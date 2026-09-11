<?php
/**
 * Export and erasure of the values shoppers type into our own fields.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Privacy;

use CheckoutBuilder\Config;
use CheckoutBuilder\Fields\FieldDefinition;
use CheckoutBuilder\Fields\RichValues;
use WC_Customer;
use WC_Order;
use WP_User;

defined( 'ABSPATH' ) || exit;

/**
 * Answers WordPress's "export my data" and "erase my data" requests for the
 * field types Fieldwright stores itself.
 *
 * WooCommerce already answers them for its own fields, including the ones it
 * carries for us, but its exporter walks its own registry and its eraser its own
 * order props. Our rich types are deliberately outside both, so a gift message,
 * a delivery instruction or a date of birth would otherwise be left on the order
 * after an erasure request and left out of an export.
 *
 * Four surfaces, because a shopper's data can be asked for in four ways:
 *
 * - WordPress's own exporter, under its own group, so the values appear in the
 *   downloaded archive next to WooCommerce's.
 * - WordPress's own eraser.
 * - WooCommerce's order anonymisation, which the merchant reaches through the
 *   "Remove personal data" bulk action on the orders screen and which also runs
 *   on the retention schedule.
 * - WooCommerce's customer erasure, for the copies kept against the account by
 *   fields the merchant set to remember what the shopper last entered.
 *
 * All four find the values by the storage prefix rather than by the fields the
 * merchant has today. A field deleted from the builder leaves its answers on
 * every order that already carried them, and those are exactly the answers an
 * export or an erasure request is about, so a configuration read is not allowed
 * to decide whether they exist. The configuration is consulted only for a
 * readable name: a key still in it is written out under its current label, and
 * one that is not is written out under the key it is stored as, which is the
 * only name left for it.
 */
final class PersonalData {

	/**
	 * Group the exported values are filed under.
	 */
	public const GROUP = 'cbwb-checkout-fields';

