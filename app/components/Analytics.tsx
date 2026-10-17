import { useEffect } from "react";
import { useLocation } from "react-router";

/*
 * Google Analytics 4 + Microsoft Clarity, loaded only on the embedded admin
 * pages (/app/*) — see root.tsx. The public /viewer/:id embed and the storefront
 * theme extension are deliberately left untracked: those render inside a
 * merchant's own storefront, and dropping our trackers on their shoppers is
 * their consent decision to make, not ours.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
  }
}

/*
 * Rendered into <head> so the tags are in the initial SSR document. React does
 * not execute inline scripts it inserts after hydration, which is fine here:
 * the admin app always enters through a server-rendered document, and the
 * page-view hook below covers every client-side navigation after that.
 */
// Structurally the same shape `getAnalyticsConfig()` returns; spelled out here
// rather than imported so this client component never reaches into a .server
// module.
export type AnalyticsProps = {
  gaMeasurementId: string | null;
  clarityProjectId: string | null;
};

/*
 * Guards the one-time injection below. Module scope, not component state: the
 * /app layout can remount across a client-side navigation, and a second pass
 * would append a second copy of each vendor script.
 */
let injected = false;

/**
 * Runs `fn` once the page has finished loading and the main thread is idle.
 *
 * Both vendor scripts are pure measurement: nothing on screen waits for either,
 * and a merchant who never gets them still sees a working app. What they are
 * not is free — 512KB for gtag.js and 73KB for Clarity, downloaded, parsed and
 * executed. Letting that happen during the load is what pushes a page that
 * renders promptly past an LCP budget it would otherwise meet.
 *
 * `load` first, so the deferral survives a browser without
 * `requestIdleCallback` (Safari shipped it only in 2022), and an idle callback
 * after it, with a timeout so a permanently busy thread cannot drop analytics
 * altogether.
 */
export function whenIdle(fn: () => void) {
  const schedule = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(fn, { timeout: 4000 });
    } else {
      window.setTimeout(fn, 1000);
    }
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}

function loadVendorScripts({
  gaMeasurementId,
  clarityProjectId,
}: AnalyticsProps) {
  if (injected) return;
  injected = true;

  const append = (src: string) => {
    const tag = document.createElement("script");
    tag.async = true;
    tag.src = src;
    document.head.appendChild(tag);
  };

  if (gaMeasurementId) {
    // Absent only when the first document of the session was not an /app page
    // — the OAuth path — so the inline shim never ran. Re-created here with the
    // same configuration, since the queued calls are what the real script
    // replays on arrival.
    if (!window.gtag) {
      window.dataLayer = window.dataLayer || [];
      // Must be a `function`, not an arrow: gtag.js reads the live `arguments`
      // object off each queued entry, and arrows do not have one. The rest
      // parameter is declared for the type checker's benefit and left unused.
      function gtag(..._args: unknown[]) {
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer!.push(arguments);
      }
      window.gtag = gtag;
      gtag("js", new Date());
      gtag("config", gaMeasurementId, {
        send_page_view: false,
        cookie_flags: "SameSite=None;Secure",
      });
    }
    append(`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`);
  }

  if (clarityProjectId) {
    // The queue shim has to exist before clarity.ms/tag runs: that file calls
    // window.clarity("start", …) on itself and drops the call if it is absent.
    if (!window.clarity) {
      const queue: unknown[][] = [];
      const clarity = (...args: unknown[]) => {
        queue.push(args);
      };
      clarity.q = queue;
      window.clarity = clarity;
    }
    append(`https://www.clarity.ms/tag/${clarityProjectId}`);
  }
}

export function AnalyticsScripts({
  gaMeasurementId,
  clarityProjectId,
}: AnalyticsProps) {
  useEffect(() => {
    whenIdle(() => loadVendorScripts({ gaMeasurementId, clarityProjectId }));
  }, [gaMeasurementId, clarityProjectId]);

  return (
    <>
      {gaMeasurementId ? (
        <>
          <link rel="preconnect" href="https://www.googletagmanager.com" />
          {/*
            The gtag.js <script> that used to sit here has moved to
            `loadVendorScripts`, which runs after load and on an idle callback.
            It is 512KB of JavaScript that renders nothing, and `async` only
            keeps it from blocking the parser — it still competed with
            polaris.js and this app's own bundle for bandwidth and main-thread
            time during exactly the window LCP is measured in.

            What stays is the queue shim below, which is a few lines and has to
            be in the first document: `gtag(...)` calls made before the real
            script arrives land in `dataLayer` and are replayed when it does, so
            deferring the download loses no events.
          */}
          <script
            // `send_page_view: false` because GA's automatic page_view only
            // fires on document load; this is a SPA, so useAnalyticsPageViews
            // sends them instead — including the first one.
            //
            // `cookie_flags` matters more than it looks: the admin app runs in
            // an iframe under admin.shopify.com, so GA's cookies are
            // third-party. Without SameSite=None;Secure the browser drops them
            // and every navigation looks like a brand new user.
            dangerouslySetInnerHTML={{
              __html: `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${gaMeasurementId}', {
  send_page_view: false,
  cookie_flags: 'SameSite=None;Secure'
});`.trim(),
            }}
          />
        </>
      ) : null}

      {clarityProjectId ? (
        <script
          dangerouslySetInnerHTML={{
            __html: `
window.clarity = window.clarity || function(){
  (window.clarity.q = window.clarity.q || []).push(arguments)
};`.trim(),
          }}
        />
      ) : null}
    </>
  );
}

/*
 * Sends a GA page_view on first paint and on every client-side route change,
 * and tells Clarity to start a fresh page in its session recording so a
 * multi-page visit doesn't collapse into one long blob.
 */
export function useAnalyticsPageViews(enabled: boolean) {
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (!enabled) return;

    const path = pathname + search;
    window.gtag?.("event", "page_view", {
      page_path: path,
      page_location: window.location.href,
      page_title: document.title,
    });
    window.clarity?.("set", "page_path", pathname);
  }, [enabled, pathname, search]);
}

/*
 * Attaches the merchant's shop domain to the session in both tools, so a
 * recording or a funnel drop-off can be traced back to the store that hit it.
 * Rendered from the /app layout, which is the first point that knows the shop.
 */
export function AnalyticsIdentify({ shop }: { shop: string | null }) {
  useEffect(() => {
    if (!shop) return;
    window.gtag?.("set", "user_properties", { shop_domain: shop });
    window.clarity?.("identify", shop);
    window.clarity?.("set", "shop_domain", shop);
  }, [shop]);

  return null;
}
