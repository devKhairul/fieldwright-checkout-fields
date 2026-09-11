<?php
/**
 * WooCommerce's own checkout fields.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Fields;

use Automattic\WooCommerce\Blocks\Assets\AssetDataRegistry;
use Automattic\WooCommerce\Blocks\Domain\Services\CheckoutFields;
use Automattic\WooCommerce\Blocks\Package;
use CheckoutBuilder\Config;
use CheckoutBuilder\I18n\Strings;
use stdClass;
use Throwable;

defined( 'ABSPATH' ) || exit;

/**
 * Relabels, hides, re-requires and reorders the fields WooCommerce ships with.
 *
 * None of this is a copy of WooCommerce's field table: the keys, their labels,
 * their default order and which of them are on today all come from
 * `CheckoutFields::get_core_fields()` at runtime, so a WooCommerce release that
 * adds or renames a field is followed rather than fought.
 *
 * The merchant's changes reach the shopper along three paths, and all three are
 * needed for the block checkout and the Store API to agree:
 *
 * 1. `defaultFields` in the asset registry — the global layer the checkout's
 *    form reads. Registered as a *callable*, which WooCommerce resolves at print
 *    time, after every plugin has registered its own fields, and which overwrites
 *    the eager array WooCommerce added earlier.
 * 2. `woocommerce_default_address_fields` (and, per WooCommerce's own developer
 *    advisory, `woocommerce_get_country_locale_default`) — the server's default
 *    locale, which is the only thing the Store API's address validation reads.
 *    Without it an optional postcode is still rejected on submit.
 * 3. `woocommerce_get_country_locale` — the per-country layer, which sits *above*
 *    `defaultFields` on the client. A global change has to be written into every
 *    country entry that carries the key, or the change disappears the moment the
 *    shopper picks one of those countries.
 *
 * Two guards travel with that third path, because a country entry is WooCommerce
 * telling us something about the country rather than a stale default: a country
 * that hides the field (postcode in the UAE) is left hidden, and a country that
 * requires it (Eircode in Ireland) is never made optional.
 *
 * `email` and `country` are relabel-only: the Store API rejects an empty email
 * outright, and WooCommerce force-resets `country` in every locale because it is
 * the key the locale lookup itself is done with.
 */
final class CoreFields {

	/**
	 * Longest core-field label a merchant can type.
	 *
	 * Shorter than a custom field's, because these labels sit in WooCommerce's
	 * own floating-label inputs, which have no room for an essay.
	 */
	public const MAX_LABEL_LENGTH = 100;

	/**
	 * Gap between consecutive fields in the merged Address order.
	 *
	 * The block checkout sorts the address form by `index`, and additional fields
	 * carry one too, so core and custom fields interleave on a single scale.
	 */
	public const INDEX_STEP = 10;

	/**
	 * Contact location key, as WooCommerce names it.
	 */
	public const LOCATION_CONTACT = 'contact';

	/**
	 * Address location key, as WooCommerce names it.
	 */
	public const LOCATION_ADDRESS = 'address';

	/**
	 * The two things the merchant can switch off that are not fields at all.
	 */
	public const PSEUDO_ORDER_NOTE  = 'order_note';
	public const PSEUDO_COUPON_FORM = 'coupon_form';

	/**
	 * The blocks the pseudo-fields are, keyed by pseudo-field.
	 */
	public const PSEUDO_BLOCKS = array(
		self::PSEUDO_ORDER_NOTE  => 'woocommerce/checkout-order-note-block',
		self::PSEUDO_COUPON_FORM => 'woocommerce/checkout-order-summary-coupon-form-block',
	);

	/**
	 * The three fields whose visibility WooCommerce keeps in its own options.
	 *
	 * Their `hidden`/`required` is read from and written to these rather than
	 * stored by us, so the editor's Address Fields sidebar, the classic checkout
	 * and the builder always agree — and so deactivating us leaves WooCommerce
	 * in exactly the state the merchant last saw.
	 */
	public const OPTIONS = array(
		'company'   => 'woocommerce_checkout_company_field',
		'address_2' => 'woocommerce_checkout_address_2_field',
		'phone'     => 'woocommerce_checkout_phone_field',
	);

	/**
	 * Fields some payment gateways and shipping rate providers still need, even
	 * when the checkout no longer asks for them. WooCommerce's own documentation
	 * carries the same warning.
	 */
	public const GATEWAY_WARNING_KEYS = array( 'first_name', 'last_name', 'phone' );

	/**
	 * The properties a merchant may override, in the order they are stored.
	 */
	public const PROPS = array( 'label', 'required', 'hidden' );

	/**
	 * What cannot be changed, and why, keyed by field.
	 *
	 * `email` and `country` are WooCommerce's; `address_2` is rendered inside
	 * `address_1`'s own component, so it has nowhere else to go.
	 */
	private const LOCKS = array(
		'email'     => array(
			'hidden'   => true,
			'required' => true,
			'label'    => false,
			'order'    => true,
		),
		'country'   => array(
			'hidden'   => true,
			'required' => true,
			'label'    => false,
			'order'    => false,
		),
		'address_2' => array(
			'hidden'   => false,
			'required' => false,
			'label'    => false,
			'order'    => true,
		),
	);

	/**
	 * Nothing locked — every field the table above does not name.
	 */
	private const NO_LOCKS = array(
		'hidden'   => false,
		'required' => false,
		'label'    => false,
		'order'    => false,
	);

	/**
	 * The per-country locale array as it reached us, before our own fan-out.
	 *
	 * Kept so the builder can tell the merchant what WooCommerce itself calls a
	 * field in their base country ("shows as ZIP Code in the United States")
	 * without having to unhook and re-run the filter to find out.
	 *
	 * @var array<string, mixed>|null
	 */
	private static $wc_locale = null;

	/**
	 * Config repository.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * Constructor.
	 *
	 * @param Config $config Config repository.
	 */
	public function __construct( Config $config ) {
		$this->config = $config;
	}

	/**
	 * Attach hooks.
	 */
	public function register(): void {
		// The lazy callable has to be handed over before WooCommerce prints its
		// asset data. `woocommerce_blocks_loaded` is the earliest point the
		// registry exists; on a request where it has already fired (an add-on
		// booting late, a test) there is nothing to wait for.
		if ( did_action( 'woocommerce_blocks_loaded' ) > 0 ) {
			$this->register_default_fields();
		} else {
			add_action( 'woocommerce_blocks_loaded', array( $this, 'register_default_fields' ), 1 );
		}

		add_filter( 'woocommerce_default_address_fields', array( $this, 'filter_default_address_fields' ) );
		add_filter( 'woocommerce_get_country_locale_default', array( $this, 'filter_default_address_fields' ) );
		add_filter( 'woocommerce_get_country_locale', array( $this, 'filter_country_locale' ), 100 );
	}

