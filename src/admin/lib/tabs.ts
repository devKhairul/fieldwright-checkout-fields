/**
 * Moving between the builder's tabs from somewhere inside one of them.
 *
 * The tab strip is App's own state, and the places that need to send a merchant
 * to another tab are leaves: a section an add-on put in the field editor, a
 * panel it put on Settings. Rather than thread a callback through six components
 * that have nothing to do with tabs, App publishes one here and the leaves ask
 * for it.
 *
 * Which tabs exist is part of the answer. An add-on's tab is registered through
 * `cbwb.tabs` and may not be there at all, so a component that wants to link to
 * one has to be able to find out before it offers the link.
 */

import { createContext, useContext } from '@wordpress/element';

/**
 * The key Fieldwright Pro registers its License tab under.
 *
 * Named here because a key is the only thing the two plugins can agree on
 * without one importing the other, and an add-on's own sections point at it from
 * inside the builder. A build of Pro that does not register it simply leaves the
 * tab missing, which every caller already has to handle.
 */
export const LICENSE_TAB = 'cbwb-pro-license';

/**
 * The builder's own Compatibility tab, by key.
 *
 * Named here because a component inside the Fields tab links to it, and a key
 * spelled twice is a key that can drift.
 */
export const COMPATIBILITY_TAB = 'compatibility';

export interface TabSwitcher {
	/** Every tab on the strip, in order, by key. */
	tabs: string[];
	/** Open one of them. */
	open: ( key: string ) => void;
}

const TabContext = createContext< TabSwitcher | null >( null );

export const TabProvider = TabContext.Provider;

/**
 * The tab strip, or null when the component is rendered outside the builder.
 *
 * Null is a real answer rather than an error: these components are also
 * rendered on their own in tests, and a link that cannot go anywhere is one
 * that should not be offered.
 *
 * @return The switcher, or null.
 */
export function useTabs(): TabSwitcher | null {
	return useContext( TabContext );
}
