/**
 * The contract between the server and the checkout bundle.
 *
 * Everything here mirrors what `Checkout\Assets` prints as
 * `window.cbwbCheckout`, which is a narrowed view of the field schema in
 * `includes/Fields/FieldDefinition.php`: only the fields WooCommerce cannot
 * render itself, and only the keys those types actually need.
 *
 * The admin app's `Field` is deliberately *not* reused. It describes the
 * builder's working copy — enabled flags, Pro settings, format presets, the
 * lot — and the storefront should carry none of that weight, nor break when
 * the builder grows a key.
 */

import type { ComponentType } from 'react';

/** The field types this bundle draws itself. WooCommerce renders the rest. */
export type BuiltinRichFieldType =
	| 'textarea'
	| 'radio'
	| 'checkbox_group'
	| 'date'
	| 'time'
	| 'heading'
	| 'paragraph';

/** Types that show something rather than ask something. */
export type ContentFieldType = Extract<
	BuiltinRichFieldType,
	'heading' | 'paragraph'
>;

export type FieldWidth = 'full' | 'half';

export type OptionsLayout = 'stacked' | 'inline';

export interface FieldOption {
	value: string;
	label: string;
	/**
	 * True while the choice is on the list but cannot be picked.
	 *
	 * Never set on the merchant's own options: it is for the lists an add-on
	 * puts on a field's state, where a choice that is there but taken says more
	 * than a choice that has vanished.
	 */
	disabled?: boolean;
}

/**
 * One field, as the server describes it.
 *
 * Every key is required here because `normalizeField()` fills in whatever the
 * server left out — so the components downstream never have to ask twice.
 */
export interface RichField {
	/** Namespaced, e.g. `cbwb/gift-message`. Matches `data-cbwb-field`. */
	id: string;
	/**
	 * One of the built-in types above, or the key an add-on registered.
	 *
	 * A string rather than the union, because the types this bundle draws are
	 * no longer only its own: an add-on registers a key with the server and the
	 * same key with `registerFieldType()`, and a field of it arrives here
	 * looking like any other.
	 */
	type: string;
	label: string;
	/** One line under the control. '' for none. */
	help: string;
	placeholder: string;
	default_value: string;
	required: boolean;
	width: FieldWidth;
	/** Placement the server chose. Carried for styling hooks only. */
	location: string;
	options: FieldOption[];
	options_layout: OptionsLayout;
	/** Textarea height in rows. */
	rows: number;
	/** Longest accepted answer, in characters. Null for no limit. */
	max_length: number | null;
	/** `YYYY-MM-DD`, or '' for no bound. */
	date_min: string;
	date_max: string;
	/** `HH:MM`, or '' for no bound. */
	time_min: string;
	time_max: string;
	/** Time granularity in minutes, as a decimal string. '' for the default. */
	step: string;
	/** Paragraph text. Sanitised server-side with `wp_kses`. */
	content: string;
	/** Heading level: 2, 3 or 4. */
	content_level: number;
	/** The merchant's own wording for a rejected answer. '' for the default. */
	error_message: string;
	/**
	 * Extra limits on a date field, worked out by an add-on.
	 *
	 * Absent unless something added it through `cbwb_checkout_bootstrap_data`.
	 * Free enforces it in the browser and does not compute it: what counts as
	 * three working days from now, in the store's timezone, is the add-on's
	 * business.
	 */
	dateRules?: DateRules;
	/**
	 * Every key of the server's entry this bundle did not read for itself.
	 *
	 * Where a registered type's own settings arrive: the server merges whatever
	 * its `public` callback published into the field's payload entry, and Free
	 * has no idea what any of it means, so it is carried across untouched and
	 * the Control that asked for it is the one that reads it. Empty for a
	 * built-in type on a payload with nothing extra on it.
	 */
	extra: Record< string, unknown >;
}

/**
 * Days a date field will not accept.
 *
 * The bounds are `YYYY-MM-DD` strings in the store's timezone, already resolved
 * to real dates by whoever computed them, so nothing here needs a clock. They
 * narrow `date_min` and `date_max` rather than replacing them: whichever is the
 * later start and the earlier end wins.
 */
