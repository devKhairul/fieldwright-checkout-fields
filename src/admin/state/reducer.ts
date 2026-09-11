/**
 * The builder store. Pure: everything the UI needs to render a change lives
 * here, so the whole editing model is unit-testable without React.
 */

import type { CoreDefaults } from '../lib/coreFields';
import {
	coreDefaults,
	isCoreRowId,
	normalizeCore,
	resetCoreField,
	sameCore,
	setCoreOverride,
	setPseudoHidden,
	toStoredId,
} from '../lib/coreFields';
import {
	SELECT_PLACEHOLDER_DEFAULT,
	applyLocationChange,
	applyTypeChange,
	duplicateField,
	moveField,
	normalizeField,
	reorderWithinLocation,
	repositionToGroupEnd,
	sameFields,
	settleFamilies,
} from '../lib/fields';
import { uniqueFieldId } from '../lib/slug';
import type {
	Config,
	CoreConfig,
	CoreFieldMeta,
	Field,
	ValidationError,
} from '../types';
import type { BuilderAction } from './actions';

export interface RemovedField {
	field: Field;
	index: number;
	wasSelected: boolean;
}

export interface BuilderState {
	/** Working copy shown in the UI. */
	fields: Field[];
	/** Last known server state; `dirty` is a deep compare against this. */
	baseline: Field[];
	schemaVersion: number;
	/**
	 * The selected row: a merchant field's key, or one of WooCommerce's own
	 * rows as `core:<key>`. One selection model, so the outline, the preview and
	 * the settings pane always agree about what is being edited.
	 */
	selectedId: string | null;
	/** Namespace for generated keys, e.g. `cbwb/`. */
	idPrefix: string;
	/** Prefilled on a field that becomes a dropdown without a placeholder. */
	selectPlaceholder: string;
	/** Unsaved fields whose key still tracks the label. */
	autoKeyIds: string[];
	/** Errors returned by the last failed save. */
	serverErrors: ValidationError[];
	/** Supports the undo snackbar after a delete. */
	lastRemoved: RemovedField | null;

	/* ------------------------- WooCommerce's own fields. */

	/** What the merchant changed about WooCommerce's own fields. */
	core: CoreConfig;
	/** Last known server state for `core`. */
	coreBaseline: CoreConfig;
	/**
	 * What WooCommerce would show with nothing of ours in the way, worked out
	 * once from the config the page loaded. It is what a reset goes back to, and
	 * what tells a change from a no-op.
	 */
	coreDefaults: Record< string, CoreDefaults >;
	/**
	 * False on a server that predates core fields, which is what keeps the
	 * builder from offering — or saving — rows it has no home for.
	 */
	hasCore: boolean;
}

export interface BuilderInit {
	config: Config;
	idPrefix: string;
	selectPlaceholder?: string;
	/** WooCommerce's own fields, exactly as the bootstrap listed them. */
	coreFields?: CoreFieldMeta[];
	/** Labels WooCommerce's own locale gives the store's base country. */
	coreLabelOverrides?: Record< string, string >;
}

export function initState( {
	config,
	idPrefix,
	selectPlaceholder = SELECT_PLACEHOLDER_DEFAULT,
	coreFields = [],
	coreLabelOverrides = {},
}: BuilderInit ): BuilderState {
	// Settled on the way in as well, and the baseline with it, so a stored
	// order the checkout would not keep is shown as the checkout keeps it
	// without reading as an unsaved change.
	const fields = settleFamilies(
		config.fields.map( ( field ) => normalizeField( field ) )
	);
	const core = normalizeCore( config.core );

	return {
		fields,
		baseline: fields,
		schemaVersion: config.schema_version,
		selectedId: fields.length > 0 ? fields[ 0 ].id : null,
		idPrefix,
		selectPlaceholder,
		autoKeyIds: [],
		serverErrors: [],
		lastRemoved: null,
		core,
		coreBaseline: core,
		coreDefaults: coreDefaults( coreFields, core, coreLabelOverrides ),
		hasCore: coreFields.length > 0,
	};
}

/** Actions that leave a failed save's errors on screen. */
const NON_MUTATING: ReadonlyArray< BuilderAction[ 'type' ] > = [
	'select',
	'serverErrors',
];

/**
 * Apply one action.
 *
 * @param state  Current state.
 * @param action Action to apply.
 * @return Next state.
 */
