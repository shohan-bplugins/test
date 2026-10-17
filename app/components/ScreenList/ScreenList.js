import getMultiShadowCSS from "../CommonFun/GetMultiShadowCss";
import { safeCss } from "./templateSafe";

export const screenOne = (boxShadow = [], volume = true, iconSize = "40px") => `
          <div class="media-controls plyr__controls screenOne" style="box-shadow: ${safeCss(getMultiShadowCSS(boxShadow, "box"))}; position: relative;">
            <style>
              .screenOne .volume-container {
                position: absolute;
                top: 10px;
                right: 15px;
                z-index: 20;
                display: flex;
                flex-direction: row-reverse;
                align-items: center;
                gap: 4px;
              }

              /* No hover/focus background on the volume button */
              .screenOne .volume-container .plyr__control:hover,
              .screenOne .volume-container .plyr__control:focus-visible,
              .screenOne .volume-container .plyr__control[aria-expanded="true"] {
                background: transparent !important;
                box-shadow: none !important;
              }

              .screenOne .volume-container button svg {
                width: 100% !important;
                height: 100% !important;
              }

              .screenOne .media-buttons {
                gap: 16px;
              }


              /* Hidden by default, shown on hover/focus of volume-container */
              .screenOne .volume-container .plyr__volume {
                display: block !important;
                width: 0 !important;
                min-width: 0 !important;
                opacity: 0 !important;
                visibility: hidden !important;
                overflow: hidden !important;
                transition: all 0.3s ease-in-out !important;
              }
              .screenOne .volume-container:hover .plyr__volume,
              .screenOne .volume-container:focus-within .plyr__volume {
                width: 64px !important;
                min-width: 64px !important;
                opacity: 1 !important;
                visibility: visible !important;
                background: none;
              }
              .screenOne .volume-container .plyr__volume input[type="range"] {
                width: 100% !important;
                height: 8px !important;
                margin: 0 !important;
              }
            </style>
            <div class="media-buttons">
              <button class="back-button media-button" label="back" style="display: none;">
                <span class="back-button__icon">
                  <svg
                    stroke="currentColor"
                    fill="currentColor"
                    strokeWidth={0}
                    viewBox="0 0 448 512"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M64 468V44c0-6.6 5.4-12 12-12h48c6.6 0 12 5.4 12 12v176.4l195.5-181C352.1 22.3 384 36.6 384 64v384c0 27.4-31.9 41.7-52.5 24.6L136 292.7V468c0 6.6-5.4 12-12 12H76c-6.6 0-12-5.4-12-12z" />
                  </svg>
                </span>
                <span class="button-text milli">Back</span>
              </button>

              <button
                class="fast-forward-button media-button"
                label="fast forward"
                data-plyr="rewind"
              >
                <span class="back-button__icon">
                  <svg stroke="currentColor" fill="currentColor" strokewidth="{0}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                <path d="M485.6 249.9L198.2 498c-8.3 7.1-8.3 20.8 0 27.9l287.4 248.2c10.7 9.2 26.4.9 26.4-14V263.8c0-14.8-15.7-23.2-26.4-13.9zm320 0L518.2 498a18.6 18.6 0 0 0-6.2 14c0 5.2 2.1 10.4 6.2 14l287.4 248.2c10.7 9.2 26.4.9 26.4-14V263.8c0-14.8-15.7-23.2-26.4-13.9z" />
              </svg>
                </span>
                <span class="button-text milli">Backward</span>
              </button>

             <button class="play-button media-button" label="play" aria-label="Play, {title}"
                data-plyr="play">
          <span class="back-button__icon play-button__icon">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" class="pause icon w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
              </svg>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" class="play icon w-6 h-6" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
 
          </span>
                 
          <span class="button-text milli">Play</span>
        </button>

              <button
                class="fast-forward-button media-button"
                label="fast forward"
                data-plyr="fast-forward"
              >
                <span class="back-button__icon">
                  <svg
                    stroke="currentColor"
                    fill="currentColor"
                    strokeWidth={0}
                    viewBox="0 0 1024 1024"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M825.8 498L538.4 249.9c-10.7-9.2-26.4-.9-26.4 14v496.3c0 14.9 15.7 23.2 26.4 14L825.8 526c8.3-7.2 8.3-20.8 0-28zm-320 0L218.4 249.9c-10.7-9.2-26.4-.9-26.4 14v496.3c0 14.9 15.7 23.2 26.4 14L505.8 526c4.1-3.6 6.2-8.8 6.2-14 0-5.2-2.1-10.4-6.2-14z" />
                  </svg>
                </span>
                <span class="button-text milli">Forward</span>
              </button>

              <button class="skip-button media-button" label="skip" style="display: none;">
                <span class="back-button__icon">
                  <svg
                    stroke="currentColor"
                    fill="currentColor"
                    strokeWidth={0}
                    viewBox="0 0 1024 1024"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M676.4 528.95L293.2 829.97c-14.25 11.2-35.2 1.1-35.2-16.95V210.97c0-18.05 20.95-28.14 35.2-16.94l383.2 301.02a21.53 21.53 0 0 1 0 33.9M694 864h64a8 8 0 0 0 8-8V168a8 8 0 0 0-8-8h-64a8 8 0 0 0-8 8v688a8 8 0 0 0 8 8" />
                  </svg>
                </span>
                <span class="button-text milli">Skip</span>
              </button>
              ${
                volume !== false
                  ? `
              <div class="volume-container">
                <button type="button" class="plyr__control media-button" aria-label="Mute" data-plyr="mute" style="padding: 16px; width: ${safeCss(iconSize)}; height: ${safeCss(iconSize)};">
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
            <div class="media-progress">
            <div class="progress-bar-wrapper progress">
            <input data-plyr="seek"  type="range" min="0" max="100" step="0.01" value="0" aria-label="Seek" />
            
     
              </div>
             
              <div class="progress-time-current milli plyr__time plyr__time--current" aria-label="Current time">15:23</div>
              <div class="progress-time-total milli plyr__time plyr__time--duration" aria-label="Duration">34:40</div>
            </div>
          </div>
          `;
