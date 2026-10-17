import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useLocation, useNavigation } from "react-router";

/*
 * Core Web Vitals readout for the embedded admin pages.
 *
 * Two groups, because an embedded admin app produces two quite different kinds
 * of page load and only one of them has Web Vitals at all:
 *
 *   load   The first document. Real LCP, FCP, TTFB and CLS, straight from
 *          PerformanceObserver. Measured once and then left alone — these
 *          belong to that document and never change again.
 *
 *   route  Every client-side navigation after it. The browser produces no new
 *          LCP or FCP for these: both are per-document, and React Router swaps
 *          the route without a new one. What can be measured is the wait the
 *          merchant actually experiences, so that is what this times — the data
 *          round trip and the paint that follows it — re-captured on each move.
 *
 * Measured with PerformanceObserver rather than App Bridge's
 * `webVitals.onReport`. That API looks like the obvious source and is not: App
 * Bridge measures the metrics itself, posts them *up* to the admin, and only
 * invokes `onReport` when the admin pushes a `webVitalsReport` event back down
 * — which, in an ordinary embedded session, it does not.
 *
 * Painted on the page rather than only logged. The admin shell and this app are
 * separate frames, so console output lands under whichever context DevTools is
 * scoped to, and a stray filter hides it with no sign anything was written.
 *
 * On in development; in production it needs `?vitals=1`. Merchants never see it.
 */

const STORAGE_KEY = "e3dv:vitals";

// Google's "good" thresholds for the real metrics. The two route timings have
// no standard budget — nobody has defined one for a soft navigation — so these
// are house numbers, set where a transition starts to feel slow rather than
// where anyone official says it does.
const BUDGETS: Record<string, number> = {
  LCP: 2500,
  FCP: 1800,
  TTFB: 800,
  CLS: 0.1,
  data: 700,
  paint: 1000,
};

type Row = { value: number; verdict: "PASS" | "FAIL" | "—"; detail?: string };
type Rows = [string, Row][];

/* Neither entry type is in TypeScript's DOM lib. */
type LayoutShiftEntry = PerformanceEntry & {
  value: number;
  hadRecentInput: boolean;
};
type LcpEntry = PerformanceEntry & { element?: Element | null };

declare global {
  interface Window {
    /** Prints both groups to the console on demand. */
    vitals?: () => void;
  }
}

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private browsing, or storage blocked by the embedding admin.
    return false;
  }
}

