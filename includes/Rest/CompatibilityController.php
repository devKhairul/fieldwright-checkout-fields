<?php
/**
 * REST controller for the block checkout migration assistant.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Rest;

use CheckoutBuilder\Compatibility\DraftPage;
use CheckoutBuilder\Compatibility\Scanner;
use WP_Error;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * GET  /cbwb/v1/compatibility             — can this store switch to the block checkout?
 * POST /cbwb/v1/compatibility/draft-page  — create a draft page to try it on.
 *
 * Reads use the same permission model as the field configuration. Creating the
 * draft page additionally needs `edit_pages`, because it writes a page rather
 * than a WooCommerce setting; shop managers have that capability, so the extra
 * check costs the intended audience nothing.
 */
final class CompatibilityController {

	public const NAMESPACE        = 'cbwb/v1';
	public const ROUTE            = '/compatibility';
	public const ROUTE_DRAFT_PAGE = '/compatibility/draft-page';

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
					'callback'            => array( $this, 'get_report' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				'schema' => array( $this, 'get_item_schema' ),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			self::ROUTE_DRAFT_PAGE,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_draft_page' ),
					'permission_callback' => array( $this, 'draft_page_permissions_check' ),
				),
				'schema' => array( $this, 'get_draft_page_schema' ),
			)
		);
	}

	/**
	 * Only shop managers and administrators may run the scan.
	 *
	 * @return true|WP_Error
	 */
	public function permissions_check() {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'rest_not_logged_in', __( 'You must be logged in.', 'fieldwright-checkout-fields' ), array( 'status' => 401 ) );
		}
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return new WP_Error( 'rest_forbidden', __( 'You are not allowed to check block checkout compatibility.', 'fieldwright-checkout-fields' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * Creating the preview page also needs permission to edit pages.
	 *
	 * @return true|WP_Error
	 */
	public function draft_page_permissions_check() {
		$allowed = $this->permissions_check();
		if ( is_wp_error( $allowed ) ) {
			return $allowed;
		}
		if ( ! current_user_can( 'edit_pages' ) ) {
			return new WP_Error(
				'rest_cannot_create_page',
				__( 'You are not allowed to create pages on this site, so the block checkout preview page cannot be created for you.', 'fieldwright-checkout-fields' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	/**
	 * Run the scan.
	 *
	 * @return WP_REST_Response
	 */
	public function get_report(): WP_REST_Response {
		return rest_ensure_response( ( new Scanner() )->scan() );
	}

	/**
	 * Create (or reuse) the draft block checkout page.
	 *
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_draft_page() {
		$page_id = ( new DraftPage() )->create( get_current_user_id() );

		if ( is_wp_error( $page_id ) ) {
			return new WP_Error(
				'cbwb_draft_page_failed',
				__( 'The block checkout preview page could not be created.', 'fieldwright-checkout-fields' ),
				array(
					'status' => 500,
					'reason' => $page_id->get_error_message(),
				)
			);
		}

		$edit_url    = get_edit_post_link( $page_id, 'raw' );
		$preview_url = get_preview_post_link( $page_id );

		return rest_ensure_response(
			array(
				'id'          => $page_id,
				'edit_url'    => is_string( $edit_url ) ? $edit_url : '',
				'preview_url' => is_string( $preview_url ) ? $preview_url : '',
			)
		);
	}

	/**
	 * JSON schema describing the compatibility report.
	 *
	 * @return array<string, mixed>
	 */
	public function get_item_schema(): array {
		$counts = array();
		foreach ( Scanner::buckets() as $bucket ) {
			$counts[ $bucket ] = array(
				'type'     => 'integer',
				'readonly' => true,
			);
		}

		$lists = array();
		foreach ( Scanner::buckets() as $bucket ) {
			$lists[ $bucket ] = array(
				'type'     => 'array',
				'readonly' => true,
				'items'    => self::plugin_schema(),
			);
		}

		$notes = array();
		foreach ( Scanner::buckets() as $bucket ) {
			$notes[ $bucket ] = array(
				'type'     => 'string',
				'readonly' => true,
			);
		}

		return array(
			'$schema'    => 'http://json-schema.org/draft-04/schema#',
			'title'      => 'cbwb_compatibility',
			'type'       => 'object',
			'properties' => array(
				'checkout_type'     => array(
					'type'        => 'string',
					'enum'        => array( Scanner::TYPE_BLOCK, Scanner::TYPE_CLASSIC, Scanner::TYPE_UNKNOWN ),
					'readonly'    => true,
					'description' => __( 'Which checkout the store uses today.', 'fieldwright-checkout-fields' ),
				),
				'checkout_page_id'  => array(
					'type'     => 'integer',
					'readonly' => true,
				),
				'checkout_page_url' => array(
					'type'     => 'string',
					'format'   => 'uri',
					'readonly' => true,
				),
				'plugins'           => array(
					'type'       => 'object',
					'readonly'   => true,
					'properties' => $lists,
				),
				'summary'           => array(
					'type'       => 'object',
					'readonly'   => true,
					'properties' => $counts,
				),
				'notes'             => array(
					'type'        => 'object',
					'readonly'    => true,
					'properties'  => $notes,
					'description' => __( 'What each group means, ready to show to the merchant.', 'fieldwright-checkout-fields' ),
				),
			),
		);
	}

	/**
	 * JSON schema for one scanned plugin.
	 *
	 * `file` and `version` are always present but are empty for a reader without
	 * `activate_plugins` — the capability WordPress gates the plugin list behind.
	 * The keys stay so the shape does not change with the reader.
	 *
	 * @return array<string, mixed>
	 */
	private static function plugin_schema(): array {
		return array(
			'type'       => 'object',
			'properties' => array(
				'file'           => array(
					'type'        => 'string',
					'description' => __( 'Plugin file, relative to the plugins directory. Empty unless you can activate plugins.', 'fieldwright-checkout-fields' ),
				),
				'name'           => array( 'type' => 'string' ),
				'version'        => array(
					'type'        => 'string',
					'description' => __( 'Installed version. Empty unless you can activate plugins.', 'fieldwright-checkout-fields' ),
				),
				'author'         => array( 'type' => 'string' ),
				'plugin_uri'     => array( 'type' => 'string' ),
				'is_woocommerce' => array( 'type' => 'boolean' ),
			),
		);
	}

	/**
	 * JSON schema describing the draft page response.
	 *
	 * @return array<string, mixed>
	 */
	public function get_draft_page_schema(): array {
		return array(
			'$schema'    => 'http://json-schema.org/draft-04/schema#',
			'title'      => 'cbwb_compatibility_draft_page',
			'type'       => 'object',
			'properties' => array(
				'id'          => array(
					'type'     => 'integer',
					'readonly' => true,
				),
				'edit_url'    => array(
					'type'     => 'string',
					'readonly' => true,
				),
				'preview_url' => array(
					'type'     => 'string',
					'readonly' => true,
				),
			),
		);
	}
}
