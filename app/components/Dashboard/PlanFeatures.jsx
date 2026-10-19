import { ICONS, useGo } from "./StatusCards";
import {
  Box,
  Text,
  Badge,
  Button,
  BlockStack,
  InlineStack,
  DataTable,
  Icon,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  XIcon,
  StarIcon,
  ArrowDownIcon,
} from "@shopify/polaris-icons";

const PlanFeatures = ({ plans = [], features = [], currentPlan }) => {
  const go = useGo();
  const currentId = currentPlan?.id || null;
  const currentPrice = currentPlan?.price || 0;

  const headings = [
    "Feature",
    ...plans.map((plan) => (
      <BlockStack gap="100" key={plan.id}>
        <Text as="span" variant="headingSm">
          {plan.title}
        </Text>
        <Text as="span" tone="subdued">
          <Text as="span" fontWeight="bold">
            {plan.price > 0 ? `$${plan.price}` : "Free"}
          </Text>
          {" / month"}
        </Text>
        {plan.name === "Pro Plus" && (
          <Box paddingBlockStart="100">
            <Badge tone="success" icon={StarIcon}>
              Most popular
            </Badge>
          </Box>
        )}
      </BlockStack>
    )),
  ];

  const rows = features.map((feature) => {
    const row = [
      <InlineStack gap="200" blockAlign="center" wrap={false} key="label">
        <Text as="span" variant="bodyMd">
          {feature.label}
        </Text>
        {feature.isCore && <Badge>Core</Badge>}
      </InlineStack>,
    ];

    plans.forEach((plan) => {
      if (feature.key === "video_limit") {
        row.push(
          <Text as="span" variant="bodyMd" fontWeight="bold" key={plan.id}>
            {plan.limitLabel}
          </Text>,
        );
      } else {
        const included = plan.includedFeatures?.includes(feature.key);
        row.push(
          included ? (
            <Icon source={CheckCircleIcon} tone="success" key={plan.id} />
          ) : (
            <Icon source={XIcon} tone="subdued" key={plan.id} />
          ),
        );
      }
    });

    return row;
  });

  // CTA Row
  const ctaRow = [
    "", // Empty first column
    ...plans.map((plan) => {
      const isCurrent = plan.id === currentId;
      const isUpgrade = plan.price > currentPrice;

      if (isCurrent) {
        return (
          <Badge tone="info" icon={CheckCircleIcon} key={plan.id}>
            Current plan
          </Badge>
        );
      }

      return (
        <Button
          key={plan.id}
          variant={isUpgrade ? "primary" : "secondary"}
          icon={isUpgrade ? ICONS.upgrade : ArrowDownIcon}
          accessibilityLabel={`${
            isUpgrade ? "Upgrade to" : "Downgrade to"
          } the ${plan.title} plan`}
          url="/app/pricing"
          onClick={go("/app/pricing")}
        >
          {isUpgrade
            ? currentPrice === 0
              ? "Get started"
              : "Upgrade"
            : "Downgrade"}
        </Button>
      );
    }),
  ];

  rows.push(ctaRow);

  return (
    <Box as="section" aria-label="Compare plan features">
      <BlockStack gap="400">
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd" fontWeight="bold">
            Features
          </Text>
          <Text tone="subdued" as="p">
            Compare plan details
          </Text>
        </BlockStack>

        <Box background="bg-surface" borderRadius="300" shadow="100">
          <div className="vp-plan-compare">
            <DataTable
              columnContentTypes={["text", "text", "text", "text"]}
              headings={headings}
              rows={rows}
              hasZebraStripingOnData
            />
          </div>
        </Box>
      </BlockStack>
    </Box>
  );
};

export default PlanFeatures;
