import type {
	Config,
	CoreConfig,
	CoreFieldOverride,
	CorePseudoKey,
	Field,
	FieldLocation,
	ValidationError,
} from '../types';

/**
 * What a save carried, remembered from the moment the request went out.
 *
 * A save is not instant, and the merchant keeps typing while it is in flight.
 * The response echoes what was *sent*, so adopting it wholesale would throw away
 * everything typed in between; the reducer compares the working copy against
 * this to tell the two cases apart.
 */
export interface SavedPayload {
	fields: Field[];
	/**
	 * WooCommerce's own rows as the working copy held them at that moment.
	 * Absent on a build with no core rows, which sends none.
	 */
	core?: CoreConfig;
	/**
	 * The `core` block that actually went on the wire, which is a different
	 * shape: `toCorePayload()` writes both halves of the three settings that
	 * share one WooCommerce option, and drops what the server does not store.
	 * It is the answer's opposite number, so it is what tells the builder what
	 * WooCommerce itself now says.
	 */
	corePayload?: CoreConfig;
}

export type BuilderAction =
	| { type: 'add'; field: Field }
	| { type: 'update'; id: string; changes: Partial< Field > }
	| { type: 'remove'; id: string }
	| { type: 'undoRemove' }
	| { type: 'duplicate'; id: string }
	| {
			type: 'reorder';
			location: FieldLocation;
			from: number;
			to: number;
	  }
	| { type: 'move'; id: string; delta: number }
	| { type: 'select'; id: string | null }
	| { type: 'import'; fields: Field[]; core?: CoreConfig }
	| { type: 'saved'; config: Config; sent: SavedPayload }
	| { type: 'serverErrors'; errors: ValidationError[] }
	| { type: 'updateCore'; key: string; changes: CoreFieldOverride }
	| { type: 'resetCore'; key: string }
	| { type: 'setPseudo'; key: CorePseudoKey; hidden: boolean }
	| { type: 'reorderAddress'; order: string[] };

export const addField = ( field: Field ): BuilderAction => ( {
	type: 'add',
	field,
} );

export const updateField = (
	id: string,
	changes: Partial< Field >
): BuilderAction => ( { type: 'update', id, changes } );

export const removeField = ( id: string ): BuilderAction => ( {
	type: 'remove',
	id,
} );

export const undoRemove = (): BuilderAction => ( { type: 'undoRemove' } );

export const duplicate = ( id: string ): BuilderAction => ( {
	type: 'duplicate',
	id,
} );

export const reorder = (
	location: FieldLocation,
	from: number,
	to: number
): BuilderAction => ( { type: 'reorder', location, from, to } );

export const move = ( id: string, delta: number ): BuilderAction => ( {
	type: 'move',
	id,
	delta,
} );

export const select = ( id: string | null ): BuilderAction => ( {
	type: 'select',
	id,
} );

export const importFields = (
	fields: Field[],
	core?: CoreConfig
): BuilderAction => ( { type: 'import', fields, core } );

/**
 * Change one thing about one of WooCommerce's own fields.
 *
 * @param key     Core field key.
 * @param changes Properties to set.
 * @return The action.
 */
export const updateCore = (
	key: string,
	changes: CoreFieldOverride
): BuilderAction => ( { type: 'updateCore', key, changes } );

/**
 * Put one of WooCommerce's own fields back the way WooCommerce ships it.
 *
 * @param key Core field key.
 * @return The action.
 */
export const resetCore = ( key: string ): BuilderAction => ( {
	type: 'resetCore',
	key,
} );

/**
 * Show or hide the order-note box or the coupon form.
 *
 * @param key    Pseudo-row key.
 * @param hidden Whether to hide it.
 * @return The action.
 */
export const setPseudo = (
	key: CorePseudoKey,
	hidden: boolean
): BuilderAction => ( { type: 'setPseudo', key, hidden } );

/**
 * Reorder the address section, which is one list of WooCommerce's own fields
 * and the merchant's own mixed together.
 *
 * @param order Outline row ids, top to bottom.
 * @return The action.
 */
export const reorderAddress = ( order: string[] ): BuilderAction => ( {
	type: 'reorderAddress',
	order,
} );

/**
 * Adopt what the server stored.
 *
 * `sent` is what the save carried, and the reducer compares it against the
 * answer twice over. For the fields, it is how an untouched working copy is told
 * from one the merchant edited while the request was in flight. For the core
 * rows, it is how the builder learns what WooCommerce now says: the server keeps
 * only what genuinely differs from WooCommerce, so a property it dropped is a
 * property WooCommerce itself now agrees with.
 *
 * @param config The stored config, as the server normalized it.
 * @param sent   The fields and the `core` payload the save carried.
 * @return The action.
 */
export const saved = (
	config: Config,
	sent: SavedPayload
): BuilderAction => ( {
	type: 'saved',
	config,
	sent,
} );

export const setServerErrors = (
	errors: ValidationError[]
): BuilderAction => ( { type: 'serverErrors', errors } );
