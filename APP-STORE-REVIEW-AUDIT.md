# App Store submission audit — Easy 3D Viewer

A pass/fail review of the whole app against Shopify's App Store requirements,
done against the code on **3 September 2026** and against the **live production
deploy** at `https://3d-viewer-app.bplugins.com`.

Every finding names the file and line. Nothing in this file changes code — it is
the work list.

Companion files: `SUBMISSION-CHECKLIST.md` (the non-code submission work),
`APP-REVIEW-NOTES.md` (what the reviewer is handed), `PRIVACY.md`.

**Verified by running:** `npm run typecheck` (clean), and `curl -D-` against the
production host for the header findings in §2.

---

## Scoreboard

| # | Area | Verdict |
| --- | --- | --- |
| 1 | Embedded app / App Bridge | ✅ Pass |
| 2 | HTTP security headers (live deploy) | 🔴 **Fail** — §2 |
| 3 | Polaris compliance | 🟠 Risk — §7 |
| 4 | OAuth and authentication | ✅ Pass |
| 5 | Billing implementation | ✅ Pass (one env check outstanding — §3) |
| 6 | Multi-tenant data isolation | 🔴 **Fail** — §1 |
| 7 | App block / theme extension — function | 🟠 Risk — §9, §10 |
| 8 | App block / theme extension — performance | ✅ Pass |
| 9 | Privacy policy and support URLs | ✅ Pass (live, verified) |
| 10 | Privacy — third-party analytics in the admin | 🟠 Risk — §6 |
| 11 | Webhooks — mandatory + response time | 🟠 Risk — §4, §5 |
| 12 | Accessibility — admin | ✅ Pass |
| 13 | Accessibility — storefront viewer | 🟠 Risk — §8 |
| 14 | Secrets / repo hygiene | ✅ Pass |
| 15 | GraphQL-only Admin API | ✅ Pass |

**Two blockers, seven risks.** Both blockers are one-file fixes.

---

# Blockers — fix before submitting

## §1 🔴 Cross-tenant delete (IDOR)

**`app/routes/app.models._index.tsx:165`**

```ts
if (intent === "delete") {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing model id" };
  await prisma.model3D.delete({ where: { id } });   // ← no shop scope
```

Any authenticated merchant can delete **another shop's** library model by
posting its id to their own `/app/models`. The row is addressed by primary key
with no `shop` predicate, so the session's shop is never consulted.

The ids are not a secret. A `Model3D.id` is published in three places by design:
the shareable `/viewer/<id>` URL, the iframe embed snippet, and the **Model ID**
field a merchant pastes into a page block. Anyone who has seen a shared viewer
link holds a working delete token for that model.

Both sibling code paths get this right, which is what makes it a slip rather
than a design choice:

- `app/routes/app.models._index.tsx:176` — `bulk_delete` uses
  `deleteMany({ where: { shop, id: { in: ids } } })`.
- `app/routes/app.models.$id.tsx:110` — guards with
  `findFirst({ where: { id, shop } })` and returns early when it misses.

### Fix

```ts
if (intent === "delete") {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing model id" };
  const { count } = await prisma.model3D.deleteMany({ where: { id, shop } });
  if (count === 0) return { ok: false, error: "Model not found" };
  await syncModelLibrary(admin, shop);
  return { ok: true, message: "Model deleted from library" };
}
```

`deleteMany` rather than `delete` because Prisma's `delete` only accepts a
unique selector — a compound `{ id, shop }` is not one on this model — and
because it reports a count instead of throwing on a miss.

**Then grep for the pattern rather than fixing the one line:** every
`prisma.<model>.{delete,update,findUnique}({ where: { id } })` reached from a
route action needs the shop in the predicate or a guard above it. The audited
set today is clean apart from this line.

---

## §2 🔴 The live deploy weakens framing protection and re-adds `X-Frame-Options`

Measured on production, not inferred:

```console
$ curl -sS -o /dev/null -D - https://3d-viewer-app.bplugins.com/
HTTP/2 200
server: nginx
x-frame-options: SAMEORIGIN
x-content-type-options: nosniff
x-xss-protection: 1; mode=block
x-permitted-cross-domain-policies: master-only
content-security-policy: frame-ancestors https://admin.shopify.com https://*.myshopify.com *
```

