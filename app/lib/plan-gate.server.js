import prisma from "../db.server";

// First-run plan selection.
//
// New installs and existing Free shops only see the one-time "Choose your
// plan" screen (/app/select-plan) until they pick a plan (Free, or an approved
// paid plan).
// Paid shops (Pro / Pro Plus, or extra credits) are never gated, and the
// storefront players are not affected at all.
//
// Every read/write here is defensive: if the database client was not
// regenerated with the new field, Prisma rejects it and we fall back to the
// old behaviour (no gate) instead of breaking the app.

// Pages a gated shop may still open.
export const SELECT_PLAN_PATH = "/app/select-plan";
const OPEN_PATHS = [SELECT_PLAN_PATH, "/app/SuccessBilling"];

export const isOpenPath = (pathname = "") => {
  const path = pathname.toLowerCase().replace(/\/+$/, "");
  return OPEN_PATHS.some((p) => {
    const open = p.toLowerCase();
    return path === open || path.startsWith(`${open}/`);
  });
};

// Same test billing.server.js uses for "claims paid access" (includes shops
// given extra credits by hand), so no paying shop is ever blocked.
const hasPaidPlan = (user) =>
  Boolean(user?.planId) ||
  Boolean(user?.chargeId) ||
  Number(user?.cardits ?? 5) > 5;

// Create the shop's user record for a fresh install.
export async function createUserRecord(shop) {
  try {
    return await prisma.Users.create({
      data: { shop, cardits: 5, planSelected: false },
    });
  } catch (error) {
    // Unique clash: another request created it first.
    if (error?.code === "P2002") return prisma.Users.findUnique({ where: { shop } });
    // Older generated client without `planSelected`: create it the old way.
    console.error("Plan gate: creating user without planSelected:", error?.message);
    try {
      return await prisma.Users.create({ data: { shop, cardits: 5 } });
    } catch (fallbackError) {
      if (fallbackError?.code === "P2002") {
        return prisma.Users.findUnique({ where: { shop } });
      }
      throw fallbackError;
    }
  }
}

export async function markPlanSelected(shop) {
  try {
    await prisma.Users.updateMany({
      where: { shop },
      data: { planSelected: true },
    });
  } catch (error) {
    console.error("Plan gate: couldn't mark plan selected:", error?.message);
  }
}

// True when this shop must pick a plan before using the app. A paid plan
// approved on Shopify counts as a pick and clears the gate for good.
export async function needsPlanSelection(shop) {
  try {
    const user = await prisma.Users.findUnique({ where: { shop } });
    // No record yet = brand-new install (root creates it in parallel).
    if (!user) return true;
    // Database client generated before `planSelected` existed: the field is
    // absent from the record, so we couldn't save a choice either — don't gate.
    if (!("planSelected" in user)) return false;
    if (user.planSelected === true) return false;
    // Paid shops (Pro / Pro Plus) are never gated; remember it.
    if (hasPaidPlan(user)) {
      await markPlanSelected(shop);
      return false;
    }
    // New installs and existing Free shops pick a plan once.
    return true;
  } catch (error) {
    console.error("Plan gate: lookup failed, not gating:", error?.message);
    return false;
  }
}
