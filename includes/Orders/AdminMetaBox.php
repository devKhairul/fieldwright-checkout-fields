<?php
/**
 * The order screen's editor for the values we store ourselves.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Orders;

use CheckoutBuilder\Config;
use CheckoutBuilder\Fields\FieldDefinition;
use CheckoutBuilder\Fields\RichValues;
use CheckoutBuilder\Fields\TypeRegistry;
use WC_Order;

defined( 'ABSPATH' ) || exit;

/**
 * A meta box on the order screen for the fields WooCommerce does not know about.
 *
 * The core order screen only offers fields registered through the Additional
 * Checkout Fields API, so everything our own checkout block stores would
 * otherwise be invisible to the shop manager reading the order.
 */
final class AdminMetaBox {

	public const BOX_ID = 'cbwb-fields';
	public const NONCE  = 'cbwb_fields_nonce';
	public const ACTION = 'cbwb_save_order_fields';

	/**
	 * Name of the form input holding one scalar value.
	 */
	public const INPUT_NAME = 'cbwb_field';

	/**
	 * Name of the form input holding a checkbox group's chosen values.
	 */
	public const GROUP_INPUT_NAME = 'cbwb_field_group';

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
	 * Attach hooks.
	 */
	public function register(): void {
		add_action( 'add_meta_boxes', array( $this, 'add_meta_box' ) );
		add_action( 'woocommerce_process_shop_order_meta', array( $this, 'save' ) );
	}

	/**
	 * Register the box on whichever order screen this store uses.
	 */
	public function add_meta_box(): void {
		if ( array() === $this->fields() || ! function_exists( 'wc_get_page_screen_id' ) ) {
			return;
		}

		add_meta_box(
			self::BOX_ID,
			__( 'Fieldwright fields', 'fieldwright-checkout-fields' ),
			array( $this, 'render' ),
			wc_get_page_screen_id( 'shop-order' ),
			'normal',
			'default'
		);

		self::add_styles();
	}

	/**
	 * The fields this box is responsible for: the ones we store ourselves, that
	 * the merchant has not hidden from the admin.
	 *
	 * A field whose type nothing answers for is left out. It is still in the
	 * configuration and the merchant can still edit it, but nobody here knows
	 * what its answer looks like, so there is no control to draw for it and
	 * nothing that could be saved back.
	 *
	 * @return FieldDefinition[]
	 */
	public function fields(): array {
		return array_values(
			array_filter(
				$this->config->fields()->all(),
				static function ( FieldDefinition $field ): bool {
					return $field->is_rich() && $field->is_visible_in( 'admin' );
				}
			)
		);
	}

	/**
	 * The few rules the box needs, printed with the screen.
	 *
	 * WooCommerce's own order screens style `.form-field` inside their
	 * options panels only, so here a label would sit on the same line as a
	 * checkbox group or a date box. Inline rather than a stylesheet of its
	 * own: it is a dozen lines for one box on one screen.
	 */
	private static function add_styles(): void {
		$css = '.cbwb-order-fields .form-field { margin: 0 0 12px; }'
			. ' .cbwb-order-fields .form-field > label, .cbwb-order-fields .cbwb-order-field__label { display: block; margin: 0 0 4px; font-weight: 600; }'
			. ' .cbwb-order-fields .cbwb-checkbox-group { display: flex; flex-wrap: wrap; gap: 4px 16px; }'
			. ' .cbwb-order-fields .cbwb-checkbox-group label { display: inline-flex; align-items: center; gap: 4px; }';

		wp_register_style( self::BOX_ID, false, array(), CBWB_VERSION );
		wp_enqueue_style( self::BOX_ID );
		wp_add_inline_style( self::BOX_ID, $css );
	}

