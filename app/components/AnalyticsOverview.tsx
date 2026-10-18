import { Suspense, type ReactNode } from "react";
import { Await, useNavigate } from "react-router";

import type { AnalyticsOverview } from "~/lib/viewer-stats";

/*
 * The Home page's window onto Analytics: the headline numbers and a small
 * views trend, linking through to the full page. Every number on every plan:
 * the last 7 days on Free, the last 30 on paid plans.
 *
 * Streamed — the dashboard loader returns the overview as a promise and this
 * renders a skeleton until it lands — so the card never holds up the Home
 * page's first paint.
 */

const fmt = (n: number) => n.toLocaleString("en-US");

function change(now: number, before: number) {
  if (before === 0) return null;
  const v = Math.round(((now - before) / before) * 100);
  return {
    label: `${v > 0 ? "↑ " : v < 0 ? "↓ " : ""}${Math.abs(v)}%`,
    tone: (v > 0 ? "success" : v < 0 ? "critical" : "neutral") as
      | "success"
      | "critical"
      | "neutral",
  };
}

/** A tiny line of daily views. Decorative: the numbers beside it say it all. */
function Sparkline({ values }: { values: number[] }) {
  const W = 240;
  const H = 40;
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => {
      const x = values.length > 1 ? (i / (values.length - 1)) * W : W / 2;
      const y = H - 2 - (v / max) * (H - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className="ao-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={`0,${H} ${pts} ${W},${H}`}
        fill="var(--ao-fill)"
        stroke="none"
      />
      <polyline
        points={pts}
        fill="none"
        stroke="var(--ao-line)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/*
 * Every tile has the same three rows, so the row of four lines up whatever the
 * label length or plan:
 *   label            — one line, never wrapped
 *   value  [tag]     — the number (or •••• when locked), with the change badge
 *                      or the PRO tag at the right
 *   footer           — the trend line, "Upgrade to see", or a quiet note
 */
function Tile({
  label,
  value,
  tag,
  footer,
  locked,
  className,
}: {
  label: string;
  value: string;
  tag: ReactNode;
  footer: ReactNode;
  locked?: boolean;
  className?: string;
}) {
  return (
    <div className={className ? `ao-stat ${className}` : "ao-stat"}>
      <span className="ao-label" title={label}>
        {label}
      </span>
      <div className="ao-value-row">
        <span
          className={locked ? "ao-value ao-locked" : "ao-value"}
          aria-label={locked ? "Locked" : undefined}
        >
          {value}
        </span>
        {tag}
      </div>
      <div className="ao-footer">{footer}</div>
    </div>
  );
}


function badge(now: number | null, before: number | null) {
  const c = now !== null && before !== null ? change(now, before) : null;
  return c ? <s-badge tone={c.tone}>{c.label}</s-badge> : null;
}

export function AnalyticsOverviewBody({ o }: { o: AnalyticsOverview }) {
  const engagement =
    o.interact !== null && o.views > 0
      ? Math.round((o.interact / o.views) * 1000) / 10
      : null;
  const prevEngagement =
    o.interactPrev !== null && o.viewsPrev > 0
      ? Math.round((o.interactPrev / o.viewsPrev) * 1000) / 10
      : null;

  const metric = (
    label: string,
    value: number | null,
    before: number | null,
    suffix = "",
  ) => (
    <Tile
      label={label}
      value={value === null ? "—" : `${fmt(value)}${suffix}`}
      tag={badge(value, before)}
      footer={
        before === null || before === 0 ? (
          <span className="ao-sub">No earlier data</span>
        ) : (
          <span className="ao-sub">{`vs previous ${o.days} days`}</span>
        )
      }
    />
  );

  return (
    <div className="ao-grid">
      <Tile
        className="ao-stat-views"
        label="3D views"
        value={fmt(o.views)}
        tag={badge(o.views, o.viewsPrev)}
        footer={<Sparkline values={o.daily} />}
      />
      {metric("Interactions", o.interact, o.interactPrev)}
      {metric("AR Click", o.ar, o.arPrev)}
      {metric("Engagement rate", engagement, prevEngagement, "%")}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="ao-grid" role="status" aria-label="Loading analytics">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="ao-stat">
          <span className="ao-skel" style={{ width: "50%" }} />
          <span className="ao-skel" style={{ width: "35%", height: 20 }} />
        </div>
      ))}
    </div>
  );
}

