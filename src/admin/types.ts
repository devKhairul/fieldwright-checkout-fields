/**
 * Shared types for the admin app. These mirror the PHP field schema exactly —
 * see includes/Fields/FieldDefinition.php.
 */

/**
 * Every field type Free carries itself, in three families.
 *
 * `core` types are the ones WooCommerce's own Checkout Fields API understands,
 * so they can go in the three sections it owns and nowhere else. `rich` and
 * `content` types are rendered by this plugin, which is why they can be placed
 * anywhere and carry the settings core has no home for.
 */
export type CoreFieldType =
	| 'text'
	| 'email'
	| 'phone'
	| 'number'
	| 'url'
	| 'select'
	| 'checkbox';

export type RichFieldType =
	| 'textarea'
	| 'radio'
	| 'checkbox_group'
	| 'date'
	| 'time';

export type ContentFieldType = 'heading' | 'paragraph';

/** The types this plugin knows about by name. */
export type BuiltinFieldType = CoreFieldType | RichFieldType | ContentFieldType;

/**
 * A field's type, which is a built-in one or any key an add-on registered.
 *
 * The `string & {}` half keeps the built-in names as suggestions in an editor
 * while still accepting the key of a type Free has never heard of: a field
 * stored by an add-on that is switched off today keeps its own type string, and
 * the builder carries it untouched.
 */
export type FieldType = BuiltinFieldType | ( string & {} );

/**
 * Which half of the checkout renders a type.
 *
 * `unavailable` is a type nothing renders right now: the add-on that provided
 * it is not running, or has not registered it for the checkout. The builder
 * keeps such a field exactly as it is and shows it as something it cannot draw.
 */
export type FieldFamily = 'core' | 'rich' | 'content' | 'unavailable';

/**
 * Where a field sits at checkout. Stored on the field as `location`; the UI
 * calls it a placement, because it is no longer only WooCommerce's three
 * sections.
 */
export type FieldLocation =
	| 'contact'
	| 'address'
	| 'shipping_address'
	| 'billing_address'
	| 'order'
	| 'after_shipping'
	| 'after_payment'
	| 'before_place_order'
	| 'order_summary';

/** Contract alias — the stored key is `location`, the concept is a placement. */
export type FieldPlacement = FieldLocation;

/** How wide a field draws. Core-family fields are always full width. */
export type FieldWidth = 'full' | 'half';

/** How a radio or checkbox group stacks its options. */
export type OptionsLayout = 'stacked' | 'inline';

/** Heading level, in the merchant's terms: 2, 3 or 4. */
export type ContentLevel = 2 | 3 | 4;

/**
 * Where a field's answer shows up once the order exists.
 *
 * Core-family fields only honour `thank_you` — WooCommerce decides the rest for
 * the fields it owns — so the editor says so, and keeps that flag in step with
 * `show_in_order_confirmation`, which is the key the checkout has always read.
 */
export interface FieldVisibility {
	thank_you: boolean;
	emails: boolean;
	admin: boolean;
	account: boolean;
}

export interface FieldOption {
	value: string;
	label: string;
}

/**
 * What a conditional rule looks at.
 */
export type RuleSubject =
	| 'product'
	| 'category'
	| 'shipping_method'
	| 'prefers_collection'
	| 'payment_method'
	| 'shipping_country'
	| 'cart_total';

/**
 * One conditional-visibility rule. The operator and value shapes belong to the
 * subject; Free never interprets either, it only carries them.
 */
export interface ProRule {
	subject: RuleSubject;
	operator: string;
	value: unknown;
}

/** Contract alias — the pinned schema calls this shape `Rule`. */
export type Rule = ProRule;

/**
 * What one of a field's options costs.
 *
 * Only the types that carry options use these: a dropdown, radio buttons or a
 * checkbox group. An option without an entry is simply not charged for.
 */
export interface ProFeeOption {
	/** The option's own value, as `FieldOption.value` stores it. */
	value: string;
	/** Decimal string in major units, e.g. `8.00`. */
	amount: string;
}

export interface ProFee {
	enabled: boolean;
	/** Decimal string in major units, e.g. `5.00`. A checkbox only. */
	amount: string;
	taxable: boolean;
	/** Order-line label; empty falls back to the field label. */
	name: string;
	/** One entry per priced option, in the field's own option order. */
	options: ProFeeOption[];
}

