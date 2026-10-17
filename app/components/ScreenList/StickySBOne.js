import getMultiShadowCSS from "../CommonFun/GetMultiShadowCss";
import { playerIcon } from "../CustomIcons/CustomIcons";
import "./style.css";
import { safeCss, safeText } from "./templateSafe";

export default function stickySBOne(
  title = "Feel the Song",
  sbAlign = "bottom-right",
  selectedIconID = 1,
  iconSize = "24px",
  backgroundColor = "#ffffff",
  textColor = "#000000",
  boxShadow = "none",
) {
  let playIcon = "";
  let pauseIcon = "";

  playerIcon.map((icon) => {
    if (icon.id === selectedIconID) {
      playIcon = icon.play;
      pauseIcon = icon.pause;
    }
  });

  return `<div>
    
    <style>
     .SBO-wrapper {
         box-shadow: ${safeCss(getMultiShadowCSS(boxShadow, "box"))};
      }
      .SBO-wrapper button svg {
        width: ${safeCss(iconSize)};
        height: ${safeCss(iconSize)};
        color: ${safeCss(textColor)} !important;
        fill: none !important;
      }
      #SBO-greeting--opened {
        margin-left: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        color: #1e2433;
        background-color: #fff;
        border-radius: 8px;
        padding: 7px 12px;
        font-size: 14px;
        line-height: 1.2;
        box-shadow: ${safeCss(getMultiShadowCSS(boxShadow, "box"))};
        transition: margin .5s cubic-bezier(.4,.22,.28,1), opacity 80ms ease;
        opacity: 0;
        ${sbAlign == "top-left" || sbAlign == "bottom-left" ? "left:100%;" : "right:120%;"}
        pointer-events: none;
        z-index: 9999;
      }
        .SBO-wrapper:hover button.plyr__control {
            background: transparent !important;
        }
    </style>
      <div class="plyr__controler SBO-wrapper" style="background: ${safeCss(backgroundColor)};">
            <button type="button" class="plyr__control" aria-label="Play, {title}" data-plyr="play">
               ${playIcon}
               ${pauseIcon}
               <span class="label--pressed plyr__tooltip" role="tooltip">Unmute</span>
               <span class="label--not-pressed plyr__tooltip" role="tooltip">Mute</span>
            </button>
            
            <h2 id="SBO-greeting--opened">${safeText(title)}</h2>
            </div>

    </div>`;
}
