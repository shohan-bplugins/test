import { useState } from "react";
import {
  Box,
  Text,
  BlockStack,
  InlineStack,
  Collapsible,
  Link,
  Icon,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";

const SUPPORT_EMAIL = "support@bplugins.com";

const FAQS = [
  {
    q: "How do I add a video player to my Shopify store?",
    a: 'Go to your Shopify theme editor, select "Add section" or "Add block", search for "Video Player by bPlugins" and add it to the page you want. You can also place a player anywhere using the embed code copied from your video list.',
  },
  {
    q: "What video sources are supported?",
    a: "The Free plan supports YouTube and Vimeo embed links. Pro and Pro Plus additionally support direct MP4 uploads, so you can host and stream your own videos without relying on a third-party platform.",
  },
  {
    q: "Why is my video player not showing on the storefront?",
    a: 'The most common reason is that the app embed is turned off. On your dashboard, find the "App embed" card and select "Enable app embed" — that opens the theme editor with the toggle ready. Remember to select Save in the theme editor afterwards.',
  },
  {
    q: "How do I customize the player appearance?",
    a: 'Select "Edit" next to any video in your video list to open the customization panel. From there you can change colors, controls, autoplay, loop, poster image, border radius and much more.',
  },
  {
    q: "Can I display multiple videos in a grid or carousel?",
    a: "Yes. Pro and Pro Plus include the Multiple/Grid Video feature, so you can group videos into a carousel, slider or grid layout — all customizable from the same settings panel.",
  },
  {
    q: "How do I embed a video on a product or blog page?",
    a: 'From your video list, select "Embed" next to any player to copy its embed code, then paste that snippet into any Shopify page, blog post or custom HTML section.',
  },
  {
    q: "What is the difference between the Free, Pro and Pro Plus plans?",
    a: "Free supports up to 5 YouTube or Vimeo players. Pro adds MP4 upload, watermark removal, advanced customization and up to 50 players. Pro Plus includes everything in Pro, plus a white-label player, analytics and a dedicated account manager.",
  },
  {
    q: "How do I get support if something is not working?",
    a: (
      <>
        Contact us from the Help and Resources section above, or email{" "}
        <Link url={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Link>. Pro Plus
        merchants receive priority responses, typically within a few hours.
      </>
    ),
  },
];

const FaqSection = () => {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <Box as="section" aria-label="Frequently asked questions">
      <BlockStack gap="400">
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd" fontWeight="bold">
            Frequently asked questions
          </Text>
          <Text tone="subdued" as="p">
            Everything you need to know about Video Player by bPlugins
          </Text>
        </BlockStack>

        <BlockStack gap="300">
          {FAQS.map((item, i) => {
            const open = openIndex === i;
            const panelId = `vp-faq-panel-${i}`;
            return (
              <Box
                key={item.q}
                padding="400"
                borderRadius="300"
                background="bg-surface"
                shadow="100"
              >
                <div
                  onClick={() => setOpenIndex(open ? null : i)}
                  aria-expanded={open ? "true" : "false"}
                  aria-controls={panelId}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenIndex(open ? null : i);
                    }
                  }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "12px",
                    width: "100%",
                    cursor: "pointer",
                    outline: "none",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <Text fontWeight="bold" as="span">
                      {item.q}
                    </Text>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <Icon
                      source={open ? ChevronUpIcon : ChevronDownIcon}
                      tone="subdued"
                    />
                  </div>
                </div>

                <Collapsible
                  id={panelId}
                  open={open}
                  transition={{ duration: "150ms", timingFunction: "ease" }}
                >
                  <Box paddingBlockStart="300">
                    <Text tone="subdued" as="p">
                      {item.a}
                    </Text>
                  </Box>
                </Collapsible>
              </Box>
            );
          })}
        </BlockStack>
      </BlockStack>
    </Box>
  );
};

export default FaqSection;