export function reducer(
	state: BuilderState,
	action: BuilderAction
): BuilderState {
	let next = apply( state, action );

	if ( next === state || NON_MUTATING.includes( action.type ) ) {
		return next;
	}

	// The outline never holds an order the checkout cannot draw: within the
	// placements WooCommerce's own types share with this plugin's, its types
	// come first. A drag across that line lands back on its own side.
	if ( next.fields !== state.fields ) {
		const settled = settleFamilies( next.fields );
		if ( settled !== next.fields ) {
			next = { ...next, fields: settled };
		}
	}

	// Any edit invalidates the errors the server reported for the old payload.
	return 0 === next.serverErrors.length
		? next
		: { ...next, serverErrors: [] };
}

function apply( state: BuilderState, action: BuilderAction ): BuilderState {
	switch ( action.type ) {
		case 'add': {
			return {
				...state,
				fields: [ ...state.fields, action.field ],
				selectedId: action.field.id,
				autoKeyIds: [ ...state.autoKeyIds, action.field.id ],
				lastRemoved: null,
			};
		}

		case 'update': {
			const index = state.fields.findIndex(
				( field ) => field.id === action.id
			);
			if ( -1 === index ) {
				return state;
			}
			return forgetRemoval( updateAt( state, index, action.changes ) );
		}

		case 'remove': {
			const index = state.fields.findIndex(
				( field ) => field.id === action.id
			);
			if ( -1 === index ) {
				return state;
			}
			const field = state.fields[ index ];
			const fields = state.fields.filter(
				( _field, at ) => at !== index
			);
			const wasSelected = state.selectedId === action.id;

			return {
				...state,
				fields,
				selectedId: wasSelected
					? nextSelection( fields, index )
					: state.selectedId,
				autoKeyIds: state.autoKeyIds.filter(
					( id ) => id !== action.id
				),
				lastRemoved: { field, index, wasSelected },
			};
		}

		case 'undoRemove': {
			const removed = state.lastRemoved;
			if ( ! removed ) {
				return state;
			}
			const fields = state.fields.slice();
			fields.splice(
				Math.min( removed.index, fields.length ),
				0,
				removed.field
			);

			return {
				...state,
				fields,
				selectedId: removed.wasSelected
					? removed.field.id
					: state.selectedId,
				lastRemoved: null,
			};
		}

		case 'duplicate': {
			const result = duplicateField(
				state.fields,
				action.id,
				state.idPrefix
			);
			if ( null === result.id ) {
				return state;
			}
			return {
				...state,
				fields: result.fields,
				selectedId: result.id,
				autoKeyIds: [ ...state.autoKeyIds, result.id ],
				lastRemoved: null,
			};
		}

		case 'reorder': {
			const fields = reorderWithinLocation(
				state.fields,
				action.location,
				action.from,
				action.to
			);
			return fields === state.fields
				? state
				: forgetRemoval( { ...state, fields } );
		}

		case 'move': {
			const fields = moveField( state.fields, action.id, action.delta );
			return fields === state.fields
				? state
				: forgetRemoval( { ...state, fields } );
		}

		case 'select':
			return state.selectedId === action.id
				? state
				: { ...state, selectedId: action.id };

		case 'import': {
			const fields = action.fields.map( ( field ) =>
				normalizeField( field )
			);
			return {
				...state,
				fields,
				selectedId: fields.length > 0 ? fields[ 0 ].id : null,
				autoKeyIds: [],
				lastRemoved: null,
				// A file written before core fields existed says nothing about
				// them, which is not the same as saying "change nothing back".
				core: state.hasCore && action.core ? action.core : state.core,
			};
		}

		case 'saved': {
			const stored = settleFamilies(
				action.config.fields.map( ( field ) => normalizeField( field ) )
			);
			const storedIds = new Set( stored.map( ( field ) => field.id ) );
			// A save that answers with no `core` at all says nothing about the
			// core rows, so the working copy is what stands.
			const storedCore = action.config.core
				? normalizeCore( action.config.core )
				: state.core;

			/*
			 * The answer is the server's echo of what this save *sent*, and a
			 * save is not instant: anything the merchant typed while it was in
			 * flight is on the working copy and not in the echo. So the echo
			 * becomes the baseline either way — it is what the server now holds
			 * — but it only replaces the working copy while the working copy is
			 * still the thing that was sent. Otherwise the edits stay, which
			 * leaves `dirty` true, the Save button live and the leave guard
			 * armed for the round that has yet to go out.
			 */
			const edited = ! sameFields( state.fields, action.sent.fields );
			const coreEdited =
				undefined !== action.sent.core &&
				! sameCore( state.core, action.sent.core );

			const fields = edited ? state.fields : stored;
			const ids = new Set( fields.map( ( field ) => field.id ) );
			const fallback = fields.length > 0 ? fields[ 0 ].id : null;

			return {
				...state,
				fields,
				baseline: stored,
				schemaVersion: action.config.schema_version,
				// A core row stays selected across a save: it is not in the
				// field list, so the "is it still there?" question is not asked
				// of it.
				selectedId:
					state.selectedId &&
					( ids.has( state.selectedId ) ||
						isCoreRowId( state.selectedId ) )
						? state.selectedId
						: fallback,
				// A key stops following its label once the field exists on the
				// server; one added while the save was in flight has not been
				// sent yet, so it goes on following.
				autoKeyIds: state.autoKeyIds.filter(
					( id ) => ! storedIds.has( id )
				),
				serverErrors: [],
				lastRemoved: null,
				core: coreEdited ? state.core : storedCore,
				coreBaseline: storedCore,
				coreDefaults: learnDefaults(
					state.coreDefaults,
					action.sent.corePayload,
					storedCore
				),
			};
		}

		case 'serverErrors':
			return { ...state, serverErrors: action.errors };

		case 'updateCore': {
			if ( ! state.hasCore ) {
				return state;
			}
			const core = setCoreOverride(
				state.core,
				action.key,
				action.changes,
				state.coreDefaults
			);
			return core === state.core ? state : { ...state, core };
		}

		case 'resetCore': {
			if ( ! state.hasCore ) {
				return state;
			}
			const core = resetCoreField( state.core, action.key );
			return core === state.core ? state : { ...state, core };
		}

		case 'setPseudo': {
			if ( ! state.hasCore ) {
				return state;
			}
			const core = setPseudoHidden(
				state.core,
				action.key,
				action.hidden
			);
			return core === state.core ? state : { ...state, core };
		}

		case 'reorderAddress': {
			const fields = reorderAddressFields( state.fields, action.order );
			const core = state.hasCore
				? {
						...state.core,
						order: {
							...state.core.order,
							address: action.order.map( toStoredId ),
						},
				  }
				: state.core;

			return fields === state.fields && core === state.core
				? state
				: { ...state, fields, core };
		}
	}
}

