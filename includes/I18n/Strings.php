<?php
/**
 * Merchant-entered strings, handed to the translation plugins.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\I18n;

use CheckoutBuilder\Config;
use CheckoutBuilder\Fields\FieldDefinition;

defined( 'ABSPATH' ) || exit;

/**
 * Registers every word a merchant typed into the builder as a translatable
 * string, and translates it again on the way out to the shopper.
 *
 * A label is a stored option, not a gettext call, so no `.po` file can carry
 * it. WPML and Polylang both answer that with one pair of hooks:
 * `wpml_register_single_string` puts a string in front of the translator, and
 * `wpml_translate_single_string` hands back the translation for the language of
 * the current request. Polylang implements both in its WPML compatibility
 * layer, so covering the pair covers both plugins; nothing here calls WPML's
 * own API or Polylang's, and nothing here needs either to be installed.
 *
 * Registration happens on the save, which is the only moment the set of strings
 * can change, and translation happens at the point a string is handed to the
 * checkout. Never in the builder: the merchant edits the source strings there,
 * and a builder showing translations would save them over the originals.
 *
 * TranslatePress needs no registration at all — it translates the rendered page
 * — and the markup our fields are rendered from carries no attribute it would
 * translate. See `Blocks\RichFields::wrapper()`.
 */
final class Strings {

	/**
	 * The context every string is registered and read under. Shown to the
	 * translator as the group name, so it is the plugin's name rather than its
	 * text domain.
	 */
	public const CONTEXT = 'fieldwright-checkout-fields';

	/**
	 * Config repository.
	 *
	 * @var Config
	 */
	private $config;

	/**
	 * Whether a save this request has already asked for a registration pass.
	 *
	 * @var bool
	 */
	private $scheduled = false;

	/**
	 * Constructor.
	 *
	 * @param Config $config Config repository.
	 */
	public function __construct( Config $config ) {
		$this->config = $config;
	}

	/**
	 * Attach hooks.
	 *
	 * The two option hooks rather than a save method of our own: the
	 * configuration is written from the REST controller, from an import, and by
	 * anything else that calls `Config::save()`, and all of them end at
	 * `update_option()`.
	 */
	public function register(): void {
		add_action( 'update_option_' . Config::OPTION, array( $this, 'schedule' ) );
		add_action( 'add_option_' . Config::OPTION, array( $this, 'schedule' ) );

		// WooCommerce's own fields the merchant has relabelled. The same two
		// filters `Fields\CoreFields` writes the stored label into, read back
		// after it at a later priority, plus the per-country entries it fans
		// that label out into.
		add_filter( 'woocommerce_default_address_fields', array( $this, 'translate_core_labels' ), 20 );
		add_filter( 'woocommerce_get_country_locale_default', array( $this, 'translate_core_labels' ), 20 );
		add_filter( 'cbwb_core_locale_overrides', array( $this, 'translate_locale_labels' ), 20 );
	}

	/**
	 * Note that the configuration has changed, and register once the request is
	 * otherwise finished.
	 *
	 * Deferred rather than done on the spot for two reasons. Reading the
	 * configuration back inside its own save hook is how a stored copy from an
	 * older schema gets migrated and written mid-save, which is a surprise
	 * nobody asked the save for; and a request that writes twice (fields, then
	 * WooCommerce's own rows) should still register once.
	 */
	public function schedule(): void {
		if ( $this->scheduled ) {
			return;
		}

		$this->scheduled = true;

		add_action( 'shutdown', array( $this, 'register_strings' ) );
	}

	/**
	 * Put every merchant-entered string in front of the translator.
	 *
	 * Empty strings are skipped: a placeholder nobody typed is not something to
	 * ask anyone to translate, and registering one would leave a blank row in
	 * the string list for every field that has no placeholder.
	 */
	public function register_strings(): void {
		foreach ( $this->config->fields()->all() as $field ) {
			foreach ( self::field_strings( $field ) as $name => $value ) {
				self::register_string( (string) $name, (string) $value );
			}
		}

		foreach ( $this->core_labels() as $key => $label ) {
			self::register_string( self::core_name( (string) $key ), (string) $label );
		}

		/**
		 * Fires while the merchant's own strings are being handed to the
		 * translation plugins.
		 *
		 * Add-ons register whatever the merchant typed into their own settings
		 * here — a fee name, say — using `Strings::register_string()` and the
		 * same names they will read it back by.
		 *
		 * @since 1.0.0
		 *
		 * @param Strings $strings The running string service.
		 */
		do_action( 'cbwb_register_strings', $this );
	}

