/**
 * The inspector for the field selected in the list.
 *
 * One card, not cards inside cards: a tinted header band names the field being
 * edited (and offers the way out of it), then divider-separated sections group
 * the settings by the question they answer. Only Advanced folds away, because
 * it is the only part a merchant can finish the job without.
 *
 * Every section is written for the type in front of it. A field never shows a
 * setting that would do nothing — a step on a dropdown, a date range on a
 * checkbox — and never hides one that would: with fourteen types of its own and
 * however many an add-on brought, "what can this field do?" has to be answerable
 * by reading the pane rather than by knowing the manual.
 */

import type { ReactNode } from 'react';

import {
	Button,
	CheckboxControl,
	Flex,
	FlexBlock,
	FlexItem,
	Panel,
	PanelBody,
	SelectControl,
	TextControl,
	TextareaControl,
	ToggleControl,
} from '@wordpress/components';
import { useEffect, useMemo, useState } from '@wordpress/element';
import { useInstanceId } from '@wordpress/compose';
import { close, copy } from '@wordpress/icons';
import { __, _n, sprintf } from '@wordpress/i18n';

import {
	DEFAULT_ROWS,
	MAX_ROWS,
	MIN_ROWS,
	canSaveToProfile,
	collectsAnswer,
	hasDefaultValue,
	isCoreType,
	isTextInput,
	maxLengthCeiling,
	usesOptions,
	usesWidth,
} from '../lib/fields';
import type { EditorSectionContext, SectionPlacement } from '../lib/hooks';
import { editorSections } from '../lib/hooks';
import {
	descriptorFor,
	familyOf,
	metaFor,
	placementsForType,
	resolvePlacements,
	resolveTypes,
	unavailableLabel,
} from '../lib/typeMeta';
import type { FieldErrors } from '../lib/validate';
import { errorFor } from '../lib/validate';
import type {
	AdminBootstrap,
	ContentLevel,
	Field,
	FieldLocation,
	FieldVisibility,
	FieldWidth,
	OptionsLayout,
	PlacementMeta,
	ValidationError,
} from '../types';
import OptionsEditor from './OptionsEditor';
import SegmentedControl from './SegmentedControl';
import TypePicker from './TypePicker';

interface EditorHeaderProps {
	/** The field's own name, or the pane's purpose when nothing is selected. */
	title: string;
	chips?: ReactNode;
	/** Omitted by the empty state, which has nothing to close. */
	onClose?: () => void;
	/** Every message the field currently carries; see `EditorProblems`. */
	problems?: string[];
}

/**
 * The tinted band that says which field the pane is editing.
 *
 * Exported for `CoreFieldEditor`: WooCommerce's own fields are edited in the
 * same pane, so they are edited in the same card.
 *
 * @param props          Component props.
 * @param props.title    Heading text.
 * @param props.chips    Type and placement chips.
 * @param props.onClose  Deselects the field.
 * @param props.problems Every message the field carries, listed under the band.
 */
export function EditorHeader( {
	title,
	chips,
	onClose,
	problems = [],
}: EditorHeaderProps ) {
	return (
		<div className="cbwb-editor__header">
			<div className="cbwb-editor__band">
				<div className="cbwb-editor__identity">
					<p className="cbwb-editor__eyebrow">
						{ __(
							'Field settings',
							'fieldwright-checkout-fields'
						) }
					</p>
					<h2 className="cbwb-editor__title">{ title }</h2>
					{ chips && (
						<div className="cbwb-editor__chips">{ chips }</div>
					) }
				</div>
				{ onClose && (
					<Button
						className="cbwb-editor__close"
						icon={ close }
						label={ __(
							'Done editing',
							'fieldwright-checkout-fields'
						) }
						onClick={ onClose }
					/>
				) }
			</div>
			<EditorProblems problems={ problems } />
		</div>
	);
}

/**
 * Every problem the field has, in one place at the top of its pane.
 *
 * Each message is also printed beside the control it belongs to, but that
 * control can be further down than the pane shows, inside a section that is
 * switched off, or in a part of the editor an add-on is not drawing right
 * now. A merchant told to fix a field has to be able to see what is wrong
 * without hunting for it, so the list is repeated here, once per message.
 *
 * @param props          Component props.
 * @param props.problems The messages, in the order they were found.
 */
