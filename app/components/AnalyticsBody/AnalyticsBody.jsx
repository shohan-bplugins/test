import { useNavigate } from "@remix-run/react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import AnalyticsMap from "../AnalyticsMap/AnalyticsMap";
import { EmptyState } from "../PageState/PageState";

// Covers a Pro-only card for Free plans. The wrapper divs only handle the
// overlay positioning; the content is Polaris web components.
function Lockable({ locked, children }) {
  const navigate = useNavigate();
  if (!locked) return children;
  return (
    <div className="an-lockable">
      {children}
      <div className="an-pro-overlay">
        <s-stack gap="small-200" alignItems="center">
          <s-icon type="lock"></s-icon>
          <s-text type="strong">Upgrade to unlock</s-text>
          <s-button variant="primary" onClick={() => navigate("/app/pricing")}>
            Upgrade now
          </s-button>
        </s-stack>
      </div>
    </div>
  );
}

// Upgrade prompt for Free plans whenever the range isn't fully unlocked.
export function AnalyticsUpgradeCard({ access, productLocked, onViewToday }) {
  const navigate = useNavigate();
  if (!access || access === "full") return null;

  const message = productLocked
    ? "Product analytics are free for Today. Switch the date range to Today, or upgrade to see product analytics for any date range."
    : access === "limited"
      ? "Free plans see plays, listeners, listen time and top tracks for Yesterday and the Last 7 days. Upgrade to see countries, browsers, devices and operating systems, and any date range."
      : "Free plans get full analytics for Today, and limited analytics for Yesterday and the Last 7 days. Upgrade to see every metric for any date range.";

  return (
    <s-section>
      <s-stack
        direction="inline"
        justifyContent="space-between"
        alignItems="center"
        gap="base"
      >
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type="lock"></s-icon>
          <s-text>{message}</s-text>
        </s-stack>
        <s-stack direction="inline" gap="small-200">
          {productLocked && onViewToday ? (
            <s-button onClick={onViewToday}>View Today</s-button>
          ) : null}
          <s-button variant="primary" onClick={() => navigate("/app/pricing")}>
            Upgrade
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

const proBadge = (isFree) =>
  isFree ? <s-badge tone="caution">Pro</s-badge> : null;

// Format a duration in seconds as a compact "1h 23m", "23m 4s", or "45s".
function formatDuration(totalSeconds) {
  const secs = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (secs === 0) return "0s";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatCard({ icon, label, value, meta, pro, isLoading }) {
  return (
    <Lockable locked={pro}>
      <s-box
        padding="base"
        border="base"
        borderRadius="base"
        background="base"
        blockSize="100%"
      >
        <s-stack gap="small-200">
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
          >
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type={icon} tone="success"></s-icon>
              <s-text color="subdued">{label}</s-text>
            </s-stack>
            {proBadge(pro)}
          </s-stack>
          {isLoading ? (
            <div className="an-skeleton" aria-hidden="true" />
          ) : (
            // Polaris web components have no display-size text, so the
            // headline number gets one styled element.
            <span className="an-stat-value">
              {pro
                ? "—"
                : typeof value === "number"
                  ? value.toLocaleString()
                  : value}
            </span>
          )}
          <s-text color="subdued">{meta}</s-text>
        </s-stack>
      </s-box>
    </Lockable>
  );
}

function BreakdownCard({ title, icon, data, isFree, isLoading }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const blurred = isLoading || isFree;

  return (
    <Lockable locked={isFree}>
      <s-section>
        <s-stack gap="base">
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
          >
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type={icon} tone="success"></s-icon>
              <s-heading>{title}</s-heading>
            </s-stack>
            {proBadge(isFree)}
          </s-stack>
          <s-stack gap="small">
            {entries.map(([name, count]) => {
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <s-stack key={name} gap="small-400">
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-text>{name}</s-text>
                    <s-text color="subdued">
                      {blurred ? "—" : `${count} · ${pct}%`}
                    </s-text>
                  </s-stack>
                  <div className="an-bar-track" aria-hidden="true">
                    <div
                      className="an-bar-fill"
                      style={{ width: blurred ? "0%" : `${pct}%` }}
                    />
                  </div>
                </s-stack>
              );
            })}
          </s-stack>
        </s-stack>
      </s-section>
    </Lockable>
  );
}

function ChartCard({ title, isFree, children }) {
  return (
    <Lockable locked={isFree}>
      <s-section>
        <s-stack gap="base">
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
          >
            <s-heading>{title}</s-heading>
            {proBadge(isFree)}
          </s-stack>
          {children}
        </s-stack>
      </s-section>
    </Lockable>
  );
}

export default function AnalyticsBody({
  data,
  isFree,
  // "full" | "limited" | "locked" from the loader. Without it, Free = locked.
  access,
  // Product range not free: even Total plays is locked.
  productLocked = false,
  isLoading,
  children,
  // Pages without OS / country data (e.g. per-player stats) can hide them.
  hideOs = false,
  hideMap = false,
}) {
  const level = access || (isFree ? "locked" : "full");
  // Headline cards (except Total plays), trend chart.
  const locked = level === "locked";
  // Countries, browsers, devices, operating systems.
  const breakdownLocked = level !== "full";

  const summary = data?.sumaryData;
  const dailyPlays = data?.dailyPlays || [];
  const countryPlays = data?.countryPlays || [];

  const browserData =
    Object.keys(summary?.browsers || {}).length > 0
      ? summary.browsers
      : { Chrome: 0, Safari: 0, Edge: 0, Firefox: 0, Opera: 0, Unknown: 0 };

  const deviceData =
    Object.keys(summary?.devices || {}).length > 0
      ? summary.devices
      : { Desktop: 0, Tablet: 0, Mobile: 0, Unknown: 0 };

  const osData =
    Object.keys(summary?.os || {}).length > 0
      ? summary.os
      : { Windows: 0, macOS: 0, iOS: 0, Android: 0, Unknown: 0 };

  const totalListening = summary?.totalDuration || 0;
  // An empty or all-zero series would draw a blank chart; say so instead.
  const hasDailyPlays = dailyPlays.some((d) => Number(d?.totalTime) > 0);

  return (
    <s-stack gap="base">
      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 220px), 1fr))"
        gap="base"
      >
        <StatCard
          icon="play-circle"
          label="Total Plays"
          value={data?.totalPlay || 0}
          meta="Play events for the selected period"
          pro={productLocked}
          isLoading={isLoading}
        />
        <StatCard
          icon="clock"
          label="Total Listening"
          value={formatDuration(totalListening)}
          meta="Total time played"
          pro={locked}
          isLoading={isLoading}
        />
        <StatCard
          icon="sound"
          label="Avg. Listening"
          value={`${data?.avgPlayTime || 0}s`}
          meta="Average seconds per play"
          pro={locked}
          isLoading={isLoading}
        />
        <StatCard
          icon="person"
          label="Unique Devices"
          value={data?.uniqueDevices || 0}
          meta="Distinct user agents"
          pro={locked}
          isLoading={isLoading}
        />
      </s-grid>

      {children}

      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 260px), 1fr))"
        gap="base"
      >
        <BreakdownCard
          title="Browsers"
          icon="globe"
          data={browserData}
          isFree={breakdownLocked}
          isLoading={isLoading}
        />
        <BreakdownCard
          title="Devices"
          icon="mobile"
          data={deviceData}
          isFree={breakdownLocked}
          isLoading={isLoading}
        />
        {hideOs ? null : (
          <BreakdownCard
            title="Operating systems"
            icon="settings"
            data={osData}
            isFree={breakdownLocked}
            isLoading={isLoading}
          />
        )}
      </s-grid>

      {hideMap ? null : (
        <ChartCard title="Plays by Country" isFree={breakdownLocked}>
          <AnalyticsMap countryPlays={countryPlays} isLoading={isLoading} />
        </ChartCard>
      )}

      <ChartCard title="Plays Over Time" isFree={locked}>
        {!isLoading && !hasDailyPlays ? (
          // Same fixed height as the chart so the card doesn't jump.
          <div className="an-chart-empty">
            <EmptyState
              compact
              image={null}
              heading="No plays in this period"
              message="Plays will appear here once visitors play your audio."
            />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320} minWidth={0}>
            <LineChart data={dailyPlays}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--app-border)" />
              <XAxis dataKey="data" stroke="var(--app-text-secondary)" />
              <YAxis stroke="var(--app-text-secondary)" />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="totalTime"
                stroke="var(--app-primary)"
                strokeWidth={2}
                dot={{ fill: "var(--app-primary)" }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </s-stack>
  );
}
