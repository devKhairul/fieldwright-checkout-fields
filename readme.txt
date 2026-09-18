=== Fieldwright Checkout Fields for WooCommerce ===
Contributors: khairul89
Tags: woocommerce, checkout, checkout fields, checkout block, block checkout
Requires at least: 6.9
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Add checkout fields and control WooCommerce's own fields on the Checkout block. Live preview, values everywhere, no code.

== Description ==

Fieldwright is a visual editor for the WooCommerce Checkout block.

It starts with the thing most field plugins still cannot do there: **WooCommerce's own checkout fields**. Rename them, switch them off, make them optional or required, and drag them into any order in the same list as the fields you add. The change reaches the browser, every country's address rules and the Store API, so an optional postcode really is optional and the order goes through.

Then it adds fields of your own. Fourteen types, nine positions on the checkout page, and a live preview of the page beside the editor as you build it.

Answers are shown where you and your customer look for them: on the admin order screen, where you can also edit them, in the order emails, on the order confirmation page, and in the customer's order history. Each of those can be switched off per field.

**No banners and no popups.** Fieldwright puts nothing in your dashboard except its own screen.

Everything described on this page is in this plugin. A separate paid add-on, **Fieldwright Pro**, adds a file upload field type, conditions, "required when" rules, checkout fees, an orders list column, CSV export of orders with their answers, answers on PDF invoices, default values for WooCommerce's own fields, date rules including a minimum age, and delivery time slots. It is sold and supported from our own site and is not needed for anything described here.

Your settings are stored as one option and stay exactly as you left them if you deactivate the plugin and come back to it.

It collects nothing, tracks nothing, and answers WordPress's own export and erasure requests. See "Privacy".

Built on WooCommerce's own Additional Checkout Fields API wherever that API can carry a field, so those fields keep working through every WooCommerce update.

**Block checkout only.** If your store still uses the classic (shortcode) checkout, these fields will not appear there. The builder's Compatibility tab tells you which checkout your store renders today, and offers a draft copy of the page to try the Checkout block on.

== What you can add ==

* **Text**, with a format rule (any text, email, phone number, number, web address, letters only, or your own pattern), your own message for a value that does not match, and an optional maximum length
* **Email address**, **Phone number** and **Web address**: a text box with the right rule and the right keyboard on a phone
* **Number**, with an optional smallest value, largest value and step
* **Dropdown**, with your own options and a first, unselected choice
* **Checkbox**, for consent and opt-ins, with your own message when it is required
* **Long text**, two to ten rows, for gift messages and delivery instructions
* **Radio buttons**: one list of options shown at once, one of them picked
* **Checkbox group**: one list of options shown at once, any number of them ticked
* **Date** and **Time**, with an optional earliest and latest
* **Heading** and **Paragraph**: a title or a note to the customer. Nothing is asked and nothing is stored.

Every field can carry help text, a starting value and a half width layout. Ten ready made fields (delivery instructions, gift message, VAT number and more) are one click away in the builder's empty state.

== Where fields go ==

* **Contact**, at the top of checkout, next to the email address.
* **Address**, inside both the shipping and billing address forms.
* **Shipping address**, in the shipping address form only, under WooCommerce's own fields.
* **Billing address**, in the billing address form only.
* **Order information**, in the Additional order information section, above the payment methods.
* **After shipping options**, below the list of shipping methods.
* **After payment options**, below the payment methods, before the order notes.
* **Before the Place order button**, the last thing read before paying.
* **Order summary**, inside the summary panel beside the form, under the totals.

Shipping address and Billing address are for a question that belongs to one address and not the other. A required field there is only required when that form is on the customer's screen, so it cannot block an order placed with one address, or an order that needs no shipping.

== WooCommerce's own fields ==

WooCommerce's own checkout fields sit in the same builder outline as the ones you add, so you arrange all of them together instead of guessing where yours will land.

* **Rename any of them.** "Postal code" to "Zip", "Phone" to "Mobile number", "Company" to "Business name". The "(optional)" wording follows automatically.
* **Switch them off.** Company, apartment or suite, phone, address, city, state, postcode, first name and last name can all be taken off the checkout. Email address and country or region stay, because WooCommerce needs both.
* **Make them optional, or required.** The same set, in both directions. The change is honoured by the checkout and again when the order is placed.
* **Reorder the address form.** Drag WooCommerce's fields and yours in one list, so a "Delivery instructions" box can sit between the street address and the city.
* **Hide the order notes box** and **hide the coupon field on checkout.** The cart's coupon field is untouched, so a coupon link still works.

Company, apartment or suite and phone are the three WooCommerce keeps its own settings for, so Fieldwright writes to those settings rather than shadowing them. The Checkout block's own "Address fields" sidebar, the classic checkout and the builder always show the same thing, and deactivating Fieldwright leaves them exactly as you last set them.

