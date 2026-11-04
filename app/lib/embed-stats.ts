import { useCallback, useEffect, useRef } from "react";

/*
 * Counts this embed in the merchant's Analytics, as the storefront widget
 * counts a theme block (extensions/viewer-3d/assets/viewer-3d.js): one view
 * per page load; one interaction on the first press, drag or scroll on the
 * viewer; AR and each control once per page load (ViewerPreview's onTrack);
 * and the time the model was on screen. Sent as beacons so they never delay
 * or break the page. See api.viewer-event.tsx.
 */
/** Same classes as the storefront script: coarse pointer → touch device. */
function deviceClass(): string {
  try {
    if (!window.matchMedia("(pointer: coarse)").matches) return "desktop";
    return Math.min(screen.width, screen.height) >= 768 ? "tablet" : "mobile";
  } catch {
    return "unknown";
  }
}

function beacon(body: Record<string, unknown>) {
  try {
    if (navigator.webdriver) return;
    navigator.sendBeacon?.("/api/viewer-event", JSON.stringify(body));
  } catch {
    // Analytics must never break the viewer.
  }
}

export function useEmbedStats(modelId: string) {
  const ref = useRef<HTMLElement>(null);
  const sent = useRef(new Set<string>());

  /** Counts `event` at most once per page load. */
  const track = useCallback(
    (e: string) => {
      if (sent.current.has(e)) return;
      sent.current.add(e);
      beacon({ m: modelId, e, d: deviceClass() });
    },
    [modelId],
  );

  useEffect(() => {
    sent.current = new Set();
    track("view");
    const el = ref.current;
    if (!el) return;
    // Capture phase: the canvas library stops some events from bubbling.
    const TYPES = ["pointerdown", "wheel", "touchstart"] as const;
    const detach = () => {
      for (const t of TYPES) el.removeEventListener(t, onFirst, true);
    };
    const onFirst = (e: Event) => {
      // Presses on the viewer's own buttons are not the model.
      if ((e.target as Element | null)?.closest?.("button")) return;
      detach();
      track("interact");
    };
    for (const t of TYPES) {
      el.addEventListener(t, onFirst, { passive: true, capture: true });
    }

    /*
     * Time with the 3D model — "Avg. time with 3D". As on the storefront:
     * counted only while at least half the viewer is on screen (inside an
     * iframe that is the top-level page's screen) and the tab is visible;
     * reported when the page is hidden or left, as the seconds since the last
     * report, capped per report; `n` marks a viewer's first report so the
     * average counts each viewer once.
     */
    let ms = 0;
    let since = 0;
    let onScreen = false;
    let reported = false;
    const start = () => {
      if (!since && onScreen && document.visibilityState === "visible") {
        since = Date.now();
      }
    };
    const stop = () => {
      if (since) {
        ms += Date.now() - since;
        since = 0;
      }
    };
    const report = () => {
      stop();
      const secs = Math.min(600, Math.round(ms / 1000));
      ms = 0;
      if (secs < 1) return;
      beacon({ m: modelId, e: "dwell", v: secs, n: reported ? 0 : 1, d: deviceClass() });
      reported = true;
    };
    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              onScreen = entries[entries.length - 1].intersectionRatio >= 0.5;
              if (onScreen) start();
              else stop();
            },
            { threshold: [0, 0.5] },
          )
        : null;
    io?.observe(el);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") report();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", report);

    return () => {
      detach();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", report);
      report();
    };
  }, [modelId, track]);

  return { ref, track };
}
