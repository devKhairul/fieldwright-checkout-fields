/**
 * What is wrong with an answer, in the shopper's own language.
 *
 * The same rules run again server-side, where they are the ones that count.
 * This half exists so a shopper is told about a mistake while they are still
 * looking at the field, rather than after a round trip that clears half the
 * form. Nothing here reaches for the checkout's state, only for what it is
 * handed — and for the registry, which is asked what an add-on's own type
 * makes of its value.
 *
 * Every function returns '' for "nothing wrong", which reads better at the call
 * sites than a null and keeps the message the only thing that has to be
 * carried around.
 */

import { __, sprintf } from '@wordpress/i18n';

import {
	CONTENT_TYPES,
	isBuiltinType,
	isDateString,
	isTimeString,
	isWellFormed,
	lengthCap,
	splitValues,
	valueLength,
} from './bootstrap';
import { DEFAULT_DATE_FORMAT, formatDate, weekdayName } from './formatDate';
import { getFieldType } from './store';
import type {
	CheckoutI18n,
	DateRules,
	FieldOption,
	FieldState,
	RichField,
} from './types';

/**
 * Minutes since midnight, for comparing two `HH:MM` strings.
 *
 * @param value Time in `HH:MM`.
 * @return Minutes, or null when the value is not a time.
 */
function minutes( value: string ): number | null {
	if ( ! isTimeString( value ) ) {
		return null;
	}

	const [ hours, mins ] = value.split( ':' );

	return Number( hours ) * 60 + Number( mins );
}

/**
 * Whether the shopper has answered at all.
 *
 * An answer that is not the shape the type stores does not count as one: a
 * native picker could not have produced it, so it came from somewhere else and
 * the shopper has nothing on screen to correct. What is said about it is
 * `validateField()`'s business, and is not "this field is required".
 *
 * @param field Field to check.
 * @param value Stored answer.
 * @return True when there is an answer.
 */
export function isAnswered( field: RichField, value: string ): boolean {
	return '' !== value.trim() && isWellFormed( field, value );
}

/**
 * What to say about an answer that is not the shape the type stores.
 *
 * `RichValues::validate()` refuses one of these whether or not the field had to
 * be answered, so the browser has to as well, and in the same words: a value
 * left over from before the field was retyped, or written to the store by an
 * add-on, would otherwise pass every check here and come back from the server
 * as an order that would not go through.
 *
 * @param field Field being checked.
 * @param value Stored answer.
 * @param i18n  Messages from the server.
 * @return The message, or '' when there is nothing wrong with the shape.
 */
function formatMessage(
	field: RichField,
	value: string,
	i18n: CheckoutI18n
): string {
	if ( isWellFormed( field, value ) ) {
		return '';
	}

	if ( 'date' === field.type ) {
		// eslint-disable-next-line @wordpress/valid-sprintf -- The format string is translated server-side and printed in the bootstrap; the contract fixes it as `%s`.
		return sprintf( i18n.invalidDate, field.label );
	}

	// A time, which with the date is the whole of what `isWellFormed()` can
	// refuse: every other type stores a plain string.
	// eslint-disable-next-line @wordpress/valid-sprintf -- The format string is translated server-side and printed in the bootstrap; the contract fixes it as `%s`.
	return sprintf( i18n.invalidTime, field.label );
}

/**
 * Complain about an answer outside the allowed range.
 *
 * The contract gives one two-sided message, which only says something true when
 * both ends are set. A field bounded on one side gets its own sentence rather
 * than the two-sided one with a blank in it.
 *
 * @param i18n Messages from the server.
 * @param min  Lowest allowed value, or '' for no bound.
 * @param max  Highest allowed value, or '' for no bound.
 * @return The message.
 */
function rangeMessage( i18n: CheckoutI18n, min: string, max: string ): string {
	if ( '' !== min && '' !== max ) {
		// eslint-disable-next-line @wordpress/valid-sprintf -- The format string is translated server-side and printed in the bootstrap; the contract fixes it as `%1$s`…`%2$s`.
		return sprintf( i18n.outOfRange, min, max );
	}

	if ( '' !== min ) {
		return sprintf(
			/* translators: %s: the earliest date or time the field accepts. */
			__( 'Please enter %s or later.', 'fieldwright-checkout-fields' ),
			min
		);
	}

	return sprintf(
		/* translators: %s: the latest date or time the field accepts. */
		__( 'Please enter %s or earlier.', 'fieldwright-checkout-fields' ),
		max
	);
}

