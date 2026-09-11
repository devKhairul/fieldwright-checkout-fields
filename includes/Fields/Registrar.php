<?php
/**
 * Registers configured fields with WooCommerce.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Fields;

use CheckoutBuilder\Config;
use CheckoutBuilder\I18n\Strings;
use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Translates our field configuration into WooCommerce's Additional Checkout
 * Fields API.
 *
 * Core rejects bad registrations silently, so everything handed over here has
 * already passed FieldDefinition validation.
 */
final class Registrar {

	/**
	 * Index offset applied to our fields outside the address form. WooCommerce's
	 * own fields occupy 0–100, so starting at 1000 keeps custom fields below them
	 * without fighting future core additions.
	 *
	 * The address form is the exception: there, core and custom fields share one
	 * ordered list the merchant arranges, so the index comes from that list —
	 * see CoreFields::index_for().
	 */
	public const INDEX_BASE = 1000;

	/**
	 * Gap between consecutive fields, leaving room to insert without a rewrite.
	 */
	public const INDEX_STEP = 10;

	/**
	 * Config repository.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * WooCommerce's own checkout fields, which share the address form's order.
	 *
	 * @var CoreFields
	 */
	private $core;

	/**
	 * Whether registration already ran this request.
	 *
	 * @var bool
	 */
	private $registered = false;

	/**
	 * The fields handed to WooCommerce this request, keyed by id.
	 *
	 * @var array<string, FieldDefinition>
	 */
	private $handed_over = array();

	/**
	 * Constructor.
	 *
	 * @param Config          $config Config repository.
	 * @param CoreFields|null $core   Core-field service, built from the same config when omitted.
	 */
	public function __construct( Config $config, ?CoreFields $core = null ) {
		$this->config = $config;
		$this->core   = $core instanceof CoreFields ? $core : new CoreFields( $config );
	}

	/**
	 * Attach hooks. `woocommerce_init` fires on `init` priority 0, after
	 * `after_setup_theme` (which WooCommerce requires) and before the checkout
	 * block is registered.
	 */
	public function register(): void {
		add_action( 'woocommerce_init', array( $this, 'register_fields' ) );
		add_action( 'woocommerce_validate_additional_field', array( $this, 'correct_message' ), 10, 3 );
	}

	/**
	 * Register every enabled field with WooCommerce.
	 */
	public function register_fields(): void {
		if ( $this->registered || ! function_exists( 'woocommerce_register_additional_checkout_field' ) ) {
			return;
		}
		$this->registered = true;

		$positions = array_fill_keys( FieldDefinition::locations(), 0 );

		foreach ( $this->config->fields()->enabled() as $field ) {
			// Only the types WooCommerce's own API understands come through
			// here; the rest are rendered and stored by our own checkout block,
			// and a type nothing answers for is in neither camp, so it is left
			// in the configuration and never handed over.
			if ( ! $field->is_core_backed() ) {
				continue;
			}

			$position = $positions[ $field->location() ];
			++$positions[ $field->location() ];

			$this->handed_over[ $field->id() ] = $field;

			woocommerce_register_additional_checkout_field( $this->build_args( $field, $position ) );
		}
	}

	/**
	 * Put the merchant's wording back on a rejected field.
	 *
	 * A field that carries `validation` rules has its validate_callback swapped
	 * out by core (`CheckoutFields::get_validate_callback()`) for one that
	 * evaluates the schema and reports "Please provide a valid <label>". The
	 * shopper reading that has no idea what the field wanted, and the message
	 * ajv-errors shows them in the browser says something else entirely — so the
	 * check is re-run here and, when it agrees the value is wrong, its message
	 * replaces the generic one.
	 *
	 * @param mixed $errors      WP_Error collector for this field.
	 * @param mixed $field_id    Field key.
	 * @param mixed $field_value Submitted value.
	 */
	public function correct_message( $errors, $field_id, $field_value ): void {
		if ( ! $errors instanceof WP_Error || ! is_string( $field_id ) ) {
			return;
		}

		$field = $this->handed_over[ $field_id ] ?? null;
		if ( null === $field ) {
			return;
		}

		$ours = $this->validate( $field, $field_value );
		if ( ! $ours instanceof WP_Error ) {
			return;
		}

		// Everything filed under core's own code is about the value we have just
		// re-checked and found wrong, so replacing it loses nothing the shopper
		// still needs. Our own code (and any other extension's) is left alone.
		$errors->remove( 'woocommerce_invalid_checkout_field' );
		$errors->merge_from( $ours );
	}

