# App review notes — Easy 3D Viewer

Everything a Shopify app reviewer needs to install this app, see every feature
work, and check the requirements that are checked on submission.

**The Partner Dashboard's "Testing instructions" field caps at 2,800
characters, and this file is far longer than that.** Paste
`TESTING-INSTRUCTIONS.txt` into that field instead — it is this file's §1–7
condensed to 2,614 characters, which leaves ~109 characters of headroom once the
five placeholders are filled with real values.

Sections **1–7** here are the long form: the same flow with the detail a
reviewer needs if they ask a follow-up. Sections **8–13** are the reference for
scopes, webhooks and data handling — keep them in the repo, and link or paste
them if asked.

Companion files: `SUBMISSION-CHECKLIST.md` (what we must do before submitting),
`APP-STORE-PUBLIC-PAGE.md` (listing copy), `PRIVACY.md` (privacy policy),
`FEATURES.md` (full feature list).

> **Fill in before submitting.** Six things in this file are placeholders,
> marked `«FILL IN»`. A reviewer who has to guess any of them is a rejection.
> They are: demo store URL, staff login, sample `.glb` URL, screencast URL,
> support email, and the review-window billing note in §5.

---

## 1. What the app does, in one paragraph

Easy 3D Viewer lets a merchant upload a `.glb` or `.gltf` file and show it as an
interactive 3D model on their storefront — the shopper drags to rotate, scrolls
to zoom, and on a phone can place the product in their own room in AR. Models
render inside a **theme app block** the merchant drops into their product page or
any other page; there is no script injection and no theme code editing. A model
is attached to a product through the `custom.model_3d` metafield, and the
viewer's settings (lighting, auto-rotate, AR toggles, controls) are stored in
`custom.viewer_3d_config`. Both metafield definitions are created by the app, on
the merchant's click, during setup.

---

## 2. Test credentials and demo store

| | |
| --- | --- |
| **Install on** | Any Shopify development store, or our demo store below |
| **Demo store URL** | «FILL IN — e.g. https://easy-3d-viewer-demo.myshopify.com» |
| **Storefront password** | «FILL IN, or "none — storefront is public"» |
| **Staff login** | «FILL IN email» / «FILL IN password» |
| **Screencast of the full flow** | «FILL IN — 2–3 min, install to storefront» |
| **Support email** | «FILL IN — the address a human answers» |

The demo store already has a model uploaded, assigned to a product, and the
block placed, so the finished result can be seen without doing the setup. **The
walkthrough in §3 is still worth running on a fresh development store** — it is
the flow a real merchant meets, and it takes about three minutes.

### What to have ready

- **A `.glb` file.** Do not assume you have one. Download:
  «FILL IN — a direct `.glb` link we host, e.g.
  https://apps.bplugins.com/docs/3d-viewer/sample/sample-model.glb»
  Any `.glb` or `.gltf` up to **20 MB** works.
- **A product** in the store with an image (any product; a physical one reads
  best).
- **A published theme on the modern theme architecture** — Dawn, or any theme
  with **Add block → Apps** in the theme editor. Older themes need the
  copy-paste embed instead (§4.3), which is a supported path, not a fallback for
  a broken one.

Nothing here needs a paid plan. **The Free plan shows the entire feature set** —
plans differ only in *how many* products and models you may publish, never in
what the viewer can do. Billing is covered separately in §5.

---

## 3. The main flow — install to a 3D model on the storefront (~3 minutes)

1. **Install the app.** You land on **Get started**, a three-step checklist.
   Progress reads *0 of 3 done*.

2. **Step 1 — "Connect the viewer metafields".** Click **Create definitions**.

   This creates two metafield definitions on the shop, both with **storefront
   read access** on:

   | Namespace + key | Type | What it holds |
   | --- | --- | --- |
   | `custom.model_3d` | File | The product's 3D model file |
   | `custom.viewer_3d_config` | JSON | That product's viewer settings |

   Nothing else on the store is touched — no product data is written, no theme
   file is changed by this step. You can verify the definitions in **Settings →
   Custom data → Products**, or in the app under **Setup**, which shows the live
   status of each one and can repair a definition whose storefront access was
   turned off by hand.

3. **Step 2 — "Add your first 3D model".** Click **Pick a product**, choose any
   product, then drop the `.glb` onto the upload area.

   The file goes to **Shopify Files** (`fileCreate`) — we do not host merchant
   model files — and its reference is written to that product's
   `custom.model_3d`. A **live preview** appears immediately, with the viewer
   settings beside it: rotate, zoom, lighting, background, auto-rotate, AR
   toggles, on-screen controls. Change anything and the preview updates before
   you save.