	/**
	 * Hand WooCommerce the callable that produces `defaultFields`.
	 *
	 * A callable rather than an array on purpose. WooCommerce adds its own array
	 * eagerly while the checkout enqueues its data, and refuses a second `add()`
	 * for a key it already has — but a lazy value is not "already there" until
	 * output, and every lazy callback is written over the data array at print
	 * time. That ordering is also what lets the merged list include additional
	 * fields registered by plugins that boot after us.
	 */
	public function register_default_fields(): void {
		$registry = self::asset_registry();
		if ( null === $registry ) {
			return;
		}

		$registry->add( 'defaultFields', array( $this, 'default_fields' ) );
	}

	/**
	 * Everything the checkout form reads as its global field table: WooCommerce's
	 * core fields with the merchant's changes applied, plus every additional
	 * field registered this request.
	 *
	 * Every relabel in it arrives translated, by way of `global_field()`.
	 *
	 * @return array<string, mixed>
	 */
	public function default_fields(): array {
		$registry = self::registry();
		if ( null === $registry ) {
			return array();
		}

		$fields = array_merge( $registry->get_core_fields(), $registry->get_additional_fields() );

		foreach ( self::table() as $key => $base ) {
			if ( ! isset( $fields[ $key ] ) || ! is_array( $fields[ $key ] ) ) {
				continue;
			}
			$fields[ $key ] = array_merge( $fields[ $key ], $this->global_field( $key ) );
		}

		return $fields;
	}

	/**
	 * Apply the merchant's changes to WooCommerce's server-side default address
	 * fields, which is what the Store API validates against.
	 *
	 * Only what the merchant actually changed is written: an untouched field
	 * keeps WooCommerce's own wording, which is not the same as the block
	 * checkout's ("Postcode / ZIP" against "Postal code") and is what the
	 * shopper is told when a required field is left empty.
	 *
	 * The index is the exception. It is written every time, because the base
	 * country's locale entry is a copy of this array when WooCommerce has no
	 * entry of its own for it — so leaving WooCommerce's classic priorities here
	 * would order the base country's checkout differently from every other one.
	 *
	 * Every time the Checkout block or the Store API asks, that is. The same
	 * filter builds the classic checkout and the My Account address forms, and
	 * those order their fields by WooCommerce's classic priorities, which put the
	 * country fourth where the block puts it first. Writing the block's order
	 * into them would move the country to the top of forms this plugin says it
	 * leaves alone, so on those two screens the priorities are not touched.
	 *
	 * @param mixed $fields Default address fields, keyed by field.
	 * @return mixed
	 */
	public function filter_default_address_fields( $fields ) {
		if ( ! is_array( $fields ) ) {
			return $fields;
		}

		$table    = self::table();
		$marks    = $this->config->marks_required();
		$reorders = ! self::drawing_a_classic_form();

		foreach ( $fields as $key => $field ) {
			$key = (string) $key;
			if ( ! isset( $table[ $key ] ) || ! is_array( $field ) ) {
				continue;
			}

			$overrides = $this->overrides_for( $key );

			if ( isset( $overrides['label'] ) ) {
				$fields[ $key ]['label'] = $overrides['label'];
			}
			if ( isset( $overrides['required'] ) ) {
				$fields[ $key ]['required'] = $overrides['required'];
			}
			if ( ! empty( $overrides['hidden'] ) ) {
				$fields[ $key ]['hidden']   = true;
				$fields[ $key ]['required'] = false;
			}

			// This array is also what WooCommerce copies into the base country's
			// locale entry when the base country has none of its own, and that
			// copy is handed to the browser — where a locale label with no
			// `optionalLabel` beside it grows one. See mark_optional_labels().
			if ( $marks && isset( $fields[ $key ]['label'] ) && is_string( $fields[ $key ]['label'] ) ) {
				$fields[ $key ]['optionalLabel'] = $fields[ $key ]['label'];
			}

			if ( $reorders && self::LOCATION_ADDRESS === $table[ $key ]['location'] ) {
				$fields[ $key ]['priority'] = $this->index_for( $key );
			}
		}//end foreach

		return $fields;
	}

	/**
	 * Whether the request is drawing one of WooCommerce's classic address forms.
	 *
	 * That is the shortcode checkout, or any My Account screen (the edit-address
	 * form and the order pages that render addresses). Both read the default
	 * address fields through the same filter the block checkout does, and both
	 * are forms this plugin does not build.
	 *
	 * Answered only once the main query has run. Before that the conditional
	 * tags cannot say what page this is, and every earlier caller (field
	 * registration, the Store API, the asset registry) is on the block checkout's
	 * side of the line.
	 *
	 * @return bool
	 */
	private static function drawing_a_classic_form(): bool {
		if ( ! did_action( 'wp' ) || ! function_exists( 'is_account_page' ) || ! function_exists( 'is_checkout' ) ) {
			return false;
		}

		if ( is_account_page() ) {
			return true;
		}

		if ( ! is_checkout() || ! function_exists( 'wc_get_page_id' ) ) {
			return false;
		}

		// The checkout page without the Checkout block is the shortcode checkout.
		$page_id = (int) wc_get_page_id( 'checkout' );

		return $page_id > 0 && ! has_block( 'woocommerce/checkout', $page_id );
	}

	/**
	 * Fan the merchant's changes out into every country entry that carries the
	 * key, and hand the result to add-ons for their own per-country layer.
	 *
	 * A country entry is WooCommerce saying something true about the country, so
	 * two things in it are never overwritten: a field the country hides stays
	 * hidden, and a field the country requires is never made optional.
	 *
	 * @param mixed $locale Locale entries keyed by country code.
	 * @return mixed
	 */
	public function filter_country_locale( $locale ) {
		if ( ! is_array( $locale ) ) {
			return $locale;
		}

		self::$wc_locale = $locale;

		$overrides = $this->overrides();
		$marks     = $this->config->marks_required();

		if ( array() !== $overrides || $marks ) {
			foreach ( $locale as $country => $entry ) {
				if ( ! is_array( $entry ) ) {
					continue;
				}
				if ( array() !== $overrides ) {
					$entry = self::apply_to_entry( $entry, $overrides );
				}
				$locale[ $country ] = $marks ? self::mark_optional_labels( $entry ) : $entry;
			}
		}

		/**
		 * Filters the per-country locale entries after Fieldwright's own
		 * global changes have been fanned out into them.
		 *
		 * This is where a per-country override belongs: everything global has
		 * already been written, so anything set here wins, and the two guards
		 * above (a country that hides a field, a country that requires one) are
		 * yours to respect or to deliberately overrule.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string, mixed> $by_country Locale entries keyed by country code.
		 * @param CoreFields           $service    The running core-fields service.
		 */
		$filtered = apply_filters( 'cbwb_core_locale_overrides', $locale, $this );

		return is_array( $filtered ) ? $filtered : $locale;
	}

