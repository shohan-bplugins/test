// Backend that serves player data + analytics.
// For local testing with `shopify app dev`, set this to your tunnel URL
// (e.g. "https://xxxx.trycloudflare.com"). Use production for the live store.
const AUDIO_APP_BASE = "https://shopify-audio-app.bplugins.com";

// Whether the Volume control is on for a saved screen. Single audio stores
// controls as an array of names (["play", "volume", ...]); playlists store an
// object of flags ({ volume: false, ... }). Unsaved screens keep volume on.
// Keep in sync with isVolumeOn in app/routes/audio-plyr-apbp.jsx.
function isVolumeOn(controls) {
  if (Array.isArray(controls)) return controls.includes("volume");
  if (controls && typeof controls === "object")
    return controls.volume !== false;
  return true;
}

// Product-page auto-display config. On themes that don't let merchants add the
// Product Audio block (e.g. Prestige), this lets the embed inject the player(s)
// assigned to the product automatically. Rendered from Liquid so it has the
// product's assigned-audio metafield at page render time.
// Filled in by the block's Liquid (settings, product metafields, shop).
const APBP_AUTO = window.APBP_AUTO || {
  enabled: false,
  isProduct: false,
  target: "",
  ids: [],
  legacyId: "",
  productId: null,
  shop: "",
};

const getControlsArray = (controls) => {
  if (Array.isArray(controls)) {
    return controls;
  }

  if (controls && typeof controls === "object") {
    return Object.entries(controls)
      .filter(([, enabled]) => enabled)
      .map(([key]) =>
        key === "currentTime"
          ? "current-time"
          : key === "fastForward"
            ? "fast-forward"
            : key,
      );
  }

  return [];
};

const el = document.querySelector(".html5-audio-plyr");
const shopDomainAudioPlayer = el?.dataset?.shop || window.APBP_SHOP || "";
fetch(`${AUDIO_APP_BASE}/app/api/user?shop=${shopDomainAudioPlayer}`)
  .then((response) => response.json())
  .then((data) => {
    if (
      document.querySelector(
        `.alart-from-audio-plyr-bp-${window.APBP_BLOCK_ID}`,
      )
    ) {
      document.querySelector(
        `.alart-from-audio-plyr-bp-${window.APBP_BLOCK_ID}`,
      ).style.display = "none";
      if (data?.userType == "free") {
        document.querySelector(
          `.player-${window.APBP_BLOCK_ID}`,
        ).style.display = "none";
        document.querySelector(
          `.alart-from-audio-plyr-bp-${window.APBP_BLOCK_ID}`,
        ).style.display = "flex";
      } else if (data?.userType == "premium") {
        document.querySelector(
          `.player-${window.APBP_BLOCK_ID}`,
        ).style.display = "flex";
        document.querySelector(
          `.alart-from-audio-plyr-bp-${window.APBP_BLOCK_ID}`,
        ).style.display = "none";
      }
    }
  })
  .catch((error) => {
    console.error("Error fetching user data:", error);
  });

function htmlToElement(html) {
  const temp = document.createElement("template");
  temp.innerHTML = html.trim();
  return temp.content.firstChild;
}
const getMultiShadowCSS = (value, type = "box") => {
  let styles = "";

  value?.map((item, index) => {
    const {
      hOffset = "0px",
      vOffset = "0px",
      blur = "0px",
      spreed = "0px",
      color = "#dddddd",
      isInset = false,
    } = item || {};

    const inset = isInset ? "inset" : "";
    const offsetBlur = `${parseInt(hOffset)}px ${parseInt(vOffset)}px ${parseInt(blur)}px`;
    const isComa = index + 1 >= value.length ? "" : ", ";

    styles +=
      "text" === type
        ? `${offsetBlur} ${color}${isComa}`
        : `${offsetBlur} ${parseInt(spreed)}px ${color} ${inset}${isComa}`;
  });

  return styles || "none";
};

function removeURLParams(url) {
  try {
    const parsedURL = new URL(url);
    return parsedURL.origin + parsedURL.pathname;
  } catch (error) {
    return null;
  }
}

function validateMediaURL(url) {
  if (url === null) {
    return false;
  }
  // Regular expression to check if URL is valid
  const urlPattern =
    /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})(\/[\w .-]*)*\/?$/;

  // Supported audio and video file extensions
  const videoExtensions = ["mp4", "mov", "avi", "mkv", "webm", "wmv"]; // video formats
  const audioExtensions = [
    "mp3",
    "wav",
    "ogg",
    "aac",
    "flac", // audio formats
  ]; // video formats

  // Check if URL is valid
  if (!urlPattern.test(url)) {
    return false;
  }

  // Extract the file name from the URL, ignoring query parameters
  const cleanURL = new URL(url).pathname;

  // Extract the file extension from the cleaned URL
  const extension = cleanURL.split(".").pop().toLowerCase();

  if (videoExtensions.includes(extension)) {
    return "audio/mp4";
  } else if (audioExtensions.includes(extension)) {
    return "audio/mp3";
  }
  return "audio/mp3";
}

// Brave ships a User-Agent byte-identical to Chrome's on purpose (anti-
// fingerprinting), so no UA pattern can ever see it and the Chrome branch in
// detectBrowser claims every Brave listen. Two signals do work, and both are
// used here: navigator.userAgentData.brands lists "Brave", and navigator.brave
// exists only in Brave. isBrave() is Brave's documented check but resolves
// asynchronously, so its answer is cached for later events while the two
// synchronous signals already cover the first one.
let braveDetected = false;

try {
  braveDetected =
    Boolean(navigator.brave) ||
    (navigator.userAgentData?.brands || []).some((b) => b.brand === "Brave");

  if (navigator.brave && typeof navigator.brave.isBrave === "function") {
    navigator.brave
      .isBrave()
      .then((result) => {
        braveDetected = Boolean(result);
      })
      .catch(() => {});
  }
} catch (e) {
  braveDetected = false;
}

function detectBrowser() {
  const ua = navigator.userAgent;

  if (/Edg\/\d+/i.test(ua)) return "Microsoft Edge";
  if (/OPR\/\d+/i.test(ua) || /Opera/i.test(ua)) return "Opera";
  if (/SamsungBrowser\/\d+/i.test(ua)) return "Samsung Internet";
  if (/UCBrowser\/\d+/i.test(ua)) return "UC Browser";
  if (/YaBrowser\/\d+/i.test(ua)) return "Yandex Browser";
  // Must stay ahead of the Chrome branch — Brave's UA matches /Chrome\/\d+/.
  if (braveDetected) return "Brave";
  if (/Firefox\/\d+/i.test(ua)) return "Firefox";
  if (/CriOS\/\d+/i.test(ua)) return "Chrome (iOS)";
  if (/FxiOS\/\d+/i.test(ua)) return "Firefox (iOS)";
  if (/Chrome\/\d+/i.test(ua) && !/Edg|OPR/i.test(ua)) return "Chrome";
  if (/Safari\/\d+/i.test(ua) && !/Chrome|CriOS|Edg|OPR/i.test(ua)) {
    return "Safari";
  }

  return "Unknown Browser";
}

