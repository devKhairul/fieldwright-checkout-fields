<?php
/**
 * The checkout bundle, declared to WooCommerce as a block integration.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Checkout;

use Automattic\WooCommerce\Blocks\Integrations\IntegrationInterface;

defined( 'ABSPATH' ) || exit;

/**
 * Gets the bundle in front of WooCommerce's own checkout script.
 *
 * ## Why an integration rather than an enqueue
 *
 * The checkout renders its inner blocks from a map of components, and that map
 * is a *snapshot*: `checkout-frontend.js` calls `getRegisteredBlockComponents(
 * 'woocommerce/checkout' )` while it executes, and the function returns a fresh
 * `{ ...byContext[ name ], ...byContext.any }` — a copy. The render happens
 * later, on `DOMContentLoaded`, but by then the map is already frozen. A
 * component registered after that script has run is registered into a registry
 * nothing reads again, so every `<div data-block-name="cbwb/field">` the server
 * injected is left in the page as an unknown block and stays empty.
 *
 * `wp_enqueue_script()` on `wp_enqueue_scripts` cannot fix that. WooCommerce
 * registers its checkout script when the block renders, which is after
 * `wp_enqueue_scripts` has run, so ours is queued first and — with no
 * dependency edge between them — printed first only by accident of queue order.
 * It was printed second.
 *
 * `IntegrationInterface` is the documented way round it. WooCommerce merges
 * every registered integration's `get_script_handles()` into the dependencies
 * of `wc-checkout-block-frontend` when it registers that script, so WordPress
 * has to print ours first. Registration then lands before the snapshot is
 * taken.
 *
 * ## The contract, as WooCommerce 11.0.1 implements it
 *
 * - `woocommerce_blocks_checkout_block_registration` fires from
 *   `IntegrationRegistry::initialize()`, which the checkout block type calls
 *   from its own constructor on `init`. So the hook has to be attached before
 *   `init`, and `initialize()` below runs *during* `init` — well before
 *   `wp_enqueue_scripts`, and on every front-end request, not only checkouts.
 * - `initialize()` runs immediately after the hook, for every integration.
 * - `get_script_handles()` is read later, when the checkout block renders, and
 *   the handles it names have to be *registered* by then. Enqueueing them is
 *   WooCommerce's business: they arrive as dependencies of its own script.
 * - `get_script_data()` is merged into `wcSettings` under
 *   `<name>_data`. We return nothing: the bundle reads `window.cbwbCheckout`,
 *   which `wp_add_inline_script( …, 'before' )` prints immediately above our
 *   script wherever WordPress ends up placing it.
 */
final class Integration implements IntegrationInterface {

	/**
	 * Name WooCommerce files the integration under. Also the prefix of the
	 * `wcSettings` key its script data would land in, if it had any.
	 */
	public const NAME = 'cbwb';

	/**
	 * The bundle's owner: it decides whether there is anything to load, and
	 * registers the handle with everything it needs.
	 *
	 * @var Assets
	 */
	private $assets;

	/**
	 * Constructor.
	 *
	 * @param Assets $assets The checkout bundle.
	 */
	public function __construct( Assets $assets ) {
		$this->assets = $assets;
	}

	/**
	 * Name WooCommerce files the integration under.
	 *
	 * @return string
	 */
	public function get_name(): string {
		return self::NAME;
	}

	/**
	 * Register the bundle, so the handle exists by the time the checkout block
	 * asks for its dependencies.
	 */
	public function initialize(): void {
		$this->assets->register_script();
	}

	/**
	 * Handles WooCommerce should make its checkout script depend on.
	 *
	 * Empty on a store using nothing but the types WooCommerce renders itself:
	 * there is no reason to put a bundle in front of every shopper for a
	 * checkout it would have nothing to do on.
	 *
	 * @return string[]
	 */
	public function get_script_handles(): array {
		return $this->assets->script_handles();
	}

	/**
	 * Handles for the editor. The builder is our own screen, not a block, so
	 * there is nothing to add to the checkout block's editor bundle.
	 *
	 * @return string[]
	 */
	public function get_editor_script_handles(): array {
		return array();
	}

	/**
	 * Data WooCommerce would publish under `wcSettings`.
	 *
	 * @return array<string, mixed>
	 */
	public function get_script_data(): array {
		return array();
	}
}
