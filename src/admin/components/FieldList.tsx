import type { Announcements, DragEndEvent } from '@dnd-kit/core';
import {
	DndContext,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

import { useMemo } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import type { CoreRow, OutlineRow, PseudoRow } from '../lib/coreFields';
import {
	buildOutline,
	isSortableRow,
	moveAddressRow,
	stepAddressRow,
} from '../lib/coreFields';
import type { FieldsByLocation } from '../lib/fields';
import type { ResolvedType } from '../lib/typeMeta';
import type { ErrorMap } from '../lib/validate';
import type { BuilderAction } from '../state/actions';
import {
	move,
	reorder,
	reorderAddress,
	setPseudo,
	updateCore,
} from '../state/actions';
import type { FieldLocation, FieldType, PlacementMeta } from '../types';
import FieldGroup from './FieldGroup';

interface FieldListProps {
	groups: FieldsByLocation;
	/** Every placement, in checkout order: one group each. */
	placements: PlacementMeta[];
	types: ResolvedType[];
	selectedId: string | null;
	errors: ErrorMap;
	canAdd: boolean;
	/**
	 * The merchant's own fields, and how many rows the configuration can hold
	 * at all. The ceiling is the same for every store: it is what one option
	 * row can carry, not something anybody is sold out of.
	 */
	used: number;
	limit: number;
	/** WooCommerce's own fields, with every override applied. */
	coreRows: CoreRow[];
	/** The order-note box and the coupon form. */
	pseudoRows: PseudoRow[];
	/** The address section, top to bottom: core rows and custom fields mixed. */
	addressOrder: string[];
	/** False on a server that has no core rows to offer. */
	hasCore: boolean;
	onAdd: ( location: FieldLocation, type: FieldType ) => void;
	dispatch: ( action: BuilderAction ) => void;
}

export default function FieldList( {
	groups,
	placements,
	types,
	selectedId,
	errors,
	canAdd,
	used,
	limit,
	coreRows,
	pseudoRows,
	addressOrder,
	hasCore,
	onAdd,
	dispatch,
}: FieldListProps ) {
	const sensors = useSensors(
		useSensor( PointerSensor, {
			activationConstraint: { distance: 4 },
		} ),
		useSensor( KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		} )
	);

	/*
	 * The whole outline, section by section. Everything below reads positions
	 * out of this rather than out of the field array, because with core rows in
	 * the list the two are no longer the same thing.
	 */
	const rows = useMemo( () => {
		const built = {} as Record< FieldLocation, OutlineRow[] >;

		placements.forEach( ( placement ) => {
			built[ placement.key ] = buildOutline(
				placement.key,
				groups[ placement.key ],
				coreRows,
				pseudoRows,
				addressOrder,
				hasCore
			);
		} );

		return built;
	}, [ placements, groups, coreRows, pseudoRows, addressOrder, hasCore ] );

	/** Every row in the outline, whichever section it is in. */
	const allRows = useMemo(
		() => Object.values( rows ).flat(),
		[ rows ]
	) as OutlineRow[];

	const labelOf = ( id: string | number | undefined ) => {
		const row = allRows.find( ( candidate ) => candidate.id === id );
		if ( ! row ) {
			return '';
		}
		return 'field' === row.kind
			? row.field.label
			: ( 'core' === row.kind ? row.core : row.pseudo ).label;
	};

	/**
	 * Which section a row is in, and where in it.
	 *
	 * @param id Outline row id.
	 * @return The section and the row's position in it, or null.
	 */
	const seatOf = ( id: string | number | undefined ) => {
		const location = ( Object.keys( rows ) as FieldLocation[] ).find(
			( key ) => rows[ key ].some( ( row ) => row.id === id )
		);
		if ( ! location ) {
			return null;
		}
		// Counted against the rows that can actually move: "3 of 11" would be a
		// lie in a list where two of the eleven are pinned.
		const movable = rows[ location ].filter( isSortableRow );
		return {
			location,
			index: movable.findIndex( ( row ) => row.id === id ) + 1,
			total: movable.length,
		};
	};

	const positionOf = ( id: string | number | undefined ) =>
		seatOf( id ) ?? { index: 0, total: 0 };

	const announcements: Announcements = useMemo(
		() => ( {
			onDragStart( { active } ) {
				return sprintf(
					/* translators: %s: field label. */
					__(
						'Picked up %s. Use the arrow keys to move it, space to drop it, escape to cancel.',
						'fieldwright-checkout-fields'
					),
					labelOf( active.id )
				);
			},
			onDragOver( { active, over } ) {
				if ( ! over ) {
					return undefined;
				}
				const { index, total } = positionOf( over.id );
				return sprintf(
					/* translators: 1: field label, 2: new position, 3: number of fields in the group. */
					__(
						'%1$s is now at position %2$d of %3$d.',
						'fieldwright-checkout-fields'
					),
					labelOf( active.id ),
					index,
					total
				);
			},
			onDragEnd( { active, over } ) {
				if ( ! over ) {
					return sprintf(
						/* translators: %s: field label. */
						__(
							'%s was dropped back in its original position.',
							'fieldwright-checkout-fields'
						),
						labelOf( active.id )
					);
				}
				const { index, total } = positionOf( over.id );
				return sprintf(
					/* translators: 1: field label, 2: new position, 3: number of fields in the group. */
					__(
						'%1$s was dropped at position %2$d of %3$d.',
						'fieldwright-checkout-fields'
					),
					labelOf( active.id ),
					index,
					total
				);
			},
			onDragCancel( { active } ) {
				return sprintf(
					/* translators: %s: field label. */
					__(
						'Reordering cancelled. %s stayed where it was.',
						'fieldwright-checkout-fields'
					),
					labelOf( active.id )
				);
			},
		} ),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- Announcements read the latest rows through the closures above.
		[ rows ]
	);

	const onDragEnd = ( event: DragEndEvent ) => {
		const { active, over } = event;
		if ( ! over || active.id === over.id ) {
			return;
		}

		const from = seatOf( active.id );
		const to = seatOf( over.id );

		// Reordering only ever happens inside one section.
		if ( ! from || ! to || from.location !== to.location ) {
			return;
		}

		/*
		 * The address section is one list of WooCommerce's fields and the
		 * merchant's own, so its order is stored as one list too — which is what
		 * WooCommerce is handed. Every other section is only ever fields.
		 */
		if ( hasCore && 'address' === from.location ) {
			dispatch(
				reorderAddress(
					moveAddressRow(
						addressOrder,
						String( active.id ),
						String( over.id )
					)
				)
			);
			return;
		}

		const group = groups[ from.location ];
		dispatch(
			reorder(
				from.location,
				group.findIndex( ( field ) => field.id === active.id ),
				group.findIndex( ( field ) => field.id === over.id )
			)
		);
	};

	const onMove = ( location: FieldLocation, id: string, delta: number ) => {
		if ( hasCore && 'address' === location ) {
			dispatch(
				reorderAddress( stepAddressRow( addressOrder, id, delta ) )
			);
			return;
		}
		dispatch( move( id, delta ) );
	};

	const onToggleCore = ( row: OutlineRow, hidden: boolean ) => {
		if ( 'pseudo' === row.kind ) {
			dispatch( setPseudo( row.pseudo.key, hidden ) );
			return;
		}
		if ( 'core' === row.kind ) {
			dispatch( updateCore( row.core.key, { hidden } ) );
		}
	};

	return (
		<section
			className="cbwb-pane cbwb-pane--fields cbwb-list"
			aria-label={ __( 'Fields', 'fieldwright-checkout-fields' ) }
			/*
			 * Not a tab stop, but focusable in code: deleting the last field
			 * leaves no row for focus to land on, and the pane is the nearest
			 * thing to where the merchant was standing.
			 */
			tabIndex={ -1 }
		>
			<div className="cbwb-pane__header">
				<h2 className="cbwb-pane__title cbwb-list__title">
					{ __( 'Fields', 'fieldwright-checkout-fields' ) }
				</h2>
				{ /*
				 * "6 of 50" beside a heading called Fields is clear enough to
				 * look at and says nothing at all to a screen reader, which
				 * hears the two as separate strings. It counts the merchant's
				 * own fields only: the ceiling is theirs, and WooCommerce's own
				 * rows are not something they can add or remove.
				 */ }
				<p className="cbwb-list__count">
					<span aria-hidden="true">
						{ sprintf(
							/* translators: 1: number of fields in use, 2: maximum number of fields. */
							__( '%1$d of %2$d', 'fieldwright-checkout-fields' ),
							used,
							limit
						) }
					</span>
					<span className="cbwb-visually-hidden">
						{ sprintf(
							/* translators: 1: number of fields in use, 2: maximum number of fields. */
							__(
								'%1$d of %2$d fields used',
								'fieldwright-checkout-fields'
							),
							used,
							limit
						) }
					</span>
				</p>
			</div>

			<div className="cbwb-pane__body">
				<DndContext
					sensors={ sensors }
					collisionDetection={ closestCenter }
					accessibility={ { announcements } }
					onDragEnd={ onDragEnd }
				>
					{ placements.map( ( location ) => (
						<FieldGroup
							key={ location.key }
							location={ location }
							rows={ rows[ location.key ] }
							types={ types }
							selectedId={ selectedId }
							errors={ errors }
							canAdd={ canAdd }
							onAdd={ ( type ) => onAdd( location.key, type ) }
							onMove={ ( id, delta ) =>
								onMove( location.key, id, delta )
							}
							onToggleCore={ onToggleCore }
							dispatch={ dispatch }
						/>
					) ) }
				</DndContext>
			</div>
		</section>
	);
}
