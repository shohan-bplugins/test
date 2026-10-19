import type { ViewerConfig } from "~/components/ViewerPreview";

/*
 * Placement-level overrides, read from an embed URL's query string.
 *
 * The saved config belongs to the model, but a single model gets embedded in
 * more than one place — and the one setting that has to follow the *host page*
 * rather than the model is the background: a white viewer dropped into a dark
 * page reads as a broken box. Re-saving the model to suit one embed would
 * change every other placement, so these ride on the URL instead.
 *
 *   ?bg=101014      background colour, hex, WITHOUT the leading '#'
 *                   ('#' starts the fragment in a URL, so requiring it would
 *                   mean every merchant hand-encoding %23)
 *   ?autorotate=0   turn auto-rotation off (or =1 to force it on)
 *
 * Anything unrecognised is ignored rather than erroring: these arrive from
 * hand-edited embed codes, and a typo should degrade to the saved config, not
 * to a 400 on someone's storefront.
 *
 * Kept out of the route so the parsing rules live in one place rather than being
 * restated by every embeddable page that grows a need for them.
 */

const HEX_COLOR = /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/;

export function applyViewerOverrides(
  config: ViewerConfig,
  url: URL,
): ViewerConfig {
  const out = { ...config };

  const bg = (url.searchParams.get("bg") ?? "").trim().replace(/^#/, "");
  if (HEX_COLOR.test(bg)) out.background = `#${bg}`;

  const autoRotate = url.searchParams.get("autorotate");
  if (autoRotate === "0" || autoRotate === "false") out.autoRotate = false;
  if (autoRotate === "1" || autoRotate === "true") out.autoRotate = true;

  return out;
}
