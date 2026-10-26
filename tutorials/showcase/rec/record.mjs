// Drives site/show.html through the whole showcase and records it.
//   node record.mjs            -> ../.work/raw.mp4 + ../.work/beats.json
// Each scene ("beat") lasts at least as long as its narration line in
// narration.json, plus PAD, so a voiceover recorded from the script fits.
import { launch, ORIGIN, WORK } from "./harness.mjs";
import { startRecording } from "./recorder.mjs";
import fs from "node:fs/promises";

const PAD = 1.1;
const NARR = Object.fromEntries(JSON.parse(await fs.readFile("narration.json", "utf8")).map((l) => [l.id, l]));
const A = JSON.parse(await fs.readFile("anchors.json", "utf8"));
const C = JSON.parse(await fs.readFile("chair-anchors.json", "utf8"));
const at = (a, focus) => ({ meshIndex: a.meshIndex, faceIndex: a.faceIndex, weights: a.weights, position: a.position, focus });

const SHOE_HOTSPOTS = [
  { id: "knit", title: "Breathable knit upper", description: "Engineered mesh that moves air where your foot runs hottest. 40% recycled yarn.",
    linkLabel: "See the materials", linkUrl: "/pages/materials", ...at(A[1], [-45, 18, 10]) },
  { id: "foam", title: "Recycled FOAM midsole", description: "Springy, plant-based foam — 12% lighter than last season.",
    image: { url: `${ORIGIN}/foam.jpg`, alt: "Close-up of the foam midsole" }, ...at(A[0], [-15, 6, 9]) },
  { id: "heel", title: "Heel pull tab", description: "Slip on in a second, even with the laces tied.",
    video: { kind: "file", id: "", url: `${ORIGIN}/heel-clip.mp4` }, ...at(A[2], [150, 15, 8]) },
  { id: "laces", title: "Reflective laces", description: "Visible from 150 m in headlights. Swap the color any time.",
    product: { id: "9001", variantId: "5101", handle: "lace-kit", title: "Reflective lace kit", imageUrl: `${ORIGIN}/laces.jpg`, price: "9.00", addToCart: true, buyNow: true },
    ...at(A[3], [-25, 38, 8]) },
];
const SHOE_CFG = { autoRotate: true, yaw: -30, pitch: 10, hotspots: SHOE_HOTSPOTS, hotspotColor: "#2a78d6" };

const CHAIR_HOTSPOTS = [
  { id: "back", title: "Hand-tufted back", description: "Buttoned by hand, so the cushion keeps its shape for years.", ...at(C[0], [-20, 10, 6]) },
  { id: "seat", title: "Sheen velvet", description: "A soft sheen that shifts with the light. Stain-guarded.", ...at(C[1], [-30, 20, 6]) },
  { id: "legs", title: "Solid oak legs", description: "Kiln-dried European oak with a smoked oil finish.", ...at(C[2], [-40, 5, 6]) },
];
const CHAIR_CFG = { autoRotate: false, yaw: -30, pitch: 10, hotspots: CHAIR_HOTSPOTS, hotspotColor: "#0f6e5f", hotspotLabel: "title", hotspotTrigger: "hover" };

const { browser, page } = await launch();
await page.goto(ORIGIN + "/show.html");
await page.waitForFunction(() => window.show?.ready);
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

/* ---- beats: scene start times, and a floor on each scene's length ---- */
let REC0 = 0;
const beats = [];
const now = () => (Date.now() - REC0) / 1000;
async function beat(id) {
  const prev = beats[beats.length - 1];
  if (prev) {
    const min = (NARR[prev.id]?.sec ?? 0) + PAD;
    const left = min - (now() - prev.start);
    if (left > 0) await wait(left * 1000);
    prev.end = now();
  }
  if (!id) return;
  beats.push({ id, start: now() });
  console.log(`  ${now().toFixed(1).padStart(5)}s  ${id}`);
}

