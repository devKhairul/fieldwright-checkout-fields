<?php
/**
 * The Store API surface for the field types WooCommerce has no equivalent of.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Checkout;

use Automattic\WooCommerce\StoreApi\Exceptions\RouteException;
use Automattic\WooCommerce\StoreApi\Schemas\ExtendSchema;
use Automattic\WooCommerce\StoreApi\Schemas\V1\CheckoutSchema;
use Automattic\WooCommerce\StoreApi\StoreApi;
use Automattic\WooCommerce\StoreApi\Utilities\LocalPickupUtils;
use CheckoutBuilder\Config;
use CheckoutBuilder\Fields\FieldDefinition;
use CheckoutBuilder\Fields\RichValues;
use WC_Cart;
use WC_Order;
use WP_Error;
use WP_REST_Request;

defined( 'ABSPATH' ) || exit;

/**
 * Declares `extensions.cbwb` on POST /wc/store/v1/checkout, then validates and
 * persists what arrives in it.
 *
 * WooCommerce runs the declared schema through `rest_validate_value_from_schema`
 * before any of our code sees the request, and a failure there becomes a generic
 * "extensions[cbwb][…] is not of type string" notice with no field attached. The
 * declared schema is therefore deliberately loose — a type and an absolute
 * length ceiling, no enums and no per-field maximum — and the real checking
 * happens in validate(), which can name the field and say what was wrong with it.
 *
 * Extensions are only sent on the final POST, never on the draft PUT, so this is
 * the one and only chance to read these values.
 */
final class Extensions {

	/**
	 * Namespace the checkout posts our values under.
	 */
	public const NAMESPACE = 'cbwb';

	/**
	 * Error code every rejected value is reported with.
	 */
	public const ERROR_CODE = 'cbwb_invalid_field';

