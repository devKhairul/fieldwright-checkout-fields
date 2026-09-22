/**
 * What the builder says when the checkout page has no Checkout block on it.
 *
 * Every field built here is carried to the shopper by the Checkout block, so a
 * store whose checkout page still holds the classic shortcode can build a whole
 * checkout in this screen, save it, visit the checkout and find nothing there.
 * From inside the builder that looks exactly like a plugin that does not work,
 * and it is the single most common thing a one-star review says.
 *
 * Deliberately not dismissible, and deliberately a notice rather than the quiet
 * line above it: it is not an aside about a paid add-on, it is the reason the
 * work being done on this screen will not appear. The link goes to the
 * Compatibility tab, which is where the store finds out what switching costs
 * and can try the block on a draft copy of the page first.
 */

import { Button, Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import { COMPATIBILITY_TAB, useTabs } from '../lib/tabs';
import { getBootstrap } from '../types';

export default function CheckoutNotice() {
	const switcher = useTabs();
	/*
	 * Read from the checkout page when the screen loaded, so there is nothing to
	 * fetch and nothing to wait for. Absent is the answer an older PHP half
	 * gives, and it is treated as nothing to say: a notice this loud is only
	 * worth drawing when the server is sure.
	 */
	const checkoutType = getBootstrap().checkoutType;

	/*
	 * Only the classic shortcode is a sure answer. `unknown` is also what a
	 * block theme reads as when it serves the checkout from a site-editor
	 * template rather than the page's content, and on such a store the
	 * fields do appear: a warning it cannot close would be false there.
	 *
	 * No strip to read is the notice rendered outside the builder, where the
	 * link it ends with has nowhere to go.
	 */
	if ( ! switcher || 'classic' !== checkoutType ) {
		return null;
	}

	return (
		<div className="cbwb-notices">
			<Notice status="warning" isDismissible={ false }>
				{ __(
					'Your checkout page uses the classic checkout. Fields built here appear on the Checkout block only, so nothing you build will show until the page is switched.',
					'fieldwright-checkout-fields'
				) }{ ' ' }
				<Button
					variant="link"
					onClick={ () => switcher.open( COMPATIBILITY_TAB ) }
				>
					{ __(
						'Open Compatibility',
						'fieldwright-checkout-fields'
					) }
				</Button>
			</Notice>
		</div>
	);
}
