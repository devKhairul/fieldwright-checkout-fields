<?php
/**
 * Storage, sanitizing and validation for the field types WooCommerce has no
 * equivalent of.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Fields;

use CheckoutBuilder\I18n\Strings;
use DateTimeZone;
use WC_Order;

defined( 'ABSPATH' ) || exit;

/**
 * One place that knows what a rich value looks like.
 *
 * WooCommerce's Additional Checkout Fields API owns the whole lifecycle of a
 * core-backed field — schema, sanitizing, order meta, customer meta, display.
 * The types it does not support get all of that here instead, and it has to
 * agree with itself across three callers: the Store API checkout, the admin
 * order screen, and every display surface.
 *
 * Values are always scalar strings, so the same code can write them to order
 * meta, user meta and an `<input>` without special cases. A checkbox group is
 * a comma-separated list of option values; a date is `Y-m-d`; a time is `H:i`.
 */
final class RichValues {

	/**
	 * Prefix of the order and customer meta keys we own.
	 */
	public const META_PREFIX = '_cbwb/';

	/**
	 * The meta key one field's value is stored under.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return string
	 */
	public static function meta_key( FieldDefinition $field ): string {
		return self::META_PREFIX . $field->storage_key();
	}

	/**
	 * Coerce a submitted value into the stored form.
	 *
	 * Never reports a problem: anything unusable becomes the empty string, and
	 * telling the customer about it is validate()'s job.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param mixed           $value Submitted value.
	 * @return string
	 */
	public static function sanitize( FieldDefinition $field, $value ): string {
		if ( $field->is_content() ) {
			return '';
		}

		if ( is_bool( $value ) ) {
			$value = $value ? 'yes' : '';
		}

		$raw = is_scalar( $value ) ? trim( (string) $value ) : '';

		// A type an add-on registered is coerced by the add-on: only it knows
		// what a stored value of its own looks like.
		$spec = TypeRegistry::spec( $field->type() );
		if ( null !== $spec ) {
			$clean = call_user_func( $spec['sanitize'], $field, $raw );
			return is_string( $clean ) ? $clean : '';
		}

		switch ( $field->type() ) {
			case FieldDefinition::TYPE_TEXTAREA:
				$clean = sanitize_textarea_field( $raw );
				$cap   = $field->length_cap();
				return mb_strlen( $clean ) > $cap ? mb_substr( $clean, 0, $cap ) : $clean;

			case FieldDefinition::TYPE_RADIO:
				$clean = sanitize_text_field( $raw );
				return in_array( $clean, $field->option_values(), true ) ? $clean : '';

			case FieldDefinition::TYPE_CHECKBOX_GROUP:
				return implode( ',', self::chosen_options( $field, $raw ) );

			case FieldDefinition::TYPE_DATE:
				return FieldDefinition::is_date( $raw ) ? $raw : '';

			case FieldDefinition::TYPE_TIME:
				return FieldDefinition::is_time( $raw ) ? $raw : '';
		}//end switch

		return sanitize_text_field( $raw );
	}

	/**
	 * The option values a checkbox group's submitted list actually names, in the
	 * order the merchant listed them rather than the order they arrived in.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param string          $raw   Comma-separated submitted list.
	 * @return string[]
	 */
	public static function chosen_options( FieldDefinition $field, string $raw ): array {
		$submitted = array_map( 'trim', explode( ',', $raw ) );

		return array_values(
			array_filter(
				$field->option_values(),
				static function ( string $option ) use ( $submitted ): bool {
					return in_array( $option, $submitted, true );
				}
			)
		);
	}