	/**
	 * Whether register_fields() has already run this request.
	 *
	 * @return bool
	 */
	public function has_registered(): bool {
		return $this->registered;
	}

	/**
	 * Build the exact argument array core expects for one field.
	 *
	 * @param FieldDefinition $field    Field definition.
	 * @param int             $position Zero-based position within its location.
	 * @return array<string, mixed>
	 */
	public function build_args( FieldDefinition $field, int $position ): array {
		// The merchant's own words, in the language of this request. Nothing
		// happens here on a store with no translation plugin; where there is
		// one, the filter below sees the translation, so an add-on appending to
		// the label appends to the right one.
		$stored = Strings::field( $field, 'label', $field->label() );

		/**
		 * Filters the label a field is registered with on the checkout.
		 *
		 * Only the checkout-facing copy changes; the stored label (and so the
		 * order confirmation, emails and admin) is untouched. Used by add-ons to
		 * append information the merchant did not type, such as a fee amount.
		 *
		 * @since 1.0.0
		 *
		 * @param string          $label Stored label.
		 * @param FieldDefinition $field Field definition.
		 */
		$label = apply_filters( 'cbwb_field_checkout_label', $stored, $field );

		$args = array(
			'id'                         => $field->id(),
			'label'                      => is_string( $label ) && '' !== $label ? $label : $stored,
			'location'                   => $field->location(),
			// Core only understands three types. An email, phone, number or url
			// field is registered as text and upgraded in the browser from the
			// `data-cbwb-type` attribute below.
			'type'                       => $field->core_type(),
			'required'                   => $field->is_required(),
			'index'                      => $this->index_for( $field, $position ),
			'show_in_order_confirmation' => $field->show_in_order_confirmation(),
			'attributes'                 => $this->build_attributes( $field ),
		);

		// Left to itself, `CheckoutFields::register_checkout_field()` fills this
		// in as "<label> (optional)" for every field it accepts, text, dropdown
		// and checkbox alike, and the checkout prints it whenever the field is
		// not required. Handing over the label itself is what leaves an optional
		// field reading exactly as a required one does, which is the whole of
		// what "mark required fields" means for the fields WooCommerce carries.
		// Nothing in WooCommerce validates or re-derives the value.
		if ( $this->config->marks_required() ) {
			$args['optionalLabel'] = $args['label'];
		}

		if ( FieldDefinition::TYPE_SELECT === $field->type() ) {
			// Only dropdowns take a placeholder: it becomes the first,
			// unselected choice. On a text input it would collide with the
			// label WooCommerce floats inside the box.
			// A merchant who cleared the placeholder gets a plain one rather
			// than WooCommerce's own fallback, which reads the label back as
			// "Select a how did you hear about us (optional)".
			$args['placeholder'] = '' !== $field->placeholder()
				? Strings::field( $field, 'placeholder', $field->placeholder() )
				: __( 'Choose an option', 'fieldwright-checkout-fields' );

			// Labels only. The values are what the browser posts and what the
			// order stores, so a translated one would stop matching the list.
			$args['options'] = Strings::options( $field, $field->options() );
		}

		// Core only accepts `error_message` on a required checkbox — it warns and
		// drops it anywhere else. A text field's message is therefore never handed
		// over: our own validate_callback returns it instead, via format_message().
		if ( FieldDefinition::TYPE_CHECKBOX === $field->type() && $field->is_required() && '' !== $field->error_message() ) {
			$args['error_message'] = Strings::field( $field, 'error', $field->error_message() );
		}

		$pattern = $field->effective_pattern();
		if ( null !== $pattern ) {
			$args['validation'] = self::validation_schema( $pattern, $this->format_message( $field ) );
		}

		$args['sanitize_callback'] = function ( $value, $core_field = null ) use ( $field ) {
			unset( $core_field );
			return $this->sanitize( $field, $value );
		};

		$args['validate_callback'] = function ( $value, $core_field = null ) use ( $field ) {
			unset( $core_field );
			return $this->validate( $field, $value );
		};

		/**
		 * Filters the argument array handed to WooCommerce for one field.
		 *
		 * This is the last chance to touch a registration, so add-ons use it to
		 * add options core supports but Free does not expose — conditional
		 * `hidden`/`required` rule schemas, for instance. Returning anything but
		 * an array leaves the registration untouched.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string, mixed> $args     Registration arguments.
		 * @param FieldDefinition      $field    Field definition.
		 * @param int                  $position Zero-based position within its location.
		 */
		$filtered = apply_filters( 'cbwb_register_field_args', $args, $field, $position );

		return is_array( $filtered ) ? $filtered : $args;
	}

