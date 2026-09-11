# Fieldwright

A visual editor for the WooCommerce Checkout block. Rename WooCommerce's own
checkout fields, switch them off, make them optional or required and reorder
them, and add fields of your own in nine positions on the page.

- WordPress.org listing: https://wordpress.org/plugins/fieldwright-checkout-fields/
- Developer reference: [docs/developers.md](docs/developers.md)

This repository is the public source of the plugin published on WordPress.org.
It is a mirror: the plugin is developed in a private monorepo alongside a paid
add-on, and every release is pushed here from that repository's `main`. Issues
and pull requests are read, but a change lands in the monorepo first.

## What is here that the zip does not carry

The zip a store installs holds the compiled assets in `build/`, the PHP in
`includes/` and `readme.txt`. This repository adds what those are made from:

| Path | What it is |
|---|---|
| `src/` | The TypeScript and React sources of both compiled bundles |
| `webpack.config.js` | The build, with the entry points and the dependency-extraction rules |
| `package.json`, `package-lock.json` | The build tooling and the versions it was built with |
| `docs/developers.md` | Every hook, filter, JavaScript API and REST route |

## Building the compiled assets

The files in `build/` are compiled and minified from `src/`. Node 20 or newer:

```bash
npm ci
npm run build
```

That runs `wp-scripts build` against `webpack.config.js`, whose two entry points
are `src/admin.tsx` (the builder screen) and `src/checkout.ts` (the checkout
bundle), and writes `build/`. `npm start` is the same build in watch mode.

The released files are built the same way from the private monorepo, which
compiles this plugin and the paid add-on together. The webpack context differs
between the two, so a build from here gives the same files, the same script
dependencies in `build/*.asset.php` and the same behaviour, with different
internal module ids inside the minified JavaScript.

## License

GPL-2.0-or-later. See the license header in
`fieldwright-checkout-fields.php`.
