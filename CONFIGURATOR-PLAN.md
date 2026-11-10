# 3D Product Configurator — Implementation Plan

## Context

`3D Configurator for Shopify/` is a static click-through prototype: Preact + htm + three.js r160, with all data in `localStorage`. Its 3D engine, option logic and pricing math really run. Every Shopify-facing part is faked: uploads, publishing, Cart Transform, checkout, webhooks, app proxy and billing.

The goal is to build its "3D Product" feature set for real inside **Easy-3D-Viewer**. That app uses React Router 7, Polaris web components, Prisma on MongoDB, the `extensions/viewer-3d` theme app extension and the `@egjs/view3d` viewer on three 0.134. We reuse what already exists and record clearly what Shopify does not allow.

**Estimate basis:** 1 full-time developer, in working days (d). Ranges cover unknowns. Each phase can be shipped on its own.

---

## Key architecture decisions

1. **Two engines side by side.** The existing view3d viewer and its AR path stay untouched, because the AR code is hands-off. The configurator gets its own engine, ported from `3D Configurator for Shopify/js/engine/` (`viewer.js`, `material-variants.js`, `decals.js`, `thumbnail.js`) onto three r160.
   - Source lives in `app/lib/configurator/engine/`, which the admin uses directly.
   - A build script (`scripts/build-configurator.mjs`, esbuild) bundles it into `extensions/viewer-3d/assets/configurator.js`. The source stays in `app/`, so this respects the "no client imports from `extensions/`" rule.
   - The bundle is lazy-loaded behind a poster, the same pattern as `view3d.pkgd.min.js`, to protect the Lighthouse budget.
2. **Data stays in MongoDB, not Postgres.** The prototype assumes Postgres; this app uses Prisma on MongoDB. New models: `ProductConfig`, `Design`, `OrderDesign` and `Preset`. On save, the published, effective data is mirrored to product metafields, the same way `syncModelLibrary` mirrors the model library.
3. **Keep the prototype's config format.** It is `schema_version: 1` and resolves in layers: product default ← option-value rules ← variant exception ← shopper choices. Port `resolveEffectiveConfig` (`js/shared/effective-config.js`) and `rulesFor`/`resolveLayers` (`shopify/core/commerce.js`) into `app/lib/configurator/config.ts`. The admin, the storefront bundle and the Cart Transform Function all share this one module.
4. **Reuse existing code.**
   - Upload, optimise and Files: `app/lib/model-upload.server.ts`, `files.server.ts`, `optimize-model.server.ts`.
   - Pickers: `FilePickerDialog.tsx`, `MediaPickerModal.tsx`.
   - Hotspots: types and sanitisers in `app/lib/hotspots.ts`; variant picker, add to cart and money formatting in the hotspot product-card code in `viewer-3d.js`.
   - Billing and gating: `app/lib/billing.server.ts`.
   - i18n: `useT`, `getServerT`, storefront `locales/*.json`.
   - Analytics: `viewer-stats.server.ts`.
   - Theme blocks: `theme-blocks.server.ts`.
   - Picking: `ViewerPreview.tsx` `intersectPosed()`.

---

## Step-by-step phases

### Phase 0 — Foundation (3–4 d) — ✅ done (2026-10-27), except scopes
> **Status:**
> - Done: Prisma models; shared modules in `app/lib/configurator/` (`types`, `config`, `options`, `pricing`, `constants`, `modules.server`, `product-config.server`); GDPR cleanup in `webhooks.compliance.tsx`.
> - Changed: no metafield *definitions* are needed, because `$app:` metafields are app-owned and readable from the extension and the Function.
> - Deferred: the scope changes move to Phase 5/8, where the scopes are first used. Requesting unused scopes forces merchants to re-approve and raises app-review questions.
> - Still to do: run `npm run setup` (`db push`) on dev, then on production.
- Prisma models (then `db push`):
  - `ProductConfig {shop, productId, modelFileId, config, optionRules, variantConfigs, customizer, publishedAt}`
  - `Design {code, shop, kind, productId, variantId, customerId?, choices, snapshotUrl, expiresAt, views}`
  - `OrderDesign {shop, orderId, lineId, designCode, effectiveConfig, snapshotUrl}`
  - `Preset {shop, kind, data}`
