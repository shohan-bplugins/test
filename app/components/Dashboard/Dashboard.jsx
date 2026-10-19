import React, { useEffect, useState } from "react";
import Modal from "../PolarisWeb/WebModal";
import { useRevalidator, useNavigate, useFetcher } from "@remix-run/react";
import "./Dashboard.css";
import Onboarding from "../Onboarding/Onboarding";
import PricingTable from "./PricingTable";
import { useSupport } from "../SupportForm/SupportProvider";
import { ErrorState } from "../PageState/PageState";

const PLAYER_TYPE_LABELS = {
  "single-audio": "Single Audio",
  "playlist-audio": "Playlist",
  "sticky-player": "Sticky Player",
  "sticky-single-button": "Sticky Button",
};

function AnalyticsOverview() {
  const fetcher = useFetcher();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load("/app/dashboard-analytics");
    }
  }, []);

  const isLoading = fetcher.state !== "idle" || !fetcher.data;
  const data = fetcher.data;
  const loadFailed = fetcher.state === "idle" && !!data?.error;
  const product = data?.product ?? null;

  const allStats = [
    { label: "Total Plays", value: data?.totalPlays ?? 0, meta: "All time" },
    {
      label: "Plays Today",
      value: data?.todayPlays ?? 0,
      meta: "Since midnight",
    },
    { label: "This Week", value: data?.weekPlays ?? 0, meta: "Last 7 days" },
    { label: "This Month", value: data?.monthPlays ?? 0, meta: "Last 30 days" },
  ];
  const productStats = [
    { label: "Total Plays", value: product?.totalPlays ?? 0, meta: "All time" },
    {
      label: "Plays Today",
      value: product?.todayPlays ?? 0,
      meta: "Since midnight",
    },
    { label: "This Week", value: product?.weekPlays ?? 0, meta: "Last 7 days" },
    {
      label: "This Month",
      value: product?.monthPlays ?? 0,
      meta: "Last 30 days",
    },
  ];

  const topPlayer = data?.topPlayer ?? null;
  const topProduct = product?.topProduct ?? null;

  // Navigate via Remix so the embedded session is kept (plain hrefs reload the iframe).
  const go = (to) => (e) => {
    e.preventDefault();
    navigate(to);
  };

  const renderStatsRow = (stats) => (
    <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="small">
      {stats.map((s) => (
        <s-stack gap="small-300" key={s.label}>
          {isLoading ? (
            <div
              className="db-skeleton db-skeleton--value"
              aria-hidden="true"
            />
          ) : (
            <s-heading>{s.value}</s-heading>
          )}
          <s-text color="subdued">{s.label}</s-text>
        </s-stack>
      ))}
    </s-grid>
  );

  const renderTopRow = ({ tag, name, to, empty }) => (
    <s-stack direction="inline" gap="small" alignItems="center">
      {isLoading ? (
        <div className="db-skeleton db-skeleton--line" aria-hidden="true" />
      ) : name ? (
        <>
          <s-badge>{tag}</s-badge>
          <s-text type="strong">{name}</s-text>
          {to ? (
            <s-link href={to} onClick={go(to)}>
              View Details
            </s-link>
          ) : null}
        </>
      ) : (
        <s-text color="subdued">{empty}</s-text>
      )}
    </s-stack>
  );

  const renderCard = ({ title, sub, stats, top }) => (
    <s-box padding="base" border="base" borderRadius="base" background="base">
      <s-stack gap="base">
        <s-stack gap="small-300">
          <s-heading>{title}</s-heading>
          <s-text color="subdued">{sub}</s-text>
        </s-stack>
        {renderStatsRow(stats)}
        <s-divider></s-divider>
        {renderTopRow(top)}
      </s-stack>
    </s-box>
  );

  return (
    <s-section>
      <s-stack gap="base">
        <s-stack
          direction="inline"
          justifyContent="space-between"
          alignItems="center"
        >
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="chart-vertical"></s-icon>
            <s-heading>Analytics Overview</s-heading>
            <s-badge tone="caution">New</s-badge>
            {isLoading ? (
              <s-spinner
                size="base"
                accessibilityLabel="Loading analytics"
              ></s-spinner>
            ) : null}
          </s-stack>
          <s-button href="/app/analytics" onClick={go("/app/analytics")}>
            View Details
          </s-button>
        </s-stack>

        {loadFailed ? (
          <ErrorState
            heading="Couldn't load analytics"
            message="Your play stats didn't load. Your players are not affected."
            onRetry={() => fetcher.load("/app/dashboard-analytics")}
            showHome={false}
          />
        ) : (
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 320px), 1fr))"
            gap="base"
          >
            {renderCard({
              title: "All Players",
              sub: "Every audio player",
              stats: allStats,
              top: {
                tag: "Top Play",
                name:
                  topPlayer?.title?.length > 30
                    ? `${topPlayer.title.substring(0, 30)}...`
                    : topPlayer
                      ? topPlayer.title || "Untitled"
                      : null,
                to: topPlayer
                  ? `/app/analytics?playerId=${encodeURIComponent(topPlayer.id)}`
                  : null,
                empty: "No plays recorded yet",
              },
            })}
            {renderCard({
              title: "Product Pages",
              sub: product?.productsTracked
                ? `${product.productsTracked} product${
                    product.productsTracked === 1 ? "" : "s"
                  } tracked`
                : "Assigned to products",
              stats: productStats,
              top: {
                tag: "Top Play",
                name: topProduct?.productTitle || null,
                to: topProduct
                  ? topProduct.productId
                    ? `/app/analytics/product?productId=${encodeURIComponent(topProduct.productId)}`
                    : "/app/analytics/product"
                  : null,
                empty: "No product plays yet",
              },
            })}
          </s-grid>
        )}
      </s-stack>
    </s-section>
  );
}

