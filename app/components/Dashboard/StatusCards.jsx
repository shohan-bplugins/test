import { useNavigate, useRevalidator } from "@remix-run/react";
import "./StatusCards.css";
import SupportTicketModal from "../SupportTicketModal/SupportTicketModal";
import { useState } from "react";
import { flag, useGo } from "../../utils/polarisWebComponents";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  Button,
  Banner,
  Icon,
  InlineGrid,
  Link as PolarisLink,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  AlertCircleIcon,
  MinusIcon,
  CheckIcon,
  PlusIcon,
  ExternalIcon,
  RefreshIcon,
  CodeIcon,
  ClipboardIcon,
  ListBulletedIcon,
  CreditCardIcon,
  ArrowUpIcon,
  ChartVerticalIcon,
  EmailIcon,
  QuestionCircleIcon,
  NoteIcon,
  StarIcon,
  ChatIcon,
  PlayCircleIcon,
} from "@shopify/polaris-icons";

// Icon names mapped to Polaris-React components
export const ICONS = {
  enabled: CheckCircleIcon,
  disabled: AlertTriangleIcon,
  unknown: AlertCircleIcon,
  notAdded: MinusIcon,
  copied: CheckIcon,
  add: PlusIcon,
  external: ExternalIcon,
  refresh: RefreshIcon,
  embed: CodeIcon,
  copy: ClipboardIcon,
  list: ListBulletedIcon,
  plan: CreditCardIcon,
  upgrade: ArrowUpIcon,
  report: ChartVerticalIcon,
  email: EmailIcon,
  support: QuestionCircleIcon,
  docs: NoteIcon,
  review: StarIcon,
  feature: ChatIcon,
  tutorials: PlayCircleIcon,
};

export { flag, useGo };

// The three status cards sit in one InlineGrid, so they all stretch to the
// tallest. .vp-status-card makes that height flow down through Polaris' Card
// internals (ShadowBevel > Box) so the footer row can be pinned to the bottom
// instead of floating mid-card on the shorter two.
const CardShell = ({ label, title, badge, children, footer }) => (
  <div className="vp-status-card">
    <Card roundedAbove="sm">
      <div className="vp-status-card-inner">
        <div className="vp-status-card-body">
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center" gap="400">
              <Text as="h2" variant="headingMd" fontWeight="bold">
                {title}
              </Text>
              {badge}
            </InlineStack>

            <Box paddingBlockStart="200">{children}</Box>
          </BlockStack>
        </div>

        <div className="vp-status-card-footer">
          <InlineStack gap="300" blockAlign="center">
            {footer}
          </InlineStack>
        </div>
      </div>
    </Card>
  </div>
);

// ── Card 1 · App embed ──────────────────────────────────────────────────────
const AppEmbedCard = ({ appEmbed, shop, themeId, apiKey }) => {
  const revalidator = useRevalidator();
  const [ticketIntent, setTicketIntent] = useState({
    heading: "Contact support",
    subject: "",
  });

  const status =
    appEmbed == null ? "unknown" : appEmbed ? "disabled" : "enabled";

  const openThemeEditor = () => {
    if (!shop || !themeId) return;
    window.open(
      `https://${shop}/admin/themes/${themeId}/editor?context=apps&activateAppId=${apiKey}/video_player_by_bplugins_script`,
      "_blank",
      "noopener",
    );
  };

  const openTicketModal = (heading, subject) => {
    setTicketIntent({ heading, subject });
    shopify.modal.show("supportTicketModal");
  };

  const badge = {
    enabled: (
      <Badge tone="success" icon={ICONS.enabled}>
        Enabled
      </Badge>
    ),
    disabled: (
      <Badge tone="critical" icon={ICONS.disabled}>
        Disabled
      </Badge>
    ),
    unknown: (
      <Badge tone="warning" icon={ICONS.unknown}>
        Unknown
      </Badge>
    ),
  }[status];

  return (
    <>
      <CardShell
        label="App embed status"
        title="App embed"
        badge={badge}
        footer={
          <>
            <Button
              variant={status === "disabled" ? "primary" : "secondary"}
              icon={ICONS.external}
              onClick={openThemeEditor}
            >
              {status === "disabled" ? "Enable app embed" : "Manage app embed"}
            </Button>
            <Button
              variant="tertiary"
              icon={ICONS.refresh}
              loading={flag(revalidator.state !== "idle")}
              onClick={() => revalidator.revalidate()}
            >
              Recheck
            </Button>
          </>
        }
      >
        {status === "enabled" && (
          <Banner tone="success" title="Theme app embed enabled">
            <Text as="p">
              Your theme is set up to show video players on your storefront.
            </Text>
          </Banner>
        )}
        {status === "disabled" && (
          <Banner tone="critical" title="Action required">
            <Text as="p">
              Video players won&apos;t appear on your storefront until you turn
              the app embed on in the theme editor.
            </Text>
          </Banner>
        )}
        {status === "unknown" && (
          <Banner tone="warning" title="Couldn't check your theme">
            <BlockStack gap="300">
              <Text as="p">
                We couldn&apos;t reach your theme just now, so this may be out
                of date. Your players are unaffected — select Recheck to try
                again, or contact support if the problem persists.
              </Text>
              <InlineStack>
                <Button
                  icon={ICONS.support}
                  size="micro"
                  onClick={() => openTicketModal("Contact support", "")}
                >
                  Contact support
                </Button>
              </InlineStack>
            </BlockStack>
          </Banner>
        )}
      </CardShell>
      <SupportTicketModal
        id="supportTicketModal"
        heading={ticketIntent.heading}
        defaultSubject={ticketIntent.subject}
      />
    </>
  );
};

