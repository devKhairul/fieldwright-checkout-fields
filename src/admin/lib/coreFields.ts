/**
 * WooCommerce's own checkout fields, as the builder speaks about them.
 *
 * Eleven fields WooCommerce renders itself — the email address and the ten
 * address fields — plus the two things that are not fields at all but read like
 * rows in the same outline: the order-note box and the checkout's coupon form.
 * The server describes every one of them in the bootstrap data, effective values
 * and all. This module is the other half: what a merchant may change about each
 * one, what WooCommerce called it before we changed anything, and how the one
 * ordered address list is put back together from core keys and the merchant's
 * own address fields mixed together.
 *
 * A bootstrap written before core fields existed carries none of those keys.
 * Rather than crash — or shrink the checkout picture to nothing — the preview
 * falls back to the fixed table below, which is exactly what it drew before, and
 * the outline simply has no core rows to offer. `hasCoreFields()` is the one
 * question every caller asks to tell the two apart.
 *
 * @see includes/Fields/CoreFields.php
 */

import { __, sprintf } from '@wordpress/i18n';

import type {
	AdminBootstrap,
	CoreConfig,
	CoreFieldKey,
	CoreFieldLocks,
	CoreFieldMeta,
	CoreFieldOverride,
	CoreProSettings,
	CorePseudoKey,
	CorePseudoMeta,
	Field,
	FieldLocation,
	ValidationError,
} from '../types';

/**
 * How a core row is addressed everywhere a merchant field would be addressed by
 * its key. A merchant's own key is always `<prefix>/<slug>`, so the colon here
 * can never collide with one.
 */
export const CORE_ROW_PREFIX = 'core:';

/** Every core field, in WooCommerce's own default order. */
export const CORE_FIELD_KEYS: CoreFieldKey[] = [
	'email',
	'country',
	'first_name',
	'last_name',
	'company',
	'address_1',
	'address_2',
	'city',
	'state',
	'postcode',
	'phone',
];

export const CORE_PSEUDO_KEYS: CorePseudoKey[] = [
	'order_note',
	'coupon_form',
];

/** Which section of the outline each pseudo-row belongs to. */
export const PSEUDO_LOCATION: Record< CorePseudoKey, FieldLocation > = {
	order_note: 'order',
	coupon_form: 'order_summary',
};

/** The server sanitizes a core label to this; the editor stops at it first. */
export const MAX_CORE_LABEL_LENGTH = 100;

const NO_LOCKS: CoreFieldLocks = {
	hidden: false,
	required: false,
	label: false,
	order: false,
};

/**
 * What WooCommerce will not let go of, for a bootstrap that did not say.
 *
 * The Store API throws without an email address; WooCommerce re-forces
 * `country` into every locale and the block checkout breaks without it; and
 * `address_2` is rendered *inside* `address_1`, so it has no position of its
 * own to move.
 */
const FALLBACK_LOCKS: Record< CoreFieldKey, CoreFieldLocks > = {
	email: { hidden: true, required: true, label: false, order: true },
	country: { hidden: true, required: true, label: false, order: false },
	first_name: NO_LOCKS,
	last_name: NO_LOCKS,
	company: NO_LOCKS,
	address_1: NO_LOCKS,
	address_2: { ...NO_LOCKS, order: true },
	city: NO_LOCKS,
	state: NO_LOCKS,
	postcode: NO_LOCKS,
	phone: NO_LOCKS,
};

/** The only three properties of a core field a merchant may change. */
export const CORE_OVERRIDE_PROPS = [ 'label', 'required', 'hidden' ] as const;

/**
 * The three fields whose visibility is one of WooCommerce's own options rather
 * than anything we store.
 *
 * The option holds `optional | required | hidden` — one value for two questions
 * — so a request that mentions only one of them leaves the other at whatever the
 * option happened to say. `toCorePayload()` therefore sends both, every time.
 */
export const OPTION_BACKED_KEYS: CoreFieldKey[] = [
	'company',
	'address_2',
	'phone',
];

