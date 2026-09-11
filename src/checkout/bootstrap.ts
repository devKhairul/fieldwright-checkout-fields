/**
 * Reading `window.cbwbCheckout` without trusting it.
 *
 * The bundle and the PHP that prints its data ship together, so in practice the
 * shape is exactly the contract. In practice is not always: a merchant on a
 * half-updated install, an object cache holding a payload from the version
 * before last, or a filter an add-on hung off the printed data can all put
 * something else there. A checkout that throws is a checkout nobody can buy
 * from, so every value is read defensively and anything unrecognisable is
 * dropped rather than guessed at.
 */

import { DEFAULT_DATE_FORMAT } from './formatDate';
import type {
	BuiltinRichFieldType,
	CheckoutBootstrap,
	CheckoutI18n,
	DateRules,
	FieldOption,
	FieldWidth,
	OptionsLayout,
	RequiredMarking,
	RichField,
} from './types';

/** Every type this bundle draws itself, which the dispatch tries first. */
export const BUILTIN_TYPES: BuiltinRichFieldType[] = [
	'textarea',
	'radio',
	'checkbox_group',
	'date',
	'time',
	'heading',
	'paragraph',
];

/** Types that carry no answer, so no value and no validation. */
export const CONTENT_TYPES: string[] = [ 'heading', 'paragraph' ];

/** Types whose answer is one of a fixed list. */
export const OPTION_TYPES: string[] = [ 'radio', 'checkbox_group' ];

/**
 * Whether a type is one this bundle draws itself.
 *
 * @param type Type key.
 * @return True for a built-in type.
 */
export function isBuiltinType( type: string ): type is BuiltinRichFieldType {
	return BUILTIN_TYPES.some( ( builtin ) => builtin === type );
}

/** Fallback namespace, matching the one the server registers. */
export const DEFAULT_NAMESPACE = 'cbwb';

/** Sensible textarea height when the server names none. */
export const DEFAULT_ROWS = 4;

/**
 * The longest answer the server will take when the merchant set no maximum.
 *
 * `FieldDefinition::MAX_TEXTAREA_LENGTH` and `FieldDefinition::MAX_FIELD_LENGTH`.
 * The server caps every value at one of the two whether or not a maximum was
 * typed into the builder, so a browser that only knew about the merchant's own
 * limit would let an answer through that the order then fails on.
 */
export const MAX_TEXTAREA_LENGTH = 5000;
export const MAX_FIELD_LENGTH = 1000;

/** Messages used when the server sent none. Untranslated on purpose: these */
/* are a last resort, and the server's copies are the translated ones. */
const FALLBACK_I18N: CheckoutI18n = {
	required: 'This field is required.',
	invalidOption: 'Choose one of the available options.',
	tooLong: 'Please use at most %d characters.',
	outOfRange: 'Please enter a value between %1$s and %2$s.',
	invalidDate: 'Enter a date for %s in YYYY-MM-DD form.',
	invalidTime: 'Enter a time for %s in HH:MM form.',
	tooYoung: 'You have to be at least %d years old.',
};

/** `YYYY-MM-DD`, which is what a native date input hands back. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `HH:MM`, which is what a native time input hands back below a 60s step. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * What a type key may look like, matching the server's `TypeRegistry`.
 *
 * Checked rather than assumed because the type is what the dispatch looks a
 * registered control up by and what a wrapper's class name is built from, and
 * an entry whose type is an object or a sentence is a payload something else
 * has been at.
 */
const TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Whether a value is a `YYYY-MM-DD` string.
 *
 * @param value Value to test.
 * @return True when it is a date.
 */
export function isDateString( value: unknown ): value is string {
	return 'string' === typeof value && DATE_PATTERN.test( value );
}

/**
 * Whether a value is an `HH:MM` string.
 *
 * @param value Value to test.
 * @return True when it is a time.
 */
export function isTimeString( value: unknown ): value is string {
	return 'string' === typeof value && TIME_PATTERN.test( value );
}

/**
 * Whether a stored answer is one the field could have produced.
 *
 * A half-typed date leaves a native input's `value` empty rather than partial,
 * so anything malformed here came from somewhere else — a stale prefill, an
 * add-on writing to the store. The server refuses exactly these, required or
 * not, so both halves have to be able to spot one.
 *
 * Only the two types with a shape of their own are asked about. Everything
 * else — the built-in text answers and every registered type — stores a plain
 * string, and what that string may say is either the merchant's list or the
 * registered type's own business.
 *
 * @param field Field the answer belongs to.
 * @param value Stored answer.
 * @return True when the answer is the shape the type stores.
 */
export function isWellFormed( field: RichField, value: string ): boolean {
	if ( 'date' === field.type ) {
		return isDateString( value );
	}
	if ( 'time' === field.type ) {
		return isTimeString( value );
	}
	return true;
}

