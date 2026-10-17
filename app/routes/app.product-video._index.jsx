import { json } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useSearchParams,
  useNavigation,
} from "@remix-run/react";
import {
  Page,
  IndexTable,
  EmptyState,
  Filters,
  Button,
  ButtonGroup,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Thumbnail,
  List,
  Box,
  Banner,
} from "@shopify/polaris";
import { PlayCircleIcon, QuestionCircleIcon, ChevronLeftIcon, ChevronRightIcon, LinkIcon, EditIcon, ExternalIcon } from "@shopify/polaris-icons";
import { useState, useCallback, useRef, useEffect } from "react";
import { Modal, TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import "../styles/styles.css";
import "../styles/product-video.css";
import "../styles/plyr.css";
import { verifyShopPlan } from "../utils/planSync.server";

const FALLBACK_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' rx='6' fill='#f1f2f3'/><path d='M13 26l5-6 4 4 3-4 4 6z' fill='#c9ccd0'/><circle cx='16' cy='15' r='2.5' fill='#c9ccd0'/></svg>`,
  );

const PAGE_SIZE = 10;

// Steps shown in the "How it works" guide modal.
const HOW_IT_WORKS_STEPS = [
  {
    title: "Create or upload a video",
    body: "Go to the Videos page and add a video — upload your own file, paste a video URL, or pick an existing player.",
  },
  {
    title: "Open a product",
    body: "From this Product Video list, click any product (or its “Assign video” button) to manage the videos for it.",
  },
  {
    title: "Assign your video",
    body: "Choose one or more videos and assign them to the product. You can reorder them anytime.",
  },
  {
    title: "Add the app block to your theme",
    body: "In the theme editor, open a product page and add the “Product Video” app block where you want the video to appear.",
  },
  {
    title: "Save & publish",
    body: "Save your theme and the assigned video goes live on the product page for your customers.",
  },
];

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  // Confirm the stored plan against Shopify billing before anything reads it.
  await verifyShopPlan(admin, session.shop);
  const shop = session.shop;

  // URL-driven cursor pagination: ?after=<cursor> pages forward,
  // ?before=<cursor> pages backward. Default (neither) is the first page.
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const q = url.searchParams.get("q");
  const queryStr = q ? `title:*${q}*` : null;

  const paginate = before
    ? { first: null, last: PAGE_SIZE, after: null, before, query: queryStr }
    : {
        first: PAGE_SIZE,
        last: null,
        after: after || null,
        before: null,
        query: queryStr,
      };

  const response = await admin.graphql(
    `#graphql
    query ProductsWithVideo($first: Int, $last: Int, $after: String, $before: String, $query: String) {
      products(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: TITLE) {
        edges {
          node {
            id
            title
            status
            handle
            featuredImage { url altText }
            metafield(namespace: "bplugins", key: "product_video") { value type }
          }
        }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      }
    }`,
    { variables: paginate },
  );
  const result = await response.json();
  const products = (result?.data?.products?.edges || []).map((e) => e.node);
  const pageInfo = result?.data?.products?.pageInfo || {
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: null,
    endCursor: null,
  };

  // Map video ids -> titles so we can label what's already assigned.
  const videos = await prisma.Video.findMany({
    where: { shop },
    select: { id: true, title: true },
  });
  const videoTitle = Object.fromEntries(videos.map((v) => [v.id, v.title]));

  // A product can have one or many videos (stored as a list metafield).
  const parseIds = (mf) => {
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

  const items = products.map((p) => {
    const videoIds = parseIds(p.metafield);
    // The assignment lives in the product metafield, the player in Mongo, so
    // deleting a player leaves its id behind here. Those ids used to be counted
    // as real videos and the first of them labelled "Video: video".
    const liveIds = videoIds.filter((id) => videoTitle[id] !== undefined);
    const missingCount = videoIds.length - liveIds.length;
    const firstTitle = liveIds.length ? videoTitle[liveIds[0]] || "video" : null;
    return {
      id: p.id,
      numericId: p.id.split("/").pop(),
      title: p.title,
      status: p.status,
      handle: p.handle,
      image: p.featuredImage?.url || null,
      videoCount: liveIds.length,
      missingCount,
      label:
        liveIds.length === 0
          ? null
          : liveIds.length === 1
            ? `Video: ${firstTitle}`
            : `${liveIds.length} videos`,
    };
  });

  return json({
    items,
    pageInfo,
    shop,
    youtubeVideoLink:
      process.env.YOUTUBE_VIDEO_LINK || "https://youtu.be/X29IJ5UvBKw",
  });
};

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