function EditorProblems( { problems }: { problems: string[] } ) {
	const unique = problems.filter(
		( message, index ) => problems.indexOf( message ) === index
	);

	if ( 0 === unique.length ) {
		return null;
	}

	return (
		<div className="cbwb-editor__problems" role="alert">
			<p className="cbwb-editor__problems-title">
				{ _n(
					'One thing to fix before saving:',
					'Things to fix before saving:',
					unique.length,
					'fieldwright-checkout-fields'
				) }
			</p>
			<ul>
				{ unique.map( ( message ) => (
					<li key={ message }>{ message }</li>
				) ) }
			</ul>
		</div>
	);
}

interface SectionProps {
	/** Omitted by a section that is only a line of prose. */
	title?: string;
	description?: string;
	children: ReactNode;
}

/**
 * One divider-separated group of settings.
 *
 * A section with no title is a footnote rather than a group: an add-on saying
 * in one line that its settings do not reach this field. It keeps the pane's
 * gutter and loses the heading, the sentence under it and the rule above it,
 * because there is nothing there for a rule to separate.
 *
 * @param props             Component props.
 * @param props.title       Section name.
 * @param props.description One line on what the section decides.
 * @param props.children    Controls.
 */
export function Section( { title, description, children }: SectionProps ) {
	const bare = ! title;

	return (
		<section
			className={
				bare ? 'cbwb-editor__section is-bare' : 'cbwb-editor__section'
			}
		>
			{ title && (
				<h3 className="cbwb-editor__section-title">{ title }</h3>
			) }
			{ description && (
				<p className="cbwb-editor__section-description">
					{ description }
				</p>
			) }
			<div className="cbwb-editor__section-body">{ children }</div>
		</section>
	);
}

/**
 * The pane with nothing selected: the same card, so the column keeps its shape
 * and its explanation of what it is for.
 */
export function FieldEditorEmpty() {
	return (
		<div className="cbwb-editor cbwb-editor--empty">
			<EditorHeader
				title={ __(
					'Select a field to edit it',
					'fieldwright-checkout-fields'
				) }
			/>
			<div className="cbwb-editor__section">
				<p className="cbwb-editor__note">
					{ __(
						'Click any field in the preview or the list, or add a new one.',
						'fieldwright-checkout-fields'
					) }
				</p>
			</div>
		</div>
	);
}

/** The `type` attribute values the editor's own text boxes use. */
type InputType = 'text' | 'number' | 'date' | 'time' | 'email' | 'url' | 'tel';

interface DefaultValueProps {
	field: Field;
	error: string | undefined;
	onChange: ( changes: Partial< Field > ) => void;
}

/**
 * The prefilled answer, in whatever shape the type's answer takes: a box for a
 * text field, the option list for a dropdown, a switch for a checkbox, a real
 * date picker for a date.
 *
 * @param props          Component props.
 * @param props.field    Field being edited.
 * @param props.error    Validation message, if any.
 * @param props.onChange Applies the change.
 */
function DefaultValueControl( { field, error, onChange }: DefaultValueProps ) {
	const label = __( 'Default value', 'fieldwright-checkout-fields' );
	const errorClass = error ? 'cbwb-control--error' : undefined;
	const set = ( value: string ) => onChange( { default_value: value } );

	const shared = {
		__next40pxDefaultSize: true as const,
		__nextHasNoMarginBottom: true as const,
		className: errorClass,
		label,
		value: field.default_value,
		onChange: set,
	};

	if ( 'checkbox' === field.type ) {
		return (
			<ToggleControl
				__nextHasNoMarginBottom
				label={ __(
					'Ticked by default',
					'fieldwright-checkout-fields'
				) }
				help={
					error ??
					__(
						'Customers can still untick it.',
						'fieldwright-checkout-fields'
					)
				}
				checked={ 'yes' === field.default_value }
				onChange={ ( ticked ) => set( ticked ? 'yes' : '' ) }
			/>
		);
	}

	if ( 'checkbox_group' === field.type ) {
		const ticked = field.default_value
			.split( ',' )
			.map( ( value ) => value.trim() )
			.filter( Boolean );

		return (
			<fieldset className="cbwb-defaults">
				<legend className="cbwb-defaults__legend">{ label }</legend>
				{ 0 === field.options.length ? (
					<p className="cbwb-editor__note">
						{ __(
							'Add an option first.',
							'fieldwright-checkout-fields'
						) }
					</p>
				) : (
					field.options.map( ( option ) => (
						<CheckboxControl
							__nextHasNoMarginBottom
							key={ option.value }
							label={
								option.label ||
								option.value ||
								__(
									'Untitled option',
									'fieldwright-checkout-fields'
								)
							}
							checked={ ticked.includes( option.value ) }
							onChange={ ( checked ) =>
								set(
									( checked
										? [ ...ticked, option.value ]
										: ticked.filter(
												( value ) =>
													value !== option.value
										  )
									).join( ',' )
								)
							}
						/>
					) )
				) }
				{ error && (
					<p className="cbwb-field-error" role="alert">
						{ error }
					</p>
				) }
			</fieldset>
		);
	}

	if ( 'select' === field.type || 'radio' === field.type ) {
		return (
			<SelectControl
				{ ...shared }
				options={ [
					{
						value: '',
						label: __(
							'No default',
							'fieldwright-checkout-fields'
						),
					},
					...field.options.map( ( option ) => ( {
						value: option.value,
						label: option.label || option.value,
					} ) ),
				] }
				help={ error }
			/>
		);
	}

	if ( 'textarea' === field.type ) {
		return (
			<TextareaControl
				__nextHasNoMarginBottom
				className={ errorClass }
				label={ label }
				rows={ 3 }
				value={ field.default_value }
				help={ error }
				onChange={ set }
			/>
		);
	}

	const inputType: InputType =
		( {
			number: 'number',
			date: 'date',
			time: 'time',
			email: 'email',
			url: 'url',
			phone: 'tel',
		}[ field.type as string ] as InputType ) ?? 'text';

	return (
		<TextControl
			{ ...shared }
			type={ inputType }
			help={
				error ??
				__(
					'Prefilled at checkout. Customers can change it.',
					'fieldwright-checkout-fields'
				)
			}
		/>
	);
}

