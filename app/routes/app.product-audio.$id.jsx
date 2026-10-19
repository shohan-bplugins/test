import React, { useEffect, useState } from "react";
import { json } from "@remix-run/node";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import Modal from "../components/PolarisWeb/WebModal";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import AudioUploadModal from "../components/AudioUploadModal/AudioUploadModal";
import PlayerTypePicker, {
  PLAYER_TYPE_ICON,
  playerTypeLabel,
} from "../components/PlayerTypePicker/PlayerTypePicker";
import {
  WebCheckbox,
  WebChangeField,
  WebSearchField,
  WebTextField,
} from "../components/PolarisWeb/fields";
import HowItWorksSteps from "../components/ProductAudio/HowItWorksSteps";
import YouTubeModal from "../components/YouTubeModal/YouTubeModal";
import "../styles/styles.css";
import "../styles/product-audio.css";
import { useSupport } from "../components/SupportForm/SupportProvider";
import { showModal } from "../utils/modal";
import { maybeAskForReview } from "../utils/reviewPrompt";

const NS = "audio_player_by_bplugins";
const KEY_ASSIGNED_ID = "assigned_audio_id";
const KEY_ASSIGNED_IDS = "assigned_audio_ids";

// App theme color + on-brand quick-pick swatches for the setup modal.
const THEME_COLOR = "#1a8d5a";
const COLOR_PRESETS = [
  "#1a8d5a",
  "#00b3ff",
  "#7c3aed",
  "#f59e0b",
  "#ef4444",
  "#111827",
];

// Ordered audio IDs for a product: prefer the multi-value list metafield,
// fall back to the legacy single-value metafield.
function resolveAssignedIds(listValue, legacyValue) {
  const isValid = (v) => typeof v === "string" && v.length === 24;
  if (typeof listValue === "string" && listValue.length) {
    try {
      const arr = JSON.parse(listValue);
      if (Array.isArray(arr)) return arr.filter(isValid);
    } catch {
      // fall through to legacy
    }
  }
  if (isValid(legacyValue)) return [legacyValue];
  return [];
}

export const loader = async ({ params, request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const productGid = `gid://shopify/Product/${params.id}`;

  const [productRes, user] = await Promise.all([
    admin.graphql(
      `#graphql
        query ProductDetail($id: ID!) {
          product(id: $id) {
            id
            title
            handle
            status
            onlineStoreUrl
            featuredImage { url altText }
            assignedList: metafield(namespace: "${NS}", key: "${KEY_ASSIGNED_IDS}") {
              id value
            }
            assigned: metafield(namespace: "${NS}", key: "${KEY_ASSIGNED_ID}") {
              id value
            }
          }
          shop { primaryDomain { url } }
        }`,
      { variables: { id: productGid } },
    ),
    prisma.Users.findFirst({ where: { shop } }),
  ]);

  const data = await productRes.json();
  const product = data?.data?.product ?? null;
  const shopDomain = data?.data?.shop?.primaryDomain?.url ?? null;

  const assignedIds = resolveAssignedIds(
    product?.assignedList?.value,
    product?.assigned?.value,
  );

  const audios = await prisma.audio.findMany({
    where: { shop },
    select: { id: true, title: true, playerType: true },
    orderBy: { createdAt: "desc" },
  });
  const audioById = Object.fromEntries(audios.map((a) => [a.id, a]));

  // Ordered list of assigned players; ids with no matching player are "missing".
  const assignedAudios = assignedIds.map((id) => {
    const found = audioById[id];
    return {
      id,
      title: found?.title ?? null,
      playerType: found?.playerType ?? null,
      missing: !found,
    };
  });

  // Store audio files (GenericFile) for the audio-select modal in the setup flow.
  const audioFiles = await fetchGenericFiles(admin);

  return json({
    product,
    shopDomain,
    assignedIds,
    assignedAudios,
    cardits: user?.cardits ?? 5,
    audioCount: audios.length,
    audios,
    audioFiles,
  });
};

// Fetch the shop's uploaded audio files (Shopify Files / GenericFile) for the
// "select audio" modal. Mirrors the query used on the customize pages.
async function fetchGenericFiles(admin) {
  try {
    const response = await admin.graphql(
      `#graphql
        query FetchAudioFiles {
          files(reverse: true, first: 50, query: "media_type:GenericFile") {
            edges {
              node {
                id
                alt
                createdAt
                preview { image { url(transform: {}) src } }
                ... on GenericFile {
                  id
                  url
                  mimeType
                  alt
                  originalFileSize
                }
              }
            }
            pageInfo { hasPreviousPage hasNextPage endCursor startCursor }
          }
        }`,
    );
    const result = await response.json();
    return {
      files: result?.data?.files?.edges || [],
      pageInfo: result?.data?.files?.pageInfo ?? {},
    };
  } catch {
    return { files: [], pageInfo: {} };
  }
}

// Read the product's current ordered assigned audio IDs from its metafields.
async function fetchAssignedIds(admin, productGid) {
  const res = await admin.graphql(
    `#graphql
      query ProductAssigned($id: ID!) {
        product(id: $id) {
          assignedList: metafield(namespace: "${NS}", key: "${KEY_ASSIGNED_IDS}") {
            value
          }
          assigned: metafield(namespace: "${NS}", key: "${KEY_ASSIGNED_ID}") {
            value
          }
        }
      }`,
    { variables: { id: productGid } },
  );
  const j = await res.json();
  const p = j?.data?.product;
  return resolveAssignedIds(p?.assignedList?.value, p?.assigned?.value);
}

// Persist the ordered list metafield and drop the legacy single key so there is
// one source of truth. Returns an array of userErrors (empty on success).
async function writeAssignedIds(admin, productGid, ids) {
  const deleteMetafields = async (keys) => {
    const delRes = await admin.graphql(
      `#graphql
        mutation MetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields { key }
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: keys.map((key) => ({
            ownerId: productGid,
            namespace: NS,
            key,
          })),
        },
      },
    );
    const j = await delRes.json();
    return j?.data?.metafieldsDelete?.userErrors ?? [];
  };

  if (ids.length === 0) {
    return deleteMetafields([KEY_ASSIGNED_IDS, KEY_ASSIGNED_ID]);
  }

  const setRes = await admin.graphql(
    `#graphql
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: productGid,
            namespace: NS,
            key: KEY_ASSIGNED_IDS,
            type: "list.single_line_text_field",
            value: JSON.stringify(ids),
          },
        ],
      },
    },
  );
  const setJson = await setRes.json();
  const errs = setJson?.data?.metafieldsSet?.userErrors ?? [];
  if (errs.length) return errs;

  // Best-effort cleanup of the legacy single key (no-op if absent).
  await deleteMetafields([KEY_ASSIGNED_ID]);
  return [];
}

