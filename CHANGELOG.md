# Changelog

## 2026-11-09 — Iframe embed, variant preview, editor controls

Commit `b054abb` on `shohan-bplugins/test` (`main`).

### Before you deploy

- **No new dependencies, database changes or access scopes.** The iframe embed
  uses the existing app proxy (`/apps/viewer-3d`, set in `shopify.app.toml`).
- **Deploy the theme extension** (`shopify app deploy`). The *3D Product
  Configurator* block has a new setting, and `viewer-3d.js`, `viewer-3d.css`,
  `configurator.js` and `configurator.css` have changed.
- **Deploy the `extensions/` folder to the VPS as well.** The new
  `/storefront-assets/*` route serves the extension's JS and CSS files from
  disk, so the iframe embed breaks if that folder is missing.

```bash
npm run build && pm2 restart 3d-viewer
```

### Added

- **Iframe embed for themes that can't use app blocks** (vintage themes, page
  builders, custom pages). The product page has a new *Embed with iframe*
  section with copyable code:
  - Choose *This product*, or *Product template (every product)*, which uses
    `{{ product.handle }}` so a single paste covers every product.
  - Set the layout in the section: default media, gallery position and height,
    3D background, full or custom width, variant picker style (buttons or
    dropdown), vendor, SKU, quantity, *Buy now* and description. These options
    are saved per product (metafield `$app:configurator.embed`) using the
    page's save bar.
  - The embed shows the full *Product configurator* (gallery, variants,
    customer options, add to cart). The page is served from the store's own
    domain at `/apps/viewer-3d/configurator/<handle>`, so it adds to the
    shopper's real cart and shows prices in their currency and language.
  - It works on password-protected stores, including development stores. The
    page is fetched and loaded as the iframe's `srcdoc`, because Shopify won't
    let a password-protected store be shown in a frame directly.
  - The iframe grows to fit its content. After *Add to cart* it either updates
    the theme's cart count or goes to the cart page (your choice). *Buy now*
    opens checkout in the full window, because checkout won't load inside a
    frame.
  - The code can be pasted more than once on a page.