	/**
	 * Write one country's entry the way the fan-out does.
	 *
	 * Shared with `effective()`, so what the builder previews for the base
	 * country is produced by the same code the checkout is.
	 *
	 * @param array<string, mixed>                $entry     One country's locale entry.
	 * @param array<string, array<string, mixed>> $overrides Changes keyed by field.
	 * @return array<string, mixed>
	 */
	public static function apply_to_entry( array $entry, array $overrides ): array {
		foreach ( $overrides as $key => $props ) {
			if ( ! isset( $entry[ $key ] ) || ! is_array( $entry[ $key ] ) ) {
				// The country says nothing about this field, so the global layer
				// is already the answer. Writing an entry here would only pin a
				// value WooCommerce might later have an opinion about.
				continue;
			}

			if ( ! empty( $entry[ $key ]['hidden'] ) ) {
				// WooCommerce hides the postcode in the UAE because the UAE has
				// none. That is not a default waiting to be corrected.
				continue;
			}

			foreach ( $props as $prop => $value ) {
				if ( 'required' === $prop && false === $value && ! empty( $entry[ $key ]['required'] ) ) {
					// Ireland's Eircode is required because Ireland requires it.
					continue;
				}
				$entry[ $key ][ $prop ] = $value;
			}

			if ( ! empty( $props['hidden'] ) ) {
				$entry[ $key ]['required'] = false;
			}
		}//end foreach

		return $entry;
	}

	/**
	 * Give every field one country has its own wording for an `optionalLabel`
	 * that is simply that wording, so nothing in this entry can print
	 * "(optional)".
	 *
	 * The per-country layer needs this as well as `defaultFields`, and it is not
	 * a belt-and-braces second pass. WooCommerce sends no `optionalLabel` in any
	 * locale entry, but the browser *manufactures* one for every entry that
	 * carries a label — `optionalLabel = sprintf( '%s (optional)', label )` in
	 * the locale normaliser — and the country layer is merged over
	 * `defaultFields`. So a US store with the setting on would still read "ZIP
	 * Code (optional)" and "State (optional)" unless the entry says otherwise.
	 *
	 * An entry that says nothing about a field is left alone: there is nothing
	 * for the browser to build a suffix out of, so `defaultFields` is already
	 * the answer.
	 *
	 * @param array<string, mixed> $entry One country's locale entry.
	 * @return array<string, mixed>
	 */
	public static function mark_optional_labels( array $entry ): array {
		foreach ( $entry as $key => $props ) {
			if ( ! is_array( $props ) || ! isset( $props['label'] ) || ! is_string( $props['label'] ) ) {
				continue;
			}
			$entry[ $key ]['optionalLabel'] = $props['label'];
		}

		return $entry;
	}

	/**
	 * WooCommerce's core checkout fields, read from WooCommerce, in its own order.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	public static function table(): array {
		$signature = self::table_signature();

		if ( null !== self::$table && self::$table_signature === $signature ) {
			return self::$table;
		}

		$registry = self::registry();
		if ( null === $registry ) {
			// Not cached: the registry is only absent because WooCommerce has not
			// finished loading, and it will answer later in the same request.
			return array();
		}

		$table = array();

		// `get_field_location()` only answers for *additional* fields, so the two
		// key lists are what say where WooCommerce puts its own — and they are
		// still read from WooCommerce rather than assumed.
		$address = $registry->get_address_fields_keys();
		$contact = $registry->get_contact_fields_keys();

		foreach ( $registry->get_core_fields() as $key => $field ) {
			$key = (string) $key;
			if ( ! is_array( $field ) ) {
				continue;
			}

			$location = self::LOCATION_ADDRESS;
			if ( in_array( $key, $contact, true ) ) {
				$location = self::LOCATION_CONTACT;
			} elseif ( ! in_array( $key, $address, true ) ) {
				$location = 'order';
			}

			$table[ $key ] = array(
				'key'            => $key,
				'location'       => $location,
				'label'          => isset( $field['label'] ) ? (string) $field['label'] : $key,
				'optional_label' => isset( $field['optionalLabel'] ) ? (string) $field['optionalLabel'] : '',
				'required'       => ! empty( $field['required'] ),
				'hidden'         => ! empty( $field['hidden'] ),
				'index'          => isset( $field['index'] ) ? (int) $field['index'] : 0,
				'locks'          => self::LOCKS[ $key ] ?? self::NO_LOCKS,
				'source'         => isset( self::OPTIONS[ $key ] ) ? 'option' : 'field',
			);
		}//end foreach

		self::$table           = $table;
		self::$table_signature = $signature;

		return $table;
	}

	/**
	 * WooCommerce's own field table, as last built.
	 *
	 * Worth holding on to because it is read on every
	 * `get_default_address_fields()` call, and WooCommerce makes several of those
	 * per Store API request, each of which walks the whole registry.
	 *
	 * @var array<string, array<string, mixed>>|null
	 */
	private static $table = null;

	/**
	 * The settings the cached table was built under.
	 *
	 * @var string|null
	 */
	private static $table_signature = null;

	/**
	 * What the table depends on, beyond WooCommerce's own code.
	 *
	 * Three of the core fields are switched on and off by WooCommerce's own
	 * settings rather than declared once, so the cache is keyed on those settings
	 * instead of being held for the whole request. A merchant saving the
	 * WooCommerce settings screen changes them mid-request, and the table has to
	 * follow.
	 *
	 * @return string
	 */
	private static function table_signature(): string {
		$parts = array();

		foreach ( self::OPTIONS as $key => $option ) {
			$value   = get_option( $option, '' );
			$parts[] = $key . '=' . ( is_scalar( $value ) ? (string) $value : '' );
		}

		return implode( '|', $parts );
	}

