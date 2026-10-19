import { useCallback, useEffect, useState } from "react";
import { json } from "@remix-run/node";
import { Modal, TitleBar } from "@shopify/app-bridge-react";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
  useNavigate,
  useSearchParams,
} from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import "../styles/style.css";
import AudioList from "../components/AudioList/AudioList";
import PlayerTypePicker from "../components/PlayerTypePicker/PlayerTypePicker";
import { useSupport } from "../components/SupportForm/SupportProvider";

// Shops whose product metafield definitions were already created by this
// server process — creating them is only needed once, not on every load.
const definedShops = new Set();

async function ensureMetafieldDefinitions(admin, shop) {
  if (definedShops.has(shop)) return;
  const createDefinition = (definition) =>
    admin
      .graphql(
        `#graphql
      mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
            name
          }
          userErrors {
            field
            message
            code
          }
        }
      }`,
        { variables: { definition } },
      )
      .catch(() => {
        // Already exists or harmless — keep going
      });

  await Promise.all([
    createDefinition({
      name: "Audio Title",
      namespace: "audio_title",
      key: "custom",
      description: "Input a Audio Title.",
      type: "single_line_text_field",
      pin: true,
      ownerType: "PRODUCT",
    }),
    createDefinition({
      name: "Select Audio",
      namespace: "audio_player",
      key: "custom",
      description: "Add a Audio For Product Page.",
      type: "file_reference",
      pin: true,
      ownerType: "PRODUCT",
    }),
  ]);
  definedShops.add(shop);
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page")) || 1;
    const pageSize = 10;
    const skip = (page - 1) * pageSize;

    // Search + filter (server-side, so they work correctly across pages).
    const q = (url.searchParams.get("q") || "").trim();
    const type = url.searchParams.get("type") || "";
    const audioWhere = {
      shop: session?.shop,
      ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
      ...(type ? { playerType: type } : {}),
    };

    // Sort order (server-side). Values use Polaris's "<key> <direction>" format.
    const sort = url.searchParams.get("sort") || "created desc";
    const audioOrderBy =
      sort === "created asc"
        ? { createdAt: "asc" }
        : sort === "title asc"
          ? { title: "asc" }
          : sort === "title desc"
            ? { title: "desc" }
            : { createdAt: "desc" };

    // Independent queries run together instead of one after another.
    const [user, audio, totalAudio] = await Promise.all([
      prisma.Users.findUnique({
        where: { shop: session?.shop },
      }),
      prisma.audio.findMany({
        where: audioWhere,
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
        orderBy: audioOrderBy,
      }),
      prisma.audio.count({
        where: audioWhere,
      }),
      ensureMetafieldDefinitions(admin, session?.shop),
    ]);

    const totalPages = Math.ceil(totalAudio / pageSize);

    return json({
      pageSize,
      totalPages,
      page,
      totalAudio,
      q,
      type,
      sort,
      audio,
      user,
      shop: session?.shop,
    });
  } catch (error) {
    console.error("Error fetching Audios Loading:", error);
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
          // Scoped to the shop: only this shop's players can be deleted.
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
    // Shown as the "That didn't work" banner, keeping the list on screen.
    console.error("Audios action failed:", error);
    return json({ result: "pleaseTryAgain" }, { status: 500 });
  }
};

