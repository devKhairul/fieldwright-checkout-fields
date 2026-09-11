<?php
/**
 * Immutable value object describing one custom checkout field.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Fields;

use DateTimeImmutable;
use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Validates and normalizes the merchant-supplied shape of a field.
 *
 * Fields come in four families:
 *
 * - `core`   — registered with WooCommerce's Additional Checkout Fields API,
 *              which only understands text, select and checkbox. Everything
 *              else in this family (email, phone, number, url) is a text field
 *              with a format preset and a `data-cbwb-type` attribute the
 *              checkout bundle uses to set the real input type.
 * - `rich`   — rendered by our own checkout block and stored under our own
 *              order meta key, because core has no equivalent. Every type an
 *              add-on registers through `TypeRegistry` is one of these.
 * - `content`— headings and paragraphs: no value, never required, never stored.
 * - `unavailable` — a field whose type nothing answers for today, because the
 *              add-on that provided it is not running. The field keeps its
 *              place and its settings and the merchant can still rename, move,
 *              switch off or delete it; nothing else touches it, because the
 *              three predicates every render, registration, validation,
 *              prefill, privacy and email path filters on are all false for it.
 *
 * WooCommerce rejects malformed field registrations silently (a
 * `_doing_it_wrong` notice and nothing else), so every value is checked here
 * before it is ever handed to core.
 */
final class FieldDefinition {

	public const TYPE_TEXT           = 'text';
	public const TYPE_EMAIL          = 'email';
	public const TYPE_PHONE          = 'phone';
	public const TYPE_NUMBER         = 'number';
	public const TYPE_URL            = 'url';
	public const TYPE_SELECT         = 'select';
	public const TYPE_CHECKBOX       = 'checkbox';
	public const TYPE_TEXTAREA       = 'textarea';
	public const TYPE_RADIO          = 'radio';
	public const TYPE_CHECKBOX_GROUP = 'checkbox_group';
	public const TYPE_DATE           = 'date';
	public const TYPE_TIME           = 'time';
	public const TYPE_HEADING        = 'heading';
	public const TYPE_PARAGRAPH      = 'paragraph';

	public const FAMILY_CORE        = 'core';
	public const FAMILY_RICH        = 'rich';
	public const FAMILY_CONTENT     = 'content';
	public const FAMILY_UNAVAILABLE = 'unavailable';

	public const LOCATION_CONTACT            = 'contact';
	public const LOCATION_ADDRESS            = 'address';
	public const LOCATION_SHIPPING_ADDRESS   = 'shipping_address';
	public const LOCATION_BILLING_ADDRESS    = 'billing_address';
	public const LOCATION_ORDER              = 'order';
	public const LOCATION_AFTER_SHIPPING     = 'after_shipping';
	public const LOCATION_AFTER_PAYMENT      = 'after_payment';
	public const LOCATION_BEFORE_PLACE_ORDER = 'before_place_order';
	public const LOCATION_ORDER_SUMMARY      = 'order_summary';

	public const WIDTH_FULL = 'full';
	public const WIDTH_HALF = 'half';

	public const LAYOUT_STACKED = 'stacked';
	public const LAYOUT_INLINE  = 'inline';

	/**
	 * Namespace every field id must use.
	 */
	public const ID_PREFIX = 'cbwb/';

	/**
	 * Full id pattern (namespace plus a hyphen-separated lowercase slug).
	 */
	public const ID_PATTERN = '/^cbwb\/[a-z0-9]+(-[a-z0-9]+)*$/';

	public const MAX_ID_LENGTH            = 64;
	public const MAX_LABEL_LENGTH         = 200;
	public const MAX_PLACEHOLDER_LENGTH   = 200;
	public const MAX_ERROR_LENGTH         = 200;
	public const MAX_OPTION_VALUE_LENGTH  = 100;
	public const MAX_OPTION_LABEL_LENGTH  = 200;
	public const MAX_FIELD_LENGTH         = 1000;
	public const MAX_TEXTAREA_LENGTH      = 5000;
	public const MAX_HELP_LENGTH          = 300;
	public const MAX_DEFAULT_VALUE_LENGTH = 1000;
	public const MAX_CONTENT_LENGTH       = 2000;
	public const MAX_OPTIONS              = 100;

	public const MIN_ROWS     = 2;
	public const MAX_ROWS     = 10;
	public const DEFAULT_ROWS = 3;

	/**
	 * Minutes between selectable times on a time field.
	 */
	public const DEFAULT_TIME_STEP = 15;
	public const MAX_TIME_STEP     = 1440;

	public const DEFAULT_CONTENT_LEVEL = 3;

	/**
	 * Size cap on the opaque `pro` payload, measured as encoded JSON. Free never
	 * inspects the contents, so this is the only thing keeping an add-on (or a
	 * hand-edited payload) from bloating the option row.
	 */
	public const MAX_PRO_BYTES = 8192;

	/**
	 * Option values are persisted as order meta, so keep them plain.
	 */
	public const OPTION_VALUE_PATTERN = '/^[A-Za-z0-9_.:-]+$/';

	/**
	 * Normalized field data keyed exactly as the JSON contract.
	 *
	 * @var array<string, mixed>
	 */
	private $data;

	/**
	 * Constructor.
	 *
	 * @param array<string, mixed> $data Already-normalized data.
	 */
	private function __construct( array $data ) {
		$this->data = $data;
	}

	/**
	 * Fieldwright's own field types, mapped to the family that decides how
	 * each is rendered, validated and stored.
	 *
	 * @return array<string, string>
	 */
	private static function builtin_families(): array {
		return array(
			self::TYPE_TEXT           => self::FAMILY_CORE,
			self::TYPE_EMAIL          => self::FAMILY_CORE,
			self::TYPE_PHONE          => self::FAMILY_CORE,
			self::TYPE_NUMBER         => self::FAMILY_CORE,
			self::TYPE_URL            => self::FAMILY_CORE,
			self::TYPE_SELECT         => self::FAMILY_CORE,
			self::TYPE_CHECKBOX       => self::FAMILY_CORE,
			self::TYPE_TEXTAREA       => self::FAMILY_RICH,
			self::TYPE_RADIO          => self::FAMILY_RICH,
			self::TYPE_CHECKBOX_GROUP => self::FAMILY_RICH,
			self::TYPE_DATE           => self::FAMILY_RICH,
			self::TYPE_TIME           => self::FAMILY_RICH,
			self::TYPE_HEADING        => self::FAMILY_CONTENT,
			self::TYPE_PARAGRAPH      => self::FAMILY_CONTENT,
		);
	}

	/**
	 * Fieldwright's own field types.
	 *
	 * @return string[]
	 */
	public static function builtin_types(): array {
		return array_keys( self::builtin_families() );
	}

	/**
	 * Every field type something answers for, mapped to its family.
	 *
	 * A registered type is `rich` whether or not its spec says it reaches the
	 * checkout: the add-on that registered it can still say what a stored
	 * answer reads as, so the order screen, the emails and the thank-you page
	 * go on showing the answers customers already gave. Whether new ones can be
	 * collected is a separate question, `is_available()`, that the checkout
	 * paths ask on top of the family.
	 *
	 * @return array<string, string>
	 */
	public static function families(): array {
		$families = self::builtin_families();

		foreach ( array_keys( TypeRegistry::all() ) as $key ) {
			$families[ $key ] = self::FAMILY_RICH;
		}

		return $families;
	}

	/**
	 * The types a field can be collected as today: the built-in ones, and the
	 * registered ones whose spec says they reach the checkout.
	 *
	 * @return string[]
	 */
	public static function types(): array {
		return array_values(
			array_filter(
				array_keys( self::families() ),
				array( self::class, 'type_is_available' )
			)
		);
	}

	/**
	 * Whether a field of this type can reach the checkout today.
	 *
	 * True for every built-in type, and for a registered type while its spec's
	 * `checkout` flag says so. False for a registered type whose add-on is
	 * running but has said, through that flag, that it cannot take new answers,
	 * and for a type nothing answers for at all.
	 *
	 * @param string $type Field type.
	 * @return bool
	 */
	public static function type_is_available( string $type ): bool {
		$spec = TypeRegistry::spec( $type );

		if ( null !== $spec ) {
			return true === $spec['checkout'];
		}

		return isset( self::builtin_families()[ $type ] );
	}