	/**
	 * Every translatable string on one field, keyed by the name it is
	 * registered and read under.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return array<string, string>
	 */
	public static function field_strings( FieldDefinition $field ): array {
		$strings = array(
			self::field_name( $field->id(), 'label' )   => $field->label(),
			self::field_name( $field->id(), 'placeholder' ) => $field->placeholder(),
			self::field_name( $field->id(), 'help' )    => $field->help(),
			self::field_name( $field->id(), 'error' )   => $field->error_message(),
			self::field_name( $field->id(), 'content' ) => $field->content(),
		);

		// Only where the default is words. A dropdown, a radio group and a
		// checkbox group store one of their own option values there, and a
		// checkbox stores yes or no: machine values, every one of them, and a
		// translated copy would simply stop matching the option list.
		if ( self::has_text_default( $field ) ) {
			$strings[ self::field_name( $field->id(), 'default' ) ] = $field->default_value();
		}

		foreach ( array_values( $field->options() ) as $index => $option ) {
			$strings[ self::field_name( $field->id(), 'option-' . $index ) ] = (string) $option['label'];
		}

		return array_filter(
			$strings,
			static function ( string $value ): bool {
				return '' !== $value;
			}
		);
	}

	/**
	 * The name one of a field's strings is registered under.
	 *
	 * @param string $field_id Field id, e.g. `cbwb/gift-message`.
	 * @param string $part     Which string, e.g. `label` or `option-0`.
	 * @return string
	 */
	public static function field_name( string $field_id, string $part ): string {
		return 'field-' . $field_id . '-' . $part;
	}

	/**
	 * The name one of WooCommerce's own fields is registered under.
	 *
	 * @param string $key  Core field key, e.g. `postcode`.
	 * @param string $part Which string. Only the label today.
	 * @return string
	 */
	public static function core_name( string $key, string $part = 'label' ): string {
		return 'core-' . $key . '-' . $part;
	}

	/**
	 * Hand one string to the translation plugins.
	 *
	 * @param string $name  Name to register it under.
	 * @param string $value The merchant's own text.
	 */
	public static function register_string( string $name, string $value ): void {
		if ( '' === $value ) {
			return;
		}

		/*
		 * WPML's hook, so WPML's name and WPML's argument order: context, name,
		 * value. Polylang answers to the same one through its WPML compatibility
		 * layer, and on a store with neither installed this does nothing at all.
		 * See https://wpml.org/wpml-hook/wpml_register_single_string/ .
		 */
		// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound, WooCommerce.Commenting.CommentHooks.MissingHookComment
		do_action( 'wpml_register_single_string', self::CONTEXT, $name, $value );
	}

	/**
	 * Whether anything is listening for translations.
	 *
	 * Checked before every read rather than once at boot: `has_filter()` is a
	 * lookup in an array WordPress already has, and asking each time is what
	 * makes a store with no translation plugin pay nothing at all.
	 *
	 * @return bool
	 */
	public static function is_available(): bool {
		return (bool) has_filter( 'wpml_translate_single_string' );
	}

	/**
	 * One string in the language of the current request.
	 *
	 * @param string $value The merchant's own text.
	 * @param string $name  The name it was registered under.
	 * @return string The translation, or the original when there is none.
	 */
	public static function translate( string $value, string $name ): string {
		if ( '' === $value || ! self::is_available() ) {
			return $value;
		}

		/*
		 * The other half of WPML's pair. `is_available()` has already checked
		 * something is listening, so the string a store with no translation
		 * plugin gets back is always the one it sent.
		 */
		// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound, WooCommerce.Commenting.CommentHooks.MissingHookComment
		$translated = apply_filters( 'wpml_translate_single_string', $value, self::CONTEXT, $name );

		return is_string( $translated ) && '' !== $translated ? $translated : $value;
	}

	/**
	 * One of a field's strings, translated.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param string          $part  Which string, e.g. `label`.
	 * @param string          $value The merchant's own text.
	 * @return string
	 */
	public static function field( FieldDefinition $field, string $part, string $value ): string {
		return self::translate( $value, self::field_name( $field->id(), $part ) );
	}

	/**
	 * One field's option list with every label translated.
	 *
	 * Values are never touched: they are what the browser posts and what the
	 * order stores, and translating one would make the answer unrecognisable.
	 *
	 * @param FieldDefinition                                 $field   Field definition.
	 * @param array<int, array{value: string, label: string}> $options Options to translate.
	 * @return array<int, array{value: string, label: string}>
	 */
	public static function options( FieldDefinition $field, array $options ): array {
		if ( ! self::is_available() ) {
			return $options;
		}

		foreach ( array_values( $options ) as $index => $option ) {
			$options[ $index ]['label'] = self::field( $field, 'option-' . $index, (string) $option['label'] );
		}

		return $options;
	}

