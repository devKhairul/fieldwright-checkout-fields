/**
 * Field factories and the ordering helpers the builder relies on.
 *
 * The config array may interleave placements. Display groups by placement while
 * keeping each group's relative order; every reorder helper rewrites the array
 * so the other groups come out untouched.
 *
 * Everything here mirrors the normalisation the server applies in
 * `includes/Fields/FieldDefinition.php`: a field that has been through
 * `normalizeField()` is the field the server would store.
 */

import { __ } from '@wordpress/i18n';

import type {
	ContentLevel,
	CoreConfig,
	Field,
	FieldLocation,
	FieldOption,
	FieldPayload,
	FieldType,
	FieldVisibility,
	FieldWidth,
	OptionsLayout,
	ProSettings,
} from '../types';
import type { CoreRow, PseudoRow } from './coreFields';
import { PSEUDO_LOCATION, normalizeCore } from './coreFields';
import type { FilterField } from './hooks';
import {
	fieldDefaults as applyFieldDefaultsFilter,
	typeChange as applyTypeChangeFilter,
} from './hooks';
import { uniqueFieldId } from './slug';
import {
	CORE_PLACEMENTS,
	FIELD_TYPES,
	PLACEMENT_ORDER,
	allowsPlacement,
	descriptorFor,
	familyOf,
	isBuiltinType,
	isContentType,
	isCoreType,
} from './typeMeta';

export {
	CORE_PLACEMENTS,
	FIELD_TYPES,
	PLACEMENT_ORDER,
	allowsPlacement,
	familyOf,
	isBuiltinType,
	isContentType,
	isCoreType,
};

/** Kept for callers that still speak of the three original locations. */
export const LOCATION_ORDER: FieldLocation[] = PLACEMENT_ORDER;

/**
 * Fallback for `AdminBootstrap.selectPlaceholderDefault`, for the code paths
 * that run without bootstrap data (imports, tests).
 */
export const SELECT_PLACEHOLDER_DEFAULT = __(
	'Choose an option',
	'fieldwright-checkout-fields'
);

/** Textarea height, in rows. */
export const MIN_ROWS = 2;
export const MAX_ROWS = 10;
export const DEFAULT_ROWS = 3;

/** How far apart a time field's choices are, in minutes. */
export const DEFAULT_TIME_STEP = '15';

/** The longest step a time field can ask for: a whole day. */
export const MAX_TIME_STEP = 1440;

/** Longest value `max_length` may ask for, by family of type. */
export const MAX_TEXT_LENGTH = 1000;
export const MAX_TEXTAREA_LENGTH = 5000;

/**
 * The types whose `format` is decided by the type itself.
 *
 * Each is a text box the checkout renders with a matching `type` attribute, so
 * the browser helps before the pattern does — a phone keypad on mobile, a URL
 * keyboard, a numeric spinner. The Format select is hidden for them, because
 * the answer is already in the type's name.
 */
export const FORCED_FORMAT: Partial< Record< FieldType, string > > = {
	email: 'email',
	phone: 'phone',
	number: 'number',
	url: 'url',
};

/** Types drawn as a single-line text box, whatever their format. */
export const TEXT_INPUT_TYPES: FieldType[] = [
	'text',
	'email',
	'phone',
	'number',
	'url',
];

/** Types that keep a list of options. */
export const OPTION_TYPES: FieldType[] = [
	'select',
	'radio',
	'checkbox_group',
];

/**
 * Free's own types that carry an `error_message`.
 *
 * A checkbox uses it for "you have to tick this"; a text field for "that is not
 * the format asked for"; a date for "not in the range you asked for". A
 * dropdown, a radio group and the content types have no failure of their own to
 * report — the browser only ever hands back one of the options — so the server
 * stores '' for them, and so does everything here.
 */
export const ERROR_MESSAGE_TYPES: FieldType[] = [
	...TEXT_INPUT_TYPES,
	'checkbox',
	'textarea',
	'date',
	'time',
];

/**
 * Whether a field of this type keeps an error message.
 *
 * Anything that is not one of Free's own does: the message belongs to a failure
 * only the add-on that provided the type knows about, and a field whose add-on
 * is switched off keeps the wording the merchant typed rather than losing it to
 * a plugin being deactivated.
 *
 * @param type Field type.
 * @return True when the type stores one.
 */