	/**
	 * Every type the builder knows a name for, whether or not it reaches the
	 * checkout: the catalogue the type picker and the field editor are built
	 * from, where a type waiting on its add-on is still something to edit.
	 *
	 * @return string[]
	 */
	public static function known_types(): array {
		return array_values( array_unique( array_merge( self::builtin_types(), array_keys( TypeRegistry::all() ) ) ) );
	}

	/**
	 * The family one type belongs to.
	 *
	 * A type nothing answers for is `unavailable` rather than `core`: handing
	 * an unknown type to WooCommerce would register it as a text box, which is
	 * not what the merchant configured and not something the add-on that owns
	 * the type could ever undo.
	 *
	 * @param string $type Field type.
	 * @return string
	 */
	public static function family_for( string $type ): string {
		return self::families()[ $type ] ?? self::FAMILY_UNAVAILABLE;
	}

	/**
	 * The type WooCommerce is asked to register a core-backed field as. Core
	 * only understands three; email, phone, number and url are text boxes the
	 * checkout bundle upgrades in the browser.
	 *
	 * @param string $type Field type.
	 * @return string
	 */
	public static function core_type_for( string $type ): string {
		if ( self::TYPE_SELECT === $type || self::TYPE_CHECKBOX === $type ) {
			return $type;
		}
		return self::TYPE_TEXT;
	}

	/**
	 * Every supported placement.
	 *
	 * The order is the order placements are injected in, so two that share an
	 * anchor always come out the same way round: `address` reaches both address
	 * forms, so it is listed before the two that reach only one of them and its
	 * fields therefore sit above theirs.
	 *
	 * @return string[]
	 */
	public static function locations(): array {
		return array(
			self::LOCATION_CONTACT,
			self::LOCATION_ADDRESS,
			self::LOCATION_SHIPPING_ADDRESS,
			self::LOCATION_BILLING_ADDRESS,
			self::LOCATION_ORDER,
			self::LOCATION_AFTER_SHIPPING,
			self::LOCATION_AFTER_PAYMENT,
			self::LOCATION_BEFORE_PLACE_ORDER,
			self::LOCATION_ORDER_SUMMARY,
		);
	}

	/**
	 * The two placements that reach one address form only.
	 *
	 * WooCommerce's own Checkout Fields API has no way to say "billing but not
	 * shipping": a field registered in the address location appears in both
	 * forms. These two are ours, and only the types we render ourselves can use
	 * them, because only those are placed by our own block rather than by
	 * WooCommerce's registry.
	 *
	 * @return string[]
	 */
	public static function single_address_locations(): array {
		return array( self::LOCATION_SHIPPING_ADDRESS, self::LOCATION_BILLING_ADDRESS );
	}

	/**
	 * The placements WooCommerce's own API can put a field in. Everything past
	 * these three is somewhere only our own checkout block can reach.
	 *
	 * @return string[]
	 */
	public static function core_locations(): array {
		return array( self::LOCATION_CONTACT, self::LOCATION_ADDRESS, self::LOCATION_ORDER );
	}

	/**
	 * The placements a value can be remembered against the customer from.
	 *
	 * Where the answer is about the person rather than about this one order.
	 * WooCommerce remembers its own contact and address fields that way, so a
	 * field standing in either address form belongs with them: a door code or a
	 * delivery note is the same next time the customer ships to the same place.
	 * Everything further down the checkout is about the order in front of them.
	 *
	 * @return string[]
	 */
	public static function profile_locations(): array {
		return array(
			self::LOCATION_CONTACT,
			self::LOCATION_ADDRESS,
			self::LOCATION_SHIPPING_ADDRESS,
			self::LOCATION_BILLING_ADDRESS,
		);
	}

	/**
	 * Placements one type may use.
	 *
	 * A registered type names its own, because the add-on that draws it is the
	 * only thing that knows where it makes sense.
	 *
	 * @param string $type Field type.
	 * @return string[]
	 */
	public static function locations_for( string $type ): array {
		$spec = TypeRegistry::spec( $type );

		if ( null !== $spec ) {
			/**
			 * Normalized by TypeRegistry, so every entry is a known placement.
			 *
			 * @var string[] $placements
			 */
			$placements = $spec['placements'];
			return $placements;
		}

		return self::FAMILY_CORE === self::family_for( $type ) ? self::core_locations() : self::locations();
	}

	/**
	 * Field widths.
	 *
	 * @return string[]
	 */
	public static function widths(): array {
		return array( self::WIDTH_FULL, self::WIDTH_HALF );
	}

	/**
	 * Option layouts for radios and checkbox groups.
	 *
	 * @return string[]
	 */
	public static function option_layouts(): array {
		return array( self::LAYOUT_STACKED, self::LAYOUT_INLINE );
	}

	/**
	 * Heading levels a content heading may use.
	 *
	 * @return int[]
	 */
	public static function content_levels(): array {
		return array( 2, 3, 4 );
	}

	/**
	 * The places a stored value can be shown, in the order the builder lists them.
	 *
	 * @return string[]
	 */
	public static function visibility_keys(): array {
		return array( 'thank_you', 'emails', 'admin', 'account' );
	}

	/**
	 * Everything visible by default.
	 *
	 * @return array<string, bool>
	 */
	public static function default_visibility(): array {
		return array_fill_keys( self::visibility_keys(), true );
	}

	/**
	 * Default (empty) field shape.
	 *
	 * @return array<string, mixed>
	 */
	public static function defaults(): array {
		return array(
			'id'                         => '',
			'label'                      => '',
			'type'                       => self::TYPE_TEXT,
			'location'                   => self::LOCATION_ORDER,
			'required'                   => false,
			'enabled'                    => true,
			'placeholder'                => '',
			'options'                    => array(),
			'error_message'              => '',
			'format'                     => FormatPresets::ANY,
			'pattern'                    => '',
			'max_length'                 => null,
			'autocomplete'               => '',
			'show_in_order_confirmation' => true,
			'help'                       => '',
			'default_value'              => '',
			'width'                      => self::WIDTH_FULL,
			'visibility'                 => self::default_visibility(),
			'save_to_profile'            => false,
			'options_layout'             => self::LAYOUT_STACKED,
			'rows'                       => self::DEFAULT_ROWS,
			'min'                        => null,
			'max'                        => null,
			'step'                       => null,
			'date_min'                   => '',
			'date_max'                   => '',
			'time_min'                   => '',
			'time_max'                   => '',
			'content'                    => '',
			'content_level'              => self::DEFAULT_CONTENT_LEVEL,
		);
	}

	/**
	 * Build a field from raw (decoded JSON) input.
	 *
	 * @param array<string, mixed> $raw  Raw field data.
	 * @param string               $path Path prefix used in error paths, e.g. "fields[2]".
	 * @return FieldDefinition|WP_Error The field, or every problem found with it.
	 */
	public static function from_array( array $raw, string $path = '' ) {
		$errors = new ValidationErrors();
		$field  = self::parse( $raw, $path, $errors );

		if ( $errors->has_errors() || null === $field ) {
			return $errors->to_wp_error();
		}

		return $field;
	}

