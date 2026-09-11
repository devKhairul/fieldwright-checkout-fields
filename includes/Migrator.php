<?php
/**
 * Config schema migrations.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder;

use CheckoutBuilder\Fields\CoreFields;
use CheckoutBuilder\Fields\FieldDefinition;

defined( 'ABSPATH' ) || exit;

/**
 * Upgrades a stored configuration to the current schema version.
 *
 * Migrations are pure: they take a config array and return a config array.
 * Persisting the result is the caller's job.
 */
final class Migrator {

	/**
	 * Migrate a configuration array up to the current schema version.
	 *
	 * @param array<string, mixed> $config Stored configuration.
	 * @param int                  $from   Version the configuration is currently at.
	 * @return array<string, mixed> Configuration at Config::SCHEMA_VERSION.
	 */
	public static function migrate( array $config, int $from ): array {
		if ( $from < 2 ) {
			$config = self::to_v2( $config );
		}

		if ( $from < 3 ) {
			$config = self::to_v3( $config );
		}

		if ( $from < 4 ) {
			$config = self::to_v4( $config );
		}

		$config['schema_version'] = Config::SCHEMA_VERSION;

		return $config;
	}

	/**
	 * 3 → 4: WooCommerce's own checkout fields join the outline, so the config
	 * gains a `core` map for the changes made to them.
	 *
	 * The map starts empty on purpose. Every property is stored as a difference
	 * from what WooCommerce ships, so "nothing stored" is exactly the checkout
	 * the merchant has today — upgrading changes nothing they can see. The three
	 * fields whose visibility WooCommerce keeps in options of its own
	 * (company, address line 2, phone) are not copied in here either: they are
	 * read from and written back to those options, so there is nothing to move.
	 *
	 * @param array<string, mixed> $config Configuration at version 3.
	 * @return array<string, mixed>
	 */
	private static function to_v4( array $config ): array {
		$config['core'] = CoreFields::normalize( $config['core'] ?? array() );

		return $config;
	}

	/**
	 * 2 → 3: the expanded type list arrives, and with it a pile of new keys —
	 * help text, a starting value, a layout width, per-surface visibility, and
	 * the type-specific settings the new types need.
	 *
	 * Every stored field is re-normalized, which fills those keys with their
	 * defaults. The one value that is not simply a default is `visibility`:
	 * `show_in_order_confirmation` becomes its `thank_you` switch, so a merchant
	 * who had already hidden a field from the confirmation page keeps it hidden.
	 * That mapping lives in FieldDefinition, which both this and every later
	 * read go through, so it happens whether or not this migration runs.
	 *
	 * @param array<string, mixed> $config Configuration at version 2.
	 * @return array<string, mixed>
	 */
	private static function to_v3( array $config ): array {
		return self::renormalize( $config );
	}

	/**
	 * 1 → 2: the field schema arrives. Version 1 stored whatever the admin app
	 * posted, so every entry is re-validated; anything that cannot be normalized
	 * into a usable field is dropped rather than kept as a field that would
	 * never register with WooCommerce.
	 *
	 * @param array<string, mixed> $config Configuration at version 1.
	 * @return array<string, mixed>
	 */
	private static function to_v2( array $config ): array {
		return self::renormalize( $config );
	}

	/**
	 * Re-validate every stored field, dropping the ones that can no longer be
	 * normalized into something that would register with WooCommerce.
	 *
	 * @param array<string, mixed> $config Stored configuration.
	 * @return array<string, mixed>
	 */
	private static function renormalize( array $config ): array {
		$stored = isset( $config['fields'] ) && is_array( $config['fields'] ) ? $config['fields'] : array();

		$fields = array();
		$seen   = array();

		foreach ( array_values( $stored ) as $raw ) {
			if ( ! is_array( $raw ) ) {
				continue;
			}

			$field = FieldDefinition::from_array( $raw );
			if ( is_wp_error( $field ) ) {
				continue;
			}

			if ( isset( $seen[ $field->id() ] ) ) {
				continue;
			}

			$seen[ $field->id() ] = true;
			$fields[]             = $field->to_array();
		}

		$config['fields'] = $fields;

		return $config;
	}
}