	/**
	 * Check a submitted value, returning the message the customer should read.
	 *
	 * The raw value is checked rather than the sanitized one: a radio value that
	 * is not on the list has to be reported, not silently blanked, or the
	 * customer sees their choice disappear with no explanation.
	 *
	 * Every message here is read by the customer, so the merchant's own words in
	 * it — the label, and the error message they wrote — come back in the
	 * language of the request. See `label()` and `required_message()`.
	 *
	 * @param FieldDefinition $field    Field definition.
	 * @param mixed           $value    Submitted value.
	 * @param bool|null       $required Whether the value has to be filled in, or
	 *                                  null to use the field's own setting. An
	 *                                  add-on may relax it for a field its
	 *                                  conditions have taken off the screen.
	 * @return string|null Null when the value is acceptable.
	 */
	public static function validate( FieldDefinition $field, $value, ?bool $required = null ): ?string {
		if ( $field->is_content() ) {
			return null;
		}

		if ( null === $required ) {
			$required = $field->is_required();
		}

		if ( is_bool( $value ) ) {
			$value = $value ? 'yes' : '';
		}

		if ( ! is_scalar( $value ) && null !== $value ) {
			return $required ? self::required_message( $field ) : null;
		}

		$raw = null === $value ? '' : trim( (string) $value );

		if ( '' === $raw ) {
			return $required ? self::required_message( $field ) : null;
		}

		// Emptiness is settled above, so a registered type is only ever asked
		// whether the answer in front of it is well formed.
		$spec = TypeRegistry::spec( $field->type() );
		if ( null !== $spec ) {
			$message = call_user_func( $spec['validate'], $field, $raw );
			return is_string( $message ) && '' !== $message ? $message : null;
		}

		switch ( $field->type() ) {
			case FieldDefinition::TYPE_TEXTAREA:
				if ( mb_strlen( $raw ) > $field->length_cap() ) {
					return self::too_long_message( $field );
				}
				return null;

			case FieldDefinition::TYPE_RADIO:
				return in_array( $raw, $field->option_values(), true ) ? null : self::option_message( $field );

			case FieldDefinition::TYPE_CHECKBOX_GROUP:
				foreach ( array_filter( array_map( 'trim', explode( ',', $raw ) ) ) as $one ) {
					if ( ! in_array( $one, $field->option_values(), true ) ) {
						return self::option_message( $field );
					}
				}
				return null;

			case FieldDefinition::TYPE_DATE:
				if ( ! FieldDefinition::is_date( $raw ) ) {
					return sprintf(
						/* translators: %s: field label. */
						__( 'Enter a date for %s in YYYY-MM-DD form.', 'fieldwright-checkout-fields' ),
						self::label( $field )
					);
				}
				return self::range_message( $field, $raw, $field->date_min(), $field->date_max() );

			case FieldDefinition::TYPE_TIME:
				if ( ! FieldDefinition::is_time( $raw ) ) {
					return sprintf(
						/* translators: %s: field label. */
						__( 'Enter a time for %s in HH:MM form.', 'fieldwright-checkout-fields' ),
						self::label( $field )
					);
				}

				// A field an add-on limited to a list of times takes one of those
				// and nothing else: the list replaces the earliest and latest
				// time, as the checkout and the builder both say it does.
				$choices = self::time_choices( $field );
				if ( array() !== $choices ) {
					return in_array( $raw, $choices, true ) ? null : self::option_message( $field );
				}

				return self::range_message( $field, $raw, $field->time_min(), $field->time_max() );
		}//end switch

		if ( mb_strlen( $raw ) > $field->length_cap() ) {
			return self::too_long_message( $field );
		}

		return null;
	}

	/**
	 * Wording for an answer longer than the field accepts.
	 *
	 * Read by the length check every type falls back to, and by the one the
	 * registry applies to a registered type that asked for no checks of its
	 * own, so the two say the same thing.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return string
	 */
	public static function too_long_message( FieldDefinition $field ): string {
		return sprintf(
			/* translators: 1: field label, 2: maximum number of characters. */
			__( '%1$s cannot be longer than %2$d characters.', 'fieldwright-checkout-fields' ),
			self::label( $field ),
			$field->length_cap()
		);
	}

	/**
	 * One field's label in the language of the request.
	 *
	 * The merchant typed it into the builder, so it is an option rather than a
	 * gettext string and only `I18n\Strings` can put it into another language.
	 * Everything the customer reads goes through here; the builder reads the
	 * stored label instead.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return string
	 */
	public static function label( FieldDefinition $field ): string {
		return Strings::field( $field, 'label', $field->label() );
	}

	/**
	 * The label of one option, in the customer's language.
	 *
	 * The same rule as the field's label: the merchant typed it, so only
	 * `I18n\Strings` can translate it, and a value on no option reads as the
	 * value itself, the way the definition answers.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param string          $value The stored option value.
	 * @return string
	 */
	public static function option_label( FieldDefinition $field, string $value ): string {
		foreach ( Strings::options( $field, $field->options() ) as $option ) {
			if ( $option['value'] === $value ) {
				return (string) $option['label'];
			}
		}

		return $value;
	}

	/**
	 * Wording for a value the field was left without.
	 *
	 * The merchant's own message wins, exactly as it does on the definition, and
	 * both halves are translated: the message is a merchant-entered string of its
	 * own, and the fallback is built from the label.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return string
	 */
	public static function required_message( FieldDefinition $field ): string {
		if ( '' !== $field->error_message() ) {
			return Strings::field( $field, 'error', $field->error_message() );
		}

		return sprintf(
			/* translators: %s: field label. */
			__( 'Please fill in %s.', 'fieldwright-checkout-fields' ),
			self::label( $field )
		);
	}

