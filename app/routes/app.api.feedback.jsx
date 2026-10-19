import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { stripTags } from "../utils/sanitize";

// Feedback is forwarded to the CRM as-is, so every string is reduced to plain
// text and capped, and the structure is bounded.
function cleanFeedback(value, depth = 0) {
  if (depth > 6) return null;
  if (typeof value === "string") return stripTags(value).slice(0, 2000);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => cleanFeedback(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      out[k] = cleanFeedback(v, depth + 1);
    }
    return out;
  }
  return null;
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const raw = await request.json().catch(() => ({}));
  let body = cleanFeedback(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {});

  const shop = session?.shop; // get shop from session
  // The shop always comes from the session, never from the request body.
  body.shop = shop;

  const data = await prisma.Users.findUnique({
    where: { shop },
    select: {
      id: true,
      planId: true,
      shop: true,
      chargeId: true,
      cardits: true,
    },
  });
  let plan = null;
  if (data?.planId) {
    plan = await prisma.Plans.findUnique({
      where: { id: data?.planId },
      select: {
        id: true,
        name: true,
      },
    });
  }

  body.plan = plan?.name || "Free";
  body.chargeId = data?.chargeId || null;
  body.credits = data?.cardits || 0;

  const res = await fetch(
    "https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (res.ok) {
    return json({ status: "ok" });
  } else {
    return json({ error: "Webhook failed" }, { status: 500 });
  }
};
