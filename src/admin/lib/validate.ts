/**
 * Client-side mirror of the PHP field validator. Same rules, same codes, same
 * error paths — so a field that passes here passes on the server too.
 *
 * @see includes/Fields/FieldDefinition.php
 */

import { __, sprintf } from '@wordpress/i18n';

import type { Field, FormatPreset, ValidationError } from '../types';
import {
	FORCED_FORMAT,
	MAX_ROWS,
	MAX_TIME_STEP,
	MIN_ROWS,
	allowsPlacement,
	collectsAnswer,
	maxLengthCeiling,
	usesOptions,
	usesWidth,
} from './fields';
import { validateField as applyValidateFieldFilter } from './hooks';
import { descriptorFor } from './typeMeta';

export const MAX_ID_LENGTH = 64;
export const MAX_LABEL_LENGTH = 200;
export const MAX_PLACEHOLDER_LENGTH = 200;
export const MAX_ERROR_MESSAGE_LENGTH = 200;
export const MAX_OPTION_VALUE_LENGTH = 100;
export const MAX_OPTION_LABEL_LENGTH = 200;
/**
 * Most options one field may offer.
 *
 * Every option is inlined into the checkout page for every shopper, so the list
 * is capped rather than left to the request-size limit. Mirrors
 * `FieldDefinition::MAX_OPTIONS`.
 */
export const MAX_OPTIONS = 100;
export const MAX_PATTERN_LENGTH = 500;
export const MAX_FIELD_MAX_LENGTH = 1000;
export const MAX_HELP_LENGTH = 300;
export const MAX_DEFAULT_VALUE_LENGTH = 1000;
export const MAX_CONTENT_LENGTH = 2000;

const OPTION_VALUE_PATTERN = /^[A-Za-z0-9_.:-]+$/;

/** A decimal string, as `min`, `max` and `step` store one. */
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/** `YYYY-MM-DD`. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `HH:MM`, 24-hour. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Whether a stored decimal is well formed. '' means "not set", which is always
 * allowed — every one of these settings is optional.
 *
 * @param value Stored value.
 * @return True when usable.
 */
function isDecimalOrEmpty( value: string ): boolean {
	return '' === value || DECIMAL_PATTERN.test( value );
}

/**
 * Whether a time step is one the checkout can be given. The server stores it as
 * a whole number of minutes, so half a minute is as wrong as none at all.
 *
 * @param value Stored step.
 * @return True when usable.
 */
function isWholeMinutes( value: string ): boolean {
	const minutes = Number( value );
	return (
		Number.isInteger( minutes ) && minutes >= 1 && minutes <= MAX_TIME_STEP
	);
}

/**
 * Compare two optional decimals.
 *
 * @param min Smallest allowed.
 * @param max Largest allowed.
 * @return True when the pair is the wrong way round.
 */
function isBackwardsNumber( min: string, max: string ): boolean {
	if ( '' === min || '' === max ) {
		return false;
	}
	return Number( min ) > Number( max );
}

/**
 * Compare two optional dates or times.
 *
 * `YYYY-MM-DD` and `HH:MM` both sort correctly as text, which is the whole
 * reason the checkout stores them that way.
 *
 * @param min Earliest allowed.
 * @param max Latest allowed.
 * @return True when the pair is the wrong way round.
 */
function isBackwardsText( min: string, max: string ): boolean {
	if ( '' === min || '' === max ) {
		return false;
	}
	return min > max;
}

export interface ValidationContext {
	idPrefix: string;
	formatPresets: Record< string, FormatPreset >;
	autocompleteTokens: string[];
	maxFields: number;
}

/**
 * Escape a literal for use inside a regular expression.
 *
 * @param value Literal text.
 * @return Escaped text.
 */
function escapeRegExp( value: string ): string {
	return value.replace( /[.*+?^${}()|[\]\\/]/g, '\\$&' );
}

/**
 * Whether a field key is well formed for the configured namespace.
 *
 * @param id     Field key.
 * @param prefix Namespace prefix, e.g. `cbwb/`.
 * @return True when valid.
 */
