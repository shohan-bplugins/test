// Per-player analytics (/app/audio-dashboard/:id), linked from My Audio Players.
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
  useNavigate,
} from "@remix-run/react";
import { useEffect } from "react";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import DateFilter from "../components/DateFilter/DateFilter";
import AnalyticsBody from "../components/AnalyticsBody/AnalyticsBody";
import { playerTypeLabel } from "../components/PlayerTypePicker/PlayerTypePicker";
import prisma from "../db.server";
import "../styles/variables.css";
import "../styles/analytics-web.css";
import { useSupport } from "../components/SupportForm/SupportProvider";

// Loader now returns list of audio players AND analytics for selected audio

const NOT_FOUND_MESSAGE = "This audio player doesn't exist or was deleted.";
const VALID_FILTERS = new Set(["today", "last7", "last30", "all"]);

// The audio must exist and belong to this shop. A malformed id (not a
// 24-hex ObjectId) would make Prisma throw, so it's a 404 too.
async function loadOwnedAudio(audioId, shop) {
  if (typeof audioId !== "string" || !/^[a-f0-9]{24}$/i.test(audioId)) {
    throw json({ message: NOT_FOUND_MESSAGE }, { status: 404 });
  }
  const audio = await prisma.audio.findUnique({ where: { id: audioId } });
  if (!audio || !shop || audio.shop !== shop) {
    throw json({ message: NOT_FOUND_MESSAGE }, { status: 404 });
  }
  return audio;
}