4. **Step 3 — "Show the viewer on your storefront".** Click **Add block for
   me**.

   The app reads the **published** theme's `templates/product.json` and inserts
   the **3D Viewer — Product** block into it (`themeFilesUpsert`). This is the
   only reason the app asks for `write_themes` — see §8. If you would rather do
   it by hand, click **Open theme editor** and add it under **Add block → Apps**;
   the app detects either route and ticks the step.

5. **Open the product on the storefront.** The viewer renders in place. Confirm:

   - Drag rotates the model; scroll or pinch zooms.
   - The on-screen controls work — fullscreen, reset view, zoom in/out,
     snapshot.
   - **No JavaScript errors in the console.**

6. **Open the same product page on a phone** (§6 for AR specifics). A **View in
   your room** button appears on supported devices.

That is the whole product. Everything below is a secondary path, or a
requirement you may want to verify directly.

---

## 4. Secondary paths worth seeing

### 4.1 The 3D model library

**3D Model Library** in the app nav is a store of models independent of any one
product: drag-and-drop upload, search, sort, list/grid view, bulk delete, and
per-model viewer settings. From a model you can assign it to a product, and from
a product you can pick an existing library model instead of uploading again.

Every plan allows **one model per product**.

### 4.2 A 3D model on a page (not a product)

The **3D Viewer — Page** block goes on any page template and takes either:

- a **Model ID** from the library — resolved on the storefront through the app
  proxy at `https://<shop>/apps/viewer-3d/model/<id>`, so the request never
  leaves the shop's own domain; or
- a **Model URL** pointing at any public `.glb` / `.gltf`.

### 4.3 The copy-paste embed, and stores on older themes

Each model has a shareable viewer page at `/viewer/<id>` on the app's domain and
an **iframe snippet** the merchant can paste into a page's HTML, a blog post, or
a site that is not Shopify at all. This is also the path for a theme with no
**Apps** block support. The snippet is built to survive Shopify's page HTML
editor — inline styles only, no `<style>` or `<script>` — and delegates
`fullscreen` and `xr-spatial-tracking` so both fullscreen and WebXR AR keep
working inside the frame.

`/viewer/<id>` is **deliberately unauthenticated** — an embed on a third-party
site has no session to present. The id is a v4 UUID, so it is not enumerable,
and the response carries only the model name, file URL and viewer config; the
owning shop is never exposed. See `app/routes/viewer.$id.tsx` and
`app/lib/model-resolve.server.ts`.

### 4.4 A product with no model

Open any product that has no model assigned. The page renders normally: **no
viewer, no empty box, no error, and nothing logged to the console.** The block
renders nothing at all when there is no model to show, and the 3D vendor bundle
is never requested.

---

## 5. Billing

Four plans, seeded by the app itself from `SEED_PLANS` in
`app/lib/billing.server.ts`. **These figures must match the listing exactly:**

| Plan | Price | Billing | Trial | Products with a model | Models in library |
| --- | --- | --- | --- | --- | --- |
| Free | $0 | — | — | 3 | 3 |
| Starter | $8.88 | Monthly | 7 days | 15 | 15 |
| Growth | $18.88 | Monthly | 7 days | 100 | 100 |
| Advance | $35.88 | Monthly | 7 days | Unlimited | Unlimited |

**Monthly only, USD.** Annual billing and promotional codes are implemented
server-side but switched off in the UI (`SHOW_BILLING_OPTIONS = false`,
`app/routes/app.pricing.tsx:349`), so there is no way for a merchant to buy
either one today. The listing must therefore quote these monthly prices and
nothing else — an annual price on the listing that the app cannot charge is a
listing/app mismatch.

**All charges are created through Shopify's Billing API** (`appSubscriptionCreate`)
and are **real, not test charges**. Test mode exists only behind an explicit
`SHOPIFY_BILLING_TEST=1` environment variable, is never inferred from `NODE_ENV`,
and is not set in production — see `BILLING_TEST_MODE` in
`app/lib/app-config.ts`.

### To test billing

1. Open **Pricing**. Confirm the four plans and the prices above. There is no
   monthly/yearly toggle — every plan is monthly.
