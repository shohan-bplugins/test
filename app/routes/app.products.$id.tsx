import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  ArrowLeft,
  Box,
  Camera,
  ChevronDown,
  Cog,
  Eye,
  ExternalLink,
  Film,
  FolderOpen,
  Palette,
  PlaySquare,
  Smartphone,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";

import { authenticate } from "../shopify.server";
import {
  countAssignedModels,
  getPlanLimitForShop,
} from "~/lib/billing.server";

import { FilePickerDialog } from "~/components/FilePickerDialog";
import { ViewerPreview, type ViewerConfig } from "~/components/ViewerPreview";
import type { FileItem } from "~/routes/api.files";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";

const NS = "custom";
const KEY_MODEL = "model_3d";
const KEY_CONFIG = "viewer_3d_config";

const TONE_MAPPINGS = [
  "None",
  "Linear",
  "Reinhard",
  "Cineon",
  "ACESFilmic",
] as const;
const REPEAT_MODES = ["one", "all", "none"] as const;

const DEFAULT_CONFIG: ViewerConfig = {
  height: 500,
  background: "#f4f4f4",
  exposure: 1,
  toneMapping: "Linear",
  useDefaultEnv: true,
  skyboxBlur: false,
  skybox: "",
  envmap: "",
  fovMode: "auto",
  fov: 45,
  yaw: 0,
  pitch: 0,
  initialZoom: 0,
  rotate: true,
  translate: true,
  zoom: true,
  autoRotate: true,
  scrollable: true,
  wheelScrollable: false,
  useGrabCursor: true,
  showControls: true,
  defaultAnimationIndex: 0,
  animationRepeatMode: "one",
  webAR: true,
  sceneViewer: true,
  quickLook: true,
  iosSrc: "",
  variant: "",
  fixSkinnedBbox: false,
  shadow: true,
  maintainSize: false,
};

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function parseConfig(raw: string | undefined | null): ViewerConfig {
  if (!raw) return { ...DEFAULT_CONFIG };
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };

  const out: ViewerConfig = { ...DEFAULT_CONFIG };
  if (typeof parsed.height === "number")
    out.height = clamp(parsed.height, 200, 1200);
  if (typeof parsed.background === "string") out.background = parsed.background;
  if (typeof parsed.exposure === "number")
    out.exposure = clamp(parsed.exposure, 0, 5);
  if ((TONE_MAPPINGS as readonly string[]).includes(parsed.toneMapping))
    out.toneMapping = parsed.toneMapping;
  if (typeof parsed.useDefaultEnv === "boolean")
    out.useDefaultEnv = parsed.useDefaultEnv;
  if (typeof parsed.skyboxBlur === "boolean") out.skyboxBlur = parsed.skyboxBlur;
  if (typeof parsed.skybox === "string") out.skybox = parsed.skybox;
  if (typeof parsed.envmap === "string") out.envmap = parsed.envmap;
  if (parsed.fovMode === "auto" || parsed.fovMode === "custom")
    out.fovMode = parsed.fovMode;
  if (typeof parsed.fov === "number") out.fov = clamp(parsed.fov, 1, 179);
  if (typeof parsed.yaw === "number") out.yaw = clamp(parsed.yaw, -360, 360);
  if (typeof parsed.pitch === "number")
    out.pitch = clamp(parsed.pitch, -90, 90);
  if (typeof parsed.initialZoom === "number")
    out.initialZoom = clamp(parsed.initialZoom, -100, 100);
  if (typeof parsed.rotate === "boolean") out.rotate = parsed.rotate;
  if (typeof parsed.translate === "boolean") out.translate = parsed.translate;
  if (typeof parsed.zoom === "boolean") out.zoom = parsed.zoom;
  if (typeof parsed.autoRotate === "boolean") out.autoRotate = parsed.autoRotate;
  if (typeof parsed.scrollable === "boolean") out.scrollable = parsed.scrollable;
  if (typeof parsed.wheelScrollable === "boolean")
    out.wheelScrollable = parsed.wheelScrollable;
  if (typeof parsed.useGrabCursor === "boolean")
    out.useGrabCursor = parsed.useGrabCursor;
  if (typeof parsed.showControls === "boolean")
    out.showControls = parsed.showControls;
  if (typeof parsed.defaultAnimationIndex === "number")
    out.defaultAnimationIndex = clamp(parsed.defaultAnimationIndex, 0, 99);
  if ((REPEAT_MODES as readonly string[]).includes(parsed.animationRepeatMode))
    out.animationRepeatMode = parsed.animationRepeatMode;
  if (typeof parsed.webAR === "boolean") out.webAR = parsed.webAR;
  if (typeof parsed.sceneViewer === "boolean")
    out.sceneViewer = parsed.sceneViewer;
  if (typeof parsed.quickLook === "boolean") out.quickLook = parsed.quickLook;
  if (typeof parsed.iosSrc === "string") out.iosSrc = parsed.iosSrc;
  if (typeof parsed.variant === "string") out.variant = parsed.variant;
  if (typeof parsed.fixSkinnedBbox === "boolean")
    out.fixSkinnedBbox = parsed.fixSkinnedBbox;
  if (typeof parsed.shadow === "boolean") out.shadow = parsed.shadow;
  if (typeof parsed.maintainSize === "boolean")
    out.maintainSize = parsed.maintainSize;
  return out;
}