function writeFlag(on: boolean) {
  try {
    sessionStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function makeRow(name: string, value: number, detail?: string): Row {
  const budget = BUDGETS[name];
  // CLS is a unitless ratio; everything else is milliseconds, where
  // sub-millisecond precision on a 2.5s budget is noise.
  const rounded =
    name === "CLS" ? Math.round(value * 1000) / 1000 : Math.round(value);
  return {
    value: rounded,
    verdict: budget === undefined ? "—" : value <= budget ? "PASS" : "FAIL",
    detail,
  };
}

/** Enough of the element to find it in the page, without dumping its markup. */
function describe(el: Element | null | undefined): string | undefined {
  if (!el) return undefined;
  const id = el.id ? `#${el.id}` : "";
  const cls =
    typeof el.className === "string" && el.className
      ? `.${el.className.trim().split(/\s+/)[0]}`
      : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

/** Ordered upsert: keeps a metric in place when its value is revised. */
function upsert(rows: Rows, name: string, row: Row): Rows {
  const next = rows.filter(([key]) => key !== name);
  next.push([name, row]);
  // Stable order regardless of which observer fired first.
  const order = ["TTFB", "FCP", "LCP", "CLS", "data", "paint"];
  next.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  return next;
}

export function WebVitals() {
  const shopify = useAppBridge();
  const { pathname, search, key: locationKey } = useLocation();
  const navigation = useNavigation();

  const [loadRows, setLoadRows] = useState<Rows>([]);
  const [routeRows, setRouteRows] = useState<Rows>([]);
  const [hidden, setHidden] = useState(false);

  // When the current client-side navigation began, and how much layout shift
  // has accumulated since. Refs, because the observers and the timing effects
  // outlive the render that created them.
  const navStart = useRef<number | null>(null);
  const routeCls = useRef(0);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // Mirrors for `window.vitals`, which is created once and would otherwise
  // close over the first render's empty arrays.
  const loadRowsRef = useRef<Rows>([]);
  const routeRowsRef = useRef<Rows>([]);
  loadRowsRef.current = loadRows;
  routeRowsRef.current = routeRows;

  /* ---- The first document. Measured once, for the lifetime of the page. ---- */
  useEffect(() => {
    const param = new URLSearchParams(search).get("vitals");
    if (param !== null) writeFlag(param !== "0" && param !== "false");

    /*
     * Installed before the observers: anything below can throw on a browser or
     * host that surprises us, and the console entry point is exactly what you
     * reach for when the rest of this has gone quiet.
     */
    window.vitals = () => {
      console.log(
        `%c web vitals %c ${pathRef.current} `,
        "background:#008060;color:#fff;font-weight:700",
        "background:#303030;color:#fff",
      );
      console.table(Object.fromEntries(loadRowsRef.current));
      console.table(Object.fromEntries(routeRowsRef.current));
    };

    const observers: PerformanceObserver[] = [];
    const observe = (
      type: string,
      handler: (entries: PerformanceEntryList) => void,
    ) => {
      try {
        const po = new PerformanceObserver((list) =>
          handler(list.getEntries()),
        );
        // `buffered` replays entries that landed before this effect ran, which
        // is always the case for FCP and usually for the first LCP candidate.
        // Verified: a late observer does still receive them.
        po.observe({ type, buffered: true });
        observers.push(po);
      } catch {
        // Older browsers reject unknown entry types; skip that metric.
      }
    };

    // LCP keeps revising upward until the first interaction or page hide, so
    // the last entry wins and the row is rewritten as candidates arrive.
    observe("largest-contentful-paint", (entries) => {
      const last = entries.at(-1) as LcpEntry | undefined;
      if (last) {
        setLoadRows((r) =>
          upsert(
            r,
            "LCP",
            makeRow("LCP", last.startTime, describe(last.element)),
          ),
        );
      }
    });

    observe("paint", (entries) => {
      const fcp = entries.find((e) => e.name === "first-contentful-paint");
      if (fcp) {
        setLoadRows((r) => upsert(r, "FCP", makeRow("FCP", fcp.startTime)));
      }
    });

    let cls = 0;
    observe("layout-shift", (entries) => {
      for (const e of entries as LayoutShiftEntry[]) {
        // Shifts within 500ms of an interaction are the merchant's own doing.
        if (e.hadRecentInput) continue;
        cls += e.value;
        // The same shift counts against the current route as well, so a
        // navigation that reflows shows up where it happened.
        if (navStart.current !== null || routeCls.current > 0) {
          routeCls.current += e.value;
        }
      }
      setLoadRows((r) => upsert(r, "CLS", makeRow("CLS", cls)));
    });

    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    // Usually the single biggest component of LCP on these pages, since every
    // route authenticates and hits Mongo before it renders.
    if (nav) {
      setLoadRows((r) => upsert(r, "TTFB", makeRow("TTFB", nav.responseStart)));
    }

    /*
     * Attached as well, though it stays quiet unless the admin volunteers a
     * report. When it does speak it overrides the local number for that metric:
     * that is the value Shopify itself recorded.
     */
    const onReport = shopify.webVitals?.onReport;
    void onReport?.(({ metrics }) => {
      for (const { name, value } of metrics) {
        setLoadRows((r) => upsert(r, name, makeRow(name, value)));
      }
    });

    return () => {
      for (const po of observers) po.disconnect();
      void onReport?.(null);
      delete window.vitals;
    };
    // Mount only: these observers cover the whole document lifetime, and
    // re-running them per navigation would replay the same buffered entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Each client-side navigation, re-captured from scratch. ---- */

  // React Router reports "loading" the moment a navigation starts, which is the
  // closest thing a soft navigation has to a navigationStart.
  useEffect(() => {
    if (navigation.state === "loading") {
      navStart.current = performance.now();
      routeCls.current = 0;
      // Cleared rather than left stale: the previous route's numbers describe a
      // transition that is over, and leaving them up while a new one is in
      // flight is the thing this was asked to stop doing.
      setRouteRows([]);
    }
  }, [navigation.state]);

  // Fires once the new route has committed, which is the render this runs in.
  useEffect(() => {
    const started = navStart.current;
    if (started === null) return; // The first document, covered above.
    navStart.current = null;

    const settled = performance.now();
    setRouteRows((r) => upsert(r, "data", makeRow("data", settled - started)));

    /*
     * Two frames, not one. A single rAF callback runs *before* the paint it was
     * scheduled against; the second one is the first moment the pixels for this
     * route are actually on screen, which is what the merchant waited for.
     */
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const painted = performance.now();
        setRouteRows((r) => {
          const withPaint = upsert(
            r,
            "paint",
            makeRow("paint", painted - started),
          );
          return upsert(withPaint, "CLS", makeRow("CLS", routeCls.current));
        });
      });
    });

    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [locationKey]);

  const enabled = import.meta.env.DEV || readFlag();
  if (!enabled || hidden || (loadRows.length === 0 && routeRows.length === 0)) {
    return null;
  }

  const tint = (v: Row["verdict"]) =>
    v === "FAIL" ? "#ff8a80" : v === "PASS" ? "#8aff9e" : "#fff";

  const group = (label: string, rows: Rows, note: string) =>
    rows.length === 0 ? null : (
      <div style={{ marginTop: 6 }}>
        <div style={{ opacity: 0.55, fontSize: 10, letterSpacing: 0.4 }}>
          {label} <span style={{ opacity: 0.7 }}>{note}</span>
        </div>
        {rows.map(([name, row]) => (
          <div
            key={name}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <span>{name}</span>
            <span style={{ color: tint(row.verdict) }}>
              {row.value}
              {name === "CLS" ? "" : "ms"}
            </span>
          </div>
        ))}
      </div>
    );

  /*
   * Inline styles and a plain div on purpose: an s-* element would be inert
   * until polaris.js defines it, and this needs to be readable during exactly
   * the window where that has not happened yet.
   */
  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 2147483647,
        background: "rgba(26,26,26,0.94)",
        color: "#fff",
        font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
        borderRadius: 8,
        padding: "8px 12px 10px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        minWidth: 210,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          opacity: 0.7,
        }}
      >
        <span>{pathname}</span>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="Hide web vitals"
          style={{
            background: "none",
            border: 0,
            color: "inherit",
            cursor: "pointer",
            padding: 0,
            font: "inherit",
          }}
        >
          ×
        </button>
      </div>
      {group("LOAD", loadRows, "first document")}
      {group(
        "ROUTE",
        routeRows,
        navigation.state === "idle" ? "this navigation" : "measuring…",
      )}
    </div>
  );
}
