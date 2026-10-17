import { useEffect, useMemo, useRef, useState } from "react";

/*
 * Daily engagement as grouped columns: one bar per event type per period, one shared count
 * axis (all three are counts of the same unit, so a single scale is honest).
 *
 * Hand-drawn SVG rather than a chart library — three lines and a hover layer
 * are not worth ~100KB of client JavaScript on an admin page with an LCP
 * budget. Colours are the first three slots of the validated categorical
 * palette (blue, orange, aqua), which pass the colour-vision checks as a set;
 * identity never rests on colour alone because the legend names each line and
 * the tooltip lists every value by name.
 */

export type DayPoint = {
  day: string;
  view: number;
  interact: number;
  ar: number;
};

export type SeriesKey = "view" | "interact" | "ar";

export const SERIES: readonly {
  key: SeriesKey;
  label: string;
  color: string;
}[] = [
  { key: "view", label: "Views", color: "var(--viz-series-1)" },
  { key: "interact", label: "Interactions", color: "var(--viz-series-2)" },
  { key: "ar", label: "AR Click", color: "var(--viz-series-3)" },
];

/*
 * Drawn at the plot's real pixel width (measured below), not scaled from a
 * fixed viewBox: scaling made every label, line and the chart's height grow
 * with the page, so on a wide admin page the chart looked oversized. Height is
 * fixed; only the width follows the container.
 */
const DEFAULT_W = 720;
const H = 220;
// Room on the right for a centred final date label.
const PAD = { top: 12, right: 28, bottom: 28, left: 40 };

/** A round axis maximum and ~4 ticks, so gridlines land on readable numbers. */
function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? rough;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v));
  return { top, ticks };
}

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const fmt = (day: string, opts: Intl.DateTimeFormatOptions) =>
  utc(day).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

/*
 * One point per day for a month or less, per week up to ~four months, per
 * month beyond that. Daily points over 90 days or a year are too dense to
 * read or hover; a weekly or monthly sum shows the trend instead.
 */
type Grain = "day" | "week" | "month";
const GRAIN_LABEL: Record<Grain, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};
/** Pixels each date label needs, so labels never overlap. */
const LABEL_SPACE: Record<Grain, number> = { day: 52, week: 52, month: 52 };

/** `partial`: a week or month only partly inside the range, so its total is
 *  not comparable with its neighbours'. */
type Bucket = DayPoint & { label: string; title: string; partial: boolean };

