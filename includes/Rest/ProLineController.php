<?php
/**
 * REST controller for the one line about the paid add-on.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Rest;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * POST /cbwb/v1/pro-line
 *
 * Closing the line above the field list hides it for the person who closed it,
 * for good. That is a preference of the reader's rather than of the store's, so
 * it is user meta behind its own route rather than another key on the settings
 * option: two merchants sharing a store each decide for themselves, and closing
 * a line never touches the checkout configuration.
 */
final class ProLineController {

	public const NAMESPACE = 'cbwb/v1';
	public const ROUTE     = '/pro-line';

	/**
	 * User meta the answer is kept in. Present means closed.
	 */
	public const META_KEY = 'cbwb_pro_line_dismissed';

	/**
	 * Register routes.
	 */
	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			self::ROUTE,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'update' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'dismissed' => array(
							'type'              => 'boolean',
							'default'           => true,
							'validate_callback' => array( $this, 'validate_dismissed' ),
						),
					),
				),
				'schema' => array( $this, 'get_item_schema' ),
			)
		);
	}

	/**
	 * The same permission model as the rest of the builder's routes.
	 *
	 * The line is only ever drawn on the builder screen, which needs
	 * `manage_woocommerce` to open at all, so anything else asking to write this
	 * preference is writing it for a user who cannot see it.
	 *
	 * @return true|WP_Error
	 */
	public function permissions_check() {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'rest_not_logged_in', __( 'You must be logged in.', 'fieldwright-checkout-fields' ), array( 'status' => 401 ) );
		}
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return new WP_Error( 'rest_forbidden', __( 'You are not allowed to manage checkout settings.', 'fieldwright-checkout-fields' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * Close the line, or bring it back.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function update( WP_REST_Request $request ): WP_REST_Response {
		$dismissed = true === $request->get_param( 'dismissed' );
		$user_id   = get_current_user_id();

		if ( $dismissed ) {
			update_user_meta( $user_id, self::META_KEY, '1' );
		} else {
			// Absent rather than empty: the row exists only to say "closed", so
			// bringing the line back is deleting it rather than storing a no.
			delete_user_meta( $user_id, self::META_KEY );
		}

		return rest_ensure_response( array( 'dismissed' => $dismissed ) );
	}

	/**
	 * Whether this user has closed the line.
	 *
	 * @param int $user_id User to ask about.
	 * @return bool
	 */
	public static function is_dismissed( int $user_id ): bool {
		if ( $user_id <= 0 ) {
			return false;
		}

		return '' !== (string) get_user_meta( $user_id, self::META_KEY, true );
	}

	/**
	 * Reject anything that is not a real JSON boolean.
	 *
	 * @param mixed                $value   Raw value.
	 * @param WP_REST_Request|null $request The request, which is not read.
	 * @param string               $param   Name of the parameter being checked.
	 * @return true|WP_Error
	 */
	public function validate_dismissed( $value, $request = null, $param = '' ) {
		unset( $request );

		if ( ! is_bool( $value ) ) {
			return new WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: %s: name of the request parameter. */
					__( '%s must be true or false.', 'fieldwright-checkout-fields' ),
					is_string( $param ) && '' !== $param ? $param : 'dismissed'
				),
				array( 'status' => 400 )
			);
		}

		return true;
	}

	/**
	 * JSON schema describing the resource.
	 *
	 * @return array<string, mixed>
	 */
	public function get_item_schema(): array {
		return array(
			'$schema'    => 'http://json-schema.org/draft-04/schema#',
			'title'      => 'cbwb_pro_line',
			'type'       => 'object',
			'properties' => array(
				'dismissed' => array(
					'type'        => 'boolean',
					'description' => __( 'Whether the line about the paid add-on stays hidden for the current user.', 'fieldwright-checkout-fields' ),
				),
			),
		);
	}
}