2. Choose **Starter**. Shopify's own approval screen appears, showing
   **$8.88/month** and a **7-day free trial** (the trial is passed to
   `appSubscriptionCreate` from the plan row, `app.pricing.tsx:253`).
3. Approve. You return to the app; the plan badge and the dashboard's limits
   update to 15 / 15.
4. **Cancel** from within the app. Limits drop back to Free (3 / 3). Models over
   the limit are **not deleted** — they stay in the library and keep rendering
   on the storefront; what the merchant loses is the ability to add more until
   they are back under the cap or upgrade again.
5. On the Free plan, add models until the limit is reached. A warning banner
   names the plan and what is capped, and the upload control is disabled rather
   than failing after the fact.

> **«FILL IN»** If you would rather not be charged during the review, say so and
> we will move the demo store onto a plan for you, or state here that reviewers
> should approve and immediately cancel inside the trial. Do not leave this
> paragraph as-is.

---

## 6. Augmented reality — how to test, and the one caveat

Open a product page with a model on a phone and tap **View in your room**.

| Platform | Mechanism | Needs |
| --- | --- | --- |
| Android | Google Scene Viewer | The `.glb` already uploaded |
| Android (in-browser) | WebXR, on supported devices | The `.glb` already uploaded |
| **iPhone / iPad** | Apple Quick Look | **A separate `.usdz` file the merchant supplies** |

**The iOS caveat is a platform constraint, not a defect.** Apple Quick Look
renders `.usdz` only; it cannot read `.glb`. The merchant adds a `.usdz`
alongside the `.glb` and the AR button then works on iOS. This is stated in the
listing, in the in-app documentation, and in `FEATURES.md` — we do not claim
iPhone AR from a `.glb` alone.

Each AR method can be switched off individually in the viewer settings.

---

## 7. Storefront performance

Shopify holds a listed app to reducing a storefront's Lighthouse performance
score by **no more than 10 points**. This app is built for that:

- The viewer is a **theme app block**. There is no `ScriptTag`, and nothing loads
  on pages where a merchant has not placed a block.
- The 3D vendor bundle (`view3d.pkgd.min.js`, the largest asset by far) is
  **not requested until a viewer approaches the viewport** — see `ensureVendor`
  in `extensions/viewer-3d/assets/viewer-3d.js`.

**To verify:** open a product page with a model, and in the network panel confirm
`view3d.pkgd.min.js` is absent on load and appears only once you scroll the
viewer into view. Then run Lighthouse (mobile) on that page and on a product page
without the block, and compare.

---

## 8. OAuth scopes, and why each is needed

Declared in `shopify.app.toml` under `[access_scopes]`. Nothing else is
requested.

| Scope | Why the app cannot work without it |
| --- | --- |
| `write_products` | Writes `custom.model_3d` and `custom.viewer_3d_config` on the product the merchant assigns a model to. This *is* the assignment. |
| `write_files` | Uploads the merchant's `.glb` / `.gltf` to **Shopify Files** via `fileCreate`, so model files live on the merchant's own store rather than on our infrastructure. |
| `write_themes` | Reads the published theme's `product.json` / `page.json` to report whether the block has been added, and inserts it on the merchant's click ("Add block for me"). Implies `read_themes`, which the status check needs. |

`write_themes` is the only one that usually needs discussing. Without it the app
can detect nothing about the merchant's theme and cannot place the block, which
leaves a manual theme-editor walkthrough as the only route to a working viewer —
and that step is where merchants stall. The app writes **one block entry into one
template of the published theme**, only on an explicit click, and touches nothing
else in the theme.

The app uses the **GraphQL Admin API only** — no REST endpoints.

---

## 9. Webhooks

Declared in `shopify.app.toml`, registered on `shopify app deploy`. Every one is
HMAC-verified by `authenticate.webhook`, which returns **401** on a bad
signature.

| Topic | Endpoint | What it does |
| --- | --- | --- |
| `app/uninstalled` | `/webhooks/app/uninstalled` | Deletes the shop's sessions |
| `app/scopes_update` | `/webhooks/app/scopes_update` | Updates the stored session scope |
| `app_subscriptions/update` | `/webhooks/app/subscriptions_update` | Keeps the shop's plan and limits in step with Shopify |
| `customers/data_request` | `/webhooks/compliance` | See §10 |
| `customers/redact` | `/webhooks/compliance` | See §10 |
| `shop/redact` | `/webhooks/compliance` | See §10 |

