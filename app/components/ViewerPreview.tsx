import { useEffect, useMemo, useRef, useState } from "react";
import "@egjs/view3d/css/view3d-bundle.min.css";

import { cn } from "~/lib/utils";

const TONE_MAPPINGS: Record<string, number> = {
  None: 0,
  Linear: 1,
  Reinhard: 2,
  Cineon: 3,
  ACESFilmic: 4,
};

export type ViewerConfig = {
  height: number;
  background: string;
  exposure: number;
  toneMapping: string;
  useDefaultEnv: boolean;
  skyboxBlur: boolean;
  skybox: string;
  envmap: string;
  fovMode: "auto" | "custom";
  fov: number;
  yaw: number;
  pitch: number;
  initialZoom: number;
  rotate: boolean;
  translate: boolean;
  zoom: boolean;
  autoRotate: boolean;
  scrollable: boolean;
  wheelScrollable: boolean;
  useGrabCursor: boolean;
  showControls: boolean;
  defaultAnimationIndex: number;
  animationRepeatMode: string;
  webAR: boolean;
  sceneViewer: boolean;
  quickLook: boolean;
  iosSrc: string;
  variant: string;
  fixSkinnedBbox: boolean;
  shadow: boolean;
  maintainSize: boolean;
};

function buildOptions(modelUrl: string, cfg: ViewerConfig) {
  const opts: Record<string, unknown> = {
    src: modelUrl,
    autoInit: true,
    exposure: cfg.exposure,
    useDefaultEnv: cfg.useDefaultEnv,
    skyboxBlur: cfg.skyboxBlur,
    yaw: cfg.yaw,
    pitch: cfg.pitch,
    initialZoom: cfg.initialZoom,
    rotate: cfg.rotate,
    translate: cfg.translate,
    zoom: cfg.zoom,
    scrollable: cfg.scrollable,
    wheelScrollable: cfg.wheelScrollable,
    useGrabCursor: cfg.useGrabCursor,
    defaultAnimationIndex: cfg.defaultAnimationIndex,
    animationRepeatMode: cfg.animationRepeatMode,
    webAR: cfg.webAR,
    sceneViewer: cfg.sceneViewer,
    quickLook: cfg.quickLook,
    fixSkinnedBbox: cfg.fixSkinnedBbox,
    shadow: cfg.shadow,
    maintainSize: cfg.maintainSize,
    autoplay: cfg.autoRotate ? { delay: 0, speed: 0.5 } : false,
  };

  if (TONE_MAPPINGS[cfg.toneMapping] != null) {
    opts.toneMapping = TONE_MAPPINGS[cfg.toneMapping];
  }
  if (cfg.skybox) opts.skybox = cfg.skybox;
  if (cfg.envmap) opts.envmap = cfg.envmap;
  if (cfg.background && cfg.background.includes("://"))
    opts.background = cfg.background;
  if (cfg.fovMode === "auto") opts.fov = "auto";
  else opts.fov = cfg.fov;
  if (cfg.iosSrc) opts.iosSrc = cfg.iosSrc;
  if (cfg.variant) opts.variant = cfg.variant;

  return opts;
}

type Props = {
  modelUrl: string | null;
  config: ViewerConfig;
  className?: string;
};

export function ViewerPreview({ modelUrl, config, className }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const view3dRef = useRef<any>(null);
  const controlBarRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const initKey = useMemo(
    () =>
      JSON.stringify({
        modelUrl,
        toneMapping: config.toneMapping,
        useDefaultEnv: config.useDefaultEnv,
        skybox: config.skybox,
        envmap: config.envmap,
        skyboxBlur: config.skyboxBlur,
        fovMode: config.fovMode,
        fov: config.fov,
        initialZoom: config.initialZoom,
        shadow: config.shadow,
        maintainSize: config.maintainSize,
        defaultAnimationIndex: config.defaultAnimationIndex,
        animationRepeatMode: config.animationRepeatMode,
        variant: config.variant,
        fixSkinnedBbox: config.fixSkinnedBbox,
        iosSrc: config.iosSrc,
        webAR: config.webAR,
        sceneViewer: config.sceneViewer,
        quickLook: config.quickLook,
      }),
    [modelUrl, config],
  );

  useEffect(() => {
    let cancelled = false;
    if (!modelUrl) {
      view3dRef.current?.destroy?.();
      view3dRef.current = null;
      return;
    }

    const el = elRef.current;
    if (!el) return;

    setError(null);
    setLoading(true);

    (async () => {
      try {
        const mod = await import("@egjs/view3d");
        if (cancelled) return;
        const View3D = (mod as any).default || mod;
        const ControlBar = (mod as any).ControlBar;

        view3dRef.current?.destroy?.();
        controlBarRef.current = null;

        const opts = buildOptions(modelUrl, config);
        const instance = new View3D(el, opts);
        view3dRef.current = instance;

        if (config.showControls && ControlBar) {
          try {
            const cb = new ControlBar();
            instance.loadPlugins(cb);
            controlBarRef.current = cb;
          } catch (e) {
            console.warn("[preview] ControlBar plugin failed", e);
          }
        }

        instance.once?.("ready", () => {
          if (!cancelled) setLoading(false);
        });
        instance.once?.("loadError", () => {
          if (!cancelled) {
            setError("Failed to load model");
            setLoading(false);
          }
        });
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initKey]);

  useEffect(() => {
    const v3d = view3dRef.current;
    if (!v3d) return;
    try {
      if (typeof config.exposure === "number") v3d.exposure = config.exposure;
    } catch {}
    try {
      const auto = v3d.autoPlayer;
      if (auto) {
        if (config.autoRotate) auto.enable?.();
        else auto.disable?.();
      }
    } catch {}
    try {
      if (v3d.control) {
        if (v3d.control.rotate)
          v3d.control.rotate.enabled = config.rotate;
        if (v3d.control.translate)
          v3d.control.translate.enabled = config.translate;
        if (v3d.control.zoom) v3d.control.zoom.enabled = config.zoom;
      }
    } catch {}
    try {
      v3d.scrollable = config.scrollable;
      v3d.wheelScrollable = config.wheelScrollable;
      v3d.useGrabCursor = config.useGrabCursor;
    } catch {}
    try {
      if (v3d.camera) {
        if (typeof config.yaw === "number") v3d.camera.yaw = config.yaw;
        if (typeof config.pitch === "number")
          v3d.camera.pitch = config.pitch;
      }
    } catch {}
  }, [
    config.exposure,
    config.autoRotate,
    config.rotate,
    config.translate,
    config.zoom,
    config.scrollable,
    config.wheelScrollable,
    config.useGrabCursor,
    config.yaw,
    config.pitch,
  ]);

  useEffect(() => {
    return () => {
      view3dRef.current?.destroy?.();
      view3dRef.current = null;
    };
  }, []);

  const bgIsColor = config.background.startsWith("#");

  if (!modelUrl) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground text-sm",
          className,
        )}
        style={{ height: config.height }}
      >
        Upload a model to see the preview
      </div>
    );
  }

  return (
    <div
      ref={elRef}
      className={cn(
        "relative overflow-hidden rounded-lg border view3d-wrapper",
        className,
      )}
      style={{
        height: config.height,
        background: bgIsColor ? config.background : "#f4f4f4",
      }}
    >
      <canvas className="view3d-canvas" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-background/40">
          Loading model…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/10 text-destructive text-xs p-4 text-center">
          {error}
        </div>
      )}
    </div>
  );
}
