// Play-tracking endpoint reached through the Shopify app proxy:
//   storefront POST /apps/svp-player/play  →  Shopify  →  /proxy/play here.
//
// Same handler as /app/api/track. The point of the proxy hop is the URL the
// browser sees: a first-party /apps/... path on the store's own domain, which
// ad blockers (Brave Shields, uBlock) don't block — unlike our direct
// third-party endpoint whose "/track" path matches EasyPrivacy filter rules
// and dies with ERR_BLOCKED_BY_CLIENT.
export { loader, action } from "./app.api.track";