export interface ProConditions {
	enabled: boolean;
	match: 'all' | 'any';
	rules: ProRule[];
}

/**
 * The Pro half of a field.
 *
 * Free stores and round-trips this untouched — it neither reads nor validates
 * it. Pro adds the editor sections and the validation rules through the
 * `cbwb.*` filters in `lib/hooks.ts`.
 */
export interface ProSettings {
	fee: ProFee;
	conditions: ProConditions;
}

/**
 * A single checkout field, in the exact shape the REST config uses.
 */
export interface Field {
	id: string;
	label: string;
	type: FieldType;
	location: FieldLocation;
	required: boolean;
	enabled: boolean;
	/** Dropdowns only: the first, unselected choice. '' for text and checkbox. */
	placeholder: string;
	options: FieldOption[];
	error_message: string;
	format: string;
	pattern: string;
	max_length: number | null;
	autocomplete: string;
	show_in_order_confirmation: boolean;

	/* ------------------------------------------------- Common to every type. */

	/** One line under the control, ≤300 characters. '' for none. */
	help: string;
	/**
	 * Prefilled answer, ≤1000 characters. A checkbox stores 'yes' or ''; a
	 * checkbox group stores its ticked values comma-separated.
	 */
	default_value: string;
	/** Rich and content types only; core types are always 'full'. */
	width: FieldWidth;
	visibility: FieldVisibility;
	/** Rich types in Contact or Address only. */
	save_to_profile: boolean;

	/* --------------------------------------------------------- Type-specific. */

	/** Radio and checkbox groups. */
	options_layout: OptionsLayout;
	/** Textarea height, 2–10. */
	rows: number;
	/** Number fields: decimal strings, '' for none. */
	min: string;
	max: string;
	/** Number step, or time step in minutes. Decimal string, '' for none. */
	step: string;
	/** Date range, `YYYY-MM-DD` or ''. */
	date_min: string;
	date_max: string;
	/** Time range, `HH:MM` or ''. */
	time_min: string;
	time_max: string;
	/** Heading level. */
	content_level: ContentLevel;
	/** Paragraph text. Limited HTML: a, strong, em, br. */
	content: string;

	/**
	 * Pro's settings for this field. Absent unless Pro has written them; Free
	 * preserves whatever is here and never strips it.
	 */
	pro?: ProSettings;
}

/**
 * A field in the shape the REST config speaks.
 *
 * Identical to `Field` but for the three numeric settings: the builder keeps
 * `min`, `max` and `step` as strings, because they are backed by boxes a
 * merchant can empty and retype mid-edit, and the API takes them as numbers
 * with null for "not set". `lib/fields.ts`'s `toPayload()` is the one place the
 * two shapes meet.
 */
export type FieldPayload = Omit< Field, 'min' | 'max' | 'step' > & {
	min: number | null;
	max: number | null;
	step: number | null;
};

/* ------------------------------ WooCommerce's own checkout fields. */

/**
 * The fields WooCommerce renders itself.
 *
 * Exactly the keys `CheckoutFields::get_core_fields()` returns: the email
 * address, which lives in Contact, and the ten address fields, which WooCommerce
 * draws in both the shipping and the billing form.
 */
export type CoreFieldKey =
	| 'email'
	| 'country'
	| 'first_name'
	| 'last_name'
	| 'company'
	| 'address_1'
	| 'address_2'
	| 'city'
	| 'state'
	| 'postcode'
	| 'phone';

/**
 * The two things that are not fields but read like rows in the same outline:
 * the "Add a note to your order" box, and the checkout's coupon form.
 */
export type CorePseudoKey = 'order_note' | 'coupon_form';

/** Where one of WooCommerce's own fields sits. */
export type CoreFieldLocation = 'contact' | 'address';

/**
 * What WooCommerce will not let a merchant change about one of its own fields.
 *
 * Every lock is a real limit rather than a policy of ours: the Store API throws
 * without an email address, WooCommerce re-forces `country` in every locale, and
 * `address_2` is drawn inside `address_1`, so it cannot be moved away from it.
 */
export interface CoreFieldLocks {
	hidden: boolean;
	required: boolean;
	label: boolean;
	order: boolean;
}

/**
 * One of WooCommerce's own fields, as the server describes it.
 *
 * `label` is WooCommerce's own block label, untouched; `resolvedLabel`,
 * `required`, `hidden` and `index` are the *effective* values — what the store's
 * base country actually shows today, with our overrides already applied.
 */
