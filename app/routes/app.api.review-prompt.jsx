import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  getReviewEligibility,
  recordReviewRequest,
} from "../lib/review-prompt.server";

// GET: may we ask this store for a review right now?
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { eligible } = await getReviewEligibility(session.shop);
  return json({ eligible });
};

// POST: record what happened when we asked ({ shown, code }).
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  let body = null;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, { status: 400 });
  }
  await recordReviewRequest(session.shop, {
    shown: body?.shown === true,
    code: typeof body?.code === "string" ? body.code : null,
  });
  return json({ ok: true });
};
