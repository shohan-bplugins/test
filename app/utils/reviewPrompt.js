// Ask the merchant for an app review after they finish a task (e.g. saving a
// player). The server checks the store-level rules (see
// app/lib/review-prompt.server.js); this file adds Rule 7: at most one popup
// per visit. Never throws — a review prompt must never break the page.

const SESSION_KEY = "apbp-review-asked";
let askedThisVisit = false;

function alreadyAskedThisVisit() {
  if (askedThisVisit) return true;
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markAskedThisVisit() {
  askedThisVisit = true;
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // storage blocked: the in-memory flag still covers this page load
  }
}

export async function maybeAskForReview({ delayMs = 1500 } = {}) {
  try {
    if (typeof window === "undefined" || typeof shopify === "undefined") return;
    if (!shopify.reviews?.request || alreadyAskedThisVisit()) return;
    // Claim the visit up front so two quick saves can't both ask.
    markAskedThisVisit();

    // Let the "Saved" toast show first.
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const res = await fetch("/app/api/review-prompt");
    if (!res.ok) return;
    const { eligible } = await res.json();
    if (!eligible) return;

    const result = await shopify.reviews.request();
    await fetch("/app/api/review-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shown: Boolean(result?.success),
        code: result?.code || null,
      }),
    });
  } catch (error) {
    console.error("Review prompt failed:", error);
  }
}
