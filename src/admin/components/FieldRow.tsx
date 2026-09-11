/**
 * One row of the Fields outline.
 *
 * The outline is the narrowest of the three panes, so everything here is sized
 * to a 40px row: statuses are single glyphs rather than the wide chips they used
 * to be, and the type badge steps out of the row's way whenever the row is too
 * narrow to spell a label out beside it — a container query, so it is the row's
 * own width that decides, not the window's. What the badge said is on the row's
 * tooltip either way, and hovering or focusing the row brings it back.
 *
 * The glyphs were anonymous coloured dots until a merchant asked what the two
 * small dots on a row meant, which is the one question a status is there to
 * answer. Each one now draws something with a meaning of its own — an asterisk
 * for Required, the store's own currency symbol for a fee, a filter for a
 * condition — and the row's tooltip spells every one of them out in words.
 *
 * That tooltip is `Tooltip`, not `title`, for the keyboard: a native `title`
 * never appears on focus, so a sighted merchant tabbing down the outline would
 * have been left with the same unexplained glyphs. It hangs on the row's own
 * button rather than on each glyph, because a focusable element inside a button
 * is neither valid HTML nor a tab stop anyone wants three of per row.
 *
 * Nothing an assistive technology hears changed by any of that: every glyph is
 * `aria-hidden` with its meaning beside it as text hidden the way
 * `.cbwb-visually-hidden` hides things, so each row's accessible name still
 * reads "<label> <type> Required".
 */

import type { ReactNode } from 'react';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import {
	Button,
	DropdownMenu,
	FormToggle,
	Tooltip,
} from '@wordpress/components';
import {
	caution,
	chevronDown,
	chevronUp,
	copy,
	dragHandle,
	moreVertical,
	plugins,
	trash,
} from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';

import type { RowIndicator } from '../lib/hooks';
import { rowIndicators } from '../lib/hooks';
import { familyOf, metaFor, unavailableLabel } from '../lib/typeMeta';
import type { Field, TypeMeta } from '../types';

interface FieldRowProps {
	field: Field;
	types: TypeMeta[];
	isSelected: boolean;
	isFirst: boolean;
	isLast: boolean;
	hasErrors: boolean;
	onSelect: () => void;
	onToggleEnabled: ( enabled: boolean ) => void;
	onMove: ( delta: number ) => void;
	onDuplicate: () => void;
	onRemove: () => void;
}

/**
 * The Required glyph: the asterisk a checkout form prints beside a field a
 * shopper has to fill in. Text rather than an icon — there is no asterisk in
 * `@wordpress/icons`, and every face has this one.
 */
export const REQUIRED_GLYPH = '*';

/** What joins the parts of a row's tooltip. */
export const TOOLTIP_SEPARATOR = ' · ';

interface IndicatorProps {
	/** Tone modifier, e.g. `required`. */
	tone: string;
	/** What the indicator means, for assistive technology. */
	label: string;
	/** The glyph to draw. A dot stands in when there is none. */
	icon?: ReactNode;
}

/**
 * A status glyph whose meaning is carried by visually hidden text.
 *
 * Exported for `CoreRow`, which draws the same statuses in the same row: the two
 * kinds of row sit in one list, so they have to look like one list.
 *
 * @param props       Component props.
 * @param props.tone  Tone modifier.
 * @param props.label Text read in place of the glyph.
 * @param props.icon  Icon element or short text glyph.
 */
export function Indicator( { tone, label, icon }: IndicatorProps ) {
	return (
		<span className={ `cbwb-indicator cbwb-indicator--${ tone }` }>
			<span className="cbwb-indicator__glyph" aria-hidden="true">
				{ icon || <span className="cbwb-indicator__dot" /> }
			</span>
			<span className="cbwb-visually-hidden">{ label }</span>
		</span>
	);
}

