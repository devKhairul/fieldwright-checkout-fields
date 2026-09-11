/**
 * What the builder knows about each field type and each placement.
 *
 * The server describes both in the bootstrap data, in the merchant's language.
 * This module holds the half the server has no opinion about — which icon a
 * type gets and which group of the picker it belongs to — and, for a bootstrap
 * written before the type expansion, stands in for the half it does: family,
 * allowed placements, and the labels of anything it did not list. A builder
 * running against an older PHP half therefore still offers every type rather
 * than silently shrinking back to three.
 *
 * A type an add-on registered is described in two halves as well: the server
 * lists it in the bootstrap catalogue, and the add-on's own bundle registers
 * what the builder has to draw for it on `cbwb.fieldTypes`. A type with only one
 * of the two halves is unavailable — nothing can render it — and every lookup
 * below says so rather than guessing at a family the checkout would then hand to
 * WooCommerce as a text box.
 */

import {
	calendar,
	check,
	chevronDown,
	envelope,
	formatListBullets,
	heading,
	link,
	list,
	math,
	mobile,
	paragraph,
	plugins,
	postContent,
	textHorizontal,
	time,
} from '@wordpress/icons';
import { __ } from '@wordpress/i18n';

import type {
	AdminBootstrap,
	BuiltinFieldType,
	FieldFamily,
	FieldLocation,
	FieldType,
	PlacementMeta,
	TypeMeta,
} from '../types';
import type { RegisteredFieldType } from './hooks';
import { registeredTypes } from './hooks';

/** An `@wordpress/icons` export, as `Button`'s `icon` prop takes it. */
type IconElement = typeof check;

/** The picker's groups, in the order it draws them. */
export type TypeGroupKey = 'text' | 'choice' | 'long' | 'content';

export const TYPE_GROUP_ORDER: TypeGroupKey[] = [
	'text',
	'choice',
	'long',
	'content',
];

/** Every placement, in checkout order. */
export const PLACEMENT_ORDER: FieldLocation[] = [
	'contact',
	'address',
	'shipping_address',
	'billing_address',
	'order',
	'after_shipping',
	'after_payment',
	'before_place_order',
	'order_summary',
];

/**
 * The two placements that reach one address form only.
 *
 * `address` puts a field in both, which is all WooCommerce's own field API can
 * express. These two are drawn by Fieldwright's own block inside one
 * form's inner block area, so only the types it draws itself can use them.
 */
export const SINGLE_ADDRESS_PLACEMENTS: FieldLocation[] = [
	'shipping_address',
	'billing_address',
];

/**
 * The placements a core-family type may use: WooCommerce's own three sections,
 * which are the only ones its Checkout Fields API knows how to fill.
 */
export const CORE_PLACEMENTS: FieldLocation[] = [
	'contact',
	'address',
	'order',
];

/** Every type Free carries itself, in the order the picker offers them. */
export const FIELD_TYPES: BuiltinFieldType[] = [
	'text',
	'email',
	'phone',
	'number',
	'url',
	'select',
	'checkbox',
	'radio',
	'checkbox_group',
	'textarea',
	'date',
	'time',
	'heading',
	'paragraph',
];

/** Which family each of Free's own types belongs to. */
export const FAMILY_OF: Record< BuiltinFieldType, FieldFamily > = {
	text: 'core',
	email: 'core',
	phone: 'core',
	number: 'core',
	url: 'core',
	select: 'core',
	checkbox: 'core',
	textarea: 'rich',
	radio: 'rich',
	checkbox_group: 'rich',
	date: 'rich',
	time: 'rich',
	heading: 'content',
	paragraph: 'content',
};

/** The picker group each of Free's own types is offered in. */
const GROUP_OF: Record< BuiltinFieldType, TypeGroupKey > = {
	text: 'text',
	email: 'text',
	phone: 'text',
	number: 'text',
	url: 'text',
	select: 'choice',
	checkbox: 'choice',
	radio: 'choice',
	checkbox_group: 'choice',
	textarea: 'long',
	date: 'long',
	time: 'long',
	heading: 'content',
	paragraph: 'content',
};

