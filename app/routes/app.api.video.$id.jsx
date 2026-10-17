import { PrismaClient } from "@prisma/client";
import { createHash, timingSafeEqual } from "node:crypto";
import { sanitizeVideoRecord } from "../utils/sanitize";
import { clientIp, hit, isLimited } from "../utils/rateLimit.server";

const prisma = new PrismaClient();

// The storefront calls this cross-origin from the merchant's own domain, and
// sends a JSON Content-Type on a GET — which is not a CORS-safelisted value, so
// the browser fires an OPTIONS preflight first. Remix routes any non-GET to
// `action`, so the preflight never reaches the loader below; without these
// headers on BOTH the preflight and the real response the browser drops the
// request before the player ever sees it, and every password looks wrong.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function jsonWithCors(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Brute-force protection for the password check.
//   - per visitor + video: 10 guesses per 15 minutes
//   - per visitor, all videos: 30 guesses per 15 minutes
//   - per video, all visitors: 100 WRONG guesses per hour — the cap that holds
//     even when an attacker rotates IPs / forged forwarding headers.
const PER_IP_VIDEO = { limit: 10, windowMs: 15 * 60 * 1000 };
const PER_IP = { limit: 30, windowMs: 15 * 60 * 1000 };
const PER_VIDEO_FAILURES = { limit: 100, windowMs: 60 * 60 * 1000 };

function tooManyAttempts(retryAfter) {
  return new Response(
    JSON.stringify({
      data: { success: false },
      rateLimited: true,
      retryAfter,
      message: "Too many attempts. Please try again later.",
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        ...CORS_HEADERS,
      },
    },
  );
}

// Constant-time comparison (hashing first gives both sides equal length), so
// response timing doesn't leak how much of a guess was right.
function samePassword(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export const loader = async ({ params, request }) => {
  if (request.method === "OPTIONS") return preflight();

  try {
    const url = new URL(request.url);
    const password = url.searchParams.get("password");

    // Mongo ObjectIds are 24 hex chars; anything else makes Prisma throw, which
    // used to land in the catch below and answer without CORS headers.
    if (!params.id || params.id.length !== 24) {
      return jsonWithCors({ data: { success: false } });
    }

    const ip = clientIp(request);
    const videoKey = `pw-fail:${params.id}`;
    const videoLock = isLimited(videoKey, PER_VIDEO_FAILURES);
    if (videoLock.limited) return tooManyAttempts(videoLock.retryAfter);
    const perIpVideo = hit(`pw:${ip}:${params.id}`, PER_IP_VIDEO);
    const perIp = hit(`pw:${ip}`, PER_IP);
    if (!perIpVideo.ok || !perIp.ok) {
      return tooManyAttempts(Math.max(perIpVideo.retryAfter, perIp.retryAfter));
    }

    const data = await prisma.video.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        videoType: true,
        url: true,
        poster: true,
        data: true,
      },
    });

    const stored = data?.data?.passwordProtected?.password;

    // No record, or protection switched off with no password stored: fail
    // closed rather than unlocking on an empty string.
    if (!data || !stored) {
      return jsonWithCors({ data: { success: false } });
    }

    if (samePassword(stored, password ?? "")) {
      // Sanitised like the main settings API, and the password itself is
      // never sent back — the visitor already knows it.
      const clean = sanitizeVideoRecord(data);
      if (clean?.data?.passwordProtected) {
        clean.data = {
          ...clean.data,
          passwordProtected: { ...clean.data.passwordProtected, password: null },
        };
      }
      clean.success = true;
      return jsonWithCors({ data: clean });
    }

    hit(videoKey, PER_VIDEO_FAILURES);
    return jsonWithCors({ data: { success: false } });
  } catch (error) {
    return jsonWithCors({ data: { success: false }, message: "403 forbidden" });
  }
};

export async function action({ request }) {
  // Reached by the CORS preflight too, since Remix sends every non-GET here.
  if (request.method === "OPTIONS") return preflight();

  return jsonWithCors({ message: "403 forbidden" }, 403);
}
