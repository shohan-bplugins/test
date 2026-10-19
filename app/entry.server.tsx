import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { getPlans } from "~/lib/billing.server";

/*
 * Warm-up at boot, not on the first merchant's request.
 *
 * The first database query in a fresh process opens the Atlas connection (TLS
 * and auth) and loads the plan list — measured at ~2.8s together. Before this,
 * whoever opened the app first after a deploy or restart paid all of it in
 * their page load. Started here, it is done before anyone asks. Failure is
 * harmless: getPlans clears its memo and the first request simply retries.
 */
void getPlans().catch((error) => {
  console.error("[boot] warm-up failed; first request will retry", error);
});

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);

  // The public /viewer/:id page exists to be embedded on any site, so it needs a
  // framing policy of its own. Shopify's helper above sets
  // `frame-ancestors https://<shop> https://admin.shopify.com …` whenever a
  // `shop` search param is present — which would restrict the embed to that
  // shop's admin the moment anyone appended one to the URL. It happens to set no
  // CSP at all without that param, but relying on the absence of a header is
  // exactly the kind of thing that breaks silently later, so state the intent.
  //
  // Only `frame-ancestors` is relaxed, and only for this path. The page is
  // read-only: no auth, no cookies it depends on, no forms, nothing a
  // click-jacking frame could usefully trick a visitor into doing.
  if (new URL(request.url).pathname.startsWith("/viewer/")) {
    responseHeaders.set("Content-Security-Policy", "frame-ancestors *;");
  }
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