	/**
	 * Whether a key is one of WooCommerce's own checkout fields.
	 *
	 * @param string $key Field key.
	 * @return bool
	 */
	public static function is_core_key( string $key ): bool {
		return isset( self::table()[ $key ] );
	}

	/**
	 * The core fields that live in the address form, in WooCommerce's own order.
	 *
	 * @return string[]
	 */
	public static function address_keys(): array {
		$keys = array();

		foreach ( self::table() as $key => $field ) {
			if ( self::LOCATION_ADDRESS === $field['location'] ) {
				$keys[] = $key;
			}
		}

		return $keys;
	}

	/**
	 * What is locked on one field.
	 *
	 * @param string $key Field key.
	 * @return array<string, bool>
	 */
	public static function locks( string $key ): array {
		return self::LOCKS[ $key ] ?? self::NO_LOCKS;
	}

	/**
	 * An empty core configuration: every field exactly as WooCommerce ships it.
	 *
	 * @return array<string, mixed>
	 */
	public static function defaults(): array {
		return array(
			'fields'                 => array(),
			'order'                  => array( self::LOCATION_ADDRESS => array() ),
			self::PSEUDO_ORDER_NOTE  => array( 'hidden' => false ),
			self::PSEUDO_COUPON_FORM => array( 'hidden' => false ),
		);
	}

	/**
	 * A normalized core configuration as JSON has to carry it.
	 *
	 * PHP has one empty value for a list and for a map, and `wp_json_encode()`
	 * writes it as `[]` — so a store with nothing overridden answered
	 * `"fields":[]` where a store with one override answered `"fields":{…}`, and
	 * every reader of the REST response, the bootstrap and an export had to
	 * accept both shapes for the same thing. Casting the one map that can
	 * legitimately be empty settles it at `{}`.
	 *
	 * Applied at the JSON boundary and nowhere else: everything on this side of
	 * it iterates and array-checks `fields`, and a `stdClass` there would only
	 * make each of those readings do the same work twice.
	 *
	 * @param array<string, mixed> $core Normalized core configuration.
	 * @return array<string, mixed>
	 */
	public static function for_json( array $core ): array {
		if ( isset( $core['fields'] ) && array() === $core['fields'] ) {
			$core['fields'] = new stdClass();
		}

		return $core;
	}

	/**
	 * Normalize a stored core configuration into the shape everything else can
	 * assume, dropping whatever no longer makes sense instead of failing the read.
	 *
	 * @param mixed $raw Stored core configuration.
	 * @return array<string, mixed>
	 */
	public static function normalize( $raw ): array {
		$core = self::defaults();

		if ( ! is_array( $raw ) ) {
			return $core;
		}

		if ( isset( $raw['fields'] ) && is_array( $raw['fields'] ) ) {
			$core['fields'] = self::normalize_fields( $raw['fields'] );
		}

		$order = array();
		if ( isset( $raw['order'][ self::LOCATION_ADDRESS ] ) && is_array( $raw['order'][ self::LOCATION_ADDRESS ] ) ) {
			$order = $raw['order'][ self::LOCATION_ADDRESS ];
		}
		$core['order'][ self::LOCATION_ADDRESS ] = self::normalize_order( $order );

		foreach ( array( self::PSEUDO_ORDER_NOTE, self::PSEUDO_COUPON_FORM ) as $pseudo ) {
			$core[ $pseudo ]['hidden'] = ! empty( $raw[ $pseudo ]['hidden'] );
		}

		return $core;
	}

	/**
	 * Keep only the overrides that mean something: known keys, known properties,
	 * nothing locked, nothing WooCommerce keeps in an option of its own — and
	 * nothing that already says what WooCommerce says.
	 *
	 * Storing only the differences is what makes an empty map mean "the checkout
	 * WooCommerce ships", and what lets a WooCommerce release that changes one of
	 * its own defaults carry the merchant along instead of being pinned in place
	 * by a value they never chose.
	 *
	 * @param array<string, mixed> $raw Raw override map.
	 * @return array<string, array<string, mixed>>
	 */
	private static function normalize_fields( array $raw ): array {
		$table  = self::table();
		$fields = array();

		foreach ( $raw as $key => $props ) {
			$key = (string) $key;

			// A WooCommerce old enough not to have the registry leaves the table
			// empty; dropping every override on that reading would lose the
			// merchant's work over a temporary absence.
			if ( array() !== $table && ! isset( $table[ $key ] ) ) {
				continue;
			}
			if ( ! is_array( $props ) ) {
				continue;
			}

			$base  = $table[ $key ] ?? array();
			$locks = self::locks( $key );
			$clean = array();

			foreach ( self::PROPS as $prop ) {
				if ( ! array_key_exists( $prop, $props ) || ! empty( $locks[ $prop ] ) ) {
					continue;
				}
				if ( 'label' === $prop ) {
					$label = self::clean_label( $props['label'] );
					if ( '' !== $label && ! self::label_says_nothing( $key, $label, $base ) ) {
						$clean['label'] = $label;
					}
					continue;
				}
				// Visibility for these three lives in WooCommerce's own option,
				// so storing a second copy could only ever disagree with it.
				if ( isset( self::OPTIONS[ $key ] ) ) {
					continue;
				}
				if ( is_bool( $props[ $prop ] ) && ( ! isset( $base[ $prop ] ) || $props[ $prop ] !== $base[ $prop ] ) ) {
					$clean[ $prop ] = $props[ $prop ];
				}
			}//end foreach

			// Hidden and required cannot both be true. A field WooCommerce
			// requires by default has to record that it no longer is; one it
			// already leaves optional has nothing to record.
			if ( ! empty( $clean['hidden'] ) ) {
				unset( $clean['required'] );
				if ( ! empty( $base['required'] ) ) {
					$clean['required'] = false;
				}
			}

			// An add-on's own settings, already checked by whoever owns them and
			// stored as they were handed over. Carried whether or not the merchant
			// changed anything else about the field, because it is a setting in its
			// own right rather than a difference from WooCommerce's default.
			if ( isset( $props['pro'] ) && is_array( $props['pro'] ) && array() !== $props['pro'] ) {
				$clean['pro'] = $props['pro'];
			}

			if ( array() !== $clean ) {
				$fields[ $key ] = self::in_prop_order( $clean );
			}
		}//end foreach

		return $fields;
	}

