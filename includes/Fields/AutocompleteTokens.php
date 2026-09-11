<?php
/**
 * Allowlist of HTML autocomplete tokens offered for custom fields.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Fields;

defined( 'ABSPATH' ) || exit;

/**
 * The subset of the WHATWG autofill detail tokens that makes sense for a
 * checkout field. Anything outside this list is rejected rather than passed to
 * the browser, so a typo can never disable autofill for the whole form.
 */
final class AutocompleteTokens {

	/**
	 * Allowed tokens, in the order shown to the merchant.
	 *
	 * @return string[]
	 */
	public static function all(): array {
		return array(
			'on',
			'off',
			'name',
			'honorific-prefix',
			'given-name',
			'additional-name',
			'family-name',
			'honorific-suffix',
			'nickname',
			'organization-title',
			'organization',
			'street-address',
			'address-line1',
			'address-line2',
			'address-line3',
			'address-level1',
			'address-level2',
			'address-level3',
			'address-level4',
			'country',
			'country-name',
			'postal-code',
			'email',
			'tel',
			'tel-national',
			'url',
			'bday',
			'sex',
			'language',
		);
	}

	/**
	 * Whether a token is allowed. The empty string means "not set" and is valid.
	 *
	 * @param string $token Candidate token.
	 * @return bool
	 */
	public static function is_allowed( string $token ): bool {
		return '' === $token || in_array( $token, self::all(), true );
	}
}
