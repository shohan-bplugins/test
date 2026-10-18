import type { Plan } from "@prisma/client";
import prisma from "../db.server";
import {
  appUserCacheGeneration,
  getCachedAppUser,
  storeAppUser,
} from "~/lib/app-user-cache.server";
import { createShopCache, SHOP_CACHE_TTL_MS } from "~/lib/shop-cache.server";
import {
  ADVANCE_PLAN_NAME,
  FREE_MODEL_LIMIT,
  FREE_PLAN_NAME,
  FREE_PRODUCT_LIMIT,
  GROWTH_PLAN_NAME,
  STARTER_PLAN_NAME,
  UNLIMITED,
} from "./billing-constants";

export {
  ADVANCE_PLAN_NAME,
  FREE_PLAN_NAME,
  GROWTH_PLAN_NAME,
  STARTER_PLAN_NAME,
};

type SeedPlan = {
  title: string;
  name: string;
  description: string;
  features: string[];
  price: string;
  currencyCode: string;
  trialDays: string;
  modelLimit: number;
  productLimit: number;
};

const SEED_PLANS: SeedPlan[] = [
  {
    title: "Free",
    name: FREE_PLAN_NAME,
    description: "Get started with interactive 3D models on your store.",
    features: [
      "3 products with a 3D model",
      "3 models in your library",
      "1 model per product",
      "Every viewer feature included",
      "Standard email support",
    ],
    price: "0",
    currencyCode: "USD",
    trialDays: "0",
    modelLimit: FREE_MODEL_LIMIT,
    productLimit: FREE_PRODUCT_LIMIT,
  },
  {
    title: "Starter",
    name: STARTER_PLAN_NAME,
    description: "For small catalogs ready to show more products in 3D.",
    features: [
      "15 products with a 3D model",
      "15 models in your library",
      "1 model per product",
      "Every viewer feature included",
      "Priority email support",
    ],
    price: "8.88",
    currencyCode: "USD",
    trialDays: "7",
    modelLimit: 15,
    productLimit: 15,
  },
  {
    title: "Growth",
    name: GROWTH_PLAN_NAME,
    description: "For growing stores rolling 3D out across the catalog.",
    features: [
      "100 products with a 3D model",
      "100 models in your library",
      "1 model per product",
      "Every viewer feature included",
      "Priority email support",
    ],
    price: "18.88",
    currencyCode: "USD",
    trialDays: "7",
    modelLimit: 100,
    productLimit: 100,
  },
  {
    title: "Advance",
    name: ADVANCE_PLAN_NAME,
    description: "For high-volume catalogs with no caps.",
    features: [
      "Unlimited products with a 3D model",
      "Unlimited models in your library",
      "1 model per product",
      "Every viewer feature included",
      "Premium priority support",
    ],
    price: "35.88",
    currencyCode: "USD",
    trialDays: "7",
    modelLimit: UNLIMITED,
    productLimit: UNLIMITED,
  },
];

const SEED_PLAN_NAMES = SEED_PLANS.map((p) => p.name);

// Seeding is deploy-time work that was running as request-time work: every
// loader that touched billing called ensurePlans(), and getOrCreateUser() called
// it again underneath, so a dashboard load paid for two full passes of four
// sequential upserts plus a stale scan — measured at ~3.4s per pass against a
// remote Atlas cluster, before the page fetched anything a merchant can see.
//
// The plan rows can only change when SEED_PLANS changes, which means a deploy,
// which means a new process: memoising the promise is enough to make this
// once-per-process, and the upserts now go out together instead of in series.
// A failed attempt clears the memo so a transient DB error doesn't leave the
// process convinced it has seeded.
let plansSeeded: Promise<void> | null = null;

export async function ensurePlans(): Promise<void> {
  if (!plansSeeded) {
    plansSeeded = seedPlans().catch((err) => {
      plansSeeded = null;
      throw err;
    });
  }
  return plansSeeded;
}

