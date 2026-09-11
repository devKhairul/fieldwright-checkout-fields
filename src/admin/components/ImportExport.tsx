import { DropdownMenu } from '@wordpress/components';
import { useRef } from '@wordpress/element';
import { download, moreVertical, upload } from '@wordpress/icons';
import { __ } from '@wordpress/i18n';

import { exportJson, parseImport } from '../lib/fields';
import type { ImportedConfig } from '../lib/fields';
import type { CoreConfig, Field } from '../types';

export const EXPORT_FILENAME = 'fieldwright-checkout-fields-fields.json';

/**
 * Read a picked file as text.
 *
 * @param file File from the hidden input.
 * @return File contents.
 */
function readAsText( file: File ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const reader = new window.FileReader();
		reader.onload = () => resolve( String( reader.result ?? '' ) );
		reader.onerror = () =>
			reject(
				new Error(
					__(
						'That file could not be read.',
						'fieldwright-checkout-fields'
					)
				)
			);
		reader.readAsText( file );
	} );
}

interface ImportExportProps {
	fields: Field[];
	schemaVersion: number;
	/**
	 * What was changed about WooCommerce's own fields. Left out on a build with
	 * no core rows, so the file it writes is exactly the file it wrote before.
	 */
	core?: CoreConfig;
	onImport: ( imported: ImportedConfig ) => void;
	onError: ( message: string ) => void;
}

/**
 * Import/export lives behind the header's "more" menu: rarely used, and a
 * primary Save button next to it should stay the obvious action.
 *
 * @param props               Component props.
 * @param props.fields        Fields to export.
 * @param props.schemaVersion Config schema version to stamp on the export.
 * @param props.core          Core-field overrides to export.
 * @param props.onImport      Called with the parsed config.
 * @param props.onError       Called with a human-readable parse failure.
 */
export default function ImportExport( {
	fields,
	schemaVersion,
	core,
	onImport,
	onError,
}: ImportExportProps ) {
	const inputRef = useRef< HTMLInputElement | null >( null );

	const onExport = () => {
		const blob = new window.Blob(
			[ exportJson( fields, schemaVersion, core ) ],
			{ type: 'application/json' }
		);
		const url = window.URL.createObjectURL( blob );
		const link = document.createElement( 'a' );
		link.href = url;
		link.download = EXPORT_FILENAME;
		document.body.appendChild( link );
		link.click();
		document.body.removeChild( link );
		window.URL.revokeObjectURL( url );
	};

	const onFile = async ( file: File | undefined ) => {
		if ( ! file ) {
			return;
		}
		try {
			onImport( parseImport( await readAsText( file ) ) );
		} catch ( error ) {
			onError(
				error instanceof Error
					? error.message
					: __(
							'That file could not be imported.',
							'fieldwright-checkout-fields'
					  )
			);
		}
	};

	return (
		<>
			<DropdownMenu
				icon={ moreVertical }
				label={ __( 'More options', 'fieldwright-checkout-fields' ) }
				controls={ [
					{
						title: __( 'Import', 'fieldwright-checkout-fields' ),
						icon: upload,
						onClick: () => inputRef.current?.click(),
					},
					{
						title: __( 'Export', 'fieldwright-checkout-fields' ),
						icon: download,
						onClick: onExport,
					},
				] }
			/>
			<input
				ref={ inputRef }
				type="file"
				accept=".json,application/json"
				className="cbwb-import-input"
				data-testid="cbwb-import-input"
				aria-hidden="true"
				tabIndex={ -1 }
				onChange={ ( event ) => {
					void onFile( event.target.files?.[ 0 ] );
					event.target.value = '';
				} }
			/>
		</>
	);
}