- Metafield definitions, created in `app.setup.tsx` / `metafields.server.ts`:
  - `$app:configurator.render`: the effective config for the storefront.
  - `$app:configurator.pricing`: compact pricing for the Function, kept under 10 KB.
- Module flags and plan gating, following the prototype's `PLAN_FEATURES` and mapped onto the existing Free/Starter/Growth/Advance plans.
- New scopes: `write_cart_transforms`, `read_orders`. Merchants will be asked to re-approve.

### Phase 1 — Engine port (6–8 d)
- Port to TypeScript:
  - Renderer and on-demand rendering.
  - Real GLB loading. Remove the procedural demo models and keep only one sample for onboarding.
  - Camera: fit, locks, tween, auto views.
  - HDRI environments, backgrounds and contact shadows; floor, reflection and grid.
  - Per-mesh materials (colour, texture, metalness, roughness, clearcoat).
  - `KHR_materials_variants`, animations, raycast picking, hotspot projection with occlusion.
  - Screenshot and thumbnail renderer; mobile pixel-ratio cap and low-power mode.
- Host the HDRIs on the app server or a CDN as real `.hdr`/`.ktx2` files. Drop the RGBE-in-PNG workaround.
- Esbuild bundle into the extension, plus a drift check like `check-locales`.

### Phase 2 — Admin 3D editor (12–15 d)
- New route `app.configurator.$productId.tsx`: a full-width editor page. Optionally open it in `s-app-window` later.
- Session state:
  - Draft with layers (Default, option value, variant exception).
  - Undo/redo: 50 steps, edits within 800 ms merge into one step.
  - Dirty tracking, Polaris save bar, leave guard, Ctrl+Z / Ctrl+Shift+Z / Ctrl+S.
- Left sidebar: layer picker ("Set up by option"), variant exceptions list, mesh scene tree (label, visible, customer can recolor, customer can hide, reset).
- Viewport: click-select, click-to-place hotspots, frame/zoom/grid/auto-rotate toolbar.
- Inspector panels:
  - Model: file info, Draco/AR warnings, replace, per-rule or per-variant model override.
  - Material, Scene & lighting, Camera (start view, locks, 4 gallery views), Animations, Hotspots (info, link, add-to-cart, camera fly-to), AR (enable, scale), Performance & health meters, Import/export JSON.
- Save writes the DB, then publishes the metafields.
- Entry point: "Configure in 3D" on `app.products.$id.tsx`.

### Phase 3 — Customer options & conditional logic (6–8 d)
- Option groups:
  - Type: colour, material or parts. Add a fourth type, `material-variant`, because the prototype has no UI for it.
  - Display: swatch, thumbnail, button or dropdown.
  - Settings: target meshes, default, required, description.
- Choices: label, colour or material values, parts shown, price rule, reordering.
- Conditions: match all or any; source is a product option or an earlier group; operators `is`, `is_not`, `has_choice`, `no_choice`.
- Pricing panel with a live meter for the 10 KB payload.

### Phase 4 — Storefront configurator (10–12 d)
- New app block `blocks/product_configurator.liquid`. It reads `$app:configurator.render` and renders a poster that loads the engine on click, scroll or eagerly.
- Placements: `block_only` and `modal`. `replace_image` / `gallery_first` work only for Dawn and Horizon, through an adapter in the app embed (see "Not possible").
- Toolbar: zoom, reset, auto-rotate, fullscreen. Gallery view chips. Hotspots with cards, reusing the existing card code.
- Customizer drawer or modal:
  - Option groups and conditional hiding.
  - Live price box: product, add-on lines, total, sale prices.
  - Required-field validation, undo/redo, reset.
  - Fallback palette mode when no option groups exist.
- Variant sync with the theme's variant change event. This also delivers NEXT-UPDATE §3.1.
- AR button: AR of the **base model** only, through Shopify's `MODEL_3D` USDZ / Scene Viewer.
- New app embed `blocks/core_embed.liquid`: the 3D badge and "View in 3D" quick view on collection cards.

### Phase 5 — Cart, pricing & snapshot (10–14 d)
- **Add to cart:**
  - Line properties: readable rows plus hidden `_3d_design` and `_3d_hash`.
  - Before adding, create the design with `POST /apps/viewer-3d/designs` through the app proxy, signed with HMAC.
