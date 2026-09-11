import { Button } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

import { metaFor } from '../lib/typeMeta';
import type { Field, PlacementMeta, TypeMeta } from '../types';

interface TemplateCardProps {
	template: Field;
	placements: PlacementMeta[];
	types: TypeMeta[];
	onAdd: () => void;
}

export default function TemplateCard( {
	template,
	placements,
	types,
	onAdd,
}: TemplateCardProps ) {
	const typeLabel =
		types.find( ( type ) => type.key === template.type )?.label ??
		metaFor( template.type ).label;
	const locationLabel =
		placements.find( ( location ) => location.key === template.location )
			?.label ?? template.location;

	return (
		<li className="cbwb-template">
			<h3 className="cbwb-template__label">{ template.label }</h3>
			<p className="cbwb-template__meta">
				{ sprintf(
					/* translators: 1: field type, 2: checkout section. */
					__( '%1$s in %2$s', 'fieldwright-checkout-fields' ),
					typeLabel,
					locationLabel
				) }
			</p>
			<Button
				__next40pxDefaultSize
				variant="secondary"
				onClick={ onAdd }
				label={ sprintf(
					/* translators: %s: template name. */
					__( 'Add %s', 'fieldwright-checkout-fields' ),
					template.label
				) }
			>
				{ __( 'Add', 'fieldwright-checkout-fields' ) }
			</Button>
		</li>
	);
}