export function isValidFieldId( id: string, prefix: string ): boolean {
	const pattern = new RegExp(
		`^${ escapeRegExp( prefix ) }[a-z0-9]+(-[a-z0-9]+)*$`
	);
	return pattern.test( id );
}

/**
 * Whether a custom pattern compiles as a JavaScript regular expression.
 *
 * Only the `u` flag is tried, because only `u` is what the pattern will be run
 * with: WooCommerce hands it to ajv, which compiles `new RegExp( pattern, 'u' )`
 * during the checkout's render with nothing catching a throw. A pattern that
 * needs `v` compiles here and still breaks there, so `v` is treated as invalid
 * rather than as a second chance. The server applies the same rule, in
 * `FormatPresets::is_ecmascript_pattern()`.
 *
 * @param pattern Pattern body, unanchored.
 * @return True when it compiles.
 */
export function isValidPattern( pattern: string ): boolean {
	if ( '' === pattern || pattern.length > MAX_PATTERN_LENGTH ) {
		return false;
	}
	try {
		// eslint-disable-next-line no-new -- Compiling is the test.
		new RegExp( pattern, 'u' );
		return true;
	} catch {
		return false;
	}
}

/** Builds the `fields[i].<key>` path an error is reported at. */
type PathFor = ( key: string ) => string;

/**
 * The rules that belong to one type and no other: the number's range, the
 * textarea's height, the date and time windows, the heading's level and the
 * paragraph's text.
 *
 * @param field Field to check.
 * @param at    Path builder.
 * @return Failures, in the order the editor draws the controls.
 */
function typeRules( field: Field, at: PathFor ): ValidationError[] {
	const errors: ValidationError[] = [];

	const notANumber = ( key: 'min' | 'max' | 'step' ) => ( {
		path: at( key ),
		code: 'invalid_value',
		message: __(
			'Enter a number, or leave it empty.',
			'fieldwright-checkout-fields'
		),
	} );

	if ( 'number' === field.type ) {
		( [ 'min', 'max', 'step' ] as const ).forEach( ( key ) => {
			if ( ! isDecimalOrEmpty( field[ key ] ) ) {
				errors.push( notANumber( key ) );
			}
		} );

		if (
			isDecimalOrEmpty( field.min ) &&
			isDecimalOrEmpty( field.max ) &&
			isBackwardsNumber( field.min, field.max )
		) {
			errors.push( {
				path: at( 'max' ),
				code: 'invalid_range',
				message: __(
					'The largest value has to be at least the smallest one.',
					'fieldwright-checkout-fields'
				),
			} );
		}

		if (
			'' !== field.step &&
			isDecimalOrEmpty( field.step ) &&
			Number( field.step ) <= 0
		) {
			errors.push( {
				path: at( 'step' ),
				code: 'invalid_range',
				message: __(
					'The step has to be above 0.',
					'fieldwright-checkout-fields'
				),
			} );
		}
	}

	if ( 'textarea' === field.type ) {
		if (
			! Number.isInteger( field.rows ) ||
			field.rows < MIN_ROWS ||
			field.rows > MAX_ROWS
		) {
			errors.push( {
				path: at( 'rows' ),
				code: 'invalid_value',
				message: sprintf(
					/* translators: 1: smallest number of rows, 2: largest. */
					__(
						'Height must be a whole number between %1$d and %2$d rows.',
						'fieldwright-checkout-fields'
					),
					MIN_ROWS,
					MAX_ROWS
				),
			} );
		}
	}

	if ( 'date' === field.type ) {
		( [ 'date_min', 'date_max' ] as const ).forEach( ( key ) => {
			if ( '' !== field[ key ] && ! DATE_PATTERN.test( field[ key ] ) ) {
				errors.push( {
					path: at( key ),
					code: 'invalid_value',
					message: __(
						'Enter a date as YYYY-MM-DD, or leave it empty.',
						'fieldwright-checkout-fields'
					),
				} );
			}
		} );

		if (
			DATE_PATTERN.test( field.date_min ) &&
			DATE_PATTERN.test( field.date_max ) &&
			isBackwardsText( field.date_min, field.date_max )
		) {
			errors.push( {
				path: at( 'date_max' ),
				code: 'invalid_range',
				message: __(
					'The latest date has to be on or after the earliest one.',
					'fieldwright-checkout-fields'
				),
			} );
		}
	}

	if ( 'time' === field.type ) {
		( [ 'time_min', 'time_max' ] as const ).forEach( ( key ) => {
			if ( '' !== field[ key ] && ! TIME_PATTERN.test( field[ key ] ) ) {
				errors.push( {
					path: at( key ),
					code: 'invalid_value',
					message: __(
						'Enter a time as HH:MM, or leave it empty.',
						'fieldwright-checkout-fields'
					),
				} );
			}
		} );

		if (
			TIME_PATTERN.test( field.time_min ) &&
			TIME_PATTERN.test( field.time_max ) &&
			isBackwardsText( field.time_min, field.time_max )
		) {
			errors.push( {
				path: at( 'time_max' ),
				code: 'invalid_range',
				message: __(
					'The latest time has to be at or after the earliest one.',
					'fieldwright-checkout-fields'
				),
			} );
		}

		/*
		 * The server counts a time step in whole minutes, from one to a day, so
		 * a step of 7.5 is rejected there however sensible it looks here.
		 */
		if ( ! isDecimalOrEmpty( field.step ) ) {
			errors.push( notANumber( 'step' ) );
		} else if ( '' !== field.step && ! isWholeMinutes( field.step ) ) {
			errors.push( {
				path: at( 'step' ),
				code: 'invalid_range',
				message: sprintf(
					/* translators: %d: largest step in minutes. */
					__(
						'The step must be a whole number of minutes between 1 and %d.',
						'fieldwright-checkout-fields'
					),
					MAX_TIME_STEP
				),
			} );
		}
	}

	if (
		'heading' === field.type &&
		! [ 2, 3, 4 ].includes( field.content_level )
	) {
		errors.push( {
			path: at( 'content_level' ),
			code: 'invalid_value',
			message: __(
				'Choose a heading level of 2, 3 or 4.',
				'fieldwright-checkout-fields'
			),
		} );
	}

	if (
		'paragraph' === field.type &&
		field.content.length > MAX_CONTENT_LENGTH
	) {
		errors.push( {
			path: at( 'content' ),
			code: 'too_long',
			message: sprintf(
				/* translators: %d: character limit. */
				__(
					'Keep the text to %d characters or fewer.',
					'fieldwright-checkout-fields'
				),
				MAX_CONTENT_LENGTH
			),
		} );
	}

	return errors;
}