None of those five headers comes from this app. They are a security-headers
block on the nginx vhost, and two of them are wrong here.

**a. `frame-ancestors … *` — any site on the internet may frame the embedded
admin app.** The trailing bare `*` makes the rest of the list decorative. An
embedded app is supposed to be frameable only by `admin.shopify.com` and the
shop's own domain, which is exactly what `addDocumentResponseHeaders` emits per
request (`app/entry.server.tsx:17`). nginx's blanket header overrides that
intent on every response, so the app ships with clickjacking protection
switched off for merchant admin pages.

**b. `X-Frame-Options: SAMEORIGIN` is back.** It is present on 2xx responses
(nginx `add_header` without `always` applies to 2xx/3xx). It is currently
harmless *only* because nginx also sends a `frame-ancestors` CSP on every
response, and browsers ignore XFO whenever a CSP carries `frame-ancestors`. So
the app works today by accident: the mistake in (a) is masking the mistake in
(b). Narrow the CSP without removing XFO and the embedded app stops loading
inside the admin.

This repo already documents this exact trap twice — `DEPLOY-VPS.md:394`
("`X-Frame-Options` from nginx blocks the embedded frame") and the header comment
in `app/lib/framed-redirect.server.ts:1-30`, which exists because a redirect hop
without a CSP was refused by the admin. The code was hardened; the server was
not.

### Fix — on the host, not in the repo

1. Find it: `grep -rn "X-Frame-Options\|Content-Security-Policy" /etc/nginx/`
2. Remove **both** directives from this vhost (and from any `include`d
   security-headers snippet it pulls in). `proxy_hide_header` does not help —
   these are added by nginx itself, not passed through from the app.
3. Leave `X-Content-Type-Options` and the other two; they are harmless.
4. Reload nginx and verify:

```console
$ curl -sS -o /dev/null -D - "https://3d-viewer-app.bplugins.com/?shop=example.myshopify.com" \
  | grep -i "frame"
content-security-policy: frame-ancestors https://example.myshopify.com https://admin.shopify.com;
```

One CSP, no `*`, no `X-Frame-Options`. The app owns this header; nginx must not
have an opinion about it.

---

# Risks a reviewer is likely to raise

## §3 🟠 Confirm `SHOPIFY_BILLING_TEST` is unset in production

`app/lib/app-config.ts:33` makes test charges opt-in via env var, which is the
right default and cannot be got wrong from the code side. But it can only be
confirmed on the host:

```console
$ env | grep SHOPIFY_BILLING_TEST   # must print nothing
```

A test charge means every merchant gets paid plans free, and reviewers check for
it. Already listed in `SUBMISSION-CHECKLIST.md:65`; repeated here because it is
the single most expensive item on either list.

## §4 🟠 Webhook handlers make un-timed external calls before responding

Shopify expects a webhook response within **5 seconds** and marks endpoints that
miss it; sustained failures get subscriptions removed.

| File | What runs before the response |
| --- | --- |
| `app/routes/webhooks.app.subscriptions_update.tsx:21-29` | `fetchShopInfo` (a Shopify GraphQL round trip) **then** `notifySwipeone` (a third-party HTTP POST), both awaited, before any of the billing DB writes |
| `app/routes/webhooks.app.uninstalled.tsx:12-20` | `notifySwipeone` awaited **before** `session.deleteMany` |

And the outbound call has no deadline at all —
`app/lib/swipeone.server.ts:81-88`:

```ts
await fetch(SWIPEONE_URL, { method: "POST", headers: {…}, body: … });
```

No `signal`. Node's fetch has no default timeout, so a CRM endpoint that accepts
the connection and stalls holds the webhook open until the platform gives up. In
the uninstall handler that also means the session rows survive an uninstall.

### Fix

```ts
// app/lib/swipeone.server.ts
await fetch(SWIPEONE_URL, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(2000),
});
```

Then reorder both handlers so the durable work happens first and the CRM notify
is the last thing before `return`:

```ts
// webhooks.app.uninstalled.tsx
if (session) await db.session.deleteMany({ where: { shop } });
void notifySwipeone({ … }).catch((err) =>
  console.error("[uninstalled] swipeone notify failed:", err),
);
return new Response();
```

`void` rather than `await`: nothing downstream needs the result, and the CRM
must not be able to delay an acknowledgement Shopify is timing.

## §5 🟠 `afterAuth` blocks the install on the same two calls

`app/shopify.server.ts:77-92` awaits `fetchShopInfo` then `notifySwipeone` inside
the OAuth `afterAuth` hook. The `try/catch` handles failure but not slowness, and
this sits on the first-install redirect path — the one moment a reviewer is
watching. A stalled CRM endpoint reads as a hung install.

Same fix: the `AbortSignal.timeout` above covers it, plus don't await —

```ts
afterAuth: async ({ session }) => {
  const { shop, accessToken } = session ?? {};
  if (!shop || !accessToken) return;
  void (async () => {
    try {
      const shopInfo = await fetchShopInfo(shop, accessToken);
      await notifySwipeone({ type: "app.installed", shop, userId: session.id, installId: shopInfo?.id, shopInfo: shopInfo ?? undefined });
    } catch (err) {
      console.error("[afterAuth] swipeone notify failed:", err);
    }
  })();
},
```

## §6 🟠 Microsoft Clarity session replay runs inside the embedded admin

`app/components/Analytics.tsx` and `app/lib/analytics.server.ts:21-22` load
GA4 **and Microsoft Clarity** on every `/app/*` page, on by default, with the
project IDs hardcoded. `app/routes/app.tsx:29` then passes the shop domain to
`AnalyticsIdentify`, which calls `clarity("identify", shop)`
(`Analytics.tsx:177`).

Clarity records the DOM of the pages it runs on. On these pages that includes
product titles and thumbnails, the shop name, the store owner's name and contact
email (the support form prefills both from
`app/routes/api.support.tsx:38-66`), the plan and price, and the model library —
all tied to a named store.

This is disclosed properly: `PRIVACY.md:86-92` describes both trackers and
`PRIVACY.md:188-189` names Google and Microsoft as sub-processors with what each
receives. That is more than most apps do, and it is why this is a risk and not a
blocker.

What a reviewer can still object to:

- There is **no consent step and no opt-out inside the app**, while
  `PRIVACY.md:149` lists consent as a lawful basis "where required for
  non-essential analytics cookies". The app does not offer the merchant a way to
  give or withhold it.
- GA's cookies are deliberately set third-party inside the admin iframe
  (`cookie_flags: 'SameSite=None;Secure'`, `Analytics.tsx:66,124`).
- Session replay of merchant admin sessions is a recognised sensitivity, and the
  listing's data-collection answers must match what these tags actually collect.

### Recommendation

Cheapest safe posture for submission — keep GA page views, and either

- set `CLARITY_PROJECT_ID=off` on the production host for the review window
  (`analytics.server.ts:105-107` already supports the keyword), or
- keep Clarity but turn on content masking (`clarity("set", "mask", …)` /
  project-level "Mask all text"), so replays carry layout without merchant data,

and add a one-line opt-out in the app — a switch on Setup writing to `AppUser`
that makes `getAnalyticsConfig()` return nulls for that shop. Then re-check the
listing's privacy answers against whichever you pick.

## §7 🟠 Tailwind's preflight is loaded into two Polaris admin pages

`app/routes/app.products.$id.tsx:33,50` and `app/routes/app.models.$id.tsx:27,44`
both do:

```ts
import appStylesUrl from "~/app.css?url";
export const links: LinksFunction = () => [{ rel: "stylesheet", href: appStylesUrl }];
```

`app/app.css:1` is `@import "tailwindcss"`, which includes **preflight** —
Tailwind's global element reset. So the two busiest admin pages ship a global
reset into a Polaris page.

`app/root.tsx:17-22` says in its own comment that `app.css` was pulled off the
global links precisely "to keep Tailwind's preflight away from the Polaris
components every other admin page is built from". These two routes put it back,
because they need the viewer's styles for the live preview.