- **Snapshot:** the client captures a 600×600 JPEG and uploads it through the app proxy to Shopify Files with a staged upload. The line property stores the URL, not a data URL.
- **Cart Transform Function** (`extensions/cart-transform`, JS):
  - Reads the pricing metafield and line properties.
  - Uses `lineExpand` (variant plus a "3D customization" component) on all plans.
  - Uses `lineUpdate` (price, title, image) on Plus only.
  - Register it on install with `cartTransformCreate`.
- Admin pricing explainers and a warning about selling plans.

### Phase 6 — Personalization / decals (6–8 d text, +4 d image)
- Editor: decal areas with part, side, x/y/w/h, rotation (the editor UI is missing in the prototype), fonts, colours, max characters, required, price.
- Storefront: text input with counter, font and colour; areas disabled when their part is hidden.
- **Image upload:** complete what the prototype only promised. Upload through the proxy to Files, and moderate size and type.

### Phase 7 — Save & share designs (4–5 d)
- "Save & share": link, copy, QR (reuse `app/lib/qr.ts`), design code.
- Proxy route `proxy.d.$code.tsx`: counts views, handles expiry and not-found, sets `noindex`, then redirects to `?variant=&3d_design=`.
- Restore the design on load, with "Start over".
- Admin "Designs" page: shopper-saved designs and designs from orders.
- Settings: link lifetime of 30/90/180/365 days or never.

### Phase 8 — Orders (6–8 d)
- `orders/create` webhook freezes the **effective config** into `OrderDesign`. This fixes the prototype's bug where old orders change when the product is edited later.
- Admin UI extensions:
  - `admin.order-details.block.render`: snapshot, readable rows, add-ons, "Open 3D preview", "Copy design code".
  - `admin.product-details.block.render` and `.action.render`: 3D on/off, file stats, "Open 3D editor".
- App page `app.orders.$id.preview.tsx`: full 3D order preview with a price breakdown.

### Phase 9 — Presets, settings, plans, i18n, analytics (5–7 d)
- Presets CRUD for material, environment, camera and animation, including the "Save view as preset" button the prototype is missing.
- Settings tabs:
  - General: placement, load trigger, toolbar, badge.
  - Customizer: layout, palette.
  - Features: modules.
  - Sharing.
  - AR.
- Per-product customizer override (inherit/on/off), which the prototype never exposed.
- Bulk "Generate posters" using the real thumbnail renderer in the admin, then upload to Files.
- i18n: admin namespaces for all 11 locales plus storefront locales (`npm run check-locales`).
- Analytics: new `ViewerStat` events `cfg_open`, `cfg_change`, `cart_cfg` and `share`. Show real conversion numbers instead of the prototype's hard-coded 18.4%.

### Phase 10 — Customer accounts (optional, 5–7 d)
- Thank-you / order-status block "Your custom design".
- Full page "Saved designs": open, add to cart, rename, copy link, delete.
- "Buy again" with the saved designs.

### Phase 11 — QA, performance, review (6–8 d)
- Lighthouse budget, the 3-live-WebGL-viewer cap, a mobile pass, a theme matrix (Dawn, Horizon plus 3 popular themes).
- GDPR: extend `shop/redact`, and add `customers/redact` for Design rows.
- Update `APP-REVIEW-NOTES.md`, plus the review notes on new scopes and protected customer data.

### Time summary

| Phase | Days |
|---|---|
| 0 Foundation | 3–4 |
| 1 Engine port | 6–8 |
| 2 Admin editor | 12–15 |
| 3 Options & logic | 6–8 |
| 4 Storefront | 10–12 |
| 5 Cart & pricing | 10–14 |
| 6 Decals (text + image) | 10–12 |
| 7 Share designs | 4–5 |
| 8 Orders | 6–8 |
| 9 Presets/settings/i18n/analytics | 5–7 |
| 10 Customer accounts (optional) | 5–7 |
| 11 QA & review | 6–8 |
| **Total** | **≈ 83–108 working days (~4–5 months)** |

**Suggested MVP:** Phases 0–4, plus the text part of 6, plus 5 without the Function (properties and snapshot only), then 11. That is about **55–65 days (~2.5–3 months)**.

---

## Not possible, or limited, on Shopify

