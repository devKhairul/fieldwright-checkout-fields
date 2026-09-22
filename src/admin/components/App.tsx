import { Button, Notice, Snackbar } from '@wordpress/components';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';

import { STALE_REVISION, saveConfig, toApiError } from '../lib/api';
import { coreRowId, toCorePayload } from '../lib/coreFields';
import { createBlankField, fieldFromTemplate } from '../lib/fields';
import type { ImportedConfig } from '../lib/fields';
import { extraTabs } from '../lib/hooks';
import { PRO_TAB, proIsAbsent } from '../lib/pro';
import { COMPATIBILITY_TAB, TabProvider } from '../lib/tabs';
import type { PaneView } from '../lib/layout';
import type { ErrorMap } from '../lib/validate';
import { useLayoutMode, visiblePanes } from '../lib/layout';
import { resolvePlacements, resolveTypes } from '../lib/typeMeta';
import type { BuilderAction } from '../state/actions';
import {
	addField,
	importFields,
	resetCore,
	saved,
	select,
	setPseudo,
	setServerErrors,
	undoRemove,
	updateCore,
	updateField,
} from '../state/actions';
import { useBuilder } from '../state/useBuilder';
import type {
	CorePseudoKey,
	Field,
	FieldLocation,
	FieldType,
	Settings,
} from '../types';
import { getBootstrap, markingOf } from '../types';
import CheckoutNotice from './CheckoutNotice';
import CompatibilityTab from './CompatibilityTab';
import CoreFieldEditor from './CoreFieldEditor';
import EmptyState from './EmptyState';
import FieldEditor, { FieldEditorEmpty } from './FieldEditor';
import FieldList from './FieldList';
import Header from './Header';
import ImportExport from './ImportExport';
import type { AppNotice } from './Notices';
import Notices from './Notices';
import Preview from './Preview';
import ProLine from './ProLine';
import ProTab from './ProTab';
import SegmentedControl from './SegmentedControl';
import SettingsTab from './SettingsTab';
import Tabs, { tabId, tabPanelId } from './Tabs';

/**
 * The builder's own tabs, by key.
 *
 * Named here as well as built below, because an add-on's tab is appended to
 * these and must not collide with one of them. See `RESERVED_TABS`, which is
 * these plus the one tab the builder only sometimes draws.
 */
const OWN_TABS = [ 'fields', COMPATIBILITY_TAB, 'settings' ] as const;

/**
 * The keys an add-on's tab may not take.
 *
 * The builder's own three, and the Pro tab, which is on the strip only while
 * nothing has registered Pro's License tab. Reserved either way: a key that
 * means one thing on one store and another thing on the next is a key nobody
 * can write against.
 */
const RESERVED_TABS: readonly string[] = [ ...OWN_TABS, PRO_TAB ];

/** How long the undo snackbar sticks around after a delete. */
const UNDO_TIMEOUT = 8000;

/** How long a confirmation notice stays up. */
const CONFIRM_TIMEOUT = 4000;

interface AppSnackbar {
	id: number;
	message: string;
	timeout: number;
	action?: { label: string; onClick: () => void };
}

let noticeId = 0;
let snackbarId = 0;

/**
 * Which fields stand in the way of saving, each a button that opens it.
 *
 * "Fix the highlighted fields" was the whole of what this used to say, and a
 * highlight is a thin red border on a row that can be off the screen and a
 * message inside a section that can be folded away. Naming the fields, and
 * taking the merchant to one on a click, is what makes the notice something
 * they can act on rather than something to search for.
 *
 * @param props          Component props.
 * @param props.errors   The client validator's map.
 * @param props.fields   The merchant's own fields.
 * @param props.coreRows WooCommerce's own rows, for their labels.
 * @param props.onSelect Opens a field or a row in the editor.
 */
