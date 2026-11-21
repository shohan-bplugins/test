import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { framedRedirect } from "~/lib/framed-redirect.server";

import styles from "./styles.module.css";

/*
 * The app's public root — what `application_url` points at.
 *
 * A merchant arriving from the admin never sees it: Shopify always appends
 * ?shop=, and the redirect below hands them straight to the embedded app. What
 * *does* land here is everything else — an App Store reviewer opening the app
 * URL directly, a merchant on a different device, a link someone shared. It
 * shipped as the CLI template's "A short heading about [your app]" placeholder,
 * which is an automatic review failure and, for anyone else, a dead end.
 */

export const meta: MetaFunction = () => [
  { title: "Easy 3D Viewer — interactive 3D product models for Shopify" },
  {
    name: "description",
    content:
      "Show your products in interactive 3D on your Shopify storefront. Upload a GLB or glTF model, drop in a theme block, and shoppers can spin, zoom, and view it in AR — no code required.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    // framedRedirect, not react-router's `redirect()`: the admin frames
    // `application_url`, which is this route, and a bare 302 carries no CSP —
    // which is what lets a proxy's X-Frame-Options refuse this hop before /app's
    // own correct headers are ever reached. See app/lib/framed-redirect.server.ts.
    throw framedRedirect(request, `/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

const FEATURES = [
  {
    title: "Interactive 3D on any product page",
    body: "Upload a GLB or glTF model, assign it to a product, and add the theme block. Shoppers can rotate, pan, and zoom the model right where they decide to buy.",
  },
  {
    title: "AR on phones, out of the box",
    body: "iOS Quick Look and Android Scene Viewer are both wired up, so a shopper can place the product in their own room from the same viewer — nothing extra to configure.",
  },
  {
    title: "Built to keep your store fast",
    body: "A theme app extension, not injected scripts. Viewers load only when they scroll into view, one at a time, and release their resources when they scroll away.",
  },
];

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>
          Show your products in interactive 3D
        </h1>
        <p className={styles.text}>
          3D Viewer turns a GLB or glTF file into a spinnable, zoomable, AR-ready
          model on your Shopify product pages. No theme code, no developer.
        </p>

        {/*
          The demo is the only place an unauthenticated visitor can actually use
          the viewer rather than read about it — a reviewer or a merchant on the
          wrong device lands here, and this is the one link on the page worth
          following before installing anything.
        */}
        <p className={styles.text}>
          <a href="/demo">See the live demo &rarr;</a>
        </p>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="my-shop-domain.myshopify.com"
                autoComplete="on"
                required
              />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}

        <ul className={styles.list}>
          {FEATURES.map((f) => (
            <li key={f.title}>
              <strong>{f.title}</strong>. {f.body}
            </li>
          ))}
        </ul>

        {/*
          Shopify requires a reachable privacy policy and a support contact for
          every listed app, and a reviewer looks for them on the app's own site
          rather than only in the listing form.
        */}
        <p className={styles.text}>
          <a href="https://bplugins.com/contact">Support</a>
          {" · "}
          <a href="https://bplugins.com/privacy-policy">Privacy policy</a>
        </p>
      </div>
    </div>
  );
}
