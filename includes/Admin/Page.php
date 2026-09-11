<?php
/**
 * Admin page.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Admin;

use CheckoutBuilder\Blocks\RichFields;
use CheckoutBuilder\Config;
use CheckoutBuilder\Fields\AutocompleteTokens;
use CheckoutBuilder\Fields\CoreFields;
use CheckoutBuilder\Fields\FieldCollection;
use CheckoutBuilder\Fields\FieldDefinition;
use CheckoutBuilder\Fields\FormatPresets;
use CheckoutBuilder\Fields\Templates;
use CheckoutBuilder\Fields\TypeRegistry;
use CheckoutBuilder\Rest\CompatibilityController;
use CheckoutBuilder\Rest\ConfigController;
use CheckoutBuilder\Rest\SettingsController;

defined( 'ABSPATH' ) || exit;

/**
 * Registers the WooCommerce → Fieldwright screen and its React app.
 */
final class Page {

	public const MENU_SLUG = 'cbwb-fieldwright-checkout-fields';
	public const ROOT_ID   = 'cbwb-admin-root';

	/**
	 * Config repository.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * Hook suffix returned by add_submenu_page().
	 *
	 * @var string|false
	 */
	private $hook = false;

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
		add_action( 'admin_menu', array( $this, 'add_menu' ), 60 );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );
	}

	/**
	 * Hook suffix of the registered screen, or null before admin_menu ran.
	 *
	 * @return string|null
	 */
	public function hook_suffix(): ?string {
		return false === $this->hook ? null : $this->hook;
	}

	/**
	 * Add the submenu under WooCommerce.
	 */
	public function add_menu(): void {
		$this->hook = add_submenu_page(
			'woocommerce',
			// The browser title carries the plugin's full name; the menu entry
			// stays short, as WooCommerce's own do.
			__( 'Fieldwright', 'fieldwright-checkout-fields' ),
			__( 'Fieldwright', 'fieldwright-checkout-fields' ),
			'manage_woocommerce',
			self::MENU_SLUG,
			array( $this, 'render' )
		);
	}

	/**
	 * Enqueue the admin app on our screen only.
	 *
	 * @param string $hook_suffix Current admin page hook.
	 */
	public function enqueue( string $hook_suffix ): void {
		if ( false === $this->hook || $hook_suffix !== $this->hook ) {
			return;
		}

		$asset_file = CBWB_DIR . 'build/admin.asset.php';
		// Build artifacts missing; the render() fallback explains.
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = require $asset_file;
		if ( ! is_array( $asset ) ) {
			return;
		}

		$version = isset( $asset['version'] ) && is_scalar( $asset['version'] ) ? (string) $asset['version'] : CBWB_VERSION;

		wp_enqueue_script(
			'cbwb-admin',
			CBWB_URL . 'build/admin.js',
			isset( $asset['dependencies'] ) && is_array( $asset['dependencies'] ) ? $asset['dependencies'] : array(),
			$version,
			true
		);
		wp_set_script_translations( 'cbwb-admin', 'fieldwright-checkout-fields', CBWB_DIR . 'languages' );

		if ( file_exists( CBWB_DIR . 'build/style-admin.css' ) ) {
			wp_enqueue_style( 'cbwb-admin', CBWB_URL . 'build/style-admin.css', array( 'wp-components' ), $version );
			wp_style_add_data( 'cbwb-admin', 'rtl', 'replace' );
		} else {
			wp_enqueue_style( 'wp-components' );
		}

		// The builder's live preview reuses WooCommerce's own block markup, so it
		// needs WooCommerce's block stylesheets to look like the real checkout.
		// `wc-blocks-style` carries the shared components; the checkout step and
		// form styles live in the separate `wc-blocks-style-checkout` handle.
		foreach ( array( 'wc-blocks-style', 'wc-blocks-style-checkout' ) as $handle ) {
			if ( wp_style_is( $handle, 'registered' ) ) {
				wp_enqueue_style( $handle );
			}
		}

		// HEX flags keep any stored string from terminating the inline <script>.
		wp_add_inline_script(
			'cbwb-admin',
			'window.cbwbAdmin = ' . wp_json_encode( $this->bootstrap_data(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ) . ';',
			'before'
		);
	}

	/**
	 * Everything the admin app needs before its first render.
	 *
	 * @return array<string, mixed>
	 */
	public function bootstrap_data(): array {
		$core = new CoreFields( $this->config );

		$data = array(
			'version'                   => CBWB_VERSION,
			'restRoute'                 => ConfigController::NAMESPACE . ConfigController::ROUTE,
			'settingsRoute'             => SettingsController::NAMESPACE . SettingsController::ROUTE,
			// The migration assistant scans on demand: the admin app calls this
			// route (and `<route>/draft-page`) only when the merchant opens it.
			'compatibilityRoute'        => CompatibilityController::NAMESPACE . CompatibilityController::ROUTE,
			'config'                    => $this->config->get(),
			'settings'                  => $this->config->settings(),
			'idPrefix'                  => FieldDefinition::ID_PREFIX,
			'locations'                 => self::locations(),
			'placements'                => self::placements(),
			'types'                     => self::types(),
			'formatPresets'             => FormatPresets::all(),
			'autocompleteTokens'        => AutocompleteTokens::all(),
			'templates'                 => Templates::all(),
			// WooCommerce's own checkout fields, in its order, with what the
			// merchant has changed already applied — `resolvedLabel`, `required`
			// and `hidden` are what a shopper in the base country would see.
			'coreFields'                => $core->rows(),
			'corePseudo'                => array(
				CoreFields::PSEUDO_ORDER_NOTE  => array( 'hidden' => $core->pseudo_is_hidden( CoreFields::PSEUDO_ORDER_NOTE ) ),
				CoreFields::PSEUDO_COUPON_FORM => array( 'hidden' => $core->pseudo_is_hidden( CoreFields::PSEUDO_COUPON_FORM ) ),
			),
			'baseCountry'               => $core->base_country(),
			// The country by name, for the sentence the code alone cannot fill:
			// "in US" reads as a typo where "in United States (US)" reads as the
			// store's own setting.
			'baseCountryLabel'          => $core->base_country_label(),
			// What WooCommerce itself calls a field in the base country, so the
			// builder can explain a name the merchant did not choose ("shows as
			// ZIP Code in the United States") rather than leave it looking broken.
			'baseCountryLabelOverrides' => $core->base_country_label_overrides(),
			'gatewayWarningKeys'        => CoreFields::GATEWAY_WARNING_KEYS,
			// WooCommerce's own "Shipping destination" setting, surfaced rather
			// than duplicated: forcing billing to match shipping is its switch.
			'shipToDestination'         => (string) get_option( 'woocommerce_ship_to_destination', 'billing' ),
			'wcShippingSettingsUrl'     => admin_url( 'admin.php?page=wc-settings&tab=shipping&section=options' ),
			'checkoutUrl'               => function_exists( 'wc_get_checkout_url' ) ? wc_get_checkout_url() : '',
			// The site's own date format, from Settings → General. Anything the
			// builder writes a date into — a blocked date on a date field, say —
			// writes it the way the rest of this site writes dates, rather than
			// as the `YYYY-MM-DD` the browser's picker hands back.
			'dateFormat'                => (string) get_option( 'date_format', 'F j, Y' ),
			// Its twin for a clock time, so a slot the preview draws reads
			// "9:00 am" on a store that writes times that way, as the checkout
			// and the order will.
			'timeFormat'                => (string) get_option( 'time_format', 'g:i a' ),
			'maxFields'                 => FieldCollection::MAX_FIELDS,
			// Prefilled on new dropdowns, so core never falls back to its own
			// "Select a <label> (optional)" placeholder.
			'selectPlaceholderDefault'  => __( 'Choose an option', 'fieldwright-checkout-fields' ),
			// Things that went wrong out on the checkout, where nobody was
			// watching. Shown as a notice above the builder.
			'warnings'                  => $this->warnings(),
		);

		/**
		 * Filters the data the admin app receives before its first render.
		 *
		 * Inlined into the page as `window.cbwbAdmin`, so everything here has to
		 * survive `wp_json_encode()`. Add-ons that ship their own admin bundle
		 * should prefer their own global over crowding this one; use this filter
		 * for values the Free app itself has to react to.
		 *
		 * @since 1.0.0
		 *
		 * @param array<string, mixed> $data Bootstrap data.
		 */
		$filtered = apply_filters( 'cbwb_admin_bootstrap_data', $data );

		return is_array( $filtered ) ? $filtered : $data;
	}

	/**
	 * Problems the merchant cannot see from here, because they happened on the
	 * checkout rather than in the builder.
	 *
	 * Two, today. A format pattern that compiled at save time and then failed
	 * while matching a real value — a catastrophically backtracking pattern, or
	 * invalid UTF-8. `FormatPresets::matches()` fails closed on that, which is
	 * the safe answer but also means the field rejects a value the customer
	 * cannot fix, so the merchant has to be told. And a placement whose anchor
	 * block was not on the rendered checkout, which sent its fields to the end
	 * of the form instead.
	 *
	 * @return array<int, string>
	 */
	private function warnings(): array {
		$warnings = array();

		foreach ( $this->config->fields()->all() as $field ) {
			$pattern = $field->effective_pattern();
			if ( null === $pattern || ! FormatPresets::had_error( $pattern ) ) {
				continue;
			}

			$warnings[] = sprintf(
				/* translators: %s: field label. */
				__( 'The format rule for “%s” caused a regular expression error at checkout; customers may be blocked from ordering until you change it.', 'fieldwright-checkout-fields' ),
				$field->label()
			);
		}

		$labels = wp_list_pluck( self::placements(), 'label', 'key' );
		$placed = ( new RichFields( $this->config ) )->grouped_fields();

		foreach ( array_keys( $labels ) as $placement ) {
			$placement = (string) $placement;

			if ( ! RichFields::had_miss( $placement ) ) {
				continue;
			}

			// The flag outlives the config it was recorded against, so a
			// merchant who answered the warning by moving the fields somewhere
			// else would otherwise keep reading it. Clear it instead of
			// repeating it.
			if ( empty( $placed[ $placement ] ) ) {
				RichFields::clear_miss( $placement );
				continue;
			}

			$warnings[] = sprintf(
				/* translators: %s: placement name, e.g. "Before the place order button". */
				__( 'The “%s” position is not on your checkout page, so fields placed there were shown at the end of the checkout form instead.', 'fieldwright-checkout-fields' ),
				$labels[ $placement ]
			);
		}//end foreach

		return $warnings;
	}

	/**
	 * Checkout locations, described in the merchant's terms.
	 *
	 * Where the answer ends up is a sentence of its own rather than the tail of
	 * the description, because it is only true of the fields that collect an
	 * answer: a heading placed in Contact is saved nowhere at all. The builder
	 * appends it for the types that store something and leaves it off for the
	 * ones that do not, which it can only do while the two are separate strings.
	 *
	 * @return array<int, array{key: string, label: string, description: string, storage?: string}>
	 */
	private static function locations(): array {
		return array(
			array(
				'key'         => FieldDefinition::LOCATION_CONTACT,
				'label'       => __( 'Contact', 'fieldwright-checkout-fields' ),
				'description' => __( 'Shown at the top of checkout, next to the email address.', 'fieldwright-checkout-fields' ),
				'storage'     => __( "Saved to the customer's account.", 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::LOCATION_ADDRESS,
				'label'       => __( 'Address', 'fieldwright-checkout-fields' ),
				'description' => __( 'Shown inside both the shipping and billing address forms.', 'fieldwright-checkout-fields' ),
				'storage'     => __( "Saved to the customer's address book.", 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::LOCATION_ORDER,
				'label'       => __( 'Order information', 'fieldwright-checkout-fields' ),
				'description' => __( 'Shown in the Additional order information section, above the payment methods.', 'fieldwright-checkout-fields' ),
				'storage'     => __( 'Saved on the order only.', 'fieldwright-checkout-fields' ),
			),
		);
	}

	/**
	 * Every place a field can go, described in the merchant's terms.
	 *
	 * The first three are WooCommerce's own field locations, and the only ones a
	 * core-backed type can use. The rest are positions on the checkout page that
	 * only the fields we render ourselves can reach.
	 *
	 * Only the first three carry a `storage` sentence, because only they name a
	 * place an answer is remembered. The rest describe a position on the page,
	 * and have never said anything about where the answer goes.
	 *
	 * @return array<int, array{key: string, label: string, description: string, storage?: string}>
	 */
	private static function placements(): array {
		$placements = self::locations();

		// The two address forms, one at a time. Listed next to Address, because
		// the choice a merchant is making here is which of the two forms the
		// field belongs in, and directly after it, because that is the order the
		// fields come out in when both positions are used.
		array_splice(
			$placements,
			2,
			0,
			array(
				array(
					'key'         => FieldDefinition::LOCATION_SHIPPING_ADDRESS,
					'label'       => __( 'Shipping address', 'fieldwright-checkout-fields' ),
					'description' => __( "Shown only in the shipping address form, after WooCommerce's own fields. A required field here is only required when that form is shown.", 'fieldwright-checkout-fields' ),
				),
				array(
					'key'         => FieldDefinition::LOCATION_BILLING_ADDRESS,
					'label'       => __( 'Billing address', 'fieldwright-checkout-fields' ),
					'description' => __( "Shown only in the billing address form, after WooCommerce's own fields. A required field here is only required when that form is shown.", 'fieldwright-checkout-fields' ),
				),
			)
		);

		$placements[] = array(
			'key'         => FieldDefinition::LOCATION_AFTER_SHIPPING,
			'label'       => __( 'After shipping options', 'fieldwright-checkout-fields' ),
			'description' => __( 'Below the list of shipping methods, where a question about the delivery belongs.', 'fieldwright-checkout-fields' ),
		);
		$placements[] = array(
			'key'         => FieldDefinition::LOCATION_AFTER_PAYMENT,
			'label'       => __( 'After payment options', 'fieldwright-checkout-fields' ),
			'description' => __( 'Below the payment methods, before the order notes.', 'fieldwright-checkout-fields' ),
		);
		$placements[] = array(
			'key'         => FieldDefinition::LOCATION_BEFORE_PLACE_ORDER,
			'label'       => __( 'Before the Place order button', 'fieldwright-checkout-fields' ),
			'description' => __( 'The last thing the customer reads before they pay.', 'fieldwright-checkout-fields' ),
		);
		$placements[] = array(
			'key'         => FieldDefinition::LOCATION_ORDER_SUMMARY,
			'label'       => __( 'Order summary', 'fieldwright-checkout-fields' ),
			'description' => __( 'Inside the summary panel beside the form, under the totals.', 'fieldwright-checkout-fields' ),
		);

		return $placements;
	}

	/**
	 * Field types, described in the merchant's terms.
	 *
	 * `family` says who carries the field: `core` is WooCommerce's own
	 * Additional Checkout Fields API, `rich` is our checkout block and our
	 * storage, and `content` is decoration with no value at all.
	 *
	 * `available` says whether a field of the type reaches the checkout today.
	 * Every type an add-on registered is listed whatever the answer, because
	 * the builder has to be able to edit a field of it either way; one that is
	 * not available is drawn as a type waiting on its add-on rather than
	 * offered as something to add.
	 *
	 * @return array<int, array{key: string, label: string, description: string, family: string, placements: string[], available: bool}>
	 */
	private static function types(): array {
		$types = array(
			array(
				'key'         => FieldDefinition::TYPE_TEXT,
				'label'       => __( 'Text', 'fieldwright-checkout-fields' ),
				'description' => __( 'A single-line text box, with optional format and length rules.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_EMAIL,
				'label'       => __( 'Email address', 'fieldwright-checkout-fields' ),
				'description' => __( 'A text box that only accepts an email address, with the right keyboard on a phone.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_PHONE,
				'label'       => __( 'Phone number', 'fieldwright-checkout-fields' ),
				'description' => __( 'A text box that only accepts a phone number, with the dial pad on a phone.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_NUMBER,
				'label'       => __( 'Number', 'fieldwright-checkout-fields' ),
				'description' => __( 'A number, with an optional smallest and largest value.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_URL,
				'label'       => __( 'Web address', 'fieldwright-checkout-fields' ),
				'description' => __( 'A link, which has to start with http:// or https://.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_SELECT,
				'label'       => __( 'Dropdown', 'fieldwright-checkout-fields' ),
				'description' => __( 'A list of options the customer picks one of.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_CHECKBOX,
				'label'       => __( 'Checkbox', 'fieldwright-checkout-fields' ),
				'description' => __( 'A single yes/no tick box, for consent and opt-ins.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_TEXTAREA,
				'label'       => __( 'Long text', 'fieldwright-checkout-fields' ),
				'description' => __( 'A multi-line box, for gift messages and delivery instructions.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_RADIO,
				'label'       => __( 'Radio buttons', 'fieldwright-checkout-fields' ),
				'description' => __( 'The same choice as a dropdown, with every option visible at once.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_CHECKBOX_GROUP,
				'label'       => __( 'Checkbox group', 'fieldwright-checkout-fields' ),
				'description' => __( 'A list the customer can tick more than one of.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_DATE,
				'label'       => __( 'Date', 'fieldwright-checkout-fields' ),
				'description' => __( 'A date picker, with an optional earliest and latest date.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_TIME,
				'label'       => __( 'Time', 'fieldwright-checkout-fields' ),
				'description' => __( 'A time picker, with an optional earliest and latest time.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_HEADING,
				'label'       => __( 'Heading', 'fieldwright-checkout-fields' ),
				'description' => __( 'A title that breaks the checkout into sections. Nothing is asked or stored.', 'fieldwright-checkout-fields' ),
			),
			array(
				'key'         => FieldDefinition::TYPE_PARAGRAPH,
				'label'       => __( 'Paragraph', 'fieldwright-checkout-fields' ),
				'description' => __( 'A note to the customer. Nothing is asked or stored.', 'fieldwright-checkout-fields' ),
			),
		);

		$catalogue = array_map(
			static function ( array $type ): array {
				$type['family']     = FieldDefinition::family_for( $type['key'] );
				$type['placements'] = FieldDefinition::locations_for( $type['key'] );
				$type['available']  = true;
				return $type;
			},
			$types
		);

		// An add-on's own types, after ours and in the order they registered.
		// The family is always `rich`, because that is the only arrangement an
		// add-on can register a type under: Fieldwright draws it with its
		// own block and stores it under its own key.
		foreach ( TypeRegistry::all() as $key => $spec ) {
			$catalogue[] = array(
				'key'         => $key,
				'label'       => (string) $spec['label'],
				'description' => (string) $spec['description'],
				'family'      => FieldDefinition::FAMILY_RICH,
				'placements'  => $spec['placements'],
				'available'   => (bool) $spec['checkout'],
			);
		}

		return $catalogue;
	}

	/**
	 * Output the React mount point.
	 */
	public function render(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'fieldwright-checkout-fields' ) );
		}
		echo '<div class="wrap" id="' . esc_attr( self::ROOT_ID ) . '">';
		if ( ! file_exists( CBWB_DIR . 'build/admin.asset.php' ) ) {
			echo '<p>' . esc_html__( 'The admin app has not been built. Run "npm run build" in the plugin directory.', 'fieldwright-checkout-fields' ) . '</p>';
		}
		echo '</div>';
	}
}