/* ---- pointer: eased glide to a (possibly moving) target ---- */
let pos = { x: 2000, y: 700 };
async function glide(target, ms = 900) {
  const from = { ...pos };
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const to = typeof target === "function" ? await target() : target;
    pos = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
    await page.mouse.move(pos.x, pos.y);
    await wait(10);
  }
}
async function click() {
  await page.mouse.down();
  await wait(90);
  await page.mouse.up();
}
const center = (sel, i = 0) => async () =>
  ev(([sel, i]) => {
    const r = document.querySelectorAll(sel)[i].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, [sel, i]);
const pin = (i) => center(".e3d-hotspot-pin", i);
const openCard = (sel) => center(`.e3d-hotspot.selected ${sel}`);

/* ---- preload the first viewer behind the intro card ---- */
await ev(() => show.intro());
await ev((cfg) => show.mountViewer("#viewerSlot", { model: "MaterialsVariantsShoe.glb", cfg, height: 820, bg: "#f1ede6" }), SHOE_CFG);
await page.waitForFunction(() => document.querySelectorAll(".e3d-hotspot-pin").length === 4);
await ev(() => show.scene(""));
await ev(() => show.intro()); // restart its entrance animation for the recording
await page.mouse.move(pos.x, pos.y);

const rec = await startRecording(page, `${WORK}/frames`);
REC0 = Date.now();

await beat("intro");
await wait(1500);

/* ---- pins ride along with the model ---- */
await beat("pins");
await ev(() => show.wipe(true));
await ev(() => show.scene(""));
await ev(() => show.wipe(false));
await ev(() => show.caption("Hotspots", "Numbered pins stay locked to the model as it turns."));
await wait(3200);

/* ---- click → camera turns, card opens ---- */
await beat("click");
await ev(() => show.caption("Click", "One click turns the camera to the detail and opens its card."));
await glide(pin(0), 1100);
await click();
await wait(2500);

/* ---- image ---- */
await beat("photo");
await ev(() => show.caption("Media", "Add a photo…"));
await glide(pin(1), 900);
await click();
await wait(2300);

/* ---- video ---- */
await beat("video");
await ev(() => show.caption("Media", "…or a video — YouTube, Vimeo or your own file."));
await glide(pin(2), 900);
await click();
await wait(1400);
await glide(openCard(".e3d-hotspot-play"), 700);
await click();
await wait(2800);

/* ---- shop from the model ---- */
await beat("shop");
await ev(() => show.caption("Shop", "Sell right from the model — live price, variants, Add to cart."));
await glide(pin(3), 900);
await click();
await wait(1600);
await glide(openCard(".e3d-hotspot-option select"), 700);
await wait(250);
await page.locator(".e3d-hotspot.selected .e3d-hotspot-option select").selectOption("Glacier");
await wait(1000);
await glide(openCard(".e3d-hotspot-btn--primary"), 650);
await click();
await wait(1400);
await glide(center("#cartCount"), 900);
await wait(900);

/* ---- title pills, brand color ---- */
await ev(() => show.caption(null));
await ev(() => show.wipe(true));
await ev(() => show.product("Ola Lounge Chair", "$849.00", "Low, wide and made for long Sundays. Hand-tufted sheen velvet on a solid oak frame.",
  { crumb: "Living / Lounge chairs", color: "Rust", swatches: ["#e04a2a", "#2f4a46", "#c9b79c"], sizeLabel: "Leg finish", sizes: ["Smoked oak", "Natural oak"] }));
await ev((cfg) => show.mountViewer("#viewerSlot", { model: "SheenChair.glb", cfg, height: 820, bg: "#f1ede6" }), CHAIR_CFG);
await page.waitForFunction(() => document.querySelectorAll(".e3d-hotspot--title .e3d-hotspot-pin").length === 3);
await wait(300);
await ev(() => show.wipe(false));
await beat("style");
await ev(() => show.caption("Style", "Show titles instead of numbers, in your brand color."));
await glide({ x: 1500, y: 860 }, 900);

/* ---- hover ---- */
await beat("hover");
await ev(() => show.caption("Hover", "…and open cards on hover, with no click at all."));
for (const i of [0, 1, 2]) {
  await glide(pin(i), 800);
  await wait(1500);
}
await glide({ x: 1500, y: 860 }, 700);

/* ---- phone: bottom sheet ---- */
await ev(() => show.caption(null));
await ev(() => show.wipe(true));
await ev((cfg) => { window.mobileCfg = cfg; show.phone(); show.hideCursor(true); }, SHOE_CFG);
await page.waitForFunction(() => {
  const w = document.getElementById("phoneFrame")?.contentWindow;
  return w && w.__v3d && w.__v3d[0] && w.__v3d[0].initialized && w.document.querySelectorAll(".e3d-hotspot-pin").length === 4;
}, null, { timeout: 60000 });
await wait(300);
await ev(() => show.wipe(false));
await beat("phone");
await wait(1200);
const frame = page.frameLocator("#phoneFrame");
const tap = async (sel, i = 0) => {
  const box = await frame.locator(sel).nth(i).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await ev(([x, y]) => show.ring(x, y), [x, y]);
  await page.mouse.click(x, y);
};
await tap(".e3d-hotspot-pin", 1);
await wait(3000);
await tap(".e3d-hotspot-sheet-close");
await wait(900);
await tap(".e3d-hotspot-pin", 3);
await wait(3400);
await tap(".e3d-hotspot-sheet-close");
await wait(500);

/* ---- merchant: place a hotspot ---- */
await ev(() => show.wipe(true));
await ev(() => { show.hideCursor(false); show.admin(); });
await ev((cfg) => show.mountViewer("#admViewer", { model: "MaterialsVariantsShoe.glb", cfg, height: 700, bg: "#f4f4f4" }),
  { ...SHOE_CFG, autoRotate: false, yaw: -20, pitch: 12 });
await page.waitForFunction(() => document.querySelectorAll("#admViewer .e3d-hotspot-pin").length === 4);
await wait(300);
pos = { x: 1500, y: 900 };
await page.mouse.move(pos.x, pos.y);
await ev(() => show.wipe(false));
await beat("admin");
await ev(() => show.caption("Set up", "Adding one takes seconds — no code."));
await wait(500);
await glide(center("#admAdd"), 900);
await click();
await ev(() => show.adminPlacing(true));
await wait(1200);
const toe = await ev(() => {
  const r = document.querySelector("#admViewer").getBoundingClientRect();
  return { x: r.x + r.width * 0.735, y: r.y + r.height * 0.6 };
});
await glide(toe, 1000);
await wait(200);
await click();
const anchor = await ev(([x, y]) => show.pick(x, y), [toe.x, toe.y]);
if (!anchor) throw new Error("toe pick missed the model");
await ev((a) => { show.addLivePin(a, { n: 5, title: "Hotspot 5", color: "#2a78d6" }); show.adminPlacing(false); show.adminNewItem(); }, anchor);
await wait(600);
await glide(center("#admTitleIn"), 700);
await click();
await ev(() => show.adminType("title", "Rubber toe guard"));
await wait(200);
await glide(center("#admDescIn"), 500);
await click();
await ev(() => show.adminType("desc", "Scuff-proof wrap for trail days.", 30));
await wait(300);
await glide(center("#admViewer .e3d-hotspot-pin", 4), 900);
await click();
await wait(2300);
await glide(center("#admSave"), 900);
await click();
await wait(700);

/* ---- outro ---- */
await ev(() => show.caption(null));
await ev(() => show.wipe(true));
await ev(() => { show.hideCursor(true); show.outro(); });
await ev(() => show.wipe(false));
await beat("outro");
await beat(null);
await wait(900);
await ev(() => show.wipe(true));
await wait(400);
const total = now();

await rec.stop(`${WORK}/raw.mp4`, 60);
await browser.close();
await fs.writeFile(`${WORK}/beats.json`, JSON.stringify({ total, beats }, null, 2));
console.log(`  total ${total.toFixed(1)}s -> ${WORK}/raw.mp4`);