The three privacy webhooks are declared with `compliance_topics` and handled
together in `app/routes/webhooks.compliance.tsx`. All three return **200**; a
request with an invalid HMAC returns **401**.

---

## 10. Data handling and privacy

**This app stores no shopper data whatsoever.** Nothing is keyed to a customer,
nothing a shopper submits is recorded, and the storefront viewer is read-only —
it renders a model and records nothing. There are no cookies set on the
storefront by the viewer.

What we do store, all keyed by shop domain:

| Data | Why |
| --- | --- |
| Shopify offline access token + session | To call the Admin API on the merchant's behalf |
| Shop domain, plan, and usage limits | Billing and plan enforcement |
| Model records — name, Shopify file GID and URL, size, viewer settings JSON | The model library and its per-model settings |
| Charge records — plan, price, status, dates | The merchant's billing history; Shopify holds the authoritative copy |

Model **files** themselves live in the merchant's own Shopify Files, not on our
servers.

### Responses to the compliance webhooks

- **`customers/data_request`** — 200. We hold no data on that shopper; the
  request is logged so a merchant asking what happened has an answer.
- **`customers/redact`** — 200. Nothing to erase, same logging.
- **`shop/redact`** — 200, and every row for that shop is deleted in one
  transaction: sessions, models, charges, the app-user record, and the webhook
  record.

Sub-processors, and what each receives, are named in full in `PRIVACY.md`
(MongoDB Atlas for the database; our own ticket and CRM endpoints for support
requests and install notifications — shop and store-contact details, never
shopper data).

---

## 11. Known limitations — expected behaviour, not bugs

- **iPhone AR needs a `.usdz` file the merchant supplies.** §6.
- **The drag-and-drop blocks need a theme with `Add block → Apps`.** Older
  themes use the copy-paste embed in §4.3.
- **One 3D model per product**, on every plan including Advance.
- **`.glb` and `.gltf` only**, up to **20 MB** per file. Other formats
  (`.fbx`, `.obj`, `.stl`) are rejected at the picker with an explanatory
  message rather than failing on upload — the renderer ships a glTF loader only.
- **English only.** The theme extension has one locale,
  `extensions/viewer-3d/locales/en.default.json`.
- **Plan limits are enforced when adding, never by deletion.** They gate
  uploading a model and assigning one to a product. A merchant who downgrades
  keeps every model and every live viewer; they cannot add another until they
  are under the new cap. Nothing already on the storefront breaks, and nothing
  is deleted.

---

## 12. If something goes wrong during review

| What you see | What it means |
| --- | --- |
| The viewer does not appear on the storefront, but the block is in the theme | The product has no model assigned (§4.4), or `custom.model_3d`'s storefront read access was turned off. Open **Setup** in the app — it shows the live status of both definitions and repairs them. |
| "Add block for me" is disabled | The app could not read a published theme. Add the block by hand: **Online Store → Themes → Customize → Product template → Add block → Apps → 3D Viewer — Product**. |
| A Model ID on a page block renders nothing | The Model ID resolves through the app proxy on the shop's own domain (§4.2). Confirm the block's Model ID matches one in **3D Model Library**. |
| The app asks you to authorize again | Expected after a long idle period; it re-authorizes rather than erroring. |

Anything else — **«FILL IN support email»**, and we will answer inside one
business day.

---

## 13. Quick reference

**Admin pages** (embedded, App Bridge, session-token auth, Polaris web
components throughout):

| Path | Page |
| --- | --- |
| `/app` | Dashboard — usage, recent models, upload activity |
| `/app/onboarding` | Get started — the three-step checklist |
| `/app/products` | Product 3D Models |
| `/app/models` | 3D Model Library |
| `/app/setup` | Setup — metafield definition status and repair |
| `/app/pricing` | Pricing and plan management |
| `/app/documentation` | In-app documentation |

**Public endpoints** (unauthenticated by design, §4.3):

| Path | Purpose |
| --- | --- |
| `/` | Public landing page (no `?shop=` needed) |
| `/viewer/<id>` | Shareable / embeddable viewer for one model |
| `/api/model/<id>` | Model JSON for the embed |
| `/proxy/model/<id>` | The same, reached via `https://<shop>/apps/viewer-3d/model/<id>` |

**Theme app extension** — `extensions/viewer-3d/`, two blocks:
**3D Viewer — Product** (reads `custom.model_3d`) and **3D Viewer — Page**
(Model ID or a direct URL).

**Versions** — Admin API `2026-01`; theme extension API `2026-01`.
