# Next update — what to build

Candidate work for the release after App Store submission, ordered by what it
costs a merchant today rather than by what is interesting to build.

Every item marked **verified** was checked against the code on 1 September 2026;
the file and line are named so the work starts from the right place. Sizes are
coarse: **S** ≈ a day, **M** ≈ a few days, **L** ≈ a week or more.

---

## 1. Fix first — these are broken for someone right now

### 1.1 Horizon and any theme that renders sections client-side — **S** · verified

`viewer-3d.js` initializes on `DOMContentLoaded` and re-initializes only on
`shopify:section:load`, which Shopify fires in the theme editor and nowhere else
([viewer-3d.js:1909](extensions/viewer-3d/assets/viewer-3d.js#L1909)). A theme
that swaps a section in at runtime — Horizon, and anything using the Section
Rendering API for variant switching — leaves the block's markup in the DOM with
the script never running. Dawn does full page loads, which is why it has never
shown up there.

Add a `MutationObserver` on `document.body` that calls `initAll()` when a
`[data-view3d]` appears without `data-view3d-initialized`. Debounce it; the
observer must not fight the mount queue.

**Also fixes:** the viewer vanishing after a variant change on any theme that
re-renders the product section.

### 1.2 Theme block detection misses nested blocks — **S** · verified

`countBlockOccurrences` walks `section.blocks` exactly one level deep
([theme-blocks.server.ts:283](app/lib/theme-blocks.server.ts#L283)). Themes on
the theme-block architecture nest blocks inside group blocks, so a merchant who
added the viewer by hand inside a group gets told by the setup checklist that
they never added it. Recurse.

### 1.3 "Add block for me" assumes an `apps` section exists — **M** · verified

`addThemeBlock` looks for a section of `type: "apps"` and invents one if absent
([theme-blocks.server.ts:222](app/lib/theme-blocks.server.ts#L222)). That type is
a theme file (`sections/apps.liquid`), not a platform builtin — Dawn ships one,
newer themes may not, and writing a section the theme cannot render leaves the
merchant with a template that silently does nothing.

Read the theme's section list first; fall back to appending into the main product
section when it accepts `@app` blocks, and to the manual walkthrough when neither
is available.

### 1.4 No server-side model validation — **S**

The upload path checks the filename extension and the byte length and nothing
else ([files.ts:29](app/lib/files.ts#L29)). A renamed file, a truncated GLB, or a
malformed glTF reaches Shopify Files and fails at render time, in front of
shoppers, with no signal in the admin. Check the GLB magic number and version
header on the server; reject with a message naming the problem.

---

## 2. High impact — the gaps merchants will actually feel

### 2.1 Upload the .usdz for iPhone AR — **M** · verified

Today `iosSrc` is a URL field the merchant fills in by hand
([ViewerSettings.tsx:410](app/components/ViewerSettings.tsx#L410)), and the app
accepts only `.glb`/`.gltf`, so the merchant has to host the `.usdz` somewhere
else entirely. This is the single largest caveat in the App Store listing: half
of mobile shoppers get no AR without it.

Accept `.usdz` on the model, store it beside the `.glb` in Shopify Files, and
fill `iosSrc` automatically. Everything downstream already works — Quick Look is
wired up and switchable.

### 2.2 Replace a model's file, keeping its ID — **S** · verified

There is no replace path; the only way to swap a file is delete and re-upload,
which mints a new UUID. Every Model ID pasted into a page block, every embed
snippet and every share link then points at a model that no longer exists. A
merchant fixing a typo in a model breaks their own landing pages.

Add a replace action on the model detail page that writes a new `fileGid` and
`fileUrl` onto the existing row.

### 2.3 Storefront analytics — **M** · verified

The dashboard charts uploads over time ([app._index.tsx:382](app/routes/app._index.tsx#L382))
— an activity log of the merchant's own work. Nothing records what shoppers do:
no view counts, no interaction rate, no AR taps. "Is 3D worth it for my store?"
is the question every merchant asks at renewal, and the app cannot answer it.

Fire events from the viewer to a lightweight endpoint on model view, first
interaction, and AR launch. Aggregate per model and per day. This is also the
only honest way to ever put a conversion claim in the listing.

### 2.4 A poster image for the page block — **S** · verified

The product block uses the product's featured image as a poster
([product_viewer.liquid:46](extensions/viewer-3d/blocks/product_viewer.liquid#L46)).
The page block has none, so a viewer on a landing page is an empty coloured box
until the model finishes downloading — worst on exactly the slow connections
where it matters. Add a poster setting, and default it to a snapshot captured at
upload time.

### 2.5 One model on several products — **M** · verified

Assignment refuses a model already used elsewhere and names the conflicting
product ([app.products.$id.tsx:271](app/routes/app.products.$id.tsx#L271)). A
merchant selling the same lamp in four listings has to upload the same file four
times and it counts four times against their plan.

The limit exists because the plan caps count assignments. Decide the pricing
question first — probably count *distinct models*, not assignments — then relax
the guard.

---

## 3. Worth doing next

### 3.1 A model per variant — **L**

The `variant` setting is a glTF material variant inside one file
([ViewerSettings.tsx:424](app/components/ViewerSettings.tsx#L424)), which only
helps a model authored with `KHR_materials_variants`. Merchants ask for
something simpler: this `.glb` for the red one, that `.glb` for the blue one,
switching when the shopper picks a variant. Needs a variant→model map on the
product and a listener for the theme's variant change event.

### 3.2 `.gltf` with external assets — **M** · verified

`.gltf` is accepted, but a `.gltf` is usually a manifest referencing a `.bin` and
loose textures, and only the one file is uploaded — so it renders untextured or
not at all. Either accept a companion upload and rewrite the paths, or accept
`.glb` only and say so plainly at the file picker. The second is a one-line
honesty fix and should ship first regardless.

### 3.3 Settings presets — **S**

Every model is configured from scratch across 36 controls. Let a merchant save a
named preset and apply it to a model, or to every model at once. Cheap to build,
and it makes a catalogue rollout feel like one decision instead of forty.

### 3.4 Bulk assign — **M**

Uploading and assigning is one product at a time. A merchant rolling 3D across
100 products on the Growth plan does 100 round trips. Multi-select in the library
plus an assign-to-product picker covers most of it.

### 3.5 Sample model in onboarding — **S**

A merchant evaluating the app on a trial often has no `.glb` to hand, and neither
will the App Store reviewer. Ship one, offer it as "try it with our sample" in
the checklist. Removes the emptiest moment in the funnel.

### 3.6 Accessibility pass — **S**

The viewer is drag-and-scroll with a mouse. Keyboard rotation and zoom, a
focusable canvas with a visible focus ring, and honouring `prefers-reduced-motion`
against auto-rotate. Shopify reviewers have begun asking about this, and it is
small.

---

## 4. Bigger bets — decide before building

### 4.1 Slim the vendor bundle — **L**

`view3d.pkgd.min.js` is ~725KB because egjs-view3d packages all of three.js. It
is already deferred to the first mount, so it costs nothing on a page whose
viewer stays below the fold — but a viewer above the fold pays it in full.
Options: a custom three.js build with only the used modules, or Draco/KTX2
decoding so the models themselves shrink. Measure against a real Lighthouse run
before committing; Shopify allows a listed app 10 points and the deferral may
already be enough.

### 4.2 Hotspots and annotations — **L**

Clickable points on the model with a label and optional link — "solid oak
frame", "USB-C here". A well-understood 3D commerce feature and a real reason to
choose a viewer over a spinning GIF. Needs an authoring UI (place a point on the
model in the admin), storage on the config, and rendering in the block.

### 4.3 Automatic model optimisation — **M**

Draco mesh compression and texture resizing on upload. Turns a 45MB export that
the 20MB cap rejects today into a model that loads in two seconds. The risk is
owning a conversion pipeline and the support load when it degrades someone's
model — gate it behind an opt-in and always keep the original.

---

## Not planned, and why

| Idea | Why not |
|---|---|
| Converting `.fbx` / `.obj` / `.stl` | A conversion pipeline is a product of its own, and the failure modes land on us. The app displays models; authoring tools make them. |
| Multiple models on one product page | Every extra viewer is another WebGL context and another three.js loop. The current design is one per product deliberately — see the eviction logic at [viewer-3d.js:120](extensions/viewer-3d/assets/viewer-3d.js#L120). |
| Self-hosting model files | Files live in the merchant's own Shopify Files and serve from Shopify's CDN. That is a feature — it is why the storefront stays fast and why uninstalling costs the merchant nothing. |
| A free-plan watermark | Cheapens the storefront the merchant is trusting us with. The plan limits are the lever. |

---

*Ordering is a proposal, not a commitment. If only three things ship, make them
1.1, 2.1 and 2.2 — a broken theme, the missing half of AR, and a foot-gun that
breaks merchants' own pages.*