/**
 * The prefilled answer has to be an answer the field could actually be given —
 * one of its options, a real date, a yes or a no.
 *
 * @param field Field to check.
 * @param at    Path builder.
 * @return Failures.
 */
function defaultValueRules( field: Field, at: PathFor ): ValidationError[] {
	const value = field.default_value;

	if ( ! collectsAnswer( field.type ) || '' === value ) {
		return [];
	}

	const invalid = ( message: string ): ValidationError[] => [
		{ path: at( 'default_value' ), code: 'invalid_value', message },
	];

	if ( value.length > MAX_DEFAULT_VALUE_LENGTH ) {
		return [
			{
				path: at( 'default_value' ),
				code: 'too_long',
				message: sprintf(
					/* translators: %d: character limit. */
					__(
						'Keep the prefilled answer to %d characters or fewer.',
						'fieldwright-checkout-fields'
					),
					MAX_DEFAULT_VALUE_LENGTH
				),
			},
		];
	}

	/** The values this field's own options offer. */
	const optionValues = () => field.options.map( ( option ) => option.value );

	switch ( field.type ) {
		case 'checkbox':
			return 'yes' === value
				? []
				: invalid(
						__(
							'A checkbox starts either ticked or unticked.',
							'fieldwright-checkout-fields'
						)
				  );

		case 'select':
		case 'radio':
			return optionValues().includes( value )
				? []
				: invalid(
						__(
							'Pick one of this field’s own options.',
							'fieldwright-checkout-fields'
						)
				  );

		case 'checkbox_group':
			return value
				.split( ',' )
				.every( ( entry ) => optionValues().includes( entry.trim() ) )
				? []
				: invalid(
						__(
							'Every prefilled choice has to be one of this field’s own options.',
							'fieldwright-checkout-fields'
						)
				  );

		case 'date':
			return DATE_PATTERN.test( value )
				? []
				: invalid(
						__(
							'Enter a date as YYYY-MM-DD.',
							'fieldwright-checkout-fields'
						)
				  );

		case 'time':
			return TIME_PATTERN.test( value )
				? []
				: invalid(
						__(
							'Enter a time as HH:MM.',
							'fieldwright-checkout-fields'
						)
				  );

		case 'number':
			return DECIMAL_PATTERN.test( value )
				? []
				: invalid(
						__( 'Enter a number.', 'fieldwright-checkout-fields' )
				  );

		default:
			return [];
	}
}