export default function FieldRow( {
	field,
	types,
	isSelected,
	isFirst,
	isLast,
	hasErrors,
	onSelect,
	onToggleEnabled,
	onMove,
	onDuplicate,
	onRemove,
}: FieldRowProps ) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable( { id: field.id } );

	// dnd-kit sets an explicit role="button"; the element already is one.
	const { role: _role, ...dragAttributes } = attributes;

	const typeLabel =
		types.find( ( type ) => type.key === field.type )?.label ??
		metaFor( field.type ).label;
	// A type nothing is providing right now. The field keeps everything it has
	// and everything on the row goes on working; the glyph says why the checkout
	// does not draw it.
	const unavailable = 'unavailable' === familyOf( field.type );

	/*
	 * A field whose label has been emptied still has a row, a handle, a toggle
	 * and a menu. Without a stand-in the row draws blank and every one of those
	 * controls is announced as "Drag to reorder", "Show at checkout" — the same
	 * name on every unlabelled field. The editor already calls it this.
	 */
	const name =
		'' === field.label.trim()
			? __( 'Untitled field', 'fieldwright-checkout-fields' )
			: field.label;

	const requiredLabel = __( 'Required', 'fieldwright-checkout-fields' );
	const attentionLabel = __(
		'Needs attention',
		'fieldwright-checkout-fields'
	);
	/*
	 * Free's own status, in the shape an add-on's takes, so the row draws and
	 * announces all of them the same way. It goes first: a field the checkout
	 * will not show is the thing to say about the row before anything else it
	 * carries. Neutral rather than a warning, because nothing is wrong with the
	 * field: something that is not here draws it.
	 */
	const own: RowIndicator[] = unavailable
		? [
				{
					key: 'cbwb-unavailable',
					label: unavailableLabel(),
					tone: 'neutral',
					icon: plugins,
				},
		  ]
		: [];
	const indicators = [ ...own, ...rowIndicators( field ) ];

	/*
	 * The whole row in words: the full label when it truncates, the type when
	 * the row is too narrow to show the badge, and every status its glyphs stand
	 * for. Read out of the same values the glyphs are drawn from, so the two
	 * cannot drift apart, and a description rather than a name — the row is
	 * already announced as "<label> <type> Required".
	 */
	const tooltip = [
		name,
		typeLabel,
		...( field.required ? [ requiredLabel ] : [] ),
		...indicators.map( ( indicator ) => indicator.label ),
		...( hasErrors ? [ attentionLabel ] : [] ),
	].join( TOOLTIP_SEPARATOR );

	const className = [
		'cbwb-field-row',
		isSelected ? 'is-selected' : '',
		isDragging ? 'is-dragging' : '',
		field.enabled ? '' : 'is-disabled',
		unavailable ? 'is-inactive' : '',
		hasErrors ? 'has-errors' : '',
	]
		.filter( Boolean )
		.join( ' ' );

	return (
		<li
			ref={ setNodeRef }
			className={ className }
			style={ {
				transform: CSS.Transform.toString( transform ),
				transition: transition ?? undefined,
			} }
		>
			<Button
				size="small"
				className="cbwb-field-row__handle"
				ref={ setActivatorNodeRef }
				icon={ dragHandle }
				label={ sprintf(
					/* translators: %s: field label. */
					__( 'Drag to reorder %s', 'fieldwright-checkout-fields' ),
					name
				) }
				{ ...dragAttributes }
				{ ...listeners }
			/>

			{ /*
			 * The whole row body selects, not just the label, so the obvious
			 * target hits the obvious result. `aria-current` carries the
			 * selection for assistive tech, which is why the "Editing" chip
			 * beside it is decorative: it would otherwise say the same thing
			 * twice, inside every row's accessible name.
			 *
			 * Anchored under the row's left edge: the tooltip is as wide as the
			 * label and the statuses together, and a centred one on a 280px pane
			 * slid left until it sat on the WordPress admin menu.
			 */ }
			<Tooltip text={ tooltip } placement="bottom-start">
				<button
					type="button"
					className="cbwb-field-row__button"
					onClick={ onSelect }
					aria-current={ isSelected ? 'true' : undefined }
				>
					<span className="cbwb-field-row__label">{ name }</span>
					<span className="cbwb-field-row__badges">
						<span className="cbwb-badge cbwb-field-row__badge">
							{ typeLabel }
						</span>
						{ field.required && (
							<Indicator
								tone="required"
								label={ requiredLabel }
								icon={ REQUIRED_GLYPH }
							/>
						) }
						{ /* Add-on statuses, in the same shape as Required. */ }
						{ indicators.map( ( indicator ) => (
							<Indicator
								key={ indicator.key }
								tone={ indicator.tone }
								label={ indicator.label }
								icon={ indicator.icon }
							/>
						) ) }
						{ hasErrors && (
							<Indicator
								tone="error"
								label={ attentionLabel }
								icon={ caution }
							/>
						) }
						{ isSelected && (
							<span
								className="cbwb-badge cbwb-badge--editing"
								aria-hidden="true"
							>
								{ __(
									'Editing',
									'fieldwright-checkout-fields'
								) }
							</span>
						) }
					</span>
				</button>
			</Tooltip>

			<FormToggle
				className="cbwb-field-row__toggle"
				checked={ field.enabled }
				aria-label={ sprintf(
					/* translators: %s: field label. */
					__( 'Show %s at checkout', 'fieldwright-checkout-fields' ),
					name
				) }
				onChange={ ( event ) =>
					onToggleEnabled( event.target.checked )
				}
			/>

			<DropdownMenu
				className="cbwb-field-row__menu"
				icon={ moreVertical }
				toggleProps={ { size: 'small' } }
				label={ sprintf(
					/* translators: %s: field label. */
					__( 'Actions for %s', 'fieldwright-checkout-fields' ),
					name
				) }
				controls={ [
					{
						title: __( 'Move up', 'fieldwright-checkout-fields' ),
						icon: chevronUp,
						isDisabled: isFirst,
						onClick: () => onMove( -1 ),
					},
					{
						title: __( 'Move down', 'fieldwright-checkout-fields' ),
						icon: chevronDown,
						isDisabled: isLast,
						onClick: () => onMove( 1 ),
					},
					{
						title: __( 'Duplicate', 'fieldwright-checkout-fields' ),
						icon: copy,
						onClick: onDuplicate,
					},
					{
						title: __( 'Delete', 'fieldwright-checkout-fields' ),
						icon: trash,
						onClick: onRemove,
					},
				] }
			/>
		</li>
	);
}