// Safely pull the unit suffix ("px", "%", "rem"...) from an iconSize value
// like "24px". Returns the suffix string or "px" as a safe default so the
// styles template never crashes on a value with no unit / null / undefined.
function getIconSizeUnit(value) {
  if (typeof value !== "string") return "px";
  const m = value.match(/[a-z%]+/i);
  return m && m[0] ? m[0] : "px";
}

function getSafeBodyElement() {
  try {
    if (window.top && window.top.document && window.top.document.body) {
      return window.top.document.body;
    }
  } catch (error) {
    return document.body;
  }

  return document.body;
}

function isDefaultMuted(screenData) {
  return !!(
    screenData &&
    (screenData.defaultMuted === true || screenData.defaultMuted === "true")
  );
}

function initAudioPlayerWhenReady() {
  // Output-escaping helpers for merchant/API values interpolated into HTML
  // strings and <style> blocks. Kept local to this function (no new globals).
  // Each stringifies first so normal values render exactly as before.
  const apbpEscapeHtml = (str) => {
    if (str === null || str === undefined) return "";
    return String(str).replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  };
  const apbpSanitizeCssValue = (val) => {
    if (val === null || val === undefined) return "";
    if (typeof val === "number") return val;
    let s = String(val);
    let prev;
    do {
      prev = s;
      s = s.replace(/\/\*|\*\/|<\//g, "").replace(/[<>{};"`\\\r\n]/g, "");
    } while (s !== prev);
    return s;
  };
  const apbpSafeUrl = (u) => {
    const t = String(u)
      .replace(/[\u0000-\u0020]/g, "")
      .toLowerCase();
    if (
      t.startsWith("javascript:") ||
      t.startsWith("data:text/html") ||
      t.startsWith("vbscript:")
    ) {
      return "";
    }
    return apbpEscapeHtml(String(u));
  };
  // Text / attribute value (String() keeps "undefined" output identical).
  const esc = (v) => apbpEscapeHtml(String(v));
  // CSS declaration value.
  const css = (v) => apbpSanitizeCssValue(String(v));

  const audioPlyrElements = document.querySelectorAll(".html5-audio-plyr");
  if (audioPlyrElements.length >= 1) {
    audioPlyrElements.forEach((el) => {
      const hostSection = el.closest(".shopify-section, section");
      if (hostSection) {
        hostSection.classList.add("h5ap-player-section");
      }
      const parent = el.parentElement?.parentElement;
      if (parent) {
        parent.style.width = "100%";
      }
    });

    const sessionId =
      window.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    let listenedSeconds = 0;
    let lastPlayTimestamp = null;
    let firedMilestones = new Set();

    const MILESTONES = [25, 50, 75, 100];

    function trackTime() {
      if (lastPlayTimestamp) {
        listenedSeconds += (Date.now() - lastPlayTimestamp) / 1000;
        lastPlayTimestamp = Date.now();
      }
    }

    function sendAnalytics(eventType, player, data) {
      const payload = {
        sessionId,
        audioId: data.id,
        shop: shopDomainAudioPlayer,
        event: eventType,
        duration: Math.round(listenedSeconds),
        currentTime: Math.round(player.currentTime || 0),
        totalDuration: Math.round(player.duration || 0),
        device: /mobile/i.test(navigator.userAgent) ? "Mobile" : "Desktop",
        browser: detectBrowser(),
        userAgent: navigator.userAgent,
      };
      fetch(`${AUDIO_APP_BASE}/app/audio-analytics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true, // 🔥 important for unload
      });
    }

    // A "play" should count once per player per page load. Plyr fires the "play"
    // event again every time the listener resumes after a pause, so without this
    // guard a single listen inflates the play count. Keyed by the player id.
    const countedPlays = new Set();
    function sendPlayOnce(player, data) {
      if (!data || countedPlays.has(data.id)) return;
      countedPlays.add(data.id);
      sendAnalytics("play", player, data);
    }

    // Applies the merchant's saved initial volume / default-muted settings to the player.
    function applyMediaDefaults(player, rawInitialVolume, rawDefaultMuted) {
      if (!player) return;
      const hasVol =
        rawInitialVolume !== undefined &&
        rawInitialVolume !== null &&
        rawInitialVolume !== "";
      const targetVolume = hasVol
        ? Math.max(0, Math.min(1, (parseInt(rawInitialVolume) || 0) / 100))
        : null;
      const defaultMuted =
        rawDefaultMuted === true || rawDefaultMuted === "true";

      const applyFinalLevels = (media) => {
        try {
          if (targetVolume !== null) {
            try {
              player.volume = targetVolume;
            } catch (e) {}
            if (media) media.volume = targetVolume;
          }
          try {
            player.muted = defaultMuted;
          } catch (e) {}
          if (media) media.muted = defaultMuted;
        } catch (e) {}
      };

      const media = player.media;
      applyFinalLevels(media);
      if (media) {
        ["loadedmetadata", "canplay"].forEach((ev) =>
          media.addEventListener(ev, () => applyFinalLevels(player.media), {
            once: true,
          }),
        );
      }
    }

    const ids = Array.from(audioPlyrElements)
      .map((item) => item.getAttribute("data-id"))
      .filter((id) => id);

    // Track which ids originated from a product metafield assignment so the
    // server can pro-gate those on free plans without affecting direct embeds.
    const metafieldIds = Array.from(audioPlyrElements)
      .filter(
        (item) => item.getAttribute("data-source") === "product-metafield",
      )
      .map((item) => item.getAttribute("data-id"))
      .filter((id) => id);

    if (!ids.length) {
      console.warn("Audio Player by bPlugins: no player ids found on page.");
      return;
    }

    fetch(
      `${AUDIO_APP_BASE}/audio-plyr-apbp?ids=${encodeURIComponent(JSON.stringify(ids))}&metafieldIds=${encodeURIComponent(JSON.stringify(metafieldIds))}`,
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        return res.json();
      })
      .then((datas) => {
        // The API returns { controls: [...] } on success or { error } on failure.
        // Guard against a missing/!array "controls" so a bad response can't crash
        // the whole init (which would leave every player on the page blank).
        const controlsList = Array.isArray(datas?.controls)
          ? datas.controls
          : [];
        if (!controlsList.length) {
          console.warn(
            "Audio Player by bPlugins: no player data returned",
            datas,
          );
          return;
        }

        let uniqueNumbers = controlsList.filter(
          (value, index, self) =>
            index === self.findIndex((obj) => obj.id === value.id),
        );

        uniqueNumbers.forEach((item, index) => {
          const data = item?.item;
          const selectedScreenData = data?.[data?.selectedScreen] || {};
          // Initial volume (0–1) saved on the screen; default 100% when unset.
          // Single-audio stores it top-level; playlist stores it under controls.
          const resolvedInitialVolume =
            selectedScreenData?.initialVolume ??
            selectedScreenData?.controls?.initialVolume;
          const initialVolumeRaw = resolvedInitialVolume;
          const initialVolumeFraction =
            initialVolumeRaw !== undefined &&
            initialVolumeRaw !== null &&
            initialVolumeRaw !== ""
              ? Math.max(
                  0,
                  Math.min(1, (parseInt(initialVolumeRaw) || 0) / 100),
                )
              : 1;
          function generateUniqueId() {
            return (
              "id-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9)
            );
          }

          const generateId = generateUniqueId();

          const id = data.id;
          const audioElement = document.querySelectorAll(
            `.html5-audio-plyr[data-id="${id}"]`,
          );

          if (!audioElement) return;

          const modalElementString = `
          <div class="player-${esc(id)}">
            <audio id="player-${esc(id)}-${index}" class="player" controls preload="auto">
              <source src="${apbpSafeUrl(data.url)}" type="${validateMediaURL(removeURLParams(data.url))}" />
              </audio>
              </div>`;

          const controlsConfig = {
            controls: [
              "play",
              "progress",
              "current-time",
              "mute",
              "volume",
              "settings",
            ],
          };

          const allControls = item?.item?.screenDefault?.controls || [];

          const controlsArray = getControlsArray(allControls);
          // const controlsArray = allControls;

          let defaultPlayerControls = controlsArray?.length
            ? controlsArray
            : [
                "play",
                "progress",
                "current-time",
                "duration",
                "mute",
                "volume",
                "settings",
              ];
          const hasCurrentTime = controlsArray.includes("current-time");
          const hasDuration = controlsArray.includes("duration");
          // Drop any legacy "save-state" flag from older saved players — it
          // is not a real Plyr control and the feature has been removed.
          defaultPlayerControls = defaultPlayerControls.filter(
            (c) => c !== "save-state",
          );
          // 1️⃣ duration → ensure current-time before it
          if (
            defaultPlayerControls.includes("duration") &&
            !defaultPlayerControls.includes("current-time")
          ) {
            const durationIndex = defaultPlayerControls.indexOf("duration");
            defaultPlayerControls.splice(durationIndex, 0, "current-time");

            // 2️⃣ current-time → ensure duration after it
          } else if (
            defaultPlayerControls.includes("current-time") &&
            !defaultPlayerControls.includes("duration")
          ) {
            const currentTimeIndex =
              defaultPlayerControls.indexOf("current-time");
            defaultPlayerControls.splice(currentTimeIndex + 1, 0, "duration");
          }

          // Saved players store their controls in whatever order they were
          // written, which Plyr renders literally — leaving the play button
          // stranded in the middle. Force one canonical order regardless of
          // how the array was stored, keeping any unknown entries
          // (e.g. "initial-volume:50") at the end. Must match
          // SINGLE_DEFAULT_CONTROL_ORDER in app/routes/audio-plyr-apbp.jsx.
          const CANONICAL_CONTROL_ORDER = [
            "restart",
            "rewind",
            "play",
            "fast-forward",
            "progress",
            "current-time",
            "duration",
            "mute",
            "volume",
            "settings",
            "download",
            "loop",
            "airplay",
          ];
          defaultPlayerControls = CANONICAL_CONTROL_ORDER.filter((c) =>
            defaultPlayerControls.includes(c),
          ).concat(
            defaultPlayerControls.filter(
              (c) => !CANONICAL_CONTROL_ORDER.includes(c),
            ),
          );

          audioElement.forEach((audio, i) => {
            // Skip nodes already rendered so re-running init (after a theme
            // section re-render / editor reload) never double-initialises Plyr.
            if (audio.dataset.apbpRendered === "1") return;
            audio.dataset.apbpRendered = "1";

            // Skin One (single audio) must match the customize preview: the
            // preview sizes icons at exactly iconSize, applies the margin only
            // on the outer #player wrapper, and lets the card use the full width.
            const isSingleScreenOne =
              data?.playerType === "single-audio" &&
              data?.selectedScreen === "screenOne";
            const iconSizeBoost =
              data?.selectedScreen == "screenDefault" ||
              data?.playerType == "sticky-player" ||
              isSingleScreenOne
                ? 0
                : 10;

            let styles = `<style>

            #player-${id} {
             width: ${css(data?.[data?.selectedScreen]?.width || "100%")};
             margin: ${css(data?.[data?.selectedScreen]?.margin + " auto" || "0 auto")};
             min-width: auto;
             max-width: 100%;
             --plyr-color-main: ${css(data?.mainColor)};
            }
            #time_progress_${id} {
             width: 100%;
            }

            div#plyr-settings-7531 .plyr__menu__container {
              z-index: 9999 !important;
            }

            #player-${id} .plyr__time+.plyr__time::before {
               content: "${hasCurrentTime && hasDuration ? "/" : ""}" !important;
            }
             #player-${id} .plyr__controls__item.plyr__time--duration::before {
                content: "${hasCurrentTime && hasDuration ? "/" : ""}" !important;
              }
              #player-${id} .playListTwo .plyr__time+.plyr__time::before {
                content: " " !important;
              }
              #player-${id} .plyr__controls__item.plyr__time--current {
                display: ${hasCurrentTime ? "inline-block" : "none"} !important;
              }
             #player-${id} .plyr__controls__item.plyr__time--duration {
                display: ${hasDuration ? "inline-block" : "none"} !important;
              }

            #player-${id} .plyr .media-controls {
              width: ${css(data?.[data?.selectedScreen]?.width || "100%")};
              height: ${css(data?.[data?.selectedScreen]?.height || "250px")};
              border-radius: ${css(data?.[data?.selectedScreen]?.borderRadius)};
              padding: ${css(data?.[data?.selectedScreen]?.padding)};
              margin: ${isSingleScreenOne ? "0" : css(data?.[data?.selectedScreen]?.margin)};
              ${isSingleScreenOne ? "max-width: 100%;" : ""}
              background: ${css(data?.[data?.selectedScreen]?.background)};
              border: ${css(data?.[data?.selectedScreen]?.borderWidth)} ${css(data?.[data?.selectedScreen]?.borderStyle)} ${css(data?.[data?.selectedScreen]?.borderColor)};
            }

            #player-${id} .media-controls .media-buttons {
              gap: 10px;
            }

            #player-${id} .media-controls .media-buttons button svg,
            #player-${id} .controls button svg,
            #player-${id} .plyr__controls svg {
                width: ${parseInt(data?.[data?.selectedScreen]?.iconSize) + iconSizeBoost + getIconSizeUnit(data?.[data?.selectedScreen]?.iconSize)};
                height: ${parseInt(data?.[data?.selectedScreen]?.iconSize) + iconSizeBoost + getIconSizeUnit(data?.[data?.selectedScreen]?.iconSize)};
                color: ${css(data?.[data?.selectedScreen]?.iconColor)};
            }

            #player-${id} .plyr--audio .plyr__controls{
             color: ${css(data?.[data?.selectedScreen]?.iconColor)};
            }

            #player-${id} .controller{
              display: none;
              transition-delay: 2s, 4ms;
              transition-duration: 2s;
              transition-property: height;
              transition-timing-function: ease-in-out;
              height: 0;
            }
            #player-${id}:hover .controller{
              display: flex;
              height: 25px;
              }

              @media (max-width: 640px) {
                #player-${id} .controller {
                  display: flex !important;
                  height: 25px !important;
                }
            }

            ${
              data?.selectedScreen === "screenDefault"
                ? `
          #player-${id} .plyr__controls {
           width: ${css(data?.[data?.selectedScreen]?.width)};
           height: ${css(data?.[data?.selectedScreen]?.height)};
           max-width: fit-content;
           border-width: ${css(data?.[data?.selectedScreen]?.borderWidth)};
           border-style: ${css(data?.[data?.selectedScreen]?.borderStyle)};
           border-color: ${css(data?.[data?.selectedScreen]?.borderColor)};
           border-radius: ${css(data?.[data?.selectedScreen]?.borderRadius)};
           padding: ${css(data?.[data?.selectedScreen]?.padding)};
           margin: ${css(data?.[data?.selectedScreen]?.margin)};
           box-shadow: ${css(getMultiShadowCSS(data?.[data?.selectedScreen]?.boxShadow, "box"))};
           background: ${css(data?.[data?.selectedScreen]?.background)};
          }

          `
                : null
            }

            </style>`;

            let audios = [];

            if (data?.playerType === "playlist-audio") {
              let playlistData = data?.audioPlayList;
              if (typeof playlistData === "string") {
                try {
                  playlistData = JSON.parse(playlistData);
                } catch (e) {
                  console.warn(
                    "Audio Player by bPlugins: audioPlayList is not valid JSON",
                    e,
                  );
                  playlistData = [];
                }
              }
              if (Array.isArray(playlistData)) {
                audios = playlistData
                  .filter((entry) => entry && entry.url)
                  .map((entry) => ({
                    title: entry.title || "",
                    artist: entry?.artist || "",
                    source: entry.url,
                    poster: entry?.poster || "",
                  }));
              } else {
                audios = [];
              }
            }

            // Create the controller HTML
            const controllerHTML = `
                              <div class="controller" style=" background: ${css(data?.[data?.selectedScreen]?.background)} ;  padding:6px; z-index: 9999; ">

                                <span
                                  class="icon icon-no-alt"
                                  style=" color: ${css(data?.[data?.selectedScreen]?.iconColor)} ;  cursor: pointer; font-size: 22px;"
                                >
                                  ×
                                </span>
                              </div>
                            `;

            const modalElementString = `
                          <div id="player-${esc(id)}" class="player-${esc(id)} ${data?.playerType === "sticky-player" ? "h5ap_sticky_player stickyPlayerOne" : ""} ">
                             <div>${data?.playerType === "sticky-player" ? controllerHTML : ""}</div>
                            <audio id="player-${esc(id)}-${i}" class="player" controls>
                              <source src="${apbpSafeUrl(data.url || "https://cdn.shopify.com/s/files/1/0700/1758/1253/files/Emma-_-John-Wedding-Intro-May-4th-25-2.mp3?v=1744788844")}" type="${validateMediaURL(removeURLParams(data.url))}" />
                            </audio>
                          </div>`;

            if (data?.[data?.selectedScreen]?.showMessage) {
              setTimeout(
                () => {
                  const greeting = window?.document?.getElementById(
                    "SBO-greeting--opened",
                  );
                  if (greeting) {
                    greeting.style.display = "flex"; // Show the element
                    // Force a reflow to ensure opacity transition works
                    void greeting.offsetWidth;
                    greeting.style.opacity = "1"; // Fade in
                  }
                },
                parseInt(data?.[data?.selectedScreen]?.messageShowDelay) * 1000,
              ); // Convert seconds to milliseconds
            }

            if (data?.playerType === "sticky-player") {
              const bodyElement = getSafeBodyElement();

              if (modalElementString) {
                const temp = document.createElement("template");
                temp.innerHTML = modalElementString.trim();
                bodyElement.appendChild(htmlToElement(styles));
                bodyElement.appendChild(temp.content.firstChild);
              }

              const audioEl = audio;

              // Add event listeners
              audioEl.innerHTML = `<div>${styles}<div>`;

              // const minus = bodyElement.querySelector('.icon-minus');
              // const plus = bodyElement.querySelector('.icon-plus');
              const close = bodyElement.querySelector(".icon-no-alt");

              let stickyPlayer = null;

              // Fall back to Plyr's default controls when the API didn't ship a
              // custom controls HTML for this player (e.g. brand-new sticky
              // player that hasn't been customized + saved yet).
              const stickyScreen = data?.[data?.selectedScreen] || {};
              const hasInitialVolume =
                stickyScreen.initialVolume !== undefined &&
                stickyScreen.initialVolume !== null;
              const stickyTargetVolume = hasInitialVolume
                ? (parseInt(stickyScreen.initialVolume) || 0) / 100
                : null;
              const stickyMuted = isDefaultMuted(stickyScreen);
              const stickyPlyrOpts = {
                seekTime:
                  parseInt(data?.[data?.selectedScreen]?.seekTime) || 10,
                muted: stickyMuted,
                storage: { enabled: false },
              };
              if (hasInitialVolume) {
                stickyPlyrOpts.volume = stickyTargetVolume;
              }
              if (item?.controls) {
                stickyPlyrOpts.controls = item.controls;
              }

              // Apply the saved default volume / mute once the player is ready.
              const applyStickyDefaults = (p) => {
                if (!p) return;

                const applyVolume = (media) => {
                  try {
                    if (stickyTargetVolume !== null && media)
                      media.volume = stickyTargetVolume;
                  } catch (e) {}
                };

                const applyFinalLevels = (media) => {
                  try {
                    if (stickyTargetVolume !== null) {
                      try {
                        p.volume = stickyTargetVolume;
                      } catch (e) {}
                      if (media) media.volume = stickyTargetVolume;
                    }
                    try {
                      p.muted = stickyMuted;
                    } catch (e) {}
                    if (media) media.muted = stickyMuted;
                  } catch (e) {}
                };

                let stickyApplied = false;
                const apply = () => {
                  if (stickyApplied) return;
                  stickyApplied = true;
                  const media =
                    p.media || document.getElementById(`player-${id}-${i}`);
                  if (!media) return;

                  applyVolume(media);
                  [
                    "loadedmetadata",
                    "loadeddata",
                    "canplay",
                    "playing",
                  ].forEach((ev) =>
                    media.addEventListener(ev, () => applyVolume(p.media), {
                      once: true,
                    }),
                  );

                  applyFinalLevels(media);
                };

                if (p.ready) {
                  apply();
                } else {
                  p.on("ready", apply);
                }
              };

              {
                // Create ONE instance — initialising Plyr twice on the same
                // element breaks the first instance (the one we bind to).
                stickyPlayer = new Plyr(`#player-${id}-${i}`, stickyPlyrOpts);

                window.player = stickyPlayer;

                applyStickyDefaults(stickyPlayer);

                /* ▶️ PLAY */
                stickyPlayer.on("play", () => {
                  lastPlayTimestamp = Date.now();
                  sendPlayOnce(stickyPlayer, item);
                });

                /* ⏸️ PAUSE */
                stickyPlayer.on("pause", () => {
                  trackTime();
                  lastPlayTimestamp = null;
                  // sendAnalytics("pause", stickyPlayer, item);
                });

                /* ⏹️ ENDED */
                stickyPlayer.on("ended", () => {
                  trackTime();
                  lastPlayTimestamp = null;
                  sendAnalytics("ended", stickyPlayer, item);
                });

                /* 🔄 SEEK */
                stickyPlayer.on("seeked", () => {
                  lastPlayTimestamp = Date.now();
                });

                /* 🚪 PAGE CLOSE / REFRESH */
                window.addEventListener("beforeunload", () => {
                  if (lastPlayTimestamp) {
                    trackTime();
                    lastPlayTimestamp = null;
                  }

                  if (listenedSeconds > 1) {
                    sendAnalytics("unload", stickyPlayer, item);
                  }
                });
              }

              if (close) {
                close.addEventListener("click", function () {
                  const ref = bodyElement.querySelector(`#player-${id}`);
                  const controllers = bodyElement.querySelector(".controller");
                  if (ref) ref.style.display = "none";
                  if (controllers) controllers.style.display = "none";
                  stickyPlayer.pause();
                });
              }
            } else if (data?.playerType === "sticky-single-button") {
              let playerPosition = { bottom: "20px", left: "20px" };

              if (data?.[data?.selectedScreen]?.sbAlign == "top-left") {
                playerPosition = {
                  top:
                    data?.[data?.selectedScreen]?.sbAllSideGap?.top || "20px",
                  left:
                    data?.[data?.selectedScreen]?.sbAllSideGap?.left || "20px",
                };
              }
              if (data?.[data?.selectedScreen]?.sbAlign == "top-right") {
                playerPosition = {
                  top:
                    data?.[data?.selectedScreen]?.sbAllSideGap?.top || "20px",
                  right:
                    data?.[data?.selectedScreen]?.sbAllSideGap?.right || "20px",
                };
              }
              if (data?.[data?.selectedScreen]?.sbAlign == "bottom-left") {
                playerPosition = {
                  bottom:
                    data?.[data?.selectedScreen]?.sbAllSideGap?.bottom ||
                    "20px",
                  left:
                    data?.[data?.selectedScreen]?.sbAllSideGap?.left || "20px",
                };
              }
              if (data?.[data?.selectedScreen]?.sbAlign == "bottom-right") {
                playerPosition = {
                  bottom:
                    data?.[data?.selectedScreen]?.sbAllSideGap?.bottom ||
                    "20px",
                  right:
                    data?.[data?.selectedScreen]?.sbAllSideGap?.right || "20px",
                };
              }
              let bodyElement = document.body;

              // try {
              //   // Will throw in Theme Editor (cross-origin)
              //   if (window.top && window.top.document) {
              //     bodyElement = window.top.document.body;
              //   }
              // } catch (e) {
              //   bodyElement = document.body; // fallback
              // }

              if (modalElementString) {
                const temp = document.createElement("template");
                temp.innerHTML = modalElementString.trim();
                bodyElement.appendChild(htmlToElement(styles));
                bodyElement.appendChild(temp.content.firstChild);
              }
              audio.innerHTML = `<div>${styles}<div>`;

              // Convert playerPosition object to inline CSS string
              const playerPositionStyles = Object.entries(playerPosition)
                .map(([key, value]) => `${key}: ${css(value)} !important`)
                .join("; ");

              // Anchor the inner controls div (sized to the button) so the
              // greeting message stays right next to the button. Use max
              // z-index and strip any stacking-context-creating styles from
              // the parent chain so the fixed button stays above theme
              // headers / hero overlays in every play state.
              const controlsStyle = `position: fixed !important; z-index: 2147483647 !important; max-width: fit-content; display: flex; flex-direction: column; width: auto; ${playerPositionStyles}`;

              // When the API hasn't shipped a custom button HTML yet (e.g.
              // brand-new player created from the Products page and not yet
              // customized), render a generic play button so the fixed
              // wrapper isn't a zero-size invisible div.
              const sbBackground =
                data?.[data?.selectedScreen]?.backgroundColor ||
                data?.[data?.selectedScreen]?.background ||
                "#1f1f1f";
              const sbIconColor =
                data?.[data?.selectedScreen]?.textColor ||
                data?.[data?.selectedScreen]?.iconColor ||
                "#ffffff";
              const sbFallbackControls = `
                              <div class="plyr__controler SBO-wrapper" style="background: ${css(sbBackground)};">
                                <button type="button" class="plyr__control" aria-label="Play" data-plyr="play">
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${esc(css(sbIconColor))}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="play">
                                    <polygon points="6 3 20 12 6 21 6 3"></polygon>
                                  </svg>
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${esc(css(sbIconColor))}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pause">
                                    <rect x="6" y="4" width="4" height="16"></rect>
                                    <rect x="14" y="4" width="4" height="16"></rect>
                                  </svg>
                                </button>
                              </div>
                            `;
              const sbControlsBody =
                item?.controls && String(item.controls).trim()
                  ? item.controls
                  : sbFallbackControls;

              const player = new Plyr(`#player-${id}-${i}`, {
                controls: `<div style="${controlsStyle}">
                            <style>
                              #player-${id},
                              #player-${id} .plyr,
                              #player-${id} .plyr--audio,
                              #player-${id} .plyr__controls:not(.volume-container) {
                                position: static !important;
                                transform: none !important;
                                filter: none !important;
                                opacity: 1 !important;
                                z-index: auto !important;
                                background: transparent !important;
                                box-shadow: none !important;
                                overflow: visible !important;
                                isolation: auto !important;
                                will-change: auto !important;
                              }
                            </style>
                            ${sbControlsBody}
                            </div>`,
                seekTime: data?.[data?.selectedScreen]?.seekTime || 10,
                muted: isDefaultMuted(selectedScreenData),
                volume: initialVolumeFraction,
                storage: { enabled: false },
              });

              applyMediaDefaults(
                player,
                data?.[data?.selectedScreen]?.initialVolume,
                data?.[data?.selectedScreen]?.defaultMuted,
              );

              /* ▶️ PLAY */
              player.on("play", () => {
                lastPlayTimestamp = Date.now();
                sendPlayOnce(player, item);
              });

              /* ⏸️ PAUSE */
              player.on("pause", () => {
                trackTime();
                lastPlayTimestamp = null;
                // sendAnalytics("pause", player, item);
              });

              /* ⏹️ ENDED */
              player.on("ended", () => {
                trackTime();
                lastPlayTimestamp = null;
                sendAnalytics("ended", player, item);
              });

              /* 🔄 SEEK */
              player.on("seeked", () => {
                lastPlayTimestamp = Date.now();
              });

              /* 🚪 PAGE CLOSE / REFRESH */
              window.addEventListener("beforeunload", () => {
                if (lastPlayTimestamp) {
                  trackTime();
                  lastPlayTimestamp = null;
                }

                if (listenedSeconds > 1) {
                  sendAnalytics("unload", player, item);
                }
              });
            } else if (data?.playerType === "playlist-audio") {
              audio.innerHTML = `<div><div>${styles}</div><div> ${modalElementString}<div>`;

              // Fall back to Plyr's default controls when item.controls is
              // empty so the player still renders something usable for
              // brand-new (uncustomized) playlist players.
              const playlistPlyrOpts = {
                seekTime:
                  parseInt(data?.[data?.selectedScreen]?.seekTime) || 10,
                muted: isDefaultMuted(selectedScreenData),
                volume: initialVolumeFraction,
                storage: { enabled: false },
              };
              if (item?.controls && String(item.controls).trim()) {
                let finalPlaylistControls = item.controls;
                {
                  const volumeEnabled = isVolumeOn(
                    selectedScreenData?.controls,
                  );
                  const tempDiv = document.createElement("div");
                  tempDiv.innerHTML = finalPlaylistControls;
                  const existingVols = Array.from(
                    tempDiv.querySelectorAll(".volume-bar, .volume-container"),
                  );
                  if (!volumeEnabled) {
                    // Volume disabled — strip any volume control.
                    existingVols.forEach((el) => el.remove());
                  } else if (existingVols.length > 1) {
                    // Dedup — keep the first (already correctly placed by
                    // the API markup), drop the rest.
                    existingVols.slice(1).forEach((el) => el.remove());
                  } else if (existingVols.length === 0) {
                    // Legacy player with no volume control — add one.
                    const volDiv = document.createElement("div");
                    volDiv.className = "volume-bar";
                    volDiv.innerHTML = `<button type="button" class="plyr__control media-button" aria-label="Mute" data-plyr="mute" style="color: inherit;"><svg class="icon--pressed" role="presentation" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg><svg class="icon--not-pressed" role="presentation" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg><span class="label--pressed plyr__tooltip" role="tooltip">Unmute</span><span class="label--not-pressed plyr__tooltip" role="tooltip">Mute</span></button><div class="plyr__volume"><input data-plyr="volume" type="range" min="0" max="1" step="0.05" value="1" autocomplete="off" aria-label="Volume"></div>`;

                    const appendTarget =
                      tempDiv.querySelector(".playerActiveControls") ||
                      tempDiv.querySelector(".audio-player");
                    if (appendTarget) {
                      appendTarget.appendChild(volDiv);
                    }
                  }
                  finalPlaylistControls = tempDiv.innerHTML;
                }

                playlistPlyrOpts.controls = `<div>
                              <style>

                                #player-${id} .plyr .media-controls svg,
                                #player-${id} .plyr .controls svg,
                                #player-${id} .volume-bar button svg {
                                    width: ${parseInt(data?.[data?.selectedScreen]?.iconSize) + (data?.selectedScreen == "screenDefault" ? 0 : 10) + getIconSizeUnit(data?.[data?.selectedScreen]?.iconSize)};
                                    height: ${parseInt(data?.[data?.selectedScreen]?.iconSize) + (data?.selectedScreen == "screenDefault" ? 0 : 10) + getIconSizeUnit(data?.[data?.selectedScreen]?.iconSize)};
                                    color: ${css(data?.[data?.selectedScreen]?.iconColor)};
                                }

                              </style>
                              ${finalPlaylistControls}
                              </div>`;
              }
              const player = new Plyr(`#player-${id}-${i}`, playlistPlyrOpts);
              const playlist = new PlyrPlaylist(player, audios);

              applyMediaDefaults(
                player,
                resolvedInitialVolume,
                data?.[data?.selectedScreen]?.defaultMuted,
              );

              // PlyrPlaylist swaps the <audio> src on "ready" and on every
              // track change, which can land after applyMediaDefaults runs and
              // leave the player at full volume. Enforce the saved initial
              // volume once the first real track is loaded, then stop so the
              // listener's own volume changes are respected.
              if (
                resolvedInitialVolume !== undefined &&
                resolvedInitialVolume !== null &&
                resolvedInitialVolume !== ""
              ) {
                const targetVol = Math.max(
                  0,
                  Math.min(1, (parseInt(resolvedInitialVolume) || 0) / 100),
                );
                let initialVolApplied = false;
                const enforceInitialVolume = () => {
                  if (initialVolApplied) return;
                  const media = player.media;
                  if (!media) return;
                  try {
                    player.volume = targetVol;
                    media.volume = targetVol;
                  } catch (e) {}
                  initialVolApplied = true;
                };
                player.on("ready", () => setTimeout(enforceInitialVolume, 0));
                player.on("loadedmetadata", enforceInitialVolume);
                player.on("canplay", enforceInitialVolume);
                player.on("playing", enforceInitialVolume);
              }
            } else if (
              (data?.playerType === "single-audio" &&
                data?.selectedScreen == "screenOne") ||
              data?.selectedScreen == "screenTwo"
            ) {
              audio.innerHTML = `<div><div>${styles}</div><div> ${modalElementString}<div>`;
              let finalControls = item?.controls || "";
              // Volume off: strip it from the markup, whatever the API sent
              // (older API versions always include it). Volume on: add one
              // only to legacy markup that lacks it.
              const singleVolumeEnabled = isVolumeOn(
                selectedScreenData?.controls,
              );
              if (!singleVolumeEnabled) {
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = finalControls;
                tempDiv
                  .querySelectorAll(
                    '.volume-container, [data-plyr="mute"], [data-plyr="volume"]',
                  )
                  .forEach((el) =>
                    (el.closest(".volume-container") || el).remove(),
                  );
                finalControls = tempDiv.innerHTML;
              } else if (!finalControls.includes("volume-container")) {
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = finalControls;
                const controlsDiv =
                  tempDiv.querySelector(".controls") ||
                  tempDiv.querySelector(".media-buttons");
                if (controlsDiv) {
                  const volDiv = document.createElement("div");
                  volDiv.className = "volume-container";
                  volDiv.innerHTML = `<button type="button" class="plyr__control media-button" aria-label="Mute" data-plyr="mute" style="width: 30px; height: 30px; padding: 4px; color: inherit;"><svg class="icon--pressed" role="presentation" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg><svg class="icon--not-pressed" role="presentation" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg><span class="label--pressed plyr__tooltip" role="tooltip">Unmute</span><span class="label--not-pressed plyr__tooltip" role="tooltip">Mute</span></button><div class="plyr__volume"><input data-plyr="volume" type="range" min="0" max="1" step="0.05" value="1" autocomplete="off" aria-label="Volume"></div>`;
                  controlsDiv.appendChild(volDiv);
                  finalControls = tempDiv.innerHTML;
                }
              }

              // Skin Two: older API versions send a Font Awesome pause icon
              // that renders larger than the play icon. Swap in the matching
              // 16×16 one (same as ScreenTwo.js now ships).
              if (
                finalControls.includes(
                  'class="pause-icon" viewBox="0 0 320 512"',
                )
              ) {
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = finalControls;
                tempDiv.querySelectorAll(".pause-icon").forEach((el) => {
                  el.outerHTML =
                    '<svg stroke="currentColor" class="pause-icon" fill="currentColor" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z"/></svg>';
                });
                finalControls = tempDiv.innerHTML;
              }

              const player = new Plyr(`#player-${id}-${i}`, {
                controls: `<div>
                             <style>

                              #player-${id} .plyr .controls .forward svg,
                              #player-${id} .plyr .controls .backward svg,
                              #player-${id} .volume-container button svg {
                                  width: ${parseInt(data?.[data?.selectedScreen]?.iconSize) + (data?.selectedScreen == "screenDefault" || data?.playerType == "sticky-player" ? 0 : 10) + getIconSizeUnit(data?.[data?.selectedScreen]?.iconSize)};
                                  height: ${parseInt(data?.[data?.selectedScreen]?.iconSize) + (data?.selectedScreen == "screenDefault" || data?.playerType == "sticky-player" ? 0 : 10) + getIconSizeUnit(data?.[data?.selectedScreen]?.iconSize)};
                                  color: ${css(data?.[data?.selectedScreen]?.iconColor)};
                              }

                              ${
                                data?.selectedScreen == "screenOne"
                                  ? `
                              /* Skin One: size the volume button exactly as the
                                 customize preview does (ScreenList.js), whatever
                                 inline size the API markup carries. */
                              #player-${id} .media-buttons .volume-container [data-plyr="mute"] {
                                  width: ${css(data?.screenOne?.iconSize || "40px")} !important;
                                  height: ${css(data?.screenOne?.iconSize || "40px")} !important;
                                  padding: 16px !important;
                                  box-sizing: border-box !important;
                                  flex-shrink: 0;
                              }
                              #player-${id} .media-buttons .volume-container [data-plyr="mute"] svg {
                                  width: 100% !important;
                                  height: 100% !important;
                              }`
                                  : ""
                              }

                            </style>

                            ${finalControls}</div>`,
                seekTime:
                  parseInt(data?.[data?.selectedScreen]?.seekTime) || 10,
                muted: isDefaultMuted(selectedScreenData),
                volume: initialVolumeFraction,
                storage: { enabled: false },
              });

              // Apply the saved initial volume / default-muted settings.
              applyMediaDefaults(
                player,
                data?.[data?.selectedScreen]?.initialVolume,
                data?.[data?.selectedScreen]?.defaultMuted,
              );

              /* ▶️ PLAY */
              player.on("play", () => {
                lastPlayTimestamp = Date.now();
                sendPlayOnce(player, item);
              });

              /* ⏸️ PAUSE */
              player.on("pause", () => {
                trackTime();
                lastPlayTimestamp = null;
                // sendAnalytics("pause", player, item);
              });

              /* ⏹️ ENDED */
              player.on("ended", () => {
                trackTime();
                lastPlayTimestamp = null;
                sendAnalytics("ended", player, item);
              });

              /* 🔄 SEEK */
              player.on("seeked", () => {
                lastPlayTimestamp = Date.now();
              });

              /* 🚪 PAGE CLOSE / REFRESH */
              window.addEventListener("beforeunload", () => {
                if (lastPlayTimestamp) {
                  trackTime();
                  lastPlayTimestamp = null;
                }

                if (listenedSeconds > 1) {
                  sendAnalytics("unload", player, item);
                }
              });
            } else {
              // audio.innerHTML = htmlToElement(styles);
              audio.innerHTML = `<div><div>${styles}</div><div> ${modalElementString}<div>`;

              const player = new Plyr(`#player-${id}-${i}`, {
                controls: defaultPlayerControls,
                loop: { active: defaultPlayerControls.includes("loop") },
                settings: defaultPlayerControls.includes("loop")
                  ? ["speed", "loop"]
                  : ["speed"],
                seekTime:
                  parseInt(data?.[data?.selectedScreen]?.seekTime) || 10,
                muted: isDefaultMuted(selectedScreenData),
                volume: initialVolumeFraction,
                storage: { enabled: false },
              });
              window.me = player;

              // Apply the saved initial volume / default-muted settings.
              applyMediaDefaults(
                player,
                data?.[data?.selectedScreen]?.initialVolume,
                data?.[data?.selectedScreen]?.defaultMuted,
              );

              /* ▶️ PLAY */
              player.on("play", () => {
                lastPlayTimestamp = Date.now();
                sendPlayOnce(player, item);
              });

              /* ⏸️ PAUSE */
              player.on("pause", () => {
                trackTime();
                lastPlayTimestamp = null;
                // sendAnalytics("pause", player, item);
              });

              /* ⏹️ ENDED */
              player.on("ended", () => {
                trackTime();
                lastPlayTimestamp = null;
                sendAnalytics("ended", player, item);
              });

              /* 🔄 SEEK */
              player.on("seeked", () => {
                lastPlayTimestamp = Date.now();
              });

              /* 🚪 PAGE CLOSE / REFRESH */
              window.addEventListener("beforeunload", () => {
                if (lastPlayTimestamp) {
                  trackTime();
                  lastPlayTimestamp = null;
                }

                if (listenedSeconds > 1) {
                  sendAnalytics("unload", player, item);
                }
              });
            }
          });
        });
      })
      .catch((error) => {
        console.error("Error fetching audio player data:", error);
      });
  }
}

