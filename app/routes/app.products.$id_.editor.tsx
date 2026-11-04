import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { flag } from "~/components/polaris/helpers";
import { Inspector, Sidebar } from "~/components/configurator/EditorPanels";
import {
  ShopperViewerStage,
  ViewModeSwitch,
  useShopperViewer,
} from "~/components/configurator/ShopperViewerPanel";
import { parseConfig } from "~/lib/viewer-config";
import type { ViewportApi } from "~/components/configurator/EditorViewport";
import { useT } from "~/i18n";
import { getServerT } from "~/i18n/i18n.server";
import {
  canRedo,
  canUndo,
  activeModelUrl,
  discard,
  getEd,
  initEditor,
  isDirty,
  markSaved,
  previewConfig,
  redo,
  savePayload,
  select,
  setSaving,
  setScene,
  setTarget,
  targetVariantIds,
  syncProduct,
  targetLabel,
  undo,
  useEd,
  type EditorProduct,
} from "~/lib/configurator/editor-state";
import {
  blankProductConfig,
  getProductConfig,
  resolveModelUrls,
  publishStoredConfig,
  saveProductConfig,
} from "~/lib/configurator/product-config.server";
import { configuratorModules } from "~/lib/configurator/modules.server";
import { sanitizeOptionGroups } from "~/lib/configurator/options";
import { MAX_VARIANT_IMAGE_BYTES, setVariantImage } from "~/lib/configurator/variants.server";
import { CubeLoader } from "~/components/CubeLoader";
import { formatFileSize } from "~/lib/files";
import type { ConfigLayer, ProductRenderConfig } from "~/lib/configurator/types";

/*
 * The full-screen 3D editor — the prototype's #admin.editor.<pid>
 * (shopify/admin/editor/*), opened in an <s-app-window> from the product page
 * and the 3D products page. Opened with ?variant=<id> (a variant's "Customize
 * in 3D" on the product page) it edits only that variant's setup. Left: what
 * you edit + parts. Centre: the R3F
 * viewport. Right: the inspector.
 *
 * `$id_` keeps this route out of the product page's layout (that page renders
 * no Outlet), so /app/products/:id/editor renders under the app shell alone.
 *
 * The session lives in a module-level store (editor-state.ts), so it is only
 * ever created in the browser: on the server a module is shared by every
 * request, and two merchants would share one draft.
 */

const EditorViewport = lazy(() => import("~/components/configurator/EditorViewport"));

