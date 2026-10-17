import {
  Box,
  Text,
  Button,
  InlineStack,
  BlockStack,
  InlineGrid,
  Badge,
  Card,
} from "@shopify/polaris";
import { formatWatchSeconds } from "../../utils/topPlayerScore";
import { ICONS, useGo } from "./StatusCards";
// Note: AnalyticsOverview.css is no longer needed since we use Polaris tokens
// import "./AnalyticsOverview.css";

const kpiStroke = {
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
};
const KpiSvg = ({ children }) => (
  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" style={{ display: 'block' }}>
    {children}
  </svg>
);
const IconPlays = (
  <KpiSvg>
    <circle cx="10" cy="10" r="7.5" {...kpiStroke} />
    <path d="M8.3 7.2 13 10l-4.7 2.8V7.2Z" {...kpiStroke} />
  </KpiSvg>
);
const IconToday = (
  <KpiSvg>
    <circle cx="10" cy="10" r="7.5" {...kpiStroke} />
    <path d="M10 5.8V10l2.8 1.8" {...kpiStroke} />
  </KpiSvg>
);
const IconWeek = (
  <KpiSvg>
    <rect x="3" y="4.5" width="14" height="12.5" rx="2" {...kpiStroke} />
    <path d="M3 8.2h14M7 3v3M13 3v3" {...kpiStroke} />
  </KpiSvg>
);
const IconMonth = (
  <KpiSvg>
    <path d="M4 16V9.5M9 16V4.5M14 16v-4" {...kpiStroke} />
    <path d="M2.7 16.5h14.6" {...kpiStroke} />
  </KpiSvg>
);

const WINDOWS = [
  { key: "total", label: "Total plays", icon: IconPlays },
  { key: "today", label: "Today", icon: IconToday },
  { key: "week", label: "Last week", icon: IconWeek },
  { key: "month", label: "Last 30 days", icon: IconMonth },
];

const Head = () => {
  const go = useGo();
  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text as="h2" variant="headingMd" fontWeight="bold">
        Analytics Overview
      </Text>
      <Button icon={ICONS.external} onClick={go("/app/analytics")}>
        View full report
      </Button>
    </InlineStack>
  );
};

const TileGrid = ({ children }) => (
  <InlineGrid columns={{ xs: 2, lg: 4 }} gap="400">
    {children}
  </InlineGrid>
);

const Tile = ({ icon, label, total, product, loading = false }) => (
  <Card roundedAbove="sm">
    <BlockStack gap="400">
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        <Box color="text-secondary">{icon}</Box>
        <Text fontWeight="medium" as="span">
          {label}
        </Text>
      </InlineStack>
      <InlineGrid columns={2} gap="200">
        <BlockStack gap="100">
          <Text variant="headingLg" fontWeight="bold">
            {loading ? "—" : total.toLocaleString()}
          </Text>
          <Text tone="subdued" as="span">All players</Text>
        </BlockStack>
        <BlockStack gap="100">
          <Text variant="headingLg" fontWeight="bold">
            {loading ? "—" : product.toLocaleString()}
          </Text>
          <Text tone="subdued" as="span">Product page</Text>
        </BlockStack>
      </InlineGrid>
    </BlockStack>
  </Card>
);

const Shell = ({ children }) => (
  <Box as="section" aria-label="Analytics overview">
    <BlockStack gap="400">
      <Head />
      {children}
    </BlockStack>
  </Box>
);

export const AnalyticsSkeleton = () => (
  <Shell>
    <TileGrid>
      {WINDOWS.map((w) => (
        <Tile key={w.key} icon={w.icon} label={w.label} loading />
      ))}
    </TileGrid>
  </Shell>
);

export const AnalyticsError = () => (
  <Shell>
    <Text tone="subdued" as="p">
      Play counts couldn&apos;t be loaded. Open the full report to try again.
    </Text>
  </Shell>
);

export const TopPlayerStrip = ({ topPlayer: tp }) => {
  const go = useGo();
  if (!tp || !(tp.plays > 0)) return null;
  const to = `/app/analytics?video=${tp.videoId}`;
  return (
    <Card roundedAbove="sm">
      <InlineStack align="start" blockAlign="center" gap="300">
        <Badge tone="success">Top player</Badge>
        <Box maxWidth="250px">
          <Text fontWeight="bold" as="span" truncate>
            {tp.title}
          </Text>
        </Box>
        <Box minWidth="0">
          <Text tone="subdued" as="span" truncate>
            {(tp.unique ?? 0).toLocaleString()}{" "}
            {tp.unique === 1 ? "viewer" : "viewers"} ·{" "}
            {formatWatchSeconds(tp.watchSeconds)} watched ·{" "}
            {tp.plays.toLocaleString()} {tp.plays === 1 ? "play" : "plays"}
          </Text>
        </Box>
        <Button variant="plain" onClick={go(to)}>
          View details
        </Button>
      </InlineStack>
    </Card>
  );
};

const AnalyticsOverview = ({ analytics = {}, topPlayerSlot = null }) => {
  const split = (w) => ({
    total: (w?.player || 0) + (w?.product || 0),
    product: w?.product || 0,
  });

  return (
    <Shell>
      <BlockStack gap="400">
        {topPlayerSlot}
        <TileGrid>
          {WINDOWS.map((w) => {
            const { total, product } = split(analytics[w.key]);
            return (
              <Tile
                key={w.key}
                icon={w.icon}
                label={w.label}
                total={total}
                product={product}
              />
            );
          })}
        </TileGrid>
      </BlockStack>
    </Shell>
  );
};

export default AnalyticsOverview;
