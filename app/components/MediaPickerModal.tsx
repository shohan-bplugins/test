import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";

import { fieldValue, flag } from "~/components/polaris/helpers";
import type { MediaItem, VideoStatus } from "~/routes/api.media";
import {
  captureFrame,
  uploadMedia,
  type UploadProgress,
} from "~/lib/media-upload";

// Images are checked here first (mirrors routes/api.media.tsx) so an
// oversized one is refused at once. Videos of any size and format go straight
// to Shopify, which has the final say on both.
const UPLOAD_RULES = {
  image: {
    accept: "image/png,image/jpeg,image/webp,image/gif",
    maxBytes: 10 * 1024 * 1024,
    tooBig: "Images can be up to 10 MB.",
  },
  video: {
    accept: "video/*,.mkv,.m4v",
    maxBytes: Infinity,
    tooBig: "",
  },
} as const;

// How often, and for how long, a video upload is checked while Shopify
// transcodes it: every second at first, when a short clip usually finishes,
// then less often for long ones.
const VIDEO_POLL_FAST_MS = 1000;
const VIDEO_POLL_SLOW_MS = 2500;
const VIDEO_POLL_FAST_FOR_MS = 30 * 1000;
const VIDEO_POLL_LIMIT_MS = 10 * 60 * 1000;

/** Grid id of an upload that has no Shopify file yet. */
const PENDING_ID = "__upload";

/*
 * A thumbnail made in the browser from the file being uploaded, so its tile
 * has a picture at once instead of after Shopify's processing. "" when the
 * browser can't decode the format (the tile then shows a play icon).
 */
async function localThumb(file: File): Promise<string> {
  if (file.type.startsWith("image/")) return URL.createObjectURL(file);
  const frame = await captureFrame(file, 320);
  return frame ? URL.createObjectURL(frame) : "";
}

/** An upload, from the moment a file is chosen until it is used or dropped. */
type Pending = {
  name: string;
  /** Local thumbnail; see localThumb. */
  thumb: string;
} & (
  | { phase: "optimizing"; fraction: number }
  | { phase: "uploading"; fraction: number | null }
  | { phase: "finishing" }
  | { phase: "processing"; videoId: string; since: number }
  | { phase: "ready"; item: MediaItem }
);

/*
 * Choose an image or a video from the store's Shopify Files — or upload a new
 * one into Files — for a hotspot card. Backed by /api/media.
 *
 * Click a file to select it (highlighted, with a check), then confirm with
 * Select; double-click or Enter selects and confirms at once. An upload
 * appears first in the grid straight away (with a thumbnail made from the
 * file itself), shows its progress, and once Shopify has it — for a video,
 * once Shopify's processing has produced a playable file, which this polls
 * for — is selected and waits for the merchant's Select; nothing is used
 * without that confirmation.
 *
 * Deliberately not an s-modal. Inside the embedded admin, s-modal's opening
 * and closing go through the admin host, and on the editor pages — where the
 * App Bridge save bar is showing as soon as a hotspot is added — it opened
 * but would not close again, whatever closed it. This dialog is drawn inside
 * the app itself (portalled to <body>, a fixed overlay), so open/close is
 * plain React state and nothing outside the app takes part. Escape and a
 * click on the backdrop close it; focus moves in on open and back on close.
 */