const ICON_OF: Record< BuiltinFieldType, IconElement > = {
	text: textHorizontal,
	email: envelope,
	phone: mobile,
	number: math,
	url: link,
	select: chevronDown,
	checkbox: check,
	radio: formatListBullets,
	checkbox_group: list,
	textarea: postContent,
	date: calendar,
	time,
	heading,
	paragraph,
};

/**
 * The icon a type the builder cannot draw is listed with, and the one a
 * registered type falls back to when its add-on named none.
 */
const UNKNOWN_ICON: IconElement = plugins;

/**
 * Whether Free carries this type itself.
 *
 * @param type Field type.
 * @return True for one of Free's own types.
 */
export function isBuiltinType( type: FieldType ): type is BuiltinFieldType {
	return Object.prototype.hasOwnProperty.call( FAMILY_OF, type );
}

/**
 * What an add-on registered for a type, if anything.
 *
 * Free's own types are never looked up: a built-in key cannot be registered,
 * and answering with a descriptor for one would let an add-on redraw the
 * builder's own fields.
 *
 * @param type Field type.
 * @return The descriptor, or undefined.
 */
export function descriptorFor(
	type: FieldType
): RegisteredFieldType | undefined {
	if ( isBuiltinType( type ) ) {
		return undefined;
	}

	return registeredTypes().find( ( entry ) => entry.key === type );
}

/**
 * The family a type belongs to.
 *
 * A registered type is always `rich` — Free renders it through its own block and
 * stores it under its own key — and everything else is `unavailable`: the add-on
 * that provided it is switched off, or never provided it at all. Nothing renders
 * an unavailable field, so every path that filters by family skips it.
 *
 * @param type Field type.
 * @return Family.
 */
export function familyOf( type: FieldType ): FieldFamily {
	if ( isBuiltinType( type ) ) {
		return FAMILY_OF[ type ];
	}

	return descriptorFor( type ) ? 'rich' : 'unavailable';
}

/**
 * The picker group a type is offered in.
 *
 * @param type Field type.
 * @return Group key.
 */
export function groupOf( type: FieldType ): TypeGroupKey {
	if ( isBuiltinType( type ) ) {
		return GROUP_OF[ type ];
	}

	const group = descriptorFor( type )?.group;

	// A group of the add-on's own invention would be drawn nowhere, so the type
	// goes in the one that holds everything that is not a box or a choice.
	return group && TYPE_GROUP_ORDER.includes( group ) ? group : 'long';
}

/**
 * The icon a type is drawn with.
 *
 * @param type Field type.
 * @return An icon element.
 */
export function iconOf( type: FieldType ): IconElement {
	if ( isBuiltinType( type ) ) {
		return ICON_OF[ type ];
	}

	const icon = descriptorFor( type )?.icon;

	return undefined === icon || null === icon
		? UNKNOWN_ICON
		: ( icon as IconElement );
}

/**
 * What a field of an unavailable type says wherever the builder names its state.
 *
 * Deliberately generic, and deliberately the same sentence in the outline, the
 * canvas and the editor: the builder does not know which add-on provided the
 * type, only that nothing is providing it now.
 *
 * A function rather than a constant: `__()` has to run once the locale's
 * translations are in, which is not guaranteed at module scope.
 *
 * @return The sentence.
 */
export function unavailableLabel(): string {
	return __(
		'Provided by an add-on that is not active',
		'fieldwright-checkout-fields'
	);
}

/**
 * Whether the type is one WooCommerce's own Checkout Fields API renders.
 *
 * @param type Field type.
 * @return True for a core-family type.
 */
export function isCoreType( type: FieldType ): boolean {
	return 'core' === familyOf( type );
}

/**
 * Whether the type is one of the two that print words rather than collect them.
 *
 * @param type Field type.
 * @return True for a content-family type.
 */
export function isContentType( type: FieldType ): boolean {
	return 'content' === familyOf( type );
}

/**
 * Where a type of this family may be placed.
 *
 * @param family Field family.
 * @return Allowed placements.
 */
