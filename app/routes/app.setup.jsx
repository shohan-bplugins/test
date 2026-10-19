import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Modal, TitleBar } from "@shopify/app-bridge-react";
import {
  Page,
  Layout,
  Card,
  ActionList,
  BlockStack,
  InlineStack,
  Button,
  Text,
  Badge,
  Select,
  TextField,
  List,
  Link,
  Banner,
  Box,
  InlineGrid,
} from "@shopify/polaris";
import {
  ClipboardIcon,
  CheckIcon,
  PlayCircleIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { useGo, CustomBox, CustomButton } from "../utils/polarisWebComponents";
import prisma from "../db.server";
import { publicOrigin } from "../utils/publicOrigin";
import PageHeader from "../components/PageHeader/PageHeader";
import "../components/PageHeader/PageHeader.css";
import "../styles/styles.css";
import "../styles/setup.css";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Snippets must show THIS deployment's host, so a merchant can copy them
  // without editing anything — and must be https, since they get pasted onto
  // https storefronts where an http:// URL is blocked as mixed content.
  const origin = publicOrigin(request);

  const rows = await prisma.video.findMany({
    where: { shop },
    select: { id: true, title: true, data: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  // A grid player's height depends on how many rows of videos it has, so its
  // iframe can't use a fixed aspect ratio the way a single video can.
  const videos = rows.map((v) => ({
    id: v.id,
    title: v.title,
    isGrid: v?.data?.playerType === "multiple",
  }));

  return json({
    shop,
    origin,
    videos,
    sampleId: videos[0]?.id || "YOUR_PLAYER_ID",
  });
};

// Walkthrough videos, one per setup method. Keyed by tab id so a tab either
// has one or it doesn't — the two developer-facing tabs have none.
//
// These play in a modal on this page rather than linking out: sending a
// merchant to youtube.com mid-setup means losing the tab they were working in,
// and the app embed / theme editor state they were part-way through.
const TUTORIALS = {
  iframe: { youtubeId: "HtX-yxDJFV8", title: "By iFrame" },
  embed: { youtubeId: "p4CB0Xy7EcQ", title: "By Embed Code" },
  block: { youtubeId: "FfHZpb4EdmM", title: "By Theme Block" },
  product: { youtubeId: "s5snBCnWK6k", title: "On Product Pages" },
};

// The tutorial dialog is an App Bridge <ui-modal>, shown and hidden by id —
// the same idiom as ModernDeleteModal, rather than Polaris React's <Modal>
// (which is not on the POLARIS_REACT_ESCAPE_HATCH list).
const TUTORIAL_MODAL_ID = "setup-tutorial-modal";

// Panel headings, hoisted out of the individual tab bodies so the title, its
// badge and the tutorial button always render at the very top of the card —
// they used to sit *below* the "choose a video" picker on the four tabs that
// show it.
const HEADINGS = {
  iframe: {
    title: "By iFrame",
    badge: "Works on any store · no setup",
    tone: "success",
  },
  embed: { title: "By Embed Code", badge: "Shopify themes", tone: "info" },
  block: {
    title: "By Theme Block",
    badge: "Online Store 2.0 themes",
    tone: "info",
  },
  product: {
    title: "On Product Pages",
    badge: "Automatic per product",
    tone: "info",
  },
  headless: {
    title: "Headless / Custom Site",
    badge: "Developer setup",
    tone: "info",
  },
  id: { title: "Finding a Player ID" },
};

/** "Watch tutorial" trigger, shown beside a panel heading when one exists. */
function TutorialButton({ tab, onOpen }) {
  const tutorial = TUTORIALS[tab];
  if (!tutorial) return null;
  return (
    <Button icon={PlayCircleIcon} onClick={() => onOpen(tab)}>
      Watch tutorial
    </Button>
  );
}

/** Code block with a copy button. */
function Snippet({ code, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card background="bg-surface-secondary" padding="400">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text tone="subdued" as="span">
            {label}
          </Text>
          <Button
            icon={copied ? CheckIcon : ClipboardIcon}
            onClick={() => {
              navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
        </InlineStack>
        <Box
          padding="400"
          background="bg-surface-inverse"
          borderWidth="025"
          borderColor="border"
          borderRadius="100"
        >
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              fontFamily: "monospace",
              color: "white",
              fontSize: "var(--p-font-size-100)",
            }}
          >
            {code}
          </pre>
        </Box>
      </BlockStack>
    </Card>
  );
}

export default function Setup() {
  const { shop, origin, videos, sampleId } = useLoaderData();

  const [tab, setTab] = useState("iframe");
  // Which tutorial is playing, as a tab id. null = modal closed.
  const [playing, setPlaying] = useState(null);
  const [videoId, setVideoId] = useState(sampleId);
  const go = useGo();

  // `playing` stays the source of truth; the dialog is driven from it.
  useEffect(() => {
    if (playing) shopify.modal.show(TUTORIAL_MODAL_ID);
    else shopify.modal.hide(TUTORIAL_MODAL_ID);
  }, [playing]);

  // Esc and the dialog's own close button never route through setPlaying, so
  // without this `playing` would stay set and the same tutorial couldn't
  // reopen.
  useEffect(() => {
    const el = document.getElementById(TUTORIAL_MODAL_ID);
    if (!el) return;
    const onHide = () => setPlaying(null);
    el.addEventListener("hide", onHide);
    return () => el.removeEventListener("hide", onHide);
  }, []);

  const chosen = (videoId || "").trim() || "YOUR_PLAYER_ID";
  const looksValid = /^[a-f\d]{24}$/i.test(chosen);

  // ── snippets ────────────────────────────────────────────────────────────
  const chosenIsGrid = videos.some((v) => v.id === chosen && v.isGrid);
  // Single video -> a 16:9 ratio box. Grid player -> a plain fixed height,
  // because a grid's height is driven by its rows, not by one video's shape.
  const iframeTag = chosenIsGrid
    ? `<iframe src="${origin}/embed/${chosen}"
  style="width:100%;height:640px;border:0"
  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
  allowfullscreen title="Videos"></iframe>`
    : `<iframe src="${origin}/embed/${chosen}"
  style="width:100%;aspect-ratio:16/9;min-height:220px;border:0;display:block"
  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
  allowfullscreen title="Video"></iframe>`;
  const embedTag = `<s-box class="video-plyr-by-bplugins" data-id="${chosen}"></s-box>`;
  const loaderTag = `<script src="${origin}/svp/loader.js"\n        data-shop="${shop}"></script>`;
  const productLiquid = `{%- assign pv = product.metafields.bplugins.product_video -%}
{%- if pv != blank -%}
  {%- if pv.type contains 'list' -%}
    {%- for vid in pv.value -%}
      <s-box class="video-plyr-by-bplugins" data-id="{{ vid }}"></s-box>
    {%- endfor -%}
  {%- else -%}
    <s-box class="video-plyr-by-bplugins" data-id="{{ pv.value | default: pv }}"></s-box>
  {%- endif -%}
{%- endif -%}`;
  const reactExample = `import { useEffect } from "react";

export default function VideoPlayer({ playerId }) {
  useEffect(() => { window.svpRefresh?.(); }, [playerId]);
  return <s-box class="video-plyr-by-bplugins" data-id={playerId}  />;
}`;

  const TABS = [
    { id: "iframe", label: "By iFrame", note: "Easiest" },
    { id: "embed", label: "By Embed Code" },
    { id: "block", label: "By Theme Block" },
    { id: "product", label: "On Product Pages" },
    { id: "headless", label: "Headless / Custom Site" },
    { id: "id", label: "Finding a Player ID" },
  ];

  // Whether the chosen video is needed by the visible tab.
  const needsId = ["iframe", "embed", "product", "headless"].includes(tab);

  return (
    <Page>
      <ui-title-bar title="Setup" />
      <PageHeader
        title="Setup"
        subtitle="Every way to put a video on your store — pick whichever suits you"
      />

      <Layout>
        <Layout.Section variant="oneThird">
          <Card padding="0">
            <ActionList
              actionRole="menuitem"
              items={TABS.map((t) => ({
                content: t.label,
                helpText: t.note ? (
                  <s-badge tone="success">{t.note}</s-badge>
                ) : null,
                active: tab === t.id,
                onAction: () => setTab(t.id),
              }))}
            />
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="400">
            <BlockStack gap="400">
              <InlineStack
                align="space-between"
                blockAlign="center"
                wrap={false}
              >
                <InlineStack gap="300" blockAlign="center">
                  <Text variant="headingLg" as="h2">
                    {HEADINGS[tab].title}
                  </Text>
                  {HEADINGS[tab].badge && (
                    <Badge tone={HEADINGS[tab].tone}>
                      {HEADINGS[tab].badge}
                    </Badge>
                  )}
                </InlineStack>
                <TutorialButton tab={tab} onOpen={setPlaying} />
              </InlineStack>

              {/* Shared picker */}
              {needsId && (
                <Box paddingBlockEnd="400">
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                    <Select
                      label="Choose a video"
                      value={videos.some((v) => v.id === chosen) ? chosen : ""}
                      onChange={(value) => setVideoId(value)}
                      options={[
                        ...(videos.length === 0
                          ? [{ label: "No players yet", value: "" }]
                          : []),
                        ...(!videos.some((v) => v.id === chosen)
                          ? [{ label: "Custom ID…", value: "" }]
                          : []),
                        ...videos.map((v) => ({
                          label: v.title || "Untitled player",
                          value: v.id,
                        })),
                      ]}
                    />
                    <TextField
                      label="…or paste a player ID"
                      placeholder="e.g. 6a79606b4b7ac0d3f979ccb4"
                      autoComplete="off"
                      value={videoId}
                      onChange={(value) => setVideoId(value)}
                    />
                  </InlineGrid>
                  {!looksValid && (
                    <Box paddingBlockStart="200">
                      <Text tone="critical" as="p">
                        That doesn't look like a player ID — it should be 24
                        letters/numbers. See{" "}
                        <Text fontWeight="bold" as="span">
                          Finding a Player ID
                        </Text>
                        .
                      </Text>
                    </Box>
                  )}
                </Box>
              )}

              {/* The tabs content blocks */}
              {tab === "iframe" && (
                <BlockStack gap="400">
                  <Text as="p">
                    The simplest option. Paste this wherever you can add HTML —
                    any Shopify theme (new or old), a headless storefront,
                    WordPress, a landing page builder, a page or blog post.{" "}
                    <Text fontWeight="bold" as="span">
                      Nothing to enable
                    </Text>
                    : no app embed, no theme block, no script.
                  </Text>
                  <Snippet label="HTML — paste anywhere" code={iframeTag} />
                  <List type="bullet">
                    <List.Item>
                      Also available per video from{" "}
                      <Text fontWeight="bold" as="span">
                        Videos → iFrame
                      </Text>
                      .
                    </List.Item>
                    {chosenIsGrid ? (
                      <List.Item>
                        This is a{" "}
                        <Text fontWeight="bold" as="span">
                          grid player
                        </Text>
                        , so the snippet uses a fixed <code>height</code>{" "}
                        instead of a fixed shape — a grid's height depends on
                        how many videos are in it. Increase <code>640px</code>{" "}
                        if rows are cut off; the grid also scrolls inside the
                        frame.
                      </List.Item>
                    ) : (
                      <List.Item>
                        The frame is 16:9. For another shape change{" "}
                        <code>aspect-ratio</code>: <code>4/3</code>,{" "}
                        <code>1/1</code> for square — or swap it for a fixed{" "}
                        <code>height:400px</code>.
                      </List.Item>
                    )}
                    <List.Item>
                      Extras: add <code>?bg=000000</code> for a background
                      colour, <code>?fit=cover</code> to fill instead of
                      letterbox.
                    </List.Item>
                    <List.Item>
                      Captions, watermark, password protection and analytics all
                      work exactly as configured.
                    </List.Item>
                  </List>
                </BlockStack>
              )}

              {tab === "embed" && (
                <BlockStack gap="400">
                  <Text as="p">
                    A lightweight placeholder that the app turns into a player.
                    Use this when you want the video to sit inside the page
                    itself rather than in a frame.
                  </Text>
                  <List type="number">
                    <List.Item>
                      Turn on the app embed once —{" "}
                      <Text fontWeight="bold" as="span">
                        Home → Theme App Block → Enable
                      </Text>
                      , then{" "}
                      <Text fontWeight="bold" as="span">
                        Save
                      </Text>{" "}
                      in the theme editor.
                    </List.Item>
                    <List.Item>
                      Paste the code below where the video should appear.
                    </List.Item>
                  </List>
                  <Snippet label="HTML" code={embedTag} />
                  <List type="bullet">
                    <List.Item>
                      <Text fontWeight="bold" as="span">
                        Where you can paste it:
                      </Text>{" "}
                      a{" "}
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
                      section in the theme editor; a product description (use
                      the <code>&lt;/&gt;</code> HTML view); a page or blog
                      post; or your theme's code.
                    </List.Item>
                    <List.Item>
                      Works on{" "}
                      <Text fontWeight="bold" as="span">
                        old (vintage) themes
                      </Text>{" "}
                      too — they can't use theme blocks, but this and the iFrame
                      both work.
                    </List.Item>
                  </List>
                </BlockStack>
              )}

              {tab === "block" && (
                <BlockStack gap="400">
                  <Text as="p">
                    Add a video visually in the theme editor — no code at all.
                    Only available on newer themes that support app blocks.
                  </Text>
                  <List type="number">
                    <List.Item>
                      <Text fontWeight="bold" as="span">
                        Online Store → Themes → Customize
                      </Text>
                    </List.Item>
                    <List.Item>
                      Pick the page (for example a product page), then{" "}
                      <Text fontWeight="bold" as="span">
                        Add section
                      </Text>{" "}
                      or{" "}
                      <Text fontWeight="bold" as="span">
                        Add block
                      </Text>
                    </List.Item>
                    <List.Item>
                      Under{" "}
                      <Text fontWeight="bold" as="span">
                        Apps
                      </Text>
                      , choose a block from{" "}
                      <Text fontWeight="bold" as="span">
                        Video Player by bPlugins
                      </Text>
                    </List.Item>
                    <List.Item>
                      Choose your video in the block settings, then{" "}
                      <Text fontWeight="bold" as="span">
                        Save
                      </Text>
                    </List.Item>
                  </List>
                  <Banner tone="info">
                    <Text as="p">
                      Not seeing the app under Apps? Your theme may not support
                      app blocks. The{" "}
                      <Text fontWeight="bold" as="span">
                        By iFrame
                      </Text>{" "}
                      or{" "}
                      <Text fontWeight="bold" as="span">
                        By Embed Code
                      </Text>{" "}
                      methods work on every theme. The dashboard's{" "}
                      <Link
                        url="/app"
                        onClick={go("/app")}
                      >
                        App Blocks card
                      </Link>{" "}
                      shows which blocks are currently placed on your theme.
                    </Text>
                  </Banner>
                </BlockStack>
              )}

              {tab === "product" && (
                <BlockStack gap="400">
                  <Text as="p">
                    Assign a player to a product once and it shows on that
                    product's page automatically — no code per product.
                  </Text>
                  <List type="number">
                    <List.Item>
                      Go to{" "}
                      <Link
                        url="/app/product-video"
                        onClick={go("/app/product-video")}
                      >
                        Product Video
                      </Link>{" "}
                      and search for the product
                    </List.Item>
                    <List.Item>Assign one or more players and save</List.Item>
                    <List.Item>
                      The video appears on the product page. If your theme
                      supports app blocks you can also position it exactly using
                      the{" "}
                      <Text fontWeight="bold" as="span">
                        Product Video
                      </Text>{" "}
                      block.
                    </List.Item>
                  </List>
                  <Box paddingBlockStart="200">
                    <Text as="p">
                      <Text fontWeight="bold" as="span">
                        Choosing the position yourself
                      </Text>{" "}
                      — add a{" "}
                      <Text fontWeight="bold" as="span">
                        Custom Liquid
                      </Text>{" "}
                      section to your product template and paste this. It
                      renders whatever you assigned, per product.
                    </Text>
                  </Box>
                  <Snippet
                    label="Liquid — product template"
                    code={productLiquid}
                  />
                  <List type="bullet">
                    <List.Item>
                      On a headless storefront, read the metafield{" "}
                      <code>bplugins.product_video</code> with the Storefront
                      API and pass the ID into the embed code.
                    </List.Item>
                  </List>
                </BlockStack>
              )}

              {tab === "headless" && (
                <BlockStack gap="400">
                  <Text as="p">
                    For Hydrogen, Next.js, Remix, Vue or any front end that
                    isn't a Liquid theme. The quickest route is still{" "}
                    <Text fontWeight="bold" as="span">
                      By iFrame
                    </Text>{" "}
                    — use this when you want the videos to be part of the page
                    itself.
                  </Text>
                  <List type="number">
                    <List.Item>
                      Add the loader script once, in your root layout
                    </List.Item>
                    <List.Item>
                      Place the embed code wherever a video should appear
                    </List.Item>
                  </List>
                  <Snippet
                    label="1. HTML — site layout / <head>"
                    code={loaderTag}
                  />
                  <Snippet
                    label="2. HTML — anywhere on the page"
                    code={embedTag}
                  />
                  <Box paddingBlockStart="200">
                    <Text as="p">
                      Videos added after the page loads (route changes, lazy
                      loading, modals) are picked up automatically. If a video
                      ever doesn't appear until you refresh, call{" "}
                      <code>window.svpRefresh()</code> after the route change,
                      or use this component:
                    </Text>
                  </Box>
                  <Snippet
                    label="React / Next.js / Hydrogen"
                    code={reactExample}
                  />
                  <Banner tone="info">
                    <Text as="p">
                      The script URLs above never change, so you won't need to
                      update them after we release an update. Questions?{" "}
                      <Text fontWeight="bold" as="span">
                        support@bplugins.com
                      </Text>
                    </Text>
                  </Banner>
                </BlockStack>
              )}

              {tab === "id" && (
                <BlockStack gap="400">
                  <Text as="p">
                    Every player has a 24-character ID. It's what the iFrame and
                    embed code point at.
                  </Text>
                  <List type="number">
                    <List.Item>
                      Open{" "}
                      <Link
                        url="/app/videos"
                        onClick={go("/app/videos")}
                      >
                        Videos
                      </Link>
                    </List.Item>
                    <List.Item>
                      Find your player and press{" "}
                      <Text fontWeight="bold" as="span">
                        ID
                      </Text>{" "}
                      to copy it, or{" "}
                      <Text fontWeight="bold" as="span">
                        Embed
                      </Text>{" "}
                      /{" "}
                      <Text fontWeight="bold" as="span">
                        iFrame
                      </Text>{" "}
                      to copy a ready-made snippet with the ID already inside
                    </List.Item>
                  </List>
                  <Banner tone="info">
                    <Text as="p">
                      <Text fontWeight="bold" as="span">
                        Tip:
                      </Text>{" "}
                      you rarely need the raw ID — the{" "}
                      <Text fontWeight="bold" as="span">
                        Embed
                      </Text>{" "}
                      and{" "}
                      <Text fontWeight="bold" as="span">
                        iFrame
                      </Text>{" "}
                      buttons give you the complete code to paste.
                    </Text>
                  </Banner>
                  {videos.length > 0 && (
                    <>
                      <Box paddingBlockStart="200">
                        <Text as="p">Your players:</Text>
                      </Box>
                      <Snippet
                        label="Player IDs"
                        code={videos
                          .slice(0, 25)
                          .map(
                            (v) => `${v.id}   ${v.title || "Untitled player"}`,
                          )
                          .join("\n")}
                      />
                    </>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Kept on this page deliberately. A merchant part-way through enabling
          the app embed or editing their theme shouldn't have to leave the app
          — and a youtu.be link would take the whole tab with it. */}
      <Modal id={TUTORIAL_MODAL_ID} variant="large">
        <TitleBar
          title={
            playing
              ? `Video tutorial — ${TUTORIALS[playing].title}`
              : "Video tutorial"
          }
        >
          {/* App Bridge takes plain <CustomButton>s as a modal's actions — they are
              its own API, not markup we get to choose. */}
          <CustomButton onClick={() => setPlaying(null)}>Close</CustomButton>
        </TitleBar>

        {/* The iframe is mounted only while a tutorial is open, so closing the
            dialog tears down the player instead of leaving it loaded. */}
        {playing && (
          <Box padding="400">
            <CustomBox className="su-video">
              <iframe
                /* nocookie host: no YouTube tracking cookie unless the merchant
                   actually plays it. rel=0 keeps end-cards to this channel and
                   modestbranding trims the YouTube chrome, so there is less to
                   click that leads off-site. */
                src={`https://www.youtube-nocookie.com/embed/${TUTORIALS[playing].youtubeId}?autoplay=1&rel=0&modestbranding=1`}
                title={`Video tutorial — ${TUTORIALS[playing].title}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </CustomBox>
          </Box>
        )}
      </Modal>
    </Page>
  );
}
