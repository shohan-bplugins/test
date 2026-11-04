import { useEffect, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

/*
 * Opens Shopify's own App Store review modal after a success moment.
 *
 * Whether to ask is decided on the server (app/lib/review-prompt.server.ts) and
 * handed down as a signal; Shopify may still decline to show it, and the
 * answer is reported back so the next ask respects it.
 *
 * Debug mode: open any admin page with `?review=debug` (and `?review=off` to
 * leave it). It lasts for the browser tab. Debug mode skips every rule: at
 * each success moment Shopify's real modal opens, nothing is recorded, and a
 * toast names the rules that would have blocked a live ask. The debug panel
 * shows each rule's live status. It works only when the server allows review debugging: outside
 * production, or with REVIEW_DEBUG=1. Elsewhere the flag does nothing.
 */

/** Long enough for the "Saved" toast to be seen before the modal covers it. */
const DELAY_MS = 2000;

/** Settings saves needed in one visit before a save may ask. */
const MIN_SETTINGS_SAVES = 2;

const DEBUG_KEY = "e3v-review-debug";
const CHECKED_EVENT = "e3v-review-checked";

/** Mirrors ReviewPromptSignal in review-prompt.server.ts. */
export type ReviewSignal = {
  id: string;
  trigger: string;
  ask: boolean;
  debug?: { failed: string[]; views: number | null };
};

const TRIGGER_LABELS: Record<string, string> = {
  "views-milestone": "lifetime views milestone",
  "onboarding-finished": "onboarding finished",
  "theme-block-confirmed": "theme block confirmed",
  "settings-saved": "viewer settings saved",
  "model-assigned": "model added to a product",
};

/*
 * Module scope: reset only by a full reload, which is what "a new visit" means
 * in an embedded app.
 *  - askedThisVisit   rule 7, at most one ask per visit
 *  - settingsSaves    saves seen this visit; the first one never asks
 *  - handled          signals already acted on, so a remount cannot replay one
 */
let askedThisVisit = false;
let settingsSaves = 0;
const handled = new Set<string>();

/** Reads and remembers `?review=debug` for the rest of the tab session. */
let debugThisVisit = false;

function debugRequested(): boolean {
  const flag = new URLSearchParams(window.location.search).get("review");
  // Kept in memory too, so debug mode works even where the admin's frame
  // blocks storage; storage only carries it across reloads.
  if (flag === "debug") debugThisVisit = true;
  if (flag === "off") debugThisVisit = false;
  try {
    if (flag === "debug") window.sessionStorage.setItem(DEBUG_KEY, "1");
    if (flag === "off") window.sessionStorage.removeItem(DEBUG_KEY);
    if (window.sessionStorage.getItem(DEBUG_KEY) === "1") return true;
  } catch {
    // Storage blocked: fall back to this visit's memory.
  }
  return debugThisVisit;
}

export function useReviewPrompt(signal: ReviewSignal | null | undefined) {
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const id = signal?.id;

  useEffect(() => {
    if (!signal) return;

    /** Saves Shopify's answer, so the cooldown and limits see this ask. */
    const report = (
      result: { success: true } | { success: false; code: string },
    ) => {
      const fd = new FormData();
      fd.set("success", result.success ? "1" : "0");
      if (!result.success) fd.set("code", result.code);
      fd.set("trigger", signal.trigger);
      fetcher.submit(fd, { method: "post", action: "/api/review-prompt" });
    };

    const timer = window.setTimeout(async () => {
      // Checked when the timer fires, not when it is set, so a re-render or a
      // development double-mount that cancels the timer does not use it up.
      if (handled.has(signal.id)) return;
      handled.add(signal.id);
      // Tells the debug panel to re-read the rules after this moment.
      window.setTimeout(
        () => window.dispatchEvent(new Event(CHECKED_EVENT)),
        1500,
      );

      const debug = signal.debug && debugRequested() ? signal.debug : null;
      const label = TRIGGER_LABELS[signal.trigger] ?? signal.trigger;

      // Rule 8 detail: only the second settings save of a visit, or later.
      let blocked: string | null = null;
      if (signal.trigger === "settings-saved") {
        settingsSaves += 1;
        if (settingsSaves < MIN_SETTINGS_SAVES) {
          blocked = `Rule 8: settings save ${settingsSaves} of ${MIN_SETTINGS_SAVES} needed this visit`;
        }
      }
      // Rule 7.
      if (!blocked && signal.ask && askedThisVisit) {
        blocked = "Rule 7: already asked this visit";
      }

      if (debug) {
        // Debug mode skips every rule: the popup opens at each trigger task,
        // whatever the rules say, and nothing is recorded, so the store's
        // review data is untouched. The toast still names the rules that
        // would have blocked a live ask.
        const reasons = [...debug.failed, ...(blocked ? [blocked] : [])];
        const views = debug.views === null ? "" : ` · views ${debug.views}`;
        const live = reasons.length
          ? ` · live would block: ${reasons.join(" · ")}`
          : " · live would ask too";
        console.info("[review debug] rules skipped", { ...signal, reasons });
        try {
          const result = await shopify.reviews.request();
          console.info("[review debug] Shopify answered", result);
          shopify.toast.show(
            result.success
              ? `Debug: review popup shown (${label})${views}${live}`
              : `Debug: Shopify declined (${label}): ${result.code}`,
            { isError: !result.success, duration: 10000 },
          );
        } catch (error) {
          console.error("[review debug] request failed", error);
          shopify.toast.show("Debug: the Reviews API is unavailable", {
            isError: true,
            duration: 8000,
          });
        }
        return;
      }

      if (!signal.ask || blocked) return;
      askedThisVisit = true;
      try {
        report(await shopify.reviews.request());
      } catch (error) {
        // An older admin without the Reviews API: nothing to show, nothing
        // to record.
        console.warn("[review] request failed", error);
      }
    }, DELAY_MS);
    return () => window.clearTimeout(timer);
    // Keyed on the signal's id: each success moment carries a fresh one, and a
    // re-render with the same signal must not start a second ask. `fetcher` is
    // stable enough for a one-shot submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, shopify]);
}

/**
 * Manual test trigger, development only (or REVIEW_DEBUG=1): open any admin
 * page with `?review=test` and Shopify's review modal is requested at once,
 * skipping every rule above. Nothing is
 * recorded, so it does not use up a real ask. Shopify still applies its own
 * limits (recently-installed, cooldown, already-reviewed, …), so the answer is
 * shown in a toast — a declined code is the reason the modal did not appear.
 */
export function ReviewPromptTest({ enabled }: { enabled: boolean }) {
  const shopify = useAppBridge();
  const { search } = useLocation();
  // On a live server the flags are ignored: no test ask, no debug toggle, and
  // no toast of any kind.
  const flag = enabled ? new URLSearchParams(search).get("review") : null;
  const testing = flag === "test";
  const { pathname } = useLocation();
  const [debugOn, setDebugOn] = useState(false);

  // Whether this tab is in debug mode, re-read on every page.
  useEffect(() => {
    setDebugOn(enabled && debugRequested());
  }, [enabled, flag, pathname]);

  // `?review=debug` and `?review=off` are remembered for the tab, so the flag
  // has to be read on whichever page it arrives with.
  useEffect(() => {
    if (flag !== "debug" && flag !== "off") return;
    const on = debugRequested();
    shopify.toast.show(
      on
        ? "Review debug on for this tab (development or REVIEW_DEBUG=1 only)"
        : "Review debug mode off",
      { duration: 5000 },
    );
  }, [flag, shopify]);

  useEffect(() => {
    if (!testing) return;
    const timer = window.setTimeout(async () => {
      try {
        const result = await shopify.reviews.request();
        const text = result.success
          ? "Review popup shown"
          : `Review popup declined by Shopify: ${result.code}`;
        console.info("[review test]", result);
        shopify.toast.show(text, {
          isError: !result.success,
          duration: 8000,
        });
      } catch (error) {
        console.error("[review test] request failed", error);
        shopify.toast.show("Review API unavailable here", { isError: true });
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [testing, shopify]);

  return debugOn ? <ReviewDebugPanel pathname={pathname} /> : null;
}

type RuleStatus = { rule: string; pass: boolean; detail: string };
type RuleReport = { rules: RuleStatus[]; milestoneUsed: boolean };

/**
 * Debug mode's live checklist: every review rule with pass or fail, on every
 * admin page. Server rules come from /api/review-prompt (development only);
 * rules 7 and 8 are known here. Re-read on each page and after each success
 * moment.
 */
function ReviewDebugPanel({ pathname }: { pathname: string }) {
  const [report, setReport] = useState<RuleReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);

  // A plain fetch rather than a fetcher: a failed fetcher load would take over
  // the page's error boundary, and here a failure should just be shown.
  // App Bridge adds the session token to requests to the app's own origin.
  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/review-prompt", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport((await res.json()) as RuleReport);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const onChecked = () => void load();
    window.addEventListener(CHECKED_EVENT, onChecked);
    return () => window.removeEventListener(CHECKED_EVENT, onChecked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const rules: RuleStatus[] = report
    ? [
        ...report.rules,
        {
          rule: "7. Once per visit",
          pass: !askedThisVisit,
          detail: askedThisVisit
            ? "Already asked this visit, reload to reset"
            : "Not asked this visit",
        },
      ]
    : [];
  const allPass = rules.length > 0 && rules.every((r) => r.pass);

  const box: React.CSSProperties = {
    position: "fixed",
    left: 12,
    bottom: 12,
    zIndex: 2147483000,
    width: 340,
    maxWidth: "calc(100vw - 24px)",
    background: "#fff",
    color: "#303030",
    border: "1px solid #c9c9c9",
    borderRadius: 10,
    boxShadow: "0 4px 16px rgba(0,0,0,.15)",
    font: "12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif",
  };

  return (
    <div style={box} role="status" aria-label="Review rules debug">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderBottom: open ? "1px solid #e3e3e3" : "none",
        }}
      >
        <strong style={{ flex: 1 }}>
          Review rules{" "}
          {report ? (
            <span style={{ color: allPass ? "#0a7a32" : "#b42318" }}>
              {allPass
                ? "· live: would ask"
                : "· live: blocked (debug skips rules)"}
            </span>
          ) : null}
        </strong>
        <button type="button" onClick={() => void load()}>
          {loading ? "…" : "Refresh"}
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open ? (
        <div style={{ padding: "6px 10px 10px" }}>
          {error ? (
            <div style={{ color: "#b42318", paddingBottom: 6 }}>
              {`Could not load the rules: ${error}. See the dev server terminal.`}
            </div>
          ) : null}
          {!report ? (
            error ? null : <div>Checking…</div>
          ) : (
            <>
              {rules.map((r) => (
                <div key={r.rule} style={{ display: "flex", gap: 6, padding: "3px 0" }}>
                  <span style={{ color: r.pass ? "#0a7a32" : "#b42318", width: 14 }}>
                    {r.pass ? "✓" : "✗"}
                  </span>
                  <span style={{ flex: 1 }}>
                    <strong>{r.rule}</strong>
                    <br />
                    <span style={{ color: "#616161" }}>{r.detail}</span>
                  </span>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, padding: "3px 0" }}>
                <span style={{ width: 14 }}>•</span>
                <span style={{ flex: 1 }}>
                  <strong>8. Success moment</strong>
                  <br />
                  <span style={{ color: "#616161" }}>
                    {`Checked only at a trigger task. Views milestone ${
                      report.milestoneUsed ? "already used" : "not used yet"
                    }.`}
                  </span>
                </span>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