export function placementsForFamily( family: FieldFamily ): FieldLocation[] {
	return 'core' === family ? CORE_PLACEMENTS : PLACEMENT_ORDER;
}

/**
 * Where this type may be placed.
 *
 * @param type Field type.
 * @return Allowed placements.
 */
export function placementsForType( type: FieldType ): FieldLocation[] {
	return placementsForFamily( familyOf( type ) );
}

/**
 * Whether a type may live in a placement.
 *
 * @param type     Field type.
 * @param location Placement key.
 * @return True when allowed.
 */
export function allowsPlacement(
	type: FieldType,
	location: FieldLocation
): boolean {
	return placementsForType( type ).includes( location );
}

/**
 * The name of each picker group, written for the merchant.
 *
 * A function rather than a constant: `__()` has to run once the locale's
 * translations are in, which is not guaranteed at module scope.
 *
 * @return Group labels, keyed by group.
 */
export function typeGroupLabels(): Record< TypeGroupKey, string > {
	return {
		text: __( 'Text inputs', 'fieldwright-checkout-fields' ),
		choice: __( 'Choices', 'fieldwright-checkout-fields' ),
		long: __( 'Long text & dates', 'fieldwright-checkout-fields' ),
		content: __( 'Content', 'fieldwright-checkout-fields' ),
	};
}

/**
 * The fallback name and one-line description of each of Free's own types, used
 * wherever the server did not describe one.
 *
 * @return Labels and descriptions, keyed by type.
 */
function typeFallbacks(): Record<
	BuiltinFieldType,
	{ label: string; description: string }
> {
	const t = ( label: string, description: string ) => ( {
		label,
		description,
	} );

	return {
		text: t(
			__( 'Text', 'fieldwright-checkout-fields' ),
			__(
				'A single line, with optional format and length rules.',
				'fieldwright-checkout-fields'
			)
		),
		email: t(
			__( 'Email address', 'fieldwright-checkout-fields' ),
			__(
				'A second email address, checked as one.',
				'fieldwright-checkout-fields'
			)
		),
		phone: t(
			__( 'Phone number', 'fieldwright-checkout-fields' ),
			__(
				'A phone number, with a phone keypad on mobile.',
				'fieldwright-checkout-fields'
			)
		),
		number: t(
			__( 'Number', 'fieldwright-checkout-fields' ),
			__(
				'Digits only, with an optional smallest and largest.',
				'fieldwright-checkout-fields'
			)
		),
		url: t(
			__( 'Web address', 'fieldwright-checkout-fields' ),
			__(
				'A web address, checked as one.',
				'fieldwright-checkout-fields'
			)
		),
		select: t(
			__( 'Dropdown', 'fieldwright-checkout-fields' ),
			__(
				'A list of options the customer picks one of.',
				'fieldwright-checkout-fields'
			)
		),
		checkbox: t(
			__( 'Checkbox', 'fieldwright-checkout-fields' ),
			__(
				'A single yes/no tick box, for consent and opt-ins.',
				'fieldwright-checkout-fields'
			)
		),
		radio: t(
			__( 'Radio buttons', 'fieldwright-checkout-fields' ),
			__(
				'Every option on show, one of them chosen.',
				'fieldwright-checkout-fields'
			)
		),
		checkbox_group: t(
			__( 'Checkbox group', 'fieldwright-checkout-fields' ),
			__(
				'Every option on show, any number of them ticked.',
				'fieldwright-checkout-fields'
			)
		),
		textarea: t(
			__( 'Long text', 'fieldwright-checkout-fields' ),
			__(
				'Several lines, for instructions and messages.',
				'fieldwright-checkout-fields'
			)
		),
		date: t(
			__( 'Date', 'fieldwright-checkout-fields' ),
			__(
				'A date picker, with an optional earliest and latest.',
				'fieldwright-checkout-fields'
			)
		),
		time: t(
			__( 'Time', 'fieldwright-checkout-fields' ),
			__(
				'A time picker, with an optional earliest and latest.',
				'fieldwright-checkout-fields'
			)
		),
		heading: t(
			__( 'Heading', 'fieldwright-checkout-fields' ),
			__(
				'A title that breaks the form into parts.',
				'fieldwright-checkout-fields'
			)
		),
		paragraph: t(
			__( 'Paragraph', 'fieldwright-checkout-fields' ),
			__(
				'A sentence or two of your own, shown as text.',
				'fieldwright-checkout-fields'
			)
		),
	};
}