/**
 * The checkout the preview drew before it was handed a real table.
 *
 * The labels are the ones a US store sees, because that is what the preview has
 * always printed, and a bootstrap old enough to be missing `coreFields` is also
 * missing the base country's locale labels. Nothing here is editable: without a
 * server that understands `core`, there is nothing to save.
 *
 * @return WooCommerce's core fields, in default order.
 */
function fallbackCoreFields(): CoreFieldMeta[] {
	const field = (
		key: CoreFieldKey,
		label: string,
		index: number,
		extra: Partial< CoreFieldMeta > = {}
	): CoreFieldMeta => ( {
		key,
		location: 'email' === key ? 'contact' : 'address',
		label,
		resolvedLabel: label,
		required: true,
		hidden: false,
		locks: FALLBACK_LOCKS[ key ],
		index,
		source: 'field',
		...extra,
	} );

	return [
		field(
			'email',
			__( 'Email address', 'fieldwright-checkout-fields' ),
			0
		),
		field(
			'country',
			__( 'Country/Region', 'fieldwright-checkout-fields' ),
			1
		),
		field(
			'first_name',
			__( 'First name', 'fieldwright-checkout-fields' ),
			10
		),
		field(
			'last_name',
			__( 'Last name', 'fieldwright-checkout-fields' ),
			20
		),
		field( 'company', __( 'Company', 'fieldwright-checkout-fields' ), 30, {
			required: false,
			hidden: true,
			source: 'option',
		} ),
		field(
			'address_1',
			__( 'Address', 'fieldwright-checkout-fields' ),
			40
		),
		field(
			'address_2',
			__( 'Apartment, suite, etc.', 'fieldwright-checkout-fields' ),
			50,
			{ required: false, source: 'option' }
		),
		field( 'city', __( 'City', 'fieldwright-checkout-fields' ), 70 ),
		field( 'state', __( 'State', 'fieldwright-checkout-fields' ), 80 ),
		field(
			'postcode',
			__( 'ZIP Code', 'fieldwright-checkout-fields' ),
			90
		),
		field( 'phone', __( 'Phone', 'fieldwright-checkout-fields' ), 100, {
			required: false,
			source: 'option',
		} ),
	];
}

/**
 * Whether this bootstrap knows about WooCommerce's own fields at all.
 *
 * @param bootstrap Bootstrap data.
 * @return True when there are core rows to offer.
 */
export function hasCoreFields(
	bootstrap: Pick< AdminBootstrap, 'coreFields' >
): boolean {
	return (
		Array.isArray( bootstrap.coreFields ) && bootstrap.coreFields.length > 0
	);
}

/**
 * Fill in anything the server left out of one core field's description.
 *
 * @param input Entry from the bootstrap data.
 * @return A complete entry.
 */
function normalizeMeta( input: Partial< CoreFieldMeta > ): CoreFieldMeta {
	const key = input.key as CoreFieldKey;
	const label = String( input.label ?? key );

	return {
		key,
		location: 'contact' === input.location ? 'contact' : 'address',
		label,
		resolvedLabel: String( input.resolvedLabel ?? label ),
		required: Boolean( input.required ),
		hidden: Boolean( input.hidden ),
		locks: { ...( FALLBACK_LOCKS[ key ] ?? NO_LOCKS ), ...input.locks },
		index: Number.isFinite( input.index ) ? Number( input.index ) : 0,
		source: 'option' === input.source ? 'option' : 'field',
	};
}

/**
 * WooCommerce's own fields, as described by the server or, failing that, by the
 * table above.
 *
 * @param bootstrap Bootstrap data.
 * @return One entry per core field, in WooCommerce's default order.
 */
export function resolveCoreFields(
	bootstrap: Pick< AdminBootstrap, 'coreFields' >
): CoreFieldMeta[] {
	if ( ! hasCoreFields( bootstrap ) ) {
		return fallbackCoreFields();
	}

	return ( bootstrap.coreFields ?? [] )
		.filter( ( meta ) => CORE_FIELD_KEYS.includes( meta?.key ) )
		.map( normalizeMeta )
		.sort( ( a, b ) => a.index - b.index );
}

/**
 * The state of the two pseudo-rows.
 *
 * @param bootstrap Bootstrap data.
 * @param core      Stored core config, which the merchant may have edited since.
 * @return Hidden flags, keyed by pseudo-row.
 */
