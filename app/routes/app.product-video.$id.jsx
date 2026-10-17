import { json } from "@remix-run/node";
import { CustomButton, CustomBox } from "../utils/polarisWebComponents";
import {
  useLoaderData,
  useNavigate,
  useNavigation,
  useActionData,
  useSubmit,
} from "@remix-run/react";
import { useEffect, useState } from "react";
import { resolvePlan, planUsage } from "../utils/planLimits";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  ButtonGroup,
  Icon,
  Banner,
  Thumbnail,
  Grid,
  List,
  Box,
  TextField,
  Checkbox,
} from "@shopify/polaris";
import {
  DragHandleIcon,
  DeleteIcon,
  EditIcon,
  PlayCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  PlayIcon,
  AppsIcon,
  ExternalIcon,
  AlertTriangleIcon,
} from "@shopify/polaris-icons";
import { Modal, TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import InlinePlayerCreatorModal from "../components/InlinePlayerCreatorModal";
import "../styles/product-video.css";
import "../styles/styles.css";
import { verifyShopPlan } from "../utils/planSync.server";

const NS = "bplugins";
const KEY = "product_video";

const HOW_IT_WORKS_STEPS = [
  {
    title: "Create a Video Player",
    body: "Go to Videos from the sidebar and create at least one player (Single or Grid). You need a player ready before you can assign it to a product.",
  },
  {
    title: "Find Your Product",
    body: "Use the search bar on the Product Video page to find the product you want to add a video to. You can search by product title.",
  },
  {
    title: "Assign a Player",
    body: "On this product page, choose one or more video players from your list under Create new or Use existing, then save.",
  },
  {
    title: "Player Shows on Product Page",
    body: "Once assigned, the video player automatically appears on the product page in your storefront. Customers can watch directly from the product page.",
  },
  {
    title: "Manage or Remove",
    body: "Use the Assigned players list above to add more players, drag to reorder them, or remove the assignment at any time.",
  },
];
const LIST_TYPE = "list.single_line_text_field";

const parseVideoIds = (mf) => {
  if (!mf?.value) return [];
  if (mf.type && mf.type.startsWith("list.")) {
    try {
      const arr = JSON.parse(mf.value);
      return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [mf.value];
};

const FALLBACK_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect width='80' height='80' rx='8' fill='#f1f2f3'/><path d='M24 54l12-14 9 9 7-9 8 14z' fill='#c9ccd0'/><circle cx='30' cy='30' r='5' fill='#c9ccd0'/></svg>`,
  );

function getYoutubeId(url) {
  if (!url) return null;
  if (url.includes("youtu.be/")) {
    return url.split("youtu.be/")[1].split("?")[0];
  }
  if (url.includes("youtube.com/watch")) {
    return new URL(url).searchParams.get("v");
  }
  return null;
}

const PLAYER_TYPES = [
  {
    id: "single",
    title: "Single Video",
    desc: "Simple player for a single video clip.",
  },
  {
    id: "multiple",
    title: "Multiple / Grid Video",
    desc: "Show several videos in a grid or carousel.",
  },
];

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  // Confirm the stored plan against Shopify billing before anything reads it.
  await verifyShopPlan(admin, session.shop);
  const shop = session.shop;
  const productId = `gid://shopify/Product/${params.id}`;

  const response = await admin.graphql(
    `#graphql
    query ProductForVideo($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        onlineStoreUrl
        featuredImage { url altText }
        metafield(namespace: "${NS}", key: "${KEY}") { value type }
      }
    }`,
    { variables: { id: productId } },
  );
  const result = await response.json();
  const product = result?.data?.product;

  if (!product) {
    throw new Response("Product not found", { status: 404 });
  }

  const [videos, user, allPlans] = await Promise.all([
    prisma.Video.findMany({
      where: { shop },
      select: {
        id: true,
        title: true,
        videoType: true,
        poster: true,
        data: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    // This page tells the merchant how many players they have left, so it needs
    // the real plan. It used to print "Unlimited" for every shop, including
    // Free ones capped at 5.
    prisma.users.findFirst({ where: { shop } }),
    prisma.plans.findMany({ orderBy: { price: "asc" } }),
  ]);

  return json({
    product: {
      id: product.id,
      numericId: params.id,
      title: product.title,
      handle: product.handle || null,
      image: product.featuredImage?.url || null,
      onlineStoreUrl: product.onlineStoreUrl || null,
      assignedVideoIds: parseVideoIds(product.metafield),
    },
    shop,
    videos,
    user: user || {},
    allPlans: allPlans || [],
    youtubeVideoLink:
      process.env.YOUTUBE_VIDEO_LINK || "https://youtu.be/X29IJ5UvBKw",
  });
};

export const action = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  // Product ids are numeric; reject anything else outright.
  if (!/^\d+$/.test(String(params.id || ""))) {
    return json({ ok: false, error: "Invalid product" }, { status: 400 });
  }
  const productId = `gid://shopify/Product/${params.id}`;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "assign") {
    let videoIds = [];
    try {
      videoIds = JSON.parse(form.get("videoIds") || "[]");
    } catch {
      videoIds = [];
    }
    // Only well-formed player ids that belong to this shop are stored; the
    // list is rendered into the storefront by the product_video block.
    videoIds = (Array.isArray(videoIds) ? videoIds : [])
      .filter((id) => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id))
      .slice(0, 50);
    if (videoIds.length > 0) {
      const owned = await prisma.video.findMany({
        where: { id: { in: videoIds }, shop: session.shop },
        select: { id: true },
      });
      const ownedIds = new Set(owned.map((v) => v.id));
      videoIds = videoIds.filter((id) => ownedIds.has(id));
    }

    if (videoIds.length === 0) {
      await admin.graphql(
        `#graphql
        mutation DeleteProductVideo($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields { key }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            metafields: [{ ownerId: productId, namespace: NS, key: KEY }],
          },
        },
      );
      return json({ ok: true, assignedVideoIds: [] });
    }

    const res = await admin.graphql(
      `#graphql
      mutation SetProductVideo($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: productId,
              namespace: NS,
              key: KEY,
              type: LIST_TYPE,
              value: JSON.stringify(videoIds),
            },
          ],
        },
      },
    );
    const data = await res.json();
    const errors = data?.data?.metafieldsSet?.userErrors || [];
    if (errors.length) {
      return json({
        ok: false,
        error: errors.map((e) => e.message).join(", "),
      });
    }
    return json({ ok: true, assignedVideoIds: videoIds });
  }

  if (intent === "unassign") {
    await admin.graphql(
      `#graphql
      mutation DeleteProductVideo($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          deletedMetafields { key }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [{ ownerId: productId, namespace: NS, key: KEY }],
        },
      },
    );
    return json({ ok: true, assignedVideoIds: [] });
  }

  return json({ ok: false, error: "Unknown action." });
};

function RowIcon({ video, boxed, missing }) {
  const t = (video?.videoType || "").toLowerCase();
  const multi = /multi|grid|playlist|list|carousel/.test(t);
  return (
    <Box
      padding={boxed ? "100" : "0"}
      borderRadius="100"
      background={boxed ? "bg-surface-secondary" : "transparent"}
    >
      <Icon
        source={missing ? AlertTriangleIcon : multi ? AppsIcon : PlayIcon}
        tone={missing ? "critical" : undefined}
      />
    </Box>
  );
}

function AssignedRow({
  index,
  video,
  missing,
  dragging,
  isOver,
  dropPos,
  onEdit,
  onEmbed,
  onRemove,
  dnd,
}) {
  return (
    <CustomBox
      className={`pv-arow${dragging ? " pv-arow--placeholder" : ""}${
        isOver ? ` pv-arow--over pv-arow--${dropPos}` : ""
      }`}
      onDragOver={(e) => dnd.over(e, index)}
      onDrop={(e) => dnd.drop(e, index)}
      onDragEnd={dnd.end}
      style={{
        padding: "12px",
        border: "1px solid var(--p-color-border)",
        borderRadius: "8px",
        background: "white",
        marginBottom: "8px",
      }}
    >
      <InlineStack blockAlign="center" align="space-between" wrap={false}>
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <CustomBox
            className="pv-arow-handle"
            draggable="true"
            onDragStart={(e) => dnd.start(e, index)}
            style={{
              cursor: "grab",
              padding: "4px",
              touchAction: "none",
              userSelect: "none",
              WebkitUserDrag: "element",
            }}
            aria-label="Drag to reorder"
          >
            <CustomBox style={{ pointerEvents: "none" }}>
              <Icon source={DragHandleIcon} />
            </CustomBox>
          </CustomBox>
          <Text fontWeight="bold" as="span">
            {index + 1}
          </Text>
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <RowIcon video={video} missing={missing} />
            <BlockStack gap="0">
              <Text
                fontWeight="bold"
                as="span"
                tone={missing ? "critical" : undefined}
              >
                {missing ? "Deleted player" : video?.title || "Untitled player"}
              </Text>
              {missing ? (
                <Badge tone="critical">Deleted</Badge>
              ) : (
                <Badge tone="success">
                  {video?.data?.playerType === "multiple"
                    ? "Multiple videos"
                    : "Single video"}
                </Badge>
              )}
            </BlockStack>
          </InlineStack>
        </InlineStack>

        <InlineStack gap="300" wrap={false}>
          {/* Nothing to customize — /app/customize/:id would 404 on an id that
              is no longer in the shop's video list. */}
          <Button icon={EditIcon} onClick={onEdit} disabled={missing}>
            Customize
          </Button>
          <Button icon={DeleteIcon} tone="critical" onClick={onRemove}>
            Remove
          </Button>
        </InlineStack>
      </InlineStack>
    </CustomBox>
  );
}

function ExistingRow({ video, checked, assigned, onToggle }) {
  return (
    <Box paddingBlockEnd="200">
      <Card padding="300">
        <InlineStack blockAlign="center" gap="300" wrap={false}>
          <Checkbox
            checked={assigned || checked}
            disabled={assigned}
            onChange={() => onToggle(video.id)}
          />
          <RowIcon video={video} boxed />
          <CustomBox style={{ flexGrow: 1 }}>
            <BlockStack gap="0">
              <Text fontWeight="bold" as="span">
                {video.title || "Untitled player"}
              </Text>
              <Text tone="subdued" as="span">
                {video?.data?.playerType == "single"
                  ? "Single video"
                  : "Multiple videos"}
              </Text>
            </BlockStack>
          </CustomBox>
          {assigned && <Badge tone="success">Assigned</Badge>}
        </InlineStack>
      </Card>
    </Box>
  );
}

function TypeCard({ type, selected, onSelect }) {
  return (
    <CustomBox
      onClick={() => onSelect(type.id)}
      style={{ cursor: "pointer", height: "100%" }}
    >
      <Card
        padding="400"
        background={selected ? "bg-surface-active" : "bg-surface"}
      >
        <BlockStack gap="200" inlineAlign="center">
          <Icon source={type.id === "single" ? PlayIcon : AppsIcon} />
          <BlockStack gap="100" inlineAlign="center">
            <Text fontWeight="bold" as="span">
              {type.title}
            </Text>
            <Text tone="subdued" as="p" alignment="center">
              {type.desc}
            </Text>
          </BlockStack>
        </BlockStack>
      </Card>
    </CustomBox>
  );
}

export default function ProductVideoAssign() {
  const { product, shop, videos, user, allPlans, youtubeVideoLink } =
    useLoaderData();

  // Same plan resolution as the dashboard and the players list.
  const usage = planUsage(
    videos.length,
    resolvePlan({ plans: allPlans, user }),
  );
  const previewUrl =
    product.onlineStoreUrl ||
    (product.handle ? `https://${shop}/products/${product.handle}` : null);
  const actionData = useActionData();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();

  const assignedVideoIds =
    actionData && "assignedVideoIds" in actionData
      ? actionData.assignedVideoIds
      : product.assignedVideoIds;

  const [selectedIds, setSelectedIds] = useState(assignedVideoIds || []);
  const [tab, setTab] = useState(0);
  const [playerType, setPlayerType] = useState("single");
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [dropPos, setDropPos] = useState(null);
  const [embedFor, setEmbedFor] = useState(null);
  const [existingChecked, setExistingChecked] = useState([]);
  const [existingSearch, setExistingSearch] = useState("");
  const [existingPage, setExistingPage] = useState(1);
  const EXISTING_PER_PAGE = 10;
  const [watchVideoOpen, setWatchVideoOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);

  useEffect(() => {
    if (watchVideoOpen) shopify.modal.show("pv-watch-video");
    else shopify.modal.hide("pv-watch-video");
  }, [watchVideoOpen]);

  useEffect(() => {
    if (removeTarget != null) shopify.modal.show("pv-remove-player");
    else shopify.modal.hide("pv-remove-player");
  }, [removeTarget]);

  useEffect(() => {
    const pairs = [
      ["pv-watch-video", () => setWatchVideoOpen(false)],
      ["pv-remove-player", () => setRemoveTarget(null)],
    ];
    const bound = pairs
      .map(([id, fn]) => [document.getElementById(id), fn])
      .filter(([el]) => el);
    bound.forEach(([el, fn]) => el.addEventListener("hide", fn));
    return () =>
      bound.forEach(([el, fn]) => el.removeEventListener("hide", fn));
  }, []);

  const youtubeId = getYoutubeId(youtubeVideoLink);

  useEffect(() => {
    setSelectedIds(assignedVideoIds || []);
  }, [JSON.stringify(assignedVideoIds)]);

  const busy = navigation.state === "submitting";
  const byId = Object.fromEntries(videos.map((v) => [v.id, v]));

  // The assignment lives in the product metafield, the player lives in Mongo —
  // deleting a player from the Videos page leaves its id behind here. Those
  // rows used to render as a normal "Untitled player" with a working Customize
  // button; they are called out as deleted instead.
  const missingIds = selectedIds.filter((id) => !byId[id]);
  const dropMissing = () => commit(selectedIds.filter((id) => byId[id]));

  const commit = (ids) => {
    setSelectedIds(ids);
    submit(
      { intent: "assign", videoIds: JSON.stringify(ids) },
      { method: "POST" },
    );
  };

  const removeRow = (id) => commit(selectedIds.filter((x) => x !== id));

  const confirmRemove = () => {
    if (removeTarget != null) removeRow(removeTarget);
    setRemoveTarget(null);
  };

  const toggleExisting = (id) =>
    setExistingChecked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const assignExisting = () => {
    const toAdd = existingChecked.filter((id) => !selectedIds.includes(id));
    if (toAdd.length === 0) return;
    commit([...selectedIds, ...toAdd]);
    setExistingChecked([]);
  };

  const filteredExisting = videos.filter((v) =>
    (v.title || "").toLowerCase().includes(existingSearch.trim().toLowerCase()),
  );

  const existingPageCount = Math.max(
    1,
    Math.ceil(filteredExisting.length / EXISTING_PER_PAGE),
  );
  const existingCurrentPage = Math.min(existingPage, existingPageCount);
  const pagedExisting = filteredExisting.slice(
    (existingCurrentPage - 1) * EXISTING_PER_PAGE,
    existingCurrentPage * EXISTING_PER_PAGE,
  );

  useEffect(() => {
    setExistingPage(1);
  }, [existingSearch]);

  const dnd = {
    start: (e, i) => {
      const row = e.currentTarget.closest(".pv-arow");
      if (row) {
        const rect = row.getBoundingClientRect();
        try {
          e.dataTransfer.setDragImage(
            row,
            e.clientX - rect.left,
            e.clientY - rect.top,
          );
        } catch {}
      }
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", String(i));
      } catch {}
      setTimeout(() => setDragIndex(i), 0);
    },
    over: (e, i) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = e.clientY - rect.top > rect.height / 2 ? "after" : "before";
      if (i !== overIndex || pos !== dropPos) {
        setOverIndex(i);
        setDropPos(pos);
      }
    },
    drop: (e, i) => {
      e.preventDefault();
      if (dragIndex != null && dragIndex !== i) {
        const rect = e.currentTarget.getBoundingClientRect();
        const after = e.clientY - rect.top > rect.height / 2;
        let target = after ? i + 1 : i;
        const next = [...selectedIds];
        const [moved] = next.splice(dragIndex, 1);
        if (dragIndex < target) target -= 1;
        next.splice(target, 0, moved);
        if (next.some((id, idx) => id !== selectedIds[idx])) commit(next);
      }
      setDragIndex(null);
      setOverIndex(null);
      setDropPos(null);
    },
    end: () => {
      setDragIndex(null);
      setOverIndex(null);
      setDropPos(null);
    },
  };

  return (
    <Page
      title="Assign Product Video"
      backAction={{ content: "Products", url: "/app/product-video" }}
      primaryAction={
        previewUrl
          ? {
              content: "Preview",
              icon: ExternalIcon,
              url: previewUrl,
              target: "_blank",
            }
          : undefined
      }
      secondaryActions={
        product.onlineStoreUrl
          ? [
              {
                content: "View on store",
                icon: ExternalIcon,
                url: product.onlineStoreUrl,
                target: "_blank",
              },
            ]
          : undefined
      }
    >
      <Layout>
        {actionData?.ok === false && actionData?.error && (
          <Layout.Section>
            <Banner tone="critical">
              <Text as="p">{actionData.error}</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="400" blockAlign="center">
              <Thumbnail
                source={product.image || FALLBACK_IMG}
                alt={product.title || "No image"}
                size="large"
              />
              <BlockStack gap="100">
                <Text variant="headingLg" as="h1">
                  {product.title}
                </Text>
                <InlineStack gap="300" blockAlign="center">
                  {product.handle && (
                    <Text tone="subdued" as="span">
                      /{product.handle}
                    </Text>
                  )}
                  {assignedVideoIds.length > 0 ? (
                    <Badge tone="success" icon={CheckCircleIcon}>
                      {`${assignedVideoIds.length} player${assignedVideoIds.length > 1 ? "s" : ""} assigned`}
                    </Badge>
                  ) : (
                    <Badge>No players assigned</Badge>
                  )}
                </InlineStack>
              </BlockStack>
            </InlineStack>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text
                variant="headingMd"
                as="h2"
              >{`Assigned players (${selectedIds.length})`}</Text>
              <Text tone="subdued" as="p">
                These play on the product page in this order. Drag a player by
                its handle to reorder, or remove any you don’t need.
              </Text>
            </BlockStack>

            {missingIds.length > 0 && (
              <Banner
                tone="warning"
                title={`${missingIds.length} assigned player${missingIds.length > 1 ? "s were" : " was"} deleted`}
                action={{
                  content: missingIds.length > 1 ? "Remove them" : "Remove it",
                  onAction: dropMissing,
                  loading: busy,
                }}
              >
                <Text as="p">
                  {missingIds.length > 1
                    ? "These players no longer exist in your video list, so they show nothing on the product page."
                    : "This player no longer exists in your video list, so it shows nothing on the product page."}{" "}
                  Remove the assignment, or add another player below.
                </Text>
              </Banner>
            )}

            {selectedIds.length === 0 ? (
              <Banner tone="info">
                No players assigned yet. Add one below.
              </Banner>
            ) : (
              <CustomBox
                className={`pv-alist${dragIndex !== null ? " pv-alist--dragging" : ""}`}
              >
                {selectedIds.map((id, i) => (
                  <AssignedRow
                    key={id}
                    index={i}
                    video={byId[id]}
                    missing={!byId[id]}
                    dragging={dragIndex === i}
                    isOver={overIndex === i && dragIndex !== i}
                    dropPos={dropPos}
                    onEdit={() => navigate(`/app/customize/${id}`)}
                    onRemove={() => setRemoveTarget(id)}
                    dnd={dnd}
                  />
                ))}
              </CustomBox>
            )}
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 8, xl: 8 }}>
              <Card>
                <BlockStack gap="500">
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h2">
                      Add another player
                    </Text>
                    <Text tone="subdued" as="p">
                      Create a brand-new player, or pick one you already have,
                      then assign them to this product.
                    </Text>
                  </BlockStack>

                  <InlineStack align="space-between" blockAlign="center">
                    <ButtonGroup variant="segmented">
                      <Button pressed={tab === 0} onClick={() => setTab(0)}>
                        Create new
                      </Button>
                      <Button
                        pressed={tab === 1}
                        onClick={() => setTab(1)}
                      >{`Use existing (${videos.length})`}</Button>
                    </ButtonGroup>

                    {tab === 1 && (
                      <Button
                        variant="primary"
                        disabled={existingChecked.length === 0 || busy}
                        loading={busy}
                        onClick={assignExisting}
                      >
                        {existingChecked.length === 0
                          ? "Assign to product"
                          : `Assign ${existingChecked.length} player${existingChecked.length > 1 ? "s" : ""}`}
                      </Button>
                    )}
                  </InlineStack>

                  {tab === 0 ? (
                    /* Same gate the Videos page puts on its create modal:
                             without it a shop at its plan limit could keep
                             creating players from this page. */
                    usage.atLimit ? (
                      <Banner
                        tone="critical"
                        title={`You've reached your plan limit of ${usage.max} players`}
                      >
                        <Text as="p">
                          Upgrade your plan to create more video players, or
                          assign one you already have from Use existing.
                        </Text>
                        <Box paddingBlockStart="400">
                          <Button
                            variant="primary"
                            url="/app/pricing"
                            onClick={() => navigate("/app/pricing")}
                          >
                            Upgrade
                          </Button>
                        </Box>
                      </Banner>
                    ) : (
                      <Grid>
                        {PLAYER_TYPES.map((pt) => (
                          <Grid.Cell
                            key={pt.id}
                            columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}
                          >
                            <TypeCard
                              type={pt}
                              selected={playerType === pt.id}
                              onSelect={setPlayerType}
                            />
                          </Grid.Cell>
                        ))}
                      </Grid>
                    )
                  ) : videos.length === 0 ? (
                    <Banner tone="info">
                      You haven't created any players yet. Switch to Create new
                      to make your first one.
                    </Banner>
                  ) : (
                    <BlockStack gap="400">
                      <TextField
                        label="Search players by name"
                        value={existingSearch}
                        onChange={setExistingSearch}
                        autoComplete="off"
                        placeholder="Search players by name..."
                      />

                      <Box>
                        {filteredExisting.length === 0 ? (
                          <Text tone="subdued" as="p">
                            No players match your search.
                          </Text>
                        ) : (
                          pagedExisting.map((v) => (
                            <ExistingRow
                              key={v.id}
                              video={v}
                              assigned={selectedIds.includes(v.id)}
                              checked={existingChecked.includes(v.id)}
                              onToggle={toggleExisting}
                            />
                          ))
                        )}
                      </Box>

                      {existingPageCount > 1 && (
                        <InlineStack
                          align="center"
                          blockAlign="center"
                          gap="400"
                        >
                          <Button
                            icon={ChevronLeftIcon}
                            disabled={existingCurrentPage <= 1}
                            onClick={() =>
                              setExistingPage((p) => Math.max(1, p - 1))
                            }
                          />
                          <Text
                            tone="subdued"
                            as="span"
                          >{`Page ${existingCurrentPage} of ${existingPageCount}`}</Text>
                          <Button
                            icon={ChevronRightIcon}
                            disabled={existingCurrentPage >= existingPageCount}
                            onClick={() =>
                              setExistingPage((p) =>
                                Math.min(existingPageCount, p + 1),
                              )
                            }
                          />
                        </InlineStack>
                      )}
                    </BlockStack>
                  )}

                  {tab === 0 && (
                    <InlineStack align="space-between" blockAlign="center">
                      <Text
                        as="span"
                        tone={usage.atLimit ? "critical" : "subdued"}
                      >{`${usage.label} players used`}</Text>
                      <Button
                        variant="primary"
                        disabled={usage.atLimit}
                        onClick={() => {
                          if (usage.atLimit) return;
                          setCreateOpen(true);
                        }}
                      >
                        Create & assign
                      </Button>
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>
            </Grid.Cell>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 4, xl: 4 }}>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingMd" as="h2">
                      How this works
                    </Text>
                    {youtubeVideoLink && (
                      <Button
                        icon={PlayCircleIcon}
                        onClick={() => setWatchVideoOpen(true)}
                      >
                        Watch Video
                      </Button>
                    )}
                  </InlineStack>
                  <List type="number">
                    {HOW_IT_WORKS_STEPS.map((step, i) => (
                      <List.Item key={i}>
                        <BlockStack gap="200">
                          <Text fontWeight="bold" as="span">
                            {step.title}
                          </Text>
                          <Text tone="subdued" as="p">
                            {step.body}
                          </Text>
                        </BlockStack>
                      </List.Item>
                    ))}
                  </List>
                  <Banner tone="info">
                    <Text as="p">
                      <Text as="span" fontWeight="bold">
                        Tip:
                      </Text>{" "}
                      You have{" "}
                      <Text as="span" fontWeight="bold">
                        {usage.label}
                      </Text>{" "}
                      players available. If you've hit the limit, upgrade your
                      plan to add more.
                    </Text>
                  </Banner>
                </BlockStack>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>
      </Layout>

      <Modal id="pv-watch-video" variant="large">
        <TitleBar title="Watch Video">
          <CustomButton onClick={() => setWatchVideoOpen(false)}>
            Close
          </CustomButton>
        </TitleBar>
        <Box padding="400">
          <CustomBox
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "16 / 9",
            }}
          >
            {watchVideoOpen && youtubeId && (
              <iframe
                src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1`}
                title="Watch Video"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: 0,
                }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                /* Overrides the `Referrer-Policy: same-origin` that production
                   nginx puts on this document. Without a Referer YouTube
                   refuses to play and shows "Error 153". See app/root.jsx. */
                referrerPolicy="strict-origin-when-cross-origin"
              />
            )}
          </CustomBox>
        </Box>
      </Modal>

      <InlinePlayerCreatorModal
        open={createOpen}
        playerType={playerType}
        onClose={() => setCreateOpen(false)}
        onAssigned={(newVideoId) => commit([...selectedIds, newVideoId])}
      />

      <Modal id="pv-remove-player">
        <TitleBar title="Remove this player?">
          <CustomButton
            variant="primary"
            tone="critical"
            onClick={confirmRemove}
          >
            Remove player
          </CustomButton>
          <CustomButton onClick={() => setRemoveTarget(null)}>
            Keep it
          </CustomButton>
        </TitleBar>
        <Box padding="400">
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text tone="subdued" as="p">
                It will be unassigned from this product and stop showing on the
                product page.
              </Text>
            </BlockStack>

            <Box
              padding="400"
              borderRadius="200"
              background="bg-surface-secondary"
            >
              <InlineStack gap="400" blockAlign="center">
                <RowIcon
                  video={byId[removeTarget]}
                  boxed
                  missing={removeTarget != null && !byId[removeTarget]}
                />
                <BlockStack gap="0">
                  <Text fontWeight="bold" as="span">
                    {byId[removeTarget]?.title || "Deleted player"}
                  </Text>
                  <Text tone="subdued" as="span">
                    {!byId[removeTarget]
                      ? "No longer in your video list"
                      : byId[removeTarget]?.data?.playerType === "multiple"
                        ? "Multiple videos"
                        : "Single video"}
                  </Text>
                </BlockStack>
              </InlineStack>
            </Box>

            <Banner tone="info">
              <Text as="p">
                The player isn't deleted — you can re-assign it to any product
                anytime.
              </Text>
            </Banner>
          </BlockStack>
        </Box>
      </Modal>
    </Page>
  );
}
