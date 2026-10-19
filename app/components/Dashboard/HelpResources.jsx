import { useState } from "react";
import {
  Box,
  Text,
  Button,
  InlineStack,
  BlockStack,
  InlineGrid,
  Avatar,
  Collapsible,
  VideoThumbnail,
  ButtonGroup,
} from "@shopify/polaris";
import { ChevronUpIcon, ChevronDownIcon } from "@shopify/polaris-icons";
import { ICONS, useGo } from "./StatusCards";

const SUPPORT_EMAIL = "support@bplugins.com";
const REVIEW_URL =
  "https://apps.shopify.com/video-player-by-bplugins#modal-show=ReviewListingModal";

const HelpResources = ({ onOpenTicket, onOpenVideo }) => {
  const go = useGo();
  const [open, setOpen] = useState(true);
  const [emailCopied, setEmailCopied] = useState(false);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      shopify.toast.show("Email address copied to clipboard!");
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      shopify.toast.show(`Couldn't copy — email us at ${SUPPORT_EMAIL}`, {
        isError: true,
      });
    }
  };

  const quickLinks = [
    {
      label: "View docs",
      icon: ICONS.docs,
      onClick: go("/app/documentation"),
      href: "/app/documentation",
    },
    {
      label: "Write a review",
      icon: ICONS.review,
      onClick: () => window.open(REVIEW_URL, "_blank", "noopener"),
    },
    {
      label: "Request a feature",
      icon: ICONS.feature,
      onClick: () => onOpenTicket("Request a feature", "Feature request: "),
    },
    { label: "Video tutorials", icon: ICONS.tutorials, onClick: onOpenVideo },
  ];

  return (
    <Box as="section" aria-label="Help and resources">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd" fontWeight="bold">
            Help and Resources
          </Text>
        </InlineStack>

        <Collapsible
          id="vp-help-body"
          open={open}
          transition={{ duration: "150ms", timingFunction: "ease" }}
        >
          <InlineGrid columns={{ xs: 1, md: "3fr 1fr 1fr" }} gap="400">
            {/* Support */}
            <Box
              padding="400"
              borderRadius="300"
              background="bg-surface"
              shadow="100"
              minHeight="100%"
            >
              {/* The three cards stretch to the tallest in the row (the video
                  one), so the buttons used to sit right under the copy with
                  dead space beneath them. This column pushes them to the card
                  footer instead. BlockStack has no height prop, hence the div. */}
              <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <BlockStack gap="400">
                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    <Avatar initials="ST" alt="Support Team" size="md" />
                    <BlockStack gap="0">
                      <Text fontWeight="bold" as="span">
                        Support Team
                      </Text>
                      <Text tone="subdued" as="span">
                        Customer Success
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Text tone="subdued" as="p">
                    Email us for 1:1 support to set up Video Player by bPlugins
                    on your store.
                  </Text>
                </BlockStack>
                <div
                  style={{
                    marginBlockStart: "auto",
                    paddingBlockStart: "var(--p-space-400)",
                  }}
                >
                  <ButtonGroup>
                    <Button
                      variant="primary"
                      icon={emailCopied ? ICONS.copied : ICONS.email}
                      onClick={copyEmail}
                    >
                      {emailCopied ? "Copied!" : "Email support"}
                    </Button>
                    <Button
                      variant="secondary"
                      icon={ICONS.support}
                      onClick={() => onOpenTicket("Contact support", "")}
                    >
                      Contact support
                    </Button>
                  </ButtonGroup>
                </div>
              </div>
            </Box>

            {/* Quick links */}
            <Box
              padding="400"
              borderRadius="300"
              background="bg-surface"
              shadow="100"
            >
              <BlockStack gap="200">
                {quickLinks.map((link) => (
                  <Button
                    key={link.label}
                    icon={link.icon}
                    url={link.href}
                    onClick={link.onClick}
                    textAlign="left"
                  >
                    {link.label}
                  </Button>
                ))}
              </BlockStack>
            </Box>

            {/* Overview video */}
            <Box
              padding="400"
              borderRadius="300"
              background="bg-surface"
              shadow="100"
            >
              <BlockStack gap="400">
                <Text fontWeight="bold" as="span">
                  Watch Tutorial
                </Text>
                <VideoThumbnail
                  videoLength={82}
                  thumbnailUrl="/Video_Player_by_bPlugins_thumbnail.png"
                  onClick={onOpenVideo}
                  accessibilityLabel="Play the Video Player by bPlugins overview video"
                />
              </BlockStack>
            </Box>
          </InlineGrid>
        </Collapsible>
      </BlockStack>
    </Box>
  );
};

export default HelpResources;