	/**
	 * Validate and normalize raw input, recording problems into a shared collector.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix used in error paths.
	 * @param ValidationErrors     $errors Collector.
	 * @return FieldDefinition|null Null when the field could not be built.
	 */
	public static function parse( array $raw, string $path, ValidationErrors $errors ): ?FieldDefinition {
		$before = count( $errors->items() );
		$data   = self::defaults();

		$data['type']     = self::parse_type( $raw, $path, $errors );
		$data['location'] = self::parse_location( $raw, $data['type'], $path, $errors );
		$data['id']       = self::parse_id( $raw, $path, $errors );
		$data['label']    = self::parse_label( $raw, $path, $errors );

		$type       = (string) $data['type'];
		$family     = self::family_for( $type );
		$is_core    = self::FAMILY_CORE === $family;
		$is_content = self::FAMILY_CONTENT === $family;
		$available  = self::FAMILY_UNAVAILABLE !== $family;

		// A type nothing answers for is parsed in common keys alone: the id,
		// the label, the type itself, where it sits, whether it is on, whether
		// it is required, where its answer is shown, the hint, the width and
		// the add-on payload. Everything below is asked of a named type, and
		// none of the questions match a name nobody here knows, so the type's
		// own settings keep the defaults they were stored with and come back
		// unchanged the moment the add-on is running again.
		$data['enabled'] = self::parse_bool( $raw, 'enabled', true, $path, $errors );

		// A heading or a paragraph has no value, so it can never be missing one.
		$data['required'] = $is_content ? false : self::parse_bool( $raw, 'required', false, $path, $errors );

		$confirmation       = self::parse_bool( $raw, 'show_in_order_confirmation', true, $path, $errors );
		$data['visibility'] = $is_content
			? self::default_visibility()
			: self::parse_visibility( $raw, $confirmation, $path, $errors );

		// `show_in_order_confirmation` is the key WooCommerce knows and the key
		// stores upgrading from schema 2 already have, so the two are kept in
		// step in both directions rather than one shadowing the other.
		$data['show_in_order_confirmation'] = (bool) $data['visibility']['thank_you'];

		$has_options = in_array( $type, array( self::TYPE_SELECT, self::TYPE_RADIO, self::TYPE_CHECKBOX_GROUP ), true );

		if ( self::TYPE_SELECT === $type ) {
			// A placeholder is the dropdown's first, unselected choice. Text
			// inputs have no room for one: WooCommerce floats the label inside
			// the input, so a placeholder would render on top of it.
			$data['placeholder'] = self::parse_string( $raw, 'placeholder', self::MAX_PLACEHOLDER_LENGTH, $path, $errors );
		}

		if ( $has_options ) {
			$data['options'] = self::parse_options( $raw, $path, $errors );
		}

		if ( self::TYPE_RADIO === $type || self::TYPE_CHECKBOX_GROUP === $type ) {
			$data['options_layout'] = self::parse_enum( $raw, 'options_layout', self::option_layouts(), self::LAYOUT_STACKED, 'invalid_value', $path, $errors );
		}

		// On a checkbox this is the "you have to tick this" message; on anything
		// with a value it is what the customer reads when that value is missing
		// or does not match. A dropdown has neither, so it keeps the default.
		if ( ! $is_content && self::TYPE_SELECT !== $type ) {
			$data['error_message'] = self::parse_string( $raw, 'error_message', self::MAX_ERROR_LENGTH, $path, $errors );
		}

		if ( self::is_text_backed( $type ) ) {
			// The four typed text fields are a text box with the matching
			// preset forced on: the merchant picked the format when they picked
			// the type, so there is nothing left to choose.
			$data['format']     = self::TYPE_TEXT === $type ? self::parse_format( $raw, $path, $errors ) : $type;
			$data['pattern']    = self::parse_pattern( $raw, (string) $data['format'], $path, $errors );
			$data['max_length'] = self::parse_max_length( $raw, self::MAX_FIELD_LENGTH, $path, $errors );
		}

		if ( self::TYPE_NUMBER === $type ) {
			$data['min']  = self::parse_number( $raw, 'min', $path, $errors );
			$data['max']  = self::parse_number( $raw, 'max', $path, $errors );
			$data['step'] = self::parse_step( $raw, $path, $errors );

			if ( null !== $data['min'] && null !== $data['max'] && $data['min'] > $data['max'] ) {
				$errors->add( self::path( $path, 'max' ), 'invalid_range', __( 'The maximum must be greater than the minimum.', 'fieldwright-checkout-fields' ) );
			}
		}

		if ( self::TYPE_TEXTAREA === $type ) {
			$data['rows']       = self::parse_rows( $raw, $path, $errors );
			$data['max_length'] = self::parse_max_length( $raw, self::MAX_TEXTAREA_LENGTH, $path, $errors );
		}

		if ( self::TYPE_DATE === $type ) {
			$data['date_min'] = self::parse_date( $raw, 'date_min', $path, $errors );
			$data['date_max'] = self::parse_date( $raw, 'date_max', $path, $errors );

			if ( '' !== $data['date_min'] && '' !== $data['date_max'] && $data['date_min'] > $data['date_max'] ) {
				$errors->add( self::path( $path, 'date_max' ), 'invalid_range', __( 'The latest date must not come before the earliest one.', 'fieldwright-checkout-fields' ) );
			}
		}

		if ( self::TYPE_TIME === $type ) {
			$data['time_min'] = self::parse_time( $raw, 'time_min', $path, $errors );
			$data['time_max'] = self::parse_time( $raw, 'time_max', $path, $errors );
			$data['step']     = self::parse_time_step( $raw, $path, $errors );

			if ( '' !== $data['time_min'] && '' !== $data['time_max'] && $data['time_min'] > $data['time_max'] ) {
				$errors->add( self::path( $path, 'time_max' ), 'invalid_range', __( 'The latest time must not come before the earliest one.', 'fieldwright-checkout-fields' ) );
			}
		}

		if ( self::TYPE_HEADING === $type ) {
			$data['content_level'] = self::parse_content_level( $raw, $path, $errors );
		}

		if ( self::TYPE_PARAGRAPH === $type ) {
			$data['content'] = self::parse_content( $raw, $path, $errors );
		}

		if ( ! $is_content ) {
			$data['help'] = self::parse_string( $raw, 'help', self::MAX_HELP_LENGTH, $path, $errors );
		}

		// Only a type that has somewhere to put one. A registered type says so
		// itself, and a type nothing answers for has nothing to check a
		// starting value against, so it carries none.
		if ( ! $is_content && self::takes_default_value( $type ) ) {
			$data['default_value'] = self::parse_default_value( $raw, $data, $path, $errors );
		}

		// Core lays its own fields out; only the ones we render ourselves can be
		// asked to sit beside a neighbour.
		$data['width'] = $is_core
			? self::WIDTH_FULL
			: self::parse_enum( $raw, 'width', self::widths(), self::WIDTH_FULL, 'invalid_width', $path, $errors );

		// WooCommerce already writes its own contact and address fields to the
		// customer, so the option only means something for the ones we store,
		// and among those only for a type whose answer is about the person
		// rather than about this one order.
		$data['save_to_profile'] = self::takes_profile_value( $type )
			&& in_array( $data['location'], self::profile_locations(), true )
			&& self::parse_bool( $raw, 'save_to_profile', false, $path, $errors );

		$data['autocomplete'] = $is_content || ! $available ? '' : self::parse_autocomplete( $raw, $path, $errors );
		if ( '' === $data['autocomplete'] ) {
			$data['autocomplete'] = self::default_autocomplete( $type );
		}

		/**
		 * Filters the add-on payload carried on a field under the `pro` key.
		 *
		 * Free never interprets the payload: it only checks that it is an
		 * array small enough to store, and hands that value through this filter
		 * so an add-on can validate and normalize it (recording problems on the
		 * shared `$errors` collector). Returning anything but an array or null
		 * drops the key.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string, mixed>|null $pro    Opaquely-checked payload, or null when absent.
		 * @param array<string, mixed>      $raw    The raw field being parsed.
		 * @param string                    $path   Path prefix used in error paths, e.g. "fields[2]".
		 * @param ValidationErrors          $errors Collector for validation problems.
		 * @param array<string, mixed>      $data   Field data parsed so far.
		 */
		$pro         = apply_filters( 'cbwb_field_parse_pro', self::parse_pro( $raw, $path, $errors ), $raw, $path, $errors, $data );
		$data['pro'] = is_array( $pro ) ? $pro : null;

		if ( count( $errors->items() ) > $before ) {
			return null;
		}

		return new self( $data );
	}

	/**
	 * Whether a type carries a value the merchant can set the field to start
	 * out with.
	 *
	 * A registered type answers for itself, because only the add-on knows
	 * whether a starting value means anything for it: an answer nothing can
	 * stand in for has nowhere to put one. The answer does not depend on
	 * whether the type reaches the checkout today, so a store whose add-on has
	 * stopped running keeps the merchant's setting rather than quietly dropping
	 * it on the next save.
	 *
	 * @param string $type Field type.
	 * @return bool
	 */
	private static function takes_default_value( string $type ): bool {
		$spec = TypeRegistry::spec( $type );

		if ( null !== $spec ) {
			return (bool) $spec['default_value'];
		}

		return in_array( $type, self::builtin_types(), true );
	}

	/**
	 * Whether a type's answer can be remembered against the customer.
	 *
	 * @param string $type Field type.
	 * @return bool
	 */
	private static function takes_profile_value( string $type ): bool {
		$spec = TypeRegistry::spec( $type );

		if ( null !== $spec ) {
			return (bool) $spec['save_to_profile'];
		}

		return self::FAMILY_RICH === self::family_for( $type );
	}

	/**
	 * Whether a type is registered with WooCommerce as a plain text box.
	 *
	 * @param string $type Field type.
	 * @return bool
	 */
	private static function is_text_backed( string $type ): bool {
		return in_array( $type, array( self::TYPE_TEXT, self::TYPE_EMAIL, self::TYPE_PHONE, self::TYPE_NUMBER, self::TYPE_URL ), true );
	}

