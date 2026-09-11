/**
 * Talking to WooCommerce's two checkout stores.
 *
 * Both are registered by WooCommerce, not by us, so `@wordpress/data` knows
 * nothing about their shapes and every call needs a cast. Doing that once, here,
 * keeps the casts out of the components and leaves one place to look when
 * WooCommerce changes a selector name.
 *
 * The store *keys* come from `@woocommerce/block-data` rather than being
 * written out: importing them is what puts `wc-blocks-data-store` in
 * `checkout.asset.php`, and reaching into `wc.wcBlocksData` without declaring
 * that handle is exactly what WooCommerce warns about in the console.
 *
 * ## Where the answers live
 *
 * Nowhere in this bundle. The checkout store is the only copy of a shopper's
 * answer: components read it back out through `useSelect` and write to it
 * through `setExtensionData`. Keeping a `useState` alongside it would give two
 * copies to disagree, and would lose the answer if WooCommerce ever remounted
 * the tree mid-checkout.
 *
 * WooCommerce posts whatever is in there under `extensions` when the order is
 * placed, keyed by namespace — no work of ours.
 *
 * ## Why the type registry is here too
 *
 * Because what an add-on can reach is one object, `window.cbwb.checkout`, and
 * this is the file that builds it. The map behind it is nobody's business but
 * this module's.
 */

import {
	CHECKOUT_STORE_KEY,
	VALIDATION_STORE_KEY,
} from '@woocommerce/block-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';

import { isBuiltinType } from './bootstrap';
import { getFieldState, setFieldState, subscribe } from './fieldState';
import type { CbwbGlobal } from '../admin/types';
import type { CheckoutFieldType, FieldState } from './types';

/** One entry of the validation store, as WooCommerce keeps it. */
export interface ValidationError {
	message: string;
	/** True while the error counts against checkout but is not shown yet. */
	hidden: boolean;
}

interface CheckoutSelectors {
	getExtensionData?: () => Record< string, unknown > | undefined;
}

interface CheckoutActions {
	/**
	 * @param namespace Extension namespace.
	 * @param data      Values to write.
	 * @param replace   True swaps the namespace's data; false merges into it.
	 */
	setExtensionData?: (
		namespace: string,
		data: Record< string, unknown >,
		replace?: boolean
	) => void;
}

interface ValidationSelectors {
	getValidationError?: ( id: string ) => ValidationError | undefined;
	/** The paragraph id, and only while the error is not hidden. */
	getValidationErrorId?: ( id: string ) => string | undefined;
}

interface ValidationActions {
	setValidationErrors?: ( errors: Record< string, ValidationError > ) => void;
	clearValidationError?: ( id: string ) => void;
	showValidationError?: ( id: string ) => void;
}

/** What `select` really is once a store WooCommerce registered is asked for. */
type SelectByKey = ( key: string ) => unknown;

/**
 * The shopper's answer to one field, as the checkout store holds it.
 *
 * @param namespace Extension namespace.
 * @param fieldId   Field id.
 * @return The answer, or '' when there is none yet.
 */
export function useExtensionValue(
	namespace: string,
	fieldId: string
): string {
	return useSelect(
		( select ) => {
			const store = ( select as unknown as SelectByKey )(
				CHECKOUT_STORE_KEY
			) as CheckoutSelectors | undefined;

			const all = store?.getExtensionData?.();
			const mine = all?.[ namespace ];

			if ( 'object' !== typeof mine || null === mine ) {
				return '';
			}

			const value = ( mine as Record< string, unknown > )[ fieldId ];

			return 'string' === typeof value ? value : '';
		},
		[ namespace, fieldId ]
	);
}

/**
 * Whether the checkout store already holds an answer for a field.
 *
 * Told apart from an empty answer so a shopper who deliberately cleared a
 * prefilled field does not get it filled back in.
 *
 * @param namespace Extension namespace.
 * @param fieldId   Field id.
 * @return True when the field has been written to.
 */
export function useHasExtensionValue(
	namespace: string,
	fieldId: string
): boolean {
	return useSelect(
		( select ) => {
			const store = ( select as unknown as SelectByKey )(
				CHECKOUT_STORE_KEY
			) as CheckoutSelectors | undefined;

			const mine = store?.getExtensionData?.()?.[ namespace ];

			return (
				'object' === typeof mine &&
				null !== mine &&
				fieldId in ( mine as Record< string, unknown > )
			);
		},
		[ namespace, fieldId ]
	);
}

/**
 * The writer for the checkout store's extension data.
 *
 * @return A function that records one field's answer.
 */
export function useSetExtensionValue(): (
	namespace: string,
	fieldId: string,
	value: string
) => void {
	const actions = useDispatch( CHECKOUT_STORE_KEY ) as CheckoutActions;

	return useCallback(
		( namespace: string, fieldId: string, value: string ) => {
			// `replace: false` merges into the namespace, so a field only ever
			// writes its own key and never stands on a neighbour's answer.
			actions?.setExtensionData?.(
				namespace,
				{ [ fieldId ]: value },
				false
			);
		},
		[ actions ]
	);
}

/** What a field needs to know about its own error. */
export interface FieldError {
	/** The message, or '' when there is no error at all. */
	message: string;
	/**
	 * Id of the paragraph the message is printed in, or '' while the error is
	 * still hidden.
	 */
	errorId: string;
}