async function seedPlans(): Promise<void> {
  // Read first, write only what differs. Four unconditional upserts cost ~3.1s
  // even issued in parallel (a Mongo upsert is several round trips, and they do
  // not overlap well); one findMany is ~250ms, and in the normal case — the seed
  // data unchanged since the last deploy — there is nothing to write at all.
  const existing = await prisma.plan.findMany();
  const byName = new Map(existing.map((plan) => [plan.name, plan]));

  const writes: Promise<unknown>[] = [];
  for (const plan of SEED_PLANS) {
    const fields = {
      title: plan.title,
      description: plan.description,
      features: JSON.stringify(plan.features),
      price: plan.price,
      currencyCode: plan.currencyCode,
      trialDays: plan.trialDays,
      modelLimit: plan.modelLimit,
      productLimit: plan.productLimit,
    };
    const current = byName.get(plan.name);
    if (!current) {
      // Upsert rather than create: two processes booting at once would both see
      // the row missing, and the loser of that race would throw on the unique
      // name. Only paid on a first deploy or a renamed plan.
      writes.push(
        prisma.plan.upsert({
          where: { name: plan.name },
          update: fields,
          create: { name: plan.name, ...fields },
        }),
      );
      continue;
    }
    const unchanged = (
      Object.entries(fields) as [keyof typeof fields, unknown][]
    ).every(([key, value]) => (current as any)[key] === value);
    if (!unchanged) {
      writes.push(
        prisma.plan.update({ where: { name: plan.name }, data: fields }),
      );
    }
  }
  if (writes.length) await Promise.all(writes);

  // Plans from an earlier pricing lineup would otherwise keep showing on the
  // pricing page. Drop them, and move any shop still pointing at one back to
  // Free so it can re-subscribe on a current plan. Derived from the rows already
  // read above rather than a second query.
  const stale = existing.filter((plan) => !SEED_PLAN_NAMES.includes(plan.name));
  if (stale.length === 0) return;
  const free =
    byName.get(FREE_PLAN_NAME) ??
    (await prisma.plan.findUnique({ where: { name: FREE_PLAN_NAME } }));
  await prisma.appUser.updateMany({
    where: { planId: { in: stale.map((p) => p.id) } },
    data: {
      planId: free?.id ?? null,
      modelLimit: free?.modelLimit ?? FREE_MODEL_LIMIT,
      productLimit: free?.productLimit ?? FREE_PRODUCT_LIMIT,
    },
  });
  await prisma.plan.deleteMany({
    where: { id: { in: stale.map((p) => p.id) } },
  });
}

/*
 * Every plan row, read once per process.
 *
 * Plans change only when SEED_PLANS does, which is a deploy and so a new
 * process — the same reasoning as ensurePlans above. Four pages read the full
 * list on every load and several helpers looked single plans up by name or id;
 * each was a ~250ms Mongo round trip for data that never changes under them.
 * Like plansSeeded, a failed read clears the memo rather than sticking.
 *
 * A plan edited directly in the database is picked up on the next restart.
 */
let plansList: Promise<Plan[]> | null = null;

export function getPlans(): Promise<Plan[]> {
  if (!plansList) {
    plansList = ensurePlans()
      .then(() => prisma.plan.findMany())
      .catch((err) => {
        plansList = null;
        throw err;
      });
  }
  return plansList;
}

export async function getPlanByName(name: string): Promise<Plan | null> {
  return (await getPlans()).find((p) => p.name === name) ?? null;
}

export async function getPlanById(id: string): Promise<Plan | null> {
  return (await getPlans()).find((p) => p.id === id) ?? null;
}

export async function getOrCreateUser(shop: string) {
  // In memory after the first read; every write clears it (see
  // app-user-cache.server.ts). Plans are needed too, but are in memory as well.
  const cached = getCachedAppUser(shop);
  if (cached) return cached;
  const gen = appUserCacheGeneration();
  const user = await loadOrCreateUser(shop);
  storeAppUser(shop, user, gen);
  return user;
}

async function loadOrCreateUser(shop: string) {
  // The plan list (seeding included) and the user row are independent reads.
  const [existing, freePlan] = await Promise.all([
    prisma.appUser.findUnique({ where: { shop } }),
    getPlanByName(FREE_PLAN_NAME),
  ]);
  if (existing) return existing;
  /*
   * Upsert rather than create, for the same reason seedPlans upserts: `shop` is
   * unique, and two callers can reach this line for the same store at once. The
   * /app layout seeds the row in the background while the route's own loader
   * fetches it, so on the first request of a new install both see the findUnique
   * miss, and a plain create would leave the loser throwing a unique-constraint
   * error on the one request where the merchant is least able to absorb it.
   *
   * `update: {}` because the existing row is already right — this is only here
   * to make losing the race a no-op that still returns the row.
   */
  return prisma.appUser.upsert({
    where: { shop },
    update: {},
    create: {
      shop,
      modelLimit: freePlan?.modelLimit ?? FREE_MODEL_LIMIT,
      productLimit: freePlan?.productLimit ?? FREE_PRODUCT_LIMIT,
    },
  });
}