export default function ProductVideoList() {
  const { items, pageInfo, shop, youtubeVideoLink } = useLoaderData();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const loading = navigation.state === "loading";

  // Products on THIS page whose metafield still points at a deleted player.
  // Cursor pagination means we only ever see one page of products, so the
  // banner is worded for what is on screen rather than the whole catalogue.
  const brokenItems = items.filter((it) => it.missingCount > 0);

  const q = searchParams.get("q") || "";
  const [queryValue, setQueryValue] = useState(q);
  const timerRef = useRef(null);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [watchVideoOpen, setWatchVideoOpen] = useState(false);

  // Both dialogs are App Bridge <ui-modal>s, shown and hidden by id. The React
  // state stays the source of truth so the existing callers are unchanged, and
  // the `hide` listeners keep it in sync when the dialog is closed by Esc or by
  // its own close button.
  useEffect(() => {
    if (howItWorksOpen) shopify.modal.show("pv-how-it-works");
    else shopify.modal.hide("pv-how-it-works");
  }, [howItWorksOpen]);

  useEffect(() => {
    if (watchVideoOpen) shopify.modal.show("pv-watch-video");
    else shopify.modal.hide("pv-watch-video");
  }, [watchVideoOpen]);

  useEffect(() => {
    const pairs = [
      ["pv-how-it-works", () => setHowItWorksOpen(false)],
      ["pv-watch-video", () => setWatchVideoOpen(false)],
    ];
    const bound = pairs
      .map(([id, fn]) => [document.getElementById(id), fn])
      .filter(([el]) => el);
    bound.forEach(([el, fn]) => el.addEventListener("hide", fn));
    return () =>
      bound.forEach(([el, fn]) => el.removeEventListener("hide", fn));
  }, []);

  const playerRef = useRef(null);

  const youtubeId = getYoutubeId(youtubeVideoLink);

  useEffect(() => {
    let player;
    if (watchVideoOpen && youtubeId && playerRef.current) {
      // Small delay to ensure DOM is ready inside Modal
      setTimeout(() => {
        if (playerRef.current) {
          player = new window.Plyr(playerRef.current, {
            playsInline: true,
            autoplay: true,
            youtube: {
              noCookie: false,
              rel: 0,
              showinfo: 0,
              iv_load_policy: 3,
              modestbranding: 1,
              controls: 0,
            },
          });
        }
      }, 100);
    }
    return () => {
      if (player) {
        player.destroy();
      }
    };
  }, [watchVideoOpen, youtubeId]);

  const handleQueryValueChange = useCallback(
    (value) => {
      setQueryValue(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("q", value);
          else next.delete("q");
          next.delete("after");
          next.delete("before");
          return next;
        });
      }, 400);
    },
    [setSearchParams],
  );

  const handleQueryValueRemove = useCallback(() => {
    handleQueryValueChange("");
  }, [handleQueryValueChange]);

  const handleClearAll = useCallback(() => {
    handleQueryValueRemove();
  }, [handleQueryValueRemove]);

  const goNext = () => {
    if (!pageInfo.endCursor) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("after", pageInfo.endCursor);
      next.delete("before");
      return next;
    });
  };
  const goPrevious = () => {
    if (!pageInfo.startCursor) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("before", pageInfo.startCursor);
      next.delete("after");
      return next;
    });
  };

  const filterControl = (
    <Filters
      queryValue={queryValue}
      queryPlaceholder="Search products by title..."
      filters={[]}
      appliedFilters={[]}
      onQueryChange={handleQueryValueChange}
      onQueryClear={handleQueryValueRemove}
      onClearAll={handleClearAll}
    />
  );

  return (
    <Page
      title="Product Video"
      fullWidth
      primaryAction={{
        content: "Watch Video",
        icon: PlayCircleIcon,
        onAction: () => {
          setWatchVideoOpen(!watchVideoOpen);
          shopify.modal.show("pv-watch-video");
        },
      }}
      secondaryActions={[
        {
          content: "How it works",
          icon: QuestionCircleIcon,
          onAction: () => {
            setHowItWorksOpen(!howItWorksOpen);
            shopify.modal.show("pv-how-it-works");
          },
        },
      ]}
    >
      <Modal id="pv-watch-video" variant="large">
        <TitleBar title="Watch Video">
          <button onClick={() => setWatchVideoOpen(false)}>Close</button>
        </TitleBar>
        <Box padding="400">
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "16 / 9",
            }}
          >
            {watchVideoOpen && youtubeId && (
              <iframe
                src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&showinfo=0&iv_load_policy=3&modestbranding=1&controls=1`}
                title="Watch Video"
                width="100%"
                height="100%"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: 0,
                }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                /* Overrides the `Referrer-Policy: same-origin` that production
                   nginx puts on this document. Without a Referer YouTube
                   refuses to play and shows "Error 153". See app/root.jsx. */
                referrerPolicy="strict-origin-when-cross-origin"
              />
            )}
          </div>
        </Box>
      </Modal>

      <Modal id="pv-how-it-works" variant="large">
        <TitleBar title="How it works">
          <button onClick={() => setHowItWorksOpen(false)}>Close</button>
        </TitleBar>
        <Box padding="400">
          <BlockStack gap="400">
            <Text tone="subdued" as="p">
              Follow these steps to show a video on your product pages.
            </Text>
            <List type="number">
              {HOW_IT_WORKS_STEPS.map((step, i) => (
                <List.Item key={i}>
                  <BlockStack gap="200">
                    <Text fontWeight="bold" as="span">{step.title}</Text>
                    <Text tone="subdued" as="p">{step.body}</Text>
                  </BlockStack>
                </List.Item>
              ))}
            </List>
          </BlockStack>
        </Box>
      </Modal>

      {brokenItems.length > 0 && (
        <Box paddingBlockEnd="400">
          <Banner
            tone="warning"
            title={`${brokenItems.length} product${brokenItems.length > 1 ? "s" : ""} on this page use${brokenItems.length > 1 ? "" : "s"} a deleted player`}
          >
            <Text as="p">
              The video player assigned to{" "}
              {brokenItems.length > 1 ? "these products" : "this product"} was
              deleted from your video list, so nothing shows on the product
              page. Open{" "}
              {brokenItems.length > 1
                ? "a product marked Deleted"
                : `“${brokenItems[0].title}”`}{" "}
              to remove the assignment or pick another player.
            </Text>
          </Banner>
        </Box>
      )}

      <Card padding="0">
        <Box padding="400" paddingBlockEnd="0">
          {filterControl}
        </Box>
        {items.length === 0 ? (
          <EmptyState
            heading="No products found"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <Text as="p">
              {q
                ? "Try changing your search to find what you're looking for."
                : "Create a product in your store to assign a video to it."}
            </Text>
          </EmptyState>
        ) : (
          <IndexTable
            resourceName={{ singular: "product", plural: "products" }}
            itemCount={items.length}
            selectable={false}
            headings={[
              { title: "Product" },
              { title: "Status" },
              { title: "Video" },
              { title: "", hidden: true },
            ]}
          >
            {items.map((item, index) => {
              const {
                id,
                numericId,
                title,
                status,
                handle,
                image,
                videoCount,
                missingCount,
                label,
              } = item;
              const to = `/app/product-video/${numericId}`;

              const statusTone =
                status === "ACTIVE"
                  ? "success"
                  : status === "DRAFT"
                    ? "info"
                    : undefined;
              const displayStatus = status
                ? status.charAt(0) + status.slice(1).toLowerCase()
                : "";

              return (
                <IndexTable.Row
                  id={id}
                  key={id}
                  position={index}
                  onClick={() => navigate(to)}
                >
                  <IndexTable.Cell>
                    <InlineStack gap="300" blockAlign="center" wrap={false}>
                      <Thumbnail
                        source={image || FALLBACK_IMG}
                        alt={title}
                        size="small"
                      />
                      <Box>
                        <Text fontWeight="bold" as="span" truncate>
                          {title}
                        </Text>
                      </Box>
                    </InlineStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {displayStatus && (
                      <Badge tone={statusTone}>{displayStatus}</Badge>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="100" blockAlign="center">
                      {videoCount > 0 ? (
                        <Badge tone="success">{label}</Badge>
                      ) : (
                        missingCount === 0 && <Badge>No video</Badge>
                      )}
                      {missingCount > 0 && (
                        <Badge tone="critical">
                          {`${missingCount} deleted`}
                        </Badge>
                      )}
                    </InlineStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <div onClick={(e) => e.stopPropagation()}>
                      <ButtonGroup>
                        <Button
                          icon={ExternalIcon}
                          accessibilityLabel="Preview product"
                          disabled={status !== "ACTIVE"}
                          url={`https://${shop}/products/${handle}`}
                          target="_blank"
                        >
                          Preview
                        </Button>
                        <Button
                          icon={videoCount === 0 ? LinkIcon : EditIcon}
                          onClick={() => navigate(to)}
                          variant={videoCount === 0 ? "primary" : undefined}
                        >
                          {videoCount > 0 ? "Update" : "Assign"}
                        </Button>
                      </ButtonGroup>
                    </div>
                  </IndexTable.Cell>
                </IndexTable.Row>
              );
            })}
          </IndexTable>
        )}
        {items.length > 0 &&
          (pageInfo.hasNextPage || pageInfo.hasPreviousPage) && (
            <Box padding="400" borderBlockStartWidth="025" borderColor="border">
              <InlineStack align="center">
                <ButtonGroup>
                  <Button
                    icon={ChevronLeftIcon}
                    accessibilityLabel="Previous page"
                    disabled={!pageInfo.hasPreviousPage || loading}
                    onClick={goPrevious}
                  />
                  <Button
                    icon={ChevronRightIcon}
                    accessibilityLabel="Next page"
                    disabled={!pageInfo.hasNextPage || loading}
                    onClick={goNext}
                  />
                </ButtonGroup>
              </InlineStack>
            </Box>
          )}
      </Card>
    </Page>
  );
}
