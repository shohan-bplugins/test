// Real-user Core Web Vitals for the embedded admin.
//
// These are the same metrics Shopify aggregates on /monitoring/admin_performance,
// with two additions that page doesn't give us:
//
//   1. the route the document loaded on, so a slow p75 can be traced to a page
//      instead of the whole app, and
//   2. LCP broken into its four phases, which answers the only question that
//      matters when LCP is bad — whether the time went to the Remix loader
//      (ttfb) or to the client bundle (elementRenderDelay).
//
// Everything is logged to the console as it arrives. Call __vitals() at any
// point for a table of what has been collected so far, or __vitals.raw for the
// full metric objects. To silence the logging:
//   localStorage.setItem("svp:vitals", "0")   // then reload
//
// App Bridge patches window.fetch to attach the session token to same-origin
// requests, so the POST below authenticates without us touching the token.
// (navigator.sendBeacon would bypass that patch and arrive unauthenticated.)

import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals/attribution";

const ENDPOINT = "/app/api/vitals";

// One decisive line, logged once when LCP is final. reportAllChanges is
// deliberately off — with it on, every paint candidate logs and the last line
// is the only real one, which is easy to misread.
onLCP((lcp) => {
  const a = lcp.attribution || {};
  const nav = performance.getEntriesByType("navigation")[0] || {};
  const r = (n) => (typeof n === "number" ? Math.round(n) : "?");

  // The four phases sum to LCP; whichever is biggest is the thing to fix.
  const phases = {
    "server (ttfb)": r(a.timeToFirstByte),
    "load delay": r(a.resourceLoadDelay),
    "load": r(a.resourceLoadDuration),
    "render (client)": r(a.elementRenderDelay),
  };
  const worst = Object.entries(phases).sort((x, y) => y[1] - x[1])[0];

  console.log(
    `web-vitals: LCP ${(lcp.value / 1000).toFixed(2)}s` +
      `  ←  ${worst[0]} ${worst[1]}ms is the bottleneck` +
      `\n  phases: server ${phases["server (ttfb)"]}ms · loadDelay ${phases["load delay"]}ms` +
      ` · load ${phases["load"]}ms · render ${phases["render (client)"]}ms` +
      `\n  document TTFB (independent check): ${r(nav.responseStart)}ms` +
      `\n  LCP element: ${a.target || "(unknown)"}` +
      `\n  url: ${a.url || "(not a resource)"}`,
  );
}, {});

onCLS(
  (cls) => {
    console.log("web-vitals: CLS", cls.value / 1000);
    console.log("web-vitals: CLS details", cls.entries);
  },
  { reportAllChanges: true },
);

onINP(
  (inp) => {
    console.log("web-vitals: INP", inp.value / 1000);
    console.log("web-vitals: INP details", inp.entries);
  },
  { reportAllChanges: true },
);

// LCP and TTFB are measured once per document. Remix navigates client-side, so
// by the time a metric reports, location.pathname may have moved on — the route
// that actually owns the measurement is the one the document loaded on.
const loadPath = typeof window === "undefined" ? "" : window.location.pathname;

const ms = (n) => (typeof n === "number" ? Math.round(n) : null);

const COLOR = {
  good: "#1c6b45",
  "needs-improvement": "#8a5806",
  poor: "#a32a20",
};

// Thresholds web-vitals uses for the `rating`, shown so a number reads in
// context rather than as a bare figure.
const BUDGET = {
  LCP: "good ≤2500ms · poor >4000ms",
  INP: "good ≤200ms · poor >500ms",
  CLS: "good ≤0.1 · poor >0.25",
  FCP: "good ≤1800ms · poor >3000ms",
  TTFB: "good ≤800ms · poor >1800ms",
};

const collected = {};
const raw = {};

