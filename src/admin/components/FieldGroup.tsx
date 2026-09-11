/**
 * One location group in the Fields outline.
 *
 * The pane is narrow, so the group's title is a small eyebrow and the sentence
 * explaining where the location lands at checkout has moved into a tooltip on
 * the `?`-style info button beside it. The way into the group is the ghost
 * "Add field" button that closes it, matching the one the preview offers on the
 * matching checkout section.
 *
 * A group holds two kinds of row — the merchant's own fields and WooCommerce's —
 * and deliberately does not separate them: WooCommerce's address form is one
 * sorted list, so the outline has to be one list too, or a merchant could not
 * see (let alone set) where their own field lands among the core ones.
 */

import {
	SortableContext,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { Button, Tooltip } from '@wordpress/components';
import { info, plus } from '@wordpress/icons';
import { Fragment } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import type { OutlineRow } from '../lib/coreFields';
import { isSortableRow } from '../lib/coreFields';
import { isSharedLocation } from '../lib/fields';
import type { ResolvedType } from '../lib/typeMeta';
import { familyOf } from '../lib/typeMeta';
import type { ErrorMap } from '../lib/validate';
import type { BuilderAction } from '../state/actions';
import { duplicate, removeField, select, updateField } from '../state/actions';
import type { FieldType, PlacementMeta } from '../types';
import CoreRow from './CoreRow';
import FieldRow from './FieldRow';
import { AddFieldPicker } from './TypePicker';

interface FieldGroupProps {
	location: PlacementMeta;
	rows: OutlineRow[];
	types: ResolvedType[];
	selectedId: string | null;
	errors: ErrorMap;
	canAdd: boolean;
	onAdd: ( type: FieldType ) => void;
	/**
	 * Moves any row a step up or down. One handler for both kinds: in the
	 * address section a merchant's field and one of WooCommerce's move through
	 * the same ordered list, so they cannot be moved by different means.
	 */
	onMove: ( id: string, delta: number ) => void;
	/** Shows or hides one of WooCommerce's own rows. */
	onToggleCore: ( row: OutlineRow, hidden: boolean ) => void;
	dispatch: ( action: BuilderAction ) => void;
}

export default function FieldGroup( {
	location,
	rows,
	types,
	selectedId,
	errors,
	canAdd,
	onAdd,
	onMove,
	onToggleCore,
	dispatch,
}: FieldGroupProps ) {
	const headingId = `cbwb-group-${ location.key }`;

	/*
	 * Only the rows that can actually move are handed to dnd-kit. A fixed row —
	 * the email address, the apartment line, the order-note box — is not a drop
	 * target either, so dropping "onto" it can never produce an order
	 * WooCommerce would refuse to draw.
	 */
	const sortable = rows.filter( isSortableRow );
	const positionOf = ( id: string ) =>
		sortable.findIndex( ( row ) => row.id === id );

	/*
	 * Where the checkout stops drawing WooCommerce's own types and starts on
	 * this plugin's, in the placements the two share. The outline is kept in
	 * that order (`settleFamilies()`), and the line says why a row will not
	 * go above it. Nothing is drawn when the group holds only one family.
	 */
	const lineBefore = isSharedLocation( location.key )
		? rows.findIndex(
				( row, index ) =>
					'field' === row.kind &&
					'core' !== familyOf( row.field.type ) &&
					rows
						.slice( 0, index )
						.some(
							( earlier ) =>
								'field' === earlier.kind &&
								'core' === familyOf( earlier.field.type )
						)
		  )
		: -1;

	return (
		<section className="cbwb-group" aria-labelledby={ headingId }>
			<div className="cbwb-group__header">
				{ /* h3: the pane's own "Fields" heading is the h2. */ }
				<h3 className="cbwb-group__title" id={ headingId }>
					{ location.label }
				</h3>
				{ /*
				 * Anchored under the button's left edge, not centred on it. The
				 * sentence is wider than the pane, and a centred tooltip dealt with
				 * that by sliding left until it sat on top of the WordPress admin
				 * menu.
				 */ }
				<Tooltip text={ location.description } placement="bottom-start">
					<Button
						size="small"
						className="cbwb-group__info"
						icon={ info }
						// `aria-label`, not `label`: `label` would make Button
						// build a second tooltip of its own around this one.
						aria-label={ __(
							'About this section',
							'fieldwright-checkout-fields'
						) }
					/>
				</Tooltip>
			</div>

			{ rows.length > 0 && (
				<SortableContext
					items={ sortable.map( ( row ) => row.id ) }
					strategy={ verticalListSortingStrategy }
				>
					<ul className="cbwb-group__list">
						{ rows.map( ( row, index ) => {
							if ( 'field' === row.kind ) {
								const field = row.field;
								const at = positionOf( row.id );

								return (
									<Fragment key={ row.id }>
										{ index === lineBefore && (
											<li
												className="cbwb-group__line"
												aria-hidden="true"
											>
												<span>
													{ __(
														'Drawn after the fields above',
														'fieldwright-checkout-fields'
													) }
												</span>
											</li>
										) }
										<FieldRow
											key={ row.id }
											field={ field }
											types={ types }
											isSelected={ row.id === selectedId }
											isFirst={ 0 === at }
											isLast={
												at === sortable.length - 1
											}
											hasErrors={ Boolean(
												errors.byField[ field.id ]
											) }
											onSelect={ () =>
												dispatch( select( field.id ) )
											}
											onToggleEnabled={ ( enabled ) =>
												dispatch(
													updateField( field.id, {
														enabled,
													} )
												)
											}
											onMove={ ( delta ) =>
												onMove( field.id, delta )
											}
											onDuplicate={ () =>
												dispatch(
													duplicate( field.id )
												)
											}
											onRemove={ () =>
												dispatch(
													removeField( field.id )
												)
											}
										/>
									</Fragment>
								);
							}

							const core =
								'core' === row.kind ? row.core : row.pseudo;
							const at = positionOf( row.id );
							const movable = isSortableRow( row );

							return (
								<CoreRow
									key={ row.id }
									row={ core }
									isSelected={ row.id === selectedId }
									isFirst={ 0 === at }
									isLast={ at === sortable.length - 1 }
									hasErrors={ Boolean(
										errors.byCore[ core.key ]
									) }
									sortable={ movable }
									isChild={
										'core' === row.kind &&
										'address_2' === row.core.key
									}
									onSelect={ () =>
										dispatch( select( row.id ) )
									}
									onToggle={ ( hidden ) =>
										onToggleCore( row, hidden )
									}
									onMove={ ( delta ) =>
										onMove( row.id, delta )
									}
								/>
							);
						} ) }
					</ul>
				</SortableContext>
			) }

			{ /*
			 * The way into a group is the type picker: the first decision about
			 * a new field is what kind of field it is, and answering it here
			 * saves a trip to the inspector to change it back.
			 */ }
			<AddFieldPicker
				types={ types }
				placement={ location.key }
				className="cbwb-add-field"
				icon={ plus }
				disabled={ ! canAdd }
				// The visible label stays short; the full name says where the
				// field would land.
				label={ sprintf(
					/* translators: %s: placement name, e.g. "Contact". */
					__( 'Add field to %s', 'fieldwright-checkout-fields' ),
					location.label
				) }
				onSelect={ onAdd }
			>
				{ __( 'Add field', 'fieldwright-checkout-fields' ) }
			</AddFieldPicker>
		</section>
	);
}
