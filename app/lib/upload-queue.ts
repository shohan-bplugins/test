import { formatFileSize, validateModelFile } from "./files";
import {
  deleteUploads,
  loadUploads,
  saveUploads,
  type StoredUpload,
} from "./upload-store";
import type {
  UploadJobStatus,
  UploadResponse,
} from "~/routes/api.models.upload";

/*
 * The model library's bulk upload queue.
 *
 * Module state rather than component state, so it belongs to the app's page
 * rather than to one route: moving to another page of the app leaves uploads
 * running, and coming back shows them where they've got to. The library page
 * subscribes through useSyncExternalStore.
 *
 * Surviving a reload or a closed tab is the job of the two halves underneath:
 *
 *   - upload-store.ts keeps every unfinished file in IndexedDB, so the bytes
 *     are still there when the page comes back.
 *   - /api/models/upload records each file's key server-side. A file that was
 *     mid-flight when the page went away may well have landed; asking by key
 *     tells the queue whether to mark it done, wait for it, or send it again,
 *     and the endpoint refuses to upload one key twice either way.
 *
 * Files go one at a time. Shopify's staged upload is per file anyway, one at a
 * time keeps the server's plan-limit check exact, and a failure costs that
 * file alone. A closed page can't send anything, so a batch pauses while the
 * app is closed and carries on the next time the library page is opened.
 */

export type UploadItem = StoredUpload & {
  /** Bytes sent of the file currently uploading. Never persisted. */
  loaded?: number;
};

export type BatchSummary = { added: number; failed: number; bytesSaved: number };

const ENDPOINT = "/api/models/upload";
const POLL_MS = 3000;
const EMPTY: UploadItem[] = [];

let items: UploadItem[] = EMPTY;
let restoredShop: string | null = null;
let running = false;
// Files refused at drop time (wrong type, too big, over the limit). They never
// reach drain(), but the batch's closing toast should still count them.
let refusedSinceDrain = 0;
const listeners = new Set<() => void>();
const finishListeners = new Set<(summary: BatchSummary) => void>();
const uploadedListeners = new Set<(modelId: string | null) => void>();

/**
 * How long a finished batch's "Added" rows stay on screen before they clear
 * themselves. Long enough to see the batch land; failed rows stay until the
 * merchant removes or retries them, since those still need something done.
 */
const DONE_LINGER_MS = 2500;

function setItems(next: UploadItem[]) {
  items = next;
  listeners.forEach((l) => l());
}

function toStored({ loaded: _loaded, ...rest }: UploadItem): StoredUpload {
  return rest;
}

function patch(key: string, change: Partial<UploadItem>, persist = true) {
  let changed: UploadItem | undefined;
  setItems(
    items.map((it) => {
      if (it.key !== key) return it;
      changed = { ...it, ...change };
      return changed;
    }),
  );
  if (persist && changed) void saveUploads([toStored(changed)]);
}