export interface CoreFieldMeta {
	key: CoreFieldKey;
	location: CoreFieldLocation;
	/** WooCommerce's own block label, before any override of ours. */
	label: string;
	/** The label after our override and the base country's own locale. */
	resolvedLabel: string;
	required: boolean;
	hidden: boolean;
	locks: CoreFieldLocks;
	index: number;
	/**
	 * Where `hidden` and `required` are stored: WooCommerce's own
	 * `woocommerce_checkout_*_field` option, or our config.
	 */
	source: 'option' | 'field';
}

export interface CorePseudoMeta {
	hidden: boolean;
}

/**
 * What a merchant changed about one of WooCommerce's own fields. Only the
 * properties that differ from WooCommerce's own value are stored.
 */
/**
 * An add-on's settings on one of WooCommerce's own rows.
 *
 * Opaque, exactly as `Field.pro` is: Free carries it through the editor, the
 * save and the export without reading a key of it. It is deliberately not
 * `ProSettings` — a core row has no fee and no conditions, and what an add-on
 * does keep here (a default value, say) is its own business.
 */
export type CoreProSettings = Record< string, unknown >;

export interface CoreFieldOverride {
	label?: string;
	required?: boolean;
	hidden?: boolean;
	/**
	 * An add-on's settings for this row. Absent unless one has written them;
	 * Free preserves whatever is here and never strips it.
	 */
	pro?: CoreProSettings | null;
}

/**
 * The `core` half of the stored config.
 *
 * `order.address` mixes core keys and custom field ids — WooCommerce's address
 * form is one sorted list, and a merchant's own address fields sit in it — so
 * this is the only place the two orders can be written down together.
 */
export interface CoreConfig {
	fields: Record< string, CoreFieldOverride >;
	order: { address: string[] };
	order_note: { hidden: boolean };
	coupon_form: { hidden: boolean };
}

export interface Config {
	schema_version: number;
	fields: Field[];
	/**
	 * Absent on a config written before core fields existed, which is why every
	 * reader goes through `lib/coreFields.ts`'s `normalizeCore()`.
	 */
	core?: CoreConfig;
	/**
	 * Stamp of the configuration this response describes, sent back with the
	 * next save so the server can tell that nobody else has saved in between.
	 *
	 * Absent on a server that predates it, which is why the save falls back to
	 * sending what the bootstrap carried.
	 */
	revision?: string;
}

/**
 * How the checkout tells a required field from an optional one.
 *
 * `optional_label` is WooCommerce's own way round, and the default: an optional
 * field says "(optional)" and a required one says nothing. `asterisk` is the
 * other way round: an optional field says nothing and a required one carries a
 * red asterisk after its label.
 */
export type RequiredMarking = 'optional_label' | 'asterisk';

export interface Settings {
	remove_data_on_uninstall: boolean;
	/**
	 * Read defensively: every reader falls back to WooCommerce's own way round
	 * rather than marking nothing at all.
	 */
	required_marking?: RequiredMarking;
	/** Whether the checkout carries the line that explains the asterisk. */
	required_note?: boolean;
}

export interface LocationMeta {
	key: FieldLocation;
	label: string;
	description: string;
	/**
	 * Where an answer given here ends up, as its own sentence: "Saved to the
	 * customer's account."
	 *
	 * Separate from the description because it is only true of the types that
	 * collect an answer — a heading in the Contact section is saved nowhere —
	 * so the editor appends it for those and leaves it off for the rest. Absent
	 * on the placements that are a position on the page rather than a home for
	 * a value, and on a bootstrap written before the two were split apart.
	 */
	storage?: string;
}

/** Bootstrap shape for one placement. Same shape as a location. */
export type PlacementMeta = LocationMeta;

export interface TypeMeta {
	key: FieldType;
	label: string;
	description: string;
	/**
	 * Which family the type belongs to, and where it may be placed. Absent on a
	 * bootstrap written before the type expansion, so `lib/typeMeta.ts` fills
	 * both in from its own table.
	 */
	family?: FieldFamily;
	placements?: FieldLocation[];
	/**
	 * Whether the checkout can render this type at all today.
	 *
	 * False for a type an add-on registered without checkout support, which is a
	 * type the builder keeps editable and never offers. Absent on a bootstrap
	 * written before the registry, where every entry the server lists is one of
	 * Free's own and therefore available.
	 */
	available?: boolean;
}

