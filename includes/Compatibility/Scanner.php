<?php
/**
 * Block checkout migration readiness scan.
 *
 * @package CheckoutBuilder
 */

declare( strict_types=1 );

namespace CheckoutBuilder\Compatibility;

use Automattic\WooCommerce\Utilities\FeaturesUtil;
use Automattic\WooCommerce\Utilities\PluginUtil;
use Throwable;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Answers "can this store switch to the block checkout safely?".
 *
 * Two questions are answered at once:
 *
 * 1. Which checkout does the store use today — the `woocommerce/checkout` block,
 *    or the `[woocommerce_checkout]` shortcode?
 * 2. Which active plugins have told WooCommerce whether they work with the block
 *    checkout, via `FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', … )`?
 *
 * ## What the "uncertain" and "unknown" buckets really mean
 *
 * WooCommerce's registry only ever knows about *WooCommerce-aware* plugins:
 * `PluginUtil::is_woocommerce_aware_plugin()` treats a plugin as WooCommerce-aware
 * when its header carries a non-empty `WC tested up to` value. Every such plugin
 * that declared neither compatibility nor incompatibility lands in "uncertain".
 *
 * A plugin with no WooCommerce integration at all — no `WC tested up to` header —
 * is absent from all three of WooCommerce's buckets, so it is collected here into
 * a fourth, "unknown". That is a scan of `get_plugins()` rather than of the
 * registry, which is why "unknown" is the only bucket whose membership we decide
 * ourselves. It is usually the uninteresting bucket (those plugins do not touch
 * checkout), but leaving it out made the counts look like a count of active
 * plugins when they were not.
 *
 * Must-use plugins and drop-ins are outside `get_plugins()` and outside
 * `active_plugins`, so they appear in no bucket at all.
 *
 * Two further limitations worth knowing:
 *
 * - `FeaturesUtil::get_compatible_plugins_for_feature()` is the public wrapper and
 *   takes only a feature id — the `$active_only` argument exists on the internal
 *   `FeaturesController` method it delegates to. Inactive-but-installed plugins are
 *   filtered out here with `is_plugin_active()` instead of asking WooCommerce.
 * - Block themes can serve the checkout from a site-editor template rather than the
 *   checkout page's content. `checkout_type` reads the page, so such a store may
 *   report `classic` (or `unknown`) while the front end already renders blocks.
 *
 * Nothing is cached: the whole scan is a handful of in-memory array operations plus
 * one `get_plugins()` call, which WordPress caches itself.
 */
final class Scanner {

	public const FEATURE = 'cart_checkout_blocks';

	public const CHECKOUT_BLOCK     = 'woocommerce/checkout';
	public const CHECKOUT_SHORTCODE = 'woocommerce_checkout';

	public const TYPE_BLOCK   = 'block';
	public const TYPE_CLASSIC = 'classic';
	public const TYPE_UNKNOWN = 'unknown';

	public const COMPATIBLE   = 'compatible';
	public const INCOMPATIBLE = 'incompatible';
	public const UNCERTAIN    = 'uncertain';
	public const UNKNOWN      = 'unknown';

	/**
	 * Run the scan.
	 *
	 * @return array{
	 *     checkout_type: string,
	 *     checkout_page_id: int,
	 *     checkout_page_url: string,
	 *     plugins: array<string, array<int, array<string, mixed>>>,
	 *     summary: array<string, int>,
	 *     notes: array<string, string>
	 * }
	 */
	public function scan(): array {
		$page    = $this->checkout_page();
		$plugins = $this->plugins();

		$summary = array();
		foreach ( self::buckets() as $bucket ) {
			$summary[ $bucket ] = count( $plugins[ $bucket ] );
		}

		return array(
			'checkout_type'     => $page['type'],
			'checkout_page_id'  => $page['id'],
			'checkout_page_url' => $page['url'],
			'plugins'           => $plugins,
			'summary'           => $summary,
			'notes'             => self::notes(),
		);
	}

