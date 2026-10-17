import { useCallback, useMemo } from "react";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { WebSelect } from "../components/PolarisWeb/fields";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import DateFilter from "../components/DateFilter/DateFilter";
import AnalyticsBody from "../components/AnalyticsBody/AnalyticsBody";
import TopPlayedRanking from "../components/TopPlayedRanking/TopPlayedRanking";
import { EmptyState } from "../components/PageState/PageState";
import {
  ALL_PLAYERS_VALUE,
  COMING_SOON_PLAYER_TYPES,
  PLAYER_TYPE_LABELS,
} from "../lib/analytics-shared";
import {
  buildAnalytics,
  buildPlayerRanking,
  loadShopPlan,
} from "../lib/analytics.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop;

  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") || "all";
  const customFrom = url.searchParams.get("from") || "";
  const customTo = url.searchParams.get("to") || "";
  const requestedAudioId =
    url.searchParams.get("playerId") || ALL_PLAYERS_VALUE;

  const { isFree } = await loadShopPlan(shop);

  const audios = await prisma.audio.findMany({
    where: { shop },
    select: { id: true, title: true, playerType: true },
    orderBy: { createdAt: "desc" },
  });

  const supportedAudios = audios.filter(
    (a) => !COMING_SOON_PLAYER_TYPES.has(a.playerType),
  );
  const allAudioIds = supportedAudios.map((a) => a.id);

  const isAllPlayers = requestedAudioId === ALL_PLAYERS_VALUE;
  const selectedAudio = !isAllPlayers
    ? (supportedAudios.find((a) => a.id === requestedAudioId) ?? null)
    : null;
  const effectiveAudioId = selectedAudio ? selectedAudio.id : ALL_PLAYERS_VALUE;

  const empty = {
    totalPlay: 0,
    avgPlayTime: 0,
    uniqueDevices: 0,
    sumaryData: { devices: {}, browsers: {}, os: {}, totalDuration: 0 },
    dailyPlays: [],
    countryPlays: [],
  };

  let analytics = { ...empty };
  try {
    if (selectedAudio) {
      analytics = await buildAnalytics({
        shop,
        audioId: selectedAudio.id,
        filter,
        customFrom,
        customTo,
        isFree,
      });
    } else if (allAudioIds.length > 0) {
      analytics = await buildAnalytics({
        shop,
        audioIds: allAudioIds,
        filter,
        customFrom,
        customTo,
        isFree,
      });
    }
  } catch (e) {
    console.error("standalone analytics build failed", e);
  }

  // Ranking of top-played players for the selected period (All Players view).
  // Optional extra — if it fails, hide it rather than failing the page.
  let ranking = [];
  if (isAllPlayers && allAudioIds.length > 0) {
    try {
      const titleById = Object.fromEntries(
        supportedAudios.map((a) => [a.id, a]),
      );
      const ranked = await buildPlayerRanking({
        shop,
        audioIds: allAudioIds,
        filter,
        customFrom,
        customTo,
      });
      ranking = ranked
        .map((r) => {
          const a = titleById[r.audioId];
          if (!a) return null;
          return {
            id: a.id,
            title: a.title,
            playerType: a.playerType,
            plays: r.plays,
          };
        })
        .filter(Boolean);
    } catch (e) {
      console.error("standalone ranking build failed", e);
    }
  }

  return json({
    ...analytics,
    audios,
    allAudioIds,
    selectedAudioId: effectiveAudioId,
    selectedAudio,
    ranking,
    filter,
    customFrom,
    customTo,
    isFree,
    hasSupportedAudios: supportedAudios.length > 0,
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

export default function StandaloneTab() {
  const data = useLoaderData();
  const nav = useNavigation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isLoading = nav.state === "loading" || nav.state === "submitting";
  const audios = data?.audios || [];

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

  const handlePlayerChange = useCallback(
    (value) => {
      const next = new URLSearchParams(searchParams);
      if (value === ALL_PLAYERS_VALUE) {
        next.delete("playerId");
      } else {
        next.set("playerId", value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const playerOptions = useMemo(() => {
    const allSet = new Set(data?.allAudioIds || []);
    return [
      { label: "All Players", value: ALL_PLAYERS_VALUE },
      ...audios
        .filter((a) => allSet.has(a.id))
        .map((a) => {
          const typeLabel = PLAYER_TYPE_LABELS[a.playerType] || "Single Audio";
          return {
            label: `${a.title || "Untitled"} — ${typeLabel}`,
            value: a.id,
          };
        }),
    ];
  }, [audios, data?.allAudioIds]);

  const selectedValue = data?.selectedAudioId || ALL_PLAYERS_VALUE;

  if (audios.length === 0) {
    return (
      <s-section>
        <EmptyState
          heading="No audio players yet"
          message="Create a standalone audio player to start collecting analytics for this view."
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
          heading="Analytics coming soon for this player type"
          message="Analytics for Playlist players are still in development. Create a Single, Sticky, or Single‑button player to see live data here."
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
              label="Player"
              value={selectedValue}
              options={playerOptions}
              onChange={handlePlayerChange}
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

      <AnalyticsBody data={data} isFree={data?.isFree} isLoading={isLoading}>
        {selectedValue === ALL_PLAYERS_VALUE &&
          (data?.ranking?.length ?? 0) > 0 && (
            <TopPlayedRanking
              heading="Top played players"
              periodLabel={periodLabelFor(data?.filter)}
              items={data.ranking}
              getMeta={(item) =>
                PLAYER_TYPE_LABELS[item.playerType] || "Single Audio"
              }
              onViewDetails={handlePlayerChange}
              isLoading={isLoading}
            />
          )}
      </AnalyticsBody>
    </s-stack>
  );
}
