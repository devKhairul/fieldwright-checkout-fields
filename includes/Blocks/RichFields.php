<?php
/**
 * The checkout block that renders the field types WooCommerce has no
 * equivalent of, and the placement of its wrappers.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Blocks;

use CheckoutBuilder\Config;
use CheckoutBuilder\Fields\CoreFields;
use CheckoutBuilder\Fields\FieldDefinition;
use WP_Block_Type_Registry;

defined( 'ABSPATH' ) || exit;

/**
 * Registers `cbwb/field` and splices one wrapper into the rendered checkout for
 * every enabled rich or content field.
 *
 * The block checkout renders whatever `data-block-name` wrappers it finds in
 * the page markup, in DOM order, handing each to the component registered under
 * that name. Registering an inner block with `force: true` on the JS side would
 * only ever append it after a parent's saved children; putting the wrapper in
 * the HTML ourselves is what lets a field sit before the order notes, after the
 * shipping methods, or in the order summary — without the merchant having to
 * edit the checkout page.
 *
 * A placement whose anchor is missing (a merchant who deleted the order-note
 * block, a heavily customised page) falls back to the end of the checkout form
 * rather than dropping the field, and leaves a flag behind for the builder to
 * warn about. Renders that are not the checkout form at all — the order-pay and
 * order-received endpoints, where the block hands back the classic shortcode —
 * are passed straight through instead, because a missing anchor there says
 * nothing about the merchant's checkout page.
 */
final class RichFields {

	/**
	 * The block name the checkout bundle registers a component for.
	 */
	public const BLOCK_NAME = 'cbwb/field';

	/**
	 * The block whose rendered subtree carries the whole checkout.
	 */
	public const CHECKOUT_BLOCK = 'woocommerce/checkout';

	/**
	 * Where a field goes when its placement's anchor is missing.
	 */
	public const FALLBACK_BLOCK = 'woocommerce/checkout-fields-block';

	/**
	 * The block the "what the asterisk means" line is written above.
	 *
	 * The contact step is the first thing in the form that asks the shopper for
	 * anything, so a line explaining the asterisk belongs directly before it.
	 * Above the whole fields block would put it over the express-payment
	 * buttons, where it explains nothing yet.
	 */
	public const NOTE_ANCHOR = 'woocommerce/checkout-contact-information-block';

	/**
	 * Class on the line that explains the asterisk.
	 */
	public const NOTE_CLASS = 'cbwb-required-note';

	/**
	 * Prefix of the transient recording "this placement had nowhere to go".
	 */
	public const WARNING_TRANSIENT_PREFIX = 'cbwb_placement_error_';

