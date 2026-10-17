import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  isReviewTrigger,
  recordReviewPrompt,
  reviewDebugAllowed,
  reviewRuleReport,
} from "~/lib/review-prompt.server";

/**
 * The debug panel's rule checklist. Development only, or REVIEW_DEBUG=1: on a
 * live server this answers 404 and reveals nothing.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (!reviewDebugAllowed()) {
    throw new Response("Not found", { status: 404 });
  }
  const report = await reviewRuleReport(admin, session?.shop ?? "");
  console.info(
    "[review debug] rules for",
    session?.shop,
    report.rules.map((r) => `${r.pass ? "PASS" : "FAIL"} ${r.rule}: ${r.detail}`),
  );
  return Response.json(report);
};

/**
 * Where components/ReviewPrompt.tsx reports what Shopify's review modal
 * answered, so the next ask respects the cooldown and stops once reviewed.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const trigger = form.get("trigger");
  await recordReviewPrompt(session?.shop ?? "", {
    success: form.get("success") === "1",
    code: String(form.get("code") ?? "") || undefined,
    trigger: isReviewTrigger(trigger) ? trigger : undefined,
  });
  return { ok: true };
};
