/**
 * The Pro tab: what the paid add-on is, on one screen, for a merchant who went
 * looking for it.
 *
 * A tab rather than a panel wedged into Settings, and the last of the builder's
 * own rather than the first, so it is read by the people who open it and by
 * nobody else. It is on the strip only while Pro is not running: installing Pro
 * registers a tab of its own under the same key this one is reserved against,
 * and its License screen takes this one's place.
 *
 * Laid out with the Settings tab's own classes, because it is the same kind of
 * screen: one column of cards at one measure. Pro's License tab does the same.
 */

import { Button, Card, CardBody, CardHeader } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import { PRO_URL } from '../lib/pro';

/**
 * Everything Pro adds, in the order the product describes it.
 *
 * Built on demand rather than as a module constant, so the strings are
 * translated with the locale that is actually loaded.
 *
 * @return One line per feature.
 */
function features(): string[] {
	return [
		__( 'A file upload field.', 'fieldwright-checkout-fields' ),
		__(
			'Conditions, so a field is shown only when the order calls for it.',
			'fieldwright-checkout-fields'
		),
		__(
			'Required when, the same rules deciding who has to answer.',
			'fieldwright-checkout-fields'
		),
		__(
			'Checkout fees, priced per option, with or without tax.',
			'fieldwright-checkout-fields'
		),
		__(
			'Date rules: closed weekdays, blocked dates, a lead time, a furthest date and a minimum age.',
			'fieldwright-checkout-fields'
		),
		__(
			'Delivery time slots, each with a capacity.',
			'fieldwright-checkout-fields'
		),
		__(
			'A column on the orders list for any field.',
			'fieldwright-checkout-fields'
		),
		__(
			'CSV export of orders with their answers.',
			'fieldwright-checkout-fields'
		),
		__( 'Answers on PDF invoices.', 'fieldwright-checkout-fields' ),
		__(
			"Default values for WooCommerce's own fields.",
			'fieldwright-checkout-fields'
		),
	];
}

export default function ProTab() {
	return (
		<div className="cbwb-settings cbwb-pro">
			<Card className="cbwb-settings__card">
				<CardHeader>
					<h2 className="cbwb-settings__title">
						{ __(
							'Fieldwright Pro',
							'fieldwright-checkout-fields'
						) }
					</h2>
				</CardHeader>
				<CardBody>
					<p className="cbwb-settings__description">
						{ __(
							'Fieldwright Pro is a separate plugin that adds these to the builder you are already using.',
							'fieldwright-checkout-fields'
						) }
					</p>

					<ul className="cbwb-pro__list">
						{ features().map( ( feature ) => (
							<li key={ feature }>{ feature }</li>
						) ) }
					</ul>

					<p className="cbwb-pro__note">
						{ __(
							'One license per site, sold per year from our own site. Nothing is stored on our servers except the license itself.',
							'fieldwright-checkout-fields'
						) }
					</p>

					<div className="cbwb-pro__actions">
						<Button
							__next40pxDefaultSize
							variant="primary"
							href={ PRO_URL }
							target="_blank"
							rel="noopener noreferrer"
						>
							{ __(
								'Read about Fieldwright Pro',
								'fieldwright-checkout-fields'
							) }
						</Button>
					</div>

					{ /*
					 * The way out of this tab for somebody who already bought it:
					 * the screen they are looking for is the one that replaces
					 * this one, and saying so is cheaper than a support ticket.
					 */ }
					<p className="cbwb-pro__note">
						{ __(
							'Already have it? Install and activate Fieldwright Pro and its License tab replaces this one.',
							'fieldwright-checkout-fields'
						) }
					</p>
				</CardBody>
			</Card>
		</div>
	);
}
