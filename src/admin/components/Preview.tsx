/**
 * The centre canvas: a mock of the WooCommerce block checkout that doubles as
 * the builder's main working surface.
 *
 * It reproduces WooCommerce's own markup and class names, so wherever the
 * `wc-blocks-style` sheet is on the page the preview inherits the real
 * checkout's styling; `Preview.scss` carries fallbacks for everywhere it is not
 * (unit tests, and WooCommerce builds that keep the checkout CSS in a separate
 * handle).
 *
 * Everything that is only a *picture* of the checkout — the core controls, the
 * headings, the merchant's own previewed fields — is `aria-hidden`: the Fields
 * outline beside it is the accessible, keyboard-operable copy of the same
 * information, and a visually hidden summary stands in for the picture. The one
 * thing that is not a picture is the ghost "Add field" button each section
 * ends with, so those are rendered *outside* the hidden parts and are real,
 * focusable buttons.
 *
 * Nothing inside the mock is focusable (`tabIndex={-1}` throughout) and every
 * control has `pointer-events: none`, so a click anywhere on a previewed field
 * lands on its wrapper and selects it.
 *
 * All of that is Edit mode. In Live mode the same markup is a working copy of
 * the checkout instead: the controls are live and focusable, nothing is
 * `aria-hidden`, a click selects nothing, the ghost buttons are gone, and the
 * add-on filters are asked what the form should look like given the answers so
 * far. What the merchant typed lives in `lib/previewState.ts` and is never
 * saved; leaving Live mode puts every control back.
 */

import type { ComponentType, ReactNode } from 'react';

import { Button, ToggleControl } from '@wordpress/components';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { desktop, external, mobile, plus } from '@wordpress/icons';
import { __, _n, sprintf } from '@wordpress/i18n';

import type { CoreRow, PseudoRow } from '../lib/coreFields';
import {
	addressRowOrder,
	buildCoreRows,
	buildPseudoRows,
	coreRowId,
	emptyCore,
	resolveCoreFields,
} from '../lib/coreFields';
import {
	SELECT_PLACEHOLDER_DEFAULT,
	byLocation,
	isBuiltinType,
} from '../lib/fields';
import type {
	PreviewBodyProps,
	PreviewMode,
	PreviewOption,
	PreviewSummaryLine,
} from '../lib/hooks';
import {
	previewFieldLabel,
	previewFieldState,
	previewSummaryLines,
} from '../lib/hooks';
import {
	isMissingRequired,
	previewContext,
	usePreviewState,
} from '../lib/previewState';
import { sanitizeContent } from '../lib/sanitize';
import type { ResolvedType } from '../lib/typeMeta';
import { descriptorFor, familyOf, unavailableLabel } from '../lib/typeMeta';
import type {
	Field,
	FieldLocation,
	FieldOption,
	FieldType,
	PlacementMeta,
	RequiredMarking,
} from '../types';
import SegmentedControl from './SegmentedControl';
import { AddFieldPicker } from './TypePicker';

export type PreviewViewport = 'desktop' | 'mobile';

/** Where the Desktop/Mobile choice is remembered between page loads. */
export const VIEWPORT_STORAGE_KEY = 'cbwb-preview-viewport';

/** Breathing room left around a field the preview scrolls to, in pixels. */
const SCROLL_MARGIN = 16;

/**
 * How long a smooth scroll is taken to still be running, in milliseconds.
 *
 * Nothing reports when one finishes, and `scrollTop` during it is the animation
 * rather than its destination — so within this window the frame is measured
 * against where it is *going*, and after it against where it is.
 */
const SCROLL_SETTLE = 700;

/**
 * The fixed amounts the order summary illustrates, in whole currency units.
 *
 * Every line is named and the total is their sum, which is the point of them
 * being here rather than typed into the markup. A summary reading "Subtotal
 * $20.00 / Total $25.00" leaves five dollars unaccounted for, and beside a
 * field labelled "Gift wrap +$5.00" the merchant reads those five dollars as
 * the fee — added to an order in which the box beside it is not even ticked.
 *
 * No fee is in this total in Edit mode, and none can be: everything in the mock
 * is a picture there, its controls are `readOnly`, and a fee is charged by a
 * shopper ticking a box. Live mode is where there is a tick to price, so that is
 * where an add-on's summary rows are added and counted into the total.
 */
const PREVIEW_SUBTOTAL = 20;
const PREVIEW_SHIPPING = 5;

/**
 * The types an add-on can answer with a list of choices for.
 *
 * A time field is the one whose whole list an add-on draws up: the merchant
 * types no options for it, and delivery slots are the add-on's to offer. The
 * other three have the merchant's own options, and all an add-on does to those
 * is rename them. Both are worth asking about in Edit mode, because both change
 * what the picture of the checkout shows.
 */
const CHOICE_TYPES: FieldType[] = [
	'time',
	'select',
	'radio',
	'checkbox_group',
];

/**
 * The types worth asking an add-on about outside the Live mode.
 *
 * The choices, and a date: the days an add-on rules out are a fact about the
 * field rather than about anything the merchant has typed, and a picker offering
 * days the checkout would refuse is a picture of the wrong checkout.
 */
const EDIT_MODE_TYPES: FieldType[] = [ ...CHOICE_TYPES, 'date' ];

/**
 * The country the mock has always shown, and the one Live mode starts at.
 *
 * A picture only ever needed this one. A working copy needs a few to switch
 * between, so a rule about the billing country has something to answer to;
 * `tryCountries()` is that short list.
 */
const PREVIEW_COUNTRY = 'US';

/**
 * One of those amounts, written the way the mock writes money.
 *
 * Not the store's currency: the whole summary is an illustration, and pricing
 * an imaginary cart in real money would invite the merchant to check the sum
 * against their own products.
 *
 * @param amount Amount in whole currency units.
 * @return The amount as text.
 */
/**
 * Attributes that keep autofill and password managers out of the preview.
 *
 * In Live mode the mock is a real form with inputs labelled the way a checkout
 * labels them, which is exactly what a password manager or the browser's own
 * autofill looks for. Neither belongs on a preview inside the builder: the
 * merchant is not entering an address, and an overlay from an extension would
 * cover the very thing they are trying to see. `autoComplete="off"` covers the
 * browser; the `data-` attributes are the opt-outs 1Password, LastPass,
 * Bitwarden, Dashlane and Grammarly each read.
 */
const NO_AUTOFILL = {
	autoComplete: 'off',
	'data-1p-ignore': 'true',
	'data-lpignore': 'true',
	'data-bwignore': 'true',
	'data-form-type': 'other',
	// Writing assistants attach to any editable text box; these are their opt-outs.
	'data-gramm': 'false',
	'data-gramm_editor': 'false',
	'data-enable-grammarly': 'false',
	spellCheck: false,
} as const;

/**
 * An amount on the mock order summary.
 *
 * The illustrated subtotal and shipping are this plugin's own invention, and a
 * dollar sign is as good a placeholder as any for two numbers nobody is paying.
 * An add-on's rows are not invented, though: they are what the store will
 * actually charge, so a row that arrives already written in the store's own
 * money is printed exactly as it came.
 *
 * @param amount    Amount in whole currency units.
 * @param formatted The same amount as the add-on wrote it, where it wrote one.
 * @return The text to print.
 */
function previewMoney( amount: number, formatted?: string ): string {
	return formatted ?? `$${ amount.toFixed( 2 ) }`;
}

interface PreviewProps {
	fields: Field[];
	/** Every type, resolved, for the ghost buttons' picker. */
	types: ResolvedType[];
	/** Every placement, for the summary the canvas is described by. */
	placements: PlacementMeta[];
	selectedId: string | null;
	/**
	 * The selection the app booted with. Landing on the page should not move
	 * the preview, so the first render is only skipped when the selection is
	 * still the one the page loaded with — a preview that mounts because a
	 * field was just added scrolls to it like any other selection change.
	 */
	initialSelectedId?: string | null;
	onSelect: ( id: string ) => void;
	/** Adds a field of the picked type to one of the checkout's sections. */
	onAdd: ( location: FieldLocation, type: FieldType ) => void;
	/** False once the storage ceiling is reached. */
	canAdd: boolean;
	/** Storefront checkout URL, from the bootstrap data. */
	checkoutUrl: string;

	/* ----------------------- WooCommerce's own checkout fields.
	 *
	 * Left out entirely by a builder running against a server that predates
	 * them, in which case the picture falls back to the checkout it always drew
	 * — WooCommerce's own defaults, drawn but not editable.
	 */

	coreRows?: CoreRow[];
	pseudoRows?: PseudoRow[];
	/** The address section, top to bottom: core rows and custom fields mixed. */
	addressOrder?: string[];
	/** True when the core rows above are the server's, and can be clicked. */
	hasCore?: boolean;

	/**
	 * Which way round the checkout marks required fields, from the Settings tab.
	 * Defaults to WooCommerce's own way round, so a caller that has not been
	 * told draws the checkout WooCommerce ships.
	 */
	requiredMarking?: RequiredMarking;
}

/**
 * The remembered viewport, defaulting to desktop.
 *
 * @return Stored viewport.
 */
function readViewport(): PreviewViewport {
	try {
		return 'mobile' === window.localStorage.getItem( VIEWPORT_STORAGE_KEY )
			? 'mobile'
			: 'desktop';
	} catch {
		// Storage can be turned off entirely; the preview just forgets.
		return 'desktop';
	}
}

/**
 * Remember the viewport for the next page load.
 *
 * @param viewport Viewport to store.
 */
function writeViewport( viewport: PreviewViewport ): void {
	try {
		window.localStorage.setItem( VIEWPORT_STORAGE_KEY, viewport );
	} catch {
		// See readViewport().
	}
}

/**
 * Whether the reader has asked for less motion.
 *
 * @return True when animation should be skipped.
 */
function prefersReducedMotion(): boolean {
	return Boolean(
		window.matchMedia?.( '(prefers-reduced-motion: reduce)' )?.matches
	);
}

/**
 * How far a node sits below the top of an ancestor's own content box.
 *
 * Walks the offset chain rather than using `getBoundingClientRect()`, so the
 * answer stays right whatever the page around the preview is doing.
 *
 * @param node     Node to measure.
 * @param ancestor Positioned ancestor to measure against.
 * @return Offset in pixels.
 */
function offsetWithin( node: HTMLElement, ancestor: HTMLElement ): number {
	let top = 0;
	let current: HTMLElement | null = node;

	while ( current && current !== ancestor ) {
		top += current.offsetTop ?? 0;
		current = current.offsetParent as HTMLElement | null;
	}

	return top;
}