	/**
	 * One field's overrides in a fixed property order, so a stored map compares
	 * equal to itself however the request that produced it was written.
	 *
	 * @param array<string, mixed> $props Cleaned properties.
	 * @return array<string, mixed>
	 */
	private static function in_prop_order( array $props ): array {
		$ordered = array();

		foreach ( self::PROPS as $prop ) {
			if ( array_key_exists( $prop, $props ) ) {
				$ordered[ $prop ] = $props[ $prop ];
			}
		}

		// Last, and outside PROPS, because it is not one of the things a merchant
		// changes on a WooCommerce field: it is whatever an add-on keeps there.
		if ( array_key_exists( 'pro', $props ) ) {
			$ordered['pro'] = $props['pro'];
		}

		return $ordered;
	}

	/**
	 * Check an add-on payload on a core row: an object, and small enough to store.
	 *
	 * What is inside it is the add-on's business, not ours. The same ceiling as
	 * the one on a field's own payload applies, for the same reason: it is stored
	 * in the same option and read on every request.
	 *
	 * @param array<string, mixed> $props  Posted properties for one field.
	 * @param string               $path   Error path for the field.
	 * @param ValidationErrors     $errors Collector.
	 * @return array<string, mixed>|null
	 */
	private static function parse_pro( array $props, string $path, ValidationErrors $errors ): ?array {
		if ( ! array_key_exists( 'pro', $props ) || null === $props['pro'] ) {
			return null;
		}

		$pro_path = $path . '.pro';

		if ( ! is_array( $props['pro'] ) ) {
			$errors->add( $pro_path, 'invalid_value', __( 'Add-on settings must be an object.', 'fieldwright-checkout-fields' ) );
			return null;
		}

		$encoded = wp_json_encode( $props['pro'] );

		if ( false === $encoded ) {
			$errors->add( $pro_path, 'invalid_value', __( 'Add-on settings could not be stored.', 'fieldwright-checkout-fields' ) );
			return null;
		}

		if ( strlen( $encoded ) > FieldDefinition::MAX_PRO_BYTES ) {
			$errors->add(
				$pro_path,
				'invalid_value',
				sprintf(
					/* translators: %d: maximum number of bytes. */
					__( 'Add-on settings cannot be larger than %d bytes.', 'fieldwright-checkout-fields' ),
					FieldDefinition::MAX_PRO_BYTES
				)
			);
			return null;
		}

		return $props['pro'];
	}

	/**
	 * A display order with nothing unknown in it, no repeats, and `address_2`
	 * back where WooCommerce renders it.
	 *
	 * Keys the list does not mention are appended in WooCommerce's own order,
	 * which is what makes a stored order survive a WooCommerce release that adds
	 * a field.
	 *
	 * @param array<int, mixed> $raw Stored order.
	 * @return string[]
	 */
	private static function normalize_order( array $raw ): array {
		$order = array();

		// An id that is not a core key and is not a field id cannot be positioned,
		// and the list can hold no more than every core key plus every field the
		// merchant is allowed to add. Both are storage guards: a hand-written
		// import could otherwise leave thousands of dead ids in the option.
		$ceiling = count( self::table() ) + FieldCollection::MAX_FIELDS;

		foreach ( $raw as $entry ) {
			if ( count( $order ) >= $ceiling ) {
				break;
			}
			if ( ! is_string( $entry ) || in_array( $entry, $order, true ) ) {
				continue;
			}
			if ( self::is_core_key( $entry ) || 0 === strpos( $entry, FieldDefinition::ID_PREFIX ) ) {
				$order[] = $entry;
			}
		}

		return $order;
	}

	/**
	 * Whether a posted label only repeats the name the store already shows.
	 *
	 * Storing nothing but real differences is what lets an empty map mean "the
	 * checkout WooCommerce ships", and what carries a merchant along when a
	 * WooCommerce release changes one of its own defaults. But the name the
	 * store shows is not the table's word on its own: a country renames some of
	 * WooCommerce's fields, and the builder shows the merchant the name their
	 * own checkout prints, which for a postcode is "ZIP Code" on a US store and
	 * "Postal code" in the table behind it. Measuring against the table alone
	 * threw that rename away, and "Postal code" is exactly what a merchant on
	 * such a store types when they want the local wording gone.
	 *
	 * So a label is only read as saying nothing when the table's word is also
	 * the word the base country uses. Where that cannot be established the
	 * merchant's text is kept: a stored label that repeats a default costs a
	 * few bytes, and a discarded rename is work lost without being told.
	 *
	 * @param string               $key   Field key.
	 * @param string               $label Cleaned label from the request.
	 * @param array<string, mixed> $base  The field's row in the table.
	 * @return bool
	 */
	private static function label_says_nothing( string $key, string $label, array $base ): bool {
		if ( ! isset( $base['label'] ) || ! is_string( $base['label'] ) || $label !== $base['label'] ) {
			return false;
		}

		$locale = self::captured_base_locale();
		if ( array() === $locale ) {
			return false;
		}

		if ( ! isset( $locale[ $key ]['label'] ) || ! is_string( $locale[ $key ]['label'] ) ) {
			// The base country says nothing about this field, so the table's
			// word is the word on the checkout.
			return true;
		}

		return $locale[ $key ]['label'] === $label;
	}

	/**
	 * WooCommerce's own locale entry for the base country, if something has
	 * already read it on this request.
	 *
	 * Deliberately never reads the locale itself. Reading it runs our own
	 * `woocommerce_get_country_locale` filter, and that filter reads the stored
	 * configuration, which is what the caller is in the middle of normalizing.
	 * An empty return means "not known here", and every caller treats that as a
	 * reason to keep what the merchant sent rather than to drop it.
	 *
	 * @return array<string, mixed>
	 */
	private static function captured_base_locale(): array {
		if ( null === self::$wc_locale || ! function_exists( 'WC' ) || null === WC()->countries ) {
			return array();
		}

		$base = (string) WC()->countries->get_base_country();
		if ( '' === $base ) {
			return array();
		}

		return isset( self::$wc_locale[ $base ] ) && is_array( self::$wc_locale[ $base ] )
			? self::$wc_locale[ $base ]
			: array();
	}

	/**
	 * Sanitize one label the way a stored one is: plain text, trimmed, capped.
	 *
	 * @param mixed $label Raw label.
	 * @return string
	 */
	private static function clean_label( $label ): string {
		if ( ! is_string( $label ) ) {
			return '';
		}

		$clean = trim( sanitize_text_field( $label ) );

		return mb_strlen( $clean ) > self::MAX_LABEL_LENGTH ? mb_substr( $clean, 0, self::MAX_LABEL_LENGTH ) : $clean;
	}