export function AnalyticsOverviewCard({
  overview,
}: {
  overview: Promise<AnalyticsOverview>;
}) {
  const navigate = useNavigate();
  return (
    <s-section>
      <style>{AO_CSS}</style>
      <s-stack direction="block" gap="base">
        <div className="ao-head">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-heading>Analytics</s-heading>
            <s-badge tone="info">New</s-badge>
            {/* The period depends on the plan, which arrives with the data. */}
            <Suspense fallback={null}>
              <Await resolve={overview} errorElement={null}>
                {(o) => (
                  <span className="ao-sub">
                    {`Last ${o.days} days`}
                    {o.paid ? null : (
                      <>
                        {" · "}
                        <s-link href="/app/pricing">Upgrade for 30 days</s-link>
                      </>
                    )}
                  </span>
                )}
              </Await>
            </Suspense>
          </s-stack>
          <s-button
            variant="secondary"
            icon="chart-line"
            onClick={() => navigate("/app/analytics")}
          >
            View analytics
          </s-button>
        </div>
        <div className="ao-wrap">
          <Suspense fallback={<Skeleton />}>
            <Await
              resolve={overview}
              errorElement={
                <s-paragraph>
                  <s-text color="subdued">
                    Couldn’t load analytics right now.{" "}
                    <s-link href="/app/analytics">Open Analytics</s-link>
                  </s-text>
                </s-paragraph>
              }
            >
              {(o) => <AnalyticsOverviewBody o={o} />}
            </Await>
          </Suspense>
        </div>
      </s-stack>
    </s-section>
  );
}

const AO_CSS = `
.ao-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
/*
 * All four tiles on one line wherever the card has room, 2 x 2 where it does
 * not — never three and an orphan. Sized by the card's own width (a container
 * query), not the window's: on the dashboard it shares the row with the
 * sidebar column, so the viewport says nothing about the space it has.
 */
.ao-wrap { container-type: inline-size; }
.ao-grid {
  display: grid; gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@container (min-width: 520px) {
  .ao-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.ao-stat {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; border: 1px solid #e3e3e3; border-radius: 10px; min-width: 0;
}
.ao-stat-views { --ao-line: #2a78d6; --ao-fill: rgba(42, 120, 214, 0.10); }
.ao-label {
  font-size: 13px; color: #616161; line-height: 18px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ao-value-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 6px; min-height: 26px;
}
/* Pinned to the bottom, so footers line up even if one tile is taller. */
.ao-footer { margin-top: auto; min-height: 20px; display: flex; align-items: flex-end; }
.ao-footer .ao-spark { margin-top: 2px; }
.ao-value { font-size: 1.25rem; font-weight: 650; line-height: 1.2; font-variant-numeric: tabular-nums; }
.ao-locked { letter-spacing: 3px; color: #8a8a8a; filter: blur(1.5px); user-select: none; }
.ao-sub { font-size: 12px; line-height: 16px; color: #616161; }
.ao-spark { display: block; width: 100%; height: 40px; }
.ao-pro {
  display: inline-flex; align-items: center; height: 18px; padding: 0 7px;
  border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
  color: #fff; background: linear-gradient(135deg, #7c3aed, #2a78d6);
}
.ao-skel {
  display: block; height: 12px; border-radius: 6px;
  background: linear-gradient(90deg, #ececec 25%, #f6f6f6 50%, #ececec 75%);
  background-size: 200% 100%; animation: ao-shimmer 1.2s ease-in-out infinite;
}
@keyframes ao-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .ao-skel { animation: none; } }
@media (prefers-color-scheme: dark) {
  .ao-stat { border-color: #3a3a3a; }
  .ao-stat-views { --ao-line: #3987e5; --ao-fill: rgba(57, 135, 229, 0.16); }
  .ao-sub, .ao-label { color: #b5b5b5; }
  .ao-skel { background: linear-gradient(90deg, #2a2a2a 25%, #333 50%, #2a2a2a 75%); background-size: 200% 100%; }
}
`;
