/**
 * What the canvas shows before there is anything to preview.
 *
 * The way out that always works is building a field, so that is the button the
 * heading carries; the ten starter templates are the shortcut, and they sit
 * under it as a grid tight enough that the whole set is on screen at once in a
 * column a third of the builder wide.
 */

import { Card, CardBody, CardHeader } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import type { ResolvedType } from '../lib/typeMeta';
import type { Field, FieldType, PlacementMeta } from '../types';
import TemplateCard from './TemplateCard';
import { AddFieldPicker } from './TypePicker';

/** Ties the grid of templates to the line that introduces it. */
const TEMPLATES_LABEL_ID = 'cbwb-empty-templates';

interface EmptyStateProps {
	templates: Field[];
	placements: PlacementMeta[];
	types: ResolvedType[];
	onAddTemplate: ( template: Field ) => void;
	/** Adds a blank field of the picked type to Order information. */
	onAddBlank: ( type: FieldType ) => void;
}

export default function EmptyState( {
	templates,
	placements,
	types,
	onAddTemplate,
	onAddBlank,
}: EmptyStateProps ) {
	return (
		<Card className="cbwb-empty">
			<CardHeader className="cbwb-empty__header">
				<div>
					<h2 className="cbwb-empty__title">
						{ __(
							'Add your first checkout field',
							'fieldwright-checkout-fields'
						) }
					</h2>
					<p className="cbwb-empty__subtitle">
						{ __(
							'Build your own, or start from a common field.',
							'fieldwright-checkout-fields'
						) }
					</p>
				</div>
				{ /*
				 * "Build your own" starts with what kind of field it is, so the
				 * same picker the rest of the builder uses opens here too.
				 */ }
				<AddFieldPicker
					types={ types }
					placement="order"
					variant="primary"
					className="cbwb-empty__scratch"
					disabled={ false }
					label={ __(
						'Start from scratch',
						'fieldwright-checkout-fields'
					) }
					onSelect={ onAddBlank }
				>
					{ __(
						'Start from scratch',
						'fieldwright-checkout-fields'
					) }
				</AddFieldPicker>
			</CardHeader>
			<CardBody>
				<p className="cbwb-empty__lead" id={ TEMPLATES_LABEL_ID }>
					{ __(
						'Or start from a template',
						'fieldwright-checkout-fields'
					) }
				</p>
				<ul
					className="cbwb-empty__grid"
					aria-labelledby={ TEMPLATES_LABEL_ID }
				>
					{ templates.map( ( template ) => (
						<TemplateCard
							key={ template.id }
							template={ template }
							placements={ placements }
							types={ types }
							onAdd={ () => onAddTemplate( template ) }
						/>
					) ) }
				</ul>
			</CardBody>
		</Card>
	);
}
