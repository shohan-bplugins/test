import getMultiShadowCSS from "../CommonFun/GetMultiShadowCss";
import { safeCss, safeText, safeUrl } from "./templateSafe";

export default function skinFusion(
  poster = null,
  title = null,
  url = null,
  otherControls = { repeat: false, playlist: false, download: false },
  background = "black",
  iconColor = "white",
  boxShadow = "none",
) {
  const download =
    otherControls?.download === true
      ? `<a class="plyr__controls__item plyr__control plyr__download" href="${safeUrl(url)}" target="_blank" download data-plyr="download">
        <svg aria-hidden="true" focusable="false"><use xlink:href="#plyr-download"></use></svg>
        <span class="plyr__sr-only">Download</span>
      </a>`
      : "";

  const error =
    url == ""
      ? `<div
        style="
          top: -100%;
          border-left: 4px solid #ffe69c;
          background: #fff3cd;
          color: #664d03;
          fontfamily: sans-serif;
          position: absolute;
          z-index: 999;
          left: 50%;
          transform: translate(-50%,50%);
          padding: 10px;
        "
      >
         <strong>Player Inactive:</strong> Select an audio file in the sidebar configuration to enable playback.
        source.
      </div>`
      : "";

  const repeat =
    otherControls?.repeat === true
      ? `<button type="button" data-active="${safeText(otherControls?.repeat)}" class="plyr__control" data-plyr="repeat"><svg class="icon">
        <use xlink:href="#exchange"></use></button>`
      : "";
  const playlist =
    otherControls?.playlist === true
      ? `<button type="button" class="plyr__control" data-active="true" data-plyr="playlist"><span class="dashicons dashicons-playlist-audio"></span></button>`
      : "";

  return `<div class="plyr__controls radius" style=" box-shadow: ${safeCss(getMultiShadowCSS(boxShadow, "box"))}; background-color:${safeCss(background)} !important;">
    <div class="plyr__controls rewind_play_fastforward" style="background-color:transparent !important; gap: 12px;">
    <img class="thumbnails" style="background: white; border-radius: 4px; object-fit: cover;" src="${safeUrl(poster)}" alt="" draggable="false">
    <div class="plyr__controls" style="background-color:transparent !important; gap: 8px;">
    <button type="button" class="plyr__control" data-plyr="rewind" style="color:${safeCss(iconColor)} !important;">
      <svg role="presentation"><use xlink:href="#plyr-rewind"></use></svg>
      <span class="plyr__tooltip" role="tooltip">Rewind {seektime} secs</span>
    </button>
    <button type="button" class="plyr__control" aria-label="Play, {title}" data-plyr="play" style="color:${safeCss(iconColor)} !important;">
      <svg class="icon--pressed" role="presentation"><use xlink:href="#plyr-pause"></use></svg>
      <svg class="icon--not-pressed" role="presentation"><use xlink:href="#plyr-play"></use></svg>
      <span class="label--pressed plyr__tooltip" role="tooltip">Pause</span>
      <span class="label--not-pressed plyr__tooltip" role="tooltip">Play</span>
    </button>
    <button type="button" class="plyr__control" data-plyr="fast-forward" style="color:${safeCss(iconColor)} !important;">
      <svg role="presentation"><use xlink:href="#plyr-fast-forward"></use></svg>
      <span class="plyr__tooltip" role="tooltip">Forward {seektime} secs</span>
    </button>
    </div>
    </div>
    <div class="infos" style="width:100%; display: flex; align-items: center; justify-content: space-between;">
    ${error}
      <div style="width: 100%;">
        <div class="title" style="margin-top: 6px;">
      <div class="tooltip-container" style="display: block;">
          <div class="tooltip" id="tooltip-text">${safeText(title)}</div>
          <h3 class="title" style="color:${safeCss(iconColor)}; backdrop-filter: blur(5px); background-color: rgba(255, 255, 255, 0.4); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal; min-width: 160px; word-break: break-all; margin: 4px 0; font-size: 14px; font-weight: 500;">${safeText(title || "Title")}</h3>
      </div>
    </div>
        <div class="time_progress" style="display: flex; gap: 10px; margin-top: 4px;">
        <div class="plyr__time plyr__time--current" aria-label="Current time" style="color:${safeCss(iconColor)} !important;">00:00</div>
        <div class="plyr__progress" style="flex: 1;">
          <input data-plyr="seek" type="range" min="0" max="100" step="0.01" value="0" aria-label="Seek">
          <progress class="plyr__progress__buffer" min="0" max="100" value="0">% buffered</progress>
          <span role="tooltip" class="plyr__tooltip">00:00</span>
        </div>
        <div class="plyr__time plyr__time--duration" aria-label="Duration" style="color:${safeCss(iconColor)} !important;">00:00</div>
        </div>
      </div>
        <div class="other_controls" style="margin-left: 16px;">
      <div class="extra_controls">
        ${download}
        ${repeat}
        ${playlist}
      </div>
      ${
        otherControls?.volume !== false
          ? `<div class="volume_controls" style="margin-bottom: -6px;">
      <button type="button" class="plyr__control" aria-label="Mute" data-plyr="mute" style="color:${safeCss(iconColor)} !important;">
          <svg class="icon--pressed" role="presentation" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
          <svg class="icon--not-pressed" role="presentation" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          <span class="label--pressed plyr__tooltip" role="tooltip">Unmute</span>
          <span class="label--not-pressed plyr__tooltip" role="tooltip">Mute</span>
      </button>
      <div class="plyr__volume">
          <input data-plyr="volume" type="range" min="0" max="1" step="0.05" value="1" autocomplete="off" aria-label="Volume">
      </div>
      </div>`
          : ""
      }
    </div>
      </div>
    
  </div>`;
}