	/**
	 * Output the editor.
	 *
	 * @param mixed $post_or_order The order, or the post behind it.
	 */
	public function render( $post_or_order = null ): void {
		$order = self::resolve_order( $post_or_order );
		if ( null === $order ) {
			return;
		}

		wp_nonce_field( self::ACTION, self::NONCE );

		echo '<div class="cbwb-order-fields">';

		foreach ( $this->fields() as $field ) {
			$this->render_field( $field, RichValues::order_value( $order, $field ), $order );
		}

		echo '</div>';
	}

	/**
	 * Output one field's editor.
	 *
	 * @param FieldDefinition $field Field definition.
	 * @param string          $value Stored value.
	 * @param WC_Order        $order The order being read.
	 */
	private function render_field( FieldDefinition $field, string $value, WC_Order $order ): void {
		$key   = $field->storage_key();
		$name  = self::INPUT_NAME . '[' . $key . ']';
		$id    = 'cbwb-field-' . $key;
		$label = $field->label();
		$spec  = TypeRegistry::spec( $field->type() );

		echo '<p class="form-field">';

		// A type the screen only shows has no control for a label to name,
		// whether it is printed here or drawn by its add-on.
		if ( null !== $spec && ! self::edits( $spec ) ) {
			printf( '<span class="cbwb-order-field__label">%s</span>', esc_html( $label ) );
		} else {
			printf( '<label for="%1$s">%2$s</label>', esc_attr( $id ), esc_html( $label ) );
		}

		if ( null !== $spec ) {
			self::render_registered( $field, $value, $order, $spec );
			echo '</p>';
			return;
		}

		switch ( $field->type() ) {
			case FieldDefinition::TYPE_TEXTAREA:
				printf(
					'<textarea class="widefat" id="%1$s" name="%2$s" rows="%3$d" maxlength="%4$d">%5$s</textarea>',
					esc_attr( $id ),
					esc_attr( $name ),
					(int) $field->rows(),
					(int) $field->length_cap(),
					esc_textarea( $value )
				);
				break;

			case FieldDefinition::TYPE_RADIO:
				printf( '<select class="widefat" id="%1$s" name="%2$s">', esc_attr( $id ), esc_attr( $name ) );
				printf( '<option value="">%s</option>', esc_html__( 'None', 'fieldwright-checkout-fields' ) );
				foreach ( $field->options() as $option ) {
					printf(
						'<option value="%1$s"%2$s>%3$s</option>',
						esc_attr( $option['value'] ),
						selected( $option['value'], $value, false ),
						esc_html( $option['label'] )
					);
				}
				echo '</select>';
				break;

			case FieldDefinition::TYPE_CHECKBOX_GROUP:
				$chosen = RichValues::chosen_options( $field, $value );
				echo '<span class="cbwb-checkbox-group">';
				foreach ( $field->options() as $index => $option ) {
					printf(
						'<label for="%1$s"><input type="checkbox" id="%1$s" name="%2$s[]" value="%3$s"%4$s /> %5$s</label> ',
						esc_attr( $id . '-' . $index ),
						esc_attr( self::GROUP_INPUT_NAME . '[' . $key . ']' ),
						esc_attr( $option['value'] ),
						checked( in_array( $option['value'], $chosen, true ), true, false ),
						esc_html( $option['label'] )
					);
				}
				echo '</span>';
				break;

			case FieldDefinition::TYPE_DATE:
				printf(
					'<input type="date" id="%1$s" name="%2$s" value="%3$s"%4$s%5$s />',
					esc_attr( $id ),
					esc_attr( $name ),
					esc_attr( $value ),
					'' === $field->date_min() ? '' : ' min="' . esc_attr( $field->date_min() ) . '"',
					'' === $field->date_max() ? '' : ' max="' . esc_attr( $field->date_max() ) . '"'
				);
				break;

			case FieldDefinition::TYPE_TIME:
				// A field an add-on limited to a list of times — delivery slots,
				// named by the customer's choice — is a dropdown of them rather
				// than a clock: a clock could name a start no slot has, which no
				// count of bookings would see and no customer was ever offered.
				/** This filter is documented in includes/Fields/RichValues.php */
				$choices = apply_filters( 'cbwb_time_choices', array(), $field, $order ); // phpcs:ignore WooCommerce.Commenting.CommentHooks.MissingSinceComment -- Documented where the checkout applies it.

				$choices = self::time_choices( is_array( $choices ) ? $choices : array() );

				if ( array() === $choices ) {
					printf(
						'<input type="time" id="%1$s" name="%2$s" value="%3$s"%4$s%5$s />',
						esc_attr( $id ),
						esc_attr( $name ),
						esc_attr( $value ),
						'' === $field->time_min() ? '' : ' min="' . esc_attr( $field->time_min() ) . '"',
						'' === $field->time_max() ? '' : ' max="' . esc_attr( $field->time_max() ) . '"'
					);
					break;
				}

				// A stored start that is on no list any more, because the
				// merchant has since removed the slot, stays on the order until
				// staff choose otherwise: it is offered as the time it is, and
				// saving the screen with nothing changed keeps it.
				if ( '' !== $value && ! isset( $choices[ $value ] ) ) {
					$choices[ $value ] = RichValues::written_time( $value );
				}

				printf( '<select class="widefat" id="%1$s" name="%2$s">', esc_attr( $id ), esc_attr( $name ) );
				printf( '<option value="">%s</option>', esc_html__( 'None', 'fieldwright-checkout-fields' ) );
				foreach ( $choices as $start => $choice_label ) {
					printf(
						'<option value="%1$s"%2$s>%3$s</option>',
						esc_attr( $start ),
						selected( $start, $value, false ),
						esc_html( $choice_label )
					);
				}
				echo '</select>';
				break;

			default:
				printf(
					'<input type="text" class="widefat" id="%1$s" name="%2$s" value="%3$s" maxlength="%4$d" />',
					esc_attr( $id ),
					esc_attr( $name ),
					esc_attr( $value ),
					(int) $field->length_cap()
				);
		}//end switch

		echo '</p>';
	}

