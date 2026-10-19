/**
 * Input sanitising for player settings.
 *
 * Every player setting a merchant types (overlay text, colours, sizes, URLs,
 * password-form copy, grid options …) is later spliced into HTML, attribute
 * and <style> strings — in the storefront player (svp-player.js) and in the
 * admin previews. None of those fields ever needs markup, so:
 *
 *   - on save, the server runs everything through `sanitizeSettings`, which
 *     strips tags from text, drops non-http(s) URLs and removes the characters
 *     that let a CSS/enum value break out of its context;
 *   - on render, `escapeHtml` / `safeUrl` / `cssValue` are applied again, so a
 *     record saved before this existed shows its payload as plain text instead
 *     of running it.
 *
 * Isomorphic on purpose (no server-only imports) — the admin previews use it
 * in the browser. svp-player.js carries its own copy because the theme
 * extension cannot import from the app.
 */

// Fields whose value is a link or media source.
const URL_KEYS = new Set([
  "url",
  "poster",
  "logo",
  "video",
  "src",
  "href",
  "link",
  "image",
  "thumbnail",
]);

// Human-readable copy. Tags are stripped; the text is escaped where rendered.
const TEXT_KEYS = new Set([
  "text",
  "title",
  "buttonText",
  "message",
  "label",
  "name",
  "description",
  "placeholder",
  "alt",
]);

// Kept verbatim (length-capped only):
//   content  — caption VTT, only ever handed to <track> through a Blob URL
//   password — compared on the server, never rendered
const RAW_KEYS = new Set(["content", "password"]);

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const LIMITS = {
  text: 500,
  url: 2048,
  css: 200,
  password: 100,
  content: 1_500_000,
  arrayItems: 200,
  depth: 10,
};

/** Escape a value for use as HTML text or inside a quoted attribute. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

/** Remove any HTML tags (and stray angle brackets) from plain text. */
export function stripTags(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/<[^>]*>?/g, "")
    .replace(/[<>]/g, "");
}

/**
 * Only http(s), protocol-relative and site-relative links survive; anything
 * else (javascript:, data:, vbscript: …) becomes "". Characters that could
 * close a quoted attribute or a CSS url() are percent-encoded, which leaves a
 * real URL working.
 */
export function safeUrl(value) {
  if (typeof value !== "string") return "";
  // Control characters and whitespace are how "java\tscript:" sneaks past.
  // eslint-disable-next-line no-control-regex
  const url = value.replace(/[\u0000- \u007f]/g, "");
  if (!url) return "";
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !/^(https?|blob)$/i.test(scheme[1])) return "";
  return url
    .slice(0, LIMITS.url)
    .replace(/["'<>`\\(){}]/g, (c) =>
      "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"),
    );
}

/**
 * A colour, size, unit, class name or enum value. Removes everything that can
 * end a CSS declaration/block, close a <style> or attribute, or pull in
 * external CSS. "#1a8d5a", "rgba(0,0,0,.5)", "16px", "top_right" pass through.
 */
export function cssValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return String(value)
    .replace(/\/\*|\*\//g, "")
    .replace(/url\s*\(|expression\s*\(|@import|javascript:/gi, "")
    .replace(/[<>"'`{};\\]/g, "")
    .slice(0, LIMITS.css);
}

function sanitizeString(value, key) {
  if (RAW_KEYS.has(key)) {
    return value.slice(0, key === "password" ? LIMITS.password : LIMITS.content);
  }
  if (URL_KEYS.has(key)) return safeUrl(value);
  if (TEXT_KEYS.has(key)) return stripTags(value).slice(0, LIMITS.text);
  return cssValue(value);
}

/**
 * Deep-clean a settings value (an object parsed from the client, or a stored
 * record). Strings are cleaned by the key they sit under; array items inherit
 * their parent key. Returns a new value — the input is not mutated.
 */
export function sanitizeSettings(value, key = "", depth = 0) {
  if (depth > LIMITS.depth) return null;
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return sanitizeString(value, key);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value
      .slice(0, LIMITS.arrayItems)
      .map((item) => sanitizeSettings(item, key, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = sanitizeSettings(v, k, depth + 1);
    }
    return out;
  }

  return null;
}

/**
 * JSON.parse a form field and sanitise it. Malformed input yields `fallback`
 * instead of throwing (which used to abort the whole save silently).
 */
export function parseSettings(raw, fallback = {}) {
  if (raw === null || raw === undefined || raw === "") return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return fallback;
    return sanitizeSettings(parsed);
  } catch {
    return fallback;
  }
}

// Older records sometimes hold a settings column as a JSON string; parse it
// first so it is cleaned as an object instead of being mangled as one value.
function sanitizeJsonColumn(value) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return sanitizeSettings(parsed);
    } catch {
      // not JSON — fall through
    }
    return {};
  }
  return sanitizeSettings(value);
}

/** Sanitise a stored Video record (all of its user-supplied fields). */
export function sanitizeVideoRecord(video) {
  if (!video || typeof video !== "object") return video;
  const cleaners = {
    title: (v) => sanitizeSettings(v, "title"),
    url: (v) => sanitizeSettings(v, "url"),
    poster: (v) => sanitizeSettings(v, "poster"),
    vimeo: (v) => sanitizeSettings(v, "url"),
    youtube: (v) => sanitizeSettings(v, "url"),
    videoType: (v) => (typeof v === "string" ? cssValue(v) : v),
    controls: sanitizeJsonColumn,
    styles: sanitizeJsonColumn,
    options: sanitizeJsonColumn,
    data: sanitizeJsonColumn,
  };
  const out = { ...video };
  for (const [key, clean] of Object.entries(cleaners)) {
    if (key in video && video[key] !== null && video[key] !== undefined) {
      out[key] = clean(video[key]);
    }
  }
  return out;
}

const UPLOAD_LIMITS = {
  video: 1024 * 1024 * 1024, // 1 GB — Shopify's own cap for video files
  audio: 1024 * 1024 * 1024,
  image: 20 * 1024 * 1024, // 20 MB
};

/**
 * Server-side check of a staged-upload request (the browser's own checks can
 * be skipped). Only video, audio and raster images are accepted — SVG is
 * refused because it can carry script. Returns cleaned values or an error.
 */
export function validateUpload({ name, type, size }) {
  const mime = String(type || "").toLowerCase().trim();
  const kind = mime.split("/")[0];
  if (!/^(video|audio|image)\/[a-z0-9.+-]+$/.test(mime) || mime === "image/svg+xml") {
    return { ok: false, error: "This file type is not allowed." };
  }
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > UPLOAD_LIMITS[kind]) {
    return { ok: false, error: "This file is too large." };
  }
  const filename = stripTags(String(name || ""))
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim()
    .slice(0, 255);
  if (!filename) return { ok: false, error: "Invalid file name." };
  return { ok: true, name: filename, type: mime, size: String(Math.floor(bytes)) };
}