export function resolvePseudo(
	bootstrap: Pick< AdminBootstrap, 'corePseudo' >,
	core?: CoreConfig
): Record< CorePseudoKey, CorePseudoMeta > {
	return {
		order_note: {
			hidden: Boolean(
				core?.order_note?.hidden ??
					bootstrap.corePseudo?.order_note?.hidden
			),
		},
		coupon_form: {
			hidden: Boolean(
				core?.coupon_form?.hidden ??
					bootstrap.corePseudo?.coupon_form?.hidden
			),
		},
	};
}

/* ------------------------------------------------------------ Stored config. */

/**
 * An empty `core` config: nothing overridden, nothing reordered, both
 * pseudo-rows shown.
 *
 * @return A complete config.
 */
export function emptyCore(): CoreConfig {
	return {
		fields: {},
		order: { address: [] },
		order_note: { hidden: false },
		coupon_form: { hidden: false },
	};
}

/**
 * Coerce anything claiming to be a `core` config into a complete one.
 *
 * Unknown field keys are kept rather than dropped: an imported file that names a
 * field WooCommerce does not have should say so through the validator, not
 * quietly lose the entry. `hidden` implies `required: false` here exactly as it
 * does on the server, so the two can never disagree about a hidden field.
 *
 * @param input Stored or imported value.
 * @return A complete config.
 */
export function normalizeCore( input: unknown ): CoreConfig {
	const raw = ( input ?? {} ) as Partial< CoreConfig >;
	const fields: Record< string, CoreFieldOverride > = {};

	Object.entries( raw.fields ?? {} ).forEach( ( [ key, value ] ) => {
		const stored = ( value ?? {} ) as Record< string, unknown >;
		const override: CoreFieldOverride = {};

		if ( undefined !== stored.label ) {
			override.label = String( stored.label );
		}
		if ( undefined !== stored.hidden ) {
			override.hidden = Boolean( stored.hidden );
		}
		if ( undefined !== stored.required ) {
			override.required =
				true === override.hidden ? false : Boolean( stored.required );
		}

		/*
		 * Anything else is kept rather than quietly dropped, for the same reason
		 * an unknown key is: an imported file that sets a property WooCommerce
		 * has no idea about should be told so by the validator.
		 */
		Object.keys( stored ).forEach( ( prop ) => {
			if (
				! ( CORE_OVERRIDE_PROPS as readonly string[] ).includes( prop )
			) {
				( override as Record< string, unknown > )[ prop ] =
					stored[ prop ];
			}
		} );

		if ( Object.keys( override ).length > 0 ) {
			fields[ key ] = override;
		}
	} );

	const order = raw.order?.address;

	return {
		fields,
		order: {
			address: Array.isArray( order ) ? order.map( String ) : [],
		},
		order_note: { hidden: Boolean( raw.order_note?.hidden ) },
		coupon_form: { hidden: Boolean( raw.coupon_form?.hidden ) },
	};
}

/**
 * Whether two `core` configs say the same thing.
 *
 * Both are small, flat and JSON-shaped, which is what makes a string compare
 * both correct and the cheapest thing to read — the same trick `useBuilder`
 * plays on the field list.
 *
 * @param a First config.
 * @param b Second config.
 * @return True when identical.
 */
export function sameCore( a: CoreConfig, b: CoreConfig ): boolean {
	return a === b || JSON.stringify( a ) === JSON.stringify( b );
}

/* -------------------------------------------------------------- Row ids. */

/**
 * The outline id of a core row.
 *
 * @param key Core field or pseudo-row key.
 * @return Row id.
 */
export function coreRowId( key: string ): string {
	return `${ CORE_ROW_PREFIX }${ key }`;
}

/**
 * Whether an outline id belongs to one of WooCommerce's own rows.
 *
 * @param id Row id.
 * @return True for a core row.
 */
export function isCoreRowId( id: string | null | undefined ): boolean {
	return 'string' === typeof id && id.startsWith( CORE_ROW_PREFIX );
}

/**
 * The key behind a core row id.
 *
 * @param id Row id.
 * @return The key, or null when the id is a merchant field's.
 */
