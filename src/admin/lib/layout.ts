/**
 * How many of the builder's three panes fit side by side.
 *
 * The breakpoints here are the JavaScript half of the ones in `style.scss`;
 * both read the same two widths, so what the grid does and what the pane
 * switcher offers can never disagree.
 */

import { useEffect, useState } from '@wordpress/element';

/** Fields · Field settings · Preview, all at once, in that order. */
export const THREE_PANE_MIN = 1280;

/** The Fields outline beside either the inspector or the preview. */
export const TWO_PANE_MIN = 1024;

export type LayoutMode = 'three' | 'two' | 'one';

/**
 * Which pane a narrow window is showing. Listed in the order the wide layout
 * puts them in, which is also the order the switcher offers them.
 */
export type PaneView = 'fields' | 'settings' | 'preview';

const QUERIES = {
	three: `(min-width: ${ THREE_PANE_MIN }px)`,
	two: `(min-width: ${ TWO_PANE_MIN }px)`,
};

/**
 * Match a media query, or fall back to the window's own width where
 * `matchMedia` is missing (very old browsers, and some test environments).
 *
 * @param query Media query.
 * @param width Width the query's `min-width` is asking about.
 * @return True when the query matches.
 */
function matches( query: string, width: number ): boolean {
	const list = window.matchMedia?.( query );
	return list ? list.matches : ( window.innerWidth ?? 0 ) >= width;
}

/**
 * The current layout mode.
 *
 * @return Mode.
 */
export function readLayoutMode(): LayoutMode {
	if ( matches( QUERIES.three, THREE_PANE_MIN ) ) {
		return 'three';
	}
	return matches( QUERIES.two, TWO_PANE_MIN ) ? 'two' : 'one';
}

/**
 * Track the layout mode across resizes.
 *
 * @return The current mode.
 */
export function useLayoutMode(): LayoutMode {
	const [ mode, setMode ] = useState< LayoutMode >( readLayoutMode );

	useEffect( () => {
		const update = () => setMode( readLayoutMode() );

		// Re-read on the first paint too: the server has no window, and a
		// resize between mount and this effect would otherwise be missed.
		update();

		const lists = Object.values( QUERIES )
			.map( ( query ) => window.matchMedia?.( query ) )
			.filter( Boolean ) as MediaQueryList[];

		lists.forEach(
			( list ) => list.addEventListener?.( 'change', update )
		);
		window.addEventListener( 'resize', update );

		return () => {
			lists.forEach(
				( list ) => list.removeEventListener?.( 'change', update )
			);
			window.removeEventListener( 'resize', update );
		};
	}, [] );

	return mode;
}

/**
 * The panes visible in a given mode, given which one the switcher is on.
 *
 * At three panes everything is on screen and the switcher is not rendered. At
 * two, the Fields outline is always up and the switcher chooses what sits
 * beside it. At one, the switcher chooses the only pane there is.
 *
 * @param mode Layout mode.
 * @param view Pane the switcher is on.
 * @return Which panes to render.
 */
export function visiblePanes(
	mode: LayoutMode,
	view: PaneView
): { fields: boolean; settings: boolean; preview: boolean } {
	if ( 'three' === mode ) {
		return { fields: true, settings: true, preview: true };
	}

	if ( 'two' === mode ) {
		// 'fields' is not one of the two-pane switcher's choices — the outline
		// is always up — so it falls back to the inspector.
		return {
			fields: true,
			settings: 'preview' !== view,
			preview: 'preview' === view,
		};
	}

	return {
		fields: 'fields' === view,
		settings: 'settings' === view,
		preview: 'preview' === view,
	};
}