/**
 * Close the undo window.
 *
 * Undo puts the removed field back at the index it came from, and an edit that
 * moves the list around leaves that index describing somewhere else entirely —
 * so anything that rewrites the order, or changes a field into something that
 * has to be moved, ends the offer rather than letting it re-insert into a list
 * it no longer fits. The snackbar goes with it: `App` watches this very field.
 *
 * @param state State after the change.
 * @return The state, with nothing left to undo.
 */
function forgetRemoval( state: BuilderState ): BuilderState {
	return null === state.lastRemoved ? state : { ...state, lastRemoved: null };
}

/**
 * Learn what WooCommerce now says, from what the save came back without.
 *
 * The server stores only what genuinely differs from WooCommerce's own value, so
 * a property it dropped from the answer is one WooCommerce itself now agrees
 * with — which is exactly what "WooCommerce's default" has to mean from here on.
 * It is the only way the builder can follow the three fields whose visibility
 * lives in a WooCommerce option rather than in our config: showing the company
 * line writes that option, and the answer says nothing about it at all.
 *
 * @param defaults What WooCommerce said before the save.
 * @param sent     The `core` payload the save carried.
 * @param stored   The `core` config the server answered with.
 * @return The defaults to keep.
 */
function learnDefaults(
	defaults: Record< string, CoreDefaults >,
	sent: CoreConfig | undefined,
	stored: CoreConfig
): Record< string, CoreDefaults > {
	if ( ! sent ) {
		return defaults;
	}

	const next = { ...defaults };
	let changed = false;

	Object.entries( sent.fields ).forEach( ( [ key, override ] ) => {
		const base = next[ key ];
		if ( ! base ) {
			return;
		}

		const kept = stored.fields[ key ] ?? {};
		const learned = { ...base };

		if ( undefined !== override.label && undefined === kept.label ) {
			learned.label = override.label;
		}
		if ( undefined !== override.required && undefined === kept.required ) {
			learned.required = override.required;
		}
		if ( undefined !== override.hidden && undefined === kept.hidden ) {
			learned.hidden = override.hidden;
		}

		if (
			learned.label !== base.label ||
			learned.required !== base.required ||
			learned.hidden !== base.hidden
		) {
			next[ key ] = learned;
			changed = true;
		}
	} );

	return changed ? next : defaults;
}

/**
 * Rewrite the address group so the merchant's own fields follow the order the
 * outline is now in.
 *
 * The order itself lives in `core.order.address`, which is the list WooCommerce
 * is actually handed — but the field array has an order of its own, and letting
 * the two disagree would export one thing and render another.
 *
 * @param fields All fields.
 * @param order  Outline row ids, top to bottom.
 * @return Rewritten array.
 */