	/**
	 * Whether the order screen takes a value back for a registered type.
	 *
	 * Only a type that draws its own control and says so. Drawing alone is not
	 * enough: a callable that prints a name and a link has nothing to post, and
	 * a request that posts under its name anyway is somebody else's form.
	 *
	 * @param array<string, mixed> $spec The registered type's spec.
	 * @return bool
	 */
	private static function edits( array $spec ): bool {
		return TypeRegistry::EDITOR_READONLY !== $spec['order_editor'] && true === $spec['editable'];
	}

	/**
	 * Output the editor for a type an add-on registered.
	 *
	 * A type that asked for nothing is printed: whatever its own `display`
	 * callback makes of the stored value, as text. One that named a callable
	 * draws its own markup; if it also said it is editable, a control under the
	 * same input name the built-in types use posts back through the type's own
	 * sanitizing (see `edits()`), and otherwise whatever it drew is for reading.
	 *
	 * @param FieldDefinition      $field Field definition.
	 * @param string               $value Stored value.
	 * @param WC_Order             $order The order being read.
	 * @param array<string, mixed> $spec  The registered type's spec.
	 */
	private static function render_registered( FieldDefinition $field, string $value, WC_Order $order, array $spec ): void {
		if ( TypeRegistry::EDITOR_READONLY !== $spec['order_editor'] ) {
			call_user_func( $spec['order_editor'], $field, $value, $order );
			return;
		}

		$display = RichValues::display_value( $field, $value );

		printf(
			'<span class="cbwb-order-field__value">%s</span>',
			esc_html( '' === $display ? __( 'None', 'fieldwright-checkout-fields' ) : $display )
		);
	}

