// ── Product Video auto-placement ──
// The app embed sets window.__svpProductVideoIds on product pages with the
// player ids assigned on the Product Video page. If the merchant hasn't
// placed them anywhere themselves (app block, Custom Liquid snippet, or a
// pasted embed div), render them automatically right after the Add to cart
// form — so assignments work on every theme, including vintage ones,
// with zero setup. Runs BEFORE the element scan below so the injected
// divs are picked up like any hand-placed ones.
(function () {
  try {
    var ids = window.__svpProductVideoIds;
    if (!ids || !ids.length) return;
    // Skip ids that already exist on the page so nothing renders twice.
    var missing = ids.filter(function (id) {
      return !document.querySelector(
        '.video-plyr-by-bplugins[data-id="' + id + '"]',
      );
    });
    if (!missing.length) return;
    // The main product form (first match is the theme's primary form; the
    // Add to cart button lives inside it). Insert directly after the form,
    // which puts the player(s) right below the Add to cart / Buy buttons.
    var form = document.querySelector('form[action*="/cart/add"]');
    if (!form || !form.parentNode) return;
    var wrap = document.createElement("div");
    // Same wrapper class as the Product Video app block, plus an --auto
    // modifier so merchants can restyle or hide it with CSS if they want.
    wrap.className = "bp-product-video bp-product-video--auto";
    wrap.style.display = "grid";
    wrap.style.gap = "16px";
    wrap.style.margin = "16px 0";
    missing.forEach(function (id) {
      var d = document.createElement("div");
      d.className = "video-plyr-by-bplugins";
      d.setAttribute("data-id", id);
      wrap.appendChild(d);
    });
    form.parentNode.insertBefore(wrap, form.nextSibling);
  } catch (e) {}
})();

// ── Analytics: persistent visitor id (for unique-play counting) ──
// Stored in BOTH a first-party cookie and localStorage so the id survives
// page reloads, VPN/network changes, and browsers that clear or partition
// localStorage. A VPN never changes this id, so it can't inflate unique
// viewers. We read whichever store has it and keep the two in sync.
window.__svpVisitorId = (function () {
  var KEY = "svp_visitor_id";

  function readCookie() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)svp_visitor_id=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) {
      return null;
    }
  }
  function writeCookie(v) {
    try {
      // ~2 years; first-party, Lax so it rides along on the storefront.
      document.cookie =
        KEY +
        "=" +
        encodeURIComponent(v) +
        ";path=/;max-age=63072000;SameSite=Lax";
    } catch (e) {}
  }
  function readLS() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }
  function writeLS(v) {
    try {
      localStorage.setItem(KEY, v);
    } catch (e) {}
  }

  try {
    var v = readLS() || readCookie();
    if (!v) {
      v =
        "v_" +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 10);
    }
    // Re-write to both stores so a missing/expired one is healed.
    writeLS(v);
    writeCookie(v);
    return v;
  } catch (e) {
    return null;
  }
})();

// ── Analytics: track endpoint + per-play watch-time accounting ──
// Primary: a FIRST-PARTY url through the Shopify app proxy (the store's own
// domain), because ad blockers (Brave Shields, uBlock) block the direct
// endpoint by URL pattern — "/track" on a third-party domain matches
// EasyPrivacy rules and the request dies with ERR_BLOCKED_BY_CLIENT before
// it leaves the browser. A same-origin /apps/... path doesn't match those
// filters (and needs no CORS). The direct endpoint stays as a fallback for
// stores that don't have the app proxy yet.
window.__svpTrackUrls = [
  "/apps/svp-player/play",
  "https://shopify-video-app.bplugins.com/app/api/track",
];
// The /apps/... path is a Shopify app proxy, which only exists on a
// storefront domain. In the iframe embed the player runs on the app's own
// host, so that relative URL would 404 on every play before falling back.
// The embed page sets this flag to skip it and go straight to the endpoint.
if (window.__svpNoProxyTrack) {
  window.__svpTrackUrls = window.__svpTrackUrls.filter(function (u) {
    return u.indexOf("/apps/") !== 0;
  });
}
window.__svpTracked = window.__svpTracked || {};
// Per-play watch state, keyed by videoId: { playId, watched, lastT, sent, bound }
window.__svpWatch = window.__svpWatch || {};

// Never record analytics inside the Shopify THEME EDITOR preview — plays
// there are the merchant customizing their theme, not real visitors, and
// they would inflate the play counts. Shopify sets Shopify.designMode = true
// in the editor's preview frame (and only there).
window.__svpNoTrack = !!(window.Shopify && window.Shopify.designMode);

// Browsers the server can't identify from the user-agent alone. Brave
// deliberately ships Chrome's exact UA string, but exposes navigator.brave
// in the page — detect it here and send the name along with each beacon.
window.__svpBrowserHint = (function () {
  try {
    if (navigator.brave && typeof navigator.brave.isBrave === "function") {
      return "Brave";
    }
  } catch (e) {}
  return null;
})();

function __svpSend(payload, beacon) {
  try {
    if (window.__svpNoTrack) return;
    if (window.__svpBrowserHint && !payload.browser) {
      payload.browser = window.__svpBrowserHint;
    }
    var body = JSON.stringify(payload);
    // Prefer a url that already worked this page load; otherwise start with
    // the first-party proxy path.
    var urls = window.__svpGoodTrackUrl
      ? [window.__svpGoodTrackUrl]
      : window.__svpTrackUrls.slice();
    if (beacon && navigator.sendBeacon) {
      // Use text/plain so the beacon stays a CORS "simple request" and skips
      // the preflight (OPTIONS) that sendBeacon can't perform on a
      // cross-origin endpoint — otherwise the browser silently drops it and
      // the watch-time flush (on ended/reload/tab-close) never reaches the DB.
      // The server reads the body with request.json(), so the type is fine.
      var ok = navigator.sendBeacon(
        urls[0],
        new Blob([body], { type: "text/plain" }),
      );
      if (ok) return;
      // If the browser refused to queue the beacon, fall through to fetch.
    }
    var i = 0;
    (function attempt() {
      if (i >= urls.length) return;
      var u = urls[i++];
      fetch(u, {
        method: "POST",
        // text/plain keeps this a CORS simple request (no preflight), which
        // matters when this runs during page unload as a beacon fallback.
        headers: { "Content-Type": "text/plain" },
        body: body,
        keepalive: true,
      })
        .then(function (res) {
          if (res && res.ok) {
            // Remember the working url so later beacons (incl. sendBeacon,
            // which can't observe failures) go straight to it.
            window.__svpGoodTrackUrl = u;
          } else {
            // e.g. 404 when this store doesn't have the app proxy yet —
            // retry on the next url.
            attempt();
          }
        })
        .catch(attempt);
    })();
  } catch (e) {}
}

// Push the current watch total for a play to the server (only if it grew).
// `key` is the per-play watch-state key (the DB videoId for a single player,
// or `videoId::itemIndex` for one item inside a multiple player). The server
// is always told the real DB videoId so it can attribute the play.
window.__svpFlushWatch = function (key, beacon) {
  var st = window.__svpWatch[key];
  if (!st || !st.playId) return;
  var secs = Math.round(st.watched);
  if (secs <= st.sent) return;
  st.sent = secs;
  __svpSend(
    { videoId: st.videoId || key, playId: st.playId, watchedSeconds: secs },
    beacon,
  );
};

// Bind play-counting + watch-time accounting directly to a Plyr instance.
//
// One play session (one playId → one row on the server) spans from the first
// play until the video ENDS — pausing and resuming along the way is still the
// same play. Replaying after it ended opens a new session and counts again.
// In a multiple player every item has its own Plyr instance, so playing 10 of
// 100 videos records 10 plays and 50 records 50.
//
// `id` is the DB videoId (always sent to the server for attribution). `trackKey`
// keys the per-instance state — it defaults to `id`, and is `id::itemIndex` for
// one item of a multiple player so items are tracked independently.
window.__svpRegisterWatch = function (id, player, trackKey) {
  try {
    // Theme-editor preview: don't even bind the tracking handlers.
    if (window.__svpNoTrack) return;
    var key = trackKey || id;
    if (!id || !player) return;
    var st = (window.__svpWatch[key] = window.__svpWatch[key] || {
      watched: 0,
      lastT: null,
      sent: 0,
      bound: false,
    });
    st.videoId = id;
    // Binding is per Plyr INSTANCE, not just per key. A password-protected
    // video is built TWICE under the same key: a locked placeholder first,
    // then a real player once the password is accepted. With a plain `bound`
    // flag the second one — the only one that ever actually plays — stayed
    // permanently unbound, so no play and no watch time was ever recorded.
    if (st.bound && st.player === player) return;
    var isRebind = st.bound && st.player !== player;
    st.bound = true;
    st.player = player;
    if (isRebind) {
      // Drop any session the previous instance opened, or the stale playId
      // makes the new player's first real play look like a resume
      // (`st.playId && !st.ended`) and it gets skipped instead of counted.
      st.playId = null;
      st.ended = false;
      st.watched = 0;
      st.lastT = null;
      st.sent = 0;
    }

    player.on("play", function () {
      // Pause→resume belongs to the SAME play: while a session is open,
      // "play" just resumes it and must not count again. A new session (a
      // new row on the server) only opens on the first play, or when the
      // previous play actually finished and the visitor replays.
      if (st.playId && !st.ended) return;
      // Flush whatever was watched on the previous play before opening a new one.
      window.__svpFlushWatch(key, true);
      st.ended = false;
      st.playId =
        "p_" +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 10);
      st.watched = 0;
      st.lastT = null;
      st.sent = 0;
      __svpSend(
        {
          videoId: id,
          visitorId: window.__svpVisitorId,
          referrer: document.referrer || window.location.href,
          // The page the play happened on (used to attribute plays to the
          // product page vs. a single video player on other pages). In the
          // iframe embed the player runs on a helper URL, so prefer the page
          // that framed it — otherwise every embedded play would be filed
          // against /embed/<id> instead of the real product or landing page.
          pageUrl: window.__svpEmbedParent || window.location.href,
          playId: st.playId,
          watchedSeconds: 0,
        },
        false,
      );
    });

    player.on("timeupdate", function () {
      var t = player.currentTime;
      if (st.lastT != null) {
        var d = t - st.lastT;
        // Ignore seeks and large gaps; a normal tick is well under 2s.
        if (d > 0 && d < 2) st.watched += d;
      }
      st.lastT = t;
    });
    player.on("seeking", function () {
      st.lastT = null;
    });
    player.on("pause", function () {
      st.lastT = null;
      window.__svpFlushWatch(key, true);
    });
    player.on("ended", function () {
      st.lastT = null;
      // Mark the session finished so the NEXT play (a replay) counts as a
      // new play; until then pause/resume stays within this session.
      st.ended = true;
      window.__svpFlushWatch(key, true);
    });
  } catch (e) {}
};

// Back-compat shim: play tracking now lives inside __svpRegisterWatch (on the
// player's "play" event). Existing call sites may still call this; it's a no-op
// so they neither throw nor double-count.
window.__svpTrackPlay = function () {};

// Fullscreen and Picture-in-Picture are meant to be mutually exclusive, but
// Plyr's fullscreen button doesn't check PiP before requesting fullscreen —
// so going fullscreen while already in PiP leaves the OS-level floating PiP
// window on top of the fullscreen video. Exit PiP the moment fullscreen
// opens, so only the fullscreen view is visible.
// Let the VIEWER's caption choice stick.
//
// Plyr's settings menu applies a language with `player.currentTrack = i`, and
// that setter is `set(i, false)` followed by a full captions `setup()`.
// setup() re-derives the active language from
//     storage.get("language") || config.captions.language || "auto"
// and this app runs Plyr with `storage: { enabled: false }`, so there is
// nothing in storage — meaning the merchant's configured default is re-read
// and re-applied on EVERY selection, snapping the viewer back to it and
// making "Disabled" impossible (config.captions.active is re-read the same
// way). Keeping config in step with the live state makes that re-read agree
// with whatever the viewer just picked.
window.__svpKeepCaptionChoice = function (player) {
  try {
    if (!player) return;
    var sync = function () {
      try {
        if (!player.config || !player.config.captions) return;
        if (player.captions && player.captions.language) {
          player.config.captions.language = player.captions.language;
        }
        player.config.captions.active = !!(
          player.captions && player.captions.toggled
        );
      } catch (e) {}
    };
    // languagechange fires inside set() — before the setter calls setup() —
    // so the sync lands before setup() re-reads the config.
    player.on("languagechange", sync);
    player.on("captionsenabled", sync);
    player.on("captionsdisabled", sync);
  } catch (e) {}
};

