<?php
/**
 * The register an add-on hands Fieldwright a field type through.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Fields;

use InvalidArgumentException;

defined( 'ABSPATH' ) || exit;

/**
 * Field types an add-on owns end to end.
 *
 * Fieldwright's own types are hard-coded in `FieldDefinition`, because it
 * renders, validates, stores and displays each of them itself. A type nobody
 * here has heard of is a different arrangement: the add-on describes it once,
 * and everything Free does with a value of that type — coercing a submission
 * into the stored form, checking it, writing it out for a human, drawing it on
 * the order screen, publishing what the shopper needs — is done by asking the
 * callbacks below. A registered type is always in the `rich` family: Free draws
 * it with its own checkout block and stores it under its own meta key, which is
 * the only arrangement that does not need WooCommerce to understand the type.
 *
 * A type's own settings are not stored here. They live under the field's opaque
 * `pro` payload, which Free already round-trips verbatim, so registering a type
 * asks nothing of the configuration schema.
 *
 * Registration belongs on the `cbwb_loaded` action. Registering after
 * `rest_api_init`, or after anything has read the configuration, is
 * unsupported: the admin catalogue, the REST schema and every parsed field are
 * built from what the register held at the time they were built.
 */
final class TypeRegistry {

	/**
	 * What a type key may look like: the shape of a PHP array key that also
	 * survives a JSON payload, a CSS class and a meta key untouched.
	 */
	public const KEY_PATTERN = '/^[a-z][a-z0-9_]*$/';

	/**
	 * How long a type key may be. The key travels in every stored field and in
	 * the checkout payload, so it is kept short enough to read.
	 */
	public const MAX_KEY_LENGTH = 32;

	/**
	 * What `order_editor` is set to for a type the order screen only prints.
	 */
	public const EDITOR_READONLY = 'readonly';

	/**
	 * Registered types, keyed by their key, in the order they were registered.
	 *
	 * @var array<string, array<string, mixed>>
	 */
	private static $types = array();

	/**
	 * Take a type into the register.
	 *
	 * Everything the spec leaves out is filled in here rather than guessed at
	 * by the callers, so every reader gets the same shape whatever the add-on
	 * bothered to say. A problem with the key or the spec is a programming
	 * mistake in the add-on rather than something a merchant did, so it is
	 * thrown rather than collected: a type registered half-way would fail
	 * later, somewhere with no way back to the line that caused it.
	 *
	 * @param string               $key  Type key, as it is stored on a field.
	 * @param array<string, mixed> $spec Type description; see the class docblock.
	 * @throws InvalidArgumentException When the key or the spec cannot be used.
	 */
	public static function register( string $key, array $spec ): void {
		self::check_key( $key );

		self::$types[ $key ] = self::normalize( $key, $spec );
	}

	/**
	 * Whether a type is registered.
	 *
	 * @param string $key Type key.
	 * @return bool
	 */
	public static function has( string $key ): bool {
		return isset( self::$types[ $key ] );
	}

	/**
	 * One registered type, with every default filled in, or null for a key
	 * nobody registered.
	 *
	 * @param string $key Type key.
	 * @return array<string, mixed>|null
	 */
	public static function spec( string $key ): ?array {
		return self::$types[ $key ] ?? null;
	}

	/**
	 * Every registered type, keyed by key, in registration order.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	public static function all(): array {
		return self::$types;
	}

	/**
	 * Empty the register.
	 *
	 * For tests that want to start from nothing. Nothing in the plugin calls
	 * it: a type is registered once per request, on `cbwb_loaded`. A test that
	 * has to leave the register as it found it takes a `snapshot()` first and
	 * `restore()`s it after, because emptying the register also forgets what
	 * every add-on running alongside the suite registered.
	 */
	public static function reset(): void {
		self::$types = array();
	}

	/**
	 * The register as it stands, to hand back to `restore()`.
	 *
	 * @return array<string, array<string, mixed>>
	 */
	public static function snapshot(): array {
		return self::$types;
	}

	/**
	 * Put back a register taken with `snapshot()`.
	 *
	 * @param array<string, array<string, mixed>> $types What `snapshot()` returned.
	 */
	public static function restore( array $types ): void {
		self::$types = $types;
	}