/**
 * The fallback name and description of every placement.
 *
 * @return Placement metadata, in checkout order.
 */
export function placementFallbacks(): PlacementMeta[] {
	return [
		{
			key: 'contact',
			label: __( 'Contact', 'fieldwright-checkout-fields' ),
			description: __(
				'Shown at the top of checkout, next to the email address.',
				'fieldwright-checkout-fields'
			),
			storage: __(
				"Saved to the customer's account.",
				'fieldwright-checkout-fields'
			),
		},
		{
			key: 'address',
			label: __( 'Address', 'fieldwright-checkout-fields' ),
			description: __(
				'Shown inside both the shipping and billing address forms.',
				'fieldwright-checkout-fields'
			),
			storage: __(
				"Saved to the customer's address book.",
				'fieldwright-checkout-fields'
			),
		},
		{
			key: 'shipping_address',
			label: __( 'Shipping address', 'fieldwright-checkout-fields' ),
			description: __(
				"Shown only in the shipping address form, after WooCommerce's own fields.",
				'fieldwright-checkout-fields'
			),
		},
		{
			key: 'billing_address',
			label: __( 'Billing address', 'fieldwright-checkout-fields' ),
			description: __(
				"Shown only in the billing address form, after WooCommerce's own fields.",
				'fieldwright-checkout-fields'
			),
		},
		{
			key: 'order',
			label: __( 'Order information', 'fieldwright-checkout-fields' ),
			description: __(
				'Shown in the Additional order information section, above the payment methods.',
				'fieldwright-checkout-fields'
			),
			storage: __(
				'Saved on the order only.',
				'fieldwright-checkout-fields'
			),
		},
		{
			key: 'after_shipping',
			label: __(
				'After shipping options',
				'fieldwright-checkout-fields'
			),
			description: __(
				'Shown directly under the shipping methods, where a delivery question belongs.',
				'fieldwright-checkout-fields'
			),
		},
		{
			key: 'after_payment',
			label: __( 'After payment options', 'fieldwright-checkout-fields' ),
			description: __(
				'Shown directly under the payment methods, where a billing question belongs.',
				'fieldwright-checkout-fields'
			),
		},
		{
			key: 'before_place_order',
			label: __(
				'Before the Place order button',
				'fieldwright-checkout-fields'
			),
			description: __(
				'Shown at the very bottom, above the Place Order button.',
				'fieldwright-checkout-fields'
			),
		},
		{
			key: 'order_summary',
			label: __( 'Order summary', 'fieldwright-checkout-fields' ),
			description: __(
				'Shown in the order summary beside the form, under the totals.',
				'fieldwright-checkout-fields'
			),
		},
	];
}

/**
 * What a type is called and what it is for, wherever the server has not said.
 *
 * A type the builder has never heard of is named by its own key: that is all
 * there is to go on, and an empty chip beside a field would say less than the
 * word the add-on stored.
 *
 * @param type Field type.
 * @return Label and description.
 */
export function metaFor( type: FieldType ): {
	label: string;
	description: string;
} {
	if ( isBuiltinType( type ) ) {
		return typeFallbacks()[ type ];
	}

	return { label: type, description: '' };
}

/**
 * Everything the builder needs about one type, whatever the server told it.
 */
export interface ResolvedType {
	key: FieldType;
	label: string;
	description: string;
	family: FieldFamily;
	placements: FieldLocation[];
	group: TypeGroupKey;
	icon: IconElement;
	/**
	 * Whether a field of this type reaches the checkout at all.
	 *
	 * False for a type the server listed that nothing can draw right now: the
	 * add-on that provided it is switched off, or registered it without checkout
	 * support. The entry is still resolved, because the fields that carry the
	 * type are still in the configuration and still have to be described; it is
	 * simply never offered as something new to build.
	 */
	available: boolean;
}

