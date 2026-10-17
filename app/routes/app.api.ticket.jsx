import { json } from "@remix-run/node";
import { authenticate, apiVersion } from "../shopify.server";
import prisma from "../db.server";
import { isPaidCredits, isPaidPlanName } from "../utils/planLimits";
import { stripTags } from "../utils/sanitize";

const TICKET_ENDPOINT = "https://tickets.bplugins.com/api/embed/submit";

// The ticket system validates `product` against a fixed allowlist, which it
// publishes at GET https://tickets.bplugins.com/api/embed/submit. This app's
// entry in that list is "Shopify - Video Player"; the marketing name
// "Video Player by bPlugins" is not one of the accepted values.
const TICKET_PRODUCT = "Shopify - Video Player";

/**
 * Whether this shop is on a paid plan.
 *
 * Mirrors the three-signal detection the analytics page uses, so a merchant
 * the dashboard treats as paying also reaches support as a paying customer.
 * Any one signal is enough. The one deliberate difference from analytics: it
 * accepts *any* ACTIVE subscription rather than only names starting with
 * "Pro", because the question here is "is this a paying customer", not
 * "which tier are they on".
 */
async function hasPaidLicense(shop, admin) {
  try {
    const users = await prisma.users.findMany({
      where: { shop },
      select: { cardits: true, planId: true },
    });

    // (1) Credits on the Users row — anything above the Free allowance.
    if (users.some((u) => isPaidCredits(u?.cardits))) return true;

    // (2) Plans table, matched by name.
    const planIds = users.map((u) => u?.planId).filter(Boolean);
    if (planIds.length) {
      const plans = await prisma.plans.findMany({
        where: { id: { in: planIds } },
        select: { name: true },
      });
      if (plans.some((p) => isPaidPlanName(p?.name))) {
        return true;
      }
    }
  } catch (error) {
    console.error("[ticket] plan lookup failed:", error.message);
  }

  // (3) Ask Shopify directly for a live subscription.
  try {
    const response = await admin.graphql(
      `#graphql
      query ActiveSubscriptions {
        currentAppInstallation { activeSubscriptions { name status } }
      }`,
    );
    const body = await response.json();
    const active = body?.data?.currentAppInstallation?.activeSubscriptions || [];
    if (active.some((s) => s?.status === "ACTIVE")) return true;
  } catch (error) {
    console.error("[ticket] subscription lookup failed:", error.message);
  }

  return false;
}

// Prefill values for the form: the store owner's name and the shop's contact
// email. Fetched on demand when the modal opens rather than in the dashboard
// loader, so it never lands in the TTFB of a page that may not need it.
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const response = await fetch(
      `https://${session.shop}/admin/api/${apiVersion}/shop.json`,
      {
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) return json({ name: "", email: "" });

    const { shop } = await response.json();
    return json({ name: shop?.shop_owner || "", email: shop?.email || "" });
  } catch (error) {
    console.error("[ticket] shop lookup failed:", error.message);
    return json({ name: "", email: "" });
  }
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  const body = await request.json().catch(() => ({}));
  // Plain text only: non-strings become "", tags are stripped, lengths capped.
  const clean = (value, max) =>
    typeof value === "string" ? stripTags(value).trim().slice(0, max) : "";
  const name = clean(body?.name, 100);
  const email = clean(body?.email, 254);
  const subject = clean(body?.subject, 200);
  const message = clean(body?.message, 5000);

  if (!name || !email || !subject || !message) {
    return json(
      { success: false, message: "Please fill in every field." },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(
      { success: false, message: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  // Decided server-side rather than trusted from the browser: the merchant
  // must not be able to raise a ticket that claims a licence they don't hold.
  const paidLicense = await hasPaidLicense(session.shop, admin);

  try {
    const response = await fetch(TICKET_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name,
        email,
        subject,
        message,
        product: TICKET_PRODUCT,
        hasPaidLicense: paidLicense,
        // The endpoint reports recaptchaEnabled:false, so there is no token
        // to attach — the field is still sent for payload compatibility.
        recaptchaToken: null,
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      console.error("[ticket] submit failed", response.status, data);
      return json(
        {
          success: false,
          message:
            data?.message || "Could not create the ticket. Please try again.",
        },
        { status: 502 },
      );
    }

    // { success: true, ticketNumber: 52966, message: "..." }
    return json(data);
  } catch (error) {
    console.error("[ticket] submit error:", error.message);
    return json(
      {
        success: false,
        message: "Could not reach the support system. Please try again.",
      },
      { status: 502 },
    );
  }
};
