/**
 * The sliver of `@woocommerce/blocks-checkout` the two checkout bundles use.
 *
 * The package is never installed: webpack maps it to the `wc.blocksCheckout`
 * global (see webpack.config.js), and WooCommerce ships the implementation. So
 * the only thing TypeScript needs is the shape of what it hands back.
 *
 * It lives in Free rather than beside the bundle that uses each export because
 * an ambient module may only declare a name once across the whole program, and
 * both plugins compile as one — the same reason Pro takes its field types from
 * `@free/admin/types`.
 */
declare module '@woocommerce/blocks-checkout' {
	import type { ComponentType } from 'react';

	export interface ExtensionCartUpdateArgs {
		/** Namespace the server registered its update callback under. */
		namespace: string;
		data?: unknown;
		/** False leaves any address the shopper is mid-way through editing alone. */
		overwriteDirtyCustomerData?: boolean;
	}

	export function extensionCartUpdate(
		args: ExtensionCartUpdateArgs
	): Promise< unknown >;

	/**
	 * What a checkout block tells WooCommerce about itself.
	 *
	 * `parent` must name at least one of WooCommerce's own inner block areas or
	 * `registerCheckoutBlock` throws; see `innerBlockAreas` in
	 * `wc-cart-checkout-base-frontend.js`.
	 */
	export interface CheckoutBlockMetadata {
		name: string;
		parent: string[];
		attributes?: Record< string, unknown >;
	}

	/**
	 * Props a checkout block component is handed.
	 *
	 * WooCommerce spreads the wrapper element's whole `dataset` onto the
	 * component — every `data-*` attribute arrives as its own camel-cased prop,
	 * always a string — so the true type is "an object of unknown things", and
	 * a component has to narrow what it reads. See `src/checkout/Field.tsx`.
	 */
	export type CheckoutBlockProps = Record< string, unknown >;

	export interface CheckoutBlockOptions {
		metadata: CheckoutBlockMetadata;
		component: ComponentType< CheckoutBlockProps >;
		/**
		 * Renders the block in each parent area that has no saved child of this
		 * name — with no props at all. Defaults to
		 * `metadata.attributes.lock.default.remove`.
		 */
		force?: boolean;
	}

	export function registerCheckoutBlock( options: CheckoutBlockOptions ): void;
}
