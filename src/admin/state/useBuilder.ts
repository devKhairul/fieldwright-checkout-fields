import { useMemo, useReducer } from '@wordpress/element';

import type { CoreRow, PseudoRow } from '../lib/coreFields';
import {
	addressRowOrder,
	buildCoreRows,
	buildPseudoRows,
	coreKeyOf,
	hasCoreFields,
	resolveCoreFields,
	sameCore,
	validateCore,
} from '../lib/coreFields';
import { byLocation, sameFields } from '../lib/fields';
import type { FieldsByLocation } from '../lib/fields';
import { mapErrors, validateFields } from '../lib/validate';
import type { ErrorMap, ValidationContext } from '../lib/validate';
import type { AdminBootstrap, Field } from '../types';
import type { BuilderAction } from './actions';
import { initState, reducer } from './reducer';
import type { BuilderState } from './reducer';

export interface Builder {
	state: BuilderState;
	dispatch: ( action: BuilderAction ) => void;
	/** Working copy differs from the last saved config. */
	dirty: boolean;
	groups: FieldsByLocation;
	/** Failures found by the client validator, keyed by field id. */
	clientErrors: ErrorMap;
	/** Failures reported by the last save, keyed by field id. */
	serverErrors: ErrorMap;
	/** Both sets merged, which is what the UI renders. */
	errors: ErrorMap;
	selected: Field | undefined;
	/** Ids that exist on the server, so their key is locked. */
	savedIds: Set< string >;

	/* --------------------------- WooCommerce's own fields. */

	/** True while this build has core rows to show at all. */
	hasCore: boolean;
	/** WooCommerce's own fields, with every override applied. */
	coreRows: CoreRow[];
	/** The order-note box and the coupon form. */
	pseudoRows: PseudoRow[];
	/** The address section, top to bottom: core rows and custom fields mixed. */
	addressOrder: string[];
	/** The core row the builder has selected, if it has one. */
	selectedCore: CoreRow | PseudoRow | undefined;
}

/**
 * Merge two error maps into one.
 *
 * @param a First map.
 * @param b Second map.
 * @return Merged map.
 */
function mergeErrors( a: ErrorMap, b: ErrorMap ): ErrorMap {
	if ( 0 === b.count ) {
		return a;
	}
	if ( 0 === a.count ) {
		return b;
	}

	const byField: ErrorMap[ 'byField' ] = {};
	const rawByField: ErrorMap[ 'rawByField' ] = {};
	const byCore: ErrorMap[ 'byCore' ] = {};
	const rawByCore: ErrorMap[ 'rawByCore' ] = {};

	[ a, b ].forEach( ( source ) => {
		( [ 'byField', 'byCore' ] as const ).forEach( ( bucket ) => {
			const into = 'byField' === bucket ? byField : byCore;

			Object.entries( source[ bucket ] ).forEach( ( [ id, keys ] ) => {
				into[ id ] = into[ id ] ?? {};
				Object.entries( keys ).forEach( ( [ key, messages ] ) => {
					into[ id ][ key ] = [
						...( into[ id ][ key ] ?? [] ),
						...messages,
					];
				} );
			} );
		} );

		( [ 'rawByField', 'rawByCore' ] as const ).forEach( ( bucket ) => {
			const into = 'rawByField' === bucket ? rawByField : rawByCore;

			Object.entries( source[ bucket ] ).forEach( ( [ id, list ] ) => {
				into[ id ] = [ ...( into[ id ] ?? [] ), ...list ];
			} );
		} );
	} );

	return {
		byField,
		rawByField,
		byCore,
		rawByCore,
		general: [ ...a.general, ...b.general ],
		count: a.count + b.count,
	};
}

/**
 * Wire the reducer up with everything the UI derives from it.
 *
 * @param bootstrap Bootstrap data from the server.
 * @return Store and derived state.
 */
export function useBuilder( bootstrap: AdminBootstrap ): Builder {
	const hasCore = hasCoreFields( bootstrap );

	const [ state, dispatch ] = useReducer(
		reducer,
		{
			config: bootstrap.config,
			idPrefix: bootstrap.idPrefix,
			selectPlaceholder: bootstrap.selectPlaceholderDefault || undefined,
			coreFields: bootstrap.coreFields,
			coreLabelOverrides: bootstrap.baseCountryLabelOverrides,
		},
		initState
	);

	const context: ValidationContext = useMemo(
		() => ( {
			idPrefix: bootstrap.idPrefix,
			formatPresets: bootstrap.formatPresets,
			autocompleteTokens: bootstrap.autocompleteTokens,
			maxFields: bootstrap.maxFields,
		} ),
		[
			bootstrap.idPrefix,
			bootstrap.formatPresets,
			bootstrap.autocompleteTokens,
			bootstrap.maxFields,
		]
	);

	/*
	 * The server's table of WooCommerce's own fields — or, on a server that
	 * predates them, the fixed one `lib/coreFields.ts` keeps so the checkout
	 * picture still has a checkout in it. `hasCore` is what says which of the
	 * two this is, and therefore whether any of it can be edited.
	 */
	const coreFields = useMemo(
		() => resolveCoreFields( bootstrap ),
		[ bootstrap ]
	);

	const dirty = useMemo(
		() =>
			! sameFields( state.fields, state.baseline ) ||
			! sameCore( state.core, state.coreBaseline ),
		[ state.fields, state.baseline, state.core, state.coreBaseline ]
	);

	const groups = useMemo(
		() => byLocation( state.fields ),
		[ state.fields ]
	);

	const coreRows = useMemo(
		() => buildCoreRows( coreFields, state.core, state.coreDefaults ),
		[ coreFields, state.core, state.coreDefaults ]
	);

	const pseudoRows = useMemo(
		() => buildPseudoRows( state.core ),
		[ state.core ]
	);

	const addressOrder = useMemo(
		() =>
			addressRowOrder( coreRows, state.fields, state.core.order.address ),
		[ coreRows, state.fields, state.core.order.address ]
	);

	const clientErrors = useMemo(
		() =>
			mapErrors( state.fields, [
				...validateFields( state.fields, context ),
				...( hasCore ? validateCore( state.core, coreFields ) : [] ),
			] ),
		[ state.fields, context, hasCore, state.core, coreFields ]
	);

	const serverErrors = useMemo(
		() => mapErrors( state.fields, state.serverErrors ),
		[ state.fields, state.serverErrors ]
	);

	const errors = useMemo(
		() => mergeErrors( clientErrors, serverErrors ),
		[ clientErrors, serverErrors ]
	);

	const selected = useMemo(
		() => state.fields.find( ( field ) => field.id === state.selectedId ),
		[ state.fields, state.selectedId ]
	);

	const selectedCore = useMemo( () => {
		const key = coreKeyOf( state.selectedId );
		if ( ! hasCore || ! key ) {
			return undefined;
		}
		return (
			coreRows.find( ( row ) => row.key === key ) ??
			pseudoRows.find( ( row ) => row.key === key )
		);
	}, [ hasCore, state.selectedId, coreRows, pseudoRows ] );

	const savedIds = useMemo(
		() => new Set( state.baseline.map( ( field ) => field.id ) ),
		[ state.baseline ]
	);

	return {
		state,
		dispatch,
		dirty,
		groups,
		clientErrors,
		serverErrors,
		errors,
		selected,
		savedIds,
		hasCore,
		coreRows,
		pseudoRows,
		addressOrder,
		selectedCore,
	};
}