== Good to know ==

* Changing a field's type discards the settings that belong only to the type you are leaving, such as its format and options. The key, label, location and every saved value are untouched.
* An add-on can provide field types of its own. If that add-on is later deactivated, nothing is deleted: its fields stay in the builder with a note on the row saying the checkout will not show them, and stop appearing on the checkout. You can go on renaming, reordering and saving them, and the add-on running again brings them back exactly as they were.
* Text, email, phone, number, web address, dropdown and checkbox fields are the ones WooCommerce carries itself, so they can only go in Contact, Address or Order information. Every other type is drawn by Fieldwright, which is what lets it reach the other six positions.
* In the Contact, Address and Order information positions WooCommerce draws its own field types as one group and the types this plugin draws come after them, so the two cannot be mixed in one order. The builder keeps each position in that order and marks the line between the two groups; you can reorder freely on either side of it.
* The six extra positions are anchored to the blocks on your checkout page. If you have removed one of those blocks, fields placed there are shown at the end of the checkout form instead, and the builder tells you which position it was.
* "Remember for next time" is offered on the types Fieldwright draws itself, in the Contact, Address, Shipping address and Billing address positions. WooCommerce already remembers its own contact and address fields without being asked.
* "Show on the order confirmation" is the only visibility switch WooCommerce honours for the types it carries. The other three are stored but have no effect on those fields.
* **Required fields** in the Settings tab decides how the checkout tells a required field from an optional one: WooCommerce's own "(optional)" after the optional ones, or a red asterisk after the required ones. It applies to WooCommerce's own fields, the fields it carries for you and the ones Fieldwright draws itself. The asterisk comes with a short line at the top of the checkout that says what it means, which you can switch off.
* Placeholders are not offered on WooCommerce's own fields. Its inputs float the label into the box while it is empty, which paints over a placeholder and makes it unreadable.
* Email address and country or region cannot be hidden or made optional. WooCommerce rejects an order with no email address, and country is the key it looks the rest of the address rules up with.
* Renaming one of WooCommerce's fields applies in every country, in place of its own wording (a postcode is "ZIP Code" in the United States and "Eircode" in Ireland). The builder shows you the local wording before you change it.
* Some payment gateways and shipping rate providers still need a name or a phone number even when your checkout stops asking for one, and fail the order rather than accept it without. The builder repeats WooCommerce's warning beside those three fields.

== Privacy ==

Fieldwright collects nothing for itself. It has no tracking, and it makes no request to any server of ours.

**What is stored, and where.** Your field configuration is one WordPress option, `cbwb_config`. An answer a customer types is stored on their order. For the field types WooCommerce carries itself, it is stored the way WooCommerce stores its own: `_wc_other/<key>`, `_wc_billing/<key>` or `_wc_shipping/<key>`. For every other type, Fieldwright stores it as `_cbwb/<key>` order meta, where `<key>` is the field key without its `cbwb/` prefix. A checkbox group is a comma separated list of the option values, a date is `YYYY-MM-DD`, and a time is `HH:MM`. A field type provided by an add-on stores whatever that add-on documents, in the same place. A field set to "Remember for next time" also keeps a copy against the customer's account as user meta under the same `_cbwb/<key>` name.

**Export and erasure.** Fieldwright answers WordPress's own personal data tools under Tools, filed under the group "Fieldwright fields". The exporter returns every answer on the customer's orders and every value remembered against their account. The eraser removes both. Answers are read from the order rather than from the fields you have today, so a field you have since switched off or deleted outright still has its old answers exported and erased. They are listed under the key they are stored as, because a deleted field has no label left to show. An add-on that keeps anything behind one of its values is told when the value is erased, so it can remove that too.

**Anonymisation.** WooCommerce's "Remove personal data" bulk action, and its retention schedule, clear Fieldwright's values from an order along with WooCommerce's own, on the same terms. WooCommerce's customer erasure clears the values remembered against an account.

**Uninstall.** Answers already on your orders are always kept, the way a customer's address is: a store has to be able to read its own past orders after removing the plugin that collected them. Everything else (your configuration, the values remembered against accounts, and the plugin's temporary rows) is removed on uninstall when you turn on "Remove all data on uninstall" in the Settings tab.

== Installation ==

1. Install and activate WooCommerce 10.0 or newer.
2. Install and activate this plugin.
3. Go to **WooCommerce → Fieldwright**.

== Frequently Asked Questions ==

= Does this work with the classic (shortcode) checkout? =

No. Fieldwright uses WooCommerce's Additional Checkout Fields API, which only works with the Checkout block. Every display path in WooCommerce for these fields (the order confirmation page, the emails and the admin order screen) only runs for orders placed through the Checkout block.

