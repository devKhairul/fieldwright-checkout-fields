/**
 * The inspector for one of WooCommerce's own checkout fields.
 *
 * The same card as the field editor beside it, with a much shorter list of
 * settings — and that is the point. WooCommerce owns the type, the placeholder,
 * the rules and where the answer ends up; three things are genuinely a
 * merchant's to decide, so three things are offered, and everything WooCommerce
 * will not part with is on screen as a switch that cannot move, with the reason
 * beside it. A missing control asks "where has it gone?"; a locked one answers.
 *
 * Add-ons see the pane through the same `cbwb.editorSections` filter as any
 * other field, with the row marked `kind: 'core'` — so an add-on can say in one
 * line that its settings do not reach WooCommerce's own fields rather than
 * leaving a merchant hunting for a section that is simply absent.
 */

import type { ReactNode } from 'react';

import { Button, TextControl, ToggleControl } from '@wordpress/components';
import { lock } from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';

import type { CoreRow, PseudoRow } from '../lib/coreFields';
import { coreLockReason, localeLabelNote } from '../lib/coreFields';
import { coreSubject } from '../lib/fields';
import type { EditorSectionContext, SectionPlacement } from '../lib/hooks';
import { editorSections } from '../lib/hooks';
import type { FieldErrors } from '../lib/validate';
import { errorFor } from '../lib/validate';
import type {
	AdminBootstrap,
	CoreFieldOverride,
	CoreProSettings,
	Field,
	ValidationError,
} from '../types';
import { EditorHeader, Section } from './FieldEditor';

interface CoreFieldEditorProps {
	row: CoreRow | PseudoRow;
	bootstrap: AdminBootstrap;
	/** This row's failures, keyed by the property they belong to. */
	errors: FieldErrors | undefined;
	/**
	 * Every failure for this row, path-relative to it. Handed to extension
	 * sections so they can pick out their own, exactly as the field editor
	 * hands a merchant's own field its errors.
	 */
	rowErrors: ValidationError[];
	/** Changes one of WooCommerce's own fields. Not called for a pseudo-row. */
	onChange: ( changes: CoreFieldOverride ) => void;
	/** Shows or hides the order-note box or the coupon form. */
	onTogglePseudo: ( hidden: boolean ) => void;
	/** Drops every override on this row. */
	onReset: () => void;
	/** Leaves the row selected-by-nothing, showing the empty state. */
	onClose: () => void;
}

/**
 * A toggle's label, padlocked where the setting is not the merchant's.
 *
 * A disabled switch is drawn grey, and grey on a switch that is *on* reads as
 * "off" at least as readily as it reads as "locked" — the one thing it must not
 * say about a field WooCommerce always asks for. The padlock settles it; the
 * sentence under the control still says why.
 *
 * Decorative: every `@wordpress/icons` glyph is `aria-hidden`, so the control
 * is still named "Required", and its help text carries the reason.
 *
 * @param props        Component props.
 * @param props.text   Label text.
 * @param props.locked Whether WooCommerce keeps this setting.
 * @return The label.
 */
function ToggleLabel( {
	text,
	locked,
}: {
	text: string;
	locked: boolean;
} ): ReactNode {
	if ( ! locked ) {
		return text;
	}

	return (
		<span className="cbwb-editor__locked-label">
			{ lock }
			{ text }
		</span>
	);
}

/**
 * What each pseudo-row actually is, in the merchant's own terms.
 *
 * A function, not a constant: `__()` has to run once the locale's translations
 * are in, which is not guaranteed at module scope.
 *
 * @return One sentence per pseudo-row.
 */
function pseudoDescriptions(): Record< string, string > {
	return {
		order_note: __(
			'The “Add a note to your order” box at the end of the checkout form.',
			'fieldwright-checkout-fields'
		),
		coupon_form: __(
			'The coupon field in the order summary. The cart’s own coupon form is left alone, so a code can still be applied there.',
			'fieldwright-checkout-fields'
		),
	};
}