/**
 * The error currently recorded against a field, shown or not.
 *
 * ## Why `getValidationErrorId` rather than the error's own `hidden`
 *
 * WooCommerce's validation reducer un-hides errors *in place*: measured against
 * 11.0.1, `SHOW_ALL_VALIDATION_ERRORS` shallow-copies the map and then does
 * `errors[ key ].hidden = false` on the very objects already in it. Anything
 * selecting the error object therefore gets the same reference back after the
 * shopper presses Place Order as it did before, `useSelect` sees no change, and
 * the field never re-renders to show what it was just told to show.
 *
 * `getValidationErrorId` is computed on every call and returns a string only
 * while the error is visible, so it *does* change — which is exactly why core's
 * own inputs select it too.
 *
 * @param fieldId Field id, which is also the validation-store key.
 * @return The message and, once shown, the id it is printed under.
 */
export function useFieldError( fieldId: string ): FieldError {
	return useSelect(
		( select ) => {
			const store = ( select as unknown as SelectByKey )(
				VALIDATION_STORE_KEY
			) as ValidationSelectors | undefined;

			return {
				message: store?.getValidationError?.( fieldId )?.message ?? '',
				errorId: store?.getValidationErrorId?.( fieldId ) ?? '',
			};
		},
		[ fieldId ]
	);
}

/**
 * What an add-on currently says about one field, kept in step as it changes.
 *
 * Subscribes rather than reading once, so a rule that becomes true halfway
 * through checkout — the shopper picks a country, a shipping method, a delivery
 * date — takes the field off the screen straight away.
 *
 * @param fieldId Field id.
 * @return The field's state.
 */
export function useFieldState( fieldId: string ): FieldState {
	const [ state, setState ] = useState< FieldState >( () =>
		getFieldState( fieldId )
	);

	useEffect( () => {
		// Read again on subscribe: an add-on may have written between the first
		// render and this effect, and that change would otherwise be missed.
		setState( getFieldState( fieldId ) );

		return subscribe( () => setState( getFieldState( fieldId ) ) );
	}, [ fieldId ] );

	return state;
}

/**
 * The types an add-on has taught this checkout, keyed the way the server keys
 * them.
 *
 * Private to this module, and written to only through `registerFieldType()`:
 * the checks that function makes are the whole of what stands between an
 * add-on's bundle and the render, and a map anything could reach into would
 * make them optional.
 */
const fieldTypes = new Map< string, CheckoutFieldType >();

/** What a type key may look like, matching the server's `TypeRegistry`. */
const TYPE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Teach the checkout a field type of an add-on's own.
 *
 * A registration that could not work is dropped rather than thrown over: this
 * is called from another plugin's bundle while the checkout is being set up,
 * and an exception there takes down whatever else that bundle had to do. A
 * field of a type nothing could draw is simply not drawn, which is what an
 * unregistered type does anyway.
 *
 * A built-in key is refused outright. The dispatch tries Free's own types
 * first, so a registration under one of those names could never be reached,
 * and failing quietly at the point of the mistake is better than failing
 * invisibly at the point of the render.
 *
 * @param key  Type key, the one the add-on registered with the server.
 * @param type How to draw and check it.
 */
export function registerFieldType(
	key: string,
	type: CheckoutFieldType
): void {
	if (
		'string' !== typeof key ||
		! TYPE_KEY_PATTERN.test( key ) ||
		isBuiltinType( key )
	) {
		return;
	}

	// A `Control` React could not render would throw at the moment the field is
	// drawn, which is far too late to say anything useful about it. A function
	// is the ordinary component; an object is what `memo()` and `forwardRef()`
	// hand back.
	const control = type?.Control as unknown;
	const drawable =
		'function' === typeof control ||
		( 'object' === typeof control && null !== control );

	if ( ! drawable ) {
		return;
	}

	fieldTypes.set( key, type );
}

/**
 * What is registered under one key.
 *
 * @param key Type key.
 * @return The type, or undefined when nothing registered it.
 */
export function getFieldType( key: string ): CheckoutFieldType | undefined {
	return fieldTypes.get( key );
}

/**
 * Forget every registered type. For tests, which share one module instance.
 */
export function resetFieldTypes(): void {
	fieldTypes.clear();
}

/**
 * Publish the field-state API and the type registry on `window.cbwb.checkout`.
 *
 * A global rather than a module export because the add-on that uses it is a
 * separate bundle: WooCommerce loads both as block integrations, and neither
 * can import from the other. The object is merged into whatever is already
 * there so two bundles can each add their own corner of `window.cbwb`.
 */
export function exposeCheckoutApi(): void {
	// Cast because the same global carries the builder's own surface, which is
	// not on the page at all when this runs: the checkout and the builder are
	// two bundles that never load together.
	const root = ( window.cbwb ?? {} ) as CbwbGlobal;

	root.checkout = {
		setFieldState,
		getFieldState,
		subscribe,
		registerFieldType,
		getFieldType,
	};

	window.cbwb = root;
}

/** The three validation-store actions a field needs. */
export interface ValidationWriters {
	setError: ( fieldId: string, message: string, hidden: boolean ) => void;
	clearError: ( fieldId: string ) => void;
	showError: ( fieldId: string ) => void;
}

/**
 * Writers for the validation store.
 *
 * @return The three actions a field needs.
 */
export function useValidationWriters(): ValidationWriters {
	const actions = useDispatch( VALIDATION_STORE_KEY ) as ValidationActions;

	return useMemo< ValidationWriters >(
		() => ( {
			setError: ( fieldId, message, hidden ) =>
				actions?.setValidationErrors?.( {
					[ fieldId ]: { message, hidden },
				} ),
			clearError: ( fieldId ) =>
				actions?.clearValidationError?.( fieldId ),
			showError: ( fieldId ) => actions?.showValidationError?.( fieldId ),
		} ),
		[ actions ]
	);
}
