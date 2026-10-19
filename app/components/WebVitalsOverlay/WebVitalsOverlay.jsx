import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigation } from "@remix-run/react";

// Live Core Web Vitals for the embedded app's own iframe, measured with the
// browser's PerformanceObserver (same method Shopify's App Bridge uses).
// Values reset on every in-app page change. Browsers only report LCP for the
// full page load, so after a client-side navigation LCP is estimated: the
// time from the click until the largest element rendered for the new page.
// Shown in dev, or in production after running this in the app iframe console:
//   localStorage.setItem("webVitalsOverlay", "1")

const THRESHOLDS = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
};

const COLORS = {
  good: "#0cce6b",
  "needs-improvement": "#ffa400",
  poor: "#ff4e42",
  pending: "#8a8a8a",
};

// Elements that can be an LCP candidate (images and text blocks).
const CANDIDATES =
  "img,video,svg,canvas,h1,h2,h3,h4,h5,h6,p,li,td,th,label,span,div,s-text,s-heading,s-paragraph,s-image,s-thumbnail";

// Soft-navigation LCP stops being tracked after this long without a new candidate.
const SOFT_LCP_IDLE_MS = 3000;

const EMPTY = {
  LCP: null,
  CLS: null,
  INP: null,
  lcpElement: "",
  clsElement: "",
  inpTarget: "",
};

const rate = (name, value) => {
  if (value == null) return "pending";
  const [good, poor] = THRESHOLDS[name];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
};

const format = (name, value) => {
  if (value == null) return "—";
  return name === "CLS" ? value.toFixed(3) : `${Math.round(value)} ms`;
};