type LoaderData = {
  product: {
    id: string;
    title: string;
    handle: string;
    featuredImage: { url: string; altText: string | null } | null;
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
};

export const loader = async ({
  params,
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin } = await authenticate.admin(request);
  const productGid = `gid://shopify/Product/${params.id}`;

  const res = await admin.graphql(
    `#graphql
      query ProductDetail($id: ID!) {
        product(id: $id) {
          id title handle
          onlineStoreUrl
          featuredImage { url altText }
          modelField: metafield(namespace: "${NS}", key: "${KEY_MODEL}") {
            id value
            reference {
              ... on GenericFile { url }
              ... on MediaImage { image { url } }
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
    return { ok: true, message: "Viewer settings saved" };
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

  async function checkLimitOrError(): Promise<{
    ok: false;
    error: string;
  } | null> {
    const shop = session?.shop ?? "";
    const productHasModelRes = await admin.graphql(
      `#graphql
        query ProductHasModel($id: ID!) {
          product(id: $id) {
            metafield(namespace: "${NS}", key: "${KEY_MODEL}") { id }
          }
        }`,
      { variables: { id: productGid } },
    );
    const phmJson = await productHasModelRes.json();
    const alreadyAssigned = Boolean(
      phmJson?.data?.product?.metafield?.id,
    );
    if (alreadyAssigned) return null;

    const [{ limit, planName }, used] = await Promise.all([
      getPlanLimitForShop(shop),
      countAssignedModels(admin, shop),
    ]);
    if (used >= limit) {
      return {
        ok: false,
        error: `You've reached your ${planName} plan limit of ${limit} 3D models. Upgrade your plan to add more.`,
      };
    }
    return null;
  }

  if (intent === "assign_existing") {
    const fileGid = String(formData.get("fileGid") ?? "");
    if (!fileGid.startsWith("gid://shopify/")) {
      return { ok: false, error: "Invalid file id" };
    }
    const limitErr = await checkLimitOrError();
    if (limitErr) return limitErr;
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
    return { ok: true, message: "3D model assigned from Files" };
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
    return { ok: true, message: "3D model removed" };
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0)
    return { ok: false, error: "Please choose a .glb or .gltf file" };
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".glb") && !lower.endsWith(".gltf"))
    return { ok: false, error: "Only .glb or .gltf files are supported" };

  const limitErr = await checkLimitOrError();
  if (limitErr) return limitErr;

  const staged = await stagedUpload(admin, file);
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

  return { ok: true, message: "3D model uploaded and assigned" };
};

function CollapsibleSection({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <details
      open
      className="group border bg-card shadow-sm overflow-hidden"
    >
      <summary className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none list-none hover:bg-accent/40 transition-colors [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="size-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">{title}</div>
            {description && (
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {description}
              </div>
            )}
          </div>
        </div>
        <ChevronDown className="size-3.5 text-muted-foreground shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t px-3 py-2 space-y-0.5">{children}</div>
    </details>
  );
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-center py-1.5">
      <div>
        <div className="text-xs font-medium">{label}</div>
        {description && (
          <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            {description}
          </div>
        )}
      </div>
      <div className="min-w-[160px] flex justify-start sm:justify-end">
        {children}
      </div>
    </div>
  );
}

