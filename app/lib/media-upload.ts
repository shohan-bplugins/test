import type { StagedTarget, UploadResult } from "~/routes/api.media";

/*
 * Uploads an image or a video for a hotspot card into Shopify Files, straight
 * from the browser. Used by components/MediaPickerModal.tsx.
 *
 *   1. stage   — /api/media asks Shopify for an upload target (a few hundred
 *                bytes of JSON; the file itself never touches this app)
 *   2. upload  — the browser posts the file directly to Shopify's storage
 *   3. create  — /api/media registers the uploaded file in Files
 *
 * The bytes travel once, at the merchant's own connection speed, with no limit
 * from this app's server or its proxy — only Shopify's. Previously every file
 * went browser → app server → Shopify: twice the transfer, buffered whole in
 * between, and capped at the proxy's 100MB.
 *
 * Step 2 has two ways in. Shopify's image storage allows cross-origin reads, so
 * an XHR reports progress. Its video storage does not: a cross-origin XHR with
 * an upload listener needs a CORS preflight, which that storage fails. A plain
 * form POST needs no preflight, so the file is then sent with fetch in
 * `no-cors` mode — it uploads just the same, but the response is unreadable,
 * so whether it landed is learnt from step 3 instead. If none of that works,
 * a file small enough is relayed through /api/media as before.
 *
 * Videos are made web-ready first, in the browser (makeWebReady): anything
 * larger than 1280px or heavier than ~4 Mbps is re-encoded to H.264/AAC MP4
 * with the device's hardware encoder (mediabunny, WebCodecs). Shopify's own
 * processing time grows with the file, so this alone cuts it — a 200MB phone
 * clip typically becomes 5–15MB. A result that fits Shopify's 20MB plain-file
 * limit is then stored as a plain file (`asFile`), which Shopify does not
 * transcode at all: usable in seconds. Its poster is a frame taken here and
 * uploaded alongside. Anything bigger goes the video route, where Shopify
 * transcodes it and supplies the poster itself.
 */

const ENDPOINT = "/api/media";
/** Mirrors MAX_RELAY_VIDEO_BYTES in routes/api.media.tsx. */
export const MAX_RELAY_BYTES = 90 * 1024 * 1024;
/** Mirrors MAX_PLAIN_FILE_BYTES in routes/api.media.tsx. */
const MAX_PLAIN_FILE_BYTES = 19 * 1024 * 1024;
// Web-ready: the long side and bitrate a hotspot card needs, at most.
const MAX_SIDE = 1280;
const MAX_BITRATE = 4_000_000;

export type UploadProgress =
  /** Re-encoding the video in the browser; see makeWebReady. */
  | { phase: "optimizing"; fraction: number }
  /** `fraction` is null while the size of what is left is unknown. */
  | { phase: "uploading"; fraction: number | null }
  | { phase: "finishing" };

type Done = Extract<UploadResult, { item: unknown } | { processing: true }>;

// Browsers leave `type` empty for some containers (.mkv, sometimes .mov).
const EXT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  "3gp": "video/3gpp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TYPES[ext] ?? "";
}