	/**
	 * The autocomplete token a typed text field gets when the merchant set none.
	 *
	 * @param string $type Field type.
	 * @return string
	 */
	private static function default_autocomplete( string $type ): string {
		$defaults = array(
			self::TYPE_EMAIL => 'email',
			self::TYPE_PHONE => 'tel',
			self::TYPE_URL   => 'url',
		);
		return $defaults[ $type ] ?? '';
	}

	/**
	 * Field id, e.g. "cbwb/gift-message".
	 *
	 * @return string
	 */
	public function id(): string {
		return (string) $this->data['id'];
	}

	/**
	 * The id without its namespace, used as the order meta key suffix.
	 *
	 * @return string
	 */
	public function storage_key(): string {
		return substr( $this->id(), strlen( self::ID_PREFIX ) );
	}

	/**
	 * Human label.
	 *
	 * @return string
	 */
	public function label(): string {
		return (string) $this->data['label'];
	}

	/**
	 * Field type.
	 *
	 * @return string
	 */
	public function type(): string {
		return (string) $this->data['type'];
	}

	/**
	 * Which family the field belongs to.
	 *
	 * @return string
	 */
	public function family(): string {
		return self::family_for( $this->type() );
	}

	/**
	 * Whether WooCommerce's own Additional Checkout Fields API carries this field.
	 *
	 * @return bool
	 */
	public function is_core_backed(): bool {
		return self::FAMILY_CORE === $this->family();
	}

	/**
	 * Whether our own checkout block renders and stores this field.
	 *
	 * @return bool
	 */
	public function is_rich(): bool {
		return self::FAMILY_RICH === $this->family();
	}

	/**
	 * Whether the field is decoration rather than a question.
	 *
	 * @return bool
	 */
	public function is_content(): bool {
		return self::FAMILY_CONTENT === $this->family();
	}

	/**
	 * Whether this field can be collected on the checkout today.
	 *
	 * False for a field whose add-on is not running at all — then the field is
	 * in none of the three families above either, and every path leaves it
	 * alone — and for one whose add-on is running without being able to take
	 * new answers. That second field is still `rich`, so the answers already on
	 * orders go on being shown; it is the checkout, the Store API and
	 * WooCommerce's registry that have to ask this question on top of the
	 * family before handing the field to a shopper.
	 *
	 * @return bool
	 */
	public function is_available(): bool {
		return self::type_is_available( $this->type() );
	}

	/**
	 * Whether an add-on registered this field's type, whether or not the type
	 * reaches the checkout today.
	 *
	 * @return bool
	 */
	public function is_registered(): bool {
		return TypeRegistry::has( $this->type() );
	}

	/**
	 * The type WooCommerce is asked to register this field as.
	 *
	 * @return string
	 */
	public function core_type(): string {
		return self::core_type_for( $this->type() );
	}

	/**
	 * Checkout placement.
	 *
	 * @return string
	 */
	public function location(): string {
		return (string) $this->data['location'];
	}

	/**
	 * Whether the customer must fill the field in.
	 *
	 * @return bool
	 */
	public function is_required(): bool {
		return (bool) $this->data['required'];
	}

	/**
	 * Whether the field is registered with WooCommerce.
	 *
	 * @return bool
	 */
	public function is_enabled(): bool {
		return (bool) $this->data['enabled'];
	}

	/**
	 * Placeholder text. Dropdowns only; always the empty string otherwise.
	 *
	 * @return string
	 */
	public function placeholder(): string {
		return (string) $this->data['placeholder'];
	}

	/**
	 * Select, radio and checkbox-group options.
	 *
	 * @return array<int, array{value: string, label: string}>
	 */
	public function options(): array {
		/**
		 * Normalized by parse_options(), so the shape is guaranteed.
		 *
		 * @var array<int, array{value: string, label: string}> $options
		 */
		$options = $this->data['options'];
		return $options;
	}

	/**
	 * Allowed option values.
	 *
	 * @return string[]
	 */
	public function option_values(): array {
		return array_column( $this->options(), 'value' );
	}

	/**
	 * The label of one option, falling back to the raw value.
	 *
	 * @param string $value Option value.
	 * @return string
	 */
	public function option_label( string $value ): string {
		foreach ( $this->options() as $option ) {
			if ( $option['value'] === $value ) {
				return $option['label'];
			}
		}
		return $value;
	}

	/**
	 * How a radio or checkbox group stacks its choices.
	 *
	 * @return string
	 */
	public function options_layout(): string {
		return (string) $this->data['options_layout'];
	}

	/**
	 * The merchant's own error message: shown when a required field is left
	 * empty, or when a value does not match its format. Always the empty
	 * string on a dropdown.
	 *
	 * @return string
	 */
	public function error_message(): string {
		return (string) $this->data['error_message'];
	}

	/**
	 * Format preset key.
	 *
	 * @return string
	 */
	public function format(): string {
		return (string) $this->data['format'];
	}

	/**
	 * Custom pattern body (only meaningful when format is "custom").
	 *
	 * @return string
	 */
	public function custom_pattern(): string {
		return (string) $this->data['pattern'];
	}

	/**
	 * Effective validation pattern, resolving the preset table.
	 *
	 * @return string|null
	 */
	public function effective_pattern(): ?string {
		if ( ! self::is_text_backed( $this->type() ) ) {
			return null;
		}
		return FormatPresets::pattern_for( $this->format(), $this->custom_pattern() );
	}

	/**
	 * Message shown when the value does not match the pattern.
	 *
	 * The merchant's own message wins when they wrote one — it is the only way to
	 * explain a custom pattern — and the preset's wording is the fallback.
	 *
	 * @return string
	 */
	public function format_message(): string {
		if ( '' !== $this->error_message() ) {
			return $this->error_message();
		}

		$preset = FormatPresets::all()[ $this->format() ] ?? null;
		if ( null === $preset || '' === $preset['message'] ) {
			return __( 'Please match the requested format.', 'fieldwright-checkout-fields' );
		}
		return $preset['message'];
	}

	/**
	 * Maximum accepted length, or null for no limit.
	 *
	 * @return int|null
	 */
	public function max_length(): ?int {
		return null === $this->data['max_length'] ? null : (int) $this->data['max_length'];
	}

	/**
	 * The longest value this field accepts, configured or not.
	 *
	 * @return int
	 */
	public function length_cap(): int {
		$ceiling = self::TYPE_TEXTAREA === $this->type() ? self::MAX_TEXTAREA_LENGTH : self::MAX_FIELD_LENGTH;
		return $this->max_length() ?? $ceiling;
	}

	/**
	 * Autocomplete token, or the empty string.
	 *
	 * @return string
	 */
	public function autocomplete(): string {
		return (string) $this->data['autocomplete'];
	}

	/**
	 * Whether the value appears on the order confirmation. Kept in step with
	 * `visibility.thank_you`, which is the key the builder edits.
	 *
	 * @return bool
	 */
	public function show_in_order_confirmation(): bool {
		return (bool) $this->data['show_in_order_confirmation'];
	}

	/**
	 * Hint shown under the input.
	 *
	 * @return string
	 */
	public function help(): string {
		return (string) $this->data['help'];
	}

	/**
	 * Value the field starts out with.
	 *
	 * @return string
	 */
	public function default_value(): string {
		return (string) $this->data['default_value'];
	}

	/**
	 * Layout width. Always "full" on a core-backed field.
	 *
	 * @return string
	 */
	public function width(): string {
		return (string) $this->data['width'];
	}

	/**
	 * Where a stored value is shown.
	 *
	 * @return array<string, bool>
	 */
	public function visibility(): array {
		/**
		 * Normalized by parse_visibility(), so every key is present.
		 *
		 * @var array<string, bool> $visibility
		 */
		$visibility = $this->data['visibility'];
		return $visibility;
	}

	/**
	 * Whether the value is shown in one place.
	 *
	 * @param string $where One of thank_you, emails, admin, account.
	 * @return bool
	 */
	public function is_visible_in( string $where ): bool {
		$visibility = $this->visibility();
		return isset( $visibility[ $where ] ) ? (bool) $visibility[ $where ] : false;
	}

	/**
	 * Whether the value is also written to (and prefilled from) the customer.
	 *
	 * @return bool
	 */
	public function saves_to_profile(): bool {
		return (bool) $this->data['save_to_profile'];
	}

	/**
	 * Visible rows on a textarea.
	 *
	 * @return int
	 */
	public function rows(): int {
		return (int) $this->data['rows'];
	}

