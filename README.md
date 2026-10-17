# viewer-3d — Shopify 3D Model Viewer

Shopify app that lets merchants attach interactive 3D models (`.glb` / `.gltf`)
to products and pages. Built with:

- **Theme app extension** — two app blocks merchants drop into their theme
  (product page + generic page). Renders models using [egjs-view3d](https://naver.github.io/egjs-view3d/).
- **Embedded admin dashboard** — React Router 7 + Polaris web components +
  App Bridge. Merchants browse products, upload `.glb` files, and assign them
  to the `custom.model_3d` metafield. Sessions stored via Prisma on MongoDB
  (see `DATABASE_URL`).

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
│   │   ├── webhooks.app.*.tsx        # uninstalled / scopes_update / billing
│   │   └── webhooks.compliance.tsx   # Shopify's 3 mandatory privacy webhooks
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

Declared in `shopify.app.toml` under `[access_scopes]`; the CLI syncs them to the
Partner Dashboard on `shopify app deploy`.

```
write_products    # set custom.model_3d / custom.viewer_3d_config on products
write_files       # upload .glb to Shopify Files via fileCreate
write_themes      # read the published theme's product/page template and insert
                  # the app block into it (the one-click "Add block" action);
                  # implies read_themes, which the block-status check needs
```

Nothing else is requested. `write_themes` is the only one that needs justifying
during review: without it the app can detect nothing about the merchant's theme
and cannot add the block for them, leaving a manual theme-editor walkthrough as
the only path to a working viewer.

## Running locally

```bash
npm install
shopify app dev --reset
```

The CLI will:
1. Re-link to your Partner app
2. Spin up a tunnel
3. Run `prisma db push && react-router dev`
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

Pushes the app configuration (`shopify.app.toml`) and the theme extension. The
admin app itself is hosted separately — `application_url` and `[app_proxy].url`
in `shopify.app.toml` must both point at that host.

For a self-hosted VPS — Node, MongoDB, systemd, nginx, TLS, and the order the
two deploys have to happen in — see **[DEPLOY-VPS.md](DEPLOY-VPS.md)**.

### Production environment

Copy `.env.example` to `.env` and fill it in. Two entries decide whether a
production deploy behaves correctly:

| Variable | Why it matters |
| --- | --- |
| `DATABASE_URL` | The MongoDB connection string, including a database name in the path (Prisma has no default database for MongoDB). Holds live Shopify access tokens, so a deploy pointed at the wrong database logs every merchant out and makes every webhook fail HMAC. |
| `SHOPIFY_BILLING_TEST` | **Leave unset.** Setting it creates app subscriptions as *test* charges, which are never billed. See `app/lib/app-config.ts`. |

`shopify app dev` injects `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
`SHOPIFY_APP_URL` and `SCOPES` itself and rotates the URL on every tunnel, so
leave those unset locally — a stale value in `.env` wins over the CLI's and
breaks OAuth. Set them only where the CLI is not running the process.

Schema changes run through `npm run setup` (`prisma generate && prisma db
push`). Prisma Migrate does not support MongoDB, so there is no
`prisma/migrations` directory and `prisma migrate deploy` will refuse to run —
`db push` is what creates the unique and compound indexes the schema declares.

`prisma generate` must run **on the deploy target**, or `binaryTargets` in
`prisma/schema.prisma` must name that target's platform. Prisma resolves a
platform-specific query engine binary at runtime, so a `node_modules` generated
on macOS and copied to a Linux host throws `Query engine library for current
platform could not be located` on the first query — a 500 on `/app` while every
route that doesn't touch the database keeps working.

## App Store submission

What the code already satisfies:

- **Mandatory compliance webhooks.** `customers/data_request`,
  `customers/redact` and `shop/redact` are declared with `compliance_topics` in
  `shopify.app.toml` and handled in `app/routes/webhooks.compliance.tsx`. HMAC is
  verified by `authenticate.webhook`, which returns 401 on a bad signature.
  `shop/redact` erases every row keyed to the shop.
- **GraphQL Admin API only.** No REST calls remain — apps submitted after
  1 April 2025 must be built exclusively on the GraphQL Admin API. Theme
  templates go through `theme.files` / `themeFilesUpsert`, shop details and
  subscription status through their GraphQL equivalents.
- **Real charges.** `appSubscriptionCreate` passes `test: BILLING_TEST_MODE`,
  which is false unless `SHOPIFY_BILLING_TEST` is explicitly set.
- **Session-token auth via App Bridge**, injected by `AppProvider embedded` from
  `@shopify/shopify-app-react-router/react`.
- **A theme app extension**, not injected script tags. The vendor bundle
  (egjs-view3d + three.js, ~725KB) is fetched on the first viewer that scrolls
  into view rather than on page load, and viewers mount one at a time and release
  their WebGL contexts when scrolled away — Shopify holds a listed app to moving
  a storefront's Lighthouse score by no more than 10 points.
- **A privacy policy** (`PRIVACY.md`) naming every sub-processor the app sends
  data to: SwipeOne (CRM), Google Analytics 4 and Microsoft Clarity (admin-page
  analytics only).

What has to be done outside this repo before submitting — see
`SUBMISSION-CHECKLIST.md` for the full list:

1. Keep `application_url`, `[app_proxy].url` and `[auth].redirect_urls` on the
   production domain (`3d-viewer-app.bplugins.com`) and re-run `shopify app
   deploy` after any `shopify app dev` session — see the warning under
   `automatically_update_urls_on_dev` in DEPLOY-VPS.md.
2. Fill in the Partner Dashboard listing: pricing that matches
   `SEED_PLANS` in `app/lib/billing.server.ts`, screenshots, support contact,
   privacy policy URL, and test instructions for the reviewer.

## Trade-offs and known gotchas

- **Vendor bundle size.** egjs-view3d packages three.js, so
  `extensions/viewer-3d/assets/view3d.pkgd.min.js` is ~725KB — an order of
  magnitude more than everything else the extension ships. It is vendored (no
  jsDelivr dependency) and no longer loaded eagerly: `viewer-3d.js` reads its URL
  off its own `<script data-vendor-js>` tag and fetches it on the first mount, so
  a page whose viewer stays below the fold never pays for it.
- **IDE warnings.** `"target": "section"` in app block schemas is flagged by
  some linters using *theme block* rules. It's required for *theme app
  extension* blocks — ignore.
- **Metafield definition required.** Without the `custom.model_3d` definition
  (with storefront read access), the block can write but the theme can't read.
  The dashboard checklist and `/app/setup` page reinforce this.
- **No GLB validation server-side** beyond extension check. A malicious / huge
  file would still upload; consider adding size limits or a GLB header check
  before going public.
