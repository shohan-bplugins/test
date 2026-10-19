import { useState, useRef } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import { COUNTRIES, countryName } from "../utils/countries";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// numeric id -> alpha-2 code, built once.
const NUM_TO_CODE = {};
for (const code of Object.keys(COUNTRIES)) {
  const num = COUNTRIES[code]?.num;
  if (num) NUM_TO_CODE[String(Number(num))] = code;
}

// Mix a hex color toward white by `t` (0 = white, 1 = full color).
function tint(hex, t) {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const mix = (v) => Math.round(255 + (v - 255) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/**
 * Choropleth world map.
 * @param {{code:string,count:number}[]} data  per-country play counts (alpha-2)
 * @param {string} themeColor  hex base color for the scale
 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export default function WorldMap({ data = [], themeColor = "#1a8d5a" }) {
  const [tooltip, setTooltip] = useState(null); // { name, count, x, y }
  const [position, setPosition] = useState({ coordinates: [0, 0], zoom: 1 });
  const wrapRef = useRef(null);

  const zoomBy = (factor) =>
    setPosition((p) => ({
      ...p,
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.zoom * factor)),
    }));
  const resetZoom = () => setPosition({ coordinates: [0, 0], zoom: 1 });

  // Build numeric-id -> count from alpha-2 data.
  const byNum = {};
  let max = 0;
  for (const d of data) {
    const num = COUNTRIES[d.code]?.num;
    if (!num) continue;
    byNum[num] = d.count;
    byNum[String(Number(num))] = d.count;
    if (d.count > max) max = d.count;
  }

  const colorFor = (count) => {
    if (!count) return "#eef1f4";
    const t = max > 0 ? 0.25 + 0.75 * (count / max) : 0.5;
    return tint(themeColor, t);
  };

  // Position the tooltip at the cursor, relative to the map container.
  const track = (e, name, count) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    setTooltip({
      name,
      count,
      x: rect ? e.clientX - rect.left : 0,
      y: rect ? e.clientY - rect.top : 0,
    });
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <ComposableMap
        projectionConfig={{ scale: 145 }}
        width={900}
        height={420}
        style={{ width: "100%", height: "auto" }}
      >
        <ZoomableGroup
          center={position.coordinates}
          zoom={position.zoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          onMoveEnd={({ coordinates, zoom }) =>
            setPosition({ coordinates, zoom })
          }
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const id = String(geo.id);
                const count = byNum[id] || byNum[String(Number(id))] || 0;
                const code = NUM_TO_CODE[String(Number(id))];
                const name = code ? countryName(code) : geo.properties.name;
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={colorFor(count)}
                    stroke="#ffffff"
                    strokeWidth={0.4 / position.zoom}
                    onMouseEnter={(e) => track(e, name, count)}
                    onMouseMove={(e) => track(e, name, count)}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      default: { outline: "none", transition: "fill .2s" },
                      hover: { outline: "none", fill: count ? themeColor : "#dfe3e8", cursor: "pointer" },
                      pressed: { outline: "none" },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          zIndex: 4,
        }}
      >
        {[
          { label: "+", title: "Zoom in", onClick: () => zoomBy(1.5) },
          { label: "−", title: "Zoom out", onClick: () => zoomBy(1 / 1.5) },
          { label: "⟲", title: "Reset zoom", onClick: resetZoom },
        ].map((btn) => (
          <button
            key={btn.title}
            type="button"
            title={btn.title}
            onClick={btn.onClick}
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #d5d9de",
              borderRadius: 6,
              background: "#ffffff",
              color: "#374151",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, calc(-100% - 14px))",
            background: "rgba(26,32,44,0.94)",
            color: "#fff",
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            zIndex: 5,
          }}
        >
          {tooltip.name}:{" "}
          <strong>{tooltip.count.toLocaleString()}</strong> plays
        </div>
      )}
    </div>
  );
}