/**
 * The longest answer one field accepts, configured or not.
 *
 * `FieldDefinition::length_cap()`, in the browser.
 *
 * @param field Field to measure against.
 * @return The limit in characters.
 */
export function lengthCap( field: RichField ): number {
	return (
		field.max_length ??
		( 'textarea' === field.type ? MAX_TEXTAREA_LENGTH : MAX_FIELD_LENGTH )
	);
}

/**
 * How long an answer is, counted the way PHP's `mb_strlen()` counts it.
 *
 * A JavaScript string's `length` is in UTF-16 code units, so an emoji or a rare
 * CJK character counts twice and an answer the server would have taken is
 * refused in front of the shopper. Walking the string counts code points, which
 * is what the server counts.
 *
 * @param value Stored answer.
 * @return The length in characters.
 */
export function valueLength( value: string ): number {
	return Array.from( value ).length;
}

/**
 * Whether a value is a plain object we can read keys off.
 *
 * @param value Value to test.
 * @return True for a non-null, non-array object.
 */
function isRecord( value: unknown ): value is Record< string, unknown > {
	return (
		'object' === typeof value && null !== value && ! Array.isArray( value )
	);
}

/**
 * Read a string, whatever the server sent.
 *
 * Numbers are stringified rather than rejected: PHP's JSON encoder turns a
 * numeric-looking option value into a number, and dropping those would lose
 * whole dropdowns.
 *
 * @param value    Value to read.
 * @param fallback Used when the value is neither a string nor a number.
 * @return A string.
 */
function readString( value: unknown, fallback = '' ): string {
	if ( 'string' === typeof value ) {
		return value;
	}
	if ( 'number' === typeof value && Number.isFinite( value ) ) {
		return String( value );
	}
	return fallback;
}

/**
 * Read a whole number.
 *
 * @param value    Value to read.
 * @param fallback Used when the value is not a finite number.
 * @return An integer.
 */
function readInt( value: unknown, fallback: number ): number {
	const number = 'string' === typeof value ? Number( value ) : value;

	if ( 'number' === typeof number && Number.isFinite( number ) ) {
		return Math.trunc( number );
	}
	return fallback;
}

/**
 * Read one of a fixed set of strings.
 *
 * @param value    Value to read.
 * @param allowed  Accepted values.
 * @param fallback Used when the value is not one of them.
 * @return One of `allowed`.
 */
function readEnum< T extends string >(
	value: unknown,
	allowed: readonly T[],
	fallback: T
): T {
	return allowed.includes( value as T ) ? ( value as T ) : fallback;
}

/**
 * Read the choices of a radio or checkbox group.
 *
 * An option with no value is dropped: it could never be submitted, and it would
 * make the "is this one of the choices?" check accept the empty answer.
 *
 * @param value Value to read.
 * @return The options that survived.
 */
function readOptions( value: unknown ): FieldOption[] {
	if ( ! Array.isArray( value ) ) {
		return [];
	}

	const seen = new Set< string >();

	return value.reduce< FieldOption[] >( ( options, raw ) => {
		if ( ! isRecord( raw ) ) {
			return options;
		}

		const optionValue = readString( raw.value );

		if ( '' === optionValue || seen.has( optionValue ) ) {
			return options;
		}

		seen.add( optionValue );
		options.push( {
			value: optionValue,
			label: readString( raw.label ) || optionValue,
		} );

		return options;
	}, [] );
}

/**
 * The keys this function reads for itself, which therefore never reach `extra`.
 *
 * Listed rather than derived from the returned object, because `extra` is built
 * before that object exists and because a key read into a differently named
 * property — `dateRules` into the rules, say — has still been read.
 */
const OWN_KEYS = [
	'id',
	'type',
	'label',
	'help',
	'placeholder',
	'default_value',
	'required',
	'width',
	'location',
	'options',
	'options_layout',
	'rows',
	'max_length',
	'date_min',
	'date_max',
	'time_min',
	'time_max',
	'step',
	'content',
	'content_level',
	'error_message',
	'dateRules',
];

/**
 * Everything on the server's entry this bundle has no use of its own for.
 *
 * A shallow copy: what the values mean is the registered type's business, and
 * the Control that reads them is the one that decides what it trusts.
 *
 * @param raw Value from the server.
 * @return The keys nothing above consumed, verbatim.
 */
function readExtra(
	raw: Record< string, unknown >
): Record< string, unknown > {
	return Object.keys( raw ).reduce< Record< string, unknown > >(
		( extra, key ) => {
			if ( ! OWN_KEYS.includes( key ) ) {
				extra[ key ] = raw[ key ];
			}

			return extra;
		},
		{}
	);
}

