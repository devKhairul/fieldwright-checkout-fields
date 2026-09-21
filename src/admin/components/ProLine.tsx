/**
 * One line about the paid add-on, above the field list.
 *
 * Deliberately not a notice. It has no background, no icon and no status
 * colour, it is the size of the text around it, and it is inside the builder
 * rather than on any other screen in wp-admin: a merchant reading the outline
 * reads it once and goes on working. Closing it hides it for that user for
 * good, which is what makes it a line rather than a nag.
 *
 * The link goes to the Pro tab and not to our site, because the tab is the
 * answer to what the line asks: what is in it. Nothing here opens a window or a
 * popover.
 */

import { Button } from '@wordpress/components';
import { useState } from '@wordpress/element';
import { close } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';

import { dismissProLine } from '../lib/api';
import { PRO_TAB, proIsAbsent } from '../lib/pro';
import { useTabs } from '../lib/tabs';
import { getBootstrap } from '../types';

export default function ProLine() {
	const switcher = useTabs();
	/*
	 * Whether it was already closed comes with the page rather than from a
	 * request of its own: a line that arrives, paints and then takes itself away
	 * again is worse than the line.
	 */
	const [ hidden, setHidden ] = useState(
		() => true === getBootstrap().proLineDismissed
	);

	// No strip to read is the editor rendered outside the builder, where nothing
	// can tell whether Pro is running; Pro running is a merchant who owns this
	// already. Neither is a place for an invitation.
	if ( ! switcher || ! proIsAbsent( switcher.tabs ) || hidden ) {
		return null;
	}

	const dismiss = () => {
		// Gone the moment it is closed. The request is only what makes that last
		// past a reload, so a failed one is not worth a notice: the line is
		// already off the screen, and the worst case is that it comes back.
		setHidden( true );
		dismissProLine().catch( () => undefined );
	};

	return (
		<p className="cbwb-pro-line">
			<span className="cbwb-pro-line__text">
				{ __(
					'Fieldwright Pro adds conditions, fees, file uploads, date rules and time slots.',
					'fieldwright-checkout-fields'
				) }
			</span>
			<Button
				variant="link"
				className="cbwb-pro-line__link"
				onClick={ () => switcher.open( PRO_TAB ) }
			>
				{ __( 'See what is in it.', 'fieldwright-checkout-fields' ) }
			</Button>
			<Button
				className="cbwb-pro-line__close"
				icon={ close }
				label={ __( 'Hide this line', 'fieldwright-checkout-fields' ) }
				onClick={ dismiss }
			/>
		</p>
	);
}
