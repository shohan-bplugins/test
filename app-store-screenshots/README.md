# App Store screenshots

Five 1600×900 PNGs for the Shopify App Store listing (Shopify's desktop
screenshot size; 3 minimum, 6 maximum).

| File | Shows |
| --- | --- |
| `01-hero.png` | Real storefront product page with the 3D viewer |
| `02-library.png` | Admin — 3D model library (reconstruction) |
| `03-products.png` | Admin — Product 3D models (reconstruction) |
| `04-settings.png` | Real admin capture — live preview + viewer settings |
| `05-mobile.png` | Real mobile capture of the same product page |

## How these were made — read before submitting

**Screenshots 1, 4 and 5 are real captures.** Both are photographs of the live
storefront with the theme app block running — the real viewer, its animation
selector, and its zoom/fullscreen controls, inside the real product page. They
are cropped and framed here, never redrawn. No browser chrome or URL bar was
added: a fabricated address would have been the one untrue pixel on an
otherwise genuine screenshot.

Screenshot 1 shows the product photo and the viewer side by side, which is the
whole point of the shot — the photo is what a shopper sees today, the viewer is
what the app adds beside it. Its text column is narrower than the other four so
the capture can run at ~0.84 scale rather than ~0.63; the crop removes only dead
margin (page whitespace, empty gutter, the clipped announcement strip).
Screenshot 5 keeps the capture's
true 598×891 aspect rather than cropping it to 390×844 to imitate an iPhone —
that crop would have sliced the edges off the viewer and the Add-to-cart row.

Screenshot 4 is a real capture of the admin settings page: the live preview
beside the Viewer settings panel, with the actual controls — viewer height,
background colour, exposure, tone mapping, default environment map, blur
skybox, cast shadow, and the collapsed Environment and Camera sections. It
replaced a Polaris reconstruction that had guessed at those controls and
guessed wrong (it showed Auto-rotate and Allow zoom toggles, which are not what
that panel offers).

**The admin screens 2 and 3 are rebuilt, not captured.** The admin lives
inside Shopify's embedded iframe and needs a session token, which a headless
browser cannot obtain — so those panels are composed from Shopify's own Polaris
web components (`cdn.shopify.com/shopifycloud/polaris.js`, the same script the
app loads) using this app's real page headings, button labels, and helper text.
They render with genuine Polaris styling and match the live screens, but they
are a reconstruction. **Compare each against the real page before submitting.**

**Some list content is illustrative.** `Astronaut.glb` and `Animated dog0` are
the two real models in the library. `Sneaker.glb`, `Lounge Chair.glb`,
`Coffee Mug.glb`, the five product names, their thumbnails, the plan badge and
the "3 of 12" count are demo data invented to fill the lists. The product
thumbnails other than the astronaut are drawn glyphs, not photographs. Replace
them with real rows from your own store if you would rather the listing show
only true content.

## Licensing to check

Screenshots 1 and 5 now show a snowboard model on *The Multi-location
Snowboard* — a real product, in stock, with Add to cart and Buy it now both
live. An earlier pair used a Growlithe (a Nintendo/Game Freak character) on an
unavailable product; both were re-shot and neither issue remains.

`Animated dog0` in the library list of screenshot 2 is a Growlithe. It appears
only as a filename in a table, never as rendered art, but rename or remove that
row if you would rather the character's name not appear at all.

## Rebuilding

`sources/` holds the HTML and the cropped renders. With a dev server on :5199:

    cd sources
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      --headless=new --hide-scrollbars --allow-file-access-from-files \
      --screenshot=../01-hero.png --window-size=1600,900 \
      --virtual-time-budget=15000 file://$PWD/01-hero.html

Fresh 3D captures need `--use-gl=angle --use-angle=swiftshader
--enable-unsafe-swiftshader`; without them WebGL fails in headless.