/**
 * Check a date against the merchant's bounds, then against an add-on's rules.
 *
 * `YYYY-MM-DD` sorts the same way it reads, so the bounds compare as strings
 * and no timezone ever enters into it — which matters, because the shopper's
 * timezone and the store's are routinely different days.
 *
 * The two sets of limits are reported separately rather than merged into one
 * window, because each half is checked again by a different piece of server
 * code and has to come back saying the same thing. The merchant's own earliest
 * and latest are ours, and get the contract's two-sided sentence; the rules an
 * add-on attached are the add-on's, and get a sentence naming the actual reason
 * the day was refused.
 *
 * @param field      Field being checked.
 * @param value      Stored answer.
 * @param i18n       Messages from the server.
 * @param dateFormat The site's date format, for a date named in a message.
 * @return The message, or '' when the date is acceptable.
 */
function checkDate(
	field: RichField,
	value: string,
	i18n: CheckoutI18n,
	dateFormat: string
): string {
	const min = isDateString( field.date_min ) ? field.date_min : '';
	const max = isDateString( field.date_max ) ? field.date_max : '';

	if ( ( '' !== min && value < min ) || ( '' !== max && value > max ) ) {
		return rangeMessage( i18n, min, max );
	}

	return dateRuleMessage( field, value, i18n, dateFormat );
}

/**
 * Why one date fails the rules an add-on attached, if it does.
 *
 * The order is the server's own: the earliest date, then the age, then the
 * latest date, then the individual dates, then the days of the week. Only the
 * first reason is reported, and both halves report the same first reason, so a
 * shopper who is told why the day was refused in the browser is not told
 * something else when they submit.
 */
export type DateRuleBreach =
	| { kind: 'min'; date: string }
	| { kind: 'age'; date: string; years: number }
	| { kind: 'max'; date: string }
	| { kind: 'blackout' }
	| { kind: 'weekday' };

/**
 * Test a date against every rule an add-on attached.
 *
 * @param value Date in `YYYY-MM-DD`.
 * @param rules The add-on's rules.
 * @return The first rule the date breaks, or null when it breaks none.
 */
export function dateRuleBreach(
	value: string,
	rules: DateRules
): DateRuleBreach | null {
	if ( isDateString( rules.minDate ) && value < rules.minDate ) {
		return { kind: 'min', date: rules.minDate };
	}

	// Before the latest date, and deliberately: the age cap is inside `maxDate`
	// already, so a date that breaks it breaks both, and the sentence about
	// being old enough is the one the server answers with.
	if (
		undefined !== rules.minAgeYears &&
		isDateString( rules.ageMaxDate ) &&
		value > rules.ageMaxDate
	) {
		return {
			kind: 'age',
			date: rules.ageMaxDate,
			years: rules.minAgeYears,
		};
	}

	if ( isDateString( rules.maxDate ) && value > rules.maxDate ) {
		return { kind: 'max', date: rules.maxDate };
	}

	if (
		Array.isArray( rules.blackoutDates ) &&
		rules.blackoutDates.includes( value )
	) {
		return { kind: 'blackout' };
	}

	const weekday = weekdayOf( value );

	if (
		Array.isArray( rules.disabledWeekdays ) &&
		null !== weekday &&
		rules.disabledWeekdays.includes( weekday )
	) {
		return { kind: 'weekday' };
	}

	return null;
}

/**
 * What to say about a date the store does not accept.
 *
 * The merchant's own message for the field replaces all of these where they
 * wrote one: they know why the day is closed and the defaults cannot. Where
 * they did not, the default says which rule the date broke rather than the one
 * sentence that used to cover all four — "this date is not available" tells a
 * shopper staring at a picker nothing they can act on, where "the earliest date
 * is 4 January 2027" tells them where to click.
 *
 * @param field      Field being checked.
 * @param value      Stored answer.
 * @param i18n       Messages from the server.
 * @param dateFormat The site's date format.
 * @return The message, or '' when the date breaks no rule.
 */
