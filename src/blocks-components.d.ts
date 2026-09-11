/**
 * The sliver of `@woocommerce/blocks-components` the checkout bundle uses.
 *
 * Same arrangement as the other two WooCommerce packages: never installed,
 * mapped by webpack to the `wc.blocksComponents` global and the
 * `wc-blocks-components` script handle, implementation shipped by WooCommerce.
 *
 * Only the four components the field bundle renders are described. Everything
 * else the global carries — `ValidatedTextInput`, `TextInput`, `Textarea`,
 * `CheckboxList`, `Panel`, the totals components — is deliberately absent: an
 * import that is not declared here is a compile error rather than a runtime
 * `undefined`, which is the point of writing these by hand.
 */
declare module '@woocommerce/blocks-components' {
	import type { ReactNode } from 'react';

	/** One choice in a `RadioControl`. */
	export interface RadioControlOption {
		value: string;
		label: ReactNode;
		description?: ReactNode;
		secondaryLabel?: ReactNode;
		secondaryDescription?: ReactNode;
	}

	export interface RadioControlProps {
		className?: string;
		/** Seeds the option ids: `radio-control-<id>-<value>`. */
		id?: string;
		/** Value of the checked option; '' for none. */
		selected?: string;
		options?: RadioControlOption[];
		onChange: ( value: string ) => void;
		disabled?: boolean;
	}

	/** Renders nothing at all when `options` is empty. */
	export function RadioControl( props: RadioControlProps ): JSX.Element | null;

	export interface CheckboxControlProps {
		className?: string;
		id?: string;
		label?: ReactNode;
		checked?: boolean;
		disabled?: boolean;
		/** Adds `has-error` and `aria-invalid`. */
		hasError?: boolean;
		value?: string;
		onChange: ( checked: boolean ) => void;
		children?: ReactNode;
	}

	export function CheckboxControl(
		props: CheckboxControlProps
	): JSX.Element;

	export interface TitleProps {
		/** 1–6; renders `<h{level}>`. */
		headingLevel: number | string;
		className?: string;
		id?: string;
		children?: ReactNode;
	}

	/** Renders `<hN class="wc-block-components-title …">`. */
	export function Title( props: TitleProps ): JSX.Element;

	export interface ValidationInputErrorProps {
		/** Overrides the message held in the validation store. */
		errorMessage?: string;
		/** Validation-store key the message is read from. */
		propertyName?: string;
		/**
		 * Validation-store key the `id` of the rendered paragraph comes from:
		 * `validate-error-<elementId>`, and only while the error is shown.
		 */
		elementId?: string;
	}

	/** Renders nothing while the error is absent or hidden. */
	export function ValidationInputError(
		props: ValidationInputErrorProps
	): JSX.Element | null;
}
