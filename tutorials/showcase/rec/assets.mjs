// Card media, rendered from the model itself: foam.jpg, laces.jpg, heel-clip.mp4.
import { launch, ORIGIN, SITE, WORK } from "./harness.mjs";
import { startRecording } from "./recorder.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
const exec = promisify(execFile);
await fs.mkdir(WORK, { recursive: true });
const BARE = { showZoomButtons: false, showFullscreenButton: false, webAR: false, sceneViewer: false, quickLook: false };
const { browser, page } = await launch();
await page.goto(ORIGIN + "/show.html");
await page.waitForFunction(() => window.show?.ready);
const mount = (cfg, bg) => page.evaluate(([cfg, bg]) => show.mountViewer("#viewerSlot", { model: "MaterialsVariantsShoe.glb", cfg, height: 820, bg }), [cfg, bg]);
const hideUi = () => page.addStyleTag({ content: ".viewer-3d [class*=control], .viewer-3d button{display:none!important}" });
await mount({ autoRotate: false, ...BARE }, "#f1ede6");
await hideUi();
const r = await page.evaluate(() => show.rect("#viewerSlot"));
const shot = async (pose, path, [x, y, w, h]) => {
  await page.evaluate((p) => show.setPose(...p), pose);
  await page.waitForTimeout(400);
  await page.screenshot({ path, clip: { x: r.x + x, y: r.y + y, width: w, height: h } });
};
await shot([0, 0, 25], `${WORK}/foam.png`, [0, 50, 712, 400]);
await shot([-10, 50, 26], `${WORK}/laces.png`, [306, 160, 500, 500]);
await mount({ autoRotate: true, yaw: -40, pitch: 8, initialZoom: 8, ...BARE }, "#1b1e26");
await hideUi();
await page.waitForTimeout(500);
const rec = await startRecording(page, `${WORK}/frames-clip`);
await page.waitForTimeout(6500);
await rec.stop(`${WORK}/clip-raw.mp4`, 30);
await browser.close();
const q = ["-loglevel", "error", "-y"];
await exec("ffmpeg", [...q, "-i", `${WORK}/foam.png`, "-q:v", "3", `${SITE}/foam.jpg`]);
await exec("ffmpeg", [...q, "-i", `${WORK}/laces.png`, "-vf", "scale=240:240", "-q:v", "3", `${SITE}/laces.jpg`]);
const ch = Math.round((r.w * 9) / 16 / 2) * 2;
await exec("ffmpeg", [...q, "-i", `${WORK}/clip-raw.mp4`, "-vf", `crop=${Math.round(r.w)}:${ch}:${Math.round(r.x)}:${Math.round(r.y + (r.h - ch) / 2)},scale=640:360,format=yuv420p`,
  "-c:v", "libx264", "-crf", "22", "-an", "-movflags", "+faststart", `${SITE}/heel-clip.mp4`]);
console.log("  assets ok");