	/**
	 * Store whatever the shop manager typed.
	 *
	 * @param mixed $order_id Order id.
	 */
	public function save( $order_id ): void {
		if ( ! is_numeric( $order_id ) || ! current_user_can( 'edit_shop_orders' ) ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- Verified on the next line.
		$nonce = isset( $_POST[ self::NONCE ] ) ? sanitize_text_field( wp_unslash( $_POST[ self::NONCE ] ) ) : '';
		if ( '' === $nonce || ! wp_verify_nonce( $nonce, self::ACTION ) ) {
			return;
		}

		$fields = $this->fields();
		if ( array() === $fields ) {
			return;
		}

		$order = wc_get_order( (int) $order_id );
		if ( ! $order instanceof WC_Order ) {
			return;
		}

		// Every value read here goes through RichValues::sanitize() below, which
		// knows what each field type accepts; sanitizing to text up front would
		// flatten a textarea's line breaks before it got the chance.
		// phpcs:disable WordPress.Security.NonceVerification.Missing, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Nonce verified above; values sanitized per field type below.
		$scalars = isset( $_POST[ self::INPUT_NAME ] ) && is_array( $_POST[ self::INPUT_NAME ] ) ? wp_unslash( $_POST[ self::INPUT_NAME ] ) : array();
		$groups  = isset( $_POST[ self::GROUP_INPUT_NAME ] ) && is_array( $_POST[ self::GROUP_INPUT_NAME ] ) ? wp_unslash( $_POST[ self::GROUP_INPUT_NAME ] ) : array();
		// phpcs:enable WordPress.Security.NonceVerification.Missing, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized

		foreach ( $fields as $field ) {
			$key = $field->storage_key();

			// A type the screen only shows was not edited, so nothing posted
			// under its name can change the stored value: whatever put the
			// answer there is the only thing that may replace it. That holds
			// whether the add-on drew the value or this screen printed it.
			$spec = TypeRegistry::spec( $field->type() );
			if ( null !== $spec && ! self::edits( $spec ) ) {
				continue;
			}

			if ( FieldDefinition::TYPE_CHECKBOX_GROUP === $field->type() ) {
				$chosen = isset( $groups[ $key ] ) && is_array( $groups[ $key ] ) ? $groups[ $key ] : array();
				$raw    = implode( ',', array_map( 'strval', array_filter( $chosen, 'is_scalar' ) ) );
			} elseif ( array_key_exists( $key, $scalars ) ) {
				$raw = is_scalar( $scalars[ $key ] ) ? (string) $scalars[ $key ] : '';
			} else {
				// The field was not on the form at all: leave the stored value be.
				continue;
			}

			RichValues::set_order_value( $order, $field, RichValues::sanitize( $field, $raw ) );
		}//end foreach

		$order->save();
	}

	/**
	 * The times an add-on offered, keyed by start, with anything that is not a
	 * time and a label thrown out.
	 *
	 * @param array<mixed> $choices What the filter returned.
	 * @return array<string, string> Label by `HH:MM` start, in the order offered.
	 */
	private static function time_choices( array $choices ): array {
		$clean = array();

		foreach ( $choices as $choice ) {
			if ( ! is_array( $choice ) || ! isset( $choice['value'], $choice['label'] ) ) {
				continue;
			}
			if ( ! is_string( $choice['value'] ) || ! FieldDefinition::is_time( $choice['value'] ) || ! is_string( $choice['label'] ) ) {
				continue;
			}

			$clean[ $choice['value'] ] = $choice['label'];
		}

		return $clean;
	}

	/**
	 * Resolve whatever WordPress or WooCommerce handed the meta box into an order.
	 *
	 * @param mixed $post_or_order The order, or the post behind it.
	 * @return WC_Order|null
	 */
	private static function resolve_order( $post_or_order ): ?WC_Order {
		if ( $post_or_order instanceof WC_Order ) {
			return $post_or_order;
		}

		$id = 0;
		if ( is_object( $post_or_order ) && isset( $post_or_order->ID ) ) {
			$id = (int) $post_or_order->ID;
		} elseif ( is_numeric( $post_or_order ) ) {
			$id = (int) $post_or_order;
		}

		if ( $id <= 0 ) {
			return null;
		}

		$order = wc_get_order( $id );

		return $order instanceof WC_Order ? $order : null;
	}
}