	/**
	 * Orders read per exporter or eraser page.
	 *
	 * WordPress calls back until `done` is true, so this only decides how much
	 * work one request does. It matches WooCommerce's own batch size.
	 */
	private const PER_PAGE = 10;

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
		add_filter( 'wp_privacy_personal_data_exporters', array( $this, 'register_exporter' ) );
		add_filter( 'wp_privacy_personal_data_erasers', array( $this, 'register_eraser' ) );
		add_action( 'woocommerce_privacy_remove_order_personal_data', array( $this, 'anonymise_order' ) );
		add_filter( 'woocommerce_privacy_erase_personal_data_customer', array( $this, 'erase_customer_data' ), 10, 2 );
	}

	/**
	 * Add our exporter to WordPress's list.
	 *
	 * @param mixed $exporters Registered exporters.
	 * @return mixed
	 */
	public function register_exporter( $exporters ) {
		if ( ! is_array( $exporters ) ) {
			return $exporters;
		}

		$exporters[ self::GROUP ] = array(
			'exporter_friendly_name' => __( 'Fieldwright fields', 'fieldwright-checkout-fields' ),
			'callback'               => array( $this, 'export' ),
		);

		return $exporters;
	}

	/**
	 * Add our eraser to WordPress's list.
	 *
	 * @param mixed $erasers Registered erasers.
	 * @return mixed
	 */
	public function register_eraser( $erasers ) {
		if ( ! is_array( $erasers ) ) {
			return $erasers;
		}

		$erasers[ self::GROUP ] = array(
			'eraser_friendly_name' => __( 'Fieldwright fields', 'fieldwright-checkout-fields' ),
			'callback'             => array( $this, 'erase' ),
		);

		return $erasers;
	}

	/**
	 * Everything one shopper has entered into our fields.
	 *
	 * The current labels are used rather than any stored at the time, because a
	 * label is the merchant's wording for the question and the shopper is owed a
	 * readable answer, not the field's storage key. Values are written out the
	 * way the order screen writes them: option labels rather than option values,
	 * and a checkbox group as a list. An answer whose field has since been
	 * deleted has no label left, so it is named with the key it is stored under
	 * rather than left out.
	 *
	 * @param string $email_address The shopper's email address.
	 * @param int    $page          One-based page number.
	 * @return array{data: array<int, array<string, mixed>>, done: bool}
	 */
	public function export( $email_address, $page = 1 ): array {
		$email  = is_string( $email_address ) ? $email_address : '';
		$page   = max( 1, (int) $page );
		$export = array();

		if ( '' === $email ) {
			return array(
				'data' => array(),
				'done' => true,
			);
		}

		// The account's own copies are a single item, so they are exported once
		// rather than on every page.
		if ( 1 === $page ) {
			$profile = $this->rows( $this->stored_user_values( $this->user_id( $email ) ) );
			if ( array() !== $profile ) {
				$export[] = $this->item( 'user', $profile );
			}
		}

		$orders = $this->orders( $email, $page );

		foreach ( $orders as $order ) {
			$rows = $this->rows( $this->stored_order_values( $order ) );
			if ( array() === $rows ) {
				continue;
			}

			$export[] = $this->item( 'order-' . $order->get_id(), $rows );
		}

		return array(
			'data' => $export,
			'done' => count( $orders ) < self::PER_PAGE,
		);
	}

	/**
	 * Remove everything one shopper has entered into our fields.
	 *
	 * Whether an order's values may go is WooCommerce's decision, not ours: a
	 * store that retains order data for accounting reasons filters
	 * `woocommerce_privacy_erase_order_personal_data` to say so, and our values
	 * are part of the same order record, so the same answer applies to them.
	 *
	 * @param string $email_address The shopper's email address.
	 * @param int    $page          One-based page number.
	 * @return array{items_removed: bool, items_retained: bool, messages: string[], done: bool}
	 */
	public function erase( $email_address, $page = 1 ): array {
		$email    = is_string( $email_address ) ? $email_address : '';
		$page     = max( 1, (int) $page );
		$response = array(
			'items_removed'  => false,
			'items_retained' => false,
			'messages'       => array(),
			'done'           => true,
		);

		if ( '' === $email ) {
			return $response;
		}

		if ( 1 === $page && $this->erase_user_meta( $this->user_id( $email ) ) ) {
			$response['items_removed'] = true;
			$response['messages'][]    = __( 'Removed the values remembered against the account for Fieldwright fields.', 'fieldwright-checkout-fields' );
		}

		$orders = $this->orders( $email, $page );

		foreach ( $orders as $order ) {
			/** This filter is documented in woocommerce/includes/class-wc-privacy-erasers.php */
			if ( ! apply_filters( 'woocommerce_privacy_erase_order_personal_data', true, $order ) ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound, WooCommerce.Commenting.CommentHooks.MissingSinceComment -- WooCommerce's own filter, honoured so a store that relaxed it for WooCommerce has relaxed it here too.
				$response['items_retained'] = true;
				continue;
			}

			if ( ! $this->remove_order_data( $order ) ) {
				continue;
			}

			$response['items_removed'] = true;
			$response['messages'][]    = sprintf(
				/* translators: %s: order number. */
				__( 'Removed Fieldwright field values from order %s.', 'fieldwright-checkout-fields' ),
				$order->get_order_number()
			);
		}

		$response['done'] = count( $orders ) < self::PER_PAGE;

		return $response;
	}

	/**
	 * WooCommerce's own anonymisation, which is what the "Remove personal data"
	 * bulk action and the retention schedule both run.
	 *
	 * A merchant who anonymises an order there should not have to think about
	 * which of its fields came from which plugin.
	 *
	 * @param mixed $order The order being anonymised.
	 */
	public function anonymise_order( $order ): void {
		$this->remove_order_data( $order );
	}

	/**
	 * Strip our values off one order.
	 *
	 * Everything under the storage prefix goes, not only what the builder holds
	 * today: a field the merchant has switched off or deleted outright still has
	 * its old values on old orders, and those are exactly the ones an erasure
	 * request is about.
	 *
	 * @param mixed $order The order being anonymised.
	 * @return bool Whether anything was removed.
	 */
	public function remove_order_data( $order ): bool {
		if ( ! $order instanceof WC_Order ) {
			return false;
		}

		$definitions = $this->definitions();
		$removed     = false;

		foreach ( $this->stored_order_values( $order ) as $key => $value ) {
			$order->delete_meta_data( $key );
			$removed = true;

			$field = $definitions[ $key ] ?? null;
			if ( $field instanceof FieldDefinition ) {
				self::announce_erasure( $field, $value, $order );
			}
		}

		if ( $removed ) {
			$order->save();
		}

		return $removed;
	}

	/**
	 * Say that one stored value has gone, for whatever else was holding
	 * something because of it.
	 *
	 * A value is not always the whole of what was stored. A value of a type an
	 * add-on registered may name something the add-on keeps elsewhere, and this
	 * is the add-on's only notice that the answer was erased.
	 *
	 * Only the fields the builder still holds are announced. A key whose field
	 * the merchant has deleted has no definition left to hand over, and the
	 * meta itself is removed either way.
	 *
	 * @param FieldDefinition $field   Field the value belonged to.
	 * @param string          $value   The value that was removed.
	 * @param WC_Order|int    $context The order it was on, or the account it was remembered against.
	 */
	private static function announce_erasure( FieldDefinition $field, string $value, $context ): void {
		if ( '' === $value ) {
			return;
		}

		/**
		 * Fires after one stored value has been erased.
		 *
		 * @since 1.0.0
		 *
		 * @param FieldDefinition $field   The field the value belonged to.
		 * @param string          $value   The value that was removed.
		 * @param WC_Order|int    $context The order it was erased from, or the user id it was remembered against.
		 */
		do_action( 'cbwb_rich_value_erased', $field, $value, $context );
	}

	/**
	 * Strip the values remembered against a customer's account.
	 *
	 * @param mixed $response WooCommerce's response so far.
	 * @param mixed $customer The customer being erased.
	 * @return mixed
	 */
	public function erase_customer_data( $response, $customer ) {
		if ( ! is_array( $response ) || ! $customer instanceof WC_Customer ) {
			return $response;
		}

		if ( ! $this->erase_user_meta( (int) $customer->get_id() ) ) {
			return $response;
		}

		$response['items_removed'] = true;
		$response['messages'][]    = __( 'Removed the values remembered against the account for Fieldwright fields.', 'fieldwright-checkout-fields' );

		return $response;
	}

	/**
	 * The fields the builder holds today, keyed by the meta key each is stored
	 * under, so a key found on an order or an account can be given its label.
	 *
	 * Every field is here, not only the ones we render: a field the merchant has
	 * retyped into one of WooCommerce's own types still has its old answers under
	 * our key, and the merchant's label is still the readable name for them.
	 *
	 * @return array<string, FieldDefinition>
	 */
	private function definitions(): array {
		$definitions = array();

		foreach ( $this->config->fields()->all() as $field ) {
			$definitions[ RichValues::storage_meta_key( $field ) ] = $field;
		}

		return $definitions;
	}

	/**
	 * Everything one order holds under our prefix, keyed by meta key.
	 *
	 * Read off the order's own meta rather than looked up field by field, so a
	 * value whose field has been deleted is still found. The first row wins if a
	 * key somehow appears twice.
	 *
	 * @param WC_Order $order The order.
	 * @return array<string, string>
	 */
	private function stored_order_values( WC_Order $order ): array {
		$values = array();

		foreach ( $order->get_meta_data() as $meta ) {
			$data = $meta->get_data();
			$key  = isset( $data['key'] ) && is_string( $data['key'] ) ? $data['key'] : '';

			if ( ! self::is_ours( $key ) || isset( $values[ $key ] ) ) {
				continue;
			}

			$value          = $data['value'] ?? '';
			$values[ $key ] = is_scalar( $value ) ? (string) $value : '';
		}

		return $values;
	}

	/**
	 * Everything one account holds under our prefix, keyed by meta key.
	 *
	 * @param int $user_id User id.
	 * @return array<string, string>
	 */
	private function stored_user_values( int $user_id ): array {
		if ( $user_id <= 0 ) {
			return array();
		}

		$meta = get_user_meta( $user_id );
		if ( ! is_array( $meta ) ) {
			return array();
		}

		$values = array();

		foreach ( $meta as $key => $stored ) {
			if ( ! is_string( $key ) || ! self::is_ours( $key ) ) {
				continue;
			}

			// Read without a key, WordPress hands back every row of a key as an
			// array and leaves them serialized. Ours are always single scalars.
			$first          = is_array( $stored ) ? reset( $stored ) : $stored;
			$first          = maybe_unserialize( $first );
			$values[ $key ] = is_scalar( $first ) ? (string) $first : '';
		}

		return $values;
	}

	/**
	 * Whether a meta key is one of ours.
	 *
	 * @param string $key Meta key.
	 * @return bool
	 */
	private static function is_ours( string $key ): bool {
		return 0 === strpos( $key, RichValues::META_PREFIX );
	}

	/**
	 * The account an email address belongs to, or 0.
	 *
	 * @param string $email Email address.
	 * @return int
	 */
	private function user_id( string $email ): int {
		$user = get_user_by( 'email', $email );

		return $user instanceof WP_User ? (int) $user->ID : 0;
	}

	/**
	 * One page of the orders that belong to an email address.
	 *
	 * Matched the way WooCommerce matches them, by billing email and, when the
	 * address belongs to an account, by that account as well, so an order placed
	 * with a different billing address is not missed.
	 *
	 * @param string $email Email address.
	 * @param int    $page  One-based page number.
	 * @return WC_Order[]
	 */
	private function orders( string $email, int $page ): array {
		if ( ! function_exists( 'wc_get_orders' ) ) {
			return array();
		}

		$customer = array( $email );
		$user     = get_user_by( 'email', $email );

		if ( $user instanceof WP_User ) {
			$customer[] = (int) $user->ID;
		}

		$orders = wc_get_orders(
			array(
				'limit'    => self::PER_PAGE,
				'page'     => $page,
				'customer' => $customer,
			)
		);

		if ( ! is_array( $orders ) ) {
			return array();
		}

		return array_values(
			array_filter(
				$orders,
				static function ( $order ): bool {
					return $order instanceof WC_Order;
				}
			)
		);
	}

	/**
	 * Stored values written out as the name/value pairs an export item is made
	 * of.
	 *
	 * A key the builder still holds is named with the merchant's current label
	 * and written the way the order screen writes it: option labels rather than
	 * option values, and a checkbox group as a list. A key it no longer holds has
	 * no label left to use, so it is named with the key itself and written as it
	 * is stored. Empty values say nothing and are left out.
	 *
	 * @param array<string, string> $values Stored values keyed by meta key.
	 * @return array<int, array{name: string, value: string}>
	 */
	private function rows( array $values ): array {
		$definitions = $this->definitions();
		$rows        = array();

		foreach ( $values as $key => $value ) {
			if ( '' === $value ) {
				continue;
			}

			$field = $definitions[ $key ] ?? null;

			$rows[] = array(
				'name'  => $field instanceof FieldDefinition ? $field->label() : $key,
				'value' => $field instanceof FieldDefinition ? RichValues::display_value( $field, $value ) : $value,
			);
		}

		return $rows;
	}

	/**
	 * Clear the values remembered against one account.
	 *
	 * @param int $user_id User id.
	 * @return bool Whether anything was removed.
	 */
	private function erase_user_meta( int $user_id ): bool {
		$definitions = $this->definitions();
		$removed     = false;

		foreach ( $this->stored_user_values( $user_id ) as $key => $value ) {
			delete_user_meta( $user_id, $key );
			$removed = true;

			$field = $definitions[ $key ] ?? null;
			if ( $field instanceof FieldDefinition ) {
				self::announce_erasure( $field, $value, $user_id );
			}
		}

		return $removed;
	}

	/**
	 * Wrap a set of rows as one export item.
	 *
	 * @param string                                         $item_id Item identifier.
	 * @param array<int, array{name: string, value: string}> $rows    Name/value pairs.
	 * @return array<string, mixed>
	 */
	private function item( string $item_id, array $rows ): array {
		return array(
			'group_id'          => self::GROUP,
			'group_label'       => __( 'Fieldwright fields', 'fieldwright-checkout-fields' ),
			'group_description' => __( 'Values entered into the checkout fields this store added with Fieldwright.', 'fieldwright-checkout-fields' ),
			'item_id'           => $item_id,
			'data'              => $rows,
		);
	}
}