const Dashboard = ({ loaderData: routeData, apiKey, isLoading }) => {
  // Theme status + media lists come from a separate request made after the
  // page is on screen — the theme scan takes seconds and used to blank the page.
  const themeFetcher = useFetcher();
  useEffect(() => {
    if (themeFetcher.state === "idle" && !themeFetcher.data) {
      themeFetcher.load("/app/dashboard-theme");
    }
  }, []);
  const themeData = themeFetcher.data;
  const themeCheckFailed = themeFetcher.state === "idle" && themeData?.error;
  // First load: theme cards show a "Checking…" state until the scan lands.
  const themePending = !themeData || !!themeCheckFailed;

  // The top section's layout depends on the theme's app-block support. The
  // answer is taken from (newest first) the full scan, a quick support-only
  // check, the server's last known value, or this browser's last known value.
  // While none is known yet, the (far more common) block layout is shown with
  // its theme-dependent parts as skeletons.
  const supportKey = `apbp:supportsAppBlocks:${routeData?.shop}`;
  const [storedSupport, setStoredSupport] = useState(null);
  const supportFetcher = useFetcher();
  useEffect(() => {
    let stored = null;
    try {
      const raw = window.localStorage.getItem(supportKey);
      if (raw === "true" || raw === "false") stored = raw === "true";
    } catch {
      // storage blocked
    }
    setStoredSupport(stored);
    if (routeData?.supportsAppBlocks == null && stored == null) {
      supportFetcher.load("/app/dashboard-theme?support=1");
    }
  }, []);
  const pick = (d) =>
    d && !d.error && typeof d.supportsAppBlocks === "boolean"
      ? d.supportsAppBlocks
      : null;
  const knownSupport =
    pick(themeData) ??
    pick(supportFetcher.data) ??
    routeData?.supportsAppBlocks ??
    storedSupport;
  useEffect(() => {
    if (knownSupport == null) return;
    try {
      window.localStorage.setItem(supportKey, String(knownSupport));
    } catch {
      // storage blocked
    }
  }, [knownSupport, supportKey]);

  // Last known app-embed state, so the Theme App Block skeleton reserves the
  // height of what will most likely replace it: the one-line "All set" row
  // (enabled) or the warning banner (disabled — also the default, as new
  // installs haven't enabled it yet).
  const embedKey = `apbp:appEmbedDisabled:${routeData?.shop}`;
  const [lastEmbedDisabled, setLastEmbedDisabled] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(embedKey) === "false") {
        setLastEmbedDisabled(false);
      }
    } catch {
      // storage blocked
    }
  }, []);
  useEffect(() => {
    if (!themeData || themeData.error) return;
    try {
      window.localStorage.setItem(embedKey, String(!!themeData.appEmbed));
    } catch {
      // storage blocked
    }
  }, [themeData, embedKey]);

  const loaderData = {
    audioFiles: [],
    imageFiles: [],
    ...routeData,
    ...(themeData && !themeData.error ? themeData : {}),
  };
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState(0);

  const faqs = [
    {
      q: "How do I add the audio player to my store?",
      a: 'Enable the App Embed first (Theme Editor → App Embeds → Audio Player by bPlugins → Save). Then add the "Audio Player by bPlugins" block to any section, or paste the HTML embed code into a Custom HTML block. Enter the Player ID shown in your player list.',
    },
    {
      q: "Why isn't my audio player showing on the storefront?",
      a: 'The most common reason is that the App Embed block is not enabled. Go to your Theme Editor, click App Embeds, and toggle on "Audio Player by bPlugins", then save. Also make sure the Player ID in the block settings matches the ID in your player list.',
    },
    {
      q: "Can I have multiple audio players on one page?",
      a: 'Yes. Add multiple "Audio Player by bPlugins" blocks to your page and set a different Player ID in each block\'s settings. Each player is independent.',
    },
    {
      q: "How do I change the player color or layout?",
      a: "Go to your player list, click Edit on any player, and use the Customize editor to change colors, skin, controls, and more. Changes are saved instantly and reflected on the storefront.",
    },
    {
      q: "What audio formats are supported?",
      a: "MP3, WAV, OGG, AAC, FLAC, M4A, WebM, and most other browser-supported audio formats. For best compatibility across all browsers and devices, MP3 is recommended.",
    },
    {
      q: "How do I create a playlist player?",
      a: 'When creating a new player, select "Playlist Audio Player" as the type. You can then add multiple tracks, each with its own title and audio file URL.',
    },
    {
      q: "How do I upgrade my plan?",
      a: "Go to the Pricing page from the sidebar. Choose a plan and click Upgrade. Your player limit increases immediately after the subscription is confirmed.",
    },
  ];
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [isBlockVideoOpen, setIsBlockVideoOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(
    (loaderData?.audio?.length || 0) < 1,
  );
  const [emailCopied, setEmailCopied] = useState(false);
  const openSupport = useSupport();
  const [copiedEmbed, setCopiedEmbed] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // Resolve current plan
  const STATIC_PLANS = loaderData?.planData;

  const activeCharge = (loaderData?.charges || []).find(
    (c) => c.status === "active",
  );

  let currentPlan = STATIC_PLANS?.find((p) => {
    if (!activeCharge || !loaderData?.user?.planId) {
      return p?.name === "Free";
    } else if (loaderData?.user?.planId) {
      return p?.id === loaderData.user.planId;
    } else if (activeCharge) {
      return p?.id === activeCharge;
    }
  });

  const isFree =
    !activeCharge || !currentPlan?.name || currentPlan?.name === "Free";

  const maxCredits = loaderData?.user?.cardits || 5;
  const usedCredits = loaderData?.audio?.length || 0;
  // Pro Plus has no cap — show "Unlimited" instead of the raw credit number.
  const isUnlimited = (currentPlan?.name || "") === "Pro Plus";
  const safeUsedCredits = Math.min(usedCredits, maxCredits);
  const progressPercent =
    maxCredits > 0 ? (safeUsedCredits / maxCredits) * 100 : 0;
  const planName = currentPlan?.name || "Free";
  const isAppBlockDisabled = loaderData?.appEmbed;
  const activeAudiosCount = loaderData?.audio?.length || 0;
  const recentAudios = (loaderData?.audio || []).slice(0, 5);

  const handleEnableAppEmbed = () => {
    const themeEditorUrl = `https://${loaderData?.shop}/admin/themes/${loaderData?.themeId}/editor?context=apps&activateAppId=${apiKey}/audio_player_by_bplugins_script`;
    window.open(themeEditorUrl, "_blank");
  };

  // All theme blocks shipped by the extension. "section" blocks are added into
  // a template section; "embed" blocks (app embeds) are toggled on app-wide.
  // `template`/`target` decide where the theme editor opens to add the block:
  //  - product blocks drop into the product page's main section
  //  - the rest open the home page and add a fresh app section
  const STORE_BLOCKS = [
    {
      handle: "audio_player_by_bplugins",
      name: "Audio Player by bPlugins",
      desc: "The main player — drop it into any section on any page.",
      type: "section",
      template: "index",
      target: "newAppsSection",
    },
    {
      handle: "audio_player_block",
      name: "Audio Player Block",
      desc: "Adds a player into your product page layout.",
      type: "section",
      template: "product",
      target: "mainSection",
    },
    {
      handle: "product_audio_player",
      name: "Product Audio Player",
      desc: "Plays the audio assigned to each product automatically.",
      type: "section",
      template: "product",
      target: "mainSection",
    },
    {
      handle: "soundcloud_block",
      name: "SoundCloud Block",
      desc: "Embed a SoundCloud track or playlist.",
      type: "section",
      template: "index",
      target: "newAppsSection",
    },
    {
      handle: "spotify_block",
      name: "Spotify Block",
      desc: "Embed a Spotify track, album, or playlist.",
      type: "section",
      template: "index",
      target: "newAppsSection",
    },
  ];

  const addedBlockCount = STORE_BLOCKS.filter(
    (b) => loaderData?.sectionBlocks?.[b.handle],
  ).length;

  // OS 2.0 themes with app-block support → block controls; otherwise the player
  // is shown automatically on product pages (auto-inject in the app embed).
  const supportsAppBlocks = knownSupport !== false;

  // Deep-link the theme editor to add/activate a specific block.
  const handleAddBlock = (block) => {
    const base = `https://${loaderData?.shop}/admin/themes/${loaderData?.themeId}/editor`;
    const url =
      block.type === "embed"
        ? `${base}?context=apps&activateAppId=${apiKey}/${block.handle}`
        : `${base}?template=${block.template || "product"}&addAppBlockId=${apiKey}/${block.handle}&target=${block.target || "mainSection"}`;
    window.open(url, "_blank");
    // The app embed must be on for any added block to render on the storefront.
    if (isAppBlockDisabled) {
      shopify.toast.show(
        "Also enable the Theme App Block, or this block won't show on your storefront.",
        { isError: true, duration: 6000 },
      );
    }
  };

  // A player needs a title and an audio source before it can be copied/embedded.
  const getMissingFields = (audio) => {
    const missing = [];
    if (!audio?.title || !audio.title.trim()) missing.push("title");

    let hasSource = !!(audio?.url && String(audio.url).trim());
    if (!hasSource && audio?.audioPlayList) {
      try {
        const list =
          typeof audio.audioPlayList === "string"
            ? JSON.parse(audio.audioPlayList)
            : audio.audioPlayList;
        if (Array.isArray(list)) {
          hasSource = list.some((t) => t?.url && String(t.url).trim());
        }
      } catch {
        hasSource = false;
      }
    }
    if (!hasSource) missing.push("audio source");

    return missing;
  };

  const handleCopyEmbed = (e, video) => {
    e.preventDefault();
    e.stopPropagation();
    const missing = getMissingFields(video);
    if (missing.length) {
      shopify.toast.show(
        `Add a ${missing.join(" and ")} to this player before copying its embed code.`,
        { isError: true },
      );
      return;
    }
    navigator.clipboard.writeText(
      `<div class="html5-audio-plyr" data-id="${video.id}"></div>`,
    );
    if (isAppBlockDisabled) {
      shopify.toast.show(
        "Embed code copied — but enable the Theme App Block first, or the player won't show on your storefront.",
        { isError: true, duration: 6000 },
      );
    } else {
      shopify.toast.show("Embed code copied!");
    }
    setCopiedEmbed(video.id);
    setTimeout(() => setCopiedEmbed(null), 2000);
  };

  const handleCopyId = (e, video) => {
    e.preventDefault();
    e.stopPropagation();
    const missing = getMissingFields(video);
    if (missing.length) {
      shopify.toast.show(
        `Add a ${missing.join(" and ")} to this player before copying its ID.`,
        { isError: true },
      );
      return;
    }
    navigator.clipboard.writeText(video.id);
    if (isAppBlockDisabled) {
      shopify.toast.show(
        "Player ID copied — but enable the Theme App Block first, or the player won't show on your storefront.",
        { isError: true, duration: 6000 },
      );
    } else {
      shopify.toast.show("Player ID copied!");
    }
    setCopiedId(video.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const isReloading =
    revalidator.state === "loading" ||
    (themeFetcher.state === "loading" && !themePending) ||
    undefined;

  const checkingBadge = themeCheckFailed ? (
    <s-badge tone="warning">Couldn't check — reload</s-badge>
  ) : (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-spinner
        size="base"
        accessibilityLabel="Checking your theme"
      ></s-spinner>
      <s-badge>Checking…</s-badge>
    </s-stack>
  );

  // Shared card header: icon + title on the left, badge (or action) on the right.
  const renderCardHeader = (icon, title, right) => (
    <s-stack
      direction="inline"
      justifyContent="space-between"
      alignItems="center"
      gap="small"
    >
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-icon type={icon}></s-icon>
        <s-heading>{title}</s-heading>
      </s-stack>
      {right}
    </s-stack>
  );

  // Card shell: header + body on top, divider + actions pinned to the bottom
  // so cards in the same grid row line up.
  const renderCard = ({ icon, title, badge, body, footer, fill = true }) => (
    <s-box
      padding="base"
      border="base"
      borderRadius="base"
      background="base"
      blockSize={fill ? "100%" : undefined}
    >
      <s-stack
        gap="small"
        blockSize={fill ? "100%" : undefined}
        justifyContent="space-between"
      >
        <s-stack gap="small-200">
          {renderCardHeader(icon, title, badge)}
          {body}
        </s-stack>
        <s-stack direction="inline" gap="small-200">
          {footer}
        </s-stack>
      </s-stack>
    </s-box>
  );

  const reloadButton = (label) => (
    <s-button
      icon="refresh"
      loading={isReloading}
      onClick={() => revalidator.revalidate()}
    >
      {label}
    </s-button>
  );

  const playerButtons = (
    <s-stack direction="inline" gap="small-200">
      <s-button icon="list-bulleted" onClick={() => navigate("/app/audios")}>
        Go to audio list
      </s-button>
      <s-button
        variant="primary"
        icon="sound"
        onClick={() => navigate("/app/audios?action=new")}
      >
        Add New Player
      </s-button>
    </s-stack>
  );

  const planTotal = isUnlimited
    ? "Unlimited"
    : String(maxCredits || 5).length > 5
      ? `${String(maxCredits).slice(0, 5)}...`
      : maxCredits || 5;

  return (
    <s-stack gap="base">
      {/* Onboarding — shown until user finishes or skips */}
      {showOnboarding && (
        <Onboarding
          loaderData={loaderData}
          apiKey={apiKey}
          onComplete={() => setShowOnboarding(false)}
        />
      )}

      <s-stack
        direction="inline"
        justifyContent="space-between"
        alignItems="center"
        gap="base"
      >
        <s-stack gap="small-300">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-heading>Dashboard</s-heading>
            {isReloading ? (
              <s-spinner
                size="base"
                accessibilityLabel="Refreshing status"
              ></s-spinner>
            ) : null}
          </s-stack>
          <s-text color="subdued">Welcome to your dashboard</s-text>
        </s-stack>
        {supportsAppBlocks && playerButtons}
      </s-stack>

      {/* Top section — layout depends on whether the theme supports app blocks.
          Blocks available → card grid (Theme · Plan · App Blocks · Recent).
          Auto mode → compact status rail + App Blocks guide. */}
      {supportsAppBlocks ? (
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 300px), 1fr))"
          gap="base"
        >
          <s-stack gap="base">
            {/* Theme App Block */}
            {renderCard({
              fill: false,
              icon: "theme",
              title: "Theme App Block",
              badge: themePending ? (
                checkingBadge
              ) : (
                <s-badge tone={isAppBlockDisabled ? "critical" : "success"}>
                  {isAppBlockDisabled ? "Disabled" : "Enabled"}
                </s-badge>
              ),
              body: (
                <>
                  {themePending ? (
                    <div
                      className={`db-skeleton ${
                        lastEmbedDisabled
                          ? "db-skeleton--banner"
                          : "db-skeleton--line"
                      }`}
                      aria-hidden="true"
                    />
                  ) : isAppBlockDisabled ? (
                    <s-banner tone="critical">
                      Enable the app block — players are hidden until then.
                    </s-banner>
                  ) : (
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <s-icon type="check-circle" tone="success"></s-icon>
                      <s-text>All set! Players show on your storefront.</s-text>
                    </s-stack>
                  )}
                </>
              ),
              footer: (
                <>
                  <s-button
                    icon="external"
                    disabled={themePending || undefined}
                    onClick={handleEnableAppEmbed}
                    tone={isAppBlockDisabled ? "critical" : undefined}
                    variant={isAppBlockDisabled ? "primary" : undefined}
                  >
                    {isAppBlockDisabled ? "Enable" : "Manage"}
                  </s-button>
                  {reloadButton("Reload")}
                </>
              ),
            })}

            {/* Current Plan */}
            {renderCard({
              fill: false,
              icon: "credit-card",
              title: "Current Plan",
              badge: <s-badge tone="success">{planName}</s-badge>,
              body: (
                <>
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="baseline"
                    gap="small"
                  >
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="baseline"
                    >
                      <s-heading>
                        {isUnlimited ? usedCredits || 0 : safeUsedCredits || 0}
                      </s-heading>
                      <s-text color="subdued">
                        of {planTotal} players used
                      </s-text>
                    </s-stack>
                    {!isUnlimited ? (
                      <s-text color="subdued">
                        {Math.max((maxCredits || 5) - safeUsedCredits, 0)} left
                      </s-text>
                    ) : null}
                  </s-stack>
                  {/* No web-component progress bar yet — keep the custom one. */}
                  <div className="db-progress-track">
                    <div
                      className={`db-progress-fill ${isUnlimited ? "is-unlimited" : ""}`}
                      style={{
                        width: isUnlimited ? "100%" : `${progressPercent}%`,
                      }}
                    />
                  </div>
                </>
              ),
              footer: (
                <>
                  <s-button
                    icon="external"
                    onClick={() => navigate("/app/pricing")}
                  >
                    Manage plan
                  </s-button>
                  {!isUnlimited ? (
                    <s-button
                      variant="primary"
                      onClick={() => navigate("/app/pricing")}
                    >
                      Upgrade
                    </s-button>
                  ) : null}
                </>
              ),
            })}
          </s-stack>

          {/* App Blocks */}
          {renderCard({
            icon: "layout-block",
            title: "App Blocks",
            badge: themePending ? (
              checkingBadge
            ) : (
              <s-badge tone={addedBlockCount > 0 ? "success" : "caution"}>
                {addedBlockCount}/{STORE_BLOCKS.length} added
              </s-badge>
            ),
            body: (
              <s-stack gap="small-200">
                {STORE_BLOCKS.map((block) => {
                  const addedCount =
                    loaderData?.sectionBlocks?.[block.handle] || 0;
                  const isAdded = addedCount > 0;
                  return (
                    // minBlockSize = the "Add" button's height, so the row
                    // doesn't change height when its skeleton is replaced.
                    <s-grid
                      key={block.handle}
                      gridTemplateColumns="auto minmax(0, 1fr) auto"
                      alignItems="center"
                      gap="small"
                      minBlockSize="28px"
                    >
                      <s-icon
                        type={isAdded ? "check-circle" : "minus-circle"}
                        tone={isAdded ? "success" : undefined}
                      ></s-icon>
                      <s-text>{block.name}</s-text>
                      {themePending ? (
                        <div
                          className="db-skeleton db-skeleton--value"
                          aria-hidden="true"
                        />
                      ) : isAdded ? (
                        <s-badge tone="success">Added {addedCount}×</s-badge>
                      ) : (
                        <s-button
                          variant="tertiary"
                          icon="plus"
                          accessibilityLabel={`Add ${block.name}`}
                          onClick={() => handleAddBlock(block)}
                        >
                          Add
                        </s-button>
                      )}
                    </s-grid>
                  );
                })}
              </s-stack>
            ),
            footer: reloadButton("Reload"),
          })}

          {/* Recent Audios */}
          {renderCard({
            icon: "sound",
            title: "Recent Audios",
            badge: <s-badge tone="success">{activeAudiosCount} Active</s-badge>,
            body:
              recentAudios.length > 0 ? (
                <s-stack gap="small-300">
                  {recentAudios.map((video) => {
                    const customizeUrl = `/app/customize/${video.id}/${video.playerType || "single-audio"}`;
                    const title = video.title || "Untitled Player";
                    return (
                      <React.Fragment key={video.id}>
                        <s-grid
                          gridTemplateColumns="auto minmax(0, 1fr) auto auto"
                          alignItems="center"
                          gap="small-200"
                        >
                          <s-icon type="play-circle"></s-icon>
                          <s-link onClick={() => navigate(customizeUrl)}>
                            {title.length > 20
                              ? `${title.substring(0, 20)}...`
                              : title}
                          </s-link>
                          <s-badge>
                            {PLAYER_TYPE_LABELS[video.playerType] ||
                              "Single Audio"}
                          </s-badge>
                          {/* Incomplete players stay clickable: the handlers
                              explain what's missing in a toast. */}
                          <s-stack direction="inline" gap="small-100">
                            <s-button
                              variant="tertiary"
                              icon={copiedEmbed === video.id ? "check" : "code"}
                              accessibilityLabel="Copy embed code"
                              onClick={(e) => handleCopyEmbed(e, video)}
                            ></s-button>
                            <s-button
                              variant="tertiary"
                              icon={
                                copiedId === video.id ? "check" : "clipboard"
                              }
                              accessibilityLabel="Copy player ID"
                              onClick={(e) => handleCopyId(e, video)}
                            ></s-button>
                          </s-stack>
                        </s-grid>
                      </React.Fragment>
                    );
                  })}
                </s-stack>
              ) : (
                <s-paragraph>
                  You currently have <s-text type="strong">0</s-text> active
                  audio players. Create one to get started!
                </s-paragraph>
              ),
            footer: (
              <s-button
                icon="list-bulleted"
                onClick={() => navigate("/app/audios")}
              >
                View all
              </s-button>
            ),
          })}
        </s-grid>
      ) : (
        <s-stack gap="base">
          {/* Setup summary strip — status at a glance, one row */}
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 240px), 1fr))"
            gap="small"
          >
            {[
              {
                icon: "theme",
                label: "Theme App Block",
                value: isAppBlockDisabled ? "Not enabled" : "Enabled",
                action: (
                  <s-button
                    icon="external"
                    tone={isAppBlockDisabled ? "critical" : undefined}
                    loading={isReloading}
                    onClick={handleEnableAppEmbed}
                  >
                    {isAppBlockDisabled ? "Enable" : "Manage"}
                  </s-button>
                ),
              },
              {
                icon: "credit-card",
                label: `${planName} Plan`,
                value: isUnlimited
                  ? `${usedCredits || 0} / Unlimited Players`
                  : `${safeUsedCredits || 0} / ${maxCredits || 5} Players`,
                action: (
                  <s-button
                    icon="external"
                    loading={isReloading}
                    onClick={() => navigate("/app/pricing")}
                  >
                    Manage
                  </s-button>
                ),
              },
            ].map((item) => (
              <s-box
                key={item.label}
                padding="small"
                border="base"
                borderRadius="base"
                background="base"
              >
                <s-stack
                  direction="inline"
                  justifyContent="space-between"
                  alignItems="center"
                  gap="small"
                >
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-icon type={item.icon}></s-icon>
                    <s-text color="subdued">{item.label}:</s-text>
                    <s-text type="strong">{item.value}</s-text>
                  </s-stack>
                  {item.action}
                </s-stack>
              </s-box>
            ))}
          </s-grid>

          {/* App Blocks — auto mode guide */}
          <s-box
            padding="base"
            border="base"
            borderRadius="base"
            background="base"
          >
            <s-stack gap="small">
              {renderCardHeader(
                "layout-block",
                "App Blocks",
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-badge tone="success">Auto mode</s-badge>
                  {reloadButton("Reload")}
                </s-stack>,
              )}
              {/* Guide beside the video when there's room, stacked on phones.
                  (No commas inside a responsive value — Polaris splits on them.) */}
              <s-query-container>
                <s-grid
                  gridTemplateColumns="@container (inline-size > 560px) 1fr 240px, 1fr"
                  gap="base"
                >
                  <s-stack gap="small">
                    <s-paragraph>
                      No app blocks on this theme — assign a player to a product
                      and it shows on that{" "}
                      <s-text type="strong">product page automatically</s-text>.
                    </s-paragraph>

                    <s-stack gap="small-200">
                      <s-text type="strong">
                        Home page &amp; other pages — how to add
                      </s-text>
                      <s-ordered-list>
                        <s-list-item>
                          In <s-text type="strong">Players</s-text> (or Recent
                          Audios), click <s-text type="strong">Embed</s-text> —
                          copies the full code (ID included).
                        </s-list-item>
                        <s-list-item>
                          In <s-text type="strong">Themes → Customize</s-text>,
                          open the page and{" "}
                          <s-text type="strong">
                            add a Custom Liquid or Custom HTML section
                          </s-text>
                          .
                        </s-list-item>
                        <s-list-item>
                          <s-text type="strong">Paste</s-text> and{" "}
                          <s-text type="strong">Save</s-text>.
                        </s-list-item>
                      </s-ordered-list>
                    </s-stack>
                    <s-stack direction="inline" gap="small-200">
                      {isAppBlockDisabled ? (
                        <s-button
                          variant="primary"
                          icon="external"
                          onClick={handleEnableAppEmbed}
                        >
                          Enable app embed
                        </s-button>
                      ) : null}
                      <s-button
                        icon="product"
                        onClick={() => navigate("/app/product-audio")}
                      >
                        Assign to products
                      </s-button>
                    </s-stack>
                  </s-stack>

                  {/* Tutorial video — opens in a modal on click */}
                  <s-stack gap="small-200">
                    <s-clickable
                      className="db-help-video"
                      accessibilityLabel="Play the setup video"
                      onClick={() => setIsBlockVideoOpen(true)}
                    >
                      <s-image
                        src="https://i.ytimg.com/vi/mWfatyIPA1M/hqdefault.jpg"
                        alt="Watch: setting up your audio player"
                        aspectRatio="16/9"
                        objectFit="cover"
                        borderRadius="base"
                        loading="lazy"
                      ></s-image>
                      <div className="db-help-video-play">
                        <s-icon type="play"></s-icon>
                      </div>
                    </s-clickable>
                  </s-stack>
                </s-grid>
              </s-query-container>
            </s-stack>
          </s-box>
        </s-stack>
      )}

      {/* Analytics Overview */}
      <AnalyticsOverview />

      {isFree && (
        <PricingTable
          currentPlanId={planName}
          isLoading={isLoading}
          plans={STATIC_PLANS || []}
        />
      )}

      {/* Help and Resources */}
      <s-section heading="Help and Resources">
        {/* One row: Support card double width, Quick links + Video single. */}
        <s-grid
          gridTemplateColumns="minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)"
          gap="base"
        >
          {/* Support Card */}
          <s-box
            padding="base"
            border="base"
            borderRadius="base"
            blockSize="100%"
          >
            {/* Info on top, buttons pinned to the bottom of the card. */}
            <s-stack gap="base" blockSize="100%" justifyContent="space-between">
              <s-stack gap="base">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-avatar initials="ST"></s-avatar>
                  <s-stack gap="small-500">
                    <s-heading>Support Team</s-heading>
                    <s-text color="subdued">Customer Success</s-text>
                  </s-stack>
                </s-stack>
                <s-paragraph>
                  Need help getting started? Get 1:1 help setting up Audio
                  Player by bPlugins for your store.
                </s-paragraph>
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="email" tone="subdued"></s-icon>
                  <s-text color="subdued">support@bplugins.com</s-text>
                </s-stack>
              </s-stack>
              <s-stack direction="inline" gap="small-200">
                <s-button
                  variant="primary"
                  icon={emailCopied ? "check" : "clipboard"}
                  onClick={() => {
                    navigator.clipboard.writeText("support@bplugins.com");
                    shopify.toast.show("Email copied!");
                    setEmailCopied(true);
                    setTimeout(() => setEmailCopied(false), 2000);
                  }}
                >
                  {emailCopied ? "Copied!" : "Copy email"}
                </s-button>
                <s-button icon="question-circle" onClick={() => openSupport()}>
                  Contact support
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>

          {/* Quick Links Card */}
          <s-box padding="base" border="base" borderRadius="base">
            <s-stack gap="small">
              <s-heading>Quick links</s-heading>
              <s-stack gap="small-300">
                {[
                  {
                    icon: "note",
                    label: "View Docs",
                    onClick: () => navigate("/app/documentation"),
                  },
                  {
                    icon: "compose",
                    label: "Write a Review",
                    external: true,
                    onClick: () =>
                      window.open(
                        "https://apps.shopify.com/audio-player-by-bplugins#modal-show=ReviewListingModal",
                        "_blank",
                      ),
                  },
                  {
                    icon: "lightbulb",
                    label: "Request a Feature",
                    external: false,
                    onClick: () => openSupport("Feature request: "),
                  },
                  {
                    icon: "play-circle",
                    label: "Video Tutorials",
                    external: false,
                    onClick: () => setIsVideoModalOpen(true),
                  },
                ].map((link, i) => (
                  <React.Fragment key={link.label}>
                    {i > 0 ? <s-divider></s-divider> : null}
                    <s-clickable
                      padding="small-200"
                      borderRadius="base"
                      accessibilityLabel={link.label}
                      onClick={link.onClick}
                    >
                      <s-grid
                        gridTemplateColumns="auto minmax(0, 1fr) auto"
                        alignItems="center"
                        gap="small"
                      >
                        <s-icon type={link.icon}></s-icon>
                        <s-text>{link.label}</s-text>
                        <s-icon
                          type={link.external ? "external" : "chevron-right"}
                          tone="subdued"
                        ></s-icon>
                      </s-grid>
                    </s-clickable>
                  </React.Fragment>
                ))}
              </s-stack>
            </s-stack>
          </s-box>

          {/* Video Preview Card */}
          <s-box padding="base" border="base" borderRadius="base">
            <s-stack gap="small">
              <s-stack gap="small-500">
                <s-heading>Watch the walkthrough</s-heading>
                <s-text color="subdued">
                  Setup and demo of Audio Player by bPlugins
                </s-text>
              </s-stack>
              <s-clickable
                className="db-help-video"
                borderRadius="base"
                accessibilityLabel="Play tutorial video"
                onClick={() => setIsVideoModalOpen(true)}
              >
                <s-image
                  src="/tutorial_video_thumbnail.jpg"
                  alt="Audio Player by bPlugins tutorial"
                  aspectRatio="16/9"
                  objectFit="cover"
                  borderRadius="base"
                  loading="lazy"
                ></s-image>
                <div className="db-help-video-play">
                  <s-icon type="play"></s-icon>
                </div>
              </s-clickable>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      {!isFree && (
        <PricingTable
          currentPlanId={planName}
          isLoading={isLoading}
          plans={STATIC_PLANS || []}
        />
      )}

      {/* FAQ */}
      <s-section heading="Frequently Asked Questions">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Quick answers to the most common questions about Audio Player by
            bPlugins.
          </s-paragraph>
          <s-stack gap="small">
            {faqs.map((item, i) => {
              const isOpen = openFaq === i;
              return (
                <s-box key={i} border="base" borderRadius="base">
                  <s-clickable
                    padding="base"
                    accessibilityLabel={item.q}
                    onClick={() => setOpenFaq(isOpen ? null : i)}
                  >
                    <s-stack
                      direction="inline"
                      justifyContent="space-between"
                      alignItems="center"
                      gap="small"
                    >
                      <s-text type="strong">{item.q}</s-text>
                      <s-icon
                        type={isOpen ? "chevron-up" : "chevron-down"}
                      ></s-icon>
                    </s-stack>
                  </s-clickable>
                  {isOpen ? (
                    <s-box paddingInline="base" paddingBlockEnd="base">
                      <s-paragraph>{item.a}</s-paragraph>
                    </s-box>
                  ) : null}
                </s-box>
              );
            })}
          </s-stack>
        </s-stack>
      </s-section>

      {/* Video Modal */}
      {isVideoModalOpen && (
        <Modal
          id="audio-preview-modal"
          open={isVideoModalOpen}
          onClose={() => setIsVideoModalOpen(false)}
          title="Audio Player by bPlugins"
          size="large"
        >
          <Modal.Section>
            <div className="db-video-frame">
              <iframe
                src="https://www.youtube.com/embed/p1KFvtXe6mU?autoplay=1&mute=1"
                title="Audio Player by bPlugins — Setup & Demo"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </Modal.Section>
        </Modal>
      )}

      {/* App Blocks tutorial video modal */}
      {isBlockVideoOpen && (
        <Modal
          id="app-blocks-video-modal"
          open={isBlockVideoOpen}
          onClose={() => setIsBlockVideoOpen(false)}
          title="How to add players to your store"
          size="large"
        >
          <Modal.Section>
            <div className="db-video-frame">
              <iframe
                src="https://www.youtube-nocookie.com/embed/mWfatyIPA1M?autoplay=1&mute=1"
                title="How to add players to your store"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </Modal.Section>
        </Modal>
      )}
    </s-stack>
  );
};

export default Dashboard;