	/**
	 * Validate a posted core configuration, recording every problem with a path
	 * the builder can highlight, and return the normalized result.
	 *
	 * @param mixed            $raw    Posted core configuration.
	 * @param string           $path   Error path prefix, e.g. "core".
	 * @param ValidationErrors $errors Collector.
	 * @return array<string, mixed>|null Normalized configuration, or null when it could not be read at all.
	 */
	public static function parse( $raw, string $path, ValidationErrors $errors ): ?array {
		if ( ! is_array( $raw ) ) {
			$errors->add( $path, 'invalid_value', __( 'Core field settings must be an object.', 'fieldwright-checkout-fields' ) );
			return null;
		}

		$fields = isset( $raw['fields'] ) && is_array( $raw['fields'] ) ? $raw['fields'] : array();
		$table  = self::table();

		foreach ( $fields as $key => $props ) {
			$key        = (string) $key;
			$field_path = $path . '.fields.' . $key;

			if ( array() !== $table && ! isset( $table[ $key ] ) ) {
				$errors->add(
					$field_path,
					'invalid_core_key',
					sprintf(
						/* translators: %s: field key. */
						__( '"%s" is not one of WooCommerce\'s own checkout fields.', 'fieldwright-checkout-fields' ),
						$key
					)
				);
				continue;
			}

			if ( ! is_array( $props ) ) {
				$errors->add( $field_path, 'invalid_value', __( 'Each core field must be an object.', 'fieldwright-checkout-fields' ) );
				continue;
			}

			self::parse_props( $key, $props, $field_path, $errors );

			/**
			 * Filters the add-on payload carried on one of WooCommerce's own
			 * checkout fields under the `pro` key.
			 *
			 * The counterpart of `cbwb_field_parse_pro` for the core rows, and it
			 * works the same way: Free never interprets the payload, only checks
			 * that it is an array small enough to store, and hands it here so an
			 * add-on can validate and normalize it, recording problems on the
			 * shared collector. What comes back is stored under `core.<key>.pro`
			 * and handed to the builder alongside the field's other settings.
			 * Returning anything but an array or null drops the key.
			 *
			 * @since 1.0.0
			 *
			 * @param array<string, mixed>|null $pro      Opaquely-checked payload, or null when absent.
			 * @param string                    $core_key The WooCommerce field key, e.g. "company".
			 * @param array<string, mixed>      $raw      The raw properties posted for this field.
			 * @param string                    $path     Path prefix used in error paths, e.g. "core.fields.company".
			 * @param ValidationErrors          $errors   Collector for validation problems.
			 */
			$pro = apply_filters( 'cbwb_core_parse_pro', self::parse_pro( $props, $field_path, $errors ), $key, $props, $field_path, $errors );

			// Written back onto the payload rather than kept aside, so the
			// normalize() below is still the single place that decides what is
			// stored, and a read of the stored value takes the same path.
			unset( $raw['fields'][ $key ]['pro'] );
			if ( is_array( $pro ) && array() !== $pro ) {
				$raw['fields'][ $key ]['pro'] = $pro;
			}
		}//end foreach

		if ( isset( $raw['order'] ) && ! is_array( $raw['order'] ) ) {
			$errors->add( $path . '.order', 'invalid_value', __( 'The field order must be an object.', 'fieldwright-checkout-fields' ) );
		}

		return self::normalize( $raw );
	}

	/**
	 * Check one field's posted properties.
	 *
	 * @param string               $key    Field key.
	 * @param array<string, mixed> $props  Posted properties.
	 * @param string               $path   Error path for the field.
	 * @param ValidationErrors     $errors Collector.
	 */
	private static function parse_props( string $key, array $props, string $path, ValidationErrors $errors ): void {
		$locks = self::locks( $key );

		foreach ( $props as $prop => $value ) {
			$prop = (string) $prop;

			// Checked by parse_pro() and by whichever add-on owns it, not here.
			if ( 'pro' === $prop ) {
				continue;
			}

			if ( ! in_array( $prop, self::PROPS, true ) ) {
				$errors->add(
					$path . '.' . $prop,
					'invalid_core_prop',
					sprintf(
						/* translators: %s: property name. */
						__( '"%s" is not something you can change on a WooCommerce field.', 'fieldwright-checkout-fields' ),
						$prop
					)
				);
				continue;
			}

			if ( ! empty( $locks[ $prop ] ) ) {
				$errors->add(
					$path . '.' . $prop,
					'locked_core_prop',
					sprintf(
						/* translators: 1: property name, 2: field key. */
						__( 'WooCommerce does not allow "%1$s" to be changed on its "%2$s" field.', 'fieldwright-checkout-fields' ),
						$prop,
						$key
					)
				);
				continue;
			}

			if ( 'label' === $prop ) {
				if ( ! is_string( $value ) ) {
					$errors->add( $path . '.label', 'invalid_value', __( 'The label must be text.', 'fieldwright-checkout-fields' ) );
					continue;
				}
				if ( mb_strlen( trim( $value ) ) > self::MAX_LABEL_LENGTH ) {
					$errors->add(
						$path . '.label',
						'too_long',
						sprintf(
							/* translators: %d: maximum number of characters. */
							__( 'Labels cannot be longer than %d characters.', 'fieldwright-checkout-fields' ),
							self::MAX_LABEL_LENGTH
						)
					);
				}
				continue;
			}

			if ( ! is_bool( $value ) ) {
				$errors->add(
					$path . '.' . $prop,
					'invalid_value',
					__( 'This setting must be true or false.', 'fieldwright-checkout-fields' )
				);
			}
		}//end foreach
	}

	/**
	 * The merchant's stored changes, keyed by field.
	 *
	 * Reading is a straight read: normalization has already dropped everything
	 * that is not a difference from what WooCommerce ships, so whatever is here
	 * is something the merchant asked for.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	public function overrides(): array {
		$overrides = array();

		foreach ( $this->config->core()['fields'] as $key => $props ) {
			if ( is_array( $props ) && array() !== $props ) {
				$overrides[ (string) $key ] = $props;
			}
		}

		return $overrides;
	}

	/**
	 * One field's overrides.
	 *
	 * @param string $key Field key.
	 * @return array<string, mixed>
	 */
	public function overrides_for( string $key ): array {
		return $this->overrides()[ $key ] ?? array();
	}

