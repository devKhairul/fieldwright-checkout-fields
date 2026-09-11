/**
 * One of WooCommerce's own rows in the Fields outline.
 *
 * Built to the same 40px as a merchant's own row, because they sit in one list
 * and a merchant reordering the address form should not be able to tell which
 * half of it belongs to whom. What is different is what the row *says*: the
 * WooCommerce mark instead of a type badge, no delete, no duplicate and no
 * type to change — WooCommerce decides all three — and, where WooCommerce will
 * not let go at all, a switch that is disabled rather than missing, with the
 * reason on a tooltip.
 *
 * The mark is a glyph rather than the word it started as. Spelled out, the
 * badge was as wide as the label beside it, so it could only ever appear on
 * hover — which is the one moment a merchant has already committed to the row
 * and no longer needs telling whose it is. Shrunk to a status glyph it costs
 * the label the same twelve pixels a Required asterisk does and is on every
 * core row at rest, with the word itself in hidden text and on the tooltip.
 *
 * The apartment line is a child row: WooCommerce renders it *inside* the address
 * line above it, so it is drawn indented, with no handle of its own, and it
 * travels with its parent wherever that is dropped.
 */

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
	dragHandle,
	moreVertical,
} from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';

import type { CoreRow as CoreRowData, PseudoRow } from '../lib/coreFields';
import { coreLockReason } from '../lib/coreFields';
import { coreSubject } from '../lib/fields';
import { rowIndicators } from '../lib/hooks';
import { Indicator, REQUIRED_GLYPH, TOOLTIP_SEPARATOR } from './FieldRow';

interface CoreRowProps {
	row: CoreRowData | PseudoRow;
	isSelected: boolean;
	isFirst: boolean;
	isLast: boolean;
	hasErrors: boolean;
	/** False where WooCommerce fixes the row's position. */
	sortable: boolean;
	/** True for the apartment line, drawn under the address line it lives in. */
	isChild?: boolean;
	onSelect: () => void;
	onToggle: ( hidden: boolean ) => void;
	onMove: ( delta: number ) => void;
}

/**
 * WooCommerce's mark, at the size of a status glyph: its initial in the rounded
 * box its own logo is.
 *
 * Two elements and a border-radius rather than an SVG. At 16px a stroked bubble
 * with a letter drawn inside it comes out muddy on a 1x display, where a box and
 * a font stay crisp at every device pixel ratio — and the mark has to read at
 * rest on every core row, which is the whole point of it.
 *
 * @return The mark.
 */
function WooMark() {
	return <span className="cbwb-woo-mark">W</span>;
}

