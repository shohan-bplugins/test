import React from "react";
import { useNavigate } from "@remix-run/react";

// Helpers and house rules for driving Polaris web components (the `s-*` custom
// elements registered by polaris-1.js) from React 18.
//
// ─── How React 18 talks to these elements ────────────────────────────────────
//
// polaris-1.js ships its own React interop bridge. It finds React's internal
// `__reactProps$…` object on the element, installs a property descriptor over
// it, and on every props write:
//
//   • turns each `onFoo` prop into a real `addEventListener("foo", …)`
//   • sets any prop backed by a property AS a property, not a stringified
//     attribute, and removes the attribute for `null` / `false`
//
// So plain React props work. Verified in a headless browser against
// React 18.3.1 + the live polaris-1.js:
//
//   ✅ onChange / onInput fire as ordinary React props
//   ✅ `value` / `checked` land as real properties, so controlled inputs work
//   ✅ <s-switch checked={on} onChange={(e) => setOn(e.target.checked)} /> is
//      correct and fires exactly once per click
//
// An earlier version of this codebase concluded the opposite — that React 18
// could not wire onChange to a custom element — and hand-rolled every form
// control because of it. That conclusion was wrong. Do not reintroduce the
// ref + addEventListener workaround; use plain props.
//
// ─── The one rule that is easy to get wrong ──────────────────────────────────
//
// For TEXT inputs use `onInput`, not `onChange`.
//
// These elements follow native semantics: `input` fires per keystroke, `change`
// only on commit/blur. `onChange` on an <s-text-field> looks like it works and
// then silently misses everything the user typed until they tab away.
//
//   <s-text-field value={v} onInput={(e) => setV(e.target.value)} />   ✅
//   <s-text-field value={v} onChange={(e) => setV(e.target.value)} />  ✗ on blur only
//
// For <s-switch> / <s-checkbox>, `onChange` is correct — a toggle has no
// intermediate state.
//
// ─── Brand color: s-button will NOT go green ─────────────────────────────────
//
// `theme-overrides.css` recolors Polaris REACT buttons via
// `--p-color-bg-fill-brand` and `.Polaris-Button--variantPrimary`. `s-button`
// honours neither: it renders into shadow DOM and reads a build-hashed token
// (`--t-fill-brand-26021`), so a converted primary button silently falls back
// to Polaris's near-black #303030.
//
// Setting that hashed token on :root does work, but the hash changes with every
// polaris-1.js release (the script tracks "newest stable 1.x"), so it would
// revert without warning on a Shopify deploy. Treat brand-green primary buttons
// as unavailable on web components until Shopify exposes a stable hook — this
// is a product decision, not a bug to work around.

// ─── Verified attribute reference ────────────────────────────────────────────
//
// Every line below was checked in a real browser against the live polaris-1.js.
// This matters more than usual here: a wrong attribute or icon name renders
// NOTHING and logs no error, so these mistakes survive code review and reach
// production looking like a styling bug.
//
//   ✅ WORKS                              ❌ SILENTLY DOES NOTHING
//   <s-icon type="view">                  <s-icon name="view">
//   <s-thumbnail src={url}>               <s-thumbnail source={url}>   (Polaris React's prop)
//   <s-text color="subdued">              <s-text tone="subdued">      (not in the tone set)
//   <s-heading>  — weight 600             <s-text fontWeight="bold">   (no such attribute)
//   <s-text-field onInput>                <s-text-field onChange>      (fires on blur only)
//   <s-button slot="secondary-actions">   <s-button> with no slot       (inside s-button-group)
//
// s-button-group uses `slotAssignment: "manual"` and exposes exactly two
//   slots: `primary-action` (variant primary or auto) and `secondary-actions`
//   (variant secondary or auto). A child with no `slot` is never assigned, so
//   the whole group renders as empty space — this is what hid the View Mode
//   control in GridSettings. `gap="none"` gives the segmented look but rejects
//   the primary-action slot, so a segmented group cannot mark an active button;
//   use s-select or s-choice-list when one option must read as chosen.
//
// s-text `tone`: auto | neutral | info | success | caution | warning | critical
//   NOT subdued, NOT magic — both fall back to auto.
// s-text `color`: base | subdued        (strong is not a value)
// s-text `type="strong"` renders a semantic <strong> but keeps weight 450, so
//   it conveys meaning, not emphasis. Use s-heading when it must look bold.
//
// Spacing scale (gap/padding/paddingBlock/paddingInline):
//   none | small-500…small-100 | base | large-100…large-500
//   Plain numbers ("300", "400", "150") are Polaris REACT token names and do
//   nothing here — there are still a few of those in the codebase.
//
// Confirmed working: s-box padding/background/borderRadius, s-stack
// direction/gap/alignItems/justifyContent, s-button icon/variant/loading/
// disabled/accessibilityLabel, s-switch label/details/checked/disabled,
// s-select + s-option, s-number-field min/max/suffix (value is a STRING),
// s-color-field, s-drop-zone, s-modal, s-spinner accessibilityLabel.
//
// Icon names are Polaris's kebab set, e.g. check-circle, alert-triangle,
// chevron-up/down/left/right, clipboard, credit-card, external, refresh, view,
// x, plus, minus, upload, delete, edit, search, link, lock, image, video,
// play, play-circle, code, list-bulleted, drag-handle, question-circle.
//
// Not in the bundle at all: any range slider, and any table with row
// selection / bulk actions / a filter bar.

