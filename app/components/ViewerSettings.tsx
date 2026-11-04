import * as React from "react";

import { fieldChecked, fieldValue, flag } from "~/components/polaris/helpers";
import type { ViewerConfig } from "~/components/ViewerPreview";
import { useT } from "~/i18n";
import {
  CONTROL_ITEMS,
  CONTROL_SLOTS,
  isControlSlot,
  moveControl,
  slotOfControl,
} from "~/lib/viewer-config";

// Message keys (namespace "viewerSettings"), translated at render.
const SLOT_NAMES: Record<(typeof CONTROL_SLOTS)[number], string> = {
  "top-left": "slotTopLeft",
  "top-center": "slotTopCenter",
  "top-right": "slotTopRight",
  "bottom-left": "slotBottomLeft",
  "bottom-center": "slotBottomCenter",
  "bottom-right": "slotBottomRight",
};

const TONE_MAPPINGS = [
  "None",
  "Linear",
  "Reinhard",
  "Cineon",
  "ACESFilmic",
] as const;
const TONE_MAPPING_LABELS: Record<(typeof TONE_MAPPINGS)[number], string> = {
  None: "toneNone",
  Linear: "toneLinear",
  Reinhard: "toneReinhard",
  Cineon: "toneCineon",
  ACESFilmic: "toneAcesFilmic",
};
const REPEAT_MODES = ["one", "all", "none"] as const;
const REPEAT_MODE_LABELS: Record<(typeof REPEAT_MODES)[number], string> = {
  one: "repeatOne",
  all: "repeatAll",
  none: "repeatNone",
};

/** The settings search, lower-cased and trimmed; empty when not searching. */
const QueryContext = React.createContext("");

function matches(text: unknown, query: string): boolean {
  return typeof text === "string" && text.toLowerCase().includes(query);
}

/**
 * A collapsible group of settings.
 *
 * Composed from `s-clickable` and `s-box` rather than a `<details>` element:
 * the disclosure has to carry admin border, padding and hover treatment, and a
 * bare `<details>` inside a Polaris page renders with browser chrome that
 * belongs to no design system. The component set ships no accordion of its own,
 * so this is assembled from its primitives and inherits their tokens.
 */
function CollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const query = React.useContext(QueryContext);
  // While searching, a group whose title matches shows everything; otherwise
  // only the fields whose label or help text match, and the group is hidden
  // when none do. Matching groups are shown open.
  let shown: React.ReactNode = children;
  if (query && !matches(title, query)) {
    const hits = React.Children.toArray(children).filter((child) => {
      if (!React.isValidElement(child)) return false;
      const props = child.props as { label?: unknown; details?: unknown };
      return matches(props.label, query) || matches(props.details, query);
    });
    if (hits.length === 0) return null;
    shown = hits;
  }
  const isOpen = query ? true : open;
  return (
    /*
      An open group is outlined in pale cyan (#ade8f4). s-box only has
      neutral border colours, so the outline is on a
      wrapper, pulled in by 1px to sit over the grey border instead of beside it.
    */
    <div
      data-settings-group
      style={{
        borderRadius: 8,
        outline: isOpen ? "2px solid #ade8f4" : "2px solid transparent",
        outlineOffset: -1,
        transition: "outline-color 120ms ease",
      }}
    >
    <s-box
      borderWidth="base"
      borderStyle="solid"
      borderColor="base"
      borderRadius="base"
      // White, so the groups stand out when the section around them is tinted
      // (CollapsibleSection's open state).
      background="base"
    >
      <s-clickable
        padding="small-100"
        inlineSize="100%"
        aria-expanded={isOpen}
        onClick={() => setOpen(!isOpen)}
      >
        {/*
          `1fr auto`, not a flex row with space-between: space-between only
          distributes space a container already has spare, and this row has
          none, so the chevron would sit against the title instead of at the
          edge. The grid states the split outright.
        */}
        <s-grid
          gridTemplateColumns="1fr auto"
          gap="small"
          alignItems="center"
          inlineSize="100%"
        >
          <s-stack
            direction="inline"
            gap="small-500"
            alignItems="center"
            minInlineSize="0"
          >
            <s-icon type={icon as never} color="subdued" size="small" />
            <s-text type="strong">{title}</s-text>
          </s-stack>
          <s-icon
            type={isOpen ? "chevron-up" : "chevron-down"}
            color="subdued"
            size="small"
          />
        </s-grid>
      </s-clickable>

      {isOpen ? (
        <s-box
          padding="small"
          borderWidth="base none none none"
          borderStyle="solid"
          borderColor="base"
        >
          <s-stack direction="block" gap="base">
            {shown}
          </s-stack>
        </s-box>
      ) : null}
    </s-box>
    </div>
  );
}