/**
 * Bring a field into view inside the preview frame — and nowhere else.
 *
 * `scrollIntoView()` walks every scrollable ancestor up to the window, which
 * yanks the whole admin page around whenever the selection changes. This moves
 * the frame's own scroll offset instead, and never touches window scroll.
 *
 * Everything is measured from the frame's own layout — where the node sits in
 * the frame's content, how tall the frame is — and from `from`, never from
 * `scrollTop`. Halfway through a smooth scroll `scrollTop` is the animation
 * rather than its destination, so a second selection arriving inside that half
 * second measured a field against a viewport the frame had already left: a
 * field the frame was scrolling *past* looked like one already on screen, and
 * the preview parked on the first field with the second one selected.
 *
 * @param frame Scrolling frame.
 * @param node  Field to reveal.
 * @param from  Where the frame is, or is on its way to.
 * @return The offset the frame is now heading for.
 */
function scrollFrameTo(
	frame: HTMLElement,
	node: HTMLElement,
	from: number
): number {
	const top = offsetWithin( node, frame );
	const bottom = top + ( node.offsetHeight ?? 0 );
	const viewBottom = from + frame.clientHeight;

	let next = from;
	if ( top < from ) {
		next = top - SCROLL_MARGIN;
	} else if ( bottom > viewBottom ) {
		next = bottom - frame.clientHeight + SCROLL_MARGIN;
	}

	next = Math.max( 0, next );
	if ( next === from ) {
		return from;
	}

	/*
	 * A browser skips the animation entirely in a tab it is not rendering, so a
	 * smooth scroll there would simply never happen. Jump in that case, as when
	 * the reader has asked for less motion.
	 */
	if (
		prefersReducedMotion() ||
		document.hidden ||
		'function' !== typeof frame.scrollTo
	) {
		frame.scrollTop = next;
		return next;
	}

	frame.scrollTo( { top: next, behavior: 'smooth' } );

	return next;
}

/**
 * The label core renders for a field, including its "(optional)" suffix, after
 * any add-on has had its say (a fee amount, say).
 *
 * The add-on goes first and core's suffix last, which is the order the real
 * checkout builds them in: an add-on decorates the *stored* label through
 * `cbwb_field_checkout_label`, and WooCommerce appends "(optional)" to whatever
 * it was handed. So the shopper reads "Gift wrap +$5.00 (optional)", and so
 * does the merchant here.
 *
 * A store that marks required fields instead gets no suffix at all: the
 * asterisk beside the label is what says which way round this checkout works,
 * and "(optional)" as well would say both.
 *
 * @param field    Field to label.
 * @param marking  Which way round the store marks required fields.
 * @param required Whether the field has to be answered right now; the
 *                 merchant's own switch unless an add-on has said otherwise.
 * @return Display label.
 */
function labelFor(
	field: Field,
	marking: RequiredMarking,
	required: boolean = field.required
): string {
	const label = previewFieldLabel( field.label, field );

	if ( required || 'asterisk' === marking ) {
		return label;
	}

	return sprintf(
		/* translators: %s: field label. */
		__( '%s (optional)', 'fieldwright-checkout-fields' ),
		label
	);
}

/**
 * What the checkout says about a required field the shopper left empty.
 *
 * The merchant's own message wins, exactly as it does on the server, and the
 * fallback is the sentence the server builds from the label — so the preview
 * repeats the checkout rather than inventing wording of its own.
 *
 * @see includes/Fields/RichValues.php
 * @param field The field.
 * @return One sentence.
 */
function requiredMessage( field: Field ): string {
	const own = ( field.error_message ?? '' ).trim();

	if ( '' !== own ) {
		return own;
	}

	return sprintf(
		/* translators: %s: field label. */
		__( 'Please fill in %s.', 'fieldwright-checkout-fields' ),
		field.label
	);
}

/**
 * The asterisk a required field carries while the store marks required rather
 * than optional.
 *
 * Decorative, like everything else in the mock: the canvas is `aria-hidden`,
 * and on the real checkout the input's own `required` is what is announced.
 *
 * @param props      Component props.
 * @param props.show Whether this field carries one.
 * @return The mark, or nothing.
 */
function RequiredMark( { show }: { show?: boolean } ) {
	if ( ! show ) {
		return null;
	}

	return (
		<span className="cbwb-required-mark" aria-hidden="true">
			*
		</span>
	);
}

/**
 * The field's own choices, wearing whatever labels an add-on gave them.
 *
 * The list stays the merchant's: their options, in their order. An add-on only
 * renames them — a fee on one of the choices reads as part of its label at
 * checkout, so it does here too — which is why an entry for a value the field
 * does not have is ignored, and a value the add-on said nothing about keeps the
 * label the merchant typed. A choice that is drawn but cannot be picked is the
 * one other thing an add-on can say about it.
 *
 * @param options The field's own choices.
 * @param offered What the add-on answered with, where it answered at all.
 * @return The choices to draw.
 */
function labelledOptions(
	options: FieldOption[],
	offered?: PreviewOption[]
): PreviewOption[] {
	if ( ! offered ) {
		return options;
	}

	const named = new Map(
		offered.map( ( option ): [ string, PreviewOption ] => [
			option.value,
			option,
		] )
	);

	return options.map( ( option ) => {
		const match = named.get( option.value );

		if ( ! match ) {
			return option;
		}

		return match.disabled
			? { value: option.value, label: match.label, disabled: true }
			: { value: option.value, label: match.label };
	} );
}

/**
 * Join class names, dropping the empty ones.
 *
 * @param names Class names.
 * @return Class attribute.
 */
function classNames( ...names: ( string | false | undefined )[] ): string {
	return names.filter( Boolean ).join( ' ' );
}

/**
 * Core's class name for one of the merchant's own fields, which is its key with
 * the namespace slash flattened.
 *
 * @param prefix Class prefix.
 * @param id     Field key.
 * @return Class name.
 */
function keyClass( prefix: string, id: string ): string {
	return `${ prefix }${ id.replace( /\//g, '-' ) }`;
}

/**
 * The `type` attribute the checkout gives a text box of this field type.
 *
 * @param field Field to render.
 * @return HTML input type.
 */
function inputTypeFor( field: Field ): string {
	switch ( field.type ) {
		case 'email':
			return 'email';
		case 'phone':
			return 'tel';
		case 'number':
			return 'number';
		case 'url':
			return 'url';
		case 'date':
			return 'date';
		case 'time':
			return 'time';
		default:
			return 'text';
	}
}

/** The `min`, `max` and `step` a control is drawn with, where it has them. */
interface Constraints {
	min?: string;
	max?: string;
	step?: string;
}

/**
 * The later of two `YYYY-MM-DD` bounds, treating '' as "no bound". The twin of
 * `laterOf()` in the checkout bundle, which is where the real picker is built.
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
 * The limits the checkout puts on a control, so the picker the preview draws
 * offers the same days, times and amounts the real one will accept.
 *
 * @param field  Field to render.
 * @param bounds The days an add-on rules out, where it has any. They narrow the
 *               merchant's own earliest and latest rather than replacing them,
 *               exactly as `src/checkout/Field.tsx` combines the two.
 * @return Attributes to set, leaving out the ones this type has no use for.
 */
function constraintsFor( field: Field, bounds?: PreviewDates ): Constraints {
	if ( 'number' === field.type ) {
		return {
			min: field.min || undefined,
			max: field.max || undefined,
			step: field.step || undefined,
		};
	}

	if ( 'date' === field.type ) {
		return {
			min: laterOf( field.date_min, bounds?.minDate ?? '' ) || undefined,
			max:
				earlierOf( field.date_max, bounds?.maxDate ?? '' ) || undefined,
		};
	}

	if ( 'time' === field.type ) {
		const minutes = Number( field.step );

		return {
			min: field.time_min || undefined,
			max: field.time_max || undefined,
			// A time input counts its step in seconds; the merchant sets minutes.
			step:
				Number.isFinite( minutes ) && minutes > 0
					? String( Math.round( minutes * 60 ) )
					: undefined,
		};
	}

	return {};
}

/**
 * Clicking a previewed field selects it, which duplicates what the Fields
 * outline already does with a real button. The mock is hidden from assistive
 * technology, so a keyboard handler here would be unreachable noise.
 */
/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */

interface StepProps {
	title: string;
	description?: string;
	className: string;
	/** True in Live mode: the heading is a real heading, not part of a picture. */
	live?: boolean;
	children?: ReactNode;
	/** The section's "Add field" control, which is not part of the picture. */
	action?: ReactNode;
}

/* One `CheckoutStep`: a heading, an optional description and the content. */
function Step( {
	title,
	description,
	className,
	live,
	children,
	action,
}: StepProps ) {
	return (
		<div
			className={ classNames(
				'wc-block-components-checkout-step',
				className
			) }
		>
			<div
				className="wc-block-components-checkout-step__heading-container"
				aria-hidden={ live ? undefined : 'true' }
			>
				<div className="wc-block-components-checkout-step__heading">
					<h2 className="wc-block-components-title wc-block-components-checkout-step__title">
						{ title }
					</h2>
				</div>
				{ description && (
					<p className="wc-block-components-checkout-step__description">
						{ description }
					</p>
				) }
			</div>
			<div className="wc-block-components-checkout-step__content">
				{ children }
				{ action }
			</div>
		</div>
	);
}

/**
 * What a control needs beyond its picture once the mock is a working form.
 *
 * `live` is the switch: with it off every one of these is ignored and the
 * control renders exactly as it always has. With it on the control is real, so
 * it is out of `aria-hidden`, focusable, and reports what the merchant does to
 * it through `onValue` — always in the checkout's own storage shape, so what
 * an add-on reads back through the preview filters is what the server would
 * have stored.
 */
interface LiveProps {
	/** True in Live mode: the control answers rather than illustrates. */
	live?: boolean;
	/** One short sentence from an add-on, drawn as a tag under the control. */
	note?: string;
	/** The checkout's own message for a required field left empty. */
	error?: string;
	/** The value changed, in the checkout's storage shape. */
	onValue?: ( value: string ) => void;
	/** The merchant left the control, which is when a required one may complain. */
	onLeave?: () => void;
}