function ProblemFields( {
	errors,
	fields,
	coreRows,
	onSelect,
}: {
	errors: ErrorMap;
	fields: Field[];
	coreRows: { key: string; label: string }[];
	onSelect: ( id: string ) => void;
} ) {
	const named: { id: string; label: string }[] = [];

	Object.keys( errors.byField ).forEach( ( id ) => {
		const field = fields.find( ( candidate ) => candidate.id === id );
		named.push( {
			id,
			label:
				field && '' !== field.label.trim()
					? field.label
					: __( 'Untitled field', 'fieldwright-checkout-fields' ),
		} );
	} );

	Object.keys( errors.byCore ).forEach( ( key ) => {
		const row = coreRows.find( ( candidate ) => candidate.key === key );
		const label = row?.label.trim() ?? '';
		named.push( {
			id: coreRowId( key ),
			label:
				'' !== label
					? label
					: __( 'Untitled field', 'fieldwright-checkout-fields' ),
		} );
	} );

	if ( 0 === named.length ) {
		// Every problem is a general one, already printed above this line.
		return (
			<>
				{ __(
					'Fix the problems above to save.',
					'fieldwright-checkout-fields'
				) }
			</>
		);
	}

	return (
		<>
			{ _n(
				'Fix this field to save:',
				'Fix these fields to save:',
				named.length,
				'fieldwright-checkout-fields'
			) }{ ' ' }
			{ named.map( ( entry, index ) => (
				<span key={ entry.id }>
					{ index > 0 && ', ' }
					<Button
						variant="link"
						className="cbwb-problem-field"
						onClick={ () => onSelect( entry.id ) }
					>
						{ entry.label }
					</Button>
				</span>
			) ) }
		</>
	);
}

