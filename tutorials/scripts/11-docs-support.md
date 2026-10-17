# Documentation, troubleshooting & support

The built-in documentation, the four problems that account for most support tickets and how to fix each, and where to reach a human.

Runtime 2:52 · 14 scenes.

---

### 01 · Title — `0:00`

Last video. Where to look when something isn't behaving, and the four problems that account for most questions we get.

### 02 · Documentation page — `0:08`

The app ships its own documentation — no tab-switching to a website. Open Documentation from the nav and you get eight cards covering the quick start, model files, every settings group, preview behaviour, block placement, embedding, plan limits and troubleshooting.

### 03 · Quick start card — `0:24`

The quick start card is the four-step version of this whole series, so it's the one to send a colleague who just needs to add one model.

### 04 · Model files card — `0:32`

Model files spells out the rules in one place: glb recommended, gltf accepted, twenty megabyte ceiling but aim under ten for page speed, and the reminder that iOS AR needs a separate USDZ.

### 05 · Problem 1 — `0:46`

Problem one: the block renders nothing at all. Almost always this means the product has no model assigned. The block outputs nothing rather than an empty box, which is correct but does look like a bug. Assign a model, or paste a manual glb URL into the block to prove the block itself works.

### 06 · Problem 2 — `1:04`

Problem two: you save, but the storefront keeps showing the old settings. Go to Setup and check storefront read access. Without it your theme genuinely cannot read the config, no matter how many times you save. Run the button, then hard-refresh.

### 07 · Problem 2 fix — `1:19`

That's this column, right here. Every row should read Ready.

### 08 · Problem 3 — `1:23`

Problem three: a page block says the Model ID isn't found. That ID is resolved through the shop library metafield, and Setup is what writes it. Run Setup, then compare your ID against the list in What the theme block can see. If it isn't there, copy it again from the model's page.

### 09 · Problem 4 — `1:40`

Problem four: the model goes white. That usually means the viewer is re-initialising because you just changed something structural, like tone mapping or the environment map. Wait a second, or revert that one field.

### 10 · Pop-up blocking — `1:53`

And one more that catches people: if Preview or Save And View seems to do nothing, your browser blocked the pop-up. Both need to be a direct click, so don't trigger them from a keyboard macro or a script.

### 11 · Troubleshooting card — `2:05`

All four of those are written up in the Troubleshooting card at the bottom of the documentation page, so you don't have to remember this video.

### 12 · Help and resources — `2:13`

Back on the dashboard, Help and resources is the fastest route out. The video tutorial, the documentation, a link to leave a review, and Get support — which reaches our team directly.

### 13 · What to send support — `2:25`

If you do write in, three things make it fast: your store domain and the product or Model ID involved, a screenshot of your Setup page, and the exact error text if one appeared. The Setup screenshot answers most questions on its own.

### 14 · Title — `2:39`

And that's the whole app. Setup once, assign a model, add the block once, then tune the viewer as much as you like. Thanks for watching — and if the app is working well for you, a review genuinely helps.
