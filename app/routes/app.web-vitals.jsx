import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Receives the Core Web Vitals App Bridge measures in the merchant's admin
// (forwarded by shopify.webVitals.onReport in app.jsx) and stores them.
// The shop comes from the session token, never from the request body.

// [good, poor] thresholds, from web.dev.
const THRESHOLDS = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

const rate = (name, value) => {
  const [good, poor] = THRESHOLDS[name];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
};

// Group pages by route: "/app/customize/6650…/single-audio" → "/app/customize/:id/single-audio".
const normalizePath = (path) =>
  path
    .split("?")[0]
    .split("/")
    .map((seg) => (/^([0-9a-f]{24}|\d+)$/i.test(seg) ? ":id" : seg))
    .join("/");

const str = (v, max) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const path = normalizePath(str(body?.path, 200) || "/");
  const appLoadId = str(body?.appLoadId, 100);
  const userId = str(body?.userId, 100);
  const metrics = (Array.isArray(body?.metrics) ? body.metrics : [])
    .slice(0, 10)
    .map((m) => ({
      name: String(m?.name || "").toUpperCase(),
      value: Number(m?.value),
      metricId: str(m?.id, 100),
    }))
    .filter(
      (m) =>
        THRESHOLDS[m.name] &&
        Number.isFinite(m.value) &&
        m.value >= 0 &&
        m.metricId,
    );

  try {
    await Promise.all(
      metrics.map(({ name, value, metricId }) => {
        const fields = { path, name, value, rating: rate(name, value) };
        return prisma.webVital.upsert({
          where: { shop_metricId: { shop: session.shop, metricId } },
          create: {
            ...fields,
            shop: session.shop,
            metricId,
            appLoadId,
            userId,
          },
          update: fields,
        });
      }),
    );
  } catch (e) {
    // Losing a metric is fine; failing the merchant's page is not.
    console.error("Web Vitals save failed:", e.message);
  }

  return new Response(null, { status: 204 });
}
