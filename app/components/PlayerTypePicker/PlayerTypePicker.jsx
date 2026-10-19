import React from "react";

export const PLAYER_TYPES = [
  {
    value: "single-audio",
    title: "Single Audio Player",
    desc: "Simple player for individual audio files",
    icon: "sound",
  },
  {
    value: "playlist-audio",
    title: "Playlist Audio Player",
    desc: "Manage and play multiple audio files in sequence",
    icon: "list-bulleted",
  },
  {
    value: "sticky-player",
    title: "Sticky Audio Player",
    desc: "Persistent player that stays visible while scrolling",
    icon: "pin",
  },
  {
    value: "sticky-single-button",
    title: "Single Button Player",
    desc: "Compact button player anchored to a screen corner",
    icon: "play",
  },
];

export const PLAYER_TYPE_ICON = Object.fromEntries(
  PLAYER_TYPES.map((t) => [t.value, t.icon]),
);

export function playerTypeLabel(type) {
  return PLAYER_TYPES.find((t) => t.value === type)?.title || "Audio Player";
}

// Card grid for choosing a player type (used when creating a player).
export default function PlayerTypePicker({ value, onChange }) {
  return (
    <s-grid gridTemplateColumns="1fr 1fr" gap="base">
      {PLAYER_TYPES.map((type) => {
        const selected = value === type.value;
        return (
          <s-clickable
            key={type.value}
            padding="base"
            border={selected ? "base strong" : "base"}
            borderRadius="base"
            background={selected ? "subdued" : undefined}
            accessibilityLabel={type.title}
            onClick={() => onChange(type.value)}
          >
            <s-grid
              gridTemplateColumns="auto minmax(0, 1fr) auto"
              gap="small"
              alignItems="center"
            >
              <s-icon type={type.icon}></s-icon>
              <s-stack gap="small-500">
                <s-heading>{type.title}</s-heading>
                <s-text color="subdued">{type.desc}</s-text>
              </s-stack>
              {selected ? (
                <s-icon type="check-circle" tone="success"></s-icon>
              ) : null}
            </s-grid>
          </s-clickable>
        );
      })}
    </s-grid>
  );
}