	/**
	 * One field's label, in the language of this request.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return string
	 */
	private function label( FieldDefinition $field ): string {
		return Strings::field( $field, 'label', $field->label() );
	}

	/**
	 * The message shown when a value does not match its format, in the language
	 * of this request.
	 *
	 * The merchant's own message is the translatable one. The preset's wording
	 * is a gettext string of ours, already translated by the time it is read, so
	 * it is left alone.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return string
	 */
	private function format_message( FieldDefinition $field ): string {
		if ( '' === $field->error_message() ) {
			return $field->format_message();
		}

		return Strings::field( $field, 'error', $field->error_message() );
	}

	/**
	 * Where one field sorts among the fields around it.
	 *
	 * An address field takes its place from the merged Address order, because
	 * there it is competing with WooCommerce's own fields for the same sorted
	 * list and the merchant may well have put it between two of them. Everywhere
	 * else there is nothing of WooCommerce's to interleave with, so our fields
	 * simply follow core's, in the order the merchant arranged them.
	 *
	 * @param FieldDefinition $field    Field definition.
	 * @param int             $position Zero-based position within its location.
	 * @return int
	 */
	private function index_for( FieldDefinition $field, int $position ): int {
		if ( FieldDefinition::LOCATION_ADDRESS === $field->location() ) {
			return $this->core->index_for( $field->id() );
		}

		return self::INDEX_BASE + ( self::INDEX_STEP * $position );
	}

	/**
	 * Sanitize a submitted value for one field.
	 *
	 * A text field is always capped, whether or not the merchant set a maximum.
	 * Nothing downstream imposes one — core's generated schema for an additional
	 * field is a bare `{"type":"string"}` — and the value is written as order
	 * meta, and for contact/address fields to the session on every
	 * `cart/update-customer` call, which needs neither an order nor a payment.
	 * `MAX_FIELD_LENGTH` is already the ceiling on the *configured* maximum, so
	 * it is the right default for an unconfigured one.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param mixed           $value Submitted value.
	 * @return mixed
	 */
	public function sanitize( FieldDefinition $field, $value ) {
		if ( FieldDefinition::TYPE_CHECKBOX === $field->type() ) {
			// `rest_sanitize_boolean()` rather than a cast, so the strings a REST
			// client may send read the way REST says they should: "false" and "0"
			// are false, where a cast would make both true. WooCommerce normalises
			// this to a real boolean before we are called, so it is a guard rather
			// than a fix. Anything that is not boolean-like at all is not a ticked
			// box: a required checkbox is usually a consent box, and consent is
			// not something to infer from a value nobody can read.
			if ( is_bool( $value ) || is_string( $value ) || is_int( $value ) ) {
				return rest_sanitize_boolean( $value );
			}

			return false;
		}

		$clean = sanitize_text_field( is_scalar( $value ) ? (string) $value : '' );

		if ( FieldDefinition::TYPE_SELECT === $field->type() ) {
			return in_array( $clean, $field->option_values(), true ) ? $clean : '';
		}

		$max = $field->length_cap();
		if ( mb_strlen( $clean ) > $max ) {
			$clean = mb_substr( $clean, 0, $max );
		}

		return $clean;
	}

