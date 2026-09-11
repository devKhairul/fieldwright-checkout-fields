/**
 * The builder's extension points.
 *
 * Everything an add-on bundle (Pro) can change about the builder goes through
 * one of the filters below. They are thin, typed wrappers over
 * `@wordpress/hooks` — a core script, so both bundles share one registry — and
 * every one of them is written so that with nothing registered the builder
 * behaves exactly as it did before the filter existed.
 *
 * Filters are read at render time, so a bundle that loads after Free only has
 * to register before the first render; `admin.tsx` defers mounting until the
 * document is ready for exactly that reason.
 */

import type { ComponentType, ReactNode } from 'react';

import { addFilter, applyFilters, removeFilter } from '@wordpress/hooks';

import type {
	AdminBootstrap,
	Field,
	FieldType,
	ValidationError,
} from '../types';
import type { TypeGroupKey } from './typeMeta';
import type { ValidationContext } from './validate';

export { addFilter, removeFilter };

/** Every filter name, in one place so a typo fails at compile time. */
export const FILTERS = {
	editorSections: 'cbwb.editorSections',
	fieldTypes: 'cbwb.fieldTypes',
	validateField: 'cbwb.validateField',
	rowIndicators: 'cbwb.rowIndicators',
	previewFieldLabel: 'cbwb.previewFieldLabel',
	fieldDefaults: 'cbwb.fieldDefaults',
	typeChange: 'cbwb.typeChange',
	settingsSections: 'cbwb.settingsSections',
	tabs: 'cbwb.tabs',
	previewFieldState: 'cbwb.previewFieldState',
	previewSummaryLines: 'cbwb.previewSummaryLines',
} as const;

/** Where an extra editor section is inserted. */
export type SectionPlacement = 'afterRules' | 'afterVisibility';

/**
 * What the row-level filters are handed.
 *
 * A merchant's own field, or one of WooCommerce's own rows wearing a field's
 * shape and marked `kind: 'core'`. An add-on's settings belong to the fields a
 * merchant added — WooCommerce owns everything about its own — so the mark is
 * how a bundle tells the two apart without needing a second filter for each.
 * `kind` is never stored: it exists only on the object handed to a filter.
 */
export type FilterField = Field & { kind?: 'field' | 'core' };

/**
 * What an extra editor section is handed when it renders.
 */
export interface EditorSectionContext {
	field: FilterField;
	/** Applies a change set to the field being edited. */
	update: ( patch: Partial< Field > ) => void;
	/**
	 * This field's validation errors, with the `fields[i].` prefix stripped —
	 * so a section owns everything whose path starts with its own key, e.g.
	 * `pro.fee.amount`.
	 */
	errors: ValidationError[];
	bootstrap: AdminBootstrap;
}

/**
 * One extra section in the field editor, contributed by an add-on.
 */
export interface EditorSection {
	/** Stable key, used as the React key. */
	key: string;
	/**
	 * Section heading, and the sentence under it.
	 *
	 * Both optional: a section that only has a line of prose to offer — an
	 * add-on saying its settings do not reach this field — reads better as a
	 * footnote to the section above it than as a group of its own with one
	 * sentence in it.
	 */
	title?: string;
	description?: string;
	placement: SectionPlacement;
	render: ( context: EditorSectionContext ) => ReactNode;
}

/**
 * What the preview hands whatever draws a field's body.
 *
 * The wrapper around it is Free's in every case — the label, the help line, the
 * "(optional)" suffix, the selection outline and the error line under it are the
 * same whoever provided the type — so a body is handed the answer, the way to
 * change it, and the three attributes that tie it to the label and the message
 * beside it. `disabled` is the picture the builder draws in Edit mode, where
 * every control is a drawing of the checkout rather than a copy of it.
 */
export interface PreviewBodyProps {
	field: Field;
	/** The answer so far, in the checkout's storage shape. */
	value: string;
	/** The answer changed, in that same shape. */
	onChange: ( value: string ) => void;
	/** True while the body is part of a picture and cannot be answered. */
	disabled: boolean;
	/** The id the label points at. */
	id: string;
	/** The id of the message under the control, where there is one. */
	describedBy?: string;
}