/**
 * Turn one entry of `cbwbCheckout.fields` into a field this bundle can draw.
 *
 * The type is not checked against a list any more, only against the shape a
 * type key has: whether anything can draw it is settled at render time, by the
 * dispatch, because an add-on registers its own types after this runs.
 *
 * @param raw Value from the server.
 * @return The field, or null when it is not one we render.
 */
export function normalizeField( raw: unknown ): RichField | null {
	if ( ! isRecord( raw ) ) {
		return null;
	}

	const id = readString( raw.id );
	const type = readString( raw.type );

	if ( '' === id || ! TYPE_PATTERN.test( type ) ) {
		return null;
	}

	const maxLength = readInt( raw.max_length, 0 );

	return {
		id,
		type,
		label: readString( raw.label ),
		help: readString( raw.help ),
		placeholder: readString( raw.placeholder ),
		default_value: readString( raw.default_value ),
		required: true === raw.required,
		width: readEnum< FieldWidth >( raw.width, [ 'full', 'half' ], 'full' ),
		location: readString( raw.location ),
		options: readOptions( raw.options ),
		options_layout: readEnum< OptionsLayout >(
			raw.options_layout,
			[ 'stacked', 'inline' ],
			'stacked'
		),
		// Core's own Textarea is fixed at two rows, which is too short for the
		// gift messages and delivery notes this type exists for.
		rows: Math.min( 20, Math.max( 2, readInt( raw.rows, DEFAULT_ROWS ) ) ),
		max_length: maxLength > 0 ? maxLength : null,
		date_min: readString( raw.date_min ),
		date_max: readString( raw.date_max ),
		time_min: readString( raw.time_min ),
		time_max: readString( raw.time_max ),
		step: readString( raw.step ),
		content: readString( raw.content ),
		content_level: Math.min(
			4,
			Math.max( 2, readInt( raw.content_level, 2 ) )
		),
		error_message: readString( raw.error_message ),
		dateRules: normalizeDateRules( raw.dateRules ),
		extra: readExtra( raw ),
	};
}

/**
 * Read the extra date limits an add-on may have attached.
 *
 * Everything is checked rather than trusted: the payload is public, and a rule
 * that arrived malformed should leave the field working the way the merchant
 * configured it rather than rejecting every date the shopper picks.
 *
 * @param raw Whatever was on the payload.
 * @return The rules, or undefined when there are none worth keeping.
 */
export function normalizeDateRules( raw: unknown ): DateRules | undefined {
	if ( ! isRecord( raw ) ) {
		return undefined;
	}

	const rules: DateRules = {};

	if ( isDateString( raw.minDate ) ) {
		rules.minDate = raw.minDate;
	}
	if ( isDateString( raw.maxDate ) ) {
		rules.maxDate = raw.maxDate;
	}

	if ( Array.isArray( raw.disabledWeekdays ) ) {
		const weekdays = raw.disabledWeekdays.filter(
			( day ): day is number =>
				'number' === typeof day &&
				Number.isInteger( day ) &&
				day >= 0 &&
				day <= 6
		);

		// All seven would leave no date choosable at all, which is never what a
		// merchant meant and would strand the shopper on a required field.
		if ( 0 < weekdays.length && 7 > weekdays.length ) {
			rules.disabledWeekdays = weekdays;
		}
	}

	if ( Array.isArray( raw.blackoutDates ) ) {
		const dates = raw.blackoutDates.filter( isDateString );

		if ( 0 < dates.length ) {
			rules.blackoutDates = dates;
		}
	}

	// A minimum age is already folded into `maxDate` by whoever computed it, and
	// carried again here because the two are refused with different sentences
	// and the age is the one the server names first. Both halves or neither: a
	// cap with no number to print, or a number with no date to compare against,
	// says nothing a shopper could act on.
	const years = readInt( raw.minAgeYears, 0 );

	if ( 0 < years && isDateString( raw.ageMaxDate ) ) {
		rules.minAgeYears = years;
		rules.ageMaxDate = raw.ageMaxDate;
	}

	return 0 === Object.keys( rules ).length ? undefined : rules;
}

/**
 * Read the messages, filling in anything the server left out.
 *
 * @param raw Value from the server.
 * @return A complete message set.
 */
function readI18n( raw: unknown ): CheckoutI18n {
	if ( ! isRecord( raw ) ) {
		return { ...FALLBACK_I18N };
	}

	return {
		required: readString( raw.required, FALLBACK_I18N.required ),
		invalidOption: readString(
			raw.invalidOption,
			FALLBACK_I18N.invalidOption
		),
		tooLong: readString( raw.tooLong, FALLBACK_I18N.tooLong ),
		outOfRange: readString( raw.outOfRange, FALLBACK_I18N.outOfRange ),
		// Absent on a payload printed by a server from before these were part of
		// the contract, which is what the fallbacks are for.
		invalidDate: readString( raw.invalidDate, FALLBACK_I18N.invalidDate ),
		invalidTime: readString( raw.invalidTime, FALLBACK_I18N.invalidTime ),
		tooYoung: readString( raw.tooYoung, FALLBACK_I18N.tooYoung ),
	};
}

