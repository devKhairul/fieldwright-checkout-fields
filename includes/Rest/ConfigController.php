<?php
/**
 * REST controller for the plugin configuration.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Rest;

use CheckoutBuilder\Config;
use CheckoutBuilder\Fields\AutocompleteTokens;
use CheckoutBuilder\Fields\CoreFields;
use CheckoutBuilder\Fields\FieldCollection;
use CheckoutBuilder\Fields\FieldDefinition;
use CheckoutBuilder\Fields\FormatPresets;
use CheckoutBuilder\Fields\TypeRegistry;
use CheckoutBuilder\Fields\ValidationErrors;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * GET/PUT /cbwb/v1/config
 */
final class ConfigController {

	public const NAMESPACE = 'cbwb/v1';
	public const ROUTE     = '/config';

	/**
	 * Hard cap on request body size (bytes) to keep abusive payloads out of the option table.
	 */
	public const MAX_BODY_BYTES = 512 * 1024;

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
					'callback'            => array( $this, 'get_config' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_config' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'fields'   => array(
							'required'          => true,
							'type'              => 'array',
							'items'             => self::field_schema(),
							'validate_callback' => array( $this, 'validate_fields_arg' ),

							/*
							 * The schema above documents the resource, but core's default
							 * sanitizer would both coerce values (turning the string "1"
							 * into a boolean, which we deliberately reject) and fail with
							 * `rest_invalid_param` before FieldCollection can report every
							 * problem with a path. Field errors have exactly one source.
							 */
							'sanitize_callback' => null,
						),
						'core'     => array(
							// Optional: a request that says nothing about
							// WooCommerce's own fields leaves them exactly as they
							// were rather than resetting them to their defaults.
							'required'          => false,
							'type'              => 'object',
							'validate_callback' => array( $this, 'validate_core_arg' ),
							'sanitize_callback' => null,
						),
						'revision' => array(
							// Which configuration this save was written against. A
							// caller has to have read before it writes, so that two
							// people editing at once find out rather than one of
							// them losing their work silently.
							'required'          => true,
							'type'              => 'string',
							'validate_callback' => array( $this, 'validate_revision_arg' ),
							'sanitize_callback' => null,
						),
					),
				),
				'schema' => array( $this, 'get_item_schema' ),
			)
		);
	}

	/**
	 * Only shop managers and administrators may read or write checkout configuration.
	 *
	 * @return true|WP_Error
	 */
	public function permissions_check() {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'rest_not_logged_in', __( 'You must be logged in.', 'fieldwright-checkout-fields' ), array( 'status' => 401 ) );
		}
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return new WP_Error( 'rest_forbidden', __( 'You are not allowed to manage checkout fields.', 'fieldwright-checkout-fields' ), array( 'status' => 403 ) );
		}
		return true;
	}

	/**
	 * Read config.
	 *
	 * @return WP_REST_Response
	 */
	public function get_config(): WP_REST_Response {
		return rest_ensure_response( $this->config->get() );
	}

	/**
	 * Stamp a configuration payload with the revision it represents.
	 *
	 * Needed for the save's own answer, which is built from what `save_fields()`
	 * returned rather than read back through `Config::get()`.
	 *
	 * @param array<string, mixed> $config Configuration payload.
	 * @return array<string, mixed>
	 */
	private function with_revision( array $config ): array {
		$config['revision'] = $this->config->revision();

		return $config;
	}

	/**
	 * Validate the `revision` argument shape.
	 *
	 * @param mixed $value Raw value.
	 * @return true|WP_Error
	 */
	public function validate_revision_arg( $value ) {
		if ( ! is_string( $value ) || '' === $value ) {
			return new WP_Error( 'rest_invalid_param', __( 'revision must be text.', 'fieldwright-checkout-fields' ), array( 'status' => 400 ) );
		}
		return true;
	}

	/**
	 * Replace config.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_config( WP_REST_Request $request ) {
		if ( strlen( (string) $request->get_body() ) > self::MAX_BODY_BYTES ) {
			return new WP_Error( 'cbwb_payload_too_large', __( 'Configuration payload is too large.', 'fieldwright-checkout-fields' ), array( 'status' => 413 ) );
		}

		// Checked before the payload is even looked at: if this save was written
		// against a configuration that is no longer the stored one, nothing about
		// its contents can be judged, and reporting field errors for a payload
		// that is going to be refused anyway would only be confusing.
		$revision = (string) $request->get_param( 'revision' );
		if ( $revision !== $this->config->revision() ) {
			return new WP_Error(
				'cbwb_stale_revision',
				__( 'Someone else has changed the checkout fields since this screen loaded. Reload to see their changes, then make yours again.', 'fieldwright-checkout-fields' ),
				array( 'status' => 409 )
			);
		}

		$errors     = new ValidationErrors();
		$fields     = array_values( (array) $request->get_param( 'fields' ) );
		$collection = FieldCollection::from_config( $fields );

		if ( is_wp_error( $collection ) ) {
			// Both halves of the payload are checked before anything is reported,
			// so the builder highlights every problem at once rather than making
			// the merchant save twice to find the second one.
			foreach ( ValidationErrors::flatten( $collection ) as $problem ) {
				$errors->add( $problem['path'], $problem['code'], $problem['message'] );
			}
		}

		$raw_core = null;
		$core     = null;

		if ( null !== $request->get_param( 'core' ) ) {
			$raw_core = $request->get_param( 'core' );
			$core     = CoreFields::parse( $raw_core, 'core', $errors );
		}

		if ( $errors->has_errors() || ! $collection instanceof FieldCollection ) {
			return self::invalid_config( $errors );
		}

		if ( null !== $core ) {
			// The three fields WooCommerce keeps its own option for are written
			// back to those options rather than stored by us, so the editor's
			// Address Fields sidebar and the builder never disagree.
			( new CoreFields( $this->config ) )->sync_options(
				isset( $raw_core['fields'] ) && is_array( $raw_core['fields'] ) ? $raw_core['fields'] : array()
			);
		}

		$stored = $this->config->save_fields( $collection, $core );

		// What was just saved, in the shape a GET of the same resource answers
		// with: an empty override map is an object, not the list PHP's own empty
		// array would encode to.
		if ( isset( $stored['core'] ) && is_array( $stored['core'] ) ) {
			$stored['core'] = CoreFields::for_json( $stored['core'] );
		}

		// The new stamp, so the screen can go on saving without reloading.
		return rest_ensure_response( $this->with_revision( $stored ) );
	}

	/**
	 * Validate the `core` argument shape.
	 *
	 * @param mixed $value Raw value.
	 * @return true|WP_Error
	 */
	public function validate_core_arg( $value ) {
		if ( ! is_array( $value ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'core must be an object.', 'fieldwright-checkout-fields' ), array( 'status' => 400 ) );
		}
		return true;
	}

	/**
	 * Turn collected problems into the structured error the admin app renders.
	 *
	 * @param ValidationErrors $errors Aggregated validation errors.
	 * @return WP_Error
	 */
	private static function invalid_config( ValidationErrors $errors ): WP_Error {
		return new WP_Error(
			'cbwb_invalid_config',
			__( 'Some fields could not be saved. Fix the highlighted problems and try again.', 'fieldwright-checkout-fields' ),
			array(
				'status' => 400,
				'errors' => $errors->items(),
			)
		);
	}

	/**
	 * Validate the `fields` argument shape.
	 *
	 * @param mixed $value Raw value.
	 * @return true|WP_Error
	 */
	public function validate_fields_arg( $value ) {
		if ( ! is_array( $value ) || ( array() !== $value && ! wp_is_numeric_array( $value ) ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'fields must be a list.', 'fieldwright-checkout-fields' ), array( 'status' => 400 ) );
		}
		foreach ( $value as $field ) {
			if ( ! is_array( $field ) ) {
				return new WP_Error( 'rest_invalid_param', __( 'Each field must be an object.', 'fieldwright-checkout-fields' ), array( 'status' => 400 ) );
			}
		}
		return true;
	}

	/**
	 * JSON schema for one field. Used as the REST args schema for a first-pass
	 * shape check; FieldCollection produces the errors the UI actually shows.
	 *
	 * @return array<string, mixed>
	 */
	public static function field_schema(): array {
		return array(
			'type'       => 'object',
			'properties' => array(
				'id'                         => array(
					'type'        => 'string',
					'pattern'     => '^cbwb/[a-z0-9]+(-[a-z0-9]+)*$',
					'maxLength'   => FieldDefinition::MAX_ID_LENGTH,
					'description' => __( 'Stable field key, used as the order meta key.', 'fieldwright-checkout-fields' ),
				),
				'label'                      => array(
					'type'      => 'string',
					'maxLength' => FieldDefinition::MAX_LABEL_LENGTH,
				),
				'type'                       => array(
					// A shape rather than a list. A field whose type an add-on
					// provides is stored and saved again whether or not that
					// add-on is running, so the set of types a configuration may
					// name is not the set this request can see.
					'type'        => 'string',
					'pattern'     => '^[a-z][a-z0-9_]*$',
					'maxLength'   => TypeRegistry::MAX_KEY_LENGTH,
					'description' => __( 'One of the built-in types, or a type an add-on registered.', 'fieldwright-checkout-fields' ),
				),
				'location'                   => array(
					'type' => 'string',
					'enum' => FieldDefinition::locations(),
				),
				'required'                   => array( 'type' => 'boolean' ),
				'enabled'                    => array( 'type' => 'boolean' ),
				'placeholder'                => array(
					'type'        => 'string',
					'maxLength'   => FieldDefinition::MAX_PLACEHOLDER_LENGTH,
					'description' => __( 'Dropdown fields only: the first, unselected choice. Dropped for other types, whose labels leave no room for a placeholder.', 'fieldwright-checkout-fields' ),
				),
				'options'                    => array(
					'description' => __( 'Dropdown, radio and checkbox group fields only: the choices offered.', 'fieldwright-checkout-fields' ),
					'type'        => 'array',
					'items'       => array(
						'type'       => 'object',
						'required'   => array( 'value', 'label' ),
						'properties' => array(
							'value' => array(
								'type'      => 'string',
								'pattern'   => '^[A-Za-z0-9_.:-]+$',
								'maxLength' => FieldDefinition::MAX_OPTION_VALUE_LENGTH,
							),
							'label' => array(
								'type'      => 'string',
								'maxLength' => FieldDefinition::MAX_OPTION_LABEL_LENGTH,
							),
						),
					),
				),
				'error_message'              => array(
					'type'        => 'string',
					'maxLength'   => FieldDefinition::MAX_ERROR_LENGTH,
					'description' => __( 'What the customer reads when the field is left empty or its value does not match. Dropped for dropdowns, headings and paragraphs.', 'fieldwright-checkout-fields' ),
				),
				'format'                     => array(
					'type' => 'string',
					'enum' => FormatPresets::keys(),
				),
				'pattern'                    => array( 'type' => 'string' ),
				'max_length'                 => array(
					'type'        => array( 'integer', 'null' ),
					'minimum'     => 1,
					'maximum'     => FieldDefinition::MAX_TEXTAREA_LENGTH,
					'description' => __( 'Long text fields accept up to 5,000; every other type up to 1,000.', 'fieldwright-checkout-fields' ),
				),
				'autocomplete'               => array(
					'type' => 'string',
					'enum' => array_merge( array( '' ), AutocompleteTokens::all() ),
				),
				'show_in_order_confirmation' => array(
					'type'        => 'boolean',
					'description' => __( 'Kept in step with visibility.thank_you, in both directions.', 'fieldwright-checkout-fields' ),
				),
				'help'                       => array(
					'type'      => 'string',
					'maxLength' => FieldDefinition::MAX_HELP_LENGTH,
				),
				'default_value'              => array(
					'type'        => 'string',
					'maxLength'   => FieldDefinition::MAX_DEFAULT_VALUE_LENGTH,
					'description' => __( 'The value the field starts out with. A comma-separated list on a checkbox group; "yes" or empty on a checkbox.', 'fieldwright-checkout-fields' ),
				),
				'width'                      => array(
					'type'        => 'string',
					'enum'        => FieldDefinition::widths(),
					'description' => __( 'Always "full" on the types WooCommerce lays out itself.', 'fieldwright-checkout-fields' ),
				),
				'visibility'                 => array(
					'type'       => 'object',
					'properties' => array(
						'thank_you' => array( 'type' => 'boolean' ),
						'emails'    => array( 'type' => 'boolean' ),
						'admin'     => array( 'type' => 'boolean' ),
						'account'   => array( 'type' => 'boolean' ),
					),
				),
				'save_to_profile'            => array(
					'type'        => 'boolean',
					'description' => __( 'Fields we store ourselves, in the contact or one of the address sections: remember the value against the customer and prefill it next time.', 'fieldwright-checkout-fields' ),
				),
				'options_layout'             => array(
					'type' => 'string',
					'enum' => FieldDefinition::option_layouts(),
				),
				'rows'                       => array(
					'type'    => 'integer',
					'minimum' => FieldDefinition::MIN_ROWS,
					'maximum' => FieldDefinition::MAX_ROWS,
				),
				'min'                        => array(
					'type'        => array( 'number', 'null' ),
					'description' => __( 'Number fields only: the smallest accepted value.', 'fieldwright-checkout-fields' ),
				),
				'max'                        => array(
					'type'        => array( 'number', 'null' ),
					'description' => __( 'Number fields only: the largest accepted value.', 'fieldwright-checkout-fields' ),
				),
				'step'                       => array(
					'type'        => array( 'number', 'null' ),
					'description' => __( 'Number fields: the step between accepted values. Time fields: whole minutes between selectable times.', 'fieldwright-checkout-fields' ),
				),
				'date_min'                   => array( 'type' => 'string' ),
				'date_max'                   => array( 'type' => 'string' ),
				'time_min'                   => array( 'type' => 'string' ),
				'time_max'                   => array( 'type' => 'string' ),
				'content'                    => array(
					'type'        => 'string',
					'maxLength'   => FieldDefinition::MAX_CONTENT_LENGTH,
					'description' => __( 'Paragraph fields only. Only a, strong, em and br survive.', 'fieldwright-checkout-fields' ),
				),
				'content_level'              => array(
					'type' => 'integer',
					'enum' => FieldDefinition::content_levels(),
				),
				'pro'                        => array(
					'type'        => array( 'object', 'null' ),
					'description' => __( 'Settings owned by an add-on. Stored verbatim and validated by the add-on when it is active.', 'fieldwright-checkout-fields' ),
				),
			),
		);
	}

	/**
	 * JSON schema describing the config resource.
	 *
	 * @return array<string, mixed>
	 */
	public function get_item_schema(): array {
		return array(
			'$schema'    => 'http://json-schema.org/draft-04/schema#',
			'title'      => 'cbwb_config',
			'type'       => 'object',
			'properties' => array(
				'schema_version' => array(
					'type'     => 'integer',
					'readonly' => true,
				),
				'fields'         => array(
					'type'     => 'array',
					'maxItems' => FieldCollection::MAX_FIELDS,
					'items'    => self::field_schema(),
				),
				'core'           => self::core_schema(),
				'revision'       => array(
					'description' => __( 'Stamp of the configuration this response describes. Send it back with the next save.', 'fieldwright-checkout-fields' ),
					'type'        => 'string',
				),
			),
		);
	}

	/**
	 * JSON schema for the changes made to WooCommerce's own checkout fields.
	 *
	 * Only differences from WooCommerce's defaults are stored, so an absent key
	 * — or an absent property on a key — means "exactly as WooCommerce ships it".
	 *
	 * @return array<string, mixed>
	 */
	public static function core_schema(): array {
		$pseudo = array(
			'type'       => 'object',
			'properties' => array( 'hidden' => array( 'type' => 'boolean' ) ),
		);

		return array(
			'type'        => 'object',
			'description' => __( "Changes to WooCommerce's own checkout fields. Only what differs from its defaults is stored.", 'fieldwright-checkout-fields' ),
			'properties'  => array(
				'fields'                       => array(
					'type'                 => 'object',
					'additionalProperties' => array(
						'type'       => 'object',
						'properties' => array(
							'label'    => array(
								'type'      => 'string',
								'maxLength' => CoreFields::MAX_LABEL_LENGTH,
							),
							'required' => array( 'type' => 'boolean' ),
							'hidden'   => array(
								'type'        => 'boolean',
								'description' => __( 'A hidden field is never required; the server makes sure of it.', 'fieldwright-checkout-fields' ),
							),
						),
					),
				),
				'order'                        => array(
					'type'       => 'object',
					'properties' => array(
						CoreFields::LOCATION_ADDRESS => array(
							'type'        => 'array',
							'items'       => array( 'type' => 'string' ),
							'description' => __( "The Address form's display order: WooCommerce's own field keys and Fieldwright field keys in one list.", 'fieldwright-checkout-fields' ),
						),
					),
				),
				CoreFields::PSEUDO_ORDER_NOTE  => $pseudo,
				CoreFields::PSEUDO_COUPON_FORM => $pseudo,
			),
		);
	}
}
