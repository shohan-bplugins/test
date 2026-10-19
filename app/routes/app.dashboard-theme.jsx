import { json } from "@remix-run/node";
import { authenticate, API_VERSION } from "../shopify.server";
import {
  detectAppBlockSupport,
  getMainThemeId,
  setCachedAppBlockSupport,
} from "../lib/theme-support.server";

// Theme status + media lists for the Dashboard. The theme scan reads many
// theme assets and takes seconds, so the Dashboard fetches this after the page
// is on screen (like /app/dashboard-analytics) instead of blocking the page.
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const restHeaders = {
    "X-Shopify-Access-Token": session.accessToken,
    "Content-Type": "application/json",
  };

  // Quick mode: only "does the theme accept app blocks?" — the Dashboard asks
  // this first so its top section can render without waiting for the full scan.
  if (new URL(request.url).searchParams.get("support") === "1") {
    try {
      const themeId = await getMainThemeId(session);
      if (!themeId) return json({ supportsAppBlocks: false });
      const supportsAppBlocks = await detectAppBlockSupport(
        session,
        themeId,
        async () => {
          const res = await fetch(
            `https://${session.shop}/admin/api/${API_VERSION}/themes/${themeId}/assets.json`,
            { headers: restHeaders },
          );
          const data = await res.json();
          return (data?.assets || []).map((a) => a.key);
        },
      );
      setCachedAppBlockSupport(session.shop, supportsAppBlocks);
      return json({ supportsAppBlocks });
    } catch (e) {
      console.error("App-block support check failed:", e.message);
      return json({ error: true });
    }
  }

  // 3. Get Theme Data (Theme assets REST has no GraphQL equivalent; using direct REST)
  const loadThemeInfo = async () => {
    let themeId = null;
    let appBlock = null;
    // Per-handle "is this section block placed in the theme?" map.
    const SECTION_BLOCK_HANDLES = [
      "audio_player_by_bplugins",
      "audio_player_block",
      "product_audio_player",
      "soundcloud_block",
      "spotify_block",
    ];
    let sectionBlocks = {};
    // Whether the published theme's product template accepts app blocks.
    // Vintage themes get the embed guide.
    let supportsAppBlocks = false;
    try {
      themeId = await getMainThemeId(session);

      if (themeId) {
        // Fetch asset contents; "" when missing or failed. The asset key is
        // passed with a literal slash (NOT URL-encoded) — Shopify's assets
        // endpoint rejects an encoded "%2F" and returns nothing, which would
        // make every block look "not added".
        const fetchAsset = (key) =>
          fetch(
            `https://${session.shop}/admin/api/${API_VERSION}/themes/${themeId}/assets.json?asset[key]=${key}`,
            { headers: restHeaders },
          )
            .then((r) => r.json())
            .then((d) => d?.asset?.value || "")
            .catch(() => "");

        // The theme's asset list, fetched once and shared by the block scan
        // and the support check.
        let assetKeysPromise;
        const getAssetKeys = () => {
          assetKeysPromise ??= fetch(
            `https://${session.shop}/admin/api/${API_VERSION}/themes/${themeId}/assets.json`,
            { headers: restHeaders },
          )
            .then((r) => r.json())
            .then((d) => (d?.assets || []).map((a) => a.key));
          return assetKeysPromise;
        };

        // App embed status (settings_data.json).
        const loadAppEmbed = async () => {
          const value = await fetchAsset("config/settings_data.json");
          if (!value) return;
          const blocks = JSON.parse(value)?.current?.blocks || {};
          appBlock = Object.values(blocks).find((block) =>
            block?.type?.includes(
              "shopify://apps/audio-player-by-bplugins/blocks/audio_player_by_bplugins_script",
            ),
          );
        };

        // Section blocks are stored inside the theme's JSON templates/sections,
        // so scan those assets for each block handle to report its live status.
        const loadSectionBlocks = async () => {
          try {
            const jsonKeys = (await getAssetKeys()).filter((k) =>
              /^(templates|sections)\/.*\.json$/.test(k),
            );

            // Small batches, to stay inside Shopify's REST rate limit.
            const contents = [];
            const BATCH = 4;
            for (let i = 0; i < jsonKeys.length; i += BATCH) {
              const batch = jsonKeys.slice(i, i + BATCH);
              contents.push(...(await Promise.all(batch.map(fetchAsset))));
            }
            // Theme JSON escapes the slashes in the block type, e.g.
            // "shopify:\/\/apps\/audio-player-by-bplugins\/blocks\/product_audio_player\/<uuid>".
            // Un-escape them so we can match on the real "blocks/<handle>/" path.
            const haystack = contents.join("\n").replace(/\\\//g, "/");
            SECTION_BLOCK_HANDLES.forEach((h) => {
              // Match the block TYPE ("blocks/<handle>/") rather than the plain
              // handle, because the auto-generated block id (e.g.
              // "audio_player_by_bplugins_product_audio_player_XYZ") embeds the
              // "audio_player_by_bplugins" name and would cause false positives.
              // The trailing "/" also stops "audio_player_by_bplugins" from
              // matching "audio_player_by_bplugins_script".
              // Count occurrences (not just presence) so the UI can show how many
              // times this block was added across the theme's templates/sections.
              sectionBlocks[h] = haystack.split(`blocks/${h}/`).length - 1;
            });
          } catch (e) {
            console.error("Error detecting section blocks:", e.message);
          }
        };

        const loadSupport = async () => {
          try {
            supportsAppBlocks = await detectAppBlockSupport(
              session,
              themeId,
              getAssetKeys,
            );
            setCachedAppBlockSupport(session.shop, supportsAppBlocks);
          } catch (e) {
            console.error("app-block support detect failed:", e.message);
          }
        };

        // Independent checks run together instead of one after another.
        await Promise.all([loadAppEmbed(), loadSectionBlocks(), loadSupport()]);
      }
    } catch (e) {
      console.error("Error fetching theme/asset data:", e.message);
    }
    return {
      themeId,
      appEmbed: appBlock ? appBlock.disabled : true,
      appBlock,
      sectionBlocks,
      supportsAppBlocks,
    };
  };

  // 4. Fetch Audio Files (Generic Files) + Image Files (Onboarding pickers)
  const loadFiles = async () => {
    let audioFiles = [];
    let imageFiles = [];
    const fileQuery = `query FetchFiles($query: String!) {
      files(reverse: true, first: 50, query: $query) {
        edges {
          node {
            id alt createdAt
            preview { image { url src } }
            ... on GenericFile { id url mimeType originalFileSize }
            ... on MediaImage { id preview { image { url src } } }
          }
        }
      }
    }`;
    try {
      const [audioRes, imageRes] = await Promise.all([
        admin.graphql(fileQuery, {
          variables: { query: "media_type:GenericFile" },
        }),
        admin.graphql(fileQuery, {
          variables: { query: "media_type:Image" },
        }),
      ]);
      audioFiles = (await audioRes.json())?.data?.files?.edges || [];
      imageFiles = (await imageRes.json())?.data?.files?.edges || [];
    } catch (e) {
      console.error("Error fetching files:", e.message);
    }
    return { audioFiles, imageFiles };
  };

  try {
    const [themeInfo, files] = await Promise.all([
      loadThemeInfo(),
      loadFiles(),
    ]);
    return json({ ...themeInfo, ...files });
  } catch (e) {
    // Never throw here: a fetcher error would replace the whole Dashboard
    // with the error boundary. The UI shows "Couldn't check" instead.
    console.error("Dashboard theme check failed:", e.message);
    return json({ error: true });
  }
}