interface ControlProps extends LiveProps {
	id: string;
	label: string;
	/** True while this field carries the required asterisk. */
	mark?: boolean;
	className?: string;
	/** Set on a merchant field, so the preview can find and highlight it. */
	fieldId?: string;
	/** The floating "Editing" flag on the selected field. */
	badge?: ReactNode;
	/** The field's own help text, printed the way core prints one. */
	help?: string;
	/**
	 * Why a greyed field is greyed. A plain `title`, because the whole mock is
	 * `aria-hidden` and the outline beside it carries the same words as text.
	 */
	title?: string;
	onClick?: () => void;
}

/**
 * The id the error line under a control is announced by.
 *
 * @param id Control id.
 * @return Element id.
 */
function errorId( id: string ): string {
	return `${ id }__error`;
}

/**
 * The attributes a live control carries, and the ones a picture carries
 * instead.
 *
 * @param props       The control's props.
 * @param props.id    Control id.
 * @param props.live  True in Live mode.
 * @param props.error The message under the control, where there is one.
 * @return Attributes to spread onto the input, select or textarea.
 */
function controlAttrs( {
	id,
	live,
	error,
}: {
	id: string;
	live?: boolean;
	error?: string;
} ) {
	if ( ! live ) {
		return { tabIndex: -1 };
	}

	return {
		'aria-invalid': error ? true : undefined,
		'aria-describedby': error ? errorId( id ) : undefined,
	};
}

/*
 * The one-line hint under a control. Deliberately *not* one of core's own
 * classes: the closest of them is the validation error, which every checkout
 * stylesheet paints red — and a hint is not a failure.
 */
function Help( { text }: { text?: string } ) {
	if ( ! text ) {
		return null;
	}
	return <span className="cbwb-preview__help">{ text }</span>;
}

/*
 * What an add-on has to say about a field the preview cannot answer for itself
 * — "Also depends on the cart." A neutral tag, not a warning: the field is on
 * the screen and the sentence says what else decides that.
 */
function Note( { text }: { text?: string } ) {
	if ( ! text ) {
		return null;
	}
	return <span className="cbwb-preview__note">{ text }</span>;
}

/*
 * The line the checkout prints under a required field left empty, in the markup
 * the checkout prints it in, so a store whose stylesheet is on the page gets its
 * own error styling here too.
 */
function ErrorLine( { id, text }: { id: string; text?: string } ) {
	if ( ! text ) {
		return null;
	}

	return (
		<div className="wc-block-components-validation-error" role="alert">
			<p id={ errorId( id ) }>
				<span>{ text }</span>
			</p>
		</div>
	);
}

interface TextInputProps extends ControlProps, Constraints {
	/** HTML input type: text, email, tel, number, url, date, time. */
	type?: string;
	value?: string;
}

/*
 * A `ValidatedTextInput` with nothing typed into it. Core keeps the label
 * centred in an empty control and floats it up as soon as there is content.
 */
function TextInput( {
	id,
	label,
	mark,
	className,
	fieldId,
	badge,
	help,
	title,
	type = 'text',
	value = '',
	min,
	max,
	step,
	onClick,
	live,
	note,
	error,
	onValue,
	onLeave,
}: TextInputProps ) {
	/*
	 * Core floats the label up as soon as the box has content — and a date or
	 * time box always has content of a sort, because the browser draws its own
	 * `yyyy-mm-dd` inside it. Leaving the label centred over that prints the two
	 * on top of each other.
	 */
	const filled = '' !== value || 'date' === type || 'time' === type;

	return (
		<div
			className={ classNames(
				'wc-block-components-text-input',
				filled && 'is-active',
				className
			) }
			data-cbwb-field={ fieldId }
			title={ title }
			aria-hidden={ live ? undefined : 'true' }
			onClick={ onClick }
		>
			<input
				{ ...NO_AUTOFILL }
				id={ id }
				type={ type }
				value={ value }
				min={ min }
				max={ max }
				step={ step }
				readOnly={ ! live }
				// The label below names the box; a second name would only be
				// read where the box is a picture nobody reaches anyway.
				aria-label={ live ? undefined : label }
				onChange={
					live && onValue
						? ( event ) => onValue( event.target.value )
						: undefined
				}
				onBlur={ live ? onLeave : undefined }
				{ ...controlAttrs( { id, live, error } ) }
			/>
			<label htmlFor={ id }>
				{ label }
				<RequiredMark show={ mark } />
			</label>
			<Note text={ note } />
			<Help text={ help } />
			<ErrorLine id={ id } text={ error } />
			{ badge }
		</div>
	);
}

interface TextareaProps extends ControlProps {
	rows: number;
	value?: string;
}

/* A `Textarea`, which core draws with the label above rather than floating. */
function Textarea( {
	id,
	label,
	mark,
	className,
	fieldId,
	badge,
	help,
	title,
	rows,
	value = '',
	onClick,
	live,
	note,
	error,
	onValue,
	onLeave,
}: TextareaProps ) {
	return (
		<div
			className={ classNames(
				'wc-block-components-textarea-wrapper',
				className
			) }
			data-cbwb-field={ fieldId }
			title={ title }
			aria-hidden={ live ? undefined : 'true' }
			onClick={ onClick }
		>
			<label htmlFor={ id }>
				{ label }
				<RequiredMark show={ mark } />
			</label>
			<Note text={ note } />
			<textarea
				{ ...NO_AUTOFILL }
				id={ id }
				className="wc-block-components-textarea"
				rows={ rows }
				value={ value }
				readOnly={ ! live }
				onChange={
					live && onValue
						? ( event ) => onValue( event.target.value )
						: undefined
				}
				onBlur={ live ? onLeave : undefined }
				{ ...controlAttrs( { id, live, error } ) }
			/>
			<Help text={ help } />
			<ErrorLine id={ id } text={ error } />
			{ badge }
		</div>
	);
}

interface SelectBodyProps extends LiveProps {
	id: string;
	label: string;
	/** True while this field carries the required asterisk. */
	mark?: boolean;
	/** The first, unselected choice. */
	placeholder?: string;
	options: PreviewOption[];
	/** Option to show as chosen; '' shows the placeholder. */
	value?: string;
	/** True while there is nothing on the list to choose. */
	disabled?: boolean;
}

/* The innards of a `Select`: floating label, control and chevron. */
function SelectBody( {
	id,
	label,
	mark,
	placeholder,
	options,
	value = '',
	disabled,
	live,
	error,
	onValue,
	onLeave,
}: SelectBodyProps ) {
	return (
		<div className="wc-blocks-components-select__container">
			<label
				className="wc-blocks-components-select__label"
				htmlFor={ id }
			>
				{ label }
				<RequiredMark show={ mark } />
			</label>
			{ /*
			 * Uncontrolled while it is a picture: the mock cannot be typed
			 * into, so the value can never change and React need not police it.
			 * Live it is controlled like every other answer in Live mode.
			 */ }
			<select
				{ ...NO_AUTOFILL }
				id={ id }
				className="wc-blocks-components-select__select"
				value={ live ? value : undefined }
				defaultValue={ live ? undefined : value }
				disabled={ disabled }
				onChange={
					live && onValue
						? ( event ) => onValue( event.target.value )
						: undefined
				}
				onBlur={ live ? onLeave : undefined }
				{ ...controlAttrs( { id, live, error } ) }
			>
				{ undefined !== placeholder && (
					<option value="">{ placeholder }</option>
				) }
				{ options.map( ( option ) => (
					<option
						key={ option.value }
						value={ option.value }
						disabled={ option.disabled }
					>
						{ option.label }
					</option>
				) ) }
			</select>
			<svg
				className="wc-blocks-components-select__expand"
				aria-hidden="true"
				viewBox="0 0 10 6"
				width="10"
				height="6"
			>
				<path d="M5 6 0 1l1-1 4 4 4-4 1 1z" />
			</svg>
		</div>
	);
}

interface SelectProps extends ControlProps, SelectBodyProps {}

/*
 * A `Select`, wrapped the way core wraps one: the class name core was handed
 * goes on the outer element and `.wc-blocks-components-select` is a wrapper of
 * its own inside it. Flattening the two breaks the full-width sizing.
 */
function Select( {
	id,
	label,
	mark,
	placeholder,
	options,
	value,
	disabled,
	className,
	fieldId,
	badge,
	help,
	title,
	onClick,
	live,
	note,
	error,
	onValue,
	onLeave,
}: SelectProps ) {
	return (
		<div
			className={ className }
			data-cbwb-field={ fieldId }
			title={ title }
			aria-hidden={ live ? undefined : 'true' }
			onClick={ onClick }
		>
			<div className="wc-blocks-components-select">
				<SelectBody
					id={ id }
					label={ label }
					mark={ mark }
					placeholder={ placeholder }
					options={ options }
					value={ value }
					disabled={ disabled }
					live={ live }
					error={ error }
					onValue={ onValue }
					onLeave={ onLeave }
				/>
			</div>
			<Note text={ note } />
			<Help text={ help } />
			<ErrorLine id={ id } text={ error } />
			{ badge }
		</div>
	);
}

interface CheckboxProps extends ControlProps {
	checked?: boolean;
	/** Live only: the box was ticked or unticked. */
	onToggle?: ( checked: boolean ) => void;
}

/* A `CheckboxControl`, unticked unless the real checkout ticks it by default. */
function Checkbox( {
	id,
	label,
	mark,
	className,
	fieldId,
	badge,
	help,
	title,
	checked = false,
	onClick,
	live,
	note,
	error,
	onToggle,
	onLeave,
}: CheckboxProps ) {
	return (
		<div
			className={ classNames(
				'wc-block-components-checkbox',
				className
			) }
			data-cbwb-field={ fieldId }
			title={ title }
			aria-hidden={ live ? undefined : 'true' }
			onClick={ onClick }
		>
			<label htmlFor={ id }>
				<input
					id={ id }
					className="wc-block-components-checkbox__input"
					type="checkbox"
					checked={ checked }
					readOnly={ ! live }
					onChange={
						live && onToggle
							? ( event ) => onToggle( event.target.checked )
							: undefined
					}
					onBlur={ live ? onLeave : undefined }
					{ ...controlAttrs( { id, live, error } ) }
				/>
				<svg
					className="wc-block-components-checkbox__mark"
					aria-hidden="true"
					viewBox="0 0 24 20"
				>
					<path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
				</svg>
				<span className="wc-block-components-checkbox__label">
					{ label }
					<RequiredMark show={ mark } />
				</span>
			</label>
			<Note text={ note } />
			<Help text={ help } />
			<ErrorLine id={ id } text={ error } />
			{ badge }
		</div>
	);
}

