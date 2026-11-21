import { useEffect } from "react";

import { whenIdle } from "~/components/Analytics";

/*
 * Crisp live-chat widget, mounted only in the embedded admin layout
 * (routes/app.tsx) so merchants can reach support. Like the analytics tags, it
 * is kept off the public viewer embed and the storefront extension.
 */

const CRISP_WEBSITE_ID = "e9e3fe6a-6052-4c62-9d27-3c2d73a2c277";

declare global {
  interface Window {
    $crisp?: unknown[];
    CRISP_WEBSITE_ID?: string;
  }
}

/*
 * Module scope, not component state: the /app layout can remount across a
 * client-side navigation, and a second pass would load the widget twice.
 */
let injected = false;

export function CrispChat({ shop }: { shop: string | null }) {
  useEffect(() => {
    if (injected) return;
    injected = true;

    window.$crisp = [];
    window.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID;
    // Tags the conversation with the store so support knows who is asking.
    if (shop) {
      window.$crisp.push(["set", "session:data", [[["shop", shop]]]]);
    }

    /*
     * Deferred to after load and an idle callback, like the analytics tags.
     * The widget is ~100KB of script plus its own fonts, styles and a socket,
     * none of which the page's first paint needs — loaded eagerly it competes
     * with polaris.js and the app bundle inside the window LCP is measured in.
     * The `$crisp` queue above is in place first, so nothing pushed before the
     * script lands is lost.
     */
    whenIdle(() => {
      const tag = document.createElement("script");
      tag.src = "https://client.crisp.chat/l.js";
      tag.async = true;
      document.head.appendChild(tag);
    });
  }, [shop]);

  return null;
}
