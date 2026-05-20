import prisma from "../db.server";
import {
  FREE_PLAN_NAME,
  PRO_PLAN_NAME,
  PRO_PLUS_PLAN_NAME,
} from "./billing-constants";

export { FREE_PLAN_NAME, PRO_PLAN_NAME, PRO_PLUS_PLAN_NAME };

type SeedPlan = {
  title: string;
  name: string;
  description: string;
  features: string[];
  price: string;
  currencyCode: string;
  trialDays: string;
  modelLimit: number;
};

const SEED_PLANS: SeedPlan[] = [
  {
    title: "Free",
    name: FREE_PLAN_NAME,
    description: "Get started with interactive 3D models on your store.",
    features: [
      "Up to 5 3D models",
      "Embed on product pages and pages",
      "All viewer customization options",
      "Live preview in admin",
      "Standard support",
    ],
    price: "0",
    currencyCode: "USD",
    trialDays: "0",
    modelLimit: 5,
  },
  {
    title: "Pro",
    name: PRO_PLAN_NAME,
    description: "Unlock more models and priority support for growing stores.",
    features: [
      "Up to 50 3D models",
      "Everything in Free",
      "HDR skybox and environment maps",
      "Material variants",
      "Priority email support",
    ],
    price: "9.99",
    currencyCode: "USD",
    trialDays: "7",
    modelLimit: 50,
  },
  {
    title: "Pro Plus",
    name: PRO_PLUS_PLAN_NAME,
    description: "For high-volume catalogs and advanced needs.",
    features: [
      "Unlimited 3D models",
      "Everything in Pro",
      "AR Quick Look (iOS) + Scene Viewer (Android)",
      "Custom annotations",
      "Premium support",
    ],
    price: "29.99",
    currencyCode: "USD",
    trialDays: "7",
    modelLimit: 100000,
  },
];

export async function ensurePlans() {
  for (const plan of SEED_PLANS) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: {
        title: plan.title,
        description: plan.description,
        features: JSON.stringify(plan.features),
        price: plan.price,
        currencyCode: plan.currencyCode,
        trialDays: plan.trialDays,
        modelLimit: plan.modelLimit,
      },
      create: {
        title: plan.title,
        name: plan.name,
        description: plan.description,
        features: JSON.stringify(plan.features),
        price: plan.price,
        currencyCode: plan.currencyCode,
        trialDays: plan.trialDays,
        modelLimit: plan.modelLimit,
      },
    });
  }
}

export async function getOrCreateUser(shop: string) {
  await ensurePlans();
  const existing = await prisma.appUser.findUnique({ where: { shop } });
  if (existing) return existing;
  const freePlan = await prisma.plan.findUnique({
    where: { name: FREE_PLAN_NAME },
  });
  return prisma.appUser.create({
    data: {
      shop,
      modelLimit: freePlan?.modelLimit ?? 5,
    },
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
  name: string;
  status: string;
  price: string;
  trialDays?: number;
  createdAt?: string;
  cancelledOn?: string | null;
};

export async function fetchActiveSubscription(
  shop: string,
  accessToken: string,
  chargeId: string | null,
): Promise<SubscriptionInfo | null> {
  if (!chargeId) return null;
  try {
    const res = await fetch(
      `https://${shop}/admin/api/2025-01/recurring_application_charges/${chargeId}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const c = data?.recurring_application_charge;
    if (!c) return null;
    return {
      name: c.name,
      status: c.status,
      price: c.price,
      trialDays: c.trial_days,
      createdAt: c.created_at,
      cancelledOn: c.cancelled_on,
    };
  } catch {
    return null;
  }
}

export async function countAssignedModels(
  admin: any,
  shop: string,
): Promise<number> {
  try {
    const res = await admin.graphql(
      `#graphql
        query CountModelsAssigned($q: String!) {
          products(first: 1, query: $q) {
            edges { node { id } }
          }
          productsCount(query: $q) {
            count
            precision
          }
        }`,
      {
        variables: {
          q: 'metafield:"custom.model_3d:*"',
        },
      },
    );
    const json = await res.json();
    const count = json?.data?.productsCount?.count;
    if (typeof count === "number") return count;
  } catch {}
  return await countAssignedModelsFallback(admin, shop);
}

async function countAssignedModelsFallback(admin: any, _shop: string) {
  let total = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const res: any = await admin.graphql(
      `#graphql
        query CountFallback($cursor: String) {
          products(first: 100, after: $cursor) {
            edges {
              cursor
              node {
                metafield(namespace: "custom", key: "model_3d") { id }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { variables: { cursor } },
    );
    const json: any = await res.json();
    const edges = json?.data?.products?.edges ?? [];
    for (const e of edges) if (e?.node?.metafield?.id) total += 1;
    if (!json?.data?.products?.pageInfo?.hasNextPage) break;
    cursor = json?.data?.products?.pageInfo?.endCursor ?? null;
    if (!cursor) break;
  }
  return total;
}

export async function getPlanLimitForShop(shop: string): Promise<{
  limit: number;
  planName: string;
}> {
  const user = await prisma.appUser.findUnique({ where: { shop } });
  if (!user) {
    const free = await prisma.plan.findUnique({
      where: { name: FREE_PLAN_NAME },
    });
    return { limit: free?.modelLimit ?? 5, planName: FREE_PLAN_NAME };
  }
  if (user.planId) {
    const plan = await prisma.plan.findUnique({ where: { id: user.planId } });
    if (plan) return { limit: plan.modelLimit, planName: plan.name };
  }
  return { limit: user.modelLimit ?? 5, planName: FREE_PLAN_NAME };
}