export interface DateRules {
	/** Earliest acceptable date, `YYYY-MM-DD`. */
	minDate?: string;
	/** Latest acceptable date, `YYYY-MM-DD`. */
	maxDate?: string;
	/** Weekdays the store does not accept, 0 for Sunday through 6 for Saturday. */
	disabledWeekdays?: number[];
	/** Individual dates the store does not accept, `YYYY-MM-DD`. */
	blackoutDates?: string[];
	/**
	 * How old a date of birth has to make the shopper.
	 *
	 * Absent unless the field asks an age, and on any payload written before the
	 * rule was published. `ageMaxDate` is already inside `maxDate` — whichever
	 * ceiling is the earlier one — and is carried separately because a date
	 * refused for being too recent is refused with a sentence about the age
	 * rather than about the store's booking window, and that is the sentence the
	 * server sends back.
	 */
	minAgeYears?: number;
	/** The latest date of birth that makes someone that old, `YYYY-MM-DD`. */
	ageMaxDate?: string;
}

/**
 * What an add-on may say about one field on this shopper's checkout.
 *
 * Free renders the fields and knows nothing about conditions; an add-on that
 * evaluates the merchant's rules says the answer here. Its server-side
 * counterpart is the `cbwb_rich_field_state` filter, and both have to be told:
 * this one decides what the shopper sees, that one decides what counted.
 */
export interface FieldState {
	/** True while the field should not be on the page at all. */
	hidden: boolean;
	/**
	 * Whether the shopper has to answer, or undefined to leave the merchant's
	 * own setting alone.
	 */
	required?: boolean;
	/**
	 * The answers this shopper may pick from, where the add-on rather than the
	 * merchant decides what they are.
	 *
	 * A time field with a list of them is drawn as a dropdown instead of a
	 * clock, and nothing outside the list is accepted. An empty array is not the
	 * same as none at all: it says the add-on has a list to offer and nothing is
	 * open yet, and the field is drawn disabled with `note` under it.
	 */
	options?: FieldOption[];
	/**
	 * One line under the control, from the add-on rather than the merchant.
	 *
	 * It stands in for the field's own help text while it is set, because a
	 * field that cannot be answered yet has something more useful to say than
	 * whatever the merchant wrote for the ordinary case.
	 */
	note?: string;
}

/**
 * The same thing, with everything optional, as a caller writes it.
 *
 * A key the patch names replaces what is stored, whatever it names it as; a key
 * it leaves out keeps what is there. So `{ options: undefined }` takes the
 * choices away and `{}` leaves them alone.
 */
export type FieldStatePatch = Partial< FieldState >;

/**
 * The surface Free publishes on `window.cbwb.checkout` for add-on bundles.
 *
 * A global rather than a module export because the add-on is a separate bundle
 * that cannot import from this one: WooCommerce loads both as block
 * integrations, with Free's handle a dependency of the add-on's, so this object
 * exists by the time the add-on runs.
 */
export interface CheckoutFieldApi {
	/** Say something about one field. Merges with what is already said. */
	setFieldState: ( fieldId: string, state: FieldStatePatch ) => void;
	/** What is currently said about one field. */
	getFieldState: ( fieldId: string ) => FieldState;
	/** Hear about every change. Returns the function that stops listening. */
	subscribe: ( listener: () => void ) => () => void;
	/**
	 * Say how a type of the add-on's own is drawn and checked.
	 *
	 * The key is the one the add-on registered with the server, and a field of
	 * that type is drawn by this `Control` wherever the server injected a
	 * wrapper for it.
	 */
	registerFieldType: ( key: string, type: CheckoutFieldType ) => void;
	/** What is registered under one key, or undefined for nothing. */
	getFieldType: ( key: string ) => CheckoutFieldType | undefined;
}

/**
 * What every control is handed, Free's own and an add-on's alike.
 *
 * One shape rather than two, so the dispatch in `Field.tsx` is a single lookup
 * and a registered type is drawn on exactly the terms the built-in types are:
 * the same answer, the same way of recording it, the same way of saying the
 * shopper has finished with it.
 */
