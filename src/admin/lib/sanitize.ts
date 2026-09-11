/**
 * The paragraph type's limited HTML, cut down to what the checkout will render.
 *
 * The server sanitizes what it stores, but the preview draws what the merchant
 * is typing *now* — before any of it has been saved — so the builder has to do
 * the same cutting down itself rather than trusting the string in front of it.
 * The allowlist is the contract's: `a`, `strong`, `em` and `br`, with nothing
 * but a safe `href` on the link.
 *
 * Parsing happens in a detached document created by
 * `document.implementation.createHTMLDocument()`, which fetches nothing and runs
 * nothing: an `<img onerror>` in there is inert markup, and it is removed before
 * the result is handed back.
 */

/** Tags that survive, with the attributes each may keep. */
const ALLOWED: Record< string, string[] > = {
	a: [ 'href' ],
	strong: [],
	em: [],
	br: [],
};

/** Tags removed outright, contents and all. */
const DROPPED = [
	'script',
	'style',
	'iframe',
	'object',
	'embed',
	'template',
	'noscript',
	'svg',
	'math',
];

/** Link targets a checkout may point at. */
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|#)/i;

/**
 * Strip one element's children down to the allowlist, in place.
 *
 * Anything not on the list is unwrapped rather than deleted — a merchant who
 * pastes a styled paragraph in keeps their words and loses only the markup.
 *
 * @param node Element whose children are being cleaned.
 */
function clean( node: Element ): void {
	Array.from( node.children ).forEach( ( child ) => {
		const tag = child.tagName.toLowerCase();

		if ( DROPPED.includes( tag ) ) {
			child.remove();
			return;
		}

		if ( ! ( tag in ALLOWED ) ) {
			clean( child );
			child.replaceWith( ...Array.from( child.childNodes ) );
			return;
		}

		Array.from( child.attributes ).forEach( ( attribute ) => {
			if ( ! ALLOWED[ tag ].includes( attribute.name.toLowerCase() ) ) {
				child.removeAttribute( attribute.name );
			}
		} );

		if (
			'a' === tag &&
			! SAFE_HREF.test( child.getAttribute( 'href' ) ?? '' )
		) {
			child.removeAttribute( 'href' );
		}

		clean( child );
	} );
}

/**
 * The merchant's paragraph text, safe to render.
 *
 * @param html Raw content.
 * @return Sanitized HTML.
 */
export function sanitizeContent( html: string ): string {
	if ( '' === html.trim() ) {
		return '';
	}

	try {
		const doc = document.implementation.createHTMLDocument( '' );
		doc.body.innerHTML = html;
		clean( doc.body );
		return doc.body.innerHTML;
	} catch {
		// No DOM to parse with: print the words and none of the markup.
		return html.replace( /<[^>]*>/g, '' );
	}
}
