import { json } from "@remix-run/node";
import { PrismaClient } from "@prisma/client";
import { cors } from "remix-utils/cors";

const prisma = new PrismaClient();

export async function loader({ request }) {
  let data = [];
  try {
    const origin = request.headers.get("origin") || "";
    const url = new URL(request.url);

    const shop = url.searchParams.get("shop"); // get shop directly

    if (!shop) {
      return json(
        { error: "Missing shop parameter", audio: [] },
        { status: 400 },
      );
    }

    const data = await prisma.Users.findUnique({
      where: { shop },
      select: {
        id: true,
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

    const userType = plan?.name === "Free" ? "free" : "premium";

    const response = json({ userType: plan ? userType : "free" });
    return cors(request, response);
  } catch (error) {
    return json({ error: error, audio: data });
  }

  return json({
    message: "403 forbidden",
    audio: [],
  });
}

export async function action({ request }) {
  return json({
    message: "403 forbidden",
    audio: [],
  });
}
