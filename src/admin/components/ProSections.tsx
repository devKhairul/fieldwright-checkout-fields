/**
 * What the paid add-on would add to the field in front of you.
 *
 * The field editor's sections are written for the type they are drawn against,
 * and so are these: a date field is told about date rules, a time field about
 * delivery slots, and a heading about nothing at all, because Pro has nothing to
 * say about a block that asks no question. Each one is a heading and a sentence,
 * in the same shape as a real section, with one link under the group.
 *
 * What it deliberately is not: no disabled controls, no padlocks, no switches
 * that do nothing. A setting drawn as a setting a merchant cannot use is a
 * setting they will try to use, and every one of those is a support ticket about
 * a broken screen. This is a sentence at the bottom of a pane, in the one place
 * a merchant is already asking what a field can do.
 *
 * Drawn only while Pro is not running. With Pro installed these sections are
 * real, and the real ones are what render here.
 */

import { __ } from '@wordpress/i18n';

import { collectsAnswer, usesOptions } from '../lib/fields';
import { PRO_URL, proIsAbsent } from '../lib/pro';
import { useTabs } from '../lib/tabs';
import type { Field, FieldType } from '../types';

/** One line about a section Pro would add here. */
interface ProStub {
	/** Stable key, used as the React key. */
	key: string;
	/** Section heading, worded as the real section's heading is. */
	title: string;
	/** One sentence on what the section decides. */
	description: string;
}

/**
 * The sections Pro would offer on a field of this type.
 *
 * Conditions and Required when apply wherever there is an answer to decide
 * about, which is every type but a heading and a paragraph. The other three
 * belong to the types that can carry them: a fee to the types with something to
 * charge for, date rules to a date, delivery slots to a time.
 *
 * @param type The field's type.
 * @return The stubs to draw, in the order the real sections come in.
 */
function stubsFor( type: FieldType ): ProStub[] {
	if ( ! collectsAnswer( type ) ) {
		return [];
	}

	const stubs: ProStub[] = [
		{
			key: 'conditions',
			title: __( 'Conditions', 'fieldwright-checkout-fields' ),
			description: __(
				"Show this field only when the cart, the shipping method, the payment method, the country, another answer or the customer's account says so.",
				'fieldwright-checkout-fields'
			),
		},
		{
			key: 'required-when',
			title: __( 'Required when', 'fieldwright-checkout-fields' ),
			description: __(
				'The same rules, deciding who has to fill it in.',
				'fieldwright-checkout-fields'
			),
		},
	];

	if ( 'checkbox' === type || usesOptions( type ) ) {
		stubs.push( {
			key: 'fee',
			title: __( 'Checkout fee', 'fieldwright-checkout-fields' ),
			description: __(
				'Add a fee to the order when an option is chosen, priced per option, with or without tax.',
				'fieldwright-checkout-fields'
			),
		} );
	}

	if ( 'date' === type ) {
		stubs.push( {
			key: 'date-rules',
			title: __( 'Date rules', 'fieldwright-checkout-fields' ),
			description: __(
				'Closed weekdays, blocked dates, a lead time, a furthest date and a minimum age.',
				'fieldwright-checkout-fields'
			),
		} );
	}

	if ( 'time' === type ) {
		stubs.push( {
			key: 'slots',
			title: __( 'Delivery slots', 'fieldwright-checkout-fields' ),
			description: __(
				'Time windows with a capacity each, so a slot that is full is not offered.',
				'fieldwright-checkout-fields'
			),
		} );
	}

	return stubs;
}

/**
 * The stubs for one field, or nothing at all.
 *
 * @param props       Component props.
 * @param props.field The field being edited.
 */
export default function ProSections( { field }: { field: Field } ) {
	const switcher = useTabs();

	/*
	 * No strip to read means the editor is rendered outside the builder, which
	 * is a place that cannot tell whether Pro is running. A component that
	 * cannot tell does not guess: it says nothing, exactly as it does when Pro
	 * is there.
	 */
	if ( ! switcher || ! proIsAbsent( switcher.tabs ) ) {
		return null;
	}

	const stubs = stubsFor( field.type );

	if ( 0 === stubs.length ) {
		return null;
	}

	return (
		<section className="cbwb-editor__section cbwb-pro-stubs">
			{ stubs.map( ( stub ) => (
				<div className="cbwb-pro-stubs__item" key={ stub.key }>
					<h3 className="cbwb-editor__section-title">
						{ stub.title }
					</h3>
					<p className="cbwb-editor__section-description">
						{ stub.description }
					</p>
				</div>
			) ) }
			<p className="cbwb-pro-stubs__link">
				<a href={ PRO_URL } target="_blank" rel="noopener noreferrer">
					{ __(
						'These are in Fieldwright Pro.',
						'fieldwright-checkout-fields'
					) }
				</a>
			</p>
		</section>
	);
}
