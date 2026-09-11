/**
 * Telling WooCommerce about `cbwb/field`.
 *
 * ## What registration actually buys us
 *
 * Two separate things, and it is worth being precise about which is which —
 * measured against WooCommerce 11.0.1.
 *
 * 1. `registerCheckoutBlock` calls `registerBlockComponent({ blockName,
 *    component })` with no `context`, which defaults to `'any'`. The checkout's
 *    renderer then builds its map with `getRegisteredBlockComponents(
 *    'woocommerce/checkout' )`, which returns `{ ...byContext[ name ],
 *    ...byContext.any }` — so the component is in the map for the whole
 *    checkout, whatever `parent` says. **This** is what makes a
 *    `<div data-block-name="cbwb/field">` in the server's markup render as our
 *    component: the renderer looks the name up in that map.
 *
 * 2. `force` is a different mechanism entirely. After rendering a parent area's
 *    saved children, `renderForcedBlocks` appends every registered block whose
 *    `parent` includes that area, whose `force` is true, and whose name is *not*
 *    already among the area's children — with **no props at all**. Because the
 *    server injects a wrapper wherever a field belongs, that condition is false
 *    in the areas that matter, and the forced copy is skipped. In the areas with
 *    no field, one bare copy mounts and renders nothing.
 *
 * `parent` is validated: it must name at least one of WooCommerce's own inner
 * block areas or the call throws. Every area the nine placements resolve to is
 * listed, so a field never lands in an area the block was not registered for.
 * The two address areas carry three placements between them: `address`, which
 * is spliced into both, and the shipping-only and billing-only ones, which are
 * spliced into one each.
 *
 * `force` is set both ways — the flag and the `lock.default.remove` attribute
 * WooCommerce falls back to reading — so it survives either being deprecated.
 */

import { registerCheckoutBlock } from '@woocommerce/blocks-checkout';

import CheckoutField from './Field';
import type { CheckoutBootstrap } from './types';

/** The name the server writes into `data-block-name`. */
export const BLOCK_NAME = 'cbwb/field';

/**
 * Every inner block area a field can be placed in.
 *
 * These are WooCommerce's own names (`innerBlockAreas` in
 * `wc-cart-checkout-base-frontend.js`); `registerCheckoutBlock` throws if none
 * of them is recognised, which is a useful early warning that the checkout
 * changed underneath us.
 */
export const PARENT_AREAS = [
	'woocommerce/checkout-contact-information-block',
	'woocommerce/checkout-shipping-address-block',
	'woocommerce/checkout-billing-address-block',
	'woocommerce/checkout-shipping-methods-block',
	'woocommerce/checkout-payment-block',
	'woocommerce/checkout-order-summary-block',
	'woocommerce/checkout-fields-block',
];

/**
 * Register the block, closing over the data the server sent.
 *
 * A closure rather than a context provider or a module global: WooCommerce
 * constructs the element itself, deep inside its own tree, so there is nowhere
 * to hang a provider — and a module global would make the component untestable
 * without touching `window`.
 *
 * @param bootstrap Everything the server sent.
 * @return True when WooCommerce accepted the registration.
 */
export function registerFieldBlock( bootstrap: CheckoutBootstrap ): boolean {
	/**
	 * The registered component.
	 *
	 * @param props Props WooCommerce spread off the wrapper's dataset.
	 * @return The field.
	 */
	const Component = ( props: Record< string, unknown > ) => (
		<CheckoutField { ...props } bootstrap={ bootstrap } />
	);

	Component.displayName = 'CbwbCheckoutField';

	try {
		registerCheckoutBlock( {
			metadata: {
				name: BLOCK_NAME,
				parent: PARENT_AREAS,
				attributes: {
					lock: {
						type: 'object',
						default: { remove: true, move: true },
					},
				},
			},
			component: Component,
			force: true,
		} );

		return true;
	} catch {
		// A checkout that throws is a checkout nobody can buy from. If
		// WooCommerce has renamed its block areas, the merchant's fields go
		// missing — which is bad — but the rest of the checkout still works.
		return false;
	}
}