	/**
	 * Wording for a value that is not on the field's option list.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return string
	 */
	private static function option_message( FieldDefinition $field ): string {
		return sprintf(
			/* translators: %s: field label. */
			__( 'Choose one of the available options for %s.', 'fieldwright-checkout-fields' ),
			self::label( $field )
		);
	}

	/**
	 * The times an add-on limited a time field to, in `HH:MM`, or an empty
	 * array for a field that takes any time between its bounds.
	 *
	 * @param FieldDefinition $field   Field definition.
	 * @param WC_Order|null   $order   The order being read, where there is one.
	 * @return string[]
	 */
	public static function time_choices( FieldDefinition $field, ?WC_Order $order = null ): array {
		/**
		 * Filters the times a time field may be set to.
		 *
		 * A field an add-on turned into a list of delivery slots holds a slot's
		 * start, not any minute of the day. The add-on that owns the list
		 * answers here with the choices, each a `value` in `HH:MM` and a
		 * `label` the way the customer read it, and the list then stands in
		 * for the field's earliest and latest time: the checkout refuses a
		 * time that is not on it, and the order screen draws a dropdown of
		 * the choices rather than a clock. Nothing answered, the default, is
		 * a field that takes any time between its bounds.
		 *
		 * @since 1.0.0
		 *
		 * @param array<int, array{value: string, label: string}> $choices The times on offer, or an empty array.
		 * @param FieldDefinition                                  $field   The field the value belongs to.
		 * @param WC_Order|null                                    $order   The order being read, or null at checkout, where there is none yet.
		 */
		$choices = apply_filters( 'cbwb_time_choices', array(), $field, $order );
		if ( ! is_array( $choices ) ) {
			return array();
		}

		$times = array();
		foreach ( $choices as $choice ) {
			if ( is_array( $choice ) && isset( $choice['value'] ) && is_string( $choice['value'] ) && FieldDefinition::is_time( $choice['value'] ) ) {
				$times[] = $choice['value'];
			}
		}

		return $times;
	}

	/**
	 * Check a date or time against its bounds. Both are stored in a form that
	 * sorts the same way it reads, so a string comparison is the right one.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param string          $value Submitted value.
	 * @param string          $min   Lower bound, or the empty string.
	 * @param string          $max   Upper bound, or the empty string.
	 * @return string|null
	 */
	private static function range_message( FieldDefinition $field, string $value, string $min, string $max ): ?string {
		if ( '' !== $min && $value < $min ) {
			return sprintf(
				/* translators: 1: field label, 2: earliest accepted value. */
				__( '%1$s cannot be earlier than %2$s.', 'fieldwright-checkout-fields' ),
				self::label( $field ),
				$min
			);
		}

		if ( '' !== $max && $value > $max ) {
			return sprintf(
				/* translators: 1: field label, 2: latest accepted value. */
				__( '%1$s cannot be later than %2$s.', 'fieldwright-checkout-fields' ),
				self::label( $field ),
				$max
			);
		}

		return null;
	}

	/**
	 * The stored value on one order.
	 *
	 * @param WC_Order        $order Order.
	 * @param FieldDefinition $field Field definition.
	 * @return string
	 */
	public static function order_value( WC_Order $order, FieldDefinition $field ): string {
		$value = $order->get_meta( self::meta_key( $field ), true );
		return is_scalar( $value ) ? (string) $value : '';
	}

	/**
	 * Write (or clear) the stored value on one order. The order is not saved:
	 * every caller is already inside a save of its own.
	 *
	 * @param WC_Order        $order Order.
	 * @param FieldDefinition $field Field definition.
	 * @param string          $value Value to store.
	 */
	public static function set_order_value( WC_Order $order, FieldDefinition $field, string $value ): void {
		if ( '' === $value ) {
			$order->delete_meta_data( self::meta_key( $field ) );
			return;
		}
		$order->update_meta_data( self::meta_key( $field ), $value );
	}

	/**
	 * Remove the stored value from one order. The order is not saved: every
	 * caller is already inside a save of its own.
	 *
	 * @param WC_Order        $order Order.
	 * @param FieldDefinition $field Field definition.
	 */
	public static function delete_order_value( WC_Order $order, FieldDefinition $field ): void {
		$order->delete_meta_data( self::meta_key( $field ) );
	}

	/**
	 * The meta key one field's value is stored under, on an order and against a
	 * customer alike.
	 *
	 * Exposed for the privacy exporter and eraser, which have to name the keys
	 * without holding a field definition for each.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @return string
	 */
	public static function storage_meta_key( FieldDefinition $field ): string {
		return self::meta_key( $field );
	}

