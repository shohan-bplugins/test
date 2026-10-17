import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { publicOrigin } from "../utils/publicOrigin";

/**
 * Public, stable hosting for the storefront player assets.
 *
 * On a Liquid theme the app embed loads these from Shopify's extension CDN,
 * whose URL contains a version hash that changes on every deploy — so it can't
 * be hard-coded by anyone. Headless / custom storefronts (Hydrogen, Next.js,
 * custom React…) have no app embed at all, so without a fixed URL they simply
 * cannot use the player. These routes give them one:
 *
 *   https://<app-host>/svp/loader.js   ← one-line install (recommended)
 *   https://<app-host>/svp/plyr.js
 *   https://<app-host>/svp/plyr.css
 *   https://<app-host>/svp/styles.css
 *   https://<app-host>/svp/svp-player.js
 *
 * The files are read from the theme-extension folder so there is a single
 * source of truth — the storefront and headless integrations always run
 * byte-identical code.
 */

// Explicit allow-list: never build a filesystem path out of user input.
const ASSETS = {
  "plyr.js": "text/javascript; charset=utf-8",
  "plyr.css": "text/css; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
  "svp-player.js": "text/javascript; charset=utf-8",
};

const ASSET_DIR = path.join(
  process.cwd(),
  "extensions",
  "star-video-player",
  "assets",
);

// Scripts and stylesheets loaded via <script>/<link> don't need CORS, but
// allowing it means a storefront can also fetch/bundle them if it prefers.
const baseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // Short cache + ETag: updates reach storefronts quickly after a release,
  // while repeat views still revalidate cheaply (304, no body).
  "Cache-Control": "public, max-age=600, must-revalidate",
};

/** One-line installer that pulls in everything in the correct order. */
function buildLoader(origin) {
  return `/* Video Player by bPlugins — headless storefront loader.
 *
 * Usage:
 *   <script src="${origin}/svp/loader.js"
 *           data-shop="your-store.myshopify.com"></script>
 *
 * Then place a player anywhere on the page:
 *   <div class="video-plyr-by-bplugins" data-id="YOUR_PLAYER_ID"></div>
 */
(function () {
  if (window.__svpLoaderStarted) return;
  window.__svpLoaderStarted = true;

  var tag = document.currentScript;

  // Work out where to load the other files from using THIS script's own URL,
  // rather than an address baked in by the server. Behind a proxy or tunnel
  // (Cloudflare, ngrok, a load balancer) the server often sees plain http://
  // and an internal host, so a baked-in address can point at the wrong origin
  // or protocol — on an https page the browser then blocks those requests as
  // mixed content and nothing loads. Deriving it here always matches the URL
  // the browser actually used.
  var base = ${JSON.stringify(origin)} + "/svp";
  try {
    // currentScript covers a normal <script> tag. It can be null in some
    // loading patterns (module scripts, certain injected-script setups), so
    // fall back to finding this file among the page's script tags.
    var self = (tag && tag.src) || null;
    if (!self) {
      var found = document.querySelector('script[src*="/svp/loader.js"]');
      if (found) {
        self = found.src;
        if (!tag) tag = found;
      }
    }
    if (self) base = new URL(".", self).href.replace(/\\/+$/, "");
  } catch (e) {}

  var shop = tag && tag.getAttribute("data-shop");
  // Only used by the domain watermark; harmless to omit.
  if (shop) window.__svpShopDomain = shop;

  function addCss(href) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function addJs(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = src;
      el.onload = resolve;
      el.onerror = function () { reject(new Error("failed to load " + src)); };
      document.head.appendChild(el);
    });
  }

  addCss(base + "/plyr.css");
  addCss(base + "/styles.css");

  // svp-player.js needs the Plyr global, so it must come second.
  addJs(base + "/plyr.js")
    .then(function () { return addJs(base + "/svp-player.js"); })
    .then(function () {
      window.__svpLoaderOk = true;
      window.dispatchEvent(new CustomEvent("svp:ready", { detail: { base: base } }));
    })
    .catch(function (err) {
      window.__svpLoaderError = err.message;
      console.error("[Video Player by bPlugins] " + err.message);
      // Let a page report the failure instead of it dying silently.
      window.dispatchEvent(
        new CustomEvent("svp:error", { detail: { message: err.message, base: base } }),
      );
    });
})();
`;
}

export const loader = async ({ params, request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: baseHeaders });
  }

  const file = params.file || "";

  if (file === "loader.js") {
    const origin = publicOrigin(request);
    // The bootstrap file is tiny and is the one thing that must never go stale:
    // a cached copy keeps pointing at whatever it was told last time, which is
    // impossible to debug from the outside. Always revalidate (an unchanged
    // file still costs only a 304). The heavy assets it pulls in stay cached.
    return serve(buildLoader(origin), "text/javascript; charset=utf-8", request, {
      "Cache-Control": "no-cache, must-revalidate",
    });
  }

  const contentType = ASSETS[file];
  if (!contentType) {
    return new Response("Not found", { status: 404, headers: baseHeaders });
  }

  try {
    const body = await readFile(path.join(ASSET_DIR, file));
    return serve(body, contentType, request);
  } catch (e) {
    // The extension assets folder isn't present on this server.
    return new Response("Asset unavailable", {
      status: 404,
      headers: baseHeaders,
    });
  }
};

/** Send with an ETag so repeat requests get a cheap 304. */
function serve(body, contentType, request, overrides = {}) {
  const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
  const headers = { ...baseHeaders, ...overrides, ETag: etag };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status: 200,
    headers: { ...headers, "Content-Type": contentType },
  });
}