Built for Shopify holds an app to using Polaris and App Bridge consistently, and
a reset that reaches Polaris host elements is how "the app looks subtly unlike
the admin" starts.

### Fix — import Tailwind without preflight

```css
/* app/app.css */
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
/* …the rest of the file unchanged… */
```

That keeps the theme tokens and the utilities the viewer markup uses and drops
the element reset. The alternative, if the preview genuinely needs preflight, is
to split the viewer's styling into its own `viewer.css` and let only
`/viewer/:id` — a standalone page with no Polaris on it — import the full
Tailwind build.

## §8 🟠 The storefront viewer has no accessible name

`extensions/viewer-3d/blocks/product_viewer.liquid:92` and
`page_viewer.liquid:207`:

```liquid
<canvas class="view3d-canvas"></canvas>
```

No `role`, no `aria-label`, no fallback content, and the wrapping
`[data-view3d]` element (`product_viewer.liquid:75-91`) carries none either. A
screen reader reaches the main content of the block and has nothing to announce
— WCAG 1.1.1. The control-bar buttons are done properly by comparison
(`viewer-3d.js:897`, `:978`, `:1180-1204` set `aria-label`, `aria-haspopup`,
`aria-expanded`, `aria-selected`, and Escape returns focus).

There is also no keyboard path to rotate the model. Zoom, reset and fullscreen
are real buttons, so this is partial rather than total, but drag-to-rotate is
pointer-only.

### Fix

```liquid
<div
  id="viewer-3d-{{ block.id }}"
  class="viewer-3d"
  role="img"
  aria-label="{{ product.title | escape }} — interactive 3D model"
  …
>
  <canvas class="view3d-canvas">
    {{ product.title | escape }} shown as an interactive 3D model.
  </canvas>
</div>
```

For the page block, use the block's `caption` setting as the label, falling back
to the model name.

**Related, same file family —** `extensions/viewer-3d/assets/viewer-3d.css:909`
has a `prefers-reduced-motion` block, but auto-rotate is a WebGL animation
started in JS (`viewer-3d.js:1493`, `autoplay: cfg.autoRotate ? … : false`), and
CSS cannot stop it. Gate it:

```js
var reduceMotion = window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
autoplay: (cfg.autoRotate && !reduceMotion) ? { delay: 0, speed: 0.5 } : false
```

## §9 🟠 The viewer never re-initialises when a theme re-renders the section

`extensions/viewer-3d/assets/viewer-3d.js:1974-1979` initialises on
`DOMContentLoaded` and re-initialises only on `shopify:section:load`, which
Shopify fires in the theme editor and nowhere else. Any theme that swaps a
section in at runtime — Horizon, and anything using the Section Rendering API
for variant switching — leaves the block's markup in the DOM with the script
never running.

A reviewer on a modern theme who changes a variant sees the viewer disappear.
That reads as "the app doesn't work", which is a rejection rather than a bug
report. Dawn does full page loads, which is why this has never shown up in
testing.

Already logged as `NEXT-UPDATE.md:14` (§1.1) — promote it to pre-submission.

### Fix

A debounced `MutationObserver` on `document.body` that calls `initAll()` when a
`[data-view3d]` appears without `data-view3d-initialized`. It must not fight the
existing mount queue — debounce and let the queue own mounting.

## §10 🟠 "Add block for me" writes the merchant's live published theme

`app/lib/theme-blocks.server.ts:199-265` reads `templates/product.json` from the
**MAIN** (published) theme and writes it back with `themeFilesUpsert`.

The implementation is careful — it preserves Shopify's generated JSONC header
verbatim (`jsonBodyStart`, `:80-101`), checks both GraphQL error channels
(`:180-197`), and only ever appends a block. It is also explicitly consented: a
merchant clicks a button labelled "Add block for me"
(`app/routes/app.onboarding.tsx:411`). But it mutates a live theme with no
backup and no preview, and reviewers are sensitive to that.

### Recommendation

Prefer Shopify's own deep link, which puts the merchant in the theme editor with
the block already staged and requires them to press Save:

