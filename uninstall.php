<?php
/**
 * Uninstall handler. Removes plugin data only when the merchant opted in.
 *
 * Order meta is deliberately kept. What a shopper typed into a checkout field is
 * part of the order record, the way their address is, and a store still has to
 * be able to read its own past orders after uninstalling the plugin that
 * collected them. A merchant who wants those values gone has WordPress's own
 * erasure request and WooCommerce's "Remove personal data" bulk action, both of
 * which this plugin answers while it is still installed.
 *
 * @package CheckoutBuilder
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/**
 * Remove one site's data.
 *
 * Runs inside whichever site is current, so a network uninstall can call it once
 * per site. The opt-in is read per site too: it is a per-site option, and a
 * network with one site that asked for cleanup and another that did not must get
 * what each of them asked for.
 */
function cbwb_uninstall_site(): void {
	global $wpdb;

	if ( 'yes' !== get_option( 'cbwb_remove_data_on_uninstall', 'no' ) ) {
		return;
	}

	$config = get_option( 'cbwb_config' );

	delete_option( 'cbwb_config' );
	delete_option( 'cbwb_remove_data_on_uninstall' );
	delete_option( 'cbwb_required_marking' );
	delete_option( 'cbwb_required_note' );

	// The values remembered against customers by fields set to prefill. Named
	// from the configuration that is being deleted, so only our own keys go.
	if ( is_array( $config ) && isset( $config['fields'] ) && is_array( $config['fields'] ) ) {
		foreach ( $config['fields'] as $field ) {
			if ( ! is_array( $field ) || ! isset( $field['id'] ) || ! is_string( $field['id'] ) ) {
				continue;
			}

			if ( 0 !== strpos( $field['id'], 'cbwb/' ) ) {
				continue;
			}

			delete_metadata( 'user', 0, '_' . $field['id'], '', true );
		}
	}

	// Whoever closed the one line about the paid add-on. A preference of a
	// reader's rather than anything a customer typed, so it goes with the rest
	// of the plugin's own state.
	delete_metadata( 'user', 0, 'cbwb_pro_line_dismissed', '', true );

	// Warning flags: one row per broken pattern or placement, written from the
	// checkout and expiring on their own within the hour. Deleted directly
	// because their names carry a hash of what they describe, so there is no list
	// of them to walk.
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- No API deletes transients by name prefix, and a delete has no cached read to reuse.
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
			$wpdb->esc_like( '_transient_cbwb_' ) . '%',
			$wpdb->esc_like( '_transient_timeout_cbwb_' ) . '%'
		)
	);
}

if ( is_multisite() ) {
	$cbwb_sites = get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	);

	foreach ( $cbwb_sites as $cbwb_site_id ) {
		switch_to_blog( (int) $cbwb_site_id );
		cbwb_uninstall_site();
		restore_current_blog();
	}
} else {
	cbwb_uninstall_site();
}