	/**
	 * How long a recorded placement miss keeps warning the merchant.
	 */
	public const WARNING_TRANSIENT_TTL = HOUR_IN_SECONDS;

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
		add_action( 'init', array( $this, 'register_block' ) );
		add_filter( 'render_block', array( $this, 'inject' ), 10, 2 );
	}

	/**
	 * Register the block type so WordPress knows the name is ours.
	 */
	public function register_block(): void {
		if ( WP_Block_Type_Registry::get_instance()->is_registered( self::BLOCK_NAME ) ) {
			return;
		}

		register_block_type(
			self::BLOCK_NAME,
			array(
				'title'           => __( 'Fieldwright field', 'fieldwright-checkout-fields' ),
				'category'        => 'woocommerce',
				'parent'          => array( self::CHECKOUT_BLOCK ),
				'supports'        => array(
					'inserter' => false,
					'html'     => false,
				),
				'attributes'      => array(
					'field' => array(
						'type'    => 'string',
						'default' => '',
					),
				),
				'render_callback' => array( $this, 'render' ),
			)
		);
	}

	/**
	 * Render one wrapper. The checkout bundle fills it in; there is nothing to
	 * output on the server, because the value lives in the checkout's own store.
	 *
	 * @param array<string, mixed> $attributes Block attributes.
	 * @return string
	 */
	public function render( array $attributes = array() ): string {
		$field = isset( $attributes['field'] ) && is_string( $attributes['field'] ) ? $attributes['field'] : '';
		return self::wrapper( $field );
	}

	/**
	 * The markup one field is rendered from.
	 *
	 * Two attributes, both `data-`, both machine values: the block name the
	 * checkout looks the component up by, and the field id the component reads
	 * its definition with. TranslatePress translates text nodes and a short list
	 * of attributes (`placeholder`, `title`, `alt`), never `data-` ones, so
	 * neither is at risk and neither is marked `data-no-translation` — which on
	 * this element would exclude the whole field, labels included, from the very
	 * translation the merchant installed TranslatePress for.
	 *
	 * @param string $field_id Field id.
	 * @return string
	 */
	public static function wrapper( string $field_id ): string {
		return sprintf(
			'<div data-block-name="%1$s" data-cbwb-field="%2$s"></div>',
			esc_attr( self::BLOCK_NAME ),
			esc_attr( $field_id )
		);
	}

	/**
	 * Splice every enabled rich and content field into the rendered checkout.
	 *
	 * @param mixed $block_content Rendered block HTML.
	 * @param mixed $block         Parsed block.
	 * @return mixed
	 */
	public function inject( $block_content, $block ) {
		if ( ! is_string( $block_content ) || ! is_array( $block ) ) {
			return $block_content;
		}

		$name = isset( $block['blockName'] ) && is_string( $block['blockName'] ) ? $block['blockName'] : '';
		if ( self::CHECKOUT_BLOCK !== $name ) {
			return $block_content;
		}

		// Before placement, so an order field whose anchor was the order-note
		// box falls back to the next block in its plan rather than being spliced
		// against a wrapper that is about to be taken out.
		$html = $this->place( $this->strip_pseudo_fields( $block_content ), $this->grouped_fields() );

		return $this->add_required_note( $html );
	}

	/**
	 * Write the line that explains the asterisk above the first thing the form
	 * asks for.
	 *
	 * A plain paragraph rather than a block of ours. The checkout's renderer
	 * walks the server's markup and mounts a component for every wrapper whose
	 * `data-block-name` it recognises; anything else it re-parses from its own
	 * `outerHTML` and renders as it stands (`renderInnerBlocks` in
	 * `wc-cart-checkout-base-frontend.js`). So a `<p>` survives the render, and
	 * a sentence that says one thing does not need a component to say it.
	 *
	 * @param string $html Rendered checkout HTML.
	 * @return string
	 */
	public function add_required_note( string $html ): string {
		if ( ! $this->config->marks_required() || ! $this->config->required_note() ) {
			return $html;
		}

		// The same guard placement uses: a render that is not the checkout form
		// has no form for this to be at the top of.
		if ( ! HtmlInjector::has_block( $html, self::FALLBACK_BLOCK ) ) {
			return $html;
		}

		$markup = sprintf(
			'<p class="%1$s">%2$s</p>',
			esc_attr( self::NOTE_CLASS ),
			esc_html__( 'Fields marked with an asterisk are required.', 'fieldwright-checkout-fields' )
		);

		$placed = HtmlInjector::insert_before( $html, self::NOTE_ANCHOR, $markup );

		if ( null === $placed ) {
			// A checkout page the merchant has taken the contact step off still
			// has fields on it, so the line still has something to explain: it
			// goes to the top of the form instead of being dropped.
			$placed = HtmlInjector::prepend_inside( $html, self::FALLBACK_BLOCK, $markup );
		}

		return null === $placed ? $html : $placed;
	}

	/**
	 * Take out the order-note box and the checkout coupon form when the merchant
	 * has switched them off.
	 *
	 * Both are ordinary inner blocks the merchant could also delete in the
	 * editor, so removing their wrappers here is the same result reached without
	 * asking them to edit the page — and it covers the older checkout templates,
	 * where WooCommerce injects those two wrappers as strings of its own during
	 * the render and no inner-block filter ever sees them.
	 *
	 * The cart's coupon form is left alone, and so is
	 * `woocommerce_coupons_enabled`: a coupon the shopper already has a link for
	 * still applies, which is not true of switching coupons off entirely.
	 *
	 * @param string $html Rendered checkout HTML.
	 * @return string
	 */
	public function strip_pseudo_fields( string $html ): string {
		// The same guard placement uses: a render that is not the checkout form
		// (the order-pay endpoint, an editor preview) has nothing to strip and
		// nothing to say about the merchant's page.
		if ( ! HtmlInjector::has_block( $html, self::FALLBACK_BLOCK ) ) {
			return $html;
		}

		$core = new CoreFields( $this->config );

		foreach ( CoreFields::PSEUDO_BLOCKS as $pseudo => $block_name ) {
			if ( ! $core->pseudo_is_hidden( (string) $pseudo ) ) {
				continue;
			}

			$stripped = HtmlInjector::remove_block( $html, (string) $block_name );
			if ( null !== $stripped ) {
				$html = $stripped;
			}
		}

		return $html;
	}

	/**
	 * Enabled rich and content fields, grouped by placement and kept in the
	 * order the merchant arranged them.
	 *
	 * A field whose type nothing answers for is left out, so no wrapper is
	 * spliced into the page for a field the checkout bundle would then have
	 * nothing to draw.
	 *
	 * @return array<string, array<int, FieldDefinition>>
	 */
	public function grouped_fields(): array {
		$grouped = array();

		foreach ( $this->config->fields()->enabled() as $field ) {
			if ( $field->is_core_backed() || ! $field->is_available() ) {
				continue;
			}
			$grouped[ $field->location() ][] = $field;
		}

		return $grouped;
	}

	/**
	 * Insert each placement's wrappers into the rendered checkout.
	 *
	 * @param string                                     $html    Rendered checkout HTML.
	 * @param array<string, array<int, FieldDefinition>> $grouped Fields keyed by placement.
	 * @return string
	 */
	public function place( string $html, array $grouped ): string {
		if ( array() === $grouped ) {
			return $html;
		}

		// The checkout block renders in places that are not the checkout form.
		// On the order-pay and order-received endpoints it hands back nothing
		// but `[woocommerce_checkout]`; an editor or REST preview, or a theme
		// that never got the inner blocks, can be just as bare. None of those
		// is a merchant mistake, and injecting into them would put a field on a
		// page nobody can fill in — so leave the markup exactly as it came and
		// record nothing. The fields block is the test because it is the
		// wrapper every checkout form has and the one the fallback aims at.
		if ( ! HtmlInjector::has_block( $html, self::FALLBACK_BLOCK ) ) {
			return $html;
		}

		// A fixed order, so two placements that end up sharing an anchor always
		// come out the same way round.
		foreach ( FieldDefinition::locations() as $location ) {
			if ( empty( $grouped[ $location ] ) ) {
				continue;
			}

			$markup = '';
			foreach ( $grouped[ $location ] as $field ) {
				$markup .= self::wrapper( $field->id() );
			}

			$html = $this->place_one( $html, $location, $markup );
		}

		return $html;
	}

	/**
	 * Insert one placement's markup, falling back rather than dropping it.
	 *
	 * @param string $html     Rendered checkout HTML.
	 * @param string $location Placement key.
	 * @param string $markup   Markup to insert.
	 * @return string
	 */
	private function place_one( string $html, string $location, string $markup ): string {
		$plan     = self::plan( $location );
		$injected = false;

		foreach ( $plan['steps'] as $step ) {
			list( $operation, $block_name ) = $step;

			$result = 'before' === $operation
				? HtmlInjector::insert_before( $html, $block_name, $markup )
				: HtmlInjector::append_inside( $html, $block_name, $markup );

			if ( null === $result ) {
				continue;
			}

			$html     = $result;
			$injected = true;

			if ( 'first' === $plan['mode'] ) {
				break;
			}
		}

		if ( $injected ) {
			// The anchor is back — a merchant who put the order summary block
			// on the page again should not keep reading about it for the rest
			// of the hour the flag would otherwise live.
			self::clear_miss( $location );

			return $html;
		}

		self::record_miss( $location );

		$fallback = HtmlInjector::append_inside( $html, self::FALLBACK_BLOCK, $markup );

		return null === $fallback ? $html . $markup : $fallback;
	}

	/**
	 * Where one placement puts its markup.
	 *
	 * `all` applies every step that is present — an address field belongs in
	 * both the shipping and the billing form. `first` stops at the first step
	 * that matches, which is how a placement degrades when the block it would
	 * rather sit next to has been removed from the page.
	 *
	 * @param string $location Placement key.
	 * @return array{mode: string, steps: array<int, array{0: string, 1: string}>}
	 */
	public static function plan( string $location ): array {
		$plans = array(
			FieldDefinition::LOCATION_CONTACT            => array(
				'mode'  => 'all',
				'steps' => array( array( 'append', 'woocommerce/checkout-contact-information-block' ) ),
			),
			FieldDefinition::LOCATION_ADDRESS            => array(
				'mode'  => 'all',
				'steps' => array(
					array( 'append', 'woocommerce/checkout-shipping-address-block' ),
					array( 'append', 'woocommerce/checkout-billing-address-block' ),
				),
			),
			// One address form each. The wrapper is spliced into that form's own
			// inner block area, so the checkout renders it only where it renders
			// that form: a billing field is simply not on the page while "Use
			// same address for billing" is ticked, and a shipping field is not
			// there when the cart needs no shipping. Extensions relaxes
			// `required` to match, so neither can block an order the shopper
			// was never shown the question for.
			FieldDefinition::LOCATION_SHIPPING_ADDRESS   => array(
				'mode'  => 'all',
				'steps' => array( array( 'append', 'woocommerce/checkout-shipping-address-block' ) ),
			),
			FieldDefinition::LOCATION_BILLING_ADDRESS    => array(
				'mode'  => 'all',
				'steps' => array( array( 'append', 'woocommerce/checkout-billing-address-block' ) ),
			),
			FieldDefinition::LOCATION_ORDER              => array(
				'mode'  => 'first',
				'steps' => array(
					array( 'before', 'woocommerce/checkout-order-note-block' ),
					array( 'before', 'woocommerce/checkout-terms-block' ),
					array( 'before', 'woocommerce/checkout-actions-block' ),
				),
			),
			FieldDefinition::LOCATION_AFTER_SHIPPING     => array(
				'mode'  => 'all',
				'steps' => array( array( 'append', 'woocommerce/checkout-shipping-methods-block' ) ),
			),
			FieldDefinition::LOCATION_AFTER_PAYMENT      => array(
				'mode'  => 'all',
				'steps' => array( array( 'append', 'woocommerce/checkout-payment-block' ) ),
			),
			FieldDefinition::LOCATION_BEFORE_PLACE_ORDER => array(
				'mode'  => 'first',
				'steps' => array( array( 'before', 'woocommerce/checkout-actions-block' ) ),
			),
			FieldDefinition::LOCATION_ORDER_SUMMARY      => array(
				'mode'  => 'all',
				'steps' => array( array( 'append', 'woocommerce/checkout-order-summary-block' ) ),
			),
		);

		return $plans[ $location ] ?? $plans[ FieldDefinition::LOCATION_ORDER ];
	}

	/**
	 * Name of the transient flagging a placement with nowhere to go.
	 *
	 * @param string $location Placement key.
	 * @return string
	 */
	public static function warning_transient( string $location ): string {
		return self::WARNING_TRANSIENT_PREFIX . $location;
	}

	/**
	 * Whether a placement has recently had to fall back.
	 *
	 * @param string $location Placement key.
	 * @return bool
	 */
	public static function had_miss( string $location ): bool {
		return false !== get_transient( self::warning_transient( $location ) );
	}

	/**
	 * Flag a placement whose anchor was not on the page.
	 *
	 * Written from the checkout, so it is deliberately cheap and self-limiting:
	 * one row per placement per hour, however many shoppers load the page.
	 *
	 * @param string $location Placement key.
	 */
	private static function record_miss( string $location ): void {
		$key = self::warning_transient( $location );

		if ( false !== get_transient( $key ) ) {
			return;
		}

		set_transient( $key, $location, self::WARNING_TRANSIENT_TTL );
	}

	/**
	 * Drop a placement's flag, because the thing it warned about is over — the
	 * anchor was found again, or the merchant moved the fields elsewhere.
	 *
	 * Reads before writing, so a checkout that has never had a problem costs a
	 * cached lookup rather than a delete on every page load.
	 *
	 * @param string $location Placement key.
	 */
	public static function clear_miss( string $location ): void {
		$key = self::warning_transient( $location );

		if ( false === get_transient( $key ) ) {
			return;
		}

		delete_transient( $key );
	}
}
