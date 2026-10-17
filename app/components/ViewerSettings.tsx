import * as React from "react";

import { fieldChecked, fieldValue, flag } from "~/components/polaris/helpers";
import type { ViewerConfig } from "~/components/ViewerPreview";
import {
  CONTROL_ITEMS,
  CONTROL_SLOTS,
  isControlSlot,
  moveControl,
  slotOfControl,
} from "~/lib/viewer-config";

const SLOT_NAMES: Record<(typeof CONTROL_SLOTS)[number], string> = {
  "top-left": "Top left",
  "top-center": "Top center",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
  "bottom-right": "Bottom right",
};

const TONE_MAPPINGS = [
  "None",
  "Linear",
  "Reinhard",
  "Cineon",
  "ACESFilmic",
] as const;
const REPEAT_MODES = ["one", "all", "none"] as const;

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
  return (
    <s-box
      borderWidth="base"
      borderStyle="solid"
      borderColor="base"
      borderRadius="base"
    >
      <s-clickable
        padding="small-100"
        inlineSize="100%"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
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
            type={open ? "chevron-up" : "chevron-down"}
            color="subdued"
            size="small"
          />
        </s-grid>
      </s-clickable>

      {open ? (
        <s-box
          padding="small"
          borderWidth="base none none none"
          borderStyle="solid"
          borderColor="base"
        >
          <s-stack direction="block" gap="base">
            {children}
          </s-stack>
        </s-box>
      ) : null}
    </s-box>
  );
}

type Props = {
  config: ViewerConfig;
  onChange: (config: ViewerConfig) => void;
};