function reorderAddressFields( fields: Field[], order: string[] ): Field[] {
	const group = fields.filter( ( field ) => 'address' === field.location );
	if ( group.length < 2 ) {
		return fields;
	}

	const byId = new Map( group.map( ( field ) => [ field.id, field ] ) );
	const sorted = order
		.map( ( id ) => byId.get( id ) )
		.filter( ( field ): field is Field => undefined !== field );

	// Anything the order did not mention keeps its place at the end.
	group.forEach( ( field ) => {
		if ( ! sorted.includes( field ) ) {
			sorted.push( field );
		}
	} );

	if ( sorted.every( ( field, at ) => field === group[ at ] ) ) {
		return fields;
	}

	let cursor = 0;
	return fields.map( ( field ) => {
		if ( 'address' !== field.location ) {
			return field;
		}
		const next = sorted[ cursor ];
		cursor += 1;
		return next;
	} );
}

/**
 * Apply a change set to one field, honouring the rules that make a change more
 * than a key/value write: type resets, location moves and auto keys.
 *
 * @param state   Current state.
 * @param index   Index of the field being changed.
 * @param changes Partial field.
 * @return Next state.
 */
function updateAt(
	state: BuilderState,
	index: number,
	changes: Partial< Field >
): BuilderState {
	const current = state.fields[ index ];
	let field: Field = { ...current, ...changes };

	if ( undefined !== changes.type ) {
		field = applyTypeChange(
			current,
			changes.type,
			state.selectPlaceholder
		);
		field = { ...field, ...changes, type: changes.type };
	}

	// The server drops any pattern that is not backing a custom format, so the
	// editor never leaves a stale one behind either.
	if ( undefined !== changes.format && 'custom' !== changes.format ) {
		field = { ...field, pattern: '' };
	}

	/*
	 * `show_in_order_confirmation` is the flag the checkout has always read and
	 * `visibility.thank_you` is the same flag inside the new group, so whichever
	 * one the editor writes, the other follows. Without this a merchant could
	 * save a field that says both yes and no about the same page.
	 */
	if ( undefined !== changes.visibility ) {
		field = {
			...field,
			show_in_order_confirmation: field.visibility.thank_you,
		};
	} else if ( undefined !== changes.show_in_order_confirmation ) {
		field = {
			...field,
			visibility: {
				...field.visibility,
				thank_you: changes.show_in_order_confirmation,
			},
		};
	}

	let autoKeyIds = state.autoKeyIds;
	let selectedId = state.selectedId;

	// Editing the key by hand stops it tracking the label.
	if ( undefined !== changes.id && changes.id !== current.id ) {
		autoKeyIds = autoKeyIds.filter( ( id ) => id !== current.id );
		selectedId = selectedId === current.id ? changes.id : selectedId;
	} else if (
		undefined !== changes.label &&
		state.autoKeyIds.includes( current.id )
	) {
		const taken = state.fields
			.filter( ( _field, at ) => at !== index )
			.map( ( other ) => other.id );
		const id = uniqueFieldId( field.label, taken, state.idPrefix );

		if ( id !== current.id ) {
			autoKeyIds = autoKeyIds.map( ( existing ) =>
				existing === current.id ? id : existing
			);
			selectedId = selectedId === current.id ? id : selectedId;
			field = { ...field, id };
		}
	}

	/*
	 * Either the merchant moved the field, or the type they picked cannot go
	 * where the field was and `applyTypeChange()` moved it for them. Both end
	 * with the field in a different group, which the array has to be rewritten
	 * for.
	 */
	const movedLocation = field.location !== current.location;

	// A field that leaves one placement can leave an add-on's settings behind
	// it — a fee that is only allowed in some sections, say. `applyTypeChange`
	// has already run the filter for a type change, so this is only for the
	// moves it did not make.
	if ( movedLocation && undefined === changes.type ) {
		field = applyLocationChange( field );
	}

	let fields = state.fields.slice();
	fields[ index ] = field;

	if ( movedLocation ) {
		fields = repositionToGroupEnd( fields, index );
	}

	return { ...state, fields, autoKeyIds, selectedId };
}

/**
 * Pick what to select after a removal: the field that took its place, else the
 * one before it.
 *
 * @param fields Fields after removal.
 * @param index  Index the removed field occupied.
 * @return Field id to select, or null.
 */
function nextSelection( fields: Field[], index: number ): string | null {
	if ( 0 === fields.length ) {
		return null;
	}
	const at = Math.min( index, fields.length - 1 );
	return fields[ at ].id;
}
