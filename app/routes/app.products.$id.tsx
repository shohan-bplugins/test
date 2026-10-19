import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LinksFunction,
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import {
  invalidateAssignedModels,
  countDistinctModels,
  findConflictingOwner,
  getAssignedModelGids,
  getPlanLimitForShop,
} from "~/lib/billing.server";
import { hotspotsAllowed } from "~/lib/hotspots.server";
import { HotspotsEditor, createHotspot } from "~/components/HotspotsEditor";
import { formatLimit } from "~/lib/billing-constants";
import prisma from "../db.server";
import {
  describeSaving,
  finalSizeError,
  MAX_MODEL_FILE_SIZE_MB,
  MAX_RAW_UPLOAD_MB,
  validateModelFile,
} from "~/lib/files";
import { optimizeModelFile } from "~/lib/optimize-model.server";
import {
  OPTIMIZE_DETAILS,
  useOptimizePreference,
} from "~/components/useOptimizePreference";

import { FilePickerDialog } from "~/components/FilePickerDialog";
import { ViewerPreview, type ViewerConfig } from "~/components/ViewerPreview";
import view3dStylesUrl from "@egjs/view3d/css/view3d-bundle.min.css?url";
import appStylesUrl from "~/app.css?url";
import { parseConfig } from "~/lib/viewer-config";
import type { FileItem } from "~/routes/api.files";
import { ViewerSettings } from "~/components/ViewerSettings";
import { BackButton } from "~/components/BackButton";
import { SupportAction } from "~/components/SupportAction";
import { ConfirmModal } from "~/components/polaris/ConfirmModal";
import { useReviewPrompt } from "~/components/ReviewPrompt";
import { evaluateReviewPrompt } from "~/lib/review-prompt.server";
import { flag, fieldChecked } from "~/components/polaris/helpers";

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

const NS = "custom";
const KEY_MODEL = "model_3d";
const KEY_CONFIG = "viewer_3d_config";

type LoaderData = {
  product: {
    id: string;
    title: string;
    handle: string;
    featuredImage: {
      url: string;
      altText: string | null;
      thumbnailUrl: string | null;
    } | null;
    modelField: {
      id: string;
      value: string;
      reference: { url: string | null } | null;
    } | null;
    configField: { id: string; value: string } | null;
    onlineStoreUrl: string | null;
  } | null;
  config: ViewerConfig;
  shopDomain: string | null;
  /** Free plan: the Hotspots panel shows a PRO lock. */
  hotspotsLocked: boolean;
};