// Unexpected failures come back as the page's normal error toast instead of
// replacing the product page with an error screen.
export const action = async (args) => {
  try {
    return await handleAction(args);
  } catch (error) {
    if (error instanceof Response) throw error; // auth / redirects
    console.error("Product audio action failed:", error);
    return json(
      {
        ok: false,
        error:
          "Something went wrong and your change wasn't saved. Please try again.",
      },
      { status: 500 },
    );
  }
};

const handleAction = async ({ params, request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";

  const productGid = `gid://shopify/Product/${params.id}`;
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "remove") {
    const audioId = String(fd.get("audioId") ?? "").trim();
    const current = await fetchAssignedIds(admin, productGid);
    // With an audioId, drop just that one; without, clear all (back-compat).
    const next = audioId ? current.filter((id) => id !== audioId) : [];
    const errs = await writeAssignedIds(admin, productGid, next);
    if (errs.length)
      return json({
        ok: false,
        error: errs.map((e) => e.message).join("; "),
      });
    return json({ ok: true, message: "Audio player removed from product." });
  }

  if (intent === "assign_existing") {
    const requested = fd
      .getAll("audioId")
      .map((v) => String(v).trim())
      .filter(Boolean);
    if (!requested.length)
      return json({ ok: false, error: "Pick a player to assign." });

    const owned = await prisma.audio.findMany({
      where: { id: { in: requested }, shop },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((a) => a.id));
    const valid = requested.filter((id) => ownedIds.has(id));
    if (!valid.length)
      return json({ ok: false, error: "Those players no longer exist." });

    const current = await fetchAssignedIds(admin, productGid);
    const merged = [...current];
    valid.forEach((id) => {
      if (!merged.includes(id)) merged.push(id);
    });

    const errs = await writeAssignedIds(admin, productGid, merged);
    if (errs.length)
      return json({
        ok: false,
        error: errs.map((e) => e.message).join("; "),
      });

    const added = merged.length - current.length;
    return json({
      ok: true,
      message:
        added > 0
          ? `Assigned ${added} player${added === 1 ? "" : "s"} to product.`
          : "Those players were already assigned.",
    });
  }

  if (intent === "reorder") {
    let ids = [];
    try {
      ids = JSON.parse(String(fd.get("ids") ?? "[]"));
    } catch {
      ids = [];
    }
    if (!Array.isArray(ids))
      return json({ ok: false, error: "Invalid order." });

    // Reconcile against the current assignment to guard stale submissions.
    const current = await fetchAssignedIds(admin, productGid);
    const currentSet = new Set(current);
    const next = ids.filter((id) => currentSet.has(id));
    current.forEach((id) => {
      if (!next.includes(id)) next.push(id);
    });

    const errs = await writeAssignedIds(admin, productGid, next);
    if (errs.length)
      return json({
        ok: false,
        error: errs.map((e) => e.message).join("; "),
      });
    return json({ ok: true, message: "Order updated." });
  }

  if (intent === "create_and_assign") {
    const playerType = String(fd.get("playerType") ?? "");
    if (!playerType) return json({ ok: false, error: "Pick a player type." });

    const customTitle = String(fd.get("title") ?? "").trim();
    const customUrl = String(fd.get("url") ?? "").trim();
    const customColor = String(fd.get("mainColor") ?? "").trim();
    // Playlist players carry multiple tracks set up in the modal.
    let customTracks = [];
    try {
      const parsed = JSON.parse(String(fd.get("tracks") ?? "[]"));
      if (Array.isArray(parsed)) {
        customTracks = parsed
          .map((t) => ({
            title: String(t?.title ?? "").trim(),
            url: String(t?.url ?? "").trim(),
          }))
          .filter((t) => t.url);
      }
    } catch {
      customTracks = [];
    }

    const [screens, user] = await Promise.all([
      prisma.screen.findMany({}),
      prisma.Users.findFirst({ where: { shop } }),
    ]);

    const limit = user?.cardits ?? 5;
    const used = await prisma.audio.count({ where: { shop } });
    if (used >= limit) {
      return json({
        ok: false,
        error: `You've reached your plan limit of ${limit} players. Upgrade to add more.`,
      });
    }

    let audio = {
      shop,
      title: "Single Audio Player",
      url: "",
      mainColor: "#00b3ff",
      playerType,
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

    if (playerType === "playlist-audio") {
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
    } else if (playerType === "sticky-player") {
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
    } else if (playerType === "sticky-single-button") {
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
          backgroundColor: "linear-gradient(to bottom right, #B388FF, #FF8A80)",
          textColor: "#FFFFFF",
          selectedIconID: 6,
          selectionType: "preset",
          selectedPreset: 3,
          messageShowDelay: "3px",
          showMessage: true,
        },
      };
    }

    if (customTitle) audio.title = customTitle;
    if (customColor) audio.mainColor = customColor;

    // Playlist: rebuild the track list from the tracks chosen in the modal,
    // preserving the default poster/artist/screen styling per track.
    if (playerType === "playlist-audio" && customTracks.length) {
      const POSTER =
        "https://placehold.co/500x500/15803d/fff/svg?text=Placeholder+Image\n+\nAudio+Player\nby+bPlugins&font=roboto";
      audio.audioPlayList = JSON.stringify(
        customTracks.map((t, i) => ({
          id: i + 1,
          title: t.title || `Track ${i + 1}`,
          url: t.url,
          poster: POSTER,
          artist: "Artist Name",
          screen: "screenTwo",
          content: "Feel this song",
        })),
      );
      audio.url = customTracks[0].url;
    } else if (customUrl) {
      audio.url = customUrl;
      // Non-track players that still carry a single url; seed playlist track 1.
      if (playerType === "playlist-audio") {
        try {
          const list = JSON.parse(audio.audioPlayList);
          if (Array.isArray(list) && list[0]) {
            list[0].url = customUrl;
            audio.audioPlayList = JSON.stringify(list);
          }
        } catch {
          // leave the default playlist untouched on parse failure
        }
      }
    }

    const created = await prisma.audio.create({ data: audio });

    // Append the new player to the product's existing assignment list.
    const current = await fetchAssignedIds(admin, productGid);
    const next = current.includes(created.id)
      ? current
      : [...current, created.id];
    const errs = await writeAssignedIds(admin, productGid, next);
    if (errs.length) {
      return json({
        ok: false,
        error: `Player created but assignment failed: ${errs
          .map((e) => e.message)
          .join("; ")}`,
      });
    }

    return json({
      ok: true,
      message: "Player created and assigned to product.",
      created: { id: created.id, playerType },
    });
  }

  return json({ ok: false, error: "Unknown action." });
};