	/**
	 * Every bucket the report carries, in the order the UI shows them.
	 *
	 * @return array<int, string>
	 */
	public static function buckets(): array {
		return array_merge( self::declared_buckets(), array( self::UNKNOWN ) );
	}

	/**
	 * The three buckets WooCommerce's own registry answers with. "unknown" is not
	 * one of them: it is what is left over once those three are accounted for.
	 *
	 * @return array<int, string>
	 */
	public static function declared_buckets(): array {
		return array( self::COMPATIBLE, self::INCOMPATIBLE, self::UNCERTAIN );
	}

	/**
	 * Active plugins grouped by what they declared, plus everything active that
	 * WooCommerce never saw.
	 *
	 * @return array<string, array<int, array<string, mixed>>>
	 */
	private function plugins(): array {
		$grouped = array();
		foreach ( self::buckets() as $bucket ) {
			$grouped[ $bucket ] = array();
		}

		// Before `woocommerce_init` the registry is incomplete and WooCommerce
		// emits a _doing_it_wrong notice, so report nothing rather than guess.
		if ( ! class_exists( FeaturesUtil::class ) || ! did_action( 'woocommerce_init' ) ) {
			return $grouped;
		}

		self::load_plugin_api();
		if ( ! function_exists( 'get_plugins' ) || ! function_exists( 'is_plugin_active' ) ) {
			return $grouped;
		}

		$declared  = FeaturesUtil::get_compatible_plugins_for_feature( self::FEATURE );
		$installed = get_plugins();
		$excluded  = self::excluded_plugin_files();
		$detailed  = self::can_see_plugin_details();

		// Every file WooCommerce placed somewhere, whether or not we list it.
		// A plugin it filed as (in)compatible is never also "unknown".
		$classified = array();

		foreach ( self::declared_buckets() as $bucket ) {
			$files = isset( $declared[ $bucket ] ) && is_array( $declared[ $bucket ] ) ? $declared[ $bucket ] : array();

			foreach ( $files as $file ) {
				if ( ! is_string( $file ) ) {
					continue;
				}
				$classified[] = $file;

				if ( in_array( $file, $excluded, true ) || ! is_plugin_active( $file ) ) {
					continue;
				}
				$data                 = isset( $installed[ $file ] ) && is_array( $installed[ $file ] ) ? $installed[ $file ] : array();
				$grouped[ $bucket ][] = self::describe( $file, $data, $detailed );
			}
		}

		// `get_plugins()` covers the plugins directory only, so must-use plugins
		// and drop-ins never reach this loop; neither does anything inactive.
		foreach ( $installed as $file => $data ) {
			$file = (string) $file;
			if ( in_array( $file, $classified, true ) || in_array( $file, $excluded, true ) || ! is_plugin_active( $file ) ) {
				continue;
			}
			// A reader without `activate_plugins` is not shown the plugins that
			// have nothing to do with WooCommerce. WordPress keeps the plugin list
			// behind that capability, and a shop manager reading this report would
			// otherwise learn which security and backup plugins the store runs.
			// Nothing useful is lost: a plugin with no WooCommerce header at all is
			// not one that changes the checkout, which is the only reason the
			// unknown bucket is worth reading.
			if ( ! $detailed && ! self::is_woocommerce_aware( $file ) ) {
				continue;
			}
			$grouped[ self::UNKNOWN ][] = self::describe( $file, is_array( $data ) ? $data : array(), $detailed );
		}

		foreach ( self::buckets() as $bucket ) {
			usort( $grouped[ $bucket ], array( self::class, 'compare_by_name' ) );
		}

		return $grouped;
	}

	/**
	 * Order two plugin entries by display name, falling back to the plugin file
	 * so the order never depends on the registry's insertion order. (For a reader
	 * who may not see plugin files that tiebreak is empty, which only matters when
	 * two plugins share a display name.)
	 *
	 * @param array<string, mixed> $a First entry.
	 * @param array<string, mixed> $b Second entry.
	 * @return int
	 */
	private static function compare_by_name( array $a, array $b ): int {
		$by_name = strnatcasecmp( self::text( $a, 'name' ), self::text( $b, 'name' ) );

		return 0 !== $by_name ? $by_name : strcmp( self::text( $a, 'file' ), self::text( $b, 'file' ) );
	}