function dateRuleMessage(
	field: RichField,
	value: string,
	i18n: CheckoutI18n,
	dateFormat: string
): string {
	const breach = dateRuleBreach( value, field.dateRules ?? {} );

	if ( null === breach ) {
		return '';
	}

	if ( '' !== field.error_message ) {
		return field.error_message;
	}

	if ( 'age' === breach.kind ) {
		// eslint-disable-next-line @wordpress/valid-sprintf -- The format string is translated server-side and printed in the bootstrap; the contract fixes it as `%d`.
		return sprintf( i18n.tooYoung, breach.years );
	}

	if ( 'min' === breach.kind ) {
		return sprintf(
			/* translators: %s: the earliest date the store will take, e.g. 4 January 2027. */
			__( 'The earliest date is %s.', 'fieldwright-checkout-fields' ),
			formatDate( breach.date, dateFormat )
		);
	}

	if ( 'max' === breach.kind ) {
		return sprintf(
			/* translators: %s: the latest date the store will take, e.g. 4 January 2027. */
			__( 'The latest date is %s.', 'fieldwright-checkout-fields' ),
			formatDate( breach.date, dateFormat )
		);
	}

	if ( 'weekday' === breach.kind ) {
		return sprintf(
			/* translators: %s: the name of a day of the week, e.g. Saturday. The sentence reads "Saturdays are not available." */
			__( '%ss are not available.', 'fieldwright-checkout-fields' ),
			weekdayName( value )
		);
	}

	return __( 'This date is not available.', 'fieldwright-checkout-fields' );
}

/**
 * Which day of the week a `YYYY-MM-DD` string falls on.
 *
 * Read as UTC deliberately. The string names a calendar day in the store's
 * timezone, and parsing it in the shopper's would shift it by a day for anyone
 * far enough east or west, which is exactly the bug this type attracts.
 *
 * @param value Date in `YYYY-MM-DD`.
 * @return 0 for Sunday through 6 for Saturday, or null when it is not a date.
 */
export function weekdayOf( value: string ): number | null {
	if ( ! isDateString( value ) ) {
		return null;
	}

	const at = new Date( `${ value }T00:00:00Z` );

	return Number.isNaN( at.getTime() ) ? null : at.getUTCDay();
}

/**
 * Whether a date is one the store will take.
 *
 * @param value Date in `YYYY-MM-DD`.
 * @param rules The add-on's rules.
 * @return True when the date breaks none of them.
 */
export function isDateAvailable( value: string, rules: DateRules ): boolean {
	return null === dateRuleBreach( value, rules );
}

/**
 * Check a time against the merchant's bounds.
 *
 * A window that ends before it starts — 22:00 to 02:00, say — is read as
 * running over midnight, because that is the only thing a merchant could have
 * meant by it.
 *
 * @param field Field being checked.
 * @param value Stored answer.
 * @param i18n  Messages from the server.
 * @return The message, or '' when the time is in range.
 */
function checkTime(
	field: RichField,
	value: string,
	i18n: CheckoutI18n
): string {
	const min = minutes( field.time_min );
	const max = minutes( field.time_max );
	const at = minutes( value );

	if ( null === at || ( null === min && null === max ) ) {
		return '';
	}

	const inRange =
		null !== min && null !== max && max < min
			? at >= min || at <= max
			: ( null === min || at >= min ) && ( null === max || at <= max );

	return inRange
		? ''
		: rangeMessage(
				i18n,
				null === min ? '' : field.time_min,
				null === max ? '' : field.time_max
		  );
}

/**
 * Check an answer against the choices the merchant offered.
 *
 * @param field Field being checked.
 * @param value Stored answer.
 * @param i18n  Messages from the server.
 * @return The message, or '' when every choice is one of the offered ones.
 */
function checkOptions(
	field: RichField,
	value: string,
	i18n: CheckoutI18n
): string {
	const allowed = field.options.map( ( option ) => option.value );
	const chosen =
		'checkbox_group' === field.type ? splitValues( value ) : [ value ];

	return chosen.every( ( entry ) => allowed.includes( entry ) )
		? ''
		: i18n.invalidOption;
}

/**
 * Check an answer against the choices an add-on offered for this shopper.
 *
 * The list is the whole of what the field accepts while it is being offered:
 * the merchant's own bounds describe the free answer this field has stopped
 * asking for. A choice that is on the list but taken is no more acceptable than
 * one that was never there — the shopper can see it, which is the only reason
 * it is still drawn.
 *
 * @param field   Field being checked.
 * @param value   Stored answer.
 * @param options The choices the add-on offered.
 * @return The message, or '' when the answer is one of the open choices.
 */