/**
 * The checks the add-on that provided a type asked for.
 *
 * Only a registered type has any, and only the add-on knows what they are: its
 * settings live inside the field's opaque payload, which Free never reads. The
 * paths come back relative to the field, the way an editor section reports its
 * own, so they are anchored here. A failure that names no path at all is
 * reported against the payload the type's settings live in, which is enough to
 * put the message in front of the merchant beside the field it belongs to.
 *
 * @param field   Field to check.
 * @param at      Path builder.
 * @param context Bootstrap-derived rules, handed on unchanged.
 * @return Failures the type's own rules found.
 */
function registeredRules(
	field: Field,
	at: PathFor,
	context: ValidationContext
): ValidationError[] {
	const validate = descriptorFor( field.type )?.validate;

	if ( ! validate ) {
		return [];
	}

	const found = validate( field, context );

	if ( ! Array.isArray( found ) ) {
		return [];
	}

	return found
		.filter(
			( error ): error is ValidationError =>
				Boolean( error ) &&
				'object' === typeof error &&
				'string' === typeof error.message &&
				'' !== error.message
		)
		.map( ( error ) => ( {
			code: error.code || 'invalid_value',
			message: error.message,
			path: at( error.path || 'pro' ),
		} ) );
}

/**
 * Validate the whole list the way the REST controller does.
 *
 * @param fields  Fields to check.
 * @param context Bootstrap-derived rules.
 * @return Every failure, in document order.
 */