export function hasErrorMessage( type: FieldType ): boolean {
	return ! isBuiltinType( type ) || ERROR_MESSAGE_TYPES.includes( type );
}

/**
 * Whether the type is drawn as a single-line text box.
 *
 * @param type Field type.
 * @return True for text, email, phone, number and url.
 */
export function isTextInput( type: FieldType ): boolean {
	return TEXT_INPUT_TYPES.includes( type );
}

/**
 * Whether the type keeps a list of options.
 *
 * @param type Field type.
 * @return True for dropdowns, radio groups and checkbox groups.
 */
export function usesOptions( type: FieldType ): boolean {
	return OPTION_TYPES.includes( type );
}

/**
 * Whether the type accepts a length limit, and how long it may be.
 *
 * @param type Field type.
 * @return The ceiling, or null when the type has no length to limit.
 */
export function maxLengthCeiling( type: FieldType ): number | null {
	if ( 'textarea' === type ) {
		return MAX_TEXTAREA_LENGTH;
	}
	return isTextInput( type ) ? MAX_TEXT_LENGTH : null;
}

/**
 * Whether the type can be drawn at half width. Core-family fields are laid out
 * by WooCommerce, which has its own opinion, so they are always full width.
 *
 * @param type Field type.
 * @return True when the width control applies.
 */
export function usesWidth( type: FieldType ): boolean {
	return ! isCoreType( type );
}

/**
 * Whether the type asks the customer for anything at all.
 *
 * @param type Field type.
 * @return False for headings and paragraphs.
 */
export function collectsAnswer( type: FieldType ): boolean {
	return ! isContentType( type );
}

/**
 * Whether a field of this type carries a prefilled answer.
 *
 * Every one of Free's own that collects an answer does. A registered type only
 * does when its add-on said so: some answers cannot be stood in for, and a
 * control offering to prefill one would be offering something the server throws
 * away. A type nothing is providing right now keeps no setting of its own at
 * all, this one included.
 *
 * @param type Field type.
 * @return True when the Default value control applies.
 */
export function hasDefaultValue( type: FieldType ): boolean {
	if ( isBuiltinType( type ) ) {
		return collectsAnswer( type );
	}

	return true === descriptorFor( type )?.hasDefaultValue;
}

/**
 * The placements an answer can be remembered from. Mirrors
 * `Fields\FieldDefinition::profile_locations()`.
 */
const PROFILE_LOCATIONS: FieldLocation[] = [
	'contact',
	'address',
	'shipping_address',
	'billing_address',
];

/**
 * Whether this field may be remembered on the customer's profile.
 *
 * Only the rich types, and only where the answer is about the person rather
 * than the order: WooCommerce already saves its own contact and address fields
 * that way, so these sit beside them, and so do the two placements that reach
 * one address form only.
 *
 * A registered type is asked rather than assumed. An answer that belongs to one
 * order and no other cannot be carried to the next one, and only the add-on that
 * provided the type knows which kind of answer it is. The server applies the
 * same rule from the same flag.
 *
 * @param type     Field type.
 * @param location Placement key.
 * @return True when the setting applies.
 */
export function canSaveToProfile(
	type: FieldType,
	location: FieldLocation
): boolean {
	if ( ! PROFILE_LOCATIONS.includes( location ) ) {
		return false;
	}

	if ( isBuiltinType( type ) ) {
		return 'rich' === familyOf( type );
	}

	return true === descriptorFor( type )?.canSaveToProfile;
}

/**
 * The format a field of this type stores.
 *
 * @param type    Field type.
 * @param current Format the field carries today.
 * @return Format to store.
 */
export function formatFor( type: FieldType, current: string ): string {
	const forced = FORCED_FORMAT[ type ];
	if ( forced ) {
		return forced;
	}
	return 'text' === type ? current || 'any' : 'any';
}

/**
 * Every key of a field, with the value a brand new field starts from.
 */