export default function ProductDetail() {
  const { product, config: savedConfig, shopDomain } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const submitting = navigation.state === "submitting";

  const [config, setConfig] = useState<ViewerConfig>(savedConfig);
  const [showProductImage, setShowProductImage] = useState(false);
  const [leftPct, setLeftPct] = useState(33);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFormRef = useRef<HTMLFormElement>(null);
  const lastSaveTimeRef = useRef(0);
  const pendingSaveViewWindowRef = useRef<Window | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);

  function handleFilePicked(file: FileItem) {
    const fd = new FormData();
    fd.set("intent", "assign_existing");
    fd.set("fileGid", file.id);
    submit(fd, { method: "post" });
  }

  function handleFileChosen() {
    uploadFormRef.current?.requestSubmit();
  }

  function startDragSplitter(e: React.MouseEvent) {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(70, Math.max(20, pct)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }
  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig],
  );

  useEffect(() => {
    setConfig(savedConfig);
  }, [savedConfig]);

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
      <div className="min-h-screen bg-background p-8">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>Product not found</CardTitle>
            <CardDescription>
              The requested product could not be loaded.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/app/products">Back to products</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const has = Boolean(product.modelField?.value);
  const modelUrl = product.modelField?.reference?.url ?? null;
  const configCustomized = Boolean(product.configField?.value);

  function update<K extends keyof ViewerConfig>(key: K, value: ViewerConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
  }

  function handleSaveConfig() {
    const fd = new FormData();
    fd.set("intent", "save_config");
    fd.set("config", JSON.stringify(config));
    submit(fd, { method: "post" });
  }

  function handleResetConfig() {
    const fd = new FormData();
    fd.set("intent", "reset_config");
    submit(fd, { method: "post" });
  }

  return (
    <div className="min-h-screen bg-background">
      <FilePickerDialog
        open={filePickerOpen}
        onOpenChange={setFilePickerOpen}
        currentUrl={modelUrl}
        onSelect={handleFilePicked}
      />
      <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Button variant="ghost" size="icon" asChild>
                <Link to="/app/products" aria-label="Back to products">
                  <ArrowLeft />
                </Link>
              </Button>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">
                  {product.title}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {has ? "3D model assigned" : "No model assigned"}
                  {configCustomized && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Customized
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {configCustomized && (
                <Button
                  variant="outline"
                  onClick={handleResetConfig}
                  disabled={submitting}
                >
                  <Trash2 /> Reset to defaults
                </Button>
              )}
              {(product.onlineStoreUrl || shopDomain) && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        onClick={() => {
                          const base =
                            product.onlineStoreUrl ??
                            `${shopDomain}/products/${product.handle}`;
                          const sep = base.includes("?") ? "&" : "?";
                          const hash = encodeURIComponent(
                            JSON.stringify(config),
                          );
                          const url = `${base}${sep}_v=${Date.now()}#preview_config=${hash}`;
                          const name = `viewer-3d-preview-${product.id}`;
                          const w = window.open(url, name);
                          w?.focus();
                        }}
                      >
                        <Eye /> Preview
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Open the storefront with your unsaved changes applied
                      via URL fragment. Nothing is persisted.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <Button
                onClick={handleSaveConfig}
                disabled={submitting || !dirty}
              >
                {submitting ? "Saving…" : dirty ? "Save settings" : "Saved"}
              </Button>
              {(product.onlineStoreUrl || shopDomain) && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={submitting}
                        onClick={(e) => {
                          e.preventDefault();
                          const base =
                            product.onlineStoreUrl ??
                            `${shopDomain}/products/${product.handle}`;
                          const sep = base.includes("?") ? "&" : "?";
                          const name = `viewer-3d-storefront-${product.id}`;

                          if (!dirty) {
                            const elapsed =
                              Date.now() - lastSaveTimeRef.current;
                            const url = `${base}${sep}_v=${Date.now()}`;
                            if (elapsed >= 4000) {
                              const w = window.open(url, name);
                              w?.focus();
                              return;
                            }
                            const w = window.open("about:blank", name);
                            if (!w) return;
                            w.focus();
                            try {
                              w.document.write(
                                `<!DOCTYPE html><html><head><title>Publishing…</title><style>html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7f7;color:#555}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem}.spinner{width:32px;height:32px;border:3px solid #ddd;border-top-color:#000;border-radius:50%;animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="spinner"></div><p>Publishing changes to the storefront…</p></body></html>`,
                              );
                              w.document.close();
                            } catch {}
                            window.setTimeout(() => {
                              try {
                                w.location.href = url;
                              } catch {}
                            }, Math.max(0, 4000 - elapsed));
                            return;
                          }

                          const w = window.open("about:blank", name);
                          if (!w) return;
                          w.focus();
                          try {
                            w.document.write(
                              `<!DOCTYPE html><html><head><title>Saving and publishing…</title><style>html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7f7;color:#555}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem}.spinner{width:32px;height:32px;border:3px solid #ddd;border-top-color:#000;border-radius:50%;animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="spinner"></div><p>Saving and publishing changes…</p></body></html>`,
                            );
                            w.document.close();
                          } catch {}
                          pendingSaveViewWindowRef.current = w;
                          handleSaveConfig();
                        }}
                      >
                        <ExternalLink />{" "}
                        {submitting && pendingSaveViewWindowRef.current
                          ? "Saving…"
                          : "Save And View"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Saves any unsaved changes, waits for the storefront to
                      catch up, then opens it in a tab. Sometimes a hard
                      reload is still required.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div
          ref={splitContainerRef}
          className="space-y-6 lg:flex lg:space-y-0"
          style={
            { ["--settings-w" as any]: `${leftPct}%` } as React.CSSProperties
          }
        >
          <div className="space-y-6 min-w-0 lg:flex-shrink-0 lg:[width:var(--settings-w)] lg:min-w-[300px] lg:max-w-[70%]">
            <Card>
              <CardHeader>
                <CardTitle>Model file</CardTitle>
                <CardDescription>
                  Upload a .glb or .gltf model. Stored in Shopify Files,
                  linked via <code>custom.model_3d</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {has && modelUrl && (
                  <div className="rounded-md border bg-muted/30 p-3 text-xs font-mono break-all">
                    {modelUrl}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setFilePickerOpen(true)}
                    disabled={submitting}
                  >
                    <FolderOpen /> Choose from Files
                  </Button>
                  <Button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={submitting}
                  >
                    <Upload /> {has ? "Upload (Replace)" : "Upload"}
                  </Button>
                  {has && (
                    <Form method="post" className="inline-flex">
                      <input type="hidden" name="intent" value="remove" />
                      <Button
                        type="submit"
                        variant="destructive"
                        disabled={submitting}
                      >
                        <Trash2 /> Remove
                      </Button>
                    </Form>
                  )}
                </div>
                <Form
                  ref={uploadFormRef}
                  method="post"
                  encType="multipart/form-data"
                  className="hidden"
                >
                  <input type="hidden" name="intent" value="upload" />
                  <input
                    ref={fileInputRef}
                    type="file"
                    name="file"
                    accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                    onChange={handleFileChosen}
                  />
                </Form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Viewer settings</CardTitle>
                <CardDescription>
                  Saved to <code>custom.viewer_3d_config</code>. The
                  storefront viewer uses these instead of the theme block
                  defaults.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <CollapsibleSection
                  title="Display"
                  icon={Palette}
                  description="Size, background, exposure, tone mapping"
                >
                    <FieldRow
                      label="Viewer height"
                      description={`${config.height}px`}
                    >
                      <div className="w-[240px]">
                        <Slider
                          min={200}
                          max={1200}
                          step={10}
                          value={[config.height]}
                          onValueChange={([v]) => update("height", v)}
                        />
                      </div>
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Background color">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={
                            config.background.startsWith("#")
                              ? config.background
                              : "#f4f4f4"
                          }
                          onChange={(e) =>
                            update("background", e.target.value)
                          }
                          className="h-9 w-12 rounded border cursor-pointer"
                        />
                        <Input
                          value={config.background}
                          onChange={(e) =>
                            update("background", e.target.value)
                          }
                          className="w-40 font-mono text-xs"
                        />
                      </div>
                    </FieldRow>
                    <Separator />
                    <FieldRow
                      label="Exposure"
                      description={`${config.exposure.toFixed(2)} (HDR brightness)`}
                    >
                      <div className="w-[240px]">
                        <Slider
                          min={0}
                          max={5}
                          step={0.05}
                          value={[config.exposure]}
                          onValueChange={([v]) => update("exposure", v)}
                        />
                      </div>
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Tone mapping">
                      <Select
                        value={config.toneMapping}
                        onValueChange={(v) => update("toneMapping", v)}
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TONE_MAPPINGS.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FieldRow>
                    <Separator />
                    <FieldRow
                      label="Default environment map"
                      description="Generated env map for material reflections"
                    >
                      <Switch
                        checked={config.useDefaultEnv}
                        onCheckedChange={(v) => update("useDefaultEnv", v)}
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Blur skybox">
                      <Switch
                        checked={config.skyboxBlur}
                        onCheckedChange={(v) => update("skyboxBlur", v)}
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Cast shadow under model">
                      <Switch
                        checked={config.shadow}
                        onCheckedChange={(v) => update("shadow", v)}
                      />
                    </FieldRow>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Environment"
                  icon={Sun}
                  description="HDR skybox and environment map URLs"
                >
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label htmlFor="skybox">Skybox HDR URL</Label>
                      <Input
                        id="skybox"
                        value={config.skybox}
                        placeholder="https://...hdr"
                        onChange={(e) => update("skybox", e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        RGBE .hdr image rendered as the background and used
                        for reflections.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="envmap">Environment map HDR URL</Label>
                      <Input
                        id="envmap"
                        value={config.envmap}
                        placeholder="https://...hdr"
                        onChange={(e) => update("envmap", e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Optional separate HDR for material reflections only.
                      </p>
                    </div>
                  </div>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Camera"
                  icon={Camera}
                  description="FOV, yaw, pitch, zoom"
                >
                    <FieldRow
                      label="FOV mode"
                      description="Auto fits the model. Custom uses the FOV value below."
                    >
                      <Select
                        value={config.fovMode}
                        onValueChange={(v) =>
                          update("fovMode", v as "auto" | "custom")
                        }
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </FieldRow>
                    <Separator />
                    <FieldRow
                      label="FOV (degrees)"
                      description={
                        config.fovMode === "auto"
                          ? "Disabled in auto mode"
                          : `${config.fov}°`
                      }
                    >
                      <div className="w-[240px]">
                        <Slider
                          min={1}
                          max={179}
                          step={1}
                          value={[config.fov]}
                          onValueChange={([v]) => update("fov", v)}
                          disabled={config.fovMode === "auto"}
                        />
                      </div>
                    </FieldRow>
                    <Separator />
                    <FieldRow
                      label="Initial yaw"
                      description={`${config.yaw}°`}
                    >
                      <div className="w-[240px]">
                        <Slider
                          min={-180}
                          max={180}
                          step={1}
                          value={[config.yaw]}
                          onValueChange={([v]) => update("yaw", v)}
                        />
                      </div>
                    </FieldRow>
                    <Separator />
                    <FieldRow
                      label="Initial pitch"
                      description={`${config.pitch}°`}
                    >
                      <div className="w-[240px]">
                        <Slider
                          min={-90}
                          max={90}
                          step={1}
                          value={[config.pitch]}
                          onValueChange={([v]) => update("pitch", v)}
                        />
                      </div>
                    </FieldRow>
                    <Separator />
                    <FieldRow
                      label="Initial zoom"
                      description={`${config.initialZoom} (positive = in)`}
                    >
                      <div className="w-[240px]">
                        <Slider
                          min={-50}
                          max={50}
                          step={0.5}
                          value={[config.initialZoom]}
                          onValueChange={([v]) => update("initialZoom", v)}
                        />
                      </div>
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Maintain model size on resize">
                      <Switch
                        checked={config.maintainSize}
                        onCheckedChange={(v) => update("maintainSize", v)}
                      />
                    </FieldRow>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Controls"
                  icon={Cog}
                  description="Rotate, pan, zoom, autoplay, scroll, control bar"
                >
                    <FieldRow label="Allow rotate">
                      <Switch
                        checked={config.rotate}
                        onCheckedChange={(v) => update("rotate", v)}
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Allow translate (pan)">
                      <Switch
                        checked={config.translate}
                        onCheckedChange={(v) => update("translate", v)}
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Allow zoom">
                      <Switch
                        checked={config.zoom}
                        onCheckedChange={(v) => update("zoom", v)}
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Auto rotate">
                      <Switch
                        checked={config.autoRotate}
                        onCheckedChange={(v) => update("autoRotate", v)}
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow
                      label="Page scroll on touch"
                      description="Allow vertical scroll when dragging on canvas"
                    >
                      <Switch
                        checked={config.scrollable}
                        onCheckedChange={(v) => update("scrollable", v)}
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Page scroll on mouse wheel">
                      <Switch
                        checked={config.wheelScrollable}
                        onCheckedChange={(v) =>
                          update("wheelScrollable", v)
                        }
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Grab cursor on canvas">
                      <Switch
                        checked={config.useGrabCursor}
                        onCheckedChange={(v) => update("useGrabCursor", v)}
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow
                      label="On-screen control bar"
                      description="Play / fullscreen / reset / progress"
                    >
                      <Switch
                        checked={config.showControls}
                        onCheckedChange={(v) => update("showControls", v)}
                      />
                    </FieldRow>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Animation"
                  icon={Film}
                  description="Default animation clip and repeat mode"
                >
                    <FieldRow
                      label="Default animation index"
                      description="Index of the clip to autoplay (0 = first)"
                    >
                      <Input
                        type="number"
                        min={0}
                        max={99}
                        value={config.defaultAnimationIndex}
                        onChange={(e) =>
                          update(
                            "defaultAnimationIndex",
                            Number(e.target.value) || 0,
                          )
                        }
                        className="w-24"
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Repeat mode">
                      <Select
                        value={config.animationRepeatMode}
                        onValueChange={(v) =>
                          update("animationRepeatMode", v)
                        }
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REPEAT_MODES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FieldRow>
                </CollapsibleSection>

                <CollapsibleSection
                  title="AR"
                  icon={Smartphone}
                  description="WebXR, Scene Viewer, Quick Look, iOS source"
                >
                    <FieldRow label="WebXR AR (modern Android Chrome)">
                      <Switch
                        checked={config.webAR}
                        onCheckedChange={(v) => update("webAR", v)}
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow label="Google Scene Viewer (Android)">
                      <Switch
                        checked={config.sceneViewer}
                        onCheckedChange={(v) => update("sceneViewer", v)}
                      />
                    </FieldRow>
                    <Separator />
                    <FieldRow
                      label="Apple Quick Look (iOS)"
                      description="Requires a .usdz model"
                    >
                      <Switch
                        checked={config.quickLook}
                        onCheckedChange={(v) => update("quickLook", v)}
                      />
                    </FieldRow>
                    <Separator />
                    <div className="space-y-2 pt-3">
                      <Label htmlFor="iosSrc">iOS source URL (.usdz)</Label>
                      <Input
                        id="iosSrc"
                        value={config.iosSrc}
                        placeholder="https://...usdz"
                        onChange={(e) => update("iosSrc", e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Used by Quick Look on iOS Safari. Upload separately to
                        Shopify Files.
                      </p>
                    </div>
                </CollapsibleSection>

                <CollapsibleSection
                  title="Advanced"
                  icon={Box}
                  description="Material variants, bounding box"
                >
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label htmlFor="variant">Material variant</Label>
                      <Input
                        id="variant"
                        value={config.variant}
                        placeholder="leave empty for default"
                        onChange={(e) => update("variant", e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Name of a KHR_materials_variants variant in the
                        model.
                      </p>
                    </div>
                    <FieldRow
                      label="Fix skinned bounding box"
                      description="Recalculate bbox using skeleton weights (rigged models)"
                    >
                      <Switch
                        checked={config.fixSkinnedBbox}
                        onCheckedChange={(v) => update("fixSkinnedBbox", v)}
                      />
                    </FieldRow>
                  </div>
                </CollapsibleSection>
              </CardContent>
            </Card>
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize columns"
            onMouseDown={startDragSplitter}
            onDoubleClick={() => setLeftPct(33)}
            className="hidden lg:flex lg:items-center lg:justify-center lg:w-3 lg:mx-1 lg:cursor-col-resize lg:group lg:select-none"
            title="Drag to resize · double-click to reset"
          >
            <div className="h-full w-px bg-border group-hover:w-0.5 group-hover:bg-primary transition-all" />
          </div>

          <div className="space-y-4 lg:flex-1 lg:min-w-0 lg:pl-2">
            <div className="sticky top-24 space-y-4">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 py-4">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <PlaySquare className="size-4" /> Live preview
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Updates instantly. Save to persist.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <ViewerPreview modelUrl={modelUrl} config={config} />
                  {!modelUrl && (
                    <p className="text-xs text-muted-foreground mt-3">
                      Upload a model above to see the preview.
                    </p>
                  )}
                </CardContent>
              </Card>

              {product.featuredImage?.url && (
                <Card>
                  <CardHeader className="flex-row items-center justify-between space-y-0 py-4">
                    <CardTitle className="text-base">Product image</CardTitle>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor="show-product-image"
                        className="text-xs text-muted-foreground"
                      >
                        Show Product Image
                      </Label>
                      <Switch
                        id="show-product-image"
                        checked={showProductImage}
                        onCheckedChange={setShowProductImage}
                      />
                    </div>
                  </CardHeader>
                  {showProductImage && (
                    <CardContent>
                      <img
                        src={product.featuredImage.url}
                        alt={product.featuredImage.altText ?? product.title}
                        className="w-full rounded-md border"
                      />
                    </CardContent>
                  )}
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