function logMetric(metric, body) {
  const unit = metric.name === "CLS" ? "" : "ms";
  const color = COLOR[metric.rating] || "#4b5d68";

  console.groupCollapsed(
    `%c● %c${metric.name} %c${body.value}${unit}%c ${metric.rating}  %c${BUDGET[metric.name] || ""}`,
    `color:${color}`,
    "font-weight:600",
    `color:${color};font-weight:700`,
    `color:${color}`,
    "color:#7a8a94;font-weight:400",
  );

  // LCP's four phases sum to the metric. Whichever dominates is the cause.
  if (metric.name === "LCP" && typeof body.ttfb === "number") {
    const phases = [
      ["1. Time to first byte (server)", body.ttfb],
      ["2. Resource load delay", body.resourceLoadDelay],
      ["3. Resource load duration", body.resourceLoadDuration],
      ["4. Element render delay (client)", body.elementRenderDelay],
    ];
    console.table(
      Object.fromEntries(
        phases.map(([label, v]) => [
          label,
          {
            ms: v ?? 0,
            "% of LCP": `${Math.round(((v ?? 0) / body.value) * 100)}%`,
          },
        ]),
      ),
    );
    const [worst] = [...phases].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    console.log(
      `%c→ dominated by ${worst[0]}`,
      "color:#0c5b68;font-weight:600",
      worst[0].includes("server")
        ? "— the Remix loader is the bottleneck, not the bundle."
        : "— client-side work is the bottleneck, not the server.",
    );
  }

  if (body.target) console.log("element:", body.target);
  console.log("route:", body.path, "· navigation:", body.navType);
  console.log("raw:", metric);
  console.groupEnd();
}

function report(metric) {
  const a = metric.attribution || {};

  const body = {
    metric: metric.name,
    // CLS is unitless and small; everything else is milliseconds.
    value:
      metric.name === "CLS"
        ? Number(metric.value.toFixed(4))
        : ms(metric.value),
    rating: metric.rating,
    path: loadPath,
    navType: metric.navigationType ?? null,
    // LCP only: these four sum to the metric value.
    ttfb: ms(a.timeToFirstByte),
    resourceLoadDelay: ms(a.resourceLoadDelay),
    resourceLoadDuration: ms(a.resourceLoadDuration),
    elementRenderDelay: ms(a.elementRenderDelay),
    // Whichever element the metric blames, normalized to one field.
    target: a.target || a.largestShiftTarget || a.interactionTarget || null,
  };

  collected[metric.name] = body;
  raw[metric.name] = metric;

  if (LOGGING) logMetric(metric, body);

  try {
    // keepalive lets the request outlive the page — LCP/CLS/INP finalize on hide.
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* telemetry must never break the page */
  }
}

let LOGGING = true;
let started = false;

export function startWebVitals() {
  if (started) return;
  started = true;

  try {
    LOGGING = localStorage.getItem("svp:vitals") !== "0";
  } catch {
    /* storage can throw in a partitioned frame; keep logging on */
  }

  // Metrics land at different times — TTFB and FCP early, LCP mid-load, CLS and
  // INP only when the page is hidden. This dumps whatever is final so far.
  window.__vitals = () => {
    const rows = Object.fromEntries(
      ["TTFB", "FCP", "LCP", "CLS", "INP"]
        .filter((k) => collected[k])
        .map((k) => {
          const b = collected[k];
          return [
            k,
            {
              value: b.value,
              rating: b.rating,
              "server (ttfb)": b.ttfb ?? "",
              "client render": b.elementRenderDelay ?? "",
              element: b.target || "",
            },
          ];
        }),
    );
    console.table(rows);
    console.log("route:", loadPath);
    return rows;
  };
  window.__vitals.raw = raw;

  onLCP(report);
  onCLS(report);
  onINP(report);
  onTTFB(report);
  onFCP(report);

  if (LOGGING) {
    console.log(
      "%c[web-vitals]%c collecting LCP · INP · CLS · TTFB · FCP — call %c__vitals()%c for a summary. CLS and INP finalize when the page is hidden (switch tabs to force them).",
      "color:#0c5b68;font-weight:700",
      "color:#4b5d68",
      "color:#0c5b68;font-weight:600",
      "color:#4b5d68",
    );
  }
}
