import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  Box,
  Camera,
  EyeOff,
  Film,
  GripVertical,
  Maximize,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import {
  CONTROL_ITEMS,
  CONTROL_SLOTS,
  controlVisibilityPatch,
  isControlEnabled,
  moveControl,
  slotOfControl,
  type ControlItemId,
  type ControlSlot,
} from "~/lib/viewer-config";
import type { ViewerConfig } from "~/components/ViewerPreview";

const ICONS: Record<ControlItemId, LucideIcon> = {
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  reset: RotateCcw,
  fullscreen: Maximize,
  screenshot: Camera,
  ar: Box,
  animation: Film,
};

const LABELS = Object.fromEntries(
  CONTROL_ITEMS.map((i) => [i.id, i.label]),
) as Record<ControlItemId, string>;

const SLOT_CLASSES: Record<ControlSlot, string> = {
  "top-left": "top-2 left-2 items-start",
  "top-center": "top-2 left-1/2 -translate-x-1/2",
  "top-right": "top-2 right-2 items-end",
  "bottom-left": "bottom-2 left-2 items-start",
  "bottom-center": "bottom-2 left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-2 right-2 items-end",
};

const SLOT_LABELS: Record<ControlSlot, string> = {
  "top-left": "top left",
  "top-center": "top center",
  "top-right": "top right",
  "bottom-left": "bottom left",
  "bottom-center": "bottom center",
  "bottom-right": "bottom right",
};

/** Corner spots stack their controls in a column, the middle ones in a row. */
const isRow = (slot: ControlSlot) => slot.endsWith("center");

function within(r: DOMRect, x: number, y: number) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** The spot under a point, by thirds across and halves down the viewer. */
function slotAt(rect: DOMRect, x: number, y: number): ControlSlot {
  const col =
    x < rect.left + rect.width / 3
      ? "left"
      : x < rect.left + (rect.width * 2) / 3
        ? "center"
        : "right";
  const row = y < rect.top + rect.height / 2 ? "top" : "bottom";
  return `${row}-${col}` as ControlSlot;
}

/** The spot one arrow-key step away, or the same spot at an edge. */
function stepSlot(slot: ControlSlot, key: string): ControlSlot {
  const [row, col] = slot.split("-") as [
    "top" | "bottom",
    "left" | "center" | "right",
  ];
  const cols = ["left", "center", "right"] as const;
  const c = cols.indexOf(col);
  if (key === "ArrowLeft") return `${row}-${cols[Math.max(0, c - 1)]}` as ControlSlot;
  if (key === "ArrowRight") return `${row}-${cols[Math.min(2, c + 1)]}` as ControlSlot;
  if (key === "ArrowUp") return `top-${col}` as ControlSlot;
  if (key === "ArrowDown") return `bottom-${col}` as ControlSlot;
  return slot;
}

type Drag = {
  id: ControlItemId;
  x: number;
  y: number;
  /** A spot on the viewer, or the tray of switched-off controls. */
  target: ControlSlot | "tray";
  /** Insert before this position in the spot's list; end when null. */
  index: number | null;
};

/**
 * The preview's "Move controls" mode.
 *
 * Every control that is switched on stands in as a chip over the viewer, in
 * the spot it occupies; the six spots are drawn as drop targets. Drag a chip
 * to any spot, and to any place in that spot's line — a marker shows where it
 * will land. Several controls can share a spot.
 *
 * Controls that are switched off sit in a tray along the bottom. Dragging one
 * out onto a spot places it and switches it on; dragging a placed control into
 * the tray switches it off. Off controls keep their spot in the layout, so one
 * switched back on from the settings panel returns where it was.
 *
 * Keyboard: arrow keys move the focused control to the next spot; Shift with
 * an arrow along the spot's line moves it earlier or later within it; Delete
 * puts it in the tray; Enter on a tray chip switches it back on in its spot.
 *
 * Every change goes straight to `onChange` as a config patch, so it is saved
 * with the rest of the settings. Pointer events rather than HTML5 drag and
 * drop, so a mouse, a trackpad and a finger all work.
 */