	/**
	 * Validate a submitted value for one field.
	 *
	 * Core calls this with the raw (whitespace-trimmed) value before
	 * sanitization, and treats a returned WP_Error as a checkout error.
	 * Returning nothing means "valid".
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param mixed           $value Submitted value.
	 * @return WP_Error|void
	 */
	public function validate( FieldDefinition $field, $value ) {
		$string = is_scalar( $value ) ? (string) $value : '';

		if ( FieldDefinition::TYPE_SELECT === $field->type() ) {
			if ( '' !== $string && ! in_array( $string, $field->option_values(), true ) ) {
				return new WP_Error(
					'cbwb_invalid_option',
					sprintf(
						/* translators: %s: field label. */
						__( 'Choose one of the available options for %s.', 'fieldwright-checkout-fields' ),
						$this->label( $field )
					)
				);
			}
			return;
		}

		if ( FieldDefinition::TYPE_CHECKBOX === $field->type() || '' === $string ) {
			return;
		}

		// Said rather than silently cut: `sanitize()` still trims an overlong
		// value to the cap for the callers that never validate, but a shopper
		// (or a client) who sent one is told, the way the fields we draw
		// ourselves tell them.
		if ( mb_strlen( $string ) > $field->length_cap() ) {
			return new WP_Error(
				'cbwb_too_long',
				sprintf(
					/* translators: 1: field label, 2: maximum number of characters. */
					__( '%1$s cannot be longer than %2$d characters.', 'fieldwright-checkout-fields' ),
					$this->label( $field ),
					$field->length_cap()
				)
			);
		}

		$pattern = $field->effective_pattern();
		if ( null !== $pattern && ! FormatPresets::matches( $pattern, $string ) ) {
			return new WP_Error( 'cbwb_invalid_format', $this->format_message( $field ) );
		}

		if ( FieldDefinition::TYPE_NUMBER === $field->type() ) {
			return $this->validate_range( $field, $string );
		}
	}

	/**
	 * Check a number against the merchant's bounds.
	 *
	 * The format preset has already established the value is a number, so this
	 * only has the comparison left to do. Bounds are not registered as HTML
	 * `min`/`max` attributes — the browser would block the submit with its own
	 * wording before anything of ours ran — but as `data-` attributes the
	 * checkout bundle reads.
	 *
	 * @param FieldDefinition $field  Field definition.
	 * @param string          $submitted Submitted value.
	 * @return WP_Error|void
	 */
	private function validate_range( FieldDefinition $field, string $submitted ) {
		// The number preset accepts a comma as the decimal separator.
		$number = (float) str_replace( ',', '.', $submitted );
		$min    = $field->min();
		$max    = $field->max();

		if ( null !== $min && null !== $max && ( $number < $min || $number > $max ) ) {
			return new WP_Error(
				'cbwb_invalid_range',
				sprintf(
					/* translators: 1: field label, 2: smallest accepted number, 3: largest accepted number. */
					__( '%1$s must be between %2$s and %3$s.', 'fieldwright-checkout-fields' ),
					$this->label( $field ),
					self::number_text( $min ),
					self::number_text( $max )
				)
			);
		}

		if ( null !== $min && $number < $min ) {
			return new WP_Error(
				'cbwb_invalid_range',
				sprintf(
					/* translators: 1: field label, 2: smallest accepted number. */
					__( '%1$s must be %2$s or more.', 'fieldwright-checkout-fields' ),
					$this->label( $field ),
					self::number_text( $min )
				)
			);
		}

		if ( null !== $max && $number > $max ) {
			return new WP_Error(
				'cbwb_invalid_range',
				sprintf(
					/* translators: 1: field label, 2: largest accepted number. */
					__( '%1$s must be %2$s or less.', 'fieldwright-checkout-fields' ),
					$this->label( $field ),
					self::number_text( $max )
				)
			);
		}
	}

	/**
	 * A bound written the way it was configured: whole numbers stay whole.
	 *
	 * @param float $number Bound.
	 * @return string
	 */
	private static function number_text( float $number ): string {
		return (string) ( floor( $number ) === $number ? (int) $number : $number );
	}