/*
 * Whether the shop has picked a plan since installing.
 *
 * A new install has to choose before it can use anything else (routes/app.tsx
 * gates every page on this). Once true it stays true until the app is
 * uninstalled, so the answer is kept in a per-process Set and the check costs
 * nothing on every page after the first.
 *
 * A shop with a live paid subscription counts as having chosen even without
 * the column set — that covers merchants who subscribed before the column
 * existed, and an approval whose return page never loaded.
 */
const planChosen = new Set<string>();

const planCheckInFlight = new Map<string, Promise<boolean>>();

export function hasChosenPlan(
  admin: { graphql: (query: string, options?: any) => Promise<Response> },
  shop: string,
): Promise<boolean> {
  if (planChosen.has(shop)) return Promise.resolve(true);
  /*
   * Shared while in the air: the /app layout and the page under it both ask on
   * the same request (select-plan does), and React Router runs their loaders
   * at once — without this each paid for the same reads.
   */
  const pending = planCheckInFlight.get(shop);
  if (pending) return pending;
  const check = checkPlanChosen(admin, shop).finally(() => {
    planCheckInFlight.delete(shop);
  });
  planCheckInFlight.set(shop, check);
  return check;
}

async function checkPlanChosen(
  admin: { graphql: (query: string, options?: any) => Promise<Response> },
  shop: string,
): Promise<boolean> {
  /*
   * Both asked at once rather than the subscription only after the user row
   * says no. The subscription read is cached per shop, so the cost of asking
   * it needlessly is small; asking it in series put a Shopify round trip on
   * the critical path of every first page after install.
   */
  const [user, subscription] = await Promise.all([
    getOrCreateUser(shop),
    fetchActiveSubscriptionCached(admin, shop).catch(() => null),
  ]);
  if (user.planSelectedAt) {
    planChosen.add(shop);
    return true;
  }
  if (subscription?.status === "active") {
    await markPlanChosen(shop);
    return true;
  }
  return false;
}

export async function markPlanChosen(shop: string): Promise<void> {
  await prisma.appUser.updateMany({
    where: { shop },
    data: { planSelectedAt: new Date() },
  });
  planChosen.add(shop);
}

/**
 * Records a choice that was just written to the row by the caller — for paths
 * that set `planSelectedAt` in an update they were making anyway, rather than
 * paying markPlanChosen's separate write.
 */
export function rememberPlanChosen(shop: string): void {
  planChosen.add(shop);
}

/** On uninstall, so a reinstall asks for a plan again. */
export async function resetPlanChoice(shop: string): Promise<void> {
  planChosen.delete(shop);
  await prisma.appUser.updateMany({
    where: { shop },
    data: { planSelectedAt: null },
  });
}

export function parseFeatures(raw: string): string[] {
  try {
    const out = JSON.parse(raw);
    return Array.isArray(out) ? out.map(String) : [];
  } catch {
    return [];
  }
}

export type SubscriptionInfo = {
  /**
   * The subscription's admin GraphQL id (`gid://shopify/AppSubscription/…`).
   *
   * Carried so a caller that has to act on the subscription — cancelling it —
   * can address the one Shopify says is live, rather than the id we happen to
   * have stored. See the note above `fetchActiveSubscription`.
   */
  id: string;
  name: string;
  status: string;
  price: string;
  trialDays?: number;
  createdAt?: string;
  cancelledOn?: string | null;
};

/*
 * The shop's current subscription to *this* app, straight from Shopify.
 *
 * Previously a REST call to /recurring_application_charges/<id>.json, keyed off
 * the chargeId we had stored. Two reasons that had to go:
 *
 *  - The REST Admin API is legacy; since 1 April 2025 apps submitted to the App
 *    Store must be built exclusively on the GraphQL Admin API.
 *  - It could only ever confirm the charge we already knew about. A subscription
 *    changed outside the app — upgraded from the admin's Subscriptions page, or
 *    cancelled while a webhook was failing — left the stored id stale, and the
 *    lookup happily reported the old charge as current.
 *
 * `currentAppInstallation.activeSubscriptions` inverts that: Shopify names the
 * active subscription, so there is nothing to keep in sync. `chargeId` is now
 * only an optional filter, for the billing return page confirming the specific
 * charge the merchant just approved.
 */
const subscriptionCache = createShopCache<SubscriptionInfo | null>(
  SHOP_CACHE_TTL_MS,
);

