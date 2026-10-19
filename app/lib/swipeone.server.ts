import { ADMIN_API_VERSION } from "./app-config";

const SWIPEONE_URL =
  "https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287";

export const APP_NAME = "viewer-3d";
export const APP_FULL_NAME = "Easy 3D Viewer";
export const APP_SLUG = "viewer-3d-by-bplugins";

function formatNow(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

export type ShopInfo = {
  shop_owner?: string;
  email?: string;
  country_name?: string;
  address1?: string;
  address2?: string;
  phone?: string;
  created_at?: string;
  domain?: string;
  myshopify_domain?: string;
  plan_display_name?: string;
  id?: number | string;
};

type NotifyArgs = {
  type: string;
  shop: string;
  userId?: string;
  installId?: string | number;
  shopInfo?: ShopInfo;
  extra?: Record<string, unknown>;
};

export async function notifySwipeone({
  type,
  shop,
  userId,
  installId,
  shopInfo,
  extra,
}: NotifyArgs) {
  const payload = [
    {
      type,
      app_name: APP_NAME,
      app_full_name: APP_FULL_NAME,
      app_slug: APP_SLUG,
      success: true,
      shop,
      user_id: userId,
      install_id: installId ?? "",
      data: {
        name: shopInfo?.shop_owner ?? "",
        email: shopInfo?.email ?? "",
        country_name: shopInfo?.country_name ?? "",
        address1: shopInfo?.address1 ?? "",
        address2: shopInfo?.address2 ?? "",
        phone: shopInfo?.phone ?? null,
        created_at: shopInfo?.created_at ?? "",
        domain: shopInfo?.domain ?? shop,
        myshopify_domain: shopInfo?.myshopify_domain ?? "",
        plan_display_name: shopInfo?.plan_display_name ?? "",
        ...(extra ?? {}),
      },
      id: userId,
      created: formatNow(),
      objects: {
        user: { email: shopInfo?.email },
      },
    },
  ];

  try {
    await fetch(SWIPEONE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[swipeone] notify failed:", err);
  }
}

/*
 * The shop's own details, for the CRM payload above.
 *
 * GraphQL rather than the old /admin/api/2025-01/shop.json: the REST Admin API
 * is legacy, and an app submitted to the App Store must be built exclusively on
 * the GraphQL Admin API. The returned shape is unchanged — REST's snake_case
 * keys are mapped back so ShopInfo and everything consuming it stay as they
 * were.
 *
 * A raw fetch rather than an `admin.graphql` client because the two hottest
 * callers don't have one: shopify.server's afterAuth hook and the uninstall
 * webhook both hold a session, not an authenticated admin client.
 */
export async function fetchShopInfo(
  shop: string,
  accessToken: string,
): Promise<ShopInfo | null> {
  try {
    const res = await fetch(
      `https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `#graphql
            query ShopInfo {
              shop {
                id
                name
                email
                contactEmail
                createdAt
                shopOwnerName
                myshopifyDomain
                primaryDomain { host }
                plan { displayName }
                shopAddress {
                  address1
                  address2
                  phone
                  country
                }
              }
            }`,
        }),
      },
    );
    if (!res.ok) return null;
    const json: any = await res.json();
    const s = json?.data?.shop;
    if (!s) return null;

    return {
      shop_owner: s.shopOwnerName ?? undefined,
      email: s.email ?? s.contactEmail ?? undefined,
      country_name: s.shopAddress?.country ?? undefined,
      address1: s.shopAddress?.address1 ?? undefined,
      address2: s.shopAddress?.address2 ?? undefined,
      phone: s.shopAddress?.phone ?? undefined,
      created_at: s.createdAt ?? undefined,
      domain: s.primaryDomain?.host ?? shop,
      myshopify_domain: s.myshopifyDomain ?? undefined,
      plan_display_name: s.plan?.displayName ?? undefined,
      // A GID ("gid://shopify/Shop/123") where REST returned the bare number.
      // Kept as the numeric tail so CRM records created before this migration
      // still match the ones created after it.
      id: String(s.id ?? "").split("/").pop() ?? undefined,
    };
  } catch {
    return null;
  }
}
