import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { loadShopPlan } from "../lib/analytics.server";
import { validateSupportTicket } from "../components/SupportForm/validateSupportTicket";

const TICKETS_URL = "https://tickets.bplugins.com/api/embed/submit";
const PRODUCT_NAME = "Shopify - Audio Player";

// Proxies the SupportForm to the bPlugins ticket system. Done server-side so
// the browser never hits CORS, and so the paid-license flag comes from the
// shop's real plan instead of whatever the client sends.
// Merchant name/email to pre-fill the support form (loaded when it opens).
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  try {
    const res = await admin.graphql(`{ shop { name email shopOwnerName } }`);
    const shop = (await res.json())?.data?.shop ?? {};
    return json({
      name: shop.shopOwnerName || shop.name || "",
      email: shop.email || "",
    });
  } catch {
    return json({ name: "", email: "" });
  }
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return json(
      { success: false, message: "Invalid request." },
      { status: 400 },
    );
  }

  const fields = {
    name: String(body?.name || "").trim(),
    email: String(body?.email || "").trim(),
    subject: String(body?.subject || "").trim(),
    message: String(body?.message || "").trim(),
  };
  const errors = validateSupportTicket(fields);
  if (Object.keys(errors).length) {
    return json(
      { success: false, errors, message: "Please fix the highlighted fields." },
      { status: 400 },
    );
  }

  const { isFree } = await loadShopPlan(session.shop);

  try {
    const res = await fetch(TICKETS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ...fields,
        product: PRODUCT_NAME,
        hasPaidLicense: !isFree,
        recaptchaToken: null,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      return json(
        {
          success: false,
          message:
            data?.message ||
            "We couldn't create your ticket right now. Please try again.",
        },
        { status: 502 },
      );
    }

    return json({
      success: true,
      ticketNumber: data.ticketNumber,
      message: data.message,
    });
  } catch (e) {
    console.error("Support ticket submit failed:", e.message);
    return json(
      {
        success: false,
        message:
          "We couldn't reach the support system. Please try again, or email support@bplugins.com.",
      },
      { status: 502 },
    );
  }
}