export const FIELD_DEFAULTS: Omit< Field, 'id' > = {
	label: '',
	type: 'text',
	location: 'order',
	required: false,
	enabled: true,
	placeholder: '',
	options: [],
	error_message: '',
	format: 'any',
	pattern: '',
	max_length: null,
	autocomplete: '',
	show_in_order_confirmation: true,
	help: '',
	default_value: '',
	width: 'full',
	/*
	 * Every one of these starts on, and `show_in_order_confirmation` — which is
	 * `thank_you` under the name the checkout has always read it by — starts on
	 * with them. An answer a merchant asked a customer for and then cannot read
	 * back anywhere is not worth collecting, so the merchant turns off what they
	 * do not want rather than hunting for what they do. The server ships the
	 * same defaults; see `Fields\FieldDefinition`.
	 */
	visibility: {
		thank_you: true,
		emails: true,
		admin: true,
		account: true,
	},
	save_to_profile: false,
	options_layout: 'stacked',
	rows: DEFAULT_ROWS,
	min: '',
	max: '',
	step: '',
	date_min: '',
	date_max: '',
	time_min: '',
	time_max: '',
	content_level: 3,
	content: '',
};

/**
 * A detached copy of an add-on's settings blob.
 *
 * Free treats `pro` as opaque: it is carried through import, duplication and
 * every save without being read, so the only thing to get right is that two
 * fields never end up sharing one object.
 *
 * @param pro Settings to copy, if any.
 * @return A deep copy, or undefined.
 */
function clonePro( pro: unknown ): ProSettings | undefined {
	if ( ! pro || 'object' !== typeof pro ) {
		return undefined;
	}
	try {
		return JSON.parse( JSON.stringify( pro ) ) as ProSettings;
	} catch {
		return undefined;
	}
}

/**
 * Read a stored string key, defaulting to ''.
 *
 * @param value Stored value.
 * @return A string.
 */
function text( value: unknown ): string {
	return 'string' === typeof value || 'number' === typeof value
		? String( value )
		: '';
}

/**
 * Read one of the numeric settings back out as the API takes it.
 *
 * '' is how the editor spells "not set", which the config spells as null. A
 * value that is not a number cannot get this far — `validate.ts` refuses to
 * save one — so it is treated as nothing rather than sent on.
 *
 * @param value Stored decimal string.
 * @return The number, or null.
 */
function decimal( value: string ): number | null {
	if ( '' === value.trim() ) {
		return null;
	}
	const parsed = Number( value );
	return Number.isFinite( parsed ) ? parsed : null;
}

/**
 * Where a field's answer shows once the order exists.
 *
 * `show_in_order_confirmation` is the flag the checkout has always read, and
 * `visibility.thank_you` is the same flag inside the new group — so whichever
 * of the two an incoming field carries, both come out agreeing. A field that
 * carries neither gets the default the server uses: shown.
 *
 * @param input Incoming field.
 * @return Complete visibility settings.
 */
function normalizeVisibility( input: Partial< Field > ): FieldVisibility {
	const stored = input.visibility as Partial< FieldVisibility > | undefined;
	const on = ( value: unknown ) =>
		undefined === value ? true : Boolean( value );

	return {
		thank_you:
			undefined === stored?.thank_you
				? on( input.show_in_order_confirmation )
				: Boolean( stored.thank_you ),
		emails: on( stored?.emails ),
		admin: on( stored?.admin ),
		account: on( stored?.account ),
	};
}

/**
 * A type string the configuration can actually carry.
 *
 * The pattern is the server's own registration key pattern, so anything that
 * would be refused on save is refused here — and anything that matches is kept
 * as it is, whether or not this store has the add-on that provided it. That is
 * what lets a field outlive the plugin that gave it its type.
 */
const TYPE_KEY = /^[a-z][a-z0-9_]*$/;

/**
 * Coerce anything that claims to be a field into a complete, typed field.
 * Used for imported JSON, where keys may be missing or the wrong type.
 *
 * @param input Partial or untrusted field data.
 * @return A complete field.
 */
