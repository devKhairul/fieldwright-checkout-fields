/**
 * One merchant field, drawn inside WooCommerce's checkout.
 *
 * ## How this component knows which field it is
 *
 * Measured against WooCommerce 11.0.1, `wc-cart-checkout-base-frontend.js`:
 * the checkout's saved markup is walked by `renderInnerBlocks`, and for every
 * element it finds it does, in effect,
 *
 *     const { blockName = '', ...rest } = {
 *         ...( child instanceof HTMLElement ? child.dataset : {} ),
 *         className: child instanceof Element ? child.className : '',
 *     };
 *     const Component = blockMap[ blockName ];
 *     …
 *     <Component { ...rest }>{ children }</Component>
 *
 * So the wrapper's **entire dataset is spread as top-level props**, minus
 * `data-block-name`, which is consumed to pick the component, plus the
 * wrapper's `className`. `data-cbwb-field="cbwb/gift-message"` therefore
 * arrives as `props.cbwbField` — not under `attributes`, and not as the dashed
 * attribute name. (`attributes` is how the *outermost* checkout block gets its
 * props, through the `getProps` its own registration supplies; inner blocks
 * registered with `registerCheckoutBlock` have no such hook.)
 *
 * The other two spellings are still read, in case a future WooCommerce
 * normalises inner blocks onto the same `attributes` shape the parent uses.
 * They cost three lines and save a checkout that renders nothing.
 *
 * A component rendered with no field id at all is not an error either: a block
 * registered with `force: true` is appended once to every parent area that has
 * no saved child of its name — with no props whatsoever — so on a checkout
 * where the server injected wrappers into one area, the other six each mount a
 * bare copy. Those render nothing, which is the whole of their job.
 */

