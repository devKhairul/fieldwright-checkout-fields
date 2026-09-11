/**
 * The sliver of `@woocommerce/block-data` the two checkout bundles use.
 *
 * Like `@woocommerce/blocks-checkout`, the package is never installed: webpack
 * maps it to the `wc.wcBlocksData` global and the `wc-blocks-data-store` script
 * handle (see webpack.config.js), and WooCommerce ships the implementation. So
 * the only thing TypeScript needs is the shape of what it exports.
 *
 * The keys are the names the data stores are registered under —
 * `wc/store/checkout`, `wc/store/cart` and `wc/store/validation` as of
 * WooCommerce 11.0.1 — but they are WooCommerce's to change, which is the
 * reason for importing them.
 */
declare module '@woocommerce/block-data' {
	/** Store key for the block checkout's own data store. */
	export const CHECKOUT_STORE_KEY: string;

	/** Store key for the cart data store. */
	export const CART_STORE_KEY: string;

	/** Store key for the store that holds the checkout's validation errors. */
	export const VALIDATION_STORE_KEY: string;
}