/**
 * A field type an add-on provides.
 *
 * Free stores the type's own settings inside the field's opaque `pro` payload
 * (`pro.<key>`), carries them through every save, export and duplicate without
 * reading a key of them, and asks the descriptor below for everything else: what
 * the picker calls the type, what the editor draws for it, what the preview
 * draws for it, and what makes a field of it invalid.
 *
 * A descriptor is only ever consulted for a type the server also registered. A
 * type the server does not list is a type the checkout cannot render, so the
 * builder leaves every field of it alone rather than offering settings that
 * would never reach a shopper.
 */
export interface RegisteredFieldType {
	/** Matches the PHP registration exactly. */
	key: string;
	/** Which group of the picker the type is offered in. */
	group: TypeGroupKey;
	icon: ReactNode;
	/**
	 * Type-specific settings, rendered where Free renders its own per-type
	 * panel: between the common header and Rules.
	 */
	Settings?: ComponentType< EditorSectionContext >;
	/**
	 * What the preview draws for the field body. Omitted: a disabled
	 * placeholder input, so the field still has a shape on the canvas.
	 */
	Preview?: ComponentType< PreviewBodyProps >;
	/**
	 * Extra client-side checks; the same contract as `cbwb.validateField` but
	 * only for this type. Paths are relative to the field, the way an editor
	 * section reads its own (`pro.file.max_mb`), and Free prefixes them with
	 * `fields[i].` before reporting them.
	 */
	validate?: (
		field: Field,
		context: ValidationContext
	) => ValidationError[];
	/**
	 * Seed for a new field of this type, merged over Free's blank field.
	 * Typically `{ pro: { <key>: {…} } }`.
	 */
	defaults?: Partial< Field >;
	/** Whether the field carries a merchant default. Default false. */
	hasDefaultValue?: boolean;
	/** Whether "remember for next time" is offered. Default false. */
	canSaveToProfile?: boolean;
}

/** What a registered key may contain, exactly as the PHP registry reads it. */
const TYPE_KEY = /^[a-z][a-z0-9_]*$/;

/**
 * Whether a filtered value is a descriptor the builder can use.
 *
 * @param value Candidate from the filter.
 * @return True when the type can be resolved from it.
 */
function isFieldType( value: unknown ): value is RegisteredFieldType {
	const type = value as Partial< RegisteredFieldType > | null;

	return Boolean(
		type &&
			'object' === typeof type &&
			'string' === typeof type.key &&
			TYPE_KEY.test( type.key ) &&
			'string' === typeof type.group
	);
}

/**
 * The field types add-ons registered, with anything malformed dropped.
 *
 * Read wherever a type is resolved rather than once at load, for the reason
 * every other filter here is: the bundle that registers a type loads after this
 * one, and the first render is what both are waiting for.
 *
 * @return The descriptors, in the order the filters left them, first
 *         registration winning where two claim one key.
 */
export function registeredTypes(): RegisteredFieldType[] {
	const filtered = applyFilters(
		FILTERS.fieldTypes,
		[] as RegisteredFieldType[]
	);

	if ( ! Array.isArray( filtered ) ) {
		return [];
	}

	const seen = new Set< string >();

	return filtered.filter( ( type ): type is RegisteredFieldType => {
		if ( ! isFieldType( type ) || seen.has( type.key ) ) {
			return false;
		}

		seen.add( type.key );

		return true;
	} );
}

/** A status beside a field in the outline, with its meaning as hidden text. */
export interface RowIndicator {
	key: string;
	label: string;
	tone: 'brand' | 'neutral' | 'warning';
	/**
	 * What the row draws for it: a `@wordpress/icons` element, or a short text
	 * glyph such as a currency symbol.
	 *
	 * Optional, and deliberately so. These were anonymous coloured dots before
	 * they were glyphs, and an add-on written against that shape — or one whose
	 * status has nothing worth drawing — still gets the dot it always got.
	 */
	icon?: ReactNode;
}

/**
 * A tab of an add-on's own, beside the builder's.
 *
 * A settings panel goes on the Settings tab through `cbwb.settingsSections`;
 * this is for the screens that are not settings — a licence, a log, a tool with
 * a page of its own — and it hands the add-on the whole panel under the tab
 * strip rather than a card inside somebody else's screen.
 */
export interface BuilderTab {
	/**
	 * Unique among tabs.
	 *
	 * It becomes part of the tab button's element id, so it is limited to
	 * letters, numbers, hyphens and underscores: a key with anything else in it
	 * would break the arrow-key navigation for every tab on the strip, not only
	 * its own.
	 */
	key: string;
	/** What the tab strip prints. Sentence case, like the built-in ones. */
	label: string;
	/** The whole panel under the tab strip. */
	render: ( context: { bootstrap: AdminBootstrap } ) => ReactNode;
}

