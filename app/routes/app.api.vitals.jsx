// Collector for the Core Web Vitals reported by app/utils/webVitals.client.js.
//
// Authenticated like any other admin route: App Bridge attaches the session
// token to the same-origin fetch, so a report can only be written for the shop
// that is actually signed in.

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const METRICS = new Set(["LCP", "CLS", "INP", "TTFB", "FCP"]);

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  try {
    const b = await request.json();

    // Reject anything that isn't one of the five metrics rather than letting
    // arbitrary rows accumulate.
    if (!METRICS.has(b?.metric) || typeof b?.value !== "number") {
      return new Response(null, { status: 204 });
    }

    await prisma.webVital.create({
      data: {
        shop: session.shop,
        metric: b.metric,
        value: b.value,
        rating: typeof b.rating === "string" ? b.rating.slice(0, 20) : null,
        // Keep the path bounded — it is a route, not a URL with a query string.
        path: typeof b.path === "string" ? b.path.slice(0, 200) : null,
        navType: typeof b.navType === "string" ? b.navType.slice(0, 30) : null,
        ttfb: numOrNull(b.ttfb),
        resourceLoadDelay: numOrNull(b.resourceLoadDelay),
        resourceLoadDuration: numOrNull(b.resourceLoadDuration),
        elementRenderDelay: numOrNull(b.elementRenderDelay),
        target: typeof b.target === "string" ? b.target.slice(0, 300) : null,
      },
    });
  } catch {
    // A dropped metric is not worth a 500 on a page that is already unloading.
  }

  return new Response(null, { status: 204 });
};

function numOrNull(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// Nothing to render; a GET here is not meaningful.
export const loader = () => new Response(null, { status: 405 });
