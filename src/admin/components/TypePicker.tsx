/**
 * The field-type picker.
 *
 * Fourteen types is too many for a segmented control and too few for a search
 * box, so they are laid out as a grid of four named groups — the way a merchant
 * already thinks about them: things you type into, things you choose from, long
 * answers and dates, and words that are not a question at all. Each one names
 * itself, shows its icon and says in one line what it is for, so the choice is
 * made in the picker rather than by trying a type and reading the settings that
 * appear.
 *
 * The same grid is the way a field is created: the outline's "Add field", the
 * canvas's ghost buttons and the empty state's "Start from scratch" all open it,
 * and the type that is picked is the type the new field is born as. In that mode
 * the grid is filtered to the types the placement will accept, so a picker
 * opened under Shipping options never offers a type that cannot go there.
 *
 * A type an add-on registered is offered here beside the builder's own, in
 * whichever group the add-on named. A type nothing can render right now is not
 * offered at all: there is no picking it, and a card that could not be pressed
 * would be a row of the grid that does nothing.
 */

import type { ReactNode } from 'react';

import { Button, Dropdown, Icon } from '@wordpress/components';
import { useInstanceId } from '@wordpress/compose';
import { useCallback, useEffect, useRef } from '@wordpress/element';
import { chevronDown } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';

import { PRO_URL } from '../lib/pro';
import type { ResolvedType, TypeGroupKey } from '../lib/typeMeta';
import { TYPE_GROUP_ORDER, typeGroupLabels } from '../lib/typeMeta';
import type { FieldLocation, FieldType } from '../types';

/** What `Dropdown` hands its toggle. */
interface ToggleArgs {
	isOpen: boolean;
	onToggle: () => void;
}

/** An `@wordpress/icons` export, as `Button`'s `icon` prop takes it. */
type IconElement = typeof chevronDown;

interface TypeGridProps {
	types: ResolvedType[];
	/** The type the field has today, if it has one. */
	value?: FieldType;
	onPick: ( type: FieldType ) => void;
	/** Prefix for the ids that tie each option to its description. */
	instanceId: string;
}

/**
 * The grid itself: four groups of buttons, walked with the arrow keys.
 *
 * @param props            Component props.
 * @param props.types      Types to offer, already filtered.
 * @param props.value      The current type, marked as chosen.
 * @param props.onPick     Called with the type that was picked.
 * @param props.instanceId Prefix for the description ids.
 */
