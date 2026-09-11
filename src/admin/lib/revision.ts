/**
 * Which configuration the builder is working against.
 *
 * The server stamps every read of the config, and every save has to send the
 * stamp it was made from. If someone else has saved in between, the stamp no
 * longer matches and the save is refused with a 409 rather than quietly
 * overwriting their work.
 *
 * Kept here rather than in the builder's reducer because it is not part of the
 * merchant's working copy: it describes the server, not the edits, and it has to
 * survive every action that rebuilds the working copy.
 */

import { getBootstrap } from '../types';
import type { Config } from '../types';

let current: string | null = null;

/**
 * The stamp to send with the next save.
 *
 * Falls back to whatever the page was rendered with, which is the usual answer:
 * the builder is seeded from the inline bootstrap and saves for the first time
 * without ever having called the REST route.
 *
 * @return The stamp, or '' when this server sent none at all.
 */
export function getRevision(): string {
	if ( null !== current && '' !== current ) {
		return current;
	}

	const fromPage = getBootstrap().config.revision;

	return 'string' === typeof fromPage ? fromPage : '';
}

/**
 * Remember the stamp a response carried.
 *
 * @param config A config the server just answered with.
 */
export function rememberRevision( config: Config ): void {
	// An empty stamp is not one: remembering it would replace a usable stamp
	// from the page with something the server is bound to refuse.
	if ( 'string' === typeof config.revision && '' !== config.revision ) {
		current = config.revision;
	}
}

/**
 * Forget the stamp, so the next read falls back to the page's own.
 *
 * For tests, which share one module instance.
 */
export function resetRevision(): void {
	current = null;
}
