import { lazy, Suspense, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import appStylesUrl from "~/app.css?url";
import view3dStylesUrl from "@egjs/view3d/css/view3d-bundle.min.css?url";
import { CubeLoader } from "~/components/CubeLoader";
import { HotspotsEditor, createHotspot } from "~/components/HotspotsEditor";
import { ViewerSettings } from "~/components/ViewerSettings";
import type { ViewerConfig } from "~/components/ViewerPreview";
import { flag } from "~/components/polaris/helpers";
import { useT } from "~/i18n";

/*
 * The shopper viewer's own settings — display, camera, controls, control bar,
 * animation, AR — and its hotspots, inside the editor. They are the product
 * page's settings, saved to the same metafield through that page's save_config
 * action, so the two screens always agree.
 *
 * Placing a hotspot and dragging controls need the shopper viewer itself, not
 * the editor's scene, so the centre viewport has a "Scene / Shopper view"
 * switch. Shopper view fills the viewport in place, with no page or dialog. It
 * is loaded on demand with the product page's stylesheets, which are Tailwind
 * with a global reset — they are added when it shows and removed when it
 * hides so they never touch the rest of the editor.
 */

const ViewerPreview = lazy(() =>
  import("~/components/ViewerPreview").then((m) => ({ default: m.ViewerPreview })),
);

export type ShopperViewerState = ReturnType<typeof useShopperViewer>;

export function useShopperViewer(
  productId: string,
  initial: ViewerConfig,
) {
  const shopify = useAppBridge();
  const t = useT("editor");
  const fetcher = useFetcher<{ ok: boolean; error?: string; message?: string }>();
  const [config, setConfig] = useState<ViewerConfig>(initial);
  const [saved, setSaved] = useState<ViewerConfig>(initial);
  const [placing, setPlacing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);

  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    const d = fetcher.data;
    if (!d || fetcher.state !== "idle") return;
    if (d.ok) {
      setSaved(config);
      shopify.toast.show(t("viewerSaved"));
    } else {
      shopify.toast.show(d.error ?? t("errSave"), { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  const save = () =>
    fetcher.submit(
      { intent: "save_config", config: JSON.stringify(config) },
      { method: "post", action: `/app/products/${productId}` },
    );

  return {
    config,
    setConfig,
    dirty,
    saving,
    save,
    discard: () => setConfig(saved),
    placing,
    setPlacing: (p: boolean) => {
      setPlacing(p);
      if (p) setPreviewOpen(true);
    },
    previewOpen,
    setPreviewOpen,
    focus,
    preview: (id: string) => {
      setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
      setPreviewOpen(true);
    },
  };
}

function SaveBar({ v }: { v: ShopperViewerState }) {
  const t = useT("editor");
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-button
        variant="primary"
        disabled={flag(!v.dirty || v.saving)}
        loading={flag(v.saving)}
        onClick={v.save}
      >
        {t("viewerSave")}
      </s-button>
      <s-button disabled={flag(!v.dirty || v.saving)} onClick={v.discard}>
        {t("discard")}
      </s-button>
      {v.dirty ? <s-badge tone="warning">{t("unsaved")}</s-badge> : null}
    </s-stack>
  );
}

export function ViewerStylePanel({
  v,
  hasModel,
}: {
  v: ShopperViewerState;
  hasModel: boolean;
}) {
  const t = useT("editor");
  return (
    <s-stack direction="block" gap="base">
      <p className="ed-help">{t("viewerHelp")}</p>
      <SaveBar v={v} />
      <s-button
        icon="view"
        disabled={flag(!hasModel)}
        onClick={() => v.setPreviewOpen(true)}
      >
        {t("viewerPreview")}
      </s-button>
      <ViewerSettings config={v.config} onChange={v.setConfig} />
    </s-stack>
  );
}

export function HotspotsPanel({ v }: { v: ShopperViewerState }) {
  const t = useT("editor");
  return (
    <s-stack direction="block" gap="base">
      <p className="ed-help">{t("hotspotsHelp")}</p>
      <SaveBar v={v} />
      <HotspotsEditor
        config={v.config}
        onChange={v.setConfig}
        placing={v.placing}
        onPlacingChange={v.setPlacing}
        onPreview={v.preview}
        locked={false}
      />
    </s-stack>
  );
}

/** The Scene / Shopper view switch at the top of the viewport. */
export function ViewModeSwitch({ v }: { v: ShopperViewerState }) {
  const t = useT("editor");
  return (
    <div className="ed-mode" role="group" aria-label={t("viewMode")}>
      <button
        type="button"
        className={v.previewOpen ? "" : "is-on"}
        onClick={() => {
          v.setPlacing(false);
          v.setPreviewOpen(false);
        }}
      >
        {t("viewScene")}
      </button>
      <button
        type="button"
        className={v.previewOpen ? "is-on" : ""}
        onClick={() => v.setPreviewOpen(true)}
      >
        {t("viewShopper")}
      </button>
    </div>
  );
}

/** The shopper viewer, in place of the scene, for placing hotspots and moving controls. */
export function ShopperViewerStage({
  v,
  modelUrl,
}: {
  v: ShopperViewerState;
  modelUrl: string | null;
}) {
  const t = useT("editor");
  const open = v.previewOpen;

  // Tailwind's reset only applies while the preview is up.
  useEffect(() => {
    if (!open) return;
    const links = [appStylesUrl, view3dStylesUrl].map((href) => {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      document.head.appendChild(l);
      return l;
    });
    return () => links.forEach((l) => l.remove());
  }, [open]);

  if (!open) return null;
  return (
    <div className="ed-stage" role="region" aria-label={t("viewShopper")}>
      {v.placing ? (
        <div className="ed-stage__hint">{t("viewerPlacing")}</div>
      ) : null}
      <div className="ed-stage__body">
        <Suspense fallback={<CubeLoader size="small" label={t("loadingModel")} />}>
          <ViewerPreview
            modelUrl={modelUrl}
            config={v.config}
            arShareUrl={null}
            onLayoutChange={(patch) => v.setConfig((c) => ({ ...c, ...patch }))}
            placingHotspot={v.placing}
            onPlaceHotspot={(anchor) => {
              v.setConfig((c) => ({
                ...c,
                hotspots: [...c.hotspots, createHotspot(anchor, c.hotspots.length)],
              }));
              v.setPlacing(false);
            }}
            focusHotspotId={v.focus?.id ?? null}
            focusNonce={v.focus?.n ?? 0}
          />
        </Suspense>
      </div>
    </div>
  );
}
