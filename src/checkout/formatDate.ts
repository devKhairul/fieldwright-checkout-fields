/**
 * Writing a calendar date the way this store writes dates.
 *
 * A shopper who is told "the earliest date is 2027-01-04" has been shown the
 * value rather than the date. The store already has an answer to how a date
 * should read — Settings, General, Date format — and the server sends it down
 * on `window.cbwbCheckout.dateFormat`, so the sentence the browser builds and
 * the same sentence coming back from the server say the same words.
 *
 * ## Why this is not `@wordpress/date`
 *
 * That package would do the whole job, and it is the right answer in the
 * builder, where it already runs. It brings moment and moment-timezone with it,
 * which is something like seventy kilobytes over the wire — on the checkout, on
 * every visit, to render one date inside one error message that most shoppers
 * never see. So the handful of format characters a `date_format` can actually
 * contain are handled here instead.
 *
 * Supported: `d j S D l N w z t L F M m n Y y`, plus `\` to escape the next
 * character. Anything else is printed as itself, which is what a separator
 * (`/`, `-`, `,`, a space) needs and what leaves an exotic format readable
 * rather than mangled. Time characters are deliberately absent: this formats a
 * calendar day, and a `date_format` carrying a clock is not one.
 *
 * ## Timezones
 *
 * There are none here. A `YYYY-MM-DD` names a day in the store's own timezone,
 * already resolved by whoever computed it; parsing it into a `Date` and reading
 * the parts back would shift it by a day for any shopper far enough east or
 * west, which is exactly the bug this type attracts. The string is taken apart
 * arithmetically instead, and the weekday is derived from the day count rather
 * than from a clock.
 */

import { __, _x } from '@wordpress/i18n';

/** `YYYY-MM-DD`, which is what a native date input hands back. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** WordPress's own default, for a bootstrap that carries no format. */
export const DEFAULT_DATE_FORMAT = 'F j, Y';

/** One date, taken apart. */
interface DateParts {
	year: number;
	/** 1 through 12. */
	month: number;
	/** 1 through 31. */
	day: number;
	/** 0 for Sunday through 6 for Saturday. */
	weekday: number;
	/** 0 for 1 January. */
	dayOfYear: number;
}

/**
 * The months, in order.
 *
 * Functions rather than constants throughout: `__()` has to run once the
 * locale's translations are in, which is not guaranteed at module scope.
 *
 * @return Month names, January first.
 */
function months(): string[] {
	return [
		__( 'January', 'fieldwright-checkout-fields' ),
		__( 'February', 'fieldwright-checkout-fields' ),
		__( 'March', 'fieldwright-checkout-fields' ),
		__( 'April', 'fieldwright-checkout-fields' ),
		__( 'May', 'fieldwright-checkout-fields' ),
		__( 'June', 'fieldwright-checkout-fields' ),
		__( 'July', 'fieldwright-checkout-fields' ),
		__( 'August', 'fieldwright-checkout-fields' ),
		__( 'September', 'fieldwright-checkout-fields' ),
		__( 'October', 'fieldwright-checkout-fields' ),
		__( 'November', 'fieldwright-checkout-fields' ),
		__( 'December', 'fieldwright-checkout-fields' ),
	];
}

/**
 * The months, abbreviated.
 *
 * @return Month abbreviations, January first.
 */