async function authHeader(): Promise<Record<string, string>> {
  try {
    const token = await (window as any).shopify?.idToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * A still from a video file as a JPEG, `width` wide, from just in (past any
 * fade from black); null when the browser can't decode the format.
 */
export async function captureFrame(file: Blob, width: number): Promise<Blob | null> {
  const src = URL.createObjectURL(file);
  try {
    return await new Promise<Blob | null>((resolve) => {
      const video = document.createElement("video");
      const done = (out: Blob | null) => {
        window.clearTimeout(timer);
        video.removeAttribute("src");
        video.load();
        resolve(out);
      };
      const timer = window.setTimeout(() => done(null), 8000);
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(0.5, (video.duration || 1) / 3);
      };
      video.onseeked = () => {
        try {
          const w = Math.min(width, video.videoWidth || width);
          const h = Math.round((w * video.videoHeight) / (video.videoWidth || 1)) || Math.round((w * 9) / 16);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d")?.drawImage(video, 0, 0, w, h);
          canvas.toBlob((b) => done(b), "image/jpeg", 0.82);
        } catch {
          done(null);
        }
      };
      video.onerror = () => done(null);
      video.src = src;
    });
  } finally {
    URL.revokeObjectURL(src);
  }
}

/**
 * The video as a web-ready MP4 (H.264/AAC, long side ≤1280px, ≤~4 Mbps), made
 * with the browser's hardware encoder; null to upload the original as it is —
 * when it already qualifies, when this browser can't encode, or when the
 * conversion would lose something (its sound) or not help.
 */
async function makeWebReady(
  file: File,
  mimeType: string,
  onFraction: (f: number) => void,
): Promise<File | null> {
  if (typeof window === "undefined" || !("VideoEncoder" in window)) return null;
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) return null;
    const audio = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    const w = video.displayWidth;
    const h = video.displayHeight;
    const tooBig = Math.max(w, h) > MAX_SIDE;
    const tooHeavy = duration > 0 && (file.size * 8) / duration > MAX_BITRATE;
    const playable =
      mimeType === "video/mp4" && video.codec === "avc" && (!audio || audio.codec === "aac");
    if (playable && !tooBig && !tooHeavy) return null;
    if (!(await mb.canEncodeVideo("avc"))) return null;

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new mb.BufferTarget(),
    });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      showWarnings: false,
      video: {
        codec: "avc",
        quality: mb.QUALITY_MEDIUM,
        ...(tooBig ? (w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE }) : {}),
        forceTranscode: tooBig || tooHeavy,
      },
      audio: { codec: "aac", quality: mb.QUALITY_MEDIUM },
    });
    // A conversion that would drop the sound (no AAC encoder here) is not
    // worth it; the original goes up and Shopify converts it instead.
    if (!conversion.isValid || conversion.discardedTracks.length > 0) return null;
    conversion.onProgress = (p) => onFraction(Math.min(1, Math.max(0, p)));
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength >= file.size) return null;
    const name = file.name.replace(/\.[^.]+$/, "") + ".mp4";
    return new File([buffer], name, { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}

async function callApi(fields: Record<string, string>): Promise<UploadResult> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    body: form,
    headers: await authHeader(),
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "Your session expired. Reload the page to continue." };
  }
  try {
    return (await res.json()) as UploadResult;
  } catch {
    return { ok: false, error: `Upload failed (server answered ${res.status}).` };
  }
}

function targetForm(target: StagedTarget, file: File) {
  const body = new FormData();
  for (const p of target.parameters) body.append(p.name, p.value);
  body.append("file", file);
  return body;
}

/** XHR with progress; resolves true on a 2xx, false when it couldn't be made. */
function xhrUpload(
  url: string,
  body: FormData,
  headers: Record<string, string>,
  onFraction: (f: number) => void,
): Promise<{ ok: boolean; status: number; text: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onFraction(e.loaded / e.total);
    };
    xhr.onload = () =>
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => resolve({ ok: false, status: 0, text: "" });
    xhr.send(body);
  });
}

/** Through this app's server, as before: the fallback. */
async function relay(file: File, onProgress: (p: UploadProgress) => void): Promise<UploadResult> {
  const body = new FormData();
  body.set("file", file, file.name);
  const res = await xhrUpload(ENDPOINT, body, await authHeader(), (fraction) =>
    onProgress({ phase: "uploading", fraction }),
  );
  onProgress({ phase: "finishing" });
  if (res.status === 413) {
    return { ok: false, error: "That file is too large for the server. Try a smaller one." };
  }
  try {
    return JSON.parse(res.text) as UploadResult;
  } catch {
    return { ok: false, error: "The upload failed. Check your connection and try again." };
  }
}

type Outcome = Done | Extract<UploadResult, { ok: false }>;

/**
 * Upload `file`. Resolves with the finished item (images, and videos that
 * took the plain-file path), a video id to poll while Shopify processes it,
 * or an error.
 */
