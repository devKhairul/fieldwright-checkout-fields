<?php
/**
 * The checkout bundle.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Checkout;

use Automattic\WooCommerce\Blocks\Integrations\IntegrationInterface;
use Automattic\WooCommerce\Blocks\Integrations\IntegrationRegistry;
use CheckoutBuilder\Config;
use CheckoutBuilder\Fields\FieldDefinition;
use CheckoutBuilder\Fields\RichValues;
use CheckoutBuilder\Fields\TypeRegistry;
use CheckoutBuilder\I18n\Strings;

defined( 'ABSPATH' ) || exit;

/**
 * Loads the script that renders our own field types on the block checkout, and
 * upgrades the typed text fields WooCommerce renders as plain text boxes.
 *
 * A store using nothing but plain text, dropdowns and checkboxes needs none of
 * it, so the bundle is skipped entirely there.
 *
 * The handle is registered once and reached two ways: as a dependency of
 * WooCommerce's own checkout script, which is the only ordering under which our
 * block component is registered in time (see Integration), and by a plain
 * enqueue on the checkout, which covers a page that loads the bundle for the
 * typed inputs alone without WooCommerce's checkout script being involved.
 *
 * The stylesheet the bundle is built with wears the same handle, but only the
 * second of those routes: an integration declares scripts and nothing else, so
 * a style WooCommerce is never told about has to enqueue itself.
 */
final class Assets {

	public const HANDLE = 'cbwb-checkout';

	/**
	 * Handles the bundle needs on top of whatever the build declared.
	 */
	public const DEPENDENCIES = array(
		'wc-blocks-checkout',
		'wc-blocks-components',
		'wp-data',
		'wp-element',
		'wp-i18n',
	);