export function coreKeyOf( id: string | null | undefined ): string | null {
	return isCoreRowId( id )
		? ( id as string ).slice( CORE_ROW_PREFIX.length )
		: null;
}

/* ----------------------------------------------------------------- Rows. */

/** What WooCommerce would show for a field with no override of ours. */
export interface CoreDefaults {
	label: string;
	required: boolean;
	hidden: boolean;
}

/**
 * One of WooCommerce's own fields, ready to draw.
 */
export interface CoreRow {
	/** Outline id, e.g. `core:postcode`. */
	id: string;
	key: CoreFieldKey;
	location: 'contact' | 'address';
	/** What shoppers see today. */
	label: string;
	required: boolean;
	hidden: boolean;
	locks: CoreFieldLocks;
	/** What WooCommerce would show with nothing of ours in the way. */
	defaults: CoreDefaults;
	/** True while this row carries an override of ours. */
	overridden: boolean;
	source: 'option' | 'field';
	index: number;
	/**
	 * An add-on's settings for this row, when it has written any. Opaque: the
	 * builder carries it from the stored config to the editor sections and back
	 * into the save without reading a key of it.
	 */
	pro?: CoreProSettings | null;
}

/** One of the two rows that stand for something other than a field. */
export interface PseudoRow {
	id: string;
	key: CorePseudoKey;
	label: string;
	hidden: boolean;
}

/**
 * What WooCommerce would show for each core field with no override of ours.
 *
 * Worked out once, from the config as the page loaded it. The bootstrap reports
 * *effective* values — our overrides already applied — so the only way to see
 * what is underneath one is to look at whether one was stored at all. The server
 * keeps a property only where it genuinely differs from WooCommerce's own value,
 * which is what makes a stored boolean readable both ways: an override that is
 * there says WooCommerce's own answer is the other one.
 *
 * A relabel is the exception, because a string has no other one: WooCommerce's
 * own name comes from the base country's locale table where it has an entry, and
 * from WooCommerce's own field table where it does not.
 *
 * @param fields         Core fields, as described by the server.
 * @param stored         The `core` config as the page loaded it.
 * @param labelOverrides Labels the base country's own locale sets.
 * @return Defaults, keyed by core field key.
 */
export function coreDefaults(
	fields: CoreFieldMeta[],
	stored: CoreConfig,
	labelOverrides: Record< string, string > = {}
): Record< string, CoreDefaults > {
	const defaults: Record< string, CoreDefaults > = {};

	fields.forEach( ( meta ) => {
		const override = stored.fields[ meta.key ] ?? {};

		defaults[ meta.key ] = {
			label:
				undefined === override.label
					? meta.resolvedLabel || meta.label
					: labelOverrides[ meta.key ] || meta.label,
			required:
				undefined === override.required
					? meta.required
					: ! override.required,
			hidden:
				undefined === override.hidden ? meta.hidden : ! override.hidden,
		};
	} );

	return defaults;
}

/**
 * The core rows to draw, with every override applied.
 *
 * @param fields   Core fields, as described by the server.
 * @param core     Working copy of the `core` config.
 * @param defaults What WooCommerce would show, from `coreDefaults()`.
 * @return One row per core field, in stored order.
 */
export function buildCoreRows(
	fields: CoreFieldMeta[],
	core: CoreConfig,
	defaults: Record< string, CoreDefaults >
): CoreRow[] {
	return fields.map( ( meta ) => {
		const override = core.fields[ meta.key ] ?? {};
		const fallback: CoreDefaults = defaults[ meta.key ] ?? {
			label: meta.resolvedLabel || meta.label,
			required: meta.required,
			hidden: meta.hidden,
		};
		const hidden = override.hidden ?? fallback.hidden;

		return {
			id: coreRowId( meta.key ),
			key: meta.key,
			location: meta.location,
			label: override.label ?? fallback.label,
			// A field nobody sees cannot be one anybody has to fill in, which is
			// what the server stores and what WooCommerce's own client assumes.
			required: hidden ? false : override.required ?? fallback.required,
			hidden,
			locks: meta.locks,
			defaults: fallback,
			overridden: Object.keys( override ).length > 0,
			source: meta.source,
			index: meta.index,
			...( override.pro ? { pro: override.pro } : {} ),
		};
	} );
}

