import { Page } from "@shopify/polaris";
import { useLoaderData, useNavigate } from "@remix-run/react";

import Dashboard from "../components/Dashboard/Dashboard";
import { defer } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { rankVideosByScore } from "../utils/topPlayerScore";
import { verifyShopPlan } from "../utils/planSync.server";

// How many recent play rows the top-player highlight ranks over. It is a
// "best of" badge, not a reported figure, so bounding the scan keeps the cost
// flat as a merchant's play volume grows.
const TOP_PLAYER_SCAN_LIMIT = 5000;

// The app-block check costs four serial Admin REST hops (themes -> asset keys
// -> per-template fan-out -> settings_data.json) and it sits in the blocking
// path of every dashboard load. A merchant only changes it in the theme editor,
// so a short TTL keeps the banner accurate while taking it off most loads.
const CONFIG_TTL_MS = 60 * 1000;
const configCache = new Map(); // shop -> { config, at }

// TEMPORARY LCP diagnostics. Prints how long each branch of this loader takes
// to the server console, so a slow TTFB can be attributed to a specific query
// instead of guessed at. Remove once the dashboard is fast.
const TIMINGS = process.env.LOADER_TIMINGS !== "0";

function timed(marks, label, thenable) {
  if (!TIMINGS) return thenable;
  const start = Date.now();
  return Promise.resolve(thenable).then(
    (v) => {
      marks[label] = Date.now() - start;
      return v;
    },
    (e) => {
      marks[label] = `${Date.now() - start} (threw)`;
      throw e;
    },
  );
}