// Auto-inject the product's assigned player(s) when the theme doesn't let the
// merchant add the Product Audio block (e.g. Prestige). Runs only on product
// pages, only if enabled, and only when no player div already exists (so it
// never doubles up on themes where the block WAS added).
function apbpAutoInjectProductPlayers() {
  try {
    if (!APBP_AUTO.enabled || !APBP_AUTO.isProduct) return;
    // Already rendered by a real block on the page — don't duplicate.
    if (document.querySelector(".html5-audio-plyr")) return;

    let ids = [];
    if (Array.isArray(APBP_AUTO.ids)) {
      ids = APBP_AUTO.ids;
    } else if (typeof APBP_AUTO.ids === "string" && APBP_AUTO.ids.trim()) {
      try {
        ids = JSON.parse(APBP_AUTO.ids);
      } catch (e) {
        ids = [];
      }
    }
    if ((!ids || !ids.length) && APBP_AUTO.legacyId) ids = [APBP_AUTO.legacyId];
    ids = (ids || [])
      .map((s) => String(s).trim())
      .filter((s) => s.length === 24);
    // De-dupe so the same player isn't rendered twice.
    ids = Array.from(new Set(ids));
    if (!ids.length) return;

    // Find where to insert: merchant selector first, then common product spots.
    const selectors = [
      APBP_AUTO.target,
      'form[action*="/cart/add"]',
      ".product-form",
      ".product__info-wrapper",
      ".product__info",
      '[id^="ProductInfo"]',
      ".shopify-section--main-product",
      'main [class*="product"]',
      "main",
    ].filter(Boolean);

    let anchor = null;
    for (const sel of selectors) {
      try {
        anchor = document.querySelector(sel);
      } catch (e) {
        anchor = null;
      }
      if (anchor) break;
    }
    if (!anchor) return;

    const wrapper = document.createElement("div");
    wrapper.className = "apbp-auto-product-players";
    wrapper.style.width = "100%";
    wrapper.style.margin = "16px 0";
    ids.forEach((id) => {
      const el = document.createElement("div");
      el.className = "html5-audio-plyr";
      el.setAttribute("data-id", id);
      el.setAttribute("data-shop", APBP_AUTO.shop || "");
      if (APBP_AUTO.productId != null) {
        el.setAttribute("data-product-id", String(APBP_AUTO.productId));
      }
      el.setAttribute("data-source", "product-metafield");
      wrapper.appendChild(el);
    });

    // Insert right after the anchor (or append if it's the container itself).
    if (
      anchor.parentNode &&
      anchor.matches('form[action*="/cart/add"], .product-form')
    ) {
      anchor.parentNode.insertBefore(wrapper, anchor.nextSibling);
    } else {
      anchor.appendChild(wrapper);
    }
  } catch (e) {
    console.warn("Audio Player by bPlugins: auto-inject failed", e);
  }
}