interface RegisteredControlProps extends ControlProps {
	field: Field;
	/** The answer so far, in the checkout's storage shape. */
	value: string;
	/** What the add-on draws for the body, where it registered one. */
	Body?: ComponentType< PreviewBodyProps >;
}

/*
 * A field of a type an add-on provided.
 *
 * Free draws everything around the control — the label, the required mark, the
 * help line, the tag an add-on put beside it, the error under it — because all
 * of that is the same whoever provided the type, and hands the add-on the
 * answer, the way to change it and the three ids that tie the control to the
 * words around it. An add-on that registered no body at all still gets a field
 * with a shape: an empty box nobody can type in, so the canvas shows where the
 * question will sit rather than a gap.
 */
function RegisteredControl( {
	id,
	label,
	mark,
	className,
	fieldId,
	badge,
	help,
	title,
	field,
	value,
	Body,
	onClick,
	live,
	note,
	error,
	onValue,
	onLeave,
}: RegisteredControlProps ) {
	return (
		<div
			className={ classNames(
				'wc-block-components-text-input',
				'cbwb-preview__registered',
				className
			) }
			data-cbwb-field={ fieldId }
			title={ title }
			aria-hidden={ live ? undefined : 'true' }
			onClick={ onClick }
			/*
			 * Watched on the wrapper rather than on the control, which belongs
			 * to the add-on: leaving anything inside is leaving the field, which
			 * is when a required one may say it has not been answered.
			 */
			onBlur={ live ? onLeave : undefined }
		>
			<label className="cbwb-preview__registered-label" htmlFor={ id }>
				{ label }
				<RequiredMark show={ mark } />
			</label>
			{ Body ? (
				<Body
					field={ field }
					value={ value }
					onChange={ ( next: string ) => onValue?.( next ) }
					disabled={ ! live }
					id={ id }
					describedBy={ error ? errorId( id ) : undefined }
				/>
			) : (
				<input
					{ ...NO_AUTOFILL }
					id={ id }
					className="cbwb-preview__registered-placeholder"
					type="text"
					value=""
					readOnly
					disabled
					tabIndex={ -1 }
					aria-label={ live ? undefined : label }
				/>
			) }
			<Note text={ note } />
			<Help text={ help } />
			<ErrorLine id={ id } text={ error } />
			{ badge }
		</div>
	);
}

interface ChoiceGroupProps extends ControlProps {
	/** 'radio' for one answer, 'checkbox' for any number. */
	control: 'radio' | 'checkbox';
	options: PreviewOption[];
	/** Values shown as already chosen. */
	chosen: string[];
	inline: boolean;
}

/* A radio group or a checkbox group: the whole list, on show. */
function ChoiceGroup( {
	id,
	label,
	mark,
	className,
	fieldId,
	badge,
	help,
	title,
	control,
	options,
	chosen,
	inline,
	onClick,
	live,
	note,
	error,
	onValue,
	onLeave,
}: ChoiceGroupProps ) {
	const labelId = `${ id }__label`;

	/**
	 * The whole answer after one option is turned on or off: a radio group
	 * keeps one value, a checkbox group a comma separated list, which is how
	 * each is stored.
	 *
	 * @param value  The option.
	 * @param picked Whether it is now chosen.
	 * @return The answer to store.
	 */
	const answer = ( value: string, picked: boolean ): string => {
		if ( 'radio' === control ) {
			return picked ? value : '';
		}

		const next = picked
			? [ ...chosen, value ]
			: chosen.filter( ( entry ) => entry !== value );

		return options
			.map( ( option ) => option.value )
			.filter( ( entry ) => next.includes( entry ) )
			.join( ',' );
	};

	return (
		<div
			className={ classNames( 'cbwb-preview__choices', className ) }
			data-cbwb-field={ fieldId }
			title={ title }
			aria-hidden={ live ? undefined : 'true' }
			onClick={ onClick }
		>
			<span className="cbwb-preview__choices-label" id={ labelId }>
				{ label }
				<RequiredMark show={ mark } />
			</span>
			<Note text={ note } />
			{ /*
			 * A group of choices is one question, so live it is one named
			 * group: the label above is its name and any message below it is
			 * its description, rather than both being repeated per option.
			 */ }
			<div
				className={ classNames(
					'cbwb-preview__choices-list',
					inline && 'is-inline'
				) }
				role={ live ? 'group' : undefined }
				aria-labelledby={ live ? labelId : undefined }
				{ ...( live
					? {
							'aria-invalid': error ? true : undefined,
							'aria-describedby': error
								? errorId( id )
								: undefined,
					  }
					: {} ) }
			>
				{ 0 === options.length ? (
					<span className="cbwb-preview__choices-empty">
						{ __(
							'No options yet',
							'fieldwright-checkout-fields'
						) }
					</span>
				) : (
					options.map( ( option ) => (
						<span
							className="cbwb-preview__choice"
							key={ option.value }
						>
							<input
								id={ `${ id }-${ option.value }` }
								type={ control }
								name={ id }
								checked={ chosen.includes( option.value ) }
								readOnly={ ! live }
								disabled={ option.disabled }
								tabIndex={ live ? undefined : -1 }
								onChange={
									live && onValue
										? ( event ) =>
												onValue(
													answer(
														option.value,
														event.target.checked
													)
												)
										: undefined
								}
								onBlur={ live ? onLeave : undefined }
							/>
							<label htmlFor={ `${ id }-${ option.value }` }>
								{ option.label || option.value }
							</label>
						</span>
					) )
				) }
			</div>
			<Help text={ help } />
			<ErrorLine id={ id } text={ error } />
			{ badge }
		</div>
	);
}

interface ContentBlockProps extends ControlProps {
	field: Field;
}

/* A heading or a paragraph: words the merchant wrote, not a question. */
function ContentBlock( {
	className,
	fieldId,
	badge,
	title,
	field,
	onClick,
	live,
	note,
}: ContentBlockProps ) {
	if ( 'heading' === field.type ) {
		const Tag = `h${ field.content_level }` as 'h2' | 'h3' | 'h4';

		return (
			<div
				className={ classNames( 'cbwb-preview__content', className ) }
				data-cbwb-field={ fieldId }
				title={ title }
				aria-hidden={ live ? undefined : 'true' }
				onClick={ onClick }
			>
				<Tag
					className={ `wc-block-components-title cbwb-preview__heading is-level-${ field.content_level }` }
				>
					{ field.label }
				</Tag>
				<Note text={ note } />
				{ badge }
			</div>
		);
	}

	const html = sanitizeContent( field.content );

	return (
		<div
			className={ classNames( 'cbwb-preview__content', className ) }
			data-cbwb-field={ fieldId }
			title={ title }
			aria-hidden={ live ? undefined : 'true' }
			onClick={ onClick }
		>
			{ '' === html ? (
				<p className="cbwb-preview__paragraph is-empty">
					{ __(
						'Your text goes here.',
						'fieldwright-checkout-fields'
					) }
				</p>
			) : (
				<p
					className="cbwb-preview__paragraph"
					// The merchant's own words, cut down to the tags the
					// checkout allows before they are drawn.
					dangerouslySetInnerHTML={ { __html: html } }
				/>
			) }
			<Note text={ note } />
			{ badge }
		</div>
	);
}

interface AffordanceProps {
	className: string;
	fieldId?: string;
	/** Kept for shape parity with the controls; unused on core affordances. */
	title?: string;
	/** The floating "Editing" flag on the selected row. */
	badge?: ReactNode;
	/** True in Live mode, where the mock is not hidden from a screen reader. */
	live?: boolean;
	children: ReactNode;
	onClick?: () => void;
}

/*
 * Something the checkout draws that is not a control: the "+ Add apartment"
 * link, the coupon form's own link. Clickable here for the same reason a field
 * is — it stands for a row in the outline.
 */
function Affordance( {
	className,
	fieldId,
	badge,
	title,
	live,
	children,
	onClick,
}: AffordanceProps ) {
	return (
		<div
			className={ className }
			data-cbwb-field={ fieldId }
			title={ title }
			aria-hidden={ live ? undefined : 'true' }
			onClick={ onClick }
		>
			{ children }
			{ badge }
		</div>
	);
}

/* eslint-enable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */

/**
 * The label the checkout prints for one of WooCommerce's own fields, "(optional)"
 * and all — derived exactly as WooCommerce's own client derives it.
 *
 * @param row     Core row.
 * @param marking Which way round the store marks required fields.
 * @return Display label.
 */
function coreLabelFor( row: CoreRow, marking: RequiredMarking ): string {
	return row.required || 'asterisk' === marking
		? row.label
		: sprintf(
				/* translators: %s: field label. */
				__( '%s (optional)', 'fieldwright-checkout-fields' ),
				row.label
		  );
}

/**
 * The two core fields WooCommerce draws as dropdowns, and the one choice each
 * shows in a picture. A function, not a constant: `__()` has to run once the
 * locale's translations are in.
 *
 * @return Options and the chosen value, keyed by core field key.
 */
function coreSelects(): Record<
	string,
	{ value: string; options: FieldOption[] }
> {
	return {
		country: {
			value: 'US',
			options: [
				{
					value: 'US',
					label: __(
						'United States (US)',
						'fieldwright-checkout-fields'
					),
				},
			],
		},
		state: {
			value: 'CA',
			options: [
				{
					value: 'CA',
					label: __( 'California', 'fieldwright-checkout-fields' ),
				},
			],
		},
	};
}

/**
 * The countries Live mode offers: the one the picture shows, and a few to switch
 * to. ISO codes, so a rule written against a country code matches here exactly
 * as it will at checkout.
 *
 * @return Options for the country dropdown.
 */
function tryCountries(): FieldOption[] {
	return [
		{
			value: 'US',
			label: __( 'United States (US)', 'fieldwright-checkout-fields' ),
		},
		{
			value: 'CA',
			label: __( 'Canada', 'fieldwright-checkout-fields' ),
		},
		{
			value: 'GB',
			label: __( 'United Kingdom (UK)', 'fieldwright-checkout-fields' ),
		},
		{
			value: 'DE',
			label: __( 'Germany', 'fieldwright-checkout-fields' ),
		},
		{
			value: 'FR',
			label: __( 'France', 'fieldwright-checkout-fields' ),
		},
		{
			value: 'AU',
			label: __( 'Australia', 'fieldwright-checkout-fields' ),
		},
	];
}

interface RadioProps {
	name: string;
	label: string;
	secondaryLabel?: string;
	/** True in Live mode, where the one option on offer is a real control. */
	live?: boolean;
}