	/**
	 * Turn a plugin basename into something the UI can render.
	 *
	 * `file` and `version` are the two values WordPress itself keeps behind
	 * `activate_plugins`, so they are emitted only to someone who already has
	 * that capability — see can_see_plugin_details(). The keys stay put either
	 * way, empty, because they are part of the REST contract.
	 *
	 * @param string               $file     Plugin basename, e.g. `my-plugin/my-plugin.php`.
	 * @param array<string, mixed> $data     Row from get_plugins(), empty when the plugin vanished.
	 * @param bool                 $detailed Whether the reader may see the exact file and version.
	 * @return array{file: string, name: string, version: string, author: string, plugin_uri: string, is_woocommerce: bool}
	 */
	private static function describe( string $file, array $data, bool $detailed ): array {
		$name = self::text( $data, 'Name' );
		if ( '' === $name ) {
			$name = dirname( $file );
		}

		// get_plugins() returns an un-marked-up 'AuthorName' alongside 'Author';
		// older data may only carry 'Author', which can contain a link.
		$author = self::text( $data, 'AuthorName' );
		if ( '' === $author ) {
			$author = self::text( $data, 'Author' );
		}

		return array(
			'file'           => $detailed ? $file : '',
			'name'           => wp_strip_all_tags( $name ),
			'version'        => $detailed ? wp_strip_all_tags( self::text( $data, 'Version' ) ) : '',
			'author'         => wp_strip_all_tags( $author ),
			// The header lands in an href in the admin app. Anything but a real
			// web address — `javascript:` above all — becomes the empty string,
			// which the app renders as plain text instead of a link.
			'plugin_uri'     => esc_url_raw( self::text( $data, 'PluginURI' ), array( 'http', 'https' ) ),
			// Always false in practice: WooCommerce itself is excluded from the
			// lists below. Kept so the entry shape is stable for consumers.
			'is_woocommerce' => self::is_woocommerce( $file ),
		);
	}

	/**
	 * Whether a plugin says anywhere in its header that it works with WooCommerce.
	 *
	 * WooCommerce's own test is a non-empty `WC tested up to` header, and it is
	 * asked rather than reimplemented. A WooCommerce too old to have the utility
	 * answers "no", which keeps the unknown bucket empty for a reader without
	 * `activate_plugins` rather than showing them the whole plugin list.
	 *
	 * @param string $file Plugin basename.
	 * @return bool
	 */
	private static function is_woocommerce_aware( string $file ): bool {
		if ( ! class_exists( PluginUtil::class ) || ! function_exists( 'wc_get_container' ) ) {
			return false;
		}

		try {
			$util = wc_get_container()->get( PluginUtil::class );
		} catch ( Throwable $error ) {
			return false;
		}

		return $util instanceof PluginUtil && $util->is_woocommerce_aware_plugin( $file );
	}

	/**
	 * Whether the current user may be told exactly which plugin files and
	 * versions this store runs.
	 *
	 * The scan is gated on `manage_woocommerce`, which a shop_manager has and
	 * which WordPress does *not* consider enough to see the plugin list. The
	 * merchant-facing point of the report is names and buckets — "these plugins
	 * haven't said whether they support the block checkout" — so a shop_manager
	 * keeps the whole feature while the versioned inventory, the single most
	 * useful thing to an attacker holding a phished account, stays behind the
	 * capability WordPress put it behind.
	 *
	 * @return bool
	 */
	private static function can_see_plugin_details(): bool {
		return current_user_can( 'activate_plugins' );
	}

