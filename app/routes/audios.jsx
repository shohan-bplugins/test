import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import {
  GENERIC_ERROR_MESSAGE,
  findAudiosInOrder,
  getShopScope,
  parseIdsParam,
  safeJson,
  sanitizeIdList,
} from "../lib/request-guards.server";
// import { cors } from "remix-utils/cors";

const prisma = new PrismaClient();

const AUDIO_SELECT = {
  id: true,
  title: true,
  url: true,
  mainColor: true,
  shop: true,
  screenDefault: true,
  screenOne: true,
  screenTwo: true,
  selectedScreen: true,
};

export async function loader({ request }) {
  let data = [];
  try {
    const url = new URL(request.url);
    const filteredIds = parseIdsParam(url.searchParams.get("ids"));

    if (filteredIds.length) {
      // Optional shop scoping: only applied when a valid `shop` is sent, so
      // older callers that don't send it keep working unchanged.
      const shop = getShopScope(url);
      data = await prisma.audio.findMany({
        where: { id: { in: filteredIds }, ...(shop ? { shop } : {}) },
        select: AUDIO_SELECT,
      });
    }
    return json({ audio: data });
  } catch (error) {
    console.error("Error in audios loader:", error);
    return json({ error: GENERIC_ERROR_MESSAGE, audio: data });
  }
}

export async function action({ request }) {
  const origin = request.headers.get("origin") || "";

  const ids = sanitizeIdList(await safeJson(request, null));
  if (
    (origin?.includes(".myshopify.com") || origin?.includes(".shopify.com")) &&
    ids.length
  ) {
    try {
      const audio = await findAudiosInOrder(prisma, ids, AUDIO_SELECT);
      return json({ audio });
    } catch (error) {
      console.error("Error in audios action:", error);
      return json({ audio: [] }, { status: 500 });
    }
  }

  return json({
    message: "403 forbidden",
    audio: [],
  });
}
