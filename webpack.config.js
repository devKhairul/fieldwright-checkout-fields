/**
 * Build for this plugin on its own.
 *
 * The private monorepo this plugin is developed in builds it and the paid add-on
 * from one config at the repository root. This file is the same thing for the
 * public copy: the same `@wordpress/scripts` defaults, the same two entry points
 * and the same dependency-extraction rules, so `npm run build` here writes the
 * `build/` directory that ships in the zip.
 */

const path = require( 'path' );
const defaultConfig = require( '@wordpress/scripts/config/webpack.config' );
const DependencyExtractionWebpackPlugin = require( '@wordpress/dependency-extraction-webpack-plugin' );

/**
 * `@wordpress/icons` is not a registered script handle on every WordPress
 * version we support, so it must be bundled rather than externalised.
 * Returning `false` (not `undefined`) stops the default rules from claiming it.
 *
 * @param {string} request Module request.
 * @return {string|string[]|false|undefined} External definition, or false to bundle.
 */
function requestToExternal( request ) {
	if ( '@wordpress/icons' === request ) {
		return false;
	}
	return undefined;
}

/**
 * The WooCommerce Blocks packages the checkout bundle imports, each with the
 * global it is published under and the script handle that provides it.
 *
 * WooCommerce ships its own globals and handles rather than `wp-` ones, and the
 * default extraction rules know nothing about them — so a package left out of
 * this map is bundled silently and its handle never reaches the asset file.
 * WooCommerce then reports the access as undeclared (see its
 * `DependencyDetection`), which is exactly the warning this map prevents.
 *
 * @type {Record<string, {global: string[], handle: string}>}
 */
const WC_EXTERNALS = {
	'@woocommerce/blocks-checkout': {
		global: [ 'wc', 'blocksCheckout' ],
		handle: 'wc-blocks-checkout',
	},
	'@woocommerce/blocks-components': {
		global: [ 'wc', 'blocksComponents' ],
		handle: 'wc-blocks-components',
	},
	'@woocommerce/block-data': {
		global: [ 'wc', 'wcBlocksData' ],
		handle: 'wc-blocks-data-store',
	},
};

/**
 * The checkout bundle talks to WooCommerce Blocks, which ships its own globals
 * and script handles rather than `wp-` ones.
 *
 * @param {string} request Module request.
 * @return {string|string[]|false|undefined} External definition, or false to bundle.
 */
function checkoutRequestToExternal( request ) {
	if ( WC_EXTERNALS[ request ] ) {
		return WC_EXTERNALS[ request ].global;
	}
	return requestToExternal( request );
}

/**
 * The script handles that provide those globals, so they land in
 * `checkout.asset.php` and the enqueue gets its dependencies for free.
 *
 * @param {string} request Module request.
 * @return {string|undefined} Script handle, or undefined for the defaults.
 */
function checkoutRequestToHandle( request ) {
	if ( WC_EXTERNALS[ request ] ) {
		return WC_EXTERNALS[ request ].handle;
	}
	return undefined;
}

module.exports = {
	...defaultConfig,
	entry: {
		admin: path.join( __dirname, 'src/admin.tsx' ),
		checkout: path.join( __dirname, 'src/checkout.ts' ),
	},
	output: {
		...defaultConfig.output,
		path: path.join( __dirname, 'build' ),
	},
	plugins: [
		...defaultConfig.plugins.filter(
			( plugin ) =>
				! ( plugin instanceof DependencyExtractionWebpackPlugin )
		),
		new DependencyExtractionWebpackPlugin( {
			requestToExternal: checkoutRequestToExternal,
			requestToHandle: checkoutRequestToHandle,
		} ),
	],
};
