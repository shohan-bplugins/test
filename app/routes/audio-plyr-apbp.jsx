import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import { cors } from "remix-utils/cors";
import skinFusion from "../components/ScreenList/StickyPlayerOne";
import { screenOne } from "../components/ScreenList/ScreenList";
import { screenTwo } from "../components/ScreenList/ScreenTwo";
import playListTwo from "../components/ScreenList/PlayListTwo";
import playListOne from "../components/ScreenList/PlayListOne";
import stickySBOne from "../components/ScreenList/StickySBOne";
import {
  GENERIC_ERROR_MESSAGE,
  findAudiosInOrder,
  getShopScope,
  parseIdsParam,
  safeJson,
  sanitizeIdList,
} from "../lib/request-guards.server";

const prisma = new PrismaClient();

// Canonical control order for the default ("Skin Default") single audio
// player: the transport buttons lead, then the progress bar and times, then
// the volume/settings/download cluster. Saved controls may be stored either as
// an array of hyphenated names (["play","progress",...]) or as an object of
// camelCase flags ({ play: true, currentTime: true, ... }) depending on when
// the player was created, so normalize both shapes to one consistent, ordered
// array. Keep this in sync with CANONICAL_CONTROL_ORDER in the theme extension
// (extensions/star-audio-player/blocks/audio_player_by_bplugins_script.liquid),
// which re-sorts this response and therefore decides the storefront order.
const SINGLE_DEFAULT_CONTROL_ORDER = [
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

const toCamelCase = (name) =>
  name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

function orderSingleDefaultControls(saved) {
  if (!saved) return [];
  const has = (name) => {
    if (Array.isArray(saved)) {
      return saved.includes(name) || saved.includes(toCamelCase(name));
    }
    if (typeof saved === "object") {
      return Boolean(saved[name] ?? saved[toCamelCase(name)]);
    }
    return false;
  };
  return SINGLE_DEFAULT_CONTROL_ORDER.filter(has);
}

// Whether the Volume control is on for a saved screen. Single audio stores
// controls as an array of names (["play", "volume", ...]); playlists store an
// object of flags ({ volume: false, ... }). Unsaved screens keep volume on.
function isVolumeOn(controls) {
  if (Array.isArray(controls)) return controls.includes("volume");
  if (controls && typeof controls === "object")
    return controls.volume !== false;
  return true;
}

const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  headers: ["Content-Type"],
};

