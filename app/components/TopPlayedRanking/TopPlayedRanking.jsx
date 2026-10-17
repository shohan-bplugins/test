import React from "react";

// Ranked list of top-played items (players or products) for the selected
// period. Each row has a rank, title, optional meta, play count, and a
// "View details" button that drills into that item.
const RANK_TONE = ["success", "info", "caution"];

export default function TopPlayedRanking({
  heading = "Top played",
  periodLabel,
  items = [],
  limit = 3,
  getMeta,
  onViewDetails,
  // Dims the (stale) list while the page re-fetches for a new filter.
  isLoading = false,
}) {
  if (!items.length) return null;

  const topItems = items.slice(0, limit);
  const maxPlays =
    topItems.reduce((m, it) => Math.max(m, it.plays || 0), 0) || 1;

  return (
    <div
      className={`an-dimmable${isLoading ? " is-loading" : ""}`}
      aria-busy={isLoading || undefined}
    >
      <s-section>
        <s-stack gap="base">
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
            gap="small"
          >
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="star" tone="success"></s-icon>
              <s-heading>{heading}</s-heading>
            </s-stack>
            {periodLabel ? <s-badge>{periodLabel}</s-badge> : null}
          </s-stack>

          <s-stack gap="small">
            {topItems.map((item, i) => {
              const pct = Math.max(
                4,
                Math.round(((item.plays || 0) / maxPlays) * 100),
              );
              const title = item.title || "Untitled";
              return (
                <React.Fragment key={item.id}>
                  {i > 0 ? <s-divider></s-divider> : null}
                  <s-grid
                    gridTemplateColumns="auto minmax(0, 1fr) auto auto"
                    gap="base"
                    alignItems="center"
                  >
                    <s-badge tone={RANK_TONE[i]}>#{i + 1}</s-badge>
                    <s-stack gap="small-300">
                      <s-stack
                        direction="inline"
                        gap="small-200"
                        alignItems="center"
                      >
                        <s-text type="strong">
                          {title.length > 48 ? `${title.slice(0, 48)}…` : title}
                        </s-text>
                        {getMeta ? <s-badge>{getMeta(item)}</s-badge> : null}
                      </s-stack>
                      <div
                        className="an-bar-track an-bar-track--thin"
                        aria-hidden="true"
                      >
                        <div
                          className="an-bar-fill an-bar-fill--soft"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </s-stack>
                    <s-stack
                      direction="inline"
                      gap="small-400"
                      alignItems="baseline"
                    >
                      <s-text type="strong">{item.plays}</s-text>
                      <s-text color="subdued">
                        {item.plays === 1 ? "play" : "plays"}
                      </s-text>
                    </s-stack>
                    <s-button
                      variant="tertiary"
                      icon="arrow-right"
                      accessibilityLabel={`View details for ${title}`}
                      onClick={() => onViewDetails(item.id)}
                    >
                      View
                    </s-button>
                  </s-grid>
                </React.Fragment>
              );
            })}
          </s-stack>
        </s-stack>
      </s-section>
    </div>
  );
}