export function validateFields(
	fields: Field[],
	context: ValidationContext
): ValidationError[] {
	const all: ValidationError[] = [];
	const seenIds = new Set< string >();

	if ( fields.length > context.maxFields ) {
		all.push( {
			path: 'fields',
			code: 'too_many',
			message: sprintf(
				/* translators: %d: maximum number of fields. */
				__(
					'You can add up to %d fields.',
					'fieldwright-checkout-fields'
				),
				context.maxFields
			),
		} );
	}

	fields.forEach( ( field, index ) => {
		const at = ( key: string ) => `fields[${ index }].${ key }`;
		// Collected per field so add-ons see (and can add to) exactly the
		// errors that belong to the field they are handed.
		const errors: ValidationError[] = [];

		if ( field.id.length > MAX_ID_LENGTH ) {
			errors.push( {
				path: at( 'id' ),
				code: 'too_long',
				message: sprintf(
					/* translators: %d: character limit. */
					__(
						'Keep the field key to %d characters or fewer.',
						'fieldwright-checkout-fields'
					),
					MAX_ID_LENGTH
				),
			} );
		} else if ( ! isValidFieldId( field.id, context.idPrefix ) ) {
			errors.push( {
				path: at( 'id' ),
				code: 'invalid_id',
				message: sprintf(
					/* translators: %s: example field key. */
					__(
						'Use lowercase letters, numbers and dashes, like %s.',
						'fieldwright-checkout-fields'
					),
					`${ context.idPrefix }my-field`
				),
			} );
		} else if ( seenIds.has( field.id ) ) {
			errors.push( {
				path: at( 'id' ),
				code: 'duplicate_id',
				message: __(
					'Another field already uses this key.',
					'fieldwright-checkout-fields'
				),
			} );
		}
		seenIds.add( field.id );

		const label = field.label.trim();
		if ( '' === label ) {
			errors.push( {
				path: at( 'label' ),
				code: 'required',
				message: __(
					'Add a label so shoppers know what to enter.',
					'fieldwright-checkout-fields'
				),
			} );
		} else if ( field.label.length > MAX_LABEL_LENGTH ) {
			errors.push( {
				path: at( 'label' ),
				code: 'too_long',
				message: sprintf(
					/* translators: %d: character limit. */
					__(
						'Keep the label to %d characters or fewer.',
						'fieldwright-checkout-fields'
					),
					MAX_LABEL_LENGTH
				),
			} );
		}

		if ( field.placeholder.length > MAX_PLACEHOLDER_LENGTH ) {
			errors.push( {
				path: at( 'placeholder' ),
				code: 'too_long',
				message: sprintf(
					/* translators: %d: character limit. */
					__(
						'Keep the placeholder to %d characters or fewer.',
						'fieldwright-checkout-fields'
					),
					MAX_PLACEHOLDER_LENGTH
				),
			} );
		}

		if ( ! allowsPlacement( field.type, field.location ) ) {
			errors.push( {
				path: at( 'location' ),
				code: 'invalid_placement',
				message: __(
					'This field type cannot be placed there. Choose one of the listed places.',
					'fieldwright-checkout-fields'
				),
			} );
		}

		if ( 'full' !== field.width && 'half' !== field.width ) {
			errors.push( {
				path: at( 'width' ),
				code: 'invalid_width',
				message: __(
					'Choose either full or half width.',
					'fieldwright-checkout-fields'
				),
			} );
		} else if ( 'half' === field.width && ! usesWidth( field.type ) ) {
			errors.push( {
				path: at( 'width' ),
				code: 'invalid_width',
				message: __(
					'WooCommerce lays this field type out itself, so it is always full width.',
					'fieldwright-checkout-fields'
				),
			} );
		}

		if ( field.help.length > MAX_HELP_LENGTH ) {
			errors.push( {
				path: at( 'help' ),
				code: 'too_long',
				message: sprintf(
					/* translators: %d: character limit. */
					__(
						'Keep the help text to %d characters or fewer.',
						'fieldwright-checkout-fields'
					),
					MAX_HELP_LENGTH
				),
			} );
		}

		if ( usesOptions( field.type ) && 0 === field.options.length ) {
			errors.push( {
				path: at( 'options' ),
				code: 'options_required',
				message: __(
					'This field needs at least one option.',
					'fieldwright-checkout-fields'
				),
			} );
		}

		if (
			usesOptions( field.type ) &&
			'stacked' !== field.options_layout &&
			'inline' !== field.options_layout
		) {
			errors.push( {
				path: at( 'options_layout' ),
				code: 'invalid_value',
				message: __(
					'Choose whether the options stack or sit in a row.',
					'fieldwright-checkout-fields'
				),
			} );
		}

		// Reported instead of the options rather than alongside them, exactly as
		// the server reads it: a hundred and one messages about a list that is
		// one item too long says the same thing a hundred times over.
		const tooManyOptions =
			usesOptions( field.type ) && field.options.length > MAX_OPTIONS;

		if ( tooManyOptions ) {
			errors.push( {
				path: at( 'options' ),
				code: 'too_many',
				message: sprintf(
					/* translators: %d: maximum number of options. */
					__(
						'A field cannot have more than %d options.',
						'fieldwright-checkout-fields'
					),
					MAX_OPTIONS
				),
			} );
		}

		const seenValues = new Set< string >();
		const checkedOptions = tooManyOptions ? [] : field.options;
		checkedOptions.forEach( ( option, optionIndex ) => {
			const optionPath = at( `options[${ optionIndex }]` );
			const optionLabel = option.label.trim();

			if (
				! OPTION_VALUE_PATTERN.test( option.value ) ||
				option.value.length > MAX_OPTION_VALUE_LENGTH ||
				'' === optionLabel ||
				option.label.length > MAX_OPTION_LABEL_LENGTH
			) {
				errors.push( {
					path: optionPath,
					code: 'invalid_option',
					message: sprintf(
						/* translators: %d: option position, starting at 1. */
						__(
							'Option %d needs a label and a value of letters, numbers, dashes, dots, colons or underscores.',
							'fieldwright-checkout-fields'
						),
						optionIndex + 1
					),
				} );
			} else if ( seenValues.has( option.value ) ) {
				errors.push( {
					path: optionPath,
					code: 'duplicate_option',
					message: sprintf(
						/* translators: %d: option position, starting at 1. */
						__(
							'Option %d repeats a value used above.',
							'fieldwright-checkout-fields'
						),
						optionIndex + 1
					),
				} );
			}
			seenValues.add( option.value );
		} );

		if ( field.error_message.length > MAX_ERROR_MESSAGE_LENGTH ) {
			errors.push( {
				path: at( 'error_message' ),
				code: 'too_long',
				message: sprintf(
					/* translators: %d: character limit. */
					__(
						'Keep the error message to %d characters or fewer.',
						'fieldwright-checkout-fields'
					),
					MAX_ERROR_MESSAGE_LENGTH
				),
			} );
		}

		/*
		 * The format of a field whose type decides it is not a choice the
		 * merchant made, so it is not one they can get wrong: it is checked
		 * against the type rather than against the preset list, which also means
		 * a `url` field keeps working on a bootstrap whose preset list predates
		 * the preset.
		 */
		const forcedFormat = FORCED_FORMAT[ field.type ];
		if ( forcedFormat ) {
			if ( field.format !== forcedFormat ) {
				errors.push( {
					path: at( 'format' ),
					code: 'invalid_format',
					message: __(
						'This field type sets its own format.',
						'fieldwright-checkout-fields'
					),
				} );
			}
		} else if ( ! ( field.format in context.formatPresets ) ) {
			errors.push( {
				path: at( 'format' ),
				code: 'invalid_format',
				message: __(
					'Choose one of the listed formats.',
					'fieldwright-checkout-fields'
				),
			} );
		} else if (
			'custom' === field.format &&
			! isValidPattern( field.pattern )
		) {
			errors.push( {
				path: at( 'pattern' ),
				code: 'invalid_pattern',
				message: __(
					'Enter a regular expression JavaScript understands.',
					'fieldwright-checkout-fields'
				),
			} );
		}

		const ceiling = maxLengthCeiling( field.type );
		const maxLength = field.max_length;
		if ( null !== maxLength && null === ceiling ) {
			errors.push( {
				path: at( 'max_length' ),
				code: 'invalid_max_length',
				message: __(
					'This field type has no length to limit.',
					'fieldwright-checkout-fields'
				),
			} );
		} else if (
			null !== maxLength &&
			null !== ceiling &&
			( ! Number.isInteger( maxLength ) ||
				maxLength < 1 ||
				maxLength > ceiling )
		) {
			errors.push( {
				path: at( 'max_length' ),
				code: 'invalid_max_length',
				message: sprintf(
					/* translators: %d: maximum allowed value. */
					__(
						'Max length must be a whole number between 1 and %d.',
						'fieldwright-checkout-fields'
					),
					ceiling
				),
			} );
		}

		errors.push( ...typeRules( field, at ) );
		errors.push( ...defaultValueRules( field, at ) );
		errors.push( ...registeredRules( field, at, context ) );

		if (
			'' !== field.autocomplete &&
			! context.autocompleteTokens.includes( field.autocomplete )
		) {
			errors.push( {
				path: at( 'autocomplete' ),
				code: 'invalid_autocomplete',
				message: __(
					'Choose one of the listed autocomplete values.',
					'fieldwright-checkout-fields'
				),
			} );
		}

		all.push(
			...applyValidateFieldFilter( errors, field, index, context )
		);
	} );

	return all;
}