export default function CoreRow( {
	row,
	isSelected,
	isFirst,
	isLast,
	hasErrors,
	sortable,
	isChild = false,
	onSelect,
	onToggle,
	onMove,
}: CoreRowProps ) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable( { id: row.id, disabled: ! sortable } );

	// dnd-kit sets an explicit role="button"; the element already is one.
	const { role: _role, ...dragAttributes } = attributes;

	const field = row as CoreRowData;
	const isPseudo = undefined === field.location;
	const locks = field.locks;

	/*
	 * A label emptied mid-edit still has a row, a switch and a menu, and without
	 * a stand-in every one of them would be announced with the same nameless
	 * name. The editor and the merchant's own rows both call it this.
	 */
	const name =
		'' === row.label.trim()
			? __( 'Untitled field', 'fieldwright-checkout-fields' )
			: row.label;

	// What the mark stands for, in the words the tooltip and the hidden text
	// both use: "WooCommerce" alone names a plugin, not the row's owner.
	const wooLabel = __(
		'WooCommerce’s own field',
		'fieldwright-checkout-fields'
	);
	const requiredLabel = __( 'Required', 'fieldwright-checkout-fields' );
	const attentionLabel = __(
		'Needs attention',
		'fieldwright-checkout-fields'
	);

	const hiddenLock = locks?.hidden
		? coreLockReason( field.key, 'hidden' )
		: '';

	/*
	 * Add-ons see core rows through the same filter as every other row, marked
	 * so they can leave them alone: WooCommerce owns everything about its own
	 * fields, so an add-on's statuses have nothing to say about them.
	 */
	const indicators = rowIndicators( coreSubject( row ) );

	const tooltip = [
		name,
		wooLabel,
		...( ! isPseudo && field.required ? [ requiredLabel ] : [] ),
		...indicators.map( ( indicator ) => indicator.label ),
		...( hasErrors ? [ attentionLabel ] : [] ),
	].join( TOOLTIP_SEPARATOR );

	const className = [
		'cbwb-field-row',
		'cbwb-field-row--core',
		isChild ? 'is-child' : '',
		isSelected ? 'is-selected' : '',
		isDragging ? 'is-dragging' : '',
		row.hidden ? 'is-disabled' : '',
		hasErrors ? 'has-errors' : '',
	]
		.filter( Boolean )
		.join( ' ' );

	const toggle = (
		<FormToggle
			className="cbwb-field-row__toggle"
			checked={ ! row.hidden }
			disabled={ Boolean( locks?.hidden ) }
			aria-label={ sprintf(
				/* translators: %s: field label. */
				__( 'Show %s at checkout', 'fieldwright-checkout-fields' ),
				name
			) }
			onChange={ ( event ) => onToggle( ! event.target.checked ) }
		/>
	);

	return (
		<li
			ref={ setNodeRef }
			className={ className }
			style={ {
				transform: CSS.Transform.toString( transform ),
				transition: transition ?? undefined,
			} }
		>
			{ sortable ? (
				<Button
					size="small"
					className="cbwb-field-row__handle"
					ref={ setActivatorNodeRef }
					icon={ dragHandle }
					label={ sprintf(
						/* translators: %s: field label. */
						__(
							'Drag to reorder %s',
							'fieldwright-checkout-fields'
						),
						name
					) }
					{ ...dragAttributes }
					{ ...listeners }
				/>
			) : (
				/*
				 * The handle's width, kept: without it every fixed row would sit
				 * a handle to the left of the rows around it, and the outline
				 * would read as two lists rather than one.
				 */
				<span
					className="cbwb-field-row__handle-space"
					aria-hidden="true"
				/>
			) }

			<Tooltip text={ tooltip } placement="bottom-start">
				<button
					type="button"
					className="cbwb-field-row__button"
					onClick={ onSelect }
					aria-current={ isSelected ? 'true' : undefined }
				>
					<span className="cbwb-field-row__label">{ name }</span>
					<span className="cbwb-field-row__badges">
						{ /*
						 * The mark says whose field this is, which is the one
						 * thing a merchant has to know before they wonder why
						 * they cannot delete it — so it is drawn like a status
						 * rather than a badge, and never steps aside for the
						 * label the way a type badge does.
						 */ }
						<Indicator
							tone="core"
							label={ wooLabel }
							icon={ <WooMark /> }
						/>
						{ ! isPseudo && field.required && (
							<Indicator
								tone="required"
								label={ requiredLabel }
								icon={ REQUIRED_GLYPH }
							/>
						) }
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

			{ /*
			 * A disabled switch cannot be hovered in every browser and cannot be
			 * focused in any, so the reason hangs on a wrapper around it rather
			 * than on the control — and is repeated in the settings pane, which
			 * is where a keyboard reaches it.
			 */ }
			{ hiddenLock ? (
				<Tooltip text={ hiddenLock } placement="bottom-end">
					<span className="cbwb-field-row__lock">{ toggle }</span>
				</Tooltip>
			) : (
				toggle
			) }

			{ sortable ? (
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
							title: __(
								'Move up',
								'fieldwright-checkout-fields'
							),
							icon: chevronUp,
							isDisabled: isFirst,
							onClick: () => onMove( -1 ),
						},
						{
							title: __(
								'Move down',
								'fieldwright-checkout-fields'
							),
							icon: chevronDown,
							isDisabled: isLast,
							onClick: () => onMove( 1 ),
						},
					] }
				/>
			) : (
				/* Same reason as the handle: the row has to line up. */
				<span
					className="cbwb-field-row__menu-space"
					aria-hidden="true"
				/>
			) }
		</li>
	);
}