const describe = (node) => {
  if (!node || !node.tagName) return "";
  const tag = node.tagName.toLowerCase();
  const id = node.id ? `#${node.id}` : "";
  const cls =
    typeof node.className === "string" && node.className.trim()
      ? `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
  return `${tag}${id}${cls}`;
};

const observe = (type, callback, options = {}) => {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return null;
    const po = new PerformanceObserver((list) => callback(list.getEntries()));
    po.observe({ type, buffered: true, ...options });
    return po;
  } catch {
    return null;
  }
};

const hasOwnText = (el) =>
  Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
  );

// Visible area of an element, clipped to the viewport.
const visibleArea = (el) => {
  const r = el.getBoundingClientRect();
  const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
  const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
  return w > 0 && h > 0 ? w * h : 0;
};

const isCandidate = (el) => {
  if (el.closest("[data-web-vitals-overlay]")) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "div" || tag === "span" || tag === "label") return hasOwnText(el);
  return true;
};

export default function WebVitalsOverlay() {
  const location = useLocation();
  const navigation = useNavigation();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(true);
  const [vitals, setVitals] = useState(EMPTY);
  const [page, setPage] = useState({ path: "", soft: false });
  const [history, setHistory] = useState([]);

  // Mutable measurement state shared by the observers.
  const m = useRef({
    soft: false,
    cls: { value: 0, entries: [], max: 0 },
    inpWorst: 0,
    navStart: null,
    stopSoftLcp: null,
  });
  const vitalsRef = useRef(EMPTY);
  const pageRef = useRef(page);
  const firstLocation = useRef(true);

  const update = (patch) => {
    vitalsRef.current = { ...vitalsRef.current, ...patch };
    setVitals(vitalsRef.current);
  };

  useEffect(() => {
    let flag = false;
    try {
      flag = window.localStorage.getItem("webVitalsOverlay") === "1";
    } catch {
      // storage blocked
    }
    setEnabled(import.meta.env.DEV || flag);
  }, []);

  // Remember when a client-side navigation starts (the user's click).
  useEffect(() => {
    if (navigation.state === "loading" && m.current.navStart == null) {
      m.current.navStart = performance.now();
    }
  }, [navigation.state]);

  // Hard-load LCP, CLS and INP observers, alive for the whole session.
  useEffect(() => {
    if (!enabled || typeof PerformanceObserver === "undefined") return;

    const lcpObserver = observe("largest-contentful-paint", (entries) => {
      if (m.current.soft) return;
      const last = entries[entries.length - 1];
      if (last) {
        update({ LCP: last.startTime, lcpElement: describe(last.element) });
      }
    });

    // CLS: largest session window (shifts < 1s apart, window max 5s).
    const clsObserver = observe("layout-shift", (entries) => {
      const cls = m.current.cls;
      entries.forEach((entry) => {
        if (entry.hadRecentInput) return;
        const first = cls.entries[0];
        const last = cls.entries[cls.entries.length - 1];
        if (
          cls.entries.length &&
          entry.startTime - last.startTime < 1000 &&
          entry.startTime - first.startTime < 5000
        ) {
          cls.value += entry.value;
          cls.entries.push(entry);
        } else {
          cls.value = entry.value;
          cls.entries = [entry];
        }
        if (cls.value > cls.max) {
          cls.max = cls.value;
          const source = entry.sources?.find((s) => s.node)?.node;
          update({ CLS: cls.max, clsElement: describe(source) });
        }
      });
      if (vitalsRef.current.CLS == null) update({ CLS: 0 });
    });

    // INP (approximation): slowest interaction on the current page.
    const inpObserver = observe(
      "event",
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.interactionId || entry.duration <= m.current.inpWorst) {
            return;
          }
          m.current.inpWorst = entry.duration;
          update({
            INP: entry.duration,
            inpTarget: `${entry.name} ${describe(entry.target)}`.trim(),
          });
        });
      },
      { durationThreshold: 16 },
    );

    return () => {
      lcpObserver?.disconnect();
      clsObserver?.disconnect();
      inpObserver?.disconnect();
      m.current.stopSoftLcp?.();
    };
  }, [enabled]);

  // Every page change: archive the previous page and start measuring again.
  useEffect(() => {
    if (!enabled) return;
    const path = location.pathname;

    if (firstLocation.current) {
      firstLocation.current = false;
      pageRef.current = { path, soft: false };
      setPage(pageRef.current);
      return;
    }

    const prevPage = pageRef.current;
    const prevVitals = vitalsRef.current;
    setHistory((h) => [{ ...prevPage, ...prevVitals }, ...h].slice(0, 5));

    const start = m.current.navStart ?? performance.now();
    m.current.navStart = null;
    m.current.soft = true;
    m.current.cls = { value: 0, entries: [], max: 0 };
    m.current.inpWorst = 0;
    m.current.stopSoftLcp?.();
    vitalsRef.current = { ...EMPTY, CLS: 0 };
    setVitals(vitalsRef.current);
    pageRef.current = { path, soft: true };
    setPage(pageRef.current);

    m.current.stopSoftLcp = measureSoftLcp(start, (value, el) =>
      update({ LCP: value, lcpElement: describe(el) }),
    );
  }, [location.key, enabled]);

  if (!enabled) return null;

  const rows = [
    ["LCP", vitals.LCP, vitals.lcpElement],
    ["CLS", vitals.CLS, vitals.clsElement],
    ["INP", vitals.INP, vitals.inpTarget],
  ];

  return (
    <div
      data-web-vitals-overlay
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 2147483647,
        background: "rgba(20, 20, 20, 0.92)",
        color: "#fff",
        font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        minWidth: open ? 260 : 0,
        maxWidth: 340,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "block",
          padding: "6px 10px",
          fontWeight: 600,
        }}
      >
        {open ? "▾" : "▸"} Web Vitals
      </button>
      {open && (
        <div style={{ padding: "0 10px 8px" }}>
          <div style={{ opacity: 0.7, marginBottom: 6 }}>
            {page.path}{" "}
            <span style={{ opacity: 0.7 }}>
              ({page.soft ? "in-app navigation" : "full page load"})
            </span>
          </div>
          {rows.map(([name, value, detail]) => (
            <div key={name} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>
                  <Dot color={COLORS[rate(name, value)]} />
                  {name}
                  {name === "LCP" && page.soft ? " (est.)" : ""}
                </span>
                <span style={{ color: COLORS[rate(name, value)] }}>
                  {format(name, value)}
                </span>
              </div>
              {detail && (
                <div
                  title={detail}
                  style={{
                    opacity: 0.6,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {detail}
                </div>
              )}
            </div>
          ))}
          {history.length > 0 && (
            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,0.15)",
                marginTop: 4,
                paddingTop: 6,
              }}
            >
              <div style={{ opacity: 0.5, marginBottom: 4 }}>Previous pages</div>
              {history.map((h, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <span
                    title={h.path}
                    style={{
                      flex: 1,
                      opacity: 0.7,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {h.path}
                  </span>
                  {["LCP", "CLS", "INP"].map((name) => (
                    <span key={name} style={{ color: COLORS[rate(name, h[name])] }}>
                      {format(name, h[name]).replace(" ms", "")}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Dot({ color }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        marginRight: 6,
        background: color,
      }}
    />
  );
}

// Estimates LCP after a client-side navigation: watches elements added to the
// page and reports the time (from `start`) at which the largest visible one
// was painted. Stops on user input or after SOFT_LCP_IDLE_MS with no new
// largest element. Returns a cleanup function.
function measureSoftLcp(start, report) {
  let largest = 0;
  let idleTimer = null;
  let stopped = false;

  const consider = (el, paintTime) => {
    if (stopped || !el.isConnected) return;
    const area = visibleArea(el);
    if (area <= largest) return;
    largest = area;
    report(paintTime - start, el);
    resetIdle();
  };

  const check = (el) => {
    if (!isCandidate(el)) return;
    if (el.tagName === "IMG" && !el.complete) {
      el.addEventListener(
        "load",
        () => requestAnimationFrame(() => consider(el, performance.now())),
        { once: true },
      );
      return;
    }
    // Next frame ≈ when the element is painted.
    requestAnimationFrame(() => consider(el, performance.now()));
  };

  const scan = (root) => {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.matches(CANDIDATES)) check(root);
    root.querySelectorAll(CANDIDATES).forEach(check);
  };

  const mutationObserver = new MutationObserver((records) => {
    records.forEach((r) => r.addedNodes.forEach(scan));
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    mutationObserver.disconnect();
    clearTimeout(idleTimer);
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("keydown", stop, true);
  };

  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, SOFT_LCP_IDLE_MS);
  };

  mutationObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("keydown", stop, true);
  // The new page may already be rendered by the time this effect runs.
  scan(document.body);
  resetIdle();

  return stop;
}
