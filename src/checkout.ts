/**
 * Fieldwright on the storefront.
 *
 * Three jobs, none of which WooCommerce can do on its own:
 *
 * - Draw the field types core has no renderer for — a textarea, a radio group,
 *   a checkbox group, a date and a time — wherever the server injected a
 *   wrapper for one, and put the answers where WooCommerce will post them.
 * - Give the inputs core *does* render, but only ever as text boxes, the type
 *   and keyboard the merchant asked for.
 * - Take the shopper to whichever of ours stopped the order, in the cases
 *   core's own scroll cannot find.
 *
 * The imports are also what put WooCommerce's script handles in
 * `checkout.asset.php`, so the enqueue gets its dependencies without having to
 * name them by hand.
 */

import { CHECKOUT_STORE_KEY } from '@woocommerce/block-data';
import { select, subscribe } from '@wordpress/data';

import { readBootstrap } from './checkout/bootstrap';
import { startTypeEnhancer } from './checkout/enhanceTypes';
import { registerFieldBlock } from './checkout/register';
import { startErrorFocus } from './checkout/scrollToError';
import { exposeCheckoutApi } from './checkout/store';
import './checkout/style.scss';

// Published before anything is read, and whether or not this store has fields of
// ours: an add-on's bundle depends on this one's handle, so it runs immediately
// after and expects the surface to be there.
exposeCheckoutApi();

const bootstrap = readBootstrap( window.cbwbCheckout );

if ( bootstrap ) {
	if ( bootstrap.fields.length > 0 ) {
		registerFieldBlock( bootstrap );

		startErrorFocus( {
			storeKey: CHECKOUT_STORE_KEY,
			// `select` is typed for registered stores; the checkout store is
			// WooCommerce's, and may not be there at all on an older release.
			select: ( key ) =>
				( select as ( name: string ) => unknown )( key ) as
					| { hasError?: () => boolean; isIdle?: () => boolean }
					| undefined,
			subscribe: ( listener ) => subscribe( listener ),
		} );
	}

	// Runs whether or not there are fields of ours: the inputs this corrects
	// are core's own, rendered from the fields core does understand.
	startTypeEnhancer();
}