const EDITOR_STEPS = [
  {
    title: "Create an Audio Player",
    desc: (
      <>
        Go to <s-text type="strong">Audio Players</s-text> from the sidebar and
        create at least one player (Single Audio, Playlist, or Sticky). You need
        a player ready before you can assign it to a product.
      </>
    ),
  },
  {
    title: "Find Your Product",
    desc: "Use the search bar on the Product Audio page to find the product you want to add audio to. You can search by product title.",
  },
  {
    title: "Assign a Player",
    desc: (
      <>
        On this product page, choose one or more audio players from your list
        under <s-text type="strong">Create new</s-text> or{" "}
        <s-text type="strong">Use existing</s-text>, then save.
      </>
    ),
  },
  {
    title: "Player Shows on Product Page",
    desc: "Once assigned, the audio player will automatically appear on the product page in your storefront. Customers can play audio directly from the product page.",
  },
  {
    title: "Manage or Remove",
    desc: (
      <>
        Use the <s-text type="strong">Assigned players</s-text> list above to
        add more players, drag to reorder them, or remove the assignment at any
        time.
      </>
    ),
  },
];

const VIDEO_SRC =
  "https://www.youtube-nocookie.com/embed/8vWlS-4gIkc?autoplay=1&mute=1&playsinline=1&rel=0";

const fileNameFromUrl = (url) =>
  url ? decodeURIComponent(url.split("/").pop().split("?")[0]) : "";