	/**
	 * One field as the global layer sees it: WooCommerce's own values with the
	 * merchant's changes applied, ready to be merged into `defaultFields`.
	 *
	 * A relabel is a stored option rather than a gettext string, so it is ours to
	 * translate on the way out — the same thing `I18n\Strings` does to the two
	 * server-side locale arrays, done here for the copy the browser reads.
	 * WooCommerce's own wording is left alone: it is already in the language of
	 * the request.
	 *
	 * @param string $key Field key.
	 * @return array<string, mixed>
	 */
	public function global_field( string $key ): array {
		$table = self::table();
		if ( ! isset( $table[ $key ] ) ) {
			return array();
		}

		$base      = $table[ $key ];
		$overrides = $this->overrides_for( $key );

		$label = isset( $overrides['label'] )
			? Strings::translate( (string) $overrides['label'], Strings::core_name( $key ) )
			: $base['label'];

		$field = array(
			'label'    => $label,
			'required' => $overrides['required'] ?? $base['required'],
			'hidden'   => $overrides['hidden'] ?? $base['hidden'],
		);

		if ( $field['hidden'] ) {
			$field['required'] = false;
		}

		if ( $this->config->marks_required() ) {
			// The checkout's form reads `required ? label : optionalLabel` for
			// every shape of control it draws (`createFieldProps` in
			// `wc-cart-checkout-base-frontend.js`), so a field whose two labels
			// are the same has no suffix left to print. That is how the setting
			// takes "(optional)" off WooCommerce's own fields without touching a
			// string WooCommerce owns or a component we do not control.
			$field['optionalLabel'] = $field['label'];
		} elseif ( isset( $overrides['label'] ) ) {
			$field['optionalLabel'] = sprintf(
				/* translators: %s: field label. */
				__( '%s (optional)', 'fieldwright-checkout-fields' ),
				$field['label']
			);
		}

		if ( self::LOCATION_ADDRESS === $base['location'] ) {
			$field['index'] = $this->index_for( $key );
		}

		return $field;
	}

	/**
	 * One field as the shopper sees it in the store's base country, which is what
	 * the builder previews.
	 *
	 * @param string $key Field key.
	 * @return array{label: string, required: bool, hidden: bool, index: int}
	 */
	public function effective( string $key ): array {
		$global = $this->global_field( $key );
		$table  = self::table();
		$base   = $table[ $key ] ?? array();

		$merged = array(
			'label'    => (string) ( $global['label'] ?? '' ),
			'required' => (bool) ( $global['required'] ?? false ),
			'hidden'   => (bool) ( $global['hidden'] ?? false ),
			'index'    => (int) ( $global['index'] ?? ( $base['index'] ?? 0 ) ),
		);

		// The checkout's form merges the country entry over the global one, and
		// so does this: reading the finished locale means the fan-out, its two
		// guards and WooCommerce's own per-country wording are all already in it.
		$entry = $this->live_base_locale()[ $key ] ?? array();
		if ( ! is_array( $entry ) ) {
			return $merged;
		}

		if ( isset( $entry['label'] ) && is_string( $entry['label'] ) ) {
			$merged['label'] = $entry['label'];
		}
		if ( isset( $entry['required'] ) ) {
			$merged['required'] = (bool) $entry['required'];
		}
		if ( isset( $entry['hidden'] ) ) {
			$merged['hidden'] = (bool) $entry['hidden'];
		}
		// A locale entry orders with `priority`; the browser is handed the same
		// number under the name `index` (CartCheckoutUtils::get_country_data()).
		foreach ( array( 'priority', 'index' ) as $sort ) {
			if ( isset( $entry[ $sort ] ) && is_numeric( $entry[ $sort ] ) ) {
				$merged['index'] = (int) $entry[ $sort ];
			}
		}

		if ( $merged['hidden'] ) {
			$merged['required'] = false;
		}

		return $merged;
	}

	/**
	 * The display order of the Address section: WooCommerce's own fields and our
	 * address fields in one list, `address_2` glued under `address_1`.
	 *
	 * @return string[]
	 */
	public function address_order(): array {
		$known = array_merge( self::address_keys(), $this->custom_address_ids() );
		$order = array();

		foreach ( $this->config->core()['order'][ self::LOCATION_ADDRESS ] as $key ) {
			if ( in_array( $key, $known, true ) && ! in_array( $key, $order, true ) ) {
				$order[] = $key;
			}
		}

		foreach ( $known as $key ) {
			if ( ! in_array( $key, $order, true ) ) {
				$order[] = $key;
			}
		}

		return self::glue_address_2( $order );
	}

	/**
	 * Put `address_2` back directly after `address_1`.
	 *
	 * WooCommerce renders the two as one component, so wherever the list claims
	 * `address_2` is, the checkout draws it under `address_1` regardless.
	 *
	 * @param string[] $order Display order.
	 * @return string[]
	 */
	private static function glue_address_2( array $order ): array {
		$first  = array_search( 'address_1', $order, true );
		$second = array_search( 'address_2', $order, true );

		if ( false === $first || false === $second ) {
			return $order;
		}

		unset( $order[ $second ] );
		$order = array_values( $order );

		$at = (int) array_search( 'address_1', $order, true );

		array_splice( $order, $at + 1, 0, array( 'address_2' ) );

		return $order;
	}

	/**
	 * Our own address-location fields, in the order the merchant arranged them.
	 *
	 * @return string[]
	 */
	private function custom_address_ids(): array {
		$ids = array();

		foreach ( $this->config->fields()->by_location( FieldDefinition::LOCATION_ADDRESS ) as $field ) {
			$ids[] = $field->id();
		}

		return $ids;
	}

	/**
	 * The index one address field is rendered at.
	 *
	 * Works for our own fields as well as WooCommerce's: they share one sorted
	 * list, which is the only way a custom field can sit between two core ones.
	 *
	 * @param string $key Field key or field id.
	 * @return int
	 */
	public function index_for( string $key ): int {
		$order    = $this->address_order();
		$position = array_search( $key, $order, true );

		if ( false === $position ) {
			// A field the order has never heard of — one being previewed before
			// it is stored — goes after everything in it rather than on top of
			// whatever happens to be first.
			$position = count( $order );
		}

		return ( (int) $position + 1 ) * self::INDEX_STEP;
	}

	/**
	 * The store's base country.
	 *
	 * @return string
	 */
	public function base_country(): string {
		if ( ! function_exists( 'WC' ) || null === WC()->countries ) {
			return '';
		}

		return (string) WC()->countries->get_base_country();
	}