	/**
	 * The value remembered against a customer, for prefilling.
	 *
	 * @param int             $user_id Customer user id.
	 * @param FieldDefinition $field   Field definition.
	 * @return string
	 */
	public static function customer_value( int $user_id, FieldDefinition $field ): string {
		if ( $user_id <= 0 ) {
			return '';
		}
		$value = get_user_meta( $user_id, self::meta_key( $field ), true );
		return is_scalar( $value ) ? (string) $value : '';
	}

	/**
	 * Remember a value against a customer.
	 *
	 * @param int             $user_id Customer user id.
	 * @param FieldDefinition $field   Field definition.
	 * @param string          $value   Value to store.
	 */
	public static function set_customer_value( int $user_id, FieldDefinition $field, string $value ): void {
		if ( $user_id <= 0 ) {
			return;
		}
		if ( '' === $value ) {
			delete_user_meta( $user_id, self::meta_key( $field ) );
			return;
		}
		update_user_meta( $user_id, self::meta_key( $field ), $value );
	}

	/**
	 * A stored date, written the way the site writes dates.
	 *
	 * The value is a calendar day with no time and no zone, so it is read as
	 * midnight UTC and formatted in UTC: any other pair could shift it a day.
	 * A value that is not a date is handed back as it is.
	 *
	 * @param string $value Stored `Y-m-d`.
	 * @return string
	 */
	public static function written_date( string $value ): string {
		if ( ! FieldDefinition::is_date( $value ) ) {
			return $value;
		}

		$timestamp = strtotime( $value . ' 00:00:00 UTC' );

		return false === $timestamp
			? $value
			: (string) wp_date( (string) get_option( 'date_format', 'F j, Y' ), $timestamp, new DateTimeZone( 'UTC' ) );
	}

	/**
	 * A stored time, written the way the site writes times.
	 *
	 * @param string $value Stored `HH:MM`.
	 * @return string
	 */
	public static function written_time( string $value ): string {
		if ( ! FieldDefinition::is_time( $value ) ) {
			return $value;
		}

		$timestamp = strtotime( '1970-01-01 ' . $value . ' UTC' );

		return false === $timestamp
			? $value
			: (string) wp_date( (string) get_option( 'time_format', 'g:i a' ), $timestamp, new DateTimeZone( 'UTC' ) );
	}

	/**
	 * The stored value written out for a human: option labels instead of option
	 * values, a checkbox group as a readable list, a date or a time the way the
	 * site writes one, and whatever a registered type's own `display` callback
	 * makes of its value.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param string          $value Stored value.
	 * @return string
	 */
	public static function display_value( FieldDefinition $field, string $value ): string {
		if ( '' === $value ) {
			return '';
		}

		$display = $value;
		$spec    = TypeRegistry::spec( $field->type() );

		if ( null !== $spec ) {
			// Asked of the add-on whether or not the type reaches the checkout
			// today: an answer already on an order is still shown to whoever
			// reads that order, and the stored value on its own may say nothing
			// to a human.
			$rendered = call_user_func( $spec['display'], $field, $value );

			$display = is_string( $rendered ) ? $rendered : '';
		} elseif ( FieldDefinition::TYPE_CHECKBOX_GROUP === $field->type() ) {
			$labels = array_map(
				static function ( string $one ) use ( $field ): string {
					return self::option_label( $field, $one );
				},
				self::chosen_options( $field, $value )
			);

			$display = implode( ', ', $labels );
		} elseif ( FieldDefinition::TYPE_RADIO === $field->type() ) {
			$display = self::option_label( $field, $value );
		} elseif ( FieldDefinition::TYPE_DATE === $field->type() ) {
			$display = self::written_date( $value );
		} elseif ( FieldDefinition::TYPE_TIME === $field->type() ) {
			$display = self::written_time( $value );
		}//end if

		/**
		 * Filters what one stored value reads as, whatever type it belongs to.
		 *
		 * This is the one place every display surface goes through — the order
		 * screen, the emails, the thank-you page, the orders list, the export
		 * and the privacy report — so an add-on that knows more about a value
		 * than the field definition does says it once here. A delivery slot is
		 * stored as its start time, and the add-on that owns the slots is what
		 * turns 09:00 back into "Morning (9:00 am to 12:00 pm)".
		 *
		 * The stored value is passed alongside, because the display has already
		 * been through the type's own rendering by this point and is not always
		 * the string that was stored.
		 *
		 * @since 1.0.0
		 *
		 * @param string          $display What the value reads as so far.
		 * @param string          $value   The stored value.
		 * @param FieldDefinition $field   The field the value belongs to.
		 */
		$filtered = apply_filters( 'cbwb_rich_display_value', $display, $value, $field );

		return is_string( $filtered ) ? $filtered : $display;
	}
}
