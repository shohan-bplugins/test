const SWIPEONE_URL =
  "https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287";

export const APP_NAME = "viewer-3d";
export const APP_FULL_NAME = "3D Viewer by bPlugins";
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

export async function fetchShopInfo(
  shop: string,
  accessToken: string,
): Promise<ShopInfo | null> {
  try {
    const res = await fetch(`https://${shop}/admin/api/2025-01/shop.json`, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.shop ?? null;
  } catch {
    return null;
  }
}