export const loader = async ({ request }) => {
  const marks = {};
  const loaderStart = Date.now();

  const authStart = Date.now();
  const { admin, session } = await authenticate.admin(request);
  marks["authenticate.admin"] = Date.now() - authStart;
  // Confirm the stored plan against Shopify billing before anything reads it.
  await verifyShopPlan(admin, session.shop);

  const shop = session.shop;
  const accessToken = session?.accessToken;

  // Run independent tasks perfectly in parallel
  const userPromise = prisma.Users.findFirst({ where: { shop } });
  const videosPromise = prisma.Video.findMany({
    where: { shop },
    select: { id: true, title: true, videoType: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const plansPromise = prisma.Plans.findMany({ orderBy: { price: "asc" } });

  // Chained off userPromise (a single indexed lookup) rather than awaited after
  // the Promise.all below — so this round trip to Shopify overlaps the rest of
  // the loader instead of adding its latency on top of the slowest branch.
  const subscriptionPromise = userPromise.then(async (u) => {
    if (!u?.chargeId) return null;
    try {
      const subResponse = await fetch(
        `https://${shop}/admin/api/2026-07/recurring_application_charges/${u.chargeId}.json`,
        {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
        },
      );
      if (!subResponse.ok) return null;
      const subData = await subResponse.json();
      return subData.recurring_application_charge ?? null;
    } catch (e) {
      console.error("Error fetching subscription in dashboard:", e);
      return null;
    }
  });

  // Total play counts for the dashboard overview: all time, today, last 7 and
  // last 30 days (each window starts at midnight local time).
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const start7 = new Date();
  start7.setDate(start7.getDate() - 7);
  start7.setHours(0, 0, 0, 0);
  const start30 = new Date();
  start30.setDate(start30.getDate() - 30);
  start30.setHours(0, 0, 0, 0);
  // A play counts as a "product page" play when the played video is assigned
  // to a product (works for existing rows), OR the page it played on contains
  // "/products/" (pageUrl for new rows, referrer as a fallback). Everything
  // else is a single video player play. Player subset = total − product.
  //
  // Everything below runs INSIDE analyticsPromise, which is streamed to the
  // client via defer() rather than awaited here. The catalog walk and the
  // videoPlay scans are the slowest work in this loader and none of it is
  // needed to paint the page, so keeping it off the critical path is what
  // decouples TTFB (and therefore LCP) from play volume and product count.
  // Deliberately separate from analyticsPromise. The KPI numbers are the
  // dashboard's LCP element (.vp-wc-kpi-value is 1.6rem/700, the largest text on the
  // page), so anything bundled with them delays LCP. The eight counts are
  // indexed and resolve in milliseconds; ranking the top player has to touch
  // every play row for the shop and never will. Streaming them separately lets
  // the tiles paint as soon as the counts land.
  const topPlayerPromise = (async () => {
    try {
      const sel = {
        videoId: true,
        videoTitle: true,
        visitorId: true,
        watchedSeconds: true,
      };
      // Capped: ranking is a "best of" highlight, not an exact figure, so a
      // bounded scan is the right trade. Without a cap this grows with a
      // merchant's traffic forever.
      let rows;
      const rowsStart = Date.now();
      try {
        rows = await prisma.videoPlay.findMany({
          where: { shop },
          select: { ...sel, ipHash: true },
          orderBy: { createdAt: "desc" },
          take: TOP_PLAYER_SCAN_LIMIT,
        });
      } catch {
        rows = await prisma.videoPlay.findMany({
          where: { shop },
          select: sel,
          orderBy: { createdAt: "desc" },
          take: TOP_PLAYER_SCAN_LIMIT,
        });
      }
      marks["3. topPlayer scan (streamed separately)"] =
        `${Date.now() - rowsStart} · ${rows.length} rows`;

      const ranked = rankVideosByScore(rows);
      if (!ranked.length) return null;
      const t = ranked[0];
      const v = await prisma.video.findUnique({
        where: { id: t.videoId },
        select: { title: true },
      });
      return {
        videoId: t.videoId,
        title: v?.title || t.title || "Untitled",
        plays: t.plays,
        unique: t.unique,
        watchSeconds: t.watchSeconds,
      };
    } catch {
      return null;
    }
  })();

  const analyticsPromise = (async () => {
    const [total, today, week, month, pTotal, pToday, pWeek, pMonth] =
      await timed(
        marks,
        "2. videoPlay counts x8 (all indexed)",
        Promise.all([
          prisma.videoPlay.count({ where: { shop } }),
          prisma.videoPlay.count({
            where: { shop, createdAt: { gte: startToday } },
          }),
          prisma.videoPlay.count({
            where: { shop, createdAt: { gte: start7 } },
          }),
          prisma.videoPlay.count({
            where: { shop, createdAt: { gte: start30 } },
          }),
          prisma.videoPlay.count({ where: { shop, isProductPage: true } }),
          prisma.videoPlay.count({
            where: {
              shop,
              isProductPage: true,
              createdAt: { gte: startToday },
            },
          }),
          prisma.videoPlay.count({
            where: { shop, isProductPage: true, createdAt: { gte: start7 } },
          }),
          prisma.videoPlay.count({
            where: { shop, isProductPage: true, createdAt: { gte: start30 } },
          }),
        ]),
      );
    return {
      total: { product: pTotal, player: total - pTotal },
      today: { product: pToday, player: today - pToday },
      week: { product: pWeek, player: week - pWeek },
      month: { product: pMonth, player: month - pMonth },
    };
  })();

  const checkAppBlockConfig = async () => {
    try {
      const response = await admin.graphql(
        `#graphql
        query getThemes {
          themes(roles: [MAIN], first: 1) {
            nodes {
              id
              name
              files(first: 250) {
                nodes {
                  filename
                }
              }
            }
          }
        }`,
      );

      const responseData = await response.json();
      const mainTheme = responseData?.data?.themes?.nodes?.[0];
      const themeId = mainTheme?.id;

      if (!themeId) {
        return {
          themeId: null,
          appEmbed: true,
          themeName: null,
          themeSupportsAppBlocks: true,
          appBlockUsage: null,
        };
      }

      const allFiles = mainTheme?.files?.nodes || [];
      const templateKeys = allFiles
        .map((f) => f.filename)
        .filter(
          (name) => name.startsWith("templates/") && name.endsWith(".json"),
        );

      let themeSupportsAppBlocks = templateKeys.length > 0;

      let appBlockUsage = null;
      let appEmbed = false;

      if (themeSupportsAppBlocks) {
        const filenamesToFetch = [...templateKeys, "config/settings_data.json"];

        const chunks = [];
        for (let i = 0; i < filenamesToFetch.length; i += 50) {
          chunks.push(filenamesToFetch.slice(i, i + 50));
        }

        let allFetchedFiles = [];
        for (const chunk of chunks) {
          const filesResponse = await admin.graphql(
            `#graphql
            query getFiles($id: ID!, $filenames: [String!]!) {
              theme(id: $id) {
                files(filenames: $filenames) {
                  nodes {
                    filename
                    body {
                      ... on OnlineStoreThemeFileBodyText {
                        content
                      }
                    }
                  }
                }
              }
            }`,
            {
              variables: {
                id: themeId,
                filenames: chunk,
              },
            },
          );

          const filesData = await filesResponse.json();
          const nodes = filesData?.data?.theme?.files?.nodes || [];
          allFetchedFiles = [...allFetchedFiles, ...nodes];
        }

        const counts = {
          product_video: 0,
          video_player_block: 0,
          video_player_by_bplugins: 0,
        };

        allFetchedFiles.forEach((file) => {
          const content = file?.body?.content;
          if (!content) return;

          if (file.filename === "config/settings_data.json") {
            try {
              const settingsJson = JSON.parse(content);
              const appEmbedBlock = Object.values(
                settingsJson?.current?.blocks || {},
              ).find(
                (block) =>
                  block.type ===
                    "6b835701-24aa-464a-b23a-f9592b0522cc/app-embed" ||
                  block.type ===
                    "shopify://apps/video-player-by-bplugins/blocks/app-embed/6b835701-24aa-464a-b23a-f9592b0522cc",
              );
              appEmbed = appEmbedBlock && !appEmbedBlock.disabled;
            } catch (e) {}
            return;
          }

          try {
            const parsed = JSON.parse(content);
            const sections = parsed?.sections || {};
            Object.values(sections).forEach((section) => {
              const blocks = section?.blocks || {};
              Object.values(blocks).forEach((block) => {
                const type = block?.type || "";
                if (type.includes("product_video")) counts.product_video++;
                else if (type.includes("video_player_block"))
                  counts.video_player_block++;
                else if (
                  type.includes("video_player_by_bplugins") &&
                  !type.includes("_script")
                )
                  counts.video_player_by_bplugins++;
              });
            });
          } catch (e) {}
        });

        appBlockUsage = counts;
      } else {
        // Just fetch settings_data.json if no blocks supported
        const filesResponse = await admin.graphql(
          `#graphql
            query getFiles($id: ID!, $filenames: [String!]!) {
              theme(id: $id) {
                files(filenames: $filenames) {
                  nodes {
                    filename
                    body {
                      ... on OnlineStoreThemeFileBodyText {
                        content
                      }
                    }
                  }
                }
              }
            }`,
          {
            variables: {
              id: themeId,
              filenames: ["config/settings_data.json"],
            },
          },
        );
        const filesData = await filesResponse.json();
        const file = filesData?.data?.theme?.files?.nodes?.[0];
        if (file?.body?.content) {
          try {
            const settingsJson = JSON.parse(file.body.content);
            const appEmbedBlock = Object.values(
              settingsJson?.current?.blocks || {},
            ).find(
              (block) =>
                block.type ===
                  "6b835701-24aa-464a-b23a-f9592b0522cc/app-embed" ||
                block.type ===
                  "shopify://apps/video-player-by-bplugins/blocks/app-embed/6b835701-24aa-464a-b23a-f9592b0522cc",
            );
            appEmbed = appEmbedBlock && !appEmbedBlock.disabled;
          } catch (e) {}
        }
      }

      const tId = themeId.split("/").pop();
      return {
        themeId: tId,
        appEmbed,
        themeName: mainTheme.name,
        themeSupportsAppBlocks,
        appBlockUsage,
      };
    } catch (e) {
      console.error("Error in checkAppBlockConfig:", e);
      return {
        themeId: null,
        appEmbed: true,
        themeName: null,
        themeSupportsAppBlocks: true,
        appBlockUsage: null,
      };
    }
  };

  // Helper function to fetch files
  async function fetchFilesByMediaType(mediaType) {
    const query = `
    #graphql
    query FetchFiles {
      files(reverse: true, first: 50, query:"${mediaType}") {
        edges {
          node {
            id
            alt
            createdAt
            preview {
              image {
                url(transform: {})
                src
              }
            }
            ... on GenericFile {
              id
              url
              mimeType
              alt
              originalFileSize
            }
            ... on MediaImage {
              id
              preview {
                image {
                  src
                }
              }
              mediaContentType
            }
            ... on ExternalVideo {
              id
              alt
              createdAt
              embedUrl
              embeddedUrl
              host
              mediaContentType
              originUrl
            }
            ... on Video {
              id
              mediaContentType
              sources {
                fileSize
                url
              }
              preview {
                image {
                  src
                }
              }
              sources {
                fileSize
                format
                mimeType
                url
              }
              filename
              originalSource {
                fileSize
                mimeType
              }
            }
          }
        }
        pageInfo {
          hasPreviousPage
          hasNextPage
          endCursor
          startCursor
        }
      }
    }
  `;
    const response = await admin.graphql(query);
    const result = await response.json();
    return {
      files: result?.data?.files?.edges || [],
      pageInfo: result?.data?.files?.pageInfo,
    };
  }

  // Only Onboarding reads the Shopify file lists, and it only mounts when the
  // store has no players yet (see Dashboard.jsx). So for every established
  // store these two Admin API round trips can be skipped outright rather than
  // waited on in the blocking path.
  const filesPromise = videosPromise.then((vids) =>
    (vids?.length || 0) > 0
      ? [null, null]
      : Promise.all([
          fetchFilesByMediaType("media_type:Video OR media_type:ExternalVideo"),
          fetchFilesByMediaType("media_type:Image"),
        ]),
  );

  const configPromise = (async () => {
    const hit = configCache.get(shop);
    if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.config;
    const cfg = await checkAppBlockConfig();
    configCache.set(shop, { config: cfg, at: Date.now() });
    return cfg;
  })();

  const [user, videos, config, allPlans, files, subscription] =
    await Promise.all([
      timed(marks, "user (mongo)", userPromise),
      timed(marks, "videos (mongo)", videosPromise),
      timed(
        marks,
        "4. app-block config (4 REST hops, cached 60s)",
        configPromise,
      ),
      timed(marks, "plans (mongo)", plansPromise),
      timed(
        marks,
        "5. shopify files (skipped if store has players)",
        filesPromise,
      ),
      timed(marks, "6. subscription (REST)", subscriptionPromise),
    ]);

  const [videoFilesData, imageFilesData] = files;

  if (TIMINGS) {
    const total = Date.now() - loaderStart;
    const rows = Object.entries(marks)
      .sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0))
      .map(([step, ms]) => ({ step, ms }));
    console.log(
      `\n\u2500\u2500 /app loader: ${total}ms total \u2500\u2500 (slowest first)`,
    );
    console.table(rows);
    console.log("This total is your TTFB. LCP cannot be faster than it.\n");
  }

  return defer({
    shop,
    apiKey: process.env.SHOPIFY_API_KEY,
    user: user || {},
    videos: videos || [],
    themeId: config.themeId,
    appEmbed: config.appEmbed,
    themeName: config.themeName,
    themeSupportsAppBlocks: config.themeSupportsAppBlocks,
    appBlockUsage: config.appBlockUsage,
    allPlans: allPlans || [],
    subscription,
    // Streamed: the dashboard renders without these and fills them in.
    analytics: analyticsPromise,
    topPlayer: topPlayerPromise,
    allFiles: [
      ...(videoFilesData?.files || []),
      ...(imageFilesData?.files || []),
    ],
    videoFiles: videoFilesData?.files || [],
    imageFiles: imageFilesData?.files || [],
    pageInfoVideo: videoFilesData?.pageInfo,
    pageInfoImage: imageFilesData?.pageInfo,
  });
};

export default function Index() {
  const loaderData = useLoaderData();
  const navigate = useNavigate();
  const apiKey = loaderData?.apiKey;

  return (
    <Page>
      <ui-title-bar title="Dashboard">
        <button onClick={() => navigate("/app/videos")} variant="primary">
          Manage Video
        </button>
      </ui-title-bar>
      {/* Server-rendered: the dashboard paints with the HTML instead of waiting
          for the client bundle to download and hydrate. The one part that needs
          App Bridge at render time (Onboarding) is wrapped in ClientOnly inside
          Dashboard itself. */}
      <Dashboard loaderData={loaderData} apiKey={apiKey} />
    </Page>
  );
}
