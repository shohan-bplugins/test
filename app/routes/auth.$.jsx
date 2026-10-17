import axios from "axios";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  function getFormattedDateTime() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");

  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1); // Months are 0-indexed
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

  try {
    const response = await axios.get(
      `https://${session?.shop}/admin/api/2026-07/shop.json`,
      {
        headers: {
          "X-Shopify-Access-Token": session?.accessToken,
          "Content-Type": "application/json",
        },
      },
    );

    const shopData = response.data.shop;

    const result = await fetch("https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          type: "app.installed",
          app_name: "video-player",
          app_full_name: "Video Player by bPlugins",
          app_slug: "video-player-by-bplugins",
          success: true,
          shop: session?.shop,
          user_id: session?.id,
          install_id: shopData?.id,
          data: {
            name: shopData?.shop_owner,
            email: shopData?.email,
            country_name: shopData?.country_name,
            address1: shopData?.address1,
            address2: shopData?.address2,
            phone: shopData?.phone,
            created_at: shopData?.created_at,
            domain: shopData?.domain,
            myshopify_domain: shopData?.myshopify_domain,
            plan_display_name: shopData?.plan_display_name,
          },
          id: session?.id,
          created: getFormattedDateTime(),
          objects: {
            user: {
              email: shopData?.email,
            },
          },
        },
      ]),
    });
  } catch (error) {
    console.error(
      "Error in afterAuth hook:",
      error?.response?.data || error.message,
    );
  }

  return null;
};
