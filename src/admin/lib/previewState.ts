/**
 * What the merchant has done in the preview's Live mode.
 *
 * The preview has two ways of working. In Edit mode it is a picture of the
 * checkout, and a click on anything selects the field for editing. In Live mode
 * it is a working copy: the controls are live, and what the merchant types and
 * ticks is kept here, in the shapes the checkout itself stores, so an add-on
 * asked about it through the preview filters reads the same values the server
 * would.
 *
 * Nothing here is saved. Leaving Live mode, or pressing Reset, puts every
 * control back where the configuration starts it.
 */

import { useCallback, useMemo, useReducer } from '@wordpress/element';

import type { Field } from '../types';
import { hasDefaultValue } from './fields';
import type { PreviewContext, PreviewCustomer, PreviewMode } from './hooks';

/** Everything the Live mode remembers. */
export interface PreviewState {
	mode: PreviewMode;
	/** By field id, in the checkout's storage shapes. */
	values: Record< string, string >;
	/** By WooCommerce's own field key: country, state, postcode, city, company. */
	coreValues: Record< string, string >;
	/** The "Use same address for billing" box. Ticked, as WooCommerce starts it. */
	sameAddress: boolean;
	customer: PreviewCustomer;
	/** Fields the merchant has left after typing in them, so a required one can say so. */
	touched: Record< string, true >;
}

export type PreviewAction =
	| { type: 'setMode'; mode: PreviewMode; fields: Field[] }
	| { type: 'setValue'; id: string; value: string }
	| { type: 'setCoreValue'; key: string; value: string }
	| { type: 'setSameAddress'; sameAddress: boolean }
	| { type: 'setLoggedIn'; loggedIn: boolean }
	| { type: 'touch'; id: string }
	| { type: 'reset'; fields: Field[] };

/** What Live mode does with the preview state. */
export interface PreviewActions {
	setMode: ( mode: PreviewMode ) => void;
	setValue: ( id: string, value: string ) => void;
	setCoreValue: ( key: string, value: string ) => void;
	setSameAddress: ( sameAddress: boolean ) => void;
	setLoggedIn: ( loggedIn: boolean ) => void;
	touch: ( id: string ) => void;
	reset: () => void;
}

/**
 * The value a field starts out with, in its storage shape.
 *
 * A heading or paragraph has no value, and a type that carries no prefilled
 * answer starts from nothing: some answers cannot be stood in for, and the
 * add-on that provided the type is what says so. Everything else starts from the
 * merchant's own starting value, which the builder already keeps in the
 * checkout's shape (a checkbox as `yes` or empty, a group as a list).
 *
 * @param field The field.
 * @return Starting value.
 */
export function startingValue( field: Field ): string {
	if ( ! hasDefaultValue( field.type ) ) {
		return '';
	}

	if ( 'checkbox' === field.type ) {
		return 'yes' === field.default_value ? 'yes' : '';
	}

	return 'string' === typeof field.default_value ? field.default_value : '';
}

/**
 * The state the preview opens with: every control at its starting value,
 * nothing touched, billing the same as shipping, a guest at the checkout.
 *
 * @param fields The configured fields.
 * @param mode   Which mode to start in.
 * @return Fresh state.
 */
export function initialPreviewState(
	fields: Field[],
	mode: PreviewMode = 'edit'
): PreviewState {
	const values: Record< string, string > = {};

	fields.forEach( ( field ) => {
		values[ field.id ] = startingValue( field );
	} );

	return {
		mode,
		values,
		coreValues: {},
		sameAddress: true,
		customer: { loggedIn: false, roles: [] },
		touched: {},
	};
}

/**
 * Apply one action.
 *
 * Switching mode always resets the form: a merchant coming back to Live mode
 * expects the checkout a shopper would first see, not the half filled form
 * they left, and Edit mode has no values to keep.
 *
 * The actions that start over carry the current field list themselves rather
 * than reading it from a closure, so the reducer is a pure function of its two
 * arguments whatever render it runs in.
 *
 * @param state  Current state.
 * @param action What happened.
 * @return Next state.
 */
export function previewReducer(
	state: PreviewState,
	action: PreviewAction
): PreviewState {
	switch ( action.type ) {
		case 'setMode':
			if ( action.mode === state.mode ) {
				return state;
			}
			return initialPreviewState( action.fields, action.mode );

		case 'setValue':
			if ( state.values[ action.id ] === action.value ) {
				return state;
			}
			return {
				...state,
				values: { ...state.values, [ action.id ]: action.value },
			};

		case 'setCoreValue':
			if ( state.coreValues[ action.key ] === action.value ) {
				return state;
			}
			return {
				...state,
				coreValues: {
					...state.coreValues,
					[ action.key ]: action.value,
				},
			};

		case 'setSameAddress':
			if ( state.sameAddress === action.sameAddress ) {
				return state;
			}
			return { ...state, sameAddress: action.sameAddress };

		case 'setLoggedIn':
			if ( state.customer.loggedIn === action.loggedIn ) {
				return state;
			}
			return {
				...state,
				customer: { ...state.customer, loggedIn: action.loggedIn },
			};

		case 'touch':
			if ( state.touched[ action.id ] ) {
				return state;
			}
			return {
				...state,
				touched: { ...state.touched, [ action.id ]: true },
			};

		case 'reset':
			return initialPreviewState( action.fields, state.mode );

		default:
			return state;
	}
}

