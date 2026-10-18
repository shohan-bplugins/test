import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { getPlanLimitForShop } from "~/lib/billing.server";
import { FREE_PLAN_NAME } from "~/lib/billing-constants";

/**
 * bPlugins' ticket intake.
 *
 * Posted to from this route rather than from the browser. Two reasons: a
 * cross-origin POST from the admin iframe depends on the ticket host sending
 * CORS headers back to whatever domain this app is on — a dependency on someone
 * else's config that fails silently — and the plan a merchant is on is
 * something this app *knows*, so it should not be a claim the browser makes.
 */
const TICKET_ENDPOINT = "https://tickets.bplugins.com/api/embed/submit";

/** Identifies this app in the shared bPlugins ticket queue. */
const SUPPORT_PRODUCT = "Shopify - 3D Viewer";

export type SupportPrefill = {
  name: string;
  email: string;
};

/**
 * Who to address the ticket from.
 *
 * App Bridge's `shopify.user()` is the better answer when it has one — it names
 * the staff member actually asking — but Shopify only exposes those details to
 * sufficiently privileged users, so it is often empty. The shop owner and
 * contact email are always available and are the right fallback.
 *
 * The plan is deliberately *not* returned. It is not a question the merchant is
 * asked any more; the action reads it from this app's own records when the
 * ticket is sent.
 */
export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<SupportPrefill> => {
  const { admin } = await authenticate.admin(request);

  try {
    const res = await admin.graphql(
      `#graphql
        query SupportPrefill {
          shop {
            name
            email
            contactEmail
            shopOwnerName
          }
        }`,
    );
    const json: any = await res.json();
    const shopNode = json?.data?.shop ?? {};
    return {
      name: shopNode.shopOwnerName ?? shopNode.name ?? "",
      email: shopNode.contactEmail ?? shopNode.email ?? "",
    };
  } catch (err) {
    console.error("[api.support] prefill lookup failed:", err);
    // An empty prefill is a fine outcome — the merchant types their own.
    return { name: "", email: "" };
  }
};

type SupportResult =
  | { ok: true; ticketNumber: number | null; message: string }
  | { ok: false; error: string };

/** What the intake returns: { success, ticketNumber, message }. */
type TicketResponse = {
  success?: boolean;
  ticketNumber?: number;
  message?: string;
};

function isEmail(value: string): boolean {
  // Deliberately loose. The ticket system is the real validator; this only
  // catches the obvious typo before a round trip.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<SupportResult> => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();

  // Read from this app's own billing records rather than asked for. The
  // merchant should not have to know which plan they are on to file a ticket,
  // and support should not be acting on a self-reported answer when the truth
  // is one query away.
  const plan = await getPlanLimitForShop(shop);
  const hasPaidLicense = plan.planName !== FREE_PLAN_NAME;

  if (!name) return { ok: false, error: "Please enter your name." };
  if (!isEmail(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (!subject) return { ok: false, error: "Please enter a subject." };
  if (!message) return { ok: false, error: "Please enter a message." };

  try {
    const res = await fetch(TICKET_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        name,
        email,
        product: SUPPORT_PRODUCT,
        hasPaidLicense,
        subject,
        // The shop domain is appended rather than asked for: it is the single
        // most useful thing for whoever picks the ticket up, and a merchant
        // should not have to know it or type it correctly.
        message: `${message}\n\n---\nShop: ${shop || "unknown"}`,
        // The form is behind Shopify's authenticated admin session, so there is
        // no anonymous traffic to screen. The field is sent because the API
        // expects it.
        recaptchaToken: null,
      }),
    });

    /*
     * The status alone is not the answer. The intake replies
     * { success, ticketNumber, message }, and it can report success: false on a
     * 200 — treating any 2xx as sent would tell a merchant their ticket was
     * filed when it was not, which is the worst possible failure here.
     */
    const payload = (await res.json().catch(() => null)) as
      | TicketResponse
      | null;

    if (!res.ok || !payload?.success) {
      console.error(
        `[api.support] ticket submit failed (HTTP ${res.status}):`,
        payload ?? "(unparseable body)",
      );
      return {
        ok: false,
        // The intake's own wording when it gave one — it knows why it refused
        // far better than this route does.
        error:
          payload?.message ??
          "We couldn't send your ticket just now. Please try again, or email support directly.",
      };
    }

    return {
      ok: true,
      ticketNumber: payload.ticketNumber ?? null,
      message:
        payload.message ?? "Your support ticket has been created successfully.",
    };
  } catch (err) {
    console.error("[api.support] ticket submit threw:", err);
    return {
      ok: false,
      error:
        "We couldn't reach the support system. Please check your connection and try again.",
    };
  }
};
