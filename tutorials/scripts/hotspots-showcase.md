# Easy 3D Viewer — Hotspots showcase: voiceover script

Video: `tutorials/videos/hotspots-showcase.mp4` (1:31, silent).
Timing reference: `tutorials/videos/hotspots-showcase-guide-voice.mp4`, the same video
with a placeholder macOS voice reading each line at its cue. Watch it once before recording.

- **11 lines, about 63 seconds of speech.**
- **Voice:** warm, confident and friendly, like a product launch rather than a tutorial. Mid-tempo, about 160 words per minute.
- **Pronunciation:** "3D" is *three-D*. "Easy 3D Viewer" is the product name; stress *Easy*.

## How to generate it

1. Generate **each line as its own audio file**, named exactly as in the **File** column below (for example `01-intro.mp3`). Separate files let every line land on its own cue. A single long take would drift.
2. Keep each file within its **Max length**. Trim any silence at the start; a little silence at the end is fine.
3. Put all 11 files in one folder and run:

   ```bash
   cd tutorials/showcase/rec
   node build.mjs --voice /path/to/that/folder
   ```

   This writes the voiced cut to `tutorials/videos/hotspots-showcase.mp4` (a silent copy is kept as `hotspots-showcase-silent.mp4`), with each line placed at its cue and the mix loudness-normalised to -16 LUFS. If the last line needs longer, the end card is held. It warns you if any file is too long for its scene.

If your generator only produces one continuous file, the plain lines are in
`tutorials/scripts/hotspots-showcase-tts.txt`. You would then have to cut that file at the cues yourself.

## Lines

| # | File | Starts at | Max length | On screen |
|---|------|-----------|------------|-----------|
| 1 | `01-intro` | 0:00.4 | 4.2 s | Title card: "Hotspots" |
| 2 | `02-pins` | 0:05.0 | 6.5 s | Shoe rotating on a store page, numbered pins riding along |
| 3 | `03-click` | 0:11.9 | 5.9 s | Pin 1 clicked: camera glides in, text card opens |
| 4 | `04-photo` | 0:18.2 | 3.3 s | Pin 2: card with a photo of the midsole |
| 5 | `05-video` | 0:21.9 | 6.3 s | Pin 3: video card, play pressed, clip plays in the card |
| 6 | `06-shop` | 0:28.6 | 10.5 s | Pin 4: product card, color changed, price updates, Add to cart, cart badge goes to 1 |
| 7 | `07-style` | 0:39.5 | 5.1 s | Lounge chair with green title pills instead of numbers |
| 8 | `08-hover` | 0:44.9 | 9.7 s | Pointer hovers each pill, cards open with no click |
| 9 | `09-phone` | 0:55.1 | 10.2 s | Phone: tap a pin, card slides up as a bottom sheet |
| 10 | `10-admin` | 1:05.7 | 14.5 s | Admin: Add hotspot, click the toe, pin 5 drops, title and description typed |
| 11 | `11-outro` | 1:20.6 | 9.7 s | End card: Easy 3D Viewer for Shopify, "Up to 20 per model · on Pro and Pro Plus" |

### 1 · `01-intro` — 0:00.4 (max 4.2 s)
> Meet Hotspots — the newest feature in Easy 3D Viewer.

Bright and inviting. Land on "Hotspots".

### 2 · `02-pins` — 0:05.0 (max 6.5 s)
> Pin the details that sell your product right onto the 3D model. The pins stay locked in place as it turns.

This line is tight; keep the pace up.

### 3 · `03-click` — 0:11.9 (max 5.9 s)
> One click, and the camera glides to that exact spot while a card opens with the story behind it.

Brief pause after "One click," as the cursor clicks on screen.

### 4 · `04-photo` — 0:18.2 (max 3.3 s)
> Add a photo to show the detail up close…

Rising tone at the end; it leads straight into line 5.

### 5 · `05-video` — 0:21.9 (max 6.3 s)
> …or a video — from YouTube, Vimeo, or your own file — that plays right inside the card.

Pick up from line 4 as if it were one sentence.

### 6 · `06-shop` — 0:28.6 (max 10.5 s)
> And hotspots can sell. Shoppers pick a variant, see the live price, and add to cart without ever leaving the model.

The key benefit. Short beat after "And hotspots can sell." There's room, so don't rush.

### 7 · `07-style` — 0:39.5 (max 5.1 s)
> Make them yours. Show titles instead of numbers, in your own brand color…

Rising tone at the end; it continues into line 8.

### 8 · `08-hover` — 0:44.9 (max 9.7 s)
> …and open cards on hover, so shoppers simply point to explore.

Relaxed. The pointer keeps hovering after the line ends, which is intended.

### 9 · `09-phone` — 0:55.1 (max 10.2 s)
> On phones, every card opens as a clean bottom sheet. Easy to read, easy to tap, with the same shop buttons.

### 10 · `10-admin` — 1:05.7 (max 14.5 s)
> Setting one up takes seconds. Click Add hotspot, click the spot on the model, then give it a title and a short description. No code needed.

Matches the on-screen actions; small pauses at the commas are fine. "No code needed" is a confident button.

### 11 · `11-outro` — 1:20.6 (max 9.7 s)
> Hotspots. Up to twenty per model, on the Pro and Pro Plus plans. Explain, show, and sell — right on the model. Easy 3D Viewer.

Slow down slightly. Short pauses after "Hotspots." and between "Explain, show, and sell". End warmly on the name.

## Notes

- Every claim matches the app: up to 20 hotspots per model (`MAX_HOTSPOTS`), paid plans only (Pro and Pro Plus), YouTube, Vimeo or https video files, live price and variants from `/products/<handle>.js`, and the bottom sheet on small screens.
- If you change a line, edit `tutorials/showcase/rec/narration.json` and re-run `node record.mjs && node build.mjs`. Each scene stretches to fit its line, and the cues in this script change with it, so update the table from the build output.
- Captions: `tutorials/subtitles/hotspots-showcase.srt` follows these same cues.