/**
 * `fetchActiveSubscription` through a per-shop cache, for the loaders that only
 * render a plan name or a badge.
 *
 * Only the no-chargeId form is cached. Passing a chargeId means "confirm this
 * specific charge", which is the billing return path — that has to see live
 * data, and it invalidates this cache rather than reading it.
 */
export async function fetchActiveSubscriptionCached(
  admin: { graphql: (query: string, options?: any) => Promise<Response> },
  shop: string,
): Promise<SubscriptionInfo | null> {
  return subscriptionCache.read(shop, () => fetchActiveSubscription(admin));
}

/** Called when a charge is created, confirmed or cancelled. */
export function invalidateSubscription(shop: string): void {
  subscriptionCache.invalidate(shop);
}

export async function fetchActiveSubscription(
  admin: { graphql: (query: string, options?: any) => Promise<Response> },
  chargeId?: string | null,
): Promise<SubscriptionInfo | null> {
  try {
    const res = await admin.graphql(
      `#graphql
        query ActiveAppSubscription {
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              status
              createdAt
              trialDays
              test
              lineItems {
                plan {
                  pricingDetails {
                    ... on AppRecurringPricing {
                      price { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }`,
    );
    const json: any = await res.json();
    const subs: any[] =
      json?.data?.currentAppInstallation?.activeSubscriptions ?? [];
    if (subs.length === 0) return null;

    // A shop can only hold one subscription to one app, but the field is a list
    // — match on the requested charge when given one, otherwise take the first.
    const sub = chargeId
      ? (subs.find((s) => String(s?.id ?? "").endsWith(`/${chargeId}`)) ?? null)
      : subs[0];
    if (!sub) return null;

    const amount =
      sub.lineItems?.[0]?.plan?.pricingDetails?.price?.amount ?? "0";

    return {
      id: String(sub.id ?? ""),
      name: sub.name,
      // Callers compare against lowercase ("active"); GraphQL enums are
      // SCREAMING_CASE. Normalise here so every call site doesn't have to.
      status: String(sub.status ?? "").toLowerCase(),
      price: String(amount),
      trialDays: sub.trialDays ?? undefined,
      createdAt: sub.createdAt ?? undefined,
      // Not exposed on AppSubscription, and never meaningful here anyway: this
      // query returns only *active* subscriptions, which by definition have no
      // cancellation date. Kept on the type so the UI shape is unchanged.
      cancelledOn: null,
    };
  } catch (err) {
    console.error("[billing] fetchActiveSubscription failed:", err);
    return null;
  }
}

export type ModelOwner = { id: string; title: string };

export type AssignedModels = {
  /** Number of products carrying a 3D model (one model per product). */
  count: number;
  gids: string[];
  /** File gid -> the product(s) it is assigned to. */
  owners: Map<string, ModelOwner[]>;
};

