import {
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  ButtonGroup,
  Button,
  Select,
  TextField,
  Box,
  Icon,
  Badge,
} from "@shopify/polaris";
import { LinkIcon } from "@shopify/polaris-icons";

/**
 * SpacingGroup — the padding/margin/dimension editor in the customizer.
 *
 * Rebuilt on standard Polaris components to fix layout issues.
 */
const DEVICES = ["desktop", "tablet", "mobile"];
const UNITS = ["px", "%", "em", "rem", "vh", "vw"];

const LABELS_FOR_TYPE = {
  DIMENSIONS: ["HEIGHT", "WIDTH"],
  VIDEO_RATIO: ["WIDTH", "HEIGHT"],
};

const DeviceIcon = ({ device, isActive }) => {
  const stroke = "currentColor";
  if (device === "desktop") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={isActive ? stroke : "none"}
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2" y="3" width="20" height="15" rx="2" ry="2" />
        <line x1="10" y1="22" x2="14" y2="22" />
      </svg>
    );
  }
  const [x, width] = device === "tablet" ? [5, 14] : [7, 10];
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x={x}
        y="2"
        width={width}
        height="20"
        rx={device === "tablet" ? 2 : 1}
        ry={device === "tablet" ? 2 : 1}
      />
      <line x1="12" y1="18" x2="12" y2="18" />
    </svg>
  );
};

const SpacingGroup = ({
  type,
  values,
  unit,
  isLinked,
  activeDevice,
  onValueChange,
  onUnitChange,
  onLinkToggle,
  onDeviceChange,
}) => {
  const labels = LABELS_FOR_TYPE[type] ?? ["TOP", "RIGHT", "BOTTOM", "LEFT"];
  const showLink = !LABELS_FOR_TYPE[type];
  const showUnitDropdown = type !== "VIDEO_RATIO";

  return (
    <Box paddingBlockEnd="600">
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm" tone="subdued">
          {type === "Round Corner" ? "ROUND CORNER" : type.toUpperCase()}
        </Text>

        <InlineStack gap="300" blockAlign="center" align="space-between">
          <ButtonGroup segmented>
            {DEVICES.map((device) => (
              <Button
                key={device}
                pressed={device === activeDevice}
                accessibilityLabel={device}
                onClick={() => onDeviceChange(device)}
                size="micro"
              >
                <DeviceIcon
                  device={device}
                  isActive={device === activeDevice}
                />
              </Button>
            ))}
          </ButtonGroup>

          {showUnitDropdown ? (
            <Box width="90px">
              <Select
                label="Unit"
                labelHidden
                options={UNITS.map((u) => ({ label: u, value: u }))}
                value={unit}
                onChange={(value) => onUnitChange(value)}
              />
            </Box>
          ) : (
            <Badge tone="info">RATIO</Badge>
          )}
        </InlineStack>

        {/* One grid rather than a flex row wrapping a grid: the link button is
            just a trailing auto-width column, and alignItems="end" replaces the
            2px nudge that used to bottom-align it against the fields. */}
        <InlineGrid
          columns={
            showLink
              ? `repeat(${labels.length}, 1fr) auto`
              : `repeat(${labels.length}, 1fr)`
          }
          gap="200"
          alignItems="end"
        >
          {labels.map((label, index) => (
            <TextField
              key={label}
              label={label}
              type="number"
              min={0}
              value={String(values[index] ?? "")}
              disabled={
                type === "DIMENSIONS" &&
                label === "HEIGHT" &&
                values[index] == 0
              }
              onChange={(value) => onValueChange(index, value)}
              autoComplete="off"
            />
          ))}

          {showLink && (
            <Button
              icon={<Icon source={LinkIcon} />}
              pressed={isLinked}
              accessibilityLabel={isLinked ? "Unlink values" : "Link values"}
              onClick={onLinkToggle}
              variant="tertiary"
            />
          )}
        </InlineGrid>
      </BlockStack>
    </Box>
  );
};

export default SpacingGroup;
