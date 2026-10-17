# Adding the theme blocks

How to place the two app blocks — '3D Viewer — Product' on product pages and '3D Viewer — Any Model' anywhere else — plus what each block setting does and why a Model ID beats a raw URL.

Runtime 2:44 · 17 scenes.

---

### 01 · Title — `0:00`

Your models are stored, but nothing draws them yet. That's the job of the theme blocks — and you add them once, in Shopify's theme editor.

### 02 · Two blocks — `0:09`

There are two. 3D Viewer — Product goes on your product template and picks the model up from the product automatically. 3D Viewer — Any Model takes a Model ID and works on any page at all: your home page, a custom page, a blog post.

### 03 · Open the editor — `0:23`

Start in your Shopify admin under Online Store, then Themes, then Customize. Make sure the template dropdown at the top says Product.

### 04 · Add section — `0:32`

In the left sidebar, click Add section.

### 05 · Apps category — `0:35`

Scroll to the bottom of the list and open Apps. This is where every app-provided block lives, not just this one.

### 06 · Pick the product block — `0:42`

Choose 3D Viewer — Product.

### 07 · Block appears — `0:45`

And there it is. The block is in your template and the viewer is already rendering the model you assigned to this product — you didn't have to tell it which file to use.

### 08 · Product block settings — `0:54`

Its settings are deliberately thin. Manual model URL is an override for testing only — leave it blank for the normal flow. Height and background colour are defaults, and any per-product setting you save in the app wins over them.

### 09 · Drag position — `1:07`

You can drag the block anywhere in the template — above the product media, below the description, wherever it fits your layout. Then hit Save.

### 10 · Live on the storefront — `1:16`

That's the product page done — for every product in your store at once. Assign a model to any product and it shows up here with no further theme work.

### 11 · Switch template — `1:25`

Now the other block. Pick a different template from the same dropdown — here I've switched to Page — then Add section, Apps, and this time choose 3D Viewer — Any Model.

### 12 · Any Model settings — `1:36`

This one needs to be told what to show, and you have two ways. Paste a Model ID from the app's 3D Models library, or paste a direct file URL. If you fill both, the ID wins.

### 13 · Why the ID is better — `1:48`

Always prefer the ID. It carries the model's saved viewer settings with it — height, background, camera, controls, everything. A raw URL brings only the file, so the block's own height and background get used instead.

### 14 · Interaction settings — `2:02`

This block has two extra switches. Auto rotate spins the model on load, and Show on-screen controls covers the zoom and fullscreen buttons. Note that these only apply when you've used a raw URL — a Model ID brings its own settings.

### 15 · Page result — `2:16`

Save, and the model is live on that page — with its caption underneath if you set one.

### 16 · OS 2.0 caveat — `2:22`

One caveat. App blocks only exist in Online Store 2.0 themes. If Apps isn't in your Add section list, your template is a legacy liquid one — use the iframe embed code instead, which we cover in tutorial eight.

### 17 · Title — `2:36`

Blocks placed. Next, the part you'll actually repeat for every product: uploading and assigning the model itself.