const numericId = (gid: string) => gid.split("/").pop() ?? gid;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const id = String(params.id ?? "");
  if (!/^\d+$/.test(id)) throw new Response("Not found", { status: 404 });

  const res = await admin.graphql(
    `#graphql
      query EditorProduct($id: ID!) {
        product(id: $id) {
          id title handle onlineStoreUrl
          options { name values }
          variants(first: 100) {
            nodes { id title price compareAtPrice sku inventoryQuantity inventoryItem { tracked } selectedOptions { name value } }
          }
          viewerConfig: metafield(namespace: "custom", key: "viewer_3d_config") { value }
          model: metafield(namespace: "custom", key: "model_3d") {
            reference {
              ... on GenericFile { id url originalFileSize }
              ... on Model3d {
                id filename
                originalSource { filesize format }
                sources { url format }
              }
            }
          }
        }
      }`,
    { variables: { id: `gid://shopify/Product/${id}` } },
  );
  const json: any = await res.json();
  const p = json?.data?.product;
  if (!p) throw new Response("Not found", { status: 404 });

  const ref = p.model?.reference ?? null;
  const isModel3d = Boolean(ref?.sources);
  const modelUrl: string | null = isModel3d
    ? (ref.sources.find((s: any) => String(s.format).toLowerCase() === "glb")?.url ?? null)
    : (ref?.url ?? null);
  const size: number | null = isModel3d
    ? (ref?.originalSource?.filesize ?? null)
    : (ref?.originalFileSize ?? null);

  const product: EditorProduct = {
    id,
    title: p.title,
    handle: p.handle,
    options: (p.options ?? []).map((o: any) => ({ name: o.name, values: o.values ?? [] })),
    variants: (p.variants?.nodes ?? []).map((v: any) => ({
      id: numericId(v.id),
      title: v.title,
      options: Object.fromEntries(
        (v.selectedOptions ?? []).map((o: any) => [o.name, o.value]),
      ),
      price: v.price ?? undefined,
      compareAtPrice: v.compareAtPrice ?? null,
      sku: v.sku ?? "",
      tracked: v.inventoryItem?.tracked ?? true,
      quantity: v.inventoryQuantity ?? null,
    })),
  };

  const data =
    (await getProductConfig(session.shop, id)) ?? blankProductConfig(id);
  const modules = await configuratorModules(admin, session.shop);

  // GLB urls for the product's model and every variant / option model, so the
  // viewport can switch between them without another round trip.
  const defaultModelId = data.modelFileId ?? ref?.id ?? null;
  const layerIds = [
    ...Object.values(data.optionRules),
    ...Object.values(data.variantConfigs),
  ]
    .map((l) => l.modelFileId)
    .filter((x): x is string => !!x && x !== defaultModelId);
  const resolved = await resolveModelUrls(admin, [...new Set(layerIds)]);
  const modelUrls: Record<string, string> = Object.fromEntries(
    Object.entries(resolved).map(([gid, u]) => [gid, u.glb]),
  );
  if (defaultModelId && modelUrl) modelUrls[defaultModelId] = modelUrl;

  return {
    product,
    modelUrl,
    modelInfo: ref
      ? {
          fileName:
            ref.filename ??
            decodeURIComponent(String(ref.url ?? "").split("?")[0].split("/").pop() || "model.glb"),
          size: size != null ? formatFileSize(size) : null,
          format: isModel3d
            ? String(ref.originalSource?.format ?? "glb").toUpperCase()
            : "GLB",
          hasUsdz: isModel3d
            ? ref.sources.some((s: any) => String(s.format).toLowerCase() === "usdz")
            : false,
        }
      : null,
    saved: {
      modelFileId: data.modelFileId ?? ref?.id ?? null,
      config: data.config,
      optionRules: data.optionRules,
      variantConfigs: data.variantConfigs,
    },
    publishedAt: data.publishedAt ? data.publishedAt.toISOString() : null,
    // Saved changes that are not live yet.
    hasDraft: !!data.draftAt && (!data.publishedAt || data.draftAt > data.publishedAt),
    // onlineStoreUrl is null until the product is published to the Online Store
    // channel; fall back to the canonical product URL so the button stays usable.
    previewUrl: p.onlineStoreUrl ?? `https://${session.shop}/products/${p.handle}`,
    // Plan gates for the Options section; the action re-checks them.
    optionsAllowed: !!modules["option-groups"],
    variantsAllowed: !!modules["material-variants"],
    pricingAllowed: !!modules["option-pricing"],
    conditionsAllowed: !!modules["conditional-logic"],
    modelUrls,
    // The shopper viewer's own settings (product page's save_config storage).
    viewerConfig: parseConfig(p.viewerConfig?.value),
  };
};