	/**
	 * Refuse a key that could not be stored, or that is already spoken for.
	 *
	 * @param string $key Type key.
	 * @throws InvalidArgumentException When the key cannot be used.
	 */
	private static function check_key( string $key ): void {
		if ( 1 !== preg_match( self::KEY_PATTERN, $key ) || strlen( $key ) > self::MAX_KEY_LENGTH ) {
			throw new InvalidArgumentException(
				esc_html(
					sprintf(
						'A field type key is up to %1$d characters of lowercase letters, numbers and underscores, starting with a letter; "%2$s" is not.',
						self::MAX_KEY_LENGTH,
						$key
					)
				)
			);
		}

		// Fieldwright's own types are rendered and validated by code an
		// add-on cannot reach, so a registration taking one of their names
		// would be silently ignored by half the plugin.
		if ( in_array( $key, FieldDefinition::builtin_types(), true ) ) {
			throw new InvalidArgumentException( esc_html( sprintf( '"%s" is one of Fieldwright\'s own field types and cannot be registered.', $key ) ) );
		}
	}

	/**
	 * Fill every default in, and refuse a spec that could not be honoured.
	 *
	 * A key the spec does not name is dropped rather than kept, so a reader
	 * never has to ask whether a key it does not recognise means something.
	 *
	 * @param string               $key  Type key.
	 * @param array<string, mixed> $spec Type description.
	 * @return array<string, mixed>
	 * @throws InvalidArgumentException When part of the spec cannot be used.
	 */
	private static function normalize( string $key, array $spec ): array {
		return array(
			'label'           => self::read_label( $key, $spec ),
			'description'     => self::read_string( $key, $spec, 'description' ),
			'checkout'        => self::read_bool( $key, $spec, 'checkout', true ),
			'sanitize'        => self::read_callable( $key, $spec, 'sanitize', array( self::class, 'default_sanitize' ) ),
			'validate'        => self::read_callable( $key, $spec, 'validate', array( self::class, 'default_validate' ) ),
			'display'         => self::read_callable( $key, $spec, 'display', array( self::class, 'default_display' ) ),
			'public'          => self::read_callable( $key, $spec, 'public', array( self::class, 'default_public' ) ),
			'order_editor'    => self::read_editor( $key, $spec ),
			'editable'        => self::read_bool( $key, $spec, 'editable', false ),
			'default_value'   => self::read_bool( $key, $spec, 'default_value', false ),
			'save_to_profile' => self::read_bool( $key, $spec, 'save_to_profile', false ),
			'placements'      => self::read_placements( $key, $spec ),
		);
	}

	/**
	 * The name the builder's type picker lists the type under. The one thing a
	 * spec has to say, because a type with no name cannot be offered.
	 *
	 * @param string               $key  Type key.
	 * @param array<string, mixed> $spec Type description.
	 * @return string
	 * @throws InvalidArgumentException When the label is missing or not text.
	 */
	private static function read_label( string $key, array $spec ): string {
		$label = $spec['label'] ?? '';

		if ( ! is_string( $label ) || '' === trim( $label ) ) {
			throw new InvalidArgumentException( esc_html( sprintf( 'The field type "%s" needs a non-empty "label".', $key ) ) );
		}

		return $label;
	}

	/**
	 * Read an optional string.
	 *
	 * @param string               $key  Type key.
	 * @param array<string, mixed> $spec Type description.
	 * @param string               $name Spec key to read.
	 * @return string
	 * @throws InvalidArgumentException When the value is not text.
	 */
	private static function read_string( string $key, array $spec, string $name ): string {
		if ( ! isset( $spec[ $name ] ) ) {
			return '';
		}

		if ( ! is_string( $spec[ $name ] ) ) {
			throw new InvalidArgumentException( esc_html( sprintf( 'The field type "%1$s" set "%2$s" to something that is not text.', $key, $name ) ) );
		}

		return $spec[ $name ];
	}

	/**
	 * Read an optional switch.
	 *
	 * @param string               $key      Type key.
	 * @param array<string, mixed> $spec     Type description.
	 * @param string               $name     Spec key to read.
	 * @param bool                 $fallback Value used when the key is absent.
	 * @return bool
	 * @throws InvalidArgumentException When the value is not a boolean.
	 */
	private static function read_bool( string $key, array $spec, string $name, bool $fallback ): bool {
		if ( ! array_key_exists( $name, $spec ) ) {
			return $fallback;
		}

		if ( ! is_bool( $spec[ $name ] ) ) {
			throw new InvalidArgumentException( esc_html( sprintf( 'The field type "%1$s" set "%2$s" to something that is not true or false.', $key, $name ) ) );
		}

		return $spec[ $name ];
	}

