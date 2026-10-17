import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import { cors } from "remix-utils/cors";
import {
  GENERIC_ERROR_MESSAGE,
  findAudiosInOrder,
  isShopDomain,
  safeJson,
  sanitizeIdList,
} from "../lib/request-guards.server";

const prisma = new PrismaClient();

export async function loader({ request }) {
  try {
    const url = new URL(request.url);

    const shop = url.searchParams.get("shop"); // get shop directly

    if (!shop) {
      return json(
        { error: "Missing shop parameter", audio: [] },
        { status: 400 },
      );
    }

    // A shop that isn't a myshopify domain can never match a Users row, which
    // previously resolved to "free" — return that directly without querying.
    if (!isShopDomain(shop)) {
      return cors(request, json({ userType: "free" }));
    }

    const data = await prisma.Users.findUnique({
      where: { shop },
      select: {
        id: true,
        cardits: true,
        planId: true,
        shop: true,
      },
    });
    let plan = null;
    if (data?.planId) {
      plan = await prisma.Plans.findUnique({
        where: { id: data?.planId },
        select: {
          id: true,
          name: true,
        },
      });
    }

    const userType =
      plan?.name !== "Free" && data?.cardits > 5 ? "premium" : "free";

    const response = json({ userType: plan ? userType : "free" });
    return cors(request, response);
  } catch (error) {
    console.error("Error in api.user loader:", error);
    return json({ error: GENERIC_ERROR_MESSAGE, audio: [] });
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
      });
      return json({ audio });
    } catch (error) {
      console.error("Error in api.user action:", error);
      return json({ audio: [] }, { status: 500 });
    }
  }

  return json({
    message: "403 forbidden",
    audio: [],
  });
}
