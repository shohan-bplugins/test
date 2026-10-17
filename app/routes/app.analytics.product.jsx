import { useCallback, useMemo } from "react";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useNavigation,
  useSearchParams,
  useNavigate,
  useRevalidator,
} from "@remix-run/react";
import { WebSelect } from "../components/PolarisWeb/fields";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import DateFilter from "../components/DateFilter/DateFilter";
import AnalyticsBody from "../components/AnalyticsBody/AnalyticsBody";
import TopPlayedRanking from "../components/TopPlayedRanking/TopPlayedRanking";
import { EmptyState, ErrorState } from "../components/PageState/PageState";
import {
  ALL_PLAYERS_VALUE,
  COMING_SOON_PLAYER_TYPES,
} from "../lib/analytics-shared";
import {
  buildAnalytics,
  buildPlayerRanking,
  loadShopPlan,
} from "../lib/analytics.server";
import { loadProductAssignments } from "../lib/product-audio.server";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop;

  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") || "all";
  const customFrom = url.searchParams.get("from") || "";
  const customTo = url.searchParams.get("to") || "";
  const requestedProductId =
    url.searchParams.get("productId") || ALL_PLAYERS_VALUE;

  const { isFree } = await loadShopPlan(shop);

  const audios = await prisma.audio.findMany({
    where: { shop },
    select: { id: true, title: true, playerType: true },
    orderBy: { createdAt: "desc" },
  });

  const supportedAudios = audios.filter(
    (a) => !COMING_SOON_PLAYER_TYPES.has(a.playerType),
  );
  const supportedIdSet = new Set(supportedAudios.map((a) => a.id));

  // Flag a failed lookup so the page can offer a retry instead of claiming
  // no products have audio.
  let assignments = [];
  let assignmentsFailed = false;
  try {
    assignments = await loadProductAssignments(admin);
  } catch (e) {
    console.error("product loader: assignment lookup failed", e);
    assignmentsFailed = true;
  }

  // Only assignments whose target audio still exists and is supported.
  const products = assignments
    .filter((a) => supportedIdSet.has(a.audioId))
    .sort((a, b) => a.productTitle.localeCompare(b.productTitle));

  const productAudioIds = Array.from(new Set(products.map((p) => p.audioId)));

  const isAllProducts = requestedProductId === ALL_PLAYERS_VALUE;
  const selectedProduct = !isAllProducts
    ? (products.find((p) => p.productId === requestedProductId) ?? null)
    : null;
  const effectiveProductId = selectedProduct
    ? selectedProduct.productId
    : ALL_PLAYERS_VALUE;

  const empty = {
    totalPlay: 0,
    avgPlayTime: 0,
    uniqueDevices: 0,
    sumaryData: { devices: {}, browsers: {}, os: {}, totalDuration: 0 },
    dailyPlays: [],
    countryPlays: [],
  };

  // A product can have several audios assigned — gather all of them so the
  // total reflects every assigned player, not just the first assignment.
  const selectedProductAudioIds = selectedProduct
    ? Array.from(
        new Set(
          products
            .filter((p) => p.productId === selectedProduct.productId)
            .map((p) => p.audioId),
        ),
      )
    : [];

  let analytics = { ...empty };
  try {
    if (selectedProduct) {
      analytics = await buildAnalytics({
        shop,
        audioIds: selectedProductAudioIds,
        filter,
        customFrom,
        customTo,
        isFree,
      });
    } else if (productAudioIds.length > 0) {
      analytics = await buildAnalytics({
        shop,
        audioIds: productAudioIds,
        filter,
        customFrom,
        customTo,
        isFree,
      });
    }
  } catch (e) {
    console.error("product analytics build failed", e);
  }

  // Ranking of top-played products for the selected period (All Products view).
  // Optional extra — if it fails, hide it rather than failing the page.
  let ranking = [];
  let ranked = null;
  if (isAllProducts && productAudioIds.length > 0) {
    try {
      ranked = await buildPlayerRanking({
        shop,
        audioIds: productAudioIds,
        filter,
        customFrom,
        customTo,
      });
    } catch (e) {
      console.error("product ranking build failed", e);
    }
  }
  if (ranked) {
    const playsByAudio = Object.fromEntries(
      ranked.map((r) => [r.audioId, r.plays]),
    );
    // Sum plays across every audio assigned to a product so products with
    // multiple players show their combined total.
    const playsByProduct = new Map();
    const titleByProduct = new Map();
    const seenPair = new Set();
    products.forEach((p) => {
      // Guard against duplicate (product, audio) assignment rows so an audio's
      // plays are added to a product at most once.
      const pair = `${p.productId}::${p.audioId}`;
      if (seenPair.has(pair)) return;
      seenPair.add(pair);
      playsByProduct.set(
        p.productId,
        (playsByProduct.get(p.productId) || 0) + (playsByAudio[p.audioId] || 0),
      );
      if (!titleByProduct.has(p.productId)) {
        titleByProduct.set(p.productId, p.productTitle);
      }
    });
    ranking = Array.from(playsByProduct.entries())
      .map(([productId, plays]) => ({
        id: productId,
        title: titleByProduct.get(productId),
        plays,
      }))
      .filter((p) => p.plays > 0)
      .sort((a, b) => b.plays - a.plays);

    // In the All Products view, show Total Plays as the sum of the per-product
    // ranking so the total and the ranking reconcile. (A player assigned to
    // multiple products is counted under each product, so this can exceed the
    // number of unique play events.)
    const rankingTotal = ranking.reduce((sum, r) => sum + (r.plays || 0), 0);
    analytics = { ...analytics, totalPlay: rankingTotal };
  }

  return json({
    ...analytics,
    audios,
    products,
    selectedProductId: effectiveProductId,
    selectedProduct,
    ranking,
    filter,
    customFrom,
    customTo,
    isFree,
    hasSupportedAudios: supportedAudios.length > 0,
    productCount: products.length,
    assignmentsFailed,
  });
}