```
https://admin.shopify.com/store/<handle>/themes/<themeId>/editor
  ?template=product
  &addAppBlockId=<extension-uuid>/product_viewer
  &target=newAppsSection
```

The extension UUID is in `extensions/viewer-3d/shopify.extension.toml:6`. Keep
the file write as the fallback for themes where the deep link cannot work, and
say in the button's helper text that it edits the published theme.

**While in that file, two smaller things:**

- **`theme-blocks.server.ts:262`** returns
  `https://${shop}/admin/themes/<id>/editor` — the legacy shop-admin host. From
  inside the embedded app this should be the `admin.shopify.com/store/<handle>/…`
  form, which `app/lib/app-config.ts:41` and `app.onboarding.tsx:244` already
  build correctly.
- **`theme-blocks.server.ts:274-291`** — `countBlockOccurrences` walks
  `section.blocks` exactly one level deep. Themes on the theme-block architecture
  nest blocks inside group blocks, so a merchant who adds the viewer by hand
  inside a group is told by the checklist that they never added it, and step 3
  never completes. Recurse. (`NEXT-UPDATE.md:31`, §1.2.)

---

# Low / polish

| # | Finding | File |
| --- | --- | --- |
| L1 | Billing redirect uses `window.top.location = url`. Works, but App Bridge's `open(url, "_top")` is the sanctioned path and is not at the mercy of iframe sandbox flags. | `app/routes/app.pricing.tsx:408-417` |
| L2 | Tutorial video embeds `youtube.com`, not `youtube-nocookie.com`, so YouTube sets cookies for the merchant — at odds with `PRIVACY.md`'s "no advertising cookies" line. One-word fix. | `app/routes/app._index.tsx:662` |
| L3 | Three attributes in the product block are unescaped — `data-model-url`, `data-poster-url`, and `{{ viewer_bg_css }}` inside `style` — while `ios_src` and `data-config` in the same tag are escaped. `model_url` is merchant-entered. Add `\| escape` to all three for consistency. | `extensions/viewer-3d/blocks/product_viewer.liquid:79-81` |
| L4 | Two `console.log`s fire on every storefront viewer init. Reviewers do open the console; keep it silent. | `extensions/viewer-3d/assets/viewer-3d.js:1665,1683` |
| L5 | The Documentation page iframes `apps.bplugins.com/docs/3d-viewer/`. Verified live today and frameable (it sends no `X-Frame-Options` and no `frame-ancestors`) — but if that site ever gains a security-headers block like the one in §2, this page goes blank. The "Open in new tab" fallback at `:117`/`:187` is the right hedge; keep it visible. | `app/routes/app.documentation.tsx:152` |
| L6 | Storefront UI strings are hardcoded English in JS (`aria-label`s, `'None'`), and the block schema labels are literals rather than `t:` keys. Fine for an English-only listing; needed before any localisation. | `extensions/viewer-3d/assets/viewer-3d.js:1180,1337`; `blocks/*.liquid` schemas |
| L7 | The page block hardcodes the app origin as a fallback. Correct today and overridden by a shop metafield, but a domain change breaks already-published themes that fell back. | `extensions/viewer-3d/blocks/page_viewer.liquid:44` |
| L8 | `/viewer/:id` and `/api/model/:id` are unauthenticated by design (documented in `app/lib/model-resolve.server.ts:1-22`) with UUIDv4 ids, `noindex`, and a minimal payload — acceptable. There is no rate limiting; each hit is a DB read. Not a review issue, an abuse one. | `app/routes/viewer.$id.tsx`, `app/routes/api.model.$id.tsx` |

---

# What passes, and the evidence

Recorded so nobody re-audits it, and so a reviewer question can be answered with
a file path.

### Embedded app / App Bridge ✅
- `AppProvider embedded apiKey` wraps every admin route
  (`app/routes/app.tsx:89`). App Bridge and Polaris load from
  **Shopify's CDN** — `https://cdn.shopify.com/shopifycloud/app-bridge.js` and
  `/polaris.js`, confirmed inside the installed
  `@shopify/shopify-app-react-router` `AppProvider`. Nothing is bundled or
  self-hosted, and there is no hand-written script tag anywhere in `app/`.
