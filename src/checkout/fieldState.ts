/**
 * Whether a field is on the shopper's screen, and whether they have to answer it.
 *
 * Free renders the fields and knows nothing about conditions. An add-on that
 * does — Fieldwright Pro evaluates the merchant's rules against the cart,
 * the address and the chosen shipping method — needs a way to say "not this one,
 * not for this shopper", and this is it.
 *
 * It is a store of its own rather than part of WooCommerce's checkout store for
 * two reasons. It is not the shopper's data, so it has no business being posted
 * with the order. And an add-on has to be able to write to it from outside
 * React, from whatever observer it hangs off WooCommerce's own stores, which a
 * hook could not offer.
 *
 * The server is told the same thing separately, through the `cbwb_rich_field_state`
 * filter. Nothing here is trusted: hiding a field in the browser stops it being
 * asked, and the server decides again whether it counted.
 */

import type { FieldOption, FieldState, FieldStatePatch } from './types';

type Listener = () => void;

const states = new Map< string, FieldState >();
const listeners = new Set< Listener >();

const DEFAULT_STATE: FieldState = { hidden: false };

/**
 * What is currently said about one field.
 *
 * @param fieldId Field id, e.g. `cbwb/gift-message`.
 * @return The state, defaulting to visible with the merchant's own `required`.
 */
export function getFieldState( fieldId: string ): FieldState {
	return states.get( fieldId ) ?? DEFAULT_STATE;
}

/**
 * The choices a patch names, or none where it named something else.
 *
 * Checked rather than trusted for the same reason `hidden` is: this is written
 * from another plugin's bundle, and a field asked to draw a list that is not
 * one would take the checkout down with it.
 *
 * @param state The patch.
 * @return The choices, or undefined.
 */
function namedOptions( state: FieldStatePatch ): FieldOption[] | undefined {
	return Array.isArray( state.options ) ? state.options : undefined;
}

/**
 * The line a patch names, or none where it named something else.
 *
 * @param state The patch.
 * @return The line, or undefined.
 */
function namedNote( state: FieldStatePatch ): string | undefined {
	return 'string' === typeof state.note ? state.note : undefined;
}

/**
 * Whether two lists of choices say the same thing.
 *
 * Compared by their JSON rather than by reference, because an add-on that asks
 * the server what is available builds a new array every time it is answered,
 * and a new array that reads the same is not a change the shopper can see.
 *
 * @param a First list, or undefined for none.
 * @param b Second list, or undefined for none.
 * @return True when both lists offer the same choices in the same order.
 */
function sameOptions(
	a: FieldOption[] | undefined,
	b: FieldOption[] | undefined
): boolean {
	if ( a === b ) {
		return true;
	}

	if ( undefined === a || undefined === b ) {
		return false;
	}

	return JSON.stringify( a ) === JSON.stringify( b );
}

/**
 * Say something about one field.
 *
 * Merges rather than replaces, so an add-on that only cares about visibility
 * does not have to restate `required` every time, and two add-ons minding
 * different things do not overwrite each other. The rule for every key is the
 * same: a patch that names it replaces it, a patch that leaves it out keeps
 * what is there — so `{ options: undefined }` is how a list is taken away.
 *
 * @param fieldId Field id, e.g. `cbwb/gift-message`.
 * @param state   What to change about it.
 */
export function setFieldState( fieldId: string, state: FieldStatePatch ): void {
	if ( 'string' !== typeof fieldId || '' === fieldId ) {
		return;
	}

	const current = getFieldState( fieldId );
	const next: FieldState = {
		hidden:
			'boolean' === typeof state.hidden ? state.hidden : current.hidden,
		required:
			'required' in state
				? ( state.required as boolean | undefined )
				: current.required,
		options: 'options' in state ? namedOptions( state ) : current.options,
		note: 'note' in state ? namedNote( state ) : current.note,
	};

	if (
		next.hidden === current.hidden &&
		next.required === current.required &&
		next.note === current.note &&
		sameOptions( next.options, current.options )
	) {
		return;
	}

	states.set( fieldId, next );
	listeners.forEach( ( listener ) => listener() );
}

/**
 * Hear about every change, whichever field it was about.
 *
 * @param listener Called after each change.
 * @return A function that stops the subscription.
 */
export function subscribe( listener: Listener ): () => void {
	listeners.add( listener );

	return () => {
		listeners.delete( listener );
	};
}

/**
 * Forget everything. For tests, which share one module instance.
 */
export function resetFieldStates(): void {
	states.clear();
	listeners.clear();
}
