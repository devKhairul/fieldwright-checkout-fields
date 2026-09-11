/**
 * Field key generation. Must agree with the PHP id regex
 * `^cbwb/[a-z0-9]+(-[a-z0-9]+)*$`.
 */

export const MAX_SLUG_LENGTH = 40;

/** Fallback used when a label contains nothing sluggable. */
export const FALLBACK_SLUG = 'field';

/** Unicode combining diacritical marks, stripped after NFD normalization. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Turn a human label into a URL-ish slug: lowercase, diacritics folded,
 * non-alphanumerics collapsed to single dashes, trimmed and length-capped.
 *
 * @param label     Human-readable label.
 * @param maxLength Maximum slug length.
 * @return Slug, never empty.
 */
export function slugify(
	label: string,
	maxLength: number = MAX_SLUG_LENGTH
): string {
	const folded = label
		.normalize( 'NFD' )
		.replace( COMBINING_MARKS, '' )
		.toLowerCase();

	const slug = folded
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, Math.max( 1, maxLength ) )
		.replace( /^-+|-+$/g, '' );

	return '' === slug ? FALLBACK_SLUG : slug;
}

/**
 * Build a field key that is unique against the ids already in use.
 *
 * @param label  Label to derive the key from.
 * @param taken  Ids already in use.
 * @param prefix Namespace prefix, e.g. `cbwb/`.
 * @return A unique field key.
 */
export function uniqueFieldId(
	label: string,
	taken: Iterable< string >,
	prefix: string
): string {
	const used = new Set( taken );
	const base = slugify( label );

	if ( ! used.has( prefix + base ) ) {
		return prefix + base;
	}

	for ( let n = 2; n < 1000; n++ ) {
		const suffix = `-${ n }`;
		const trimmed = base
			.slice( 0, MAX_SLUG_LENGTH - suffix.length )
			.replace( /-+$/g, '' );
		const candidate = `${ prefix }${
			'' === trimmed ? FALLBACK_SLUG : trimmed
		}${ suffix }`;
		if ( ! used.has( candidate ) ) {
			return candidate;
		}
	}

	/* istanbul ignore next -- 998 collisions on one slug is not reachable in practice. */
	return `${ prefix }${ FALLBACK_SLUG }-${ Date.now() }`;
}