export function ControlLayoutEditor({
  config,
  onChange,
  onDone,
}: {
  config: ViewerConfig;
  onChange: (patch: Partial<ViewerConfig>) => void;
  onDone: () => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const layout = config.controlsLayout;
  const enabled = (id: ControlItemId) => isControlEnabled(config, id);
  const hidden = CONTROL_ITEMS.map((i) => i.id).filter((id) => !enabled(id));

  /** Where a drop at this point would land. */
  function aim(id: ControlItemId, clientX: number, clientY: number) {
    const area = areaRef.current;
    const tray = trayRef.current;
    const rect = area?.getBoundingClientRect();
    if (!area || !rect) return null;
    const base = { x: clientX - rect.left, y: clientY - rect.top };
    if (tray && within(tray.getBoundingClientRect(), clientX, clientY)) {
      return { ...base, target: "tray" as const, index: null };
    }
    const slot = slotAt(rect, clientX, clientY);
    const chips = Array.from(
      area.querySelectorAll<HTMLElement>(`[data-slot="${slot}"] [data-chip]`),
    ).filter((el) => el.dataset.chip !== id);
    let index: number | null = null;
    for (const chip of chips) {
      const r = chip.getBoundingClientRect();
      const before = isRow(slot)
        ? clientX < r.left + r.width / 2
        : clientY < r.top + r.height / 2;
      if (before) {
        index = layout[slot].indexOf(chip.dataset.chip as ControlItemId);
        break;
      }
    }
    return { ...base, target: slot, index };
  }

  function place(id: ControlItemId, slot: ControlSlot, index?: number) {
    onChange({
      controlsLayout: moveControl(layout, id, slot, index),
      // Dragged out of the tray: switched on as it lands.
      ...(enabled(id) ? {} : controlVisibilityPatch(id, true)),
    });
  }

  function onPointerDown(id: ControlItemId, e: PointerEvent<HTMLButtonElement>) {
    const t = aim(id, e.clientX, e.clientY);
    if (!t) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, ...t });
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const t = aim(drag.id, e.clientX, e.clientY);
    if (t) setDrag({ ...drag, ...t });
  }

  function onPointerUp() {
    if (!drag) return;
    const { id, target, index } = drag;
    setDrag(null);
    if (target === "tray") {
      if (enabled(id)) onChange(controlVisibilityPatch(id, false));
      return;
    }
    place(id, target, index ?? undefined);
  }

  function onKeyDown(id: ControlItemId, e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onDone();
      return;
    }
    if (!enabled(id)) {
      // A tray chip: Enter or Space brings it back in its own spot.
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onChange(controlVisibilityPatch(id, true));
      }
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onChange(controlVisibilityPatch(id, false));
      return;
    }
    if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
    const slot = slotOfControl(layout, id);
    const at = layout[slot].indexOf(id);
    if (e.shiftKey) {
      // Along the spot's own line: earlier or later among its neighbours.
      const earlier = isRow(slot) ? e.key === "ArrowLeft" : e.key === "ArrowUp";
      const later = isRow(slot) ? e.key === "ArrowRight" : e.key === "ArrowDown";
      if (earlier && at > 0) place(id, slot, at - 1);
      if (later && at < layout[slot].length - 1) place(id, slot, at + 2);
      return;
    }
    const next = stepSlot(slot, e.key);
    if (next !== slot) place(id, next);
  }

  const marker = (slot: ControlSlot) => (
    <div
      aria-hidden
      className={cn("shrink-0 bg-primary", isRow(slot) ? "h-8 w-0.5" : "h-0.5 w-24")}
    />
  );

  function chip(id: ControlItemId, where: string) {
    const Icon = ICONS[id];
    const off = !enabled(id);
    const dragging = drag?.id === id;
    return (
      // Kept mounted while it is dragged, only made invisible: it holds the
      // pointer capture, and unmounting it would drop the moves and the
      // release with it.
      <button
        type="button"
        data-chip={dragging || off ? undefined : id}
        aria-label={
          off
            ? `${LABELS[id]}, switched off. Drag onto the viewer, or press Enter, to turn it on.`
            : `${LABELS[id]}, ${where}. Drag, or use the arrow keys, to move; Delete to switch off.`
        }
        onPointerDown={(e) => onPointerDown(id, e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => onKeyDown(id, e)}
        className={cn(
          "flex h-8 cursor-grab touch-none select-none items-center gap-1 whitespace-nowrap border bg-white pl-1 pr-2 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing",
          off
            ? "border-dashed border-black/25 text-black/50"
            : "border-black/10 text-black/80 shadow-sm",
          dragging && "opacity-0",
        )}
      >
        <GripVertical className="size-3.5 shrink-0 text-black/30" />
        <Icon className="size-3.5 shrink-0" />
        {LABELS[id]}
      </button>
    );
  }

  const trayTarget = drag?.target === "tray";

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col bg-white/60 backdrop-blur-[1px]"
      // No pointer handler here: this layer covers the canvas, so a press on it
      // never reaches view3d's controls anyway. (A capture-phase stopper here
      // used to swallow every press before it got to the chips.)
      onWheel={(e) => e.stopPropagation()}
    >
      <div ref={areaRef} className="relative min-h-0 flex-1">
        {CONTROL_SLOTS.map((slot) => {
          const isTarget = drag?.target === slot;
          const visible = layout[slot].filter((id) => enabled(id));
          return (
            <div
              key={slot}
              data-slot={slot}
              className={cn(
                "absolute flex min-h-12 min-w-28 gap-1.5 border-2 border-dashed p-1.5 transition-colors",
                isRow(slot)
                  ? "max-w-[60%] flex-row flex-wrap items-center justify-center"
                  : "flex-col",
                SLOT_CLASSES[slot],
                isTarget ? "border-primary bg-primary/10" : "border-black/20",
              )}
            >
              {visible.length === 0 && !isTarget ? (
                <span className="m-auto text-[11px] text-black/40">Empty</span>
              ) : null}
              {visible.map((id) => (
                <div
                  key={id}
                  className={cn("flex", isRow(slot) ? "flex-row items-center" : "flex-col")}
                >
                  {isTarget && drag && drag.index !== null && layout[slot][drag.index] === id && drag.id !== id
                    ? marker(slot)
                    : null}
                  {chip(id, SLOT_LABELS[slot])}
                </div>
              ))}
              {isTarget && drag && drag.index === null ? marker(slot) : null}
            </div>
          );
        })}

        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
          <div className="pointer-events-auto flex max-w-xs flex-col items-center gap-2 border bg-white/95 px-4 py-3 text-center shadow-md">
            <p className="text-xs text-black/70">
              Drag any control to a spot, or between two others to set the
              order. Drag one to the tray below to hide it, or out of the tray
              to show it.
            </p>
            <button
              type="button"
              onClick={onDone}
              className="bg-primary px-3 py-1.5 text-xs font-medium text-white outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-black/30"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {/* Switched-off controls, along the bottom of the frame. */}
      <div
        ref={trayRef}
        className={cn(
          "flex min-h-12 shrink-0 flex-wrap items-center gap-1.5 border-t-2 border-dashed px-2 py-1.5 transition-colors",
          trayTarget ? "border-primary bg-primary/10" : "border-black/20 bg-white/80",
        )}
      >
        <span className="mr-1 flex items-center gap-1 text-[11px] font-medium text-black/50">
          <EyeOff className="size-3.5" />
          Hidden
        </span>
        {hidden.length === 0 ? (
          <span className="text-[11px] text-black/40">
            {trayTarget ? "Drop to hide" : "Nothing hidden — drag a control here to hide it"}
          </span>
        ) : (
          hidden.map((id) => <span key={id}>{chip(id, "hidden")}</span>)
        )}
      </div>

      {drag ? (
        // The chip in hand, following the pointer.
        <div
          className="pointer-events-none absolute z-10 flex h-8 -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap border border-primary bg-white px-2 text-[11px] font-medium text-black/80 shadow-lg"
          style={{ left: drag.x, top: drag.y }}
        >
          {(() => {
            const Icon = ICONS[drag.id];
            return <Icon className="size-3.5 shrink-0 text-primary" />;
          })()}
          {LABELS[drag.id]}
        </div>
      ) : null}
    </div>
  );
}