/**
 * The two pseudo-rows, named for the merchant.
 *
 * @param core Working copy of the `core` config.
 * @return One row each, in outline order.
 */
export function buildPseudoRows( core: CoreConfig ): PseudoRow[] {
	return [
		{
			id: coreRowId( 'order_note' ),
			key: 'order_note',
			label: __( 'Order note', 'fieldwright-checkout-fields' ),
			hidden: core.order_note.hidden,
		},
		{
			id: coreRowId( 'coupon_form' ),
			key: 'coupon_form',
			label: __( 'Coupon form', 'fieldwright-checkout-fields' ),
			hidden: core.coupon_form.hidden,
		},
	];
}

/* --------------------------------------------------------- Address order. */

/**
 * Put `address_2` back where WooCommerce draws it: inside the address line
 * above it, and therefore directly after it wherever that has moved to.
 *
 * @param ids Row ids in display order.
 * @return The same ids, with the apartment line pinned.
 */
function pinAddress2( ids: string[] ): string[] {
	const child = coreRowId( 'address_2' );
	const parent = coreRowId( 'address_1' );

	if ( ! ids.includes( child ) || ! ids.includes( parent ) ) {
		return ids;
	}

	const rest = ids.filter( ( id ) => id !== child );
	rest.splice( rest.indexOf( parent ) + 1, 0, child );

	return rest;
}

/**
 * A stored order entry as an outline row id. Core fields are stored by their
 * bare key; a merchant's own field by its own key, which needs no translating.
 *
 * @param entry Stored entry.
 * @return Row id.
 */
function toRowId( entry: string ): string {
	return CORE_FIELD_KEYS.includes( entry as CoreFieldKey )
		? coreRowId( entry )
		: entry;
}

/**
 * An outline row id as the config stores it.
 *
 * @param id Row id.
 * @return Stored entry.
 */
export function toStoredId( id: string ): string {
	return coreKeyOf( id ) ?? id;
}

/**
 * The address section, in the order it is drawn.
 *
 * WooCommerce sorts its address form by one index, and a merchant's own address
 * fields are sorted into the same list — so this is one list, not two. Anything
 * the stored order does not mention is appended in WooCommerce's own order, and
 * the apartment line is pinned under the address line whatever the stored order
 * says.
 *
 * @param rows   Core rows.
 * @param fields Every merchant field.
 * @param stored `core.order.address` as stored.
 * @return Row ids, top to bottom.
 */
export function addressRowOrder(
	rows: CoreRow[],
	fields: Field[],
	stored: string[]
): string[] {
	const known = [
		...rows
			.filter( ( row ) => 'address' === row.location )
			.map( ( row ) => row.id ),
		...fields
			.filter( ( field ) => 'address' === field.location )
			.map( ( field ) => field.id ),
	];

	const seen = new Set< string >();
	const ordered: string[] = [];

	stored.map( toRowId ).forEach( ( id ) => {
		if ( known.includes( id ) && ! seen.has( id ) ) {
			seen.add( id );
			ordered.push( id );
		}
	} );

	known.forEach( ( id ) => {
		if ( ! seen.has( id ) ) {
			seen.add( id );
			ordered.push( id );
		}
	} );

	return pinAddress2( ordered );
}

/**
 * The order after one row is dropped on another.
 *
 * The apartment line is not a drop target and never moves on its own, so it is
 * lifted out before the move and pinned back after it.
 *
 * @param order    Row ids, top to bottom.
 * @param activeId Row being moved.
 * @param overId   Row it was dropped on.
 * @return The new order, or the old one when the move is a no-op.
 */
export function moveAddressRow(
	order: string[],
	activeId: string,
	overId: string
): string[] {
	const from = order.indexOf( activeId );
	const to = order.indexOf( overId );

	if ( from < 0 || to < 0 || from === to ) {
		return order;
	}

	const next = order.slice();
	const [ moved ] = next.splice( from, 1 );
	next.splice( to, 0, moved );

	return pinAddress2( next );
}