- Navigation uses `s-app-nav` with `rel="home"` (`app.tsx:92-116`), and route
  transitions drive the admin's own indicator via `shopify.loading`
  (`app.tsx:70-78`) instead of painting a second bar inside the iframe.
- `boundary.error` / `boundary.headers` on the app shell (`app.tsx:118-124`) and
  on each top-level route.
- Toasts go through `shopify.toast` throughout.

### OAuth and authentication ✅
- Managed installation, `AppDistribution.AppStore`, token-exchange embedded auth
  (`app/shopify.server.ts:45-96`). Required env vars fail fast at boot with a
  named error rather than coercing to `""` (`shopify.server.ts:33-43`) — the
  failure that otherwise surfaces as a login form inside the admin.
- `future.expiringOfflineAccessTokens` with the `refreshToken` /
  `refreshTokenExpires` columns it needs (`prisma/schema.prisma`, Session).
- Bare `/auth?shop=…` forwards the shop to `/auth/login` instead of dropping it
  and rendering a domain form (`app/routes/auth.$.tsx:31-44`).
- Framed redirects carry a CSP so the admin will follow them
  (`app/lib/framed-redirect.server.ts`) — used by `_index`, `auth.$`,
  `app._index` and `app.models.$id`.
- Session storage on Prisma/MongoDB with a boot-retry budget sized for Atlas cold
  starts (`shopify.server.ts:50-70`).

### Billing ✅
- Real charges via `appSubscriptionCreate`; test mode is opt-in on an env var
  only and is never inferred from `NODE_ENV`
  (`app/lib/app-config.ts:18-33`, used at `app/routes/app.pricing.tsx:255`).
- Return URL is a proper admin deep link built from the app handle
  (`app-config.ts:41`), and `app.SuccessBilling.tsx` confirms the charge **live**
  before granting anything.
- Cross-shop charge confirmation is not possible: `fetchActiveSubscription` reads
  `currentAppInstallation.activeSubscriptions` through the shop's own admin
  client and matches the id against that list
  (`app/lib/billing.server.ts:265-300`) — a foreign `charge_id` simply doesn't
  match.
- Cancel calls `appSubscriptionCancel` and resets the shop to Free limits
  (`app.pricing.tsx:278-323`); `app_subscriptions/update` reconciles
  cancelled / expired / declined / frozen / active independently
  (`webhooks.app.subscriptions_update.tsx:44-83`).
- Coupons are resolved **server-side** from a code table — the browser can
  neither define nor inflate one (`app/lib/coupons.server.ts`).
- Plan limits are enforced in the actions that add, against live data rather than
  the cache (`app.models._index.tsx:196-201`, `app.products.$id.tsx`), and
  nothing is deleted on downgrade.
- Prices are derived with cent rounding, not float arithmetic
  (`billing-constants.ts:annualPrice`).

### Mandatory webhooks and privacy compliance ✅
- All three privacy topics declared with `compliance_topics` (not `topics`) in
  `shopify.app.toml:31-40` and handled in `app/routes/webhooks.compliance.tsx`;
  HMAC verification and the 401 on failure come from `authenticate.webhook`.
- `shop/redact` erases every table keyed by shop in one transaction — Session,
  Model3D, Charge, AppUser, WebhookCall (`webhooks.compliance.tsx:64-77`).
- Both customer topics answer 200 and log, because the app stores no shopper
  data at all — confirmed: no customer-keyed model in
  `prisma/schema.prisma`, and the storefront extension sets **no cookies and no
  `localStorage`** (grepped clean across `extensions/viewer-3d/assets/`).

### Theme extension performance ✅
- A theme app extension, no `ScriptTag` API anywhere.
- All assets are served from the extension via `asset_url` — nothing is pulled
  from a third-party CDN at runtime (`product_viewer.liquid:108-113`).
- The 725 KB vendor bundle is **not** requested until a viewer nears the
  viewport: it is handed over as a URL in `data-vendor-js` and fetched by
  `ensureVendor` behind an `IntersectionObserver`
  (`viewer-3d.js:189-193,412`). This is the single biggest Lighthouse lever and
  it is pulled the right way.
