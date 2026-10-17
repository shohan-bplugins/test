# Viewer settings — all eight sections

Every per-product viewer option: Display, Environment, Camera, Controls, Control bar, Animation, AR and Advanced — and what each one does to the model your customer sees.

Runtime 5:04 · 23 scenes.

---

### 01 · Title — `0:00`

A 3D model on a page is only half the job. How it's lit, how far away the camera sits, what a customer is allowed to do with it — that's all in here.

### 02 · Where settings live — `0:10`

The viewer settings card sits under the model file, on the left. Everything you change here is saved to that product's own config metafield, so it applies to this product only and overrides the theme block's defaults.

### 03 · Live preview — `0:22`

On the right is the live preview, and this is the thing to trust. It renders the same viewer your customers get, loading the same file the storefront will. Nothing here needs saving to see — the preview updates as you drag.

### 04 · Display — height — `0:35`

Start with Display. Viewer height sets how tall the viewer is on the page, from two hundred up to twelve hundred pixels. Drag it and watch the preview grow.

### 05 · Display — background — `0:45`

Background colour is the one setting people change first. Pick a colour that matches your theme — a white viewer dropped into a dark page reads as a broken box. You can use the swatch or type a hex value.

### 06 · Display — exposure — `0:57`

Exposure is brightness, and it's the fix for a model that came out of Blender looking too dark or blown out. Zero to five, and small moves make a big difference.

### 07 · Display — tone mapping — `1:07`

Tone mapping decides how bright values get compressed into what your screen can show. Linear is the safe default. ACES Filmic is the most photographic and usually the best-looking for product shots. Try them — it's one dropdown.

### 08 · Display — env, blur, shadow — `1:21`

Three switches finish Display. Default environment map generates lighting so metals and glossy plastics have something to reflect — leave it on. Blur skybox softens the background image. And Cast shadow puts a contact shadow under the model, which is what stops it looking like it's floating.

### 09 · Environment — `1:39`

Environment is for when the generated lighting isn't enough. Point Skybox at an HDR image and it becomes the visible background and the light source. Environment map is a separate HDR used only for reflections, so you can have studio lighting on the model without a photo behind it.

### 10 · Camera — FOV — `1:55`

Camera. FOV mode is Auto by default, which frames the model to fit whatever its size happens to be — leave it there unless you have a reason. Switch to Custom and the FOV slider wakes up: low numbers are a long lens, high numbers a wide-angle look.

### 11 · Camera — yaw and pitch — `2:10`

Initial yaw and pitch are the angle the model faces when the page loads. This is worth spending a minute on: turn the shoe so the logo faces the customer, tilt it so they can see the sole. Watch the preview rotate as you drag.

### 12 · Camera — zoom — `2:24`

Initial zoom moves the camera in or out from that framing. Positive numbers move closer. Combined with yaw and pitch, these three give you a proper hero shot rather than whatever angle the file was exported at.

### 13 · Controls — interaction — `2:36`

Controls decide what a customer can do. Allow rotate, allow pan, allow zoom — all independent. Turning pan on is useful for large models; turning zoom off is useful when you want one fixed presentation.

### 14 · Controls — auto rotate — `2:49`

Auto rotate spins the model gently on load. It's the single best way to tell a shopper that this image is interactive — most people won't try to drag a picture unless something moves first.

### 15 · Controls — scroll behaviour — `3:00`

These two matter on mobile. Page scroll on touch lets a finger drag scroll the page instead of trapping it in the viewer — keep it on. Page scroll on mouse wheel does the same for the wheel, so the wheel scrolls the page rather than zooming the model.

### 16 · Control bar — `3:14`

Control bar is the on-screen buttons, each one an individual switch. By default you get zoom in, zoom out, and fullscreen — that's a deliberate minimum, so the model isn't buried under chrome.

### 17 · Control bar — all on — `3:27`

Switch the rest on and you can see them appear in the preview. The axis gizmo shows orientation. The camera button downloads a PNG of the current view. Reset returns the camera to your starting angle. And the animation switcher shows the playing clip — note that with this off, the model doesn't animate at all.

### 18 · Animation — `3:45`

Animation. If your model has clips baked in, default animation index picks which one autoplays — one is the first, zero means none. Repeat mode: one loops that clip, all cycles through every clip, none plays it once and stops.

### 19 · AR — `3:59`

AR lets a shopper put the product in their room. WebXR and Google Scene Viewer cover Android and are on by default. Apple Quick Look covers iPhone and iPad, but it needs a separate USDZ file — glb won't do — so upload one to Shopify Files and paste its URL in the box below.

### 20 · Advanced — `4:17`

Advanced holds two specialist options. Material variant switches the model to a named variant, if your glb was authored with them — handy for colourways. And fix skinned bounding box recalculates the model's bounds using its skeleton, which fixes rigged models that frame themselves badly.

### 21 · Save — `4:35`

Nothing is stored until you hit Save settings. The button only lights up when you actually have unsaved changes, so it doubles as your dirty indicator.

### 22 · Customized and reset — `4:44`

Once saved, a Customized chip appears next to the product name, and a Reset to defaults button appears in the header. Reset deletes the config metafield entirely, so the product falls back to the theme block's defaults.

### 23 · Title — `4:57`

That's every setting. Next, the three different ways this app lets you check your work before customers see it.
