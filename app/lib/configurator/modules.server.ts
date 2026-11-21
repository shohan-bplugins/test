import { fetchActiveSubscriptionCached } from "~/lib/billing.server";
import { FREE_PLAN_NAME } from "~/lib/billing-constants";
import { planIncludes } from "./constants";
import { MODULE_IDS, type ModuleFlags } from "./options";

type Admin = Parameters<typeof fetchActiveSubscriptionCached>[0];

/**
 * The configurator modules this shop's plan unlocks. Read from Shopify's live
 * subscription (cached), like hotspotsAllowed, so the decision is made on the
 * server and a lower plan can't enable a module by posting it.
 *
 * The subscription's name is the plan title (app.pricing.tsx creates it with
 * `name: plan.title`), and titles equal plan names.
 */
export async function allowedModules(
  admin: Admin,
  shop: string,
): Promise<ModuleFlags> {
  const subscription = await fetchActiveSubscriptionCached(admin, shop).catch(
    () => null,
  );
  const plan =
    subscription?.status === "active" ? subscription.name : FREE_PLAN_NAME;
  return Object.fromEntries(
    MODULE_IDS.map((id) => [id, planIncludes(plan, id)]),
  ) as ModuleFlags;
}

/**
 * Every configurator module is free in the Customize editor and on the
 * storefront. Flip to false to bring back the Growth / Advance gating in
 * MODULE_MIN_PLAN (constants.ts) — the editor, its save action and the
 * published storefront payload all read modules through this function.
 */
export const CUSTOMIZER_ALL_FREE = true;

export async function configuratorModules(
  admin: Admin,
  shop: string,
): Promise<ModuleFlags> {
  if (CUSTOMIZER_ALL_FREE) {
    return Object.fromEntries(MODULE_IDS.map((id) => [id, true])) as ModuleFlags;
  }
  return allowedModules(admin, shop);
}

/** Plan-allowed AND merchant-enabled. A missing merchant setting means on. */
export function effectiveModules(
  allowed: ModuleFlags,
  enabled: ModuleFlags | null | undefined,
): ModuleFlags {
  return Object.fromEntries(
    MODULE_IDS.map((id) => [id, !!allowed[id] && enabled?.[id] !== false]),
  ) as ModuleFlags;
}