- The block renders nothing at all when a product has no model
  (`product_viewer.liquid:74` — `{%- if model_url != blank -%}`), so an
  unassigned product page loads no CSS, no JS and no markup.

### Privacy policy and support URLs ✅ (verified live)
| URL | Result |
| --- | --- |
| `https://3d-viewer-app.bplugins.com/` | 200, real landing page with copy, Support and Privacy links (`app/routes/_index/route.tsx`) — not the CLI placeholder |
| `https://bplugins.com/privacy-policy` | 301 → trailing slash → 200 |
| `https://bplugins.com/contact` | 301 → trailing slash → 200 |
| `https://apps.bplugins.com/docs/3d-viewer/` | 200, and frameable |

### Admin accessibility ✅
- Polaris's own `s-drop-zone` for uploads, chosen over a hand-rolled div
  precisely because it is keyboard-reachable and announced
  (`app.models._index.tsx:593-607`).
- Icon-only controls carry `accessibilityLabel` (`app._index.tsx:985`,
  `app.models._index.tsx:457,664,670,715,736`).
- The one hand-drawn chart is exposed as `role="img"` with a descriptive
  `aria-label`, and every bar takes `currentColor` so it stays correct in any
  admin theme (`app._index.tsx:545-555`).
- Decorative product thumbnails use `alt=""` next to the product title as
  adjacent text (`app.products._index.tsx:289-292`).
- `prefers-reduced-motion` respected in both admin stylesheets
  (`app/critical.css:121`, `app/app.css:326`) — see §8 for the WebGL gap.

### Polaris compliance ✅ (with §7 noted)
The admin is Polaris web components throughout — `ViewerSettings.tsx` is 100%
`s-*` with zero `className`. Raw markup survives in exactly three places, each
with no Polaris equivalent: the uploads chart, one grid toolbar
(`app.models._index.tsx:631`, class defined in `critical.css:271`), and the 3D
`<canvas>` itself.

### Security and repo hygiene ✅
- No secrets committed: `.env` is untracked and gitignored, and no tracked file
  contains `SHOPIFY_API_SECRET`.
- **GraphQL Admin API only** — no REST call anywhere. The one raw `fetch` goes to
  `/admin/api/2026-01/graphql.json` (`app/lib/swipeone.server.ts:114`) because
  its callers hold a session rather than an admin client.
- API version is consistent across all four places that state one:
  `shopify.app.toml:13` (`2026-01`), `shopify.server.ts:47`
  (`ApiVersion.January26`), `app-config.ts:55`, and
  `extensions/viewer-3d/shopify.extension.toml:1`.
- Server-side file validation is present, not just client-side —
  `validateModelFile` runs in every upload action
  (`app.models._index.tsx:229,383`; `app.products.$id.tsx:369,503`), and
  `api.files.tsx:83` filters what the picker will even offer.
- Tenant scoping is correct everywhere except §1.
- `/viewer/:id` sends `robots: noindex` (`viewer.$id.tsx:74`) and selects only
  the fields it renders — the owning shop is never exposed
  (`viewer.$id.tsx:47-55`).
- Scopes are minimal and each is justified: `write_products`, `write_files`,
  `write_themes` (`shopify.app.toml:55`, rationale in `README.md:44-60`).
- `npm run typecheck` is clean.

---

## Suggested order of work

1. **§1** — the delete scope. One line, ten minutes.
2. **§2** — nginx headers. On the host; verify with the curl in that section.
3. **§3** — confirm the billing env var on the host.
4. **§4 / §5** — the fetch timeout and the two handler reorderings. One shared fix.
5. **§6** — decide the Clarity posture before the listing's privacy answers are
   filled in, since they have to agree.
6. **§9** — the `MutationObserver`. This is the one remaining item that can make
   the app look broken to a reviewer on a modern theme.
7. **§7, §8, §10** — before a Built for Shopify assessment; none blocks a
   standard submission.
8. Low items as convenient. L2 and L4 are one-liners.
