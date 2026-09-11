<?php
/**
 * Config storage.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder;

use CheckoutBuilder\Fields\CoreFields;
use CheckoutBuilder\Fields\FieldCollection;
use CheckoutBuilder\Fields\FieldDefinition;

defined( 'ABSPATH' ) || exit;

/**
 * Reads and writes the plugin configuration option.
 *
 * The configuration is a single versioned array:
 * `{ schema_version, fields, core }` — the fields the merchant added, and the
 * changes they made to the ones WooCommerce ships with. Reads always return
 * normalized data, so every other class can assume the contract holds.
 */
final class Config {

	/**
	 * Option name holding the configuration.
	 */
	public const OPTION = 'cbwb_config';

	/**
	 * Option name for the per-site "remove data on uninstall" preference.
	 */
	public const OPTION_UNINSTALL_CLEANUP = 'cbwb_remove_data_on_uninstall';

	/**
	 * Option name for how the checkout tells required fields from optional ones.
	 */
	public const OPTION_REQUIRED_MARKING = 'cbwb_required_marking';

	/**
	 * Option name for the line above the form that explains the asterisk.
	 */
	public const OPTION_REQUIRED_NOTE = 'cbwb_required_note';

	/**
	 * WooCommerce's own way round: optional fields say so, required ones say
	 * nothing. The default here, because it is the checkout the merchant already
	 * has.
	 */
	public const MARKING_OPTIONAL_LABEL = 'optional_label';

	/**
	 * The other way round: optional fields say nothing, required ones carry an
	 * asterisk.
	 */
	public const MARKING_ASTERISK = 'asterisk';

	/**
	 * The two answers the setting takes.
	 */
	public const MARKINGS = array( self::MARKING_OPTIONAL_LABEL, self::MARKING_ASTERISK );

	/**
	 * Current config schema version. Bump when the shape changes and add a migration.
	 */
	public const SCHEMA_VERSION = 4;

	/**
	 * Default configuration.
	 *
	 * @return array<string, mixed>
	 */
	public static function defaults(): array {
		return array(
			'schema_version' => self::SCHEMA_VERSION,
			'fields'         => array(),
			'core'           => CoreFields::defaults(),
		);
	}

	/**
	 * Write defaults if no config exists yet. Safe to call repeatedly.
	 */
	public static function install_defaults(): void {
		if ( false === get_option( self::OPTION, false ) ) {
			add_option( self::OPTION, self::defaults(), '', false );
		}
		if ( false === get_option( self::OPTION_UNINSTALL_CLEANUP, false ) ) {
			add_option( self::OPTION_UNINSTALL_CLEANUP, 'no', '', false );
		}
		if ( false === get_option( self::OPTION_REQUIRED_MARKING, false ) ) {
			add_option( self::OPTION_REQUIRED_MARKING, self::MARKING_OPTIONAL_LABEL, '', false );
		}
		if ( false === get_option( self::OPTION_REQUIRED_NOTE, false ) ) {
			add_option( self::OPTION_REQUIRED_NOTE, 'yes', '', false );
		}
	}

	/**
	 * Read the configuration, migrating and normalizing it first.
	 *
	 * The reading everything outside PHP is handed — the REST resource, the
	 * builder's bootstrap — so the empty core override map is cast to an object
	 * here rather than shipped as the `[]` PHP's own empty array encodes to.
	 * Callers that work on the configuration in PHP read `fields()` and `core()`
	 * instead, and get arrays.
	 *
	 * The revision travels with the configuration rather than being added by
	 * whoever serves it. Both readers have to have it — the builder is seeded
	 * from the inline bootstrap and may save without ever calling the REST
	 * route — and one of them getting it and the other not is exactly the bug
	 * this key exists to prevent, in a place nobody would look for it.
	 *
	 * @return array<string, mixed>
	 */
	public function get(): array {
		return array(
			'schema_version' => self::SCHEMA_VERSION,
			'fields'         => $this->fields()->to_array(),
			'core'           => CoreFields::for_json( $this->core() ),
			'revision'       => $this->revision(),
		);
	}

	/**
	 * A short stamp of the configuration as it stands.
	 *
	 * Used to notice that someone else has saved since the builder last read: the
	 * screen sends back the stamp it was given, and a save whose stamp no longer
	 * matches is refused rather than quietly overwriting the other person's work.
	 * It is derived from the configuration rather than counted alongside it, so
	 * it cannot drift out of step with what it describes, and a change that ends
	 * up back where it started is correctly not a conflict.
	 *
	 * Always a 32-character string, including on a store where the option has
	 * never been written: "no configuration yet" is a state worth stamping like
	 * any other, and it is the state the very first save is made against.
	 *
	 * @return string
	 */
	public function revision(): string {
		return md5( (string) wp_json_encode( $this->canonical() ) );
	}