let audioPlayerInitStarted = false;
function waitForPlayers() {
  if (document.querySelectorAll(".html5-audio-plyr").length) {
    if (
      typeof window.Plyr !== "function" ||
      typeof window.PlyrPlaylist !== "function"
    ) {
      requestAnimationFrame(waitForPlayers);
      return;
    }
    if (audioPlayerInitStarted) return;
    audioPlayerInitStarted = true;
    initAudioPlayerWhenReady();
  } else {
    requestAnimationFrame(waitForPlayers);
  }
}

// Try to auto-inject as soon as the DOM is ready, then start the render loop.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    apbpAutoInjectProductPlayers();
    waitForPlayers();
  });
} else {
  apbpAutoInjectProductPlayers();
  waitForPlayers();
}

// Re-run injection + rendering. Rendering is idempotent (each node is guarded
// by data-apbp-rendered), and injection only adds a wrapper when missing, so
// this is safe to call repeatedly.
function apbpRefresh() {
  apbpAutoInjectProductPlayers();
  audioPlayerInitStarted = false;
  waitForPlayers();
}

// Theme editor: sections re-render on edit — re-inject/re-render for those.
document.addEventListener("shopify:section:load", apbpRefresh);
document.addEventListener("shopify:section:reorder", apbpRefresh);

// Some themes re-render the product area via AJAX (quick view, variant change,
// cart drawer), which can wipe an auto-injected player. If our injected wrapper
// disappears, put it back. Debounced so rapid DOM changes don't thrash.
if (APBP_AUTO.enabled && APBP_AUTO.isProduct && "MutationObserver" in window) {
  let apbpDebounce = null;
  const apbpObserver = new MutationObserver(() => {
    // If there is no player node on the page anymore, re-inject + re-render.
    if (document.querySelector(".html5-audio-plyr")) return;
    if (apbpDebounce) return;
    apbpDebounce = setTimeout(() => {
      apbpDebounce = null;
      apbpRefresh();
    }, 300);
  });
  const startObserver = () => {
    if (document.body)
      apbpObserver.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) startObserver();
  else document.addEventListener("DOMContentLoaded", startObserver);
}
