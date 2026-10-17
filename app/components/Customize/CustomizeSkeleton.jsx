import React from "react";
import "./CustomizeSkeleton.css";

// Polaris web components have no skeleton, so these are shimmer blocks laid
// out with s-* containers to match the customize page.
const Bar = ({ w = "100%", h = 14, round = false }) => (
  <div
    className={`cz-sk${round ? " cz-sk--round" : ""}`}
    style={{ width: w, height: h }}
    aria-hidden="true"
  />
);

// Player-shaped placeholder for the live preview area.
export function PreviewSkeleton() {
  return (
    <div className="cz-sk-preview" role="status" aria-label="Loading preview">
      <s-box padding="base" border="base" borderRadius="base" background="base">
        <s-stack gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <Bar w="56px" h={56} />
            <s-stack gap="small-200">
              <Bar w="180px" h={16} />
              <Bar w="120px" h={12} />
            </s-stack>
          </s-stack>
          <s-stack direction="inline" gap="small" alignItems="center">
            <Bar w="36px" h={36} round />
            <Bar w="100%" h={8} />
            <Bar w="48px" h={12} />
            <Bar w="24px" h={24} round />
          </s-stack>
        </s-stack>
      </s-box>
    </div>
  );
}

// Settings sidebar placeholder: heading + collapsed section rows.
export function SidebarSkeleton({ sections = 6 }) {
  return (
    <s-stack gap="small">
      <Bar w="140px" h={20} />
      {Array.from({ length: sections }).map((_, i) => (
        <s-box key={i} padding="small" border="base" borderRadius="base">
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
          >
            <Bar w={`${45 + ((i * 13) % 35)}%`} h={14} />
            <Bar w="14px" h={14} />
          </s-stack>
        </s-box>
      ))}
    </s-stack>
  );
}

// Whole customize page: header, sidebar and preview.
export default function CustomizeSkeleton() {
  return (
    <div
      className="cz-sk-page"
      role="status"
      aria-label="Loading player editor"
    >
      <s-box padding="small" background="base">
        <s-stack
          direction="inline"
          justifyContent="space-between"
          alignItems="center"
        >
          {/* Same sizes as the real header: 28px buttons, 20px heading/badge. */}
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <Bar w="28px" h={28} />
            <Bar w="130px" h={20} />
            <Bar w="120px" h={20} round />
          </s-stack>
          <s-stack direction="inline" gap="small-200">
            <Bar w="170px" h={28} />
            <Bar w="100px" h={28} />
          </s-stack>
        </s-stack>
      </s-box>
      <div className="cz-sk-body">
        <div className="cz-sk-sidebar">
          <s-box padding="base">
            <SidebarSkeleton />
          </s-box>
        </div>
        <div className="cz-sk-main">
          <PreviewSkeleton />
        </div>
      </div>
    </div>
  );
}
