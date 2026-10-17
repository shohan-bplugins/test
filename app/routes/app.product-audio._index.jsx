import { useState, useMemo } from "react";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { debounce } from "../utils/debounce";
import Modal from "../components/PolarisWeb/WebModal";
import { WebSearchField, WebSelect } from "../components/PolarisWeb/fields";
import { EmptyState } from "../components/PageState/PageState";
import HowItWorksSteps from "../components/ProductAudio/HowItWorksSteps";
import YouTubeModal from "../components/YouTubeModal/YouTubeModal";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { parseAssignedIds } from "../lib/product-audio.server";
import "../styles/styles.css";
import { useSupport } from "../components/SupportForm/SupportProvider";

const NS = "audio_player_by_bplugins";
const KEY_ASSIGNED_ID = "assigned_audio_id";
const KEY_ASSIGNED_IDS = "assigned_audio_ids";
const PAGE_SIZE = 10;

// Shops whose metafield definitions were already created by this server
// process — creating them is only needed once, not on every page load.
const definedShops = new Set();

async function ensureMetafieldDefinition(admin, shop) {
  if (definedShops.has(shop)) return;
  const createDefinition = (definition) =>
    admin
      .graphql(
        `#graphql
      mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id name }
          userErrors { field message code }
        }
      }`,
        { variables: { definition } },
      )
      .catch(() => {
        // Already exists or harmless — keep going
      });

  // Legacy single-value key (kept for backward compatibility) + the multi-value
  // list key used for assigning several players to one product.
  await Promise.all([
    createDefinition({
      name: "Assigned Audio Player",
      namespace: NS,
      key: KEY_ASSIGNED_ID,
      description:
        "ID of the audio player from Audio Player by bPlugins assigned to this product.",
      type: "single_line_text_field",
      pin: true,
      ownerType: "PRODUCT",
      access: { storefront: "PUBLIC_READ" },
    }),
    createDefinition({
      name: "Assigned Audio Players",
      namespace: NS,
      key: KEY_ASSIGNED_IDS,
      description:
        "Ordered list of audio player IDs from Audio Player by bPlugins assigned to this product.",
      type: "list.single_line_text_field",
      pin: true,
      ownerType: "PRODUCT",
      access: { storefront: "PUBLIC_READ" },
    }),
  ]);
  definedShops.add(shop);
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";

  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() ?? "";
  const status = url.searchParams.get("status") ?? ""; // active | draft | archived
  const sort = url.searchParams.get("sort") ?? "az";
  const cursor = url.searchParams.get("cursor") ?? null;
  const direction = url.searchParams.get("dir") ?? "next";

  // Build Shopify's product search query from the title search + status filter.
  const queryParts = [];
  if (search) queryParts.push(`title:*${search}*`);
  if (status) queryParts.push(`status:${status}`);
  const queryString = queryParts.length ? queryParts.join(" AND ") : null;

  // Map the sort option to Shopify's sortKey + reverse.
  const sortMap = {
    az: { sortKey: "TITLE", reverse: false },
    za: { sortKey: "TITLE", reverse: true },
    newest: { sortKey: "CREATED_AT", reverse: true },
    oldest: { sortKey: "CREATED_AT", reverse: false },
  };
  const { sortKey, reverse } = sortMap[sort] ?? sortMap.az;

  const variables = {
    first: direction === "prev" ? null : PAGE_SIZE,
    last: direction === "prev" ? PAGE_SIZE : null,
    after: direction === "prev" ? null : cursor,
    before: direction === "prev" ? cursor : null,
    query: queryString,
    sortKey,
    reverse,
  };

  // Independent requests run together instead of one after another. Reading
  // the metafields below doesn't need their definitions to exist yet.
  const productsQuery = admin.graphql(
    `#graphql
      query Products(
        $first: Int
        $last: Int
        $after: String
        $before: String
        $query: String
        $sortKey: ProductSortKeys
        $reverse: Boolean
      ) {
        products(
          first: $first
          last: $last
          after: $after
          before: $before
          query: $query
          sortKey: $sortKey
          reverse: $reverse
        ) {
          edges {
            cursor
            node {
              id
              title
              handle
              status
              featuredImage {
                # Thumbnails render at 40px; don't download the original.
                url(transform: { maxWidth: 80, maxHeight: 80 })
                altText
              }
              assignedList: metafield(namespace: "${NS}", key: "${KEY_ASSIGNED_IDS}") {
                id value
              }
              assigned: metafield(namespace: "${NS}", key: "${KEY_ASSIGNED_ID}") {
                id value
              }
            }
          }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      }`,
    { variables },
  );

  const [productsRes, audios] = await Promise.all([
    productsQuery,
    prisma.audio.findMany({
      where: { shop },
      select: { id: true, title: true, playerType: true },
    }),
    ensureMetafieldDefinition(admin, shop),
  ]);

  const json_ = await productsRes.json();
  // A failed query shows the error page (with Try again) — not a misleading
  // "no products" state.
  if (json_?.errors?.length) {
    console.error("Products query failed:", JSON.stringify(json_.errors));
    throw new Error("Couldn't load products from Shopify.");
  }
  const edges = json_?.data?.products?.edges ?? [];
  const pageInfo = json_?.data?.products?.pageInfo ?? {};
  const audioById = Object.fromEntries(audios.map((a) => [a.id, a]));

  const products = edges.map((e) => {
    const node = e.node;
    const ids = parseAssignedIds(
      node?.assignedList?.value,
      node?.assigned?.value,
    );
    const resolved = ids.map((id) => audioById[id]).filter(Boolean);
    return {
      id: node.id,
      cursor: e.cursor,
      title: node.title,
      handle: node.handle,
      status: node.status ?? null,
      featuredImageUrl: node.featuredImage?.url ?? null,
      featuredImageAlt: node.featuredImage?.altText ?? null,
      assignedCount: ids.length,
      assignedAudioTitle: resolved[0]?.title ?? null,
      assignedAudioType: resolved[0]?.playerType ?? null,
      isOrphaned: ids.length > 0 && resolved.length < ids.length,
    };
  });

  const assignedCount = products.filter((p) => p.assignedCount > 0).length;

  return json({
    products,
    pageInfo,
    audiosCount: audios.length,
    assignedCount,
    search,
    status,
    sort,
    shop,
  });
};

