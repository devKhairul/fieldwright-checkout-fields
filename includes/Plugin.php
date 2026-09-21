<?php
/**
 * Plugin bootstrap.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder;

use CheckoutBuilder\Admin\Page;
use CheckoutBuilder\Blocks\RichFields;
use CheckoutBuilder\Checkout\Assets as CheckoutAssets;
use CheckoutBuilder\Checkout\Extensions;
use CheckoutBuilder\Fields\CoreFields;
use CheckoutBuilder\Fields\Registrar;
use CheckoutBuilder\I18n\Strings;
use CheckoutBuilder\Orders\AdminMetaBox;
use CheckoutBuilder\Orders\Emails;
use CheckoutBuilder\Orders\Frontend;
use CheckoutBuilder\Privacy\PersonalData;
use CheckoutBuilder\Rest\CompatibilityController;
use CheckoutBuilder\Rest\ConfigController;
use CheckoutBuilder\Rest\ProLineController;
use CheckoutBuilder\Rest\SettingsController;

defined( 'ABSPATH' ) || exit;

/**
 * Wires the plugin together. One instance per request.
 */
final class Plugin {

	/**
	 * Minimum WooCommerce version the plugin supports.
	 */
	public const MIN_WC_VERSION = '10.0';

	/**
	 * Singleton instance.
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Config repository.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * The builder screen, on admin requests only.
	 *
	 * @var Page|null
	 */
	private $admin_page = null;

	/**
	 * Retrieve the running instance (null before boot).
	 *
	 * @return Plugin|null
	 */
	public static function instance(): ?Plugin {
		return self::$instance;
	}

	/**
	 * Entry point on plugins_loaded.
	 */
	public static function boot(): void {
		if ( null !== self::$instance ) {
			return;
		}
		if ( ! self::woocommerce_is_supported() ) {
			add_action( 'admin_notices', array( self::class, 'render_requirements_notice' ) );
			return;
		}
		self::$instance = new self();
		self::$instance->register_hooks();

		/**
		 * Fires once the plugin is running and its own hooks are attached.
		 *
		 * Add-ons boot from here rather than racing `plugins_loaded`: reaching
		 * this point already means WooCommerce is present and supported, and
		 * that every extension point below is in place.
		 *
		 * @since 1.0.0
		 *
		 * @param Plugin $plugin The running plugin instance.
		 */
		do_action( 'cbwb_loaded', self::$instance );
	}

	/**
	 * Activation: seed default config. Never fatals if WooCommerce is absent —
	 * the admin notice handles that on the next request.
	 */
	public static function activate(): void {
		Config::install_defaults();
	}

	/**
	 * Whether a supported WooCommerce version is active.
	 *
	 * @return bool
	 */
	public static function woocommerce_is_supported(): bool {
		if ( ! defined( 'WC_VERSION' ) ) {
			return false;
		}
		return version_compare( WC_VERSION, self::MIN_WC_VERSION, '>=' );
	}

	/**
	 * Admin notice shown when WooCommerce is missing or too old.
	 */
	public static function render_requirements_notice(): void {
		if ( ! current_user_can( 'activate_plugins' ) ) {
			return;
		}
		printf(
			'<div class="notice notice-error"><p>%s</p></div>',
			esc_html(
				sprintf(
					/* translators: %s: minimum WooCommerce version. */
					__( 'Fieldwright requires WooCommerce %s or newer to be installed and active.', 'fieldwright-checkout-fields' ),
					self::MIN_WC_VERSION
				)
			)
		);
	}

	/**
	 * Constructor.
	 */
	private function __construct() {
		$this->config = new Config();
	}

	/**
	 * Config repository accessor.
	 *
	 * @return Config
	 */
	public function config(): Config {
		return $this->config;
	}

	/**
	 * The builder screen, or null on a request that is not an admin one.
	 *
	 * Exposed so an add-on can ask which hook suffix WordPress gave our page —
	 * `$page->hook_suffix()` — rather than guessing at the screen from the query
	 * string, which is not capability-checked. The hook is only ever set when
	 * `add_submenu_page()` accepted the page, which needs `manage_woocommerce`.
	 *
	 * @since 1.0.0
	 *
	 * @return Page|null
	 */
	public function admin_page(): ?Page {
		return $this->admin_page;
	}

	/**
	 * Attach WordPress hooks.
	 */
	private function register_hooks(): void {
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );

		// WooCommerce's own checkout fields: relabelled, hidden, made optional
		// and reordered. Attached on every request type, because the merchant's
		// changes have to reach the browser, the Store API and the builder's own
		// preview alike, and because the address order it owns is what our
		// fields are registered against below.
		$core = new CoreFields( $this->config );
		$core->register();

		// Merchant-entered strings, handed to WPML and Polylang on every save
		// and read back translated on the checkout. Attached before the field
		// registration below, because the labels it hands WooCommerce come
		// through here.
		( new Strings( $this->config ) )->register();

		// The types WooCommerce's own API can carry.
		( new Registrar( $this->config, $core ) )->register();

		// Everything else: our block, our Store API namespace, our storage.
		( new RichFields( $this->config ) )->register();
		( new Extensions( $this->config ) )->register();

		// Display surfaces. Emails are sent from the front end, the admin and
		// cron alike, so neither of these is conditional on the request type.
		( new Emails( $this->config ) )->register();
		( new Frontend( $this->config ) )->register();

		// Export and erasure. Requests are worked through by cron as well as from
		// the admin screens, so this is not conditional on the request type either.
		( new PersonalData( $this->config ) )->register();

		if ( is_admin() ) {
			$this->admin_page = new Page( $this->config );
			$this->admin_page->register();

			( new AdminMetaBox( $this->config ) )->register();

			return;
		}

		// The checkout bundle: enqueued on the checkout, and declared to
		// WooCommerce as a block integration so its own checkout script depends
		// on ours and ours therefore runs first. Nothing our block renders
		// appears without that ordering — see Checkout\Integration.
		( new CheckoutAssets( $this->config ) )->register();
	}

	/**
	 * Register REST controllers.
	 */
	public function register_rest_routes(): void {
		( new ConfigController( $this->config ) )->register_routes();
		( new SettingsController( $this->config ) )->register_routes();
		( new CompatibilityController() )->register_routes();
		( new ProLineController() )->register_routes();
	}
}