function shortMonths(): string[] {
	return [
		_x( 'Jan', 'January abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Feb', 'February abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Mar', 'March abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Apr', 'April abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'May', 'May abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Jun', 'June abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Jul', 'July abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Aug', 'August abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Sep', 'September abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Oct', 'October abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Nov', 'November abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Dec', 'December abbreviation', 'fieldwright-checkout-fields' ),
	];
}

/**
 * The days of the week, Sunday first, which is how every date API numbers them.
 *
 * @return Weekday names.
 */
function weekdays(): string[] {
	return [
		__( 'Sunday', 'fieldwright-checkout-fields' ),
		__( 'Monday', 'fieldwright-checkout-fields' ),
		__( 'Tuesday', 'fieldwright-checkout-fields' ),
		__( 'Wednesday', 'fieldwright-checkout-fields' ),
		__( 'Thursday', 'fieldwright-checkout-fields' ),
		__( 'Friday', 'fieldwright-checkout-fields' ),
		__( 'Saturday', 'fieldwright-checkout-fields' ),
	];
}

/**
 * The days of the week, abbreviated.
 *
 * @return Weekday abbreviations, Sunday first.
 */
function shortWeekdays(): string[] {
	return [
		_x( 'Sun', 'Sunday abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Mon', 'Monday abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Tue', 'Tuesday abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Wed', 'Wednesday abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Thu', 'Thursday abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Fri', 'Friday abbreviation', 'fieldwright-checkout-fields' ),
		_x( 'Sat', 'Saturday abbreviation', 'fieldwright-checkout-fields' ),
	];
}

/**
 * The suffix an ordinal day number takes: 1st, 2nd, 3rd, 4th.
 *
 * @param day Day of the month.
 * @return The suffix, which is empty in most languages.
 */
function ordinal( day: number ): string {
	if ( day > 3 && day < 21 ) {
		return _x( 'th', 'ordinal suffix', 'fieldwright-checkout-fields' );
	}

	switch ( day % 10 ) {
		case 1:
			return _x( 'st', 'ordinal suffix', 'fieldwright-checkout-fields' );
		case 2:
			return _x( 'nd', 'ordinal suffix', 'fieldwright-checkout-fields' );
		case 3:
			return _x( 'rd', 'ordinal suffix', 'fieldwright-checkout-fields' );
		default:
			return _x( 'th', 'ordinal suffix', 'fieldwright-checkout-fields' );
	}
}

/** Days in each month of a common year. */
const MONTH_LENGTHS = [ 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];

/**
 * Whether a year has a 29 February in it.
 *
 * @param year Four-digit year.
 * @return True for a leap year.
 */
function isLeapYear( year: number ): boolean {
	return ( 0 === year % 4 && 0 !== year % 100 ) || 0 === year % 400;
}

/**
 * How many days one month has.
 *
 * @param year  Four-digit year.
 * @param month 1 through 12.
 * @return Days in the month.
 */
function daysInMonth( year: number, month: number ): number {
	if ( 2 === month ) {
		return isLeapYear( year ) ? 29 : 28;
	}
	return MONTH_LENGTHS[ month - 1 ];
}

/**
 * Take a `YYYY-MM-DD` apart.
 *
 * @param value Date in `YYYY-MM-DD`.
 * @return The parts, or null when the value is not a date this can read.
 */
export function dateParts( value: string ): DateParts | null {
	if ( ! DATE_PATTERN.test( value ) ) {
		return null;
	}

	const year = Number( value.slice( 0, 4 ) );
	const month = Number( value.slice( 5, 7 ) );
	const day = Number( value.slice( 8, 10 ) );

	if (
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > daysInMonth( year, month )
	) {
		return null;
	}

	// Read as UTC, so the shopper's own clock cannot move the day. The value
	// names a calendar day in the store's timezone and nothing else.
	const at = new Date( Date.UTC( year, month - 1, day ) );

	if ( Number.isNaN( at.getTime() ) ) {
		return null;
	}

	let dayOfYear = day - 1;
	for ( let earlier = 1; earlier < month; earlier++ ) {
		dayOfYear += daysInMonth( year, earlier );
	}

	return {
		year,
		month,
		day,
		weekday: at.getUTCDay(),
		dayOfYear,
	};
}

/**
 * The name of the day a date falls on.
 *
 * @param value Date in `YYYY-MM-DD`.
 * @return The weekday, or '' when the value is not a date.
 */
export function weekdayName( value: string ): string {
	const parts = dateParts( value );

	return null === parts ? '' : weekdays()[ parts.weekday ];
}

/**
 * Pad a number to two digits.
 *
 * @param value Number to pad.
 * @return Two characters.
 */
function pad( value: number ): string {
	return String( value ).padStart( 2, '0' );
}

/**
 * One format character, resolved against one date.
 *
 * @param character Format character.
 * @param parts     The date.
 * @return The text it stands for, or null when it stands for nothing.
 */
function token( character: string, parts: DateParts ): string | null {
	switch ( character ) {
		case 'd':
			return pad( parts.day );
		case 'j':
			return String( parts.day );
		case 'S':
			return ordinal( parts.day );
		case 'D':
			return shortWeekdays()[ parts.weekday ];
		case 'l':
			return weekdays()[ parts.weekday ];
		case 'N':
			return String( 0 === parts.weekday ? 7 : parts.weekday );
		case 'w':
			return String( parts.weekday );
		case 'z':
			return String( parts.dayOfYear );
		case 'F':
			return months()[ parts.month - 1 ];
		case 'M':
			return shortMonths()[ parts.month - 1 ];
		case 'm':
			return pad( parts.month );
		case 'n':
			return String( parts.month );
		case 't':
			return String( daysInMonth( parts.year, parts.month ) );
		case 'L':
			return isLeapYear( parts.year ) ? '1' : '0';
		case 'Y':
			return String( parts.year );
		case 'y':
			return pad( parts.year % 100 );
		default:
			return null;
	}
}

/**
 * Write a date the way the store writes dates.
 *
 * @param value  Date in `YYYY-MM-DD`.
 * @param format PHP date format, from the bootstrap.
 * @return The formatted date, or the value itself when it is not a date.
 */
export function formatDate( value: string, format: string ): string {
	const parts = dateParts( value );

	if ( null === parts ) {
		return value;
	}

	const pattern = '' === format ? DEFAULT_DATE_FORMAT : format;
	let out = '';

	for ( let i = 0; i < pattern.length; i++ ) {
		const character = pattern[ i ];

		// A backslash means "print the next character, whatever it is", which
		// is how a merchant writes a date format with a letter in it.
		if ( '\\' === character ) {
			out += pattern[ i + 1 ] ?? '';
			i++;
			continue;
		}

		out += token( character, parts ) ?? character;
	}

	return out;
}
