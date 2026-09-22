<?php
/**
 * Plugin Name:          Fieldwright Checkout Fields for WooCommerce
 * Plugin URI:           https://fieldwright.methodicalstudio.com/
 * Description:          Add checkout fields and control WooCommerce's own fields on the Checkout block, with no code.
 * Version:              1.2.1
 * Requires at least:    6.9
 * Requires PHP:         7.4
 * Requires Plugins:     woocommerce
 * WC requires at least: 10.0
 * WC tested up to:      11.1
 * Author:               Methodical
 * Author URI:           https://methodicalstudio.com
 * License:              GPL-2.0-or-later
 * License URI:          https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:          fieldwright-checkout-fields
 * Domain Path:          /languages
 *
 * @package CheckoutBuilder
 */

defined( 'ABSPATH' ) || exit;

// Already loaded (e.g. a second copy of the plugin).
if ( defined( 'CBWB_VERSION' ) ) {
	return;
}

define( 'CBWB_VERSION', '1.2.1' );
define( 'CBWB_FILE', __FILE__ );
define( 'CBWB_DIR', plugin_dir_path( __FILE__ ) );
define( 'CBWB_URL', plugin_dir_url( __FILE__ ) );
define( 'CBWB_SLUG', 'fieldwright-checkout-fields' );

/**
 * Minimal PSR-4 autoloader for the CheckoutBuilder namespace.
 *
 * Kept dependency-free so the distributed plugin ships no vendor directory.
 *
 * @param string $class_name Fully-qualified class name.
 */
function cbwb_autoload( string $class_name ): void {
	$prefix = 'CheckoutBuilder\\';
	if ( 0 !== strpos( $class_name, $prefix ) ) {
		return;
	}
	$relative = str_replace( '\\', '/', substr( $class_name, strlen( $prefix ) ) );
	$file     = CBWB_DIR . 'includes/' . $relative . '.php';
	if ( is_readable( $file ) ) {
		require $file;
	}
}
spl_autoload_register( 'cbwb_autoload' );

// Declare compatibility with block checkout and HPOS before WooCommerce inspects plugins.
add_action(
	'before_woocommerce_init',
	static function (): void {
		if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', __FILE__, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
		}
	}
);

register_activation_hook( __FILE__, array( \CheckoutBuilder\Plugin::class, 'activate' ) );

add_action( 'plugins_loaded', array( \CheckoutBuilder\Plugin::class, 'boot' ), 5 );