	/**
	 * The configuration in one fixed shape, for hashing.
	 *
	 * Deliberately not `get()`, which would be circular, and deliberately the
	 * normalized fields rather than their JSON presentation: what is being
	 * compared is the stored configuration, not how it happens to be rendered
	 * for a reader. Anything that writes the option — this class, WP-CLI, an
	 * import, another tab — changes what this returns, and so changes the stamp.
	 *
	 * The core map is taken as stored rather than through `core()`. It was
	 * normalized on the way in, and normalizing it again on the way out asks
	 * WooCommerce's country table whether a label says anything — an answer
	 * that depends on whether the table has been read yet on this request. Two
	 * requests that reach that question at different points in the boot would
	 * stamp the same option differently, and the builder would be told its own
	 * unchanged copy was stale. The stored bytes say the same thing everywhere.
	 *
	 * @return array<string, mixed>
	 */
	private function canonical(): array {
		$stored = $this->stored();

		return array(
			'schema_version' => self::SCHEMA_VERSION,
			'fields'         => $this->fields()->to_array(),
			'core'           => isset( $stored['core'] ) && is_array( $stored['core'] ) ? $stored['core'] : array(),
		);
	}

	/**
	 * The stored array the memo below was built from.
	 *
	 * @var array<string, mixed>|null
	 */
	private static $memo_source = null;

	/**
	 * The parsed fields for `$memo_source`.
	 *
	 * @var FieldCollection|null
	 */
	private static $memo_fields = null;

	/**
	 * The normalized core overrides for `$memo_source`.
	 *
	 * @var array<string, mixed>|null
	 */
	private static $memo_core = null;

	/**
	 * The configured fields.
	 *
	 * @return FieldCollection
	 */
	public function fields(): FieldCollection {
		$config = $this->stored();
		self::sync( $config );

		if ( null === self::$memo_fields ) {
			$raw = isset( $config['fields'] ) && is_array( $config['fields'] ) ? $config['fields'] : array();

			self::$memo_fields = self::coerce( $raw );
		}

		return self::$memo_fields;
	}

	/**
	 * The merchant's changes to WooCommerce's own checkout fields.
	 *
	 * Only what differs from WooCommerce's defaults is stored, so an empty map
	 * means "every core field exactly as WooCommerce ships it".
	 *
	 * @return array<string, mixed>
	 */
	public function core(): array {
		$config = $this->stored();
		self::sync( $config );

		if ( null === self::$memo_core ) {
			self::$memo_core = CoreFields::normalize( $config['core'] ?? array() );
		}

		return self::$memo_core;
	}

	/**
	 * Keep the memo honest by tying it to the stored array it was built from.
	 *
	 * Parsing is not cheap: a full read validates every field, runs a `preg_match`
	 * probe per custom pattern and a `wp_kses` per paragraph. It also happens far
	 * more often than it looks, because WooCommerce asks for the default address
	 * fields several times per request and each ask walks the whole configuration,
	 * which adds up to dozens of parses on a guest-reachable Store API call.
	 *
	 * What is cached is therefore the parse, not the read. `get_option()` goes to
	 * the object cache and is cheap; comparing what it returned against what the
	 * memo was built from is cheaper still than parsing it again, and it means no
	 * write can leave a stale copy behind. That matters because the repository is
	 * not a singleton: the running plugin holds one, a REST controller saving a
	 * change holds another, and before this was keyed on content the plugin's copy
	 * went on answering with the configuration as it stood when the request began.
	 *
	 * The memo is shared by every instance because they all describe one option.
	 *
	 * @param array<string, mixed> $config The configuration just read.
	 */
	private static function sync( array $config ): void {
		if ( self::$memo_source === $config ) {
			return;
		}

		self::$memo_source = $config;
		self::$memo_fields = null;
		self::$memo_core   = null;
	}

	/**
	 * Read the stored configuration, migrating and persisting it if it is behind.
	 *
	 * @return array<string, mixed>
	 */
	private function stored(): array {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		$config  = array_merge( self::defaults(), $stored );
		$version = isset( $config['schema_version'] ) && is_numeric( $config['schema_version'] ) ? (int) $config['schema_version'] : 1;

		if ( $version < self::SCHEMA_VERSION ) {
			$config = Migrator::migrate( $config, $version );
			update_option( self::OPTION, $config, false );
		}

		return $config;
	}

	/**
	 * Persist a configuration array. Invalid fields are dropped; callers that
	 * need to report problems must validate with FieldCollection first.
	 *
	 * @param array<string, mixed> $config Configuration array with a `fields` key,
	 *                                     and optionally a `core` one.
	 * @return array<string, mixed> The stored configuration.
	 */
	public function save( array $config ): array {
		$raw  = isset( $config['fields'] ) && is_array( $config['fields'] ) ? $config['fields'] : array();
		$core = array_key_exists( 'core', $config ) ? CoreFields::normalize( $config['core'] ) : null;

		return $this->save_fields( self::coerce( $raw ), $core );
	}

