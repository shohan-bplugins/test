import React from "react";
import "./style.css";
import { safeCss, safeText, safeUrl } from "./templateSafe";
import getMultiShadowCSS from "../CommonFun/GetMultiShadowCss";

export default function playListTwo(items, audios, styles) {
  return `<div class="music-app playListTwo" style="width:${safeCss(styles?.style?.width)}; max-width: calc(100vw - 30px - ${safeCss(styles?.style?.margin || "0%")} - ${safeCss(styles?.style?.padding || "0%")});">
  <style>
  .playListTwo .control-btn svg {
    width: ${safeCss(styles?.style?.iconSize || "30px")};
    height:${safeCss(styles?.style?.iconSize || "30px")};
  }
  .progress-container .audioTime .plyr__time.plyr__time--duration::before {
    content: " " !important;
  }
  </style>
    <div class="player-card" style="background:${safeCss(styles?.style?.background)}; box-shadow: ${safeCss(getMultiShadowCSS(styles?.style?.boxShadow, "box"))}; padding: ${safeCss(styles?.style?.padding)}; margin: ${safeCss(styles?.style?.margin)}">
      <div class="playerActiveControls">
              <div class="audio-poster">
                <div class="album-art" style="box-shadow: ${safeCss(styles?.style?.shadow)};">
                  <img data-plyr="playlist-cover" src="${audios?.[0]?.poster || audios?.[0]?.image ? safeUrl(audios?.[0]?.poster || audios?.[0]?.image) : "https://placehold.co/500x500/15803d/fff/svg?text=Placeholder+Image\n+\nAudio+Player\nby+bPlugins&font=roboto"}"
                        alt="${safeText(audios?.[0]?.title)}" />
                </div>
              </div>
              <div class="song-info">
              <div class="tooltip-container">
                  <h2 class="song-title" data-plyr="playlist-title" style="color:${safeCss(styles?.style?.iconColor)};">Audio Title</h2>
                  <div class="tooltip" id="tooltip-text" data-plyr="playlist-tooltip-title" style="color:white; background: black;"></div>
              </div>
                <p class="song-genre" data-plyr="playlist-artist" style="color:${safeCss(styles?.style?.iconColor)};">Artist</p>
              </div>
              <div class="progress-container">
                 <div class="audioTime" >
                    <span class="time plyr__time plyr__time--current" style="color:${safeCss(styles?.style?.iconColor)};" aria-label="Current time">0:00</span>
                    <span class="time  plyr__time plyr__time--duration" style="color:${safeCss(styles?.style?.iconColor)};" aria-label="Duration">0:20</span>
                 </div>
                <div class="plyr__progress" >
                    <input data-plyr="seek" type="range" min="0" max="100" step="0.01" value="0" aria-label="Seek" />
                </div>
              </div>
              <div class="controls">
                <button class="control-btn previous-btn" data-plyr="prev" style="color:${safeCss(styles?.style?.iconColor)};">
                <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 320 512">{ /*!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.*/ }<path d="M267.5 440.6c9.5 7.9 22.8 9.7 34.1 4.4s18.4-16.6 18.4-29l0-320c0-12.4-7.2-23.7-18.4-29s-24.5-3.6-34.1 4.4l-192 160L64 241 64 96c0-17.7-14.3-32-32-32S0 78.3 0 96L0 416c0 17.7 14.3 32 32 32s32-14.3 32-32l0-145 11.5 9.6 192 160z" /></svg>
                
                 </button>
                 <button type="button" class="control-btn plyr__control" data-plyr="rewind">
              <svg style="color:${safeCss(styles?.style?.iconColor)};" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M459.5 440.6c9.5 7.9 22.8 9.7 34.1 4.4s18.4-16.6 18.4-29l0-320c0-12.4-7.2-23.7-18.4-29s-24.5-3.6-34.1 4.4L288 214.3l0 41.7 0 41.7L459.5 440.6zM256 352l0-96 0-128 0-32c0-12.4-7.2-23.7-18.4-29s-24.5-3.6-34.1 4.4l-192 160C4.2 237.5 0 246.5 0 256s4.2 18.5 11.5 24.6l192 160c9.5 7.9 22.8 9.7 34.1 4.4s18.4-16.6 18.4-29l0-64z" /></svg>
              <span class="plyr__tooltip" role="tooltip">Rewind {seektime} secs</span>
          </button>
                <button class="control-btn play-btn plyr__control" style="color:${safeCss(styles?.style?.iconColor)};" aria-label="Play, {title}" data-plyr="play">
                  <svg class="icon--not-pressed" role="presentation" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M464 256A208 208 0 1 0 48 256a208 208 0 1 0 416 0zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zM188.3 147.1c7.6-4.2 16.8-4.1 24.3 .5l144 88c7.1 4.4 11.5 12.1 11.5 20.5s-4.4 16.1-11.5 20.5l-144 88c-7.4 4.5-16.7 4.7-24.3 .5s-12.3-12.2-12.3-20.9l0-176c0-8.7 4.7-16.7 12.3-20.9z" /></svg>
                  <svg class="icon--pressed" role="presentation" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M464 256A208 208 0 1 0 48 256a208 208 0 1 0 416 0zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zm224-72l0 144c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-144c0-13.3 10.7-24 24-24s24 10.7 24 24zm112 0l0 144c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-144c0-13.3 10.7-24 24-24s24 10.7 24 24z" /></svg>
                 </button>
                 <button type="button" class="control-btn plyr__control" data-plyr="fast-forward" style="color: ${safeCss(styles?.style?.iconColor)}">
                    <svg style="color:${safeCss(styles?.style?.iconColor)};" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M52.5 440.6c-9.5 7.9-22.8 9.7-34.1 4.4S0 428.4 0 416L0 96C0 83.6 7.2 72.3 18.4 67s24.5-3.6 34.1 4.4L224 214.3l0 41.7 0 41.7L52.5 440.6zM256 352l0-96 0-128 0-32c0-12.4 7.2-23.7 18.4-29s24.5-3.6 34.1 4.4l192 160c7.3 6.1 11.5 15.1 11.5 24.6s-4.2 18.5-11.5 24.6l-192 160c-9.5 7.9-22.8 9.7-34.1 4.4s-18.4-16.6-18.4-29l0-64z" /></svg>
                     <span class="plyr__tooltip" role="tooltip">Forward {seektime} secs</span>
                 </button>
                <button class="control-btn next-btn " data-plyr="next" style="color:${safeCss(styles?.style?.iconColor)};">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 320 512">{ /*!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.*/ }<path d="M52.5 440.6c-9.5 7.9-22.8 9.7-34.1 4.4S0 428.4 0 416L0 96C0 83.6 7.2 72.3 18.4 67s24.5-3.6 34.1 4.4l192 160L256 241l0-145c0-17.7 14.3-32 32-32s32 14.3 32 32l0 320c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-145-11.5 9.6-192 160z" /></svg>
                </button>
              </div>
                ${
                  styles?.volume !== false
                    ? `
                <div class="volume-bar">
                  <button type="button" class="plyr__control media-button" aria-label="Mute" data-plyr="mute" style="color:${safeCss(styles?.style?.iconColor)};">
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

              <div class="playlist">
              ${audios
                ?.map((audio, i) => {
                  return ` <div class="playlist-item" data-plyr="playlist-item">
                    <div class="playlist-item-thumbnail">
                      <img
                        src="${audio?.poster || audio?.image ? safeUrl(audio?.poster || audio?.image) : "https://placehold.co/500x500/15803d/fff/svg?text=Placeholder+Image\n+\nAudio+Player\nby+bPlugins&font=roboto"}"
                        alt="${safeText(audio?.title)}"
                      />
                    </div>
                    <div class="playlist-item-info">
                      <h3 class="playlist-item-title" style="color:${safeCss(styles?.style?.iconColor)};">${safeText(audio?.title)}</h3>
                      <p class="playlist-item-genre" style="color:${safeCss(styles?.style?.iconColor)};">${safeText(audio?.artist)}</p>
                    </div>
                    <div class="playlist-item-duration track-duration duration" style="color:${safeCss(styles?.style?.iconColor)};">0:00</div>
                  </div>`;
                })
                .join("")}
    </div>
    
  </div>`;
}