export interface FieldControlProps {
	/** The field, with an add-on's override of `required` already applied. */
	field: RichField;
	/** DOM id the label points at, which the control has to carry. */
	id: string;
	/** The shopper's answer, which the checkout store holds the only copy of. */
	value: string;
	/** Whether the shopper has to answer, an add-on's override included. */
	required: boolean;
	/** True while an error about this field is on screen. */
	invalid: boolean;
	/** Help and error paragraph ids, or undefined when there are none. */
	describedBy: string | undefined;
	/** What an add-on says about this field for this shopper. */
	state: FieldState;
	/** Record an answer. */
	onChange: ( value: string ) => void;
	/** The shopper has finished with the control: say what is wrong, if anything. */
	onSettle: () => void;
	/**
	 * Say what went wrong where no rule about the answer could have found it —
	 * a request of the control's own that failed. '' takes the complaint back.
	 */
	onProblem: ( message: string ) => void;
}

/**
 * A field type an add-on draws and checks for itself.
 *
 * Registered through `window.cbwb.checkout.registerFieldType()`, and read at
 * the moment a field is drawn rather than when this bundle loads, so an add-on
 * whose bundle depends on Free's handle — and therefore runs after it — is in
 * time whatever order WooCommerce enqueues the two in.
 */
export interface CheckoutFieldType {
	/** Draws the input. Receives the same props as the built-in controls. */
	Control: ComponentType< FieldControlProps >;
	/**
	 * Well-formedness of a non-empty value; a message, or null.
	 *
	 * Free handles required and empty before this is called, and says nothing
	 * else about the answer: what a value of this type may be is the add-on's
	 * to know, and its server half is what the order is finally held to.
	 */
	validate?: (
		field: RichField,
		value: string,
		i18n: CheckoutI18n
	) => string | null;
}

/**
 * The messages the server translates for us.
 *
 * Every one of them has a twin the server sends back on submit, so the shopper
 * is never told one thing while typing and another when they press the button.
 * Anything the bundle needs beyond these — the one-sided date and time bounds —
 * it translates itself through `@wordpress/i18n`.
 *
 * A payload printed by an older server carries only the first four; the rest
 * fall back to their English wording in `readBootstrap()`.
 */
export interface CheckoutI18n {
	required: string;
	invalidOption: string;
	/** `%d` is the character limit. */
	tooLong: string;
	/** `%1$s` is the lowest allowed value, `%2$s` the highest. */
	outOfRange: string;
	/** `%s` is the field's label. */
	invalidDate: string;
	/** `%s` is the field's label. */
	invalidTime: string;
	/** `%d` is a number of years. */
	tooYoung: string;
}

/**
 * How the checkout tells a required field from an optional one.
 *
 * `optional_label` is WooCommerce's own way round, and the default: an optional
 * field says "(optional)" and a required one says nothing. `asterisk` is the
 * other way round, and the fields we draw ourselves have to follow it or they
 * would be the only ones on the page still saying "(optional)".
 */
export type RequiredMarking = 'optional_label' | 'asterisk';

/**
 * Everything `window.cbwbCheckout` carries.
 */
export interface CheckoutBootstrap {
	/** Extension-data namespace the server reads the answers back out of. */
	namespace: string;
	fields: RichField[];
	/**
	 * Which way round this store marks required fields. Read from the payload
	 * rather than from the body class, so the label a field draws and the
	 * stylesheet that marks core's cannot disagree.
	 */
	requiredMarking: RequiredMarking;
	/** Answers already known for this shopper, keyed by field id. */
	prefill: Record< string, string >;
	i18n: CheckoutI18n;
	/**
	 * The site's date format, from Settings → General, as a PHP date format
	 * string. A date the bundle has to name in a message is written with it, so
	 * the sentence matches the one the server sends back on submit.
	 *
	 * Filled in from WordPress's own default by `readBootstrap()`, so a payload
	 * written by an older server is still readable rather than absent.
	 */
	dateFormat: string;
}

declare global {
	interface Window {
		cbwbCheckout?: unknown;
	}
}