	/**
	 * WooCommerce's own checkout stylesheets, in the order it registers them:
	 * the shared block components, then the checkout's own rules.
	 *
	 * Declared as dependencies of ours for two reasons. They are what our rules
	 * are measured against — the label size, the input box, the option spacing
	 * — so ours have to come *after* theirs for a tie to fall our way. And
	 * naming them drags them into `wp_head` alongside ours, where the checkout
	 * block would otherwise enqueue them mid-render and have them printed in
	 * the footer, after us.
	 *
	 * Whichever of them the running WooCommerce does not have is skipped: a
	 * dependency on an unregistered handle stops the stylesheet printing at
	 * all.
	 */
	public const STYLE_DEPENDENCIES = array(
		'wc-blocks-style',
		'wc-blocks-style-checkout',
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
	 * The class the checkout page wears while required fields are the ones
	 * being marked.
	 *
	 * Everything the stylesheet says about WooCommerce's own inputs is written
	 * under it, so a store on WooCommerce's own way round is styled by none of
	 * it even where the stylesheet is on the page for our own fields.
	 */
	public const ASTERISK_BODY_CLASS = 'cbwb-required-asterisk';

	/**
	 * Attach hooks.
	 */
	public function register(): void {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ) );
		add_action( 'woocommerce_blocks_checkout_block_registration', array( $this, 'register_integration' ) );
		add_filter( 'body_class', array( $this, 'body_class' ) );
	}

	/**
	 * Mark the checkout page as one that marks required fields.
	 *
	 * Set on the server rather than by the bundle, because the bundle is not
	 * loaded at all on a store whose only fields are WooCommerce's own — and
	 * those are exactly the fields the stylesheet has to reach.
	 *
	 * @param mixed $classes Body classes.
	 * @return mixed
	 */
	public function body_class( $classes ) {
		if ( ! is_array( $classes ) || ! $this->config->marks_required() || ! $this->is_checkout() ) {
			return $classes;
		}

		$classes[] = self::ASTERISK_BODY_CLASS;

		return $classes;
	}

	/**
	 * Hand WooCommerce the integration that makes its checkout script depend on
	 * ours, so ours executes first.
	 *
	 * @param mixed $registry WooCommerce's integration registry.
	 */
	public function register_integration( $registry ): void {
		// A WooCommerce old enough to fire the hook without the interface would
		// fatal on loading the class, so the check comes first.
		if ( ! $registry instanceof IntegrationRegistry || ! interface_exists( IntegrationInterface::class ) ) {
			return;
		}

		if ( $registry->is_registered( Integration::NAME ) ) {
			return;
		}

		$registry->register( new Integration( $this ) );
	}

	/**
	 * Register the bundle with everything it needs before its first render.
	 *
	 * Idempotent, because it is reached from two directions: WooCommerce calls
	 * the integration's `initialize()` on `init`, and the enqueue below runs on
	 * `wp_enqueue_scripts`. Registering twice would be harmless; printing the
	 * `window.cbwbCheckout` assignment twice would not be. The script registry
	 * is asked rather than a flag of our own, so a handle that went away with
	 * the registry it lived in is registered again rather than assumed.
	 *
	 * @return bool Whether the handle is registered and ready to be enqueued.
	 */
	public function register_script(): bool {
		if ( wp_script_is( self::HANDLE, 'registered' ) ) {
			return true;
		}

		if ( ! $this->needs_bundle() ) {
			return false;
		}

		$asset = $this->asset();
		if ( null === $asset ) {
			return false;
		}

		$dependencies = array_values(
			array_unique(
				array_merge(
					isset( $asset['dependencies'] ) && is_array( $asset['dependencies'] ) ? $asset['dependencies'] : array(),
					self::DEPENDENCIES
				)
			)
		);

		wp_register_script(
			self::HANDLE,
			CBWB_URL . 'build/checkout.js',
			$dependencies,
			$this->version( $asset ),
			true
		);
		wp_set_script_translations( self::HANDLE, 'fieldwright-checkout-fields', CBWB_DIR . 'languages' );

		// HEX flags keep any stored string from terminating the inline <script>.
		wp_add_inline_script(
			self::HANDLE,
			'window.cbwbCheckout = ' . wp_json_encode( $this->bootstrap_data(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ) . ';',
			'before'
		);

		return true;
	}

	/**
	 * Register the stylesheet the fields we draw ourselves are dressed in.
	 *
	 * WooCommerce's integration contract carries scripts and nothing else, so
	 * unlike the bundle this has no way in through `get_script_handles()` — the
	 * enqueue below is the only one it gets.
	 *
	 * Shares the script's handle: they are one asset in two files, and a
	 * separate name would only be something else to keep in step.
	 *
	 * @return bool Whether the handle is registered and ready to be enqueued.
	 */
	public function register_style(): bool {
		if ( wp_style_is( self::HANDLE, 'registered' ) ) {
			return true;
		}

		$asset = $this->asset();
		if ( null === $asset || ! file_exists( CBWB_DIR . 'build/style-checkout.css' ) ) {
			return false;
		}

		$dependencies = array();
		foreach ( self::STYLE_DEPENDENCIES as $handle ) {
			if ( wp_style_is( $handle, 'registered' ) ) {
				$dependencies[] = $handle;
			}
		}

		wp_register_style(
			self::HANDLE,
			CBWB_URL . 'build/style-checkout.css',
			$dependencies,
			$this->version( $asset )
		);
		wp_style_add_data( self::HANDLE, 'rtl', 'replace' );

		return true;
	}

	/**
	 * The handles WooCommerce should hang off its own checkout script.
	 *
	 * @return string[]
	 */
	public function script_handles(): array {
		return $this->register_script() ? array( self::HANDLE ) : array();
	}

	/**
	 * Whether anything in the configuration needs the bundle at all.
	 *
	 * @return bool
	 */
	public function needs_bundle(): bool {
		return array() !== $this->fields() || array() !== $this->typed_core_fields();
	}

	/**
	 * Enqueue the bundle where it has something to do.
	 *
	 * WooCommerce enqueues it for us wherever its checkout script loads; this
	 * covers the rest of the checkout — a shortcode page carrying typed inputs,
	 * say — and costs nothing where WooCommerce got there first.
	 *
	 * The stylesheet is enqueued on its own condition rather than the script's.
	 * It dresses the fields the bundle draws, so a checkout with none of them
	 * usually has nothing to style — but the asterisk on WooCommerce's own
	 * required fields is drawn from this sheet too, and that is exactly the case
	 * where there is no bundle to hang it off.
	 */
	public function enqueue(): void {
		if ( ! $this->is_checkout() ) {
			return;
		}

		if ( $this->register_script() ) {
			wp_enqueue_script( self::HANDLE );
		}

		if ( ! $this->needs_bundle() && ! $this->config->marks_required() ) {
			return;
		}

		if ( $this->register_style() ) {
			wp_enqueue_style( self::HANDLE );
		}
	}

	/**
	 * Everything the checkout bundle needs before its first render.
	 *
	 * @return array<string, mixed>
	 */
	public function bootstrap_data(): array {
		$fields = $this->fields();

		$data = array(
			'namespace'       => Extensions::NAMESPACE,
			// The merchant's own words, in the language of this request. This is
			// the only copy of them the fields we draw ourselves ever see, so it
			// is where their translations have to be applied.
			'fields'          => array_map(
				static function ( FieldDefinition $field ): array {
					return Strings::translate_payload( $field, self::public_field( $field ) );
				},
				$fields
			),
			'prefill'         => $this->prefill( $fields ),
			// Which way round this store marks required fields. The fields we
			// draw ourselves append "(optional)" themselves, so they have to be
			// told, or they would be the only ones on the page still saying it.
			'requiredMarking' => $this->config->required_marking(),
			'i18n'            => self::strings(),
			// The site's own date format, from Settings → General. A date the
			// bundle has to name in a message — the earliest one a field will
			// take, say — is written the way this store writes dates, so it
			// matches the same sentence coming back from the server.
			'dateFormat'      => (string) get_option( 'date_format', 'F j, Y' ),
		);

		/**
		 * Filters the data the checkout bundle receives before its first render.
		 *
		 * Inlined into the page as `window.cbwbCheckout`, so everything here has
		 * to survive `wp_json_encode()`, and it is public: never add anything
		 * the shopper should not be able to read.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string, mixed> $data Bootstrap data.
		 */
		$filtered = apply_filters( 'cbwb_checkout_bootstrap_data', $data );

		return is_array( $filtered ) ? $filtered : $data;
	}

	/**
	 * The keys of a field that only the builder and the order screens read.
	 *
	 * The checkout payload is inlined into a page every visitor loads, so it
	 * carries what the field needs to be drawn and validated and nothing about
	 * how the merchant runs the store: where an answer is shown afterwards,
	 * whether it is remembered against an account, whether the field is switched
	 * on (a field that is off is not in the payload at all), and an add-on's own
	 * settings. An add-on that needs the shopper to know something publishes it
	 * through `cbwb_checkout_bootstrap_data` on purpose, the way the date rules
	 * and the condition rules are.
	 */
	private const ADMIN_ONLY_KEYS = array( 'pro', 'visibility', 'save_to_profile', 'enabled' );

	/**
	 * One field as the checkout page may carry it.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return array<string, mixed>
	 */
	private static function public_field( FieldDefinition $field ): array {
		$data = $field->to_array();

		foreach ( self::ADMIN_ONLY_KEYS as $key ) {
			unset( $data[ $key ] );
		}

		// A registered type's own settings are under `pro`, which the payload
		// has just dropped, so the add-on publishes what the shopper needs from
		// them here instead: what its control has to be drawn and checked with,
		// resolved on the server and nothing more.
		$spec = TypeRegistry::spec( $field->type() );
		if ( null !== $spec ) {
			$extra = call_user_func( $spec['public'], $field );

			if ( is_array( $extra ) ) {
				$data = array_merge( $data, $extra );
			}
		}

		return $data;
	}

	/**
	 * The enabled fields our own block renders, in order.
	 *
	 * @return FieldDefinition[]
	 */
	public function fields(): array {
		return array_values(
			array_filter(
				$this->renderable(),
				static function ( FieldDefinition $field ): bool {
					return ! $field->is_core_backed();
				}
			)
		);
	}

	/**
	 * The enabled fields this store may render at all.
	 *
	 * Everything the payload carries is read from here, so a field whose type
	 * nothing answers for is never written into the page the shopper loads:
	 * there would be no control to draw it with and no rules to check it
	 * against.
	 *
	 * @return FieldDefinition[]
	 */
	private function renderable(): array {
		return array_values(
			array_filter(
				$this->config->fields()->enabled(),
				static function ( FieldDefinition $field ): bool {
					return $field->is_available();
				}
			)
		);
	}

	/**
	 * The enabled core-backed fields WooCommerce renders as a plain text box but
	 * the shopper should get a real email, phone, number or url input for.
	 *
	 * @return FieldDefinition[]
	 */
	public function typed_core_fields(): array {
		$typed = array( FieldDefinition::TYPE_EMAIL, FieldDefinition::TYPE_PHONE, FieldDefinition::TYPE_NUMBER, FieldDefinition::TYPE_URL );

		return array_values(
			array_filter(
				$this->renderable(),
				static function ( FieldDefinition $field ) use ( $typed ): bool {
					return in_array( $field->type(), $typed, true );
				}
			)
		);
	}

	/**
	 * What the build wrote alongside the bundle, or null when there is no build
	 * to read — a checkout of a repository nobody has run `npm run build` in.
	 *
	 * @return array<string, mixed>|null
	 */
	private function asset(): ?array {
		$asset_file = CBWB_DIR . 'build/checkout.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return null;
		}

		$asset = require $asset_file;

		return is_array( $asset ) ? $asset : null;
	}

	/**
	 * The cache-buster the script and the stylesheet share: they are built from
	 * the same sources, so they change together.
	 *
	 * @param array<string, mixed> $asset Build metadata.
	 * @return string
	 */
	private function version( array $asset ): string {
		return isset( $asset['version'] ) ? (string) $asset['version'] : CBWB_VERSION;
	}

	/**
	 * Values remembered against the signed-in customer, keyed by field id.
	 *
	 * @param FieldDefinition[] $fields Fields being rendered.
	 * @return array<string, string>
	 */
	private function prefill( array $fields ): array {
		$user_id = get_current_user_id();
		if ( $user_id <= 0 ) {
			return array();
		}

		$prefill = array();

		foreach ( $fields as $field ) {
			if ( ! $field->saves_to_profile() ) {
				continue;
			}
			$value = RichValues::customer_value( $user_id, $field );
			if ( '' !== $value ) {
				$prefill[ $field->id() ] = $value;
			}
		}

		return $prefill;
	}

	/**
	 * Strings the bundle shows without a round trip to the server.
	 *
	 * @return array<string, string>
	 */
	public static function strings(): array {
		return array(
			'required'      => __( 'This field is required.', 'fieldwright-checkout-fields' ),
			'invalidOption' => __( 'Choose one of the available options.', 'fieldwright-checkout-fields' ),
			'tooLong'       => __( 'This value is too long.', 'fieldwright-checkout-fields' ),
			'outOfRange'    => __( 'Choose a value within the allowed range.', 'fieldwright-checkout-fields' ),
			'optional'      => __( '(optional)', 'fieldwright-checkout-fields' ),

			/*
			 * The two shapes a value can arrive in that no picker could have
			 * produced. `RichValues::validate()` refuses both of them whether or
			 * not the field had to be answered, so the bundle refuses them too,
			 * and word for word: a customer must not be told one thing while
			 * they are typing and another when they press the button. A
			 * registered type ships its own wording, through its `public`
			 * payload or its add-on's own bootstrap data.
			 */
			/* translators: %s: field label. */
			'invalidDate'   => __( 'Enter a date for %s in YYYY-MM-DD form.', 'fieldwright-checkout-fields' ),
			/* translators: %s: field label. */
			'invalidTime'   => __( 'Enter a time for %s in HH:MM form.', 'fieldwright-checkout-fields' ),
			/* translators: %d: a number of years. */
			'tooYoung'      => __( 'You have to be at least %d years old.', 'fieldwright-checkout-fields' ),
		);
	}

	/**
	 * Whether the current request renders the block checkout.
	 *
	 * @return bool
	 */
	private function is_checkout(): bool {
		if ( function_exists( 'is_checkout' ) && is_checkout() ) {
			return true;
		}

		return function_exists( 'has_block' ) && has_block( 'woocommerce/checkout' );
	}
}
