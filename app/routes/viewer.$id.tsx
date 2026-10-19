import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
  HeadersFunction,
} from "react-router";
import { useLoaderData } from "react-router";

import { ViewerPreview } from "~/components/ViewerPreview";
import { useEmbedStats } from "~/lib/embed-stats";
import view3dStylesUrl from "@egjs/view3d/css/view3d-bundle.min.css?url";
import appStylesUrl from "~/app.css?url";
import prisma from "../db.server";
import { parseConfig } from "~/lib/viewer-config";
import { applyViewerOverrides } from "~/lib/viewer-overrides";
import { resolveAppOrigin } from "~/lib/app-origin.server";

// Moved off root's global links: only the routes that mount ViewerPreview need
// view3d's stylesheet, and it still loads with the route so the canvas is never
// briefly unstyled.
export const links: LinksFunction = () => [
  // app.css is Tailwind plus the viewer's own styling. ViewerPreview is the
  // only thing left in the app that uses either, so it loads here rather than
  // globally — which also keeps Tailwind's preflight away from the Polaris
  // components every other admin page is built from.
  { rel: "stylesheet", href: appStylesUrl },
  { rel: "stylesheet", href: view3dStylesUrl },
];

/*
 * Public, embeddable viewer for one saved model, addressed by its Model3D id:
 *
 *   /viewer/<id>
 *
 * Deliberately unauthenticated — the whole point is that the URL can be shared
 * or dropped into an <iframe> on any site. The id is a v4 uuid, so it isn't
 * guessable, and the loader returns only what's needed to render (name, file
 * URL, viewer config); the owning shop is never exposed.
 *
 * Before this route existed the model page's "Embed URL" pointed straight at the
 * .glb file with the config in the hash, which just made the browser download or
 * blank-screen the file — there was no page to render it.
 */

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const model = await prisma.model3D.findUnique({
    where: { id },
    // An explicit select rather than the whole row: `shop` and the file GID are
    // nobody else's business on a public endpoint.
    select: { id: true, name: true, fileUrl: true, config: true },
  });

  if (!model) throw new Response("Model not found", { status: 404 });

  /*
   * Where a desktop visitor's phone should go for AR: this page, standalone.
   * ViewerPreview's own default reads window.location, and gives up when the
   * page is framed — right for the Shopify admin, whose address no phone can
   * open, but every embed code is a frame too, so on a desktop embed the AR
   * button (a QR code there) vanished. This page needs no login and opens on
   * any phone, so it is always the answer here. The public origin, not the
   * request's (behind the VPS proxy that is an internal address); ?bg= and
   * ?autorotate= kept so the phone shows the same look.
   */
  const requestUrl = new URL(request.url);
  const share = new URL(`/viewer/${encodeURIComponent(model.id)}`, resolveAppOrigin(request));
  for (const key of ["bg", "autorotate"]) {
    const value = requestUrl.searchParams.get(key);
    if (value !== null) share.searchParams.set(key, value);
  }

  return {
    arShareUrl: share.href,
    model: { id: model.id, name: model.name, fileUrl: model.fileUrl },
    config: applyViewerOverrides(
      parseConfig(model.config),
      new URL(request.url),
    ),
  };
};

// Long-lived immutable assets, but the page itself is a small, cheap document
// that must reflect config edits promptly — hence a short cache with
// stale-while-revalidate rather than no-store.
export const headers: HeadersFunction = () => ({
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
});

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const name = data?.model?.name;
  return [
    { title: name ? `${name} — 3D viewer` : "3D viewer" },
    // Not useful in search results, and it's someone's product asset.
    { name: "robots", content: "noindex" },
  ];
};

export default function PublicViewer() {
  const { model, config, arShareUrl } = useLoaderData<typeof loader>();
  const stats = useEmbedStats(model.id);

  return (
    // h-dvh, not h-screen: on mobile browsers the dynamic viewport unit accounts
    // for the collapsing address bar, so the viewer isn't cropped on load.
    <main ref={stats.ref} className="h-dvh w-full overflow-hidden bg-background">
      <ViewerPreview
        modelUrl={model.fileUrl}
        config={config}
        // Fills the window, or the <iframe> when embedded, instead of the
        // configured height — the container decides the size here.
        fill
        onTrack={stats.track}
        arShareUrl={arShareUrl}
        // A refusal on this page means a document *around* this one didn't grant
        // fullscreen, which is a different cause from the admin's. Named as the
        // whole chain rather than just the embedding page because the permission
        // has to be delegated at every level: the theme editor renders the
        // storefront in an iframe of its own that grants nothing, so an embed
        // that works perfectly on the live page still refuses inside the editor
        // preview — and the first thing anyone does is re-check the attribute
        // they already got right.
        fullscreenUnavailableMessage={
          "Fullscreen isn't allowed here \u2014 every frame around this viewer has to grant it. Check allowfullscreen on the embedding <iframe>, and test on the live page: Shopify's theme editor preview never grants it."
        }
        className="border-0 shadow-none"
      />
    </main>
  );
}