/**
 * The order after one row moves a step up or down.
 *
 * A step past the pinned apartment line is a step past the pair it belongs to,
 * so the neighbour is picked from the list with it taken out.
 *
 * @param order Row ids, top to bottom.
 * @param id    Row to move.
 * @param delta -1 for up, 1 for down.
 * @return The new order, or the old one at the edges.
 */
export function stepAddressRow(
	order: string[],
	id: string,
	delta: number
): string[] {
	const child = coreRowId( 'address_2' );
	const movable = order.filter( ( entry ) => entry !== child );
	const from = movable.indexOf( id );
	const to = from + delta;

	if ( from < 0 || to < 0 || to >= movable.length ) {
		return order;
	}

	return moveAddressRow( order, id, movable[ to ] );
}

/* ----------------------------------------------------------- The outline. */

/**
 * One row of the Fields outline, whoever it belongs to.
 */
export type OutlineRow =
	| { kind: 'field'; id: string; field: Field }
	| { kind: 'core'; id: string; core: CoreRow }
	| { kind: 'pseudo'; id: string; pseudo: PseudoRow };

/**
 * The rows one section of the outline shows, in the order it draws them.
 *
 * Contact leads with the email address and Order information ends with the
 * order-note box, because that is where WooCommerce puts them and neither can be
 * moved. Address is the interesting one: WooCommerce's own fields and the
 * merchant's own are one sorted list there, so this is where the two meet.
 *
 * @param location     Placement being drawn.
 * @param fields       That placement's fields, in their own order.
 * @param coreRows     Every core row.
 * @param pseudoRows   The order-note box and the coupon form.
 * @param addressOrder The address section's order, from `addressRowOrder()`.
 * @param hasCore      False on a server that has no core rows to offer.
 * @return Rows, top to bottom.
 */
export function buildOutline(
	location: FieldLocation,
	fields: Field[],
	coreRows: CoreRow[],
	pseudoRows: PseudoRow[],
	addressOrder: string[],
	hasCore: boolean
): OutlineRow[] {
	const asField = ( field: Field ): OutlineRow => ( {
		kind: 'field',
		id: field.id,
		field,
	} );

	if ( ! hasCore ) {
		return fields.map( asField );
	}

	const pseudo = ( key: CorePseudoKey ): OutlineRow[] =>
		pseudoRows
			.filter( ( row ) => row.key === key )
			.map( ( row ) => ( { kind: 'pseudo', id: row.id, pseudo: row } ) );

	if ( 'contact' === location ) {
		return [
			...coreRows
				.filter( ( row ) => 'contact' === row.location )
				.map(
					( row ): OutlineRow => ( {
						kind: 'core',
						id: row.id,
						core: row,
					} )
				),
			...fields.map( asField ),
		];
	}

	if ( 'address' === location ) {
		const byId = new Map( fields.map( ( field ) => [ field.id, field ] ) );

		return addressOrder
			.map( ( id ): OutlineRow | null => {
				const core = coreRows.find( ( row ) => row.id === id );
				if ( core ) {
					return { kind: 'core', id, core };
				}
				const field = byId.get( id );
				return field ? asField( field ) : null;
			} )
			.filter( ( row ): row is OutlineRow => null !== row );
	}

	if ( 'order' === location ) {
		return [ ...fields.map( asField ), ...pseudo( 'order_note' ) ];
	}

	if ( 'order_summary' === location ) {
		return [ ...fields.map( asField ), ...pseudo( 'coupon_form' ) ];
	}

	return fields.map( asField );
}

/**
 * Whether a row can be picked up and dropped somewhere else.
 *
 * @param row Outline row.
 * @return True when the row has a handle.
 */
export function isSortableRow( row: OutlineRow ): boolean {
	if ( 'field' === row.kind ) {
		return true;
	}
	return 'core' === row.kind && ! row.core.locks.order;
}

/* ------------------------------------------------------------- Editing. */

/**
 * Write one change onto a core field's override.
 *
 * An override that says nothing different from WooCommerce is not an override,
 * so a value that matches the default is dropped rather than stored — which is
 * also what makes "Reset to WooCommerce default" the same thing as "change every
 * setting back by hand".
 *
 * @param core     Working copy of the config.
 * @param key      Core field key.
 * @param changes  Properties to set.
 * @param defaults What WooCommerce would show.
 * @return The next config.
 */
