import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import { cors } from "remix-utils/cors";
import {
  GENERIC_ERROR_MESSAGE,
  isObjectId,
  isShopDomain,
  truncate,
} from "../lib/request-guards.server";

const prisma = new PrismaClient();

// Max analytics events accepted per client IP per day. High enough that real
// listeners (several events per play, many plays per day) are never cut off.
// Per visitor IP, per shop, per day. Generous so shared IPs (offices, mobile
// carrier NAT) never lose real plays; it only stops scripted flooding.
const MAX_EVENTS_PER_IP_PER_DAY = 2000;
const MAX_STRING_LENGTH = 500;
const MAX_USER_AGENT_LENGTH = 1000;
const MAX_INT = 2147483647;

function toStr(value, max = MAX_STRING_LENGTH) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return truncate(String(value), max);
}

function toInt(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(MAX_INT, Math.max(0, Math.round(n)));
}

// Builds the Analytics row from an explicit allowlist of the fields the
// storefront sends. id / ipAddress / country / calledAt are never taken from
// the client. Returns null when the event should be dropped.
function buildAnalyticsData(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (!isShopDomain(body.shop)) return null;
  if (!isObjectId(body.audioId)) return null;

  const data = {
    sessionId: toStr(body.sessionId),
    audioId: body.audioId,
    shop: body.shop,
    event: toStr(body.event),
    duration: toInt(body.duration),
    currentTime: toInt(body.currentTime),
    totalDuration: toInt(body.totalDuration),
    userAgent: toStr(body.userAgent, MAX_USER_AGENT_LENGTH),
    device: toStr(body.device),
    browser: toStr(body.browser),
  };
  // Drop undefined keys so Prisma applies its normal required/optional rules.
  for (const key of Object.keys(data)) {
    if (data[key] === undefined) delete data[key];
  }
  return data;
}

/* 🟢 LOADER MUST ALLOW PREFLIGHT */
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return cors(request, new Response(null, { status: 204 }));
  }

  return cors(
    request,
    json(
      {
        success: false,
        message: "Forbidden",
      },
      { status: 403 },
    ),
  );
}

export async function action({ request }) {
  function getIP(request) {
    const ip =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "Unknown";
    return truncate(ip, 100);
  }

  function getCountry(request) {
    const code =
      request.headers.get("cf-ipcountry") ||
      request.headers.get("x-vercel-ip-country") ||
      null;
    if (!code) return null;
    const trimmed = code.trim().toUpperCase();
    if (!trimmed || trimmed === "XX" || trimmed === "T1") return null;
    return trimmed;
  }

  async function checkIpLimit(ip, shop) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const count = await prisma.analytics.count({
      where: {
        ipAddress: ip,
        shop,
        calledAt: { gte: today },
      },
    });

    return count >= MAX_EVENTS_PER_IP_PER_DAY;
  }

  async function shopIsPaid(shop) {
    if (!shop) return false;
    const user = await prisma.Users.findUnique({
      where: { shop },
      select: { planId: true },
    });
    if (!user?.planId) return false;
    const plan = await prisma.Plans.findUnique({
      where: { id: user.planId },
      select: { name: true },
    });
    return !!plan && plan.name !== "Free";
  }

  try {
    let body = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const analyticsData = buildAnalyticsData(body);
    if (!analyticsData) {
      // Invalid / unrecognised event: silently drop it with the normal
      // success response so the storefront behaves exactly as before.
      return cors(request, json({ success: true }, { status: 200 }));
    }

    // if (!(await shopIsPaid(body?.shop))) {
    //   return cors(
    //     request,
    //     json({ success: true, skipped: "free-plan" }, { status: 200 }),
    //   );
    // }

    const ip = getIP(request);

    // "Unknown" means no proxy IP header was present; don't lump every such
    // request into one shared bucket (that would cut off real listeners).
    if (ip !== "Unknown" && (await checkIpLimit(ip, analyticsData.shop))) {
      return cors(
        request,
        json(
          {
            success: false,
            message: "IP limit reached",
          },
          { status: 429 },
        ),
      );
    }

    const country = getCountry(request);

    await prisma.analytics.create({
      data: {
        ...analyticsData,
        ipAddress: ip,
        country,
      },
    });

    return cors(
      request,
      json(
        {
          success: true,
        },
        { status: 200 },
      ),
    );
  } catch (error) {
    console.error("Error in audio-analytics action:", error);
    return cors(
      request,
      json(
        {
          success: false,
          error: GENERIC_ERROR_MESSAGE,
        },
        { status: 500 },
      ),
    );
  }
}
