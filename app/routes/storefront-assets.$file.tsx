import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoaderFunctionArgs } from "react-router";

/*
 * The theme extension's storefront assets, served by the app:
 *
 *   /storefront-assets/configurator.js  ->  extensions/viewer-3d/assets/configurator.js
 *
 * For pages rendered outside a theme — the Product configurator iframe
 * (proxy.configurator.$handle.tsx) — which can't use `asset_url` for an app
 * extension's files. Same files the app blocks load, so the two never drift.
 *
 * An allowlist, not a path join on user input. Server-side reads only: the
 * browser never imports from extensions/ (the CLI tunnel 404s that path).
 */
const FILES: Record<string, string> = {
  "configurator.js": "application/javascript; charset=utf-8",
  "configurator.css": "text/css; charset=utf-8",
  "viewer-3d.js": "application/javascript; charset=utf-8",
  "viewer-3d.css": "text/css; charset=utf-8",
  "view3d.pkgd.min.js": "application/javascript; charset=utf-8",
  "view3d-bundle.min.css": "text/css; charset=utf-8",
};

const ASSET_DIR = join(process.cwd(), "extensions", "viewer-3d", "assets");

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const name = params.file ?? "";
  const type = Object.prototype.hasOwnProperty.call(FILES, name) ? FILES[name] : null;
  if (!type) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(join(ASSET_DIR, name));
    return new Response(body, {
      headers: {
        "Content-Type": type,
        // Short browser cache, longer at a CDN: a deploy should reach shoppers
        // within minutes, and the page's ?v= changes with every deploy anyway.
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};
