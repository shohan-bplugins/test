# 3D Viewer — tutorial videos

Eleven narrated tutorial videos, one per feature area of the app. 1920×1080,
H.264 + AAC, ready to upload to YouTube or drop into the app's Help & resources
card (`app/routes/app._index.tsx` already renders a `VideoEmbed` there).

**Total runtime: 33:06 across 11 videos.**

| # | Video | Length | Scenes | Text |
|---|-------|--------|--------|------|
| 01 | [Overview & Dashboard](videos/01-overview.mp4) | 2:27 | 13 | [script](scripts/01-overview.md) · [srt](subtitles/01-overview.srt) |
| 02 | [Setup — metafield definitions & the model library](videos/02-setup.mp4) | 2:52 | 14 | [script](scripts/02-setup.md) · [srt](subtitles/02-setup.srt) |
| 03 | [Adding the theme blocks](videos/03-theme-blocks.mp4) | 2:44 | 17 | [script](scripts/03-theme-blocks.md) · [srt](subtitles/03-theme-blocks.srt) |
| 04 | [Assigning a 3D model to a product](videos/04-product-models.mp4) | 2:51 | 17 | [script](scripts/04-product-models.md) · [srt](subtitles/04-product-models.srt) |
| 05 | [Viewer settings — all eight sections](videos/05-viewer-settings.mp4) | 5:04 | 23 | [script](scripts/05-viewer-settings.md) · [srt](subtitles/05-viewer-settings.srt) |
| 06 | [Preview vs Save And View — checking your work](videos/06-preview-publish.mp4) | 2:22 | 13 | [script](scripts/06-preview-publish.md) · [srt](subtitles/06-preview-publish.srt) |
| 07 | [The 3D Model Library](videos/07-model-library.mp4) | 2:59 | 17 | [script](scripts/07-model-library.md) · [srt](subtitles/07-model-library.srt) |
| 08 | [Share & embed a model anywhere](videos/08-share-embed.mp4) | 2:47 | 15 | [script](scripts/08-share-embed.md) · [srt](subtitles/08-share-embed.srt) |
| 09 | [The storefront viewer — what shoppers can do](videos/09-storefront-viewer.mp4) | 3:11 | 16 | [script](scripts/09-storefront-viewer.md) · [srt](subtitles/09-storefront-viewer.srt) |
| 10 | [Plans, limits & billing](videos/10-plans-billing.mp4) | 2:56 | 16 | [script](scripts/10-plans-billing.md) · [srt](subtitles/10-plans-billing.srt) |
| 11 | [Documentation, troubleshooting & support](videos/11-docs-support.mp4) | 2:52 | 14 | [script](scripts/11-docs-support.md) · [srt](subtitles/11-docs-support.srt) |

## What's in each one

### 01 — Overview & Dashboard

`videos/01-overview.mp4` · 2:27

What the 3D Viewer app does, the three-step path to a live 3D product, and how to read every panel on the dashboard.

### 02 — Setup — metafield definitions & the model library

`videos/02-setup.mp4` · 2:52

The one page you must visit before anything reaches the storefront: what the three metafield definitions are for, what 'storefront read access' means, and how to read the library diagnostics when a Model ID says 'not found'.

### 03 — Adding the theme blocks

`videos/03-theme-blocks.mp4` · 2:44

How to place the two app blocks — '3D Viewer — Product' on product pages and '3D Viewer — Any Model' anywhere else — plus what each block setting does and why a Model ID beats a raw URL.

### 04 — Assigning a 3D model to a product

`videos/04-product-models.mp4` · 2:51

Uploading a .glb to a product, reusing a file already in Shopify Files, replacing and removing models, and the file rules the app enforces.

### 05 — Viewer settings — all eight sections

`videos/05-viewer-settings.mp4` · 5:04

Every per-product viewer option: Display, Environment, Camera, Controls, Control bar, Animation, AR and Advanced — and what each one does to the model your customer sees.

### 06 — Preview vs Save And View — checking your work

`videos/06-preview-publish.mp4` · 2:22

The three ways to see your changes: the instant live preview, Preview (unsaved changes on the real storefront), and Save And View (save, wait for Shopify, then open).

### 07 — The 3D Model Library

`videos/07-model-library.mp4` · 2:59

Standalone models that aren't tied to a product: drag-and-drop upload, search and sort, list and grid views, bulk delete, and the three things every row can copy.

### 08 — Share & embed a model anywhere

`videos/08-share-embed.mp4` · 2:47

The public /viewer/<id> page, the responsive and fixed iframe snippets, where they can be pasted, and the ?bg and ?autorotate URL overrides.

