import apiFetch from '@wordpress/api-fetch';

import type {
	ApiError,
	CompatibilityDraftPage,
	CompatibilityReport,
	Config,
	CoreConfig,
	Field,
	Settings,
} from '../types';
import { getBootstrap } from '../types';
import { toPayload } from './fields';
import { getRevision, rememberRevision } from './revision';

export async function fetchConfig(): Promise< Config > {
	const config = await apiFetch< Config >( {
		path: getBootstrap().restRoute,
	} );

	rememberRevision( config );

	return config;
}

/**
 * Replace the stored fields, and what was changed about WooCommerce's own.
 *
 * Every field goes through `toPayload()` first: the builder's `min`, `max` and
 * `step` are strings, and the config takes numbers.
 *
 * `core` is left out entirely when this build has no core rows to speak of —
 * a server that predates them would ignore it, and a builder that never showed
 * the rows has nothing to say about them either way.
 *
 * The stamp of the configuration this save was written against goes with it, so
 * a second merchant editing the same screen is told rather than overwritten.
 *
 * @param fields Fields to store.
 * @param core   Core-field overrides, or undefined to leave them untouched.
 * @return The stored config, as the server normalized it.
 */
export async function saveConfig(
	fields: Field[],
	core?: CoreConfig
): Promise< Config > {
	const config = await apiFetch< Config >( {
		path: getBootstrap().restRoute,
		method: 'PUT',
		data: {
			fields: fields.map( toPayload ),
			revision: getRevision(),
			...( core ? { core } : {} ),
		},
	} );

	rememberRevision( config );

	return config;
}

/** Error code the server answers a save written against stale data with. */
export const STALE_REVISION = 'cbwb_stale_revision';

export function fetchSettings(): Promise< Settings > {
	return apiFetch< Settings >( { path: getBootstrap().settingsRoute } );
}

export function saveSettings( settings: Settings ): Promise< Settings > {
	return apiFetch< Settings >( {
		path: getBootstrap().settingsRoute,
		method: 'PATCH',
		data: settings,
	} );
}

/**
 * Run the block checkout migration scan.
 *
 * @return The report.
 */
export function fetchCompatibility(): Promise< CompatibilityReport > {
	return apiFetch< CompatibilityReport >( {
		path: getBootstrap().compatibilityRoute,
	} );
}

/**
 * Create (or reuse) the draft page a merchant tries the block checkout on.
 *
 * @return The page's id and its edit and preview links.
 */
export function createCompatibilityDraftPage(): Promise< CompatibilityDraftPage > {
	return apiFetch< CompatibilityDraftPage >( {
		path: `${ getBootstrap().compatibilityRoute }/draft-page`,
		method: 'POST',
	} );
}

/**
 * Narrow an unknown rejection into the REST error envelope.
 *
 * @param error Rejected value.
 * @return The error envelope, always with a message.
 */
export function toApiError( error: unknown ): ApiError {
	if ( error && 'object' === typeof error ) {
		return error as ApiError;
	}
	return { message: String( error ) };
}
