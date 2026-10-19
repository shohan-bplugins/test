import { json, redirect } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
  Link,
  useNavigate,
} from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import "../styles/style.css";
import Dashboard from "../components/Dashboard/Dashboard";
import { getCachedAppBlockSupport } from "../lib/theme-support.server";
import { useSupport } from "../components/SupportForm/SupportProvider";

export const loader = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);

    if (!session) {
      return redirect("/auth");
    }

    const planDataPromise = prisma.plans.findMany();
    // Fetch DB Data
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page")) || 1;
    const pageSize = 10;
    const skip = (page - 1) * pageSize;

    let charge = [],
      user = [],
      audio = [],
      totalAudio = 0;
    try {
      const results = await Promise.all([
        prisma.Charges.findMany({ where: { shop: session.shop } }),
        prisma.Users.findMany({ where: { shop: session.shop } }),
        prisma.audio.findMany({
          where: { shop: session.shop },
          skip,
          take: pageSize,
          select: {
            id: true,
            title: true,
            url: true,
            audioPlayList: true,
            shop: true,
            playerType: true,
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.audio.count({ where: { shop: session.shop } }),
      ]);
      charge = results[0];
      user = results[1];
      audio = results[2];
      totalAudio = results[3];
    } catch (e) {
      console.error("Error fetching database data:", e.message);
    }

    const planData = await planDataPromise;
    const totalPages = Math.ceil(totalAudio / pageSize);

    return json({
      pageSize,
      totalPages,
      page,
      totalAudio,
      audio,
      user: user[0] || { cardits: 5, plan: "Free" },
      charges: charge,
      shop: session.shop,
      planData,
      // Last known theme app-block support (null = not checked yet), so the
      // Dashboard's top section renders on first paint.
      supportsAppBlocks: getCachedAppBlockSupport(session.shop),
      apiKey: process.env.SHOPIFY_API_KEY,
    });
  } catch (error) {
    // Thrown so the app's error page (with Try again) shows, instead of an
    // empty Dashboard. Never send error details / stack to the browser.
    console.error("Critical loader error:", error);
    throw error;
  }
};

const ALLOWED_PLAYER_TYPES = [
  "single-audio",
  "playlist-audio",
  "sticky-player",
  "sticky-single-button",
];

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const body = await request.formData();

  const data = body.get("data");
  const ob_title = body.get("ob_title");
  const ob_url = body.get("ob_url");
  const ob_mainColor = body.get("ob_mainColor");
  const ob_loop = body.get("ob_loop");
  const ob_tracks = body.get("ob_tracks");
  const ob_stickyPosition = body.get("ob_stickyPosition");
  const ob_btnLabel = body.get("ob_btnLabel");
  const ob_btnColor = body.get("ob_btnColor");
  const ob_btnPosition = body.get("ob_btnPosition");
  const ob_imageUrl = body.get("ob_imageUrl");
  try {
    const screens = await prisma.screen.findMany({});

    if (!session?.shop) {
      throw new Error("Shop not found");
    }

    let createAudio;
    if (request.method === "POST") {
      const screen = {};

      // Server-side checks: the UI hides these options, but a crafted request
      // must not create unknown player types or go past the plan's limit.
      const requestedType = data?.split(",")?.[0];
      if (requestedType && !ALLOWED_PLAYER_TYPES.includes(requestedType)) {
        return json({ result: "pleaseTryAgain" });
      }
      if (requestedType) {
        const owner = await prisma.Users.findFirst({
          where: { shop: session.shop },
        });
        const limit = Number(owner?.cardits) || 5; // same fallback the dashboard UI uses
        const used = await prisma.audio.count({ where: { shop: session.shop } });
        if (used >= limit) {
          return json({
            result: "pleaseTryAgain",
            error: `You've reached your plan limit of ${limit} players. Upgrade to add more.`,
          });
        }
      }

      if (data?.split(",")?.[0]) {
        let audio = {
          shop: session?.shop,
          title: "Single Audio Player",
          url: "",
          mainColor: "#00b3ff",
          playerType: data?.split(",")?.[0],
          screenOne: {
            ...screens[0],
            padding: "10px",
            margin: "20px",
            boxShadow: [
              {
                hOffset: "0px",
                vOffset: "0px",
                blur: 10,
                spreed: 1,
                color: "#ffbf75",
                isInset: false,
              },
            ],
          },
          screenTwo: {
            ...screens[1],
            padding: "10px",
            margin: "20px",
            image:
              "https://cdn.shopify.com/s/files/1/0700/1758/1253/files/Screenshot_1.png?v=174652019000",
            backgroundImage:
              "https://cdn.shopify.com/s/files/1/0700/1758/1253/files/download_1.png?v=1745121132",
          },
          screenDefault: screens[2],
          selectedScreen: "screenDefault",
        };
        if (data?.split(",")?.[0] === "playlist-audio") {
          audio = {
            ...audio,
            title: "Playlist Audio Player",
            audioPlayList: JSON.stringify([
              {
                id: 1,
                title: "",
                url: "",
                poster:
                  "https://placehold.co/500x500/15803d/fff/svg?text=Placeholder+Image\n+\nAudio+Player\nby+bPlugins&font=roboto",
                artist: "Artist Name",
                screen: "screenTwo",
                content: "Feel this song",
              },
            ]),
            screenOne: {
              ...screens[0],
              background: "#000000",
              iconColor: "#ffffff",
              width: "600px",
              height: "100%",
              padding: "20px",
              iconSize: "24px",
            },
            screenTwo: {
              ...screens[1],
              background: "#071739",
              iconColor: "#0000000",
              height: "100%",
              boxShadow: [
                {
                  hOffset: "0px",
                  vOffset: "0px",
                  blur: 10,
                  spreed: 1,
                  color: "#071739",
                  isInset: false,
                },
              ],
            },
            mainColor: "#00b3ff",
            selectedScreen: "screenOne",
          };
        } else if (data?.split(",")?.[0] === "sticky-player") {
          audio = {
            ...audio,
            selectedScreen: "screenOne",
            title: "Sticky Audio Player",
            screenOne: {
              ...screens[0],
              iconSize: "24px",
              width: "100%",
              image:
                "http://apps.bplugins.com/wp-content/uploads/2026/01/download.png",
              background: "#000000",
              iconColor: "#ffffff",
            },
          };
        } else if (data?.split(",")?.[0] === "sticky-single-button") {
          audio = {
            ...audio,
            selectedScreen: "screenDefault",
            title: "Single Button Audio Player",
            screenDefault: {
              ...screens[2],
              iconSize: "24px",
              boxShadow: [
                {
                  hOffset: "0px",
                  vOffset: "0px",
                  blur: 10,
                  spreed: "0px",
                  color: "#adadad",
                  isInset: false,
                },
              ],
              sbAlign: "bottom-left",
              backgroundColor:
                "linear-gradient(to bottom right, #B388FF, #FF8A80)",
              textColor: "#FFFFFF",
              selectedIconID: 6,
              selectionType: "preset",
              selectedPreset: 3,
              messageShowDelay: "3px",
              showMessage: true,
            },
          };
        }
        // Apply onboarding values if provided
        if (ob_title) audio.title = ob_title;
        if (ob_url) audio.url = ob_url;
        if (ob_mainColor) audio.mainColor = ob_mainColor;
        if (ob_loop !== null) {
          audio.screenDefault = {
            ...audio.screenDefault,
            loop: ob_loop === "true",
          };
          if (audio.screenOne)
            audio.screenOne = { ...audio.screenOne, loop: ob_loop === "true" };
        }
        if (ob_tracks && audio.playerType === "playlist-audio") {
          const parsedTracks = JSON.parse(ob_tracks);
          audio.audioPlayList = JSON.stringify(
            parsedTracks.map((tr, i) => ({
              id: i + 1,
              title: tr.title || `Track ${i + 1}`,
              url: tr.url || "",
              poster:
                "https://placehold.co/500x500/15803d/fff/svg?text=Placeholder+Image%0A%0AAudio+Player%0Aby+bPlugins&font=roboto",
              artist: "Artist Name",
              screen: "screenTwo",
              content: "",
            })),
          );
        }
        if (ob_stickyPosition && audio.playerType === "sticky-player") {
          audio.screenOne = { ...audio.screenOne, position: ob_stickyPosition };
        }
        if (ob_btnPosition && audio.playerType === "sticky-single-button") {
          audio.screenDefault = {
            ...audio.screenDefault,
            sbAlign: ob_btnPosition,
          };
        }
        if (ob_btnColor && audio.playerType === "sticky-single-button") {
          audio.mainColor = ob_btnColor;
        }
        if (ob_imageUrl && audio.playerType === "sticky-player") {
          audio.screenOne = { ...audio.screenOne, image: ob_imageUrl };
        }

        // Onboarding single-audio: use screenOne so the storefront renders
        // the rich custom skin instead of the bare screenDefault Plyr player.
        if (
          audio.playerType === "single-audio" &&
          body.get("preventRedirect") === "true"
        ) {
          audio.selectedScreen = "screenOne";
        }

        createAudio = await prisma.audio.create({
          data: audio,
        });

        const audioCount = await prisma.audio.findMany({
          where: { shop: session?.shop },
        });

        const shopResponse = await admin.graphql(
          `#graphql
          query ShopDetails {
            shop {
              id
              email
              shopOwnerName
              myshopifyDomain
              primaryDomain { host }
              billingAddress {
                address1
                address2
                phone
                country
              }
              createdAt
              plan { displayName }
            }
          }`,
        );
        const shopJson = await shopResponse.json();
        const shopGql = shopJson?.data?.shop ?? {};

        fetch(
          "https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287",
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify([
              {
                type: `app.created_player_${Number(audioCount?.length) || 1}`,
                app_name: "audio-player",
                app_full_name: "Audio Player by bPlugins",
                app_slug: "html5-audio-player",
                success: true,
                shop: session?.shop,
                user_id: session?.id,
                install_id: "",
                data: {
                  name: shopGql?.shopOwnerName || "",
                  email: shopGql?.email || "",
                  country_name: shopGql?.billingAddress?.country || "",
                  address1: shopGql?.billingAddress?.address1 || "",
                  address2: shopGql?.billingAddress?.address2 || "",
                  phone: shopGql?.billingAddress?.phone || "",
                  created_at: shopGql?.createdAt || "",
                  domain: shopGql?.primaryDomain?.host || session?.shop,
                  myshopify_domain: shopGql?.myshopifyDomain || "",
                  plan_display_name: shopGql?.plan?.displayName || "",
                },
                id: session?.id,
                created: new Date()
                  .toISOString()
                  .slice(0, 19)
                  .replace("T", " "),
                objects: {
                  user: {
                    email: shopGql?.email,
                  },
                },
              },
            ]),
          },
        );

        if (body.get("preventRedirect") === "true") {
          return json({ success: true, id: createAudio?.id });
        }
        return redirect(
          `/app/customize/${createAudio?.id}/${data?.split(",")?.[0]}`,
        );
      }

      return json({ result: "pleaseTryAgain" });
    } else if (request.method === "DELETE") {
      const audioIds = JSON.parse(body.get("audioList"));
      const shop = session?.shop;

      if (audioIds?.length > 0) {
        // Remove the players and any analytics collected for them.
        const [result] = await prisma.$transaction([
          prisma.audio.deleteMany({
            where: { id: { in: audioIds }, shop },
          }),
          prisma.analytics.deleteMany({
            where: { shop, audioId: { in: audioIds } },
          }),
        ]);
        return json({ deleted: result.count });
      } else {
        const audioId = body.get("data");
        // Scoped to the shop: a player id from another shop deletes nothing.
        const [result] = await prisma.$transaction([
          prisma.audio.deleteMany({
            where: { id: audioId, shop },
          }),
          prisma.analytics.deleteMany({
            where: { shop, audioId },
          }),
        ]);
        return json({ deleted: result.count });
      }
    }
  } catch (error) {
    // Shown as the "Please try again" banner (or the onboarding error toast)
    // instead of replacing the whole Dashboard with an error page.
    console.error("Dashboard action failed:", error);
    return json({ result: "pleaseTryAgain" }, { status: 500 });
  }
};

