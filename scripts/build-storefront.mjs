#!/usr/bin/env node
/*
 * Bundles the storefront configurator (app/lib/configurator/storefront) into
 * the theme extension. It shares config.ts / options.ts / pricing.ts with the
 * admin editor, so what a shopper sees resolves exactly as it did in the editor.
 *
 * Run with `npm run build:storefront`; the output is committed, like the
 * vendored viewer bundle, because the extension ships as plain assets.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["app/lib/configurator/storefront/entry.ts"],
  outfile: "extensions/viewer-3d/assets/configurator.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2019"],
  legalComments: "none",
  logLevel: "info",
});
