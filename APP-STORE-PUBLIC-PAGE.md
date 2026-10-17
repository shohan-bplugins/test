# App Store public page — Easy 3D Viewer

Everything that appears on the app's public App Store page, field by field, in
the order the Partner Dashboard asks for it. Paste from here; don't rewrite.

Verified against the code on 31 August 2026. Character counts are exact.
**Check every limit in the Partner Dashboard before pasting** — Shopify revises
them, and a field that silently truncates is worse than one you shortened
yourself.

Companion files: `FEATURES.md` (the full feature list, for ad copy and
comparison tables), `SUBMISSION-CHECKLIST.md` (everything that is not listing
copy), `PRIVACY.md` (the privacy-policy content).

---

## 1. App name

```
Easy 3D Viewer
```

*14 characters.* Matches `name` in `shopify.app.toml`. Contains no "Shopify" —
not permitted in this field.

---

## 2. Tagline

```
Interactive 3D product models with augmented reality
```

*52 characters.* Names both halves of the product, 3D *and* AR, which is what
merchants search for. No "Shopify" — not permitted here either.

Alternates, if the tagline needs to change without a rewrite:

| Tagline | Chars |
|---|---|
| Let shoppers spin, zoom and view products in their room | 55 |
| Show products in 3D and AR on any page | 38 |

---

## 3. App introduction

The short line directly under the app name.

```
Show products in interactive 3D on any page, and let shoppers view them in their own room with AR.
```

*98 characters.*

---

## 4. App details

The long description. **No pricing and no competitor comparisons** — pricing
belongs in §6 and must match the app exactly.

*1,720 characters as written below.*

```
Turn your product photos into something shoppers can pick up.

Photos show a product from a handful of fixed angles. Shoppers who cannot see the back, the underside or the true proportions hesitate, ask questions, or buy and send it back.

Easy 3D Viewer puts your product on the page in interactive 3D. Shoppers drag to turn it over, scroll to zoom in on the finish, and — on both iPhone and Android — place it in their own room to check the size before they buy. There is nothing for them to install.

Upload a model, place it, done.

Upload a .glb or .gltf file, assign it to a product, and add the viewer block to your theme. A guided checklist walks through each step, and the app can add the block to your product template for you. No code, no theme editing.

Control exactly how it looks.

Set the angle your product first appears at, its zoom, and how it is lit. Choose a background colour, add studio lighting or your own environment image, and drop a soft shadow beneath it. If your model has built-in animations, play them, loop them, or let shoppers switch between them. Every change renders instantly in a live preview showing exactly what your customers will see — nothing goes live until you save it.

Not only product pages.

Place a viewer on a landing page, your homepage or a blog post using a Model ID. For anywhere a theme block cannot reach, copy a ready-made embed. Every model also gets a shareable link you can send in an email or a message.

Built for your store, not bolted on.

Your files are stored in your own Shopify Files and served from Shopify's network, so your storefront stays fast. The viewer loads only on pages where you have placed a model, and only once a shopper scrolls to it.
```

The five short lines are section leads. If the Dashboard offers bold or heading
formatting, set them as headings; if it is plain text only, leave them as their
own paragraphs — they read correctly either way.

**If the field caps below ~1,200 characters**, cut "Not only product pages" and
"Built for your store, not bolted on." in that order. Never cut the opening two
paragraphs or "Upload a model, place it, done." — the first sells the problem,
the second answers "how much work is this".

---

## 5. Key features

Five bullets, each under the 80-character guidance.

```
Spin, zoom and inspect products in 3D on desktop and mobile
View in your room with AR — nothing for shoppers to install
Place a viewer on product pages, any other page, or embed anywhere
Tune camera, lighting and animation with a live preview beside you
Set up without code — guided checklist and one-click theme block
```

| # | Chars |
|---|---|
| 1 | 59 |
| 2 | 59 |
| 3 | 66 |
| 4 | 66 |
| 5 | 64 |

---

## 6. Pricing

Must match `SEED_PLANS` in `app/lib/billing.server.ts` exactly, or the
submission is rejected. A yearly subscription is charged ten months, so the
annual price is the monthly one × 10 (`ANNUAL_MONTHS_CHARGED`).

| Plan | Monthly | Yearly | Trial | Products with a model | Models in library |
|---|---|---|---|---|---|
| Free | $0 | — | — | 3 | 3 |
| Starter | $8.88 | $88.80 | 7 days | 15 | 15 |
| Growth | $18.88 | $188.80 | 7 days | 100 | 100 |
| Advance | $35.88 | $358.80 | 7 days | Unlimited | Unlimited |

### Plan cards — one-line description and bullets

