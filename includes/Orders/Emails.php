<?php
/**
 * Our own field values in order emails.
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
 * Adds the values our own checkout block stores to every order email.
 *
 * WooCommerce prints its own additional fields from its registry, which our
 * rich types are deliberately not in, so they are added through the generic
 * meta-fields filter instead.
 */
final class Emails {

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
		add_filter( 'woocommerce_email_order_meta_fields', array( $this, 'add_fields' ), 10, 3 );
	}

	/**
	 * Append our fields to the list WooCommerce prints.
	 *
	 * @param mixed $fields        Fields collected so far.
	 * @param mixed $sent_to_admin Whether this is the admin copy.
	 * @param mixed $order         The order.
	 * @return mixed
	 */
	public function add_fields( $fields, $sent_to_admin, $order ) {
		unset( $sent_to_admin );

		if ( ! is_array( $fields ) || ! $order instanceof WC_Order ) {
			return $fields;
		}

		foreach ( $this->config->fields()->all() as $field ) {
			if ( ! $field->is_rich() || ! $field->is_visible_in( 'emails' ) ) {
				continue;
			}

			$value = RichValues::order_value( $order, $field );
			if ( '' === $value ) {
				continue;
			}

			$fields[ RichValues::meta_key( $field ) ] = array(
				'label' => RichValues::label( $field ),
				'value' => RichValues::display_value( $field, $value ),
			);
		}

		return $fields;
	}

	/**
	 * Whether a field would be printed at all, whatever the order holds.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return bool
	 */
	public static function is_printable( FieldDefinition $field ): bool {
		return $field->is_rich() && $field->is_visible_in( 'emails' );
	}
}