export function subscribeUploads(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getUploads() {
  return items;
}

export function getServerUploads() {
  return EMPTY;
}

/** Called each time one file lands in the library. Returns an unsubscribe. */
export function onModelUploaded(listener: (modelId: string | null) => void) {
  uploadedListeners.add(listener);
  return () => {
    uploadedListeners.delete(listener);
  };
}

function markDone(
  key: string,
  size: number,
  modelId: string | null,
  sizes?: { originalSize?: number; size?: number },
) {
  patch(key, {
    status: "done",
    file: null,
    loaded: size,
    originalSize: sizes?.originalSize,
    uploadedSize: sizes?.size,
  });
  uploadedListeners.forEach((l) => l(modelId));
}

/** Called when a batch drains. Returns an unsubscribe. */
export function onBatchFinished(listener: (summary: BatchSummary) => void) {
  finishListeners.add(listener);
  return () => {
    finishListeners.delete(listener);
  };
}

const isActive = (u: UploadItem) =>
  u.status === "queued" || u.status === "uploading" || u.status === "processing";

/* App Bridge's global, present on every embedded page. */
function appBridge(): any {
  return (window as any).shopify;
}

async function authHeader(): Promise<Record<string, string>> {
  try {
    const token = await appBridge()?.idToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * Pick up whatever a previous page load left behind for this shop. Anything
 * that was mid-upload is marked "processing" and checked with the server
 * before anything is sent again.
 */
export async function restoreUploads(shop: string) {
  if (restoredShop === shop) return;
  restoredShop = shop;
  const all = await loadUploads(shop);
  // Files that already landed have nothing left to show — the library table
  // has them — so they are dropped rather than brought back as stale rows.
  const landed = all.filter((s) => s.status === "done");
  if (landed.length) void deleteUploads(landed.map((s) => s.key));
  const stored = all.filter((s) => s.status !== "done");
  if (stored.length === 0) return;
  const known = new Set(items.map((i) => i.key));
  const restored: UploadItem[] = stored
    .filter((s) => !known.has(s.key))
    .map((s) =>
      s.status === "uploading" || s.status === "processing"
        ? { ...s, status: "processing" }
        : s,
    );
  setItems([...items, ...restored]);
  void drain();
}

/**
 * Add dropped files. Ones that can't be added — wrong type, too big, or past
 * the `room` the plan has left — fail straight away without a request.
 */
export function enqueueUploads(
  shop: string,
  files: File[],
  room: number,
  limitMessage: string,
  optimize = true,
) {
  let left = room - items.filter(isActive).length;
  const now = Date.now();
  const added: UploadItem[] = files.map((file, i) => {
    const base = {
      key: crypto.randomUUID(),
      shop,
      name: file.name,
      size: file.size,
      // A fraction per file keeps drop order through a reload: the store sorts
      // by this, and a whole batch shares one millisecond.
      addedAt: now + i / 1000,
      optimize,
    };
    const fileError = validateModelFile(file, optimize);
    if (fileError) return { ...base, file: null, status: "error", error: fileError };
    if (left <= 0) {
      return { ...base, file: null, status: "error", error: limitMessage };
    }
    left--;
    return { ...base, file, status: "queued" };
  });
  refusedSinceDrain += added.filter((u) => u.status === "error").length;
  setItems([...items, ...added]);
  void saveUploads(added.map(toStored));
  void drain();
}

/**
 * Drop the rows that landed, once a batch is over. Skipped if another batch
 * has started meanwhile — its rows would vanish from under the bar mid-run.
 */
function clearDoneUploads() {
  if (running || items.some(isActive)) return;
  const gone = items.filter((u) => u.status === "done");
  if (gone.length === 0) return;
  setItems(items.filter((u) => u.status !== "done"));
  void deleteUploads(gone.map((u) => u.key));
}

/** Drop finished rows (added and failed) from the list. */
export function clearFinishedUploads() {
  const gone = items.filter((u) => !isActive(u));
  setItems(items.filter(isActive));
  void deleteUploads(gone.map((u) => u.key));
}

/** Stop everything not yet sent. The file uploading right now still finishes. */
export function cancelQueuedUploads() {
  const gone = items.filter((u) => u.status === "queued");
  setItems(items.filter((u) => u.status !== "queued"));
  void deleteUploads(gone.map((u) => u.key));
}

/** Take one finished or failed file off the list. */
export function removeUpload(key: string) {
  const item = items.find((u) => u.key === key);
  if (!item || item.status === "uploading" || item.status === "processing") return;
  setItems(items.filter((u) => u.key !== key));
  void deleteUploads([key]);
}

/** Send failed files again, where the file is still at hand. */
export function retryFailedUploads() {
  const retry = items.filter((u) => u.status === "error" && u.file);
  if (retry.length === 0) return;
  for (const u of retry) patch(u.key, { status: "queued", error: undefined });
  void drain();
}

function post(
  form: FormData,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
): Promise<UploadResponse> {
  // XHR rather than fetch: fetch still has no upload progress.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", ENDPOINT);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let body: UploadResponse | null = null;
      try {
        body = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        // Not JSON — a crash page, a proxy error. Reported by status below.
      }
      if (body && typeof body.ok === "boolean") {
        resolve(body);
      } else if (xhr.status === 401 || xhr.status === 403) {
        reject(new Error("Your session expired. Reload the page to continue."));
      } else {
        reject(new Error(`Upload failed (server answered ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error. Check your connection and retry."));
    xhr.send(form);
  });
}

type Outcome = "done" | "error" | "waiting";

async function sendOne(item: UploadItem): Promise<Outcome> {
  if (!item.file) {
    patch(item.key, { status: "error", error: "The file is no longer available. Add it again." });
    return "error";
  }
  patch(item.key, { status: "uploading", loaded: 0 });
  try {
    const form = new FormData();
    form.append("key", item.key);
    form.append("name", item.name);
    form.append("optimize", item.optimize === false ? "0" : "1");
    form.append("file", item.file, item.name);
    const result = await post(form, await authHeader(), (loaded) =>
      // Once every byte is sent the server still has to hand the file to
      // Shopify, which reports no progress of its own.
      patch(
        item.key,
        { loaded, status: loaded >= item.size ? "processing" : "uploading" },
        false,
      ),
    );
    if (result.ok) {
      markDone(item.key, item.size, result.id, result);
      return "done";
    }
    if (result.pending) {
      patch(item.key, { status: "processing" });
      return "waiting";
    }
    patch(item.key, { status: "error", error: result.error });
    return "error";
  } catch (err) {
    patch(item.key, {
      status: "error",
      error: err instanceof Error ? err.message : "Upload failed",
    });
    return "error";
  }
}

async function fetchStatuses(
  keys: string[],
): Promise<Record<string, UploadJobStatus> | null> {
  try {
    const res = await fetch(`${ENDPOINT}?keys=${keys.join(",")}`, {
      headers: await authHeader(),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { jobs: Record<string, UploadJobStatus> }).jobs;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function drain() {
  if (running) return;
  running = true;
  const summary: BatchSummary = { added: 0, failed: 0, bytesSaved: 0 };
  let worked = false;
  try {
    for (;;) {
      const next = items.find((u) => u.status === "queued");
      if (next) {
        worked = true;
        const outcome = await sendOne(next);
        if (outcome === "done") {
          summary.added++;
          const landed = items.find((u) => u.key === next.key);
          if (landed?.originalSize && landed.uploadedSize) {
            summary.bytesSaved += Math.max(0, landed.originalSize - landed.uploadedSize);
          }
        }
        else if (outcome === "error") summary.failed++;
        continue;
      }

      // Nothing left to send; settle the files the server is still working on
      // (or that were in flight when the page last went away).
      const waiting = items.filter((u) => u.status === "processing" || u.status === "uploading");
      if (waiting.length === 0) break;
      worked = true;
      const jobs = await fetchStatuses(waiting.map((u) => u.key));
      if (jobs) {
        for (const u of waiting) {
          const job = jobs[u.key];
          if (job?.status === "done") {
            markDone(u.key, u.size, job.modelId);
            summary.added++;
          } else if (job?.status === "error") {
            patch(u.key, { status: "error", error: job.error ?? "Upload failed" });
            summary.failed++;
          } else if (!job || job.stale) {
            // Never reached the server, or died there: send it again.
            patch(u.key, { status: "queued" });
          }
        }
      }
      const stillWaiting = items.some(
        (u) => u.status === "processing" || u.status === "uploading",
      );
      if (stillWaiting && !items.some((u) => u.status === "queued")) {
        await sleep(POLL_MS);
      }
    }
  } finally {
    running = false;
  }

  summary.failed += refusedSinceDrain;
  refusedSinceDrain = 0;
  if (!worked) return;
  finishListeners.forEach((l) => l(summary));
  setTimeout(clearDoneUploads, DONE_LINGER_MS);
  // Toasted from here rather than by the library page, so it still shows if
  // the merchant has moved to another page of the app meanwhile.
  const n = (k: number) => `${k} model${k === 1 ? "" : "s"}`;
  const toast = appBridge()?.toast;
  if (!toast) return;
  const saved =
    summary.bytesSaved > 0 ? ` · ${formatFileSize(summary.bytesSaved)} saved` : "";
  if (summary.failed === 0 && summary.added > 0) {
    toast.show(
      (summary.added === 1 ? "Model uploaded to library" : `${n(summary.added)} uploaded`) + saved,
    );
  } else if (summary.failed > 0) {
    toast.show(
      summary.added > 0
        ? `${n(summary.added)} uploaded, ${summary.failed} failed`
        : `${n(summary.failed)} failed to upload`,
      { isError: true },
    );
  }
}