export default function Audios() {
  const openSupport = useSupport();
  const nav = useNavigation();
  const navigate = useNavigate();
  const actionData = useActionData();
  const actionFailed = actionData?.result === "pleaseTryAgain";
  const loaderData = useLoaderData();
  const user = loaderData?.user;
  const submit = useSubmit();
  const isLoading =
    (["loading", "submitting"].includes(nav.state) &&
      nav.formMethod === "POST") ||
    nav.formMethod === "PUT" ||
    nav.formMethod === "DELETE";
  const [searchParams, setSearchParams] = useSearchParams();
  const [active, setActive] = useState(false);

  // Confirm deletes once the server has actually removed the players.
  useEffect(() => {
    if (typeof actionData?.deleted !== "number") return;
    shopify.toast.show(
      actionData.deleted === 1
        ? "Audio player deleted"
        : `${actionData.deleted} audio players deleted`,
    );
  }, [actionData]);

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      // Delay slightly to ensure App Bridge Modal is ready
      const timer = setTimeout(() => {
        setActive(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  const handleModalChange = useCallback(() => {
    setActive(!active);
    if (searchParams.get("action") === "new") {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete("action");
      setSearchParams(newParams, { replace: true });
    }
  }, [active, searchParams, setSearchParams]);

  const uploadAudio = useCallback(() => {
    handleModalChange();
  });

  useEffect(() => {
    if (active) {
      shopify.modal.show("audio-type-select");
    } else {
      shopify.modal.hide("audio-type-select");
    }
  }, [active]);

  // Pagination is handled server-side via the `?page=` search param, so the
  // current page and total page count come straight from the loader.
  const page = loaderData?.page || 1;
  const totalPages = loaderData?.totalPages || 1;

  const handlePagination = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return;
    // Update the URL search param so the loader re-runs and returns the
    // requested page of audios.
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", String(newPage));
    setSearchParams(newParams);
  };

  // Search / filter / sort live inside <AudioList> using Polaris IndexFilters.

  const [selectedPlayerType, setSelectedPlayerType] = useState("single-audio");
  // Compare against all of the shop's players, not just this page's 10.
  const creditLimit = Number(user?.cardits ?? 5);
  const creditLimitReached =
    Number.isFinite(creditLimit) &&
    (loaderData?.totalAudio || 0) >= creditLimit;

  const createNewAudioPlayer = (type) => {
    return submit({ data: [selectedPlayerType] }, { method: "POST" });
  };

  return (
    <s-page inlineSize="large">
      <ui-title-bar title="My Audio Player's">
        <button onClick={() => openSupport()}>Support</button>
        <button variant="breadcrumb" onClick={() => navigate("/app")}>
          Dashboard
        </button>
      </ui-title-bar>

      <s-stack gap="base">
        {actionFailed ? (
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
        <s-stack
          direction="inline"
          justifyContent="space-between"
          alignItems="center"
          gap="base"
        >
          <s-stack gap="small-300">
            <s-heading>My Audio Players</s-heading>
            <s-text color="subdued">Manage and create new audio players</s-text>
          </s-stack>
          <s-button variant="primary" icon="plus" onClick={uploadAudio}>
            Add New Player
          </s-button>
        </s-stack>

        <AudioList
          nav={nav}
          isLoading={isLoading}
          loaderData={loaderData}
          uploadAudio={uploadAudio}
          pagination={{ page, totalPages, handlePagination }}
          submit={submit}
        />
      </s-stack>

      <Modal id="audio-type-select">
        <s-box padding="base">
          {creditLimitReached ? (
            <s-stack gap="base">
              <s-banner tone="critical" heading="Credit limit reached">
                Your current plan allows only {user?.cardits} players. Upgrade
                your plan to add more audio players.
              </s-banner>
              <s-stack direction="inline">
                <s-button
                  variant="primary"
                  onClick={() => {
                    shopify.modal.hide("audio-type-select");
                    navigate("/app/pricing");
                  }}
                >
                  Upgrade now
                </s-button>
              </s-stack>
            </s-stack>
          ) : (
            <PlayerTypePicker
              value={selectedPlayerType}
              onChange={setSelectedPlayerType}
            />
          )}
        </s-box>

        <TitleBar title="Select Audio Player Type">
          {creditLimitReached ? (
            <button
              variant="primary"
              onClick={() => {
                shopify.modal.hide("audio-type-select");
              }}
            >
              Close
            </button>
          ) : (
            <>
              <button
                variant="primary"
                onClick={() => {
                  if (selectedPlayerType !== "") {
                    createNewAudioPlayer(selectedPlayerType);
                    shopify.modal.hide("audio-type-select");
                  } else {
                    shopify.toast.show("Please select a player type.", {
                      isError: true,
                    });
                  }
                }}
                disabled={selectedPlayerType === ""}
              >
                Next
              </button>
              <button onClick={() => shopify.modal.hide("audio-type-select")}>
                Cancel
              </button>
            </>
          )}
        </TitleBar>
      </Modal>
    </s-page>
  );
}