	/**
	 * Persist an already-validated collection.
	 *
	 * @param FieldCollection           $fields Fields to store.
	 * @param array<string, mixed>|null $core   Core-field changes, or null to keep the stored ones.
	 * @return array<string, mixed> The stored configuration.
	 */
	public function save_fields( FieldCollection $fields, ?array $core = null ): array {
		$config = array(
			'schema_version' => self::SCHEMA_VERSION,
			'fields'         => $fields->to_array(),
			'core'           => null === $core ? $this->core() : CoreFields::normalize( $core ),
		);

		update_option( self::OPTION, $config, false );

		return $config;
	}

	/**
	 * Persist core-field changes on their own, leaving the fields alone.
	 *
	 * @param array<string, mixed> $core Core-field changes.
	 * @return array<string, mixed> The stored configuration.
	 */
	public function save_core( array $core ): array {
		return $this->save_fields( $this->fields(), $core );
	}

	/**
	 * Whether the merchant asked for their data to be deleted on uninstall.
	 *
	 * @return bool
	 */
	public function remove_data_on_uninstall(): bool {
		return 'yes' === get_option( self::OPTION_UNINSTALL_CLEANUP, 'no' );
	}

	/**
	 * Store the uninstall-cleanup preference.
	 *
	 * @param bool $remove Whether to remove data on uninstall.
	 */
	public function set_remove_data_on_uninstall( bool $remove ): void {
		update_option( self::OPTION_UNINSTALL_CLEANUP, $remove ? 'yes' : 'no', false );
	}

	/**
	 * How the checkout tells a required field from an optional one.
	 *
	 * Anything the option does not recognise reads as WooCommerce's own way
	 * round, so a hand-edited option can never leave the checkout marking
	 * nothing at all.
	 *
	 * @return string One of self::MARKINGS.
	 */
	public function required_marking(): string {
		$stored = get_option( self::OPTION_REQUIRED_MARKING, self::MARKING_OPTIONAL_LABEL );

		return is_string( $stored ) && in_array( $stored, self::MARKINGS, true )
			? $stored
			: self::MARKING_OPTIONAL_LABEL;
	}

	/**
	 * Store how the checkout marks required fields.
	 *
	 * @param string $marking One of self::MARKINGS.
	 */
	public function set_required_marking( string $marking ): void {
		update_option(
			self::OPTION_REQUIRED_MARKING,
			in_array( $marking, self::MARKINGS, true ) ? $marking : self::MARKING_OPTIONAL_LABEL,
			false
		);
	}

	/**
	 * Whether required fields carry an asterisk instead of optional ones saying
	 * they are optional.
	 *
	 * The question every caller actually has, asked once here so no other class
	 * has to know the two option values by name.
	 *
	 * @return bool
	 */
	public function marks_required(): bool {
		return self::MARKING_ASTERISK === $this->required_marking();
	}

	/**
	 * Whether the checkout carries the line that explains the asterisk.
	 *
	 * On by default: an asterisk nobody has explained is a convention rather
	 * than an instruction.
	 *
	 * @return bool
	 */
	public function required_note(): bool {
		return 'no' !== get_option( self::OPTION_REQUIRED_NOTE, 'yes' );
	}

	/**
	 * Store whether the checkout carries the line that explains the asterisk.
	 *
	 * @param bool $show Whether to show it.
	 */
	public function set_required_note( bool $show ): void {
		update_option( self::OPTION_REQUIRED_NOTE, $show ? 'yes' : 'no', false );
	}

	/**
	 * Every store-wide preference, in the one shape the REST resource and both
	 * bootstraps speak.
	 *
	 * Built here rather than in each of the three readers, so a preference added
	 * later cannot reach one of them and not the others.
	 *
	 * @return array{remove_data_on_uninstall: bool, required_marking: string, required_note: bool}
	 */
	public function settings(): array {
		return array(
			'remove_data_on_uninstall' => $this->remove_data_on_uninstall(),
			'required_marking'         => $this->required_marking(),
			'required_note'            => $this->required_note(),
		);
	}

	/**
	 * Build a collection from stored data, discarding entries that no longer
	 * validate instead of failing the whole read.
	 *
	 * @param array<int, mixed> $raw Raw field list.
	 * @return FieldCollection
	 */
	private static function coerce( array $raw ): FieldCollection {
		$collection = FieldCollection::from_config( $raw );
		if ( ! is_wp_error( $collection ) ) {
			return $collection;
		}

		$fields = array();
		$seen   = array();

		foreach ( array_values( $raw ) as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}

			$field = FieldDefinition::from_array( $entry );

			if ( is_wp_error( $field ) && isset( $entry['pro'] ) ) {
				// An add-on's settings can stop applying without anything being
				// wrong with the field itself — a fee configured on a checkbox
				// that was later turned into a text box, say. Dropping the whole
				// field would take it off the checkout; drop only the settings.
				unset( $entry['pro'] );
				$field = FieldDefinition::from_array( $entry );
			}

			if ( is_wp_error( $field ) || isset( $seen[ $field->id() ] ) ) {
				continue;
			}
			$seen[ $field->id() ] = true;
			$fields[]             = $field;
		}//end foreach

		return FieldCollection::from_definitions( array_slice( $fields, 0, FieldCollection::MAX_FIELDS ) );
	}
}