/** Largest draft we accept, in bytes of JSON. Well under a metafield's limit. */
const MAX_DRAFT_BYTES = 512 * 1024;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const t = getServerT(request, "editor");
  const id = String(params.id ?? "");
  if (!/^\d+$/.test(id)) return { ok: false as const, error: t("errSave") };

  // "Use as variant image": a snapshot of the viewport, posted as a file.
  if (request.headers.get("Content-Type")?.includes("multipart/form-data")) {
    const form = await request.formData();
    const image = form.get("image");
    const variantIds = String(form.get("variantIds") ?? "").split(",").filter((v) => /^\d+$/.test(v));
    if (
      form.get("intent") !== "variantImage" ||
      !(image instanceof File) ||
      !image.type.startsWith("image/") ||
      image.size > MAX_VARIANT_IMAGE_BYTES ||
      !variantIds.length
    ) {
      return { ok: false as const, error: t("errVariantImage") };
    }
    const done = await setVariantImage(admin, id, variantIds, image, String(form.get("alt") ?? ""));
    return done.ok
      ? { ok: true as const, image: true as const, message: t("variantImageSet", { count: variantIds.length }) }
      : { ok: false as const, error: done.error };
  }

  const raw = await request.text();
  if (raw.length > MAX_DRAFT_BYTES) {
    return { ok: false as const, error: t("errTooLarge") };
  }
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false as const, error: t("errSave") };
  }

  // Publish what is already saved (a draft) — no config in the body.
  if (body?.intent === "publish") {
    const published = await publishStoredConfig(admin, session.shop, id);
    return published.ok
      ? { ok: true as const, mode: "publish" as const, message: t("saved") }
      : { ok: false as const, error: published.error };
  }

  const config = body?.config;
  if (!isObject(config) || config.schema_version !== 1) {
    return { ok: false as const, error: t("errSave") };
  }
  // Custom options are plan-gated here, not just hidden in the UI, so a lower
  // plan can't save them by posting. Without the module the stored options
  // stay as they were.
  const modules = await configuratorModules(admin, session.shop);
  // "draft" stores and previews; anything else publishes, as saving always did.
  const mode = body.mode === "draft" ? ("draft" as const) : ("publish" as const);
  const existing =
    (await getProductConfig(session.shop, id)) ?? blankProductConfig(id);
  const cleanOptions = (raw: unknown, fallback: unknown) =>
    modules["option-groups"]
      ? sanitizeOptionGroups(raw, {
          materialVariants: !!modules["material-variants"],
          pricing: !!modules["option-pricing"],
          conditions: !!modules["conditional-logic"],
        })
      : fallback;
  const layers = (v: unknown, keyOk: (k: string) => boolean) => {
    if (!isObject(v)) return {};
    const out: Record<string, ConfigLayer> = {};
    for (const [k, l] of Object.entries(v)) {
      if (!keyOk(k) || !isObject(l)) continue;
      const cfg = isObject(l.config) ? { ...l.config } : null;
      if (cfg && "options" in cfg) {
        const options = cleanOptions(cfg.options, undefined);
        if (options) cfg.options = options as never;
        else delete cfg.options;
      }
      out[k] = {
        modelFileId:
          typeof l.modelFileId === "string" && l.modelFileId.startsWith("gid://shopify/")
            ? l.modelFileId
            : null,
        config: cfg as Partial<ProductRenderConfig> | null,
      };
    }
    return out;
  };
  // The editor doesn't change the product's model yet; keep what's stored, or
  // the product's own custom.model_3d for a first save.
  const modelFileId =
    existing.modelFileId ??
    (typeof body.modelFileId === "string" && body.modelFileId.startsWith("gid://shopify/")
      ? body.modelFileId
      : null);

  const saved = await saveProductConfig(admin, session.shop, {
    ...existing,
    modelFileId,
    config: {
      ...(config as ProductRenderConfig),
      options: cleanOptions(
        config.options,
        (existing.config as ProductRenderConfig).options ?? [],
      ) as ProductRenderConfig["options"],
    },
    optionRules: layers(body.optionRules, (k) => k.includes("=")),
    variantConfigs: layers(body.variantConfigs, (k) => /^\d+$/.test(k)),
  }, mode);
  return saved.ok
    ? {
        ok: true as const,
        mode,
        message: mode === "draft" ? t("savedDraft") : t("saved"),
      }
    : { ok: false as const, error: saved.error };
};

/* ------------------------------------------------------------------ */

const isTextEntry = (el: Element | null) =>
  !!el &&
  (el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    (el as HTMLElement).isContentEditable ||
    el.tagName.startsWith("S-"));