| # | Prototype feature | Status | What we do instead |
|---|---|---|---|
| 1 | AR of the *configured* product (`usdz-export`, "configured AR") | **Not possible reliably.** Shopify generates USDZ only for the base `MODEL_3D`. Client-side `USDZExporter` output is unreliable in Quick Look, and the AR code is hands-off. | Base-model AR only; document the limitation. |
| 2 | Changing line price, title or image on non-Plus shops (`lineUpdate`) | **Plus only** | `lineExpand` with a "3D customization" component on Basic, Shopify and Advanced plans. |
| 3 | Add-on pricing on subscription (selling plan) lines | **Not possible.** The Cart Transform skips these lines. | Hide the priced options, or warn the merchant. |
| 4 | Showing the snapshot or 3D in checkout on non-Plus shops | **Not possible** | Snapshot shown in theme cart pages, order status and admin only. |
| 5 | Live 3D inside Shopify admin order pages | **Not possible.** Admin blocks can't run WebGL and there is no server-side rendering. | Snapshot image in the block, plus an "Open 3D preview" app page. |
| 6 | `replace_image` / `gallery_first` on every theme | **Limited.** Each theme's gallery DOM is different. | Adapters for Dawn and Horizon only; other themes use the block or modal. |
| 7 | Cart Function reading the app database | **Not possible.** Functions can't do network calls. | Pricing goes in a metafield of 10 KB or less; very large option sets are capped. |
| 8 | Data-URL images in line properties | **Not possible** (size limits) | Upload to Shopify Files and store the URL. |
| 9 | Saved designs page / order-status block in **classic** customer accounts | **Not possible.** Requires new customer accounts. | Phase 10 is only for new accounts; others get the share link. |
| 10 | Draco-compressed GLB → automatic USDZ | **Shopify limitation** | Keep a non-Draco copy for AR, or warn (as the prototype does). |
| 11 | Sharing one engine with the existing viewer | **Not practical.** view3d uses three 0.134; the prototype uses r160. | Two separate lazy bundles; the configurator replaces the viewer only on configured products. |
| 12 | Several configurators on one page | **Limited** by the WebGL context budget | One configurator per product page. |
| 13 | `orders/create` webhook with customer data | **Needs approval** for protected customer data (Level 1) in the Partner dashboard | Apply early; until then store only line and design data. |
| 14 | Bundling the HDRIs (~20 MB) in the theme extension | **Not possible.** Extension asset size limits apply. | Serve them from the app server or a CDN. |
| 15 | Fake prototype items: Basic/Plus switch, demo checkout, hard-coded 18.4% stat, procedural demo models, fixed date/EUR rate | Not carried over | Replace with real data, the shop's currency (`Shopify.currency`), and real GLBs. |

---

## Critical files

- **New:**
  - `app/lib/configurator/{engine/*,config.ts,pricing.ts}`
  - `app/routes/app.configurator.$productId.tsx`
  - `app/components/configurator/*`
  - `app/routes/proxy.designs.tsx`, `proxy.d.$code.tsx`, `webhooks.orders.create.tsx`
  - `extensions/viewer-3d/blocks/product_configurator.liquid`, `core_embed.liquid`
  - `extensions/cart-transform/`
  - Admin UI extensions under `extensions/admin-*`
  - `scripts/build-configurator.mjs`
- **Modified:**
  - `prisma/schema.prisma`, `shopify.app.toml` (scopes, webhook)
  - `app/routes/app.setup.tsx` / `app/lib/metafields.server.ts`
  - `app/routes/app.products.$id.tsx` (entry button)
  - `app/routes/webhooks.compliance.tsx`
  - `app/lib/billing.server.ts` (feature gating)
  - `app/i18n/locales/*`
- **Untouched:** the AR code in `extensions/viewer-3d/assets/viewer-3d.js`.

## Verification (per phase)

- `npm run typecheck`, `npm run lint`, `npm run check-locales`, and the configurator-bundle drift check.
- Run `shopify app dev`. Test the admin editor **through the tunnel URL**, not localhost, because of the `/extensions/*` 404 issue.
- Dev store with Dawn and Horizon: add the block, configure a product, check the live price, add to cart, and confirm the properties and snapshot in the cart.
- Cart Transform: `shopify app function run` with fixture input. Then a test order on a non-Plus dev store (lineExpand) and a Plus sandbox (lineUpdate).
- Place an order, confirm `OrderDesign` is frozen, then edit the product and confirm the old order preview doesn't change.
- Share link: open in an incognito window, check expiry, check that views are counted.
- Lighthouse on the product page: confirm the cost is within 10 points before and after the configurator loads.