export function normalizeField( input: Partial< Field > ): Field {
	const type: FieldType =
		'string' === typeof input.type && TYPE_KEY.test( input.type )
			? input.type
			: FIELD_DEFAULTS.type;

	const requested: FieldLocation = PLACEMENT_ORDER.includes(
		input.location as FieldLocation
	)
		? ( input.location as FieldLocation )
		: FIELD_DEFAULTS.location;
	// A placement the type cannot use falls back to the one every type can.
	const location = allowsPlacement( type, requested ) ? requested : 'order';

	const options: FieldOption[] =
		usesOptions( type ) && Array.isArray( input.options )
			? input.options.map( ( option ) => ( {
					value: String( option?.value ?? '' ),
					label: String( option?.label ?? '' ),
			  } ) )
			: [];

	const maxLength = input.max_length;
	const ceiling = maxLengthCeiling( type );
	const rows = Number( input.rows );
	const level = Number( input.content_level );
	const pro = clonePro( input.pro );
	const visibility = normalizeVisibility( input );
	const numeric = 'number' === type;
	const isDate = 'date' === type;
	const isTime = 'time' === type;

	return {
		id: String( input.id ?? '' ),
		label: String( input.label ?? '' ),
		type,
		location,
		// Nothing is required of a customer by a heading or a paragraph.
		required: collectsAnswer( type ) ? Boolean( input.required ) : false,
		enabled: undefined === input.enabled ? true : Boolean( input.enabled ),
		// Select-only, exactly as the server normalizes it.
		placeholder: 'select' === type ? String( input.placeholder ?? '' ) : '',
		options,
		error_message: hasErrorMessage( type )
			? String( input.error_message ?? '' )
			: '',
		format: formatFor( type, text( input.format ) ),
		pattern:
			'text' === type && 'custom' === input.format
				? text( input.pattern )
				: '',
		max_length:
			null !== ceiling &&
			'number' === typeof maxLength &&
			Number.isFinite( maxLength )
				? maxLength
				: null,
		autocomplete: String( input.autocomplete ?? '' ),
		show_in_order_confirmation: visibility.thank_you,
		help: text( input.help ),
		// A heading or a paragraph asks for nothing to prefill, and a registered
		// type only takes a prefilled answer when its add-on said it does.
		default_value: hasDefaultValue( type )
			? text( input.default_value )
			: '',
		width: usesWidth( type ) && 'half' === input.width ? 'half' : 'full',
		visibility,
		save_to_profile:
			canSaveToProfile( type, location ) &&
			Boolean( input.save_to_profile ),
		options_layout:
			usesOptions( type ) && 'inline' === input.options_layout
				? 'inline'
				: 'stacked',
		rows:
			'textarea' === type && Number.isFinite( rows ) && rows > 0
				? Math.trunc( rows )
				: DEFAULT_ROWS,
		min: numeric ? text( input.min ) : '',
		max: numeric ? text( input.max ) : '',
		step: numeric || isTime ? text( input.step ) : '',
		date_min: isDate ? text( input.date_min ) : '',
		date_max: isDate ? text( input.date_max ) : '',
		time_min: isTime ? text( input.time_min ) : '',
		time_max: isTime ? text( input.time_max ) : '',
		content_level:
			'heading' === type && [ 2, 3, 4 ].includes( level )
				? ( level as ContentLevel )
				: FIELD_DEFAULTS.content_level,
		content: 'paragraph' === type ? text( input.content ) : '',
		// Never invented, never stripped: the key is only present when the
		// incoming field had one.
		...( pro ? { pro } : {} ),
	};
}

/**
 * Compare two field lists by value. The lists are small and flat enough that a
 * JSON compare is both correct and the cheapest thing to read — the same trick
 * `sameCore()` plays on WooCommerce's own rows.
 *
 * @param a First list.
 * @param b Second list.
 * @return True when identical.
 */
export function sameFields( a: Field[], b: Field[] ): boolean {
	return a === b || JSON.stringify( a ) === JSON.stringify( b );
}

/**
 * Serialize a field for the wire — the inverse of `normalizeField()`.
 *
 * The three numeric settings are strings in the builder and numbers in the
 * config, so this is where they are converted: '' becomes null, and a decimal
 * string becomes the number the server parses. Which of them a field carries
 * follows the type exactly as `normalizeField()` decides it — only a number
 * field has a range, only a number or a time field has a step — so every other
 * type sends null for all three.
 *
 * @param field Field to serialize.
 * @return The field as the config takes it.
 */
export function toPayload( field: Field ): FieldPayload {
	const numeric = 'number' === field.type;
	const isTime = 'time' === field.type;

	return {
		...field,
		min: numeric ? decimal( field.min ) : null,
		max: numeric ? decimal( field.max ) : null,
		step: numeric || isTime ? decimal( field.step ) : null,
	};
}

