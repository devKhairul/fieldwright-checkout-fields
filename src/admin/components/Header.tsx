import type { ReactNode } from 'react';

import { __ } from '@wordpress/i18n';

interface HeaderProps {
	/** Actions rendered on the right: import/export menu and Save. */
	children?: ReactNode;
}

export default function Header( { children }: HeaderProps ) {
	return (
		<header className="cbwb-header">
			<div className="cbwb-header__titles">
				<h1 className="cbwb-header__title">
					{ __( 'Fieldwright', 'fieldwright-checkout-fields' ) }
				</h1>
				<p className="cbwb-header__subtitle">
					{ __(
						"Add fields to the Checkout block, arrange WooCommerce's own, and preview the result. Nothing reaches your checkout until you save.",
						'fieldwright-checkout-fields'
					) }
				</p>
			</div>
			<div className="cbwb-header__actions">{ children }</div>
		</header>
	);
}