= Will the free plugin nag me? =

No. There are no admin notices, no banners, no review prompts and no popups. The paid add-on is named in exactly one place: a single line at the foot of the field type picker, with a link. Nothing in this plugin is switched off, counted or held back waiting for it.

= Is anything in this plugin limited? =

No. Every field type, every position, every setting and every display surface described on this page works in full. The paid add-on adds things this plugin does not have; it does not switch on anything this plugin already has.

= Does it work with WPML or Polylang? =

Yes. Every word you type into the builder is handed to the translator: field labels, placeholders, help text, option labels, error messages, starting values, headings, paragraphs and the names you give WooCommerce's own fields. They appear under the string group "fieldwright-checkout-fields" and are translated on the checkout for the language of the request. Both plugins are covered by the same pair of hooks, and neither has to be installed for Fieldwright to work. TranslatePress needs no registration, because it translates the rendered page, and nothing Fieldwright renders carries an attribute it would translate by mistake.

= What happens to my saved values if I remove the plugin? =

They stay on your orders as order meta. Only the plugin's own configuration and the values remembered against customer accounts are removed on uninstall, and only if you turn on "Remove all data on uninstall" in the Settings tab.

= Can I change a field's key after customers have used it? =

No, and that is deliberate. The field key is the order meta key, so changing it would orphan every value already saved against it.

= Do I have to edit my checkout page? =

No. Fieldwright places its fields on the rendered checkout itself, so a page you have never opened in the editor gets them all.

= Two of us edit the checkout. Can we overwrite each other? =

No. Every save carries the revision of the configuration it was made against. If someone else has saved since your screen loaded, yours is refused and you are offered a reload, so nobody's work disappears without being told.

== Screenshots ==

1. The builder: every field on the checkout in one outline, the settings for the field you picked, and a preview of the page beside them.
2. WooCommerce's own fields sit in the same outline. Rename them, switch them off, make them optional or required, and drag them into a new order.
3. Pick the field type. The group you open the picker in decides where the field goes on the checkout.
4. The Checkout block with the fields in place, in the contact, address, shipping and order sections.
5. Answers arrive on the order screen, beside the address and in a box you can edit.
6. Answers on the order confirmation page and in the order emails, each switchable per field.

== For developers ==

Fieldwright is built to be extended, and every hook, filter, JavaScript API and REST route it offers is a public contract, documented at https://github.com/devKhairul/fieldwright-checkout-fields/blob/main/docs/developers.md.

**Source code.** The files in `build/` are compiled and minified from the TypeScript and React sources in `src/`, and both the sources and the build tooling are in that same repository. To rebuild them: `npm ci`, then `npm run build`, which runs `wp-scripts build`.

== Changelog ==

= 1.1.0 =
* Checkbox group, date and time fields are part of the plugin, and there is no longer a count of fields that collect an answer.
* An add-on can register field types of its own, and a field whose add-on is not running stays in the builder untouched until it is. See "For developers".
* The one link to the paid add-on is a line at the foot of the field type picker; the Plugins screen row action and the panels that described it are gone.

= 1.0.0 =
* First release.
* A visual builder for the WooCommerce Checkout block, under WooCommerce → Fieldwright: every field on the checkout in one outline, the settings for the field you picked, and a live preview of the page beside them.
* WooCommerce's own checkout fields in the same outline. Rename them, switch them off, make them optional or required, and drag them into any order; the change reaches the browser, every country's address rules and the Store API.
* Eleven field types (text, email address, phone number, web address, number, dropdown, checkbox, long text, radio buttons, heading and paragraph), in nine positions on the checkout page, each with help text, a starting value, a half width layout and, where it applies, a format rule with your own message.
* Answers on the admin order screen, where they can be edited, in the order emails, on the order confirmation page and in the customer's order history, each switchable per field; a field can also remember its answer against the customer's account for next time.
* Translations: every merchant-entered string is registered with WPML and Polylang, and the checkout, the confirmation page, the order history and the emails read in the customer's language.
* Personal data tooling: an exporter and an eraser for WordPress's own privacy tools, and support for WooCommerce's "Remove personal data" bulk action, its retention schedule and its customer erasure.
* A Compatibility tab that says which checkout the store renders today, names the plugins that only work with the classic one, and offers a draft copy of the checkout page to try the Checkout block on.
* Import and export of the configuration as JSON, ten ready made fields in the builder's empty state, and a save that refuses to overwrite a change somebody else made since your screen loaded.
* No banners, no popups, no tracking and no requests to any server of ours. Built on WooCommerce's Additional Checkout Fields API wherever that API can carry a field.
* Every hook, filter, JavaScript API and REST route is a public contract, documented for developers: see "For developers".
