import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	RadioControl,
	ToggleControl,
} from '@wordpress/components';
import { useState } from '@wordpress/element';
import { applyFilters } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';
import type { ReactNode } from 'react';

import { saveSettings, toApiError } from '../lib/api';
import { FILTERS } from '../lib/hooks';
import { getBootstrap, markingOf } from '../types';
import type { AdminBootstrap, RequiredMarking, Settings } from '../types';

/**
 * A panel an add-on adds to the Settings tab.
 *
 * The way an add-on puts its own settings — a licence key, an export tool — on
 * a screen it does not own. Rendered after Free's own panels, in the order the
 * filter left them, each inside the same card the built-in ones use so the tab
 * reads as one screen rather than a host and its guests.
 */
export interface SettingsSection {
	/** Unique among sections. Used as the React key. */
	key: string;
	/** Card heading. Sentence case, like the built-in ones. */
	title: string;
	/** One line under the heading. Optional. */
	description?: string;
	/** The panel's body. */
	render: ( context: { bootstrap: AdminBootstrap } ) => ReactNode;
}

interface SettingsTabProps {
	settings: Settings;
	onSaved: ( settings: Settings ) => void;
	onNotify: ( message: string ) => void;
}

/**
 * The sections an add-on asked to add, with anything malformed dropped.
 *
 * A filter is a place another plugin's code runs, so what comes back is checked
 * rather than trusted: a section without a working `render` would take the whole
 * Settings tab down with it, and the merchant would have no way to tell which
 * plugin did it.
 *
 * @param bootstrap Everything the server sent.
 * @return The sections to render.
 */
export function extraSections( bootstrap: AdminBootstrap ): SettingsSection[] {
	const filtered = applyFilters(
		FILTERS.settingsSections,
		[] as SettingsSection[],
		bootstrap
	);

	if ( ! Array.isArray( filtered ) ) {
		return [];
	}

	const seen = new Set< string >();

	return filtered.filter( ( section ): section is SettingsSection => {
		if ( ! section || 'object' !== typeof section ) {
			return false;
		}

		const { key, title, render } = section as Partial< SettingsSection >;

		if (
			'string' !== typeof key ||
			'' === key ||
			'string' !== typeof title ||
			'function' !== typeof render ||
			seen.has( key )
		) {
			return false;
		}

		seen.add( key );

		return true;
	} );
}

export default function SettingsTab( {
	settings,
	onSaved,
	onNotify,
}: SettingsTabProps ) {
	const [ value, setValue ] = useState< Settings >( settings );
	const [ saving, setSaving ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );

	const marking = markingOf( value );
	// Absent on a bootstrap written before the setting existed, which is the
	// same thing as "on": the line is what explains the asterisk.
	const note = false !== value.required_note;

	const dirty =
		value.remove_data_on_uninstall !== settings.remove_data_on_uninstall ||
		marking !== markingOf( settings ) ||
		note !== ( false !== settings.required_note );

	const bootstrap = getBootstrap();
	const sections = extraSections( bootstrap );

	const save = async () => {
		setSaving( true );
		setError( null );
		try {
			const next = await saveSettings( value );
			setValue( next );
			onSaved( next );
			onNotify( __( 'Settings saved.', 'fieldwright-checkout-fields' ) );
		} catch ( caught ) {
			setError(
				toApiError( caught ).message ??
					__( 'Something went wrong.', 'fieldwright-checkout-fields' )
			);
		} finally {
			setSaving( false );
		}
	};

	return (
		<div className="cbwb-settings">
			{ error && (
				<Notice status="error" onRemove={ () => setError( null ) }>
					{ error }
				</Notice>
			) }
			<Card className="cbwb-settings__card">
				<CardHeader>
					<h2 className="cbwb-settings__title">
						{ __(
							'Required fields',
							'fieldwright-checkout-fields'
						) }
					</h2>
				</CardHeader>
				<CardBody>
					<RadioControl
						label={ __(
							'Required fields',
							'fieldwright-checkout-fields'
						) }
						hideLabelFromVision
						help={ __(
							"WooCommerce's own fields, the fields it carries for you and the ones Fieldwright draws itself all follow this setting.",
							'fieldwright-checkout-fields'
						) }
						selected={ marking }
						options={ [
							{
								value: 'optional_label',
								label: __(
									'Say "(optional)" after optional fields',
									'fieldwright-checkout-fields'
								),
							},
							{
								value: 'asterisk',
								label: __(
									'Mark required fields with an asterisk',
									'fieldwright-checkout-fields'
								),
							},
						] }
						onChange={ ( next ) =>
							setValue( {
								...value,
								required_marking: next as RequiredMarking,
							} )
						}
					/>
					{ /*
					 * Only under the asterisk: the line it explains is not on the
					 * checkout the other way round, so a switch for it there would
					 * be a setting with nothing to do.
					 */ }
					{ 'asterisk' === marking && (
						<ToggleControl
							__nextHasNoMarginBottom
							className="cbwb-settings__follow-up"
							label={ __(
								'Show "Fields marked with an asterisk are required." at the top of the checkout',
								'fieldwright-checkout-fields'
							) }
							checked={ note }
							onChange={ ( show ) =>
								setValue( { ...value, required_note: show } )
							}
						/>
					) }
				</CardBody>
			</Card>
			<Card className="cbwb-settings__card">
				<CardHeader>
					<h2 className="cbwb-settings__title">
						{ __( 'Data', 'fieldwright-checkout-fields' ) }
					</h2>
				</CardHeader>
				<CardBody>
					<ToggleControl
						__nextHasNoMarginBottom
						label={ __(
							'Remove all plugin data when the plugin is deleted',
							'fieldwright-checkout-fields'
						) }
						help={ __(
							'Field definitions and settings are deleted. Values already saved on orders are kept.',
							'fieldwright-checkout-fields'
						) }
						checked={ value.remove_data_on_uninstall }
						onChange={ ( remove ) =>
							setValue( {
								...value,
								remove_data_on_uninstall: remove,
							} )
						}
					/>
				</CardBody>
			</Card>
			{ /*
			 * One button for both panels above, and outside either of them: the
			 * two are one form, and a Save that lived in the second card would
			 * read as though it only saved that card.
			 */ }
			<div className="cbwb-settings__actions">
				<Button
					__next40pxDefaultSize
					variant="primary"
					disabled={ ! dirty || saving }
					accessibleWhenDisabled
					isBusy={ saving }
					onClick={ save }
				>
					{ __( 'Save settings', 'fieldwright-checkout-fields' ) }
				</Button>
			</div>
			{ sections.map( ( section ) => (
				<Card className="cbwb-settings__card" key={ section.key }>
					<CardHeader>
						<h2 className="cbwb-settings__title">
							{ section.title }
						</h2>
					</CardHeader>
					<CardBody>
						{ section.description && (
							<p className="cbwb-settings__description">
								{ section.description }
							</p>
						) }
						{ section.render( { bootstrap } ) }
					</CardBody>
				</Card>
			) ) }
		</div>
	);
}