const PLACEMENTS: SectionPlacement[] = [ 'afterRules', 'afterVisibility' ];

/** What a tab key may contain. See `BuilderTab.key`. */
const TAB_KEY = /^[a-zA-Z0-9_-]+$/;

/**
 * Whether a filtered value is a usable editor section.
 *
 * @param value Candidate from the filter.
 * @return True when the section can be rendered.
 */
function isSection( value: unknown ): value is EditorSection {
	const section = value as Partial< EditorSection > | null;
	return Boolean(
		section &&
			'string' === typeof section.key &&
			'function' === typeof section.render &&
			PLACEMENTS.includes( section.placement as SectionPlacement )
	);
}

/**
 * The extra sections to render in the field editor.
 *
 * @param context What the sections will be rendered with. Passed to the filter
 *                too, so an add-on can leave a section out entirely for a field
 *                it does not apply to rather than rendering an empty one.
 * @return Sections contributed by add-ons.
 */
export function editorSections(
	context: EditorSectionContext
): EditorSection[] {
	const sections = applyFilters(
		FILTERS.editorSections,
		[] as EditorSection[],
		context
	);

	return Array.isArray( sections ) ? sections.filter( isSection ) : [];
}

/**
 * The tabs an add-on asked to add, with anything malformed dropped.
 *
 * Checked rather than trusted, for the same reason `extraSections()` checks what
 * it is handed: a filter is a place another plugin's code runs, and a tab
 * without a working `render` would take the whole builder down with it. A key
 * the builder is already using is dropped too, because two tabs answering to one
 * id is a tab strip whose keyboard navigation lands on the wrong panel.
 *
 * @param bootstrap Everything the server sent. Passed to the filter as well, so
 *                  an add-on can leave a tab out entirely on a store it has
 *                  nothing to say about.
 * @param reserved  Keys the builder's own tabs already hold.
 * @return The tabs to render, after the builder's own.
 */
export function extraTabs(
	bootstrap: AdminBootstrap,
	reserved: readonly string[] = []
): BuilderTab[] {
	const filtered = applyFilters(
		FILTERS.tabs,
		[] as BuilderTab[],
		bootstrap
	);

	if ( ! Array.isArray( filtered ) ) {
		return [];
	}

	const seen = new Set< string >( reserved );

	return filtered.filter( ( tab ): tab is BuilderTab => {
		if ( ! tab || 'object' !== typeof tab ) {
			return false;
		}

		const { key, label, render } = tab as Partial< BuilderTab >;

		if (
			'string' !== typeof key ||
			! TAB_KEY.test( key ) ||
			'string' !== typeof label ||
			'' === label ||
			'function' !== typeof render ||
			seen.has( key )
		) {
			return false;
		}

		seen.add( key );

		return true;
	} );
}

/**
 * Let add-ons add to one field's validation errors.
 *
 * @param errors  Errors Free found for the field.
 * @param field   The field.
 * @param index   Its position in the config, for `fields[i].…` paths.
 * @param context Bootstrap-derived validation rules.
 * @return The errors to report for the field.
 */
export function validateField(
	errors: ValidationError[],
	field: Field,
	index: number,
	context: ValidationContext
): ValidationError[] {
	const filtered = applyFilters(
		FILTERS.validateField,
		errors,
		field,
		index,
		context
	);

	return Array.isArray( filtered )
		? ( filtered as ValidationError[] )
		: errors;
}

/**
 * The extra statuses one outline row shows.
 *
 * @param field The field.
 * @return Indicators contributed by add-ons.
 */
export function rowIndicators( field: FilterField ): RowIndicator[] {
	const indicators = applyFilters(
		FILTERS.rowIndicators,
		[] as RowIndicator[],
		field
	);

	return Array.isArray( indicators )
		? ( indicators as RowIndicator[] ).filter(
				( indicator ) =>
					indicator &&
					'string' === typeof indicator.key &&
					'string' === typeof indicator.label
		  )
		: [];
}

/**
 * The label the checkout preview prints for a field.
 *
 * @param label What Free would print.
 * @param field The field.
 * @return Label to render.
 */
