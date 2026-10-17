# App icon

The mark from the screenshot lockup, redrawn at icon scale. Two variants, both
1200×1200 PNG — Shopify's App Store icon size.

| File | Use |
| --- | --- |
| `app-icon-solid-1200.png` | **Recommended.** Upload this one. |
| `app-icon-outline-1200.png` | Identical to the badge in the screenshots. |
| `app-icon-*-512.png` | Smaller copies, for a favicon or a README. |
| `icon-solid.svg`, `icon-outline.svg` | Vector sources — edit these, re-render at any size. |
| `preview-rounded.png` | Both variants at 220 / 104 / 48px with Shopify's corner rounding applied. |

## Why solid over outline

They are the same cube. The outline version matches the screenshots exactly, so
it is here if visual consistency with the listing matters more to you. But
Shopify renders this icon at roughly 48px in search results and category
listings, and at that size an outline cube loses its interior lines and closes
up into a pale hexagon. The shaded faces still read as a solid object. See
`preview-rounded.png` — the 48px pair on the right makes the difference obvious.

## Before uploading

- **Corners:** the source files are square with a full-bleed background.
  Shopify applies its own rounding, so do not round them yourself — a
  pre-rounded PNG gets rounded twice and shows pale corner wedges.
- **Safe area:** the cube occupies the middle ~53% of the canvas, well clear of
  anything the corner mask can reach.
- **No transparency:** the background is a solid blue gradient
  (`#2a80ff` → `#0b57c4`, the app's `#146ef5` family). Shopify rejects icons
  with transparent backgrounds.
- **No text:** deliberately. Shopify's guidelines ask for a mark, not a
  wordmark, and at 48px any lettering would be unreadable.

## Re-rendering

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      --headless=new --hide-scrollbars --allow-file-access-from-files \
      --screenshot=out.png --window-size=1200,1200 \
      --virtual-time-budget=6000 file://$PWD/wrapper.html

where `wrapper.html` is a bare page holding `<img src="icon-solid.svg">` sized
to 1200×1200. Any SVG renderer works; this is just what was used here.
