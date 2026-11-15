# Product variants & 3D customization doc: how to use it

`product-variants-3d.html` is a ready-to-paste WordPress (Gutenberg) page. It has 26 marked screenshots
embedded right in the file. The same screenshots are in `images/` as `.webp` files.

## Paste into WordPress

1. Create a new page or post.
2. Open the ⋮ menu (top right) → **Code editor** (or press Ctrl/Cmd + Shift + Alt + M).
3. Paste all of `product-variants-3d.html` and click **Exit code editor**.
4. Optional but recommended: click each image → **Replace** → upload the matching file from `images/`
   (or use the image toolbar's upload button). This moves the images into your Media Library and keeps the page small.

Notes:
- Embedded images need an Administrator account (one with "unfiltered HTML"). If WordPress removes them,
  upload the files from `images/` instead. They're named in page order.
- The FAQ uses the **Details** block, which needs WordPress 6.3 or newer.

## About the screenshots

They show the app's real screens, rendered locally with sample data (a "Lounge Chair" with Color and Size options).
They aren't from a live store. The storefront shots use the theme blocks' real Liquid, JS and CSS with a plain demo theme.
Theme editor screens (Online Store → Customize) aren't included. The doc describes those steps in text.

| File | Section |
|---|---|
| 01-variants-section | 1. Find the Product variants section |
| 02-add-option … 05-manage-options | 2. Add variants and options |
| 06a-variant-menu, 06b-edit-modal, 07-set-prices | 3. Change price, SKU and stock |
| 08-preview-variant | 4. Preview a variant |
| 09 … 13, 17-editor-variant-details | 5. Customize the 3D look of a variant |
| 14-variant-actions, 15-copy-setup | 6. More variant actions |
| 20-custom-options, 21-pricing, 22-shopper-view | 7. Custom options for shoppers |
| 30 … 32b (store-*) | 8. Show it on your store (theme blocks) |
| 23-embed-iframe | 9. Embed with iframe |