// One assigned player row, draggable by its handle. Reordering on the
// storefront follows this order, so we let merchants drag to arrange.
function SortableAssignedRow({
  audio,
  index,
  total,
  submitting,
  onEdit,
  onRemove,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: audio.id });

  // dnd-kit needs a real DOM node with its transform; the rest is web components.
  return (
    <div
      ref={setNodeRef}
      className={`pa-sortable-row${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <s-grid
        gridTemplateColumns="auto auto auto minmax(0, 1fr) auto"
        gap="small"
        alignItems="center"
      >
        <button
          type="button"
          className="pa-drag-handle"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          disabled={submitting || total < 2}
        >
          <s-icon type="drag-handle"></s-icon>
        </button>
        <s-text color="subdued">{index + 1}</s-text>
        <s-icon
          type={
            audio.missing
              ? "note"
              : PLAYER_TYPE_ICON[audio.playerType] || "note"
          }
        ></s-icon>
        <s-stack gap="small-500">
          <s-text type="strong">
            {audio.missing
              ? "Missing player"
              : audio.title || "Untitled player"}
          </s-text>
          <s-stack direction="inline">
            {audio.missing ? (
              <s-badge tone="warning">Player deleted</s-badge>
            ) : (
              <s-badge>{playerTypeLabel(audio.playerType)}</s-badge>
            )}
          </s-stack>
        </s-stack>
        <s-stack direction="inline" gap="small-200">
          {!audio.missing ? (
            <s-button icon="edit" onClick={onEdit}>
              Customize
            </s-button>
          ) : null}
          <s-button
            tone="critical"
            icon="delete"
            disabled={submitting || undefined}
            onClick={onRemove}
          >
            Remove
          </s-button>
        </s-stack>
      </s-grid>
    </div>
  );
}

export default function ProductDetail() {
  const openSupport = useSupport();
  const {
    product,
    shopDomain,
    assignedAudios,
    assignedIds,
    cardits,
    audioCount,
    audios,
    audioFiles,
  } = useLoaderData();
  const totalCredits = cardits > 100 ? `Unlimited` : cardits;
  const actionData = useActionData();
  const nav = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const submitting = nav.state === "submitting" || nav.state === "loading";

  const [selected, setSelected] = useState("single-audio");
  const [mode, setMode] = useState("create");
  const [selectedAudioIds, setSelectedAudioIds] = useState([]);
  // The assigned player pending removal (drives the confirmation modal).
  const [removeTarget, setRemoveTarget] = useState(null);
  // The just-created player (drives the "Done / Customize" success modal).
  const [createdPlayer, setCreatedPlayer] = useState(null);
  // Pre-create setup modal: collect a few starter options for the new player.
  const [showSetup, setShowSetup] = useState(false);
  const [setupTitle, setSetupTitle] = useState("");
  const [setupUrl, setSetupUrl] = useState("");
  const [setupColor, setSetupColor] = useState(THEME_COLOR);
  // Playlist players collect multiple tracks; other types use setupUrl.
  const [setupTracks, setSetupTracks] = useState([{ title: "", url: "" }]);
  const isPlaylist = selected === "playlist-audio";
  // Audio-select modal state (reuses the app's standard AudioUploadModal).
  const AUDIO_MODAL_ID = "setup-audio-upload";
  const [audioStagedFiles, setAudioStagedFiles] = useState([]);
  const [selectedAudioFile, setSelectedAudioFile] = useState(null);
  // Which field the audio modal fills: null = single field, number = track index.
  const [audioTargetIndex, setAudioTargetIndex] = useState(null);

  const openAudioModalFor = (index) => {
    setAudioTargetIndex(index);
    setSelectedAudioFile(null);
    showModal(AUDIO_MODAL_ID);
  };

  // When the user clicks "Insert Selected" in the audio modal, use its URL.
  const handleAudioSelected = (file) => {
    const url = file?.node?.url || "";
    if (!url) return;
    if (audioTargetIndex == null) {
      setSetupUrl(url);
    } else {
      setSetupTracks((prev) =>
        prev.map((t, i) => (i === audioTargetIndex ? { ...t, url } : t)),
      );
    }
  };

  const updateTrack = (index, patch) =>
    setSetupTracks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    );
  const addTrack = () =>
    setSetupTracks((prev) => [...prev, { title: "", url: "" }]);
  const removeTrack = (index) =>
    setSetupTracks((prev) => prev.filter((_, i) => i !== index));
  const [searchQuery, setSearchQuery] = useState("");
  // "Use existing" list pagination (client-side, 10 per page).
  const [existingPage, setExistingPage] = useState(1);
  const [showVideo, setShowVideo] = useState(false);

  // Reset to the first page whenever the existing-player search changes.
  useEffect(() => {
    setExistingPage(1);
  }, [searchQuery]);

  // Local copy of the assigned players so drag reordering feels instant; the
  // loader's order stays the source of truth and re-syncs after each save.
  const [orderedAudios, setOrderedAudios] = useState(assignedAudios);
  useEffect(() => {
    setOrderedAudios(assignedAudios);
  }, [assignedAudios]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    if (!actionData) return;
    if (actionData.ok) {
      shopify.toast.show(actionData.message ?? "Saved");
      maybeAskForReview();
      setSelectedAudioIds([]);
      if (actionData.created) setCreatedPlayer(actionData.created);
    } else if (actionData.error)
      shopify.toast.show(actionData.error, { isError: true });
  }, [actionData, shopify]);

  if (!product) {
    return (
      <s-page inlineSize="large">
        <ui-title-bar title="Product not found">
          <button onClick={() => openSupport()}>Support</button>
        </ui-title-bar>
        <s-stack gap="base">
          <s-banner tone="critical">
            The requested product could not be loaded.
          </s-banner>
          <s-stack direction="inline">
            <s-button
              icon="arrow-left"
              onClick={() => navigate("/app/product-audio")}
            >
              Back to Product Audio
            </s-button>
          </s-stack>
        </s-stack>
      </s-page>
    );
  }

  const storefrontUrl =
    product.onlineStoreUrl ??
    (shopDomain && product.handle
      ? `${shopDomain}/products/${product.handle}`
      : null);

  const limitReached = audioCount >= cardits;
  const assignedIdSet = new Set(assignedIds);
  const assignedCount = assignedIds.length;
  const hasAssigned = assignedCount > 0;
  const hasMissing = assignedAudios.some((a) => a.missing);
  // Players not yet assigned to this product — available to add.
  const availableAudios = audios.filter((a) => !assignedIdSet.has(a.id));
  const filteredAudios = availableAudios.filter((a) =>
    (a.title || "Untitled player")
      .toLowerCase()
      .includes(searchQuery.toLowerCase()),
  );
  const EXISTING_PAGE_SIZE = 10;
  const existingTotalPages = Math.max(
    1,
    Math.ceil(filteredAudios.length / EXISTING_PAGE_SIZE),
  );
  const currentExistingPage = Math.min(existingPage, existingTotalPages);
  const pagedAudios = filteredAudios.slice(
    (currentExistingPage - 1) * EXISTING_PAGE_SIZE,
    currentExistingPage * EXISTING_PAGE_SIZE,
  );

  // Step 1: open the setup modal with sensible defaults for the chosen type.
  const openSetup = () => {
    if (limitReached) {
      shopify.toast.show(
        `You've reached your plan limit of ${totalCredits} players. Upgrade to add more.`,
        { isError: true },
      );
      return;
    }
    setSetupTitle(product.title);
    setSetupUrl("");
    setSetupColor(THEME_COLOR);
    setSetupTracks([{ title: "", url: "" }]);
    setShowSetup(true);
  };

  // Step 2: create the player with the options chosen in the setup modal.
  const handleCreateAndAssign = () => {
    const fd = new FormData();
    fd.set("intent", "create_and_assign");
    fd.set("playerType", selected);
    fd.set("title", setupTitle.trim() || product.title);
    fd.set("mainColor", setupColor);
    if (isPlaylist) {
      const tracks = setupTracks
        .map((t) => ({ title: t.title.trim(), url: t.url.trim() }))
        .filter((t) => t.url);
      fd.set("tracks", JSON.stringify(tracks));
    } else {
      fd.set("url", setupUrl.trim());
    }
    submit(fd, { method: "post" });
    setShowSetup(false);
  };

  const toggleSelectExisting = (id) => {
    setSelectedAudioIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleAssignExisting = () => {
    if (!selectedAudioIds.length) {
      shopify.toast.show("Select at least one player to assign.", {
        isError: true,
      });
      return;
    }
    const fd = new FormData();
    fd.set("intent", "assign_existing");
    selectedAudioIds.forEach((id) => fd.append("audioId", id));
    submit(fd, { method: "post" });
  };

  const handleRemove = (audioId) => {
    const fd = new FormData();
    fd.set("intent", "remove");
    fd.set("audioId", audioId);
    submit(fd, { method: "post" });
  };

  const confirmRemove = () => {
    if (removeTarget) handleRemove(removeTarget.id);
    setRemoveTarget(null);
  };

  const handleReorder = (ids) => {
    const fd = new FormData();
    fd.set("intent", "reorder");
    fd.set("ids", JSON.stringify(ids));
    submit(fd, { method: "post" });
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedAudios.findIndex((a) => a.id === active.id);
    const newIndex = orderedAudios.findIndex((a) => a.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(orderedAudios, oldIndex, newIndex);
    setOrderedAudios(next);
    handleReorder(next.map((a) => a.id));
  };

  const assignLabel =
    selectedAudioIds.length > 0
      ? `Assign ${selectedAudioIds.length} player${
          selectedAudioIds.length === 1 ? "" : "s"
        }`
      : "Assign to product";

  const createButton = (
    <s-button
      variant="primary"
      loading={submitting || undefined}
      onClick={openSetup}
    >
      Continue & Create
    </s-button>
  );

  const assignButton = (
    <s-button
      variant="primary"
      loading={submitting || undefined}
      disabled={selectedAudioIds.length === 0 || undefined}
      onClick={handleAssignExisting}
    >
      {assignLabel}
    </s-button>
  );

  const selectAudioButton = (index, label) => (
    <s-button icon="upload" onClick={() => openAudioModalFor(index)}>
      {label}
    </s-button>
  );

  const chosenFile = (url) =>
    url ? (
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-icon type="check-circle" tone="success"></s-icon>
        <s-text color="subdued">{fileNameFromUrl(url)}</s-text>
      </s-stack>
    ) : null;

  return (
    <s-page inlineSize="large">
      <ui-title-bar title={product.title}>
        <button onClick={() => openSupport()}>Support</button>
        <button
          variant="breadcrumb"
          onClick={() => navigate("/app/product-audio")}
        >
          Product Audio
        </button>
      </ui-title-bar>

      <s-stack gap="base">
        {/* Header: product + assignment status */}
        <s-stack
          direction="inline"
          justifyContent="space-between"
          alignItems="center"
          gap="base"
        >
          <s-stack direction="inline" gap="base" alignItems="center">
            {product.featuredImage?.url ? (
              <s-thumbnail
                src={product.featuredImage.url}
                alt={product.featuredImage.altText ?? product.title}
                size="base"
              ></s-thumbnail>
            ) : null}
            <s-stack gap="small-300">
              <s-heading>{product.title}</s-heading>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text color="subdued">/{product.handle}</s-text>
                {hasMissing ? (
                  <s-badge tone="warning">
                    {assignedCount} assigned · needs attention
                  </s-badge>
                ) : hasAssigned ? (
                  <s-badge tone="success" icon="check-circle">
                    {assignedCount} player{assignedCount === 1 ? "" : "s"}{" "}
                    assigned
                  </s-badge>
                ) : (
                  <s-badge>No audio assigned</s-badge>
                )}
              </s-stack>
            </s-stack>
          </s-stack>
          {storefrontUrl ? (
            <s-button
              icon="external"
              onClick={() =>
                window.open(storefrontUrl, "_blank", "noopener,noreferrer")
              }
            >
              View on store
            </s-button>
          ) : null}
        </s-stack>

        {/* Assigned players: full width */}
        {hasAssigned && (
          <s-section padding="none">
            <s-box padding="base">
              <s-stack gap="small-300">
                <s-heading>Assigned players ({assignedCount})</s-heading>
                <s-paragraph color="subdued">
                  These play on the product page in this order. Drag a player by
                  its handle to reorder, or remove any you don&apos;t need.
                </s-paragraph>
              </s-stack>
            </s-box>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={orderedAudios.map((a) => a.id)}
                strategy={verticalListSortingStrategy}
              >
                {orderedAudios.map((a, index) => (
                  <SortableAssignedRow
                    key={a.id}
                    audio={a}
                    index={index}
                    total={orderedAudios.length}
                    submitting={submitting}
                    onEdit={() =>
                      navigate(
                        `/app/customize/${a.id}/${a.playerType || "single-audio"}`,
                      )
                    }
                    onRemove={() => setRemoveTarget(a)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </s-section>
        )}

        {/* Add another player (2/3) | How this works (1/3) */}
        <s-query-container>
          <s-grid
            gridTemplateColumns="@container (inline-size > 760px) 2fr 1fr, 1fr"
            gap="base"
            alignItems="start"
          >
            <s-section>
              <s-stack gap="base">
                <s-stack gap="small-300">
                  <s-heading>
                    {hasAssigned ? "Add another player" : "Assign a player"}
                  </s-heading>
                  <s-paragraph color="subdued">
                    Create a brand-new player, or pick one (or several) you
                    already have, then assign them to this product.
                  </s-paragraph>
                </s-stack>

                <s-grid
                  className="pa-tabs"
                  gridTemplateColumns="minmax(0, 1fr) auto"
                  alignItems="end"
                  gap="small"
                >
                  <s-stack
                    direction="inline"
                    gap="none"
                    role="tablist"
                    aria-label="Add a player"
                  >
                    {[
                      {
                        id: "create",
                        label: "Create new",
                        icon: "plus-circle",
                      },
                      {
                        id: "existing",
                        label: "Use existing",
                        icon: "collection",
                        count: availableAudios.length,
                      },
                    ].map((tab) => {
                      const active = mode === tab.id;
                      return (
                        <s-clickable
                          key={tab.id}
                          role="tab"
                          aria-selected={active ? "true" : "false"}
                          className={`pa-tab ${active ? "is-active" : ""}`}
                          paddingInline="base"
                          paddingBlock="small"
                          onClick={() => setMode(tab.id)}
                        >
                          <s-stack
                            direction="inline"
                            gap="small-200"
                            alignItems="center"
                          >
                            <s-icon
                              type={tab.icon}
                              tone={active ? "success" : "subdued"}
                            ></s-icon>
                            <s-text type="strong">{tab.label}</s-text>
                            {tab.count !== undefined ? (
                              <s-badge tone={active ? "success" : undefined}>
                                {tab.count}
                              </s-badge>
                            ) : null}
                          </s-stack>
                        </s-clickable>
                      );
                    })}
                  </s-stack>
                  <s-box paddingBlockEnd="small-200">
                    {mode === "create"
                      ? !limitReached && createButton
                      : availableAudios.length > 0 && assignButton}
                  </s-box>
                </s-grid>

                {mode === "create" ? (
                  limitReached ? (
                    <s-stack gap="base">
                      <s-banner tone="critical">
                        Credit limit reached — your plan allows{" "}
                        <s-text type="strong">{totalCredits} players</s-text> (
                        {audioCount}/{totalCredits} used).
                      </s-banner>
                      <s-stack direction="inline">
                        <s-button
                          variant="primary"
                          onClick={() => navigate("/app/pricing")}
                        >
                          Upgrade plan
                        </s-button>
                      </s-stack>
                    </s-stack>
                  ) : (
                    <s-stack gap="base">
                      <PlayerTypePicker
                        value={selected}
                        onChange={setSelected}
                      />
                      <s-divider></s-divider>
                      <s-stack
                        direction="inline"
                        justifyContent="space-between"
                        alignItems="center"
                        gap="small"
                      >
                        <s-text color="subdued">
                          {audioCount} / {totalCredits} players used
                        </s-text>
                        {createButton}
                      </s-stack>
                    </s-stack>
                  )
                ) : availableAudios.length === 0 ? (
                  <s-banner>
                    {audios.length === 0 ? (
                      <>
                        You don&apos;t have any players yet. Switch to{" "}
                        <s-text type="strong">Create new</s-text> to make your
                        first one.
                      </>
                    ) : (
                      "All of your players are already assigned to this product."
                    )}
                  </s-banner>
                ) : (
                  <s-stack gap="base">
                    <WebSearchField
                      label="Search players"
                      labelAccessibilityVisibility="exclusive"
                      placeholder="Search players by name..."
                      value={searchQuery}
                      onChange={setSearchQuery}
                    />
                    {filteredAudios.length === 0 ? (
                      <s-text color="subdued">
                        No players match your search.
                      </s-text>
                    ) : (
                      <s-stack gap="small">
                        {pagedAudios.map((a, i) => (
                          <React.Fragment key={a.id}>
                            {i > 0 ? <s-divider></s-divider> : null}
                            <s-grid
                              gridTemplateColumns="minmax(0, 1fr) auto"
                              gap="small"
                              alignItems="center"
                            >
                              <WebCheckbox
                                label={a.title || "Untitled player"}
                                details={playerTypeLabel(a.playerType)}
                                checked={selectedAudioIds.includes(a.id)}
                                onChange={() => toggleSelectExisting(a.id)}
                              />
                              <s-icon
                                type={PLAYER_TYPE_ICON[a.playerType] || "note"}
                                tone="subdued"
                              ></s-icon>
                            </s-grid>
                          </React.Fragment>
                        ))}
                      </s-stack>
                    )}

                    {existingTotalPages > 1 ? (
                      <s-stack
                        direction="inline"
                        gap="small"
                        alignItems="center"
                        justifyContent="center"
                      >
                        <s-button
                          icon="chevron-left"
                          accessibilityLabel="Previous page"
                          disabled={currentExistingPage <= 1 || undefined}
                          onClick={() =>
                            setExistingPage((p) => Math.max(1, p - 1))
                          }
                        ></s-button>
                        <s-text color="subdued">
                          Page {currentExistingPage} of {existingTotalPages}
                        </s-text>
                        <s-button
                          icon="chevron-right"
                          accessibilityLabel="Next page"
                          disabled={
                            currentExistingPage >= existingTotalPages ||
                            undefined
                          }
                          onClick={() =>
                            setExistingPage((p) =>
                              Math.min(existingTotalPages, p + 1),
                            )
                          }
                        ></s-button>
                      </s-stack>
                    ) : null}

                    <s-divider></s-divider>
                    <s-stack
                      direction="inline"
                      justifyContent="space-between"
                      alignItems="center"
                      gap="small"
                    >
                      <s-text color="subdued">
                        {selectedAudioIds.length} selected
                      </s-text>
                      {assignButton}
                    </s-stack>
                  </s-stack>
                )}
              </s-stack>
            </s-section>
            <s-box>
              <s-section>
                <s-stack gap="base">
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                    gap="small"
                  >
                    <s-heading>How this works</s-heading>
                    <s-button
                      icon="play-circle"
                      onClick={() => setShowVideo(true)}
                    >
                      Watch video
                    </s-button>
                  </s-stack>
                  <HowItWorksSteps steps={EDITOR_STEPS} />
                  {hasMissing ? (
                    <s-banner tone="warning">
                      One or more assigned players no longer exist. Remove them
                      from the list above.
                    </s-banner>
                  ) : null}
                  <s-banner tone="info">
                    <s-text type="strong">Tip:</s-text> You have{" "}
                    <s-text type="strong">
                      {audioCount} / {totalCredits} players
                    </s-text>{" "}
                    available.
                    {totalCredits !== "Unlimited" ? (
                      <>
                        {" "}
                        If you&apos;ve hit the limit, upgrade your plan to{" "}
                        <s-link onClick={() => navigate("/app/pricing")}>
                          add more
                        </s-link>{" "}
                        audio players.
                      </>
                    ) : null}
                  </s-banner>
                </s-stack>
              </s-section>
            </s-box>
          </s-grid>
        </s-query-container>
      </s-stack>

      <Modal
        open={showSetup}
        onClose={() => setShowSetup(false)}
        title={`Set up your ${playerTypeLabel(selected)}`}
        primaryAction={{
          content: "Create & assign",
          loading: submitting,
          onAction: handleCreateAndAssign,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setShowSetup(false) },
        ]}
      >
        <Modal.Section>
          <s-stack gap="base">
            {/* Selected player type */}
            <s-box
              padding="small"
              background="subdued"
              border="base"
              borderRadius="base"
            >
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-icon type={PLAYER_TYPE_ICON[selected] || "note"}></s-icon>
                <s-stack gap="small-500">
                  <s-text type="strong">{playerTypeLabel(selected)}</s-text>
                  <s-text color="subdued">
                    Give it a head start — you can change everything later on
                    the customize page.
                  </s-text>
                </s-stack>
              </s-stack>
            </s-box>

            <WebTextField
              label="Player title"
              value={setupTitle}
              onChange={setSetupTitle}
              placeholder="e.g. Product preview track"
              autocomplete="off"
            />

            {isPlaylist ? (
              <s-stack gap="small">
                <s-stack
                  direction="inline"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <s-text type="strong">Tracks ({setupTracks.length})</s-text>
                  <s-button variant="tertiary" icon="plus" onClick={addTrack}>
                    Add track
                  </s-button>
                </s-stack>
                {setupTracks.map((track, i) => (
                  <s-box
                    key={i}
                    padding="small"
                    border="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-stack gap="small">
                      <s-stack
                        direction="inline"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <s-stack
                          direction="inline"
                          gap="small-200"
                          alignItems="center"
                        >
                          <s-badge tone="info">{i + 1}</s-badge>
                          <s-text>Track {i + 1}</s-text>
                        </s-stack>
                        {setupTracks.length > 1 ? (
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            icon="delete"
                            accessibilityLabel={`Remove track ${i + 1}`}
                            onClick={() => removeTrack(i)}
                          ></s-button>
                        ) : null}
                      </s-stack>
                      <WebTextField
                        label="Track title"
                        labelAccessibilityVisibility="exclusive"
                        value={track.title}
                        onChange={(v) => updateTrack(i, { title: v })}
                        placeholder={`Track ${i + 1} title (optional)`}
                        autocomplete="off"
                      />
                      <s-grid
                        gridTemplateColumns="minmax(0, 1fr) auto"
                        gap="small"
                        alignItems="end"
                      >
                        <WebTextField
                          label="Track audio"
                          labelAccessibilityVisibility="exclusive"
                          value={track.url}
                          onChange={(v) => updateTrack(i, { url: v })}
                          placeholder="Choose or upload an audio file…"
                          autocomplete="off"
                        />
                        {selectAudioButton(i, "Select")}
                      </s-grid>
                      {chosenFile(track.url)}
                    </s-stack>
                  </s-box>
                ))}
                <s-text color="subdued">
                  Add as many tracks as you like — reorder and fine-tune them
                  later on the customize page.
                </s-text>
              </s-stack>
            ) : (
              <s-stack gap="small-200">
                <s-grid
                  gridTemplateColumns="minmax(0, 1fr) auto"
                  gap="small"
                  alignItems="end"
                >
                  <WebTextField
                    label="Audio file"
                    value={setupUrl}
                    onChange={setSetupUrl}
                    placeholder="Choose or upload an audio file…"
                    autocomplete="off"
                  />
                  {selectAudioButton(null, "Select audio")}
                </s-grid>
                {chosenFile(setupUrl) || (
                  <s-text color="subdued">
                    Select from your uploaded files, upload a new one, or paste
                    a URL.
                  </s-text>
                )}
              </s-stack>
            )}

            {selected !== "sticky-single-button" && (
              <s-stack gap="small-200">
                <s-text>Brand color</s-text>
                <s-grid
                  gridTemplateColumns="auto minmax(0, 1fr)"
                  gap="base"
                  alignItems="center"
                >
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    {/* Presets need arbitrary hex backgrounds, so these stay
                        tiny custom swatches. */}
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Use ${c}`}
                        aria-pressed={
                          setupColor.toLowerCase() === c.toLowerCase()
                        }
                        className={`pa-swatch${
                          setupColor.toLowerCase() === c.toLowerCase()
                            ? " is-active"
                            : ""
                        }`}
                        style={{ background: c }}
                        onClick={() => setSetupColor(c)}
                      />
                    ))}
                  </s-stack>
                  <WebChangeField
                    tag="s-color-field"
                    label="Custom brand color"
                    labelAccessibilityVisibility="exclusive"
                    value={setupColor}
                    onChange={(v) => v && setSetupColor(v)}
                  />
                </s-grid>
              </s-stack>
            )}
          </s-stack>
        </Modal.Section>
      </Modal>

      <AudioUploadModal
        modalId={AUDIO_MODAL_ID}
        handleSubmitFile={() => {}}
        items={audioFiles?.files || []}
        files={audioStagedFiles}
        setFiles={setAudioStagedFiles}
        selectedFile={selectedAudioFile}
        setSelectedFile={setSelectedAudioFile}
        isUploading={false}
        fileProgress={false}
        setUploadAndSelectedFile={handleAudioSelected}
      />

      <Modal
        open={!!createdPlayer}
        onClose={() => setCreatedPlayer(null)}
        title="Player created 🎉"
        primaryAction={{
          content: "Customize",
          onAction: () => {
            if (createdPlayer) {
              navigate(
                `/app/customize/${createdPlayer.id}/${
                  createdPlayer.playerType || "single-audio"
                }`,
              );
            }
          },
        }}
        secondaryActions={[
          { content: "Done", onAction: () => setCreatedPlayer(null) },
        ]}
      >
        <Modal.Section>
          <s-paragraph>
            Your new{" "}
            <s-text type="strong">
              {playerTypeLabel(createdPlayer?.playerType)}
            </s-text>{" "}
            has been created and assigned to{" "}
            <s-text type="strong">{product.title}</s-text>. You can fine-tune
            its look and audio now, or come back to it any time from the
            assigned players list.
          </s-paragraph>
        </Modal.Section>
      </Modal>

      <Modal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Remove player?"
        primaryAction={{
          content: "Remove",
          destructive: true,
          loading: submitting,
          onAction: confirmRemove,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setRemoveTarget(null) },
        ]}
      >
        <Modal.Section>
          <s-paragraph>
            This will unassign{" "}
            <s-text type="strong">
              {removeTarget?.missing
                ? "this missing player"
                : removeTarget?.title || "this player"}
            </s-text>{" "}
            from <s-text type="strong">{product.title}</s-text>. It will no
            longer show on the product page. The player itself isn&apos;t
            deleted — you can reassign it anytime.
          </s-paragraph>
        </Modal.Section>
      </Modal>

      <YouTubeModal
        open={showVideo}
        onClose={() => setShowVideo(false)}
        src={VIDEO_SRC}
        title="How this works - Product Audio tutorial"
      />
    </s-page>
  );
}