/* A single, always-selected `RadioControl` option. */
function Radio( { name, label, secondaryLabel, live }: RadioProps ) {
	const id = `cbwb-preview-${ name }`;

	return (
		<div
			className="wc-block-components-radio-control"
			aria-hidden={ live ? undefined : 'true' }
		>
			{ /*
			 * Core nests the option's text three levels deep, past the depth
			 * the rule looks at; the label does have an associated control.
			 */ }
			{ /* eslint-disable-next-line jsx-a11y/label-has-associated-control */ }
			<label
				className="wc-block-components-radio-control__option wc-block-components-radio-control__option-checked"
				htmlFor={ id }
			>
				{ /*
				 * The mock offers one shipping method and one way to pay, so
				 * the choice is made either way: read only even in Live mode,
				 * because there is nothing else to pick.
				 */ }
				<input
					id={ id }
					className="wc-block-components-radio-control__input"
					type="radio"
					name={ name }
					checked
					readOnly
					tabIndex={ live ? undefined : -1 }
				/>
				<div className="wc-block-components-radio-control__option-layout">
					<div className="wc-block-components-radio-control__label-group">
						<span className="wc-block-components-radio-control__label">
							{ label }
						</span>
						{ secondaryLabel && (
							<span className="wc-block-components-radio-control__secondary-label">
								{ secondaryLabel }
							</span>
						) }
					</div>
				</div>
			</label>
		</div>
	);
}

/** Everything a previewed field needs once it is answering rather than posing. */
interface FieldAnswer {
	/** The answer so far, in the checkout's storage shape. */
	value: string;
	/** What an add-on has to say beside the field. */
	note?: string;
	/**
	 * Whether an add-on made the field compulsory, where it said so at all. The
	 * merchant's own Required switch stands wherever it did not.
	 */
	required?: boolean;
	/** The checkout's message for a required field left empty. */
	error?: string;
	onValue: ( value: string ) => void;
	onLeave: () => void;
}

/**
 * The choices an add-on had something to say about for one field, and what it
 * says about them.
 *
 * Drawn in both modes, unlike everything else the preview filters answer: a
 * time field offering delivery slots is a dropdown at checkout whether or not
 * the merchant is filling the form in, and a picture of a clock would be a
 * picture of the wrong control. A dropdown or a group of choices reads the same
 * way round: the labels a shopper will pick from are the labels drawn here.
 */
interface PreviewChoices {
	options: PreviewOption[];
	note?: string;
}

/**
 * The days an add-on rules out on one date field, as `YYYY-MM-DD` bounds.
 *
 * Only the two ends. A weekday or a single blocked day cannot be expressed on a
 * native date input at all, so the preview draws what the input can hold and
 * leaves the rest to the checkout, exactly as the checkout bundle does.
 */
interface PreviewDates {
	minDate?: string;
	maxDate?: string;
}

interface PreviewFieldProps {
	field: Field;
	isSelected: boolean;
	marking: RequiredMarking;
	/** Set where an add-on answered with a list of choices for this field. */
	choices?: PreviewChoices;
	/** Set where an add-on narrowed the days this field's picker offers. */
	dates?: PreviewDates;
	/** Set in Live mode only, where the field is a control rather than a picture. */
	answer?: FieldAnswer;
	onSelect: ( id: string ) => void;
}

/* One of the merchant's own fields, rendered the way core would render it. */
function PreviewField( {
	field,
	isSelected,
	marking,
	choices,
	dates,
	answer,
	onSelect,
}: PreviewFieldProps ) {
	const live = Boolean( answer );
	/*
	 * A field of a type nothing is providing right now. Drawn greyed rather than
	 * dropped: the row is still in the outline, the canvas is what the outline
	 * points at, and the field is still the merchant's to rename or move.
	 */
	const inactive = 'unavailable' === familyOf( field.type );
	const value = answer ? answer.value : field.default_value;
	const selection = classNames(
		'cbwb-preview__field',
		`is-${ field.width }`,
		// Nothing is selected in Live mode, and nothing there answers a click.
		! live && isSelected && 'is-selected',
		live && 'is-live',
		inactive && 'is-inactive'
	);
	// An add-on can make a field compulsory in some situations; where it has
	// not said anything, the merchant's own switch is what the label and the
	// mark follow.
	const required = answer?.required ?? field.required;
	const shared = {
		id: `cbwb-preview-${ field.id }`,
		label: labelFor( field, marking, required ),
		mark: 'asterisk' === marking && required,
		fieldId: field.id,
		help: field.help,
		title: inactive ? unavailableLabel() : undefined,
		onClick: live ? undefined : () => onSelect( field.id ),
		// Decorative twin of the outline's "Editing" chip, so the preview, the
		// outline and the settings pane visibly agree on one field.
		badge:
			! live && isSelected ? (
				<span className="cbwb-preview__editing" aria-hidden="true">
					{ __( 'Editing', 'fieldwright-checkout-fields' ) }
				</span>
			) : undefined,
		live,
		note: answer?.note,
		error: answer?.error,
		onValue: answer?.onValue,
		onLeave: answer?.onLeave,
	};

	if ( 'heading' === field.type || 'paragraph' === field.type ) {
		return (
			<ContentBlock
				{ ...shared }
				field={ field }
				className={ selection }
			/>
		);
	}

	if ( 'checkbox' === field.type ) {
		// A checkbox never gets core's "(optional)" suffix, but it does get
		// whatever an add-on appends.
		return (
			<Checkbox
				{ ...shared }
				label={ previewFieldLabel( field.label, field ) }
				checked={ 'yes' === value }
				onToggle={ ( checked ) =>
					answer?.onValue( checked ? 'yes' : '' )
				}
				className={ selection }
			/>
		);
	}

	const selectClass = classNames(
		'wc-block-components-select-input',
		keyClass( 'wc-block-components-select-input-', field.id ),
		selection
	);

	if ( 'select' === field.type ) {
		return (
			<Select
				{ ...shared }
				className={ selectClass }
				// Core shows the unselected state until a shopper picks.
				placeholder={ field.placeholder || SELECT_PLACEHOLDER_DEFAULT }
				options={ labelledOptions( field.options, choices?.options ) }
				value={ value }
			/>
		);
	}

	// A time an add-on drew the answers for: the checkout offers those and
	// nothing else, so the preview offers them too. An answer that is not on the
	// list any more shows as nothing chosen, the way the checkout draws it.
	if ( choices && 'time' === field.type ) {
		const picked = choices.options.some(
			( option ) => ! option.disabled && option.value === value
		)
			? value
			: '';

		return (
			<Select
				{ ...shared }
				note={ choices.note ?? shared.note }
				className={ selectClass }
				placeholder={ __(
					'Choose a time',
					'fieldwright-checkout-fields'
				) }
				options={ choices.options }
				value={ picked }
				disabled={ 0 === choices.options.length }
			/>
		);
	}

	if ( 'radio' === field.type || 'checkbox_group' === field.type ) {
		return (
			<ChoiceGroup
				{ ...shared }
				className={ selection }
				control={ 'radio' === field.type ? 'radio' : 'checkbox' }
				options={ labelledOptions( field.options, choices?.options ) }
				chosen={ value
					.split( ',' )
					.map( ( entry ) => entry.trim() )
					.filter( Boolean ) }
				inline={ 'inline' === field.options_layout }
			/>
		);
	}

	if ( 'textarea' === field.type ) {
		return (
			<Textarea
				{ ...shared }
				className={ classNames(
					keyClass( 'wc-block-components-address-form__', field.id ),
					selection
				) }
				rows={ field.rows }
				value={ value }
			/>
		);
	}

	/*
	 * Everything left is either one of Free's own text boxes or a type an add-on
	 * provided. One lookup decides which: the add-on's own body where it
	 * registered one, a placeholder where it did not, and Free's box for its own
	 * types.
	 */
	if ( ! isBuiltinType( field.type ) ) {
		return (
			<RegisteredControl
				{ ...shared }
				className={ selection }
				field={ field }
				value={ value }
				Body={ descriptorFor( field.type )?.Preview }
			/>
		);
	}

	return (
		<TextInput
			{ ...shared }
			type={ inputTypeFor( field ) }
			value={ value }
			{ ...constraintsFor( field, dates ) }
			className={ classNames(
				keyClass( 'wc-block-components-address-form__', field.id ),
				selection
			) }
		/>
	);
}

interface AddFieldProps {
	/** Checkout section name, e.g. "Shipping address". */
	section: string;
	/** Placement the new field lands in. */
	location: FieldLocation;
	types: ResolvedType[];
	disabled: boolean;
	/**
	 * Visible button text, where "Add field" would not say enough.
	 *
	 * The shipping step carries two of these — one for the fields that go in
	 * both address forms, one for the fields that go in this form alone — and
	 * two buttons reading "Add field" side by side would not tell them apart.
	 */
	text?: string;
	onAdd: ( location: FieldLocation, type: FieldType ) => void;
}

/**
 * The ghost control that ends every section a merchant field can go in.
 *
 * @param props          Component props.
 * @param props.section  Checkout section name.
 * @param props.location Placement the new field lands in.
 * @param props.types    Every type, resolved.
 * @param props.disabled True at the storage ceiling.
 * @param props.text     Visible button text.
 * @param props.onAdd    Adds a field of the picked type.
 */
function AddField( {
	section,
	location,
	types,
	disabled,
	text,
	onAdd,
}: AddFieldProps ) {
	return (
		<div className="cbwb-preview__add">
			<AddFieldPicker
				types={ types }
				placement={ location }
				className="cbwb-add-field"
				icon={ plus }
				disabled={ disabled }
				label={ sprintf(
					/* translators: %s: checkout section name, e.g. "Shipping address". */
					__( 'Add a field to %s', 'fieldwright-checkout-fields' ),
					section
				) }
				onSelect={ ( type ) => onAdd( location, type ) }
			>
				{ text ?? __( 'Add field', 'fieldwright-checkout-fields' ) }
			</AddFieldPicker>
		</div>
	);
}