window.__svpSyncFullscreenPip = function (player) {
  try {
    if (!player) return;
    player.on("enterfullscreen", function () {
      // `player.pip = false` (Plyr's own setter) exits PiP the correct way
      // for both the standard Picture-in-Picture API and Safari's
      // webkitSetPresentationMode fallback — plain
      // document.exitPictureInPicture() would miss the Safari case.
      if (player.pip) player.pip = false;
    });
  } catch (e) {}
};

// Flush every active play when the page is hidden or unloaded.
if (!window.__svpUnloadBound) {
  window.__svpUnloadBound = true;
  var flushAll = function () {
    try {
      Object.keys(window.__svpWatch || {}).forEach(function (id) {
        window.__svpFlushWatch(id, true);
      });
    } catch (e) {}
  };
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushAll();
  });
}

// Normalise any Vimeo link to the canonical embed form
// "https://player.vimeo.com/video/<id>".
//
// Merchants paste Vimeo URLs in many shapes — vimeo.com/123,
// www.vimeo.com/123, vimeo.com/channels/staffpicks/123, or an unlisted link
// vimeo.com/123/abcdef (and ?h=abcdef). Only the player.vimeo.com form is
// recognised by every branch downstream; anything else falls through to the
// HTML5 <video> path, which silently fails because a Vimeo page URL is not a
// media file. Converting once, up front, means every later check — and Plyr
// itself — sees a form it understands. The unlisted-video hash is preserved,
// otherwise private videos would 404.
function svpNormalizeVimeoUrl(url) {
  if (typeof url !== "string" || !/vimeo\.com/i.test(url)) return url;
  // Already canonical — leave it alone (keeps any existing query string).
  if (/player\.vimeo\.com\/video\/\d+/i.test(url)) return url;
  var match = url.match(/vimeo\.com\/(?:[\w-]+\/)*?(\d+)(?:\/([\da-f]+))?/i);
  if (!match) return url;
  var query = url.match(/[?&]h=([\da-f]+)/i);
  var hash = (query && query[1]) || match[2] || null;
  return (
    "https://player.vimeo.com/video/" + match[1] + (hash ? "?h=" + hash : "")
  );
}

// Normalise any YouTube link to the short canonical form
// "https://youtu.be/<id>".
//
// Provider detection downstream tests `startsWith("https://www.youtu")` /
// `startsWith("https://youtu")`, so mobile links (m.youtube.com), plain
// http://, and protocol-less pastes (www.youtube.com/..., youtube.com/...)
// all miss and fall through to the HTML5 <video> branch — where a YouTube
// page URL is not a media file, so nothing plays. Rewriting to one canonical
// form up front makes every later check, and Plyr, agree.
//
// Playlist/radio params (&list=, &start_radio=, &t=) are dropped on purpose:
// keeping them would make the embed load a whole mix instead of the single
// video the merchant picked.
function svpNormalizeYouTubeUrl(url) {
  if (typeof url !== "string") return url;
  if (!/(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(url))
    return url;
  var match =
    url.match(/youtu\.be\/([\w-]{11})/i) ||
    url.match(
      /youtube(?:-nocookie)?\.com\/(?:embed|v|shorts|live)\/([\w-]{11})/i,
    ) ||
    url.match(/[?&]v=([\w-]{11})/i);
  if (!match) return url;
  return "https://youtu.be/" + match[1];
}

// ── Input sanitising ─────────────────────────────────────────────────────
// Player settings typed by merchants are spliced into HTML, attribute and
// <style> strings below. None of them ever needs markup, so every record is
// cleaned once as it arrives (svpCleanVideo) and text is escaped where it is
// rendered (svpEsc): anything that looks like code shows as plain text and
// never runs. Mirrors app/utils/sanitize.js — keep the two in step.
var SVP_URL_KEYS = {
  url: 1, poster: 1, logo: 1, video: 1, src: 1, href: 1, link: 1, image: 1, thumbnail: 1,
};
var SVP_TEXT_KEYS = {
  text: 1, title: 1, buttonText: 1, message: 1, label: 1, name: 1, description: 1, placeholder: 1, alt: 1,
};
// Caption VTT (only ever used through a Blob URL) and the password are kept.
var SVP_RAW_KEYS = { content: 1, password: 1 };

function svpEsc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

// http(s), protocol-relative and relative links only; quote/bracket characters
// are percent-encoded so the URL can't close an attribute or a CSS url().
function svpSafeUrl(value) {
  if (typeof value !== "string") return "";
  var url = value.replace(/[\u0000- \u007f]/g, "");
  if (!url) return "";
  var scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !/^(https?|blob)$/i.test(scheme[1])) return "";
  return url.slice(0, 2048).replace(/["'<>`\\(){}]/g, function (c) {
    return "%" + ("0" + c.charCodeAt(0).toString(16).toUpperCase()).slice(-2);
  });
}