export default function CoreFieldEditor( {
	row,
	bootstrap,
	errors,
	rowErrors,
	onChange,
	onTogglePseudo,
	onReset,
	onClose,
}: CoreFieldEditorProps ) {
	const core = row as CoreRow;
	const isPseudo = undefined === core.location;

	const sectionContext: EditorSectionContext = {
		field: coreSubject( row ) as Field,
		/*
		 * The label, whether it is required and whether it shows are the pane's
		 * own three controls, and WooCommerce owns everything else about its
		 * fields — so the one thing a section may write here is its own opaque
		 * `pro` payload, and only on a real field. The pseudo-rows are parts of
		 * the Checkout block rather than fields, and have nothing to carry one.
		 */
		update: ( patch ) => {
			if ( isPseudo || ! ( 'pro' in patch ) ) {
				return;
			}
			onChange( {
				pro: ( patch.pro ?? null ) as CoreProSettings | null,
			} );
		},
		errors: rowErrors,
		bootstrap,
	};
	const extraSections = editorSections( sectionContext );

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

	const header = (
		<EditorHeader
			// A locale that leaves a core row's label empty still has a pane
			// with a heading, and the outline and the save notice already call
			// an unnamed row this.
			title={
				'' === row.label.trim()
					? __( 'Untitled field', 'fieldwright-checkout-fields' )
					: row.label
			}
			onClose={ onClose }
			chips={
				<span className="cbwb-chip cbwb-chip--core">
					{ /*
					 * The order-note box and the coupon form are parts of the
					 * Checkout block, not fields: neither has a label, a value
					 * or a place in the order, and calling them fields sends a
					 * merchant looking for settings that cannot exist.
					 */ }
					{ isPseudo
						? __(
								'WooCommerce checkout block',
								'fieldwright-checkout-fields'
						  )
						: __(
								'WooCommerce field',
								'fieldwright-checkout-fields'
						  ) }
				</span>
			}
			problems={ Object.values( errors ?? {} ).flat() }
		/>
	);

	if ( isPseudo ) {
		const pseudo = row as PseudoRow;

		return (
			<div className="cbwb-editor cbwb-editor--core">
				{ header }

				<Section
					title={ __( 'Visibility', 'fieldwright-checkout-fields' ) }
					description={ __(
						'Whether shoppers see it.',
						'fieldwright-checkout-fields'
					) }
				>
					<p className="cbwb-editor__note">
						{ pseudoDescriptions()[ pseudo.key ] }
					</p>
					<ToggleControl
						__nextHasNoMarginBottom
						label={ __(
							'Show at checkout',
							'fieldwright-checkout-fields'
						) }
						help={ __(
							'Turn off to take it off the checkout page.',
							'fieldwright-checkout-fields'
						) }
						checked={ ! pseudo.hidden }
						onChange={ ( shown ) => onTogglePseudo( ! shown ) }
					/>
				</Section>

				{ sectionsAt( 'afterVisibility' ) }
			</div>
		);
	}

	const localeLabel = bootstrap.baseCountryLabelOverrides?.[ core.key ];
	// The country's *name*, never its code: "shows as ZIP Code in US" reads as
	// a typo, and the sentence has a shorter form for when only a code is known.
	const country = bootstrap.baseCountryLabel ?? '';
	const relabelled = core.label !== core.defaults.label;
	const warnsGateways = ( bootstrap.gatewayWarningKeys ?? [] ).includes(
		core.key
	);

	const labelHelp = () => {
		const error = errorFor( errors, 'label' );
		if ( error ) {
			return error;
		}
		if ( relabelled ) {
			return __(
				'Your label is used in every country, in place of WooCommerce’s own.',
				'fieldwright-checkout-fields'
			);
		}
		/*
		 * WooCommerce renames a handful of fields per country — "Postal code" is
		 * "ZIP Code" in the United States — so a builder that printed the table
		 * name next to a checkout showing something else would look broken.
		 */
		return localeLabel
			? localeLabelNote( localeLabel, country )
			: undefined;
	};

	const requiredHelp = () => {
		const error = errorFor( errors, 'required' );
		if ( error ) {
			return error;
		}
		if ( core.locks.required ) {
			return coreLockReason( core.key, 'required' );
		}
		if ( core.hidden ) {
			return __(
				'A field nobody sees cannot be one anybody has to fill in.',
				'fieldwright-checkout-fields'
			);
		}
		return __(
			"Customers can't complete checkout without it.",
			'fieldwright-checkout-fields'
		);
	};

	const hiddenHelp = () => {
		const error = errorFor( errors, 'hidden' );
		if ( error ) {
			return error;
		}
		if ( core.locks.hidden ) {
			return coreLockReason( core.key, 'hidden' );
		}
		return __(
			'Turn off to take this field off the checkout. WooCommerce stops asking for it and stops checking it.',
			'fieldwright-checkout-fields'
		);
	};

	return (
		<div className="cbwb-editor cbwb-editor--core">
			{ header }

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
					className={
						errorFor( errors, 'label' )
							? 'cbwb-control--error'
							: undefined
					}
					label={ __( 'Label', 'fieldwright-checkout-fields' ) }
					value={ core.label }
					help={ labelHelp() }
					onChange={ ( label ) => onChange( { label } ) }
				/>
			</Section>

			<Section
				title={ __( 'Rules', 'fieldwright-checkout-fields' ) }
				description={ __(
					'What counts as a valid answer.',
					'fieldwright-checkout-fields'
				) }
			>
				<ToggleControl
					__nextHasNoMarginBottom
					disabled={ core.locks.required || core.hidden }
					label={
						<ToggleLabel
							text={ __(
								'Required',
								'fieldwright-checkout-fields'
							) }
							locked={ core.locks.required }
						/>
					}
					help={ requiredHelp() }
					checked={ core.required }
					onChange={ ( required ) => onChange( { required } ) }
				/>

				{ /*
				 * WooCommerce's own warning, and worth keeping: a name or a
				 * phone number the checkout no longer asks for is one a gateway
				 * or a carrier may still demand, and the failure shows up at
				 * Place Order rather than here.
				 */ }
				{ warnsGateways && ! core.required && ! core.hidden && (
					<p className="cbwb-editor__note is-warning">
						{ sprintf(
							/* translators: %s: field label. */
							__(
								'Some payment gateways and shipping providers still expect a %s. Test a real order before you leave this off.',
								'fieldwright-checkout-fields'
							),
							core.label.toLowerCase()
						) }
					</p>
				) }
			</Section>

			{ sectionsAt( 'afterRules' ) }

			<Section
				title={ __( 'Visibility', 'fieldwright-checkout-fields' ) }
				description={ __(
					'Whether shoppers see it.',
					'fieldwright-checkout-fields'
				) }
			>
				<ToggleControl
					__nextHasNoMarginBottom
					disabled={ core.locks.hidden }
					label={
						<ToggleLabel
							text={ __(
								'Show at checkout',
								'fieldwright-checkout-fields'
							) }
							locked={ core.locks.hidden }
						/>
					}
					help={ hiddenHelp() }
					checked={ ! core.hidden }
					onChange={ ( shown ) => onChange( { hidden: ! shown } ) }
				/>

				{ 'address' === core.location && (
					<p className="cbwb-editor__note">
						{ __(
							'Address fields are shared: whatever you change here applies to the billing form as well as the shipping one.',
							'fieldwright-checkout-fields'
						) }
						{ bootstrap.wcShippingSettingsUrl && (
							<>
								{ ' ' }
								<a
									href={ bootstrap.wcShippingSettingsUrl }
									target="_blank"
									rel="noopener noreferrer"
								>
									{ __(
										'Which addresses are asked for is a WooCommerce setting.',
										'fieldwright-checkout-fields'
									) }
								</a>
							</>
						) }
					</p>
				) }
			</Section>

			{ sectionsAt( 'afterVisibility' ) }

			<Section
				title={ __(
					'WooCommerce’s own settings',
					'fieldwright-checkout-fields'
				) }
				description={ __(
					'Everything else about this field is WooCommerce’s to decide.',
					'fieldwright-checkout-fields'
				) }
			>
				<Button
					__next40pxDefaultSize
					variant="secondary"
					disabled={ ! core.overridden }
					accessibleWhenDisabled
					onClick={ onReset }
				>
					{ __(
						'Reset to WooCommerce default',
						'fieldwright-checkout-fields'
					) }
				</Button>
			</Section>
		</div>
	);
}