	/**
	 * Core's per-field `validation` schema for one text format.
	 *
	 * Registered as an HTML `pattern` attribute, a format is enforced by the
	 * browser itself: it refuses the submit with its own wording ("Please match
	 * the requested format.") before the checkout — or our validate callback —
	 * gets a look in, so the merchant's message is never read. Core's `validation`
	 * rules are a JSON Schema for the field's own value instead, evaluated by ajv
	 * in the browser (ajv-errors renders the `errorMessage` we attach, and ajv
	 * compiles patterns with the `u` flag, so `\p{L}` in the letters preset still
	 * works) and by Opis on the server, which ignores the keyword.
	 *
	 * The trailing `?` leaves an empty value valid, the way our own validate
	 * callback does: emptiness is the required check's business, not the format's.
	 *
	 * @param string $pattern Effective pattern body.
	 * @param string $message Message shown when the value does not match.
	 * @return array<string, string>
	 */
	private static function validation_schema( string $pattern, string $message ): array {
		return array(
			'type'         => 'string',
			'pattern'      => '^(?:' . $pattern . ')?$',
			'errorMessage' => self::literal_message( $message ),
		);
	}

	/**
	 * A message ajv-errors will print as the merchant wrote it.
	 *
	 * The ajv-errors library reads `${…}` in an `errorMessage` as a JSON pointer into the data
	 * being validated and substitutes whatever it finds there. Two things follow
	 * for a message a merchant typed. The mild one is that a message containing
	 * that sequence would print part of the shopper's own submission back at them.
	 * The less mild one is that the pointer is resolved while the schema is being
	 * compiled, during the checkout's render, and a pointer that resolves to
	 * nothing throws there — which is the same broken checkout a bad pattern
	 * causes, from a different direction.
	 *
	 * ajv-errors has no escape syntax (its interpolation is a plain
	 * `/\$\{([^}]+)\}/g` replace with nothing exempted), so the sequence is broken
	 * up instead. Only `${` is touched, and only when it is there at all, so every
	 * message that does not use it reaches the shopper untouched.
	 *
	 * @param string $message The merchant's message.
	 * @return string
	 */
	private static function literal_message( string $message ): string {
		return str_replace( '${', '$ {', $message );
	}

	/**
	 * Build the `attributes` array core forwards to the block's input.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return array<string, mixed>
	 */
	private function build_attributes( FieldDefinition $field ): array {
		$attributes = array();
		$type       = $field->type();

		// Mirror the server-side cap into the browser, so a text field always
		// carries one even when the merchant did not set a maximum. Text only:
		// a dropdown's values are checked against its option list, and a
		// checkbox is a boolean.
		if ( FieldDefinition::TYPE_SELECT !== $type && FieldDefinition::TYPE_CHECKBOX !== $type ) {
			$attributes['maxLength'] = $field->length_cap();
		}

		// No `pattern` attribute: it becomes the input's native HTML constraint,
		// and the browser then blocks the submit with its own wording before any
		// of our validation runs. The pattern is registered as a `validation`
		// schema instead — see validation_schema().
		if ( '' !== $field->autocomplete() ) {
			$attributes['autocomplete'] = $field->autocomplete();
		}

		// Core renders every one of these as `<input type="text">`. The checkout
		// bundle reads this back off the DOM and sets the real input type and
		// inputmode, which is what puts an @ key on a phone keyboard. Core's
		// attribute allowlist passes anything starting `data-`.
		if ( in_array( $type, array( FieldDefinition::TYPE_EMAIL, FieldDefinition::TYPE_PHONE, FieldDefinition::TYPE_NUMBER, FieldDefinition::TYPE_URL ), true ) ) {
			$attributes['data-cbwb-type'] = $type;
		}

		if ( FieldDefinition::TYPE_NUMBER === $type ) {
			foreach ( array(
				'data-cbwb-min'  => $field->min(),
				'data-cbwb-max'  => $field->max(),
				'data-cbwb-step' => $field->step(),
			) as $attribute => $bound ) {
				if ( null !== $bound ) {
					$attributes[ $attribute ] = self::number_text( $bound );
				}
			}
		}

		return $attributes;
	}
}