import {
	CheckboxControl,
	RadioControl,
	Title,
	ValidationInputError,
} from '@woocommerce/blocks-components';
import { useCallback, useEffect, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import type { ComponentType, ReactNode } from 'react';

import {
	CONTENT_TYPES,
	fieldKey,
	initialValue,
	isBuiltinType,
	joinValues,
	lengthCap,
	splitValues,
} from './bootstrap';
import {
	getFieldType,
	useExtensionValue,
	useFieldError,
	useFieldState,
	useHasExtensionValue,
	useSetExtensionValue,
	useValidationWriters,
} from './store';
import type {
	CheckoutBootstrap,
	FieldControlProps,
	FieldOption,
	FieldState,
	RequiredMarking,
	RichField,
} from './types';
import { validateField } from './validate';

/**
 * Join class names, dropping the empty ones.
 *
 * @param names Class names, or falsy values to skip.
 * @return One class attribute.
 */
function classNames( ...names: ( string | false | undefined )[] ): string {
	return names.filter( Boolean ).join( ' ' );
}

/**
 * The later of two `YYYY-MM-DD` bounds, treating '' as "no bound".
 *
 * @param a First bound.
 * @param b Second bound.
 * @return The binding one.
 */
function laterOf( a: string, b: string ): string {
	if ( '' === a || '' === b ) {
		return a || b;
	}
	return a > b ? a : b;
}

/**
 * The earlier of two `YYYY-MM-DD` bounds, treating '' as "no bound".
 *
 * @param a First bound.
 * @param b Second bound.
 * @return The binding one.
 */
function earlierOf( a: string, b: string ): string {
	if ( '' === a || '' === b ) {
		return a || b;
	}
	return a < b ? a : b;
}

/**
 * The label a shopper reads, with core's "(optional)" suffix where core puts
 * one.
 *
 * WooCommerce appends it to every optional field it renders itself — see
 * `%s (optional)` in `wc-cart-checkout-base-frontend.js` — so a field of ours
 * without it would be the odd one out in the same column.
 *
 * On a store that marks required fields instead, nothing is appended at all:
 * the server has already taken the suffix off WooCommerce's own fields by
 * setting each one's `optionalLabel` to its label, and the asterisk beside a
 * required label is the whole of what this checkout says about the difference.
 *
 * @param field   Field to label.
 * @param marking Which way round this store marks required fields.
 * @return The display label.
 */
export function displayLabel(
	field: RichField,
	marking: RequiredMarking = 'optional_label'
): string {
	if ( field.required || 'asterisk' === marking ) {
		return field.label;
	}

	return sprintf(
		/* translators: %s: field label. */
		__( '%s (optional)', 'fieldwright-checkout-fields' ),
		field.label
	);
}

/**
 * The asterisk a required field carries on a store that marks required rather
 * than optional.
 *
 * `aria-hidden`, and deliberately: the control itself carries `required`, which
 * is what a screen reader announces, and a spoken "star" after every label
 * would be noise on top of an announcement the shopper already has.
 *
 * The fields we draw ourselves render this rather than growing it from CSS the
 * way WooCommerce's own do, because these labels are ours to write and a real
 * element is one less thing for a theme to paint over.
 *
 * @param props         Component props.
 * @param props.field   Field being labelled.
 * @param props.marking Which way round this store marks required fields.
 * @return The mark, or nothing.
 */
function RequiredMark( {
	field,
	marking,
}: {
	field: RichField;
	marking: RequiredMarking;
} ) {
	if ( ! field.required || 'asterisk' !== marking ) {
		return null;
	}

	return (
		<span className="cbwb-required-mark" aria-hidden="true">
			*
		</span>
	);
}

/**
 * Pull the field id out of whatever props WooCommerce handed us.
 *
 * @param props Props from the block renderer.
 * @return The field id, or '' when there is none.
 */
export function readFieldId( props: Record< string, unknown > ): string {
	const direct = props.cbwbField;

	if ( 'string' === typeof direct && '' !== direct ) {
		return direct;
	}

	const attributes = props.attributes;

	if ( 'object' === typeof attributes && null !== attributes ) {
		const nested = ( attributes as Record< string, unknown > ).cbwbField;

		if ( 'string' === typeof nested && '' !== nested ) {
			return nested;
		}
	}

	const dashed = props[ 'data-cbwb-field' ];

	return 'string' === typeof dashed ? dashed : '';
}

/**
 * A multi-line answer.
 *
 * Core's own `Textarea` is fixed at two rows, which is too short for the gift
 * messages and delivery notes this type exists for, so the element is ours —
 * wearing core's class so it is styled by the same rules.
 *
 * @param props             Control props.
 * @param props.field
 * @param props.id
 * @param props.value
 * @param props.required
 * @param props.invalid
 * @param props.describedBy
 * @param props.onChange
 * @param props.onSettle
 * @return The control.
 */
function TextareaControl( {
	field,
	id,
	value,
	required,
	invalid,
	describedBy,
	onChange,
	onSettle,
}: FieldControlProps ) {
	return (
		<textarea
			id={ id }
			className="wc-block-components-textarea cbwb-field__textarea"
			rows={ field.rows }
			// The server's own ceiling stands in where the merchant set no
			// maximum, so the box stops taking characters at the same point the
			// order would be refused.
			maxLength={ lengthCap( field ) }
			placeholder={ field.placeholder || undefined }
			required={ required }
			aria-describedby={ describedBy }
			aria-invalid={ invalid }
			value={ value }
			onChange={ ( event ) => onChange( event.target.value ) }
			onBlur={ onSettle }
		/>
	);
}

/**
 * A date or a time, drawn by the browser's own picker.
 *
 * The `min` and `max` attributes are set as well as checked in JavaScript: they
 * are what stops a native picker offering an impossible day in the first place,
 * and what makes the input match core's `input:invalid` scroll-to-error
 * selector without any help from us.
 *
 * @param props             Control props.
 * @param props.field
 * @param props.id
 * @param props.value
 * @param props.required
 * @param props.invalid
 * @param props.describedBy
 * @param props.onChange
 * @param props.onSettle
 * @return The control.
 */
function DateTimeControl( {
	field,
	id,
	value,
	required,
	invalid,
	describedBy,
	onChange,
	onSettle,
}: FieldControlProps ) {
	const isDate = 'date' === field.type;
	const rules = field.dateRules ?? {};
	// An add-on's bounds narrow the merchant's rather than replacing them, and
	// they are set on the element as well as checked in JavaScript so the native
	// picker never offers a day the store would refuse.
	const min = isDate
		? laterOf( field.date_min, rules.minDate ?? '' )
		: field.time_min;
	const max = isDate
		? earlierOf( field.date_max, rules.maxDate ?? '' )
		: field.time_max;
	// A time input's step is in seconds; the merchant sets minutes.
	const step = Number( field.step );
	const seconds =
		! isDate && Number.isFinite( step ) && step > 0
			? String( Math.round( step * 60 ) )
			: undefined;

	return (
		<input
			id={ id }
			className="cbwb-field__input"
			type={ isDate ? 'date' : 'time' }
			min={ min || undefined }
			max={ max || undefined }
			step={ seconds }
			required={ required }
			aria-describedby={ describedBy }
			aria-invalid={ invalid }
			value={ value }
			onChange={ ( event ) => onChange( event.target.value ) }
			onBlur={ onSettle }
		/>
	);
}

interface SlotControlProps extends FieldControlProps {
	/** The choices the add-on offered, which may be none at all. */
	options: FieldOption[];
}

/**
 * One time from a list an add-on drew up.
 *
 * A time field the merchant left to the shopper is a clock; one an add-on has
 * given choices to — delivery slots worked out from the chosen date, the
 * store's hours and what is already booked — is a dropdown, because those are
 * the only answers the order can be placed with.
 *
 * The box is the same one `DateTimeControl` draws in rather than core's own
 * `.wc-blocks-components-select__select`: core's select is cut for the floating
 * label and the chevron its container draws, and the label here is above the
 * box like every other field of ours.
 *
 * A choice that is on the list but taken is drawn disabled and said so, rather
 * than left out: a shopper who cannot have 9am is better served by seeing that
 * it exists and is full than by wondering where it went.
 *
 * @param props             Control props.
 * @param props.id
 * @param props.value
 * @param props.required
 * @param props.invalid
 * @param props.describedBy
 * @param props.options
 * @param props.onChange
 * @param props.onSettle
 * @return The control.
 */
function SlotControl( {
	id,
	value,
	required,
	invalid,
	describedBy,
	options,
	onChange,
	onSettle,
}: SlotControlProps ) {
	// An answer that is no longer one of the open choices — the shopper picked a
	// time and then changed the date under it — shows as nothing chosen. The
	// stored value is the add-on's to clear; this only stops the control claiming
	// the shopper has an answer they no longer have.
	const chosen = options.some(
		( option ) => ! option.disabled && option.value === value
	)
		? value
		: '';

	return (
		<select
			id={ id }
			className="cbwb-field__input cbwb-field__select"
			required={ required }
			disabled={ 0 === options.length }
			aria-describedby={ describedBy }
			aria-invalid={ invalid }
			value={ chosen }
			onChange={ ( event ) => {
				onChange( event.target.value );
				onSettle();
			} }
			onBlur={ onSettle }
		>
			<option value="">
				{ __( 'Choose a time', 'fieldwright-checkout-fields' ) }
			</option>
			{ options.map( ( option ) => (
				<option
					key={ option.value }
					value={ option.value }
					disabled={ option.disabled }
				>
					{ option.disabled
						? sprintf(
								/* translators: %s: the name of a delivery time, e.g. "Morning (9:00 am to 12:00 pm)". */
								__(
									'%s (full)',
									'fieldwright-checkout-fields'
								),
								option.label
						  )
						: option.label }
				</option>
			) ) }
		</select>
	);
}

/**
 * One choice from a list.
 *
 * @param props          Control props.
 * @param props.field
 * @param props.id
 * @param props.value
 * @param props.onChange
 * @param props.onSettle
 * @return The control.
 */
function RadioGroupControl( {
	field,
	id,
	value,
	onChange,
	onSettle,
}: FieldControlProps ) {
	return (
		<RadioControl
			id={ id }
			className={ classNames(
				'cbwb-field__options',
				'inline' === field.options_layout &&
					'cbwb-field__options--inline'
			) }
			selected={ value }
			options={ field.options }
			onChange={ ( next ) => {
				onChange( next );
				onSettle();
			} }
		/>
	);
}

/**
 * Any number of choices from a list.
 *
 * The answer is stored as one comma-separated string because that is the shape
 * the server stores and the order confirmation prints — see `default_value` in
 * the field schema.
 *
 * @param props          Control props.
 * @param props.field
 * @param props.id
 * @param props.value
 * @param props.invalid
 * @param props.onChange
 * @param props.onSettle
 * @return The control.
 */
function CheckboxGroupControl( {
	field,
	id,
	value,
	invalid,
	onChange,
	onSettle,
}: FieldControlProps ) {
	const chosen = splitValues( value );

	return (
		<div
			className={ classNames(
				'cbwb-field__options',
				'inline' === field.options_layout &&
					'cbwb-field__options--inline'
			) }
		>
			{ field.options.map( ( option ) => (
				<CheckboxControl
					key={ option.value }
					id={ `${ id }-${ fieldKey( option.value ) }` }
					className="cbwb-field__option"
					label={ option.label }
					value={ option.value }
					checked={ chosen.includes( option.value ) }
					hasError={ invalid }
					onChange={ ( checked ) => {
						// Rebuilt from the merchant's order rather than the
						// click order, so the answer reads the way the list
						// does however it was ticked.
						onChange(
							joinValues(
								field.options
									.map(
										( { value: candidate } ) => candidate
									)
									.filter( ( candidate ) =>
										candidate === option.value
											? checked
											: chosen.includes( candidate )
									)
							)
						);
						onSettle();
					} }
				/>
			) ) }
		</div>
	);
}

interface FieldBodyProps {
	field: RichField;
	bootstrap: CheckoutBootstrap;
	/** What an add-on says about this field for this shopper. */
	state: FieldState;
	/**
	 * The control a registered type draws, or undefined for a built-in type.
	 *
	 * Looked up by the caller rather than here, because a type neither side has
	 * a control for must not reach this component at all: the hooks below would
	 * hold checkout up over a field the shopper cannot see.
	 */
	Control?: ComponentType< FieldControlProps >;
}

/**
 * A field that asks the shopper something.
 *
 * @param props           Component props.
 * @param props.field     Field to draw.
 * @param props.bootstrap Everything the server sent.
 * @param props.state     What an add-on says about the field.
 * @param props.Control   The registered control, where the type is not ours.
 * @return The field.
 */
function InputField( { field, bootstrap, state, Control }: FieldBodyProps ) {
	const { namespace, prefill, i18n, dateFormat, requiredMarking } = bootstrap;
	const key = fieldKey( field.id );
	const wrapperId = `cbwb-field-${ key }`;
	const controlId = `${ wrapperId }__control`;
	const helpId = `${ wrapperId }-help`;

	const value = useExtensionValue( namespace, field.id );
	const seeded = useHasExtensionValue( namespace, field.id );
	const setValue = useSetExtensionValue();
	const { errorId } = useFieldError( field.id );
	const { setError, clearError, showError } = useValidationWriters();
	const [ touched, setTouched ] = useState( false );
	const [ problem, setProblem ] = useState( '' );

	// The choices an add-on drew up for this field, where it drew any: a time
	// field with a list of them is a dropdown of those times and nothing else.
	const slots = 'time' === field.type ? state.options : undefined;
	// One line from the add-on, which stands in for the merchant's own help text
	// while it is there: a field that cannot be answered yet has more to say
	// about why than the sentence written for the ordinary case. Read whether or
	// not there is a list to draw, because "the times could not be loaded" is
	// exactly the case where the add-on has none to offer and the field falls
	// back to being an ordinary clock.
	const note = 'time' === field.type ? state.note ?? '' : '';
	const help = '' === note ? field.help : note;

	// True once the error is on screen, whoever put it there — a blur of ours,
	// or core's `showAllValidationErrors()` when the shopper pressed the button
	// without touching this field at all.
	const shown = '' !== errorId;
	// A problem the control itself ran into — a request of its own that failed —
	// comes first: the shopper watched it happen, and no rule about the answer
	// they have not managed to give yet says anything as useful.
	const message =
		problem || validateField( field, value, i18n, dateFormat, state );

	// The store is the only copy of the answer, so it has to be given the
	// starting one. Guarded on "has this key been written" rather than on the
	// answer being empty, or clearing a prefilled field would fill it back in.
	useEffect( () => {
		if ( ! seeded ) {
			setValue( namespace, field.id, initialValue( field, prefill ) );
		}
	}, [ seeded, setValue, namespace, field, prefill ] );

	useEffect( () => {
		if ( '' === message ) {
			clearError( field.id );
			return;
		}

		setError( field.id, message, ! touched && ! shown );
	}, [ message, touched, shown, field.id, setError, clearError ] );

	// A field that is no longer on the page must not hold checkout up. Core's
	// own inputs do exactly this on unmount, for the same reason.
	useEffect( () => () => clearError( field.id ), [ field.id, clearError ] );

	const settle = useCallback( () => {
		setTouched( true );
		showError( field.id );
	}, [ showError, field.id ] );

	const change = useCallback(
		( next: string ) => setValue( namespace, field.id, next ),
		[ setValue, namespace, field.id ]
	);

	// Shown straight away rather than on the next blur: the shopper has just
	// done something and watched it fail, so waiting for anything else would
	// leave them looking at a control that says nothing happened.
	const report = useCallback( ( next: string ) => {
		setProblem( next );

		if ( '' !== next ) {
			setTouched( true );
		}
	}, [] );

	const hasError = '' !== message && ( touched || shown );
	const describedBy =
		classNames(
			'' !== help && helpId,
			// Only once the store agrees the message is on screen: naming a
			// paragraph that is not there is worse than naming nothing.
			shown && errorId
		) || undefined;

	const controlProps: FieldControlProps = {
		field,
		id: controlId,
		value,
		required: field.required,
		invalid: hasError,
		describedBy,
		state,
		onChange: change,
		onSettle: settle,
		onProblem: report,
	};

	const label = displayLabel( field, requiredMarking );
	const mark = <RequiredMark field={ field } marking={ requiredMarking } />;
	const isGroup = 'radio' === field.type || 'checkbox_group' === field.type;

	return (
		<Wrapper field={ field } id={ wrapperId } hasError={ hasError }>
			{ isGroup ? (
				<fieldset
					className="cbwb-field__group"
					aria-describedby={ describedBy }
					// A group has no single control to carry `required` and
					// `aria-invalid` the way a textarea does — the radios are
					// one answer between them — so the fieldset carries both,
					// which is what a screen reader reads out on the way in.
					aria-required={ field.required || undefined }
					aria-invalid={ hasError || undefined }
				>
					<legend className="cbwb-field__label">
						{ label }
						{ mark }
					</legend>
					{ 'radio' === field.type && (
						<RadioGroupControl { ...controlProps } />
					) }
					{ 'checkbox_group' === field.type && (
						<CheckboxGroupControl { ...controlProps } />
					) }
				</fieldset>
			) : (
				<>
					<label className="cbwb-field__label" htmlFor={ controlId }>
						{ label }
						{ mark }
					</label>
					{ Control && <Control { ...controlProps } /> }
					{ ! Control && 'textarea' === field.type && (
						<TextareaControl { ...controlProps } />
					) }
					{ ! Control &&
						'textarea' !== field.type &&
						( undefined === slots ? (
							<DateTimeControl { ...controlProps } />
						) : (
							<SlotControl
								{ ...controlProps }
								options={ slots }
							/>
						) ) }
				</>
			) }
			{ '' !== help && (
				<p className="cbwb-field__help" id={ helpId }>
					{ help }
				</p>
			) }
			<ValidationInputError
				propertyName={ field.id }
				elementId={ field.id }
			/>
		</Wrapper>
	);
}

/**
 * A field that tells the shopper something.
 *
 * ## Trust boundary
 *
 * A paragraph's text is merchant-authored HTML — links, bold, italic and line
 * breaks — and it is written into the page without being touched here. That is
 * safe only because of what happens before it arrives: the REST controller runs
 * it through `wp_kses()` on save with an allow-list of those tags, and
 * `Checkout\Assets` prints the already-sanitised string. Nothing between the
 * two can add to it — the payload is JSON-encoded by `wp_json_encode()`, not
 * concatenated — and only a user who can edit the checkout could have written
 * it in the first place.
 *
 * So the invariant this component depends on is: **`content` is `wp_kses()`
 * output**. Anything that starts sending paragraph text from somewhere other
 * than the config REST route has to sanitise it there, not here, because by the
 * time it reaches this line the escaping decision has already been made.
 *
 * @param props       Component props.
 * @param props.field Field to draw.
 * @return The field.
 */
function ContentField( { field }: { field: RichField } ) {
	const wrapperId = `cbwb-field-${ fieldKey( field.id ) }`;
	const helpId = `${ wrapperId }-help`;

	return (
		<Wrapper field={ field } id={ wrapperId } hasError={ false }>
			{ 'heading' === field.type ? (
				<Title
					headingLevel={ field.content_level }
					className="cbwb-heading"
				>
					{ field.label }
				</Title>
			) : (
				<p
					className="cbwb-paragraph"
					/* eslint-disable-next-line react/no-danger -- Server-sanitised with wp_kses(); see the trust boundary above. */
					dangerouslySetInnerHTML={ { __html: field.content } }
				/>
			) }
			{ '' !== field.help && (
				<p className="cbwb-field__help" id={ helpId }>
					{ field.help }
				</p>
			) }
		</Wrapper>
	);
}

interface WrapperProps {
	field: RichField;
	id: string;
	hasError: boolean;
	children: ReactNode;
}

/**
 * The box every field is drawn in.
 *
 * @param props          Component props.
 * @param props.field    Field being drawn.
 * @param props.id       DOM id.
 * @param props.hasError Whether an error is on screen.
 * @param props.children The label, control, help and error.
 * @return The wrapper.
 */
function Wrapper( { field, id, hasError, children }: WrapperProps ) {
	return (
		<div
			id={ id }
			className={ classNames(
				'cbwb-field',
				// The type verbatim, underscore and all: it is the same string
				// the server, the builder and the E2E selectors use, and a
				// tidier spelling here would be a fourth one to keep in step.
				`cbwb-field--${ field.type }`,
				`cbwb-field--${ field.width }`,
				hasError && 'has-error'
			) }
		>
			{ children }
		</div>
	);
}

export interface CheckoutFieldProps {
	bootstrap: CheckoutBootstrap;
	/** Whatever WooCommerce spread off the wrapper's dataset. */
	[ key: string ]: unknown;
}

/**
 * The component WooCommerce renders for every `cbwb/field` wrapper.
 *
 * ## Which control draws the field
 *
 * Three answers, tried in that order: one of Free's own types is drawn by the
 * control above; a type an add-on registered is drawn by that registration's
 * `Control`; a type that is neither is drawn by nothing at all — no markup, and
 * no validation error either, so a field nobody can see cannot hold the order
 * up.
 *
 * The last case is a guard rather than a normal path. The server has already
 * left every unavailable field out of the payload, so reaching it means the
 * add-on's PHP registered a type its bundle then did not, or did not load.
 *
 * The registry is read here, at render time, and never when this module loads:
 * an add-on's bundle depends on Free's script handle and therefore runs after
 * it, so anything read at load would be read before the add-on had registered
 * a thing.
 *
 * @param props           Component props.
 * @param props.bootstrap Everything the server sent.
 * @return The field, or nothing when this copy has no field to draw.
 */
export default function CheckoutField( {
	bootstrap,
	...props
}: CheckoutFieldProps ) {
	const id = readFieldId( props );
	// Called before the early return, because a hook cannot be. An id that
	// matches no field asks about '' and gets the default state, which is the
	// right answer for a bare forced copy.
	const state = useFieldState( id );
	const field = bootstrap.fields.find( ( candidate ) => candidate.id === id );

	if ( ! field || state.hidden ) {
		return null;
	}

	// An add-on may make a field the merchant left optional required, or the
	// other way round, for this shopper only. Applied here so the label, the
	// control's own `required` and the validation all read the same answer.
	const resolved: RichField =
		'boolean' === typeof state.required && state.required !== field.required
			? { ...field, required: state.required }
			: field;

	if ( CONTENT_TYPES.includes( resolved.type ) ) {
		return <ContentField field={ resolved } />;
	}

	const builtin = isBuiltinType( resolved.type );
	const Control = builtin
		? undefined
		: getFieldType( resolved.type )?.Control;

	if ( ! builtin && ! Control ) {
		return null;
	}

	return (
		<InputField
			field={ resolved }
			bootstrap={ bootstrap }
			state={ state }
			Control={ Control }
		/>
	);
}