export const loader = async ({
  params,
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const productGid = `gid://shopify/Product/${params.id}`;

  // Alongside the product read, never after it: cached, and independent.
  const allowedP = hotspotsAllowed(admin, session?.shop ?? "");
  const res = await admin.graphql(
    `#graphql
      query ProductDetail($id: ID!) {
        product(id: $id) {
          id title handle
          onlineStoreUrl
          featuredImage {
            url
            altText
            thumbnailUrl: url(transform: { maxWidth: 96, maxHeight: 96 })
          }
          modelField: metafield(namespace: "${NS}", key: "${KEY_MODEL}") {
            id value
            reference {
              ... on GenericFile { url }
              ... on MediaImage { image { url } }
              ... on Model3d {
                originalSource { url }
                sources { url format }
              }
            }
          }
          configField: metafield(namespace: "${NS}", key: "${KEY_CONFIG}") {
            id value
          }
        }
        shop {
          primaryDomain { url }
        }
      }`,
    { variables: { id: productGid } },
  );

  const json = await res.json();
  const product = json?.data?.product ?? null;
  const shopDomain = json?.data?.shop?.primaryDomain?.url ?? null;
  return {
    product,
    config: parseConfig(product?.configField?.value),
    shopDomain,
    hotspotsLocked: !(await allowedP),
  };
};

async function stagedUpload(
  admin: any,
  file: File,
): Promise<{ url: string; resourceUrl: string } | null> {
  const stagedRes = await admin.graphql(
    `#graphql
      mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url resourceUrl
            parameters { name value }
          }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        input: [
          {
            filename: file.name,
            mimeType: file.type || "model/gltf-binary",
            resource: "FILE",
            fileSize: String(file.size),
            httpMethod: "POST",
          },
        ],
      },
    },
  );
  const stagedJson = await stagedRes.json();
  const target = stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) return null;

  const formData = new FormData();
  for (const p of target.parameters) formData.append(p.name, p.value);
  formData.append("file", file);

  const uploadRes = await fetch(target.url, {
    method: "POST",
    body: formData,
  });
  if (!uploadRes.ok) return null;
  return { url: target.url, resourceUrl: target.resourceUrl };
}

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const productGid = `gid://shopify/Product/${params.id}`;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save_config") {
    const rawConfig = String(formData.get("config") ?? "");
    const config = parseConfig(rawConfig);
    /*
     * Hotspots are paid-only. On Free, whatever hotspots the product already
     * has are kept exactly as saved — never the posted ones — so a store that
     * downgraded keeps its work, and nothing new can be added by hand.
     */
    if (!(await hotspotsAllowed(admin, session?.shop ?? ""))) {
      const prev = await admin.graphql(
        `#graphql
          query SavedConfig($id: ID!) {
            product(id: $id) {
              metafield(namespace: "${NS}", key: "${KEY_CONFIG}") { value }
            }
          }`,
        { variables: { id: productGid } },
      );
      const prevJson = await prev.json();
      config.hotspots = parseConfig(
        prevJson?.data?.product?.metafield?.value,
      ).hotspots;
    }
    const setRes = await admin.graphql(
      `#graphql
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: [
            {
              ownerId: productGid,
              namespace: NS,
              key: KEY_CONFIG,
              type: "json",
              value: JSON.stringify(config),
            },
          ],
        },
      },
    );
    const setJson = await setRes.json();
    const errs = setJson?.data?.metafieldsSet?.userErrors ?? [];
    if (errs.length)
      return { ok: false, error: errs.map((e: any) => e.message).join("; ") };
    return {
      ok: true,
      message: "Viewer settings saved",
      reviewPrompt: await evaluateReviewPrompt(
        admin,
        session?.shop ?? "",
        "settings-saved",
        // This product has a model, or there would be nothing to configure.
        { assignedCount: 1 },
      ),
    };
  }

  if (intent === "reset_config") {
    const delRes = await admin.graphql(
      `#graphql
        mutation MetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields { key }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: [{ ownerId: productGid, namespace: NS, key: KEY_CONFIG }],
        },
      },
    );
    const delJson = await delRes.json();
    const errs = delJson?.data?.metafieldsDelete?.userErrors ?? [];
    if (errs.length)
      return { ok: false, error: errs.map((e: any) => e.message).join("; ") };
    return { ok: true, message: "Settings reset to defaults" };
  }

  /**
   * Guards every path that puts a model on this product: a file may only ever
   * be the model of a single product, and new assignments have to fit the
   * plan's product and model caps. Pass the file gid when assigning an existing
   * file; a fresh upload is a brand-new file and can't collide.
   */
  async function checkAssignOrError(
    fileGid: string | null,
  ): Promise<{ ok: false; error: string } | null> {
    const shop = session?.shop ?? "";
    const [phmJson, planLimits, libraryGids, assignedModels] =
      await Promise.all([
        admin
          .graphql(
            `#graphql
              query ProductHasModel($id: ID!) {
                product(id: $id) {
                  metafield(namespace: "${NS}", key: "${KEY_MODEL}") { id }
                }
              }`,
            { variables: { id: productGid } },
          )
          .then((r: any) => r.json()),
        getPlanLimitForShop(shop),
        prisma.model3D.findMany({
          where: { shop },
          select: { fileGid: true },
        }),
        getAssignedModelGids(admin, shop),
      ]);

    if (fileGid) {
      const owner = findConflictingOwner(assignedModels, fileGid, productGid);
      if (owner) {
        return {
          ok: false,
          error: `That 3D model is already assigned to "${owner.title}". Each model can only be used on one product — remove it from that product first, or upload a separate copy of the file.`,
        };
      }
    }

    // Swapping the model on a product that already has one takes no new slot.
    const alreadyAssigned = Boolean(phmJson?.data?.product?.metafield?.id);
    if (alreadyAssigned) return null;

    const { modelLimit, productLimit, planName } = planLimits;
    // One model per product, so the assignment count is also the number of
    // products currently using 3D.
    if (assignedModels.count >= productLimit) {
      return {
        ok: false,
        error: `You've reached your ${planName} plan limit of ${formatLimit(productLimit)} products with a 3D model. Upgrade your plan to add more.`,
      };
    }
    const used = countDistinctModels(
      libraryGids.map((m) => m.fileGid),
      assignedModels.gids,
    );
    if (used >= modelLimit) {
      return {
        ok: false,
        error: `You've reached your ${planName} plan limit of ${formatLimit(modelLimit)} 3D models. Upgrade your plan to add more.`,
      };
    }
    return null;
  }

  /*
   * A model just landed on this product: a review moment (see
   * review-prompt.server.ts). Evaluated only once the save has succeeded, and
   * never able to fail it — a lookup error just means no ask.
   */
  const reviewCheck = () =>
    evaluateReviewPrompt(admin, session?.shop ?? "", "model-assigned", {
      assignedCount: 1,
    });

  if (intent === "assign_existing") {
    const fileGid = String(formData.get("fileGid") ?? "");
    if (!fileGid.startsWith("gid://shopify/")) {
      return { ok: false, error: "Invalid file id" };
    }
    const guardErr = await checkAssignOrError(fileGid);
    if (guardErr) return guardErr;
    const metaRes = await admin.graphql(
      `#graphql
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: [
            {
              ownerId: productGid,
              namespace: NS,
              key: KEY_MODEL,
              type: "file_reference",
              value: fileGid,
            },
          ],
        },
      },
    );
    const metaJson = await metaRes.json();
    const metaErrs = metaJson?.data?.metafieldsSet?.userErrors ?? [];
    if (metaErrs.length) {
      return {
        ok: false,
        error: metaErrs.map((e: any) => e.message).join("; "),
      };
    }
    invalidateAssignedModels(session?.shop ?? "");
    return {
      ok: true,
      message: "3D model assigned from Files",
      reviewPrompt: await reviewCheck(),
    };
  }

  if (intent === "remove") {
    const delRes = await admin.graphql(
      `#graphql
        mutation MetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields { key }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: [{ ownerId: productGid, namespace: NS, key: KEY_MODEL }],
        },
      },
    );
    const delJson = await delRes.json();
    const errs = delJson?.data?.metafieldsDelete?.userErrors ?? [];
    if (errs.length)
      return { ok: false, error: errs.map((e: any) => e.message).join("; ") };
    invalidateAssignedModels(session?.shop ?? "");
    return { ok: true, message: "3D model removed" };
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0)
    return { ok: false, error: "Please choose a .glb or .gltf file" };
  const optimizeUpload = formData.get("optimize") !== "0";
  const fileError = validateModelFile(file, optimizeUpload);
  if (fileError) return { ok: false, error: fileError };

  const guardErr = await checkAssignOrError(null);
  if (guardErr) return guardErr;

  // Smaller and faster to load before it goes anywhere; falls back to the
  // original on any failure. See optimize-model.server.ts.
  const optimized = optimizeUpload
    ? await optimizeModelFile(file)
    : { file, originalSize: file.size, optimized: false };
  // The size limit is on what gets stored, so it is judged after compression.
  const sizeError = finalSizeError(optimized.file.size, file.size);
  if (sizeError) return { ok: false, error: sizeError };
  const staged = await stagedUpload(admin, optimized.file);
  if (!staged) return { ok: false, error: "Failed to upload file to Shopify" };

  const fileCreateRes = await admin.graphql(
    `#graphql
      mutation FileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id ... on GenericFile { url } }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        files: [
          {
            originalSource: staged.resourceUrl,
            contentType: "FILE",
            alt: `3D model for product ${params.id}`,
          },
        ],
      },
    },
  );
  const fileJson = await fileCreateRes.json();
  const fileErrs = fileJson?.data?.fileCreate?.userErrors ?? [];
  if (fileErrs.length)
    return { ok: false, error: fileErrs.map((e: any) => e.message).join("; ") };
  const fileGid = fileJson?.data?.fileCreate?.files?.[0]?.id;
  if (!fileGid) return { ok: false, error: "Shopify did not return a file id" };

  const metaRes = await admin.graphql(
    `#graphql
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: productGid,
            namespace: NS,
            key: KEY_MODEL,
            type: "file_reference",
            value: fileGid,
          },
        ],
      },
    },
  );
  const metaJson = await metaRes.json();
  const metaErrs = metaJson?.data?.metafieldsSet?.userErrors ?? [];
  if (metaErrs.length)
    return { ok: false, error: metaErrs.map((e: any) => e.message).join("; ") };

  invalidateAssignedModels(session?.shop ?? "");
  const saving = describeSaving(optimized.originalSize, optimized.file.size);
  return {
    ok: true,
    message: saving
      ? `3D model uploaded and assigned · ${saving}`
      : "3D model uploaded and assigned",
    reviewPrompt: await reviewCheck(),
  };
};