	/**
	 * Read one of the callbacks, falling back to the behaviour a type that
	 * says nothing about it gets.
	 *
	 * @param string               $key      Type key.
	 * @param array<string, mixed> $spec     Type description.
	 * @param string               $name     Spec key to read.
	 * @param callable             $fallback Default callback.
	 * @return callable
	 * @throws InvalidArgumentException When the value cannot be called.
	 */
	private static function read_callable( string $key, array $spec, string $name, callable $fallback ): callable {
		if ( ! isset( $spec[ $name ] ) ) {
			return $fallback;
		}

		if ( ! is_callable( $spec[ $name ] ) ) {
			throw new InvalidArgumentException( esc_html( sprintf( 'The field type "%1$s" set "%2$s" to something that cannot be called.', $key, $name ) ) );
		}

		return $spec[ $name ];
	}

	/**
	 * Read what the order screen does with a value of this type: print it, or
	 * hand the drawing to the add-on.
	 *
	 * Drawing and saving are two separate permissions. A callable draws
	 * whatever it likes, but nothing it draws posts back unless the spec also
	 * says `editable`, which is off unless asked for: a value that names
	 * something the add-on holds — an upload, a booking — must not be
	 * replaceable from a form field by anyone who can edit orders, however
	 * well-formed the replacement is.
	 *
	 * @param string               $key  Type key.
	 * @param array<string, mixed> $spec Type description.
	 * @return callable|string
	 * @throws InvalidArgumentException When the value is neither.
	 */
	private static function read_editor( string $key, array $spec ) {
		if ( ! isset( $spec['order_editor'] ) ) {
			return self::EDITOR_READONLY;
		}

		if ( self::EDITOR_READONLY === $spec['order_editor'] ) {
			return self::EDITOR_READONLY;
		}

		if ( ! is_callable( $spec['order_editor'] ) ) {
			throw new InvalidArgumentException( esc_html( sprintf( 'The field type "%1$s" set "order_editor" to something that is neither "%2$s" nor callable.', $key, self::EDITOR_READONLY ) ) );
		}

		return $spec['order_editor'];
	}

	/**
	 * Read where the type may be placed. A type that names none may go
	 * anywhere Fieldwright itself draws a field.
	 *
	 * @param string               $key  Type key.
	 * @param array<string, mixed> $spec Type description.
	 * @return string[]
	 * @throws InvalidArgumentException When a placement is not one of ours.
	 */
	private static function read_placements( string $key, array $spec ): array {
		if ( ! isset( $spec['placements'] ) ) {
			return FieldDefinition::locations();
		}

		$placements = $spec['placements'];

		if ( ! is_array( $placements ) || array() === $placements ) {
			throw new InvalidArgumentException( esc_html( sprintf( 'The field type "%s" set "placements" to something that is not a non-empty list.', $key ) ) );
		}

		foreach ( $placements as $placement ) {
			if ( ! is_string( $placement ) || ! in_array( $placement, FieldDefinition::locations(), true ) ) {
				throw new InvalidArgumentException( esc_html( sprintf( 'The field type "%s" named a placement Fieldwright does not have.', $key ) ) );
			}
		}

		return array_values( $placements );
	}

	/**
	 * What a type that says nothing about sanitizing gets: plain text, cut to
	 * whatever the field accepts.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param string          $raw   Submitted value, already trimmed.
	 * @return string
	 */
	public static function default_sanitize( FieldDefinition $field, string $raw ): string {
		$clean = sanitize_text_field( $raw );
		$cap   = $field->length_cap();

		return mb_strlen( $clean ) > $cap ? mb_substr( $clean, 0, $cap ) : $clean;
	}

	/**
	 * What a type that says nothing about validating gets: the same length
	 * check every other answer is held to.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param string          $raw   Submitted value, never empty.
	 * @return string|null
	 */
	public static function default_validate( FieldDefinition $field, string $raw ): ?string {
		return mb_strlen( $raw ) > $field->length_cap() ? RichValues::too_long_message( $field ) : null;
	}

	/**
	 * What a type that says nothing about display gets: the stored value.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param string          $value Stored value.
	 * @return string
	 */
	public static function default_display( FieldDefinition $field, string $value ): string {
		unset( $field );

		return $value;
	}

	/**
	 * What a type that says nothing about the checkout payload gets: the keys
	 * every field carries and nothing more.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return array<string, mixed>
	 */
	public static function default_public( FieldDefinition $field ): array {
		unset( $field );

		return array();
	}
}