// ── Card 2 · Recent players ─────────────────────────────────────────────────
const RecentPlayersCard = ({
  videos = [],
  copiedEmbed,
  copiedId,
  onCopyEmbed,
  onCopyId,
}) => {
  const go = useGo();
  const recent = videos.slice(0, 3);

  return (
    <CardShell
      label="Recent video players"
      title="Recent players"
      badge={
        <Badge tone="info">
          {videos.length} {videos.length === 1 ? "player" : "players"}
        </Badge>
      }
      footer={
        <>
          <Button
            variant="secondary"
            icon={ICONS.list}
            url="/app/videos"
            onClick={go("/app/videos")}
          >
            All players
          </Button>
          <Button
            variant="primary"
            icon={ICONS.add}
            url="/app/videos?action=new"
            onClick={go("/app/videos?action=new")}
          >
            Add player
          </Button>
        </>
      }
    >
      {recent.length === 0 ? (
        <Box padding="400" borderRadius="200" background="bg-surface-secondary">
          <BlockStack gap="300" inlineAlign="center">
            <Text as="p">No video players yet.</Text>
            <Button
              variant="primary"
              icon={ICONS.add}
              url="/app/videos?action=new"
              onClick={go("/app/videos?action=new")}
            >
              Create your first player
            </Button>
          </BlockStack>
        </Box>
      ) : (
        <BlockStack gap="200">
          {recent.map((video) => {
            const title =
              video?.title?.length > 16
                ? `${video.title.slice(0, 13)}...`
                : video?.title || "Untitled player";
            const to = `/app/customize/${video.id}`;
            return (
              <Box
                key={video.id}
                padding="200"
                borderRadius="200"
                background="bg-surface-secondary"
              >
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  gap="200"
                  wrap={false}
                >
                  <Box>
                    <PolarisLink url={to} onClick={go(to)} removeUnderline>
                      <Text fontWeight="bold" as="span">
                        {title}
                      </Text>
                    </PolarisLink>
                  </Box>
                  <InlineStack gap="200" wrap={false}>
                    <Button
                      variant="tertiary"
                      size="micro"
                      icon={
                        copiedEmbed === video.id ? ICONS.copied : ICONS.embed
                      }
                      accessibilityLabel={`Copy embed code for ${title}`}
                      onClick={(e) => onCopyEmbed(e, video.id)}
                    >
                      {copiedEmbed === video.id ? "Copied" : "Embed"}
                    </Button>
                    <Button
                      variant="tertiary"
                      size="micro"
                      icon={copiedId === video.id ? ICONS.copied : ICONS.copy}
                      accessibilityLabel={`Copy player ID for ${title}`}
                      onClick={(e) => onCopyId(e, video.id)}
                    >
                      {copiedId === video.id ? "Copied" : "Copy ID"}
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Box>
            );
          })}
        </BlockStack>
      )}
    </CardShell>
  );
};

