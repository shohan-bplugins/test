/**
 * Self-contained iframe embed for a single player.
 *
 *   <iframe src="https://<app-host>/embed/<PLAYER_ID>" ...></iframe>
 *
 * This is the zero-setup option: no app embed, no theme block, no script tag,
 * no CORS. It works on any website — a Shopify theme, a headless storefront,
 * WordPress, a landing page builder — because the browser loads a normal page
 * that happens to contain the player. The page renders the same player engine
 * and honours every setting saved in the app.
 */

import prisma from "../db.server";

// Only 24-character Mongo ObjectIds are valid player ids; reject anything else
// rather than serving a page that can never work.
const ID_RE = /^[a-f\d]{24}$/i;

export const loader = async ({ params, request }) => {
  const id = String(params.id || "");
  const url = new URL(request.url);

  // Optional presentation tweaks, so one URL can cover common cases.
  const q = url.searchParams;
  const bg = /^[0-9a-f]{3,8}$/i.test(q.get("bg") || "") ? `#${q.get("bg")}` : "transparent";
  const fit = q.get("fit") === "cover" ? "cover" : "contain";

  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    // This page must be embeddable on any storefront, so it has to defeat two
    // different framing controls at once.
    //
    //  1. X-Frame-Options. Reverse proxies routinely bolt
    //     `X-Frame-Options: SAMEORIGIN` onto every response as a blanket
    //     hardening rule, and the app server can't remove a header the proxy
    //     adds downstream of it. But the spec says a browser MUST ignore
    //     X-Frame-Options entirely when the response also carries a CSP
    //     `frame-ancestors` directive — so sending one here neutralises the
    //     proxy's header instead of fighting it. (This is the same mechanism
    //     that keeps the embedded admin working under that proxy.)
    //
    //  2. The `*` trap. `frame-ancestors *` looks like "allow all" but is
    //     actually NARROWER than expected: per spec `*` matches only network
    //     schemes or a scheme matching this response's own, so some parents are
    //     refused with "The scheme 'https:' must be added explicitly" and the
    //     frame renders blank. Listing the schemes alongside `*` closes that
    //     gap, leaving framing effectively unrestricted while still emitting a
    //     directive — which is what suppresses X-Frame-Options.
    "Content-Security-Policy": "frame-ancestors * https: http:;",
    "Cache-Control": "public, max-age=300, must-revalidate",
    "X-Robots-Tag": "noindex",
  };

  if (!ID_RE.test(id)) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#6d7175;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:16px">
       <div>That video ID doesn&rsquo;t look right.<br><small>Copy it from the app: Videos &rarr; Embed.</small></div></body>`,
      { status: 404, headers },
    );
  }

  // The shop is needed for the "domain" watermark, which reads
  // window.__svpShopDomain — a value the Liquid app embed normally supplies and
  // that doesn't exist here. Looking it up also lets a deleted/unknown player
  // fail clearly instead of rendering an empty frame.
  let shopDomain = "";
  let isGrid = false;
  try {
    const video = await prisma.video.findUnique({
      where: { id },
      select: { shop: true, data: true },
    });
    if (!video) {
      return new Response(
        `<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#6d7175;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:16px">
         <div>This video isn&rsquo;t available.<br><small>It may have been deleted.</small></div></body>`,
        { status: 404, headers },
      );
    }
    shopDomain = video.shop || "";
    // A grid/multiple player's height comes from its rows, so it can't be
    // forced to fill the frame the way a single video is.
    isGrid = video?.data?.playerType === "multiple";
  } catch (e) {
    // A lookup failure shouldn't block playback — only the domain watermark
    // depends on it, and the player fetches its own settings anyway.
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Video</title>
<link rel="stylesheet" href="/svp/plyr.css">
<link rel="stylesheet" href="/svp/styles.css">
<style>
  html, body { margin: 0; padding: 0; background: ${bg}; }
${
  isGrid
    ? `  /* Grid / multiple player: its height is set by however many rows of
     videos there are, so let the content decide and allow scrolling if the
     frame is shorter than the grid. Forcing height:100% here would squash
     every tile and hide all rows after the first. */
  html, body { height: auto; min-height: 100%; overflow-x: hidden; overflow-y: auto; }
  #svp-embed { width: 100%; }`
    : `  /* Single video: fill the frame the merchant sized. */
  html, body { height: 100%; overflow: hidden; }
  #svp-embed, #svp-embed > div, .plyr { width: 100%; height: 100%; }
  .plyr video { object-fit: ${fit}; }
  .plyr__poster { background-size: ${fit === "cover" ? "cover" : "contain"}; }`
}
</style>
</head>
<body>
  <div id="svp-embed">
    <div class="video-plyr-by-bplugins" data-id="${id}"></div>
  </div>
  <script>
    // Inside an iframe, document.referrer is the page that embedded us, so
    // analytics still attribute the play to the real page rather than to this
    // helper URL.
    try {
      if (document.referrer) window.__svpEmbedParent = document.referrer;
    } catch (e) {}
    // Supplies what the Liquid app embed normally would:
    //  • the shop domain, used by the "domain" watermark;
    //  • a flag to skip the storefront-only app-proxy tracking path, which
    //    doesn't exist on this host and would 404 on every play.
    window.__svpShopDomain = ${JSON.stringify(shopDomain)};
    window.__svpNoProxyTrack = true;
  </script>${
    isGrid
      ? `
  <script>
    // A grid's height depends on its rows, which the parent page can't know in
    // advance. Report it upwards so a merchant who wants an exactly-fitting
    // frame can listen for it; ignoring the message just means the frame keeps
    // whatever height they set, and the grid scrolls inside it.
    (function () {
      var last = 0;
      function report() {
        try {
          var h = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight,
          );
          if (h && Math.abs(h - last) > 8) {
            last = h;
            parent.postMessage({ svpEmbedHeight: h, id: ${JSON.stringify(id)} }, "*");
          }
        } catch (e) {}
      }
      window.addEventListener("load", report);
      setInterval(report, 500);
      if (typeof ResizeObserver !== "undefined") {
        try { new ResizeObserver(report).observe(document.body); } catch (e) {}
      }
    })();
  </script>`
      : ""
  }
  <script src="/svp/plyr.js"></script>
  <script src="/svp/svp-player.js"></script>
  <script>
    // A blank frame is impossible to diagnose from the outside — it looks the
    // same whether the assets failed, the id is wrong, or the video URL is
    // dead. If nothing has rendered after a few seconds, say why on screen.
    (function () {
      var started = Date.now();
      var timer = setInterval(function () {
        if (document.querySelector(".plyr")) return clearInterval(timer);
        if (Date.now() - started < 6000) return;
        clearInterval(timer);
        var why = [];
        if (typeof window.Plyr === "undefined") why.push("player engine did not load (/svp/plyr.js)");
        if (typeof window.svpRefresh !== "function") why.push("player script did not run (/svp/svp-player.js)");
        if (!why.length) why.push("the video settings could not be loaded for this ID");
        var box = document.createElement("div");
        box.setAttribute("style",
          "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
          "padding:16px;text-align:center;background:#fff;color:#6d7175;" +
          "font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif");
        box.innerHTML =
          "<div><b style='color:#202223'>Video could not load</b><br>" + why.join("<br>") +
          "<br><small style='opacity:.75'>ID ${id}</small></div>";
        document.body.appendChild(box);
        try { console.error("[Video Player by bPlugins] embed failed: " + why.join(" | ")); } catch (e) {}
      }, 500);
    })();
  </script>
</body>
</html>`;

  return new Response(html, { status: 200, headers });
};