export function setCoreOverride(
	core: CoreConfig,
	key: string,
	changes: CoreFieldOverride,
	defaults: Record< string, CoreDefaults >
): CoreConfig {
	const fallback = defaults[ key ];
	const next: CoreFieldOverride = {
		...( core.fields[ key ] ?? {} ),
		...changes,
	};

	/*
	 * Required is deliberately left alone when a field is hidden. A hidden
	 * field is never required — the row says so, the server normalizes it away
	 * — but the merchant asked to *hide* the field, not to stop asking for it,
	 * so showing it again brings the answer they gave back with it.
	 */
	if ( fallback ) {
		( [ 'label', 'required', 'hidden' ] as const ).forEach( ( prop ) => {
			if ( next[ prop ] === fallback[ prop ] ) {
				delete next[ prop ];
			}
		} );
	}

	/*
	 * An add-on clearing its own settings clears the key, the way the server
	 * does: `CoreFields::parse_props()` stores `pro` only when it comes back a
	 * non-empty array, so a row left with nothing else is a row with no
	 * override at all.
	 */
	if ( ! next.pro || 0 === Object.keys( next.pro ).length ) {
		delete next.pro;
	}

	const fields = { ...core.fields };
	if ( 0 === Object.keys( next ).length ) {
		delete fields[ key ];
	} else {
		fields[ key ] = next;
	}

	return { ...core, fields };
}

/**
 * The `core` config as the wire takes it.
 *
 * Identical to the stored shape but for the three fields WooCommerce keeps in an
 * option of its own. That option answers "hidden, optional or required?" with
 * one value, so a request that mentions only `hidden` leaves the other half at
 * whatever the option happened to say — and once a field is hidden, what it used
 * to ask for is not in there to be read back. Both halves therefore go every
 * time, override or not, so what the builder shows and what the option holds can
 * never drift apart.
 *
 * @param core Working copy of the config.
 * @param rows Core rows, with every override applied.
 * @return The config to send.
 */
export function toCorePayload( core: CoreConfig, rows: CoreRow[] ): CoreConfig {
	const fields: Record< string, CoreFieldOverride > = { ...core.fields };

	rows.forEach( ( row ) => {
		if ( 'option' !== row.source ) {
			return;
		}
		fields[ row.key ] = {
			...( fields[ row.key ] ?? {} ),
			hidden: row.hidden,
			required: row.required,
		};
	} );

	return { ...core, fields };
}

/**
 * Drop everything we changed about one core field.
 *
 * @param core Working copy of the config.
 * @param key  Core field key.
 * @return The next config.
 */
export function resetCoreField( core: CoreConfig, key: string ): CoreConfig {
	if ( ! core.fields[ key ] ) {
		return core;
	}

	const fields = { ...core.fields };
	delete fields[ key ];

	return { ...core, fields };
}

/**
 * Show or hide one of the pseudo-rows.
 *
 * @param core   Working copy of the config.
 * @param key    Pseudo-row key.
 * @param hidden Whether to hide it.
 * @return The next config.
 */
export function setPseudoHidden(
	core: CoreConfig,
	key: CorePseudoKey,
	hidden: boolean
): CoreConfig {
	if ( core[ key ].hidden === hidden ) {
		return core;
	}

	return { ...core, [ key ]: { hidden } };
}

/* ------------------------------------------------------------- Wording. */

/**
 * Why a setting is not the merchant's to change.
 *
 * Every one of these is a limit WooCommerce imposes, so each says what
 * WooCommerce does rather than what we decided.
 *
 * @param key  Core field key.
 * @param prop The locked property.
 * @return One sentence, or '' when nothing is locked.
 */
export function coreLockReason(
	key: string,
	prop: keyof CoreFieldLocks
): string {
	if ( 'email' === key ) {
		return __(
			'WooCommerce needs an email address to send the order confirmation, so this one always shows and is always required.',
			'fieldwright-checkout-fields'
		);
	}

	if ( 'country' === key ) {
		return __(
			'WooCommerce works out tax and shipping from the country, so the block checkout cannot run without it.',
			'fieldwright-checkout-fields'
		);
	}

	if ( 'address_2' === key && 'order' === prop ) {
		return __(
			'WooCommerce draws this inside the address line above it, so it moves with it.',
			'fieldwright-checkout-fields'
		);
	}

	return '';
}