// Colours, sizes, units, class names, enum values.
function svpCssValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return isFinite(value) ? value : 0;
  return String(value)
    .replace(/\/\*|\*\//g, "")
    .replace(/url\s*\(|expression\s*\(|@import|javascript:/gi, "")
    .replace(/[<>"'`{};\\]/g, "")
    .slice(0, 200);
}

function svpCleanSettings(value, key, depth) {
  depth = depth || 0;
  if (depth > 10) return null;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (SVP_RAW_KEYS[key]) return value;
    if (SVP_URL_KEYS[key]) return svpSafeUrl(value);
    if (SVP_TEXT_KEYS[key]) return value.slice(0, 500); // escaped at render
    return svpCssValue(value);
  }
  if (typeof value === "number") return isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map(function (v) {
      return svpCleanSettings(v, key, depth + 1);
    });
  }
  if (typeof value === "object") {
    var out = {};
    Object.keys(value).forEach(function (k) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") return;
      out[k] = svpCleanSettings(value[k], k, depth + 1);
    });
    return out;
  }
  return null;
}

function svpCleanJsonColumn(value) {
  if (typeof value === "string") {
    try {
      var parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return svpCleanSettings(parsed, "");
    } catch (e) {}
    return {};
  }
  return svpCleanSettings(value, "");
}

// Clean a player record from the settings API (top-level columns included).
function svpCleanVideo(video) {
  if (!video || typeof video !== "object") return video;
  var out = {};
  Object.keys(video).forEach(function (k) {
    out[k] = video[k];
  });
  out.id = svpSafeId(video.id);
  if (typeof video.title === "string") out.title = video.title.slice(0, 500);
  if (typeof video.url === "string") out.url = svpSafeUrl(video.url);
  if (typeof video.poster === "string") out.poster = svpSafeUrl(video.poster);
  if (typeof video.videoType === "string") out.videoType = svpCssValue(video.videoType);
  if (typeof video.shop === "string") out.shop = svpCssValue(video.shop);
  ["controls", "styles", "options", "data"].forEach(function (k) {
    if (video[k] !== undefined) out[k] = svpCleanJsonColumn(video[k]);
  });
  return out;
}

// Player ids land in element ids, selectors and inline <style>; real ones are
// 24-char hex ObjectIds.
function svpSafeId(id) {
  return String(id === null || id === undefined ? "" : id).replace(/[^A-Za-z0-9_-]/g, "");
}

function htmlToElement(html) {
  // Create a temporary template element
  let temp = document.createElement("template");

  // Set the inner HTML of the template
  temp.innerHTML = html;

  // Return the first child of the template's content (the resulting element)
  return temp.content.firstChild;
}

function OverlayInit(index, rawOverlay, playerWrapper, isSmallOverlay = false) {
  // Every value escaped for the context it lands in (CSS / attribute / text).
  const overlay = {
    type: rawOverlay?.type,
    color: svpCssValue(rawOverlay?.color),
    fontSize: svpCssValue(rawOverlay?.fontSize),
    backgroundColor: svpCssValue(rawOverlay?.backgroundColor),
    opacity: svpCssValue(rawOverlay?.opacity),
    position: svpCssValue(rawOverlay?.position),
    url: svpEsc(svpSafeUrl(rawOverlay?.url)),
    logo: svpEsc(svpSafeUrl(rawOverlay?.logo)),
    text: svpEsc(rawOverlay?.text),
  };
  const overlayElement = `<div>
     <style>
              
              .overlay_item_${index} p{
                padding: 5px 12px;
                cursor: pointer;
              }
              .overlay_item_${index} p,
              .overlay_item_${index} img {
              color: ${overlay?.color || "#ffffff"};
              font-size: ${overlay?.fontSize || "16px"};
              background-color: ${overlay?.backgroundColor || "rgba(0, 0, 0, 0.5)"};
              border-radius: 3px;
              opacity: ${overlay?.opacity || "0.7"};
              overflow: hidden;
              display: block;
            }
            .overlay_item_${index} a {
              color: ${overlay?.color || "#ffffff"};
              font-size: ${overlay?.fontSize || "16px"};
            }
            .overlay_item_${index} p:hover,
            .overlay_item_${index} p:hover a,
            .overlay_item_${index} a:hover {
              background-color: ${overlay?.color || "rgba(255, 255, 255, 0.7)"};
              color: ${overlay?.backgroundColor || "#000000"};
            }
            
        .h5vp_overlay {
        position: absolute;
        z-index: 99;
      }
   .h5vp_overlay.overlay_item_${index} img {        
        max-width: ${isSmallOverlay ? "40px" : "70px"} !important;
        max-height: ${isSmallOverlay ? "40px" : "70px"} !important;
        width: 100%;
        height: 100%;
        object-fit: cover;
        overflow: hidden;
    }
   .h5vp_overlay a {
        text-decoration: none !important;
        cursor: pointer;
    }
   .h5vp_overlay p {
        margin: 0;
        cursor: pointer;
    }
    .h5vp_overlay.bottom_right {
        bottom: 10px;
        right: 10px;
    }
    .h5vp_overlay.top_right {
        top: 10px;
        right: 10px;
    }
    .h5vp_overlay.bottom_left {
        bottom: 10px;
        left: 10px;
    }
    .h5vp_overlay.top_left {
        top: 10px;
        left: 10px;
    }

            </style>
            <div class="h5vp_overlay ${overlay.position || "top_right"} overlay_item_${index}">
              ${
                overlay?.type == "text"
                  ? `
                <p>
                  ${
                    overlay?.url
                      ? `
                    <a href="${overlay?.url}" rel="noreferrer" target="_blank">
                     ${overlay.text}
                    </a>
                  `
                      : `
                    ${overlay?.text}
                  `
                  }
                </p>
              `
                  : overlay?.url
                    ? `
                <a class="background-transparent" href="${overlay?.url}" rel="noreferrer" target="_blank">
                  <img src="${overlay?.logo}" />
                </a>
              `
                    : `
                <img src="${overlay?.logo}" />
              `
              }
            </div>
    </div>`;

  const plyrEl = playerWrapper.querySelector(".plyr");

  if (plyrEl && htmlToElement(overlayElement) instanceof Node) {
    plyrEl.appendChild(htmlToElement(overlayElement));
  } else {
    console.error(
      "overlayElement is not a DOM node!",
      htmlToElement(overlayElement),
    );
  }
}

function watermarkInit(player, content, plyrWrapper, color) {
  let tag = "watermark";
  player.on("play", () => {
    const watermarkInterval = setInterval(() => {
      const watermarkElement = document.querySelector(tag);
      if (watermarkElement) {
        plyrWrapper.querySelector(".plyr").removeChild(watermarkElement);
      }
      tag = "watermark" + Math.round(Math.random() * 1000);
      const span = document.createElement(tag);
      span.setAttribute("style", "display: block !important");
      span.innerText = content;
      plyrWrapper.querySelector(".plyr").appendChild(span);
      span.innerText = content;
      span.setAttribute(
        "style",
        `position:absolute; display:block !important; opacity:1 !important;top: ${Math.round(Math.random() * 90)}% !important; left: ${Math.round(Math.random() * 70)}% !important; transform: none !important; z-index: 2147483647 !important; pointer-events: none !important`,
      );
      span.style.color = color;

      plyrWrapper.querySelector(".plyr").appendChild(span);
    }, 2000);

    player.on("pause", () => {
      setTimeout(() => {
        clearInterval(watermarkInterval);
        const watermarkElement = document.querySelector(tag);
        if (watermarkElement) {
          plyrWrapper.querySelector(".plyr").removeChild(watermarkElement);
        }
      }, 0);
    });
  });
}

function passwordProtectedOptionInit(id, index, passwordOption, plyrWrapper) {
  const plyrEl = plyrWrapper.querySelector(
    `#starVideoPlayer-${id}-${index} .plyr`,
  );

  if (plyrEl && htmlToElement(passwordOption) instanceof Node) {
    plyrEl.appendChild(htmlToElement(passwordOption));
  } else {
    console.error(
      "overlayElement is not a DOM node!",
      htmlToElement(passwordOption),
    );
  }
}

// ── Reporting a player that can't come up ────────────────────────────────
// Replaces the skeleton (or an already-built player) with a short message.
// Without this the two failure modes below are indistinguishable from a slow
// connection: the block just sits there, empty, forever.
function svpPlayerMessage(mount, title, detail) {
  if (!mount) return;
  try {
    var box = document.createElement("div");
    box.className = "svp-player-message";
    box.setAttribute(
      "style",
      "position:absolute;inset:0;z-index:5;display:flex;align-items:center;" +
        "justify-content:center;text-align:center;padding:16px;box-sizing:border-box;" +
        "background:#f6f6f7;color:#616161;font:13px/1.55 -apple-system," +
        "BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
    );
    box.innerHTML =
      '<div><div style="color:#202223;font-weight:600;margin-bottom:4px">' +
      title +
      "</div>" +
      (detail ? '<div style="opacity:.85">' + detail + "</div>" : "") +
      "</div>";
    // The skeleton loader, if it is still there, is what we are replacing.
    var wrapper = mount.querySelector(".wrapper");
    if (wrapper) wrapper.remove();
    if (getComputedStyle(mount).position === "static") {
      mount.style.position = "relative";
    }
    mount.style.display = "block";
    mount.appendChild(box);
  } catch (e) {}
}

// ── Silent decode failures ───────────────────────────────────────────────
// A <video> whose <source> the browser cannot decode fails with NO signal
// that ordinary error handling can see: the <source> element fires "error",
// media.networkState becomes NETWORK_NO_SOURCE (3) — and because the failure
// happened on a <source> child rather than on a direct src attribute, the
// media element itself never fires "error" and media.error stays null. Plyr
// has nothing to report either, so the block renders as an empty player with
// nothing in the console to explain it.
//
// That silence is why this reads as a browser bug. The usual cause is codec
// support, not a broken file or a broken URL: H.265/HEVC — what an iPhone
// records by default, and what Shopify serves back untranscoded when a clip
// is uploaded under Content > Files instead of as a Video — decodes in
// Safari but NOT in Chrome or Firefox. Same page, same URL, same settings:
// it plays on the merchant's Mac and is blank for every Chrome visitor.
function svpWatchMedia(media, mount, videoId) {
  if (!media || media.__svpWatched) return;
  media.__svpWatched = true;
  var done = false;

  function check() {
    if (done) return;
    // NETWORK_NO_SOURCE, or MEDIA_ERR_SRC_NOT_SUPPORTED on a direct src.
    var rejected =
      media.networkState === 3 || (media.error && media.error.code === 4);
    if (!rejected) return;
    done = true;

    var src = media.currentSrc || "";
    if (!src) {
      var s = media.querySelector("source");
      src = (s && s.getAttribute("src")) || "";
    }
    svpPlayerMessage(
      mount,
      "This video couldn\u2019t be played",
      "Please try again later, or use a different browser.",
    );

    // "Every source was rejected" covers two opposite problems \u2014 a file
    // this browser cannot decode, and a URL that is no longer there \u2014 and
    // they have opposite fixes. The media element cannot tell them apart, so
    // ask the network: if the file downloads fine, the format is the problem.
    var prefix =
      "[Video Player by bPlugins] Could not play video" +
      (videoId ? " (id " + videoId + ")" : "") +
      ": " +
      (src || "no source") +
      ". ";
    // If H.264 plays here the browser is healthy, so the file is the suspect.
    var playsH264 = false;
    try {
      playsH264 = !!media.canPlayType('video/mp4; codecs="avc1.42E01E"');
    } catch (e) {}
    var codecAdvice = playsH264
      ? "H.264/MP4 plays in this browser, so the file is in a format it does " +
        "not support \u2014 most often H.265/HEVC, which plays in Safari but " +
        "not in Chrome or Firefox. Re-encode it as H.264 MP4, or add it to " +
        "Shopify as a Video (Shopify transcodes those) instead of as a file " +
        "under Content > Files."
      : "No supported video format was found.";

    function report(reachability) {
      try {
        console.error(prefix + reachability + codecAdvice);
      } catch (e) {}
    }
    if (!src) {
      report("No source URL was set. ");
    } else {
      try {
        fetch(src, { method: "HEAD" })
          .then(function (r) {
            report(
              r.ok
                ? "The file downloads fine (HTTP " +
                    r.status +
                    "), so this is a format problem, not a broken link. "
                : "The file itself returned HTTP " +
                    r.status +
                    " \u2014 fix the video URL first. ",
            );
          })
          .catch(function () {
            // A blocked or opaque probe tells us nothing either way.
            report("");
          });
      } catch (e) {
        report("");
      }
    }
  }

  // A rejected <source> fires "error" on the <source>, not on the <video>.
  try {
    Array.prototype.forEach.call(
      media.querySelectorAll("source"),
      function (s) {
        s.addEventListener("error", function () {
          setTimeout(check, 0);
        });
      },
    );
  } catch (e) {}
  media.addEventListener("error", check);
  // Backstop: covers a source that was already rejected before these
  // listeners were attached, which leaves no event to wait for.
  setTimeout(check, 8000);
}

// ── Render players (re-runnable) ─────────────────────────────────────────
// Exposed as window.svpRefresh() for headless / SPA storefronts, where video
// elements can appear AFTER this script first runs (client-side route
// changes, lazy-loaded sections, modals). On a normal page load nothing
// changes: it is invoked exactly once, immediately, at the bottom of this
// file — same work, same order, same result as before.
//
// Elements that have already been rendered are marked with data-svp-init and
// skipped, so calling it again can never duplicate a player.
window.svpRefresh = function () {
  const svpFresh = Array.from(
    document.querySelectorAll(".video-plyr-by-bplugins"),
  ).filter((el) => !el.hasAttribute("data-svp-init"));
  // Nothing new on the page — don't fire a pointless request.
  if (!svpFresh.length) return;
  svpFresh.forEach((el) => el.setAttribute("data-svp-init", "1"));

  // Per-player DOM ids below are built from `${id}-${index}`. If the index
  // restarted at 0 on every pass, rendering the same video a second time
  // would generate an id that already exists, and querySelector would return
  // the FIRST player — leaving the newly added element empty. A running
  // total keeps every generated id unique for the life of the page.
  window.__svpRenderedCount = window.__svpRenderedCount || 0;
  const svpOffset = window.__svpRenderedCount;
  window.__svpRenderedCount += svpFresh.length;

  const videoPlyrElement = svpFresh;

  if (videoPlyrElement?.length >= 1) {
    /* cssInt(); */
    const ids = [];

    videoPlyrElement?.forEach((el) => {
      el.parentElement.style.width = "100%";
      const parent = el.parentElement?.parentElement;
      el.innerHTML = `
        <div class="wrapper">
    <div class="video-loader" aria-busy="true" aria-label="Loading video">
      <div class="vl-media">

        <div class="vl-play">
          <div class="vl-play-btn skel" aria-hidden="true"></div>
        </div>

        <div class="vl-controls" aria-hidden="true">
          <div class="vl-row">
            <div class="vl-left">
              <span class="ico skel"></span>
              <div class="vl-progress skel"></div>
            </div>

            <div class="vl-right">
              <div class="vl-time skel"></div>
              <span class="ico skel"></span>
              <span class="ico skel"></span>
              <span class="ico skel"></span>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
      `;
      if (parent) {
        parent.style.width = "100%";
      }
    });

    Array.from(videoPlyrElement).map((item) => {
      const id = svpSafeId(item.getAttribute("data-id"));
      ids.push(id);
    });

    fetch(
      `https://shopify-video-app.bplugins.com/app/api/video?ids=${JSON.stringify(ids)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    )
      .then((res) => {
        if (!res.ok)
          throw new Error("settings request failed: HTTP " + res.status);
        return res.json();
      })
      .then((datas) => {
        if (datas?.data?.length > 0) {
          Array.from(videoPlyrElement).map((item, __svpLocal) => {
            // Unique across refreshes — see svpOffset above.
            const index = __svpLocal + svpOffset;

            const id = svpSafeId(item.getAttribute("data-id"));
            ids.push(id);

            // Cleaned once here; everything below reads the cleaned copy.
            const data = svpCleanVideo(
              datas?.data?.find((item) => item.id == id),
            );

            // Do this BEFORE any provider detection below — those checks look for
            // "https://player.vimeo.com/video", so a plain vimeo.com link would
            // otherwise be treated as an HTML5 file and never play.
            if (data?.url) {
              data.url = svpNormalizeYouTubeUrl(svpNormalizeVimeoUrl(data.url));
            }

            let parsedOptions = data?.options || {};
            if (typeof parsedOptions === "string") {
              try {
                parsedOptions = JSON.parse(parsedOptions);
              } catch (e) {}
            }
            let parsedStyles = data?.styles || {};
            if (typeof parsedStyles === "string") {
              try {
                parsedStyles = JSON.parse(parsedStyles);
              } catch (e) {}
            }
            let parsedControls = data?.controls || {};
            if (typeof parsedControls === "string") {
              try {
                parsedControls = JSON.parse(parsedControls);
              } catch (e) {}
            }
            const style = parsedStyles;

            let controls = {
              controls: [
                "play",
                "progress",
                "current-time",
                "mute",
                "volume",
                "settings",
              ],
            };

            const controlsData = parsedControls;

            if (controlsData) {
              controls = {
                controls: [
                  controlsData?.playLarge && "play-large", // The large play button in the center
                  controlsData?.restart && "restart", // Restart playback
                  controlsData?.rewind && "rewind", // Rewind by the seek time (default 10 seconds)
                  controlsData?.play && "play", // Play/pause playback
                  controlsData?.fastForward && "fast-forward", // Fast forward by the seek time (default 10 seconds)
                  controlsData?.progress && "progress", // The progress bar and scrubber for playback and buffering
                  controlsData?.currentTime && "current-time", // The current time of playback
                  controlsData?.duration && "duration", // The full duration of the media
                  controlsData?.muted && "mute", // Toggle mute
                  controlsData?.volume && "volume", // Volume control
                  controlsData?.pip && "pip", // Picture-in-picture (currently Safari only)
                  controlsData?.airplay && "airplay", // Airplay (currently Safari only)
                  controlsData?.settings && "settings", // Settings menu
                  controlsData?.download && "download", // Show a download button with a link to either the current source or a custom URL you specify in your options
                  controlsData?.fullscreen && "fullscreen", // Toggle fullscreen
                ],
              };

              const getEmbedId = (url) => {
                if (!url) return "";
                const ytMatch = url.match(
                  /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/,
                );
                if (ytMatch) return ytMatch[1];
                const vimMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
                if (vimMatch) return vimMatch[1];
                return url.split("/")[4] || url.split("/")[3] || "";
              };

              function formatSpacingSize(SpacingSizeValue, device) {
                const values = SpacingSizeValue?.devices?.[device]?.values;
                const unit = SpacingSizeValue?.devices?.[device]?.unit;
                return `${values?.[0] + unit} ${values?.[1] + unit} ${values?.[2] + unit} ${values?.[3] + unit}`;
              }

              const borderRadius = `${formatSpacingSize(style?.borderRadius, "desktop")}`;

              let resolvedAutoHide = true;
              if (
                parsedOptions &&
                typeof parsedOptions.autoHideControls !== "undefined"
              ) {
                resolvedAutoHide = parsedOptions.autoHideControls;
              }

              const optionsBase = {
                autoplay: data?.autoPlay,
                controls: controls?.controls?.filter((item) => item !== false),
                debug: false,
                loop: { active: data?.repeat },
                muted: parsedOptions?.muted,
                playsInline: true,
                resetOnEnd: data?.resetOnEnd,
                hideControls: resolvedAutoHide,
                storage: { enabled: false },
              };

              const controlsByDevice = data?.data?.controlsByDevice;
              const activeDevice =
                window.innerWidth >= 1024
                  ? "desktop"
                  : window.innerWidth >= 768
                    ? "tablet"
                    : "mobile";

              if (controlsByDevice?.[activeDevice]) {
                const activeControls = [
                  controlsByDevice?.[activeDevice]?.playLarge && "play-large",
                  controlsByDevice?.[activeDevice]?.restart && "restart",
                  controlsByDevice?.[activeDevice]?.rewind && "rewind",
                  controlsByDevice?.[activeDevice]?.play && "play",
                  controlsByDevice?.[activeDevice]?.fastForward &&
                    "fast-forward",
                  controlsByDevice?.[activeDevice]?.progress && "progress",
                  controlsByDevice?.[activeDevice]?.currentTime &&
                    "current-time",
                  controlsByDevice?.[activeDevice]?.duration && "duration",
                  controlsByDevice?.[activeDevice]?.muted && "mute",
                  controlsByDevice?.[activeDevice]?.volume && "volume",
                  controlsByDevice?.[activeDevice]?.pip && "pip",
                  controlsByDevice?.[activeDevice]?.airplay && "airplay",
                  controlsByDevice?.[activeDevice]?.settings && "settings",
                  controlsByDevice?.[activeDevice]?.download && "download",
                  controlsByDevice?.[activeDevice]?.fullscreen && "fullscreen",
                ];
                optionsBase.controls = activeControls?.filter(
                  (item) => item !== false,
                );
              }

              // ── Captions / subtitles (Pro) ──
              // Tracks are stored as WebVTT TEXT (SRT is converted to VTT in the
              // admin, since no browser understands SRT). We turn each one into a
              // blob: URL — same-origin by definition, so <track> never hits the
              // cross-origin restriction that kills captions loaded from a CDN
              // without CORS headers.
              // Captions come from <track> elements inside an HTML5 <video>.
              // YouTube and Vimeo play through their own iframe embeds, which have
              // no <video> to attach tracks to (those platforms serve their own
              // captions), so skip captions entirely for them — otherwise a CC
              // button would appear that opens an empty language list.
              const svpIsEmbedProvider =
                data?.videoType === "youtube" ||
                data?.videoType === "vimeo" ||
                /youtube\.com|youtu\.be|vimeo\.com/i.test(data?.url || "");

              const captionsConfig = svpIsEmbedProvider
                ? null
                : data?.data?.captions;
              const captionTracks =
                captionsConfig?.enabled && Array.isArray(captionsConfig?.tracks)
                  ? captionsConfig.tracks.filter((t) => t && t.content)
                  : [];

              const captionTrackHtml = captionTracks
                .map((t, tIdx) => {
                  try {
                    const url = URL.createObjectURL(
                      new Blob([t.content], { type: "text/vtt" }),
                    );
                    const label = svpEsc(t.label || t.srclang || "Captions");
                    const lang = svpEsc(t.srclang || "en");
                    // Only the first track flagged default gets `default`, so the
                    // browser can't be handed two competing default tracks.
                    const isDefault =
                      t.default &&
                      captionTracks.findIndex((x) => x.default) === tIdx;
                    return `<track kind="captions" label="${label}" srclang="${lang}" src="${url}"${isDefault ? " default" : ""}>`;
                  } catch (e) {
                    return "";
                  }
                })
                .join("");

              if (captionTracks.length) {
                // Plyr needs a "captions" button in the controls list to expose the
                // CC toggle; append it only if the merchant's control set lacks it.
                if (
                  Array.isArray(optionsBase.controls) &&
                  !optionsBase.controls.includes("captions")
                ) {
                  optionsBase.controls.push("captions");
                }
                // The LANGUAGE picker lives in Plyr's settings menu, and that menu
                // only renders when "settings" is in the controls list. With more
                // than one language a viewer would otherwise be stuck with the
                // default track and no way to switch, so force the control on.
                if (
                  captionTracks.length > 1 &&
                  Array.isArray(optionsBase.controls) &&
                  !optionsBase.controls.includes("settings")
                ) {
                  optionsBase.controls.push("settings");
                }
                // Guarantee Captions is one of the settings-menu sections (this is
                // Plyr's default, but set it explicitly so the language list can't
                // be dropped by any other config).
                optionsBase.settings = Array.from(
                  new Set([
                    ...(optionsBase.settings || [
                      "captions",
                      "quality",
                      "speed",
                    ]),
                    "captions",
                  ]),
                );
                // Which language starts selected. This MUST be the merchant's
                // chosen default track, not Plyr's "auto" — "auto" resolves to the
                // VIEWER's browser language, and Plyr only enables captions when a
                // track matches it (`toggle(active && languageMatches)`). So with
                // "auto" a Hindi default track would be ignored on an English
                // browser, and skipped entirely on a browser whose language has no
                // track at all. Viewers can still switch language from the settings
                // menu, which lists every track.
                const defaultTrack =
                  captionTracks.find((t) => t.default) || captionTracks[0];
                optionsBase.captions = {
                  active: captionTracks.some((t) => t.default),
                  language: (defaultTrack?.srclang || "en").toLowerCase(),
                  // Keep true: Plyr rebuilds the settings-menu language list inside
                  // captions.update(), which only re-runs on "addtrack" when this is
                  // enabled. Without it a track that registers late (a large VTT
                  // file) would be missing from the language menu. The re-assertion
                  // update() also performs is neutralised by
                  // __svpKeepCaptionChoice() keeping config in sync with the viewer.
                  update: true,
                };
              }

              const isMultiplePlayer =
                data?.isMultiplePlayer ||
                data?.data?.isMultiplePlayer ||
                data?.data?.playerType === "multiple";

              if (isMultiplePlayer) {
                const multiItems =
                  data?.data?.items ||
                  data?.data?.multiItems ||
                  data?.multiItems ||
                  [];
                const gridSettings =
                  data?.data?.gridSettings || data?.gridSettings || {};
                const viewMode = gridSettings?.viewMode || "grid";
                const columnsDesktop = gridSettings?.columns?.desktop || 3;
                const columnsTablet = gridSettings?.columns?.tablet || 2;
                const columnsMobile = gridSettings?.columns?.mobile || 1;
                const gap = gridSettings?.gap || 16;
                const autoplay = gridSettings?.autoplay || false;
                const autopSpeed = (gridSettings?.autoplaySpeed || 3) * 1000;

                let containerStyles = `
            #audioPlayerContainer-${id} { width: 100%; display: flex; justify-content: center; }
            .multi-player-wrapper-${id} {
              width: ${data?.styles?.dimension?.devices?.desktop ? data?.styles?.dimension?.devices?.desktop?.values?.[1] + data?.styles?.dimension?.devices?.desktop?.unit : data?.styles?.width || "100%"};
              margin: ${data?.styles?.margin?.devices?.desktop ? formatSpacingSize(style?.margin, "desktop") : "0px auto"};
              padding: ${data?.styles?.padding?.devices?.desktop ? formatSpacingSize(style?.padding, "desktop") : "0px"};
              display: flex; 
              flex-direction: column; 
              gap: 0; 
              box-sizing: border-box;
              display: none;
            }

            .multi-player-wrapper-${id} .plyr__controls {
              padding: 0 !important;
            }

            @media (min-width: 768px) and (max-width: 1023px) {
              .multi-player-wrapper-${id} {
                 width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.tablet?.values?.[1] + data?.styles?.dimension?.devices?.tablet?.unit : data?.styles?.width || "100%"};
                 margin: ${data?.styles?.margin?.devices?.tablet ? formatSpacingSize(style?.margin, "tablet") : "0px auto"};
                 padding: ${data?.styles?.padding?.devices?.tablet ? formatSpacingSize(style?.padding, "tablet") : "0px"};
              }
            }
            @media (max-width: 767px) {
              .multi-player-wrapper-${id} {
                 width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.mobile?.values?.[1] + data?.styles?.dimension?.devices?.mobile?.unit : data?.styles?.width || "100%"};
                 margin: ${data?.styles?.margin?.devices?.mobile ? formatSpacingSize(style?.margin, "mobile") : "0px auto"};
                 padding: ${data?.styles?.padding?.devices?.mobile ? formatSpacingSize(style?.padding, "mobile") : "0px"};
              }
            }
            
            .multi-player-track-${id} { display: flex; gap: ${gap}px; box-sizing: border-box; width: 100%; }
            .multi-player-track-${id}.grid-view { display: grid; grid-template-columns: repeat(${columnsDesktop}, 1fr); }
            @media (min-width: 768px) and (max-width: 1023px) {
              .multi-player-track-${id}.grid-view { grid-template-columns: repeat(${columnsTablet}, 1fr); }
            }
            @media (max-width: 767px) {
              .multi-player-track-${id}.grid-view { grid-template-columns: repeat(${columnsMobile}, 1fr); }
            }
            
            .multi-player-track-${id}.carousel-view, .multi-player-track-${id}.slider-view {
               overflow-x: auto; scroll-snap-type: x mandatory; scroll-behavior: smooth;
               -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none; padding-bottom: 4px;
            }
            .multi-player-track-${id}.carousel-view::-webkit-scrollbar, .multi-player-track-${id}.slider-view::-webkit-scrollbar { display: none; }
            .multi-player-item-${id} { scroll-snap-align: start; min-width: 0; box-sizing: border-box; }
            .multi-player-track-${id}.carousel-view > .multi-player-item-${id} { flex: 0 0 calc(${100 / columnsDesktop}% - ${((columnsDesktop - 1) * gap) / columnsDesktop}px); }
            @media (min-width: 768px) and (max-width: 1023px) {
               .multi-player-track-${id}.carousel-view > .multi-player-item-${id} { flex: 0 0 calc(${100 / columnsTablet}% - ${((columnsTablet - 1) * gap) / columnsTablet}px); }
            }
            @media (max-width: 767px) {
               .multi-player-track-${id}.carousel-view > .multi-player-item-${id} { flex: 0 0 calc(${100 / columnsMobile}% - ${((columnsMobile - 1) * gap) / columnsMobile}px); }
            }
            .multi-player-track-${id}.slider-view > .multi-player-item-${id} { flex: 0 0 100%; }
            
            .nav-arrow-${id} {
               position: absolute; top: 44.5%; transform: translateY(-50%); width: 32px; height: 32px;
               border-radius: 50%; border: 1px solid #dfe3e8; background: #fff; cursor: pointer;
               display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,0.12); z-index: 5;
            }
            .nav-arrow-${id}.prev { left: -16px; }
            .nav-arrow-${id}.next { right: -16px; }
            .multi-dots-${id} { 
              display: flex; 
              justify-content: center; 
              flex-wrap: wrap; 
              gap: 8px; 
              margin: 6px auto 14px auto; 
              width: 100%; 
              align-items: center; 
            }
            .multi-dot-${id} { display: flex !important; flex: 0 0 10px; width: 10px; height: 10px; min-width: 10px; min-height: 10px; border-radius: 50%; background: #dfe3e8; cursor: pointer; transition: transform 0.3s ease, background 0.3s ease; display: inline-block; padding: 0; box-sizing: border-box; }
            .multi-dot-${id}.active { background: ${style?.brandColor || "#202223"}; transform: scale(1.2); }
            
            .multi-item-plyr-wrap-${id} {
               --plyr-color-main: ${style?.brandColor} !important;
               border-radius: ${data?.styles?.borderRadius?.devices?.desktop ? formatSpacingSize(style?.borderRadius, "desktop") : style?.borderRadius || "0px"};
               overflow: hidden; width: 100%;
               aspect-ratio: ${data?.styles?.videoRatio?.devices?.desktop?.values?.[0] + "/" + data?.styles?.videoRatio?.devices?.desktop?.values?.[1] || "16/9"};
               height: 100%; box-sizing: border-box;
            }
            .multi-item-plyr-wrap-${id} > .plyr { height: 100%; border-radius: inherit; }
            `;

                let itemsHtml = "";
                let dotsHtml = "";
                multiItems.forEach((mItem, mIdx) => {
                  // Grid items carry their own URLs, so normalise these too.
                  let vSource = svpNormalizeYouTubeUrl(
                    svpNormalizeVimeoUrl(mItem?.video || ""),
                  );
                  let pType = vSource.includes("youtu")
                    ? "youtube"
                    : vSource.includes("vimeo")
                      ? "vimeo"
                      : "html5";
                  let emId = getEmbedId(vSource);

                  itemsHtml += `<div class="multi-player-item-${id}">
                  <div class="multi-item-plyr-wrap-${id}" id="multi-wrap-${id}-${index}-${mIdx}">`;

                  if (pType === "html5") {
                    let isFirstAutoPlay =
                      mIdx === 0 && data?.autoPlay ? "autoplay muted" : "";
                    // An item with no url would render src="" — which the browser
                    // resolves to the page itself and rejects, tripping the decode
                    // reporter. No source at all is the honest representation.
                    itemsHtml += `<video id="player-${id}-${index}-${mIdx}" playsinline ${isFirstAutoPlay} data-poster="${mItem?.poster || ""}">
                     ${vSource ? `<source src="${vSource}" type="video/mp4" />` : ``}
                  </video>`;
                  } else {
                    itemsHtml += `<div id="player-${id}-${index}-${mIdx}" data-plyr-provider="${pType}" data-plyr-embed-id="${emId}"></div>`;
                  }
                  itemsHtml += `</div></div>`;
                });

                let wrapperHtml = `<style>${containerStyles}</style>
              <div id="audioPlayerContainer-${id}">
                <div class="multi-player-wrapper-${id}" style="position: relative;">
                   <div id="multi-track-${id}-${index}" class="multi-player-track-${id} ${viewMode}-view">
                      ${itemsHtml}
                   </div>
                   ${
                     viewMode === "carousel" || viewMode === "slider"
                       ? `
                       <button id="multi-prev-${id}-${index}" class="nav-arrow-${id} prev">
                         <svg width="14" height="14" viewBox="0 0 20 20" fill="#202223"><path d="M12.707 15.707a1 1 0 01-1.414 0L6.586 11a1.5 1.5 0 010-2.121l4.707-4.586a1 1 0 011.414 1.414L8.414 10l4.293 4.293a1 1 0 010 1.414z" /></svg>
                       </button>
                       <button id="multi-next-${id}-${index}" class="nav-arrow-${id} next">
                         <svg width="14" height="14" viewBox="0 0 20 20" fill="#202223"><path d="M7.293 4.293a1 1 0 011.414 0L13.414 9a1.5 1.5 0 010 2.121l-4.707 4.586a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" /></svg>
                       </button>
                       <div id="multi-dots-container-${id}-${index}" class="multi-dots-${id}">
                          ${dotsHtml}
                       </div>
                   `
                       : ""
                   }
                </div>
              </div>`;

                let videoElement = htmlToElement(`<div>${wrapperHtml}</div>`);
                item.appendChild(videoElement);

                setTimeout(() => {
                  const wrapper = item.querySelector(".wrapper");
                  const multiPlayerWrapper = item.querySelector(
                    `.multi-player-wrapper-${id}`,
                  );
                  if (wrapper) wrapper.remove();
                  if (multiPlayerWrapper)
                    multiPlayerWrapper.style.display = "block";

                  // ── Centralized auto-pause registry for this carousel ──
                  const allPlyrInstances = [];

                  // Players currently playing in picture-in-picture. While this is
                  // non-empty the carousel must hold still: the PiP window keeps
                  // playing detached from the page, so scrolling the track (or
                  // pausing its player) under it is never what the visitor wants.
                  const pipPlayers = new Set();
                  // Set by the autoplay block below, if autoplay is enabled.
                  let onPipStateChange = () => {};

                  const pauseAllPlayers = (exceptInstance) => {
                    allPlyrInstances.forEach((p) => {
                      try {
                        if (
                          p !== exceptInstance &&
                          !pipPlayers.has(p) &&
                          typeof p.pause === "function" &&
                          p.playing
                        ) {
                          p.pause();
                        }
                      } catch (e) {
                        /* ignore destroyed players */
                      }
                    });
                  };

                  if (viewMode === "carousel" || viewMode === "slider") {
                    const track = document.getElementById(
                      `multi-track-${id}-${index}`,
                    );
                    const prevBtn = document.getElementById(
                      `multi-prev-${id}-${index}`,
                    );
                    const nextBtn = document.getElementById(
                      `multi-next-${id}-${index}`,
                    );

                    const getCols = () => {
                      if (window.innerWidth >= 1024) return columnsDesktop;
                      if (window.innerWidth >= 768) return columnsTablet;
                      return columnsMobile;
                    };
                    const getShift = () => track.offsetWidth;

                    const dotsContainer = document.getElementById(
                      `multi-dots-container-${id}-${index}`,
                    );
                    let currentDotsCount = 0;
                    let dotsNodes = [];

                    const updateDots = () => {
                      if (!dotsNodes.length || !track) return;
                      const shift = getShift();
                      if (shift <= 0) return;
                      let activeIndex = Math.round(track.scrollLeft / shift);

                      if (
                        Math.ceil(track.scrollLeft + track.clientWidth) >=
                        track.scrollWidth - 10
                      ) {
                        activeIndex = dotsNodes.length - 1;
                      }
                      dotsNodes.forEach((dot, dIdx) => {
                        if (dIdx === activeIndex) dot.classList.add("active");
                        else dot.classList.remove("active");
                      });
                    };

                    const renderDots = () => {
                      if (!dotsContainer || !track) return;
                      const cols = viewMode === "carousel" ? getCols() : 1;
                      const newDotsCount = Math.ceil(multiItems.length / cols);

                      if (currentDotsCount !== newDotsCount) {
                        let newDotsHtml = "";
                        const activeIndex =
                          getShift() > 0
                            ? Math.round(track.scrollLeft / getShift())
                            : 0;
                        for (let i = 0; i < newDotsCount; i++) {
                          newDotsHtml += `<div class="multi-dot-${id} ${i === activeIndex ? "active" : ""}" data-idx="${i}"></div>`;
                        }
                        dotsContainer.innerHTML = newDotsHtml;
                        currentDotsCount = newDotsCount;
                        dotsNodes = dotsContainer.querySelectorAll(
                          `.multi-dot-${id}`,
                        );

                        dotsNodes.forEach((dot, dIdx) => {
                          dot.addEventListener("click", () => {
                            pauseAllPlayers(); // ← pause all on dot click
                            track.scrollTo({
                              left: getShift() * dIdx,
                              behavior: "smooth",
                            });
                          });
                        });
                      }
                    };

                    renderDots();
                    window.addEventListener("resize", () => {
                      clearTimeout(window._resTimer_multiPlay);
                      window._resTimer_multiPlay = setTimeout(renderDots, 150);
                    });

                    if (track && prevBtn && nextBtn) {
                      // ── Debounced scroll listener pauses all players ──
                      let _scrollPauseTimer = null;
                      track.addEventListener("scroll", () => {
                        updateDots();
                        clearTimeout(_scrollPauseTimer);
                        _scrollPauseTimer = setTimeout(() => {
                          pauseAllPlayers();
                        }, 150);
                      });

                      prevBtn.addEventListener("click", () => {
                        pauseAllPlayers(); // ← pause all on prev click
                        if (track.scrollLeft <= 0) {
                          track.scrollTo({
                            left: track.scrollWidth - track.clientWidth,
                            behavior: "smooth",
                          });
                        } else {
                          track.scrollBy({
                            left: -getShift(),
                            behavior: "smooth",
                          });
                        }
                      });
                      nextBtn.addEventListener("click", () => {
                        pauseAllPlayers(); // ← pause all on next click
                        if (
                          track.scrollLeft + track.clientWidth >=
                          track.scrollWidth - 10
                        ) {
                          track.scrollTo({ left: 0, behavior: "smooth" });
                        } else {
                          track.scrollBy({
                            left: getShift(),
                            behavior: "smooth",
                          });
                        }
                      });

                      if (autoplay) {
                        let autoInterval = null;
                        let isHovering = false;

                        const advance = () => {
                          pauseAllPlayers(); // ← pause all on auto-scroll
                          if (
                            track.scrollLeft + track.clientWidth >=
                            track.scrollWidth - 10
                          ) {
                            track.scrollTo({ left: 0, behavior: "smooth" });
                          } else {
                            track.scrollBy({
                              left: getShift(),
                              behavior: "smooth",
                            });
                          }
                        };
                        const stopAuto = () => {
                          if (autoInterval) {
                            clearInterval(autoInterval);
                            autoInterval = null;
                          }
                        };
                        // Only runs when nothing is holding the carousel: not
                        // hovered, and no item playing in picture-in-picture.
                        const startAuto = () => {
                          if (autoInterval || isHovering || pipPlayers.size > 0)
                            return;
                          autoInterval = setInterval(advance, autopSpeed);
                        };

                        startAuto();
                        track.parentElement.addEventListener(
                          "mouseenter",
                          () => {
                            isHovering = true;
                            stopAuto();
                          },
                        );
                        track.parentElement.addEventListener(
                          "mouseleave",
                          () => {
                            isHovering = false;
                            startAuto();
                          },
                        );

                        onPipStateChange = () => {
                          if (pipPlayers.size > 0) stopAuto();
                          else startAuto();
                        };
                      }
                    }
                  }

                  multiItems.forEach((mItem, mIdx) => {
                    let options = {
                      ...optionsBase,
                      poster: mItem?.poster,
                      autoplay: mIdx === 0 ? data?.autoPlay : false,
                    };

                    // Autoplay only survives browser policy while the video is
                    // MUTED. The <video> tag already carries `muted`, but Plyr
                    // re-applies its own config.muted right after init — so when
                    // the merchant leaves "Muted" off, Plyr unmutes the video and
                    // the browser blocks the autoplay. Chrome often let it through
                    // anyway (its Media Engagement Index permits unmuted autoplay
                    // on sites the visitor has played media on), which is why this
                    // looked Chrome-only. Force muted for the autoplaying item,
                    // exactly as the single-video player does.
                    const isAutoplayItem =
                      mIdx === 0 && Boolean(data?.autoPlay);
                    if (isAutoplayItem) options.muted = true;

                    let isYouTubeOrVimeo =
                      mItem?.video?.includes("youtube") ||
                      mItem?.video?.includes("youtu.be") ||
                      mItem?.video?.includes("vimeo");
                    if (isYouTubeOrVimeo && options.controls) {
                      options.controls = options.controls.filter(
                        (c) => c !== "pip" && c !== "download",
                      );
                    }

                    let plyrItem = new Plyr(
                      `#player-${id}-${index}-${mIdx}`,
                      options,
                    );

                    // Belt and braces, mirroring the single-video player: re-assert
                    // the autoplay-safe state once Plyr is ready and kick off
                    // playback explicitly, since Plyr's own autoplay can be
                    // rejected silently by the browser's policy.
                    if (isAutoplayItem) {
                      plyrItem.on("ready", () => {
                        try {
                          plyrItem.muted = true;
                          plyrItem.volume = 0;
                          setTimeout(() => {
                            const played = plyrItem.play();
                            if (played && typeof played.catch === "function")
                              played.catch(() => {});
                          }, 500);
                        } catch (e) {}
                      });
                    }
                    let plyrWrapper = document.getElementById(
                      `multi-wrap-${id}-${index}-${mIdx}`,
                    );

                    // Same silent decode failure as the single player — an item
                    // the browser can't play is otherwise just a black tile.
                    if (!isYouTubeOrVimeo) {
                      svpWatchMedia(
                        plyrItem?.media ||
                          document.getElementById(
                            `player-${id}-${index}-${mIdx}`,
                          ),
                        plyrWrapper,
                        id,
                      );
                    }

                    // ── Register this player in the auto-pause registry ──
                    allPlyrInstances.push(plyrItem);

                    // ── Freeze the carousel while this item is in picture-in-picture ──
                    // Both the Plyr event and the raw media events are wired up
                    // (Safari only reports PiP through webkitpresentationmodechanged);
                    // setPipState dedupes so a double report is harmless.
                    const setPipState = (active) => {
                      const wasActive = pipPlayers.has(plyrItem);
                      if (active === wasActive) return;
                      if (active) pipPlayers.add(plyrItem);
                      else pipPlayers.delete(plyrItem);
                      onPipStateChange();
                    };
                    try {
                      plyrItem.on("enterpictureinpicture", () =>
                        setPipState(true),
                      );
                      plyrItem.on("leavepictureinpicture", () =>
                        setPipState(false),
                      );
                    } catch (e) {}
                    const pipMediaEl =
                      plyrItem?.media ||
                      document.getElementById(`player-${id}-${index}-${mIdx}`);
                    if (pipMediaEl && pipMediaEl.tagName === "VIDEO") {
                      pipMediaEl.addEventListener("enterpictureinpicture", () =>
                        setPipState(true),
                      );
                      pipMediaEl.addEventListener("leavepictureinpicture", () =>
                        setPipState(false),
                      );
                      pipMediaEl.addEventListener(
                        "webkitpresentationmodechanged",
                        () => {
                          setPipState(
                            pipMediaEl.webkitPresentationMode ===
                              "picture-in-picture",
                          );
                        },
                      );
                    }

                    plyrItem.on("ready", () => {
                      if (data?.data?.overlay?.enabled && plyrWrapper) {
                        const getColsActive = () => {
                          if (window.innerWidth >= 1024) return columnsDesktop;
                          if (window.innerWidth >= 768) return columnsTablet;
                          return columnsMobile;
                        };
                        let isSmallOverlay =
                          getColsActive() > 1 &&
                          data?.data?.gridSettings?.viewMode === "carousel";
                        if (
                          (data?.data?.gridSettings?.viewMode === "grid" &&
                            getColsActive() > 1) ||
                          window.innerWidth < 768
                        ) {
                          isSmallOverlay = true;
                        }
                        OverlayInit(
                          `${index}-${mIdx}`,
                          data?.data?.overlay,
                          plyrWrapper,
                          isSmallOverlay,
                        );
                      }
                      if (data?.data?.watermark?.enabled && plyrWrapper) {
                        watermarkInit(
                          plyrItem,
                          data?.data?.watermark?.type == "domain"
                            ? window.__svpShopDomain
                            : data?.data?.watermark?.text,
                          plyrWrapper,
                          data?.data?.watermark?.color || "#ff0000ff",
                        );
                      }
                    });
                    // Poster styling, injected ONCE and synchronously.
                    //
                    // The hide-while-playing rule used to be added inside a 'play'
                    // handler, which is a race: a <video autoplay muted> can start
                    // playing before Plyr binds its listeners (Firefox does this
                    // reliably), so the event was missed, the rule was never added,
                    // and the poster — forced visible by the rule below — sat on
                    // top of the playing video. The video was running fine; it just
                    // looked frozen. Calling play() again doesn't help either,
                    // since 'play' doesn't re-fire on an already-playing video.
                    // The rule is scoped to .plyr--playing, so it only takes effect
                    // during playback and needs no event at all. Injecting once
                    // also stops the old code appending a new <style> node on every
                    // single play.
                    {
                      const wrapSel = `#multi-wrap-${id}-${index}-${mIdx}`;
                      const styleNode = document.createElement("style");
                      styleNode.innerHTML = `
                       ${mItem?.poster ? `${wrapSel} .plyr__poster { background-image: url('${mItem.poster}') !important; background-size: cover; display: block; opacity: 1 !important; transform: none !important; }` : ``}
                       ${wrapSel} .plyr--playing .plyr__poster { display: none !important; opacity: 0 !important; visibility: hidden !important; }
                    `;
                      document.head.appendChild(styleNode);
                    }

                    // ── Auto-pause: when THIS video plays, pause all OTHERS ──
                    plyrItem.on("play", () => {
                      pauseAllPlayers(plyrItem);
                    });

                    // ── Analytics: record the play ──
                    // Each item in a multiple player counts as its own play, so we
                    // dedupe/track per item (`id::mIdx`) while still attributing the
                    // play to the player's DB videoId (`id`) on the server.
                    var __svpItemKey = id + "::" + mIdx;
                    plyrItem.on("play", () => {
                      if (window.__svpTrackPlay)
                        window.__svpTrackPlay(id, __svpItemKey);
                    });
                    if (window.__svpRegisterWatch)
                      window.__svpRegisterWatch(id, plyrItem, __svpItemKey);
                    if (window.__svpSyncFullscreenPip)
                      window.__svpSyncFullscreenPip(plyrItem);
                  });
                }, 500);
                return;
              }
              const modalElementString = `<div>
        <style>
          :root {
          }
          #audioPlayerContainer-${id} {
            display: flex; 
            justify-content: center;
            align-items: center;
            width: 100%;
            margin: ${data?.styles?.margin?.devices?.desktop ? formatSpacingSize(style?.margin, "desktop") : "0px"};
            padding: ${data?.styles?.padding?.devices?.desktop ? formatSpacingSize(style?.padding, "desktop") : "0px"};
          }
           
           #audioPlayerContainer-${id} video {
             width: 100% !important;
             max-width: 100% !important;
            }
          
          #starVideoPlayer-${id}-${index} {
            --plyr-color-main: ${style?.brandColor} !important;
              display: none;
              overflow: hidden;
              width: ${data?.styles?.dimension?.devices?.desktop ? data?.styles?.dimension?.devices?.desktop?.values?.[1] + data?.styles?.dimension?.devices?.desktop?.unit : data?.styles?.width || "100%"};
              aspect-ratio: ${data?.styles?.videoRatio?.devices?.desktop?.values?.[0] + "/" + data?.styles?.videoRatio?.devices?.desktop?.values?.[1] || "16/9"};
              position: relative;
              border-radius: ${data?.styles?.borderRadius?.devices?.desktop ? formatSpacingSize(style?.borderRadius, "desktop") : data?.style?.borderRadius || "0px"};
              ${data?.data?.passwordProtected?.enabled ? "min-height: 260px;" : ""}
            }
            ${data?.data?.passwordProtected?.enabled ? ` #starVideoPlayer-${id}-${index} .plyr {height: 100%}` : ""}

            #starVideoPlayer-${id}-${index}  > .plyr {
              width: 100%;
              height: 100%;
            }

            @media (min-width: 768px) and (max-width: 1023px) {
              #audioPlayerContainer-${id} {
                margin: ${data?.styles?.margin?.devices?.tablet ? formatSpacingSize(style?.margin, "tablet") : "20px"};
                padding: ${data?.styles?.padding?.devices?.tablet ? formatSpacingSize(style?.padding, "tablet") : "20px"};
                width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.tablet?.values?.[1] + data?.styles?.dimension?.devices?.tablet?.unit : data?.styles?.width || "100%"};
                aspect-ratio: ${data?.styles?.videoRatio?.devices?.tablet?.values?.[0] + "/" + data?.styles?.videoRatio?.devices?.tablet?.values?.[1] || "16/9"};
              }
              #starVideoPlayer-${id}-${index} {
                border-radius: ${style?.borderRadius?.devices?.desktop ? formatSpacingSize(style?.borderRadius, "tablet") : style?.borderRadius};
                width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.tablet?.values?.[1] + data?.styles?.dimension?.devices?.tablet?.unit : data?.styles?.width || "100%"};
                aspect-ratio: ${data?.styles?.videoRatio?.devices?.tablet?.values?.[0] + "/" + data?.styles?.videoRatio?.devices?.tablet?.values?.[1] || "16/9"};
              }
            }
            @media (max-width: 767px) {
              #audioPlayerContainer-${id} {
                margin: ${data?.styles?.margin?.devices?.mobile ? formatSpacingSize(style?.margin, "mobile") : "0px"};
                padding: ${data?.styles?.padding?.devices?.mobile ? formatSpacingSize(style?.padding, "mobile") : "0px"};
                width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.mobile?.values?.[1] + data?.styles?.dimension?.devices?.mobile?.unit : data?.styles?.width || "100%"};
                aspect-ratio: ${data?.styles?.videoRatio?.devices?.mobile?.values?.[0] + "/" + data?.styles?.videoRatio?.devices?.mobile?.values?.[1] || "16/9"};
              }
              #starVideoPlayer-${id}-${index} {
                display: none;
                border-radius: ${style?.borderRadius?.devices?.desktop ? formatSpacingSize(style?.borderRadius, "mobile") : style?.borderRadius};
                width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.mobile?.values?.[1] + data?.styles?.dimension?.devices?.mobile?.unit : data?.styles?.width || "100%"};
                aspect-ratio: ${data?.styles?.videoRatio?.devices?.mobile?.values?.[0] + "/" + data?.styles?.videoRatio?.devices?.mobile?.values?.[1] || "16/9"};
              }
            }

          </style>
          <div id="audioPlayerContainer-${id}">
          <div
            id="starVideoPlayer-${id}-${index}"
          >
            <video ${data?.autoPlay ? "playsinline autoplay" : "playsinline"} ${data?.options?.muted ? "webkit-playsinline muted" : "webkit-playsinline"} id="player-${id}-${index}"
              data-poster="${data?.poster || ""}"
            >
              ${
                /* A password-protected video reaches the storefront with url
                    and poster stripped. An unquoted `src=${data?.url}` wrote
                    the literal string "null", which the browser resolved
                    against the shop domain and fetched as /null (404), so the
                    locked placeholder looked like a broken video. */ ""
              }
              ${data?.url ? `<source src="${data.url}" type="video/mp4" />` : ``}
              ${captionTrackHtml}
              </video>
             
              
          </div>
              
          </div>
          </div>`;

              const modalElementStringYouTube = `<div>
        <style>
          :root {
          }
           #audioPlayerContainer-${id} {
            display: flex; 
            justify-content: center;
            align-items: center;
            width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.tablet?.values?.[1] + data?.styles?.dimension?.devices?.tablet?.unit : data?.styles?.width || "100%"};
            margin: 0;
          }
          #starVideoPlayer-${id}-${index} {
            display: none;
            --plyr-color-main: ${style?.brandColor} !important;
              border-radius: ${style?.borderRadius?.devices?.desktop ? formatSpacingSize(style?.borderRadius, "desktop") : style?.borderRadius};
              overflow: hidden;
              width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.desktop?.values?.[1] + data?.styles?.dimension?.devices?.desktop?.unit : data?.styles?.width || "100%"};
              margin: ${data?.styles?.margin?.devices?.desktop ? formatSpacingSize(style?.margin, "desktop") : "0px"};
              padding: ${data?.styles?.padding?.devices?.desktop ? formatSpacingSize(style?.padding, "desktop") : "0px"};
            }
            
            #starVideoPlayer-${id}-${index} > .plyr {
                border-radius: ${
                  style?.borderRadius?.devices
                    ? formatSpacingSize(style.borderRadius, "desktop")
                    : style?.borderRadius || "0px"
                };
              }


            #starVideoPlayer-${id}-${index} .plyr__video-embed {
              aspect-ratio: ${data?.styles?.videoRatio?.devices?.desktop?.values?.[0] + "/" + data?.styles?.videoRatio?.devices?.desktop?.values?.[1] || "16/9"} !important;
            }

            @media (min-width: 768px) and (max-width: 1024px) {
              #audioPlayerContainer-${id} {
                width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.tablet?.values?.[1] + data?.styles?.dimension?.devices?.tablet?.unit : data?.styles?.width || "100%"};
              }
              #starVideoPlayer-${id}-${index} {
                width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.tablet?.values?.[1] + data?.styles?.dimension?.devices?.tablet?.unit : data?.styles?.width || "100%"};
              }
              #starVideoPlayer-${id}-${index} .plyr__video-embed {
              aspect-ratio: ${data?.styles?.videoRatio?.devices?.tablet?.values?.[0] + "/" + data?.styles?.videoRatio?.devices?.tablet?.values?.[1] || "16/9"} !important;
            }
            }
            @media (max-width: 767px) {
              #audioPlayerContainer-${id} {
                width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.mobile?.values?.[1] + data?.styles?.dimension?.devices?.mobile?.unit : data?.styles?.width || "100%"};
              }
              #starVideoPlayer-${id}-${index} {
                width: ${data?.styles?.dimension?.devices ? data?.styles?.dimension?.devices?.mobile?.values?.[1] + data?.styles?.dimension?.devices?.mobile?.unit : data?.styles?.width || "100%"};
              }
              #starVideoPlayer-${id}-${index} .plyr__video-embed {
              aspect-ratio: ${data?.styles?.videoRatio?.devices?.mobile?.values?.[0] + "/" + data?.styles?.videoRatio?.devices?.mobile?.values?.[1] || "16/9"} !important;
            }
            }
          </style>
          <div id="audioPlayerContainer-${id}"  style="position: relative;">
          <div
            id="starVideoPlayer-${id}-${index}"
          >
           <div id="player-${id}-${index}" data-plyr-provider="${
             data?.videoType == "youtube" ||
             data?.url?.startsWith("https://youtu") ||
             data?.url?.startsWith("https://www.youtube")
               ? "youtube"
               : "vimeo"
           }" data-plyr-embed-id="${getEmbedId(data?.url)}"></div>
          </div>
          </div>`;

              let videoElement = null;

              if (!data?.url) {
                videoElement = htmlToElement(modalElementString);
              } else if (
                data?.videoType == "youtube" ||
                data?.url?.startsWith("https://www.youtu") ||
                data?.url?.startsWith("https://youtu")
              ) {
                videoElement = htmlToElement(modalElementStringYouTube);
              } else if (
                data?.videoType == "vimeo" ||
                data?.url?.startsWith("https://vimeo") ||
                data?.url?.startsWith("https://player.vimeo.com/video")
              ) {
                videoElement = htmlToElement(modalElementStringYouTube);
              } else {
                videoElement = htmlToElement(modalElementString);
              }

              /* const stylesElement = htmlToElement(styles); */

              item.appendChild(videoElement);
              const options = {
                ...optionsBase,
                poster: data?.poster,
                // Let keyboard shortcuts (space, arrows, f, m, etc.) drive the player
                // even when focus isn't precisely inside it — single product player.
                keyboard: { focused: true, global: true },
              };

              const isYouTubeOrVimeo =
                data?.videoType === "youtube" ||
                data?.videoType === "vimeo" ||
                data?.url?.includes("youtube") ||
                data?.url?.includes("youtu.be") ||
                data?.url?.includes("vimeo");

              if (isYouTubeOrVimeo && options.controls) {
                options.controls = options.controls.filter(
                  (c) => c !== "pip" && c !== "download",
                );
              }

              const shouldResetOnEnd = Boolean(data?.resetOnEnd);

              const attachResetOnEnd = (playerInstance) => {
                if (!shouldResetOnEnd || !playerInstance) {
                  return;
                }

                playerInstance.on("ended", () => {
                  playerInstance.stop();
                  if (playerInstance.elements?.poster) {
                    playerInstance.elements.poster.style.display = "block";
                  }
                });
              };

              const player = new Plyr(`#player-${id}-${index}`, options);

              const plyrWrapper = document.getElementById(
                `starVideoPlayer-${id}-${index}`,
              );

              // A password-protected video is still LOCKED while the settings
              // API withholds the url (it strips url/poster/password until the
              // password is accepted), so this `player` is an empty <video>
              // placeholder rather than the real video.
              const svpIsLocked =
                !!data?.data?.passwordProtected?.enabled && !data?.url;

              // Report a file this browser cannot decode (see svpWatchMedia) rather
              // than leaving an empty player behind. A locked placeholder has no
              // source at all by design: watching it painted "This video couldn't
              // be played" over the password form (z-index 5 vs 2), leaving the
              // visitor no way to unlock it. It is watched after unlock instead.
              if (!isYouTubeOrVimeo && !svpIsLocked) {
                svpWatchMedia(
                  player?.media ||
                    document.getElementById(`player-${id}-${index}`),
                  plyrWrapper,
                  id,
                );
              }

              // The container is hidden by the stylesheet above and is un-hidden
              // only from Plyr's "ready" event. For a YouTube/Vimeo embed that
              // event waits on the provider's own API script, so anything that
              // stops that script — a blocker, a network policy — used to hide the
              // block permanently with no error. Reveal it regardless after a few
              // seconds; "ready" still does it first on a normal load.
              setTimeout(() => {
                if (plyrWrapper && plyrWrapper.style.display !== "block") {
                  plyrWrapper.style.display = "block";
                  const stuck = item.querySelector(".wrapper");
                  if (stuck) stuck.remove();
                }
              }, 8000);

              const passwordOverlayHtml = `<div id="videoPasswordWrapper-${id}-${index}" style="position: absolute; top:0; left:0; right:0; bottom:0; background: rgba(0,0,0,0.5); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; animation: vpFadeIn 0.4s ease-out forwards;">
              <style>
                #starVideoPlayer-${id}-${index} .plyr__control--overlaid {
                  display: none !important;
                }
                
                @keyframes vpFadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes vpSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
                @keyframes vpLockPulse { 0% { transform: scale(1); } 50% { transform: scale(1.1); } 100% { transform: scale(1); } }
                @keyframes vpSpin { 100% { transform: rotate(360deg); } }
                
                #videoPasswordWrapper-${id}-${index} .password-card {
                  background: rgba(255, 255, 255, 0.98); 
                  padding: 18px 20px; 
                  border-radius: 14px; 
                  box-shadow: 0 18px 38px -12px rgba(0,0,0,0.3); 
                  text-align: center; 
                  max-width: 300px; 
                  width: 90%;
                  animation: vpSlideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                  border: 1px solid rgba(255,255,255,0.4);
                }
                #videoPasswordWrapper-${id}-${index} .lock-icon {
                  width: 36px;
                  height: 36px;
                  background: #eef9f3;
                  border-radius: 50%;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  margin: 0 auto 10px auto;
                  color: #1a8d5a;
                  animation: vpLockPulse 2.5s infinite ease-in-out;
                }
                #videoPasswordWrapper-${id}-${index} .password-card h2 {
                  font-size: 17px; font-weight: 700; font-family: Roboto, sans-serif !important; color: #111827; margin: 0 0 4px 0; letter-spacing: -0.3px;
                }
                #videoPasswordWrapper-${id}-${index} .password-card p.subtitle {
                  font-size: 12px; font-family: Roboto, sans-serif !important; color: #6b7280; margin: 0 0 12px 0; line-height: 1.35;
                }
                #videoPasswordWrapper-${id}-${index} .password-form {
                  display: flex; flex-direction: column; gap: 6px; width: 100%;
                }
                #videoPasswordWrapper-${id}-${index} input {
                  width: 100%; padding: 8px 12px; font-size: 13px; border: 1.5px solid #e5e7eb; border-radius: 8px; outline: none; background: #f9fafb; color: #111827; transition: all 0.3s ease; box-sizing: border-box;
                }
                #videoPasswordWrapper-${id}-${index} input:focus {
                  border-color: #1a8d5a; background: #ffffff; box-shadow: 0 0 0 2.5px rgba(26, 141, 90, 0.15);
                }
                #videoPasswordWrapper-${id}-${index} button {
                  width: 100%; padding: 8px 16px; font-size: 13px; font-weight: 600; background: #1a8d5a; color: #ffffff; border: none; border-radius: 8px; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 4px 6px -1px rgba(26, 141, 90, 0.2);
                }
                #videoPasswordWrapper-${id}-${index} button:hover {
                  background: #15734a; transform: translateY(-1px); box-shadow: 0 6px 10px -3px rgba(26, 141, 90, 0.3);
                }
                #videoPasswordWrapper-${id}-${index} button:active {
                  transform: translateY(0); box-shadow: 0 2px 4px -1px rgba(26, 141, 90, 0.2);
                }
                @media (max-width: 480px) {
                  #videoPasswordWrapper-${id}-${index} .password-card {
                    padding: 16px 14px;
                    width: 92%;
                  }
                  #videoPasswordWrapper-${id}-${index} h2 {
                    font-size: 15px;
                  }
                  #videoPasswordWrapper-${id}-${index} .lock-icon {
                    width: 32px; height: 32px; margin-bottom: 8px;
                  }
                }
              </style>
              <div class="password-card">
                <div class="lock-icon">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </div>
                <h2>${svpEsc(data?.data?.passwordProtected?.title)}</h2>
                <p class="subtitle">This video is private. Please enter the password to view it.</p>
                <div class="password-form">
                  <div style="position: relative; width: 100%;">
                    <input type="password" id="videoPasswordInput-${id}-${index}" placeholder="Enter your password" style="padding-right: 34px;" />
                    <span id="togglePasswordBtn-${id}-${index}" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: #6b7280; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 3;" title="Toggle password visibility">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-icon" id="eyeIcon-${id}-${index}">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="eye-off-icon" id="eyeOffIcon-${id}-${index}" style="display: none;">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    </span>
                  </div>
                  <button id="videoPasswordButton-${id}-${index}">${svpEsc(data?.data?.passwordProtected?.buttonText)}</button>
                </div>
                <p id="error-${id}-${index}" style="font-size: 12px; color: #ef4444; margin: 8px 0 0 0; display: none; font-weight: 500;">${svpEsc(data?.data?.passwordProtected?.message)}</p>
              </div>
            </div>`;

              // The unlock handler below names its fetch response `data`, which
              // shadows this record — so anything it still needs from the
              // original settings has to be captured out here under a new name.
              const svpOuterAutoPlay = !!data?.autoPlay;

              window.player = player;
              attachResetOnEnd(player);
              // ── Analytics: record the play ──
              player.on("play", () => {
                if (window.__svpTrackPlay) window.__svpTrackPlay(id);
              });
              // Never track the locked placeholder. HTMLMediaElement.play()
              // fires "play" even when the element has no source, so an
              // autoplaying placeholder logged a play on page load — before the
              // visitor had typed a single character of the password.
              if (window.__svpRegisterWatch && !svpIsLocked)
                window.__svpRegisterWatch(id, player);
              if (window.__svpSyncFullscreenPip)
                window.__svpSyncFullscreenPip(player);
              if (window.__svpKeepCaptionChoice)
                window.__svpKeepCaptionChoice(player);
              player.on("ready", () => {
                // Autoplaying a sourceless placeholder only produced a console
                // error and a phantom "play" event; the real autoplay happens
                // in the unlock handler once the video url arrives.
                if (data?.autoPlay && !svpIsLocked) {
                  // force autoplay-safe state
                  player.muted = true;
                  player.volume = 0;

                  setTimeout(() => {
                    player.play().catch(() => {});
                  }, 500);
                }

                setTimeout(() => {
                  const wrapper = item.querySelector(".wrapper");
                  if (wrapper) wrapper.remove();

                  if (player.elements?.poster && data?.poster) {
                    player.elements.poster.style.backgroundImage = `url(${data?.poster})`;
                    player.elements.poster.style.backgroundSize = "cover";
                    player.elements.poster.style.display = "block";
                  }

                  const container = document.querySelector(
                    `#starVideoPlayer-${id}-${index}`,
                  );
                  if (container) container.style.display = "block";
                }, 500);
              });

              data?.data?.overlay?.enabled
                ? OverlayInit(index, data?.data?.overlay, plyrWrapper)
                : ``;
              data?.data?.watermark?.enabled &&
                watermarkInit(
                  player,
                  data?.data?.watermark?.type == "domain"
                    ? window.__svpShopDomain
                    : data?.data?.watermark?.text,
                  plyrWrapper,
                  data?.data?.watermark?.color || "#ff0000ff",
                );
              data?.data?.passwordProtected?.enabled
                ? passwordProtectedOptionInit(
                    id,
                    index,
                    passwordOverlayHtml,
                    plyrWrapper,
                  )
                : ``;

              document.addEventListener("keydown", (e) => {
                if (
                  e.target.matches(`#videoPasswordInput-${id}-${index}`) &&
                  e.key === "Enter"
                ) {
                  e.preventDefault();
                  document
                    .getElementById(`videoPasswordButton-${id}-${index}`)
                    ?.click();
                }
              });

              document.addEventListener("click", (e) => {
                const toggleBtn = e.target.closest(
                  `#togglePasswordBtn-${id}-${index}`,
                );
                if (toggleBtn) {
                  const passwordInput = document.getElementById(
                    `videoPasswordInput-${id}-${index}`,
                  );
                  const eyeIcon = document.getElementById(
                    `eyeIcon-${id}-${index}`,
                  );
                  const eyeOffIcon = document.getElementById(
                    `eyeOffIcon-${id}-${index}`,
                  );
                  if (passwordInput && passwordInput.type === "password") {
                    passwordInput.type = "text";
                    if (eyeIcon) eyeIcon.style.display = "none";
                    if (eyeOffIcon) eyeOffIcon.style.display = "block";
                  } else if (passwordInput) {
                    passwordInput.type = "password";
                    if (eyeIcon) eyeIcon.style.display = "block";
                    if (eyeOffIcon) eyeOffIcon.style.display = "none";
                  }
                  return;
                }

                if (e.target.matches(`#videoPasswordButton-${id}-${index}`)) {
                  const passwordInput = document.getElementById(
                    `videoPasswordInput-${id}-${index}`,
                  );
                  const errorElement = document.getElementById(
                    `error-${id}-${index}`,
                  );
                  if (errorElement) {
                    errorElement.style.display = "none";
                  }

                  const candidatePasswords = [
                    passwordInput?.value?.trim(),
                  ].filter(Boolean);

                  if (!candidatePasswords.length) {
                    if (errorElement) {
                      errorElement.style.display = "block";
                    }
                    return;
                  }

                  const tryPassword = (passwordIndex = 0) => {
                    const enteredPassword = candidatePasswords[passwordIndex];
                    // No custom headers on purpose. A `Content-Type: application/json`
                    // on a cross-origin GET is not CORS-safelisted, so it forces an
                    // OPTIONS preflight — an extra round trip that fails outright if
                    // anything in front of the app (nginx, a CDN) answers OPTIONS
                    // without CORS headers, and then every password reads as wrong.
                    // A bare GET is a simple request: no preflight, nothing to break.
                    fetch(
                      `https://shopify-video-app.bplugins.com/app/api/video/${id}?password=${encodeURIComponent(enteredPassword)}`,
                      {
                        method: "GET",
                      },
                    )
                      .then((res) => res.json())
                      .then((data) => {
                        if (data?.data?.success) {
                          data.data = svpCleanVideo(data.data);
                          // This response is fetched separately from the main one,
                          // so it needs the same Vimeo normalisation.
                          if (data?.data?.url) {
                            data.data.url = svpNormalizeYouTubeUrl(
                              svpNormalizeVimeoUrl(data.data.url),
                            );
                          }
                          const passwordWrapper = document.getElementById(
                            `videoPasswordWrapper-${id}-${index}`,
                          );
                          if (passwordWrapper) passwordWrapper.remove();

                          const skeletonHtml = `
                        <div class="wrapper">
                          <div class="video-loader" aria-busy="true" aria-label="Loading video">
                            <div class="vl-media">
                              <div class="vl-play"><div class="vl-play-btn skel" aria-hidden="true"></div></div>
                              <div class="vl-controls" aria-hidden="true">
                                <div class="vl-row">
                                  <div class="vl-left"><span class="ico skel"></span><div class="vl-progress skel"></div></div>
                                  <div class="vl-right"><div class="vl-time skel"></div><span class="ico skel"></span><span class="ico skel"></span><span class="ico skel"></span></div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>`;
                          item.insertAdjacentHTML("afterbegin", skeletonHtml);

                          const videoElement = document.getElementById(
                            `player-${id}-${index}`,
                          );
                          const videoParentElement = document.getElementById(
                            `starVideoPlayer-${id}-${index}`,
                          );
                          videoParentElement.style.height = "auto";
                          videoParentElement.style.display = "none";

                          if (data?.data?.videoType == "html5") {
                            videoElement.src = data?.data?.url;
                            videoElement.setAttribute(
                              "data-poster",
                              data?.data?.poster || "",
                            );
                            // The placeholder was rendered with no <source>, so the
                            // element never ran resource selection; assigning .src
                            // restarts it, and load() makes that explicit rather
                            // than relying on the attribute-change side effect.
                            try {
                              videoElement.load();
                            } catch (e) {}
                            // Now that there is a real file, a codec/404 failure is
                            // worth reporting again.
                            svpWatchMedia(
                              player?.media || videoElement,
                              videoParentElement,
                              id,
                            );
                            // This element was left untracked while it was a locked
                            // placeholder; it reuses the SAME Plyr instance, so bind
                            // it here, now that it finally has a real source.
                            if (window.__svpRegisterWatch)
                              window.__svpRegisterWatch(id, player);

                            setTimeout(() => {
                              const wrapper = item.querySelector(".wrapper");
                              if (wrapper) wrapper.remove();
                              videoParentElement.style.display = "block";
                              if (
                                player.elements?.poster &&
                                data?.data?.poster
                              ) {
                                player.elements.poster.style.backgroundImage = `url(${data?.data?.poster})`;
                                player.elements.poster.style.backgroundSize =
                                  "cover";
                                player.elements.poster.style.display = "block";
                              }
                              // Update download button href if it exists
                              const downloadBtn =
                                videoParentElement.querySelector(
                                  'a[data-plyr="download"]',
                                );
                              if (downloadBtn) {
                                downloadBtn.href = data?.data?.url;
                              }
                            }, 500);
                          } else if (videoParentElement) {
                            videoParentElement.innerHTML = ` <div style="display: none;" id="player-${id}-${index}" data-plyr-provider="${
                              data?.data?.videoType == "youtube" ||
                              data?.data?.url?.startsWith("https://youtu") ||
                              data?.data?.url?.startsWith("https://www.youtube")
                                ? "youtube"
                                : "vimeo"
                            }" data-plyr-embed-id="${getEmbedId(data?.data?.url)}"></div>`;

                            const newPlayer = new Plyr(
                              `#player-${id}-${index}`,
                              options,
                            );

                            attachResetOnEnd(newPlayer);
                            // ── Analytics: record the play ──
                            newPlayer.on("play", () => {
                              if (window.__svpTrackPlay)
                                window.__svpTrackPlay(id);
                            });
                            if (window.__svpRegisterWatch)
                              window.__svpRegisterWatch(id, newPlayer);
                            if (window.__svpSyncFullscreenPip)
                              window.__svpSyncFullscreenPip(newPlayer);
                            if (window.__svpKeepCaptionChoice)
                              window.__svpKeepCaptionChoice(newPlayer);
                            newPlayer.on("ready", () => {
                              // `data` here is the unlock response, whose loader
                              // never selects autoPlay — so this was always
                              // undefined and autoplay-after-unlock never fired.
                              if (svpOuterAutoPlay) {
                                // force autoplay-safe state
                                newPlayer.muted = true;
                                newPlayer.volume = 0;

                                setTimeout(() => {
                                  newPlayer.play().catch(() => {});
                                }, 502);
                              }

                              setTimeout(() => {
                                const wrapper = item.querySelector(".wrapper");
                                if (wrapper) wrapper.remove();
                                videoParentElement.style.display = "block";

                                if (
                                  newPlayer.elements?.poster &&
                                  data?.data?.poster
                                ) {
                                  newPlayer.elements.poster.style.backgroundImage = `url(${data?.data?.poster})`;
                                  newPlayer.elements.poster.style.backgroundSize =
                                    "cover";
                                  newPlayer.elements.poster.style.display =
                                    "block";
                                }
                              }, 500);
                            });
                            data?.data?.data?.overlay?.enabled
                              ? OverlayInit(
                                  index,
                                  data?.data?.data?.overlay,
                                  plyrWrapper,
                                )
                              : ``;
                            data?.data?.data?.watermark?.enabled &&
                              watermarkInit(
                                newPlayer,
                                data?.data?.data?.watermark?.type == "domain"
                                  ? window.__svpShopDomain
                                  : data?.data?.data?.watermark?.text,
                                plyrWrapper,
                                data?.data?.data?.watermark?.color ||
                                  "#ff0000ff",
                              );
                          }
                        } else if (
                          passwordIndex + 1 <
                          candidatePasswords.length
                        ) {
                          tryPassword(passwordIndex + 1);
                        } else if (errorElement) {
                          // The server rate-limits guesses (HTTP 429). Say so,
                          // rather than showing "wrong password" for a right one.
                          if (errorElement.dataset.svpMsg === undefined) {
                            errorElement.dataset.svpMsg =
                              errorElement.textContent;
                          }
                          errorElement.textContent = data?.rateLimited
                            ? "Too many attempts. Please try again in " +
                              Math.max(1, Math.ceil((data.retryAfter || 60) / 60)) +
                              " minute(s)."
                            : errorElement.dataset.svpMsg;
                          errorElement.style.display = "block";
                          const btn = document.getElementById(
                            `videoPasswordButton-${id}-${index}`,
                          );
                          if (btn) {
                            btn.disabled = false;
                            btn.innerHTML =
                              btn.dataset.originalText || btn.innerHTML;
                            btn.style.opacity = "";
                            btn.style.cursor = "";
                            btn.style.display = "";
                          }
                        }
                      })
                      .catch(() => {
                        if (errorElement) errorElement.style.display = "block";
                        const btn = document.getElementById(
                          `videoPasswordButton-${id}-${index}`,
                        );
                        if (btn) {
                          btn.disabled = false;
                          btn.innerHTML =
                            btn.dataset.originalText || btn.innerHTML;
                          btn.style.opacity = "";
                          btn.style.cursor = "";
                          btn.style.display = "";
                        }
                      });
                  };

                  const submitBtn = document.getElementById(
                    `videoPasswordButton-${id}-${index}`,
                  );
                  if (submitBtn) {
                    submitBtn.dataset.originalText = submitBtn.innerHTML;
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: vpSpin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg> Processing...`;
                    submitBtn.style.opacity = "0.8";
                    submitBtn.style.cursor = "not-allowed";
                    submitBtn.style.display = "flex";
                    submitBtn.style.alignItems = "center";
                    submitBtn.style.justifyContent = "center";
                    submitBtn.style.gap = "8px";
                  }

                  tryPassword();
                }
              });
            }
          });
        }
      })
      // Nothing handled a failed settings request, so a blocked, offline or
      // erroring fetch left every player stuck on its skeleton loader for good —
      // visually identical to a video that is merely slow, and invisible in the
      // console. Say what happened instead.
      .catch((err) => {
        try {
          console.error(
            "[Video Player by bPlugins] Could not load video settings:",
            err,
          );
        } catch (e) {}
        videoPlyrElement.forEach((el) => {
          svpPlayerMessage(
            el,
            "Video unavailable",
            "The player settings could not be loaded.",
          );
        });
      });
  }
};

// Initial run — identical to the previous top-level execution.
window.svpRefresh();

// Auto-detect players added AFTER this point, so no integration code is
// needed on any storefront — single-page apps (React, Next.js, Hydrogen,
// Vue) that swap pages without reloading, lazy-loaded sections, modals and
// tabs all just work. Calling window.svpRefresh() by hand remains available
// but is no longer required.
//
// Safe by construction:
//  • debounced, so a burst of DOM changes triggers at most one pass;
//  • it only calls refresh when an UNINITIALISED player element exists, and
//    svpRefresh() marks every element it handles — so the work refresh itself
//    does to the DOM cannot re-trigger it, and no player is ever duplicated.
if (!window.__svpObserverBound && typeof MutationObserver !== "undefined") {
  window.__svpObserverBound = true;
  try {
    var svpScanPending = null;
    var svpObserver = new MutationObserver(function () {
      if (svpScanPending) return;
      svpScanPending = setTimeout(function () {
        svpScanPending = null;
        try {
          if (
            document.querySelector(
              ".video-plyr-by-bplugins:not([data-svp-init])",
            )
          ) {
            window.svpRefresh();
          }
        } catch (e) {}
      }, 150);
    });
    svpObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  } catch (e) {}
}