export function previewFieldLabel( label: string, field: FilterField ): string {
	const filtered = applyFilters( FILTERS.previewFieldLabel, label, field );

	return 'string' === typeof filtered ? filtered : label;
}

/**
 * The preview's two ways of working.
 *
 * `edit` is the picture the builder has always drawn: a click selects the
 * field. `try` is a working copy of the checkout: the controls are live, and
 * the add-on filters below are asked what the form should look like given what
 * the merchant has typed and ticked so far.
 */
export type PreviewMode = 'edit' | 'try';

/** Who the previewed checkout is pretending to be. */
export interface PreviewCustomer {
	loggedIn: boolean;
	/** Role slugs. Empty until something in the builder can choose one. */
	roles: string[];
}

/**
 * What the preview filters are handed: everything a merchant has done in the
 * Live mode so far, in the shapes the checkout itself stores.
 *
 * `values` are keyed by field id and use the storage shapes of the checkout: a
 * checkbox is `'yes'` or `''`, a checkbox group is a comma separated list, a
 * date is `YYYY-MM-DD`, a time is `HH:MM`. `coreValues` are keyed by
 * WooCommerce's own field keys (`country`, `state`, `postcode`, `city`,
 * `company`, ...). `hidden` is filled in from `cbwb.previewFieldState` before
 * `cbwb.previewSummaryLines` runs, so a summary line can leave out a fee whose
 * checkbox is not on the screen.
 */
export interface PreviewContext {
	mode: PreviewMode;
	fields: Field[];
	values: Record< string, string >;
	coreValues: Record< string, string >;
	sameAddress: boolean;
	customer: PreviewCustomer;
	hidden: ReadonlySet< string >;
}

/** One choice an add-on offered a previewed field. */
export interface PreviewOption {
	value: string;
	label: string;
	/** True while the choice is drawn but cannot be picked. */
	disabled?: boolean;
}

/**
 * What an add-on says about one previewed field.
 *
 * `note` is one short sentence drawn as a tag beside the field in Live mode, for
 * the things a preview cannot know: "Also depends on the cart."
 *
 * `options` is for the fields whose answers an add-on draws up rather than the
 * merchant: a time field offering delivery slots is a dropdown of them on the
 * real checkout, so it is one here too. An empty array is not the same as none
 * at all — it says the add-on has a list and nothing is on it yet, and the
 * preview draws the dropdown disabled with the note under it.
 *
 * `required` is for a field an add-on makes compulsory in some situations and
 * not in others. Left out entirely — which is what anything but a boolean is
 * read as — the merchant's own Required switch is what decides, as it always
 * has.
 *
 * `minDate` and `maxDate` are `YYYY-MM-DD` bounds an add-on puts on a date
 * field, the same ones the checkout sets on the real picker. They narrow the
 * merchant's own earliest and latest date rather than replacing them, so a
 * preview never offers a day the checkout would refuse.
 */
export interface PreviewFieldState {
	hidden: boolean;
	note?: string;
	options?: PreviewOption[];
	required?: boolean;
	minDate?: string;
	maxDate?: string;
}

/** One extra row in the preview's order summary, in the store's currency. */
export interface PreviewSummaryLine {
	key: string;
	label: string;
	amount: number;
	/**
	 * The amount already written the way the store writes money, e.g. "€5,00".
	 *
	 * Optional, and only an add-on that knows the store's currency can supply
	 * one: the preview's own fallback formats the number itself, and it does
	 * not know the symbol, the separators or how many decimals the store uses.
	 */
	formatted?: string;
}

/**
 * The choices an add-on offered, with anything malformed dropped.
 *
 * A list is only worth drawing if every entry of it can be, so an entry without
 * a value and a label of its own is left out rather than drawn as an empty row.
 *
 * @param value Whatever the filter put on `options`.
 * @return The choices, or undefined when the filter offered no list at all.
 */
function previewOptions( value: unknown ): PreviewOption[] | undefined {
	if ( ! Array.isArray( value ) ) {
		return undefined;
	}

	return value
		.filter( ( option ): option is PreviewOption => {
			const entry = option as Partial< PreviewOption > | null;

			return Boolean(
				entry &&
					'object' === typeof entry &&
					'string' === typeof entry.value &&
					'string' === typeof entry.label &&
					'' !== entry.label
			);
		} )
		.map( ( option ) =>
			option.disabled
				? { value: option.value, label: option.label, disabled: true }
				: { value: option.value, label: option.label }
		);
}

