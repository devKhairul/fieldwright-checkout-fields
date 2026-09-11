import { useInstanceId } from '@wordpress/compose';
import { Icon } from '@wordpress/components';
import type { IconType } from '@wordpress/components';

/**
 * A radio group styled as a segmented control.
 *
 * `@wordpress/components` still only exposes its toggle group behind an
 * `__experimental` export, which this plugin does not use, so this is built on
 * native radios instead: arrow-key navigation, labelling and focus handling all
 * come from the platform.
 */

export interface SegmentedOption< T extends string > {
	value: T;
	/** What the option is called. Read aloud always; drawn unless an icon stands in. */
	label: string;
	/**
	 * An icon drawn in place of the label. The label still names the option
	 * for a screen reader and as a tooltip, so a picture never replaces a word,
	 * only hides it.
	 */
	icon?: IconType;
}

interface SegmentedControlProps< T extends string > {
	label: string;
	value: T;
	options: SegmentedOption< T >[];
	onChange: ( value: T ) => void;
	help?: string;
	className?: string;
}

export default function SegmentedControl< T extends string >( {
	label,
	value,
	options,
	onChange,
	help,
	className,
}: SegmentedControlProps< T > ) {
	const instanceId = useInstanceId( SegmentedControl, 'cbwb-segmented' );
	const helpId = `${ instanceId }__help`;

	return (
		<fieldset
			className={ [ 'cbwb-segmented', className ]
				.filter( Boolean )
				.join( ' ' ) }
			aria-describedby={ help ? helpId : undefined }
		>
			<legend className="cbwb-segmented__legend">{ label }</legend>
			<div className="cbwb-segmented__options">
				{ options.map( ( option ) => {
					const optionId = `${ instanceId }-${ option.value }`;
					return (
						<label
							key={ option.value }
							htmlFor={ optionId }
							className={
								option.icon
									? 'cbwb-segmented__option has-icon'
									: 'cbwb-segmented__option'
							}
							title={ option.icon ? option.label : undefined }
						>
							<input
								id={ optionId }
								type="radio"
								className="cbwb-segmented__input"
								name={ instanceId }
								value={ option.value }
								checked={ option.value === value }
								onChange={ () => onChange( option.value ) }
							/>
							<span className="cbwb-segmented__label">
								{ option.icon ? (
									<>
										<Icon
											icon={ option.icon }
											size={ 20 }
										/>
										<span className="screen-reader-text">
											{ option.label }
										</span>
									</>
								) : (
									option.label
								) }
							</span>
						</label>
					);
				} ) }
			</div>
			{ help && (
				<p className="cbwb-segmented__help" id={ helpId }>
					{ help }
				</p>
			) }
		</fieldset>
	);
}