interface FieldEditorProps {
	field: Field;
	bootstrap: AdminBootstrap;
	errors: FieldErrors | undefined;
	/**
	 * Every error for this field, path-relative to it. Handed to extension
	 * sections so they can pick out their own.
	 */
	fieldErrors: ValidationError[];
	/** False while the field has never been saved, when the key is still editable. */
	keyLocked: boolean;
	onChange: ( changes: Partial< Field > ) => void;
	/** Leaves the field selected-by-nothing, showing the empty state. */
	onClose: () => void;
}

/**
 * The placement's description, and where an answer given there is saved.
 *
 * The three placements WooCommerce owns say where the value goes ("Saved on the
 * order only."), which is only true of a field that collects one: a heading or a
 * paragraph stores nothing. The two sentences arrive separately for exactly this
 * reason — the storage half used to be the tail of the description, and picking
 * it back off meant matching an English word against a translated string.
 *
 * @param placement The placement, as the bootstrap describes it.
 * @param field     The field being placed.
 * @return The help text.
 */
function placementHelp(
	placement: PlacementMeta | undefined,
	field: Field
): string {
	const description = placement?.description ?? '';
	const storage = placement?.storage ?? '';

	if ( '' === storage || ! collectsAnswer( field.type ) ) {
		return description;
	}

	return '' === description ? storage : `${ description } ${ storage }`;
}

