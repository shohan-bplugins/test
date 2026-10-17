/**
 * The App Bridge global, or null if it is not there yet.
 *
 * `window.shopify` is defined by the app-bridge.js tag that AppProvider injects
 * into the body, and `useAppBridge()` does not tolerate its absence — it throws:
 *
 *   if (!window.shopify) throw Error("The shopify global is not defined...")
 *
 * Mount effects run at hydration, which on a cold or slow load can beat that
 * CDN script. An effect that throws there takes out the nearest React error
 * boundary, and on /app/videos the nearest one is <Await>'s — which logs
 * "<Await> caught the following error during render" and rethrows, killing the
 * page.
 *
 * Click handlers do not need this: the user cannot click before the page is
 * interactive. Use it for anything that runs on mount.
 */
export const appBridge = () =>
  typeof window === "undefined" ? null : window.shopify ?? null;
