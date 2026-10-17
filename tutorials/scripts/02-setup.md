# Setup — metafield definitions & the model library

The one page you must visit before anything reaches the storefront: what the three metafield definitions are for, what 'storefront read access' means, and how to read the library diagnostics when a Model ID says 'not found'.

Runtime 2:52 · 14 scenes.

---

### 01 · Title — `0:00`

Before a single model can appear on your storefront, the app needs somewhere to store it. That's what the Setup page is for. It takes about ten seconds and you only do it once.

### 02 · Why setup exists — `0:11`

The dashboard's first step points here. Shopify keeps custom data in things called metafields, and the theme block reads your model out of them. If the definitions don't exist, the block finds nothing.

### 03 · The Setup page — `0:23`

Open Setup from the nav. The page is in three parts: the definitions themselves, what your theme can actually see, and the two manual steps that follow.

### 04 · The three definitions — `0:33`

There are three definitions. The first, custom dot model underscore 3D, is a file reference — it points at the actual .glb in your Shopify Files. The second, custom dot viewer underscore 3D underscore config, is JSON and holds the viewer settings for that product.

### 05 · Shop library definition — `0:51`

The third is different. It hangs off the shop rather than a product, and it's a map from every Model ID in your library to that model's file URL and settings. That's what lets you paste an ID into a page block anywhere on your store.

### 06 · Storefront read access — `1:04`

Each row says Ready, Missing, or No storefront access. That last one matters: a definition can exist and still be invisible to your theme. Storefront read access is what makes it readable, and the button below fixes it either way.

### 07 · Run the button — `1:18`

So: click Create slash fix definitions. It creates anything missing, turns on storefront access where it's off, and then immediately syncs your model library. It's safe to run as many times as you like.

### 08 · All ready — `1:31`

All three go green, and you get a confirmation. Once you've done this, the button relabels itself to Re-sync model library — same action, and it stays available on purpose.

### 09 · What the theme can see — `1:42`

Now the most useful panel on the page: What the theme block can see. This doesn't check the schema — it reads the value back, exactly the way your theme's Liquid would. That's the difference between a definition that exists and a library that actually works.

### 10 · Resolvable IDs — `1:57`

It also prints the Model IDs the storefront can resolve. If a page block reports a model as not found, compare the ID here with the one you pasted — nine times out of ten they simply don't match.

### 11 · Empty library diagnosis — `2:08`

If the library comes back empty while you clearly have models, the panel says so and tells you what to do — run the button again, and if it still reads empty, Shopify's own rejection message is printed right here so you can act on it or send it to support.

### 12 · Partial publish — `2:23`

And if only some models made it, it tells you the count. Models without a resolved file URL get left out — usually because Shopify is still processing the upload. Open those models and re-save them.

### 13 · Steps 2 and 3 — `2:35`

The rest of the page is the two things only you can do: add the theme block, and upload models per product. Both have their own tutorial in this series.

### 14 · Title — `2:45`

That's Setup. Next we'll add the theme block, which is the piece that actually draws the viewer on your storefront.