export interface FormatPreset {
	label: string;
	pattern: string | null;
	message: string;
}

/* ------------------------------------------- Block checkout compatibility. */

/**
 * How a plugin answered WooCommerce's `cart_checkout_blocks` question.
 *
 * `uncertain` is a WooCommerce-aware plugin that declared nothing either way;
 * `unknown` is a plugin with no WooCommerce integration at all, which is in the
 * report so the counts add up to something a merchant recognises.
 */
export type CompatibilityBucket =
	| 'compatible'
	| 'incompatible'
	| 'uncertain'
	| 'unknown';

/** Which checkout the store's checkout page renders today. */
export type CheckoutType = 'block' | 'classic' | 'unknown';

/**
 * One scanned plugin, exactly as `Compatibility\Scanner` describes it.
 */
export interface CompatibilityPlugin {
	/**
	 * Plugin file relative to the plugins directory, e.g. `woo-x/woo-x.php`.
	 * Empty for a user who cannot activate plugins — WordPress keeps the plugin
	 * inventory behind that capability, and so does the scan.
	 */
	file: string;
	name: string;
	/** Installed version. Empty for a user who cannot activate plugins. */
	version: string;
	author: string;
	/** The plugin's own page, when its header names a usable one. */
	plugin_uri: string;
	is_woocommerce: boolean;
}

/**
 * The migration assistant's answer to "can this store switch safely?".
 */
export interface CompatibilityReport {
	checkout_type: CheckoutType;
	checkout_page_id: number;
	checkout_page_url: string;
	plugins: Record< CompatibilityBucket, CompatibilityPlugin[] >;
	summary: Record< CompatibilityBucket, number >;
	/** What each bucket means, already written for the merchant. */
	notes: Record< CompatibilityBucket, string >;
}

/**
 * The throwaway page a merchant tries the block checkout on.
 */
export interface CompatibilityDraftPage {
	id: number;
	edit_url: string;
	preview_url: string;
}

/**
 * One validation failure. `path` is a JSON-ish pointer such as
 * `fields[2].label`, matching what the REST controller returns.
 */
export interface ValidationError {
	path: string;
	code: string;
	message: string;
}

/**
 * The error object `@wordpress/api-fetch` rejects with.
 */
export interface ApiError {
	code?: string;
	message?: string;
	data?: {
		status?: number;
		errors?: ValidationError[];
	};
}

/**
 * Data injected by Admin\Page::enqueue() before the script runs.
 */
export interface AdminBootstrap {
	version: string;
	restRoute: string;
	settingsRoute: string;
	/**
	 * The migration assistant's route. Scanned on demand: the Compatibility tab
	 * calls this, and `<compatibilityRoute>/draft-page`, only once opened.
	 */
	compatibilityRoute: string;
	/**
	 * Where the one line about the paid add-on is closed for good. A POST, and
	 * the only thing the builder writes that is not about the checkout.
	 */
	proLineRoute: string;
	/**
	 * Whether this user has already closed that line. Carried here rather than
	 * fetched, so the line never paints and then takes itself away again.
	 */
	proLineDismissed: boolean;
	config: Config;
	settings: Settings;
	idPrefix: string;
	locations: LocationMeta[];
	/**
	 * Every placement a field can be given, in checkout order. Absent on a
	 * bootstrap written before the type expansion, in which case `locations`
	 * (WooCommerce's own three sections) is all the server knows about and
	 * `lib/typeMeta.ts` supplies the rest.
	 */
	placements?: PlacementMeta[];
	/**
	 * Every type the builder may offer: Free's own, and each one an add-on
	 * registered, whether or not the checkout can render it today.
	 */
	types: TypeMeta[];
	formatPresets: Record< string, FormatPreset >;
	autocompleteTokens: string[];
	templates: Field[];
	checkoutUrl: string;
	/**
	 * Which checkout that page renders today, read from its stored content when
	 * the builder loaded. Absent on a bootstrap written before the check
	 * existed, and an absent answer says nothing rather than warning: a notice
	 * about the wrong checkout is only worth drawing when the server is sure.
	 */
	checkoutType?: CheckoutType;
	/**
	 * The site's date format, from Settings → General, as a PHP date format
	 * string. Anything the builder writes a date into writes it the way the
	 * rest of the site does, rather than as the `YYYY-MM-DD` a picker hands
	 * back. Read it defensively.
	 */
	dateFormat?: string;
	/**
	 * The site's time format, likewise, for a clock time the builder writes
	 * out — a delivery slot's window in the preview. Read it defensively.
	 */
	timeFormat?: string;
	maxFields: number;
	/**
	 * Prefilled on new dropdowns. `placeholder` is select-only — it is the first,
	 * unselected choice — so every dropdown starts with one rather than falling
	 * back to core's own "Select a <label>".
	 */
	selectPlaceholderDefault: string;
	/**
	 * Problems that happened out on the checkout, where the merchant could not
	 * see them — today, a format pattern that failed while matching a real
	 * value. Shown as a notice above the builder. Absent on a bootstrap written
	 * by an older version, so read it defensively.
	 */
	warnings?: string[];