export function ViewerSettings({ config, onChange }: Props) {
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
    <s-stack direction="block" gap="base">
      <CollapsibleSection title="Display" icon="color">
        {/*
          Number fields, where these were range sliders. Polaris ships no
          slider, and the alternative — keeping a hand-styled range input — is
          the one control on the page that would not inherit admin tokens or
          focus treatment. A number field is also the more precise instrument
          for values a merchant usually knows exactly (a 480px height, a 45°
          yaw), and it is reachable by keyboard without a custom key handler.
        */}
        <s-number-field
          label="Viewer height"
          details="Height of the viewer canvas, in pixels."
          suffix="px"
          min={200}
          max={1200}
          step={10}
          value={String(config.height)}
          onInput={(e) => update("height", num(e, config.height))}
        />

        <s-color-field
          label="Background color"
          details="Solid colour behind the model."
          value={config.background}
          onInput={(e) => update("background", fieldValue(e))}
        />

        <s-number-field
          label="Exposure"
          details="HDR brightness."
          min={0}
          max={5}
          step={0.05}
          value={String(config.exposure)}
          onInput={(e) => update("exposure", num(e, config.exposure))}
        />

        <s-select
          label="Tone mapping"
          value={config.toneMapping}
          onInput={(e) => update("toneMapping", fieldValue(e))}
        >
          {TONE_MAPPINGS.map((t) => (
            <s-option key={t} value={t}>
              {t}
            </s-option>
          ))}
        </s-select>

        <s-switch
          label="Default environment map"
          details="Generated env map for material reflections."
          checked={flag(config.useDefaultEnv)}
          onInput={(e) => update("useDefaultEnv", fieldChecked(e))}
        />
        <s-switch
          label="Blur skybox"
          checked={flag(config.skyboxBlur)}
          onInput={(e) => update("skyboxBlur", fieldChecked(e))}
        />
        <s-switch
          label="Cast shadow under model"
          checked={flag(config.shadow)}
          onInput={(e) => update("shadow", fieldChecked(e))}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Environment" icon="sun" defaultOpen={false}>
        <s-url-field
          label="Skybox HDR URL"
          placeholder="https://...hdr"
          details="RGBE .hdr image rendered as the background and used for reflections."
          value={config.skybox}
          onInput={(e) => update("skybox", fieldValue(e))}
        />
        <s-url-field
          label="Environment map HDR URL"
          placeholder="https://...hdr"
          details="Optional separate HDR for material reflections only."
          value={config.envmap}
          onInput={(e) => update("envmap", fieldValue(e))}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Camera" icon="camera" defaultOpen={false}>
        <s-select
          label="FOV mode"
          details="Auto fits the model. Custom uses the FOV value below."
          value={config.fovMode}
          onInput={(e) => update("fovMode", fieldValue(e) as "auto" | "custom")}
        >
          <s-option value="auto">Auto</s-option>
          <s-option value="custom">Custom</s-option>
        </s-select>

        <s-number-field
          label="FOV"
          suffix="°"
          details={
            config.fovMode === "auto"
              ? "Disabled in auto mode."
              : "Field of view, in degrees."
          }
          disabled={flag(config.fovMode === "auto")}
          min={1}
          max={179}
          step={1}
          value={String(config.fov)}
          onInput={(e) => update("fov", num(e, config.fov))}
        />
        <s-number-field
          label="Initial yaw"
          suffix="°"
          min={-180}
          max={180}
          step={1}
          value={String(config.yaw)}
          onInput={(e) => update("yaw", num(e, config.yaw))}
        />
        <s-number-field
          label="Initial pitch"
          suffix="°"
          min={-90}
          max={90}
          step={1}
          value={String(config.pitch)}
          onInput={(e) => update("pitch", num(e, config.pitch))}
        />
        <s-number-field
          label="Initial zoom"
          details="Positive zooms in."
          min={-50}
          max={50}
          step={0.5}
          value={String(config.initialZoom)}
          onInput={(e) => update("initialZoom", num(e, config.initialZoom))}
        />
        <s-switch
          label="Maintain model size on resize"
          checked={flag(config.maintainSize)}
          onInput={(e) => update("maintainSize", fieldChecked(e))}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Controls" icon="settings" defaultOpen={false}>
        <s-switch
          label="Allow rotate"
          checked={flag(config.rotate)}
          onInput={(e) => update("rotate", fieldChecked(e))}
        />
        <s-switch
          label="Allow translate (pan)"
          checked={flag(config.translate)}
          onInput={(e) => update("translate", fieldChecked(e))}
        />
        <s-switch
          label="Allow zoom"
          details="Off also hides the zoom in / out buttons."
          checked={flag(config.zoom)}
          onInput={(e) => update("zoom", fieldChecked(e))}
        />
        <s-switch
          label="Auto rotate"
          checked={flag(config.autoRotate)}
          onInput={(e) => update("autoRotate", fieldChecked(e))}
        />
        <s-switch
          label="Page scroll on touch"
          details="Allow vertical scroll when dragging on the canvas."
          checked={flag(config.scrollable)}
          onInput={(e) => update("scrollable", fieldChecked(e))}
        />
        <s-switch
          label="Page scroll on mouse wheel"
          checked={flag(config.wheelScrollable)}
          onInput={(e) => update("wheelScrollable", fieldChecked(e))}
        />
        <s-switch
          label="Grab cursor on canvas"
          checked={flag(config.useGrabCursor)}
          onInput={(e) => update("useGrabCursor", fieldChecked(e))}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Control bar" icon="adjust" defaultOpen={false}>
        <s-switch
          label="Animation clip name / switcher"
          details="Shows the active clip in the mini toolbar; click it to pick another. Off means the model does not animate at all."
          checked={flag(config.showAnimationSelector)}
          onInput={(e) => update("showAnimationSelector", fieldChecked(e))}
        />
        <s-switch
          label="Axis gizmo (X/Y/Z)"
          details="Orientation indicator shown in the corner of the viewer."
          checked={flag(config.showAxes)}
          onInput={(e) => update("showAxes", fieldChecked(e))}
        />
        <s-switch
          label="Zoom in / out buttons"
          details="Hidden while “Allow zoom” is off, under Controls."
          checked={flag(config.showZoomButtons)}
          onInput={(e) => update("showZoomButtons", fieldChecked(e))}
        />
        <s-switch
          label="Camera (snapshot) button"
          details="Downloads a PNG of the current view."
          checked={flag(config.showScreenshotButton)}
          onInput={(e) => update("showScreenshotButton", fieldChecked(e))}
        />
        <s-switch
          label="Reset view button"
          details="Returns the camera to its starting angle and zoom."
          checked={flag(config.showCameraResetButton)}
          onInput={(e) => update("showCameraResetButton", fieldChecked(e))}
        />
        <s-switch
          label="Fullscreen button"
          checked={flag(config.showFullscreenButton)}
          onInput={(e) => update("showFullscreenButton", fieldChecked(e))}
        />
        {/*
          The same layout "Move controls" sets by dragging in the preview, for
          anyone who'd rather pick from a list. A control moved here goes to the
          end of its new spot's line; the order within a spot is set by dragging.
        */}
        <s-paragraph color="subdued">
          Positions — or use “Move controls” under the preview to drag each one,
          including the order within a spot.
        </s-paragraph>
        {CONTROL_ITEMS.map((item) => (
          <s-select
            key={item.id}
            label={`${item.label} position`}
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
                {SLOT_NAMES[slot]}
              </s-option>
            ))}
          </s-select>
        ))}
      </CollapsibleSection>

      <CollapsibleSection title="Animation" icon="play" defaultOpen={false}>
        {/*
          Counts clips the way the switcher lists them: 1 is the first clip, 0 is
          none. It used to store `num(e) + 1` while displaying the raw stored
          value, so typing 1 saved 2 and the field then showed 2 — a half-applied
          1-based conversion that only ever reached the write side.
        */}
        <s-number-field
          label="Default animation index"
          details="Which clip plays on load, counted as the switcher lists them: 1 = first, 2 = second… 0 = none. Needs “Animation clip name / switcher” (under Control bar) to be on."
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
          label="Repeat mode"
          value={config.animationRepeatMode}
          onInput={(e) => update("animationRepeatMode", fieldValue(e))}
        >
          {REPEAT_MODES.map((r) => (
            <s-option key={r} value={r}>
              {r}
            </s-option>
          ))}
        </s-select>
      </CollapsibleSection>

      <CollapsibleSection title="AR" icon="mobile" defaultOpen={false}>
        <s-switch
          label="WebXR AR (modern Android Chrome)"
          checked={flag(config.webAR)}
          onInput={(e) => update("webAR", fieldChecked(e))}
        />
        <s-switch
          label="Google Scene Viewer (Android)"
          checked={flag(config.sceneViewer)}
          onInput={(e) => update("sceneViewer", fieldChecked(e))}
        />
        <s-switch
          label="Apple Quick Look (iOS)"
          details="Requires a .usdz model."
          checked={flag(config.quickLook)}
          onInput={(e) => update("quickLook", fieldChecked(e))}
        />
        <s-select
          label="Placement"
          details="Where the model goes when a shopper opens AR. Wall suits art, mirrors, shelves and TVs. Wall placement works on Android; iPhones place the model as its .usdz file says, which for Shopify's own files is the floor."
          value={config.arPlacement}
          onInput={(e) =>
            update("arPlacement", fieldValue(e) === "wall" ? "wall" : "floor")
          }
        >
          <s-option value="floor">Floor</s-option>
          <s-option value="wall">Wall</s-option>
        </s-select>
        <s-url-field
          label="iOS source URL (.usdz)"
          placeholder="https://...usdz"
          details="Used by Quick Look on iOS Safari. Upload separately to Shopify Files."
          value={config.iosSrc}
          onInput={(e) => update("iosSrc", fieldValue(e))}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Advanced"
        icon="three-d-environment"
        defaultOpen={false}
      >
        <s-text-field
          label="Material variant"
          placeholder="leave empty for default"
          details="Name of a KHR_materials_variants variant in the model."
          value={config.variant}
          onInput={(e) => update("variant", fieldValue(e))}
        />
        <s-switch
          label="Fix skinned bounding box"
          details="Recalculate bbox using skeleton weights (rigged models)."
          checked={flag(config.fixSkinnedBbox)}
          onInput={(e) => update("fixSkinnedBbox", fieldChecked(e))}
        />
      </CollapsibleSection>
    </s-stack>
  );
}