/**
 * Ask add-ons whether one field is on the previewed checkout, and what to say
 * beside it.
 *
 * Read like `previewFieldLabel()`: the result is checked, not trusted, and a
 * filter that returns nothing usable leaves the field exactly as Free would
 * draw it.
 *
 * @param field   The field.
 * @param context What the merchant has done in the preview so far.
 * @return Whether the field is shown, whether it has to be answered, the choices
 *         to offer, and any tag to draw beside it.
 */
export function previewFieldState(
	field: FilterField,
	context: PreviewContext
): PreviewFieldState {
	const seed: PreviewFieldState = { hidden: false };
	const filtered = applyFilters(
		FILTERS.previewFieldState,
		seed,
		field,
		context
	) as Partial< PreviewFieldState > | null;

	if ( ! filtered || 'object' !== typeof filtered ) {
		return seed;
	}

	const state: PreviewFieldState = { hidden: Boolean( filtered.hidden ) };

	if ( 'string' === typeof filtered.note && '' !== filtered.note.trim() ) {
		state.note = filtered.note.trim();
	}

	const options = previewOptions( filtered.options );

	if ( undefined !== options ) {
		state.options = options;
	}

	// A boolean is an answer either way; anything else is no answer at all, and
	// the field keeps the merchant's own setting.
	if ( 'boolean' === typeof filtered.required ) {
		state.required = filtered.required;
	}

	if ( isDateString( filtered.minDate ) ) {
		state.minDate = filtered.minDate;
	}

	if ( isDateString( filtered.maxDate ) ) {
		state.maxDate = filtered.maxDate;
	}

	return state;
}

/** `YYYY-MM-DD`, which is the only shape a date input takes. */
const PREVIEW_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a filtered bound is a date the preview can put on an input.
 *
 * @param value Whatever the filter offered.
 * @return True for a `YYYY-MM-DD` string.
 */
function isDateString( value: unknown ): value is string {
	return 'string' === typeof value && PREVIEW_DATE.test( value );
}

/**
 * The extra rows add-ons want in the preview's order summary.
 *
 * A line without a usable label or with an amount that is not a finite number
 * is dropped rather than drawn as `NaN`, and a duplicate key keeps its first
 * line, so two add-ons cannot bill the same thing twice by accident.
 *
 * @param context What the merchant has done in the preview so far, with
 *                `hidden` already filled in.
 * @return Lines to add under the subtotal.
 */
export function previewSummaryLines(
	context: PreviewContext
): PreviewSummaryLine[] {
	const filtered = applyFilters(
		FILTERS.previewSummaryLines,
		[] as PreviewSummaryLine[],
		context
	);

	if ( ! Array.isArray( filtered ) ) {
		return [];
	}

	const seen = new Set< string >();

	return filtered.filter( ( line ): line is PreviewSummaryLine => {
		if ( ! line || 'object' !== typeof line ) {
			return false;
		}

		const { key, label, amount, formatted } =
			line as Partial< PreviewSummaryLine >;

		if (
			'string' !== typeof key ||
			'' === key ||
			'string' !== typeof label ||
			'' === label.trim() ||
			'number' !== typeof amount ||
			! Number.isFinite( amount ) ||
			seen.has( key ) ||
			// Offered or not offered; an empty string is neither, and would
			// draw a row with a label and a blank where the price goes.
			( undefined !== formatted &&
				( 'string' !== typeof formatted || '' === formatted.trim() ) )
		) {
			return false;
		}

		seen.add( key );

		return true;
	} );
}

/**
 * Let add-ons seed their own keys on a newly created field.
 *
 * @param field The new field.
 * @return The field to add.
 */
export function fieldDefaults( field: Field ): Field {
	const filtered = applyFilters( FILTERS.fieldDefaults, field );

	return filtered && 'object' === typeof filtered
		? ( filtered as Field )
		: field;
}

/**
 * Let add-ons react to a field changing shape — a new type, or a move to a
 * location where a setting of theirs no longer applies.
 *
 * @param field The field, already carrying its new type and location.
 * @param type  The type it now has.
 * @return The field to store.
 */
export function typeChange( field: Field, type: FieldType ): Field {
	const filtered = applyFilters( FILTERS.typeChange, field, type );

	return filtered && 'object' === typeof filtered
		? ( filtered as Field )
		: field;
}
