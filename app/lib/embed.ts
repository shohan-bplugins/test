/*
 * Builds the iframe snippet a merchant pastes to put a viewer on a page.
 *
 * The snippet has to survive Shopify's page HTML editor, which strips <style>
 * and <script> — so everything is an inline style on the iframe and one wrapper
 * div, with no classes to collide with the theme's CSS.
 *
 * Fullscreen is delegated twice, on purpose. `allow="fullscreen"` is the modern
 * Permissions Policy spelling, and `allowfullscreen` is the legacy boolean
 * attribute — without one of them the browser refuses the request from inside
 * the iframe and the button can only report that it's unavailable. Both are
 * needed because either one alone has a real hole: WebKit honoured
 * `allowfullscreen` long before it parsed `allow` at all, and the sanitiser in
 * Shopify's page HTML editor keeps the attributes it knows (`allowfullscreen`,
 * which every YouTube embed carries) while dropping ones it doesn't. YouTube's
 * own embed code hedges the same way. Harmless together: per the HTML spec
 * `allowfullscreen` behaves as if `fullscreen` were appended to `allow`.
 *
 * xr-spatial-tracking is the same bargain for AR. WebXR is gated behind that
 * permission policy, and an iframe that does not delegate it reports AR as
 * unavailable — so the "View in your room" button never appears, on a phone
 * that supports it perfectly well. iOS Quick Look and Android Scene Viewer do
 * not need it (they hand off to a native app rather than starting a WebXR
 * session), which is exactly what made this the kind of gap that shows up on
 * one platform only.
 *
 * Kept out of the route so the framing behaviour is defined once, rather than
 * restated by every screen that hands out an embed code.
 */

export type EmbedMode = "responsive" | "fixed";

// Aspect ratio of the responsive embed, as a padding-bottom percentage. 4:3 is
// a reasonable default for a single object on a turntable — tall enough for the
// model, short enough not to push a page's content off the first screen.
export const RESPONSIVE_PADDING_PCT = 75;

export function buildEmbedSnippet(
  src: string,
  height: number,
  mode: EmbedMode,
  title = "3D model",
): string {
  const common =
    `src="${src}" allow="fullscreen; xr-spatial-tracking" allowfullscreen ` +
    `loading="lazy" title="${title}"`;

  if (mode === "fixed") {
    return `<iframe ${common} width="100%" height="${height}" style="border:0;display:block"></iframe>`;
  }

  // padding-bottom rather than the shorter `aspect-ratio`: this markup ends up
  // in theme templates and page bodies of every vintage, and the percentage
  // trick renders identically everywhere without a support caveat.
  return [
    `<div style="position:relative;width:100%;padding-bottom:${RESPONSIVE_PADDING_PCT}%">`,
    `  <iframe ${common} style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe>`,
    `</div>`,
  ].join("\n");
}