/** Errors for one field, keyed by the field property they belong to. */
export type FieldErrors = Record< string, string[] >;

export interface ErrorMap {
	/** Keyed by field id. */
	byField: Record< string, FieldErrors >;
	/**
	 * Every error for a field, keyed by field id, with the `fields[i].` prefix
	 * stripped: `fields[2].pro.fee.amount` arrives as `pro.fee.amount`. This is
	 * what extension sections filter by prefix to find their own errors.
	 */
	rawByField: Record< string, ValidationError[] >;
	/**
	 * Failures about one of WooCommerce's own fields, keyed by core key —
	 * `core.fields.postcode.label` arrives as `postcode` → `label`. A row with an
	 * entry here is a row the outline flags and the settings pane explains.
	 */
	byCore: Record< string, FieldErrors >;
	/**
	 * Every error for one of WooCommerce's own rows, keyed by core key, with the
	 * `core.fields.<key>.` prefix stripped: `core.fields.company.pro.default`
	 * arrives as `pro.default`. The core rows' half of `rawByField`, and what
	 * extension sections filter by prefix to find their own.
	 */
	rawByCore: Record< string, ValidationError[] >;
	/** Errors that are not attached to a single field. */
	general: string[];
	/** Total number of errors. */
	count: number;
}

/**
 * `core.fields.<key>.<prop>…`, or `core.fields.<key>` on its own.
 *
 * The property is only the first segment: an add-on's own payload is reported
 * deeper than that (`pro.default`), and the row's controls are keyed by the
 * property a message belongs to whatever sits under it.
 */