/**
 * Read the answers the server already knows for this shopper.
 *
 * @param raw Value from the server.
 * @return Field id to answer.
 */
function readPrefill( raw: unknown ): Record< string, string > {
	if ( ! isRecord( raw ) ) {
		return {};
	}

	return Object.keys( raw ).reduce< Record< string, string > >(
		( prefill, key ) => {
			const value = raw[ key ];

			if ( 'string' === typeof value || 'number' === typeof value ) {
				prefill[ key ] = readString( value );
			}

			return prefill;
		},
		{}
	);
}

/**
 * Read `window.cbwbCheckout`.
 *
 * @param raw Whatever the page put there.
 * @return The bootstrap, or null when there is nothing usable to read.
 */
export function readBootstrap( raw: unknown ): CheckoutBootstrap | null {
	if ( ! isRecord( raw ) ) {
		return null;
	}

	const fields = Array.isArray( raw.fields )
		? raw.fields.reduce< RichField[] >( ( kept, entry ) => {
				const field = normalizeField( entry );

				if ( field && ! kept.some( ( { id } ) => id === field.id ) ) {
					kept.push( field );
				}

				return kept;
		  }, [] )
		: [];

	return {
		namespace: readString( raw.namespace, DEFAULT_NAMESPACE ),
		fields,
		// Anything that is not the asterisk is WooCommerce's own way round,
		// which is also what a payload written before the setting existed says
		// by saying nothing.
		requiredMarking: readEnum< RequiredMarking >(
			raw.requiredMarking,
			[ 'optional_label', 'asterisk' ],
			'optional_label'
		),
		prefill: readPrefill( raw.prefill ),
		i18n: readI18n( raw.i18n ),
		dateFormat: readString( raw.dateFormat ) || DEFAULT_DATE_FORMAT,
	};
}

/**
 * The answer a field starts out with.
 *
 * The shopper's own saved answer beats the merchant's default, which is the
 * point of having one — but only when there is one. An empty prefill is the
 * server saying "nothing saved", not "saved as blank", so it must not wipe a
 * default the merchant typed.
 *
 * @param field   Field to seed.
 * @param prefill Answers the server already knows.
 * @return The starting answer.
 */
export function initialValue(
	field: RichField,
	prefill: Record< string, string >
): string {
	if ( CONTENT_TYPES.includes( field.type ) ) {
		return '';
	}

	const saved = prefill[ field.id ];
	// A remembered answer the field could not have produced is dropped rather
	// than posted: it was saved while the field was a text box and the field is
	// a date now, and the server refuses it whether or not the field has to be
	// answered. The merchant's own default is left to stand instead, and where
	// there is none the field starts empty.
	const value =
		'string' === typeof saved &&
		'' !== saved &&
		isWellFormed( field, saved )
			? saved
			: field.default_value;

	if ( ! OPTION_TYPES.includes( field.type ) ) {
		return isWellFormed( field, value ) ? value : '';
	}

	// A saved answer can name an option the merchant has since deleted, and
	// submitting it would fail the server's own check. Drop it here instead.
	const allowed = field.options.map( ( option ) => option.value );
	const chosen = splitValues( value ).filter( ( entry ) =>
		allowed.includes( entry )
	);

	return 'radio' === field.type ? chosen[ 0 ] ?? '' : joinValues( chosen );
}

/**
 * The ticked values inside a checkbox group's answer.
 *
 * @param value Stored answer.
 * @return One entry per tick, in stored order.
 */
export function splitValues( value: string ): string[] {
	return value
		.split( ',' )
		.map( ( entry ) => entry.trim() )
		.filter( ( entry ) => '' !== entry );
}

/**
 * Put a checkbox group's ticks back into one stored answer.
 *
 * @param values Ticked values.
 * @return Stored answer.
 */
export function joinValues( values: string[] ): string {
	return values.join( ',' );
}

/**
 * The part of a field id that is safe to build DOM ids out of.
 *
 * @param id Field id, e.g. `cbwb/gift-message`.
 * @return A slug, e.g. `gift-message`.
 */
export function fieldKey( id: string ): string {
	const slash = id.indexOf( '/' );
	const key = slash === -1 ? id : id.slice( slash + 1 );

	return key.replace( /[^a-zA-Z0-9_-]+/g, '-' ).replace( /^-+|-+$/g, '' );
}
