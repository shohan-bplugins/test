# App Store submission checklist — Easy 3D Viewer

Everything in this file is work that cannot be done from the repository. The
code-side requirements are done and listed under **Already handled** at the
bottom, with the file that satisfies each one.

---

## 1. Blockers — the app cannot be submitted until these are done

### 1.1 Point the app at a production domain

`shopify.app.toml` now points every URL at the production host:

```toml
application_url = "https://3d-viewer-app.bplugins.com"

[app_proxy]
url = "https://3d-viewer-app.bplugins.com/proxy"

[auth]
redirect_urls = [ "https://3d-viewer-app.bplugins.com/auth/callback" ]
```

These read `3d-viewer-app-test.bplugins.com` until 1 September 2026, while the
server ran on the non-test host — which broke Model ID resolution on the
storefront and nothing else, because the proxy is the only path that leaves the
shop's own domain.

All three must change together, and all three must be the same host. A mismatch
between `application_url` and `[app_proxy].url` is the failure mode the proxy was
introduced to remove: the storefront block resolves a Model ID through
`https://<shop>/apps/viewer-3d/model/<id>`, Shopify forwards that to
`[app_proxy].url`, and if that host is wrong every viewer using a Model ID fails
with the browser's opaque "Failed to fetch".

Then `shopify app deploy`.

### 1.2 Point `DATABASE_URL` at the production MongoDB database

The database holds live Shopify offline access tokens:

- Lose it and every merchant is logged out and has to reinstall.
- Lose it and every incoming webhook fails to find a session.

MongoDB is off-host, so an ephemeral filesystem no longer costs anything — but
three things still have to be right:

- The connection string ends in a **database name** (`…mongodb.net/viewer3d`).
  Prisma's MongoDB connector has no default database and fails at connect time.
- The production deploy's egress IP is in the Atlas project's Network Access
  allowlist. A blocked IP times out on the first query and reads like a bad
  password.
- Production and dev use **different database names**, so a dev run cannot
  invalidate live merchant sessions.

Run `npm run setup` on the host once (`prisma generate && prisma db push`) —
`db push` is what creates the unique indexes on `AppUser.shop`,
`WebhookCall.shop` and `Plan.name`. Without it the app still reads and writes,
it just silently loses every uniqueness guarantee.

Confirm before submitting: install on a dev store, restart the host, reload the
embedded app. If it asks you to reinstall, this is not done.

### 1.3 Confirm `SHOPIFY_BILLING_TEST` is not set in production

Set, it creates every app subscription as a *test* charge — the merchant sees the
normal approval screen and is never billed. Reviewers check for this, and it is
the single most expensive thing to get wrong.

```bash
# on the production host
env | grep SHOPIFY_BILLING_TEST   # must print nothing
```

### 1.4 Verify the compliance webhooks are registered after deploy

Declared in `shopify.app.toml`, but confirm Shopify actually took them — the
declaration only lands on `shopify app deploy`:

Partner Dashboard → your app → **App setup** → **Compliance webhooks**. All
three fields must show `/webhooks/compliance`:

- Customer data request endpoint
- Customer data erasure endpoint
- Shop data erasure endpoint

Then test each one. From the CLI, against a dev store:

```bash
shopify app webhook trigger --topic=customers/data_request
shopify app webhook trigger --topic=customers/redact
shopify app webhook trigger --topic=shop/redact
```

Each must return 200. Send one with a deliberately wrong HMAC and confirm 401 —
Shopify requires the rejection, and reviewers do test it.

---

## 2. Partner Dashboard — app listing

### 2.1 Pricing must match the code

The plans the app actually creates live in `SEED_PLANS` in
`app/lib/billing.server.ts`. The listing's pricing section must say the same
thing, including trial lengths:

| Plan | Price / month | Trial | Products with a model | Models in library |
| --- | --- | --- | --- | --- |
| Free | $0 | — | 3 | 3 |
| Starter | $8.88 | 7 days | 15 | 15 |
| Growth | $18.88 | 7 days | 100 | 100 |
| Advance | $35.88 | 7 days | Unlimited | Unlimited |

A discrepancy between the listing and the charge the merchant is shown is a
rejection. If you change one, change both.

### 2.2 Required listing fields

- **App name** and **tagline** — must not contain "Shopify".
- **App icon** — 1200×1200, no text, no screenshots of the UI.
- **Feature media** — at least 3 screenshots, 1600×900. Show the embedded admin
  and a storefront product page with a viewer on it.
- **Demo video** (optional but strongly recommended for a visual app like this).
- **Detailed description** — what it does, no competitor comparisons, no pricing.
- **Search terms**, **primary category** (Store design → Product display).
- **Privacy policy URL** — must be live and reachable. `PRIVACY.md` in this repo
  is the content; publish it at a stable URL and link that.
