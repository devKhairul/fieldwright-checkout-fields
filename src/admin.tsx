import { createRoot } from '@wordpress/element';
import { addFilter, removeFilter } from '@wordpress/hooks';

import App from './admin/components/App';
import SegmentedControl from './admin/components/SegmentedControl';
import './admin/style.scss';

/*
 * The surface add-on bundles build against. Assigned before anything renders,
 * and before any later script runs, so an add-on enqueued with `cbwb-admin` as
 * its dependency can rely on it at module scope.
 */
window.cbwb = {
	hooks: { addFilter, removeFilter },
	components: { SegmentedControl },
	version: window.cbwbAdmin?.version ?? '',
};

/**
 * Mount the builder.
 */
function mount(): void {
	const root = document.getElementById( 'cbwb-admin-root' );

	if ( root ) {
		createRoot( root ).render( <App /> );
	}
}

/*
 * Filters are read while rendering, so every script that registers one has to
 * have run first. Waiting for the document means the whole footer — add-on
 * bundles included — is in place before the first render, whatever order the
 * browser happened to finish fetching them in.
 */
if ( 'loading' === document.readyState ) {
	document.addEventListener( 'DOMContentLoaded', mount );
} else {
	mount();
}
