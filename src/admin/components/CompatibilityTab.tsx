/**
 * "Can this store switch to the block checkout?"
 *
 * The whole tab is a read: it runs the server's scan when the merchant first
 * opens it and then reports what came back. Nothing here writes the field
 * configuration, so there is no dirty state and no autosave — the one action
 * available creates a draft page to try the block checkout on, and even that
 * touches nothing the shop already has.
 *
 * The scan is not run on page load. A store with fifty plugins pays for
 * `get_plugins()` and the whole feature registry, and most visits to this screen
 * are about fields, so it waits until it is asked.
 */

import {
	Button,
	Card,
	CardBody,
	CardHeader,
	ExternalLink,
	Notice,
	Spinner,
} from '@wordpress/components';
import { useEffect, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

import {
	createCompatibilityDraftPage,
	fetchCompatibility,
	toApiError,
} from '../lib/api';
import type {
	CompatibilityBucket,
	CompatibilityDraftPage,
	CompatibilityPlugin,
	CompatibilityReport,
} from '../types';

/** The buckets, in the order the tab shows them: best news first. */
const BUCKETS: CompatibilityBucket[] = [
	'compatible',
	'incompatible',
	'uncertain',
	'unknown',
];

/**
 * What each bucket is called on screen.
 *
 * Built on demand rather than as a module constant, so the strings are
 * translated with the locale that is actually loaded.
 *
 * @return Bucket headings, keyed by bucket.
 */
function bucketLabels(): Record< CompatibilityBucket, string > {
	return {
		compatible: __( 'Compatible', 'fieldwright-checkout-fields' ),
		incompatible: __( 'Incompatible', 'fieldwright-checkout-fields' ),
		uncertain: __( 'Not declared', 'fieldwright-checkout-fields' ),
		unknown: __(
			'Not related to WooCommerce',
			'fieldwright-checkout-fields'
		),
	};
}

/**
 * Whether a plugin's own URL is safe to put in an href.
 *
 * `Plugin URI` is a header another plugin wrote, and React 18 renders a
 * `javascript:` href with a console warning rather than refusing it. The server
 * already drops anything that is not http(s), so this is the second of the two
 * checks the value has to pass before it becomes a link — and the one that
 * still holds if the report came from an older server.
 *
 * @param uri The plugin's URL as the scan reported it.
 * @return Whether it can be linked to.
 */
function isLinkable( uri: string ): boolean {
	return /^https?:\/\//i.test( uri );
}

interface PluginTableProps {
	label: string;
	plugins: CompatibilityPlugin[];
}

/**
 * One bucket's plugins, as a plain table.
 *
 * @param props         Component props.
 * @param props.label   Bucket heading, so the table can be named after it.
 * @param props.plugins Plugins in the bucket.
 */
function PluginTable( { label, plugins }: PluginTableProps ) {
	if ( 0 === plugins.length ) {
		return (
			<p className="cbwb-compat__empty">
				{ __( 'None.', 'fieldwright-checkout-fields' ) }
			</p>
		);
	}

	return (
		<div className="cbwb-compat__scroller">
			<table className="cbwb-compat__table">
				<caption className="cbwb-visually-hidden">
					{ sprintf(
						/* translators: %s: group name, e.g. "Compatible". */
						__( 'Plugins: %s', 'fieldwright-checkout-fields' ),
						label
					) }
				</caption>
				<thead>
					<tr>
						<th scope="col">
							{ __( 'Name', 'fieldwright-checkout-fields' ) }
						</th>
						<th scope="col">
							{ __( 'Version', 'fieldwright-checkout-fields' ) }
						</th>
						<th scope="col">
							{ __( 'Author', 'fieldwright-checkout-fields' ) }
						</th>
					</tr>
				</thead>
				<tbody>
					{ /*
					 * Keyed by position: `file` is the natural key but it is
					 * empty for a reader who may not see plugin files, and two
					 * plugins can share a name. The list is rebuilt wholesale on
					 * every scan, so there is nothing for a stable key to save.
					 */ }
					{ plugins.map( ( plugin, index ) => (
						<tr
							key={ `${ plugin.file }|${ plugin.name }|${ index }` }
						>
							<th scope="row">{ plugin.name }</th>
							<td>{ plugin.version }</td>
							<td>
								{ isLinkable( plugin.plugin_uri ) ? (
									<ExternalLink href={ plugin.plugin_uri }>
										{ plugin.author }
									</ExternalLink>
								) : (
									plugin.author
								) }
							</td>
						</tr>
					) ) }
				</tbody>
			</table>
		</div>
	);
}

interface CheckoutCardProps {
	report: CompatibilityReport;
}

/**
 * The status card: which checkout is live, and the way to try the other one.
 *
 * @param props        Component props.
 * @param props.report The scan.
 */
function CheckoutCard( { report }: CheckoutCardProps ) {
	const [ draft, setDraft ] = useState< CompatibilityDraftPage | null >(
		null
	);
	const [ creating, setCreating ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );

	const isBlock = 'block' === report.checkout_type;

	const headline = ( () => {
		if ( isBlock ) {
			return __(
				'Block checkout is active',
				'fieldwright-checkout-fields'
			);
		}
		if ( 'classic' === report.checkout_type ) {
			return __(
				'Classic checkout is active',
				'fieldwright-checkout-fields'
			);
		}
		return __(
			"The checkout page doesn't use either checkout",
			'fieldwright-checkout-fields'
		);
	} )();

	const createDraft = async () => {
		setCreating( true );
		setError( null );
		try {
			setDraft( await createCompatibilityDraftPage() );
		} catch ( caught ) {
			setError(
				toApiError( caught ).message ??
					__(
						'The draft page could not be created.',
						'fieldwright-checkout-fields'
					)
			);
		} finally {
			setCreating( false );
		}
	};

	return (
		<Card className="cbwb-compat__card">
			<CardHeader>
				<h2 className="cbwb-compat__title">
					{ __( 'Your checkout', 'fieldwright-checkout-fields' ) }
				</h2>
			</CardHeader>
			<CardBody>
				<Notice
					status={ isBlock ? 'success' : 'info' }
					isDismissible={ false }
				>
					{ headline }
				</Notice>

				{ '' !== report.checkout_page_url && (
					<p className="cbwb-compat__link">
						<ExternalLink href={ report.checkout_page_url }>
							{ __(
								'View the checkout page',
								'fieldwright-checkout-fields'
							) }
						</ExternalLink>
					</p>
				) }

				{ /*
				 * Offered for anything that is not already the block checkout —
				 * including a page we could not classify, where a draft to
				 * compare against is exactly what settles the question.
				 */ }
				{ ! isBlock && (
					<div className="cbwb-compat__actions">
						{ error && (
							<Notice
								status="error"
								onRemove={ () => setError( null ) }
							>
								{ error }
							</Notice>
						) }

						<Button
							__next40pxDefaultSize
							variant="secondary"
							isBusy={ creating }
							disabled={ creating }
							accessibleWhenDisabled
							onClick={ () => void createDraft() }
						>
							{ __(
								'Create a draft page with the block checkout',
								'fieldwright-checkout-fields'
							) }
						</Button>

						<p className="cbwb-compat__note">
							{ __(
								'The draft is a copy to test on. Your live checkout is left exactly as it is.',
								'fieldwright-checkout-fields'
							) }
						</p>

						{ draft && (
							<p className="cbwb-compat__link">
								<ExternalLink href={ draft.edit_url }>
									{ __(
										'Edit draft',
										'fieldwright-checkout-fields'
									) }
								</ExternalLink>{ ' ' }
								<ExternalLink href={ draft.preview_url }>
									{ __(
										'Preview draft',
										'fieldwright-checkout-fields'
									) }
								</ExternalLink>
							</p>
						) }
					</div>
				) }
			</CardBody>
		</Card>
	);
}

export default function CompatibilityTab() {
	const [ report, setReport ] = useState< CompatibilityReport | null >(
		null
	);
	const [ error, setError ] = useState< string | null >( null );

	useEffect( () => {
		let live = true;

		fetchCompatibility()
			.then( ( scan ) => {
				if ( live ) {
					setReport( scan );
				}
			} )
			.catch( ( caught ) => {
				if ( live ) {
					setError(
						toApiError( caught ).message ??
							__(
								'Something went wrong.',
								'fieldwright-checkout-fields'
							)
					);
				}
			} );

		return () => {
			live = false;
		};
	}, [] );

	if ( error ) {
		return (
			<div className="cbwb-compat">
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			</div>
		);
	}

	if ( ! report ) {
		return (
			<div className="cbwb-compat">
				<p className="cbwb-compat__loading">
					<Spinner />
					{ __(
						'Checking your plugins…',
						'fieldwright-checkout-fields'
					) }
				</p>
			</div>
		);
	}

	const labels = bucketLabels();

	/*
	 * Every read of the report is defensive. The buckets are a contract, but a
	 * site mid-upgrade can serve a report from the older scanner — and a tab
	 * that throws is worse than one missing a column.
	 */
	const pluginsIn = ( bucket: CompatibilityBucket ): CompatibilityPlugin[] =>
		report.plugins?.[ bucket ] ?? [];

	return (
		<div className="cbwb-compat">
			<CheckoutCard report={ report } />

			<Card className="cbwb-compat__card">
				<CardHeader>
					<h2 className="cbwb-compat__title">
						{ __( 'Your plugins', 'fieldwright-checkout-fields' ) }
					</h2>
				</CardHeader>
				<CardBody>
					<ul className="cbwb-compat__stats">
						{ BUCKETS.map( ( bucket ) => (
							<li
								key={ bucket }
								className={ `cbwb-compat__stat is-${ bucket }` }
							>
								<span className="cbwb-compat__stat-value">
									{ report.summary?.[ bucket ] ??
										pluginsIn( bucket ).length }
								</span>
								<span className="cbwb-compat__stat-label">
									{ labels[ bucket ] }
								</span>
							</li>
						) ) }
					</ul>

					{ BUCKETS.map( ( bucket ) => (
						<section
							key={ bucket }
							className="cbwb-compat__group"
							aria-label={ labels[ bucket ] }
						>
							<h3 className="cbwb-compat__group-title">
								{ labels[ bucket ] }
							</h3>
							{ report.notes?.[ bucket ] && (
								<p className="cbwb-compat__note">
									{ report.notes[ bucket ] }
								</p>
							) }
							<PluginTable
								label={ labels[ bucket ] }
								plugins={ pluginsIn( bucket ) }
							/>
						</section>
					) ) }
				</CardBody>
			</Card>
		</div>
	);
}