type Props = {
  config: ViewerConfig;
  onChange: (config: ViewerConfig) => void;
  /** Shows only the settings whose label, help text or group title match. */
  query?: string;
};

export function ViewerSettings({ config, onChange, query = "" }: Props) {
  const t = useT("viewerSettings");
  const tl = useT("layout");
  const q = query.trim().toLowerCase();
  // Whether the search hid every group, read off what actually rendered: the
  // groups do the matching themselves, against their translated labels.
  const listRef = React.useRef<HTMLDivElement>(null);
  const [noMatches, setNoMatches] = React.useState(false);
  React.useEffect(() => {
    setNoMatches(
      !!q && !listRef.current?.querySelector("[data-settings-group]"),
    );
  });
  function update<K extends keyof ViewerConfig>(
    key: K,
    value: ViewerConfig[K],
  ) {
    onChange({ ...config, [key]: value });
  }

  /**
   * Numbers arrive as strings and an empty field parses as NaN, which would
   * otherwise be written straight into the config and reach the viewer.
   */
  function num(event: Event, fallback: number): number {
    const parsed = Number(fieldValue(event));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return (
    <QueryContext.Provider value={q}>
    <div ref={listRef}>
    {noMatches ? (
      <s-text color="subdued">{t("noSettingsMatch", { query: query.trim() })}</s-text>
    ) : null}
    <s-stack direction="block" gap="base">
      <CollapsibleSection title={t("sectionDisplay")} icon="color">
        {/*
          Number fields, where these were range sliders. Polaris ships no
          slider, and the alternative — keeping a hand-styled range input — is
          the one control on the page that would not inherit admin tokens or
          focus treatment. A number field is also the more precise instrument
          for values a merchant usually knows exactly (a 480px height, a 45°
          yaw), and it is reachable by keyboard without a custom key handler.
        */}
        <s-number-field
          label={t("heightLabel")}
          details={t("heightDetails")}
          suffix="px"
          min={200}
          max={1200}
          step={10}
          value={String(config.height)}
          onInput={(e) => update("height", num(e, config.height))}
        />

        <s-color-field
          label={t("backgroundLabel")}
          details={t("backgroundDetails")}
          value={config.background}
          onInput={(e) => update("background", fieldValue(e))}
        />

        <s-number-field
          label={t("exposureLabel")}
          details={t("exposureDetails")}
          min={0}
          max={5}
          step={0.05}
          value={String(config.exposure)}
          onInput={(e) => update("exposure", num(e, config.exposure))}
        />

        <s-select
          label={t("toneMappingLabel")}
          value={config.toneMapping}
          onInput={(e) => update("toneMapping", fieldValue(e))}
        >
          {TONE_MAPPINGS.map((tm) => (
            <s-option key={tm} value={tm}>
              {t(TONE_MAPPING_LABELS[tm])}
            </s-option>
          ))}
        </s-select>

        <s-switch
          label={t("defaultEnvLabel")}
          details={t("defaultEnvDetails")}
          checked={flag(config.useDefaultEnv)}
          onInput={(e) => update("useDefaultEnv", fieldChecked(e))}
        />
        <s-switch
          label={t("skyboxBlurLabel")}
          checked={flag(config.skyboxBlur)}
          onInput={(e) => update("skyboxBlur", fieldChecked(e))}
        />
        <s-switch
          label={t("shadowLabel")}
          checked={flag(config.shadow)}
          onInput={(e) => update("shadow", fieldChecked(e))}
        />
      </CollapsibleSection>

      <CollapsibleSection title={t("sectionEnvironment")} icon="sun" defaultOpen={false}>
        <s-url-field
          label={t("skyboxLabel")}
          placeholder="https://...hdr"
          details={t("skyboxDetails")}
          value={config.skybox}
          onInput={(e) => update("skybox", fieldValue(e))}
        />
        <s-url-field
          label={t("envmapLabel")}
          placeholder="https://...hdr"
          details={t("envmapDetails")}
          value={config.envmap}
          onInput={(e) => update("envmap", fieldValue(e))}
        />
      </CollapsibleSection>

      <CollapsibleSection title={t("sectionCamera")} icon="camera" defaultOpen={false}>
        <s-select
          label={t("fovModeLabel")}
          details={t("fovModeDetails")}
          value={config.fovMode}
          onInput={(e) => update("fovMode", fieldValue(e) as "auto" | "custom")}
        >
          <s-option value="auto">{t("fovAuto")}</s-option>
          <s-option value="custom">{t("fovCustom")}</s-option>
        </s-select>

        <s-number-field
          label={t("fovLabel")}
          suffix="°"
          details={
            config.fovMode === "auto"
              ? t("fovDisabled")
              : t("fovDetails")
          }
          disabled={flag(config.fovMode === "auto")}
          min={1}
          max={179}
          step={1}
          value={String(config.fov)}
          onInput={(e) => update("fov", num(e, config.fov))}
        />
        <s-number-field
          label={t("yawLabel")}
          suffix="°"
          min={-180}
          max={180}
          step={1}
          value={String(config.yaw)}
          onInput={(e) => update("yaw", num(e, config.yaw))}
        />
        <s-number-field
          label={t("pitchLabel")}
          suffix="°"
          min={-90}
          max={90}
          step={1}
          value={String(config.pitch)}
          onInput={(e) => update("pitch", num(e, config.pitch))}
        />
        <s-number-field
          label={t("zoomLabel")}
          details={t("zoomDetails")}
          min={-50}
          max={50}
          step={0.5}
          value={String(config.initialZoom)}
          onInput={(e) => update("initialZoom", num(e, config.initialZoom))}
        />
        <s-switch
          label={t("maintainSizeLabel")}
          checked={flag(config.maintainSize)}
          onInput={(e) => update("maintainSize", fieldChecked(e))}
        />
      </CollapsibleSection>

      <CollapsibleSection title={t("sectionControls")} icon="settings" defaultOpen={false}>
        <s-switch
          label={t("allowRotateLabel")}
          checked={flag(config.rotate)}
          onInput={(e) => update("rotate", fieldChecked(e))}
        />
        <s-switch
          label={t("allowTranslateLabel")}
          checked={flag(config.translate)}
          onInput={(e) => update("translate", fieldChecked(e))}
        />
        <s-switch
          label={t("allowZoomLabel")}
          details={t("allowZoomDetails")}
          checked={flag(config.zoom)}
          onInput={(e) => update("zoom", fieldChecked(e))}
        />
        <s-switch
          label={t("autoRotateLabel")}
          checked={flag(config.autoRotate)}
          onInput={(e) => update("autoRotate", fieldChecked(e))}
        />
        <s-switch
          label={t("scrollTouchLabel")}
          details={t("scrollTouchDetails")}
          checked={flag(config.scrollable)}
          onInput={(e) => update("scrollable", fieldChecked(e))}
        />
        <s-switch
          label={t("scrollWheelLabel")}
          checked={flag(config.wheelScrollable)}
          onInput={(e) => update("wheelScrollable", fieldChecked(e))}
        />
        <s-switch
          label={t("grabCursorLabel")}
          checked={flag(config.useGrabCursor)}
          onInput={(e) => update("useGrabCursor", fieldChecked(e))}
        />
      </CollapsibleSection>

      <CollapsibleSection title={t("sectionControlBar")} icon="adjust" defaultOpen={false}>
        <s-switch
          label={t("animationSelectorLabel")}
          details={t("animationSelectorDetails")}
          checked={flag(config.showAnimationSelector)}
          onInput={(e) => update("showAnimationSelector", fieldChecked(e))}
        />
        <s-switch
          label={t("axesLabel")}
          details={t("axesDetails")}
          checked={flag(config.showAxes)}
          onInput={(e) => update("showAxes", fieldChecked(e))}
        />
        <s-switch
          label={t("zoomButtonsLabel")}
          details={t("zoomButtonsDetails")}
          checked={flag(config.showZoomButtons)}
          onInput={(e) => update("showZoomButtons", fieldChecked(e))}
        />
        <s-switch
          label={t("screenshotLabel")}
          details={t("screenshotDetails")}
          checked={flag(config.showScreenshotButton)}
          onInput={(e) => update("showScreenshotButton", fieldChecked(e))}
        />
        <s-switch
          label={t("resetViewLabel")}
          details={t("resetViewDetails")}
          checked={flag(config.showCameraResetButton)}
          onInput={(e) => update("showCameraResetButton", fieldChecked(e))}
        />
        <s-switch
          label={t("fullscreenLabel")}
          checked={flag(config.showFullscreenButton)}
          onInput={(e) => update("showFullscreenButton", fieldChecked(e))}
        />
        {/*
          The same layout "Move controls" sets by dragging in the preview, for
          anyone who'd rather pick from a list. A control moved here goes to the
          end of its new spot's line; the order within a spot is set by dragging.
        */}
        <s-paragraph color="subdued">
          {t("positionsHelp")}
        </s-paragraph>
        {CONTROL_ITEMS.map((item) => (
          <s-select
            key={item.id}
            label={t("controlPosition", { control: tl(`control_${item.id}`) })}
            value={slotOfControl(config.controlsLayout, item.id)}
            onInput={(e) => {
              const slot = fieldValue(e);
              if (!isControlSlot(slot)) return;
              if (slot === slotOfControl(config.controlsLayout, item.id))
                return;
              update(
                "controlsLayout",
                moveControl(config.controlsLayout, item.id, slot),
              );
            }}
          >
            {CONTROL_SLOTS.map((slot) => (
              <s-option key={slot} value={slot}>
                {t(SLOT_NAMES[slot])}
              </s-option>
            ))}
          </s-select>
        ))}
      </CollapsibleSection>

      <CollapsibleSection title={t("sectionAnimation")} icon="play" defaultOpen={false}>
        {/*
          Counts clips the way the switcher lists them: 1 is the first clip, 0 is
          none. It used to store `num(e) + 1` while displaying the raw stored
          value, so typing 1 saved 2 and the field then showed 2 — a half-applied
          1-based conversion that only ever reached the write side.
        */}
        <s-number-field
          label={t("animationIndexLabel")}
          details={t("animationIndexDetails")}
          min={0}
          max={99}
          step={1}
          value={String(config.defaultAnimationIndex)}
          onInput={(e) =>
            update(
              "defaultAnimationIndex",
              num(e, config.defaultAnimationIndex),
            )
          }
        />
        <s-select
          label={t("repeatModeLabel")}
          value={config.animationRepeatMode}
          onInput={(e) => update("animationRepeatMode", fieldValue(e))}
        >
          {REPEAT_MODES.map((r) => (
            <s-option key={r} value={r}>
              {t(REPEAT_MODE_LABELS[r])}
            </s-option>
          ))}
        </s-select>
      </CollapsibleSection>

      <CollapsibleSection title={t("sectionAr")} icon="mobile" defaultOpen={false}>
        <s-switch
          label={t("webArLabel")}
          checked={flag(config.webAR)}
          onInput={(e) => update("webAR", fieldChecked(e))}
        />
        <s-switch
          label={t("sceneViewerLabel")}
          checked={flag(config.sceneViewer)}
          onInput={(e) => update("sceneViewer", fieldChecked(e))}
        />
        <s-switch
          label={t("quickLookLabel")}
          details={t("quickLookDetails")}
          checked={flag(config.quickLook)}
          onInput={(e) => update("quickLook", fieldChecked(e))}
        />
        <s-select
          label={t("placementLabel")}
          details={t("placementDetails")}
          value={config.arPlacement}
          onInput={(e) =>
            update("arPlacement", fieldValue(e) === "wall" ? "wall" : "floor")
          }
        >
          <s-option value="floor">{t("placementFloor")}</s-option>
          <s-option value="wall">{t("placementWall")}</s-option>
        </s-select>
        <s-url-field
          label={t("iosSrcLabel")}
          placeholder="https://...usdz"
          details={t("iosSrcDetails")}
          value={config.iosSrc}
          onInput={(e) => update("iosSrc", fieldValue(e))}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={t("sectionAdvanced")}
        icon="three-d-environment"
        defaultOpen={false}
      >
        <s-text-field
          label={t("variantLabel")}
          placeholder={t("variantPlaceholder")}
          details={t("variantDetails")}
          value={config.variant}
          onInput={(e) => update("variant", fieldValue(e))}
        />
        <s-switch
          label={t("fixSkinnedLabel")}
          details={t("fixSkinnedDetails")}
          checked={flag(config.fixSkinnedBbox)}
          onInput={(e) => update("fixSkinnedBbox", fieldChecked(e))}
        />
      </CollapsibleSection>
    </s-stack>
    </div>
    </QueryContext.Provider>
  );
}
