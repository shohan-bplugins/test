import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";
import {
  CustomBox,
  CustomSpan,
  CustomButton,
} from "../../utils/polarisWebComponents";
import {
  BlockStack,
  Box,
  Text,
  Button,
  InlineStack,
  Banner,
  List,
  Link,
} from "@shopify/polaris";
import { Modal, TitleBar } from "@shopify/app-bridge-react";
import { Await, useNavigate, useRevalidator } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import SupportTicketModal from "../SupportTicketModal/SupportTicketModal";
import StatusCards, { AppBlocksCard, ICONS, flag, useGo } from "./StatusCards";
import AnalyticsOverview, {
  AnalyticsSkeleton,
  AnalyticsError,
  TopPlayerStrip,
} from "./AnalyticsOverview";
import HelpResources from "./HelpResources";
import PlanFeatures from "./PlanFeatures";
import FaqSection from "./FaqSection";
import { normalizePlans, resolvePlan, planUsage } from "../../utils/planLimits";
import "./Dashboard.css";
// Lazy: Onboarding drags in the whole media-picker tree (MediaImg, Mediaaa,
// MultipleVideoItems, GridSettings, ColorController, TextInput, ToggleControl)
// plus styles.css and MultipleVideoItems.css — ~1,400 lines of CSS. None of it
// belongs in the dashboard's initial download, since the wizard only shows to
// merchants who have no players yet.
const Onboarding = lazy(() => import("../Onboarding/Onboarding"));

// Video modal on App Bridge's <ui-modal> — the same primitive
// SupportTicketModal already uses — rather than Polaris React's Modal. Beyond
// consistency, it removes the raw
// `.Polaris-Modal-Dialog__Modal { max-width: 1100px !important }` block the
// guide modal used to inject into the document, and takes the last Polaris
// React component off the dashboard.
//
// The dialog element stays mounted, because App Bridge resolves
// `shopify.modal.show` by id and the element has to exist to be found. The
// <iframe> inside it is rendered only while open: both sources carry
// `?autoplay=1`, so an always-mounted iframe would start playing audio behind
// a closed dialog.
const VideoModal = ({ id, title, src, open, onClose }) => {
  useEffect(() => {
    if (open) shopify.modal.show(id);
  }, [id, open]);

  // The dialog is also dismissable by its own close button and by Esc, neither
  // of which routes through our handler. Listening for the element's `hide`
  // event is what keeps React state in sync — without it `open` would stay
  // true after a manual close and the modal could never be reopened.
  //
  // Only the show side is driven programmatically above; closing is left to
  // App Bridge and observed here, so there is no show/hide feedback loop.
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("hide", onClose);
    return () => el.removeEventListener("hide", onClose);
  }, [id, onClose]);

  return (
    <Modal id={id} variant="large">
      <TitleBar title={title} />
      {open && (
        <CustomBox className="vp-video-frame">
          <iframe
            width="100%"
            height="100%"
            src={src}
            title={title}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          ></iframe>
        </CustomBox>
      )}
    </Modal>
  );
};

