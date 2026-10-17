# Share & embed a model anywhere

The public /viewer/<id> page, the responsive and fixed iframe snippets, where they can be pasted, and the ?bg and ?autorotate URL overrides.

Runtime 2:47 · 15 scenes.

---

### 01 · Title — `0:00`

Theme blocks only work inside modern Shopify themes. But sometimes you need a model in a blog post, a legacy template, an email landing page, or a site that isn't Shopify at all. That's what this is for.

### 02 · Share & embed card — `0:14`

Open any library model and you'll find the Share and embed card. It gives you two things: a link, and an iframe snippet.

### 03 · The viewer link — `0:22`

The viewer link is a real, public page that renders just this model at full size. Anyone with the link can open it — no login. The ID is a random UUID so it isn't guessable, and the page is marked noindex so it won't turn up in search results.

### 04 · The public page — `0:37`

Here's that page. Nothing but your model, filling the window, with your saved settings applied. Send it to a client, drop it in a Slack message, put it behind a QR code on packaging.

### 05 · The embed snippet — `0:48`

The embed code wraps that same page in an iframe. It's deliberately built to survive: every style is inline, there are no CSS classes and no script tag, so Shopify's HTML sanitiser leaves it alone and your theme's CSS can't collide with it.

### 06 · Responsive mode — `1:04`

Two modes. Responsive keeps a four-to-three box at whatever width the column happens to be, which is what you want inside a page layout you don't fully control.

### 07 · Fixed mode — `1:13`

Fixed pins the model's saved height in pixels instead. Use it when you want the viewer exactly as tall as you designed it.

### 08 · Where to paste — `1:21`

Three places it goes. A Shopify page or blog post — switch the rich text editor to the HTML view first, the angle-bracket button. A Custom Liquid section, which works in every theme including legacy liquid ones. Or any website at all.

### 09 · Copy it — `1:36`

Hit Copy and it's on your clipboard.

### 10 · Embedded in a blog post — `1:39`

And there it is, sitting in a blog post, fully interactive. Your theme's typography above and below it, the model in the middle, no layout fighting.

### 11 · URL overrides — `1:48`

Now the clever bit. Two settings can ride on the URL, so one model can suit several placements without re-saving it. Question mark b g equals a hex colour changes the background — and note there's no hash symbol, because a hash starts a URL fragment. And autorotate equals zero stops it spinning.

### 12 · Dark placement — `2:07`

Here's the same model, same saved settings, with question mark b g equals one-oh-one-oh-one-four appended — sitting comfortably on a dark page. Re-saving the model would have changed every other placement; this changes only this one.

### 13 · Keep allow=fullscreen — `2:21`

One thing not to strip out: allow equals fullscreen on the iframe tag. Without it, the browser refuses the fullscreen request and the button appears to do nothing.

### 14 · Preview button — `2:31`

Finally, the Preview button in the header opens that public page in a tab. It renders the saved settings, so if you've just changed something, save first.

### 15 · Title — `2:41`

Next, we look at the viewer from the other side — what your customer can actually do with it.