function checkAvailable(
	field: RichField,
	value: string,
	options: FieldOption[]
): string {
	const open = options.some(
		( option ) => ! option.disabled && option.value === value
	);

	if ( open ) {
		return '';
	}

	if ( '' !== field.error_message ) {
		return field.error_message;
	}

	return __(
		'Choose one of the available times.',
		'fieldwright-checkout-fields'
	);
}

/**
 * Everything that could be wrong with one answer, as one message.
 *
 * The order is the order a shopper would notice things in: is it there, is it
 * the shape the field stores, is it a real choice, is it the right size, is it
 * in range. Only the first problem is reported — a field that argues twice
 * about the same keystroke reads as broken.
 *
 * A type an add-on registered is asked about its own answer instead of every
 * check below, exactly as the server asks the type's `validate` callback and
 * nothing else: what a value of that type may say is the add-on's to know.
 * Whether the shopper answered at all stays Free's question, because that is
 * the one every field on the checkout is asked in the same words. A type
 * neither Free nor an add-on has a control for is not on the page, so it has
 * nothing to say about anything.
 *
 * @param field      Field being checked.
 * @param value      Stored answer.
 * @param i18n       Messages from the server.
 * @param dateFormat The site's date format, for a date named in a message.
 *                   Defaults to WordPress's own, so a caller with no bootstrap
 *                   to hand still gets a readable date rather than an ISO one.
 * @param state      What an add-on says about the field, where anything does.
 *                   Only the choices it offered a time field are read here;
 *                   whether the field is on the page at all, and whether it has
 *                   to be answered, are both settled before this is called.
 * @return The message, or '' when the answer is fine.
 */
export function validateField(
	field: RichField,
	value: string,
	i18n: CheckoutI18n,
	dateFormat: string = DEFAULT_DATE_FORMAT,
	state: FieldState = { hidden: false }
): string {
	if ( CONTENT_TYPES.includes( field.type ) ) {
		return '';
	}

	const builtin = isBuiltinType( field.type );
	const registered = builtin ? undefined : getFieldType( field.type );

	if ( ! builtin && ! registered ) {
		return '';
	}

	if ( ! isAnswered( field, value ) ) {
		// Nothing there at all is the required question. Something there that the
		// field could not have produced is the server's own complaint about the
		// shape, which it makes whether or not the field had to be answered:
		// saying "this field is required" instead would leave an optional field
		// quietly holding a value the order cannot be placed with.
		if ( '' === value.trim() ) {
			return field.required ? i18n.required : '';
		}

		return formatMessage( field, value, i18n );
	}

	if ( registered ) {
		// Read rather than returned straight: this comes from another plugin's
		// bundle, and a field told to complain about something that is not a
		// sentence would print `[object Object]` at the shopper.
		const complaint = registered.validate?.( field, value, i18n );

		return 'string' === typeof complaint ? complaint : '';
	}

	// A list of times an add-on drew up is the whole of what the field accepts,
	// so nothing below it is asked: the merchant's earliest and latest describe
	// the free answer this field has stopped asking for. Only a time field is
	// read this way, because only a time field is drawn as that list.
	if ( 'time' === field.type && undefined !== state.options ) {
		return checkAvailable( field, value, state.options );
	}

	if ( 'radio' === field.type || 'checkbox_group' === field.type ) {
		const problem = checkOptions( field, value, i18n );

		if ( '' !== problem ) {
			return problem;
		}
	}

	// Against the cap rather than the merchant's own maximum: the server has one
	// either way, and a field the merchant left unlimited is still refused past
	// it. Counted in characters, the way `mb_strlen()` counts them.
	const cap = lengthCap( field );

	if ( valueLength( value ) > cap ) {
		// eslint-disable-next-line @wordpress/valid-sprintf -- The format string is translated server-side and printed in the bootstrap; the contract fixes it as `%d`.
		return sprintf( i18n.tooLong, cap );
	}

	if ( 'date' === field.type ) {
		return checkDate( field, value, i18n, dateFormat );
	}

	if ( 'time' === field.type ) {
		return checkTime( field, value, i18n );
	}

	return '';
}