### 09 — The storefront viewer — what shoppers can do

`videos/09-storefront-viewer.mp4` · 3:11

The customer's side: drag to rotate, wheel or buttons to zoom, reset view, snapshot, the animation clip switcher, fullscreen, and AR on Android and iOS.

### 10 — Plans, limits & billing

`videos/10-plans-billing.mp4` · 2:56

What each plan includes, exactly how models are counted against your limit, upgrading through Shopify's approval flow, and what happens when you cancel.

### 11 — Documentation, troubleshooting & support

`videos/11-docs-support.mp4` · 2:52

The built-in documentation, the four problems that account for most support tickets and how to fix each, and where to reach a human.


## Re-recording the voiceover

The narration is macOS `say` (Samantha). It is clear but unmistakably
synthetic, so every video ships with the material you need to replace it:

- `scripts/<id>.md` — the narration, split by scene, with the timecode each
  line starts at.
- `subtitles/<id>.srt` — burn-in-free subtitles with real timings. Upload
  alongside the MP4 so viewers get captions they can turn off (the on-screen
  captions in the video itself are baked in).

To swap in a human or AI-recorded track, record against the script, then remux:

```bash
ffmpeg -i videos/01-overview.mp4 -i my-voiceover.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 160k -shortest \
  videos/01-overview-revoiced.mp4
```

If your recording changes the pacing, edit the narration in
`build/videos/<id>.mjs` and re-render instead — scene lengths are derived from
the spoken length of each line, so the visuals re-time themselves.

## Rebuilding

```bash
node build/render.mjs                 # all eleven
node build/render.mjs 05 07           # just those two
node build/index.mjs                  # regenerate this README
```

Requirements: macOS (for `say`), Google Chrome, and `ffmpeg`/`ffprobe` on
`PATH`. Nothing is installed and nothing talks to Shopify.

## How the videos are made

The app is an embedded Shopify app — it needs store auth and a tunnel to run, so
these are not screen recordings. Each frame is a faithful recreation of the real
screen, rebuilt in HTML from the app's own source: the same nav, the same copy,
the same design tokens as `app/app.css` (`#5449e4 → #3277f4` gradient, square
corners). The 3D model is a stand-in — a lit cube — rather than a real `.glb`.

Pipeline per scene:

1. `build/ui.mjs` renders the screen markup → Chrome headless at 1440×810 with
   a 2× device scale → a 2880×1620 PNG, downscaled to 1080p (that's what keeps
   small UI text legible).
2. The caption is a second, transparent PNG — this `ffmpeg` build has no
   libass or freetype, so all text is drawn by Chrome.
3. `say` speaks the narration; its measured duration becomes the scene length.
4. `ffmpeg` composites: optional Ken Burns, caption, an eased cursor overlay,
   and a click ring, into one segment. Segments are concatenated, the narration
   is laid underneath, and the ends are faded.

`build/` is the generator and is not needed to watch or ship the videos — delete
or `.gitignore` it if you only want the MP4s. `.work/` is scratch and is safe to
remove at any time.

## Accuracy notes

Every claim in the narration was taken from the source, including the
non-obvious ones worth double-checking if the code changes:

- The plan limit counts **distinct model files** — a file used by both a product
  and the library takes one slot (`countDistinctModels` in
  `app/lib/billing.server.ts`).
- Limit checks are skipped when a product **already** has a model, so replacing
  is always allowed (`checkLimitOrError` in `app/routes/app.products.$id.tsx`).
- A Model ID carries the model's saved config; a raw URL does not
  (`extensions/viewer-3d/blocks/page_viewer.liquid`).
- Turning the animation clip switcher off means the model does not animate at
  all (`showAnimationSelector`).
- iOS AR (Quick Look) needs a separate `.usdz`; Android works from the `.glb`.
- `?bg=` takes hex **without** the `#`, and `?autorotate=0` stops rotation
  (`app/lib/viewer-overrides.ts`).
- Deleting a library entry leaves the file in Shopify Files
  (`app/routes/app.models._index.tsx`).
- Plan data in video 10 is copied verbatim from `SEED_PLANS` in
  `app/lib/billing.server.ts` — Free $0/5, Pro $9.99/50, Pro Plus
  $29.99/unlimited, both paid plans with a 7-day trial. HDR maps and material
  variants are **Pro** features. Change the seed, change `pricing()` in
  `build/ui.mjs`, and re-render video 10.
- The shop library metafield is `$app:viewer3d.library`
  (`app/lib/model-library-constants.ts`), with `custom.viewer_3d_library` kept
  only as a legacy read path.
