import { useEffect, useRef } from "react";
import { CustomBox } from "../../utils/polarisWebComponents";
import { cssValue, escapeHtml, safeUrl } from "../../utils/sanitize";

/**
 * A single Plyr.io player for use in the multiple-video grid preview.
 *
 * IMPORTANT: The video/iframe element is created imperatively via DOM APIs,
 * NOT rendered via JSX. This prevents the "removeChild" React error that
 * occurs when Plyr modifies the DOM (wrapping <video> inside .plyr) and
 * then React tries to reconcile after a state change (e.g. drag-and-drop reorder).
 */
const PlyrGridItem = ({
  video,
  poster,
  borderRadius,
  options = {},
  overlay,
  watermark,
  columns,
  viewMode,
  activeDevice,
}) => {
  const containerRef = useRef(null);
  const plyrRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clean up previous content completely
    if (plyrRef.current) {
      try {
        plyrRef.current.destroy();
      } catch (e) {}
      plyrRef.current = null;
    }
    // Clear any leftover DOM from previous render
    container.innerHTML = "";

    if (!video) {
      // Show empty state
      // Raw HTML string, so these are real <div> tags — CustomBox is a React
      // component and the browser would parse it as an unknown inline element,
      // leaving the container looking like an empty black box.
      container.innerHTML = `
        <div style="width:100%;height:100%;display:flex;justify-content:center;align-items:center;">
          <div style="width:48px;height:48px;border-radius:50%;background:#1a8d5a;display:flex;align-items:center;justify-content:center;">
            <svg width="30" height="30" viewBox="0 0 20 20" fill="#fff"><path d="M6.5 3.5v13l11-6.5z"/></svg>
          </div>
        </div>
      `;
      return;
    }

    const isYoutube = video.includes("youtu");
    const isVimeo = video.includes("vimeo.com");
    const isEmbed = isYoutube || isVimeo;

    // Create the media element imperatively
    let mediaEl;

    if (isEmbed) {
      // Build embed URL
      let embedSrc = "";
      if (isYoutube) {
        let vid = "";
        if (video.includes("watch?v=")) {
          vid = video.split("v=")[1]?.split("&")[0];
        } else {
          vid = video.split("/").pop();
        }
        // No `origin=` param. It used to say `origin=https://admin.shopify.com`,
        // which is the TOP frame — this document's real origin is the app's own
        // host. YouTube cross-checks that value against the actual embedder and
        // refuses to start the player when they disagree ("Error 153").
        // Omitting it is supported; the YT IFrame API works it out.
        embedSrc = `https://www.youtube.com/embed/${vid}?iv_load_policy=3&modestbranding=1&playsinline=1&showinfo=0&rel=0&enablejsapi=1`;
      } else {
        const vid = video.split("/").pop();
        embedSrc = `https://player.vimeo.com/video/${vid}`;
      }

      mediaEl = document.createElement("div");
      mediaEl.className = "plyr__video-embed";
      mediaEl.style.cssText = "width:100%;height:100%;";

      const iframe = document.createElement("iframe");
      iframe.src = embedSrc;
      iframe.setAttribute("allowtransparency", "true");
      iframe.setAttribute(
        "allow",
        "autoplay; encrypted-media; picture-in-picture",
      );
      iframe.setAttribute("allowfullscreen", "true");
      // Only covers the moment before Plyr swaps this element out — the player
      // Plyr ends up with is built by the YT API and takes no such attribute,
      // so it relies on the document-level meta in app/root.jsx instead.
      iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      mediaEl.appendChild(iframe);
    } else {
      mediaEl = document.createElement("video");
      mediaEl.playsInline = true;
      mediaEl.muted = true;
      if (options.autoPlay || options.autoplay) {
        mediaEl.autoplay = true;
      }

      const source = document.createElement("source");
      source.src = video;
      source.type = "video/mp4";
      mediaEl.appendChild(source);
    }

    container.appendChild(mediaEl);

    // Poll until Plyr CDN is loaded, then initialize
    intervalRef.current = setInterval(() => {
      if (typeof window === "undefined" || !window.Plyr) return;

      clearInterval(intervalRef.current);
      intervalRef.current = null;

      const plyrOptions = {
        controls: [
          "play-large",
          "play",
          "progress",
          "current-time",
          "mute",
          "fullscreen",
        ],
        muted: true,
        autoplay: !!(options.autoPlay || options.autoplay),
        loop: { active: false },
        hideControls: false, // Show controls so they are accessible
        clickToPlay: true,
        ...options,
      };

      if (
        isEmbed &&
        plyrOptions.controls &&
        Array.isArray(plyrOptions.controls)
      ) {
        plyrOptions.controls = plyrOptions.controls.filter(
          (c) => c !== "pip" && c !== "download",
        );
      }

      if (poster && !isEmbed) {
        plyrOptions.poster = poster;
      }

      try {
        const player = new window.Plyr(mediaEl, plyrOptions);
        plyrRef.current = player;

        // Auto pause when scrolled out of view in carousel mode
        if (typeof window !== "undefined" && "IntersectionObserver" in window) {
          const observer = new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                if (!entry.isIntersecting && player.playing) {
                  player.pause();
                }
              });
            },
            { threshold: 0.2 },
          );
          if (container) observer.observe(container);
        }

        if (poster) {
          player.on("ready", () => {
            setTimeout(() => {
              const posterEl = container.querySelector(".plyr__poster");
              if (posterEl) {
                posterEl.style.backgroundImage = `url(${poster})`;
                posterEl.style.backgroundSize = "cover";
              }
            }, 500);
          });

          player.on("play", () => {});
        } else {
          player.on("ready", () => {});
        }

        player.on("ready", () => {
          if (overlay && overlay.enabled) {
            let overlayImgStyle = "max-width: 70px; max-height: 70px;";
            const isSmall = (columns?.[activeDevice] || 1) > 1;
            if (activeDevice === "mobile" || isSmall) {
              overlayImgStyle = "max-width: 40px; max-height: 40px;";

              if (viewMode == "slider") {
                if (activeDevice === "mobile") {
                  overlayImgStyle = "max-width: 40px; max-height: 40px;";
                } else {
                  overlayImgStyle = "max-width: 70px; max-height: 70px;";
                }
              }
            }
            // Escaped per context so markup in overlay settings shows as text.
            const ov = {
              color: cssValue(overlay?.color),
              fontSize: cssValue(overlay?.fontSize),
              backgroundColor: cssValue(overlay?.backgroundColor),
              opacity: cssValue(overlay?.opacity),
              position: cssValue(overlay?.position),
              url: escapeHtml(safeUrl(overlay?.url)),
              logo: escapeHtml(safeUrl(overlay?.logo)),
              text: escapeHtml(overlay?.text),
            };
            const overlayHtml = `
              <div class="h5vp_overlay_wrapper">
                <style>
                  .h5vp_overlay_customize p { padding: 5px 12px; cursor: pointer; color: ${ov.color || "#ffffff"}; font-size: ${ov.fontSize || "16px"}; background-color: ${ov.backgroundColor || "rgba(0, 0, 0, 0.5)"}; border-radius: 3px; opacity: ${ov.opacity || "0.7"}; overflow: hidden; display: block; }
                  .h5vp_overlay_customize a { color: ${ov.color || "#ffffff"}; font-size: ${ov.fontSize || "16px"}; text-decoration: none !important; }
                  .h5vp_overlay_customize p:hover { background-color: ${ov.color || "rgba(255, 255, 255, 0.7)"}; color: ${ov.backgroundColor || "#000000"}; }
                  .h5vp_overlay { position: absolute; z-index: 99; }
                  .h5vp_overlay img { ${overlayImgStyle} width: 100%; height: 100%; object-fit: cover; border-radius: 3px; opacity: ${ov.opacity || "0.7"}; }
                  .h5vp_overlay.bottom_right { bottom: 10px; right: 10px; }
                  .h5vp_overlay.top_right { top: 10px; right: 10px; }
                  .h5vp_overlay.bottom_left { bottom: 10px; left: 10px; }
                  .h5vp_overlay.top_left { top: 10px; left: 10px; }
                </style>
                <div class="h5vp_overlay ${ov.position || "top_right"} h5vp_overlay_customize">
                  ${overlay?.type === "text" ? `<p>${overlay?.url ? `<a href="${ov.url}" rel="noreferrer" target="_blank">${ov.text}</a>` : ov.text}</p>` : overlay?.url ? `<a href="${ov.url}" rel="noreferrer" target="_blank"><img src="${ov.logo}" /></a>` : `<img src="${ov.logo}" />`}
                </div>
              </div>`;
            const temp = document.createElement("template");
            temp.innerHTML = overlayHtml.trim();
            container.appendChild(temp.content.firstChild);
          }
        });

        // Simple Watermark handling
        if (watermark && watermark.enabled) {
          player.on("ready", () => {
            const wmContent =
              watermark.type === "domain"
                ? "your-shop.myshopify.com"
                : watermark.text || "";
            const wmColor = watermark.color || "#ff0000ff";
            const wmSpan = document.createElement("span");
            wmSpan.innerText = wmContent;
            wmSpan.setAttribute(
              "style",
              `position:absolute; display:block !important; opacity:0; z-index:100; color:${wmColor}; pointer-events:none; transition: opacity 0.5s;`,
            );
            container.appendChild(wmSpan);

            let wmInterval;
            player.on("play", () => {
              wmSpan.style.opacity = "1";
              wmInterval = setInterval(() => {
                wmSpan.style.top = Math.round(Math.random() * 90) + "%";
                wmSpan.style.left = Math.round(Math.random() * 70) + "%";
              }, 2000);
            });
            player.on("pause", () => {
              clearInterval(wmInterval);
              wmSpan.style.opacity = "0";
            });
          });
        }
      } catch (e) {
        console.warn("PlyrGridItem init error:", e);
      }
    }, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (plyrRef.current) {
        try {
          plyrRef.current.destroy();
        } catch (e) {}
        plyrRef.current = null;
      }
      // Clear the container so React doesn't try to reconcile Plyr's DOM
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [
    video,
    poster,
    JSON.stringify(options),
    JSON.stringify(overlay),
    JSON.stringify(watermark),
    activeDevice,
    JSON.stringify(columns),
  ]);

  return (
    <>
      <style>
        {`
          @keyframes gradientBG {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          .plyr-grid-container {
            position: relative;
            aspect-ratio: 16/9;
            width: 100%;
            overflow: hidden;
            background: linear-gradient(-45deg, #424242, #1d1d1d, #0b0b0b, #2a2a2a);
            background-size: 400% 400%;
            animation: gradientBG 10s ease infinite;
          }
          /* Ensure Plyr fills the container */
          .plyr-grid-container .plyr { height: 100%; }
        `}
      </style>
      <CustomBox
        ref={containerRef}
        className="plyr-grid-container"
        style={{ borderRadius }}
      />
    </>
  );
};

export default PlyrGridItem;
