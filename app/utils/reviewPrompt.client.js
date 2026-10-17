import { appBridge } from "./appBridge";

/**
 * Ask for an App Store review after the merchant finishes a task (saving a
 * player, assigning a product video …). Safe to call on every success: it does
 * nothing unless the server-side rules in app/routes/app.api.review.jsx pass,
 * and only one popup is attempted per visit (rule 7).
 *
 * The popup itself is Shopify's own review modal (shopify.reviews.request),
 * so it never looks out of place and Shopify's limits always apply.
 */

const VISIT_KEY = "svp-review-asked";
// Let the "Saved" toast land before the modal appears.
const DELAY_MS = 1500;

let askedThisVisit = false;

function alreadyAskedThisVisit() {
  if (askedThisVisit) return true;
  try {
    return window.sessionStorage.getItem(VISIT_KEY) === "1";
  } catch {
    return false;
  }
}

function markAskedThisVisit() {
  askedThisVisit = true;
  try {
    window.sessionStorage.setItem(VISIT_KEY, "1");
  } catch {
    // Storage blocked: the in-memory flag still covers this page load.
  }
}

export function requestReviewAfterTask() {
  if (typeof window === "undefined" || alreadyAskedThisVisit()) return;

  setTimeout(async () => {
    try {
      if (alreadyAskedThisVisit()) return;
      const shopify = appBridge();
      if (!shopify?.reviews?.request) return;

      const res = await fetch("/app/api/review");
      if (!res.ok) return;
      const { eligible } = await res.json();
      if (!eligible) return;

      markAskedThisVisit();
      const result = await shopify.reviews.request();

      await fetch("/app/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: result?.code }),
      });
    } catch (error) {
      // A review prompt must never get in the merchant's way.
      console.warn("[review] prompt skipped:", error);
    }
  }, DELAY_MS);
}
