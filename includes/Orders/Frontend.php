<?php
/**
 * Our own field values on the order confirmation and in My Account.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Orders;

use CheckoutBuilder\Config;
use CheckoutBuilder\Fields\FieldDefinition;
use CheckoutBuilder\Fields\RichValues;
use WC_Order;

defined( 'ABSPATH' ) || exit;

/**
 * Prints the values our own checkout block stores on the two screens a shopper
 * reads an order on.
 *
 * There are two of them because WooCommerce has two order confirmations. The
 * block one is a tree of `woocommerce/order-confirmation-*` blocks, and its
 * additional-fields block prints only what is in WooCommerce's own registry —
 * which our types are deliberately not in. The classic one is a template, and
 * it fires `woocommerce_order_details_after_customer_details`, which is also
 * what My Account's order view fires.
 *
 * Both print the same `<dl>` core uses, right after core's own list and with no
 * heading of their own, so the two read as one list rather than two.
 */
final class Frontend {

	/**
	 * The block that prints WooCommerce's own additional fields on the block
	 * order confirmation.
	 */
	public const CONFIRMATION_BLOCK = 'woocommerce/order-confirmation-additional-fields';

	/**
	 * Config repository.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * Constructor.
	 *
	 * @param Config $config Config repository.
	 */
	public function __construct( Config $config ) {
		$this->config = $config;
	}

	/**
	 * Attach hooks.
	 */
	public function register(): void {
		// Priority 11: just after CheckoutFieldsFrontend prints core's own list.
		add_action( 'woocommerce_order_details_after_customer_details', array( $this, 'render' ), 11 );
		add_filter( 'render_block', array( $this, 'append_to_confirmation_block' ), 10, 2 );
	}

	/**
	 * Print the values for one order, on the classic order confirmation or in
	 * My Account.
	 *
	 * @param mixed $order The order.
	 */
	public function render( $order ): void {
		if ( ! $order instanceof WC_Order ) {
			return;
		}

		echo wp_kses_post( $this->markup( $this->rows( $order, self::context() ) ) );
	}

	/**
	 * Add our values to the block order confirmation's additional-fields block.
	 *
	 * @param mixed $block_content Rendered block HTML.
	 * @param mixed $block         Parsed block.
	 * @return mixed
	 */
	public function append_to_confirmation_block( $block_content, $block ) {
		if ( ! is_string( $block_content ) || ! is_array( $block ) ) {
			return $block_content;
		}

		$name = isset( $block['blockName'] ) && is_string( $block['blockName'] ) ? $block['blockName'] : '';
		if ( self::CONFIRMATION_BLOCK !== $name ) {
			return $block_content;
		}

		$order = self::confirmation_order();
		if ( null === $order || ! self::can_view( $order ) ) {
			return $block_content;
		}

		return $block_content . $this->markup( $this->rows( $order, 'thank_you' ) );
	}

	/**
	 * The order the block order confirmation is being rendered for.
	 *
	 * The blocks resolve it from the query themselves, and expose no accessor,
	 * so it is resolved the same way here: the `order-received` query var, which
	 * is what the confirmation URL carries.
	 *
	 * @return WC_Order|null
	 */
	private static function confirmation_order(): ?WC_Order {
		global $wp;

		$order_id = isset( $wp->query_vars['order-received'] ) ? absint( $wp->query_vars['order-received'] ) : 0;
		if ( $order_id <= 0 ) {
			return null;
		}

		$order = wc_get_order( $order_id );

		return $order instanceof WC_Order ? $order : null;
	}

	/**
	 * Whether the current visitor is allowed to read this order's details.
	 *
	 * WordPress fires `render_block` for every block in the template, including
	 * one that decided to render nothing, so the additional-fields block having
	 * refused to print WooCommerce's own values does not stop this filter from
	 * running. The permission check therefore has to be made here as well, and it
	 * is made the same way WooCommerce makes it, in
	 * `AbstractOrderConfirmationBlock::get_view_order_permissions()`: a valid
	 * order key first, then ownership for an order that belongs to an account,
	 * and for a guest order the session, the grace period or a verified email
	 * address. The same two filters are honoured, so a store that has relaxed the
	 * rules for WooCommerce has relaxed them here too.
	 *
	 * @param WC_Order $order The order.
	 * @return bool
	 */
	public static function can_view( WC_Order $order ): bool {
		if ( ! self::has_valid_order_key( $order ) ) {
			return false;
		}

		if ( $order->get_user_id() > 0 ) {
			/** This filter is documented in woocommerce/src/Blocks/BlockTypes/OrderConfirmation/AbstractOrderConfirmationBlock.php */
			if ( ! apply_filters( 'woocommerce_order_received_verify_known_shoppers', true ) ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound, WooCommerce.Commenting.CommentHooks.MissingSinceComment -- WooCommerce's own filter, honoured so a store that relaxed it for WooCommerce has relaxed it here too.
				return true;
			}

			return $order->get_user_id() === get_current_user_id();
		}

		return ! self::email_verification_required( $order );
	}

