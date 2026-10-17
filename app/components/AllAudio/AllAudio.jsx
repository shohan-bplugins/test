import React, { useEffect, useRef, useState } from "react";
import "./AllAudio.css";
import { audioLabel } from "./audioMeta";

// Only one preview plays at a time across the picker.
let activeAudio = null;

const formatTime = (sec) => {
  if (!Number.isFinite(sec)) return "";
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Compact picker card: play button, name, length. Click the card to select.
const AllAudio = ({ item, selectedFile, setSelectedFile }) => {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(null);
  const [current, setCurrent] = useState(0);

  const url = item?.node?.url;
  const { name, ext } = audioLabel(item?.node);
  const isSelected = selectedFile?.node?.id
    ? selectedFile.node.id === item?.node?.id
    : selectedFile === item;

  useEffect(
    () => () => {
      if (activeAudio === audioRef.current) activeAudio = null;
    },
    [],
  );

  const togglePlay = (e) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (activeAudio && activeAudio !== audio) activeAudio.pause();
      activeAudio = audio;
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  const time = playing
    ? `${formatTime(current)} / ${formatTime(duration)}`
    : formatTime(duration);

  return (
    <s-clickable
      className={`audioCard ${isSelected ? "audioCard--selected" : ""}`}
      accessibilityLabel={`Select ${name}`}
      padding="small"
      borderRadius="large"
      onClick={() => setSelectedFile(item)}
    >
      {url ? (
        <s-grid
          gridTemplateColumns="auto minmax(0, 1fr) auto"
          gap="small"
          alignItems="center"
        >
          <s-button
            variant={playing ? "primary" : "secondary"}
            icon={playing ? "pause-circle" : "play"}
            accessibilityLabel={playing ? `Pause ${name}` : `Play ${name}`}
            onClick={togglePlay}
          ></s-button>
          <s-stack gap="small-500" className="audioCard__text">
            <s-text type="strong" className="audioCard__name" title={name}>
              {name}
            </s-text>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              {ext ? <s-badge>{ext}</s-badge> : null}
              <s-text color="subdued">{time || "–:––"}</s-text>
            </s-stack>
          </s-stack>
          {isSelected ? (
            <s-icon type="check-circle-filled" tone="success"></s-icon>
          ) : null}
          <audio
            ref={audioRef}
            src={url}
            preload="metadata"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        </s-grid>
      ) : (
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-spinner size="base" accessibilityLabel="Processing"></s-spinner>
          <s-text color="subdued">Processing…</s-text>
        </s-stack>
      )}
    </s-clickable>
  );
};

export default AllAudio;
