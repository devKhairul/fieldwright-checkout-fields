import type { KeyboardEvent } from 'react';

export interface TabDefinition {
	name: string;
	title: string;
}

interface TabsProps {
	tabs: TabDefinition[];
	active: string;
	onSelect: ( name: string ) => void;
}

export const tabId = ( name: string ) => `cbwb-tab-${ name }`;
export const tabPanelId = ( name: string ) => `cbwb-tabpanel-${ name }`;

/**
 * A minimal ARIA tablist. Roving tabindex plus arrow/Home/End keys, so the
 * whole switcher is one tab stop.
 *
 * @param props          Component props.
 * @param props.tabs     Tabs to render.
 * @param props.active   Name of the selected tab.
 * @param props.onSelect Called with the newly selected tab name.
 */
export default function Tabs( { tabs, active, onSelect }: TabsProps ) {
	const focusTab = ( index: number ) => {
		const bounded = ( index + tabs.length ) % tabs.length;
		const tab = tabs[ bounded ];
		onSelect( tab.name );
		// Looked up by id rather than matched by a selector built from one: an
		// add-on names its own tab, and a key with anything a selector reads as
		// syntax would throw rather than move the focus.
		document.getElementById( tabId( tab.name ) )?.focus();
	};

	const onKeyDown = ( event: KeyboardEvent< HTMLButtonElement > ) => {
		const current = tabs.findIndex( ( tab ) => tab.name === active );
		if ( 'ArrowRight' === event.key ) {
			event.preventDefault();
			focusTab( current + 1 );
		} else if ( 'ArrowLeft' === event.key ) {
			event.preventDefault();
			focusTab( current - 1 );
		} else if ( 'Home' === event.key ) {
			event.preventDefault();
			focusTab( 0 );
		} else if ( 'End' === event.key ) {
			event.preventDefault();
			focusTab( tabs.length - 1 );
		}
	};

	return (
		<div className="cbwb-tabs" role="tablist">
			{ tabs.map( ( tab ) => {
				const isActive = tab.name === active;
				return (
					<button
						key={ tab.name }
						type="button"
						id={ tabId( tab.name ) }
						role="tab"
						className="cbwb-tabs__tab"
						aria-selected={ isActive }
						aria-controls={ tabPanelId( tab.name ) }
						tabIndex={ isActive ? 0 : -1 }
						onClick={ () => onSelect( tab.name ) }
						onKeyDown={ onKeyDown }
					>
						{ tab.title }
					</button>
				);
			} ) }
		</div>
	);
}