	/**
	 * Whether the request carries the order's own key.
	 *
	 * @param WC_Order $order The order.
	 * @return bool
	 */
	private static function has_valid_order_key( WC_Order $order ): bool {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Reading a public confirmation URL, exactly as WooCommerce does.
		$key = isset( $_GET['key'] ) ? sanitize_text_field( wp_unslash( $_GET['key'] ) ) : '';

		return is_string( $key ) && '' !== $key && $order->key_is_valid( $key );
	}

	/**
	 * Whether a guest order still has to prove who is asking.
	 *
	 * @param WC_Order $order The order.
	 * @return bool
	 */
	private static function email_verification_required( WC_Order $order ): bool {
		$session = function_exists( 'WC' ) ? WC()->session : null;

		// The shopper who just placed it still has it in their session.
		if ( null !== $session && $order->get_id() === (int) $session->get( 'store_api_draft_order' ) ) {
			return false;
		}

		if ( self::is_within_grace_period( $order ) ) {
			return false;
		}

		if ( self::is_email_verified( $order ) ) {
			return false;
		}

		/** This filter is documented in woocommerce/src/Blocks/BlockTypes/OrderConfirmation/AbstractOrderConfirmationBlock.php */
		return (bool) apply_filters( 'woocommerce_order_email_verification_required', true, $order, 'order-received' ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound, WooCommerce.Commenting.CommentHooks.MissingSinceComment -- WooCommerce's own filter, honoured so a store that relaxed it for WooCommerce has relaxed it here too.
	}

	/**
	 * Whether the order is new enough that WooCommerce asks for nothing more.
	 *
	 * @param WC_Order $order The order.
	 * @return bool
	 */
	private static function is_within_grace_period( WC_Order $order ): bool {
		/** This filter is documented in woocommerce/src/Blocks/BlockTypes/OrderConfirmation/AbstractOrderConfirmationBlock.php */
		$grace_period = (int) apply_filters( 'woocommerce_order_email_verification_grace_period', 10 * MINUTE_IN_SECONDS, $order, 'order-received' ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound, WooCommerce.Commenting.CommentHooks.MissingSinceComment -- WooCommerce's own filter, honoured so a store that relaxed it for WooCommerce has relaxed it here too.
		$created      = $order->get_date_created();

		if ( ! $created instanceof \WC_DateTime ) {
			return false;
		}

		return time() - $created->getTimestamp() <= $grace_period;
	}

	/**
	 * Whether the visitor just proved the billing email address is theirs.
	 *
	 * Mirrors WooCommerce's own check, down to the two nonce actions its email
	 * verification form and its account creation form use.
	 *
	 * @param WC_Order $order The order.
	 * @return bool
	 */
	private static function is_email_verified( WC_Order $order ): bool {
		if ( ! isset( $_POST['email'], $_POST['_wpnonce'] ) ) {
			return false;
		}

		$nonce = sanitize_key( wp_unslash( $_POST['_wpnonce'] ) );

		if ( ! wp_verify_nonce( $nonce, 'wc_verify_email' ) && ! wp_verify_nonce( $nonce, 'wc_create_account' ) ) {
			return false;
		}

		$email = sanitize_email( wp_unslash( $_POST['email'] ) );

		return '' !== $order->get_billing_email() && $email === $order->get_billing_email();
	}

	/**
	 * The label/value pairs one screen should show.
	 *
	 * @param WC_Order $order   The order.
	 * @param string   $context Visibility key: thank_you or account.
	 * @return array<int, array{label: string, value: string}>
	 */
	public function rows( WC_Order $order, string $context ): array {
		$rows = array();

		foreach ( $this->config->fields()->all() as $field ) {
			if ( ! $field->is_rich() || ! $field->is_visible_in( $context ) ) {
				continue;
			}

			$value = RichValues::order_value( $order, $field );
			if ( '' === $value ) {
				continue;
			}

			$rows[] = array(
				'label' => RichValues::label( $field ),
				'value' => RichValues::display_value( $field, $value ),
			);
		}

		return $rows;
	}

	/**
	 * The list markup for a set of rows, in the shape WooCommerce prints its own.
	 *
	 * @param array<int, array{label: string, value: string}> $rows Rows to print.
	 * @return string
	 */
	public function markup( array $rows ): string {
		if ( array() === $rows ) {
			return '';
		}

		$items = '';
		foreach ( $rows as $row ) {
			$items .= sprintf( '<dt>%1$s</dt><dd>%2$s</dd>', esc_html( $row['label'] ), esc_html( $row['value'] ) );
		}

		return '<dl class="wc-block-components-additional-fields-list cbwb-order-fields">' . $items . '</dl>';
	}

	/**
	 * Which visibility switch the current request is governed by.
	 *
	 * @return string
	 */
	public static function context(): string {
		if ( function_exists( 'is_wc_endpoint_url' ) && is_wc_endpoint_url( 'view-order' ) ) {
			return 'account';
		}
		return 'thank_you';
	}

	/**
	 * Whether a field would be printed at all, whatever the order holds.
	 *
	 * @param FieldDefinition $field   Field definition.
	 * @param string          $context Visibility key.
	 * @return bool
	 */
	public static function is_printable( FieldDefinition $field, string $context ): bool {
		return $field->is_rich() && $field->is_visible_in( $context );
	}
}