export default function EditorRoute() {
  const data = useLoaderData<typeof loader>();
  const [ready, setReady] = useState(false);
  const [params] = useSearchParams();
  const variant = data.product.variants.find((v) => v.id === params.get("variant"))?.id ?? null;

  // Browser-only session (see the note at the top).
  useEffect(() => {
    initEditor(data.product, data.saved, data.modelUrls);
    if (variant) setTarget(variant);
    setReady(true);
    // Re-initialise only for another product or variant; after a save the
    // loader revalidates with what we just saved, and the session already has it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.product.id, variant]);

  if (!ready) {
    return (
      <div className="ed-boot">
        <CubeLoader size="large" />
      </div>
    );
  }
  return <Editor locked={!!variant} />;
}

function Editor({ locked }: { locked: boolean }) {
  const data = useLoaderData<typeof loader>();
  const t = useT("editor");
  const tc = useT("common");
  const shopify = useAppBridge();
  const ed = useEd();
  const fetcher = useFetcher<typeof action>();
  const viewportRef = useRef<ViewportApi | null>(null);
  const viewer = useShopperViewer(data.product.id, data.viewerConfig);
  const liveColorRef = useRef<(name: string) => string | null>(() => null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [grid, setGrid] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [published, setPublished] = useState(!!data.publishedAt);
  // Saved but not live: set by "Save draft", cleared by "Publish".
  const [hasDraft, setHasDraft] = useState(data.hasDraft);
  const lastMode = useRef<"draft" | "publish">("publish");
  // A tab opened on click for "Preview" while unsaved changes are saved first.
  const previewTab = useRef<Window | null>(null);

  const dirty = isDirty(ed);
  const saving = fetcher.state !== "idle";

  // After a variant or option changed in Shopify the loader reruns; bring the
  // session's variant list and layers along without touching the draft.
  useEffect(() => {
    syncProduct(data.product);
  }, [data.product]);

  // The model the viewport shows follows the selected variant / option value.
  const viewportModelUrl = activeModelUrl(ed) ?? data.modelUrl;
  useEffect(() => setLoadError(null), [viewportModelUrl]);

  // The storefront shows this flag's draft instead of the live config.
  const previewHref = data.previewUrl
    ? `${data.previewUrl}${data.previewUrl.includes("?") ? "&" : "?"}e3d_preview=1`
    : null;

  const submit = useCallback(
    (mode: "draft" | "publish") => {
      if (fetcher.state !== "idle") return;
      const dirtyNow = isDirty(getEd());
      // Publishing with nothing new to save publishes the stored draft.
      if (!dirtyNow && mode === "draft") return;
      lastMode.current = mode;
      setSaving(true);
      fetcher.submit(
        JSON.stringify(dirtyNow ? savePayload(getEd(), mode) : { intent: "publish" }),
        { method: "post", encType: "application/json" },
      );
    },
    [fetcher],
  );
  const save = useCallback(() => submit("draft"), [submit]);

  // "Use as variant image": snapshot the viewport and make it the image of the
  // variant (or every variant with the option value) being edited.
  const imageFetcher = useFetcher<typeof action>();
  const imageFor = targetVariantIds(ed);
  const snapshotAsImage = async () => {
    const api = viewportRef.current;
    if (!imageFor.length) return;
    if (!api) {
      // The shopper-viewer view has no editor canvas to take a picture of.
      shopify.toast.show(t("errVariantImageView"), { isError: true });
      return;
    }
    const env = (previewConfig(getEd()).environment ?? {}) as {
      backgroundType?: string;
      backgroundColor?: string;
    };
    const blob = await api.snapshot(
      env.backgroundType === "color" ? (env.backgroundColor ?? "#ffffff") : "#ffffff",
    );
    if (!blob) {
      shopify.toast.show(t("errVariantImage"), { isError: true });
      return;
    }
    const label = targetLabel(getEd());
    const form = new FormData();
    form.set("intent", "variantImage");
    form.set("variantIds", imageFor.join(","));
    form.set("alt", `${data.product.title} – ${label}`);
    form.set("image", new File([blob], "variant-3d.jpg", { type: "image/jpeg" }));
    imageFetcher.submit(form, { method: "post", encType: "multipart/form-data" });
  };
  useEffect(() => {
    const d = imageFetcher.data;
    if (!d || imageFetcher.state !== "idle") return;
    if (d.ok) shopify.toast.show(d.message);
    else shopify.toast.show(d.error, { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageFetcher.data, imageFetcher.state]);

  const preview = () => {
    if (!previewHref) return;
    if (!isDirty(getEd())) {
      window.open(previewHref, "_blank");
      return;
    }
    // Opened now, inside the click, so it isn't blocked; sent to the page once
    // the draft it should show has been saved.
    previewTab.current = window.open("about:blank", "_blank");
    submit("draft");
  };

  useEffect(() => {
    const d = fetcher.data;
    if (!d || fetcher.state !== "idle") return;
    if (d.ok) {
      markSaved();
      if (lastMode.current === "publish") {
        setPublished(true);
        setHasDraft(false);
      } else {
        setHasDraft(true);
      }
      shopify.toast.show(d.message);
      if (previewTab.current && previewHref) {
        previewTab.current.location.href = previewHref;
      }
      previewTab.current = null;
    } else {
      previewTab.current?.close();
      previewTab.current = null;
      setSaving(false);
      shopify.toast.show(d.error, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Y, Ctrl/Cmd+S — as in the prototype.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isTextEntry(e.target instanceof Element ? e.target : null)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y") {
        e.preventDefault();
        redo();
      } else if (k === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const onScene = useCallback(
    (names: string[], tree: Parameters<typeof setScene>[1]) => setScene(names, tree),
    [],
  );

  const status = saving ? (
    <s-badge tone="info">{t("saving")}</s-badge>
  ) : dirty ? (
    <s-badge tone="warning">{t("unsaved")}</s-badge>
  ) : hasDraft ? (
    <s-badge tone="caution">{t("draft")}</s-badge>
  ) : (
    <s-badge tone={published ? "success" : "neutral"}>
      {published ? t("published") : t("notPublished")}
    </s-badge>
  );

  return (
    <div className="ed">
      <style>{EDITOR_CSS}</style>

      {/*
        No App Bridge <SaveBar> here: inside an <s-app-window> App Bridge does
        not define <ui-save-bar>, so the element never gets show()/hide() and
        SaveBar throws "saveBar.hide is not a function". Save and Discard live
        in the editor's own top bar instead.
      */}

      <header className="ed-top">
        <div className="ed-top__title">
          <s-heading>{t("title", { title: data.product.title })}</s-heading>
          {status}
          {targetLabel(ed) ? (
            <s-badge tone="info">{t("editingTarget", { target: targetLabel(ed) })}</s-badge>
          ) : null}
        </div>
        <div className="ed-top__actions">
          <s-button
            icon="undo"
            accessibilityLabel={t("undo")}
            disabled={flag(!canUndo(ed))}
            onClick={undo}
          />
          <s-button
            icon="redo"
            accessibilityLabel={t("redo")}
            disabled={flag(!canRedo(ed))}
            onClick={redo}
          />
          {imageFor.length ? (
            <s-button
              icon="camera"
              disabled={flag(!viewportModelUrl)}
              loading={flag(imageFetcher.state !== "idle")}
              onClick={snapshotAsImage}
            >
              {t("useAsVariantImage", { count: imageFor.length })}
            </s-button>
          ) : null}
          <s-button
            icon="external"
            disabled={flag(!previewHref || saving)}
            onClick={preview}
          >
            {t("previewStore")}
          </s-button>
          <s-button disabled={flag(!dirty || saving)} onClick={discard}>
            {t("discard")}
          </s-button>
          <s-button disabled={flag(!dirty || saving)} onClick={() => submit("draft")}>
            {t("saveDraft")}
          </s-button>
          <s-button
            variant="primary"
            disabled={flag(!dirty && !hasDraft && published)}
            loading={flag(saving)}
            onClick={() => submit("publish")}
          >
            {t("publish")}
          </s-button>
        </div>
      </header>

      <div className="ed-body">
        <aside className="ed-left" aria-label={t("leftPanel")}>
          <Sidebar hasModel={!!viewportModelUrl} locked={locked} />
        </aside>

        <main className="ed-center">
          {data.modelUrl ? <ViewModeSwitch v={viewer} /> : null}
          <ShopperViewerStage v={viewer} modelUrl={data.modelUrl} />
          {viewportModelUrl ? (
            <Suspense
              fallback={
                <div className="ed-boot">
                  <CubeLoader size="large" label={t("loadingModel")} />
                </div>
              }
            >
              <ViewportHost
                viewportRef={viewportRef}
                liveColorRef={liveColorRef}
                modelUrl={viewportModelUrl as string}
                autoRotate={autoRotate}
                grid={grid}
                onScene={onScene}
                onError={setLoadError}
              />
            </Suspense>
          ) : (
            <div className="ed-boot">
              <s-text color="subdued">{t("noModel")}</s-text>
            </div>
          )}
          {loadError ? (
            <div className="ed-error">
              <s-banner tone="critical" heading={t("loadFailed")}>
                <s-paragraph>{loadError}</s-paragraph>
              </s-banner>
            </div>
          ) : null}
          <div className="ed-tools" role="toolbar" aria-label={t("viewTools")}>
            <s-button icon="maximize" accessibilityLabel={t("frame")} onClick={() => viewportRef.current?.frame()} />
            <s-button icon="plus" accessibilityLabel={t("zoomIn")} onClick={() => viewportRef.current?.zoom(0.8)} />
            <s-button icon="minus" accessibilityLabel={t("zoomOut")} onClick={() => viewportRef.current?.zoom(1.25)} />
            <s-button
              icon="layout-columns-3"
              variant={grid ? "primary" : "secondary"}
              accessibilityLabel={t("grid")}
              onClick={() => setGrid((g) => !g)}
            />
            <s-button
              icon="refresh"
              variant={autoRotate ? "primary" : "secondary"}
              accessibilityLabel={t("autoRotate")}
              onClick={() => setAutoRotate((a) => !a)}
            />
          </div>
        </main>

        <aside className="ed-right" aria-label={t("inspector")}>
          <Inspector
            modelInfo={data.modelInfo}
            viewport={() => viewportRef.current}
            liveColor={(n) => liveColorRef.current(n)}
            onError={(m) => shopify.toast.show(m, { isError: true })}
            optionsAllowed={data.optionsAllowed}
            variantsAllowed={data.variantsAllowed}
            pricingAllowed={data.pricingAllowed}
            conditionsAllowed={data.conditionsAllowed}
            viewer={viewer}
            hasModel={!!data.modelUrl}
          />
        </aside>
      </div>
          </div>
  );
}

/** Mounts the lazy R3F viewport against the session's effective config. */
function ViewportHost({
  viewportRef,
  liveColorRef,
  modelUrl,
  autoRotate,
  grid,
  onScene,
  onError,
}: {
  viewportRef: React.MutableRefObject<ViewportApi | null>;
  liveColorRef: React.MutableRefObject<(name: string) => string | null>;
  modelUrl: string;
  autoRotate: boolean;
  grid: boolean;
  onScene: (names: string[], tree: Parameters<typeof setScene>[1]) => void;
  onError: (m: string) => void;
}) {
  const ed = useEd();
  return (
    <EditorViewport
      ref={(api) => {
        viewportRef.current = api;
        liveColorRef.current = api?.colorOf ?? (() => null);
      }}
      modelUrl={modelUrl}
      config={previewConfig(ed)}
      selection={ed.selection}
      autoRotate={autoRotate}
      grid={grid}
      onSelect={select}
      onScene={onScene}
      onError={onError}
    />
  );
}

const EDITOR_CSS = `
.ed { position: fixed; inset: 0; display: flex; flex-direction: column; background: #f1f1f1; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #303030; }
.ed-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; background: #fff; border-bottom: 1px solid #e3e3e3; }
.ed-top__title, .ed-top__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ed-body { flex: 1; display: grid; grid-template-columns: 280px 1fr 320px; min-height: 0; }
.ed-left, .ed-right { overflow: auto; background: #fff; }
.ed-left { border-right: 1px solid #e3e3e3; }
.ed-right { border-left: 1px solid #e3e3e3; }
.ed-center { position: relative; min-width: 0; }
.ed-boot { position: absolute; inset: 0; display: grid; place-items: center; }
.ed-error { position: absolute; left: 12px; right: 12px; top: 12px; }
.ed-tools { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 4px; background: #fff; padding: 4px; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
.ed-panel { padding: 12px; border-bottom: 1px solid #ebebeb; display: flex; flex-direction: column; gap: 6px; }
.ed-h { margin: 6px 0 2px; font-size: 13px; font-weight: 650; display: flex; justify-content: space-between; align-items: baseline; }
.ed-meta { font-weight: 400; color: #616161; font-size: 12px; }
.ed-sub { margin: 6px 0 0; font-size: 12px; color: #616161; font-weight: 550; }
.ed-help { margin: 0; color: #616161; font-size: 12px; }
.ed-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.ed-row, .ed-mesh__name { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 8px; border-radius: 8px; }
.ed-rowwrap { display: flex; align-items: center; }
.ed-row:hover, .ed-mesh:hover { background: #f3f3f3; }
.ed-row.is-on, .ed-mesh.is-on { background: #e7eefb; }
.ed-row:focus-visible, .ed-mesh__name:focus-visible { outline: 2px solid #005bd3; }
.ed-row__label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-dot { width: 7px; height: 7px; border-radius: 50%; background: #e2a400; flex: none; }
.ed-optgroup { border: 1px solid #e3e3e3; border-radius: 10px; background: #fafafa; }
.ed-optgroup > summary { cursor: pointer; padding: 10px 12px; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; list-style: none; }
.ed-optgroup > summary::-webkit-details-marker { display: none; }
.ed-optgroup__body { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 10px; }
.ed-choice { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid #e3e3e3; border-radius: 8px; background: #fff; }
.ed-choice.is-previewing { border-color: #005bd3; box-shadow: 0 0 0 1px #005bd3; }
.ed-checks { margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; gap: 2px; max-height: 148px; overflow: auto; }
.ed-checks legend { padding: 0 0 4px; font-size: 12px; color: #616161; font-weight: 550; }
.ed-editing { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding-top: 6px; }
.ed-mesh { display: flex; align-items: center; border-radius: 8px; }
.ed-mesh.is-hidden .ed-mesh__name { opacity: .5; }
.ed-mesh__name { padding: 4px 6px; }
.ed-mesh__edit { display: flex; flex-direction: column; gap: 8px; padding: 8px 8px 12px 18px; }
.ed-vrow { display: flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 8px; }
.ed-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 6px 6px; }
.ed-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 10px; border: 1px solid #e3e3e3; border-radius: 999px; background: #fff; font-size: 12px; }
.ed-chip:not(:has(button)) { padding-inline-end: 10px; }
.ed-chip button { all: unset; cursor: pointer; width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%; color: #616161; }
.ed-chip button:hover { background: #fbeae5; color: #8e1f0b; }
.ed-chip button:focus-visible { outline: 2px solid #005bd3; }
.ed-vrow:hover { background: #f3f3f3; }
.ed-vrow__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-form, .ed-cond, .ed-layermodel { display: flex; flex-direction: column; gap: 8px; padding: 10px; margin: 4px 0; border: 1px solid #e3e3e3; border-radius: 8px; background: #fafafa; }
.ed-layermodel { margin-top: 10px; }
.ed-tgroup { list-style: none; display: flex; align-items: center; gap: 2px; padding-block: 1px; color: #303030; font-size: 12px; font-weight: 600; border-radius: 8px; }
.ed-tgroup:hover { background: #f3f3f3; }
.ed-tgroup__toggle { all: unset; box-sizing: border-box; cursor: pointer; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; color: #616161; flex: none; transition: transform .12s; }
.ed-tgroup__toggle.is-collapsed { transform: rotate(-90deg); }
.ed-tgroup__toggle.is-collapsed:dir(rtl) { transform: rotate(90deg); }
.ed-tgroup__toggle:focus-visible { outline: 2px solid #005bd3; }
.ed-tgroup__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-tgroup.is-hidden .ed-tgroup__name { opacity: .5; }
.ed-tgroup.is-mixed .ed-tgroup__name { opacity: .75; }
.ed-mode { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 7; display: flex; background: #fff; border-radius: 10px; padding: 3px; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
.ed-mode button { border: 0; background: none; padding: 5px 12px; border-radius: 8px; cursor: pointer; font: inherit; color: #303030; }
.ed-mode button.is-on { background: #303030; color: #fff; }
.ed-stage { position: absolute; inset: 0; z-index: 6; background: #fff; display: flex; flex-direction: column; }
.ed-stage__body { flex: 1; min-height: 0; padding: 52px 12px 12px; overflow: auto; }
.ed-stage__hint { position: absolute; top: 52px; left: 50%; transform: translateX(-50%); z-index: 8; background: #303030; color: #fff; padding: 8px 12px; border-radius: 8px; font-size: 12px; }
.ed-group { margin: 14px 12px 2px; font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: #616161; }
.ed-search { padding: 10px 12px 0; }
.ed-price { border: 1px solid #ebebeb; border-radius: 8px; padding: 8px 10px; }
.ed-price__row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
.ed-price__row--total { border-top: 1px solid #ebebeb; margin-top: 4px; padding-top: 6px; font-weight: 650; }
.ed-sec { border-bottom: 1px solid #ebebeb; }
.ed-sec > summary { cursor: pointer; padding: 12px; font-weight: 650; display: flex; justify-content: space-between; gap: 8px; list-style: none; }
.ed-sec > summary::-webkit-details-marker { display: none; }
.ed-sec__chev { display: grid; place-items: center; flex: none; color: #8a8a8a; transition: transform 200ms ease, color 120ms ease; }
.ed-sec[open] > summary .ed-sec__chev { transform: rotate(180deg); }
.ed-sec__meta { margin-left: auto; font-weight: 400; color: #616161; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ed-sec__body { padding: 0 12px 14px; display: flex; flex-direction: column; gap: 10px; }
/* Hover and open match the product page's collapsible cards (CollapsibleSection.tsx): selection blue on a pale blue tint. */
.ed-sec > summary { transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease; }
/* Hover is the open look on the heading alone: tint, blue text, blue bar. */
.ed-sec > summary:hover { background: #f4f8fe; color: #005bd3; box-shadow: inset 3px 0 0 #005bd3; }
.ed-sec > summary:hover .ed-sec__chev { color: #005bd3; }
.ed-sec > summary:focus-visible { outline: none; background: #f4f8fe; box-shadow: inset 0 0 0 2px #005bd3; }
.ed-sec { transition: background 200ms ease, box-shadow 200ms ease; }
.ed-sec[open] { background: #f4f8fe; box-shadow: inset 3px 0 0 #005bd3; }
.ed-sec[open] > summary { color: #005bd3; }
.ed-sec[open] > summary .ed-sec__chev { color: #005bd3; }
.ed-slider { display: flex; flex-direction: column; gap: 2px; }
.ed-slider__top { display: flex; justify-content: space-between; }
.ed-slider__val { color: #616161; font-variant-numeric: tabular-nums; }
.ed-slider input { width: 100%; accent-color: #303030; }
.ed-color { display: flex; flex-direction: column; gap: 4px; }
.ed-color__row { display: flex; align-items: center; gap: 8px; }
.ed-color input { width: 40px; height: 28px; padding: 0; border: 1px solid #c9c9c9; border-radius: 6px; background: none; }
.ed-dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
.ed-dl dt { color: #616161; }
.ed-dl dd { margin: 0; word-break: break-all; }
.ed-gallery__name { width: 84px; }
@media (max-width: 900px) {
  .ed-body { grid-template-columns: 1fr; grid-template-rows: 45vh auto auto; overflow: auto; }
  .ed-center { grid-row: 1; }
  .ed-left, .ed-right { border: 0; border-top: 1px solid #e3e3e3; overflow: visible; }
}
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
