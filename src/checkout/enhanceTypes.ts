/**
 * Giving core-rendered inputs the keyboard they deserve.
 *
 * WooCommerce's Checkout Fields API knows three input types: text, select and
 * checkbox. A merchant asking for an email address, a phone number, a quantity
 * or a URL gets a plain text box — which on a phone means the wrong keyboard,
 * no `@` key where one is needed, and no browser validation at all.
 *
 * The server cannot fix that: the field's `type` is core's to choose. What it
 * *can* do is pass extra attributes through — WooCommerce spreads a field's
 * `attributes` onto the rendered input — so it marks each one with
 * `data-cbwb-type` (and `data-cbwb-min`, `-max`, `-step` where they apply), and
 * this corrects the element after React has drawn it.
 *
 * ## Why the correction sticks, and why it still needs watching
 *
 * React does not police attributes it did not set this render: it diffs against
 * its own previous props, so an input whose `type` prop stays `"text"` is never
 * written to again, and ours survives every re-render. What it does not survive
 * is a *remount* — React setting up the element from scratch — which is why
 * there is an observer rather than a single pass. Mutations we cause ourselves
 * are attribute changes, and the observer watches only for nodes coming and
 * going, so it cannot set itself off.
 */

/** What each marked type should really be. */
interface Enhancement {
	type: string;
	inputMode: string;
}

/**
 * The types the server marks, and what they become.
 *
 * `tel` rather than `phone` on the output side: `phone` is the merchant's word
 * for it and the field schema's, `tel` is HTML's.
 */
export const ENHANCED_TYPES: Record< string, Enhancement > = {
	email: { type: 'email', inputMode: 'email' },
	phone: { type: 'tel', inputMode: 'tel' },
	tel: { type: 'tel', inputMode: 'tel' },
	number: { type: 'number', inputMode: 'decimal' },
	url: { type: 'url', inputMode: 'url' },
};

/** Marker attributes to the real ones they stand in for. */
const RANGE_ATTRIBUTES: Record< string, string > = {
	'data-cbwb-min': 'min',
	'data-cbwb-max': 'max',
	'data-cbwb-step': 'step',
};

/**
 * Correct one input.
 *
 * @param input Input carrying `data-cbwb-type`.
 * @return True when anything changed.
 */
function enhance( input: HTMLInputElement ): boolean {
	const wanted = ENHANCED_TYPES[ input.dataset.cbwbType ?? '' ];

	if ( ! wanted ) {
		return false;
	}

	let changed = false;

	// Only when it differs. Assigning `type` on a number input whose value is
	// not a number blanks that value, so the assignment has to be rare enough
	// to be safe — once per mount, not once per keystroke.
	if ( input.getAttribute( 'type' ) !== wanted.type ) {
		input.setAttribute( 'type', wanted.type );
		changed = true;
	}

	if ( input.getAttribute( 'inputmode' ) !== wanted.inputMode ) {
		input.setAttribute( 'inputmode', wanted.inputMode );
		changed = true;
	}

	Object.keys( RANGE_ATTRIBUTES ).forEach( ( marker ) => {
		const value = input.getAttribute( marker );
		const real = RANGE_ATTRIBUTES[ marker ];

		if ( null !== value && input.getAttribute( real ) !== value ) {
			input.setAttribute( real, value );
			changed = true;
		}
	} );

	return changed;
}

/**
 * Correct every marked input under a root.
 *
 * @param root Anything to search in.
 * @return How many inputs changed.
 */
export function enhanceInputs( root: ParentNode ): number {
	const inputs = root.querySelectorAll< HTMLInputElement >(
		'input[data-cbwb-type]'
	);

	return Array.from( inputs ).reduce(
		( count, input ) => count + ( enhance( input ) ? 1 : 0 ),
		0
	);
}

export interface TypeEnhancerOptions {
	/** Where to watch. Defaults to the document body. */
	root?: Element | Document | null;
	/** How long to wait after a batch of DOM changes. */
	settleMs?: number;
}

/**
 * Watch the checkout and keep every marked input corrected.
 *
 * @param options Where and how to watch.
 * @return A function that stops watching.
 */
export function startTypeEnhancer(
	options: TypeEnhancerOptions = {}
): () => void {
	const noop = () => {};

	if ( 'undefined' === typeof window || 'undefined' === typeof document ) {
		return noop;
	}

	const root = options.root ?? document.body;
	const settleMs = options.settleMs ?? 0;

	if ( ! root || 'undefined' === typeof MutationObserver ) {
		return noop;
	}

	let timer: ReturnType< typeof setTimeout > | null = null;

	const run = () => {
		timer = null;
		enhanceInputs( root );
	};

	// Coalesced: the checkout rewrites whole sections at a time, and every
	// pass is a query across the form.
	const schedule = () => {
		if ( null === timer ) {
			timer = setTimeout( run, settleMs );
		}
	};

	const observer = new MutationObserver( schedule );

	observer.observe( root, { childList: true, subtree: true } );
	enhanceInputs( root );

	return () => {
		observer.disconnect();

		if ( null !== timer ) {
			clearTimeout( timer );
			timer = null;
		}
	};
}