/**
 * The picture handed to the preview filters.
 *
 * Values for fields that no longer exist are left out, so an add-on never reads
 * a value for a field the merchant has since deleted, and every current field
 * has an entry even if the merchant has not touched it, so "not filled in" reads
 * as the empty string rather than as absent.
 *
 * @param state  Preview state.
 * @param fields The configured fields.
 * @param hidden Field ids an add-on has hidden, once known.
 * @return Context for the filters.
 */
export function previewContext(
	state: PreviewState,
	fields: Field[],
	hidden: ReadonlySet< string > = new Set()
): PreviewContext {
	const values: Record< string, string > = {};

	fields.forEach( ( field ) => {
		const value = state.values[ field.id ];
		values[ field.id ] =
			'string' === typeof value ? value : startingValue( field );
	} );

	return {
		mode: state.mode,
		fields,
		values,
		coreValues: { ...state.coreValues },
		sameAddress: state.sameAddress,
		customer: {
			loggedIn: state.customer.loggedIn,
			roles: [ ...state.customer.roles ],
		},
		hidden,
	};
}

/**
 * Whether a field's own rules say it is missing something, in Live mode.
 *
 * Only the one rule the preview can judge without a server: a required field
 * the merchant has left empty. Everything else (formats, ranges, option lists)
 * is the checkout's to say, and the preview does not pretend to.
 *
 * Which fields those are is the merchant's Required switch, unless an add-on
 * answered for this one: a field that is only compulsory in some situations is
 * compulsory here whenever the add-on says it is.
 *
 * @param field    The field.
 * @param state    Preview state.
 * @param visible  Whether the field is on the screen at all.
 * @param required Whether an add-on has made the field compulsory, where it said
 *                 so at all. The merchant's own Required switch decides
 *                 wherever it did not.
 * @return True when the field should show its "please fill in" message.
 */
export function isMissingRequired(
	field: Field,
	state: PreviewState,
	visible: boolean,
	required?: boolean
): boolean {
	const compulsory =
		'boolean' === typeof required ? required : field.required;

	if ( ! visible || ! compulsory || ! state.touched[ field.id ] ) {
		return false;
	}

	if ( 'heading' === field.type || 'paragraph' === field.type ) {
		return false;
	}

	const value = state.values[ field.id ] ?? '';

	return '' === value.trim();
}

/**
 * Keep the preview's Live mode state for one set of fields.
 *
 * @param fields The configured fields. When the list changes shape (a field
 *               added or removed) values for fields that still exist are kept
 *               and the new field starts at its starting value.
 * @return The state and the actions that change it.
 */
export function usePreviewState(
	fields: Field[]
): [ PreviewState, PreviewActions ] {
	const [ state, dispatch ] = useReducer(
		previewReducer,
		fields,
		( initial: Field[] ) => initialPreviewState( initial )
	);

	const setMode = useCallback(
		( mode: PreviewMode ) => dispatch( { type: 'setMode', mode, fields } ),
		[ fields ]
	);
	const setValue = useCallback(
		( id: string, value: string ) =>
			dispatch( { type: 'setValue', id, value } ),
		[]
	);
	const setCoreValue = useCallback(
		( key: string, value: string ) =>
			dispatch( { type: 'setCoreValue', key, value } ),
		[]
	);
	const setSameAddress = useCallback(
		( sameAddress: boolean ) =>
			dispatch( { type: 'setSameAddress', sameAddress } ),
		[]
	);
	const setLoggedIn = useCallback(
		( loggedIn: boolean ) => dispatch( { type: 'setLoggedIn', loggedIn } ),
		[]
	);
	const touch = useCallback(
		( id: string ) => dispatch( { type: 'touch', id } ),
		[]
	);
	const reset = useCallback(
		() => dispatch( { type: 'reset', fields } ),
		[ fields ]
	);

	const actions = useMemo(
		() => ( {
			setMode,
			setValue,
			setCoreValue,
			setSameAddress,
			setLoggedIn,
			touch,
			reset,
		} ),
		[
			setMode,
			setValue,
			setCoreValue,
			setSameAddress,
			setLoggedIn,
			touch,
			reset,
		]
	);

	return [ state, actions ];
}