/**
 * A blank field, ready to be appended and edited.
 *
 * @param taken    Ids already in use.
 * @param prefix   Namespace prefix.
 * @param location Placement to create it in.
 * @param type     Type to create it as.
 * @return New field.
 */
export function createBlankField(
	taken: Iterable< string >,
	prefix: string,
	location: FieldLocation = 'order',
	type: FieldType = 'text'
): Field {
	const label = __( 'New field', 'fieldwright-checkout-fields' );
	const seed: Field = normalizeField( {
		...FIELD_DEFAULTS,
		/*
		 * What the add-on that provided the type wants a new field of it to
		 * start from: its own settings under `pro.<key>`, which Free carries
		 * without reading. Merged over the blank field and under everything the
		 * builder decides itself, so a descriptor cannot hand a field an id, a
		 * label or a placement of its own choosing.
		 */
		...( descriptorFor( type )?.defaults ?? {} ),
		id: uniqueFieldId( label, taken, prefix ),
		label,
		type,
		location: allowsPlacement( type, location ) ? location : 'order',
		step: 'time' === type ? DEFAULT_TIME_STEP : '',
	} );

	return applyFieldDefaultsFilter( seed );
}

/**
 * Turn a bootstrap template into a field with a key that is free to use.
 *
 * @param template Template field from bootstrap data.
 * @param taken    Ids already in use.
 * @param prefix   Namespace prefix.
 * @return New field.
 */
export function fieldFromTemplate(
	template: Field,
	taken: Iterable< string >,
	prefix: string
): Field {
	const used = new Set( taken );
	const field = normalizeField( template );
	const id =
		field.id && ! used.has( field.id )
			? field.id
			: uniqueFieldId( field.label, used, prefix );

	return applyFieldDefaultsFilter( { ...field, id } );
}

/**
 * A copy of a field, appended straight after the original.
 *
 * @param fields All fields.
 * @param id     Field to duplicate.
 * @param prefix Namespace prefix.
 * @return The new list and the new field's id, or nulls when `id` is unknown.
 */
export function duplicateField(
	fields: Field[],
	id: string,
	prefix: string
): { fields: Field[]; id: string | null } {
	const index = fields.findIndex( ( field ) => field.id === id );
	if ( -1 === index ) {
		return { fields, id: null };
	}

	const source = fields[ index ];
	const label = `${ source.label } ${ __(
		'(copy)',
		'fieldwright-checkout-fields'
	) }`;
	const clonedPro = clonePro( source.pro );
	const copy: Field = {
		...source,
		options: source.options.map( ( option ) => ( { ...option } ) ),
		visibility: { ...source.visibility },
		...( clonedPro ? { pro: clonedPro } : {} ),
		id: uniqueFieldId(
			label,
			fields.map( ( field ) => field.id ),
			prefix
		),
		label,
	};

	const next = fields.slice();
	next.splice( index + 1, 0, copy );

	return { fields: next, id: copy.id };
}

/**
 * The placeholder a field of `type` should carry.
 *
 * `placeholder` is select-only: it is the dropdown's first, unselected choice,
 * and the server resets it to '' for every other type. A dropdown that has none
 * starts from the default, so core never falls back to its own
 * "Select a <label>".
 *
 * @param type              Field type.
 * @param current           Placeholder the field carries today.
 * @param selectPlaceholder Default for a dropdown with no placeholder yet.
 * @return Placeholder to store.
 */
export function placeholderFor(
	type: FieldType,
	current: string,
	selectPlaceholder: string = SELECT_PLACEHOLDER_DEFAULT
): string {
	if ( 'select' !== type ) {
		return '';
	}
	return '' === current ? selectPlaceholder : current;
}