- **Support contact** — an email address that a human answers, plus a support
  page or docs URL.
- **Languages supported** — English only today (`extensions/viewer-3d/locales/`).

### 2.3 Test instructions for the reviewer

**Written out in full in `APP-REVIEW-NOTES.md`.** Sections 1–7 of that file are
the text to paste into the Partner Dashboard's testing-instructions field;
sections 8–13 are the reference for scopes, webhooks and data handling if a
reviewer asks. Six placeholders in it (`«FILL IN»` — demo store, staff login,
sample `.glb` URL, screencast, support email, and the review-window billing
note) must be filled before submitting.

Reviewers install on a fresh dev store and follow these literally. Anything they
have to guess is a rejection. What has to be covered:

1. A test store, or "install on any development store".
2. That a `.glb` or `.gltf` file is needed, **with a link to one they can
   download** — do not assume they have a 3D model to hand.
3. The exact path: install → **Get started** → upload the model → assign it to a
   product → **Add block** → open the product on the storefront.
4. That the metafield definition (`custom.model_3d`, type File, storefront read
   access ON) is created for them by the app's Setup step, and where to see it.
5. Which plan to test on, and that Free is enough to see the whole feature set.

---

## 3. Verify before submitting

Run each of these on a fresh dev store against the **production** deploy, not a
dev tunnel.

**Install and OAuth**
- [ ] Install from the Partner install link — no error screen, lands in the app.
- [ ] Reload the embedded app; it does not re-prompt for OAuth.
- [ ] Uninstall, then reinstall. Previously uploaded models are still listed.

**Core flow**
- [ ] Upload a `.glb`, assign it to a product, add the block, view the product
      page on the storefront. Model renders and can be rotated and zoomed.
- [ ] Open the same page on a phone. The AR button appears and launches Quick
      Look on iOS / Scene Viewer on Android.
- [ ] A product with no model assigned renders the page with no viewer, no error,
      and no JavaScript in the console.

**Billing**
- [ ] Subscribe to Starter. The approval screen shows **$8.88/month**, not a test
      charge, and the trial length matches the listing.
- [ ] After approving, the app reflects the new plan and the raised limits.
- [ ] Cancel. The app drops back to Free limits.
- [ ] Hit a plan limit on Free and confirm the upgrade prompt is clear about
      what is capped.

**Performance** — Shopify holds a listed app to reducing a storefront's
Lighthouse performance score by no more than 10 points.
- [ ] Lighthouse (mobile) on a product page **without** the block.
- [ ] Lighthouse (mobile) on the same product page **with** the block and a
      model assigned.
- [ ] Difference ≤ 10 points. Confirm in the network panel that
      `view3d.pkgd.min.js` is **not** requested until the viewer scrolls into
      view — if it loads on page load, the lazy-loading in
      `extensions/viewer-3d/assets/viewer-3d.js` is not taking effect.

**Compliance and errors**
- [ ] All three compliance webhooks return 200; a bad HMAC returns 401.
- [ ] The app's public root URL (no `?shop=`) shows the real landing page, not a
      placeholder.
- [ ] No console errors on any admin page.
- [ ] Session expiry: leave the app open for a while, then act. It re-authorises
      instead of showing a raw error.

---

## 4. Already handled in code

| Requirement | Where |
| --- | --- |
| `customers/data_request`, `customers/redact`, `shop/redact` webhooks | `app/routes/webhooks.compliance.tsx`, declared via `compliance_topics` in `shopify.app.toml` |
| HMAC verification, 401 on failure | `authenticate.webhook` (library) |
| Shop data erased on `shop/redact` | `webhooks.compliance.tsx` — Session, Model3D, Charge, AppUser, WebhookCall |
| GraphQL Admin API only, no REST | `app/lib/theme-blocks.server.ts` (`theme.files` / `themeFilesUpsert`), `app/lib/billing.server.ts` (`currentAppInstallation.activeSubscriptions`), `app/lib/swipeone.server.ts` (`shop` query) |
| Real (non-test) charges | `BILLING_TEST_MODE` in `app/lib/app-config.ts`, used in `app/routes/app.pricing.tsx` |
| Billing return URL uses the real app handle | `adminAppUrl` in `app/lib/app-config.ts` |
| Session-token auth, App Bridge from Shopify's CDN | `AppProvider embedded` in `app/routes/app.tsx` |
| Theme app extension, no ScriptTag API | `extensions/viewer-3d/` |
| Vendor bundle deferred until a viewer is near the viewport | `ensureVendor` in `extensions/viewer-3d/assets/viewer-3d.js`; URLs passed via `data-vendor-js` from both blocks |
| Real public landing page at the app root | `app/routes/_index/route.tsx` |
| Privacy policy naming every sub-processor | `PRIVACY.md` |
| Minimum necessary scopes, each justified | `README.md` → OAuth scopes |
