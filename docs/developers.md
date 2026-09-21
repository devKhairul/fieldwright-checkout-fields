# Developer reference

Fieldwright is built to be extended. Everything on
this page is a public contract, available since 1.0.0: an extension point added
later is marked with the version it arrived in, and a documented name and shape
is not changed without a major version and a changelog entry saying so.

- [PHP actions](#php-actions)
- [PHP filters](#php-filters)
- [Field types](#field-types)
- [JavaScript](#javascript)
- [REST](#rest)
- [Loading a checkout bundle](#loading-a-checkout-bundle)
- [Source code](#source-code)

## PHP actions

### `cbwb_loaded`

Fires once the plugin is running and its hooks are attached, with the running
`CheckoutBuilder\Plugin`. Boot your add-on from here rather than from
`plugins_loaded`: reaching this point already means a supported WooCommerce is
active and every extension point below exists.

### `cbwb_register_strings`

Fires while the merchant's own words are handed to WPML and Polylang, with the
running `CheckoutBuilder\I18n\Strings`. Register what the merchant typed into
your own settings with `Strings::register_string()`, and translate on read with
`Strings::translate()`.

### `cbwb_rich_value_erased`

`do_action( 'cbwb_rich_value_erased', FieldDefinition $field, string $value, WC_Order|int $context )`

Fires after one stored value has been erased: `$context` is the `WC_Order` it was
on, or the user id it was remembered against. It runs once per value, only for a
value that was not already empty, and only for a field the builder still holds,
because a key whose field the merchant has deleted has no definition to hand
over. The meta is removed either way.

Use it to release whatever else was being held because of that value. A value of
a type you registered may name something you keep elsewhere, and this is the only
notice you get that the answer has gone.

## PHP filters

### `cbwb_field_parse_pro`

Filters the add-on payload a field carries under its `pro` key, with the raw
field, the error path prefix, a shared `ValidationErrors` collector and the field
data parsed so far. Fieldwright never interprets that payload: it checks
only that it is an array small enough to store. Validate and normalize it, record
problems on the collector so they appear inline in the editor, and return the
cleaned array or `null`.

### `cbwb_core_parse_pro`

The same contract for one of WooCommerce's own field rows, with the core field
key in place of the raw field. What you return is stored under `core.<key>.pro`
and handed back in the admin bootstrap.

### `cbwb_register_field_args`

Filters the argument array handed to
`woocommerce_register_additional_checkout_field()` for one field, with the
`FieldDefinition` and its zero based position. This is the last chance to touch a
registration, so it is where you add options WooCommerce supports but Checkout
Builder does not expose. Return anything but an array and the registration is
left untouched.

### `cbwb_field_checkout_label`

Filters the label a field is registered with on the checkout. Only the checkout
facing copy changes: the order confirmation, the emails and the admin order
screen keep the label the merchant typed. Use it to append something the merchant
did not type, such as a fee amount.

### `cbwb_admin_bootstrap_data`

Filters the data the admin app receives before its first render, inlined as
`window.cbwbAdmin`, so everything you add has to survive `wp_json_encode()`.

### `cbwb_checkout_bootstrap_data`

Filters the data the checkout bundle receives before its first render, inlined as
`window.cbwbCheckout`. It is public, so never add anything the shopper should not
read.

### `cbwb_core_locale_overrides`

Filters WooCommerce's per country address rules after Fieldwright has fanned
the merchant's global changes into them, with the running
`CheckoutBuilder\Fields\CoreFields`. Everything global has already been written,
so anything you set here wins. Two guards are applied first: a country whose
entry hides a field is left alone, and a country's own `required` is never
lowered.

### `cbwb_rich_field_state`

Filters `array{hidden: bool, required: bool}` for one of the field types Checkout
Builder draws itself, with the `FieldDefinition` and the checkout
`WP_REST_Request`. It runs before the required check and before anything is
stored: a hidden field is not validated, is not stored, and has any value an
earlier attempt left on the order removed. `required` is seeded from the field's
own setting and can be raised or lowered the same way, which is how a field the
merchant left optional is made compulsory for one order. Settle `hidden` first: a
field that is not on the shopper's screen must never be one their order is
refused for.

The filter runs on every `POST /wc/store/v1/checkout`, including one that carried
no `extensions.cbwb` block at all, because that is a form with every one of these
fields left blank rather than a request to skip them.

### `cbwb_validate_rich_value`

Filters `WP_Error|null` for one posted value, with the value, the
`FieldDefinition` and the request. It runs only after the field's own rules have
passed, so you see a value that is already well formed. Return a `WP_Error` and
the checkout is rejected with that message, attributed to the field.

### `cbwb_time_choices`

`apply_filters( 'cbwb_time_choices', array $choices, FieldDefinition $field, ?WC_Order $order )`

Filters the times a time field may be set to. Answer with a list of
`array( 'value' => 'HH:MM', 'label' => '…' )` entries and the list stands in
for the field's earliest and latest time: the checkout refuses a time that is
not on it, and the editable panel on the admin order screen draws a dropdown of
the choices, labelled as you labelled them, in place of a clock. An empty array,
the default, is a field that takes any time between its bounds. `$order` is the
order being read on the admin screen and `null` at checkout, where there is no
order yet. Entries whose `value` is not an `HH:MM` time are dropped.

This is how Fieldwright Pro's delivery slots work: the stored value is a
slot's start, and the slots are the only times the field takes.

### `cbwb_rich_display_value`

`apply_filters( 'cbwb_rich_display_value', string $display, string $value, FieldDefinition $field )`

Filters what one stored value reads as, whatever type it belongs to. It is the
last thing `RichValues::display_value()` does, so `$display` has already been
through the type's own rendering: an option value has become its label, a
checkbox group has become a readable list, and a registered type's value has been
through its own `display` callback. The stored value is passed alongside, because
by that point `$display` is not always the string that was stored. Return a
string, or anything else and the unfiltered display stands.

Use it where an add-on knows more about a value than the field definition does.
A delivery slot is stored as its start time, and the add-on that owns the slots
is what turns `13:00` back into "Afternoon (1:00 pm to 5:00 pm)".

Every surface that prints an answer goes through `display_value()`, so answering
once covers the order confirmation page, the order emails, the customer's order
history, the personal data export, and an add-on's own readers such as an orders
list column, a CSV export or a PDF invoice. The exception is the editable panel
on the admin order screen, which draws each answer in an input of its own type
and shows the stored value rather than the display.

## Field types

### `CheckoutBuilder\Fields\TypeRegistry`

A field type an add-on owns end to end. Fieldwright draws it with its own
checkout block and stores its answers under its own meta key, so a registered
type is always in the `rich` family; it cannot take one of Fieldwright's own
type names, and it cannot register a core-backed or content type.

```php
TypeRegistry::register( string $key, array $spec ): void  // InvalidArgumentException on a bad key or spec
TypeRegistry::has( string $key ): bool
TypeRegistry::spec( string $key ): ?array                 // the spec with every default filled in
TypeRegistry::all(): array                                // key => spec, in registration order
```

Register on `cbwb_loaded`. A key is up to 32 characters matching
`^[a-z][a-z0-9_]*$`. Registering after `rest_api_init`, or after anything has
read the configuration, is unsupported: the builder's catalogue, the REST schema
and every parsed field are built from what the register held at the time.

Every callback takes the `FieldDefinition` first.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `label` | string | required | The name the builder's type picker lists it under; translate it yourself |
| `description` | string | `''` | The sentence under that name |
| `checkout` | bool | `true` | Whether the type reaches the checkout at all. `false` makes every field of it unavailable (below) while keeping it in the builder with its settings |
| `sanitize` | `callable( $field, string $raw ): string` | `sanitize_text_field` cut to the field's length cap | Coerce a submission into the stored form; never errors |
| `validate` | `callable( $field, string $raw ): ?string` | the same length check | Called only for a value that is there; return the customer-facing message, or null. Emptiness is Fieldwright's to answer, before this |
| `display` | `callable( $field, string $value ): string` | the value itself | The human form of a stored value. `cbwb_rich_display_value` still runs after it |
| `public` | `callable( $field ): array` | `[]` | Extra keys merged into the field's checkout payload entry. It is public: never put anything secret in it |
| `order_editor` | `'readonly'` or `callable( $field, string $value, WC_Order $order ): void` | `'readonly'` | The admin order screen. `'readonly'` prints `display()` as text; a callable draws its own markup (a name and a download link, say) |
| `editable` | bool | `false` | Whether the order screen takes a value back for the type. Only with a callable `order_editor` that draws a control under `AdminMetaBox::INPUT_NAME[<storage key>]`; the posted scalar comes back through `sanitize`. Off, nothing posted under the field's name is stored, whatever was drawn |
| `default_value` | bool | `false` | Whether the field carries a value the merchant sets it to start out with |
| `save_to_profile` | bool | `false` | Whether "remember for next time" is offered |
| `placements` | string[] | every placement | Where a field of the type may be placed |

The type's own settings belong under the field's `pro` payload, keyed by the type
(`pro.<key>`), validated in your `cbwb_field_parse_pro` handler. Fieldwright
stores, exports, duplicates and round-trips that payload verbatim and never reads
it, so a type needs no schema work here. The checkout payload strips `pro`, which
is what `public` is for.

### Types nothing answers for

A field whose type is neither one of Fieldwright's own nor registered right
now, because the add-on that provided it is deactivated, is **unavailable**. Its
family is `unavailable`, `FieldDefinition::is_available()` is false, and
`is_core_backed()`, `is_rich()` and `is_content()` are all false, so every
render, registration, validation, prefill, privacy and email path skips it
without further arrangement.

A type registered with `checkout` false is the gentler case: the add-on is
running but has said it cannot take new answers for now. Its fields stay
`rich`, so the answers already on orders go on being shown on the order screen,
in emails and on the thank-you page through the type's `display` and
`order_editor` callbacks, but `is_available()` is false and the checkout
payload, the Store API endpoint and WooCommerce's field registry leave the field
out. `FieldDefinition::types()` lists only available types;
`FieldDefinition::known_types()` lists every registered one.

Nothing is deleted and nothing is rewritten. The field stays in the
configuration with its `pro` payload untouched, and the merchant can still
rename it, move it, switch it off, make it required, write a hint, change where
its answer is shown and delete it; a save carrying it is accepted like any
other. Everything the type itself would own keeps the value it was stored with
and comes back the moment the add-on is running again. Answers already on orders
stay where they are.

`FieldDefinition::types()` is the types a field can be rendered as today;
`known_types()` adds the registered types that cannot reach the checkout, which
is what the builder's catalogue is built from. Every entry in
`window.cbwbAdmin.types` carries `available` to say which it is.

## JavaScript

### `window.cbwb.checkout`

Published by the checkout bundle.

- `setFieldState( fieldId, { hidden?, required?, options?, note? } )` merges a
  state into what is already said about a field, so two add-ons minding different
  things do not overwrite each other.
- `getFieldState( fieldId )` reads it back.
- `subscribe( callback )` returns an unsubscribe function.

A hidden field is not rendered and is skipped by validation. The server decides
again through `cbwb_rich_field_state`.

`required` is the same idea put to the next question along. `true` makes a field
the merchant left optional compulsory for this shopper, `false` relaxes one they
made required, and leaving the key out keeps whatever they set. The label loses
or gains its "(optional)", the control's own `required` follows and validation
asks for an answer, so the three never disagree. A hidden field is never
required, whatever is written here, because the shopper is not being asked at
all. The server settles the same two keys, in the same order, through
`cbwb_rich_field_state`. Fieldwright Pro writes `required` from a field's
"required when" rules (see "Rules an add-on publishes").

The merge rule is the same for every key: a key the patch names replaces what is
stored, whatever it names it as, and a key it leaves out keeps what is there. So
`{ options: undefined }` takes a list away and `{}` leaves everything alone.
Nothing here is trusted: `options` that is not an array and a `note` that is not
a string are read as none at all, and an identical state does not notify
subscribers.

#### `options` and `note`

```ts
interface FieldOption {
  value: string;
  label: string;
  disabled?: boolean;  // on the list, but not pickable
}

interface FieldState {
  hidden: boolean;
  required?: boolean;
  options?: FieldOption[];
  note?: string;
}
```

`options` is for the fields whose answers an add-on draws up rather than the
merchant. A `time` field whose state carries a list is drawn as a dropdown of
those times instead of a clock, with a first "Choose a time" entry, and the value
written is the option's `value`, which is the checkout's own `HH:MM`, so nothing
about storage, export or privacy changes. An entry marked `disabled` is drawn as
"<label> (full)" and cannot be picked; it is drawn rather than dropped because a
shopper is better served by seeing that a time exists and is taken. An empty
array is not the same as no list at all: it says the add-on has a list and
nothing is on it yet, and the control is drawn disabled.

Validation follows the list. While a time field carries `options`, a non-empty
answer has to be one of the entries that are not `disabled`, or the field's own
error message is shown, or "Choose one of the available times." when the merchant
set none. The merchant's earliest and latest times are not applied, because they
describe the free answer the field has stopped asking for. Required is unchanged.
Clearing an answer the shopper can no longer give is the add-on's job. The
control falls back to its placeholder on its own, but the value is still in the
checkout store, and only whatever put it there can take it back.

`note` is one line drawn under the control, and it stands in for the merchant's
help text while it is set: a field that cannot be answered yet has more to say
about why than the sentence written for the ordinary case. It is read only on a
field that also carries `options`.

### Builder filters

The builder's filters run through `@wordpress/hooks`:

- `cbwb.editorSections`: extra sections in the field editor.
- `cbwb.validateField`
- `cbwb.rowIndicators`: a status beside a field in the outline.
- `cbwb.previewFieldLabel`
- `cbwb.fieldDefaults`
- `cbwb.typeChange`
- `cbwb.settingsSections` takes `{ key, title, description?, render }`
  and renders after Fieldwright's own Settings panels.
- `cbwb.tabs` takes `{ key, label, render }` and adds a tab after
  Fieldwright's own.

Both of the last two are handed the bootstrap, and both hand it back to `render`
as `{ bootstrap }`. A tab owns the whole panel under the tab strip, which is the
difference between the two: use `cbwb.settingsSections` for a settings panel and
`cbwb.tabs` for a screen that is not settings. A tab key becomes part of an
element id, so it is limited to letters, numbers, hyphens and underscores; an
entry that is malformed, that repeats a key or that takes one of the builder's
own (`fields`, `compatibility`, `settings`, `pro`) is dropped rather than
rendered.

`pro` is reserved since 1.2.0. Fieldwright puts its own Pro tab there whenever
no tab has been registered under `cbwb-pro-license`, which is the key Fieldwright
Pro's License tab uses, and the key is reserved whether or not that tab is being
drawn: a key that means one thing on one store and another on the next is a key
nobody can write against. Registering `cbwb-pro-license` is therefore also how an
add-on says the builder's own Pro tab, the line above the field list and the
sentences at the foot of a field's settings are not wanted, because the screens
they point at are the add-on's own.

### The preview's Live mode

The checkout preview has two modes. Edit is a picture: a click selects the
field. Live is a working copy: the controls answer, and two filters let an
add-on say what the form should look like given what the merchant has typed
and ticked. Both are handed a `PreviewContext`:

```ts
interface PreviewContext {
  mode: 'edit' | 'try';               // the builder labels the second one "Live"; the value stays 'try'
  fields: Field[];
  values: Record< string, string >;      // by field id, in the checkout's storage shapes
  coreValues: Record< string, string >;  // by WooCommerce key: country, state, postcode, city, company, ...
  sameAddress: boolean;                  // the "Use same address for billing" box
  customer: { loggedIn: boolean; roles: string[] };
  hidden: ReadonlySet< string >;         // field ids other filters have hidden, filled in before the summary runs
}
```

Values use the checkout's own shapes: a checkbox is `yes` or empty, a checkbox
group is a comma separated list, a date is `YYYY-MM-DD`, a time is `HH:MM`. A
registered type's preview value is whatever its own preview control writes, which
need not be what the checkout would store.

- `cbwb.previewFieldState` receives
  `{ hidden: boolean, note?: string, options?: { value, label, disabled? }[] }`,
  the field and the context, and returns the same shape. A hidden field is not
  drawn in Live mode. `note` is one short sentence drawn as a tag beside the field,
  for what a preview cannot know ("Also depends on the cart."). Anything that is
  not an object is ignored, and a note that is not a string is dropped.
  `options` is the checkout's own list of choices for a field whose
  answers an add-on draws up: a time field offering delivery slots is a dropdown
  of them in the preview as it is on the checkout, inert in Edit mode and writing
  the option's value in Live mode. An entry without a string `value` and a
  non-empty string `label` is dropped rather than drawn as an empty row, and a
  value that is not an array is read as no list at all. On a dropdown, radio
  buttons or a checkbox group the merchant's own options are the list, and an
  entry only renames one of them: an entry for a value the field does not have is
  ignored, a value the filter said nothing about keeps the merchant's own label,
  and `disabled` draws a choice that cannot be picked.

  `required` says whether the field has to be answered, for an add-on
  that makes an optional field compulsory in some situations. `true` draws the
  required mark and takes the "(optional)" off the label, `false` does the
  opposite, and anything that is not a boolean leaves the merchant's own Required
  switch to decide. Live mode then asks for the answer before it will take the
  form, the way the checkout does.
- `cbwb.previewSummaryLines` receives an array of
  `{ key: string, label: string, amount: number }` and the context, and returns
  the rows to draw between the subtotal and the total, in the store's currency
  and major units. A row without a label, with an amount that is not a finite
  number, or with a key already used is dropped.

Fieldwright Pro answers both: conditions that read another field, the
billing address or the signed in state are evaluated with the code the checkout
bundle runs, and a ticked fee checkbox adds its row, as does each priced option
the shopper chooses on a dropdown, radio buttons or a checkbox group. Rules the
preview cannot answer without a cart are taken as matched and the field is
tagged.

### Date rules

A field in the checkout payload (`window.cbwbCheckout.fields[i]`) may carry
`dateRules: { minDate?, maxDate?, disabledWeekdays?, blackoutDates? }`, added
through `cbwb_checkout_bootstrap_data`. Dates are `YYYY-MM-DD` in the store's
timezone; weekdays are 0 for Sunday through 6 for Saturday. Fieldwright
enforces the rules in the browser and does not compute them, and they narrow the
merchant's own earliest and latest rather than replacing them. A rule the browser
has no vocabulary for arrives as a date it does: Fieldwright Pro's minimum
age on a date of birth is sent as the `maxDate` it works out to, and is checked
again on the server with a sentence of its own. A date refused by
one of those rules gets a message naming the reason, and where that message has a
date in it the date is written with `window.cbwbCheckout.dateFormat`. An add-on
enforcing the same rules on the server should say the same sentence, formatted
with `wp_date()` and the same option.

### Time slots

A `time` field in the checkout payload may carry
`slotRules: { dateField: string, route: string }`, added through
`cbwb_checkout_bootstrap_data` by an add-on that owns the slots. Fieldwright
Pro adds it. `dateField` is the id of the date field in the same configuration
the slots hang off, and `route` is where to ask which of them are open, from
`rest_url()`, so on a store with plain permalinks it is itself a query string and
the separator has to be worked out rather than assumed. Nothing about the
slots, and no count of what is booked, is in the payload: which windows exist on
a day depends on the day and on the orders already placed, so it is asked for
rather than published.

Fieldwright Pro answers on `GET /cbwb-pro/v1/slots?field=<field id>&date=<YYYY-MM-DD>`:

```json
{
  "date": "2026-09-11",
  "slots": [
    { "start": "09:00", "end": "12:00", "label": "Morning (9:00 am to 12:00 pm)", "available": true },
    { "start": "13:00", "end": "17:00", "label": "Afternoon (1:00 pm to 5:00 pm)", "available": false }
  ]
}
```

The route is public, because a guest choosing a delivery day has to be told. What
it gives away is whether a slot is open, never how many orders it holds and
nothing about anyone's order. A field it does not know, or one whose slots are
switched off, is a `400`, as is a date that is not `YYYY-MM-DD`. The answer
carries `Cache-Control: no-store`.

Pro's own checkout bundle turns each entry into a `FieldOption` on the field's
state (`value` from `start`, `label` as it comes, and `disabled` for anything
that is not `available`), and Free draws it as the dropdown above. The pick is
checked again on the server when the order is placed, through
`cbwb_validate_rich_value`, so nothing about the list is trusted.

### Rules an add-on publishes

`cbwb_field_parse_pro` lets an add-on keep its own settings inside a field, and
Fieldwright never reads them. Fieldwright Pro's are written out here
because they sit in the configuration this plugin stores and in the bootstrap it
publishes, so anything that reads either meets them.

Stored, under a field's `pro` key:

```json
{
  "conditions":    { "enabled": true, "match": "all", "rules": [] },
  "required_when": { "enabled": true, "match": "all", "rules": [] },
  "date_rules":    { "min_age_years": 18 }
}
```

`required_when` mirrors `conditions` exactly: the same `enabled`, the same
`match` of `all` or `any`, and rules written from the same subjects and
operators. What differs is the question. `conditions` decides whether the field
is on the page at all; `required_when` decides whether the answer is compulsory,
on a field whose own `required` is false. It is refused on a checkbox, a heading
and a paragraph, and on a field the merchant has already made required.

`date_rules.min_age_years` is a whole number of years, 0 to 150, with 0 for none.
It is a date of birth rule: the field's latest date becomes the earlier of the
merchant's own latest and today minus that many years, counted on the calendar in
the store's timezone. See "Date rules" for what the browser is handed.

Published, on `window.cbwbCheckout.pro`:

```ts
interface ResolvedRuleSet {
  match: 'all' | 'any';
  rules: object[];
}

interface ProCheckoutRules {
  rules: Record< string, ResolvedRuleSet >;         // by field id: is it drawn
  requiredWhen: Record< string, ResolvedRuleSet >;  // by field id: must it be answered
  customer: { id: number; roles: string[] };
}
```

Both maps carry resolved rules, with categories already expanded to product ids
and source keys already located, and both are keyed by field id. `requiredWhen`
is shaped exactly like `rules`, and a field can be in one map without being in
the other. Pro's checkout bundle evaluates both against WooCommerce's own data
stores and writes the answer through
`window.cbwb.checkout.setFieldState( id, { hidden, required } )`, so the shopper
is asked what the server will decide. A key the bootstrap does not carry reads as
no rules rather than as a reason to stop, which is what a page served by an older
release looks like. Anything published here is readable by anyone who reaches the
checkout, the same caveat WooCommerce's own compiled field rules carry.

### Date format

`window.cbwbAdmin.dateFormat` and `window.cbwbCheckout.dateFormat` carry the
site's date format, from Settings, General, as a PHP date format string. Anything
that writes a stored `YYYY-MM-DD` onto a screen should write it with that rather
than printing the stored value.

## REST

`GET /cbwb/v1/config` returns the stored configuration with a `revision` stamp.
`PUT /cbwb/v1/config` requires that stamp back and answers `409` if the stored
configuration has moved on, so two open builders cannot overwrite each other; it
reports every validation problem at once, with a path per field. `GET` and
`PATCH /cbwb/v1/settings` carry the uninstall preference.
`GET /cbwb/v1/compatibility` is the migration assistant's report. They all need
`manage_woocommerce`, as does `POST /cbwb/v1/compatibility/draft-page`, which
creates the draft preview page and also asks for `edit_pages`.

`POST /cbwb/v1/pro-line`, since 1.2.0, takes a `dismissed` boolean and records
whether the line about the paid add-on stays hidden for the user who sent it. It
is user meta (`cbwb_pro_line_dismissed`) rather than a setting, so two merchants
sharing a store each decide for themselves, and it needs `manage_woocommerce`
like the rest. The current answer travels in the bootstrap as
`window.cbwbAdmin.proLineDismissed`, with the route as `proLineRoute`.

The values Fieldwright stores itself travel on the Store API as
`extensions.cbwb` on `POST /wc/store/v1/checkout`, keyed by field id (the bare key
without the `cbwb/` prefix is accepted too). `OPTIONS` on that route lists exactly
what the current configuration accepts.

That block is read only on the `POST` that places the order, and a `POST` without
it is a form with every one of these fields left blank: required fields are
answered for, and stored values from an earlier attempt are cleared. The draft
`PUT` the block checkout sends after a failed payment carries a diff rather than
the form, so it is left alone.

## Loading a checkout bundle

If your add-on registers a checkout block component with
`registerCheckoutBlock()`, load its script as a WooCommerce block integration,
not with `wp_enqueue_script()`. WooCommerce's renderer takes a copy of the
registered component map while `checkout-frontend.js` executes and renders from
that copy on `DOMContentLoaded`, so anything registered after that script has run
is left in the page as an empty `<div>`. A plain enqueue lands after it.

Register an
`Automattic\WooCommerce\Blocks\Integrations\IntegrationInterface` instance on the
`woocommerce_blocks_checkout_block_registration` action instead, and WooCommerce
merges your `get_script_handles()` into the dependencies of
`wc-checkout-block-frontend`, so WordPress prints yours first. The action fires on
`init`, so hook it before then. `initialize()` runs immediately afterwards and is
where the handle must be registered, never enqueued. `get_script_data()` is read
when the block renders and published under `wcSettings` as `<name>_data`. Every
handle you name needs all of its own dependencies registered by print time:
WordPress drops a script with a missing dependency, and everything that depends on
it, which now includes WooCommerce's checkout.

## Source code

The files in `build/` are compiled and minified from the TypeScript and React
sources in `src/`. To rebuild them from this directory:

```bash
npm ci
npm run build
```

That runs `wp-scripts build` against `webpack.config.js` here, whose two entry
points are `src/admin.tsx` and `src/checkout.ts`, and writes `build/`.

`package.json`, `package-lock.json`, `webpack.config.js`, `src/` and this
directory are all left out of the distributed zip, so the plugin a store installs
carries the compiled files and nothing else.
