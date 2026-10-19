import { PrismaClient } from "@prisma/client";
import { sanitizeVideoRecord } from "../utils/sanitize";

const prisma = new PrismaClient();

export async function loader({ request }) {
  // Handle preflight requests
if (request.method === "OPTIONS") {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*", // ✅ allow all headers
    },
  });
}

  try {
    const url = new URL(request.url);
    let ids = [];
    try {
      ids = JSON.parse(url.searchParams.get("ids") || "[]");
    } catch {
      ids = [];
    }
    // Only well-formed ObjectIds, and a sane number of them per page.
    const filteredIds = (Array.isArray(ids) ? ids : [])
      .filter((id) => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id))
      .slice(0, 50);

    let data = await prisma.video.findMany({
      where: { id: { in: filteredIds } },
      select: {
        id: true,
        shop: true,
        title: true,
        youtube: true,
        vimeo: true,
        videoType: true,
        url: true,
        resetOnEnd: true,
        poster: true,
        autoPlay: true,
        repeat: true,
        controls: true,
        styles: true,
        options: true,
        data: true,
      },
    });

    // Clean every stored setting before it reaches a storefront, so a payload
    // saved before input sanitising existed cannot run there.
    data = data.map(sanitizeVideoRecord);

    // Hide video URLs if password-protected
    data = data.map(item => {
      if (item?.data?.passwordProtected?.enabled) {
        return {
          ...item,
          url: null,
          poster: null,
          data: {
            ...item.data,
            passwordProtected: {
              ...item.data.passwordProtected,
              password: null,
            },
          },
        };
      }
      return item;
    });

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Allow any origin
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  } catch (err) {
    console.error("video settings API error:", err);
    return new Response(JSON.stringify({ error: "Could not load player settings" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}

export async function action({ request }) {
  return new Response(JSON.stringify({ message: "403 forbidden!!", video: [] }), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
