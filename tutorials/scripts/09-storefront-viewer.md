# The storefront viewer — what shoppers can do

The customer's side: drag to rotate, wheel or buttons to zoom, reset view, snapshot, the animation clip switcher, fullscreen, and AR on Android and iOS.

Runtime 3:11 · 16 scenes.

---

### 01 · Title — `0:00`

Everything so far has been from your side. Now let's sit in the customer's seat and go through every control they get.

### 02 · First impression — `0:07`

This is the default. The model, a soft contact shadow so it sits on something, and two small buttons in the corner. Deliberately quiet — the product is the subject, not the interface.

### 03 · Drag to rotate — `0:19`

The main interaction is drag to rotate. Mouse or finger, any direction. If you enabled the grab cursor, the pointer turns into a hand over the canvas, which is the hint that makes people try it.

### 04 · Auto rotate — `0:31`

If you turned auto rotate on, it spins by itself until someone touches it. That's the strongest signal you can give that the image is interactive, and it costs nothing.

### 05 · Zoom — `0:41`

Zoom works two ways: the plus and minus buttons, or the scroll wheel and pinch. This is where 3D beats photography — a customer can get close enough to judge the stitching or the finish, on their own terms.

### 06 · Reset view — `0:54`

Once someone has spun a model to a strange angle, they need a way back. Reset view returns the camera to exactly the yaw, pitch and zoom you configured. It's off by default — switch it on for anything complicated.

### 07 · Snapshot — `1:07`

The camera button downloads a PNG of the current view. Customers use it to send a colleague the exact angle they're looking at, which quietly turns your product page into a sharing tool.

### 08 · Animation switcher — `1:18`

If your model has animation clips, the switcher appears top-left showing the playing clip. Click it and the customer picks another — open the lid, fold the frame, extend the legs. Remember: with this switch off, the model doesn't animate at all.

### 09 · Axis gizmo — `1:33`

The axis gizmo shows X, Y and Z orientation in the corner. It's genuinely useful for technical products — furniture, machine parts, anything where which way is up matters — and clutter for a sneaker.

### 10 · Fullscreen — `1:46`

Fullscreen is the one I'd always leave on. A viewer inside a product page column is small; fullscreen gives the model the whole screen.

### 11 · In fullscreen — `1:54`

In fullscreen the controls follow, and an exit button appears top-left. The model re-fits to the new shape rather than staying at its old scale. Escape also works.

### 12 · AR — `2:04`

On a phone, an AR button appears. Tapping it drops the product into the camera view at real scale — on the customer's floor, on their desk, against their wall. For furniture and anything size-sensitive, this is the feature that answers will it fit.

### 13 · AR platforms — `2:19`

Two platforms, two mechanisms. Android uses WebXR or Google Scene Viewer and works straight from your glb, on by default. iOS uses Apple Quick Look, which needs a separate USDZ file — so if AR matters to you, export one and paste its URL into the AR settings. Desktop browsers just don't show the button.

### 14 · Mobile scroll — `2:40`

One last warning about mobile. If you turned page scroll on touch off, a finger drag inside the viewer rotates the model and never scrolls the page. On a tall product page that means a customer can get stuck. Leave it on unless you have a very specific reason.

### 15 · Graceful loading — `2:56`

And while a model loads, the viewer shows a spinner in your chosen background colour rather than a blank hole — so a slow connection looks intentional instead of broken.

### 16 · Title — `3:05`

That's the customer experience. Next, the practical matter of plans and limits.