	/**
	 * The store's base country, named the way WooCommerce names it.
	 *
	 * The builder puts this in a sentence — "Shows as “ZIP Code” in United
	 * States (US)." — so the name is taken from WooCommerce's own list rather
	 * than rebuilt: a merchant reading it should recognise the country exactly
	 * as WooCommerce's own settings screen spells it.
	 *
	 * @return string Empty when WooCommerce has no name for the base country.
	 */
	public function base_country_label(): string {
		$base = $this->base_country();
		if ( '' === $base || ! function_exists( 'WC' ) || null === WC()->countries ) {
			return '';
		}

		$countries = WC()->countries->get_countries();

		return isset( $countries[ $base ] ) && is_string( $countries[ $base ] ) ? $countries[ $base ] : '';
	}

	/**
	 * The labels WooCommerce itself gives its fields in the base country — "ZIP
	 * Code" for a US postcode — so the builder can explain a name the merchant
	 * did not choose and is not seeing a bug in.
	 *
	 * @return array<string, string>
	 */
	public function base_country_label_overrides(): array {
		$labels    = array();
		$overrides = $this->overrides();

		foreach ( $this->base_locale_entry() as $key => $props ) {
			$key = (string) $key;
			if ( ! is_array( $props ) || ! isset( $props['label'] ) || ! is_string( $props['label'] ) ) {
				continue;
			}
			if ( ! self::is_core_key( $key ) ) {
				continue;
			}
			// A fallback reading (our filter never ran) would otherwise report
			// the merchant's own relabel back to them as WooCommerce's wording.
			if ( isset( $overrides[ $key ]['label'] ) && $overrides[ $key ]['label'] === $props['label'] ) {
				continue;
			}
			$labels[ $key ] = $props['label'];
		}

		return $labels;
	}

	/**
	 * The base country's finished locale entry — every filter applied, ours
	 * included — which is exactly what the browser is handed for that country.
	 *
	 * @return array<string, mixed>
	 */
	private function live_base_locale(): array {
		$base = $this->base_country();
		if ( '' === $base || ! function_exists( 'WC' ) || null === WC()->countries ) {
			return array();
		}

		$locale = WC()->countries->get_country_locale();

		return isset( $locale[ $base ] ) && is_array( $locale[ $base ] ) ? $locale[ $base ] : array();
	}

	/**
	 * WooCommerce's own locale entry for the base country, before our fan-out.
	 *
	 * @return array<string, mixed>
	 */
	private function base_locale_entry(): array {
		$base = $this->base_country();
		if ( '' === $base ) {
			return array();
		}

		// Reading the locale is what runs our filter, and running our filter is
		// what captures WooCommerce's own copy. The result is cached on the
		// countries object, so this costs nothing after the first call.
		$live = $this->live_base_locale();
		if ( null === self::$wc_locale ) {
			return $live;
		}

		return isset( self::$wc_locale[ $base ] ) && is_array( self::$wc_locale[ $base ] ) ? self::$wc_locale[ $base ] : array();
	}

	/**
	 * Write the three option-backed fields' visibility back to WooCommerce.
	 *
	 * Only a field the request actually says something about is touched, and a
	 * property the request leaves out keeps whatever the option already had —
	 * so a merchant switching a field back on does not silently lose its
	 * "required" setting along the way.
	 *
	 * @param array<string, mixed> $fields The request's `core.fields` map.
	 */
	public function sync_options( array $fields ): void {
		foreach ( self::OPTIONS as $key => $option ) {
			$props = isset( $fields[ $key ] ) && is_array( $fields[ $key ] ) ? $fields[ $key ] : null;
			if ( null === $props ) {
				continue;
			}
			if ( ! array_key_exists( 'hidden', $props ) && ! array_key_exists( 'required', $props ) ) {
				continue;
			}

			$current = (string) get_option( $option, 'optional' );

			$hidden = array_key_exists( 'hidden', $props ) ? ! empty( $props['hidden'] ) : 'hidden' === $current;

			if ( $hidden ) {
				update_option( $option, 'hidden' );
				continue;
			}

			$required = array_key_exists( 'required', $props ) ? ! empty( $props['required'] ) : 'required' === $current;

			update_option( $option, $required ? 'required' : 'optional' );
		}//end foreach
	}

	/**
	 * Whether one of the two pseudo-fields is switched off.
	 *
	 * @param string $pseudo Pseudo-field key.
	 * @return bool
	 */
	public function pseudo_is_hidden( string $pseudo ): bool {
		$core = $this->config->core();

		return isset( $core[ $pseudo ]['hidden'] ) && true === $core[ $pseudo ]['hidden'];
	}

	/**
	 * Every core field as the builder needs it, in WooCommerce's own order.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public function rows(): array {
		$rows = array();

		$overrides = $this->overrides();

		foreach ( self::table() as $key => $base ) {
			$effective = $this->effective( $key );
			$pro       = $overrides[ $key ]['pro'] ?? null;

			$rows[] = array(
				'key'           => $key,
				'location'      => $base['location'],
				'label'         => $base['label'],
				'resolvedLabel' => $effective['label'],
				'required'      => $effective['required'],
				'hidden'        => $effective['hidden'],
				'locks'         => $base['locks'],
				'index'         => $effective['index'],
				'source'        => $base['source'],
				// Whatever an add-on stored against this field, handed back
				// untouched so its own screen can read it. Absent rather than null
				// when there is none, the way a field's own `pro` is.
				'pro'           => is_array( $pro ) ? $pro : null,
			);
		}

		return $rows;
	}

	/**
	 * WooCommerce's additional-checkout-fields registry, or null on a request
	 * where WooCommerce's block package is not up yet.
	 *
	 * @return CheckoutFields|null
	 */
	private static function registry(): ?CheckoutFields {
		if ( ! class_exists( Package::class ) || ! class_exists( CheckoutFields::class ) ) {
			return null;
		}

		try {
			$registry = Package::container()->get( CheckoutFields::class );
		} catch ( Throwable $error ) {
			return null;
		}

		return $registry instanceof CheckoutFields ? $registry : null;
	}

	/**
	 * WooCommerce's asset data registry, or null when the block package is not
	 * up yet.
	 *
	 * @return AssetDataRegistry|null
	 */
	private static function asset_registry(): ?AssetDataRegistry {
		if ( ! class_exists( Package::class ) || ! class_exists( AssetDataRegistry::class ) ) {
			return null;
		}

		try {
			$registry = Package::container()->get( AssetDataRegistry::class );
		} catch ( Throwable $error ) {
			return null;
		}

		return $registry instanceof AssetDataRegistry ? $registry : null;
	}
}
