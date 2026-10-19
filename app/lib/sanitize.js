// Shared output-escaping helpers. Safe on both client and server (no node
// imports). These only neutralise characters at render time; they never
// change stored data.

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape a value for safe interpolation into HTML text or a quoted attribute.
 * null/undefined -> "", numbers -> String(n).
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Make a value safe to interpolate into a CSS declaration value inside a
 * <style> block. Numbers pass through unchanged. For strings, removes the
 * characters < > { } ; " ` \ and newlines, and the sequences "/*", "*\/"
 * and "</", so the value cannot close the declaration, rule, comment or the
 * <style> element. null/undefined stringify to "null"/"undefined", exactly
 * like the plain `${value}` interpolation this replaces, so existing players
 * render byte-for-byte the same.
 */
export function sanitizeCssValue(val) {
  if (typeof val === "number") return val;
  let s = String(val);
  // Remove sequences first, then repeat until stable so that removing one
  // character can't assemble a new forbidden sequence.
  let prev;
  do {
    prev = s;
    s = s
      .replace(/\/\*|\*\/|<\//g, "")
      .replace(/[<>{};"`\\\r\n]/g, "");
  } while (s !== prev);
  return s;
}