- **Variant preview on the product page.** Click a variant row, or its new
  *Preview* button, to show that variant in the live preview with its own model
  (or an option rule's model) and its 3D editor materials and colours, the same
  way the storefront shows it. A "Previewing: …" badge appears above the
  preview, and *Show product default* switches back.
- **"Default media" setting** on the *3D Product Configurator* block. The
  gallery can open on the 3D model or on the selected variant's image. Products
  without a 3D model always open on the image.
- **Translations** for all the new text in the 12 dashboard languages
  (`product.json`, `editor.json`). The embed page uses the storefront
  translations of the shopper's language.

### Changed

- **3D editor viewport controls** (zoom in / out, frame, grid, auto-rotate) now
  look like the viewer's own controls: square white buttons in the corner.
  Grid and auto-rotate are filled while they're on.
- **The configurator gallery stays on 3D when the shopper changes variant**,
  instead of jumping to the variant's image.
- **The admin preview and the storefront now share the same styling code**
  (`app/lib/configurator/styler.ts`), so a variant looks the same in both.

### Fixed

- **Replacing or removing a product's model now updates the configurator.**
  Previously the *3D Product Configurator* block kept showing the old model.
  Only the model is updated: unpublished draft edits stay unpublished.
  Products that were already out of sync are repaired the next time their
  product page is opened in the app.
- **The 3D controls no longer show on top of an image** in the configurator
  gallery.
- **The fullscreen close button no longer covers other controls.** When every
  corner has a control, the close button is added to one of those control bars
  instead of being drawn over it, both on the storefront and in the admin
  preview. Controls that are switched off no longer count as taking a corner.

## 2026-11-04 — 3D configurator & editor

Hand-off commit `ec75d55` on `shohan-bplugins/test` (`main`).

### Before you deploy

- **Run `npm ci`.** The update adds a new dependency, `@react-three/fiber`, and
  the dev dependency `@types/three`.
- **Run `npm run setup`** (`prisma db push`) against the production database.
  It creates four new collections: `ProductConfig`, `Design`, `OrderDesign` and
  `Preset`. The new pages return 500 errors until this has run.
- **New access scopes: `write_inventory`, `read_locations`.** Add them to
  `SCOPES` in the VPS `.env` and to `shopify.app.toml`, then run
  `shopify app deploy`. Merchants are asked to approve the new scopes the next
  time they open the app.
- **Deploy the theme extension** (`shopify app deploy`). It has two new app
  blocks and a new `configurator.js` asset.

Full order on the VPS:

```bash
npm ci && npm run setup && npm run build && pm2 restart 3d-viewer
```

### Added

- **3D products page** (`/app/product-3d`, new nav item). It lists every product
  with its 3D setup and has filter tabs and bulk Enable / Disable 3D with undo.
  You can add a model by uploading it, picking it from Shopify Files or
  importing it from a URL.
- **Full-screen 3D editor** (`/app/products/:id/editor`). It opens in an App
  Bridge app window from the product page or the 3D products page:
  - Edit per-part materials and colours in a React Three Fiber viewport.
  - Set up per-variant and per-option-value 3D setups, and use a different
    model for each variant if needed.
  - Add customer options with price changes and "show only when…" conditions.
  - Use "Save draft" and "Publish". Drafts can be previewed on the storefront
    with `?e3d_preview=1`, and shoppers never see them.
  - Switch to a "Shopper view" to edit the shopper viewer's settings and
    hotspots in place.
- **Variants on the product page.** Create, edit and delete real Shopify
  variants: price, compare-at price, SKU and stock. "Customize 3D" on a variant
  opens the editor for that variant only. A variant's 3D setup can be reset or
  copied to other variants.
- **Theme blocks:**
  - *3D Product Configurator*: a complete product section in one block, with a
    3D and image gallery, title, price, variant picker, quantity, add to cart,
    customer options, description and tabs.
  - *3D product + Customize*: the same section, with the customer options in a
    sheet opened by a "Customize" button.
- **Settings search** in the product page's Viewer settings. It filters the
  settings down to the controls that match.
- **Demo assets** in `public/`: 7 demo models (`demo-models/`), 10 HDRI
  environments (`hdri/`) and the Draco decoder (`draco/`).
- **`npm run build:storefront`.** It bundles `app/lib/configurator/storefront`
  into `extensions/viewer-3d/assets/configurator.js`. The output is committed.
- **Translations** for the new screens in all 12 dashboard languages
  (`editor.json`, `product3d.json`) and in the storefront locales.

### Changed

- **"Disable 3D" turns the viewer off but keeps the model assigned.** The 3D
  products page publishes `enabled: false`, and the product viewer block then
  renders nothing. A model URL typed directly into the block still renders.
- **The viewer fires a `viewer3d:ready` event** once it has loaded. The
  configurator block listens for it to apply the shopper's choices.
- **Customer options and hotspots are free on every plan for now.** This is
  controlled by `CUSTOMIZER_ALL_FREE` in
  `app/lib/configurator/modules.server.ts`; set it to `false` to restore the
  Growth / Advance gating.
- **New loading animation.** A shared cube loader replaces the spinners on the
  boot splash and the documentation page.
- **Inside the editor window**, the app nav and the Crisp chat widget are
  hidden so they don't overlap the editor.

### Privacy / GDPR

The app now stores shopper data: `Design` rows hold a shopper's option choices
and personalization text, linked to their customer id if they were logged in.
The compliance webhooks handle this data as follows:

- `customers/data_request` logs how many designs are held for that customer.
- `customers/redact` deletes that customer's designs.
- `shop/redact` also deletes the shop's product configs and designs.

Update the privacy policy (`PRIVACY.md`, and the listing) before this goes to
App Store review. They currently say no shopper data is stored.

### Security

- **Importing a model from a URL is protected against SSRF.** Only `https` is
  allowed, on the default port and with no credentials in the URL. Every
  resolved IP is checked when the connection is made, which blocks DNS
  rebinding to internal addresses.