/**
 * Guard for boolean attributes on custom elements.
 *
 * Belt and braces: the interop bridge already turns `false` into a removed
 * attribute, so this is no longer strictly required. It is kept because it is
 * harmless, self-documenting, and correct even if an element is rendered
 * before the bridge attaches.
 *
 *   <s-button loading={flag(isSaving)} disabled={flag(!canSave)}>
 */
export const flag = (on) => (on ? true : undefined);

/**
 * Real hrefs that still navigate through Remix instead of doing a full document
 * load. The href stays meaningful for middle-click and "open in new tab"; the
 * click handler keeps the SPA navigation. Use on `s-link` and `s-button href`.
 *
 *   const go = useGo();
 *   <s-button href="/app/pricing" onClick={go("/app/pricing")}>Upgrade</s-button>
 */
export const useGo = () => {
  const navigate = useNavigate();
  return (to) => (event) => {
    event?.preventDefault?.();
    navigate(to);
  };
};

/**
 * Polaris React components that are still allowed, because polaris-1.js has no
 * equivalent. Everything else should be an `s-*` element — see the migration
 * plan. Keep this list short and justify additions.
 *
 *   IndexTable / IndexFilters / useIndexResourceState
 *     until the s-table + s-checkbox rebuild lands (migration Phase 5)
 *   RangeSlider
 *     no `s-range-slider` exists in the bundle
 */
export const POLARIS_REACT_ESCAPE_HATCH = [
  "IndexTable",
  "IndexFilters",
  "RangeSlider",
];

/**
 * A SHRINKING MIGRATION SHIM. Do not add new usages.
 *
 * These wrap a plain `<div>`/`<span>`/`<button>`/`<img>` and forward
 * `className` and `style`, which Polaris `Box` does not accept. That makes them
 * a useful staging post when a chunk of CSS-driven markup cannot be converted
 * in one go — the ref fix below is why they still exist.
 *
 * What they are NOT is progress. An earlier version of this comment claimed
 * they "enable reaching a higher custom component usage percentage without
 * breaking existing CSS", and the codebase followed that advice: ~180 `<div>`s
 * were renamed to `<CustomBox>`. The browser still received a `<div>`, no CSS
 * moved, no layout improved, and scripts/polaris-census.mjs — which classified
 * any tag it did not recognise as neither Polaris nor custom — reported 14.3%
 * custom HTML against a true 23.6%. The census now counts these as the raw HTML
 * they are, and prints the remaining usages as a backlog.
 *
 * The real conversions, which do move the number because they move the markup:
 *
 *   display:flex + justifyContent:space-between  ->  <InlineStack align="space-between">
 *   display:flex + flexDirection:column + gap    ->  <BlockStack gap="400">
 *   display:grid + gridTemplateColumns           ->  <InlineGrid columns={n}>
 *   padding/margin only                          ->  <Box padding*="…">
 *   no className and no style                    ->  unwrap it
 *
 * Reach for a wrapper only when the element carries CSS that Polaris genuinely
 * cannot express (`position:absolute`, `aspectRatio`, a `:before` pseudo-element,
 * an `onClick` guard), and leave a comment saying which.
 */
// These wrappers must forward refs. On React 18 a plain function component
// silently drops `ref` (it is a reserved prop, not passed through), so
// `<CustomBox ref={…}>` left the ref null — which is what blanked the
// multiple-player preview: PlyrGridItem's effect bailed on `if (!container)`
// and never built the player, leaving only the empty gradient box.
const domWrapper = (tag, displayName) => {
  const Wrapped = React.forwardRef((props, ref) =>
    React.createElement(tag, ref ? { ...props, ref } : props),
  );
  Wrapped.displayName = displayName;
  return Wrapped;
};

export const CustomBox = domWrapper("div", "CustomBox");
export const CustomSpan = domWrapper("span", "CustomSpan");
export const CustomButton = domWrapper("button", "CustomButton");
export const CustomImg = domWrapper("img", "CustomImg");
export const CustomP = domWrapper("p", "CustomP");
export const CustomA = domWrapper("a", "CustomA");
export const CustomH1 = domWrapper("h1", "CustomH1");
export const CustomH2 = domWrapper("h2", "CustomH2");
export const CustomH3 = domWrapper("h3", "CustomH3");
export const CustomH4 = domWrapper("h4", "CustomH4");
export const CustomUl = domWrapper("ul", "CustomUl");
export const CustomLi = domWrapper("li", "CustomLi");
export const CustomForm = domWrapper("form", "CustomForm");
export const CustomLabel = domWrapper("label", "CustomLabel");
export const CustomInput = domWrapper("input", "CustomInput");

