import { Button, TextControl } from '@wordpress/components';
import { useEffect, useRef } from '@wordpress/element';
import { chevronDown, chevronUp, plus, trash } from '@wordpress/icons';
import { __, sprintf } from '@wordpress/i18n';

import { slugify } from '../lib/slug';
import { MAX_OPTIONS } from '../lib/validate';
import type { FieldOption } from '../types';

/**
 * Derive an option value from its label, keeping an empty label empty.
 *
 * @param label Option label.
 * @return Slugified value.
 */
function valueFromLabel( label: string ): string {
	return '' === label.trim() ? '' : slugify( label );
}

interface OptionsEditorProps {
	options: FieldOption[];
	error?: string;
	onChange: ( options: FieldOption[] ) => void;
}

/**
 * Value/label pairs for a dropdown. Reordering is done with explicit Move
 * up/Move down buttons so it works with a keyboard and a screen reader without
 * a drag interaction inside the editor pane.
 *
 * @param props          Component props.
 * @param props.options  Current options.
 * @param props.error    Validation message for the list as a whole.
 * @param props.onChange Called with the new options list.
 */
export default function OptionsEditor( {
	options,
	error,
	onChange,
}: OptionsEditorProps ) {
	const update = ( index: number, changes: Partial< FieldOption > ) => {
		onChange(
			options.map( ( option, at ) =>
				at === index ? { ...option, ...changes } : option
			)
		);
	};

	/*
	 * The rows are keyed by position, so React reuses the buttons where they
	 * are and a move leaves focus sitting on the option that has just been
	 * pushed out of the way — the wrong one, and the one that would move back
	 * on a second press. The button the option is moving *to* is remembered
	 * here and focused once the new order has rendered, so a merchant holding
	 * Move up walks their option up the list.
	 */
	const moveButtons = useRef<
		Record< 'up' | 'down', ( HTMLButtonElement | null )[] >
	>( { up: [], down: [] } );
	const moved = useRef< { index: number; way: 'up' | 'down' } | null >(
		null
	);

	useEffect( () => {
		const target = moved.current;
		if ( ! target ) {
			return;
		}
		moved.current = null;
		moveButtons.current[ target.way ][ target.index ]?.focus();
	} );

	const swap = ( index: number, delta: number ) => {
		const target = index + delta;
		if ( target < 0 || target >= options.length ) {
			return;
		}
		const next = options.slice();
		[ next[ index ], next[ target ] ] = [ next[ target ], next[ index ] ];
		moved.current = { index: target, way: delta < 0 ? 'up' : 'down' };
		onChange( next );
	};

	const atLimit = options.length >= MAX_OPTIONS;

	return (
		<div className="cbwb-options">
			<ul className="cbwb-options__list">
				{ options.map( ( option, index ) => (
					<li className="cbwb-options__row" key={ index }>
						<TextControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							className="cbwb-options__label"
							label={ sprintf(
								/* translators: %d: option position, starting at 1. */
								__(
									'Option %d label',
									'fieldwright-checkout-fields'
								),
								index + 1
							) }
							value={ option.label }
							onChange={ ( label ) => {
								const shouldFollow =
									'' === option.value ||
									option.value ===
										valueFromLabel( option.label );
								update( index, {
									label,
									...( shouldFollow
										? { value: valueFromLabel( label ) }
										: {} ),
								} );
							} }
						/>
						<TextControl
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							className="cbwb-options__value"
							label={ sprintf(
								/* translators: %d: option position, starting at 1. */
								__(
									'Option %d value',
									'fieldwright-checkout-fields'
								),
								index + 1
							) }
							value={ option.value }
							onChange={ ( value ) => update( index, { value } ) }
						/>
						<div className="cbwb-options__actions">
							<Button
								size="small"
								icon={ chevronUp }
								disabled={ 0 === index }
								accessibleWhenDisabled
								ref={ ( node: HTMLButtonElement | null ) => {
									moveButtons.current.up[ index ] = node;
								} }
								label={ sprintf(
									/* translators: %d: option position, starting at 1. */
									__(
										'Move option %d up',
										'fieldwright-checkout-fields'
									),
									index + 1
								) }
								onClick={ () => swap( index, -1 ) }
							/>
							<Button
								size="small"
								icon={ chevronDown }
								disabled={ index === options.length - 1 }
								accessibleWhenDisabled
								ref={ ( node: HTMLButtonElement | null ) => {
									moveButtons.current.down[ index ] = node;
								} }
								label={ sprintf(
									/* translators: %d: option position, starting at 1. */
									__(
										'Move option %d down',
										'fieldwright-checkout-fields'
									),
									index + 1
								) }
								onClick={ () => swap( index, 1 ) }
							/>
							<Button
								size="small"
								icon={ trash }
								isDestructive
								label={ sprintf(
									/* translators: %d: option position, starting at 1. */
									__(
										'Remove option %d',
										'fieldwright-checkout-fields'
									),
									index + 1
								) }
								onClick={ () =>
									onChange(
										options.filter(
											( _option, at ) => at !== index
										)
									)
								}
							/>
						</div>
					</li>
				) ) }
			</ul>

			{ error && (
				<p className="cbwb-field-error" role="alert">
					{ error }
				</p>
			) }

			<Button
				__next40pxDefaultSize
				variant="secondary"
				icon={ plus }
				disabled={ atLimit }
				accessibleWhenDisabled
				onClick={ () =>
					onChange( [ ...options, { value: '', label: '' } ] )
				}
			>
				{ __( 'Add option', 'fieldwright-checkout-fields' ) }
			</Button>

			{ /*
			 * Said beside the button that has stopped working, rather than left
			 * for the save to report: the ceiling is the server's, and a
			 * merchant who has reached it should read why here.
			 */ }
			{ atLimit && (
				<p className="cbwb-editor__note">
					{ sprintf(
						/* translators: %d: maximum number of options. */
						__(
							'A field cannot have more than %d options.',
							'fieldwright-checkout-fields'
						),
						MAX_OPTIONS
					) }
				</p>
			) }
		</div>
	);
}