	/**
	 * Smallest accepted number, or null.
	 *
	 * @return float|null
	 */
	public function min(): ?float {
		return null === $this->data['min'] ? null : (float) $this->data['min'];
	}

	/**
	 * Largest accepted number, or null.
	 *
	 * @return float|null
	 */
	public function max(): ?float {
		return null === $this->data['max'] ? null : (float) $this->data['max'];
	}

	/**
	 * Step between accepted numbers, or null. On a time field this is a whole
	 * number of minutes instead — see time_step().
	 *
	 * @return float|null
	 */
	public function step(): ?float {
		return null === $this->data['step'] ? null : (float) $this->data['step'];
	}

	/**
	 * Minutes between selectable times.
	 *
	 * @return int
	 */
	public function time_step(): int {
		return null === $this->data['step'] ? self::DEFAULT_TIME_STEP : (int) $this->data['step'];
	}

	/**
	 * Earliest accepted date (Y-m-d), or the empty string.
	 *
	 * @return string
	 */
	public function date_min(): string {
		return (string) $this->data['date_min'];
	}

	/**
	 * Latest accepted date (Y-m-d), or the empty string.
	 *
	 * @return string
	 */
	public function date_max(): string {
		return (string) $this->data['date_max'];
	}

	/**
	 * Earliest accepted time (H:i), or the empty string.
	 *
	 * @return string
	 */
	public function time_min(): string {
		return (string) $this->data['time_min'];
	}

	/**
	 * Latest accepted time (H:i), or the empty string.
	 *
	 * @return string
	 */
	public function time_max(): string {
		return (string) $this->data['time_max'];
	}

	/**
	 * Paragraph body, already run through wp_kses.
	 *
	 * @return string
	 */
	public function content(): string {
		return (string) $this->data['content'];
	}

	/**
	 * Heading level, 2 to 4.
	 *
	 * @return int
	 */
	public function content_level(): int {
		return (int) $this->data['content_level'];
	}

	/**
	 * Add-on payload, or null when the field carries none.
	 *
	 * @return array<string, mixed>|null
	 */
	public function pro(): ?array {
		$pro = isset( $this->data['pro'] ) ? $this->data['pro'] : null;
		return is_array( $pro ) ? $pro : null;
	}

	/**
	 * Normalized array form, matching the JSON contract key for key.
	 *
	 * The `pro` key is omitted entirely when empty, so a store running Free on
	 * its own never grows a key it has no use for.
	 *
	 * @return array<string, mixed>
	 */
	public function to_array(): array {
		$data = $this->data;
		if ( ! isset( $data['pro'] ) ) {
			unset( $data['pro'] );
		}
		return $data;
	}

