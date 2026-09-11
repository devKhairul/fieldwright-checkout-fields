<?php
/**
 * Draft block-checkout preview page.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Compatibility;

use WP_Error;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Creates the throwaway page merchants use to try the block checkout before
 * switching their real checkout over to it.
 *
 * The page content is the same block markup WooCommerce writes into a fresh
 * checkout page. WooCommerce keeps that markup in `WC_Install::get_checkout_block_content()`,
 * which is `protected static` and has no public accessor, so it is mirrored here
 * (verbatim, from WooCommerce 11.0) rather than reached for by reflection. If a
 * future WooCommerce reshapes the checkout, the merchant's own checkout page and
 * this preview would drift apart — the block itself still renders every inner
 * block it needs, so the preview stays usable in the meantime.
 *
 * Creation is idempotent: the first call stores `_cbwb_block_preview` on the page
 * and every later call returns that page instead of littering the page list.
 */
final class DraftPage {

	/**
	 * Post meta flagging a page as our preview. Underscore-prefixed so it stays
	 * out of the custom fields UI and the REST API.
	 */
	public const META_KEY = '_cbwb_block_preview';

	/**
	 * Statuses a previously created preview may have reached. A merchant who
	 * publishes the preview should not get a second one on the next click.
	 */
	private const STATUSES = array( 'draft', 'pending', 'private', 'future', 'publish' );

	/**
	 * Transient held while a page is being inserted, so two concurrent requests
	 * do not each create one.
	 */
	private const LOCK = 'cbwb_draft_page_lock';

	/**
	 * How long the lock survives a request that died mid-insert.
	 */
	private const LOCK_TTL = 30;

	/**
	 * The object-cache group the lock is kept under on a store with a shared
	 * cache.
	 */
	private const CACHE_GROUP = 'cbwb';

	/**
	 * Create the preview page, or return the existing one.
	 *
	 * @param int $user_id Author for the new page.
	 * @return int|WP_Error Page id, or an error when WordPress refused the insert.
	 */
	public function create( int $user_id ) {
		$existing = $this->existing();
		if ( $existing > 0 ) {
			return $existing;
		}

		// Two clicks close together would otherwise both read "no page yet" and
		// both insert one. On a store with a shared object cache the claim is an
		// atomic add; on one without, the transient narrows the window to the
		// gap between its read and its write, and the worst case is a second
		// draft page rather than anything lost.
		if ( ! $this->claim() ) {
			$claimed = $this->existing();

			return $claimed > 0 ? $claimed : new WP_Error(
				'cbwb_draft_page_busy',
				__( 'The preview page is already being created. Reload the page in a moment.', 'fieldwright-checkout-fields' )
			);
		}

		$page_id = wp_insert_post(
			array(
				'post_type'    => 'page',
				'post_status'  => 'draft',
				'post_title'   => self::title(),
				'post_content' => self::content(),
				'post_author'  => max( 0, $user_id ),
				'meta_input'   => array( self::META_KEY => '1' ),
			),
			true
		);

		$this->release();

		if ( is_wp_error( $page_id ) ) {
			return $page_id;
		}

		return (int) $page_id;
	}

	/**
	 * Take the "I am creating the preview page" lock, if it is free.
	 *
	 * @return bool
	 */
	private function claim(): bool {
		// `wp_cache_add()` refuses a key that is already there, in one round
		// trip to the cache, which is what makes it a lock. A transient is a
		// read and then a write, so it can only be the fallback.
		if ( wp_using_ext_object_cache() ) {
			return wp_cache_add( self::LOCK, 1, self::CACHE_GROUP, self::LOCK_TTL );
		}

		if ( false !== get_transient( self::LOCK ) ) {
			return false;
		}

		set_transient( self::LOCK, 1, self::LOCK_TTL );

		return true;
	}

	/**
	 * Give the lock back.
	 */
	private function release(): void {
		if ( wp_using_ext_object_cache() ) {
			wp_cache_delete( self::LOCK, self::CACHE_GROUP );
			return;
		}

		delete_transient( self::LOCK );
	}

