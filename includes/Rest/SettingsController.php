<?php
/**
 * REST controller for plugin-level settings.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Rest;

use CheckoutBuilder\Config;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * GET/PATCH /cbwb/v1/settings
 *
 * Kept separate from the field configuration so toggling a preference never
 * risks rewriting the field list.
 */
final class SettingsController {

	public const NAMESPACE = 'cbwb/v1';
	public const ROUTE     = '/settings';

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
	 * Register routes.
	 */
	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			self::ROUTE,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_settings' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_settings' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'remove_data_on_uninstall' => array(
							'type'              => 'boolean',
							'required'          => true,
							'validate_callback' => array( $this, 'validate_bool_arg' ),
						),
						// The two below are optional, so a client that predates
						// them can go on sending the one preference this route
						// started with, and a request that says nothing about a
						// preference leaves it exactly as it was.
						'required_marking'         => array(
							'type' => 'string',
							'enum' => Config::MARKINGS,
						),
						'required_note'            => array(
							'type'              => 'boolean',
							'validate_callback' => array( $this, 'validate_bool_arg' ),
						),
					),
				),
				'schema' => array( $this, 'get_item_schema' ),
			)
		);
	}

	/**
	 * Same permission model as the field configuration.
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
	 * Read settings.
	 *
	 * @return WP_REST_Response
	 */
	public function get_settings(): WP_REST_Response {
		return rest_ensure_response( $this->settings() );
	}

	/**
	 * Update settings.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function update_settings( WP_REST_Request $request ): WP_REST_Response {
		$this->config->set_remove_data_on_uninstall( true === $request->get_param( 'remove_data_on_uninstall' ) );

		// A preference the request does not mention keeps whatever it had. The
		// builder always sends the lot, but this route is a PATCH, and a client
		// that only knows about one preference must not silently reset the rest.
		$marking = $request->get_param( 'required_marking' );
		if ( is_string( $marking ) ) {
			$this->config->set_required_marking( $marking );
		}

		$note = $request->get_param( 'required_note' );
		if ( is_bool( $note ) ) {
			$this->config->set_required_note( $note );
		}

		return rest_ensure_response( $this->settings() );
	}

	/**
	 * Reject anything that is not a real JSON boolean, so a stray "false"
	 * string can never switch data deletion on.
	 *
	 * @param mixed                $value   Raw value.
	 * @param WP_REST_Request|null $request The request, which is not read.
	 * @param string               $param   Name of the parameter being checked.
	 * @return true|WP_Error
	 */
	public function validate_bool_arg( $value, $request = null, $param = '' ) {
		unset( $request );

		if ( ! is_bool( $value ) ) {
			return new WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: %s: name of the request parameter. */
					__( '%s must be true or false.', 'fieldwright-checkout-fields' ),
					is_string( $param ) && '' !== $param ? $param : 'remove_data_on_uninstall'
				),
				array( 'status' => 400 )
			);
		}
		return true;
	}

	/**
	 * Current settings payload.
	 *
	 * @return array{remove_data_on_uninstall: bool, required_marking: string, required_note: bool}
	 */
	private function settings(): array {
		return $this->config->settings();
	}

	/**
	 * JSON schema describing the settings resource.
	 *
	 * @return array<string, mixed>
	 */
	public function get_item_schema(): array {
		return array(
			'$schema'    => 'http://json-schema.org/draft-04/schema#',
			'title'      => 'cbwb_settings',
			'type'       => 'object',
			'properties' => array(
				'remove_data_on_uninstall' => array(
					'type'        => 'boolean',
					'description' => __( 'Delete the plugin configuration when the plugin is uninstalled.', 'fieldwright-checkout-fields' ),
				),
				'required_marking'         => array(
					'type'        => 'string',
					'enum'        => Config::MARKINGS,
					'description' => __( 'Whether the checkout says "(optional)" after optional fields, or marks required fields with an asterisk.', 'fieldwright-checkout-fields' ),
				),
				'required_note'            => array(
					'type'        => 'boolean',
					'description' => __( 'Show the line that explains the asterisk at the top of the checkout.', 'fieldwright-checkout-fields' ),
				),
			),
		);
	}
}