/**
 * Reset the keys that only make sense for the previous type. Mirrors the
 * normalisation FieldDefinition applies on the server: the label, the help
 * text, Required and the placement survive — a merchant who tries a question as
 * a dropdown and then as a radio group should not have to write it out again —
 * and everything that belonged to the old type goes back to its default.
 *
 * A placement the new type cannot use moves to Order information, which every
 * type can. `autocomplete` is never touched.
 *
 * `error_message` survives a swap between the types that have a failure to word
 * — a text box that is not the right format, an unticked required box, a date
 * outside its range. Only the types with no failure of their own clear it.
 *
 * `pro` is deliberately not among them — Free never edits an add-on's settings.
 * The `cbwb.typeChange` filter is where an add-on turns off whatever its own
 * settings no longer allow.
 *
 * @param field             Field being changed.
 * @param type              New type.
 * @param selectPlaceholder Default placeholder for a dropdown.
 * @return Updated field.
 */
export function applyTypeChange(
	field: Field,
	type: FieldType,
	selectPlaceholder: string = SELECT_PLACEHOLDER_DEFAULT
): Field {
	if ( field.type === type ) {
		return field;
	}

	const location = allowsPlacement( type, field.location )
		? field.location
		: 'order';
	// One list of options is as good as another to the three types that keep
	// one, so the list follows the field between them.
	const keepsOptions = usesOptions( type ) && usesOptions( field.type );

	return applyTypeChangeFilter(
		{
			...field,
			type,
			location,
			required: collectsAnswer( type ) ? field.required : false,
			options: keepsOptions ? field.options : [],
			options_layout: keepsOptions
				? field.options_layout
				: FIELD_DEFAULTS.options_layout,
			placeholder: placeholderFor(
				type,
				field.placeholder,
				selectPlaceholder
			),
			error_message: hasErrorMessage( type ) ? field.error_message : '',
			format: formatFor( type, 'any' ),
			pattern: '',
			max_length: null,
			// Every remaining key describes the old type's answer, so none of
			// them can be carried across.
			default_value: '',
			width: usesWidth( type ) ? field.width : 'full',
			save_to_profile:
				canSaveToProfile( type, location ) && field.save_to_profile,
			rows: FIELD_DEFAULTS.rows,
			min: '',
			max: '',
			step: 'time' === type ? DEFAULT_TIME_STEP : '',
			date_min: '',
			date_max: '',
			time_min: '',
			time_max: '',
			content_level: FIELD_DEFAULTS.content_level,
			content: '',
		},
		type
	);
}

/**
 * Re-run the shape filter for a change that is not a type change but can still
 * invalidate a setting — moving a field to another placement.
 *
 * @param field Field, already carrying its new placement.
 * @return The field to store.
 */
export function applyLocationChange( field: Field ): Field {
	return applyTypeChangeFilter(
		{
			...field,
			save_to_profile:
				canSaveToProfile( field.type, field.location ) &&
				field.save_to_profile,
		},
		field.type
	);
}

export type FieldsByLocation = Record< FieldLocation, Field[] >;

/**
 * An empty group for every placement, in checkout order.
 *
 * @return Empty groups.
 */
function emptyGroups(): FieldsByLocation {
	return PLACEMENT_ORDER.reduce( ( groups, key ) => {
		groups[ key ] = [];
		return groups;
	}, {} as FieldsByLocation );
}

/**
 * Group fields by placement, preserving each group's relative order.
 *
 * @param fields All fields.
 * @return Fields keyed by placement.
 */
export function byLocation( fields: Field[] ): FieldsByLocation {
	const groups = emptyGroups();
	fields.forEach( ( field ) => {
		( groups[ field.location ] ?? groups.order ).push( field );
	} );
	return groups;
}

/**
 * Rebuild the flat array from per-placement groups, reusing the original
 * array's slot pattern so untouched groups keep both their order and their
 * positions.
 *
 * @param fields Original array (defines the slot pattern).
 * @param groups New per-placement order.
 * @return Rewritten array.
 */
function rebuild( fields: Field[], groups: FieldsByLocation ): Field[] {
	const cursors = PLACEMENT_ORDER.reduce(
		( counts, key ) => {
			counts[ key ] = 0;
			return counts;
		},
		{} as Record< FieldLocation, number >
	);

	return fields.map( ( field ) => {
		const location = field.location;
		const next = groups[ location ][ cursors[ location ] ];
		cursors[ location ] += 1;
		return next;
	} );
}

/**
 * The three placements WooCommerce's own field types can live in.
 *
 * In these, WooCommerce draws its own types itself, as one block, and the
 * types this plugin draws are spliced into the page after that block. The
 * two families cannot be interleaved on the checkout, however the outline
 * orders them, so the outline does not offer an order the checkout cannot
 * keep: see `settleFamilies()`.
 */
