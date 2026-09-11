<?php
/**
 * Ordered list of custom checkout fields.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Fields;

use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * An ordered, duplicate-free list of field definitions. Array order is display
 * order within each location.
 */
final class FieldCollection {

	/**
	 * Upper bound on stored fields. A checkout with more than this is a mistake,
	 * and an unbounded list would make every checkout request slower.
	 */
	public const MAX_FIELDS = 50;

	/**
	 * Fields, in order.
	 *
	 * @var FieldDefinition[]
	 */
	private $fields;

	/**
	 * Constructor.
	 *
	 * @param FieldDefinition[] $fields Ordered fields.
	 */
	private function __construct( array $fields ) {
		$this->fields = $fields;
	}

	/**
	 * Build from the stored/posted `fields` list.
	 *
	 * @param array<int, mixed> $fields Raw field list.
	 * @return FieldCollection|WP_Error The collection, or every problem found.
	 */
	public static function from_config( array $fields ) {
		$errors = new ValidationErrors();

		if ( array() !== $fields && ! wp_is_numeric_array( $fields ) ) {
			$errors->add( 'fields', 'invalid_value', __( 'Fields must be a list.', 'fieldwright-checkout-fields' ) );
			return $errors->to_wp_error();
		}

		if ( count( $fields ) > self::MAX_FIELDS ) {
			$errors->add(
				'fields',
				'too_many',
				sprintf(
					/* translators: %d: maximum number of fields. */
					__( 'You can add up to %d checkout fields.', 'fieldwright-checkout-fields' ),
					self::MAX_FIELDS
				)
			);
			return $errors->to_wp_error();
		}

		$parsed = array();
		$seen   = array();

		foreach ( array_values( $fields ) as $index => $raw ) {
			$path = 'fields[' . $index . ']';

			if ( ! is_array( $raw ) ) {
				$errors->add( $path, 'invalid_value', __( 'Each field must be an object.', 'fieldwright-checkout-fields' ) );
				continue;
			}

			$field = FieldDefinition::parse( $raw, $path, $errors );
			if ( null === $field ) {
				continue;
			}

			if ( isset( $seen[ $field->id() ] ) ) {
				$errors->add(
					$path . '.id',
					'duplicate_id',
					sprintf(
						/* translators: %s: field key. */
						__( 'The field key "%s" is already used by another field.', 'fieldwright-checkout-fields' ),
						$field->id()
					)
				);
				continue;
			}

			$seen[ $field->id() ] = true;
			$parsed[]             = $field;
		}//end foreach

		if ( $errors->has_errors() ) {
			return $errors->to_wp_error();
		}

		return new self( $parsed );
	}

	/**
	 * Build from already-valid definitions, skipping validation.
	 *
	 * @param FieldDefinition[] $fields Ordered fields.
	 * @return FieldCollection
	 */
	public static function from_definitions( array $fields ): FieldCollection {
		return new self( array_values( $fields ) );
	}

	/**
	 * Fields, in order.
	 *
	 * @return FieldDefinition[]
	 */
	public function all(): array {
		return $this->fields;
	}

	/**
	 * Only the fields the merchant has switched on.
	 *
	 * @return FieldDefinition[]
	 */
	public function enabled(): array {
		return array_values(
			array_filter(
				$this->fields,
				static function ( FieldDefinition $field ): bool {
					return $field->is_enabled();
				}
			)
		);
	}

	/**
	 * Fields belonging to one checkout location, in order.
	 *
	 * @param string $location Location key.
	 * @return FieldDefinition[]
	 */
	public function by_location( string $location ): array {
		return array_values(
			array_filter(
				$this->fields,
				static function ( FieldDefinition $field ) use ( $location ): bool {
					return $field->location() === $location;
				}
			)
		);
	}

	/**
	 * Number of fields.
	 *
	 * @return int
	 */
	public function count(): int {
		return count( $this->fields );
	}

	/**
	 * Normalized array form for storage and REST responses.
	 *
	 * @return array<int, array<string, mixed>>
	 */
	public function to_array(): array {
		return array_map(
			static function ( FieldDefinition $field ): array {
				return $field->to_array();
			},
			$this->fields
		);
	}
}
