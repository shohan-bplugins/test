import { useCallback } from "react";
import SelectInput from "../SelectInput/SelectInput";

/**
 * GridSettings — layout controls for the multi-video player.
 *
 * Built on s-select / s-number-field / s-switch. The clamping logic is
 * unchanged; what went away is the markup around it — three
 * `.gs-column-input` number boxes with unassociated captions and a
 * checkbox-hack switch.
 *
 * View Mode is a select rather than the segmented <s-button-group> it was:
 * that group declares `slotAssignment: "manual"` with only `primary-action`
 * and `secondary-actions` slots, so its three unslotted buttons were never
 * assigned anywhere and the control rendered as empty space — Carousel and
 * Slider were unreachable even though both are implemented end to end (the
 * preview in app.customize.$id.jsx and `svp-player.js` on the storefront).
 * Slotting them properly is not a fix either: a segmented group requires
 * gap="none", which only accepts `secondary` variants, leaving no way to show
 * which mode is active.
 *
 * The three device silhouettes next to Desktop/Tablet/Mobile are gone: they
 * repeated the text label beside them, and polaris-1.js has no device icon to
 * swap them for. Which device is being previewed is now said in words, under
 * the field it applies to, rather than encoded as a colour.
 */
const VIEW_MODES = [
  { value: "grid", label: "Grid" },
  { value: "carousel", label: "Carousel" },
  { value: "slider", label: "Slider" },
];

const COLUMN_LIMITS = { desktop: [1, 6], tablet: [1, 4], mobile: [1, 3] };
const COLUMN_FIELDS = [
  { key: "desktop", label: "Desktop" },
  { key: "tablet", label: "Tablet" },
  { key: "mobile", label: "Mobile" },
];

const clamp = (value, min, max, fallback) => {
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? fallback : Math.max(min, Math.min(max, num));
};

const GridSettings = ({ gridSettings, setGridSettings, activeDevice }) => {
  const handleViewModeChange = useCallback(
    (mode) => setGridSettings((prev) => ({ ...prev, viewMode: mode })),
    [setGridSettings],
  );

  const handleColumnChange = useCallback(
    (device, value) => {
      const [min, max] = COLUMN_LIMITS[device];
      setGridSettings((prev) => ({
        ...prev,
        columns: { ...prev.columns, [device]: clamp(value, min, max, min) },
      }));
    },
    [setGridSettings],
  );

  const handleGapChange = useCallback(
    (value) =>
      setGridSettings((prev) => ({ ...prev, gap: clamp(value, 0, 100, 0) })),
    [setGridSettings],
  );

  const handleAutoplayChange = useCallback(
    (checked) => setGridSettings((prev) => ({ ...prev, autoplay: checked })),
    [setGridSettings],
  );

  const handleAutoplaySpeedChange = useCallback(
    (value) =>
      setGridSettings((prev) => ({
        ...prev,
        autoplaySpeed: clamp(value, 2, 10, 3),
      })),
    [setGridSettings],
  );

  return (
    <s-stack direction="block" gap="base">
      <SelectInput
        label="View Mode"
        name="view_mode"
        options={VIEW_MODES}
        value={gridSettings.viewMode || "grid"}
        onChange={handleViewModeChange}
      />

      {gridSettings.viewMode !== "slider" && (
        <s-stack direction="block" gap="small-200">
          <s-heading>Videos Per Row</s-heading>
          <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="small-200">
            {COLUMN_FIELDS.map(({ key, label }) => (
              <s-number-field
                key={key}
                label={label}
                details={activeDevice === key ? "Previewing" : undefined}
                min={COLUMN_LIMITS[key][0]}
                max={COLUMN_LIMITS[key][1]}
                value={String(gridSettings.columns?.[key] || 1)}
                onInput={(event) => handleColumnChange(key, event.target.value)}
              />
            ))}
          </s-grid>
          <s-number-field
            label="Gap Between Items"
            suffix="px"
            min={0}
            max={100}
            value={String(gridSettings.gap || 0)}
            onInput={(event) => handleGapChange(event.target.value)}
          />
        </s-stack>
      )}

      {gridSettings.viewMode !== "grid" && (
        <s-stack direction="block" gap="small-200">
          <s-switch
            label="Autoplay Items"
            checked={gridSettings.autoplay || false}
            onChange={(event) => handleAutoplayChange(event.target.checked)}
          />
          {gridSettings.autoplay && (
            <s-number-field
              label="Interval"
              suffix="s"
              min={2}
              max={10}
              value={String(gridSettings.autoplaySpeed || 3)}
              onInput={(event) => handleAutoplaySpeedChange(event.target.value)}
            />
          )}
        </s-stack>
      )}
    </s-stack>
  );
};

export default GridSettings;