function bucketize(data: DayPoint[]): { grain: Grain; buckets: Bucket[] } {
  const grain: Grain =
    data.length <= 31 ? "day" : data.length <= 120 ? "week" : "month";

  const keyOf = (day: string) => {
    if (grain === "day") return day;
    if (grain === "month") return day.slice(0, 7);
    // Weeks start on Monday.
    const d = utc(day);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };

  const groups = new Map<string, DayPoint[]>();
  for (const point of data) {
    const key = keyOf(point.day);
    const group = groups.get(key);
    if (group) group.push(point);
    else groups.set(key, [point]);
  }

  const buckets = [...groups.values()].map((days) => {
    const first = days[0].day;
    const sum = (k: SeriesKey) => days.reduce((n, d) => n + d[k], 0);
    let label: string;
    let title: string;
    if (grain === "day") {
      label = fmt(first, { month: "short", day: "numeric" });
      title = fmt(first, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } else if (grain === "week") {
      // Labelled by its first day in range, so a week clipped by the range
      // start is not named after a day the chart does not cover.
      label = fmt(first, { month: "short", day: "numeric" });
      title = `Week of ${fmt(first, { month: "short", day: "numeric", year: "numeric" })}`;
    } else {
      // Short month names, with the year only where it changes — the first
      // label and every January — as "Oct ’25", which cannot be misread as
      // the 25th of October the way "Oct 25" was.
      const d = utc(first);
      const yearMark = first === data[0].day || d.getUTCMonth() === 0;
      const short = fmt(first, { month: "short" });
      label = yearMark
        ? `${short} ’${String(d.getUTCFullYear()).slice(2)}`
        : short;
      title = fmt(first, { month: "long", year: "numeric" });
    }
    const fullLength =
      grain === "day"
        ? 1
        : grain === "week"
          ? 7
          : new Date(
              Date.UTC(
                utc(first).getUTCFullYear(),
                utc(first).getUTCMonth() + 1,
                0,
              ),
            ).getUTCDate();
    const partial = days.length < fullLength;
    if (partial) title += ` (${days.length} of ${fullLength} days)`;
    return {
      day: first,
      view: sum("view"),
      interact: sum("interact"),
      ar: sum("ar"),
      label,
      title,
      partial,
    };
  });
  return { grain, buckets };
}

export function EngagementChart({
  data: days,
  only,
  onLockedClick,
}: {
  data: DayPoint[];
  /** Restrict the chart to these lines (the Free plan shows views only). */
  only?: readonly SeriesKey[];
  /**
   * With `only`, the other lines still appear in the legend — greyed, tagged
   * PRO, drawing nothing — and pressing one calls this (the upgrade path).
   */
  onLockedClick?: () => void;
}) {
  const offered = only ? SERIES.filter((s) => only.includes(s.key)) : SERIES;
  const locked =
    only && onLockedClick ? SERIES.filter((s) => !only.includes(s.key)) : [];
  const { grain, buckets: data } = useMemo(() => bucketize(days), [days]);
  const [hover, setHover] = useState<number | null>(null);
  /*
   * Lines can be switched off from the legend — AR launches are usually a
   * fraction of views, and hiding views rescales the axis so the smaller lines
   * become readable. At least one line always stays on.
   */
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const visible = offered.filter((s) => !hidden.has(s.key));
  const toggle = (key: SeriesKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (visible.length > 1) next.add(key);
      return next;
    });
  const svgRef = useRef<SVGSVGElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(DEFAULT_W);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setW(w);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { top, ticks } = useMemo(
    () =>
      niceScale(
        Math.max(0, ...data.flatMap((d) => visible.map((s) => d[s.key]))),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, hidden],
  );

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  /*
   * Grouped columns: each day / week / month is a band, and each visible
   * series a bar inside it, side by side, growing up from the baseline.
   * Bars keep a 2px gap between them and round only their top corners, so
   * every bar stays anchored to the axis.
   */
  const n = Math.max(1, data.length);
  const band = innerW / n;
  const x = (i: number) => PAD.left + band * (i + 0.5);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const baseline = PAD.top + innerH;
  const groupW = Math.min(
    band * 0.78,
    22 * visible.length + 2 * (visible.length - 1),
  );
  const gap = visible.length > 1 && groupW / visible.length > 6 ? 2 : 0;
  const barW = Math.max(
    1,
    (groupW - gap * (visible.length - 1)) / Math.max(1, visible.length),
  );
  const barPath = (bx: number, value: number) => {
    const top = y(value);
    const h = baseline - top;
    if (h <= 0) return "";
    const r = Math.min(4, barW / 2, h);
    return (
      `M${bx},${baseline}V${top + r}` +
      `Q${bx},${top} ${bx + r},${top}H${bx + barW - r}` +
      `Q${bx + barW},${top} ${bx + barW},${top + r}V${baseline}Z`
    );
  };

  // Every point labelled when there is room (all seven days of a week, say);
  // otherwise every Nth, evenly, always ending on the last point.
  const perPoint = band;
  const labelEvery = Math.max(1, Math.ceil(LABEL_SPACE[grain] / perPoint));
  const showLabel = (i: number) => {
    const last = data.length - 1;
    if (i === last) return true;
    // From the end backwards, so the final label is never crowded out.
    return (last - i) % labelEvery === 0 && (i !== 0 || last - i >= labelEvery);
  };

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || data.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((px - PAD.left) / band);
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  }

  const hovered = hover !== null ? data[hover] : null;
  // Tooltip flips to the left of the crosshair past the chart's midpoint.
  const tipLeft = hover !== null && x(hover) > W / 2;

  return (
    <div className="viz-root">
      <style>{VIZ_CSS}</style>

      <div className="viz-legend" role="group" aria-label="Show or hide series">
        {offered.map((s) => {
          const on = !hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              className="viz-legend-item"
              aria-pressed={on}
              onClick={() => toggle(s.key)}
            >
              <span
                className="viz-swatch"
                style={{
                  background: on ? s.color : "transparent",
                  borderColor: s.color,
                }}
              />
              {s.label}
            </button>
          );
        })}
        {locked.map((s) => (
          <button
            key={s.key}
            type="button"
            className="viz-legend-item viz-legend-locked"
            onClick={onLockedClick}
            aria-label={`${s.label} — available on paid plans. Upgrade.`}
          >
            <span className="viz-swatch" style={{ borderColor: s.color }} />
            {s.label}
            <span className="viz-pro">PRO</span>
          </button>
        ))}
        <span className="viz-grain">{GRAIN_LABEL[grain]}</span>
      </div>

      <div className="viz-plot" ref={plotRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${GRAIN_LABEL[grain]} views, interactions and AR clicks. The table below lists the daily numbers.`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                className="viz-grid"
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
              />
              <text
                className="viz-axis"
                x={PAD.left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
              >
                {t.toLocaleString("en-US")}
              </text>
            </g>
          ))}

          {data.map((d, i) =>
            showLabel(i) ? (
              <text
                key={d.day}
                className="viz-axis"
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
              >
                {d.label}
              </text>
            ) : null,
          )}

          {/* The hovered period, shaded behind its bars. */}
          {hover !== null ? (
            <rect
              className="viz-band-hover"
              x={PAD.left + band * hover}
              y={PAD.top}
              width={band}
              height={innerH}
            />
          ) : null}

          {data.map((d, i) => {
            const left = x(i) - groupW / 2;
            return (
              <g
                key={d.day}
                /*
                 * A clipped first or last week/month is shorter only because
                 * fewer of its days are in range; lighter, so it does not read
                 * as a fall in traffic. The tooltip says how many days it has.
                 */
                opacity={d.partial ? 0.45 : 1}
              >
                {visible.map((s, k) => {
                  const path = barPath(left + k * (barW + gap), d[s.key]);
                  return path ? (
                    <path key={s.key} d={path} fill={s.color} />
                  ) : null;
                })}
              </g>
            );
          })}

          <line
            className="viz-baseline"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={baseline}
            y2={baseline}
          />

          {/* One wide hit area, so hovering anywhere on the plot works. */}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={innerW}
            height={innerH}
            fill="transparent"
          />
        </svg>

        {hovered ? (
          <div
            className="viz-tooltip"
            style={{
              left: `${(x(hover!) / W) * 100}%`,
              transform: tipLeft
                ? "translateX(calc(-100% - 12px))"
                : "translateX(12px)",
            }}
          >
            <div className="viz-tooltip-title">{hovered.title}</div>
            {offered.map((s) => (
              <div key={s.key} className="viz-tooltip-row">
                <span className="viz-swatch" style={{ background: s.color }} />
                <span>{s.label}</span>
                <strong>{hovered[s.key].toLocaleString("en-US")}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const VIZ_CSS = `
.viz-root {
  --viz-surface: #ffffff;
  --viz-text: #303030;
  --viz-muted: #616161;
  --viz-grid: #e3e3e3;
  --viz-series-1: #2a78d6;
  --viz-series-2: #eb6834;
  --viz-series-3: #1baf7a;
  color: var(--viz-text);
  font-size: 12px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .viz-root {
    --viz-surface: #1a1a1a;
    --viz-text: #e3e3e3;
    --viz-muted: #b5b5b5;
    --viz-grid: #3a3a3a;
    --viz-series-1: #3987e5;
    --viz-series-2: #d95926;
    --viz-series-3: #199e70;
  }
}
:root[data-theme="dark"] .viz-root {
  --viz-surface: #1a1a1a;
  --viz-text: #e3e3e3;
  --viz-muted: #b5b5b5;
  --viz-grid: #3a3a3a;
  --viz-series-1: #3987e5;
  --viz-series-2: #d95926;
  --viz-series-3: #199e70;
}
.viz-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 8px; color: var(--viz-muted); }
.viz-legend-locked { color: var(--viz-muted); border-style: dashed; }
.viz-legend-locked .viz-swatch { background: transparent; opacity: 0.6; }
.viz-pro {
  display: inline-flex; align-items: center; height: 16px; padding: 0 6px;
  border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
  color: #fff; background: linear-gradient(135deg, #7c3aed, #2a78d6);
}
.viz-grain { margin-left: auto; color: var(--viz-muted); }
.viz-legend-item {
  display: inline-flex; align-items: center; gap: 6px;
  font: inherit; color: var(--viz-text); background: none;
  border: 1px solid var(--viz-grid); border-radius: 999px;
  padding: 4px 10px; cursor: pointer;
}
.viz-legend-item[aria-pressed="false"] { color: var(--viz-muted); }
.viz-legend-item:hover { border-color: var(--viz-muted); }
.viz-legend-item:focus-visible { outline: 2px solid var(--viz-series-1); outline-offset: 2px; }
.viz-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; flex: none; border: 2px solid transparent; box-sizing: border-box; }
.viz-plot { position: relative; }
.viz-plot svg { display: block; width: 100%; height: auto; overflow: visible; touch-action: pan-y; }
.viz-grid { stroke: var(--viz-grid); stroke-width: 1; }
.viz-axis { fill: var(--viz-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.viz-band-hover { fill: var(--viz-grid); opacity: 0.45; }
.viz-baseline { stroke: var(--viz-muted); stroke-width: 1; opacity: 0.5; }
.viz-crosshair { stroke: var(--viz-muted); stroke-width: 1; stroke-dasharray: 3 3; }
.viz-dot { stroke: var(--viz-surface); stroke-width: 2; }
.viz-tooltip {
  position: absolute; top: 8px; pointer-events: none; z-index: 1;
  background: var(--viz-surface); color: var(--viz-text);
  border: 1px solid var(--viz-grid); border-radius: 8px;
  padding: 8px 10px; min-width: 150px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
}
.viz-tooltip-title { font-weight: 600; margin-bottom: 4px; }
.viz-tooltip-row { display: grid; grid-template-columns: 10px 1fr auto; gap: 6px; align-items: center; line-height: 1.6; }
.viz-tooltip-row strong { font-variant-numeric: tabular-nums; }
`;
