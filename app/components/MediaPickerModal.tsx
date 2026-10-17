import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";

import { fieldValue, flag } from "~/components/polaris/helpers";
import type { MediaItem } from "~/routes/api.media";

/*
 * Choose an image or a video from the store's Shopify Files — or, for images,
 * upload a new one into Files — for a hotspot card. Backed by /api/media.
 *
 * Click a file to select it (highlighted, with a check), then confirm with
 * Select; double-click or Enter selects and confirms at once. An upload is
 * used as soon as it lands.
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
  const upload = useFetcher<{
    ok: boolean;
    error?: string;
    item?: MediaItem;
  }>();
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
  const items =
    currentItem && (currentInList || !q)
      ? [currentItem, ...loaded.filter((i) => i !== currentInList)]
      : loaded;
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

  // A finished upload is used straight away — that is why it was uploaded.
  useEffect(() => {
    if (upload.state === "idle" && upload.data?.ok && upload.data.item) {
      choose(upload.data.item);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.state, upload.data]);

  if (!open || typeof document === "undefined") return null;

  const loading = !fixedItems && !listForType;
  const uploading = upload.state !== "idle";
  const selected = items.find((i) => i.id === selectedId) ?? null;
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
            {type === "image" ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    if (!file) return;
                    const fd = new FormData();
                    fd.set("file", file);
                    upload.submit(fd, {
                      method: "post",
                      action: "/api/media",
                      encType: "multipart/form-data",
                    });
                  }}
                />
                <s-button
                  icon="upload"
                  loading={flag(uploading)}
                  onClick={() => fileRef.current?.click()}
                >
                  Upload image
                </s-button>
              </>
            ) : null}
          </div>

          {upload.data && !upload.data.ok ? (
            <s-banner tone="critical">
              <s-paragraph>{upload.data.error}</s-paragraph>
            </s-banner>
          ) : null}
          {uploading ? (
            <s-banner tone="info">
              <s-paragraph>
                Uploading to Shopify Files — it’s used as soon as it’s ready.
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
                : "No videos in Shopify Files. Add videos in Content → Files, or paste a YouTube or Vimeo link in the hotspot form."}
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
                    onClick={() => select(item.id)}
                    onDoubleClick={() => choose(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") choose(item);
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
            {selected
              ? `Selected: ${selected.name}`
              : `Click a${noun === "image" ? "n" : ""} ${noun} to select it, or double-click to use it.`}
          </span>
          <s-button onClick={close}>Cancel</s-button>
          <s-button
            variant="primary"
            disabled={flag(!selected)}
            onClick={() => {
              if (selected) choose(selected);
            }}
          >
            {type === "image" ? "Select image" : "Select video"}
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
}
`;