	/**
	 * One field's array form with every merchant-entered string translated.
	 *
	 * This is the shape the checkout bundle is handed, so it is the one place
	 * the fields we draw ourselves get their translations.
	 *
	 * @param FieldDefinition      $field Field definition.
	 * @param array<string, mixed> $data  The field as `FieldDefinition::to_array()` returns it.
	 * @return array<string, mixed>
	 */
	public static function translate_payload( FieldDefinition $field, array $data ): array {
		if ( ! self::is_available() ) {
			return $data;
		}

		foreach ( array(
			'label'         => 'label',
			'placeholder'   => 'placeholder',
			'help'          => 'help',
			'error_message' => 'error',
			'content'       => 'content',
		) as $key => $part ) {
			if ( isset( $data[ $key ] ) && is_string( $data[ $key ] ) && '' !== $data[ $key ] ) {
				$data[ $key ] = self::field( $field, $part, $data[ $key ] );
			}
		}

		// The paragraph body is the one string here that is rendered as markup
		// rather than as text, and a translation of it has not been through the
		// filter the original was saved through. It goes through it now, so a
		// translator can change the words and nothing else.
		if ( isset( $data['content'] ) && is_string( $data['content'] ) && '' !== $data['content'] ) {
			$data['content'] = FieldDefinition::sanitize_content( $data['content'] );
		}

		if ( self::has_text_default( $field ) && isset( $data['default_value'] ) && is_string( $data['default_value'] ) ) {
			$data['default_value'] = self::field( $field, 'default', $data['default_value'] );
		}

		if ( isset( $data['options'] ) && is_array( $data['options'] ) ) {
			$data['options'] = self::options( $field, $data['options'] );
		}

		return $data;
	}

	/**
	 * Translate the labels the merchant gave WooCommerce's own address fields,
	 * on the server-side table the Store API validates and reports against.
	 *
	 * Runs after `Fields\CoreFields` has written the stored labels in, so what
	 * is translated here is exactly what the merchant typed.
	 *
	 * @param mixed $fields Default address fields, keyed by field.
	 * @return mixed
	 */
	public function translate_core_labels( $fields ) {
		if ( ! is_array( $fields ) || ! self::is_available() ) {
			return $fields;
		}

		foreach ( $this->core_labels() as $key => $label ) {
			if ( ! isset( $fields[ $key ] ) || ! is_array( $fields[ $key ] ) ) {
				continue;
			}

			$fields[ $key ]['label'] = self::translate( $label, self::core_name( (string) $key ) );
		}

		return $fields;
	}

	/**
	 * Translate the same labels where they have been fanned out into the
	 * per-country locale entries the checkout form reads.
	 *
	 * Only entries that already carry the label are touched: an entry is
	 * WooCommerce saying something about a country, and adding a key to one
	 * would pin a value WooCommerce may later have an opinion about.
	 *
	 * @param mixed $locale Locale entries keyed by country code.
	 * @return mixed
	 */
	public function translate_locale_labels( $locale ) {
		if ( ! is_array( $locale ) || ! self::is_available() ) {
			return $locale;
		}

		$labels = $this->core_labels();
		if ( array() === $labels ) {
			return $locale;
		}

		foreach ( $locale as $country => $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}

			foreach ( $labels as $key => $label ) {
				if ( ! isset( $entry[ $key ]['label'] ) || $entry[ $key ]['label'] !== $label ) {
					continue;
				}

				$locale[ $country ][ $key ]['label'] = self::translate( $label, self::core_name( (string) $key ) );
			}
		}

		return $locale;
	}

	/**
	 * The labels the merchant gave WooCommerce's own fields, keyed by field.
	 *
	 * @return array<string, string>
	 */
	private function core_labels(): array {
		$core   = $this->config->core();
		$fields = isset( $core['fields'] ) && is_array( $core['fields'] ) ? $core['fields'] : array();
		$labels = array();

		foreach ( $fields as $key => $props ) {
			if ( is_array( $props ) && isset( $props['label'] ) && is_string( $props['label'] ) && '' !== $props['label'] ) {
				$labels[ (string) $key ] = $props['label'];
			}
		}

		return $labels;
	}

	/**
	 * Whether a field's default value is words rather than a machine value.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return bool
	 */
	private static function has_text_default( FieldDefinition $field ): bool {
		return in_array(
			$field->type(),
			array(
				FieldDefinition::TYPE_TEXT,
				FieldDefinition::TYPE_TEXTAREA,
			),
			true
		);
	}
}
