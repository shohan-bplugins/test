// Escaping helpers for the ScreenList HTML-string templates (Plyr `controls`).
// Each helper stringifies first with String(v) so the output is byte-identical
// to the old `${value}` interpolation for normal data (including the literal
// "undefined"/"null" a missing value used to produce — dropping those could
// change how a declaration like `border: undefined solid red` is parsed).
import { escapeHtml, sanitizeCssValue } from "../../lib/sanitize";

// Text placed inside an element or a quoted attribute (title, artist, alt...).
export const safeText = (v) => escapeHtml(String(v));

// A value placed inside a CSS declaration (style attribute or <style> block).
export const safeCss = (v) => sanitizeCssValue(String(v));

// Script-capable URL schemes. Whitespace/control chars are ignored when
// checking because browsers strip them from schemes ("java\tscript:").
const isDangerousUrl = (s) => {
  const t = s.replace(/[\u0000- ]/g, "").toLowerCase();
  return (
    t.startsWith("javascript:") ||
    t.startsWith("data:text/html") ||
    t.startsWith("vbscript:")
  );
};

// A URL placed in a quoted src/href attribute.
export const safeUrl = (v) => {
  const s = String(v);
  return isDangerousUrl(s) ? "" : escapeHtml(s);
};

// A URL placed inside url('...') within a style attribute. Attribute entities
// are decoded before CSS parsing, so also percent-encode the characters that
// could end the CSS string (quotes, backslash, newlines).
export const safeCssUrl = (v) => {
  const s = String(v);
  if (isDangerousUrl(s)) return "";
  return escapeHtml(
    s.replace(
      /['"\\\r\n\f]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"),
    ),
  );
};
