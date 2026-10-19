import { json } from "@remix-run/node";
import { authenticate, API_VERSION } from "../shopify.server";
import prisma from "../db.server";

const APP_HANDLE = "audio-player-by-bplugins";
const BLOCK_TYPE = `shopify://apps/${APP_HANDLE}/blocks/audio_player_by_bplugins`;

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function shopifyUrl(shop, path) {
  return `https://${shop}/admin/api/${API_VERSION}/${path}`;
}

function baseHeaders(token) {
  return {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
  };
}

async function parseResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

async function getAsset(shop, token, themeId, key) {
  // Do NOT encode the key — Shopify expects the literal slash in "templates/index.json"
  const url = `${shopifyUrl(shop, `themes/${themeId}/assets.json`)}?asset[key]=${key}`;
  const res = await fetch(url, { headers: baseHeaders(token) });
  if (!res.ok) return null;
  const data = await parseResponse(res);
  return data?.asset?.value ?? null;
}

async function putAsset(shop, token, themeId, key, value) {
  const url = shopifyUrl(shop, `themes/${themeId}/assets.json`);
  const res = await fetch(url, {
    method: "PUT",
    headers: baseHeaders(token),
    body: JSON.stringify({ asset: { key, value } }),
  });
  const data = await parseResponse(res);
  if (!res.ok) {
    const errors = data?.errors;
    const msg = errors
      ? typeof errors === "string"
        ? errors
        : JSON.stringify(errors)
      : `Shopify API error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop, accessToken } = session;

  const body = await request.formData();
  const playerId = body.get("playerId");
  const themeId = body.get("themeId");

  if (!playerId || !themeId) {
    return json({ error: "Missing playerId or themeId." }, { status: 400 });
  }

  // playerId is written into the theme and themeId into a REST path, so only
  // accept well-formed ids for a player this shop owns.
  if (!/^[a-f0-9]{24}$/i.test(String(playerId)) || !/^\d+$/.test(String(themeId))) {
    return json({ error: "Invalid playerId or themeId." }, { status: 400 });
  }
  const ownPlayer = await prisma.audio.findFirst({
    where: { id: String(playerId), shop },
    select: { id: true },
  });
  if (!ownPlayer) {
    return json({ error: "Player not found." }, { status: 404 });
  }

  try {
    // 1. Fetch the index template (JSON templates only — Online Store 2.0)
    const assetKey = "templates/index.json";
    const assetValue = await getAsset(shop, accessToken, themeId, assetKey);

    if (!assetValue) {
      return json({
        error:
          "Your theme uses Liquid templates and doesn't support programmatic block insertion. Please add the Audio Player block manually in the Theme Editor.",
      }, { status: 422 });
    }

    const template = JSON.parse(assetValue);
    const sections = template.sections || {};

    // 2. Find or create an "apps" section
    let appsSectionId = Object.keys(sections).find(
      (k) => sections[k]?.type === "apps",
    );

    if (!appsSectionId) {
      appsSectionId = `apps-${makeId()}`;
      sections[appsSectionId] = {
        type: "apps",
        blocks: {},
        block_order: [],
        settings: {},
      };
      template.sections = sections;
      template.order = [...(template.order || []), appsSectionId];
    }

    // 3. Prepend the audio player block with the player ID pre-filled
    const blockId = `audio-player-${makeId()}`;
    sections[appsSectionId].blocks[blockId] = {
      type: BLOCK_TYPE,
      settings: { id: playerId },
    };
    sections[appsSectionId].block_order = [
      blockId,
      ...(sections[appsSectionId].block_order || []),
    ];

    // 4. Save back to Shopify
    await putAsset(
      shop,
      accessToken,
      themeId,
      assetKey,
      JSON.stringify(template, null, 2),
    );

    const editorUrl = `https://${shop}/admin/themes/${themeId}/editor`;
    return json({ success: true, editorUrl });
  } catch (err) {
    console.error("[add-block]", err?.message ?? err);
    return json(
      { error: err?.message || "Failed to add block to theme." },
      { status: 500 },
    );
  }
};