/**
 * Fill a just-opened tab with a holding message while a save propagates.
 *
 * The tab has to be opened synchronously inside the click to survive popup
 * blocking, which means it exists several seconds before there is anywhere to
 * send it. Written with document.write rather than by pointing it at a route of
 * this app: the tab's final destination is the merchant's storefront, and
 * loading an admin page into it first would leave the wrong origin in history.
 */
/**
 * A short, stable token for a string — djb2.
 *
 * Used as the preview link's cache-buster. It has to be deterministic so the
 * server and the browser render the same href; anything derived from the clock
 * or from Math.random would differ between the two and break hydration.
 */
function hashToken(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function writeInterstitial(w: Window, message: string) {
  try {
    w.document.write(
      `<!DOCTYPE html><html><head><title>${message}</title><style>html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7f7;color:#555}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem}.spinner{width:32px;height:32px;border:3px solid #ddd;border-top-color:#000;border-radius:50%;animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="spinner"></div><p>${message}</p></body></html>`,
    );
    w.document.close();
  } catch {
    // A blocked or already-closed window; the redirect below still tries.
  }
}

export default function ProductDetail() {
  const {
    product,
    config: savedConfig,
    shopDomain,
    hotspotsLocked,
  } = useLoaderData<typeof loader>();
  // Hotspots: placement mode, and "preview this one" in the live preview.
  const [placingHotspot, setPlacingHotspot] = useState(false);
  const [hotspotFocus, setHotspotFocus] = useState<{
    id: string;
    n: number;
  } | null>(null);

  const actionData = useActionData<typeof action>();
  useReviewPrompt(
    actionData && "reviewPrompt" in actionData ? actionData.reviewPrompt : null,
  );
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const submitting = navigation.state === "submitting";

  const [config, setConfig] = useState<ViewerConfig>(savedConfig);
  const [showProductImage, setShowProductImage] = useState(false);
  const lastSaveTimeRef = useRef(0);
  const pendingSaveViewWindowRef = useRef<Window | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [optimize, setOptimize] = useOptimizePreference();
  // Which destructive action is awaiting confirmation, if any.
  const [pending, setPending] = useState<"remove" | "reset" | null>(null);

  function handleFilePicked(file: FileItem) {
    const fd = new FormData();
    fd.set("intent", "assign_existing");
    fd.set("fileGid", file.id);
    submit(fd, { method: "post" });
  }

  /** Upload whatever the drop zone received, whether dropped or chosen. */
  function handleFileChosen(event: Event) {
    const input = event.currentTarget as HTMLElement & {
      files?: FileList | null;
    };
    const file = input.files?.[0];
    if (!file) return;
    const fileError = validateModelFile(file, optimize);
    if (fileError) {
      shopify.toast.show(fileError, { isError: true });
      return;
    }
    const fd = new FormData();
    fd.set("intent", "upload");
    fd.set("file", file);
    fd.set("optimize", optimize ? "1" : "0");
    submit(fd, { method: "post", encType: "multipart/form-data" });
  }

  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig],
  );

  /*
   * Keyed on the serialised config, not the object — see the same effect in
   * app.models.$id.tsx for what depending on the object identity does. Short
   * version: useLoaderData returns a fresh object each render in the production
   * build, so this effect re-ran forever and rebuilt the page header faster
   * than anything in it could be clicked.
   */
  const savedConfigKey = JSON.stringify(savedConfig);
  useEffect(() => {
    setConfig(savedConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedConfigKey]);

  useEffect(() => {
    if (actionData?.ok) {
      lastSaveTimeRef.current = Date.now();
      shopify.toast.show(actionData.message ?? "Saved");

      const base =
        product?.onlineStoreUrl ??
        (shopDomain && product?.handle
          ? `${shopDomain}/products/${product.handle}`
          : null);
      if (base) {
        const primeUrl = `${base}${base.includes("?") ? "&" : "?"}_prime=${Date.now()}`;
        try {
          fetch(primeUrl, { mode: "no-cors", cache: "reload" }).catch(() => {});
        } catch {
          // ignore
        }
      }

      const pendingWindow = pendingSaveViewWindowRef.current;
      if (pendingWindow && base) {
        pendingSaveViewWindowRef.current = null;
        const sep = base.includes("?") ? "&" : "?";
        const url = `${base}${sep}_v=${Date.now()}`;
        window.setTimeout(() => {
          try {
            pendingWindow.location.href = url;
          } catch {
            // best-effort
          }
        }, 3500);
      }
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
      const pendingWindow = pendingSaveViewWindowRef.current;
      if (pendingWindow) {
        pendingSaveViewWindowRef.current = null;
        try {
          pendingWindow.close();
        } catch {
          // ignore
        }
      }
    }
  }, [actionData, shopify, product, shopDomain]);

  if (!product) {
    return (
      <s-page heading="Product not found">
        <BackButton to="/app/products" label="Product 3D models" />
        <SupportAction />

        <s-section>
          <s-banner tone="critical">
            <s-paragraph>
              The requested product could not be loaded.
            </s-paragraph>
          </s-banner>
          <s-button
            slot="primary-action"
            variant="primary"
            href="/app/products"
            onClick={(event) => {
              event.preventDefault();
              navigate("/app/products");
            }}
          >
            Back to products
          </s-button>
        </s-section>
      </s-page>
    );
  }

  const has = Boolean(product.modelField?.value);
  const ref = product.modelField?.reference as any;
  // Resolution order mirrors product_viewer.liquid's exactly, so the preview
  // loads the same file the storefront will. It matters for Model3d
  // references: Shopify transcodes uploaded 3D media, and `sources` (what
  // Liquid can reach) is the transcoded GLB while `originalSource` is the raw
  // upload — preferring originalSource here meant the merchant was tuning
  // exposure/camera against a different asset than their customers see, and
  // for a non-glTF upload (.obj, .fbx) it isn't even loadable. Matched on the
  // `format` field rather than sniffing the URL for ".glb" for the same
  // reason: that's what Liquid keys off.
  const glbSource = Array.isArray(ref?.sources)
    ? ref.sources.find((s: any) => {
        const format = String(s?.format ?? "").toLowerCase();
        return format === "glb" || format === "gltf";
      })
    : null;
  const modelUrl: string | null =
    ref?.url ??
    glbSource?.url ??
    ref?.originalSource?.url ??
    (Array.isArray(ref?.sources) ? (ref.sources[0]?.url ?? null) : null) ??
    ref?.image?.url ??
    null;
  const configCustomized = Boolean(product.configField?.value);

  function handleSaveConfig() {
    const fd = new FormData();
    fd.set("intent", "save_config");
    fd.set("config", JSON.stringify(config));
    submit(fd, { method: "post" });
  }

  function confirmPending() {
    const fd = new FormData();
    fd.set("intent", pending === "remove" ? "remove" : "reset_config");
    submit(fd, { method: "post" });
    setPending(null);
  }

  const storefrontBase =
    product.onlineStoreUrl ??
    (shopDomain && product.handle
      ? `${shopDomain}/products/${product.handle}`
      : null);

  /*
   * The storefront with the *unsaved* config applied via URL fragment, built
   * during render so the button can be a real link.
   *
   * It used to be a window.open() in a click handler, and that is what made
   * Preview fail intermittently: this page runs inside the admin's iframe, so a
   * scripted popup needs the frame to have been granted popups *and* the
   * browser to credit the call to the user's gesture. When either fails,
   * window.open returns null and the click does nothing at all — no tab, no
   * error, nothing to report. An anchor with target="_blank" is attributed to
   * the user directly and is never blocked; it is also what App Bridge handles
   * on the app's behalf, and what the model page's Preview already uses.
   *
   * The cache-buster is derived from the config rather than from Date.now().
   * Two reasons: this page is server-rendered, and a clock read during render
   * disagrees between server and client, which React reports as a hydration
   * mismatch. And a token that changes only when the settings change is the
   * more correct cache key anyway — the storefront should be refetched when
   * there is something new to show, not on every render.
   */
  const previewConfigJson = JSON.stringify(config);
  const previewUrl = storefrontBase
    ? `${storefrontBase}${storefrontBase.includes("?") ? "&" : "?"}` +
      `_v=${hashToken(previewConfigJson)}` +
      `#preview_config=${encodeURIComponent(previewConfigJson)}`
    : null;

  /*
   * Save, wait for the storefront cache to catch up, then show it.
   *
   * The window is opened synchronously inside the click, never after the
   * action resolves: a popup opened from an async continuation is not tied to
   * a user gesture and browsers block it silently. It holds an interstitial
   * until the save lands, which is why it is opened on about:blank first.
   */
  function handleSaveAndView() {
    if (!storefrontBase) return;
    const name = `viewer-3d-storefront-${product!.id}`;
    const sep = storefrontBase.includes("?") ? "&" : "?";

    if (!dirty) {
      const elapsed = Date.now() - lastSaveTimeRef.current;
      const url = `${storefrontBase}${sep}_v=${Date.now()}`;
      if (elapsed >= 4000) {
        window.open(url, name)?.focus();
        return;
      }
      const w = window.open("about:blank", name);
      if (!w) return;
      w.focus();
      writeInterstitial(w, "Publishing changes to the storefront…");
      window.setTimeout(
        () => {
          try {
            w.location.href = url;
          } catch {
            // The tab may have been closed; nothing to recover.
          }
        },
        Math.max(0, 4000 - elapsed),
      );
      return;
    }

    const w = window.open("about:blank", name);
    if (!w) return;
    w.focus();
    writeInterstitial(w, "Saving and publishing changes…");
    pendingSaveViewWindowRef.current = w;
    handleSaveConfig();
  }

  return (
    <s-page heading={product.title}>
      <BackButton to="/app/products" label="Product 3D models" />

      {/*
        The admin's contextual save bar owns saving, so the page header carries
        only actions that are not "save". It also guards navigation away from
        unsaved settings, which the old header button could not do.
      */}
      <SaveBar id="product-save-bar" open={dirty}>
        <button
          variant="primary"
          onClick={handleSaveConfig}
          loading={submitting ? "" : undefined}
        />
        <button onClick={() => setConfig(savedConfig)} />
      </SaveBar>

      {previewUrl ? (
        <s-button
          slot="primary-action"
          variant="primary"
          icon="view"
          href={previewUrl}
          target="_blank"
        >
          Preview
        </s-button>
      ) : null}
      {storefrontBase ? (
        <s-button
          slot="secondary-actions"
          icon="external"
          disabled={flag(submitting)}
          onClick={handleSaveAndView}
        >
          Save and view
        </s-button>
      ) : null}
      {configCustomized ? (
        <s-button
          slot="secondary-actions"
          icon="reset"
          disabled={flag(submitting)}
          onClick={() => setPending("reset")}
        >
          Reset to defaults
        </s-button>
      ) : null}
      <SupportAction />

      <FilePickerDialog
        open={filePickerOpen}
        onOpenChange={setFilePickerOpen}
        currentUrl={modelUrl}
        onSelect={handleFilePicked}
        productId={product.id}
        blockAssigned
      />

      <ConfirmModal
        id="product-confirm"
        open={pending !== null}
        heading={
          pending === "remove" ? "Remove 3D model?" : "Reset viewer settings?"
        }
        confirmLabel={pending === "remove" ? "Remove model" : "Reset settings"}
        loading={submitting}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      >
        <s-paragraph>
          {pending === "remove"
            ? "The product stops showing a 3D model on your storefront. The .glb file itself stays in Shopify Files and can be reassigned later."
            : "Every viewer setting for this product goes back to its default. The assigned model file is untouched."}
        </s-paragraph>
      </ConfirmModal>

      <s-section>
        <s-stack direction="inline" gap="small" alignItems="center">
          {product.featuredImage?.url ? (
            <s-thumbnail
              src={
                product.featuredImage.thumbnailUrl ?? product.featuredImage.url
              }
              alt=""
              size="small"
            />
          ) : null}
          <s-text color="subdued">
            {has ? "3D model assigned" : "No model assigned"}
          </s-text>
          {configCustomized ? <s-badge tone="info">Customized</s-badge> : null}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Model file">
        <s-paragraph color="subdued">
          Upload a .glb or .gltf model. The stored file can be up to{" "}
          {MAX_MODEL_FILE_SIZE_MB} MB; with optimization on, you can upload up
          to {MAX_RAW_UPLOAD_MB} MB and it must compress to{" "}
          {MAX_MODEL_FILE_SIZE_MB} MB or less. Stored in Shopify Files, linked
          via <code>custom.model_3d</code>.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          {has && modelUrl ? (
            <s-box background="subdued" padding="small" borderRadius="base">
              <s-text color="subdued">
                <code>
                  <div style={{ wordBreak: "break-all" }}>{modelUrl}</div>
                </code>
              </s-text>
            </s-box>
          ) : null}

          {/*
            The drop zone doubles as the upload button — clicking it opens the
            file dialog — so there is no separate hidden <input> and <Form> to
            keep in sync, and the file posts straight through useSubmit.
          */}
          <s-drop-zone
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            label={
              has
                ? "Drop a replacement .glb or .gltf here, or click to choose"
                : "Drop a .glb or .gltf file here, or click to choose"
            }
            disabled={flag(submitting)}
            onInput={handleFileChosen}
          />
          <s-checkbox
            label="Optimize for faster loading"
            details={OPTIMIZE_DETAILS}
            checked={flag(optimize)}
            onInput={(e) => setOptimize(fieldChecked(e))}
          />

          <s-stack direction="inline" gap="small" alignItems="center">
            <s-button
              icon="folder"
              disabled={flag(submitting)}
              onClick={() => setFilePickerOpen(true)}
              accessibilityLabel="Choose a 3D model from Shopify Files"
            >
              Choose from Files
            </s-button>
            {has ? (
              <s-button
                tone="critical"
                icon="delete"
                disabled={flag(submitting)}
                onClick={() => setPending("remove")}
              >
                Remove
              </s-button>
            ) : null}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Viewer settings">
        <s-paragraph color="subdued">
          Saved to <code>custom.viewer_3d_config</code>. The storefront viewer
          uses these instead of the theme block defaults.
        </s-paragraph>
        {/*
          The shared panel, not a second copy. This screen used to inline all
          eight setting groups verbatim from ViewerSettings — roughly 500 lines
          that had to be edited twice for every change, and had already drifted
          (its colour fallback and default-open states differed).
        */}
        <ViewerSettings config={config} onChange={setConfig} />
      </s-section>

      <s-section slot="aside" heading="Hotspots">
        <HotspotsEditor
          config={config}
          onChange={setConfig}
          placing={placingHotspot}
          onPlacingChange={setPlacingHotspot}
          onPreview={(id) =>
            setHotspotFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }))
          }
          locked={hotspotsLocked}
        />
      </s-section>

      {/*
        The preview owns the wide main column and the controls sit in the aside.
        s-page's aside is the admin's narrow (~1/3) column, so hosting the
        viewer there squeezed the canvas into a third of the page while the
        settings form took two thirds — the inverse of the 33/67 split this
        screen was designed around, and of what the merchant is actually looking
        at while they tune it.
      */}
      {/*
        Sticky, so the canvas stays in view while the merchant works down the
        settings column beside it — the whole point of a live preview is seeing
        a change land, which is no use if tweaking a control near the bottom of
        the form has scrolled the viewer off screen.

        A plain div, and wrapping the section rather than sitting inside it:
        Polaris's Box exposes no position or inset props, and the sticky element
        has to be the column's own child so its containing block is the full
        column — the two columns share a grid row, so this one is as tall as the
        settings beside it and there is room to stick. Nested inside the section
        it could only stick within that card's own height, which is to say not
        at all.
      */}
      <div style={{ position: "sticky", top: 16 }}>
        <s-section heading="Live preview">
          <s-paragraph color="subdued">
            Updates instantly. Save to persist.
          </s-paragraph>
          <ViewerPreview
            modelUrl={modelUrl}
            config={config}
            arShareUrl={storefrontBase}
            onLayoutChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
            placingHotspot={placingHotspot}
            onPlaceHotspot={(anchor) => {
              setConfig((c) => ({
                ...c,
                hotspots: [
                  ...c.hotspots,
                  createHotspot(anchor, c.hotspots.length),
                ],
              }));
              setPlacingHotspot(false);
            }}
            focusHotspotId={hotspotFocus?.id ?? null}
            focusNonce={hotspotFocus?.n ?? 0}
          />
        </s-section>
      </div>

      {/* {product.featuredImage?.url ? (
        <s-section slot="aside" heading="Product image">
          <s-switch
            label="Show product image"
            checked={flag(showProductImage)}
            onInput={(e) => setShowProductImage(fieldChecked(e))}
          />
          {showProductImage ? (
            <s-image
              src={product.featuredImage.url}
              alt={product.featuredImage.altText ?? product.title}
            />
          ) : null}
        </s-section>
      ) : null} */}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
