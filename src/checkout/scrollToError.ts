/**
 * Taking the shopper to the field that stopped the order.
 *
 * WooCommerce already does this, but only for the elements it knows how to
 * find. Measured against WooCommerce 11.0.1, `checkout-frontend.js` waits for
 * the checkout to be idle *and* in error *and* holding validation errors, then
 * calls `showAllValidationErrors()` and, 50ms later, scrolls to
 *
 *     document.querySelector( 'input:invalid, .has-error input, .has-error select' )
 *
 * Three of our five answerable types are made of `input` elements, so a radio
 * group, a checkbox group, a date and a time are all found by that selector
 * once their wrapper carries `has-error`. A textarea is not an `input` and
 * matches nothing in it — so a shopper who left a required gift message empty
 * would be told the order failed, and shown the top of a form with no visible
 * reason why.
 *
 * This closes that gap without fighting core for it: it runs after core's own
 * scroll would have happened, and only takes over when core had nothing earlier
 * in the page to scroll to. If core found something above our field, core was
 * right — that error comes first.
 */

/** What core looks for, so we can tell whether it found anything. */
export const CORE_SELECTOR =
	'input:invalid, .has-error input, .has-error select';

/** Our own fields, once they are showing an error. */
export const FIELD_SELECTOR = '.cbwb-field.has-error';

/** What to move focus to inside one of our fields. */
const FOCUSABLE = 'textarea, input, select, button';

/**
 * Long enough to be sure core has had its turn.
 *
 * Core waits 50ms after the checkout errors before it scrolls; going second is
 * the whole point, so this waits longer than that and then looks at what
 * actually happened.
 */
export const SETTLE_MS = 120;

interface CheckoutStoreLike {
	hasError?: () => boolean;
	isIdle?: () => boolean;
}

export interface ErrorFocusDeps {
	/** Reads a store by key; WooCommerce's checkout store is the one wanted. */
	select: ( key: string ) => CheckoutStoreLike | undefined | null;
	/** The checkout store's key. */
	storeKey: string;
	subscribe: ( listener: () => void ) => () => void;
	/** Overridable for tests. */
	settleMs?: number;
	/** Overridable for tests. */
	doc?: Document;
}

/**
 * Whether one node comes before another in the document.
 *
 * @param node   Node to compare.
 * @param before Node it might come after.
 * @return True when `before` really is earlier in the page.
 */
function comesFirst( node: Element, before: Element ): boolean {
	/* eslint-disable-next-line no-bitwise -- compareDocumentPosition is a bitmask. */
	return 0 !== ( node.compareDocumentPosition( before ) & 2 );
}

/**
 * Scroll to the first of our fields that is showing an error, if core did not
 * already scroll somewhere better.
 *
 * @param doc Document to search.
 * @return True when this moved the page.
 */
export function focusFirstFieldError( doc: Document ): boolean {
	const field = doc.querySelector< HTMLElement >( FIELD_SELECTOR );

	if ( ! field ) {
		return false;
	}

	const core = doc.querySelector< HTMLElement >( CORE_SELECTOR );

	// Core scrolls to the first match in the whole document. If that match is
	// above our field, the shopper is already looking at the right problem.
	if ( core && comesFirst( field, core ) ) {
		return false;
	}

	field.scrollIntoView?.( { block: 'center' } );
	// Asked of the field, not the document: a selector list only scopes its
	// first member, so `${ FIELD_SELECTOR } ${ FOCUSABLE }` would have matched
	// the first input anywhere on the page.
	field.querySelector< HTMLElement >( FOCUSABLE )?.focus?.();

	return true;
}

/**
 * Watch the checkout and take over the scroll when core cannot do it.
 *
 * @param deps Everything this needs from the page.
 * @return A function that stops watching.
 */
export function startErrorFocus( deps: ErrorFocusDeps ): () => void {
	const {
		select,
		storeKey,
		subscribe,
		settleMs = SETTLE_MS,
		doc = 'undefined' === typeof document ? undefined : document,
	} = deps;

	const noop = () => {};

	if (
		'function' !== typeof select ||
		'function' !== typeof subscribe ||
		! doc
	) {
		return noop;
	}

	let stopped = false;
	let failing = false;
	let timer: ReturnType< typeof setTimeout > | null = null;

	const tick = () => {
		if ( stopped ) {
			return;
		}

		const store = select( storeKey );
		// The same three conditions core waits for, so this fires on the same
		// transition core's own scroll does and never on a half-settled one.
		const next = Boolean(
			store?.hasError?.() && store?.isIdle?.() !== false
		);

		if ( next === failing ) {
			return;
		}

		failing = next;

		if ( ! next || null !== timer ) {
			return;
		}

		timer = setTimeout( () => {
			timer = null;

			if ( ! stopped ) {
				focusFirstFieldError( doc );
			}
		}, settleMs );
	};

	const unsubscribe = subscribe( tick );

	return () => {
		stopped = true;

		if ( null !== timer ) {
			clearTimeout( timer );
			timer = null;
		}

		unsubscribe();
	};
}