export async function uploadMedia(
  file: File,
  onProgress: (p: UploadProgress) => void,
): Promise<Outcome> {
  const mimeType = mimeOf(file);
  if (!mimeType.startsWith("video/")) return uploadOne(file, mimeType, onProgress);

  let video = file;
  let videoType = mimeType;
  try {
    onProgress({ phase: "optimizing", fraction: 0 });
    const ready = await makeWebReady(file, mimeType, (fraction) =>
      onProgress({ phase: "optimizing", fraction }),
    );
    if (ready) {
      video = ready;
      videoType = "video/mp4";
    }
  } catch {
    // Can't read or convert it here; Shopify gets the original instead.
  }

  if (videoType === "video/mp4" && video.size <= MAX_PLAIN_FILE_BYTES) {
    // The poster goes up alongside, from a frame taken here.
    const poster = captureFrame(video, 960).then((blob) =>
      blob
        ? uploadOne(
            new File([blob], video.name.replace(/\.[^.]+$/, "") + "-poster.jpg", { type: "image/jpeg" }),
            "image/jpeg",
            () => {},
          )
        : null,
    );
    const stored = await uploadOne(video, videoType, onProgress, true);
    if (stored.ok && "item" in stored) {
      const shot = await poster.catch(() => null);
      const posterUrl = shot?.ok && "item" in shot ? shot.item.url : "";
      return {
        ok: true,
        item: { ...stored.item, thumb: posterUrl, poster: posterUrl },
      };
    }
    // Not stored as a plain file after all: the video route below.
  }
  return uploadOne(video, videoType, onProgress);
}

async function uploadOne(
  file: File,
  mimeType: string,
  onProgress: (p: UploadProgress) => void,
  asFile = false,
): Promise<Outcome> {
  onProgress({ phase: "uploading", fraction: 0 });

  const staged = await callApi({
    intent: "stage",
    filename: file.name,
    mimeType,
    fileSize: String(file.size),
    ...(asFile ? { asFile: "1" } : {}),
  });
  if (!staged.ok) return staged;
  if (!("target" in staged)) return { ok: false, error: "Shopify didn’t accept the upload." };
  const { target } = staged;

  // Straight to Shopify: with progress where its storage allows it…
  let direct = await xhrUpload(target.url, targetForm(target, file), {}, (fraction) =>
    onProgress({ phase: "uploading", fraction }),
  );
  let unverified = false;
  if (!direct.ok && direct.status === 0) {
    // …and blind where it doesn't (see the note at the top).
    onProgress({ phase: "uploading", fraction: null });
    try {
      await fetch(target.url, { method: "POST", mode: "no-cors", body: targetForm(target, file) });
      direct = { ok: true, status: 0, text: "" };
      unverified = true;
    } catch {
      direct = { ok: false, status: 0, text: "" };
    }
  }

  onProgress({ phase: "finishing" });
  if (direct.ok) {
    const created = await callApi({
      intent: "create",
      resourceUrl: target.resourceUrl,
      mimeType,
      filename: file.name,
      ...(asFile ? { asFile: "1" } : {}),
    });
    if (created.ok && !("target" in created)) return created;
    // Only a blind upload is worth repeating through the relay: a create that
    // failed after a confirmed upload failed for a reason the relay shares.
    if (!unverified || file.size > MAX_RELAY_BYTES) {
      return created.ok ? { ok: false, error: "Shopify couldn’t create the file." } : created;
    }
  } else if (direct.status >= 400) {
    return { ok: false, error: `Shopify refused the upload (${direct.status}).` };
  }

  // The relay has no plain-file mode; the caller takes the video route.
  if (asFile || file.size > MAX_RELAY_BYTES) {
    return { ok: false, error: "The upload to Shopify failed. Check your connection and try again." };
  }
  const relayed = await relay(file, onProgress);
  if (relayed.ok && "target" in relayed) {
    return { ok: false, error: "Shopify couldn’t create the file." };
  }
  return relayed;
}
