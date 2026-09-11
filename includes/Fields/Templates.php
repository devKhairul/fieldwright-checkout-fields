<?php
/**
 * Ready-made field templates offered in the builder's empty state.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Fields;

defined( 'ABSPATH' ) || exit;

/**
 * The ten one-click recipes. Each is a complete, already-normalized field, so
 * clicking one produces exactly what the merchant would have built by hand.
 */
final class Templates {

	/**
	 * All templates in the order they are shown.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public static function all(): array {
		$templates = array(
			self::make(
				'cbwb/delivery-instructions',
				__( 'Delivery instructions', 'fieldwright-checkout-fields' ),
				FieldDefinition::TYPE_TEXT,
				FieldDefinition::LOCATION_ORDER
			),
			self::make(
				'cbwb/how-did-you-hear',
				__( 'How did you hear about us?', 'fieldwright-checkout-fields' ),
				FieldDefinition::TYPE_SELECT,
				FieldDefinition::LOCATION_CONTACT,
				array(
					'placeholder' => __( 'Choose an option', 'fieldwright-checkout-fields' ),
					'options'     => array(
						array(
							'value' => 'search',
							'label' => __( 'Search engine', 'fieldwright-checkout-fields' ),
						),
						array(
							'value' => 'social',
							'label' => __( 'Social media', 'fieldwright-checkout-fields' ),
						),
						array(
							'value' => 'friend',
							'label' => __( 'Friend or family', 'fieldwright-checkout-fields' ),
						),
						array(
							'value' => 'ad',
							'label' => __( 'Advertisement', 'fieldwright-checkout-fields' ),
						),
						array(
							'value' => 'other',
							'label' => __( 'Other', 'fieldwright-checkout-fields' ),
						),
					),
				)
			),
			self::make(
				'cbwb/po-number',
				__( 'Purchase order number', 'fieldwright-checkout-fields' ),
				FieldDefinition::TYPE_TEXT,
				FieldDefinition::LOCATION_ORDER,
				array( 'max_length' => 40 )
			),
			self::make(
				'cbwb/gift-message',
				__( 'Gift message', 'fieldwright-checkout-fields' ),
				FieldDefinition::TYPE_TEXTAREA,
				FieldDefinition::LOCATION_ORDER,
				array(
					'rows'       => 3,
					'max_length' => 200,
				)
			),
			self::make(
				'cbwb/terms-consent',
				__( 'I agree to the terms and conditions', 'fieldwright-checkout-fields' ),
				FieldDefinition::TYPE_CHECKBOX,
				FieldDefinition::LOCATION_ORDER,
				array(
					'required'      => true,
					'error_message' => __( 'You must agree to the terms to continue.', 'fieldwright-checkout-fields' ),
				)
			),
			self::make(
				'cbwb/vat-number',
				__( 'VAT number', 'fieldwright-checkout-fields' ),
				FieldDefinition::TYPE_TEXT,
				FieldDefinition::LOCATION_ADDRESS,
				array(
					'format'       => FormatPresets::CUSTOM,
					'pattern'      => '[A-Z]{2}[A-Z0-9]{2,12}',
					'autocomplete' => '',
				)
			),
			self::make(
				'cbwb/delivery-date',
				__( 'Delivery date', 'fieldwright-checkout-fields' ),
				FieldDefinition::TYPE_DATE,
				FieldDefinition::LOCATION_ORDER,
				array( 'help' => __( 'We deliver Monday to Friday.', 'fieldwright-checkout-fields' ) )
			),
			self::make(
				'cbwb/gift-wrap-style',
				__( 'Gift wrap style', 'fieldwright-checkout-fields' ),
				FieldDefinition::TYPE_RADIO,
				FieldDefinition::LOCATION_ORDER,
				array(
					'options'        => array(
						array(
							'value' => 'none',
							'label' => __( 'No gift wrap', 'fieldwright-checkout-fields' ),
						),
						array(
							'value' => 'classic',
							'label' => __( 'Classic', 'fieldwright-checkout-fields' ),
						),
						array(
							'value' => 'premium',
							'label' => __( 'Premium', 'fieldwright-checkout-fields' ),
						),
					),
					'options_layout' => FieldDefinition::LAYOUT_STACKED,
				)
			),
			self::make(
				'cbwb/special-requests',
				__( 'Special requests', 'fieldwright-checkout-fields' ),
				FieldDefinition::TYPE_TEXTAREA,
				FieldDefinition::LOCATION_ORDER,
				array( 'rows' => 4 )
			),
			self::make(
				'cbwb/order-heading',
				__( 'A few more details', 'fieldwright-checkout-fields' ),
				FieldDefinition::TYPE_HEADING,
				FieldDefinition::LOCATION_ORDER,
				array( 'content_level' => 3 )
			),
		);

		return $templates;
	}

	/**
	 * Build one template, normalized through FieldDefinition so a template can
	 * never be something the validator would reject.
	 *
	 * @param string               $id       Field id.
	 * @param string               $label    Field label.
	 * @param string               $type     Field type.
	 * @param string               $location Field location.
	 * @param array<string, mixed> $extras   Type-specific overrides.
	 * @return array<string, mixed>
	 */
	private static function make( string $id, string $label, string $type, string $location, array $extras = array() ): array {
		$raw = array_merge(
			array(
				'id'                         => $id,
				'label'                      => $label,
				'type'                       => $type,
				'location'                   => $location,
				'enabled'                    => true,
				'show_in_order_confirmation' => true,
			),
			$extras
		);

		$field = FieldDefinition::from_array( $raw );

		// Templates are authored here, so a failure is a bug rather than input.
		return is_wp_error( $field ) ? $raw : $field->to_array();
	}
}
