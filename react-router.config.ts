import type { Config } from "@react-router/dev/config";

export default {
  allowedActionOrigins: [
    "admin.shopify.com",
    "*.shopify.com",
    "**.shopify.com",
    "*.myshopify.com",
    "**.myshopify.com",
    "3d-viewer-app.bplugins.com",
    "*.bplugins.com",
    "**.bplugins.com",
    "localhost",
    "localhost:*",
    "127.0.0.1",
    "127.0.0.1:*",
  ],
} satisfies Config;
