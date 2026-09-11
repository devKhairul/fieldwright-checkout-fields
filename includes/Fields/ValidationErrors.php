<?php
/**
 * Ordered collector for field validation errors.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Fields;

use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Accumulates every validation problem found in a payload instead of bailing on
 * the first one, so the admin app can show all inline errors at once.
 *
 * WP_Error groups messages by code, which loses the original ordering; the
 * position is carried in each error's data and restored by flatten().
 */
final class ValidationErrors {

	/**
	 * Collected errors.
	 *
	 * @var array<int, array{path: string, code: string, message: string}>
	 */
	private $items = array();

	/**
	 * Record an error.
	 *
	 * @param string $path    Dotted path, e.g. "fields[2].label".
	 * @param string $code    Machine-readable error code.
	 * @param string $message Human-readable message.
	 */
	public function add( string $path, string $code, string $message ): void {
		$this->items[] = array(
			'path'    => $path,
			'code'    => $code,
			'message' => $message,
		);
	}

	/**
	 * Whether anything was recorded.
	 *
	 * @return bool
	 */
	public function has_errors(): bool {
		return array() !== $this->items;
	}

	/**
	 * Collected errors in the order they were found.
	 *
	 * @return array<int, array{path: string, code: string, message: string}>
	 */
	public function items(): array {
		return $this->items;
	}

	/**
	 * Convert to a WP_Error carrying the path (and its position) as error data.
	 *
	 * @return WP_Error
	 */
	public function to_wp_error(): WP_Error {
		$error = new WP_Error();
		foreach ( $this->items as $position => $item ) {
			$error->add(
				$item['code'],
				$item['message'],
				array(
					'path'     => $item['path'],
					'position' => $position,
				)
			);
		}
		return $error;
	}

	/**
	 * Rebuild the ordered error list from a WP_Error produced by to_wp_error().
	 *
	 * @param WP_Error $error Error object.
	 * @return array<int, array{path: string, code: string, message: string}>
	 */
	public static function flatten( WP_Error $error ): array {
		$items = array();
		foreach ( $error->get_error_codes() as $code ) {
			$messages = $error->get_error_messages( $code );
			$data     = $error->get_all_error_data( $code );
			foreach ( $messages as $offset => $message ) {
				$entry   = isset( $data[ $offset ] ) && is_array( $data[ $offset ] ) ? $data[ $offset ] : array();
				$items[] = array(
					'position' => isset( $entry['position'] ) ? (int) $entry['position'] : count( $items ),
					'path'     => isset( $entry['path'] ) ? (string) $entry['path'] : '',
					'code'     => (string) $code,
					'message'  => (string) $message,
				);
			}
		}

		usort(
			$items,
			static function ( array $a, array $b ): int {
				return $a['position'] <=> $b['position'];
			}
		);

		return array_map(
			static function ( array $item ): array {
				return array(
					'path'    => $item['path'],
					'code'    => $item['code'],
					'message' => $item['message'],
				);
			},
			$items
		);
	}
}