export function MediaPickerModal({
  open,
  type,
  onClose,
  onPick,
  items: fixedItems,
  currentUrl = "",
}: {
  open: boolean;
  type: "image" | "video";
  onClose: () => void;
  onPick: (item: MediaItem) => void;
  /** Fixed items instead of loading /api/media — for previews and tests. */
  items?: MediaItem[];
  /** What the hotspot uses now: shown first, badged, and pre-selected. */
  currentUrl?: string;
}) {
  /*
   * One fetcher per kind (the key), so the image list and the video list are
   * separate data: switching kinds can never show the other kind's files
   * while the new list loads — reopening a kind shows its last list at once.
   */
  const list = useFetcher<{ type: "image" | "video"; items: MediaItem[] }>({
    key: `media-picker-${type}`,
  });
  // The latest upload, until the merchant uses it or closes the picker.
  const [pending, setPending] = useState<Pending | null>(null);
  const status = useFetcher<VideoStatus>();
  const [localError, setLocalError] = useState<string | null>(null);
  const rules = UPLOAD_RULES[type];
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Only a list of the kind being chosen; anything else counts as loading.
  const listForType = list.data?.type === type ? list.data : null;
  const loaded = fixedItems ?? listForType?.items ?? [];

  /*
   * The hotspot's current file, first in the grid and pre-selected. Matched
   * ignoring the query string (Shopify's CDN versions URLs with ?v=). When it
   * is not among the files listed — a pasted link, or older than the newest
   * forty — it is still shown, as its own tile, unless a search is narrowing
   * the list.
   */
  const sameFile = (a: string, b: string) =>
    !!a && !!b && a.split("?")[0] === b.split("?")[0];
  const currentInList = loaded.find((i) => sameFile(i.url, currentUrl));
  const currentItem: MediaItem | null = currentUrl
    ? (currentInList ?? {
        id: "__current",
        url: currentUrl,
        thumb: type === "image" ? currentUrl : "",
        alt: "",
        name:
          decodeURIComponent(currentUrl.split("?")[0].split("/").pop() ?? "") ||
          `Current ${type}`,
      })
    : null;
  const listed =
    currentItem && (currentInList || !q)
      ? [currentItem, ...loaded.filter((i) => i !== currentInList)]
      : loaded;
  // The upload leads the grid: a placeholder tile while it is on its way,
  // then the real file (with the local thumbnail if Shopify has no preview
  // yet), not repeated where the refreshed list also has it.
  const uploadTile: MediaItem | null = !pending
    ? null
    : pending.phase === "ready"
      ? { ...pending.item, thumb: pending.item.thumb || pending.thumb }
      : { id: PENDING_ID, url: "", thumb: pending.thumb, alt: "", name: pending.name };
  const items = uploadTile
    ? [uploadTile, ...listed.filter((i) => i.id !== uploadTile.id)]
    : listed;
  const currentId = currentItem?.id ?? null;

  const close = () => onClose();
  const choose = (item: MediaItem) => {
    onPick(item);
    onClose();
  };

  // A fresh start each time it opens; focus in, and back out on close.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setLocalError(null);
    setPending(null);
    // The in-browser video encoder (media-upload.ts), fetched while the
    // merchant is still choosing a file rather than after.
    if (type === "video") void import("mediabunny").catch(() => {});
    returnFocus.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      returnFocus.current?.focus?.();
    };
  }, [open, type]);

  // Pre-select the current file — on open, and again once the list has
  // loaded and resolved it to its real tile — until the merchant picks.
  const touched = useRef(false);
  useEffect(() => {
    if (open) touched.current = false;
  }, [open, type]);
  useEffect(() => {
    if (open && !touched.current) setSelectedId(currentId);
  }, [open, currentId]);
  const select = (id: string) => {
    touched.current = true;
    setSelectedId(id);
  };

  // Escape closes, wherever focus is.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  // Loaded on open and as the search changes (debounced), never on mount:
  // this sits on the editor pages, where most visits never open it.
  useEffect(() => {
    if (!open || fixedItems) return;
    const t = window.setTimeout(
      () => list.load(`/api/media?type=${type}&q=${encodeURIComponent(q)}`),
      q ? 300 : 0,
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type, q]);

  const openRef = useRef(open);
  openRef.current = open;
  // Which upload is current, so a stale one finishing late changes nothing.
  const uploadSeq = useRef(0);
  async function startUpload(file: File) {
    setLocalError(null);
    if (file.size > rules.maxBytes) {
      setLocalError(rules.tooBig);
      return;
    }
    const seq = ++uploadSeq.current;
    const live = () => openRef.current && seq === uploadSeq.current;
    const base = { name: file.name, thumb: "" };
    setPending({ ...base, phase: "uploading", fraction: 0 });
    // The tile's picture, made while the upload runs.
    void localThumb(file).then((thumb) => {
      if (live()) setPending((p) => (p ? { ...p, thumb } : p));
      else if (thumb.startsWith("blob:")) URL.revokeObjectURL(thumb);
    });
    const result = await uploadMedia(file, (p: UploadProgress) => {
      if (!live()) return;
      setPending((cur) => {
        const keep = { name: file.name, thumb: cur?.thumb ?? "" };
        return p.phase === "finishing"
          ? { ...keep, phase: "finishing" }
          : p.phase === "optimizing"
            ? { ...keep, phase: "optimizing", fraction: p.fraction }
            : { ...keep, phase: "uploading", fraction: p.fraction };
      });
    }).catch(() => ({
      ok: false as const,
      error: "The upload failed. Check your connection and try again.",
    }));
    if (!live()) return;
    if (!result.ok) {
      setPending(null);
      setLocalError(result.error);
    } else if ("item" in result) {
      readyUp(result.item);
    } else {
      setPending((cur) => ({
        name: file.name,
        thumb: cur?.thumb ?? "",
        phase: "processing",
        videoId: result.videoId,
        since: Date.now(),
      }));
    }
  }

  // Done: selected and waiting for the merchant's Select, not used on its
  // own — they may want to check it, or pick something else after all.
  function readyUp(item: MediaItem) {
    setPending((cur) => ({ name: item.name, thumb: cur?.thumb ?? "", phase: "ready", item }));
    select(item.id);
    // The list as Shopify now has it, so the new file stays once this ends.
    if (!fixedItems) list.load(`/api/media?type=${type}&q=${encodeURIComponent(q)}`);
  }

  // Poll a processing video until it is ready, fails, or takes implausibly
  // long. Stops if the picker closes: the video still finishes in Shopify
  // Files and is in the list next time.
  const processingId = pending?.phase === "processing" ? pending.videoId : null;
  const processingSince = pending?.phase === "processing" ? pending.since : 0;
  useEffect(() => {
    if (!open || !processingId) return;
    const waited = Date.now() - processingSince;
    const t = window.setTimeout(
      () => {
        if (Date.now() - processingSince > VIDEO_POLL_LIMIT_MS) {
          setPending(null);
          setLocalError(
            "Shopify is still processing the video. It will appear in this list when it’s ready.",
          );
          return;
        }
        status.load(`/api/media?video=${encodeURIComponent(processingId)}`);
      },
      waited < VIDEO_POLL_FAST_FOR_MS ? VIDEO_POLL_FAST_MS : VIDEO_POLL_SLOW_MS,
    );
    return () => window.clearTimeout(t);
    // Re-armed after every answer (status.data), so it polls in sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, processingId, status.data]);

  useEffect(() => {
    if (!processingId || status.state !== "idle" || !status.data) return;
    if (status.data.status === "ready") {
      readyUp(status.data.item);
    } else if (status.data.status === "failed") {
      setPending(null);
      setLocalError(status.data.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.state, status.data]);

  useEffect(() => {
    if (!open) {
      uploadSeq.current++;
      setPending(null);
    }
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const loading = !fixedItems && !listForType;
  const busy = pending !== null && pending.phase !== "ready";
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const selectedBusy = selected?.id === PENDING_ID;
  const badge = (p: Pending) =>
    p.phase === "optimizing"
      ? `Optimizing ${Math.round(p.fraction * 100)}%`
      : p.phase === "uploading"
      ? p.fraction === null
        ? "Uploading…"
        : `Uploading ${Math.round(p.fraction * 100)}%`
      : p.phase === "finishing"
        ? "Saving…"
        : p.phase === "processing"
          ? "Processing…"
          : "New";
  const noun = type === "image" ? "image" : "video";
  const heading = type === "image" ? "Choose an image" : "Choose a video";

  return createPortal(
    <div
      className="mp-backdrop"
      onMouseDown={(e) => {
        // Only a press that starts on the backdrop itself, so dragging out of
        // the panel (selecting search text, say) does not close it.
        if (e.target === e.currentTarget) close();
      }}
    >
      <style>{MP_CSS}</style>
      <div
        ref={panelRef}
        className="mp-panel"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
      >
        <div className="mp-head">
          <h2>{heading}</h2>
          <button
            type="button"
            className="mp-x"
            aria-label="Close"
            onClick={close}
          >
            ×
          </button>
        </div>

        <div className="mp-body">
          <div className="mp-toolbar">
            <div className="mp-search">
              <s-search-field
                label="Search Shopify Files"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search by file name"
                value={q}
                onInput={(e) => setQ(fieldValue(e))}
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={rules.accept}
              hidden
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (!file) return;
                void startUpload(file);
              }}
            />
            <s-button
              icon="upload"
              loading={flag(busy)}
              onClick={() => fileRef.current?.click()}
            >
              {type === "image" ? "Upload image" : "Upload video"}
            </s-button>
          </div>

          {localError ? (
            <s-banner tone="critical">
              <s-paragraph>{localError}</s-paragraph>
            </s-banner>
          ) : null}
          {pending && pending.phase !== "ready" ? (
            <div className="mp-progress" role="status">
              <div className="mp-progress-label">
                {pending.phase === "optimizing"
                  ? `Optimizing for the web… ${Math.round(pending.fraction * 100)}%`
                  : pending.phase === "uploading"
                  ? pending.fraction === null
                    ? "Uploading to Shopify…"
                    : `Uploading to Shopify… ${Math.round(pending.fraction * 100)}%`
                  : pending.phase === "finishing"
                    ? "Adding to Shopify Files…"
                    : "Uploaded. Shopify is preparing the video — usually a few seconds to a minute."}
              </div>
              <div
                className="mp-progress-track"
                data-indeterminate={
                  (pending.phase === "uploading" || pending.phase === "optimizing") &&
                  pending.fraction !== null
                    ? undefined
                    : ""
                }
              >
                <div
                  className="mp-progress-bar"
                  style={
                    (pending.phase === "uploading" || pending.phase === "optimizing") &&
                    pending.fraction !== null
                      ? { width: `${Math.max(2, pending.fraction * 100)}%` }
                      : undefined
                  }
                />
              </div>
            </div>
          ) : pending?.phase === "ready" ? (
            <s-banner tone="success">
              <s-paragraph>
                {pending.name} is ready. Click{" "}
                {type === "image" ? "Select image" : "Select video"} to use it.
              </s-paragraph>
            </s-banner>
          ) : null}

          {loading ? (
            <div className="mp-center">
              <s-spinner accessibilityLabel="Loading files" />
            </div>
          ) : items.length === 0 ? (
            <s-paragraph color="subdued">
              {type === "image"
                ? "No images found. Upload one, or paste an image link in the hotspot form."
                : "No videos in Shopify Files yet. Upload one, or paste a YouTube or Vimeo link in the hotspot form."}
            </s-paragraph>
          ) : (
            <div className="mp-grid" role="listbox" aria-label={`${noun}s`}>
              {items.map((item) => {
                const isSelected = item.id === selectedId;
                return (
                  <div
                    key={item.id}
                    className="mp-item"
                    data-media-id={item.id}
                    data-selected={isSelected ? "" : undefined}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    title={item.name}
                    data-busy={item.id === PENDING_ID ? "" : undefined}
                    onClick={() => select(item.id)}
                    onDoubleClick={() => {
                      if (item.id !== PENDING_ID) choose(item);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && item.id !== PENDING_ID) choose(item);
                      if (e.key === " ") {
                        e.preventDefault();
                        select(item.id);
                      }
                    }}
                  >
                    {item.thumb ? (
                      <img
                        src={item.thumb}
                        alt={item.alt || item.name}
                        loading="lazy"
                      />
                    ) : (
                      <span className="mp-noimg">▶</span>
                    )}
                    {item.id === currentId ? (
                      <span className="mp-current">Current</span>
                    ) : pending && item.id === uploadTile?.id ? (
                      <span className="mp-current" data-state={pending.phase}>
                        {badge(pending)}
                      </span>
                    ) : null}
                    <span className="mp-check" aria-hidden="true">
                      ✓
                    </span>
                    <span className="mp-name">{item.name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mp-foot">
          <span className="mp-hint">
            {selectedBusy
              ? "It can be selected once Shopify has finished with it."
              : selected
              ? `Selected: ${selected.name}`
              : `Click a${noun === "image" ? "n" : ""} ${noun} to select it, or double-click to use it.`}
          </span>
          <s-button onClick={close}>Cancel</s-button>
          <s-button
            variant="primary"
            disabled={flag(!selected || selectedBusy)}
            onClick={() => {
              if (selected && !selectedBusy) choose(selected);
            }}
          >
            {selectedBusy
              ? "Processing…"
              : type === "image"
                ? "Select image"
                : "Select video"}
          </s-button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const MP_CSS = `
.mp-backdrop {
  position: fixed; inset: 0; z-index: 2147483000; display: flex;
  align-items: center; justify-content: center; padding: 16px;
  background: rgba(0, 0, 0, 0.45);
}
.mp-panel {
  width: min(760px, 100%); max-height: min(720px, calc(100vh - 32px));
  display: flex; flex-direction: column; background: #fff; color: #303030;
  border-radius: 12px; box-shadow: 0 20px 48px rgba(0, 0, 0, 0.28); outline: none;
  font-family: Inter, -apple-system, "Segoe UI", sans-serif; font-size: 13px;
}
.mp-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid #ebebeb;
}
.mp-head h2 { margin: 0; font-size: 14px; font-weight: 650; }
.mp-x {
  all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; font-size: 20px; color: #616161;
}
.mp-x:hover { background: #f1f1f1; }
.mp-x:focus-visible { outline: 2px solid #2a78d6; }
.mp-body { padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.mp-toolbar { display: flex; gap: 8px; align-items: flex-end; }
.mp-search { flex: 1; min-width: 0; }
.mp-center { display: flex; justify-content: center; padding: 24px; }
.mp-progress { display: flex; flex-direction: column; gap: 6px; }
.mp-progress-label { font-weight: 550; }
.mp-progress-track { position: relative; height: 6px; border-radius: 3px; background: #ebebeb; overflow: hidden; }
.mp-progress-bar { height: 100%; width: 0; background: #2a78d6; border-radius: 3px; transition: width 0.2s; }
.mp-progress-track[data-indeterminate] .mp-progress-bar {
  position: absolute; width: 35%; animation: mp-slide 1.1s ease-in-out infinite;
}
@keyframes mp-slide { from { left: -35%; } to { left: 100%; } }
.mp-grid {
  display: grid; gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
}
.mp-item {
  position: relative; box-sizing: border-box; cursor: pointer; display: flex;
  flex-direction: column; gap: 6px; padding: 6px; border-radius: 10px;
  border: 1px solid #e3e3e3; background: #fff; user-select: none;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.mp-item:hover { border-color: #b5b5b5; }
.mp-item:focus-visible { outline: 2px solid #2a78d6; outline-offset: 2px; }
.mp-item[data-selected] {
  border-color: #2a78d6; box-shadow: 0 0 0 2px #2a78d6; background: #f2f7fe;
}
.mp-item img, .mp-noimg {
  width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; background: #f1f1f1;
  display: flex; align-items: center; justify-content: center; color: #8a8a8a; font-size: 24px;
}
.mp-check {
  position: absolute; top: 10px; right: 10px; width: 22px; height: 22px; border-radius: 50%;
  display: none; align-items: center; justify-content: center;
  background: #2a78d6; color: #fff; font-size: 13px; font-weight: 700;
  box-shadow: 0 0 0 2px #fff;
}
.mp-item[data-selected] .mp-check { display: flex; }
.mp-current {
  position: absolute; top: 10px; left: 10px; padding: 2px 7px; border-radius: 999px;
  background: rgba(0, 0, 0, 0.7); color: #fff; font-size: 11px; font-weight: 600;
}
.mp-item[data-busy] img, .mp-item[data-busy] .mp-noimg { opacity: 0.55; }
.mp-current[data-state="ready"] { background: #2a78d6; }
.mp-name { font-size: 12px; color: #616161; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-foot {
  display: flex; align-items: center; gap: 8px; padding: 12px 16px;
  border-top: 1px solid #ebebeb;
}
.mp-hint { flex: 1; min-width: 0; color: #616161; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (prefers-color-scheme: dark) {
  .mp-panel { background: #1f1f1f; color: #e3e3e3; }
  .mp-head, .mp-foot { border-color: #333; }
  .mp-item { background: #1f1f1f; border-color: #3a3a3a; }
  .mp-item[data-selected] { background: #14243a; }
  .mp-x:hover { background: #2a2a2a; }
  .mp-hint, .mp-name { color: #b5b5b5; }
  .mp-progress-track { background: #333; }
}
`;