	/**
	 * Read the type.
	 *
	 * Any well-formed type key is accepted, not only the ones something answers
	 * for today. A merchant whose add-on has stopped running still has to be
	 * able to save the configuration it left behind — rename a field, move the
	 * others, switch WooCommerce's own fields around — and refusing the type
	 * would mean the only way out was deleting the field and its answers with
	 * it. What the type is not is inferred: it stays exactly as it was stored.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_type( array $raw, string $path, ValidationErrors $errors ): string {
		$type = isset( $raw['type'] ) && is_string( $raw['type'] ) ? $raw['type'] : '';

		if ( strlen( $type ) > TypeRegistry::MAX_KEY_LENGTH || 1 !== preg_match( TypeRegistry::KEY_PATTERN, $type ) ) {
			$errors->add(
				self::path( $path, 'type' ),
				'invalid_type',
				sprintf(
					/* translators: %d: maximum number of characters. */
					__( 'A field type is up to %d characters of lowercase letters, numbers and underscores, starting with a letter.', 'fieldwright-checkout-fields' ),
					TypeRegistry::MAX_KEY_LENGTH
				)
			);
			return self::TYPE_TEXT;
		}

		return $type;
	}

	/**
	 * Read the placement, and check the type is allowed to use it.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $type   Resolved field type.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_location( array $raw, string $type, string $path, ValidationErrors $errors ): string {
		$location = isset( $raw['location'] ) && is_string( $raw['location'] ) ? $raw['location'] : '';

		if ( ! in_array( $location, self::locations(), true ) ) {
			$errors->add(
				self::path( $path, 'location' ),
				'invalid_location',
				sprintf(
					/* translators: %s: comma-separated list of supported locations. */
					__( 'Choose one of the supported locations: %s.', 'fieldwright-checkout-fields' ),
					implode( ', ', self::locations() )
				)
			);
			return self::LOCATION_ORDER;
		}

		$allowed = self::locations_for( $type );
		if ( ! in_array( $location, $allowed, true ) ) {
			$errors->add(
				self::path( $path, 'location' ),
				'invalid_placement',
				sprintf(
					/* translators: 1: field type, 2: comma-separated list of allowed locations. */
					__( 'A %1$s field can only go in: %2$s.', 'fieldwright-checkout-fields' ),
					$type,
					implode( ', ', $allowed )
				)
			);
			return self::LOCATION_ORDER;
		}

		return $location;
	}

	/**
	 * Read the id. Ids are never rewritten: an unusable id is an error, because
	 * silently changing it would orphan already-stored order meta.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_id( array $raw, string $path, ValidationErrors $errors ): string {
		$id = isset( $raw['id'] ) && is_string( $raw['id'] ) ? trim( $raw['id'] ) : '';

		if ( strlen( $id ) > self::MAX_ID_LENGTH ) {
			$errors->add(
				self::path( $path, 'id' ),
				'too_long',
				sprintf(
					/* translators: %d: maximum number of characters. */
					__( 'Field keys cannot be longer than %d characters.', 'fieldwright-checkout-fields' ),
					self::MAX_ID_LENGTH
				)
			);
			return '';
		}

		if ( 1 !== preg_match( self::ID_PATTERN, $id ) ) {
			$errors->add(
				self::path( $path, 'id' ),
				'invalid_id',
				__( 'Field keys must look like cbwb/my-field: lowercase letters, numbers, and single hyphens.', 'fieldwright-checkout-fields' )
			);
			return '';
		}

		return $id;
	}

	/**
	 * Read the label.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_label( array $raw, string $path, ValidationErrors $errors ): string {
		if ( isset( $raw['label'] ) && ! is_string( $raw['label'] ) ) {
			$errors->add( self::path( $path, 'label' ), 'invalid_value', __( 'The label must be text.', 'fieldwright-checkout-fields' ) );
			return '';
		}

		$label = sanitize_text_field( isset( $raw['label'] ) ? $raw['label'] : '' );

		if ( '' === $label ) {
			$errors->add( self::path( $path, 'label' ), 'required', __( 'Every field needs a label.', 'fieldwright-checkout-fields' ) );
			return '';
		}

		if ( mb_strlen( $label ) > self::MAX_LABEL_LENGTH ) {
			$errors->add(
				self::path( $path, 'label' ),
				'too_long',
				sprintf(
					/* translators: %d: maximum number of characters. */
					__( 'Labels cannot be longer than %d characters.', 'fieldwright-checkout-fields' ),
					self::MAX_LABEL_LENGTH
				)
			);
			return '';
		}

		return $label;
	}

	/**
	 * Read a strict boolean. REST bodies are JSON, so "1" and "true" are typos, not booleans.
	 *
	 * @param array<string, mixed> $raw      Raw field data.
	 * @param string               $key      Key to read.
	 * @param bool                 $fallback Value used when the key is absent.
	 * @param string               $path     Path prefix.
	 * @param ValidationErrors     $errors   Collector.
	 * @return bool
	 */
	private static function parse_bool( array $raw, string $key, bool $fallback, string $path, ValidationErrors $errors ): bool {
		if ( ! array_key_exists( $key, $raw ) || null === $raw[ $key ] ) {
			return $fallback;
		}
		if ( ! is_bool( $raw[ $key ] ) ) {
			$errors->add(
				self::path( $path, $key ),
				'invalid_value',
				sprintf(
					/* translators: %s: setting name. */
					__( '"%s" must be true or false.', 'fieldwright-checkout-fields' ),
					$key
				)
			);
			return $fallback;
		}
		return $raw[ $key ];
	}

	/**
	 * Read the four visibility switches, seeding "thank you page" from the
	 * `show_in_order_confirmation` key an older stored configuration carries.
	 *
	 * @param array<string, mixed> $raw          Raw field data.
	 * @param bool                 $confirmation Value of show_in_order_confirmation.
	 * @param string               $path         Path prefix.
	 * @param ValidationErrors     $errors       Collector.
	 * @return array<string, bool>
	 */
	private static function parse_visibility( array $raw, bool $confirmation, string $path, ValidationErrors $errors ): array {
		$visibility              = self::default_visibility();
		$visibility['thank_you'] = $confirmation;

		if ( ! array_key_exists( 'visibility', $raw ) || null === $raw['visibility'] ) {
			return $visibility;
		}

		$value           = $raw['visibility'];
		$visibility_path = self::path( $path, 'visibility' );

		if ( ! is_array( $value ) || ( array() !== $value && wp_is_numeric_array( $value ) ) ) {
			$errors->add( $visibility_path, 'invalid_value', __( 'Visibility must be an object of true/false switches.', 'fieldwright-checkout-fields' ) );
			return $visibility;
		}

		foreach ( self::visibility_keys() as $key ) {
			if ( ! array_key_exists( $key, $value ) || null === $value[ $key ] ) {
				continue;
			}
			if ( ! is_bool( $value[ $key ] ) ) {
				$errors->add(
					$visibility_path . '.' . $key,
					'invalid_value',
					sprintf(
						/* translators: %s: setting name. */
						__( '"%s" must be true or false.', 'fieldwright-checkout-fields' ),
						$key
					)
				);
				continue;
			}
			$visibility[ $key ] = $value[ $key ];
		}

		return $visibility;
	}

	/**
	 * Read an optional short string.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $key    Key to read.
	 * @param int                  $max    Maximum length.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_string( array $raw, string $key, int $max, string $path, ValidationErrors $errors ): string {
		if ( ! array_key_exists( $key, $raw ) || null === $raw[ $key ] ) {
			return '';
		}
		if ( ! is_string( $raw[ $key ] ) ) {
			$errors->add(
				self::path( $path, $key ),
				'invalid_value',
				sprintf(
					/* translators: %s: setting name. */
					__( '"%s" must be text.', 'fieldwright-checkout-fields' ),
					$key
				)
			);
			return '';
		}

		$value = sanitize_text_field( $raw[ $key ] );

		if ( mb_strlen( $value ) > $max ) {
			$errors->add(
				self::path( $path, $key ),
				'too_long',
				sprintf(
					/* translators: 1: setting name, 2: maximum number of characters. */
					__( '"%1$s" cannot be longer than %2$d characters.', 'fieldwright-checkout-fields' ),
					$key,
					$max
				)
			);
			return '';
		}

		return $value;
	}

	/**
	 * Read a value that has to come from a fixed list.
	 *
	 * @param array<string, mixed> $raw      Raw field data.
	 * @param string               $key      Key to read.
	 * @param string[]             $allowed  Allowed values.
	 * @param string               $fallback Value used when the key is absent.
	 * @param string               $code     Error code to record.
	 * @param string               $path     Path prefix.
	 * @param ValidationErrors     $errors   Collector.
	 * @return string
	 */
	private static function parse_enum( array $raw, string $key, array $allowed, string $fallback, string $code, string $path, ValidationErrors $errors ): string {
		if ( ! array_key_exists( $key, $raw ) || null === $raw[ $key ] ) {
			return $fallback;
		}
		$value = is_string( $raw[ $key ] ) ? $raw[ $key ] : '';
		if ( ! in_array( $value, $allowed, true ) ) {
			$errors->add(
				self::path( $path, $key ),
				$code,
				sprintf(
					/* translators: 1: setting name, 2: comma-separated list of allowed values. */
					__( '"%1$s" must be one of: %2$s.', 'fieldwright-checkout-fields' ),
					$key,
					implode( ', ', $allowed )
				)
			);
			return $fallback;
		}
		return $value;
	}

	/**
	 * Read and validate the option list.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return array<int, array{value: string, label: string}>
	 */
	private static function parse_options( array $raw, string $path, ValidationErrors $errors ): array {
		$options_path = self::path( $path, 'options' );
		$raw_options  = isset( $raw['options'] ) ? $raw['options'] : array();

		if ( ! is_array( $raw_options ) || ( array() !== $raw_options && ! wp_is_numeric_array( $raw_options ) ) ) {
			$errors->add( $options_path, 'invalid_value', __( 'Options must be a list.', 'fieldwright-checkout-fields' ) );
			return array();
		}

		if ( array() === $raw_options ) {
			$errors->add( $options_path, 'options_required', __( 'This field needs at least one option.', 'fieldwright-checkout-fields' ) );
			return array();
		}

		// Every option is inlined into the checkout page for every shopper, and
		// checked by a linear search on every submission, so the list is capped
		// rather than left to the request-size limit. An import is the only
		// realistic way to reach this.
		if ( count( $raw_options ) > self::MAX_OPTIONS ) {
			$errors->add(
				$options_path,
				'too_many',
				sprintf(
					/* translators: %d: maximum number of options. */
					__( 'A field cannot have more than %d options.', 'fieldwright-checkout-fields' ),
					self::MAX_OPTIONS
				)
			);
			return array();
		}

		$clean = array();
		$seen  = array();

		foreach ( array_values( $raw_options ) as $index => $option ) {
			$option_path = $options_path . '[' . $index . ']';

			if ( ! is_array( $option ) || ! isset( $option['value'] ) || ! isset( $option['label'] ) ) {
				$errors->add( $option_path, 'invalid_option', __( 'Each option needs a value and a label.', 'fieldwright-checkout-fields' ) );
				continue;
			}

			if ( ! is_string( $option['value'] ) || ! is_string( $option['label'] ) ) {
				$errors->add( $option_path, 'invalid_option', __( 'Option values and labels must be text.', 'fieldwright-checkout-fields' ) );
				continue;
			}

			$value = trim( $option['value'] );
			$label = sanitize_text_field( $option['label'] );

			if ( mb_strlen( $value ) > self::MAX_OPTION_VALUE_LENGTH ) {
				$errors->add(
					$option_path . '.value',
					'too_long',
					sprintf(
						/* translators: %d: maximum number of characters. */
						__( 'Option values cannot be longer than %d characters.', 'fieldwright-checkout-fields' ),
						self::MAX_OPTION_VALUE_LENGTH
					)
				);
				continue;
			}

			if ( 1 !== preg_match( self::OPTION_VALUE_PATTERN, $value ) ) {
				$errors->add(
					$option_path . '.value',
					'invalid_option',
					__( 'Option values may only contain letters, numbers, and the characters _ . : and -.', 'fieldwright-checkout-fields' )
				);
				continue;
			}

			if ( '' === $label ) {
				$errors->add( $option_path . '.label', 'required', __( 'Every option needs a label.', 'fieldwright-checkout-fields' ) );
				continue;
			}

			if ( mb_strlen( $label ) > self::MAX_OPTION_LABEL_LENGTH ) {
				$errors->add(
					$option_path . '.label',
					'too_long',
					sprintf(
						/* translators: %d: maximum number of characters. */
						__( 'Option labels cannot be longer than %d characters.', 'fieldwright-checkout-fields' ),
						self::MAX_OPTION_LABEL_LENGTH
					)
				);
				continue;
			}

			if ( in_array( $value, $seen, true ) ) {
				$errors->add(
					$option_path . '.value',
					'duplicate_option',
					sprintf(
						/* translators: %s: duplicated option value. */
						__( 'The option value "%s" is used more than once.', 'fieldwright-checkout-fields' ),
						$value
					)
				);
				continue;
			}

			$seen[]  = $value;
			$clean[] = array(
				'value' => $value,
				'label' => $label,
			);
		}//end foreach

		return $clean;
	}

	/**
	 * Read the format preset.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_format( array $raw, string $path, ValidationErrors $errors ): string {
		if ( ! array_key_exists( 'format', $raw ) || null === $raw['format'] ) {
			return FormatPresets::ANY;
		}
		$format = is_string( $raw['format'] ) ? $raw['format'] : '';
		if ( ! FormatPresets::exists( $format ) ) {
			$errors->add(
				self::path( $path, 'format' ),
				'invalid_format',
				sprintf(
					/* translators: %s: comma-separated list of format keys. */
					__( 'Choose one of the supported formats: %s.', 'fieldwright-checkout-fields' ),
					implode( ', ', FormatPresets::keys() )
				)
			);
			return FormatPresets::ANY;
		}
		return $format;
	}

	/**
	 * Read the custom pattern. A pattern only applies to the "custom" format;
	 * for every other preset it is dropped rather than treated as an error, so
	 * switching a field's format never blocks a save.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $format Resolved format key.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_pattern( array $raw, string $format, string $path, ValidationErrors $errors ): string {
		$pattern_path = self::path( $path, 'pattern' );

		if ( isset( $raw['pattern'] ) && ! is_string( $raw['pattern'] ) ) {
			$errors->add( $pattern_path, 'invalid_value', __( 'The pattern must be text.', 'fieldwright-checkout-fields' ) );
			return '';
		}

		$pattern = isset( $raw['pattern'] ) && is_string( $raw['pattern'] ) ? trim( $raw['pattern'] ) : '';

		if ( FormatPresets::CUSTOM !== $format ) {
			return '';
		}

		if ( '' === $pattern ) {
			$errors->add( $pattern_path, 'invalid_pattern', __( 'Enter a pattern, or choose a different format.', 'fieldwright-checkout-fields' ) );
			return '';
		}

		if ( ! FormatPresets::compiles_as_pcre( $pattern ) ) {
			$errors->add( $pattern_path, 'invalid_pattern', __( 'That pattern is not a valid regular expression.', 'fieldwright-checkout-fields' ) );
			return '';
		}

		// The browser checks the same pattern with its own engine, and one it
		// cannot compile stops the checkout rendering at all, so a pattern only
		// PHP understands is refused here rather than at checkout.
		if ( ! FormatPresets::is_ecmascript_pattern( $pattern ) ) {
			$errors->add( $pattern_path, 'invalid_pattern', __( 'That pattern must also be a valid JavaScript regular expression, because the checkout runs it in the browser. Remove any syntax JavaScript does not have, such as escapes like \A or \Z, inline flags like (?i), atomic groups, possessive quantifiers or POSIX classes.', 'fieldwright-checkout-fields' ) );
			return '';
		}

		return $pattern;
	}

	/**
	 * Read the maximum length.
	 *
	 * @param array<string, mixed> $raw     Raw field data.
	 * @param int                  $ceiling Largest value the type accepts.
	 * @param string               $path    Path prefix.
	 * @param ValidationErrors     $errors  Collector.
	 * @return int|null
	 */
	private static function parse_max_length( array $raw, int $ceiling, string $path, ValidationErrors $errors ): ?int {
		if ( ! array_key_exists( 'max_length', $raw ) || null === $raw['max_length'] ) {
			return null;
		}

		$value = $raw['max_length'];
		if ( ! is_int( $value ) || $value < 1 || $value > $ceiling ) {
			$errors->add(
				self::path( $path, 'max_length' ),
				'invalid_max_length',
				sprintf(
					/* translators: %d: maximum allowed value. */
					__( 'Maximum length must be a whole number between 1 and %d.', 'fieldwright-checkout-fields' ),
					$ceiling
				)
			);
			return null;
		}

		return $value;
	}

	/**
	 * Read the number of visible textarea rows.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return int
	 */
	private static function parse_rows( array $raw, string $path, ValidationErrors $errors ): int {
		if ( ! array_key_exists( 'rows', $raw ) || null === $raw['rows'] ) {
			return self::DEFAULT_ROWS;
		}

		$value = $raw['rows'];
		if ( ! is_int( $value ) || $value < self::MIN_ROWS || $value > self::MAX_ROWS ) {
			$errors->add(
				self::path( $path, 'rows' ),
				'invalid_range',
				sprintf(
					/* translators: 1: smallest number of rows, 2: largest number of rows. */
					__( 'Rows must be a whole number between %1$d and %2$d.', 'fieldwright-checkout-fields' ),
					self::MIN_ROWS,
					self::MAX_ROWS
				)
			);
			return self::DEFAULT_ROWS;
		}

		return $value;
	}

	/**
	 * Read a bound on a number field.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $key    Key to read.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return float|int|null
	 */
	private static function parse_number( array $raw, string $key, string $path, ValidationErrors $errors ) {
		if ( ! array_key_exists( $key, $raw ) || null === $raw[ $key ] || '' === $raw[ $key ] ) {
			return null;
		}

		$value = $raw[ $key ];
		if ( ( ! is_int( $value ) && ! is_float( $value ) ) || ! is_finite( (float) $value ) ) {
			$errors->add(
				self::path( $path, $key ),
				'invalid_value',
				sprintf(
					/* translators: %s: setting name. */
					__( '"%s" must be a number.', 'fieldwright-checkout-fields' ),
					$key
				)
			);
			return null;
		}

		return $value;
	}

	/**
	 * Read the step between accepted numbers.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return float|int|null
	 */
	private static function parse_step( array $raw, string $path, ValidationErrors $errors ) {
		$step = self::parse_number( $raw, 'step', $path, $errors );

		if ( null !== $step && (float) $step <= 0.0 ) {
			$errors->add( self::path( $path, 'step' ), 'invalid_range', __( 'The step must be greater than zero.', 'fieldwright-checkout-fields' ) );
			return null;
		}

		return $step;
	}

	/**
	 * Read the step between selectable times, in minutes.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return int
	 */
	private static function parse_time_step( array $raw, string $path, ValidationErrors $errors ): int {
		if ( ! array_key_exists( 'step', $raw ) || null === $raw['step'] ) {
			return self::DEFAULT_TIME_STEP;
		}

		$value = $raw['step'];
		if ( ! is_int( $value ) || $value < 1 || $value > self::MAX_TIME_STEP ) {
			$errors->add(
				self::path( $path, 'step' ),
				'invalid_range',
				sprintf(
					/* translators: %d: largest step in minutes. */
					__( 'The step must be a whole number of minutes between 1 and %d.', 'fieldwright-checkout-fields' ),
					self::MAX_TIME_STEP
				)
			);
			return self::DEFAULT_TIME_STEP;
		}

		return $value;
	}

	/**
	 * Read a Y-m-d bound on a date field.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $key    Key to read.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_date( array $raw, string $key, string $path, ValidationErrors $errors ): string {
		if ( ! array_key_exists( $key, $raw ) || null === $raw[ $key ] || '' === $raw[ $key ] ) {
			return '';
		}

		$value = is_string( $raw[ $key ] ) ? trim( $raw[ $key ] ) : '';
		if ( ! self::is_date( $value ) ) {
			$errors->add(
				self::path( $path, $key ),
				'invalid_value',
				sprintf(
					/* translators: %s: setting name. */
					__( '"%s" must be a date in YYYY-MM-DD form.', 'fieldwright-checkout-fields' ),
					$key
				)
			);
			return '';
		}

		return $value;
	}

	/**
	 * Read an H:i bound on a time field.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $key    Key to read.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_time( array $raw, string $key, string $path, ValidationErrors $errors ): string {
		if ( ! array_key_exists( $key, $raw ) || null === $raw[ $key ] || '' === $raw[ $key ] ) {
			return '';
		}

		$value = is_string( $raw[ $key ] ) ? trim( $raw[ $key ] ) : '';
		if ( ! self::is_time( $value ) ) {
			$errors->add(
				self::path( $path, $key ),
				'invalid_value',
				sprintf(
					/* translators: %s: setting name. */
					__( '"%s" must be a time in HH:MM form.', 'fieldwright-checkout-fields' ),
					$key
				)
			);
			return '';
		}

		return $value;
	}

	/**
	 * Whether a string is a real calendar date in Y-m-d form.
	 *
	 * @param string $value Candidate.
	 * @return bool
	 */
	public static function is_date( string $value ): bool {
		if ( 1 !== preg_match( '/^\d{4}-\d{2}-\d{2}$/', $value ) ) {
			return false;
		}
		$date = DateTimeImmutable::createFromFormat( '!Y-m-d', $value );
		return false !== $date && $date->format( 'Y-m-d' ) === $value;
	}

	/**
	 * Whether a string is a 24-hour time in H:i form.
	 *
	 * @param string $value Candidate.
	 * @return bool
	 */
	public static function is_time( string $value ): bool {
		return 1 === preg_match( '/^([01][0-9]|2[0-3]):[0-5][0-9]$/', $value );
	}

	/**
	 * Read the heading level.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return int
	 */
	private static function parse_content_level( array $raw, string $path, ValidationErrors $errors ): int {
		if ( ! array_key_exists( 'content_level', $raw ) || null === $raw['content_level'] ) {
			return self::DEFAULT_CONTENT_LEVEL;
		}

		$value = $raw['content_level'];
		if ( ! is_int( $value ) || ! in_array( $value, self::content_levels(), true ) ) {
			$errors->add(
				self::path( $path, 'content_level' ),
				'invalid_value',
				sprintf(
					/* translators: %s: comma-separated list of heading levels. */
					__( 'The heading level must be one of: %s.', 'fieldwright-checkout-fields' ),
					implode( ', ', array_map( 'strval', self::content_levels() ) )
				)
			);
			return self::DEFAULT_CONTENT_LEVEL;
		}

		return $value;
	}

	/**
	 * Read a paragraph's body. Only the handful of inline tags a merchant needs
	 * survive; everything else is stripped rather than escaped, so the stored
	 * value is already safe to print.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_content( array $raw, string $path, ValidationErrors $errors ): string {
		if ( ! array_key_exists( 'content', $raw ) || null === $raw['content'] ) {
			return '';
		}

		$content_path = self::path( $path, 'content' );

		if ( ! is_string( $raw['content'] ) ) {
			$errors->add( $content_path, 'invalid_value', __( '"content" must be text.', 'fieldwright-checkout-fields' ) );
			return '';
		}

		if ( mb_strlen( $raw['content'] ) > self::MAX_CONTENT_LENGTH ) {
			$errors->add(
				$content_path,
				'too_long',
				sprintf(
					/* translators: %d: maximum number of characters. */
					__( 'Paragraph text cannot be longer than %d characters.', 'fieldwright-checkout-fields' ),
					self::MAX_CONTENT_LENGTH
				)
			);
			return '';
		}

		return self::sanitize_content( $raw['content'] );
	}

	/**
	 * Reduce paragraph markup to the tags a paragraph may use.
	 *
	 * Run on the merchant's own text when it is saved, and again on any
	 * translation of it before the checkout is handed the result: a translation
	 * is typed by whoever holds the translator role, which is not the role that
	 * may manage the store, and it reaches the same `innerHTML` the original
	 * does.
	 *
	 * @param string $content Paragraph markup as typed.
	 * @return string
	 */
	public static function sanitize_content( string $content ): string {
		return self::safe_link_targets( trim( wp_kses( $content, self::content_tags() ) ) );
	}

	/**
	 * Make every link that opens a new tab give up its handle on this one.
	 *
	 * Current browsers imply `noopener` for `target="_blank"` by themselves, so
	 * this is for the older ones, where the opened page could otherwise reach
	 * back through `window.opener` and navigate the checkout somewhere else. The
	 * merchant writes the link, so this is not a defence against them; it is one
	 * against whatever they linked to.
	 *
	 * @param string $content Sanitized paragraph markup.
	 * @return string
	 */
	private static function safe_link_targets( string $content ): string {
		if ( false === strpos( $content, 'target=' ) ) {
			return $content;
		}

		$result = preg_replace_callback(
			'/<a\s[^>]*>/i',
			static function ( array $found ): string {
				$tag = $found[0];

				if ( false === stripos( $tag, 'target=' ) ) {
					return $tag;
				}

				$tag = (string) preg_replace( '/\s+rel="[^"]*"/i', '', $tag );

				return (string) preg_replace( '/\s*>$/', ' rel="noopener noreferrer">', $tag );
			},
			$content
		);

		return null === $result ? $content : $result;
	}

	/**
	 * The tags a paragraph may use.
	 *
	 * @return array<string, array<string, array<string, bool>>>
	 */
	public static function content_tags(): array {
		return array(
			'a'      => array(
				'href'   => array(),
				'title'  => array(),
				'rel'    => array(),
				'target' => array(),
			),
			'strong' => array(),
			'em'     => array(),
			'br'     => array(),
		);
	}

	/**
	 * Read the value the field starts out with, checking it against whatever
	 * the type accepts.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param array<string, mixed> $data   Field data parsed so far.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_default_value( array $raw, array $data, string $path, ValidationErrors $errors ): string {
		$value = self::parse_string( $raw, 'default_value', self::MAX_DEFAULT_VALUE_LENGTH, $path, $errors );

		if ( '' === $value ) {
			return '';
		}

		$default_path = self::path( $path, 'default_value' );
		$type         = (string) $data['type'];

		/**
		 * Already normalized by parse_options().
		 *
		 * @var array<int, array{value: string, label: string}> $options
		 */
		$options = $data['options'];
		$allowed = array_column( $options, 'value' );

		if ( self::TYPE_CHECKBOX === $type ) {
			if ( 'yes' !== $value ) {
				$errors->add( $default_path, 'invalid_value', __( 'A checkbox starts out either ticked ("yes") or empty.', 'fieldwright-checkout-fields' ) );
				return '';
			}
			return $value;
		}

		if ( self::TYPE_SELECT === $type || self::TYPE_RADIO === $type ) {
			if ( ! in_array( $value, $allowed, true ) ) {
				$errors->add( $default_path, 'invalid_option', __( 'The starting value must be one of the options.', 'fieldwright-checkout-fields' ) );
				return '';
			}
			return $value;
		}

		if ( self::TYPE_CHECKBOX_GROUP === $type ) {
			$chosen = array_filter( array_map( 'trim', explode( ',', $value ) ) );
			foreach ( $chosen as $one ) {
				if ( ! in_array( $one, $allowed, true ) ) {
					$errors->add( $default_path, 'invalid_option', __( 'Every starting value must be one of the options.', 'fieldwright-checkout-fields' ) );
					return '';
				}
			}
			return implode( ',', array_values( array_unique( $chosen ) ) );
		}

		if ( self::TYPE_DATE === $type && ! self::is_date( $value ) ) {
			$errors->add( $default_path, 'invalid_value', __( 'The starting date must be in YYYY-MM-DD form.', 'fieldwright-checkout-fields' ) );
			return '';
		}

		if ( self::TYPE_TIME === $type && ! self::is_time( $value ) ) {
			$errors->add( $default_path, 'invalid_value', __( 'The starting time must be in HH:MM form.', 'fieldwright-checkout-fields' ) );
			return '';
		}

		return $value;
	}

	/**
	 * Read the autocomplete token.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return string
	 */
	private static function parse_autocomplete( array $raw, string $path, ValidationErrors $errors ): string {
		if ( ! array_key_exists( 'autocomplete', $raw ) || null === $raw['autocomplete'] ) {
			return '';
		}
		$token = is_string( $raw['autocomplete'] ) ? trim( $raw['autocomplete'] ) : '';
		if ( ! AutocompleteTokens::is_allowed( $token ) ) {
			$errors->add(
				self::path( $path, 'autocomplete' ),
				'invalid_autocomplete',
				__( 'That is not a recognised autocomplete value.', 'fieldwright-checkout-fields' )
			);
			return '';
		}
		return $token;
	}

	/**
	 * Check the opaque add-on payload without interpreting it.
	 *
	 * Free has no idea what an add-on stores here, so the payload is
	 * preserved verbatim as long as it is an array that round-trips through
	 * JSON and stays small. Anything else is an error rather than a silent
	 * drop, because losing an add-on's settings on save is worse than a
	 * rejected save.
	 *
	 * @param array<string, mixed> $raw    Raw field data.
	 * @param string               $path   Path prefix.
	 * @param ValidationErrors     $errors Collector.
	 * @return array<string, mixed>|null
	 */
	private static function parse_pro( array $raw, string $path, ValidationErrors $errors ): ?array {
		if ( ! array_key_exists( 'pro', $raw ) || null === $raw['pro'] ) {
			return null;
		}

		$pro_path = self::path( $path, 'pro' );
		$value    = $raw['pro'];

		if ( ! is_array( $value ) ) {
			$errors->add( $pro_path, 'invalid_value', __( 'Add-on settings must be an object.', 'fieldwright-checkout-fields' ) );
			return null;
		}

		$encoded = wp_json_encode( $value );

		if ( false === $encoded ) {
			$errors->add( $pro_path, 'invalid_value', __( 'Add-on settings could not be stored.', 'fieldwright-checkout-fields' ) );
			return null;
		}

		if ( strlen( $encoded ) > self::MAX_PRO_BYTES ) {
			$errors->add(
				$pro_path,
				'invalid_value',
				sprintf(
					/* translators: %d: maximum number of bytes. */
					__( 'Add-on settings cannot be larger than %d bytes.', 'fieldwright-checkout-fields' ),
					self::MAX_PRO_BYTES
				)
			);
			return null;
		}

		return $value;
	}

	/**
	 * Join a path prefix and a key.
	 *
	 * @param string $prefix Prefix, possibly empty.
	 * @param string $key    Key name.
	 * @return string
	 */
	private static function path( string $prefix, string $key ): string {
		return '' === $prefix ? $key : $prefix . '.' . $key;
	}
}