export async function loader({ request }) {
  let data = [];
  try {
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") {
      return cors(
        request,
        new Response(null, {
          status: 204,
        }),
        corsOptions,
      );
    }

    const url = new URL(request.url);
    const filteredIds = parseIdsParam(url.searchParams.get("ids"));
    // `metafieldIds` is still sent by the storefront but no longer used (see
    // note below), so it is intentionally not parsed.

    // Optional shop scoping: only applied when a valid `shop` is sent, so
    // older extension versions that don't send it keep working unchanged.
    const shop = getShopScope(url);

    data = !filteredIds.length
      ? []
      : await prisma.audio.findMany({
          where: { id: { in: filteredIds }, ...(shop ? { shop } : {}) },
          select: {
            id: true,
            title: true,
            url: true,
            audioPlayList: true,
            mainColor: true,
            playerType: true,
            shop: true,
            screenDefault: true,
            screenOne: true,
            screenTwo: true,
            selectedScreen: true,
          },
        });

    // Product-metafield (Product Audio block) players are available on all
    // plans — no plan-based gating. `metafieldIds` is still accepted for
    // backward compatibility but no longer filters the response.

    let controls = [];

    data.map((item) => {
      if (item?.playerType === "sticky-player") {
        return controls.push({
          id: item.id,
          item,
          controls: skinFusion(
            item?.[item?.selectedScreen]?.image,
            item?.title,
            item?.url,
            { repeat: false, playlist: false, download: false },
            item?.[item?.selectedScreen]?.background,
            item?.[item?.selectedScreen]?.iconColor,
            item?.[item?.selectedScreen]?.boxShadow || [],
          ),
        });
      } else if (item?.playerType === "single-audio") {
        if (item?.selectedScreen === "screenDefault") {
          const ordered = orderSingleDefaultControls(
            item?.screenDefault?.controls,
          );

          return controls.push({
            id: item.id,
            item,
            controls: ordered.length
              ? ordered
              : item?.screenDefault?.controls || [],
          });
        } else if (item?.selectedScreen === "screenOne") {
          return controls.push({
            id: item.id,
            item,
            controls: screenOne(
              item?.screenOne?.boxShadow || [],
              isVolumeOn(item?.screenOne?.controls),
              item?.screenOne?.iconSize,
            ),
          });
        } else if (item?.selectedScreen === "screenTwo") {
          return controls.push({
            id: item.id,
            item,
            controls: screenTwo(
              item?.[item?.selectedScreen]?.image,
              item?.title,
              item?.[item?.selectedScreen]?.boxShadow || [],
              item?.[item?.selectedScreen]?.padding,
              item?.[item?.selectedScreen]?.margin,
              item?.[item?.selectedScreen]?.height,
              item?.[item?.selectedScreen]?.background,
              item?.[item?.selectedScreen]?.backgroundImage,
              {
                border: {
                  borderWidth: item?.[item?.selectedScreen]?.borderWidth,
                  borderStyle: item?.[item?.selectedScreen]?.borderStyle,
                  borderColor: item?.[item?.selectedScreen]?.borderColor,
                },
              },
              isVolumeOn(item?.[item?.selectedScreen]?.controls),
            ),
          });
        }
      } else if (item?.playerType === "playlist-audio") {
        let style = {
          iconColor: item?.[item?.selectedScreen]?.iconColor,
          mainColor: item?.mainColor,
          background: item?.[item?.selectedScreen]?.background,
          width: item?.[item?.selectedScreen]?.width,
          height: item?.[item?.selectedScreen]?.height,
          iconSize: item?.[item?.selectedScreen]?.iconSize,
          borderColor: item?.[item?.selectedScreen]?.borderColor,
          borderWidth: item?.[item?.selectedScreen]?.borderWidth,
          borderRadius: item?.[item?.selectedScreen]?.borderRadius,
          borderStyle: item?.[item?.selectedScreen]?.borderStyle,
          boxShadow: item?.[item?.selectedScreen]?.boxShadow,
          margin: item?.[item?.selectedScreen]?.margin,
          padding: item?.[item?.selectedScreen]?.padding,
        };

        // const audios = JSON.parse(item?.audioPlayList || [])?.map((au) => ({
        //   title: au?.title,
        //   artist: au?.artist || "",
        //   source: au?.url,
        //   poster: au?.poster || "",
        // }));

        const audios = JSON.parse(item?.audioPlayList || "[]").map((au) => ({
          title: au?.title,
          artist: au?.artist || "",
          source: au?.url,
          poster: au?.poster || "",
        }));

        if (item?.selectedScreen === "screenOne") {
          return controls.push({
            id: item?.id,
            item,
            controls: playListOne(audios, {
              style,
              volume: isVolumeOn(item?.screenOne?.controls),
            }),
            // controls: [item?.selectedScreen, item],
          });
        } else if (item?.selectedScreen === "screenTwo") {
          style = {
            ...style,
            shadow: item?.[item?.selectedScreen]?.boxShadow || [],
          };
          return controls.push({
            id: item.id,
            item,
            controls: playListTwo(item?.audioPlayList, audios, {
              style,
              volume: isVolumeOn(item?.screenTwo?.controls),
            }),
          });
        }
      } else if (item?.playerType === "sticky-single-button") {
        return controls.push({
          id: item.id,
          item,
          controls: stickySBOne(
            item?.title,
            item?.[item?.selectedScreen]?.sbAlign,
            item?.[item?.selectedScreen]?.selectedIconID,
            item?.[item?.selectedScreen]?.iconSize,
            // item?.[item?.selectedScreen]?.iconColor,
            item?.[item?.selectedScreen]?.backgroundColor,
            item?.[item?.selectedScreen]?.textColor,
            item?.[item?.selectedScreen]?.boxShadow,
          ),
        });
      } else {
        if (item?.selectedScreen === "screenDefault") {
          const ordered = orderSingleDefaultControls(
            item?.screenDefault?.controls,
          );

          return controls.push({
            id: item.id,
            item,
            controls: ordered.length
              ? ordered
              : item?.screenDefault?.controls || [],
          });
        } else if (item?.selectedScreen === "screenOne") {
          return controls.push({
            id: item.id,
            item,
            controls: screenOne(
              item?.screenOne?.boxShadow || [],
              isVolumeOn(item?.screenOne?.controls),
              item?.screenOne?.iconSize,
            ),
          });
        } else if (item?.selectedScreen === "screenTwo") {
          return controls.push({
            id: item.id,
            item,
            controls: screenTwo(
              item?.[item?.selectedScreen]?.image,
              item?.title,
              item?.[item?.selectedScreen]?.boxShadow || [],
              item?.[item?.selectedScreen]?.padding,
              item?.[item?.selectedScreen]?.margin,
              item?.[item?.selectedScreen]?.height,
              item?.[item?.selectedScreen]?.background,
              item?.[item?.selectedScreen]?.backgroundImage,
              {
                border: {
                  borderWidth: item?.[item?.selectedScreen]?.borderWidth,
                  borderStyle: item?.[item?.selectedScreen]?.borderStyle,
                  borderColor: item?.[item?.selectedScreen]?.borderColor,
                },
              },
              isVolumeOn(item?.[item?.selectedScreen]?.controls),
            ),
          });
        }
      }
    });

    const response = json(
      { controls },
      {
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    );

    return cors(request, response, corsOptions);
  } catch (error) {
    console.error("Error in audio-plyr-apbp loader:", error);
    return cors(request, json({ error: GENERIC_ERROR_MESSAGE }), corsOptions);
  }
}

export async function action({ request }) {
  const origin = request.headers.get("origin") || "";

  if (request.method === "OPTIONS") {
    return cors(
      request,
      new Response(null, {
        status: 204,
      }),
      corsOptions,
    );
  }

  const ids = sanitizeIdList(await safeJson(request, null));
  if (
    (origin?.includes(".myshopify.com") || origin?.includes(".shopify.com")) &&
    ids.length
  ) {
    try {
      const audio = await findAudiosInOrder(prisma, ids, {
        id: true,
        title: true,
        url: true,
        mainColor: true,
        shop: true,
        screenDefault: true,
        screenOne: true,
        screenTwo: true,
        selectedScreen: true,
        playerType: true,
      });

      return cors(request, json({ audio }), corsOptions);
    } catch (error) {
      console.error("Error in audio-plyr-apbp action:", error);
      return cors(request, json({ audio: [] }, { status: 500 }), corsOptions);
    }
  }

  return cors(
    request,
    json({
      message: "403 forbidden",
      audio: [],
    }),
    corsOptions,
  );
}
