import * as React from "react";
import {
  Box,
  Camera,
  ChevronDown,
  Cog,
  Film,
  Palette,
  Smartphone,
  Sun,
} from "lucide-react";

import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import type { ViewerConfig } from "~/components/ViewerPreview";

const TONE_MAPPINGS = [
  "None",
  "Linear",
  "Reinhard",
  "Cineon",
  "ACESFilmic",
] as const;
const REPEAT_MODES = ["one", "all", "none"] as const;

function CollapsibleSection({
  title,
  icon: Icon,
  description,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group border bg-card shadow-sm overflow-hidden"
    >
      <summary className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none list-none hover:bg-accent/40 transition-colors [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="size-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">{title}</div>
            {description && (
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {description}
              </div>
            )}
          </div>
        </div>
        <ChevronDown className="size-3.5 text-muted-foreground shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t px-3 py-2 space-y-0.5">{children}</div>
    </details>
  );
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 sm:gap-4 items-center py-1.5">
      <div>
        <div className="text-xs font-medium">{label}</div>
        {description && (
          <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            {description}
          </div>
        )}
      </div>
      <div className="min-w-[160px] flex justify-start sm:justify-end">
        {children}
      </div>
    </div>
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

  return (
    <div className="space-y-3">
      <CollapsibleSection
        title="Display"
        icon={Palette}
        description="Size, background, exposure, tone mapping"
      >
        <FieldRow label="Viewer height" description={`${config.height}px`}>
          <div className="w-[240px]">
            <Slider
              min={200}
              max={1200}
              step={10}
              value={[config.height]}
              onValueChange={([v]) => update("height", v)}
            />
          </div>
        </FieldRow>
        <Separator />
        <FieldRow label="Background color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={
                config.background.startsWith("#")
                  ? config.background
                  : "#f4f4f4"
              }
              onChange={(e) => update("background", e.target.value)}
              className="h-9 w-12 rounded border cursor-pointer"
            />
            <Input
              value={config.background}
              onChange={(e) => update("background", e.target.value)}
              className="w-40 font-mono text-xs"
            />
          </div>
        </FieldRow>
        <Separator />
        <FieldRow
          label="Exposure"
          description={`${config.exposure.toFixed(2)} (HDR brightness)`}
        >
          <div className="w-[240px]">
            <Slider
              min={0}
              max={5}
              step={0.05}
              value={[config.exposure]}
              onValueChange={([v]) => update("exposure", v)}
            />
          </div>
        </FieldRow>
        <Separator />
        <FieldRow label="Tone mapping">
          <Select
            value={config.toneMapping}
            onValueChange={(v) => update("toneMapping", v)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONE_MAPPINGS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <Separator />
        <FieldRow
          label="Default environment map"
          description="Generated env map for material reflections"
        >
          <Switch
            checked={config.useDefaultEnv}
            onCheckedChange={(v) => update("useDefaultEnv", v)}
          />
        </FieldRow>
        <Separator />
        <FieldRow label="Blur skybox">
          <Switch
            checked={config.skyboxBlur}
            onCheckedChange={(v) => update("skyboxBlur", v)}
          />
        </FieldRow>
        <Separator />
        <FieldRow label="Cast shadow under model">
          <Switch
            checked={config.shadow}
            onCheckedChange={(v) => update("shadow", v)}
          />
        </FieldRow>
      </CollapsibleSection>

      <CollapsibleSection
        title="Environment"
        icon={Sun}
        description="HDR skybox and environment map URLs"
        defaultOpen={false}
      >
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="skybox">Skybox HDR URL</Label>
            <Input
              id="skybox"
              value={config.skybox}
              placeholder="https://...hdr"
              onChange={(e) => update("skybox", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              RGBE .hdr image rendered as the background and used for
              reflections.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="envmap">Environment map HDR URL</Label>
            <Input
              id="envmap"
              value={config.envmap}
              placeholder="https://...hdr"
              onChange={(e) => update("envmap", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optional separate HDR for material reflections only.
            </p>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Camera"
        icon={Camera}
        description="FOV, yaw, pitch, zoom"
        defaultOpen={false}
      >
        <FieldRow
          label="FOV mode"
          description="Auto fits the model. Custom uses the FOV value below."
        >
          <Select
            value={config.fovMode}
            onValueChange={(v) => update("fovMode", v as "auto" | "custom")}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
        <Separator />
        <FieldRow
          label="FOV (degrees)"
          description={
            config.fovMode === "auto"
              ? "Disabled in auto mode"
              : `${config.fov}°`
          }
        >
          <div className="w-[240px]">
            <Slider
              min={1}
              max={179}
              step={1}
              value={[config.fov]}
              onValueChange={([v]) => update("fov", v)}
              disabled={config.fovMode === "auto"}
            />
          </div>
        </FieldRow>
        <Separator />
        <FieldRow label="Initial yaw" description={`${config.yaw}°`}>
          <div className="w-[240px]">
            <Slider
              min={-180}
              max={180}
              step={1}
              value={[config.yaw]}
              onValueChange={([v]) => update("yaw", v)}
            />
          </div>
        </FieldRow>
        <Separator />
        <FieldRow label="Initial pitch" description={`${config.pitch}°`}>
          <div className="w-[240px]">
            <Slider
              min={-90}
              max={90}
              step={1}
              value={[config.pitch]}
              onValueChange={([v]) => update("pitch", v)}
            />
          </div>
        </FieldRow>
        <Separator />
        <FieldRow
          label="Initial zoom"
          description={`${config.initialZoom} (positive = in)`}
        >
          <div className="w-[240px]">
            <Slider
              min={-50}
              max={50}
              step={0.5}
              value={[config.initialZoom]}
              onValueChange={([v]) => update("initialZoom", v)}
            />
          </div>
        </FieldRow>
        <Separator />
        <FieldRow label="Maintain model size on resize">
          <Switch
            checked={config.maintainSize}
            onCheckedChange={(v) => update("maintainSize", v)}
          />
        </FieldRow>
      </CollapsibleSection>

      <CollapsibleSection
        title="Controls"
        icon={Cog}
        description="Rotate, pan, zoom, autoplay, scroll, control bar"
        defaultOpen={false}
      >
        <FieldRow label="Allow rotate">
          <Switch
            checked={config.rotate}
            onCheckedChange={(v) => update("rotate", v)}
          />
        </FieldRow>
        <Separator />
        <FieldRow label="Allow translate (pan)">
          <Switch
            checked={config.translate}
            onCheckedChange={(v) => update("translate", v)}
          />
        </FieldRow>
        <Separator />
        <FieldRow label="Allow zoom">
          <Switch
            checked={config.zoom}
            onCheckedChange={(v) => update("zoom", v)}
          />
        </FieldRow>
        <Separator />
        <FieldRow label="Auto rotate">
          <Switch
            checked={config.autoRotate}
            onCheckedChange={(v) => update("autoRotate", v)}
          />
        </FieldRow>
        <Separator />
        <FieldRow
          label="Page scroll on touch"
          description="Allow vertical scroll when dragging on canvas"
        >
          <Switch
            checked={config.scrollable}
            onCheckedChange={(v) => update("scrollable", v)}
          />
        </FieldRow>
        <Separator />
        <FieldRow label="Page scroll on mouse wheel">
          <Switch
            checked={config.wheelScrollable}
            onCheckedChange={(v) => update("wheelScrollable", v)}
          />
        </FieldRow>
        <Separator />
        <FieldRow label="Grab cursor on canvas">
          <Switch
            checked={config.useGrabCursor}
            onCheckedChange={(v) => update("useGrabCursor", v)}
          />
        </FieldRow>
        <Separator />
        <FieldRow
          label="On-screen control bar"
          description="Play / fullscreen / reset / progress"
        >
          <Switch
            checked={config.showControls}
            onCheckedChange={(v) => update("showControls", v)}
          />
        </FieldRow>
      </CollapsibleSection>

      <CollapsibleSection
        title="Animation"
        icon={Film}
        description="Default animation clip and repeat mode"
        defaultOpen={false}
      >
        <FieldRow
          label="Default animation index"
          description="Index of the clip to autoplay (0 = first)"
        >
          <Input
            type="number"
            min={0}
            max={99}
            value={config.defaultAnimationIndex}
            onChange={(e) =>
              update(
                "defaultAnimationIndex",
                Number(e.target.value) || 0,
              )
            }
            className="w-24"
          />
        </FieldRow>
        <Separator />
        <FieldRow label="Repeat mode">
          <Select
            value={config.animationRepeatMode}
            onValueChange={(v) => update("animationRepeatMode", v)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPEAT_MODES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
      </CollapsibleSection>

      <CollapsibleSection
        title="AR"
        icon={Smartphone}
        description="WebXR, Scene Viewer, Quick Look, iOS source"
        defaultOpen={false}
      >
        <FieldRow label="WebXR AR (modern Android Chrome)">
          <Switch
            checked={config.webAR}
            onCheckedChange={(v) => update("webAR", v)}
          />
        </FieldRow>
        <Separator />
        <FieldRow label="Google Scene Viewer (Android)">
          <Switch
            checked={config.sceneViewer}
            onCheckedChange={(v) => update("sceneViewer", v)}
          />
        </FieldRow>
        <Separator />
        <FieldRow
          label="Apple Quick Look (iOS)"
          description="Requires a .usdz model"
        >
          <Switch
            checked={config.quickLook}
            onCheckedChange={(v) => update("quickLook", v)}
          />
        </FieldRow>
        <Separator />
        <div className="space-y-2 pt-3">
          <Label htmlFor="iosSrc">iOS source URL (.usdz)</Label>
          <Input
            id="iosSrc"
            value={config.iosSrc}
            placeholder="https://...usdz"
            onChange={(e) => update("iosSrc", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Used by Quick Look on iOS Safari. Upload separately to Shopify
            Files.
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Advanced"
        icon={Box}
        description="Material variants, bounding box"
        defaultOpen={false}
      >
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="variant">Material variant</Label>
            <Input
              id="variant"
              value={config.variant}
              placeholder="leave empty for default"
              onChange={(e) => update("variant", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Name of a KHR_materials_variants variant in the model.
            </p>
          </div>
          <FieldRow
            label="Fix skinned bounding box"
            description="Recalculate bbox using skeleton weights (rigged models)"
          >
            <Switch
              checked={config.fixSkinnedBbox}
              onCheckedChange={(v) => update("fixSkinnedBbox", v)}
            />
          </FieldRow>
        </div>
      </CollapsibleSection>
    </div>
  );
}