export async function loader({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop;
  const audioId = params.id;

  const data = await prisma.Users.findUnique({
    where: { shop },
    select: {
      id: true,
      cardits: true,
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

  const userType =
    plan?.name !== "Free" && data?.cardits > 5 ? "premium" : "free";

  const audio = await loadOwnedAudio(audioId, shop);

  let filter = "today"; // default filter
  if (request.method === "POST") {
    const formData = await request.formData();
    filter = formData.get("filter") || "today";
  }

  // Calculate date filter
  let fromDate;
  const now = new Date();
  if (filter === "today") fromDate = new Date(now.setHours(0, 0, 0, 0));
  else if (filter === "last7")
    fromDate = new Date(now.setDate(now.getDate() - 7));
  else if (filter === "last30")
    fromDate = new Date(now.setDate(now.getDate() - 30));
  else fromDate = null; // all time

  const whereFilter = {
    shop,
    audioId,
    ...(fromDate && { calledAt: { gte: fromDate } }),
  };

  const totalPlay = await prisma.analytics.count({
    where: {
      shop,
      audioId,
      ...(fromDate && { calledAt: { gte: fromDate } }),
    },
  });

  const deviceCounts = await prisma.analytics.groupBy({
    by: ["device"],
    where: whereFilter,
    _count: { device: true },
  });

  const browserCounts = await prisma.analytics.groupBy({
    by: ["browser"],
    where: whereFilter,
    _count: { browser: true },
  });

  const durationSum = await prisma.analytics.aggregate({
    where: whereFilter,
    _sum: { duration: true },
  });

  // Visitor IPs never leave the server.
  const result = await prisma.analytics.findMany({
    where: whereFilter,
    omit: { ipAddress: true },
  });

  return json({
    audio,
    result,
    sumaryData: {
      devices: Object.fromEntries(
        deviceCounts.map((d) => [d.device, d._count.device]),
      ),
      browsers: Object.fromEntries(
        browserCounts.map((b) => [b.browser, b._count.browser]),
      ),
      totalDuration: durationSum._sum.duration || 0,
    },
    filter,
    userType: plan ? userType : "free",
    totalPlay,
  });
}

export async function action({ params, request }) {
  const { admin, session } = await authenticate.admin(request);
  const audioId = params.id;
  const shop = session?.shop;

  const audio = await loadOwnedAudio(audioId, shop);

  let filter = "today"; // default
  const formData = await request.formData();
  filter = formData.get("filter") || "today";
  // Bad input comes back as an error the page can show, not a thrown error.
  if (!VALID_FILTERS.has(filter)) {
    return json(
      { error: "That date range isn't supported. Please pick another." },
      { status: 400 },
    );
  }

  try {
    let fromDate;
    const now = new Date();
    if (filter === "today") fromDate = new Date(now.setHours(0, 0, 0, 0));
    else if (filter === "last7")
      fromDate = new Date(now.setDate(now.getDate() - 7));
    else if (filter === "last30")
      fromDate = new Date(now.setDate(now.getDate() - 30));
    else fromDate = null;

    const whereFilter = {
      shop,
      audioId,
      ...(fromDate && { calledAt: { gte: fromDate } }),
    };

    const totalPlay = await prisma.analytics.count({
      where: {
        shop,
        audioId,
        ...(fromDate && { calledAt: { gte: fromDate } }),
      },
    });

    const deviceCounts = await prisma.analytics.groupBy({
      by: ["device"],
      where: whereFilter,
      _count: { device: true },
    });

    const browserCounts = await prisma.analytics.groupBy({
      by: ["browser"],
      where: whereFilter,
      _count: { browser: true },
    });

    const durationSum = await prisma.analytics.aggregate({
      where: whereFilter,
      _sum: { duration: true },
    });

    // Visitor IPs never leave the server.
    const result = await prisma.analytics.findMany({
      where: whereFilter,
      omit: { ipAddress: true },
    });

    return json({
      result,
      audio,
      sumaryData: {
        devices: Object.fromEntries(
          deviceCounts.map((d) => [d.device, d._count.device]),
        ),
        browsers: Object.fromEntries(
          browserCounts.map((b) => [b.browser, b._count.browser]),
        ),
        totalDuration: durationSum._sum.duration || 0,
      },
      filter,
      totalPlay,
    });
  } catch (e) {
    console.error("audio-dashboard: analytics for filter failed", e);
    return json(
      { error: "Couldn't load analytics for that period. Please try again." },
      { status: 500 },
    );
  }
}

export default function AudioDashboard() {
  const openSupport = useSupport();
  const defaultData = useLoaderData();
  const newData = useActionData();
  const nav = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();

  // An action error keeps the current data on screen and shows a toast.
  const actionError = newData?.error;
  const data = newData && !actionError ? newData : defaultData;
  useEffect(() => {
    if (actionError) shopify.toast.show(actionError, { isError: true });
  }, [newData, actionError]);
  const events = data?.result || [];
  const isLoading = nav.state !== "idle";
  // The action response doesn't carry the plan, so read it from the loader.
  const isFree = defaultData?.userType !== "premium";
  const audio = data?.audio;

  // Per-day listening time, average play length and distinct listeners,
  // shaped like the Analytics & Reports data so AnalyticsBody can render it.
  const dailyTotals = {};
  events.forEach((e) => {
    const day = new Date(e.calledAt).toISOString().split("T")[0];
    dailyTotals[day] = (dailyTotals[day] || 0) + (e.duration || 0);
  });
  const analytics = {
    sumaryData: data?.sumaryData,
    totalPlay: data?.totalPlay || 0,
    dailyPlays: Object.keys(dailyTotals).map((day) => ({
      data: day,
      totalTime: dailyTotals[day],
    })),
    avgPlayTime: events.length
      ? Number(
          (
            events.reduce((sum, e) => sum + (e.duration || 0), 0) /
            events.length
          ).toFixed(2),
        )
      : 0,
    uniqueDevices: new Set(events.map((e) => e.userAgent)).size,
    countryPlays: [],
  };

  const hasNoPlays = (data?.totalPlay ?? 0) === 0 && events.length === 0;

  const customizeUrl = audio
    ? `/app/customize/${audio.id}/${audio.playerType || "single-audio"}`
    : null;

  return (
    <s-page inlineSize="large">
      <ui-title-bar title="Player analytics">
        <button onClick={() => openSupport()}>Support</button>
        <button variant="breadcrumb" onClick={() => navigate("/app/audios")}>
          My Audio Players
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
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-heading>{audio?.title || "Untitled player"}</s-heading>
              {audio?.playerType ? (
                <s-badge>{playerTypeLabel(audio.playerType)}</s-badge>
              ) : null}
            </s-stack>
            <s-text color="subdued">
              Plays and listening stats for this player
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="small-200" alignItems="end">
            <DateFilter submit={submit} defaultValue={data?.filter} />
            {customizeUrl ? (
              <s-button icon="edit" onClick={() => navigate(customizeUrl)}>
                Customize
              </s-button>
            ) : null}
          </s-stack>
        </s-stack>

        {!isLoading && hasNoPlays && (
          <s-banner tone="info">
            {data?.filter === "all"
              ? "No plays recorded yet. Embed your audio player to start seeing data here."
              : "No plays in this period. Try a longer date range, or embed your audio player to start seeing data here."}
          </s-banner>
        )}

        <s-banner tone="info">
          We&apos;re actively adding more insights. If you notice anything
          missing or have a question, email us at{" "}
          <s-link href="mailto:shopify@bplugins.com" target="_blank">
            shopify@bplugins.com
          </s-link>
          .
        </s-banner>

        <AnalyticsBody
          data={analytics}
          isFree={isFree}
          isLoading={isLoading}
          hideOs
          hideMap
        />
      </s-stack>
    </s-page>
  );
}