/**
 * The complete type list: Free's own, and every type an add-on registered.
 *
 * The server's catalogue is the authority on what exists — it lists Free's
 * fourteen and every type registered in PHP — and the descriptors registered on
 * `cbwb.fieldTypes` are the authority on what the builder draws for one. An
 * entry that has only one of the two halves resolves as unavailable rather than
 * as something a merchant can pick, because nothing could render it.
 *
 * @param types Bootstrap type list.
 * @return One entry per type: Free's own in picker order, then the server's
 *         registered types in the order it listed them.
 */
export function resolveTypes( types: TypeMeta[] = [] ): ResolvedType[] {
	const fallbacks = typeFallbacks();
	const fromServer = new Map( types.map( ( type ) => [ type.key, type ] ) );
	const descriptors = new Map(
		registeredTypes().map( ( type ) => [ type.key, type ] )
	);

	const builtins: ResolvedType[] = FIELD_TYPES.map( ( key ) => {
		const server = fromServer.get( key );
		// Never false in practice: the server marks its own types available. Read
		// anyway, so one answer decides the family everywhere.
		const available = false !== server?.available;
		const family = available
			? server?.family ?? FAMILY_OF[ key ]
			: 'unavailable';

		return {
			key: key as FieldType,
			label: server?.label || fallbacks[ key ].label,
			description: server?.description || fallbacks[ key ].description,
			family,
			placements:
				server?.placements && server.placements.length > 0
					? server.placements
					: placementsForFamily( family ),
			group: GROUP_OF[ key ],
			icon: ICON_OF[ key ],
			available,
		};
	} );

	const registered: ResolvedType[] = types
		.filter( ( type ) => ! isBuiltinType( type.key ) )
		.map( ( server ) => {
			const descriptor = descriptors.get( server.key );
			// Both halves have to be there. The server says the checkout can
			// render the type; the descriptor is what the builder draws for it.
			const available =
				false !== server.available && undefined !== descriptor;
			const family: FieldFamily = available ? 'rich' : 'unavailable';

			return {
				key: server.key,
				label: server.label || server.key,
				description: server.description || '',
				family,
				placements:
					server.placements && server.placements.length > 0
						? server.placements
						: placementsForFamily( family ),
				group: groupOf( server.key ),
				icon: iconOf( server.key ),
				available,
			};
		} );

	return [ ...builtins, ...registered ];
}

/**
 * The complete placement list, with the server's wording where it has any.
 *
 * `placements` is what a current bootstrap sends; `locations` is all an older
 * one has, and describes the first three.
 *
 * @param bootstrap Bootstrap data.
 * @return One entry per placement, in checkout order.
 */
export function resolvePlacements(
	bootstrap: Pick< AdminBootstrap, 'locations' | 'placements' >
): PlacementMeta[] {
	const fallbacks = placementFallbacks();
	const described = new Map(
		[
			...( bootstrap.locations ?? [] ),
			...( bootstrap.placements ?? [] ),
		].map( ( placement ) => [ placement.key, placement ] )
	);

	return fallbacks.map( ( fallback ) => {
		const server = described.get( fallback.key );
		return {
			key: fallback.key,
			label: server?.label || fallback.label,
			description: server?.description || fallback.description,
			/*
			 * Taken from the same half as the description it belongs to. A
			 * bootstrap old enough to have no `storage` key still has the
			 * sentence baked into its description, and adding this one on top
			 * would say it twice.
			 */
			storage: server ? server.storage : fallback.storage,
		};
	} );
}

/**
 * The types a placement will accept.
 *
 * @param types    Resolved types.
 * @param location Placement key.
 * @return The types allowed there.
 */
export function typesForPlacement(
	types: ResolvedType[],
	location: FieldLocation
): ResolvedType[] {
	return types.filter( ( type ) => type.placements.includes( location ) );
}