Paste these verbatim; they are the strings the app itself shows on its pricing
page.

**Free** — Get started with interactive 3D models on your store.

```
3 products with a 3D model
3 models in your library
1 model per product
Every viewer feature included
Standard email support
```

**Starter** — For small catalogs ready to show more products in 3D.

```
15 products with a 3D model
15 models in your library
1 model per product
Every viewer feature included
Priority email support
```

**Growth** — For growing stores rolling 3D out across the catalog.

```
100 products with a 3D model
100 models in your library
1 model per product
Every viewer feature included
Priority email support
```

**Advance** — For high-volume catalogs with no caps.

```
Unlimited products with a 3D model
Unlimited models in your library
1 model per product
Every viewer feature included
Premium priority support
```

Every viewer feature is on every plan, Free included. Plans differ only in how
many products and models you can publish — say so on the pricing section if
there is room for a line of context.

---

## 7. Categories and search terms

**Primary category:** Store design → Product display

**Search terms:**

```
3d model
3d viewer
augmented reality
ar product viewer
product 3d
```

---

## 8. Media

### App icon

1200×1200. No text, no UI screenshots, no drop shadow. Source files are in
`app-store-icon/`.

### Screenshots

At least three, 1600×900. Shopify requires the embedded admin *and* a storefront
page to both appear in the set. Shot list, in the order they should be ordered on
the listing:

| # | Shot | Why it earns the slot |
|---|---|---|
| 1 | A storefront product page with the viewer live on a recognisable product | The hero. This is the image a merchant judges the app on. |
| 2 | AR on a phone — the product placed in a real room | The single most persuasive image in the set. |
| 3 | The editor — settings on one side, live 3D preview on the other | Shows there is no guesswork in setup. |
| 4 | The model library, stocked | Shows this scales past one product. |
| 5 | The setup checklist | Substantiates the "no code" claim. |

Working files are in `app-store-screenshots/`.

### Demo video

Optional, strongly recommended for a visual app. 30–60 seconds: upload a model,
place the block, spin it on the storefront, open AR on a phone.

---

## 9. Support and legal

| Field | Value |
|---|---|
| Support email | A monitored inbox — must be answered by a human |
| Support / docs page | Public URL; the in-app documentation is at `/app/documentation` |
| Privacy policy URL | Live, stable URL serving the content of `PRIVACY.md` |
| Languages | English |

---

## 10. Reviewer test instructions

Not public, but submitted alongside the listing. The reviewer will not have a 3D
model to hand, so the download link is not optional.

```
1. Install the app on a development store with a modern theme (Online Store 2.0).
2. The app opens on a three-step checklist.
   Step 1 — click "Create definitions" to add the two metafield definitions the
   viewer reads. No manual setup in Settings is needed.
3. Download this sample model: <PUBLIC .GLB DOWNLOAD LINK>
   Step 2 — go to 3D Models → Upload model, and choose that file.
4. Open the model, adjust any setting, and watch the preview beside it update.
   Click Save.
5. Step 3 — click "Add block for me". The app inserts the viewer block into the
   published theme's product template.
6. Assign the model: Products → pick any product → assign the uploaded model.
7. Open that product on the storefront. Drag to rotate, scroll to zoom.
   On an Android phone, tap the AR button to place it in the room.

Notes for the reviewer:
- One 3D model per product, and one product per model — assigning a model that
  is already on another product is refused, with the conflicting product named.
  Upload a second copy of the file to use it twice.
- iPhone AR (Apple Quick Look) needs a separate .usdz file the merchant
  supplies, set per model under AR settings. Without it, iPhone shoppers still
  get the interactive 3D viewer.
- Only .glb and .gltf files are accepted, up to 20 MB.
```

---

## Claims not to make

Each is wrong about the app as built. Two are review rejections; the rest become
support tickets.

| Don't write | What is actually true |
|---|---|
| "Shopify" in the app name or tagline | Not permitted in either field. Fine inside the description. |
| Any conversion-rate or return-rate figure | The app has no data of its own, and Shopify asks for substantiation. |
| "Works with any theme" | The drag-and-drop blocks need a modern theme (Online Store 2.0). Older themes use the copy-paste embed. |
| "Upload any 3D file" | .glb and .gltf only, up to 20 MB. The app displays models; it does not create or convert them. |
| "Multiple models per product" | One model per product, by design — and a model already assigned to one product cannot be assigned to a second. |
| "AR works automatically everywhere" | iPhone AR needs a .usdz file the merchant supplies. |
| "40+ viewer settings" | 36 controls. Counted from `app/components/ViewerSettings.tsx`. |

---

*If anything here disagrees with what the app does, the app is right — fix this
file, not the app's copy.*