	/**
	 * Id of the preview page created earlier, or 0 when there is none.
	 *
	 * @return int
	 */
	public function existing(): int {
		$posts = get_posts(
			array(
				'post_type'        => 'page',
				'post_status'      => self::STATUSES,
				'numberposts'      => 1,
				'orderby'          => 'ID',
				'order'            => 'ASC',
				'no_found_rows'    => true,
				'suppress_filters' => false,
				// A single indexed meta lookup on a page the merchant creates at
				// most once; the "slow query" warning does not apply.
				'meta_key'         => self::META_KEY, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'       => '1', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			)
		);

		foreach ( $posts as $post ) {
			if ( $post instanceof WP_Post ) {
				return (int) $post->ID;
			}
		}

		return 0;
	}

	/**
	 * Title of the preview page.
	 *
	 * @return string
	 */
	public static function title(): string {
		return __( 'Checkout (block preview)', 'fieldwright-checkout-fields' );
	}

	/**
	 * The block checkout markup WooCommerce puts on a fresh checkout page.
	 *
	 * Mirrors `WC_Install::get_checkout_block_content()` (WooCommerce 11.0).
	 *
	 * @return string
	 */
	public static function content(): string {
		return '<!-- wp:woocommerce/checkout -->
<div class="wp-block-woocommerce-checkout alignwide wc-block-checkout is-loading"><!-- wp:woocommerce/checkout-fields-block -->
<div class="wp-block-woocommerce-checkout-fields-block"><!-- wp:woocommerce/checkout-express-payment-block -->
<div class="wp-block-woocommerce-checkout-express-payment-block"></div>
<!-- /wp:woocommerce/checkout-express-payment-block -->

<!-- wp:woocommerce/checkout-contact-information-block -->
<div class="wp-block-woocommerce-checkout-contact-information-block"></div>
<!-- /wp:woocommerce/checkout-contact-information-block -->

<!-- wp:woocommerce/checkout-shipping-method-block -->
<div class="wp-block-woocommerce-checkout-shipping-method-block"></div>
<!-- /wp:woocommerce/checkout-shipping-method-block -->

<!-- wp:woocommerce/checkout-pickup-options-block -->
<div class="wp-block-woocommerce-checkout-pickup-options-block"></div>
<!-- /wp:woocommerce/checkout-pickup-options-block -->

<!-- wp:woocommerce/checkout-shipping-address-block -->
<div class="wp-block-woocommerce-checkout-shipping-address-block"></div>
<!-- /wp:woocommerce/checkout-shipping-address-block -->

<!-- wp:woocommerce/checkout-billing-address-block -->
<div class="wp-block-woocommerce-checkout-billing-address-block"></div>
<!-- /wp:woocommerce/checkout-billing-address-block -->

<!-- wp:woocommerce/checkout-shipping-methods-block -->
<div class="wp-block-woocommerce-checkout-shipping-methods-block"></div>
<!-- /wp:woocommerce/checkout-shipping-methods-block -->

<!-- wp:woocommerce/checkout-payment-block -->
<div class="wp-block-woocommerce-checkout-payment-block"></div>
<!-- /wp:woocommerce/checkout-payment-block -->

<!-- wp:woocommerce/checkout-additional-information-block -->
<div class="wp-block-woocommerce-checkout-additional-information-block"></div>
<!-- /wp:woocommerce/checkout-additional-information-block -->

<!-- wp:woocommerce/checkout-order-note-block -->
<div class="wp-block-woocommerce-checkout-order-note-block"></div>
<!-- /wp:woocommerce/checkout-order-note-block -->

<!-- wp:woocommerce/checkout-terms-block -->
<div class="wp-block-woocommerce-checkout-terms-block"></div>
<!-- /wp:woocommerce/checkout-terms-block -->

<!-- wp:woocommerce/checkout-actions-block -->
<div class="wp-block-woocommerce-checkout-actions-block"></div>
<!-- /wp:woocommerce/checkout-actions-block --></div>
<!-- /wp:woocommerce/checkout-fields-block -->

<!-- wp:woocommerce/checkout-totals-block -->
<div class="wp-block-woocommerce-checkout-totals-block"><!-- wp:woocommerce/checkout-order-summary-block -->
<div class="wp-block-woocommerce-checkout-order-summary-block"><!-- wp:woocommerce/checkout-order-summary-cart-items-block -->
<div class="wp-block-woocommerce-checkout-order-summary-cart-items-block"></div>
<!-- /wp:woocommerce/checkout-order-summary-cart-items-block -->

<!-- wp:woocommerce/checkout-order-summary-coupon-form-block -->
<div class="wp-block-woocommerce-checkout-order-summary-coupon-form-block"></div>
<!-- /wp:woocommerce/checkout-order-summary-coupon-form-block -->

<!-- wp:woocommerce/checkout-order-summary-subtotal-block -->
<div class="wp-block-woocommerce-checkout-order-summary-subtotal-block"></div>
<!-- /wp:woocommerce/checkout-order-summary-subtotal-block -->

<!-- wp:woocommerce/checkout-order-summary-fee-block -->
<div class="wp-block-woocommerce-checkout-order-summary-fee-block"></div>
<!-- /wp:woocommerce/checkout-order-summary-fee-block -->

<!-- wp:woocommerce/checkout-order-summary-discount-block -->
<div class="wp-block-woocommerce-checkout-order-summary-discount-block"></div>
<!-- /wp:woocommerce/checkout-order-summary-discount-block -->

<!-- wp:woocommerce/checkout-order-summary-shipping-block -->
<div class="wp-block-woocommerce-checkout-order-summary-shipping-block"></div>
<!-- /wp:woocommerce/checkout-order-summary-shipping-block -->

<!-- wp:woocommerce/checkout-order-summary-taxes-block -->
<div class="wp-block-woocommerce-checkout-order-summary-taxes-block"></div>
<!-- /wp:woocommerce/checkout-order-summary-taxes-block --></div>
<!-- /wp:woocommerce/checkout-order-summary-block --></div>
<!-- /wp:woocommerce/checkout-totals-block --></div>
<!-- /wp:woocommerce/checkout -->';
	}
}