function shortId(gid) {
  return String(gid).split("/").pop() ?? gid;
}

function playerTypeLabel(t) {
  switch (t) {
    case "single-audio":
      return "Single";
    case "playlist-audio":
      return "Playlist";
    case "sticky-player":
      return "Sticky";
    case "sticky-single-button":
      return "Button";
    default:
      return "Player";
  }
}

function statusBadge(status) {
  switch (status) {
    case "ACTIVE":
      return <s-badge tone="success">Active</s-badge>;
    case "DRAFT":
      return <s-badge tone="info">Draft</s-badge>;
    case "ARCHIVED":
      return <s-badge>Archived</s-badge>;
    default:
      return <s-badge>—</s-badge>;
  }
}

const STATUS_OPTIONS = [
  { label: "All statuses", value: "" },
  { label: "Active", value: "active" },
  { label: "Draft", value: "draft" },
  { label: "Archived", value: "archived" },
];

const HOW_TO_STEPS = [
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
    desc: "Use the search bar on this page to find the product you want to add audio to. You can search by product title.",
  },
  {
    title: "Assign a Player",
    desc: (
      <>
        Click the <s-text type="strong">Assign</s-text> button next to the
        product. On the product detail page, choose one or more audio players
        from your list and save.
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
        Products that already have a player assigned show a{" "}
        <s-text type="strong">Manage</s-text> button. Click it to add more
        players, reorder them, or remove the assignment at any time.
      </>
    ),
  },
];

const VIDEO_SRC =
  "https://www.youtube-nocookie.com/embed/8vWlS-4gIkc?autoplay=1&mute=1&playsinline=1&rel=0";
