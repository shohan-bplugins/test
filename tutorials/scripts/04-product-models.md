# Assigning a 3D model to a product

Uploading a .glb to a product, reusing a file already in Shopify Files, replacing and removing models, and the file rules the app enforces.

Runtime 2:50 · 17 scenes.

---

### 01 · Title — `0:00`

This is the screen you'll use most: attaching a 3D model to one of your products.

### 02 · Products list — `0:06`

Open Product 3D Models from the nav. Every product in your store is listed here, newest first, and each row tells you whether it already has a model.

### 03 · Coverage line — `0:15`

The subtitle under the heading is your coverage: three of twenty-four products have a model. It's the single number that tells you how much of the catalogue is done.

### 04 · Search — `0:24`

With a big catalogue, search by title. It's server-side and debounced, so it searches your whole store rather than just the page you're looking at.

### 05 · Assigned badge — `0:33`

A green cube and the words 3D model assigned mean that product is live. The button on the right changes from Add to Update to match.

### 06 · Open a product — `0:40`

Click a product — anywhere on the row, or the Add button — to open its detail screen.

### 07 · Empty product detail — `0:46`

Here's a product with no model yet. On the left, the model file card and the viewer settings. On the right, a live preview that's currently empty because there's nothing to show.

### 08 · File rules — `0:56`

Read the card description, because it's the rules. Glb or gltf only. Up to twenty megabytes. Stored in your Shopify Files, and linked to the product through the custom dot model underscore 3D metafield.

### 09 · Two ways in — `1:10`

You have two ways to get a model in. Upload sends a new file from your computer. Choose from Files reuses something already in your Shopify Files — useful when the same model belongs to several products, because it doesn't duplicate the file.

### 10 · OS file chooser — `1:25`

Let's upload. Click Upload, pick your .glb, and open it. The app validates the file before it sends anything — wrong extension or over twenty megabytes and you get told immediately instead of after a long upload.

### 11 · Uploading — `1:38`

The upload goes through Shopify's staged upload, so the file lands in your Files, then gets linked to the product. Big models take a moment.

### 12 · Assigned — `1:47`

Done. The file URL appears, the header now says 3D model assigned, and the live preview is rendering your actual model.

### 13 · Replace and remove — `1:55`

Once a model is assigned, two things change. Upload becomes Upload Replace, which swaps the file but keeps all your viewer settings. And Remove appears — that unlinks the model from the product; it does not delete the file from your Shopify Files.

### 14 · Choose from Files — `2:11`

Choose from Files opens this picker. It lists only model files, tells you which one is currently assigned, and searching filters as you type. Pick one and it's assigned instantly — no second upload of the same geometry.

### 15 · Plan limit — `2:24`

One thing to know: the plan limit is checked here. If you're at your limit and try to assign a model to a new product, the app stops you and says so. Replacing a model on a product that already has one is always allowed.

### 16 · Live on the product page — `2:37`

And that's it — the product page picks the model up from the metafield with no further work. Assign, and it's live.

### 17 · Title — `2:44`

Model assigned. Next we open up the viewer settings, which is where this app really earns its keep.