	/**
	 * Read one string value out of an untyped array.
	 *
	 * @param array<string, mixed> $data Source array.
	 * @param string               $key  Key to read.
	 * @return string
	 */
	private static function text( array $data, string $key ): string {
		return isset( $data[ $key ] ) && is_scalar( $data[ $key ] ) ? (string) $data[ $key ] : '';
	}

	/**
	 * Plugins that are never interesting here: WooCommerce itself (the feature is
	 * its own) and our two plugins, which declare compatibility by definition.
	 *
	 * @return array<int, string>
	 */
	private static function excluded_plugin_files(): array {
		$excluded = array( 'woocommerce/woocommerce.php' );

		foreach ( array( 'WC_PLUGIN_FILE', 'CBWB_FILE', 'CBWB_PRO_FILE' ) as $constant ) {
			if ( ! defined( $constant ) ) {
				continue;
			}
			$file = constant( $constant );
			if ( is_string( $file ) && '' !== $file ) {
				$excluded[] = plugin_basename( $file );
			}
		}

		return array_values( array_unique( $excluded ) );
	}

	/**
	 * Whether a plugin basename is WooCommerce core.
	 *
	 * @param string $file Plugin basename.
	 * @return bool
	 */
	private static function is_woocommerce( string $file ): bool {
		if ( 'woocommerce/woocommerce.php' === $file ) {
			return true;
		}

		return defined( 'WC_PLUGIN_FILE' ) && is_string( WC_PLUGIN_FILE ) && plugin_basename( WC_PLUGIN_FILE ) === $file;
	}

	/**
	 * `get_plugins()` and `is_plugin_active()` live in an admin-only file that the
	 * REST request has not loaded.
	 */
	private static function load_plugin_api(): void {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
	}

	/**
	 * Which checkout the store's checkout page renders today.
	 *
	 * @return array{id: int, url: string, type: string}
	 */
	private function checkout_page(): array {
		$missing = array(
			'id'   => 0,
			'url'  => '',
			'type' => self::TYPE_UNKNOWN,
		);

		if ( ! function_exists( 'wc_get_page_id' ) ) {
			return $missing;
		}

		// wc_get_page_id() answers -1 when no checkout page is assigned.
		$page_id = (int) wc_get_page_id( 'checkout' );
		if ( $page_id <= 0 ) {
			return $missing;
		}

		$post = get_post( $page_id );
		if ( ! $post instanceof WP_Post ) {
			return $missing;
		}

		$permalink = get_permalink( $post );

		return array(
			'id'   => (int) $post->ID,
			'url'  => is_string( $permalink ) ? $permalink : '',
			'type' => self::page_type( $post ),
		);
	}

	/**
	 * Classify a checkout page's content.
	 *
	 * @param WP_Post $post Checkout page.
	 * @return string One of the TYPE_* constants.
	 */
	private static function page_type( WP_Post $post ): string {
		if ( has_block( self::CHECKOUT_BLOCK, $post ) ) {
			return self::TYPE_BLOCK;
		}
		if ( has_shortcode( (string) $post->post_content, self::CHECKOUT_SHORTCODE ) ) {
			return self::TYPE_CLASSIC;
		}

		return self::TYPE_UNKNOWN;
	}

	/**
	 * What each bucket means, in the merchant's words.
	 *
	 * @return array<string, string>
	 */
	private static function notes(): array {
		return array(
			self::COMPATIBLE   => __( 'These plugins have told WooCommerce they work with the block checkout.', 'fieldwright-checkout-fields' ),
			self::INCOMPATIBLE => __( 'These plugins have told WooCommerce they do not work with the block checkout. Check with their developers before switching.', 'fieldwright-checkout-fields' ),
			self::UNCERTAIN    => __( "These plugins haven't said whether they support the block checkout. Test them on a draft page before switching.", 'fieldwright-checkout-fields' ),
			self::UNKNOWN      => __( "These plugins don't mention WooCommerce, so WooCommerce can't classify them. They're usually unrelated to checkout, but test any that add checkout features.", 'fieldwright-checkout-fields' ),
		);
	}
}