// Human label for the active date filter, shown next to the ranking heading.
function periodLabelFor(filter) {
  switch (filter) {
    case "today":
      return "Today";
    case "last7":
      return "Last 7 days";
    case "last30":
      return "Last 30 days";
    case "custom":
      return "Selected range";
    default:
      return "All time";
  }
}

export default function ProductTab() {
  const data = useLoaderData();
  const nav = useNavigation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();

  const isLoading = nav.state === "loading" || nav.state === "submitting";
  const audios = data?.audios || [];
  const products = data?.products || [];

  const handleFilterChange = (formData) => {
    const next = new URLSearchParams(searchParams);
    const filter = formData.get("filter") || "today";
    next.set("filter", filter);
    if (filter === "custom") {
      const from = formData.get("from");
      const to = formData.get("to");
      if (from) next.set("from", from);
      else next.delete("from");
      if (to) next.set("to", to);
      else next.delete("to");
    } else {
      next.delete("from");
      next.delete("to");
    }
    setSearchParams(next, { replace: true });
  };

  const handleProductChange = useCallback(
    (value) => {
      const next = new URLSearchParams(searchParams);
      if (value === ALL_PLAYERS_VALUE) {
        next.delete("productId");
      } else {
        next.set("productId", value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const productOptions = useMemo(
    () => [
      { label: "All Products", value: ALL_PLAYERS_VALUE },
      ...products.map((p) => ({
        label: p.productTitle,
        value: p.productId,
      })),
    ],
    [products],
  );

  const selectedValue = data?.selectedProductId || ALL_PLAYERS_VALUE;

  if (audios.length === 0) {
    return (
      <s-section>
        <EmptyState
          heading="No audio players yet"
          message="You don't have any audio players yet. Create one to start collecting product analytics."
          action={
            <s-button variant="primary" onClick={() => navigate("/app/audios")}>
              Create your first player
            </s-button>
          }
        />
      </s-section>
    );
  }
  if (!data?.hasSupportedAudios) {
    return (
      <s-section>
        <EmptyState
          heading="Analytics coming soon"
          message="Analytics for Playlist players is coming soon."
        />
      </s-section>
    );
  }
  if (data?.assignmentsFailed) {
    return (
      <s-section>
        <ErrorState
          heading="Couldn't load product assignments"
          message="We couldn't check which products have audio. Please try again."
          onRetry={() => revalidator.revalidate()}
          retrying={revalidator.state === "loading"}
        />
      </s-section>
    );
  }
  if (data?.productCount === 0) {
    return (
      <s-section>
        <EmptyState
          heading="No products have audio yet"
          message="No audio has been assigned to any product yet. Assign a player to a product to see its analytics here."
          action={
            <s-button
              variant="primary"
              onClick={() => navigate("/app/product-audio")}
            >
              Open Product Audio
            </s-button>
          }
        />
      </s-section>
    );
  }

  const hasNoPlays =
    (data?.totalPlay ?? 0) === 0 &&
    (data?.dailyPlays?.length ?? 0) === 0 &&
    (data?.countryPlays?.length ?? 0) === 0;

  return (
    <s-stack gap="base">
      <s-section>
        <s-stack gap="small">
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 260px), 1fr))"
            gap="base"
            alignItems="end"
          >
            <WebSelect
              label="Product"
              value={selectedValue}
              options={productOptions}
              onChange={handleProductChange}
            />
            <DateFilter
              submit={handleFilterChange}
              defaultValue={data?.filter}
              defaultFrom={data?.customFrom}
              defaultTo={data?.customTo}
              enableCustomRange
            />
          </s-grid>
          <s-text color="subdued">
            Playlist players are not supported here — analytics for Playlist
            data are not shown.
          </s-text>
        </s-stack>
      </s-section>

      {!isLoading && hasNoPlays && (
        <s-banner tone="info">
          No plays recorded yet. Embed your audio player to start seeing data
          here.
        </s-banner>
      )}

      {selectedValue === ALL_PLAYERS_VALUE &&
        (data?.ranking?.length ?? 0) > 0 && (
          <TopPlayedRanking
            heading="Top played products"
            periodLabel={periodLabelFor(data?.filter)}
            items={data.ranking}
            onViewDetails={handleProductChange}
            isLoading={isLoading}
          />
        )}

      <AnalyticsBody data={data} isFree={data?.isFree} isLoading={isLoading} />
    </s-stack>
  );
}