export default function FieldEditor( {
	field,
	bootstrap,
	errors,
	fieldErrors,
	keyLocked,
	onChange,
	onClose,
}: FieldEditorProps ) {
	const [ copied, setCopied ] = useState( false );
	const keyHelpId = `cbwb-key-help-${ useInstanceId( FieldEditor ) }`;
	const { formatPresets, autocompleteTokens } = bootstrap;

	const types = useMemo(
		() => resolveTypes( bootstrap.types ),
		[ bootstrap.types ]
	);
	const placements = useMemo(
		() => resolvePlacements( bootstrap ),
		[ bootstrap ]
	);

	const type = types.find( ( candidate ) => candidate.key === field.type );
	const placement = placements.find(
		( candidate ) => candidate.key === field.location
	);
	/*
	 * Where this field may go. A type the server did not list at all — the
	 * add-on that provided it is gone, not merely switched off — falls back to
	 * the places every type this plugin draws can use, because a field nobody
	 * can move is a field a merchant is stuck with.
	 */
	const allowedPlacements = placements.filter( ( candidate ) =>
		( type?.placements ?? placementsForType( field.type ) ).includes(
			candidate.key
		)
	);

	const sectionContext: EditorSectionContext = {
		field,
		update: onChange,
		errors: fieldErrors,
		bootstrap,
	};
	const extraSections = editorSections( sectionContext );

	/*
	 * The settings that belong to a type an add-on provided, drawn where Free
	 * draws its own per-type controls: after the field's own name and place, and
	 * before the rules about its answer. Free knows nothing about what is in
	 * there beyond where it goes.
	 */
	const TypeSettings = descriptorFor( field.type )?.Settings;

	const sectionsAt = ( at: SectionPlacement ) =>
		extraSections
			.filter( ( section ) => section.placement === at )
			.map( ( section ) => (
				<Section
					key={ section.key }
					title={ section.title }
					description={ section.description }
				>
					{ section.render( sectionContext ) }
				</Section>
			) );

	// The editor stays mounted while the selection changes, so the transient
	// "Copied" confirmation has to be cleared by hand.
	useEffect( () => setCopied( false ), [ field.id ] );

	const keyHelp =
		errorFor( errors, 'id' ) ??
		( keyLocked
			? __(
					'Locked to keep existing order data attached',
					'fieldwright-checkout-fields'
			  )
			: __(
					'Generated from the label. You can change it until you save.',
					'fieldwright-checkout-fields'
			  ) );

	const typeLabel = type?.label ?? metaFor( field.type ).label;
	const isContent = ! collectsAnswer( field.type );
	const isCore = isCoreType( field.type );
	const ceiling = maxLengthCeiling( field.type );
	/*
	 * A field whose type nothing is providing right now. Everything the builder
	 * knows about it is here — its name, where it goes, whether it is on — and
	 * nothing else is, because the settings that are missing belong to a plugin
	 * that is not running. The field itself is left exactly as it is.
	 */
	const unavailable = 'unavailable' === familyOf( field.type );

	const copyKey = async () => {
		try {
			await navigator?.clipboard?.writeText( field.id );
			setCopied( true );
		} catch {
			setCopied( false );
		}
	};

	const errorClass = ( key: string ) =>
		errorFor( errors, key ) ? 'cbwb-control--error' : undefined;

	/**
	 * The Error message control, wherever the type has a failure to word.
	 * @param help
	 */
	const errorMessageControl = ( help: string ) => (
		<TextControl
			__next40pxDefaultSize
			__nextHasNoMarginBottom
			className={ errorClass( 'error_message' ) }
			label={ __( 'Error message', 'fieldwright-checkout-fields' ) }
			value={ field.error_message }
			help={ errorFor( errors, 'error_message' ) ?? help }
			onChange={ ( message ) => onChange( { error_message: message } ) }
		/>
	);

	/**
	 * A `min`/`max`-style pair of boxes.
	 * @param key
	 * @param label
	 * @param inputType
	 * @param help
	 */
	const rangeControl = (
		key: 'min' | 'max' | 'date_min' | 'date_max' | 'time_min' | 'time_max',
		label: string,
		inputType: InputType,
		help?: string
	) => (
		<TextControl
			__next40pxDefaultSize
			__nextHasNoMarginBottom
			type={ inputType }
			className={ errorClass( key ) }
			label={ label }
			value={ field[ key ] }
			help={ errorFor( errors, key ) ?? help }
			onChange={ ( value ) =>
				onChange( { [ key ]: value } as Partial< Field > )
			}
		/>
	);

	const updateVisibility = ( changes: Partial< FieldVisibility > ) =>
		onChange( { visibility: { ...field.visibility, ...changes } } );

	return (
		<div className="cbwb-editor">
			<EditorHeader
				title={
					'' === field.label.trim()
						? __( 'Untitled field', 'fieldwright-checkout-fields' )
						: field.label
				}
				onClose={ onClose }
				problems={ fieldErrors.map( ( error ) => error.message ) }
				chips={
					<>
						<span className="cbwb-chip">{ typeLabel }</span>
						<span className="cbwb-chip">
							{ sprintf(
								/* translators: %s: placement name, e.g. "Contact". */
								__(
									'Shows in: %s',
									'fieldwright-checkout-fields'
								),
								placement?.label ?? field.location
							) }
						</span>
					</>
				}
			/>

			{ unavailable && (
				<Section>
					<p className="cbwb-editor__note">{ unavailableLabel() }</p>
				</Section>
			) }

			<Section
				title={ __( 'Basics', 'fieldwright-checkout-fields' ) }
				description={ __(
					'What the customer sees.',
					'fieldwright-checkout-fields'
				) }
			>
				<TextControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={
						'heading' === field.type
							? __(
									'Heading text',
									'fieldwright-checkout-fields'
							  )
							: __( 'Label', 'fieldwright-checkout-fields' )
					}
					value={ field.label }
					help={
						errorFor( errors, 'label' ) ??
						( 'paragraph' === field.type
							? __(
									'Names this block in the builder. Customers see the text below, not this.',
									'fieldwright-checkout-fields'
							  )
							: undefined )
					}
					className={ errorClass( 'label' ) }
					onChange={ ( label ) => onChange( { label } ) }
				/>

				<TypePicker
					types={ types }
					value={ field.type }
					onSelect={ ( next ) => onChange( { type: next } ) }
				/>

				<SelectControl< FieldLocation >
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					className={ errorClass( 'location' ) }
					label={ __(
						'Where it appears',
						'fieldwright-checkout-fields'
					) }
					value={ field.location }
					options={ allowedPlacements.map( ( option ) => ( {
						value: option.key,
						label: option.label,
					} ) ) }
					help={
						errorFor( errors, 'location' ) ??
						placementHelp( placement, field )
					}
					onChange={ ( next ) => onChange( { location: next } ) }
				/>

				{ usesWidth( field.type ) && (
					<SegmentedControl< FieldWidth >
						className={ errorClass( 'width' ) }
						label={ __( 'Width', 'fieldwright-checkout-fields' ) }
						value={ field.width }
						options={ [
							{
								value: 'full',
								label: __(
									'Full',
									'fieldwright-checkout-fields'
								),
							},
							{
								value: 'half',
								label: __(
									'Half',
									'fieldwright-checkout-fields'
								),
							},
						] }
						help={
							errorFor( errors, 'width' ) ??
							__(
								'Two fields set to Half sit side by side in a row.',
								'fieldwright-checkout-fields'
							)
						}
						onChange={ ( width ) => onChange( { width } ) }
					/>
				) }
			</Section>

			{ TypeSettings && (
				<Section title={ typeLabel }>
					<TypeSettings { ...sectionContext } />
				</Section>
			) }

			<Section
				title={ __( 'Rules', 'fieldwright-checkout-fields' ) }
				description={
					isContent
						? __( 'How it reads.', 'fieldwright-checkout-fields' )
						: __(
								'What counts as a valid answer.',
								'fieldwright-checkout-fields'
						  )
				}
			>
				{ ! isContent && (
					<ToggleControl
						__nextHasNoMarginBottom
						label={ __(
							'Required',
							'fieldwright-checkout-fields'
						) }
						help={ __(
							"Customers can't complete checkout without it.",
							'fieldwright-checkout-fields'
						) }
						checked={ field.required }
						onChange={ ( required ) => onChange( { required } ) }
					/>
				) }

				{ 'text' === field.type && (
					<>
						<SelectControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							className={ errorClass( 'format' ) }
							label={ __(
								'Format',
								'fieldwright-checkout-fields'
							) }
							value={ field.format }
							options={ Object.entries( formatPresets ).map(
								( [ key, preset ] ) => ( {
									value: key,
									label: preset.label,
								} )
							) }
							help={ errorFor( errors, 'format' ) }
							onChange={ ( format ) => onChange( { format } ) }
						/>

						{ 'custom' === field.format && (
							<TextControl
								__next40pxDefaultSize
								__nextHasNoMarginBottom
								className={ errorClass( 'pattern' ) }
								label={ __(
									'Custom pattern',
									'fieldwright-checkout-fields'
								) }
								value={ field.pattern }
								help={
									errorFor( errors, 'pattern' ) ??
									__(
										'A regular expression JavaScript understands, without slashes or anchors.',
										'fieldwright-checkout-fields'
									)
								}
								onChange={ ( pattern ) =>
									onChange( { pattern } )
								}
							/>
						) }

						{ /*
						 * The message belongs to the format, so it is offered
						 * with it: on "Any text" there is nothing the value can
						 * fail, and a box asking how to word that failure would
						 * be asking about something that cannot happen.
						 */ }
						{ 'any' !== field.format &&
							errorMessageControl(
								__(
									"Shown when the value doesn't match the format. Leave empty for the default message.",
									'fieldwright-checkout-fields'
								)
							) }
					</>
				) }

				{ isTextInput( field.type ) &&
					'text' !== field.type &&
					errorMessageControl(
						sprintf(
							/* translators: %s: field type, e.g. "Email". */
							__(
								"Shown when the value isn't a valid %s. Leave empty for the default message.",
								'fieldwright-checkout-fields'
							),
							typeLabel.toLowerCase()
						)
					) }

				{ 'number' === field.type && (
					<div className="cbwb-editor__row">
						{ rangeControl(
							'min',
							__( 'Smallest', 'fieldwright-checkout-fields' ),
							'number',
							__(
								'Leave empty for no minimum.',
								'fieldwright-checkout-fields'
							)
						) }
						{ rangeControl(
							'max',
							__( 'Largest', 'fieldwright-checkout-fields' ),
							'number',
							__(
								'Leave empty for no maximum.',
								'fieldwright-checkout-fields'
							)
						) }
						<TextControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							type="number"
							className={ errorClass( 'step' ) }
							label={ __(
								'Step',
								'fieldwright-checkout-fields'
							) }
							value={ field.step }
							help={
								errorFor( errors, 'step' ) ??
								__(
									'e.g. 0.5. Leave empty for whole numbers.',
									'fieldwright-checkout-fields'
								)
							}
							onChange={ ( step ) => onChange( { step } ) }
						/>
					</div>
				) }

				{ 'textarea' === field.type && (
					<>
						<TextControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							type="number"
							className={ errorClass( 'rows' ) }
							label={ __(
								'Height (rows)',
								'fieldwright-checkout-fields'
							) }
							value={ String( field.rows ) }
							help={
								errorFor( errors, 'rows' ) ??
								sprintf(
									/* translators: 1: smallest number of rows, 2: largest. */
									__(
										'Between %1$d and %2$d.',
										'fieldwright-checkout-fields'
									),
									MIN_ROWS,
									MAX_ROWS
								)
							}
							onChange={ ( value ) =>
								onChange( {
									rows:
										'' === value.trim()
											? DEFAULT_ROWS
											: Number( value ),
								} )
							}
						/>
						{ errorMessageControl(
							__(
								"Shown when the answer doesn't fit the rules above. Leave empty for the default message.",
								'fieldwright-checkout-fields'
							)
						) }
					</>
				) }

				{ 'date' === field.type && (
					<>
						<div className="cbwb-editor__row">
							{ rangeControl(
								'date_min',
								__( 'Earliest', 'fieldwright-checkout-fields' ),
								'date'
							) }
							{ rangeControl(
								'date_max',
								__( 'Latest', 'fieldwright-checkout-fields' ),
								'date'
							) }
						</div>
						{ errorMessageControl(
							__(
								'Shown when the date is outside that range. Leave empty for the default message.',
								'fieldwright-checkout-fields'
							)
						) }
					</>
				) }

				{ 'time' === field.type && (
					<>
						<div className="cbwb-editor__row">
							{ rangeControl(
								'time_min',
								__( 'Earliest', 'fieldwright-checkout-fields' ),
								'time'
							) }
							{ rangeControl(
								'time_max',
								__( 'Latest', 'fieldwright-checkout-fields' ),
								'time'
							) }
							<TextControl
								__next40pxDefaultSize
								__nextHasNoMarginBottom
								type="number"
								className={ errorClass( 'step' ) }
								label={ __(
									'Step (minutes)',
									'fieldwright-checkout-fields'
								) }
								value={ field.step }
								help={
									errorFor( errors, 'step' ) ??
									__(
										'How far apart the choices are.',
										'fieldwright-checkout-fields'
									)
								}
								onChange={ ( step ) => onChange( { step } ) }
							/>
						</div>
						{ errorMessageControl(
							__(
								'Shown when the time is outside that range. Leave empty for the default message.',
								'fieldwright-checkout-fields'
							)
						) }
					</>
				) }

				{ usesOptions( field.type ) && (
					<>
						<OptionsEditor
							options={ field.options }
							error={ errorFor( errors, 'options' ) }
							onChange={ ( options ) => onChange( { options } ) }
						/>

						{ 'select' === field.type ? (
							<TextControl
								__next40pxDefaultSize
								__nextHasNoMarginBottom
								className={ errorClass( 'placeholder' ) }
								label={ __(
									'Placeholder',
									'fieldwright-checkout-fields'
								) }
								value={ field.placeholder }
								help={
									errorFor( errors, 'placeholder' ) ??
									__(
										'Shown as the first, unselected choice.',
										'fieldwright-checkout-fields'
									)
								}
								onChange={ ( placeholderText ) =>
									onChange( {
										placeholder: placeholderText,
									} )
								}
							/>
						) : (
							<SegmentedControl< OptionsLayout >
								className={ errorClass( 'options_layout' ) }
								label={ __(
									'Option layout',
									'fieldwright-checkout-fields'
								) }
								value={ field.options_layout }
								options={ [
									{
										value: 'stacked',
										label: __(
											'Stacked',
											'fieldwright-checkout-fields'
										),
									},
									{
										value: 'inline',
										label: __(
											'In a row',
											'fieldwright-checkout-fields'
										),
									},
								] }
								help={ errorFor( errors, 'options_layout' ) }
								onChange={ ( layout ) =>
									onChange( { options_layout: layout } )
								}
							/>
						) }
					</>
				) }

				{ 'checkbox' === field.type &&
					( field.required ? (
						errorMessageControl(
							__(
								'Shown in the checkout when a required box is left unticked.',
								'fieldwright-checkout-fields'
							)
						)
					) : (
						<p className="cbwb-editor__note">
							{ __(
								'Turn on Required to set a message for an unticked box.',
								'fieldwright-checkout-fields'
							) }
						</p>
					) ) }

				{ null !== ceiling && (
					<TextControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						type="number"
						className={ errorClass( 'max_length' ) }
						label={ __(
							'Max length',
							'fieldwright-checkout-fields'
						) }
						value={
							null === field.max_length
								? ''
								: String( field.max_length )
						}
						help={
							errorFor( errors, 'max_length' ) ??
							__(
								'Leave empty for no limit.',
								'fieldwright-checkout-fields'
							)
						}
						onChange={ ( value ) =>
							onChange( {
								max_length:
									'' === value.trim()
										? null
										: Number( value ),
							} )
						}
					/>
				) }

				{ 'heading' === field.type && (
					<SegmentedControl< string >
						className={ errorClass( 'content_level' ) }
						label={ __(
							'Heading level',
							'fieldwright-checkout-fields'
						) }
						value={ String( field.content_level ) }
						options={ [
							{ value: '2', label: 'H2' },
							{ value: '3', label: 'H3' },
							{ value: '4', label: 'H4' },
						] }
						help={
							errorFor( errors, 'content_level' ) ??
							__(
								'How big it is next to the checkout’s own headings.',
								'fieldwright-checkout-fields'
							)
						}
						onChange={ ( level ) =>
							onChange( {
								content_level: Number( level ) as ContentLevel,
							} )
						}
					/>
				) }

				{ 'paragraph' === field.type && (
					<TextareaControl
						__nextHasNoMarginBottom
						className={ errorClass( 'content' ) }
						label={ __( 'Text', 'fieldwright-checkout-fields' ) }
						rows={ 4 }
						value={ field.content }
						help={
							errorFor( errors, 'content' ) ??
							__(
								'Shown to the customer. Links, bold and italic are allowed.',
								'fieldwright-checkout-fields'
							)
						}
						onChange={ ( content ) => onChange( { content } ) }
					/>
				) }

				{ ! isContent && (
					<>
						{ /*
						 * Only where the answer is one something can stand in
						 * for. A type an add-on provided says so itself, and a
						 * type nothing is providing says nothing at all.
						 */ }
						{ hasDefaultValue( field.type ) && (
							<DefaultValueControl
								field={ field }
								error={ errorFor( errors, 'default_value' ) }
								onChange={ onChange }
							/>
						) }

						<TextControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							className={ errorClass( 'help' ) }
							label={ __(
								'Help text',
								'fieldwright-checkout-fields'
							) }
							value={ field.help }
							help={
								errorFor( errors, 'help' ) ??
								__(
									'One line under the field, for anything the label cannot say.',
									'fieldwright-checkout-fields'
								)
							}
							onChange={ ( help ) => onChange( { help } ) }
						/>
					</>
				) }
			</Section>

			{ sectionsAt( 'afterRules' ) }

			<Section
				title={ __( 'Visibility', 'fieldwright-checkout-fields' ) }
				description={ __(
					'Where the answer goes.',
					'fieldwright-checkout-fields'
				) }
			>
				<ToggleControl
					__nextHasNoMarginBottom
					label={ __(
						'Show at checkout',
						'fieldwright-checkout-fields'
					) }
					help={ __(
						'Turn off to hide this field without deleting it. Its settings are kept.',
						'fieldwright-checkout-fields'
					) }
					checked={ field.enabled }
					onChange={ ( enabled ) => onChange( { enabled } ) }
				/>

				{ isContent ? (
					<p className="cbwb-editor__note">
						{ __(
							'This block has no answer to show anywhere else. It is only ever part of the checkout page.',
							'fieldwright-checkout-fields'
						) }
					</p>
				) : (
					<>
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __(
								'Order confirmation',
								'fieldwright-checkout-fields'
							) }
							help={ __(
								'Show the answer on the order received page.',
								'fieldwright-checkout-fields'
							) }
							checked={ field.visibility.thank_you }
							onChange={ ( shown ) =>
								updateVisibility( { thank_you: shown } )
							}
						/>

						<ToggleControl
							__nextHasNoMarginBottom
							disabled={ isCore }
							label={ __(
								'Emails',
								'fieldwright-checkout-fields'
							) }
							help={ __(
								'Show the answer in order emails.',
								'fieldwright-checkout-fields'
							) }
							checked={ field.visibility.emails }
							onChange={ ( emails ) =>
								updateVisibility( { emails } )
							}
						/>

						<ToggleControl
							__nextHasNoMarginBottom
							disabled={ isCore }
							label={ __(
								'Admin order screen',
								'fieldwright-checkout-fields'
							) }
							help={ __(
								'Show the answer when you open the order.',
								'fieldwright-checkout-fields'
							) }
							checked={ field.visibility.admin }
							onChange={ ( admin ) =>
								updateVisibility( { admin } )
							}
						/>

						<ToggleControl
							__nextHasNoMarginBottom
							disabled={ isCore }
							label={ __(
								'My Account',
								'fieldwright-checkout-fields'
							) }
							help={ __(
								"Show the answer in the customer's order history.",
								'fieldwright-checkout-fields'
							) }
							checked={ field.visibility.account }
							onChange={ ( account ) =>
								updateVisibility( { account } )
							}
						/>

						{ isCore && (
							<p className="cbwb-editor__note">
								{ __(
									'WooCommerce decides where its own field types are shown, so only the order confirmation can be changed here. The other three apply to the types this plugin renders itself: the long text, choice, date and time fields.',
									'fieldwright-checkout-fields'
								) }
							</p>
						) }

						{ canSaveToProfile( field.type, field.location ) && (
							<ToggleControl
								__nextHasNoMarginBottom
								label={ __(
									'Save to customer profile',
									'fieldwright-checkout-fields'
								) }
								help={ __(
									'Remember the answer and prefill it next time this customer checks out.',
									'fieldwright-checkout-fields'
								) }
								checked={ field.save_to_profile }
								onChange={ ( remember ) =>
									onChange( { save_to_profile: remember } )
								}
							/>
						) }
					</>
				) }
			</Section>

			{ sectionsAt( 'afterVisibility' ) }

			<Panel className="cbwb-editor__advanced">
				<PanelBody
					title={ __( 'Advanced', 'fieldwright-checkout-fields' ) }
					initialOpen={ false }
				>
					{ isTextInput( field.type ) && (
						<SelectControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							className={ errorClass( 'autocomplete' ) }
							label={ __(
								'Autocomplete',
								'fieldwright-checkout-fields'
							) }
							value={ field.autocomplete }
							options={ [
								{
									value: '',
									label: __(
										'Browser default',
										'fieldwright-checkout-fields'
									),
								},
								...autocompleteTokens.map( ( token ) => ( {
									value: token,
									label: token,
								} ) ),
							] }
							help={ errorFor( errors, 'autocomplete' ) }
							onChange={ ( autocomplete ) =>
								onChange( { autocomplete } )
							}
						/>
					) }

					{ /*
					 * The key input and its copy button are one row, bottom
					 * aligned. The help text sits below the row rather than
					 * inside the control, so the button lines up with the
					 * input's bottom edge instead of the help text's.
					 */ }
					<div className="cbwb-key">
						<Flex
							className="cbwb-key__row"
							align="flex-end"
							gap={ 2 }
						>
							<FlexBlock>
								<TextControl
									__next40pxDefaultSize
									__nextHasNoMarginBottom
									className={
										errorFor( errors, 'id' )
											? 'cbwb-key__input cbwb-control--error'
											: 'cbwb-key__input'
									}
									label={ __(
										'Field key',
										'fieldwright-checkout-fields'
									) }
									value={ field.id }
									readOnly={ keyLocked }
									aria-describedby={ keyHelpId }
									onChange={ ( id ) =>
										keyLocked
											? undefined
											: onChange( { id } )
									}
								/>
							</FlexBlock>
							<FlexItem>
								<Button
									__next40pxDefaultSize
									className="cbwb-key__copy"
									icon={ copy }
									label={ __(
										'Copy field key',
										'fieldwright-checkout-fields'
									) }
									onClick={ copyKey }
								/>
							</FlexItem>
							{ copied && (
								<FlexItem>
									<span
										className="cbwb-key__copied"
										role="status"
										aria-live="polite"
									>
										{ __(
											'Copied',
											'fieldwright-checkout-fields'
										) }
									</span>
								</FlexItem>
							) }
						</Flex>
						<p
							className={
								errorFor( errors, 'id' )
									? 'cbwb-key__help is-error'
									: 'cbwb-key__help'
							}
							id={ keyHelpId }
						>
							{ keyHelp }
						</p>
					</div>
				</PanelBody>
			</Panel>
		</div>
	);
}