function TypeGrid( { types, value, onPick, instanceId }: TypeGridProps ) {
	const gridRef = useRef< HTMLDivElement | null >( null );
	const groupLabels = typeGroupLabels();

	// Open on the type the field already has, so the picker starts where the
	// merchant left off rather than at "Text" every time.
	useEffect( () => {
		const root = gridRef.current;
		if ( ! root ) {
			return;
		}
		const target =
			root.querySelector< HTMLButtonElement >(
				`[data-cbwb-type="${ value }"]`
			) ?? root.querySelector< HTMLButtonElement >( '[data-cbwb-type]' );
		target?.focus();
	}, [ value ] );

	const onKeyDown = useCallback( ( event: React.KeyboardEvent ) => {
		const keys = [ 'ArrowDown', 'ArrowUp', 'Home', 'End' ];
		if ( ! keys.includes( event.key ) ) {
			return;
		}

		const root = gridRef.current;
		if ( ! root ) {
			return;
		}

		const options = Array.from(
			root.querySelectorAll< HTMLButtonElement >( '[data-cbwb-type]' )
		);
		// The popover may be rendered into another document (an iframed editor
		// canvas), so the grid's own document is the one to ask.
		const current = options.indexOf(
			root.ownerDocument.activeElement as HTMLButtonElement
		);
		if ( -1 === current ) {
			return;
		}

		event.preventDefault();

		let next = current;
		if ( 'ArrowDown' === event.key ) {
			next = ( current + 1 ) % options.length;
		} else if ( 'ArrowUp' === event.key ) {
			next = ( current - 1 + options.length ) % options.length;
		} else if ( 'Home' === event.key ) {
			next = 0;
		} else {
			next = options.length - 1;
		}

		options[ next ]?.focus();
	}, [] );

	const groups = TYPE_GROUP_ORDER.map( ( group: TypeGroupKey ) => ( {
		group,
		label: groupLabels[ group ],
		types: types.filter( ( type ) => type.group === group ),
	} ) ).filter( ( entry ) => entry.types.length > 0 );

	return (
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions -- The handler only moves focus between the buttons inside, which are the interactive elements.
		<div
			className="cbwb-type-picker__panel"
			ref={ gridRef }
			onKeyDown={ onKeyDown }
		>
			{ groups.map( ( entry ) => (
				<div
					className="cbwb-type-picker__group"
					key={ entry.group }
					role="group"
					aria-label={ entry.label }
				>
					<p className="cbwb-type-picker__group-title">
						{ entry.label }
					</p>
					<div className="cbwb-type-picker__grid">
						{ entry.types.map( ( type ) => (
							<button
								type="button"
								key={ type.key }
								data-cbwb-type={ type.key }
								className={ [
									'cbwb-type-option',
									type.key === value ? 'is-current' : '',
								]
									.filter( Boolean )
									.join( ' ' ) }
								aria-pressed={ type.key === value }
								/*
								 * The name is the type's name and nothing else;
								 * the line under it is what it is *for*, which
								 * is a description, not part of the name.
								 */
								aria-label={ type.label }
								aria-describedby={ `${ instanceId }-${ type.key }` }
								onClick={ () => onPick( type.key ) }
							>
								<Icon
									className="cbwb-type-option__icon"
									icon={ type.icon }
									size={ 20 }
								/>
								<span className="cbwb-type-option__name">
									{ type.label }
								</span>
								<span
									className="cbwb-type-option__description"
									id={ `${ instanceId }-${ type.key }` }
								>
									{ type.description }
								</span>
							</button>
						) ) }
					</div>
				</div>
			) ) }
			{ /*
			 * The paid add-on, where a merchant looking for a type the plugin
			 * does not have is already looking. The same restraint everywhere it
			 * is named: no tags on cards, no panels standing in for settings, and
			 * nothing that interrupts what the merchant came here to do.
			 */ }
			<p className="cbwb-type-picker__more">
				<a href={ PRO_URL } target="_blank" rel="noopener noreferrer">
					{ __(
						'More field types and rules are available in Fieldwright Pro.',
						'fieldwright-checkout-fields'
					) }
				</a>
			</p>
		</div>
	);
}

interface TypePickerProps {
	types: ResolvedType[];
	/** The current type. Left out when the picker is creating a field. */
	value?: FieldType;
	/** Restricts the grid to the types this placement accepts. */
	placement?: FieldLocation;
	onSelect: ( type: FieldType ) => void;
	/**
	 * The control that opens the grid. Left out for the field editor's own
	 * toggle, which names the type it is showing.
	 */
	renderToggle?: ( args: ToggleArgs ) => ReactNode;
	className?: string;
}

/**
 * A dropdown whose menu is the type grid.
 *
 * @param props              Component props.
 * @param props.types        Every type, resolved.
 * @param props.value        The current type.
 * @param props.placement    Placement the picked type has to allow.
 * @param props.onSelect     Called with the picked type.
 * @param props.renderToggle Custom toggle; defaults to the editor's control.
 * @param props.className    Extra class for the wrapper.
 */