	/**
	 * The address keys a shopper can fill in, and so the ones a billing address
	 * posted as "same as shipping" is a copy of.
	 */
	public const ADDRESS_KEYS = array(
		'first_name',
		'last_name',
		'company',
		'address_1',
		'address_2',
		'city',
		'state',
		'postcode',
		'country',
		'phone',
	);

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
		add_action( 'woocommerce_blocks_loaded', array( $this, 'register_endpoint_data' ) );
		add_action( 'woocommerce_store_api_checkout_update_order_from_request', array( $this, 'update_order' ), 10, 2 );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( $this, 'save_to_profile' ) );
	}

	/**
	 * Declare our namespace on the checkout endpoint.
	 */
	public function register_endpoint_data(): void {
		if ( ! class_exists( StoreApi::class ) || ! class_exists( ExtendSchema::class ) ) {
			return;
		}

		$extend = StoreApi::container()->get( ExtendSchema::class );
		if ( ! $extend instanceof ExtendSchema ) {
			return;
		}

		$extend->register_endpoint_data(
			array(
				'endpoint'        => CheckoutSchema::IDENTIFIER,
				'namespace'       => self::NAMESPACE,
				'schema_callback' => array( $this, 'schema' ),
				'schema_type'     => ARRAY_A,
			)
		);
	}

	/**
	 * The properties the checkout may post under our namespace.
	 *
	 * WooCommerce rebuilds the posted object from exactly these keys and drops
	 * everything else (see `AbstractSchema::get_recursive_sanitize_callback()`),
	 * so what is not declared here never reaches update_order(). Each field is
	 * therefore declared twice: under its full id, which is what the checkout
	 * bundle reads off `window.cbwbCheckout`, and under the bare storage key it
	 * is saved as. Either name works; neither can be mistaken for the other.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	public function schema(): array {
		$schema = array();

		foreach ( $this->fields() as $field ) {
			$property = array(
				'description' => $field->label(),
				'type'        => array( 'string', 'null' ),
				'context'     => array( 'view', 'edit' ),
				// An anti-abuse ceiling only. The merchant's own maximum is
				// enforced in validate(), which can say which field it was.
				'maxLength'   => self::ceiling( $field ),
			);

			$schema[ $field->id() ]          = $property;
			$schema[ $field->storage_key() ] = $property;
		}

		return $schema;
	}

	/**
	 * Validate and store what the checkout posted.
	 *
	 * The method is the whole of the decision, because the two requests
	 * WooCommerce fires this action on mean opposite things.
	 *
	 * The draft `PUT /wc/store/v1/checkout` the block checkout sends after a
	 * failed payment carries only the fields the client changed — never
	 * `extensions` — so on a PUT our values simply are not in the request. It is
	 * left alone entirely: nothing validated, nothing stored, nothing cleared.
	 * Reading its absent values as empty ones made a filled-in required field
	 * answer "Please fill in Delivery date" and fail the request at the moment
	 * the shopper was trying to correct their card details, and taking the same
	 * silence as a request to clear wiped every optional value off the pending
	 * order.
	 *
	 * The POST that places the order is the whole form, so an absent
	 * `extensions.cbwb` block is an empty submission rather than a request to
	 * skip our fields. Every active field is validated against it and any value
	 * an earlier attempt left behind is cleared. Returning early on the missing
	 * block instead let a request that had only to leave it out place the order
	 * with every required field empty.
	 *
	 * @param mixed $order   Order being placed.
	 * @param mixed $request The checkout request.
	 * @throws RouteException When a value is missing or unusable.
	 */
	public function update_order( $order, $request ): void {
		if ( ! $order instanceof WC_Order || ! $request instanceof WP_REST_Request ) {
			return;
		}

		// The draft PUT/PATCH carries a diff, not the form. Only the POST that
		// places the order is authoritative about our values.
		if ( 'POST' !== $request->get_method() ) {
			return;
		}

		$fields = $this->fields();
		if ( array() === $fields ) {
			return;
		}

		$posted = self::posted_values( $request );

		foreach ( $fields as $field ) {
			$state = self::field_state( $field, $request );

			// A field an add-on has hidden is not on the shopper's screen, so it
			// is not theirs to fill in: it is not validated, nothing is stored for
			// it, and anything an earlier attempt left behind is cleared.
			if ( $state['hidden'] ) {
				RichValues::delete_order_value( $order, $field );
				continue;
			}

			$raw = self::value_for( $field, $posted );

			$message = RichValues::validate( $field, $raw, $state['required'] );
			if ( null !== $message ) {
				throw new RouteException(
					esc_attr( self::ERROR_CODE ),
					esc_html( $message ),
					400,
					array( 'field' => esc_attr( $field->id() ) )
				);
			}

			$error = self::extra_validation( $raw, $field, $request );
			if ( null !== $error ) {
				throw new RouteException(
					esc_attr( self::ERROR_CODE ),
					esc_html( $error ),
					400,
					array( 'field' => esc_attr( $field->id() ) )
				);
			}

			RichValues::set_order_value( $order, $field, RichValues::sanitize( $field, $raw ) );
		}//end foreach
	}

	/**
	 * Copy the values the merchant marked "save to profile" onto the customer.
	 *
	 * Deliberately a separate hook from update_order(). An account created during
	 * checkout does not exist yet while the order is being filled in, so
	 * `get_customer_id()` is still 0 there and the values went nowhere. By the
	 * time WooCommerce announces the order as processed the customer has been
	 * resolved, which is the earliest point at which a new account can be given
	 * what they typed.
	 *
	 * @param mixed $order The processed order.
	 */
	public function save_to_profile( $order ): void {
		if ( ! $order instanceof WC_Order ) {
			return;
		}

		$customer_id = (int) $order->get_customer_id();
		if ( $customer_id <= 0 ) {
			return;
		}

		foreach ( $this->fields() as $field ) {
			if ( ! $field->saves_to_profile() ) {
				continue;
			}

			$value = RichValues::order_value( $order, $field );
			if ( '' === $value ) {
				continue;
			}

			RichValues::set_customer_value( $customer_id, $field, $value );
		}
	}

	/**
	 * Whether one field is being asked for on this request, and whether it has
	 * to be answered.
	 *
	 * @param FieldDefinition $field   Field definition.
	 * @param WP_REST_Request $request The checkout request.
	 * @return array{hidden: bool, required: bool}
	 */
	private static function field_state( FieldDefinition $field, WP_REST_Request $request ): array {
		$state = array(
			'hidden'   => false,
			// A field in one of the two address-form positions is only asked for
			// when that form is on the shopper's screen, so it is only required
			// when it was. Seeded before the filter rather than enforced after
			// it, so an add-on still has the last word.
			'required' => $field->is_required() && self::form_is_shown( $field, $request ),
		);

		/**
		 * Filters whether a field of one of our own types applies to this request.
		 *
		 * The Checkout block decides what to show in the browser, and this is how
		 * an add-on tells the server the same thing, so that a field the shopper
		 * never saw is not held against them. A hidden field is not validated, is
		 * not stored, and has any value an earlier attempt left on the order
		 * removed. `required` may be tightened or relaxed the same way.
		 *
		 * Only fields Fieldwright renders itself are passed through here.
		 * WooCommerce's own field types carry their conditions in the `hidden`
		 * rules it evaluates itself.
		 *
		 * @since 1.0.0
		 *
		 * @param array{hidden: bool, required: bool} $state   Seeded from the field's own settings.
		 * @param FieldDefinition                     $field   The field being considered.
		 * @param WP_REST_Request                     $request The checkout request.
		 */
		$filtered = apply_filters( 'cbwb_rich_field_state', $state, $field, $request );

		if ( ! is_array( $filtered ) ) {
			return $state;
		}

		return array(
			'hidden'   => ! empty( $filtered['hidden'] ),
			'required' => isset( $filtered['required'] ) ? (bool) $filtered['required'] : $state['required'],
		);
	}

	/**
	 * Whether the form a field sits in was on the shopper's screen.
	 *
	 * The Checkout block draws the shipping address form, and the shipping
	 * options under it, only while the order is being shipped somewhere: not
	 * for a cart of downloads, not when the store ships to the billing address
	 * only, and not when the shopper chose to collect in person. The billing
	 * form is drawn whenever the shipping form is not, and otherwise only when
	 * the shopper unticked "Use same address for billing". A field in any of
	 * those positions was only asked when its form was, so it is only required
	 * when it was.
	 *
	 * Every other position is on every checkout, so the question does not arise.
	 *
	 * @param FieldDefinition $field   Field definition.
	 * @param WP_REST_Request $request The checkout request.
	 * @return bool
	 */
	private static function form_is_shown( FieldDefinition $field, WP_REST_Request $request ): bool {
		switch ( $field->location() ) {
			case FieldDefinition::LOCATION_SHIPPING_ADDRESS:
				return self::shipping_form_is_shown();

			case FieldDefinition::LOCATION_AFTER_SHIPPING:
				return self::shipping_options_are_shown();

			case FieldDefinition::LOCATION_BILLING_ADDRESS:
				return ! self::shipping_form_is_shown() || ! self::billing_matches_shipping( $request );
		}

		return true;
	}

	/**
	 * Whether the shipping address form is on the shopper's screen: the order
	 * is being shipped, the store takes a shipping address at all, and the
	 * shopper is not collecting.
	 *
	 * @return bool
	 */
	private static function shipping_form_is_shown(): bool {
		return self::shipping_options_are_shown() && 'billing_only' !== get_option( 'woocommerce_ship_to_destination' );
	}

	/**
	 * Whether the shipping options are on the shopper's screen: the order is
	 * being shipped, and not collected in person.
	 *
	 * @return bool
	 */
	private static function shipping_options_are_shown(): bool {
		return self::cart_needs_shipping() && ! self::prefers_collection();
	}

	/**
	 * Whether this order is being shipped anywhere.
	 *
	 * A cart of downloads or a store with shipping switched off never draws the
	 * shipping address form, so a field placed in it was never asked.
	 *
	 * Fails towards "yes": a request with no cart to ask is not evidence that
	 * the form was missing, and a merchant's required field should not quietly
	 * stop being required because something else went wrong.
	 *
	 * @return bool
	 */
	private static function cart_needs_shipping(): bool {
		if ( ! function_exists( 'WC' ) ) {
			return true;
		}

		$cart = WC()->cart;

		return $cart instanceof WC_Cart ? (bool) $cart->needs_shipping() : true;
	}

	/**
	 * Whether the shopper chose to collect the order rather than have it
	 * shipped, which is when the Checkout block puts the shipping form and the
	 * shipping options away.
	 *
	 * Read the way the block reads it: the rate the session holds, against the
	 * methods WooCommerce knows collect in person. Fails towards "no", for the
	 * same reason `cart_needs_shipping()` fails towards "yes".
	 *
	 * @return bool
	 */
	private static function prefers_collection(): bool {
		if ( ! function_exists( 'WC' ) || null === WC()->session ) {
			return false;
		}

		$chosen = WC()->session->get( 'chosen_shipping_methods' );
		if ( ! is_array( $chosen ) || array() === $chosen ) {
			return false;
		}

		// The two methods WooCommerce ships, plus whatever else it says collects
		// in person: the block's own pickup method is only registered while
		// its setting is on, and a rate chosen under it is still a collection.
		$pickup = array( 'local_pickup', 'pickup_location' );
		if ( class_exists( LocalPickupUtils::class ) ) {
			$ids = LocalPickupUtils::get_local_pickup_method_ids();
			if ( is_array( $ids ) ) {
				$pickup = array_unique( array_merge( $pickup, array_map( 'strval', $ids ) ) );
			}
		}

		foreach ( $chosen as $rate ) {
			if ( ! is_string( $rate ) ) {
				continue;
			}

			$method = strtok( $rate, ':' );
			if ( is_string( $method ) && in_array( $method, $pickup, true ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Whether the billing address arrived as a copy of the shipping one, which
	 * is what the checkout posts when "Use same address for billing" is ticked
	 * and the billing form was therefore never drawn.
	 *
	 * Compared key by key rather than by whether the client sent a flag: the
	 * Store API has no such flag, and the copy is the only thing about the
	 * request that says the shopper did not see the second form.
	 *
	 * @param WP_REST_Request $request The checkout request.
	 * @return bool
	 */
	private static function billing_matches_shipping( WP_REST_Request $request ): bool {
		$billing  = $request['billing_address'];
		$shipping = $request['shipping_address'];

		if ( ! is_array( $billing ) || ! is_array( $shipping ) ) {
			return false;
		}

		foreach ( self::ADDRESS_KEYS as $key ) {
			$billed  = isset( $billing[ $key ] ) && is_scalar( $billing[ $key ] ) ? (string) $billing[ $key ] : '';
			$shipped = isset( $shipping[ $key ] ) && is_scalar( $shipping[ $key ] ) ? (string) $shipping[ $key ] : '';

			if ( $billed !== $shipped ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Give an add-on the last word on a value our own checks have accepted.
	 *
	 * @param mixed           $value   The posted value.
	 * @param FieldDefinition $field   Field definition.
	 * @param WP_REST_Request $request The checkout request.
	 * @return string|null Message to reject the value with, or null to accept it.
	 */
	private static function extra_validation( $value, FieldDefinition $field, WP_REST_Request $request ): ?string {
		/**
		 * Filters the result of validating one of our own field's values.
		 *
		 * Runs only once the field's own rules (required, length, option list,
		 * format, range) have all passed, so an add-on sees a value that is
		 * already well formed and can concentrate on what it alone knows: that
		 * the chosen date is a day the store delivers on, say. Returning a
		 * `WP_Error` rejects the checkout with that error's message, attributed to
		 * this field.
		 *
		 * @since 1.0.0
		 *
		 * @param WP_Error|null   $error   Null while the value is still acceptable.
		 * @param mixed           $value   The posted value.
		 * @param FieldDefinition $field   The field being validated.
		 * @param WP_REST_Request $request The checkout request.
		 */
		$error = apply_filters( 'cbwb_validate_rich_value', null, $value, $field, $request );

		if ( ! is_wp_error( $error ) ) {
			return null;
		}

		$message = $error->get_error_message();

		return '' === $message ? null : $message;
	}

	/**
	 * Every enabled field we own the storage for. Headings and paragraphs are
	 * left out: they have no value, so they have nothing to declare or store.
	 *
	 * So is a field the checkout cannot collect today, whether because nothing
	 * answers for its type or because the add-on that does cannot take new
	 * answers. A field the shopper was never shown is not one they can be asked
	 * to fill in, so it is neither declared on the endpoint nor required by it;
	 * left in, a required one would stop every order with a message about a
	 * field nobody could see.
	 *
	 * @return FieldDefinition[]
	 */
	public function fields(): array {
		return array_values(
			array_filter(
				$this->config->fields()->enabled(),
				static function ( FieldDefinition $field ): bool {
					return $field->is_rich() && $field->is_available();
				}
			)
		);
	}

	/**
	 * The absolute length one field's value may reach, whatever the merchant
	 * configured.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return int
	 */
	private static function ceiling( FieldDefinition $field ): int {
		return FieldDefinition::TYPE_TEXTAREA === $field->type()
			? FieldDefinition::MAX_TEXTAREA_LENGTH
			: FieldDefinition::MAX_FIELD_LENGTH;
	}

	/**
	 * Everything posted under our namespace.
	 *
	 * A request that carried no block of ours comes back as an empty array, which
	 * on the POST that places the order is a form with every one of our fields
	 * left blank. See update_order().
	 *
	 * @param WP_REST_Request $request The checkout request.
	 * @return array<string, mixed>
	 */
	private static function posted_values( WP_REST_Request $request ): array {
		$extensions = $request['extensions'];

		if ( ! is_array( $extensions ) || ! isset( $extensions[ self::NAMESPACE ] ) || ! is_array( $extensions[ self::NAMESPACE ] ) ) {
			return array();
		}

		return $extensions[ self::NAMESPACE ];
	}

	/**
	 * One field's posted value, under either of the names it may arrive as.
	 *
	 * WooCommerce fills in every declared property, using null for the ones the
	 * client left out, so "absent" and "sent as null" look the same here — which
	 * is why the alias is only consulted once the primary name has come back
	 * empty rather than only when it is missing.
	 *
	 * @param FieldDefinition      $field  Field definition.
	 * @param array<string, mixed> $posted Everything posted under our namespace.
	 * @return mixed
	 */
	private static function value_for( FieldDefinition $field, array $posted ) {
		foreach ( array( $field->id(), $field->storage_key() ) as $key ) {
			if ( isset( $posted[ $key ] ) && '' !== $posted[ $key ] ) {
				return $posted[ $key ];
			}
		}

		return null;
	}
}