// ── Card 3 · Plan ───────────────────────────────────────────────────────────
const PlanCard = ({ planName, used = 0, max = 0, unlimited = false }) => {
  const go = useGo();
  const over = !unlimited && max > 0 && used > max;
  const percent =
    unlimited || !max ? 0 : Math.min(100, Math.round((used / max) * 100));

  return (
    <CardShell
      label="Plan and usage"
      title="Plan"
      badge={<Badge tone="info">{planName}</Badge>}
      footer={
        <Button
          variant={over ? "primary" : "secondary"}
          icon={over ? ICONS.upgrade : ICONS.plan}
          url="/app/pricing"
          onClick={go("/app/pricing")}
        >
          {over ? "Upgrade plan" : "Manage plan"}
        </Button>
      }
    >
      <BlockStack gap="300">
        <Text as="p">
          <Text fontWeight="bold" as="span">
            {used.toLocaleString()}
          </Text>{" "}
          of{" "}
          <Text as="span">
            {unlimited ? "unlimited" : max.toLocaleString()}
          </Text>{" "}
          {max === 1 && !unlimited ? "player" : "players"} used
        </Text>

        {!unlimited && max > 0 && (
          <div
            className="vp-wc-meter"
            role="progressbar"
            aria-label="Players used"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={Math.min(used, max)}
            aria-valuetext={`${used} of ${max} players used`}
          >
            <div
              className={`vp-wc-meter-fill${over ? " over" : ""}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}

        {over && (
          <Banner tone="warning" title="Over your plan limit">
            <Text as="p">
              You have {used.toLocaleString()} players on a plan that includes{" "}
              {max.toLocaleString()}. Upgrade to keep all of them publishing.
            </Text>
          </Banner>
        )}
      </BlockStack>
    </CardShell>
  );
};

// ── App blocks on your theme ────────────────────────────────────────────────
const BLOCKS = [
  {
    key: "product_video",
    label: "Product Video",
    desc: "Auto-shows the player assigned on the Product Video page.",
    addTarget: { template: "product", target: "mainSection" },
  },
  {
    key: "video_player_by_bplugins",
    label: "Single Video Embed",
    desc: "Add anywhere in the theme editor to embed one video.",
    addTarget: { template: "index", target: "newAppsSection" },
  },
  {
    key: "video_player_block",
    label: "Product Video (old)",
    desc: "Older version of the Product Video block.",
    addTarget: { template: "product", target: "mainSection" },
  },
];

export const AppBlocksCard = ({ appBlockUsage, onAddBlock }) => (
  <Box as="section" aria-label="App blocks on your theme">
    <BlockStack gap="400">
      <BlockStack gap="200">
        <Text as="h2" variant="headingMd" fontWeight="bold">
          App blocks on your theme
        </Text>
        <Text as="p" tone="subdued">
          Whether each video block has been placed on your storefront yet, and
          how many places.
        </Text>
      </BlockStack>

      <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
        {BLOCKS.map((block) => {
          const count = appBlockUsage?.[block.key] || 0;
          const added = count > 0;
          return (
            <Card key={block.key} roundedAbove="sm">
              <BlockStack gap="300">
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  gap="200"
                  wrap={false}
                >
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Icon
                      source={added ? ICONS.enabled : ICONS.notAdded}
                      tone={added ? "success" : "base"}
                    />
                    <Text fontWeight="bold" as="span">
                      {block.label}
                    </Text>
                  </InlineStack>

                  {added ? (
                    <Badge tone="success">
                      {`Added ${count} place${count > 1 ? "s" : ""}`}
                    </Badge>
                  ) : (
                    <Button
                      size="micro"
                      icon={ICONS.add}
                      accessibilityLabel={`Add the ${block.label} block to your theme`}
                      onClick={() => onAddBlock(block.key, block.addTarget)}
                    >
                      Add block
                    </Button>
                  )}
                </InlineStack>

                <Text as="p" tone="subdued">
                  {block.desc}
                </Text>
              </BlockStack>
            </Card>
          );
        })}
      </InlineGrid>
    </BlockStack>
  </Box>
);

// ── Grid ────────────────────────────────────────────────────────────────────
const StatusCards = ({
  loaderData,
  apiKey,
  copiedEmbed,
  copiedId,
  onCopyEmbed,
  onCopyId,
  planName,
  usedCredits,
  maxCredits,
  unlimited,
}) => (
  <InlineGrid columns={{ xs: 1, lg: 3 }} gap="400">
    <AppEmbedCard
      appEmbed={loaderData?.appEmbed}
      shop={loaderData?.shop}
      themeId={loaderData?.themeId}
      apiKey={apiKey}
    />
    <RecentPlayersCard
      videos={loaderData?.videos || []}
      copiedEmbed={copiedEmbed}
      copiedId={copiedId}
      onCopyEmbed={onCopyEmbed}
      onCopyId={onCopyId}
    />
    <PlanCard
      planName={planName}
      used={usedCredits}
      max={maxCredits}
      unlimited={unlimited}
    />
  </InlineGrid>
);

export default StatusCards;