export default function App() {
	const bootstrap = getBootstrap();
	const builder = useBuilder( bootstrap );
	const { state, dispatch, dirty, groups, clientErrors, errors } = builder;

	const [ tab, setTab ] = useState( 'fields' );
	const [ notices, setNotices ] = useState< AppNotice[] >( [] );
	const [ snackbar, setSnackbar ] = useState< AppSnackbar | null >( null );
	const [ saving, setSaving ] = useState( false );
	const [ settings, setSettings ] = useState< Settings >(
		bootstrap.settings
	);

	const takenIds = useMemo(
		() => state.fields.map( ( field ) => field.id ),
		[ state.fields ]
	);

	/*
	 * The bootstrap describes types and placements in the merchant's language;
	 * these fill in everything it has no opinion about (icons, picker groups)
	 * and everything an older PHP half has not learned yet. Read once and handed
	 * down, so the outline, the canvas and the type picker cannot disagree about
	 * what the store can build.
	 */
	const types = useMemo(
		() => resolveTypes( bootstrap.types ),
		[ bootstrap.types ]
	);
	const placements = useMemo(
		() => resolvePlacements( bootstrap ),
		[ bootstrap ]
	);

	/*
	 * Trouble the server saw out on the checkout. Not dismissible and not
	 * cleared by saving: the flag behind it expires on its own, and until it
	 * does the problem is still live for customers.
	 */
	const warnings = bootstrap.warnings ?? [];

	const notify = useCallback(
		(
			status: AppNotice[ 'status' ],
			message: string,
			actions?: AppNotice[ 'actions' ]
		) => {
			noticeId += 1;
			setNotices( [
				{ id: `cbwb-notice-${ noticeId }`, status, message, actions },
			] );
		},
		[]
	);

	/**
	 * Confirm something the merchant just did, where they are looking.
	 *
	 * A confirmation is drawn as a notice at the top of the panel it belongs
	 * to, in place of anything else the panel was saying, and takes itself away
	 * after a few seconds. It used to be a snackbar at the bottom of the window,
	 * which on a wide screen sits a long way from the button that was just
	 * pressed and is easy to miss altogether.
	 */
	const flash = useCallback( ( message: string ) => {
		noticeId += 1;
		const id = `cbwb-notice-${ noticeId }`;
		setNotices( [ { id, status: 'success', message } ] );
		window.setTimeout( () => {
			setNotices( ( current ) =>
				current.filter( ( notice ) => notice.id !== id )
			);
		}, CONFIRM_TIMEOUT );
	}, [] );

	useEffect( () => {
		if ( ! snackbar ) {
			return;
		}
		const timer = window.setTimeout( () => {
			setSnackbar( ( current ) =>
				current && current.id === snackbar.id ? null : current
			);
		}, snackbar.timeout );
		return () => window.clearTimeout( timer );
	}, [ snackbar ] );

	const canSave = dirty && ! saving && 0 === clientErrors.count;

	const save = useCallback( async () => {
		if ( ! canSave ) {
			return;
		}
		setSaving( true );
		try {
			/*
			 * A server that has no core rows to offer is one that would not know
			 * what to do with them either. `toCorePayload()` is what turns the
			 * stored shape into the one the wire takes.
			 */
			const corePayload = builder.hasCore
				? toCorePayload( state.core, builder.coreRows )
				: undefined;
			/*
			 * What the request was made from is remembered and handed to the
			 * reducer, because the answer is only ever an echo of it. A merchant
			 * who keeps typing while it is in flight has a working copy the
			 * server has not seen, and the reducer needs both halves to tell
			 * that from a save nothing happened during.
			 */
			const sent = {
				fields: state.fields,
				core: builder.hasCore ? state.core : undefined,
				corePayload,
			};
			const config = await saveConfig( sent.fields, corePayload );
			dispatch( saved( config, sent ) );
			setNotices( [] );
			flash(
				__( 'Checkout fields saved.', 'fieldwright-checkout-fields' )
			);
		} catch ( caught ) {
			const error = toApiError( caught );
			const serverErrors = error.data?.errors;

			if ( 400 === error.data?.status && Array.isArray( serverErrors ) ) {
				dispatch( setServerErrors( serverErrors ) );
				notify(
					'error',
					__(
						'Some fields need attention.',
						'fieldwright-checkout-fields'
					)
				);
			} else if (
				STALE_REVISION === error.code ||
				409 === error.data?.status
			) {
				// Somebody else saved while this screen was open. Nothing is
				// dispatched: the merchant's edits stay exactly where they are,
				// so they can copy anything they need before reloading, or keep
				// working and try again.
				notify(
					'warning',
					__(
						'Someone else has changed the checkout fields since this screen loaded. Your changes have not been saved. Reload to see theirs, then make yours again.',
						'fieldwright-checkout-fields'
					),
					[
						{
							label: __(
								'Reload',
								'fieldwright-checkout-fields'
							),
							onClick: () => window.location.reload(),
							variant: 'primary',
						},
					]
				);
			} else {
				notify(
					'error',
					error.message ??
						__(
							'Something went wrong.',
							'fieldwright-checkout-fields'
						)
				);
			}
		} finally {
			setSaving( false );
		}
	}, [
		builder.coreRows,
		builder.hasCore,
		canSave,
		dispatch,
		flash,
		notify,
		state.core,
		state.fields,
	] );

	// Cmd/Ctrl+S saves, but only when there is something to save.
	const saveRef = useRef( save );
	saveRef.current = save;
	useEffect( () => {
		const onKeyDown = ( event: KeyboardEvent ) => {
			if ( 's' !== event.key.toLowerCase() ) {
				return;
			}
			if ( ! event.metaKey && ! event.ctrlKey ) {
				return;
			}
			event.preventDefault();
			void saveRef.current();
		};
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [] );

	// Leave guard, armed only while there are unsaved changes.
	useEffect( () => {
		if ( ! dirty ) {
			return;
		}
		const onBeforeUnload = ( event: BeforeUnloadEvent ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', onBeforeUnload );
		return () =>
			window.removeEventListener( 'beforeunload', onBeforeUnload );
	}, [ dirty ] );

	/*
	 * How many rows one configuration can hold. The same ceiling for every
	 * store: it is what the option row can carry, not a quota.
	 */
	const canAdd = state.fields.length < bootstrap.maxFields;

	const addBlank = useCallback(
		( location: FieldLocation, type: FieldType = 'text' ) => {
			if ( ! canAdd ) {
				return;
			}
			dispatch(
				addField(
					createBlankField(
						takenIds,
						bootstrap.idPrefix,
						location,
						type
					)
				)
			);
		},
		[ bootstrap.idPrefix, canAdd, dispatch, takenIds ]
	);

	const addTemplate = useCallback(
		( template: Field ) => {
			if ( ! canAdd ) {
				return;
			}
			dispatch(
				addField(
					fieldFromTemplate( template, takenIds, bootstrap.idPrefix )
				)
			);
		},
		[ bootstrap.idPrefix, canAdd, dispatch, takenIds ]
	);

	const onImport = useCallback(
		( imported: ImportedConfig ) => {
			const { fields } = imported;
			dispatch( importFields( fields, imported.core ) );
			notify(
				'info',
				sprintf(
					/* translators: %d: number of imported fields. */
					_n(
						'Imported %d field. Review it and save.',
						'Imported %d fields. Review them and save.',
						fields.length,
						'fieldwright-checkout-fields'
					),
					fields.length
				)
			);
		},
		[ dispatch, notify ]
	);

	const lastRemovedField = state.lastRemoved?.field;
	useEffect( () => {
		if ( ! lastRemovedField ) {
			// The undo window closed because something else changed the list.
			setSnackbar( ( current ) => ( current?.action ? null : current ) );
			return;
		}
		const removedLabel =
			'' === lastRemovedField.label.trim()
				? __( 'Untitled field', 'fieldwright-checkout-fields' )
				: lastRemovedField.label;
		snackbarId += 1;
		setSnackbar( {
			id: snackbarId,
			// Naming the field is what makes Undo safe to trust after a click
			// that landed on the wrong row.
			message: sprintf(
				/* translators: %s: field label. */
				__( 'Removed “%s”', 'fieldwright-checkout-fields' ),
				removedLabel
			),
			timeout: UNDO_TIMEOUT,
			action: {
				label: __( 'Undo', 'fieldwright-checkout-fields' ),
				onClick: () => {
					dispatch( undoRemove() );
					setSnackbar( null );
				},
			},
		} );
		// eslint-disable-next-line react-hooks/exhaustive-deps -- One snackbar per removal.
	}, [ lastRemovedField ] );

	/*
	 * Delete takes the row the merchant was standing on out of the document, and
	 * their focus with it: a keyboard is dropped on `body` and has to tab the
	 * whole screen again to get back to the outline. The reducer has already
	 * chosen the row that took the deleted one's place, so focus follows the
	 * selection there; with nothing left to select, the outline itself takes it.
	 */
	useEffect( () => {
		if ( ! lastRemovedField ) {
			return;
		}
		const outline =
			document.querySelector< HTMLElement >( '.cbwb-pane--fields' );
		const row = outline?.querySelector< HTMLElement >(
			'.cbwb-field-row__button[aria-current="true"]'
		);
		( row ?? outline )?.focus();
	}, [ lastRemovedField ] );

	const selected = builder.selected;
	const selectedCore = builder.selectedCore;

	/*
	 * The templates own the canvas while there is nothing of the merchant's to
	 * preview — except once they have picked one of WooCommerce's own rows,
	 * because then the thing they are asking to see is the checkout that row is
	 * in. A brand new store is exactly the case where core fields matter most,
	 * and it is also the case with no fields in it.
	 */
	const isEmpty = 0 === state.fields.length && ! selectedCore;

	/** Applies a change to whichever of WooCommerce's own rows is selected. */
	const changeCore = useCallback(
		( key: string, changes: Parameters< typeof updateCore >[ 1 ] ) =>
			dispatch( updateCore( key, changes ) ),
		[ dispatch ]
	);

	/*
	 * Three panes side by side is the shape the builder is designed around:
	 * the outline, the settings for the row it has selected, and the preview
	 * as the reference on the right. Narrower windows drop panes rather than
	 * stacking them, and a switcher says which one is up; the choice is
	 * deliberately not persisted, because the window width that forced it is
	 * not either.
	 */
	const mode = useLayoutMode();
	const [ paneView, setPaneView ] = useState< PaneView >( () =>
		// Landing on an empty screen, the preview is the pane worth showing:
		// it is where the templates are.
		0 === bootstrap.config.fields.length ? 'preview' : 'fields'
	);

	/*
	 * Two panes keep the outline up and let the switcher choose what sits
	 * beside it, so 'fields' is not one of the answers it can give. With a row
	 * selected the inspector is what the merchant went looking for; with
	 * nothing selected there is nothing to inspect, so the preview takes the
	 * column.
	 */
	let shownPane: PaneView = paneView;
	if ( 'two' === mode && 'fields' === paneView ) {
		shownPane = selected ? 'settings' : 'preview';
	}

	const panes = visiblePanes( mode, shownPane );

	/*
	 * Below three panes, picking a field has to bring its settings along with
	 * it — otherwise the click looks like it did nothing. Two things can do the
	 * picking: an explicit `select`, which is the click, and an action that
	 * lands on a new field of its own (add, duplicate, delete), which is what
	 * the effect below catches.
	 */
	const onDispatch = useCallback(
		( action: BuilderAction ) => {
			if (
				'three' !== mode &&
				'select' === action.type &&
				null !== action.id
			) {
				setPaneView( 'settings' );
			}
			dispatch( action );
		},
		[ dispatch, mode ]
	);

	const selectedId = state.selectedId;
	/*
	 * The selection the page loaded with. The preview mounts and unmounts as
	 * fields come and go, so the "don't scroll on load" rule cannot live in a
	 * ref of its own: it has to be anchored to a selection that outlives the
	 * component.
	 */
	const bootSelection = useRef( selectedId );
	const lastSelection = useRef( selectedId );
	useEffect( () => {
		if ( selectedId === lastSelection.current ) {
			return;
		}
		lastSelection.current = selectedId;

		if ( 'three' !== mode && selectedId ) {
			setPaneView( 'settings' );
		}
	}, [ mode, selectedId ] );

	const closeEditor = useCallback( () => {
		dispatch( select( null ) );
		setPaneView( ( current ) => {
			if ( 'settings' !== current ) {
				return current;
			}
			// Two panes keep the outline up, so the column the inspector was
			// filling goes back to the preview; one pane has no outline on
			// screen at all, so it goes back to the list.
			return 'two' === mode ? 'preview' : 'fields';
		} );
	}, [ dispatch, mode ] );

	const paneLabels: Record< PaneView, string > = {
		fields: __( 'Fields', 'fieldwright-checkout-fields' ),
		// "Field settings", not "Settings": the tab strip directly above this
		// one already has a Settings tab, and it is a different place.
		settings: __( 'Field settings', 'fieldwright-checkout-fields' ),
		preview: __( 'Preview', 'fieldwright-checkout-fields' ),
	};

	/*
	 * The switcher offers the panes in the order the wide layout lays them out
	 * — outline, inspector, preview — so the control reads as a shrunken
	 * version of the screen rather than a list of its own. At two panes the
	 * outline is always up, so it is not one of the choices.
	 */
	const switcherOrder: PaneView[] =
		'two' === mode
			? [ 'settings', 'preview' ]
			: [ 'fields', 'settings', 'preview' ];

	const paneSwitcher =
		'three' === mode ? null : (
			<SegmentedControl< PaneView >
				className="cbwb-builder__switch"
				label={ __( 'Show pane', 'fieldwright-checkout-fields' ) }
				value={ shownPane }
				options={ switcherOrder.map( ( value ) => ( {
					value,
					label: paneLabels[ value ],
				} ) ) }
				onChange={ setPaneView }
			/>
		);

	/*
	 * Tabs an add-on brought with it, read at render time like every other
	 * filter, and appended after the builder's own. The panel below renders
	 * whichever one is open, so an add-on owns the whole screen under the strip
	 * rather than a card inside somebody else's.
	 */
	const addOnTabs = extraTabs( bootstrap, RESERVED_TABS );
	const openAddOnTab = addOnTabs.find( ( addOn ) => addOn.key === tab );

	/*
	 * Pro announces itself by registering its License tab, so a strip without
	 * one is a store that does not have it. That store is offered a tab saying
	 * what Pro is; the store that has it is offered nothing, because the screens
	 * it would point at are already on the strip.
	 */
	const showProTab = proIsAbsent( addOnTabs.map( ( addOn ) => addOn.key ) );

	/*
	 * Named rather than returned, so the tab strip can be published around it
	 * below without moving every line of the screen one level to the right.
	 */
	const app = (
		<div className="cbwb-app">
			<Header>
				{ 'fields' === tab && (
					<>
						<ImportExport
							fields={ state.fields }
							schemaVersion={ state.schemaVersion }
							core={ builder.hasCore ? state.core : undefined }
							onImport={ onImport }
							onError={ ( message ) =>
								notify( 'error', message )
							}
						/>
						<Button
							__next40pxDefaultSize
							variant="primary"
							disabled={ ! canSave }
							accessibleWhenDisabled
							isBusy={ saving }
							onClick={ () => void save() }
						>
							{ __(
								'Save changes',
								'fieldwright-checkout-fields'
							) }
						</Button>
					</>
				) }
			</Header>

			<Tabs
				tabs={ [
					{
						name: 'fields',
						title: __( 'Fields', 'fieldwright-checkout-fields' ),
					},
					{
						name: COMPATIBILITY_TAB,
						title: __(
							'Compatibility',
							'fieldwright-checkout-fields'
						),
					},
					{
						name: 'settings',
						title: __( 'Settings', 'fieldwright-checkout-fields' ),
					},
					...( showProTab
						? [
								{
									name: PRO_TAB,
									title: __(
										'Pro',
										'fieldwright-checkout-fields'
									),
								},
						  ]
						: [] ),
					...addOnTabs.map( ( addOn ) => ( {
						name: addOn.key,
						title: addOn.label,
					} ) ),
				] }
				active={ tab }
				onSelect={ ( next ) => {
					setNotices( [] );
					setTab( next );
				} }
			/>

			<div
				className="cbwb-app__panel"
				role="tabpanel"
				id={ tabPanelId( tab ) }
				aria-labelledby={ tabId( tab ) }
			>
				<Notices
					notices={ notices }
					onRemove={ ( id ) =>
						setNotices( ( current ) =>
							current.filter( ( notice ) => notice.id !== id )
						)
					}
				/>

				{ 'fields' === tab && (
					<>
						{ warnings.length > 0 && (
							<div className="cbwb-notices">
								{ warnings.map( ( message ) => (
									<Notice
										key={ message }
										status="warning"
										isDismissible={ false }
									>
										{ message }
									</Notice>
								) ) }
							</div>
						) }

						{ ( errors.general.length > 0 ||
							clientErrors.count > 0 ) && (
							<div className="cbwb-notices">
								{ errors.general.map( ( message ) => (
									<Notice
										key={ message }
										status="error"
										isDismissible={ false }
									>
										{ message }
									</Notice>
								) ) }
								{ clientErrors.count > 0 && (
									<Notice
										status="warning"
										isDismissible={ false }
									>
										<ProblemFields
											errors={ clientErrors }
											fields={ state.fields }
											coreRows={ [
												...builder.coreRows,
												...builder.pseudoRows,
											] }
											onSelect={ ( id ) =>
												onDispatch( select( id ) )
											}
										/>
									</Notice>
								) }
							</div>
						) }

						{ /*
						 * The one thing that makes every field on this screen
						 * come to nothing: a checkout page with no Checkout
						 * block on it. Above the add-on line, which it
						 * outranks, and under the notices, which are about
						 * something the merchant did a moment ago.
						 */ }
						<CheckoutNotice />

						{ /*
						 * One line about the paid add-on, under anything the
						 * builder has to say about this checkout and above the
						 * outline. It draws itself only while Pro is not
						 * running and only until this user closes it; see
						 * ProLine for why it is not a notice.
						 */ }
						<ProLine />

						<div className={ `cbwb-builder is-${ mode }-pane` }>
							{ /*
							 * The panes are written in the order they are drawn
							 * — outline, inspector, preview — so tabbing
							 * through the screen walks it left to right.
							 *
							 * The switcher goes wherever it is drawn too: at
							 * one pane it heads the only column there is, and
							 * at two it heads the second one, the column it
							 * actually chooses between.
							 */ }
							{ 'two' !== mode && paneSwitcher }

							{ panes.fields && (
								<FieldList
									groups={ groups }
									placements={ placements }
									types={ types }
									selectedId={ state.selectedId }
									errors={ errors }
									canAdd={ canAdd }
									used={ state.fields.length }
									limit={ bootstrap.maxFields }
									coreRows={ builder.coreRows }
									pseudoRows={ builder.pseudoRows }
									addressOrder={ builder.addressOrder }
									hasCore={ builder.hasCore }
									onAdd={ addBlank }
									dispatch={ onDispatch }
								/>
							) }

							{ 'two' === mode && paneSwitcher }

							{ panes.settings && (
								<section
									className="cbwb-pane cbwb-pane--settings"
									aria-label={ __(
										'Field settings',
										'fieldwright-checkout-fields'
									) }
								>
									<div className="cbwb-pane__body">
										{ selected && (
											<FieldEditor
												field={ selected }
												bootstrap={ bootstrap }
												errors={
													errors.byField[
														selected.id
													]
												}
												fieldErrors={
													errors.rawByField[
														selected.id
													] ?? []
												}
												keyLocked={ builder.savedIds.has(
													selected.id
												) }
												onChange={ ( changes ) =>
													dispatch(
														updateField(
															selected.id,
															changes
														)
													)
												}
												onClose={ closeEditor }
											/>
										) }
										{ ! selected && selectedCore && (
											<CoreFieldEditor
												row={ selectedCore }
												bootstrap={ bootstrap }
												errors={
													errors.byCore[
														selectedCore.key
													]
												}
												rowErrors={
													errors.rawByCore[
														selectedCore.key
													] ?? []
												}
												onChange={ ( changes ) =>
													changeCore(
														selectedCore.key,
														changes
													)
												}
												onTogglePseudo={ ( hidden ) =>
													dispatch(
														setPseudo(
															selectedCore.key as CorePseudoKey,
															hidden
														)
													)
												}
												onReset={ () =>
													dispatch(
														resetCore(
															selectedCore.key
														)
													)
												}
												onClose={ closeEditor }
											/>
										) }
										{ ! selected && ! selectedCore && (
											<FieldEditorEmpty />
										) }
									</div>
								</section>
							) }

							{ panes.preview &&
								( isEmpty ? (
									<div className="cbwb-pane cbwb-pane--canvas">
										<div className="cbwb-pane__body">
											<EmptyState
												templates={
													bootstrap.templates
												}
												placements={ placements }
												types={ types }
												onAddTemplate={ addTemplate }
												onAddBlank={ ( type ) =>
													addBlank( 'order', type )
												}
											/>
										</div>
									</div>
								) : (
									<Preview
										fields={ state.fields }
										types={ types }
										placements={ placements }
										selectedId={ state.selectedId }
										initialSelectedId={
											bootSelection.current
										}
										canAdd={ canAdd }
										checkoutUrl={ bootstrap.checkoutUrl }
										coreRows={ builder.coreRows }
										pseudoRows={ builder.pseudoRows }
										addressOrder={ builder.addressOrder }
										hasCore={ builder.hasCore }
										/*
										 * The Settings tab's own state, so a
										 * merchant who switches the marking
										 * over and comes back finds the canvas
										 * already drawing it.
										 */
										requiredMarking={ markingOf(
											settings
										) }
										onSelect={ ( id ) =>
											onDispatch( select( id ) )
										}
										onAdd={ addBlank }
									/>
								) ) }
						</div>
					</>
				) }

				{ /*
				 * Mounted only while it is the open tab, which is what keeps
				 * the scan off the page load: nothing is fetched until the
				 * merchant asks for it.
				 */ }
				{ COMPATIBILITY_TAB === tab && <CompatibilityTab /> }

				{ 'settings' === tab && (
					<SettingsTab
						settings={ settings }
						onSaved={ setSettings }
						onNotify={ ( message ) => flash( message ) }
					/>
				) }

				{ PRO_TAB === tab && showProTab && <ProTab /> }

				{ openAddOnTab && openAddOnTab.render( { bootstrap } ) }
			</div>

			{ snackbar && (
				<div className="cbwb-snackbar">
					<Snackbar
						actions={
							snackbar.action
								? [
										{
											label: snackbar.action.label,
											onClick: snackbar.action.onClick,
										},
								  ]
								: []
						}
						onRemove={ () => setSnackbar( null ) }
					>
						{ snackbar.message }
					</Snackbar>
				</div>
			) }
		</div>
	);

	/*
	 * Which tabs there are, and how to open one. A section an add-on put in the
	 * field editor, or a panel it put on Settings, may want to send a merchant to
	 * a tab of its own, and every one of them is several components deep:
	 * publishing the strip here is what saves threading a callback through the
	 * six components in between, none of which has anything to do with tabs.
	 */
	return (
		<TabProvider
			value={ {
				tabs: [
					...OWN_TABS,
					...( showProTab ? [ PRO_TAB ] : [] ),
					...addOnTabs.map( ( addOn ) => addOn.key ),
				],
				open: setTab,
			} }
		>
			{ app }
		</TabProvider>
	);
}