export async function getAssignedModelGids(
  admin: any,
  _shop: string,
): Promise<AssignedModels> {
  const gids: string[] = [];
  const owners = new Map<string, ModelOwner[]>();
  let cursor: string | null = null;
  // 250 is the connection maximum, and the whole page costs 24 points against a
  // 1000-point single-query ceiling — so the old `first: 100` was buying 2.5x
  // the round trips for nothing. Ten pages now covers 2500 products rather than
  // 1000; past that the count is a floor, which is what it always was.
  for (let page = 0; page < 10; page++) {
    const res: any = await admin.graphql(
      `#graphql
        query AssignedModelGids($cursor: String) {
          products(first: 250, after: $cursor) {
            edges {
              cursor
              node {
                id
                title
                metafield(namespace: "custom", key: "model_3d") { value }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { variables: { cursor } },
    );
    const json: any = await res.json();
    const edges = json?.data?.products?.edges ?? [];
    for (const e of edges) {
      const value = e?.node?.metafield?.value;
      if (!value) continue;
      gids.push(value);
      const list = owners.get(value) ?? [];
      list.push({ id: e.node.id, title: e.node.title ?? "Untitled product" });
      owners.set(value, list);
    }
    if (!json?.data?.products?.pageInfo?.hasNextPage) break;
    cursor = json?.data?.products?.pageInfo?.endCursor ?? null;
    if (!cursor) break;
  }
  return { count: gids.length, gids, owners };
}

/*
 * Every product page of the crawl above is a Shopify round trip (~500ms each),
 * and four separate loaders run it just to render a count: the dashboard tiles,
 * the product list header, the library's usage bar, the onboarding checklist.
 * None of them is a decision point — they display a number.
 *
 * So those four read through a short-lived per-shop cache, and the paths that
 * *enforce* something (assignment conflicts, plan caps) keep calling
 * getAssignedModelGids directly and always see live data. Assignment writes go
 * through app.products.$id, which drops the entry, so the TTL only has to cover
 * assignments made outside this app — a merchant editing the metafield in the
 * Shopify admin by hand.
 */
// The shared per-shop cache, for its in-flight sharing and stale-while-
// revalidate: this is up to ten sequential product pages, the most expensive
// read in the app, and it was the one cache without either.
const assignedCache = createShopCache<AssignedModels>(SHOP_CACHE_TTL_MS);

/*
 * The store's total product count, cached like every other Shopify read on a
 * page load.
 *
 * This was the one Admin API call on the dashboard still going out on every
 * request — several hundred milliseconds, in series with nothing but in
 * parallel with everything, which made it the item that decided how long the
 * whole loader took. It renders a single number in a stat tile; a count that is
 * up to a minute old is indistinguishable from a fresh one to a merchant, and
 * unlike the checklist reads below, nothing this app does changes it, so there
 * is no action that needs to invalidate it.
 */
const productsCountCache = createShopCache<number>(SHOP_CACHE_TTL_MS);

export async function fetchProductsCountCached(
  admin: any,
  shop: string,
): Promise<number> {
  return productsCountCache.read(shop, async () => {
    const res = await admin.graphql(
      `#graphql
        query TotalProducts {
          productsCount { count }
        }`,
    );
    const json = await res.json();
    return json?.data?.productsCount?.count ?? 0;
  });
}

export async function getAssignedModelGidsCached(
  admin: any,
  shop: string,
): Promise<AssignedModels> {
  return assignedCache.read(shop, () => getAssignedModelGids(admin, shop));
}

/*
 * The Products page's default view — first page, no search — as Shopify
 * returned it. It is what nearly every visit to that page shows, and it was the
 * one Shopify read on it with no cache: a full GraphQL round trip in front of
 * every load. Cleared alongside the assignment cache, since assigning or
 * removing a model is what changes its "has model" badges; changes made in the
 * Shopify admin (a new product) show from the load after next, per the
 * stale-while-revalidate rule in shop-cache.server.ts.
 */
export const productsFirstPageCache =
  createShopCache<unknown>(SHOP_CACHE_TTL_MS);

/** Called by every action that assigns or removes a product's model. */
export function invalidateAssignedModels(shop: string): void {
  assignedCache.invalidate(shop);
  productsFirstPageCache.invalidate(shop);
}

/**
 * A 3D model file belongs to exactly one product. Returns the *other* product
 * already using `fileGid`, or null when the file is free to assign.
 */
export function findConflictingOwner(
  assigned: AssignedModels,
  fileGid: string,
  ownProductGid: string | null,
): ModelOwner | null {
  const list = assigned.owners.get(fileGid) ?? [];
  return list.find((p) => p.id !== ownProductGid) ?? null;
}

/**
 * A single uploaded file can appear both as a library row and as one or more
 * product assignments — count it once toward the plan limit either way.
 */
export function countDistinctModels(
  libraryGids: Iterable<string | null | undefined>,
  assignedGids: Iterable<string | null | undefined>,
): number {
  const set = new Set<string>();
  for (const g of libraryGids) if (g) set.add(g);
  for (const g of assignedGids) if (g) set.add(g);
  return set.size;
}

export type PlanLimits = {
  /** Max distinct 3D models the shop may keep across library + products. */
  modelLimit: number;
  /** Max products that may carry a 3D model. */
  productLimit: number;
  planName: string;
};

export async function getPlanLimitForShop(shop: string): Promise<PlanLimits> {
  const user = await prisma.appUser.findUnique({ where: { shop } });
  if (!user) {
    const free = await getPlanByName(FREE_PLAN_NAME);
    return {
      modelLimit: free?.modelLimit ?? FREE_MODEL_LIMIT,
      productLimit: free?.productLimit ?? FREE_PRODUCT_LIMIT,
      planName: FREE_PLAN_NAME,
    };
  }
  if (user.planId) {
    const plan = await getPlanById(user.planId);
    if (plan) {
      return {
        modelLimit: plan.modelLimit,
        productLimit: plan.productLimit,
        planName: plan.name,
      };
    }
  }
  return {
    modelLimit: user.modelLimit ?? FREE_MODEL_LIMIT,
    productLimit: user.productLimit ?? FREE_PRODUCT_LIMIT,
    planName: FREE_PLAN_NAME,
  };
}
