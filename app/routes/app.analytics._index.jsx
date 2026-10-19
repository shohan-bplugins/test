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
import DateFilter, {
  periodLabelFor,
  rangeSearchParams,
} from "../components/DateFilter/DateFilter";
import TopPlayedRanking from "../components/TopPlayedRanking/TopPlayedRanking";
import { EmptyState } from "../components/PageState/PageState";
import {
  ALL_PLAYERS_VALUE,
  COMING_SOON_PLAYER_TYPES,
  PLAYER_TYPE_LABELS,
  analyticsAccess,
  isTodayRange,
  resolveAnalyticsRange,
} from "../lib/analytics-shared";
import {
  analyticsRangeBounds,
  buildAnalytics,
  buildPlayerRanking,
  loadShopPlan,
} from "../lib/analytics.server";
import AnalyticsBody, {
  AnalyticsUpgradeCard,
} from "../components/AnalyticsBody/AnalyticsBody";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop;

  const url = new URL(request.url);
  // Defaults to Today (merchant's date) when the URL has no valid range.
  const range = resolveAnalyticsRange(url.searchParams);
  const dateRange = analyticsRangeBounds(range);
  const requestedAudioId =
    url.searchParams.get("playerId") || ALL_PLAYERS_VALUE;

  const { isFree } = await loadShopPlan(shop);
  const isPro = !isFree;
  // What this plan may see for this range; enforced here, not just in the UI.
  const access = analyticsAccess({ isPro, range });

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
        dateRange,
        isFree,
        access,
      });
    } else if (allAudioIds.length > 0) {
      analytics = await buildAnalytics({
        shop,
        audioIds: allAudioIds,
        dateRange,
        isFree,
        access,
      });
    }
  } catch (e) {
    console.error("standalone analytics build failed", e);
  }

  // Ranking of top-played players for the selected period (All Players view).
  // Optional extra — if it fails, hide it rather than failing the page.
  // Not sent at all when the range is locked for this plan.
  let ranking = [];
  if (isAllPlayers && allAudioIds.length > 0 && access !== "locked") {
    try {
      const titleById = Object.fromEntries(
        supportedAudios.map((a) => [a.id, a]),
      );
      const ranked = await buildPlayerRanking({
        shop,
        audioIds: allAudioIds,
        dateRange,
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
    filter: range.filter,
    since: range.since,
    until: range.until,
    isTodayRange: isTodayRange(range),
    access,
    productLocked: false,
    isPro,
    isFree,
    hasSupportedAudios: supportedAudios.length > 0,
  });
}

export default function StandaloneTab() {
  const data = useLoaderData();
  const nav = useNavigation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isLoading = nav.state === "loading" || nav.state === "submitting";
  const audios = data?.audios || [];

  const handleFilterChange = (formData) => {
    setSearchParams(rangeSearchParams(searchParams, formData), {
      replace: true,
    });
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
              // Remount when the range changes from outside the picker.
              key={`${data?.filter}:${data?.since}:${data?.until}`}
              submit={handleFilterChange}
              defaultValue={data?.filter}
              defaultSince={data?.since}
              defaultUntil={data?.until}
              isFree={!data?.isPro}
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

      <AnalyticsUpgradeCard access={data?.access} />

      <AnalyticsBody
        data={data}
        isFree={data?.isFree}
        access={data?.access}
        isLoading={isLoading}
      >
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