export const SHARED_LOCATIONS: readonly FieldLocation[] = [
	'contact',
	'address',
	'order',
];

/**
 * Whether the checkout draws WooCommerce's own types before this plugin's
 * in a placement.
 *
 * @param location Placement.
 * @return True for the three placements WooCommerce's own API covers.
 */
export function isSharedLocation( location: FieldLocation ): boolean {
	return SHARED_LOCATIONS.includes( location );
}

/**
 * Put every shared placement in the order the checkout will draw it: the
 * types WooCommerce carries first, then the types this plugin draws, each
 * half keeping its own order.
 *
 * Applied after every edit, so a field dragged across the line settles back
 * on its side of it, and a field whose type changes family moves to where
 * the checkout will put it. Returns the same array when nothing moves.
 *
 * @param fields Fields in outline order.
 * @return Fields in checkout order.
 */
export function settleFamilies( fields: Field[] ): Field[] {
	const settled: Field[] = [];
	let moved = false;

	// Walk the list once per shared placement, writing the core-family rows
	// where the first row of that placement stood and the rest after them;
	// rows of other placements keep their slots.
	const indexes = fields.map( ( _, index ) => index );
	const taken = new Set< number >();
	const slots = new Map< number, Field >();

	SHARED_LOCATIONS.forEach( ( location ) => {
		const here = indexes.filter(
			( index ) =>
				fields[ index ].location === location && ! taken.has( index )
		);
		if ( here.length < 2 ) {
			return;
		}

		const core = here.filter(
			( index ) => 'core' === familyOf( fields[ index ].type )
		);
		const own = here.filter(
			( index ) => 'core' !== familyOf( fields[ index ].type )
		);
		const order = [ ...core, ...own ];

		here.forEach( ( slot, at ) => {
			taken.add( slot );
			slots.set( slot, fields[ order[ at ] ] );
			if ( order[ at ] !== slot ) {
				moved = true;
			}
		} );
	} );

	if ( ! moved ) {
		return fields;
	}

	fields.forEach( ( field, index ) => {
		settled.push( slots.get( index ) ?? field );
	} );

	return settled;
}

/**
 * Move a field inside its own placement group.
 *
 * @param fields   All fields.
 * @param location Group being reordered.
 * @param from     Index within the group.
 * @param to       Target index within the group.
 * @return Rewritten array.
 */
export function reorderWithinLocation(
	fields: Field[],
	location: FieldLocation,
	from: number,
	to: number
): Field[] {
	const groups = byLocation( fields );
	const group = groups[ location ];

	if (
		from === to ||
		from < 0 ||
		to < 0 ||
		from >= group.length ||
		to >= group.length
	) {
		return fields;
	}

	const reordered = group.slice();
	const [ moved ] = reordered.splice( from, 1 );
	reordered.splice( to, 0, moved );

	return rebuild( fields, { ...groups, [ location ]: reordered } );
}

/**
 * Move a field one slot up or down within its group.
 *
 * @param fields All fields.
 * @param id     Field to move.
 * @param delta  -1 for up, 1 for down.
 * @return Rewritten array.
 */
export function moveField(
	fields: Field[],
	id: string,
	delta: number
): Field[] {
	const field = fields.find( ( candidate ) => candidate.id === id );
	if ( ! field ) {
		return fields;
	}

	const group = byLocation( fields )[ field.location ];
	const from = group.findIndex( ( candidate ) => candidate.id === id );

	return reorderWithinLocation( fields, field.location, from, from + delta );
}

/**
 * Move the field at `index` so it sits last in its own placement group. Use
 * after changing a field's placement.
 *
 * @param fields All fields.
 * @param index  Index of the field to reposition.
 * @return Rewritten array.
 */
export function repositionToGroupEnd(
	fields: Field[],
	index: number
): Field[] {
	const moved = fields[ index ];
	if ( ! moved ) {
		return fields;
	}

	const rest = fields.filter( ( _field, at ) => at !== index );

	let lastOfGroup = -1;
	rest.forEach( ( field, at ) => {
		if ( field.location === moved.location ) {
			lastOfGroup = at;
		}
	} );

	const next = rest.slice();
	next.splice( lastOfGroup >= 0 ? lastOfGroup + 1 : next.length, 0, moved );

	return next;
}

