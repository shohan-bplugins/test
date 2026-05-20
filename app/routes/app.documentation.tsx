import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Boxes,
  FileBox,
  Layers,
  Paintbrush,
  Rocket,
  ScrollText,
  Settings2,
} from "lucide-react";

import { authenticate } from "../shopify.server";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const sections = [
  {
    icon: Rocket,
    title: "Quick start",
    body: (
      <ol className="list-decimal pl-5 space-y-2 text-sm">
        <li>
          Open <Link to="/app/setup" className="text-primary underline">Setup</Link>
          {" "}and run <strong>Create / fix definitions</strong> so the
          required product metafields exist with storefront read access.
        </li>
        <li>
          From the dashboard, open a product and upload a{" "}
          <code className="font-mono text-xs">.glb</code> file. The model is
          stored in Shopify Files and linked to the product.
        </li>
        <li>
          In the theme editor, add the <strong>3D Model Viewer</strong> block
          to your Product template under <em>Add section &rarr; Apps</em>.
        </li>
        <li>
          Tweak per-product settings in the dashboard and watch the live
          preview update. Hit <strong>Save And View</strong> when ready.
        </li>
      </ol>
    ),
  },
  {
    icon: FileBox,
    title: "Model files",
    body: (
      <ul className="list-disc pl-5 space-y-2 text-sm">
        <li>
          Accepted formats: <code className="font-mono text-xs">.glb</code> (recommended) and{" "}
          <code className="font-mono text-xs">.gltf</code>.
        </li>
        <li>Keep files under ~10&nbsp;MB so product pages stay snappy.</li>
        <li>
          Use <strong>Choose from Files</strong> to reassign a model already
          uploaded to Shopify Files.
        </li>
        <li>
          For Apple Quick Look (AR on iOS), upload a separate{" "}
          <code className="font-mono text-xs">.usdz</code> file to Shopify
          Files and paste its URL into the <em>AR &rarr; iOS source URL</em>{" "}
          setting.
        </li>
      </ul>
    ),
  },
  {
    icon: Settings2,
    title: "Per-product viewer settings",
    body: (
      <div className="space-y-3 text-sm">
        <p>
          Every product can override the theme block defaults via{" "}
          <code className="font-mono text-xs">custom.viewer_3d_config</code>
          {" "}(JSON metafield). The dashboard groups them into:
        </p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <li className="border p-2">
            <strong>Display</strong> &mdash; height, background, exposure,
            tone mapping, shadow
          </li>
          <li className="border p-2">
            <strong>Environment</strong> &mdash; skybox / envmap HDR URLs
          </li>
          <li className="border p-2">
            <strong>Camera</strong> &mdash; FOV, yaw, pitch, initial zoom
          </li>
          <li className="border p-2">
            <strong>Controls</strong> &mdash; rotate, pan, zoom, auto-rotate,
            grab cursor, scroll behavior, on-screen control bar
          </li>
          <li className="border p-2">
            <strong>Animation</strong> &mdash; default clip index, repeat mode
          </li>
          <li className="border p-2">
            <strong>AR</strong> &mdash; WebXR, Scene Viewer, Quick Look, iOS
            source URL
          </li>
          <li className="border p-2 sm:col-span-2">
            <strong>Advanced</strong> &mdash; KHR_materials_variants name,
            skinned bounding box fix
          </li>
        </ul>
      </div>
    ),
  },
  {
    icon: Paintbrush,
    title: "Live preview vs storefront",
    body: (
      <ul className="list-disc pl-5 space-y-2 text-sm">
        <li>
          The right-hand preview re-renders instantly as you edit. Save is
          only required to persist the change to the metafield.
        </li>
        <li>
          The <strong>Preview</strong> button opens the storefront with your
          unsaved changes applied via a URL fragment &mdash; nothing is
          persisted.
        </li>
        <li>
          The <strong>Save And View</strong> button saves first, then opens a
          fresh storefront tab. Shopify takes a few seconds to propagate
          metafield writes; the placeholder spinner waits for that.
        </li>
      </ul>
    ),
  },
  {
    icon: Layers,
    title: "Theme block placement",
    body: (
      <ul className="list-disc pl-5 space-y-2 text-sm">
        <li>
          Requires an <strong>Online Store 2.0</strong> theme with a JSON
          product template (Dawn and most modern themes qualify).
        </li>
        <li>
          The block name in the theme editor is <strong>3D Model Viewer</strong>.
          A separate <strong>3D Model Viewer (page)</strong> block accepts a
          direct GLB URL for use on static pages, blogs, or the home page.
        </li>
        <li>
          Leave the block&rsquo;s &ldquo;Manual model URL&rdquo; field empty so
          it falls back to the product metafield.
        </li>
      </ul>
    ),
  },
  {
    icon: Boxes,
    title: "Plan limits",
    body: (
      <ul className="list-disc pl-5 space-y-2 text-sm">
        <li>
          The <strong>Free</strong> plan allows up to <strong>5 products</strong>
          {" "}with an assigned 3D model.
        </li>
        <li>
          Upgrade to <Link to="/app/pricing" className="text-primary underline">Pro or Pro Plus</Link>
          {" "}to lift the limit and unlock priority support.
        </li>
        <li>
          Existing model assignments are never removed on a downgrade &mdash;
          only new uploads beyond the limit are blocked.
        </li>
      </ul>
    ),
  },
  {
    icon: ScrollText,
    title: "Troubleshooting",
    body: (
      <ul className="list-disc pl-5 space-y-2 text-sm">
        <li>
          <strong>Block renders nothing.</strong> The product has no model
          assigned. Upload one or paste a manual URL ending in{" "}
          <code className="font-mono text-xs">.glb</code> /{" "}
          <code className="font-mono text-xs">.gltf</code>.
        </li>
        <li>
          <strong>Storefront ignores your saved changes.</strong> Confirm the
          metafield definitions have <em>Storefront read access</em> enabled
          (run the Setup page button to fix it). Then hard-refresh.
        </li>
        <li>
          <strong>Model appears white.</strong> The viewer is mid-init &mdash;
          a structural option just changed (tone mapping, env map). Wait a
          beat or revert that field.
        </li>
        <li>
          <strong>Pop-up blocked.</strong> Make sure clicking{" "}
          <em>Save And View</em> or <em>Preview</em> is a direct user click
          &mdash; not a programmatic trigger.
        </li>
      </ul>
    ),
  },
];

export default function Documentation() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Documentation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everything you need to embed and customize interactive 3D models on
            your store.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.title}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="size-4" />
                    {s.title}
                  </CardTitle>
                  <CardDescription>{null}</CardDescription>
                </CardHeader>
                <CardContent>{s.body}</CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
