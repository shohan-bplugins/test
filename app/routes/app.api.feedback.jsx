import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { truncate } from "../lib/request-guards.server";

const MAX_FIELD_LENGTH = 5000;
const MAX_DEPTH = 5;

// Caps every string in the (client-supplied) feedback payload without changing
// its structure, so the CRM webhook keeps receiving the same keys.
function capStrings(value, depth = 0) {
  if (typeof value === "string") return truncate(value, MAX_FIELD_LENGTH);
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => capStrings(v, depth + 1));
  }
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = capStrings(v, depth + 1);
  }
  return out;
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    body = capStrings(body);

    const shop = session?.shop; // get shop from session
    // Never trust a client-supplied shop; always report the authenticated one.
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
  } catch (error) {
    console.error("Error in api.feedback action:", error);
    return json({ error: "Webhook failed" }, { status: 500 });
  }
};
