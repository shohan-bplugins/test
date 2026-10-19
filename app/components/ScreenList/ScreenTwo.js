import getMultiShadowCSS from "../CommonFun/GetMultiShadowCss";
import { safeCss, safeCssUrl, safeText, safeUrl } from "./templateSafe";

export const screenTwo = (
  image,
  title,
  boxShadow,
  padding = "0px",
  margin = "0px",
  height = "240px",
  background = "#ffffff",
  backgroundImage = "",
  border = {
    border: {
      borderWidth: "0px",
      borderStyle: "solid",
      borderColor: "#000000",
    },
  },
  volume = true,
) => {
  const borderData = border?.border;

  const thumbnailImg = "/skinTwoThumbnail.png";
  const backgroundImgDefault = "/skinTwoBackground.png";
  return `<div class="demo-1 screenTwo" style="padding: ${safeCss(padding)}; margin: ${safeCss(margin)} auto; width: 100%; max-width: 100%;">
        <style>
          .screenTwo .volume-container {
            position: absolute !important;
            right: 15px !important;
            top: 50% !important;
            transform: translateY(-50%) !important;
            z-index: 20 !important;
            display: flex !important;
            flex-direction: row-reverse !important;
            align-items: center !important;
            gap: 4px !important;
          }
          /* Hidden by default, shown on hover/focus of volume-container */
          .screenTwo .volume-container .plyr__volume {
            display: block !important;
            width: 0 !important;
            min-width: 0 !important;
            opacity: 0 !important;
            visibility: hidden !important;
            overflow: hidden !important;
            transition: all 0.3s ease-in-out !important;
          }
          .screenTwo .volume-container:hover .plyr__volume,
          .screenTwo .volume-container:focus-within .plyr__volume {
            width: 64px !important;
            min-width: 64px !important;
            opacity: 1 !important;
            visibility: visible !important;
          }
          .screenTwo .volume-container .plyr__volume input[type="range"] {
            width: 100% !important;
            height: 8px !important;
            margin: 0 !important;
          }
        </style>
        <div class="screen-container" style="border-width: ${safeCss(borderData?.borderWidth)}; border-style: ${safeCss(borderData?.borderStyle)}; border-color: ${safeCss(borderData?.borderColor)}; background: ${safeCss(background)}; box-shadow: ${safeCss(getMultiShadowCSS(boxShadow, "box"))}; min-height: 240px; height:${safeCss(height)};">
          <div class="image-box" style="background:url('${safeCssUrl(backgroundImage || backgroundImgDefault)}'); background-position: center center; background-repeat: no-repeat;  background-size: cover;">
            <div class="content">
              <div class="cover">
                <img src="${safeUrl(image || thumbnailImg)}" alt="${safeText(title?.length > 17 ? title?.slice(0, 17) + "..." : title)}" srcSet="" />
              </div>
              <div>
                <div class="tooltip-container" style="margin-bottom: 15; display: block; ">
                <div class="tooltip" id="tooltip-text">${safeText(title)}</div>
                <h2 class="title">${safeText(title?.length > 17 ? title?.slice(0, 17) + "..." : title)}</h2>
              </div>
                <div class="total-time">
                  <span class="icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" class="w-6 h-6">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg></span>
                  <span>Total Time :</span>
                  <span class="progress-time-current plyr__time plyr__time--current" aria-label="Current time">03:03</span>
                </div>
              </div>
            </div>
            </div>
            <div class="progressbar">
              <input data-plyr="seek"  type="range" min="0" max="100" step="0.01" value="0" aria-label="Seek" />
            </div>
          <div class="controls" style="background: ${safeCss(background)}; position: relative;">
            <button class="backward" data-plyr="rewind">
              <svg stroke="currentColor" fill="currentColor" strokeWidth={0} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                <path d="M485.6 249.9L198.2 498c-8.3 7.1-8.3 20.8 0 27.9l287.4 248.2c10.7 9.2 26.4.9 26.4-14V263.8c0-14.8-15.7-23.2-26.4-13.9zm320 0L518.2 498a18.6 18.6 0 0 0-6.2 14c0 5.2 2.1 10.4 6.2 14l287.4 248.2c10.7 9.2 26.4.9 26.4-14V263.8c0-14.8-15.7-23.2-26.4-13.9z" />
              </svg>
            </button>
            <button class="play" aria-label="Play, {title}"
                  data-plyr="play">
              <svg stroke="currentColor" class="play-icon" fill="currentColor" strokeWidth={0} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                <path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 010 1.393z" />
              </svg>
              <svg stroke="currentColor" class="pause-icon" fill="currentColor" strokeWidth={0} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z" /></svg>
            </button>
            <button class="forward"  data-plyr="fast-forward">
              <svg stroke="currentColor" fill="currentColor" strokeWidth={0} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                <path d="M825.8 498L538.4 249.9c-10.7-9.2-26.4-.9-26.4 14v496.3c0 14.9 15.7 23.2 26.4 14L825.8 526c8.3-7.2 8.3-20.8 0-28zm-320 0L218.4 249.9c-10.7-9.2-26.4-.9-26.4 14v496.3c0 14.9 15.7 23.2 26.4 14L505.8 526c4.1-3.6 6.2-8.8 6.2-14 0-5.2-2.1-10.4-6.2-14z" />
              </svg>
            </button>
            ${
              volume !== false
                ? `
            <div class="volume-container">
              <button type="button" class="plyr__control media-button" aria-label="Mute" data-plyr="mute" style="padding: 4px; color: inherit;">
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
};
