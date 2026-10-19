import "@shopify/shopify-app-remix/adapters/node";
import {
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { ExpiringOfflineTokenStorage } from "./lib/expiring-token-storage.server";
import prisma from "./db.server";
import { API_VERSION } from "./lib/api-version";

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
  // A plain version string, not the ApiVersion enum: an enum member is
  // undefined on an install whose library predates that version, which
  // crashes startup ("Missing values for: apiVersion").
  apiVersion: API_VERSION,
  scopes: process.env.SCOPES?.split(",") || [],
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  // Also migrates shops still on a deprecated non-expiring offline token.
  sessionStorage: new ExpiringOfflineTokenStorage(prisma, {
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  }),
  distribution: AppDistribution.AppStore,
  isEmbeddedApp: true,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
    },
    APP_SUBSCRIPTIONS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/subscriptionsUpdate",
    },
    CUSTOMERS_DATA_REQUEST: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/compliance",
    },
    CUSTOMERS_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/compliance",
    },
    SHOP_REDACT: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/compliance",
    },
  },

  hooks: {
    afterAuth: async ({ session, admin }) => {
      try {
        const response = await admin.graphql(
          `#graphql
          query ShopDetails {
            shop {
              id
              name
              email
              shopOwnerName
              myshopifyDomain
              primaryDomain { host }
              billingAddress {
                address1
                address2
                phone
                country
              }
              createdAt
              plan { displayName }
            }
          }`,
        );

        const { data } = await response.json();
        const shopData = data?.shop;

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
                app_name: "audio-player",
                app_full_name: "Audio Player by bPlugins",
                app_slug: "html5-audio-player",
                success: true,
                shop: session?.shop,
                user_id: session?.id,
                install_id: shopData?.id,
                data: {
                  name: shopData?.shopOwnerName,
                  email: shopData?.email,
                  country_name: shopData?.billingAddress?.country,
                  address1: shopData?.billingAddress?.address1,
                  address2: shopData?.billingAddress?.address2,
                  phone: shopData?.billingAddress?.phone,
                  created_at: shopData?.createdAt,
                  domain: shopData?.primaryDomain?.host,
                  myshopify_domain: shopData?.myshopifyDomain,
                  plan_display_name: shopData?.plan?.displayName,
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
    // New offline tokens expire and are refreshed automatically (non-expiring
    // ones are deprecated; required by January 1, 2027).
    expiringOfflineAccessTokens: true,
  },

  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export { API_VERSION } from "./lib/api-version";
export const apiVersion = API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