	/* ---------------------------- WooCommerce's own checkout fields.
	 *
	 * Every key below arrived with core fields and is absent on a bootstrap
	 * written before them. Nothing reads one directly: `lib/coreFields.ts`
	 * resolves the lot, and a builder that finds none simply has no core rows
	 * to show.
	 */

	/** WooCommerce's own fields, in its own default order. */
	coreFields?: CoreFieldMeta[];
	corePseudo?: Record< CorePseudoKey, CorePseudoMeta >;
	/** The store's base country, e.g. `US`. */
	baseCountry?: string;
	/** The base country's name, for the sentence that explains a locale label. */
	baseCountryLabel?: string;
	/**
	 * The labels WooCommerce's *own* locale gives the base country — `postcode`
	 * → "ZIP Code" in the US — so the builder can explain why a field the
	 * merchant has not touched is not called what WooCommerce's table calls it.
	 */
	baseCountryLabelOverrides?: Record< string, string >;
	/**
	 * The fields some payment gateways and shipping providers still expect,
	 * whatever the checkout asks for. Making one of these optional earns a
	 * warning rather than a lock.
	 */
	gatewayWarningKeys?: string[];
	/** WooCommerce's own "Shipping destination" setting. */
	shipToDestination?: 'billing' | 'shipping' | 'billing_only';
	/** Where that setting is changed, which is WooCommerce's screen, not ours. */
	wcShippingSettingsUrl?: string;
}

/**
 * The surface Free publishes on `window.cbwb` for add-on bundles.
 *
 * Type-only imports: this is a description of what `admin.tsx` assigns, so it
 * must not pull either module into every file that imports the types.
 */
export interface CbwbGlobal {
	/**
	 * The checkout bundle's own surface. Present on the storefront rather than
	 * here: the two bundles never load on the same page, so each fills in its
	 * own half of this object and reads only that half.
	 */
	checkout?: import('../checkout/types').CheckoutFieldApi;
	hooks: {
		addFilter: typeof import('@wordpress/hooks').addFilter;
		removeFilter: typeof import('@wordpress/hooks').removeFilter;
	};
	components: {
		SegmentedControl: typeof import('./components/SegmentedControl').default;
	};
	version: string;
}

declare global {
	interface Window {
		cbwbAdmin?: AdminBootstrap;
		cbwb?: CbwbGlobal;
	}
}

/**
 * The bootstrap data, or a clear failure.
 *
 * Every key a newer PHP half added is optional on the type above, so a builder
 * running against an older one reads them as `undefined` and falls back rather
 * than crashing — core fields included, which simply means there are no core
 * rows to show.
 *
 * @return Bootstrap data.
 * @throws {Error} When the page did not inject any.
 */
export function getBootstrap(): AdminBootstrap {
	if ( ! window.cbwbAdmin ) {
		throw new Error( 'cbwbAdmin bootstrap data is missing.' );
	}
	return window.cbwbAdmin;
}

/**
 * Which way round a set of settings marks required fields.
 *
 * Anything that is not the asterisk reads as WooCommerce's own way round: the
 * key is absent on a bootstrap written before the setting existed, and a
 * checkout that marks nothing at all is not one of the two answers.
 *
 * @param settings Stored settings.
 * @return The marking to draw.
 */
export function markingOf( settings: Settings | undefined ): RequiredMarking {
	return 'asterisk' === settings?.required_marking
		? 'asterisk'
		: 'optional_label';
}