export default function Index() {
  const openSupport = useSupport();
  const nav = useNavigation();
  const navigate = useNavigate();
  const actionData = useActionData();
  const loaderData = useLoaderData();
  const isLoading =
    (["loading", "submitting"].includes(nav.state) &&
      nav.formMethod === "POST") ||
    nav.formMethod === "PUT" ||
    nav.formMethod === "DELETE";

  return (
    <s-page inlineSize="large">
      <ui-title-bar title="Audio Player by bPlugins">
        <button onClick={() => openSupport()}>Support</button>
        <button onClick={() => navigate("/app/audios")} variant="primary">
          Manage Players
        </button>
      </ui-title-bar>
      <s-stack gap="base">
        {/* A failed create/delete keeps the Dashboard on screen. */}
        {actionData?.result === "pleaseTryAgain" ? (
          <s-banner tone="critical" heading="That didn't work">
            <s-stack gap="small">
              <s-paragraph>
                Your change wasn't saved. Please try again — if it keeps
                happening, contact support.
              </s-paragraph>
              <s-stack direction="inline">
                <s-button onClick={() => openSupport()}>
                  Contact support
                </s-button>
              </s-stack>
            </s-stack>
          </s-banner>
        ) : null}
        <Dashboard
          loaderData={loaderData}
          apiKey={loaderData.apiKey}
          isLoading={isLoading}
        />
      </s-stack>
    </s-page>
  );
}