export default function Preview( {
	fields,
	types,
	placements,
	selectedId,
	initialSelectedId = null,
	onSelect,
	onAdd,
	canAdd,
	checkoutUrl,
	coreRows,
	pseudoRows,
	addressOrder,
	hasCore = false,
	requiredMarking = 'optional_label',
}: PreviewProps ) {
	const [ viewport, setViewport ] =
		useState< PreviewViewport >( readViewport );
	const [ preview, previewActions ] = usePreviewState( fields );
	const {
		setMode,
		setValue,
		setCoreValue,
		setSameAddress,
		setLoggedIn,
		touch,
		reset,
	} = previewActions;
	const isTry = 'try' === preview.mode;
	/*
	 * The order-note box, which is WooCommerce's own and stands for a textarea
	 * the mock does not draw. Nothing else in the checkout reads it, so it is
	 * kept here rather than in the state the preview filters are handed.
	 */
	const [ noteOpen, setNoteOpen ] = useState( false );
	const frameRef = useRef< HTMLDivElement | null >( null );
	// True already when the preview mounts on a selection the page did not load
	// with — adding the first field, which mounts the preview in place of the
	// empty state, has to scroll to it or the field lands out of sight.
	const followedOnce = useRef( selectedId !== initialSelectedId );

	// Disabled fields never reach the checkout, so they are not previewed.
	const groups = useMemo(
		() => byLocation( fields.filter( ( field ) => field.enabled ) ),
		[ fields ]
	);

	/*
	 * WooCommerce's own fields. A builder with a server that knows about them
	 * is handed the live rows and every one of them can be clicked; one without
	 * gets the fixed table `lib/coreFields.ts` keeps, which is the checkout this
	 * preview drew before any of this existed.
	 */
	const core = useMemo(
		() =>
			coreRows ??
			buildCoreRows( resolveCoreFields( {} ), emptyCore(), {} ),
		[ coreRows ]
	);
	const pseudo = useMemo(
		() => pseudoRows ?? buildPseudoRows( emptyCore() ),
		[ pseudoRows ]
	);
	const shown = useMemo(
		() => core.filter( ( row ) => ! row.hidden ),
		[ core ]
	);
	const addressRows = useMemo(
		() => addressOrder ?? addressRowOrder( core, fields, [] ),
		[ addressOrder, core, fields ]
	);

	const hiddenPseudo = ( key: string ) =>
		hasCore && Boolean( pseudo.find( ( row ) => row.key === key )?.hidden );
	const noteHidden = hiddenPseudo( 'order_note' );
	const noteId = coreRowId( 'order_note' );
	const couponId = coreRowId( 'coupon_form' );
	// The coupon form is only drawn where it can also be switched off: without
	// core rows there is nothing in the outline for it to stand for.
	const showCoupon = hasCore && ! hiddenPseudo( 'coupon_form' );

	/*
	 * The order the picture is drawn in, as one string. A reorder — from a row's
	 * menu or from a drop — changes nothing about the selection, so without this
	 * the effect below would not run and the row the merchant just moved would
	 * slide out from under them. Ids only: relabelling a field does not move it.
	 */
	const orderKey = useMemo(
		() =>
			[ ...fields.map( ( field ) => field.id ), ...addressRows ].join(
				'|'
			),
		[ addressRows, fields ]
	);

	/*
	 * Where the frame is on its way to, and when it was asked. Read in place of
	 * `scrollTop` while a smooth scroll is still running; see `scrollFrameTo()`.
	 */
	const scrollTarget = useRef< { top: number; at: number } | null >( null );

	// Follow the selection — and follow it through a reorder — but only inside
	// the preview's own scroll box, and never for the selection the page loaded
	// with: landing on the page should not move it.
	useEffect( () => {
		const frame = frameRef.current;
		if ( ! frame || ! selectedId ) {
			return;
		}
		if ( ! followedOnce.current ) {
			followedOnce.current = true;
			return;
		}

		const node = Array.from(
			frame.querySelectorAll< HTMLElement >( '[data-cbwb-field]' )
		).find( ( candidate ) => candidate.dataset.cbwbField === selectedId );

		if ( ! node ) {
			return;
		}

		const now = Date.now();
		const pending = scrollTarget.current;
		const from =
			pending && now - pending.at < SCROLL_SETTLE
				? pending.top
				: frame.scrollTop;

		scrollTarget.current = {
			top: scrollFrameTo( frame, node, from ),
			at: now,
		};
	}, [ orderKey, selectedId ] );

	const changeViewport = useCallback( ( next: PreviewViewport ) => {
		setViewport( next );
		writeViewport( next );
	}, [] );

	const changeMode = useCallback(
		( next: PreviewMode ) => {
			setMode( next );
			setNoteOpen( false );
		},
		[ setMode ]
	);

	const resetTry = useCallback( () => {
		reset();
		setNoteOpen( false );
	}, [ reset ] );

	/*
	 * Picking a field in the outline or the settings pane is an edit, so the
	 * canvas goes back to being the thing being edited. Only a change counts:
	 * the selection the preview mounted with is not one, and Live mode does not
	 * change the selection itself.
	 */
	const lastSelected = useRef( selectedId );
	useEffect( () => {
		if ( lastSelected.current === selectedId ) {
			return;
		}
		lastSelected.current = selectedId;
		setMode( 'edit' );
		setNoteOpen( false );
	}, [ selectedId, setMode ] );

	/*
	 * The mock has always drawn one country, and in Live mode that drawing has
	 * to be an answer: a rule about the billing country reads what the merchant
	 * can see. An empty country means "as shown", so this is what "as shown"
	 * is — including after Reset, which empties it again.
	 */
	const { country } = preview.coreValues;
	useEffect( () => {
		if ( isTry && ! country ) {
			setCoreValue( 'country', PREVIEW_COUNTRY );
		}
	}, [ country, isTry, setCoreValue ] );

	/*
	 * What the add-ons make of the form as it stands, in the two passes the
	 * contract asks for: every field is asked whether it is on the screen, and
	 * only then are the summary rows asked for — so a fee whose checkbox is not
	 * showing cannot bill for itself.
	 *
	 * Free's own rule is the one it has always drawn: while billing is the same
	 * as shipping there is no billing form, so nothing in it is on the screen.
	 *
	 * Edit mode asks too, but only about the fields whose answers an add-on can
	 * have a say in and only for the list itself: what a field's choices are
	 * called, and which control it is drawn as, belong to the picture, and a
	 * field offering delivery slots is a dropdown either way.
	 */
	const { notes, hiddenIds, summaryLines, choices, compulsory, dateBounds } =
		useMemo( () => {
			const context = previewContext( preview, fields );
			const tags = new Map< string, string >();
			const hidden = new Set< string >();
			const lists = new Map< string, PreviewChoices >();
			const required = new Map< string, boolean >();
			const dates = new Map< string, PreviewDates >();

			fields.forEach( ( field ) => {
				// Outside Live mode the only answers worth having belong to the
				// picture rather than to the form being filled in: what a
				// field's choices are called, and which days its picker offers.
				// A type with neither is not asked.
				if ( ! isTry && ! EDIT_MODE_TYPES.includes( field.type ) ) {
					return;
				}

				const state = previewFieldState( field, context );

				if ( state.options ) {
					lists.set( field.id, {
						options: state.options,
						note: state.note,
					} );
				}

				if ( state.minDate || state.maxDate ) {
					dates.set( field.id, {
						minDate: state.minDate,
						maxDate: state.maxDate,
					} );
				}

				if ( ! isTry ) {
					return;
				}

				if (
					state.hidden ||
					! field.enabled ||
					'unavailable' === familyOf( field.type ) ||
					( 'billing_address' === field.location &&
						preview.sameAddress )
				) {
					hidden.add( field.id );
				}

				if ( state.note ) {
					tags.set( field.id, state.note );
				}

				if ( 'boolean' === typeof state.required ) {
					required.set( field.id, state.required );
				}
			} );

			return {
				notes: tags,
				hiddenIds: hidden,
				choices: lists,
				compulsory: required,
				dateBounds: dates,
				summaryLines: isTry
					? previewSummaryLines(
							previewContext( preview, fields, hidden )
					  )
					: ( [] as PreviewSummaryLine[] ),
			};
		}, [ fields, isTry, preview ] );

	/**
	 * What one field needs to answer for itself, or nothing at all in Edit mode.
	 *
	 * @param field The field.
	 * @return The live half of a previewed field.
	 */
	const answerFor = ( field: Field ): FieldAnswer | undefined => {
		if ( ! isTry ) {
			return undefined;
		}

		const required = compulsory.get( field.id );
		const missing = isMissingRequired(
			field,
			preview,
			! hiddenIds.has( field.id ),
			required
		);

		return {
			value: preview.values[ field.id ] ?? '',
			note: notes.get( field.id ),
			required,
			error: missing ? requiredMessage( field ) : undefined,
			onValue: ( value: string ) => setValue( field.id, value ),
			onLeave: () => touch( field.id ),
		};
	};

	/**
	 * What one of WooCommerce's own boxes needs to answer for itself.
	 *
	 * The keys are WooCommerce's own, so a rule written against the billing
	 * company or country reads the same key here that it reads at checkout.
	 *
	 * @param key Core field key.
	 * @return Props to spread onto the control, empty in Edit mode.
	 */
	const coreAnswer = ( key: string ) =>
		isTry
			? {
					live: true,
					onValue: ( value: string ) => setCoreValue( key, value ),
			  }
			: {};

	/*
	 * The merchant's fields for one placement, wrapped so a pair of half-width
	 * fields can sit side by side the way they will at checkout.
	 */
	const renderFields = ( list: Field[] ) => {
		// A field an add-on has hidden is off the checkout, so it is off the
		// working copy too — and a section left with nothing draws nothing.
		const drawn = isTry
			? list.filter( ( field ) => ! hiddenIds.has( field.id ) )
			: list;

		return drawn.length > 0 ? (
			<div className="cbwb-preview__fields">
				{ drawn.map( ( field ) => (
					<PreviewField
						key={ field.id }
						field={ field }
						isSelected={ field.id === selectedId }
						marking={ requiredMarking }
						choices={ choices.get( field.id ) }
						dates={ dateBounds.get( field.id ) }
						answer={ answerFor( field ) }
						onSelect={ onSelect }
					/>
				) ) }
			</div>
		) : null;
	};

	/**
	 * Everything a core row needs to behave like the rest of the picture: the
	 * hook the scroll uses to find it, the click that selects it, and the flag
	 * that outlines it. A row from the fallback table gets none of them — there
	 * is nothing in the outline for it to select.
	 *
	 * @param id Core row id.
	 * @return Props to spread onto the control.
	 */
	const coreProps = ( id: string ) => {
		if ( ! hasCore ) {
			return {};
		}

		// Nothing selects a row in Live mode, so all that is left of this is the
		// hook the scroll uses to find a row again on the way back to Edit.
		if ( isTry ) {
			return { fieldId: id };
		}

		return {
			fieldId: id,
			onClick: () => onSelect( id ),
			badge:
				id === selectedId ? (
					<span className="cbwb-preview__editing" aria-hidden="true">
						{ __( 'Editing', 'fieldwright-checkout-fields' ) }
					</span>
				) : undefined,
		};
	};

	/**
	 * One of WooCommerce's own fields, drawn the way WooCommerce draws it.
	 *
	 * @param row Core row to draw.
	 * @return The control.
	 */
	const renderCore = ( row: CoreRow ) => {
		const selects = coreSelects();
		const shared = {
			id: `cbwb-preview-${ row.key }`,
			label: coreLabelFor( row, requiredMarking ),
			mark: 'asterisk' === requiredMarking && row.required,
			...coreProps( row.id ),
		};
		const selection = classNames(
			hasCore && 'cbwb-preview__field',
			hasCore && isTry && 'is-live',
			hasCore && ! isTry && row.id === selectedId && 'is-selected'
		);
		const answer = coreAnswer( row.key );

		/*
		 * WooCommerce folds the apartment line away behind a link and only opens
		 * it when a shopper asks, so the picture shows the link. The wording is
		 * WooCommerce's own and does not follow the label: it is a sentence
		 * about the action, not the name of the box it opens.
		 */
		if ( 'address_2' === row.key ) {
			return (
				<Affordance
					key={ row.id }
					className={ classNames(
						'wc-block-components-address-form__address_2-toggle',
						selection
					) }
					live={ isTry }
					{ ...coreProps( row.id ) }
				>
					{ __(
						'+ Add apartment, suite, etc.',
						'fieldwright-checkout-fields'
					) }
				</Affordance>
			);
		}

		/*
		 * In Live mode the country is the one dropdown worth having: it is what
		 * a rule about the billing country reads. The state is a box to type
		 * in, because a list of every state of every country is a picture of
		 * WooCommerce's dropdown, not a working copy of it.
		 */
		if ( isTry ) {
			if ( 'country' === row.key ) {
				return (
					<Select
						{ ...shared }
						{ ...answer }
						key={ row.id }
						className={ classNames(
							'wc-block-components-address-form__country',
							'wc-block-components-country-input',
							selection
						) }
						value={ country || PREVIEW_COUNTRY }
						options={ tryCountries() }
					/>
				);
			}

			return (
				<TextInput
					{ ...shared }
					{ ...answer }
					key={ row.id }
					type={ 'email' === row.key ? 'email' : 'text' }
					className={ classNames(
						`wc-block-components-address-form__${ row.key }`,
						selection
					) }
					value={ preview.coreValues[ row.key ] ?? '' }
				/>
			);
		}

		const select = selects[ row.key ];
		if ( select ) {
			return (
				<Select
					{ ...shared }
					key={ row.id }
					className={ classNames(
						`wc-block-components-address-form__${ row.key }`,
						'country' === row.key
							? 'wc-block-components-country-input'
							: 'wc-block-components-state-input',
						selection
					) }
					value={ select.value }
					options={ select.options }
				/>
			);
		}

		return (
			<TextInput
				{ ...shared }
				key={ row.id }
				type={ 'email' === row.key ? 'email' : 'text' }
				className={ classNames(
					`wc-block-components-address-form__${ row.key }`,
					selection
				) }
			/>
		);
	};

	/** The address section: WooCommerce's own fields and the merchant's, in one list. */
	const renderAddress = () => {
		const byId = new Map( groups.address.map( ( f ) => [ f.id, f ] ) );
		const coreById = new Map( shown.map( ( row ) => [ row.id, row ] ) );

		return addressRows.map( ( id ) => {
			const row = coreById.get( id );
			if ( row ) {
				return renderCore( row );
			}
			const field = byId.get( id );
			if ( ! field || ( isTry && hiddenIds.has( field.id ) ) ) {
				return null;
			}

			return (
				<PreviewField
					key={ field.id }
					field={ field }
					isSelected={ field.id === selectedId }
					marking={ requiredMarking }
					choices={ choices.get( field.id ) }
					dates={ dateBounds.get( field.id ) }
					answer={ answerFor( field ) }
					onSelect={ onSelect }
				/>
			);
		} );
	};

	const contactSection = __(
		'Contact information',
		'fieldwright-checkout-fields'
	);
	const addressSection = __(
		'Shipping address',
		'fieldwright-checkout-fields'
	);
	const billingSection = __(
		'Billing address',
		'fieldwright-checkout-fields'
	);
	const orderSection = __(
		'Additional order information',
		'fieldwright-checkout-fields'
	);
	const shippingSection = __(
		'Shipping options',
		'fieldwright-checkout-fields'
	);
	const paymentSection = __(
		'Payment options',
		'fieldwright-checkout-fields'
	);
	const placeOrderSection = __(
		'Place Order',
		'fieldwright-checkout-fields'
	);
	const summarySection = __( 'Order summary', 'fieldwright-checkout-fields' );

	// Adding a field is an edit, so the ghosts are not part of the working copy.
	const addTo = (
		location: FieldLocation,
		section: string,
		text?: string
	) =>
		isTry ? null : (
			<AddField
				section={ section }
				location={ location }
				types={ types }
				disabled={ ! canAdd }
				text={ text }
				onAdd={ onAdd }
			/>
		);

	/*
	 * What the picture says, in words, for the reader who cannot see it. The
	 * three sections WooCommerce has always had are always counted; the four
	 * new placements are only mentioned once something is in them, so the
	 * sentence stays the length of a sentence.
	 */
	const extraCounts = placements
		.filter(
			( placement ) =>
				! [ 'contact', 'address', 'order' ].includes( placement.key ) &&
				groups[ placement.key ].length > 0
		)
		.map( ( placement ) =>
			sprintf(
				/* translators: 1: number of fields, 2: placement name, e.g. "Order summary". */
				__( '%1$d in %2$s', 'fieldwright-checkout-fields' ),
				groups[ placement.key ].length,
				placement.label
			)
		);

	return (
		<section
			className={ classNames(
				'cbwb-pane cbwb-pane--preview cbwb-preview',
				isTry && 'is-try'
			) }
			aria-label={ __(
				'Checkout preview',
				'fieldwright-checkout-fields'
			) }
		>
			<div className="cbwb-pane__header cbwb-preview__header">
				<div className="cbwb-preview__titles">
					<h2
						className="cbwb-pane__title cbwb-preview__title"
						id="cbwb-preview-title"
					>
						{ __(
							'Checkout preview',
							'fieldwright-checkout-fields'
						) }
					</h2>
					<p className="cbwb-preview__caption">
						{ __(
							'Approximate. Your theme controls the final styling.',
							'fieldwright-checkout-fields'
						) }
					</p>
				</div>
				<div className="cbwb-preview__tools">
					<SegmentedControl< PreviewMode >
						className="cbwb-preview__mode"
						label={ __(
							'Preview mode',
							'fieldwright-checkout-fields'
						) }
						value={ preview.mode }
						options={ [
							{
								value: 'edit',
								label: __(
									'Edit',
									'fieldwright-checkout-fields'
								),
							},
							{
								value: 'try',
								label: __(
									'Live',
									'fieldwright-checkout-fields'
								),
							},
						] }
						onChange={ changeMode }
					/>
					<SegmentedControl< PreviewViewport >
						className="cbwb-preview__viewport"
						label={ __(
							'Preview width',
							'fieldwright-checkout-fields'
						) }
						value={ viewport }
						options={ [
							{
								value: 'desktop',
								icon: desktop,
								label: __(
									'Desktop',
									'fieldwright-checkout-fields'
								),
							},
							{
								value: 'mobile',
								icon: mobile,
								label: __(
									'Mobile',
									'fieldwright-checkout-fields'
								),
							},
						] }
						onChange={ changeViewport }
					/>
					{ /*
					 * Live mode only. Who the checkout is pretending to be
					 * decides what a guest-only or a signed-in-only field does,
					 * and Reset puts every answer back where a shopper finds
					 * them — neither has anything to say about a picture.
					 */ }
					{ isTry && (
						<ToggleControl
							__nextHasNoMarginBottom
							className="cbwb-preview__customer"
							label={ __(
								'Signed in',
								'fieldwright-checkout-fields'
							) }
							checked={ preview.customer.loggedIn }
							onChange={ setLoggedIn }
						/>
					) }
					{ isTry && (
						<Button
							__next40pxDefaultSize
							variant="secondary"
							className="cbwb-preview__reset"
							onClick={ resetTry }
						>
							{ __( 'Reset', 'fieldwright-checkout-fields' ) }
						</Button>
					) }
					{ checkoutUrl && (
						<Button
							__next40pxDefaultSize
							variant="secondary"
							className="cbwb-preview__open"
							icon={ external }
							href={ checkoutUrl }
							target="_blank"
							rel="noopener noreferrer"
						>
							{ __( 'Open page', 'fieldwright-checkout-fields' ) }
						</Button>
					) }
				</div>
			</div>

			<p className="cbwb-preview__summary" id="cbwb-preview-summary">
				{ sprintf(
					/* translators: 1: contact count phrase, e.g. "1 field in Contact". 2: address count phrase. 3: order information count phrase. */
					__(
						'Preview: %1$s, %2$s, %3$s.',
						'fieldwright-checkout-fields'
					),
					sprintf(
						/* translators: %d: number of fields. */
						_n(
							'%d field in Contact',
							'%d fields in Contact',
							groups.contact.length,
							'fieldwright-checkout-fields'
						),
						groups.contact.length
					),
					sprintf(
						/* translators: %d: number of fields. */
						_n(
							'%d in Address',
							'%d in Address',
							groups.address.length,
							'fieldwright-checkout-fields'
						),
						groups.address.length
					),
					sprintf(
						/* translators: %d: number of fields. */
						_n(
							'%d in Additional order information',
							'%d in Additional order information',
							groups.order.length,
							'fieldwright-checkout-fields'
						),
						groups.order.length
					)
				) }
				{ extraCounts.length > 0 &&
					` ${ sprintf(
						/* translators: %s: a list of counts, e.g. "1 in Order summary, 2 in Before Place Order". */
						__( 'Also: %s.', 'fieldwright-checkout-fields' ),
						// Punctuation between two already-translated phrases; the
						// sentence around them is what carries the wording.
						extraCounts.join( ', ' )
					) }` }
			</p>

			<div
				className={ classNames(
					'cbwb-preview__frame',
					`is-${ viewport }`
				) }
				ref={ frameRef }
				/*
				 * The frame scrolls, so it must be reachable by keyboard — and
				 * a focusable box needs a name of its own: without one a screen
				 * reader reads the whole mock checkout out on arrival instead of
				 * saying what has just been focused.
				 */
				tabIndex={ 0 }
				role="group"
				aria-label={ __(
					'Checkout preview',
					'fieldwright-checkout-fields'
				) }
				aria-describedby="cbwb-preview-summary"
			>
				{ /*
				 * Keyed on the mode: every control in here changes between a
				 * picture and an answer, and React would otherwise carry one
				 * DOM node from an uncontrolled box into a controlled one.
				 */ }
				<div
					className="wc-block-checkout cbwb-preview__checkout"
					key={ preview.mode }
				>
					<div className="cbwb-preview__layout">
						<form className="wc-block-components-form wc-block-checkout__form">
							<Step
								className="wc-block-checkout__contact-fields"
								title={ contactSection }
								live={ isTry }
								action={ addTo( 'contact', contactSection ) }
							>
								<div className="wc-block-components-address-form">
									{ shown
										.filter(
											( row ) =>
												'contact' === row.location
										)
										.map( renderCore ) }
									{ renderFields( groups.contact ) }
								</div>
							</Step>

							<Step
								className="wc-block-checkout__shipping-fields"
								title={ addressSection }
								live={ isTry }
								// A note to the merchant, not part of the checkout.
								description={
									isTry
										? undefined
										: __(
												'Address fields also appear in the billing address form.',
												'fieldwright-checkout-fields'
										  )
								}
								action={
									<>
										{ addTo( 'address', addressSection ) }
										{ addTo(
											'shipping_address',
											__(
												'the shipping address form only',
												'fieldwright-checkout-fields'
											),
											__(
												'Shipping form only',
												'fieldwright-checkout-fields'
											)
										) }
									</>
								}
							>
								{ /*
								 * WooCommerce's own fields and the merchant's,
								 * in the one sorted list WooCommerce actually
								 * draws — which is why the merchant can put
								 * their own field between two of core's.
								 */ }
								<div className="wc-block-components-address-form">
									{ renderAddress() }
								</div>
								<Checkbox
									id="cbwb-preview-same-address"
									className="wc-block-checkout__use-address-for-billing"
									label={ __(
										'Use same address for billing',
										'fieldwright-checkout-fields'
									) }
									checked={
										isTry ? preview.sameAddress : true
									}
									live={ isTry }
									onToggle={ setSameAddress }
								/>
								{ /*
								 * The shipping form's own extra fields. The
								 * checkout renders a step's inner blocks after
								 * everything the step draws itself, which puts
								 * them below this switch rather than beside the
								 * address boxes above it.
								 */ }
								{ renderFields( groups.shipping_address ) }
							</Step>

							{ /*
							 * The billing form. The real checkout only draws it
							 * once the shopper unticks the switch above, so the
							 * canvas says so rather than pretending otherwise —
							 * and keeps the section on screen, because a
							 * position with nowhere to add a field to is a
							 * position no merchant will find. In Live mode the
							 * switch is real, so the step comes and goes with it.
							 */ }
							{ ( ! isTry || ! preview.sameAddress ) && (
								<Step
									className="wc-block-checkout__billing-fields"
									title={ billingSection }
									live={ isTry }
									description={
										isTry
											? undefined
											: __(
													'Shown when the customer unticks "Use same address for billing".',
													'fieldwright-checkout-fields'
											  )
									}
									action={ addTo(
										'billing_address',
										billingSection
									) }
								>
									{ renderFields( groups.billing_address ) }
								</Step>
							) }

							<Step
								className="wc-block-checkout__shipping-option"
								title={ shippingSection }
								live={ isTry }
								action={ addTo(
									'after_shipping',
									shippingSection
								) }
							>
								<Radio
									name="shipping-option"
									label={ __(
										'Flat rate',
										'fieldwright-checkout-fields'
									) }
									secondaryLabel={ previewMoney(
										PREVIEW_SHIPPING
									) }
									live={ isTry }
								/>
								{ renderFields( groups.after_shipping ) }
							</Step>

							<Step
								className="wc-block-checkout__payment-method"
								title={ paymentSection }
								live={ isTry }
								action={ addTo(
									'after_payment',
									paymentSection
								) }
							>
								<Radio
									name="payment-method"
									label={ __(
										'Cash on delivery',
										'fieldwright-checkout-fields'
									) }
									live={ isTry }
								/>
								{ renderFields( groups.after_payment ) }
							</Step>

							{ /*
							 * Core drops this block entirely when it has nothing to
							 * show. The builder keeps a stub of it so the section
							 * stays discoverable — there has to be somewhere to put
							 * the first order field.
							 */ }
							{ groups.order.length > 0 ||
							( hasCore && ! noteHidden ) ? (
								<Step
									className="wc-block-checkout__additional-information-fields"
									title={ orderSection }
									live={ isTry }
									action={ addTo( 'order', orderSection ) }
								>
									{ renderFields( groups.order ) }
									{ ! noteHidden && (
										<div className="wc-block-checkout__add-note">
											<Checkbox
												id="cbwb-preview-order-note"
												label={ __(
													'Add a note to your order',
													'fieldwright-checkout-fields'
												) }
												className={ classNames(
													hasCore &&
														'cbwb-preview__field',
													hasCore &&
														isTry &&
														'is-live',
													hasCore &&
														! isTry &&
														noteId === selectedId &&
														'is-selected'
												) }
												checked={ isTry && noteOpen }
												live={ isTry }
												onToggle={ setNoteOpen }
												{ ...coreProps( noteId ) }
											/>
										</div>
									) }
								</Step>
							) : (
								/*
								 * A stub for the merchant to add the first order
								 * field to. Live mode is the checkout as it
								 * stands, and the checkout drops the step.
								 */
								! isTry && (
									<Step
										className="wc-block-checkout__additional-information-fields is-placeholder"
										title={ __(
											'Additional order information (appears when you add a field)',
											'fieldwright-checkout-fields'
										) }
										action={ addTo(
											'order',
											orderSection
										) }
									/>
								)
							) }

							<div
								className="wc-block-checkout__terms wc-block-checkout__terms--with-separator"
								aria-hidden={ isTry ? undefined : 'true' }
							>
								<span className="wc-block-components-checkbox__label">
									{ __(
										'By proceeding with your purchase you agree to our Terms and Conditions and Privacy Policy',
										'fieldwright-checkout-fields'
									) }
								</span>
							</div>

							{ /*
							 * The last thing before the button, which is where a
							 * final consent or instruction belongs. It has no
							 * heading of its own at checkout, so it has none here.
							 */ }
							<div className="cbwb-preview__before-place-order">
								{ renderFields( groups.before_place_order ) }
								{ addTo(
									'before_place_order',
									placeOrderSection
								) }
							</div>

							{ /*
							 * Disabled in both modes: Live mode is a copy of the
							 * form, not a copy of the order, and there is
							 * nothing here to place.
							 */ }
							<div
								className="wc-block-checkout__actions"
								aria-hidden={ isTry ? undefined : 'true' }
							>
								<div className="wc-block-checkout__actions_row wc-block-checkout__actions_row--justify-flex-end">
									<button
										type="button"
										className="wc-block-components-button wp-element-button wc-block-components-checkout-place-order-button wc-block-components-checkout-place-order-button--full-width contained"
										disabled
										tabIndex={ isTry ? undefined : -1 }
									>
										<span className="wc-block-components-button__text">
											{ __(
												'Place Order',
												'fieldwright-checkout-fields'
											) }
										</span>
									</button>
								</div>
							</div>
						</form>

						{ /*
						 * The order summary is a sidebar in the real checkout, so
						 * it is one here — but only once a field is actually in
						 * it: an empty card beside every checkout would be a
						 * picture of something the shopper never sees. Live mode
						 * always draws it, because the real checkout does and
						 * because it is where an add-on's rows land.
						 */ }
						{ ( isTry ||
							groups.order_summary.length > 0 ||
							showCoupon ) && (
							<aside className="wc-block-components-sidebar cbwb-preview__sidebar">
								<div
									className="wc-block-components-totals-wrapper"
									aria-hidden={ isTry ? undefined : 'true' }
								>
									<h2 className="wc-block-components-title">
										{ summarySection }
									</h2>
									<p className="cbwb-preview__totals">
										<span>
											{ __(
												'Subtotal',
												'fieldwright-checkout-fields'
											) }
										</span>
										<span>
											{ previewMoney( PREVIEW_SUBTOTAL ) }
										</span>
									</p>
									{ /*
									 * The same five dollars the shipping step
									 * offers, said out loud: unnamed, it reads
									 * as a fee the summary has added.
									 */ }
									<p className="cbwb-preview__totals">
										<span>
											{ __(
												'Shipping',
												'fieldwright-checkout-fields'
											) }
										</span>
										<span>
											{ previewMoney( PREVIEW_SHIPPING ) }
										</span>
									</p>
									{ /*
									 * What an add-on says this order now costs
									 * on top: one row each, and every one of
									 * them counted into the total below.
									 */ }
									{ summaryLines.map( ( line ) => (
										<p
											className="cbwb-preview__totals cbwb-preview__totals--extra"
											key={ line.key }
										>
											<span>{ line.label }</span>
											<span>
												{ previewMoney(
													line.amount,
													line.formatted
												) }
											</span>
										</p>
									) ) }
									<p className="cbwb-preview__totals is-total">
										<span>
											{ __(
												'Total',
												'fieldwright-checkout-fields'
											) }
										</span>
										<span>
											{ previewMoney(
												summaryLines.reduce(
													( total, line ) =>
														total + line.amount,
													PREVIEW_SUBTOTAL +
														PREVIEW_SHIPPING
												)
											) }
										</span>
									</p>
								</div>
								{ /*
								 * WooCommerce keeps the coupon field folded away
								 * behind this link, and the cart page has a form
								 * of its own that this row never touches.
								 */ }
								{ showCoupon && (
									<Affordance
										className={ classNames(
											'wc-block-components-totals-coupon',
											'cbwb-preview__coupon',
											'cbwb-preview__field',
											isTry && 'is-live',
											! isTry &&
												couponId === selectedId &&
												'is-selected'
										) }
										live={ isTry }
										{ ...coreProps( couponId ) }
									>
										{ __(
											'Add a coupon',
											'fieldwright-checkout-fields'
										) }
									</Affordance>
								) }
								{ renderFields( groups.order_summary ) }
								{ addTo( 'order_summary', summarySection ) }
							</aside>
						) }
					</div>
				</div>
			</div>
		</section>
	);
}