const Dashboard = ({ loaderData, apiKey }) => {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const go = useGo();
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [guideVideoOpen, setGuideVideoOpen] = useState(false);
  // Stable identities: VideoModal subscribes to its dialog's `hide` event
  // keyed on this handler, so a new function each render would tear the
  // listener down and re-add it on every parent render.
  const closeVideoModal = useCallback(() => setIsVideoModalOpen(false), []);
  const closeGuideVideo = useCallback(() => setGuideVideoOpen(false), []);
  const [upgradeOpen, setUpgradeOpen] = useState(true);
  // "Contact support" and "Request a feature" raise the same ticket form and
  // differ only in the heading and the subject it opens with.
  const [ticketIntent, setTicketIntent] = useState({
    heading: "Contact support",
    subject: "",
  });

  const openTicketModal = (heading, subject) => {
    setTicketIntent({ heading, subject });
    shopify.modal.show("supportTicketModal");
  };
  const [copiedEmbed, setCopiedEmbed] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // ── Master feature list (single source of truth, no duplicates) ────────────
  const ALL_FEATURES = [
    { key: "video_limit", label: "Video Players", isCore: true },
    { key: "multiple_videos", label: "Multiple/Grid Video", isCore: true },
    { key: "embeds", label: "YouTube / Vimeo Embeds", isCore: true },
    { key: "basic_custom", label: "Basic Customization", isCore: true },
    { key: "std_support", label: "Standard Support", isCore: true },
    { key: "adv_custom", label: "Advanced Customization", isCore: false },
    { key: "priority_sup", label: "Priority Support", isCore: false },
  ];

  // ── Feature matrix, keyed by the catalogue's plan NAME ────────────────────
  // Only the feature checkmarks live here. Price, credits and the video-limit
  // label all come from the Plans catalogue in Mongo via `normalizePlans`, so
  // the dashboard cannot disagree with what the app actually enforces. It used
  // to hold a full hardcoded plan list that said Pro = 50 players while the
  // catalogue said 10.
  const PLAN_FEATURES = {
    Free: [
      "video_limit",
      "multiple_videos",
      "embeds",
      "basic_custom",
      "std_support",
    ],
    Pro: [
      "video_limit",
      "multiple_videos",
      "embeds",
      "basic_custom",
      "std_support",
      "no_watermark",
      "adv_custom",
      "priority_sup",
    ],
    "Pro Plus": [
      "video_limit",
      "multiple_videos",
      "embeds",
      "basic_custom",
      "std_support",
      "no_watermark",
      "adv_custom",
      "priority_sup",
    ],
  };

  // The Plans catalogue, straight from the loader, with the feature matrix
  // merged in by name. `normalizePlans` also coerces the stored string price to
  // a number — PlanFeatures compares prices, and "10.00" > "9.99" is false as
  // strings.
  const plans = normalizePlans(loaderData?.allPlans || []).map((plan) => ({
    ...plan,
    includedFeatures: PLAN_FEATURES[plan.name] || [],
  }));

  // Shared resolver: live Shopify subscription first, then the stored planId,
  // then stored credits, then Free. Every other page asks the same question the
  // same way.
  const currentPlan = resolvePlan({
    plans: loaderData?.allPlans || [],
    user: loaderData?.user,
    subscription: loaderData?.subscription,
  });

  const activeVideosCount = loaderData?.videos?.length || 0;
  const usage = planUsage(activeVideosCount, currentPlan);

  const maxCredits = usage.max;
  const isUnlimitedPlan = usage.unlimited;
  const planName = currentPlan?.title || "Free";
  const usedCredits = usage.used;

  const handleEnableAppEmbed = () => {
    const themeEditorUrl = `https://${loaderData?.shop}/admin/themes/${loaderData?.themeId}/editor?context=apps&activateAppId=${apiKey}/video_player_by_bplugins_script`;
    window.open(themeEditorUrl, "_blank");
  };

  // Deep-link into the theme editor with a specific app block pre-staged for
  // insertion (Shopify's documented `addAppBlockId` param) — the merchant
  // still clicks Save, but the block is already picked and placed for them,
  // so "Add" is a real one-click action rather than just a link to go find
  // it themselves. `target: "mainSection"` drops it into a template's main
  // section (used for the product-scoped blocks); `target: "newAppsSection"`
  // creates/uses a generic Apps section (used for the anywhere-goes single
  // video embed, since it has no one natural home template).
  const handleAddAppBlock = (
    blockHandle,
    { template = "index", target = "newAppsSection" } = {},
  ) => {
    if (!loaderData?.shop || !loaderData?.themeId) return;
    const params = new URLSearchParams({
      template,
      addAppBlockId: `${apiKey}/${blockHandle}`,
      target,
    });
    window.open(
      `https://${loaderData.shop}/admin/themes/${loaderData.themeId}/editor?${params.toString()}`,
      "_blank",
    );
  };

  // Liquid snippet that renders the player(s) assigned on the Product Video
  // page. It reads the same product metafield the product_video app block
  // uses, so it works on themes without app-block support via a Custom
  // Liquid section (or pasted into the product template's code).
  const productVideoLiquid = [
    "{%- assign pv = product.metafields.bplugins.product_video -%}",
    "{%- if pv != blank -%}",
    "  {%- if pv.type contains 'list' -%}",
    "    {%- for vid in pv.value -%}",
    '      <s-box class="video-plyr-by-bplugins" data-id="{{ vid }}"></s-box>',
    "    {%- endfor -%}",
    "  {%- else -%}",
    '    <s-box class="video-plyr-by-bplugins" data-id="{{ pv.value | default: pv }}"></s-box>',
    "  {%- endif -%}",
    "{%- endif -%}",
  ].join("\n");

  const [copiedLiquid, setCopiedLiquid] = useState(false);
  const handleCopyProductVideoLiquid = () => {
    navigator.clipboard.writeText(productVideoLiquid);
    shopify.toast.show("Product Video Liquid snippet copied!");
    setCopiedLiquid(true);
    setTimeout(() => setCopiedLiquid(false), 2000);
  };

  const handleCopyEmbed = (e, videoId) => {
    e.preventDefault();
    e.stopPropagation();
    const embedCode = `<s-box class="video-plyr-by-bplugins" data-id="${videoId}"></s-box>`;
    navigator.clipboard.writeText(embedCode);
    shopify.toast.show("Embed code copied!");
    setCopiedEmbed(videoId);
    setTimeout(() => setCopiedEmbed(null), 2000);
  };

  const handleCopyId = (e, videoId) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(videoId);
    shopify.toast.show("Player ID copied!");
    setCopiedId(videoId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <CustomBox className="vp-dashboard">
      {/* One gapped column for every dashboard section. The modals below
          sit outside it: SupportTicketModal renders a <ui-modal> inline, and
          a hidden one must not count as a gapped sibling. */}
      <BlockStack gap="500">
        {/* Setup Guide.
          Client-only because Onboarding calls useAppBridge(), which throws when
          window.shopify is undefined — i.e. during SSR. Isolating it here (rather
          than wrapping the whole dashboard) lets everything above server-render,
          so the LCP element paints at TTFB instead of after hydration. It costs
          nothing visually: `dismissed` starts true, so this renders null on the
          first pass either way. */}
        {activeVideosCount === 0 && (
          <ClientOnly fallback={null}>
            {() => (
              <Suspense fallback={null}>
                <Onboarding loaderData={loaderData} apiKey={apiKey} />
              </Suspense>
            )}
          </ClientOnly>
        )}

        {/* Vintage-theme guide: the theme can't use app blocks, but players
          still work everywhere via the app embed + pasted embed code. */}
        {loaderData?.themeSupportsAppBlocks === false && (
          <Box as="section" aria-label="Setup for themes without app blocks">
            <BlockStack gap="500">
              <Banner
                tone="warning"
                title={`Your theme${loaderData?.themeName ? ` “${loaderData.themeName}”` : ""} doesn't support app blocks`}
              >
                <BlockStack gap="300">
                  <Text as="p">
                    No problem — your video players still work on this theme.
                    Place them with the embed code in 3 quick steps:
                  </Text>
                  <InlineStack gap="300">
                    <Button
                      icon={ICONS.tutorials}
                      onClick={() => setGuideVideoOpen(true)}
                    >
                      Watch video guide
                    </Button>
                    <Button
                      icon={ICONS.refresh}
                      onClick={() => revalidator.revalidate()}
                      loading={flag(revalidator.state !== "idle")}
                    >
                      Reload status
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Banner>

              <List type="number">
                <List.Item>
                  <BlockStack gap="300">
                    <Text fontWeight="bold" as="span">
                      Enable the app embed
                    </Text>
                    <Text as="p">
                      Required once. It loads the player on every page of your
                      store — click the button, toggle{" "}
                      <Text fontWeight="bold" as="span">
                        Video Player by bPlugins
                      </Text>{" "}
                      on, then hit{" "}
                      <Text fontWeight="bold" as="span">
                        Save
                      </Text>{" "}
                      in the theme editor.
                    </Text>
                    <InlineStack gap="300">
                      <Button variant="primary" onClick={handleEnableAppEmbed}>
                        Enable app embed
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </List.Item>

                <List.Item>
                  <BlockStack gap="300">
                    <Text fontWeight="bold" as="span">
                      Copy a player&apos;s embed code
                    </Text>
                    <Text as="p">
                      Press{" "}
                      <Text fontWeight="bold" as="span">
                        Embed
                      </Text>{" "}
                      on any player in{" "}
                      <Link url="/app/videos" onClick={go("/app/videos")}>
                        My Videos
                      </Link>
                      . It looks like:
                    </Text>
                    <Box
                      padding="200"
                      borderRadius="200"
                      background="bg-surface-secondary"
                    >
                      <code className="vp-vintage-code vp-vintage-code--inline">
                        {`<s-box class="video-plyr-by-bplugins" data-id="${
                          loaderData?.videos?.[0]?.id || "YOUR_PLAYER_ID"
                        }"></s-box>`}
                      </code>
                    </Box>
                    <InlineStack gap="300">
                      <Button
                        onClick={(e) =>
                          loaderData?.videos?.[0]?.id
                            ? handleCopyEmbed(e, loaderData.videos[0].id)
                            : navigate("/app/videos")
                        }
                      >
                        {loaderData?.videos?.[0]?.id
                          ? copiedEmbed === loaderData.videos[0].id
                            ? "Copied!"
                            : "Copy embed code"
                          : "Create a player"}
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </List.Item>

                <List.Item>
                  <BlockStack gap="300">
                    <Text fontWeight="bold" as="span">
                      Paste it where the video goes
                    </Text>
                    <Text as="p">
                      In the theme editor, add a{" "}
                      <Text fontWeight="bold" as="span">
                        Custom Liquid
                      </Text>
                      ,{" "}
                      <Text fontWeight="bold" as="span">
                        Custom HTML
                      </Text>{" "}
                      or{" "}
                      <Text fontWeight="bold" as="span">
                        Custom content
                      </Text>{" "}
                      section and paste the code. Also works in product
                      descriptions (the{" "}
                      <Text fontWeight="bold" as="span">
                        &lt;/&gt; Show HTML
                      </Text>{" "}
                      view), pages, blog posts, or theme code (
                      <Text fontWeight="bold" as="span">
                        Online Store → Themes → Edit code
                      </Text>
                      , e.g. <code>sections/product-template.liquid</code>).
                    </Text>
                  </BlockStack>
                </List.Item>
              </List>

              <Box
                padding="400"
                borderRadius="300"
                background="bg-surface-secondary"
              >
                <BlockStack gap="300">
                  <InlineStack
                    gap="300"
                    align="space-between"
                    blockAlign="center"
                  >
                    <Text fontWeight="bold" as="span">
                      🎬 Product Video — automatic, per product
                    </Text>
                    <InlineStack gap="300">
                      <Button onClick={handleCopyProductVideoLiquid}>
                        {copiedLiquid ? "Copied!" : "Copy Liquid snippet"}
                      </Button>
                    </InlineStack>
                  </InlineStack>
                  <Text as="p">
                    Players assigned on the{" "}
                    <Link
                      url="/app/product-video"
                      onClick={go("/app/product-video")}
                    >
                      Product Video
                    </Link>{" "}
                    page appear{" "}
                    <Text fontWeight="bold" as="span">
                      automatically below the Add to cart button
                    </Text>{" "}
                    — no setup needed. Want them somewhere else? Paste this
                    snippet where they should show instead: add a{" "}
                    <Text fontWeight="bold" as="span">
                      Custom Liquid
                    </Text>{" "}
                    section to your{" "}
                    <Text fontWeight="bold" as="span">
                      product template
                    </Text>{" "}
                    (or put it in the template&apos;s code), and the automatic
                    placement steps aside.
                  </Text>
                  <code className="vp-vintage-code">{productVideoLiquid}</code>
                </BlockStack>
              </Box>
            </BlockStack>
          </Box>
        )}

        <StatusCards
          loaderData={loaderData}
          apiKey={apiKey}
          copiedEmbed={copiedEmbed}
          copiedId={copiedId}
          onCopyEmbed={handleCopyEmbed}
          onCopyId={handleCopyId}
          planName={planName}
          usedCredits={usedCredits}
          maxCredits={maxCredits}
          unlimited={isUnlimitedPlan}
        />

        {/* App blocks — full width below the three-up grid, so a long list never
          stretches the shorter cards. Only relevant on Online Store 2.0 themes,
          and only once we actually have usage data. */}
        {loaderData?.themeSupportsAppBlocks !== false &&
          loaderData?.appBlockUsage && (
            <AppBlocksCard
              appBlockUsage={loaderData.appBlockUsage}
              onAddBlock={handleAddAppBlock}
            />
          )}

        {/* Analytics Overview — total play counts */}
        {/* Streamed from the loader via defer(): the play counts require a
          catalog walk and full scans of VideoPlay, none of which the page
          needs in order to paint. Rendering them behind Suspense keeps that
          work off TTFB, so LCP no longer scales with play volume. */}
        <Suspense fallback={<AnalyticsSkeleton />}>
          <Await
            resolve={loaderData?.analytics}
            errorElement={<AnalyticsError />}
          >
            {(analytics) => (
              <AnalyticsOverview
                analytics={analytics || {}}
                topPlayerSlot={
                  <Suspense fallback={null}>
                    <Await resolve={loaderData?.topPlayer} errorElement={null}>
                      {(tp) => <TopPlayerStrip topPlayer={tp} />}
                    </Await>
                  </Suspense>
                }
              />
            )}
          </Await>
        </Suspense>

        {/* Free plan sees the plan comparison first; paid plans see help first.
          Same gap either way — is-reversed only flips the order. */}
        <CustomBox
          className={`vp-dash-sections${
            currentPlan?.title === "Free" ? " is-reversed" : ""
          }`}
        >
          <HelpResources
            onOpenTicket={openTicketModal}
            onOpenVideo={() => setIsVideoModalOpen(true)}
          />

          <PlanFeatures
            plans={plans}
            features={ALL_FEATURES}
            currentPlan={currentPlan}
          />
        </CustomBox>

        <FaqSection />
      </BlockStack>

      <VideoModal
        id="dashboardOverviewVideo"
        title="Watch Tutorial: Video Player by bPlugins"
        src="https://www.youtube.com/embed/9tYK6ZgsDVk?autoplay=1&mute=1"
        open={isVideoModalOpen}
        onClose={closeVideoModal}
      />

      <VideoModal
        id="dashboardGuideVideo"
        title="Video guide: themes without app blocks"
        src="https://www.youtube.com/embed/M6LnkdpX5vM?autoplay=1&mute=1"
        open={guideVideoOpen}
        onClose={closeGuideVideo}
      />

      {/* Always mounted; raised via shopify.modal.show("supportTicketModal"). */}
      <SupportTicketModal
        id="supportTicketModal"
        heading={ticketIntent.heading}
        defaultSubject={ticketIntent.subject}
      />
    </CustomBox>
  );
};

export default Dashboard;
