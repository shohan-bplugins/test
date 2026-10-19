import getMultiShadowCSS from "../CommonFun/GetMultiShadowCss";
import "./style.css";
import { safeCss, safeText } from "./templateSafe";

export default function playListOne(audios, options, container = null) {
  // Callers pass { style, volume }; the template reads style.style.<prop>,
  // so keep that wrapper (unwrapping it made every value "undefined").
  const style = options?.style ? options : { style: options };
  const volume = options?.volume ?? true;
  // return { audios, style };

  return `<div class="audio-player plyrPlayListCss" style="padding: ${safeCss(style?.style?.padding)}; box-shadow: ${safeCss(getMultiShadowCSS(style?.style?.boxShadow, "box"))};  max-width: 100%;  width:${safeCss(style?.style?.width)}; height:${safeCss(style?.style?.height)}; background:${safeCss(style?.style?.background)}; border: ${safeCss(style?.style?.borderWidth)} solid ${safeCss(style?.style?.borderColor)}; border-radius: ${safeCss(style?.style?.borderRadius)}; ">
  <style>
   .plyrPlayListCss .track.item-active {
     background: ${safeCss(style?.style?.mainColor)};
   }
    

  </style>
      <div class="player-header">
          <div class="time plyr__time plyr__time--current" aria-label="Current time" style=" color: ${safeCss(style?.style?.iconColor)} ;">00:00</div>
          
            <div class="tooltip-container">
               <div class="tooltip" id="tooltip-text" data-plyr="playlist-tooltip-title"></div>
              <div class="title" data-plyr="playlist-title" style=" color: ${safeCss(style?.style?.iconColor)} ;"></div>
            </div>
          
          <div class="time  plyr__time plyr__time--duration" aria-label="Duration" style=" color: ${safeCss(style?.style?.iconColor)} ;">00:00</div>
      </div>

      <div class="progress-row">
        <div class="plyr__progress">
            <input data-plyr="seek" type="range" min="0" max="100" step="0.01" value="0" aria-label="Seek">
            <progress class="plyr__progress__buffer" min="0" max="100" value="0">% buffered</progress>
            <span role="tooltip" class="plyr__tooltip">00:00</span>
        </div>
        ${
          volume !== false
            ? `
        <div class="volume-bar">
          <button type="button" class="plyr__control" aria-label="Mute" data-plyr="mute" style="color:${safeCss(style?.style?.iconColor)} !important;">
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


      <div class="controls">
          <div class="prev-btn" data-plyr="prev" style=" cursor: pointer; color: ${safeCss(style?.style?.iconColor)};  display: flex; justify-content: center;">
          <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 320 512">{ /*!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.*/ }<path d="M267.5 440.6c9.5 7.9 22.8 9.7 34.1 4.4s18.4-16.6 18.4-29l0-320c0-12.4-7.2-23.7-18.4-29s-24.5-3.6-34.1 4.4l-192 160L64 241 64 96c0-17.7-14.3-32-32-32S0 78.3 0 96L0 416c0 17.7 14.3 32 32 32s32-14.3 32-32l0-145 11.5 9.6 192 160z" /></svg>
        </div>
        <button type="button" class="plyr__control" data-plyr="rewind">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 5.5c0-.83-.9-1.34-1.6-.9l-8.4 5.4c-.67.43-.67 1.37 0 1.8l8.4 5.4c.7.45 1.6-.07 1.6-.9V5.5z" />
            <path d="M12 5.5c0-.83-.9-1.34-1.6-.9l-8.4 5.4c-.67.43-.67 1.37 0 1.8l8.4 5.4c.7.45 1.6-.07 1.6-.9V5.5z" />
          </svg>
              <span class="plyr__tooltip" role="tooltip">Rewind {seektime} secs</span>
          </button>
      <button type="button" class="plyr__control" aria-label="Play, {title}" data-plyr="play">
         <svg class="icon--pressed" role="presentation"><use xlink:href="#plyr-pause"></use></svg>
         <svg class="icon--not-pressed" role="presentation"><use xlink:href="#plyr-play"></use></svg>
         <span class="label--pressed plyr__tooltip" role="tooltip">Pause</span>
         <span class="label--not-pressed plyr__tooltip" role="tooltip">Play</span>
      </button>
      <button type="button" class="plyr__control" data-plyr="fast-forward" style=" color: ${safeCss(style?.style?.iconColor)};">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 5.5c0-.83.9-1.34 1.6-.9l8.4 5.4c.67.43.67 1.37 0 1.8l-8.4 5.4c-.7.45-1.6-.07-1.6-.9v-10.8z"/>
          <path d="M12 5.5c0-.83.9-1.34 1.6-.9l8.4 5.4c.67.43.67 1.37 0 1.8l-8.4 5.4c-.7.45-1.6-.07-1.6-.9v-10.8z"/>
        </svg>
          <span class="plyr__tooltip" role="tooltip">Forward {seektime} secs</span>
      </button>
      <div class="next-btn" data-plyr="next" style="cursor: pointer; color:${safeCss(style?.style?.iconColor)}; display: flex; justify-content: center;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 320 512">{ /*!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.*/ }<path d="M52.5 440.6c-9.5 7.9-22.8 9.7-34.1 4.4S0 428.4 0 416L0 96C0 83.6 7.2 72.3 18.4 67s24.5-3.6 34.1 4.4l192 160L256 241l0-145c0-17.7 14.3-32 32-32s32 14.3 32 32l0 320c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-145-11.5 9.6-192 160z" /></svg>  
      </div>
  </div>

  <div class="playlist">
      
     ${audios
       ?.map((aud, i) => {
         return `<div key=${i} class="track" data-plyr="playlist-item">
              <div class="track-icon" style=" color: ${safeCss(style?.style?.iconColor)} ;">
                <svg class="play" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 5.5c0-.83.9-1.34 1.6-.9l10.4 6.4c.67.43.67 1.37 0 1.8l-10.4 6.4c-.7.45-1.6-.07-1.6-.9V5.5z" />
                </svg>
                <svg class="pause" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <rect x="5" y="4" width="4" height="16" rx="2" />
                  <rect x="15" y="4" width="4" height="16" rx="2" />
                </svg>
              </div>

              
              <div class="track-info" style=" color: ${safeCss(style?.style?.iconColor)} ;">${safeText(
                aud?.title?.length > 20
                  ? aud?.title?.slice(0, 20) + "..."
                  : aud?.title,
              )}</div>
              <div class="track-duration duration" style=" color: ${safeCss(style?.style?.iconColor)} ;" >00:00</div>
            </div>`;
       })
       .join("")}
    
  </div>
</div>`;
}