export default function ProductsIndex() {
  const openSupport = useSupport();
  const {
    products,
    pageInfo,
    audiosCount,
    assignedCount,
    search,
    status,
    shop,
  } = useLoaderData();
  const navigate = useNavigate();
  const nav = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(search);
  const [showHowTo, setShowHowTo] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  // Mutate the URL params (preserving search/status), always resetting
  // cursor pagination so a changed query/filter/sort starts from page one.
  const pushParams = (mutate) => {
    const params = new URLSearchParams(searchParams);
    mutate(params);
    params.delete("cursor");
    params.delete("dir");
    setSearchParams(params);
  };

  // Auto-search: debounced so the loader only re-runs once the user pauses.
  const debouncedSearch = useMemo(
    () =>
      debounce((value) => {
        pushParams((p) => {
          if (value.trim()) p.set("q", value.trim());
          else p.delete("q");
        });
      }, 400),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams],
  );

  const handleSearchChange = (value) => {
    setQuery(value);
    debouncedSearch(value);
  };

  const handleStatusChange = (value) =>
    pushParams((p) => {
      if (value) p.set("status", value);
      else p.delete("status");
    });

  const handleClearAll = () => {
    debouncedSearch.cancel();
    setQuery("");
    pushParams((p) => {
      p.delete("q");
      p.delete("status");
    });
  };

  const goPage = (dir, cursor) => {
    const params = new URLSearchParams(searchParams);
    if (cursor) {
      params.set("cursor", cursor);
      params.set("dir", dir);
    } else {
      params.delete("cursor");
      params.delete("dir");
    }
    setSearchParams(params);
  };

  const hasActiveFilter = !!(search || status);
  // Search / status / page change in progress on this page.
  const isRefreshing =
    nav.state === "loading" && nav.location?.pathname === "/app/product-audio";
  const openProduct = (p) => navigate(`/app/product-audio/${shortId(p.id)}`);

  return (
    <s-page inlineSize="large">
      <ui-title-bar title="Product Audio">
        <button onClick={() => openSupport()}>Support</button>
        <button variant="breadcrumb" onClick={() => navigate("/app")}>
          Dashboard
        </button>
      </ui-title-bar>

      <s-stack gap="base">
        <s-stack
          direction="inline"
          justifyContent="space-between"
          alignItems="center"
          gap="base"
        >
          <s-stack gap="small-300">
            <s-heading>Product Audio</s-heading>
            <s-text color="subdued">
              Assign an audio player to any product. {assignedCount} of{" "}
              {products.length} products on this page have a player assigned.
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="small-200">
            <s-button icon="question-circle" onClick={() => setShowHowTo(true)}>
              How it works
            </s-button>
            <s-button icon="play-circle" onClick={() => setShowVideo(true)}>
              Watch video
            </s-button>
          </s-stack>
        </s-stack>

        {audiosCount === 0 ? (
          <s-banner tone="info" heading="Create a player first">
            <s-stack gap="small">
              <s-paragraph>
                You need at least one audio player before you can assign it to
                a product.
              </s-paragraph>
              <s-stack direction="inline">
                <s-button
                  variant="primary"
                  icon="plus"
                  onClick={() => navigate("/app/audios?action=new")}
                >
                  Create a player
                </s-button>
              </s-stack>
            </s-stack>
          </s-banner>
        ) : null}

        <s-section padding="none">
          <s-stack gap="none">
            {/* Toolbar: search · status filter */}
            <s-box padding="base">
              <s-grid
                gridTemplateColumns="minmax(0, 1fr) auto auto"
                gap="small"
                alignItems="center"
              >
                <WebSearchField
                  label="Search products"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="Search products by title"
                  value={query}
                  onChange={handleSearchChange}
                />
                <WebSelect
                  label="Product status"
                  labelAccessibilityVisibility="exclusive"
                  value={status || ""}
                  options={STATUS_OPTIONS}
                  onChange={handleStatusChange}
                />
                {nav.state === "loading" ? (
                  <s-spinner
                    size="base"
                    accessibilityLabel="Loading products"
                  ></s-spinner>
                ) : hasActiveFilter ? (
                  <s-button variant="tertiary" onClick={handleClearAll}>
                    Clear filters
                  </s-button>
                ) : (
                  <s-box></s-box>
                )}
              </s-grid>
            </s-box>

            {products.length === 0 ? (
              hasActiveFilter ? (
                <EmptyState
                  heading={
                    search
                      ? `No products match "${search}"`
                      : "No products with this status"
                  }
                  message="Try a different search term or clear the filters."
                  action={
                    <s-button onClick={handleClearAll}>Clear filters</s-button>
                  }
                />
              ) : (
                <EmptyState
                  heading="No products in this store yet"
                  message="Add products in Shopify, then come back to assign audio players to them."
                  action={
                    <s-button
                      icon="external"
                      onClick={() =>
                        window.open(
                          `https://${shop}/admin/products/new`,
                          "_blank",
                        )
                      }
                    >
                      Add a product
                    </s-button>
                  }
                />
              )
            ) : (
              <s-table loading={isRefreshing || undefined}>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Product</s-table-header>
                  <s-table-header>Status</s-table-header>
                  <s-table-header>Audio player</s-table-header>
                  <s-table-header>Action</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {products.map((p) => (
                    <s-table-row key={p.id}>
                      <s-table-cell>
                        <s-stack
                          direction="inline"
                          gap="small"
                          alignItems="center"
                        >
                          {p.featuredImageUrl ? (
                            <s-thumbnail
                              src={p.featuredImageUrl}
                              alt={p.featuredImageAlt ?? p.title}
                              size="small"
                            ></s-thumbnail>
                          ) : (
                            <s-box
                              inlineSize="40px"
                              blockSize="40px"
                              background="subdued"
                              border="base"
                              borderRadius="base"
                            ></s-box>
                          )}
                          <s-stack gap="small-500">
                            <s-link onClick={() => openProduct(p)}>
                              {p.title}
                            </s-link>
                            <s-text color="subdued">/{p.handle}</s-text>
                          </s-stack>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>{statusBadge(p.status)}</s-table-cell>
                      <s-table-cell>
                        {p.assignedCount > 0 ? (
                          <s-stack direction="inline" gap="small-200">
                            <s-badge tone="success" icon="check-circle">
                              {p.assignedCount === 1
                                ? (p.assignedAudioTitle ?? "Assigned")
                                : `${p.assignedCount} players`}
                            </s-badge>
                            {p.isOrphaned ? (
                              <s-badge tone="warning" icon="alert-circle">
                                Needs attention
                              </s-badge>
                            ) : p.assignedCount === 1 ? (
                              <s-badge>
                                {playerTypeLabel(p.assignedAudioType)}
                              </s-badge>
                            ) : null}
                          </s-stack>
                        ) : (
                          <s-badge>Not assigned</s-badge>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-200">
                          {shop && p.handle ? (
                            <s-button
                              variant="tertiary"
                              icon="external"
                              onClick={() =>
                                window.open(
                                  `https://${shop}/products/${p.handle}`,
                                  "_blank",
                                  "noopener,noreferrer",
                                )
                              }
                            >
                              Preview
                            </s-button>
                          ) : null}
                          {/* Assign = call to action; Manage = quieter edit. */}
                          {p.assignedCount > 0 ? (
                            <s-button
                              icon="edit"
                              onClick={() => openProduct(p)}
                            >
                              Manage
                            </s-button>
                          ) : (
                            <s-button
                              variant="primary"
                              icon="plus"
                              onClick={() => openProduct(p)}
                            >
                              Assign
                            </s-button>
                          )}
                        </s-stack>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}

            {pageInfo.hasPreviousPage || pageInfo.hasNextPage ? (
              <s-box padding="base">
                <s-stack
                  direction="inline"
                  gap="small"
                  alignItems="center"
                  justifyContent="center"
                >
                  <s-button
                    icon="chevron-left"
                    accessibilityLabel="Previous page"
                    disabled={
                      !pageInfo.hasPreviousPage || isRefreshing || undefined
                    }
                    onClick={() => goPage("prev", pageInfo.startCursor)}
                  ></s-button>
                  <s-button
                    icon="chevron-right"
                    accessibilityLabel="Next page"
                    disabled={
                      !pageInfo.hasNextPage || isRefreshing || undefined
                    }
                    onClick={() => goPage("next", pageInfo.endCursor)}
                  ></s-button>
                </s-stack>
              </s-box>
            ) : null}
          </s-stack>
        </s-section>
      </s-stack>

      <Modal
        open={showHowTo}
        onClose={() => setShowHowTo(false)}
        title="How to use Product Audio"
      >
        <Modal.Section>
          <s-stack gap="base">
            <HowItWorksSteps steps={HOW_TO_STEPS} />
            <s-banner tone="info">
              <s-text type="strong">Tip:</s-text> The count at the top shows how
              many products have a player. If you have no players yet, create
              one first before returning here.
            </s-banner>
          </s-stack>
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
