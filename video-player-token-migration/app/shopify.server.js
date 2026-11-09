import "@shopify/shopify-app-remix/adapters/node";
import {
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import axios from "axios";

// Literal rather than the ApiVersion enum: @shopify/shopify-api 11.6.0 only
// enumerates up to 2024-10, so the latest versions have no enum member yet.
const API_VERSION = "2026-07";

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

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: API_VERSION,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
      callback: async (_topic, shop, _body) => {},
    },
    APP_SUBSCRIPTIONS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/subscriptionsUpdate",
      callback: async (_topic, shop, _body) => {console.log("Subscription Update")},
    },
    APP_INSTALLED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/webhooks/app/installed",
    callback: async (_topic, shop, _body) => {},
  },
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
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

        await fetch(
          "https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287",
          {
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
          },
        );
      } catch (error) {
        console.error(
          "Error in afterAuth hook:",
          error?.response?.data || error.message,
        );
      }
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    // Offline tokens now expire after 1h and carry a refresh token. Required
    // for public apps from 2027-01-01; needs shopify-app-remix >= 4.1.0 and
    // session-storage-prisma >= 8.0.0 to persist the refresh token.
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});



export default shopify;
export const apiVersion = API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
