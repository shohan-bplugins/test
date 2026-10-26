// Shared browser harness: serves ../site on a fake https origin so the widget's
// https-only checks pass, and mocks the two Shopify endpoints hotspots call.
import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SITE = path.resolve(HERE, "../site");
export const WORK = path.resolve(HERE, "../.work");
export const ORIGIN = "https://aurora-supply.test";
const THREE = path.resolve(HERE, "../../../node_modules/three/build/three.module.js");

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".glb": "model/gltf-binary", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".mp4": "video/mp4",
};

// Live product data the card refreshes from when it opens.
const PRODUCTS = {
  "lace-kit": {
    options: ["Color"],
    variants: [
      { id: 5101, option1: "Ember", price: 900, available: true },
      { id: 5102, option1: "Glacier", price: 1100, available: true },
    ],
  },
};

export async function launch({ width = 1920, height = 1080 } = {}) {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--hide-scrollbars"],
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !/Multiple instances|KHR_texture|ERR_NAME_NOT_RESOLVED/.test(m.text()))
      console.log("  [page]", m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

  await context.route(`${ORIGIN}/**`, async (route) => {
    const p = new URL(route.request().url()).pathname;
    const m = p.match(/^\/products\/([\w-]+)\.js$/);
    if (m && PRODUCTS[m[1]]) {
      await new Promise((r) => setTimeout(r, 250));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(PRODUCTS[m[1]]) });
    }
    if (p === "/cart/add.js") {
      await new Promise((r) => setTimeout(r, 600));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) });
    }
    if (p === "/three.module.js") {
      return route.fulfill({ contentType: "text/javascript", body: await fs.readFile(THREE) });
    }
    const file = path.join(SITE, p === "/" ? "index.html" : p);
    try {
      const body = await fs.readFile(file);
      return route.fulfill({ contentType: TYPES[path.extname(file)] ?? "application/octet-stream", body });
    } catch {
      return route.fulfill({ status: 404, body: "not found" });
    }
  });
  return { browser, context, page };
}
