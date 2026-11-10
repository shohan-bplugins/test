# Product 3D customization — plan

Written for: the team building the editor. Prototype: [prototype.html](./prototype.html) (open in a browser, no build).

## Goal

One place, opened from the **Customize** button on *3D products* (`/app/product-3d`), where a merchant sets up everything about a product's 3D: what it looks like, what shoppers can change, and what goes live. Today this is the editor window (`app.products.$id_.editor.tsx`). The plan keeps every existing control, groups them so they are easier to find, and closes the gaps listed under Phase 3.

## Entry points

| From | Action |
|---|---|
| 3D products list, row | **Customize** (opens editor) / **Change model** (modal: upload, Files, URL, demo models) |
| Product title link | opens editor (unchanged) |
| Editor header | Preview on store, Discard, Save draft, Publish |

The editor stays an App Bridge `<s-app-window>`; the live-chat widget is hidden while it is open.

## Layout (unchanged: 280px / flexible / 320px)

- **Top bar:** title, status badge (Saving / Unsaved / Draft / Published / Not published), "Editing {target}" badge, Undo, Redo, Preview on store, Discard, Save draft, Publish.
- **Left:** Set up by option → Product variants → Parts.
- **Centre:** viewport + view tools (Reset view, Zoom in/out, Show grid, Auto-rotate).
- **Right:** inspector, collapsible sections.

## Complete control inventory (all exist today)

### Top bar
- Undo / Redo (50 steps per target, 800 ms coalescing), Ctrl/Cmd+Z, Shift+Z / Y, Ctrl/Cmd+S.
- Preview on store (`?e3d_preview=1`; saves a draft first when dirty), Discard, Save draft, Publish (publishes stored draft when clean).

### Left — Set up by option
- Target switcher: Default (all variants); each product option value (`rule:Name=Value`) with "+" to add options; override dot.
- Variant exceptions (`n of total`), "Find a variant" search when more than 8 variants.
- For non-default targets: Overrides default / Same as default badge, Reset to default.
- Model for this selection: Choose a different model (Shopify Files), Use the product's model.

### Left — Product variants (edits real Shopify variants)
- Add an option (name + comma-separated values, max 3 options), Add values, Remove value, Remove option (confirm modals).
- Variant list (title, price, stock) with Edit (Price, Compare-at, SKU, Unlimited quantity, Quantity) and Delete.
- Set prices by option (Any / value per option, Price, Compare-at, Unlimited quantity, Quantity, "Variants affected").
- Add variant (value per option, Price).

### Left — Parts
- Mesh tree: collapse groups, hide/show eye per part or group.
- Selected part: Label shoppers see, Visible, Customer can recolor, Customer can hide, Use default for this part.

### Right — inspector sections
1. **Model** (read only): File, Size, Format, Meshes, AR file badge.
2. **Material:** Colour, Metalness (0–1), Roughness (0–1), Clear coat (0–1), Reset to the model's material.
3. **Custom options** *(Growth+)*: Add Color / Material / Parts / Material variant (max 8 groups). Per group: Option name, Show as (swatches / buttons / dropdown), Parts this option changes, Default choice, Shoppers must choose one, Show only when… *(Growth+)*, Add choice (max 24), Remove option. Per choice: Choice name, type fields (Colour; Colour + Metalness + Roughness; Parts shown; Material variant name), Price change *(Advance)*, Show only when… *(Growth+)*, Preview, Remove. Variant/rule targets can inherit or own their groups.
4. **Scene & lighting:** Lighting preset (Studio, Apartment, City, Dawn, Forest, Lobby, Night, Park, Sunset, Warehouse), Light intensity (0–2), Background (Transparent / Colour / Lighting image), Background colour, Shadows, Shadow strength (0–1).
5. **Camera:** Use current view as start view, Back to automatic, Shoppers can rotate / zoom / pan, Lowest / Highest view angle, Gallery views (Perspective, Front, Side, Back: Capture, Fly to).
6. **AR:** Show "View in your space", Size in AR (True to size / Shoppers can resize).
7. **Performance:** Sharpness limit on phones (1× / 1.5× / 2×), Power-saving mode.
8. **Import & export:** Configuration JSON, Apply, Copy JSON.
9. **Customer options, pricing & more** — placeholder today. The prototype replaces it with three sections: **Pricing** (shopper price preview and cart table size), **Personalization** (decal areas, Advance) and **Hotspots** (reuses the product-page hotspot controls).
10. **Viewer style & controls** (new in the editor, today on the product page): Display, Environment, Camera, Controls, Control bar with the drag-to-position layout editor and Hidden tray, Animation, AR, Advanced. The on-viewer control bar uses the storefront's look: 36px square buttons, white with a shadow, brand-blue hover, same six positions.

### Conditions and pricing sub-editors
- Show only when…: Based on (Product option / Custom option), Option / Condition (is, is not, has a choice, has no choice) / Value or Choice, Match (All / Any), Add / Remove condition, max 10 rules.
- Price change: No change / Fixed amount / Percent of the price, Amount, Sale amount (optional).

### Plan gating
Growth: option groups, conditions, material variants. Advance: option pricing, personalization, URL import. Locked controls show an inline "Available on {plan}" note instead of hiding.

## Phases

**Phase 1 — Entry and model (done / in progress)**
Customize and Change model buttons on the list; demo models in the add-model modal; hide live chat while the editor is open.

**Phase 2 — Reorganise without changing behaviour**
1. Group the right inspector into *Appearance* (Material, Scene & lighting), *Shopper experience* (Custom options, Camera, AR), *Advanced* (Performance, Import & export).
2. Show plan-locked controls in place with the required plan.
3. Add a search box to the inspector (jump to a setting).
4. Persist open/closed section state per merchant (localStorage, per-viewer only).
No data-model or action changes; existing `render` / `render_draft` metafields stay as they are.

**Phase 3 — Fill the gaps already in the data model**
1. Option group description (200 chars) and thumbnail display — types exist, no UI.
2. Camera distance limits (`minDistance` / `maxDistance`) — read by the viewport, no UI.
3. Choice material texture and clear coat for material choices.
4. Hotspots in the editor (reuse `HotspotsEditor`; the editor and viewer hotspot types differ, so map between them).
5. Decals / personalization *(Advance)*, animations, pricing summary replacing the placeholder section.

**Phase 4 — Quality**
Loading/error states in the viewport, keyboard access for the parts tree, translation of new strings in all 11 locales, e2e check of save → preview → publish.

## Risks
- Cannot test WebXR/AR here; AR section is read-only in this plan apart from the existing two controls. Storefront AR code is out of scope.
- Draft size cap is 512 KB; adding more per-choice data (descriptions, thumbnails) must show the existing "too large" error early.
- Client code must not import from `extensions/` (tunnel 404s `/extensions/*`).
- Variant edits hit Shopify immediately, while option edits are drafts. The prototype separates them visually; keep that in the real UI.

## Open questions
1. Should Customize open the full editor, or a lighter "quick customize" panel with only Material and Scene first?
2. Which locales must ship translations with Phase 2?
3. Is Phase 3 hotspots in scope for this release?
