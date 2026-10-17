import { useMemo, useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import iso from "iso-3166-1";
import "./AnalyticsMap.css";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

function buildAlpha2ByNumeric() {
  const map = {};
  iso.all().forEach((c) => {
    map[c.numeric] = { alpha2: c.alpha2, name: c.country };
  });
  return map;
}

export default function AnalyticsMap({ countryPlays = [], isLoading = false }) {
  const [tooltip, setTooltip] = useState(null);

  const alpha2ByNumeric = useMemo(buildAlpha2ByNumeric, []);

  const playsByAlpha2 = useMemo(() => {
    const map = {};
    let max = 0;
    countryPlays.forEach((row) => {
      if (!row.country || row.country === "Unknown") return;
      const code = row.country.toUpperCase();
      map[code] = (map[code] || 0) + row.plays;
      if (map[code] > max) max = map[code];
    });
    return { map, max };
  }, [countryPlays]);

  const unknownPlays = useMemo(
    () =>
      countryPlays
        .filter((c) => !c.country || c.country === "Unknown")
        .reduce((sum, c) => sum + c.plays, 0),
    [countryPlays],
  );

  const colorFor = (plays) => {
    if (!plays) return "var(--app-bg-muted)";
    const max = playsByAlpha2.max || 1;
    const intensity = Math.min(1, plays / max);
    // Lerp from very light green to primary green
    const start = [230, 246, 238];
    const end = [26, 141, 90];
    const r = Math.round(start[0] + (end[0] - start[0]) * intensity);
    const g = Math.round(start[1] + (end[1] - start[1]) * intensity);
    const b = Math.round(start[2] + (end[2] - start[2]) * intensity);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const totalKnown = Object.values(playsByAlpha2.map).reduce(
    (s, n) => s + n,
    0,
  );

  return (
    <s-stack gap="small">
      <div className="an-map-wrap">
        <ComposableMap
          projectionConfig={{ scale: 145 }}
          width={900}
          height={420}
          style={{ width: "100%", height: "auto" }}
        >
          <ZoomableGroup center={[0, 20]} zoom={1} maxZoom={6}>
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const meta = alpha2ByNumeric[geo.id] || {};
                  const plays = meta.alpha2
                    ? playsByAlpha2.map[meta.alpha2] || 0
                    : 0;
                  const name = meta.name || geo.properties?.name || "Unknown";
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      onMouseEnter={(evt) =>
                        setTooltip({
                          name,
                          plays,
                          x: evt.clientX,
                          y: evt.clientY,
                        })
                      }
                      onMouseMove={(evt) =>
                        setTooltip((t) =>
                          t ? { ...t, x: evt.clientX, y: evt.clientY } : t,
                        )
                      }
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        default: {
                          fill: colorFor(plays),
                          stroke: "var(--app-border)",
                          strokeWidth: 0.5,
                          outline: "none",
                        },
                        hover: {
                          fill: "var(--app-primary-hover)",
                          stroke: "var(--app-primary)",
                          strokeWidth: 0.75,
                          outline: "none",
                          cursor: "pointer",
                        },
                        pressed: {
                          fill: "var(--app-primary)",
                          outline: "none",
                        },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>

        {/* Overlaid on the (still drawn) map so the card keeps its size. */}
        {!isLoading && totalKnown === 0 && (
          <div className="an-map-empty">
            <s-box
              padding="small-200 small"
              background="base"
              borderRadius="base"
            >
              <s-text color="subdued">No plays with a known location yet</s-text>
            </s-box>
          </div>
        )}

        {tooltip && (
          <div
            className="an-map-tooltip"
            style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
          >
            <s-stack gap="small-500">
              <s-text type="strong">{tooltip.name}</s-text>
              <s-text color="subdued">
                {tooltip.plays} {tooltip.plays === 1 ? "play" : "plays"}
              </s-text>
            </s-stack>
          </div>
        )}
      </div>

      <s-stack
        direction="inline"
        gap="small"
        alignItems="center"
        justifyContent="space-between"
      >
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text color="subdued">Fewer plays</s-text>
          <span className="an-map-legend-bar" aria-hidden="true" />
          <s-text color="subdued">More plays</s-text>
        </s-stack>
        <s-text color="subdued">
          {totalKnown} located
          {unknownPlays > 0 && ` · ${unknownPlays} unknown`}
        </s-text>
      </s-stack>
    </s-stack>
  );
}