/**
 * The line that explains a label the store's own country has already changed.
 *
 * WooCommerce relabels a handful of fields per country — "Postal code" is "ZIP
 * Code" in the United States — and a merchant who sees the builder say one thing
 * and their checkout say another has found a bug, not a locale.
 *
 * @param localeLabel The base country's own label for the field.
 * @param country     The base country's name. '' where only its code is known,
 *                    which is not worth printing: "in US" reads as a typo.
 * @return One sentence.
 */
export function localeLabelNote(
	localeLabel: string,
	country: string
): string {
	if ( '' === country ) {
		return sprintf(
			/* translators: %s: label WooCommerce uses in the store's own country, e.g. "ZIP Code". */
			__(
				'WooCommerce shows this as “%s” in your store’s country.',
				'fieldwright-checkout-fields'
			),
			localeLabel
		);
	}

	return sprintf(
		/* translators: 1: label WooCommerce uses in the store's own country, e.g. "ZIP Code". 2: country name. */
		__( 'Shows as “%1$s” in %2$s.', 'fieldwright-checkout-fields' ),
		localeLabel,
		country
	);
}

/* ---------------------------------------------------------- Validation. */

/**
 * Client-side mirror of the server's `core` validation. Same codes, same paths.
 *
 * @param core   Working copy of the config.
 * @param fields Core fields, as described by the server.
 * @return Every failure, in key order.
 */
export function validateCore(
	core: CoreConfig,
	fields: CoreFieldMeta[]
): ValidationError[] {
	const errors: ValidationError[] = [];
	const known = new Map( fields.map( ( meta ) => [ meta.key, meta ] ) );

	Object.entries( core.fields ).forEach( ( [ key, override ] ) => {
		const meta = known.get( key as CoreFieldKey );

		if ( ! meta ) {
			errors.push( {
				path: `core.fields.${ key }`,
				code: 'invalid_core_key',
				message: __(
					'That is not one of WooCommerce’s own checkout fields.',
					'fieldwright-checkout-fields'
				),
			} );
			return;
		}

		CORE_OVERRIDE_PROPS.forEach( ( prop ) => {
			if ( undefined !== override[ prop ] && meta.locks[ prop ] ) {
				errors.push( {
					path: `core.fields.${ key }.${ prop }`,
					code: 'locked_core_prop',
					message:
						coreLockReason( key, prop ) ||
						__(
							'WooCommerce does not allow this to be changed.',
							'fieldwright-checkout-fields'
						),
				} );
			}
		} );

		// The three above are the whole of what a merchant owns on one of
		// WooCommerce's fields; anything else came from a hand-edited file. The
		// exception is `pro`, which belongs to an add-on and is checked by
		// whoever owns it — the server skips it here for the same reason.
		Object.keys( override ).forEach( ( prop ) => {
			if (
				'pro' === prop ||
				( CORE_OVERRIDE_PROPS as readonly string[] ).includes( prop )
			) {
				return;
			}
			errors.push( {
				path: `core.fields.${ key }.${ prop }`,
				code: 'invalid_core_prop',
				message: __(
					'Only the label, whether it is required and whether it shows can be changed on one of WooCommerce’s own fields.',
					'fieldwright-checkout-fields'
				),
			} );
		} );

		if ( undefined === override.label ) {
			return;
		}

		if ( '' === override.label.trim() ) {
			errors.push( {
				path: `core.fields.${ key }.label`,
				code: 'required',
				message: __(
					'Add a label so shoppers know what to enter.',
					'fieldwright-checkout-fields'
				),
			} );
		} else if ( override.label.length > MAX_CORE_LABEL_LENGTH ) {
			errors.push( {
				path: `core.fields.${ key }.label`,
				code: 'too_long',
				message: sprintf(
					/* translators: %d: character limit. */
					__(
						'Keep the label to %d characters or fewer.',
						'fieldwright-checkout-fields'
					),
					MAX_CORE_LABEL_LENGTH
				),
			} );
		}
	} );

	return errors;
}
