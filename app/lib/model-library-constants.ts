/*
 * Namespace/key constants for the shop-level model library metafield.
 *
 * Separate from model-library.server.ts — mirroring ~/lib/billing-constants —
 * because the Setup page renders these names in the UI. Importing them from the
 * `.server` module made React Router pull a server-only file into the client
 * bundle and the build failed outright: route exports other than
 * loader/action/headers can't reference server code.
 *
 * `$app:` marks a namespace reserved to this app. Shopify expands it to
 * app--<app-id>--viewer3d, the app owns it without needing any extra access
 * scope, and it is readable from this app's own theme app extension in Liquid as
 * shop.metafields["$app:viewer3d"].library.value.
 *
 * The `custom.*` pair is the original, merchant-owned location. It is retained
 * only so a shop whose metafield did get populated keeps working through a block
 * that hasn't been redeployed; new writes there are expected to fail, because
 * this app requests no scope granting shop-level metafield writes.
 */

export const APP_LIBRARY_NAMESPACE = "$app:viewer3d";
export const APP_LIBRARY_KEY = "library";

/*
 * The app's own current URL, published for the theme block to read.
 *
 * The block needs an absolute origin for the case where it has to resolve a
 * Model ID by fetching from the app, and it has no way to learn one on its own —
 * so it carried a hardcoded literal, which is the exact fragility the app proxy
 * was introduced to remove. Under `shopify app dev` the proxy does not help
 * either: it keeps pointing at whatever `[app_proxy].url` says, so a storefront
 * request lands on the production app, which does not have the dev database's
 * models and answers 404. Both paths then fail and the block silently renders
 * with defaults instead of the model's saved config.
 *
 * Writing the URL here means every sync republishes wherever the app currently
 * lives — including a fresh dev tunnel — and Liquid reads it back with no
 * redeploy of the extension.
 */
export const APP_URL_KEY = "app_url";

export const LIBRARY_NAMESPACE = "custom";
export const LIBRARY_KEY = "viewer_3d_library";
