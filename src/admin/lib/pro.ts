/**
 * The paid add-on, as the builder refers to it.
 *
 * Three places name Fieldwright Pro: the line at the foot of the type picker,
 * the line above the field list, and the Pro tab, plus the sentences under a
 * field's settings saying what Pro would add to the field in front of you. All
 * of them read the address from here, because the plugin is the same for
 * everyone, the address does not vary by store, and a link the server has to
 * supply is a link the server has to have an opinion about.
 *
 * Every one of them is drawn only while Pro is not running, and none of them
 * interrupts: they sit where a merchant is already looking, in the builder and
 * nowhere else.
 */

import { LICENSE_TAB } from './tabs';

/** Where the paid add-on is described and sold. */
export const PRO_URL = 'https://fieldwright.methodicalstudio.com/pro/';

/**
 * The key Free's own Pro tab holds.
 *
 * Reserved against `cbwb.tabs` as the builder's own three are, so a tab under
 * this key is always the one below rather than an add-on's.
 */
export const PRO_TAB = 'pro';

/**
 * Whether the paid add-on is running.
 *
 * Asked of the tab strip, because registering a tab under `LICENSE_TAB` is how
 * Pro announces itself and a key is the only thing the two plugins agree on
 * without one importing the other. Nothing here looks for a plugin slug or asks
 * WordPress which plugins are active: a build of Pro that registers no tab has
 * no screen to replace these invitations with, and a merchant who has one
 * should be reading it rather than an advertisement for what they own.
 *
 * @param tabs Every tab on the strip, by key.
 * @return True when nothing has registered Pro's tab.
 */
export function proIsAbsent( tabs: readonly string[] ): boolean {
	return ! tabs.includes( LICENSE_TAB );
}
