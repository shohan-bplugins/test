# Preview vs Save And View — checking your work

The three ways to see your changes: the instant live preview, Preview (unsaved changes on the real storefront), and Save And View (save, wait for Shopify, then open).

Runtime 2:22 · 13 scenes.

---

### 01 · Title — `0:00`

You've tuned the viewer. Now, how do you know it looks right where it actually matters — on your storefront? There are three tools, and they do genuinely different things.

### 02 · Three buttons — `0:10`

Three buttons in the header. Preview, Save settings, and Save And View. People mix these up constantly, so let's be precise.

### 03 · 1 — live preview — `0:19`

First, the live preview on the right. It updates as you drag, and it needs no button at all. This is where you do ninety percent of your work. It's the same viewer code the storefront runs, loading the same file — so if it looks right here, it will look right there.

### 04 · Preview button — `0:35`

Second, the Preview button. This opens your actual storefront product page and applies your unsaved changes through the URL. Nothing is written to your store — close the tab and it's as if it never happened.

### 05 · Preview result — `0:47`

So you see your dark background, your camera angle, your control bar — inside your real theme, with your real header, fonts and layout around it. That context is the whole point. Nothing about your saved settings has changed.

### 06 · Why not just save — `1:01`

Use Preview while you're still deciding — try five backgrounds against your real page without writing five times. When you've decided, then save.

### 07 · Save settings — `1:10`

Save settings writes the config to the product's metafield. That's the moment it becomes real for customers.

### 08 · Saved — `1:17`

You get a confirmation, and the button goes back to reading Saved.

### 09 · Save And View — `1:21`

Save And View is the convenience button, and it does something subtle. It saves, then it waits, and only then opens the storefront. The waiting is the important part.

### 10 · The propagation wait — `1:31`

Shopify takes a few seconds to propagate a metafield write to the storefront. If you opened the page immediately you'd see your old settings and conclude the save had failed. So the app opens a placeholder tab with this spinner, holds it for a moment, and then navigates.

### 11 · The published page — `1:47`

And there's the published result. This is what a customer will load — saved settings, no URL tricks. If it looks right here, you're done.

### 12 · If it looks stale — `1:56`

Occasionally a hard reload is still needed — caching happens at several layers. If the storefront keeps ignoring your changes, check the Setup page: storefront read access has to be on, or your theme literally can't read the config. And if no tab opens at all, your browser blocked the pop-up — both buttons need to be a direct click.

### 13 · Title — `2:16`

Next up, the 3D Model Library — for models that don't belong to a single product.