/**
 * Move a field to the end of another placement group.
 *
 * @param fields   All fields.
 * @param id       Field to move.
 * @param location Target placement.
 * @return Rewritten array.
 */
export function moveToLocation(
	fields: Field[],
	id: string,
	location: FieldLocation
): Field[] {
	const index = fields.findIndex( ( field ) => field.id === id );
	if ( -1 === index || fields[ index ].location === location ) {
		return fields;
	}

	const next = fields.slice();
	next[ index ] = { ...next[ index ], location };

	return repositionToGroupEnd( next, index );
}

/**
 * One of WooCommerce's own rows, wearing a field's shape.
 *
 * The `cbwb.*` filters are the one place an add-on meets a core row, and every
 * one of them is written against a field — so a core row arrives as a field with
 * the settings it actually has and a `kind` that says where it came from. The
 * object is built for the filter and thrown away after it: nothing here is ever
 * stored, and Free never puts one in `state.fields`.
 *
 * @param row A core row or a pseudo-row.
 * @return A field-shaped subject marked `kind: 'core'`.
 */
export function coreSubject( row: CoreRow | PseudoRow ): FilterField {
	const core = row as CoreRow;
	const isField = undefined !== core.location;

	return {
		...FIELD_DEFAULTS,
		kind: 'core',
		id: row.id,
		label: row.label,
		location: isField
			? core.location
			: PSEUDO_LOCATION[ ( row as PseudoRow ).key ],
		required: isField ? core.required : false,
		enabled: ! row.hidden,
		/*
		 * The add-on's own settings, carried through untouched so a section can
		 * read them back the way it reads a merchant field's. The cast is the
		 * price of one filter shape covering both: a core row's payload is not
		 * a field's (no fee, no conditions), and Free reads neither.
		 */
		...( isField && core.pro
			? { pro: core.pro as unknown as ProSettings }
			: {} ),
	};
}

/**
 * Build the JSON payload used by Export.
 *
 * Serialized the same way a save is, so an exported file is exactly a config as
 * the REST endpoint reads and returns one — and `parseImport()` reads it back,
 * numbers, WooCommerce's own fields and all.
 *
 * @param fields        Fields to export.
 * @param schemaVersion Config schema version.
 * @param core          What was changed about WooCommerce's own fields, where
 *                      this build knows about them at all.
 * @return Pretty-printed JSON.
 */
export function exportJson(
	fields: Field[],
	schemaVersion: number,
	core?: CoreConfig
): string {
	return JSON.stringify(
		{
			schema_version: schemaVersion,
			fields: fields.map( toPayload ),
			...( core ? { core } : {} ),
		},
		null,
		'\t'
	);
}

/** What an imported file turned out to contain. */
export interface ImportedConfig {
	fields: Field[];
	/** Absent when the file was written before core fields existed. */
	core?: CoreConfig;
}

/**
 * Parse an imported file. Accepts `{ fields: [...] }`, a full config, or a bare
 * array of fields.
 *
 * @param  raw File contents.
 * @return Normalized fields, and the core overrides where the file had any.
 * @throws {Error} When the file is not valid field JSON.
 */
export function parseImport( raw: string ): ImportedConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse( raw );
	} catch {
		throw new Error(
			__( 'That file is not valid JSON.', 'fieldwright-checkout-fields' )
		);
	}

	const list = Array.isArray( parsed )
		? parsed
		: ( parsed as { fields?: unknown } )?.fields;

	if ( ! Array.isArray( list ) ) {
		throw new Error(
			__(
				'That file does not contain a "fields" list.',
				'fieldwright-checkout-fields'
			)
		);
	}

	const core = Array.isArray( parsed )
		? undefined
		: ( parsed as { core?: unknown } )?.core;

	return {
		fields: list.map( ( item ) =>
			normalizeField( item as Partial< Field > )
		),
		...( core && 'object' === typeof core
			? { core: normalizeCore( core ) }
			: {} ),
	};
}

/** Re-exported so a caller needs one import for the width and layout unions. */
export type { FieldWidth, OptionsLayout };