const CORE_PATH =
	/^core\.fields\.([A-Za-z0-9_]+)(?:\.(([A-Za-z0-9_]+)(?:\..*)?))?$/;

/** `core.order_note.hidden` and its coupon-form twin. */
const CORE_PSEUDO_PATH = /^core\.(order_note|coupon_form)\.([A-Za-z0-9_]+)$/;

/**
 * Turn a flat error list into something the editor can render, resolving
 * `fields[2].label` style paths against the current field order, and
 * `core.fields.postcode.label` against WooCommerce's own field keys.
 *
 * @param fields Current fields, in array order.
 * @param errors Errors from the client validator or the REST response.
 * @return Errors grouped by field id and property.
 */
export function mapErrors(
	fields: Field[],
	errors: ValidationError[]
): ErrorMap {
	const map: ErrorMap = {
		byField: {},
		rawByField: {},
		byCore: {},
		rawByCore: {},
		general: [],
		count: errors.length,
	};

	/**
	 * File one message under a key and a property.
	 *
	 * @param into    Map to write into.
	 * @param key     Field id or core key.
	 * @param prop    Property the message belongs to.
	 * @param message The message.
	 */
	const file = (
		into: Record< string, FieldErrors >,
		key: string,
		prop: string,
		message: string
	) => {
		into[ key ] = into[ key ] ?? {};
		into[ key ][ prop ] = into[ key ][ prop ] ?? [];
		into[ key ][ prop ].push( message );
	};

	errors.forEach( ( error ) => {
		const path = error.path ?? '';

		const core = CORE_PATH.exec( path );
		if ( core ) {
			// A failure about the row itself — an unknown key — has nowhere
			// more specific to go than the row.
			file( map.byCore, core[ 1 ], core[ 3 ] ?? 'row', error.message );

			map.rawByCore[ core[ 1 ] ] = map.rawByCore[ core[ 1 ] ] ?? [];
			map.rawByCore[ core[ 1 ] ].push( {
				...error,
				path: core[ 2 ] ?? '',
			} );
			return;
		}

		const pseudo = CORE_PSEUDO_PATH.exec( path );
		if ( pseudo ) {
			// The order-note box and the coupon form have one setting each and
			// carry no add-on payload, so the row's own map is all they need.
			file( map.byCore, pseudo[ 1 ], pseudo[ 2 ], error.message );
			return;
		}

		const match = /^fields\[(\d+)\]\.(([A-Za-z0-9_]+).*)$/.exec( path );
		const field = match ? fields[ Number( match[ 1 ] ) ] : undefined;

		if ( ! match || ! field ) {
			map.general.push( error.message );
			return;
		}

		const relative = match[ 2 ];

		file( map.byField, field.id, match[ 3 ], error.message );

		map.rawByField[ field.id ] = map.rawByField[ field.id ] ?? [];
		map.rawByField[ field.id ].push( { ...error, path: relative } );
	} );

	return map;
}

/**
 * Join the messages for one property into the single string a control's `help`
 * or error slot can render.
 *
 * @param errors Errors for one field.
 * @param key    Field property.
 * @return Joined message, or undefined when there is nothing to show.
 */
export function errorFor(
	errors: FieldErrors | undefined,
	key: string
): string | undefined {
	const messages = errors?.[ key ];
	return messages && messages.length > 0 ? messages.join( ' ' ) : undefined;
}
