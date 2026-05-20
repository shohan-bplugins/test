import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  PlaySquare,
  Trash2,
} from "lucide-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";

import { ViewerPreview, type ViewerConfig } from "~/components/ViewerPreview";
import { ViewerSettings } from "~/components/ViewerSettings";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";

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

function parseConfigOrDefault(raw: string | null | undefined): ViewerConfig {
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...parsed } as ViewerConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

type LoaderData = {
  model: {
    id: string;
    name: string;
    fileUrl: string;
    fileGid: string;
    createdAt: string;
  };
  config: ViewerConfig;
};

export const loader = async ({
  params,
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const id = String(params.id ?? "");
  const model = await prisma.model3D.findFirst({
    where: { id, shop },
  });
  if (!model) {
    throw new Response("Model not found", { status: 404 });
  }
  return {
    model: {
      id: model.id,
      name: model.name,
      fileUrl: model.fileUrl,
      fileGid: model.fileGid,
      createdAt: model.createdAt.toISOString(),
    },
    config: parseConfigOrDefault(model.config),
  };
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const id = String(params.id ?? "");
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  const existing = await prisma.model3D.findFirst({ where: { id, shop } });
  if (!existing) return { ok: false, error: "Model not found" };

  if (intent === "delete") {
    await prisma.model3D.delete({ where: { id } });
    return redirect("/app/models");
  }

  if (intent === "save") {
    const name = String(formData.get("name") ?? "").trim() || existing.name;
    const config = String(formData.get("config") ?? "");
    await prisma.model3D.update({
      where: { id },
      data: {
        name,
        config: config || null,
      },
    });
    return { ok: true, message: "Saved" };
  }

  if (intent === "reset_config") {
    await prisma.model3D.update({
      where: { id },
      data: { config: null },
    });
    return { ok: true, message: "Settings reset to defaults" };
  }

  return { ok: false, error: "Unknown intent" };
};

function buildEmbedUrl(modelUrl: string, config: ViewerConfig): string {
  const sep = modelUrl.includes("?") ? "&" : "?";
  const hash = encodeURIComponent(JSON.stringify(config));
  return `${modelUrl}${sep}_v=${Date.now()}#preview_config=${hash}`;
}

export default function ModelDetail() {
  const { model, config: savedConfig } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const submitting = navigation.state === "submitting";

  const [name, setName] = useState(model.name);
  const [config, setConfig] = useState<ViewerConfig>(savedConfig);
  const [copying, setCopying] = useState<"url" | "embed" | null>(null);
  const [leftPct, setLeftPct] = useState(33);
  const splitContainerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setName(model.name);
    setConfig(savedConfig);
  }, [model.id, model.name, savedConfig]);

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(actionData.message ?? "Saved");
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const dirty = useMemo(
    () =>
      name !== model.name ||
      JSON.stringify(config) !== JSON.stringify(savedConfig),
    [name, config, model.name, savedConfig],
  );

  function handleSave() {
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("name", name);
    fd.set("config", JSON.stringify(config));
    submit(fd, { method: "post" });
  }

  function handleReset() {
    if (
      !window.confirm("Reset all viewer settings to defaults for this model?")
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("intent", "reset_config");
    submit(fd, { method: "post" });
  }

  function handleDelete() {
    if (
      !window.confirm(
        "Delete this model from the library? The .glb file itself stays in Shopify Files.",
      )
    )
      return;
    const fd = new FormData();
    fd.set("intent", "delete");
    submit(fd, { method: "post" });
  }

  async function handleCopy(value: string, kind: "url" | "embed") {
    setCopying(kind);
    try {
      await navigator.clipboard.writeText(value);
      shopify.toast.show(kind === "url" ? "URL copied" : "Embed URL copied");
    } catch {
      shopify.toast.show("Couldn't copy", { isError: true });
    } finally {
      setTimeout(() => setCopying(null), 700);
    }
  }

  function handlePreview() {
    const url = buildEmbedUrl(model.fileUrl, config);
    const w = window.open(url, `viewer-3d-model-preview-${model.id}`);
    w?.focus();
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Button variant="ghost" size="icon" asChild>
                <Link to="/app/models" aria-label="Back to models">
                  <ArrowLeft />
                </Link>
              </Button>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">
                  {model.name}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Library model · {model.fileGid.split("/").pop()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={submitting}
              >
                <Trash2 /> Reset settings
              </Button>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" onClick={handlePreview}>
                      <ExternalLink /> Preview
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Open the storefront viewer URL with the current
                    (unsaved) settings applied via URL fragment.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                onClick={handleSave}
                disabled={submitting || !dirty}
              >
                {submitting ? "Saving…" : dirty ? "Save" : "Saved"}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={submitting}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div
          ref={splitContainerRef}
          className="space-y-5 lg:flex lg:space-y-0"
          style={
            { ["--settings-w" as any]: `${leftPct}%` } as React.CSSProperties
          }
        >
          <div className="space-y-5 min-w-0 lg:flex-shrink-0 lg:[width:var(--settings-w)] lg:min-w-[300px] lg:max-w-[70%]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="model-name">Name</Label>
                  <Input
                    id="model-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My 3D model"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Source URL</Label>
                  <div className="flex gap-1.5">
                    <Input
                      readOnly
                      value={model.fileUrl}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(model.fileUrl, "url")}
                    >
                      <Copy />
                      {copying === "url" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Paste this URL into the &ldquo;3D Model Viewer (page)&rdquo;
                    block&rsquo;s &ldquo;Model URL&rdquo; setting.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Viewer settings</CardTitle>
                <CardDescription>
                  Saved with this library entry. Used by the
                  &ldquo;Preview&rdquo; button.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ViewerSettings config={config} onChange={setConfig} />
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

          <div className="space-y-5 lg:flex-1 lg:min-w-0 lg:pl-2">
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
                  <ViewerPreview
                    modelUrl={model.fileUrl}
                    config={config}
                  />
                </CardContent>
              </Card>
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