export default function TypePicker( {
	types,
	value,
	placement,
	onSelect,
	renderToggle,
	className,
}: TypePickerProps ) {
	const instanceId = useInstanceId( TypePicker, 'cbwb-type-picker' );
	const labelId = `${ instanceId }__label`;
	const valueId = `${ instanceId }__value`;
	const helpId = `${ instanceId }__help`;

	/*
	 * A type nothing can render is never on the grid, whatever placement the
	 * picker was opened for: the fields that already carry one are kept and
	 * editable, but there is no building another.
	 */
	const available = types.filter( ( type ) => type.available );
	const offered = placement
		? available.filter( ( type ) => type.placements.includes( placement ) )
		: available;

	// Looked up in the whole list rather than the offered one, so the toggle can
	// name the type a field carries even when the picker would not offer it.
	const current = types.find( ( type ) => type.key === value );

	const dropdown = (
		<Dropdown
			className="cbwb-type-picker__dropdown"
			popoverProps={ {
				placement: 'bottom-start',
				className: 'cbwb-type-picker__popover',
				/*
				 * Fourteen types are taller than the room under a button in the
				 * middle of a pane. `flip` and `resize` are core's defaults and
				 * do most of the work — turn the grid upwards, then cap it to
				 * the space that is left and scroll it; `shift` is not, and
				 * without it a picker near an edge is left hanging over it.
				 */
				flip: true,
				resize: true,
				shift: true,
				/*
				 * The grid is a menu of choices, not a reveal: the merchant is
				 * already reaching for it, and a fade means the row they were
				 * aiming at arrives late. It also keeps the popover's state
				 * settled by the time it has rendered.
				 */
				animate: false,
			} }
			renderToggle={ ( { isOpen, onToggle }: ToggleArgs ) =>
				renderToggle ? (
					renderToggle( { isOpen, onToggle } )
				) : (
					<Button
						__next40pxDefaultSize
						className="cbwb-type-picker__toggle"
						variant="secondary"
						aria-expanded={ isOpen }
						aria-haspopup="true"
						aria-labelledby={ `${ labelId } ${ valueId }` }
						aria-describedby={ helpId }
						onClick={ onToggle }
					>
						{ current && (
							<Icon
								className="cbwb-type-option__icon"
								icon={ current.icon }
								size={ 20 }
							/>
						) }
						<span
							className="cbwb-type-picker__value"
							id={ valueId }
						>
							{ current?.label ??
								__(
									'Choose a type',
									'fieldwright-checkout-fields'
								) }
						</span>
						<Icon
							className="cbwb-type-picker__chevron"
							icon={ chevronDown }
							size={ 20 }
						/>
					</Button>
				)
			}
			renderContent={ ( { onClose }: { onClose: () => void } ) => (
				<TypeGrid
					types={ offered }
					value={ value }
					instanceId={ instanceId }
					onPick={ ( type ) => {
						onSelect( type );
						onClose();
					} }
				/>
			) }
		/>
	);

	if ( renderToggle ) {
		return dropdown;
	}

	return (
		<div
			className={ [ 'cbwb-type-picker', className ]
				.filter( Boolean )
				.join( ' ' ) }
		>
			<span className="cbwb-type-picker__label" id={ labelId }>
				{ __( 'Type', 'fieldwright-checkout-fields' ) }
			</span>
			{ dropdown }
			<p className="cbwb-type-picker__help" id={ helpId }>
				{ current?.description ?? '' }
			</p>
		</div>
	);
}

interface AddFieldPickerProps {
	types: ResolvedType[];
	/** Placement the new field lands in. */
	placement: FieldLocation;
	/** The button's accessible name, which says where the field would go. */
	label: string;
	/** Visible button text. */
	children: ReactNode;
	/** True at the storage ceiling, where nothing at all can be added. */
	disabled: boolean;
	className?: string;
	variant?: 'tertiary' | 'secondary' | 'primary';
	icon?: IconElement;
	onSelect: ( type: FieldType ) => void;
}

/**
 * A ghost "Add field" button that opens the type grid.
 *
 * @param props           Component props.
 * @param props.types     Every type, resolved.
 * @param props.placement Where the new field lands.
 * @param props.label     Accessible name for the button.
 * @param props.children  Visible button text.
 * @param props.disabled  True at the storage ceiling.
 * @param props.className Extra class for the button.
 * @param props.variant   Button variant.
 * @param props.icon      Button icon.
 * @param props.onSelect  Called with the picked type.
 */
export function AddFieldPicker( {
	types,
	placement,
	label,
	children,
	disabled,
	className,
	variant = 'tertiary',
	icon,
	onSelect,
}: AddFieldPickerProps ) {
	return (
		<TypePicker
			types={ types }
			placement={ placement }
			onSelect={ onSelect }
			renderToggle={ ( { isOpen, onToggle } ) => (
				<Button
					__next40pxDefaultSize
					variant={ variant }
					className={ className }
					icon={ icon }
					disabled={ disabled }
					accessibleWhenDisabled
					aria-expanded={ isOpen }
					aria-haspopup="true"
					aria-label={ label }
					onClick={ onToggle }
				>
					{ children }
				</Button>
			) }
		/>
	);
}
