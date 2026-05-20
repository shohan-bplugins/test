# viewer-3d — Shopify 3D Model Viewer

Shopify app that lets merchants attach interactive 3D models (`.glb` / `.gltf`)
to products and pages. Built with:

- **Theme app extension** — two app blocks merchants drop into their theme
  (product page + generic page). Renders models using [egjs-view3d](https://naver.github.io/egjs-view3d/).
- **Embedded admin dashboard** — React Router 7 + Polaris web components +
  App Bridge. Merchants browse products, upload `.glb` files, and assign them
  to the `custom.model_3d` metafield. Sessions stored in SQLite via Prisma.

## Project layout

```
.
├── app/                              # React Router admin app
│   ├── routes/
│   │   ├── app._index.tsx            # Product list + 3D model status
│   │   ├── app.products.$id.tsx      # Upload / replace / remove model
│   │   ├── app.setup.tsx             # Setup guide
│   │   ├── app.tsx                   # Embedded app shell + nav
│   │   ├── auth.$.tsx                # OAuth callback
│   │   ├── auth.login/               # Login route
│   │   └── webhooks.*.tsx            # uninstalled / scopes_update
│   ├── db.server.ts                  # Prisma client
│   └── shopify.server.ts             # shopify-app-react-router config
├── extensions/viewer-3d/             # Theme app extension
│   ├── blocks/
│   │   ├── product_viewer.liquid     # Reads custom.model_3d on product
│   │   └── page_viewer.liquid        # URL setting on page
│   ├── assets/
│   │   ├── viewer-3d.js              # Initializes View3D
│   │   └── viewer-3d.css
│   └── locales/en.default.json
├── prisma/schema.prisma              # Session storage
├── shopify.app.toml                  # App config (scopes, webhooks, etc.)
├── shopify.web.toml                  # Web process config (dev/predev hooks)
├── vite.config.ts
└── package.json
```

## OAuth scopes

```
write_products    # set metafields on products
write_files       # upload .glb to Shopify Files via fileCreate
```

## Running locally

```bash
npm install
shopify app dev --reset
```

The CLI will:
1. Re-link to your Partner app
2. Spin up a tunnel
3. Run `prisma migrate deploy && react-router dev`
4. Give you a preview URL — open it to install the app on your dev store

The app will appear in the dev store's admin sidebar under **Apps** (because it
now has an embedded admin UI, unlike before).

## Merchant flow

1. **Install the app** from the Partner-provided install link.
2. **Create the metafield definition** (one-time, see in-app Setup guide):
   - Settings → Custom data → Products → Add definition
   - Namespace + key: `custom.model_3d`
   - Type: File
   - Storefronts: Read access **ON**
3. **Upload models** from the app dashboard: open Products → click a product →
   choose a `.glb` file → Upload.
4. **Add the block** in the theme editor: Online Store → Themes → Customize →
   Product template → Add section → Apps → **3D Model Viewer**.
5. **Done** — the storefront renders the 3D model.

## Admin app routes

| Route | Purpose |
| --- | --- |
| `/app` | Dashboard: list of products + which ones have a 3D model |
| `/app/products/:id` | Product detail: upload `.glb`, remove, or view current model |
| `/app/setup` | Static setup guide |
| `/auth/*` | OAuth |
| `/webhooks/*` | App lifecycle webhooks |

## How the upload flow works

1. Merchant submits a `.glb` file in the product detail page (`<Form encType="multipart/form-data">`).
2. Server action runs the Admin GraphQL three-step:
   - `stagedUploadsCreate` — Shopify returns a presigned S3-style URL.
   - POST the file to that URL.
   - `fileCreate` — Shopify ingests the staged file into Files, returns a file GID.
   - `metafieldsSet` — write the file GID into `custom.model_3d` on the product
     (type `file_reference`).
3. Theme block reads `product.metafields.custom.model_3d.value.url` server-side
   and the JS asset initializes egjs-view3d on `[data-view3d]`.

## Theme block settings

| Setting | Type | Notes |
| --- | --- | --- |
| Model URL override | url | Optional on product block (overrides metafield) |
| Model URL | url | Required on page block |
| Viewer height | range | 200–800 px |
| Background color | color | Behind the canvas |
| Auto rotate | checkbox | |
| Show on-screen controls | checkbox | Play / fullscreen / reset / progress bar |

## Deploying

```bash
shopify app deploy
```

Pushes both the React Router app config and the theme extension. The hosted
admin app itself needs separate hosting (Fly, Vercel, Render, etc.) once
you're past dev — update `application_url` in `shopify.app.toml` accordingly.

## Trade-offs and known gotchas

- **CDN library load.** Theme blocks load egjs-view3d from jsDelivr. Production
  apps should vendor `view3d.pkgd.min.js` + `view3d-bundle.min.css` into
  `extensions/viewer-3d/assets/` and reference via `asset_url` to avoid the
  external-asset warning and survive CDN outages.
- **IDE warnings.** `"target": "section"` in app block schemas is flagged by
  some linters using *theme block* rules. It's required for *theme app
  extension* blocks — ignore.
- **Metafield definition required.** Without the `custom.model_3d` definition
  (with storefront read access), the block can write but the theme can't read.
  The dashboard checklist and `/app/setup` page reinforce this.
- **No GLB validation server-side** beyond extension check. A malicious / huge
  file would still upload; consider adding size limits or a GLB header check
  before going public.
