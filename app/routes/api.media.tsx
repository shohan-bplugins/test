import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { hotspotsAllowed } from "~/lib/hotspots.server";

/*
 * Images and videos from the store's Shopify Files, for hotspot cards — and
 * upload of either into Files. Used by components/MediaPickerModal.tsx.
 *
 *   GET  ?type=image|video&q=…   newest first, 40 at a time
 *   GET  ?video=<file gid>       a video upload's processing status
 *   POST intent=stage            filename, mimeType, fileSize → a Shopify
 *                                staged-upload target the BROWSER uploads to
 *   POST intent=create           resourceUrl, mimeType, filename → the file in
 *                                Files: an image's CDN URL, or a video's id to
 *                                poll with ?video= until Shopify is done
 *   POST multipart "file"        fallback: the file itself, relayed through
 *                                this server (images ≤10MB, videos ≤90MB)
 *
 * stage/create take `asFile=1` for a small MP4 the picker has already made
 * web-ready (media-upload.ts): it is stored as a plain file instead of a
 * Shopify video, so Shopify does not transcode it — usable in a second or two
 * rather than after minutes of processing. Larger videos go the video route.
 *
 * The browser uploads straight to Shopify's storage (stage → upload →
 * create), so the bytes travel once, at the merchant's own upload speed, and
 * no size limit of this server or its proxy applies — only Shopify's. The
 * relay is what the picker falls back to if a direct upload cannot be made.
 *
 * A video is not polled here, unlike an image: Shopify transcodes it first,
 * which can take minutes, and holding the request open that long would run
 * into the reverse proxy's timeout. The picker polls instead.
 */

export type MediaItem = {
  id: string;
  /** The URL to store: the image itself, or the video's playable source. */
  url: string;
  /** A small preview for the picker grid. */
  thumb: string;
  /** Videos: a full-size still from the video, for the hotspot card. */
  poster?: string;
  alt: string;
  name: string;
};

export type StagedTarget = {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
};

export type UploadResult =
  | { ok: true; item: MediaItem }
  | { ok: true; processing: true; videoId: string }
  | { ok: true; target: StagedTarget }
  | { ok: false; error: string };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// The relay fallback only: below the VPS's 100MB client_max_body_size
// (DEPLOY-VPS.md), with room for the multipart envelope. Direct uploads are
// bounded by Shopify alone.
const MAX_RELAY_VIDEO_BYTES = 90 * 1024 * 1024;
// Shopify's limit for a plain (non-image, non-video) file is 20MB; kept just
// under it. Mirrors MAX_PLAIN_FILE_BYTES in lib/media-upload.ts.
const MAX_PLAIN_FILE_BYTES = 19 * 1024 * 1024;

/** The processing state of a video upload, for the picker's poll. */
export type VideoStatus =
  | { status: "processing" }
  | { status: "ready"; item: MediaItem }
  | { status: "failed"; error: string };

// The mp4 source plays everywhere; HLS (m3u8) would need a player.
const mp4Of = (node: any): string =>
  (node?.sources ?? []).find((s: any) => s.mimeType === "video/mp4")?.url ??
  "";

const nameFrom = (url: string) =>
  decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");

const isImageType = (t: string) => /^image\/(png|jpe?g|webp|gif)$/.test(t);
const isVideoType = (t: string) => /^video\/[\w.+-]+$/.test(t);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;

  const videoId = params.get("video");
  if (videoId) return videoStatus(admin, videoId);

  const type = params.get("type") === "video" ? "VIDEO" : "IMAGE";
  const q = (params.get("q") ?? "").trim().replace(/[*?"]/g, "");
  const query = [`media_type:${type}`, q ? `filename:*${q}*` : ""]
    .filter(Boolean)
    .join(" ");

  // Videos also include MP4s stored as plain files — what the picker's fast
  // upload path makes (see the note at the top).
  const plainMp4s =
    type === "VIDEO"
      ? listPlainMp4s(admin, q).catch(() => [] as MediaItem[])
      : Promise.resolve([] as MediaItem[]);
  const res = await admin.graphql(
    `#graphql
      query MediaFiles($q: String!) {
        files(first: 40, query: $q, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            alt
            fileStatus
            ... on MediaImage {
              image { url thumb: url(transform: { maxWidth: 200, maxHeight: 200 }) }
            }
            ... on Video {
              sources { url mimeType }
              preview {
                image {
                  thumb: url(transform: { maxWidth: 200, maxHeight: 200 })
                  poster: url(transform: { maxWidth: 1280 })
                }
              }
            }
          }
        }
      }`,
    { variables: { q: query } },
  );
  const json = await res.json();
  const nodes: any[] = json?.data?.files?.nodes ?? [];

  const items: MediaItem[] = nodes
    .filter((n) => n.fileStatus === "READY")
    .map((n): MediaItem | null => {
      if (type === "IMAGE") {
        const url = n.image?.url;
        return url
          ? {
              id: n.id,
              url,
              thumb: n.image.thumb ?? url,
              alt: n.alt ?? "",
              name: nameFrom(url),
            }
          : null;
      }
      return videoItem(n.id, n);
    })
    .filter((x): x is MediaItem => x !== null);

  // Labelled, so the picker can tell an image list from a video list and
  // never shows one while the other is loading.
  return {
    type: type === "IMAGE" ? ("image" as const) : ("video" as const),
    items: [...(await plainMp4s), ...items],
  };
};

// JSON, so the picker's upload steps can call it with plain fetch/XHR.
export const action = async (args: ActionFunctionArgs) =>
  Response.json(await handleUpload(args));

async function handleUpload({
  request,
}: ActionFunctionArgs): Promise<UploadResult> {
  const { admin, session } = await authenticate.admin(request);
  // Hotspot media is part of a paid feature; uploading into a store's Files
  // is not something a Free store reaches through this route.
  if (!(await hotspotsAllowed(admin, session?.shop ?? ""))) {
    return { ok: false, error: "Hotspots are available on paid plans." };
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "stage") {
    const filename = String(form.get("filename") ?? "").slice(0, 255);
    const mimeType = String(form.get("mimeType") ?? "");
    const fileSize = Number(form.get("fileSize") ?? 0);
    const invalid = checkFile(mimeType, fileSize, Infinity);
    if (invalid) return { ok: false, error: invalid };
    const asFile = form.get("asFile") === "1";
    if (asFile && (mimeType !== "video/mp4" || fileSize > MAX_PLAIN_FILE_BYTES)) {
      return { ok: false, error: "Only a small MP4 can skip Shopify’s processing." };
    }
    return stage(admin, filename || "upload", mimeType, fileSize, asFile);
  }

  if (intent === "create") {
    const resourceUrl = String(form.get("resourceUrl") ?? "");
    const mimeType = String(form.get("mimeType") ?? "");
    const filename = String(form.get("filename") ?? "").slice(0, 255);
    // Only a URL Shopify's own stagedUploadsCreate handed out.
    if (!/^https:\/\/[\w.-]+\.(googleapis\.com|shopify\.com)\//.test(resourceUrl)) {
      return { ok: false, error: "That upload can’t be used." };
    }
    if (!isImageType(mimeType) && !isVideoType(mimeType)) {
      return { ok: false, error: "Upload an image or a video." };
    }
    const asFile = form.get("asFile") === "1" && mimeType === "video/mp4";
    return create(admin, resourceUrl, mimeType, filename, asFile);
  }

  // Fallback: the file itself, relayed through this server.
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  const invalid = checkFile(file.type, file.size, MAX_RELAY_VIDEO_BYTES);
  if (invalid) return { ok: false, error: invalid };
  const staged = await stage(admin, file.name, file.type, file.size);
  if (!staged.ok || !("target" in staged)) return staged;
  const body = new FormData();
  for (const p of staged.target.parameters) body.append(p.name, p.value);
  body.append("file", file);
  const uploaded = await fetch(staged.target.url, { method: "POST", body });
  if (!uploaded.ok) {
    return { ok: false, error: "The upload to Shopify failed." };
  }
  return create(admin, staged.target.resourceUrl, file.type, file.name);
}

/** Why a file can't be uploaded, or null. */
function checkFile(type: string, size: number, maxVideo: number) {
  if (isVideoType(type)) {
    if (size > maxVideo) {
      return "That video is too large to upload this way. Try a smaller file, or paste a YouTube or Vimeo link.";
    }
    return null;
  }
  if (isImageType(type)) {
    return size > MAX_IMAGE_BYTES ? "Images can be up to 10 MB." : null;
  }
  return "Upload a PNG, JPG, WebP or GIF image, or a video file.";
}

async function stage(
  admin: any,
  filename: string,
  mimeType: string,
  fileSize: number,
  asFile = false,
): Promise<UploadResult> {
  const res = await admin.graphql(
    `#graphql
      mutation StageMedia($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { message }
        }
      }`,
    {
      variables: {
        input: [
          {
            filename,
            mimeType,
            resource: asFile ? "FILE" : isVideoType(mimeType) ? "VIDEO" : "IMAGE",
            fileSize: String(fileSize),
            httpMethod: "POST",
          },
        ],
      },
    },
  );
  const json = (await res.json())?.data?.stagedUploadsCreate;
  const target = json?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) {
    // Shopify's own reason — its size and format limits live here.
    return {
      ok: false,
      error: json?.userErrors?.[0]?.message ?? "Shopify didn’t accept the upload.",
    };
  }
  return {
    ok: true,
    target: {
      url: target.url,
      resourceUrl: target.resourceUrl,
      parameters: target.parameters ?? [],
    },
  };
}

async function create(
  admin: any,
  resourceUrl: string,
  mimeType: string,
  filename: string,
  asFile = false,
): Promise<UploadResult> {
  const isVideo = isVideoType(mimeType) && !asFile;
  const created = await admin.graphql(
    `#graphql
      mutation CreateMedia($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id }
          userErrors { message }
        }
      }`,
    {
      variables: {
        files: [
          {
            originalSource: resourceUrl,
            contentType: asFile ? "FILE" : isVideo ? "VIDEO" : "IMAGE",
            alt: filename.replace(/\.[^.]+$/, ""),
          },
        ],
      },
    },
  );
  const createdJson = await created.json();
  const fileId = createdJson?.data?.fileCreate?.files?.[0]?.id;
  if (!fileId) {
    const msg = createdJson?.data?.fileCreate?.userErrors?.[0]?.message;
    return { ok: false, error: msg ?? "Shopify couldn’t create the file." };
  }

  // Transcoding takes too long to wait for here; the picker polls ?video=.
  if (isVideo) return { ok: true, processing: true, videoId: fileId };
  if (asFile) return plainFileReady(admin, fileId, filename);

  // Shopify processes the image before it has a CDN URL; usually a second or
  // two. Polled briefly rather than making the merchant refresh.
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 500 : 900));
    const res = await admin.graphql(
      `#graphql
        query ImageReady($id: ID!) {
          node(id: $id) {
            ... on MediaImage { fileStatus alt image { url } }
          }
        }`,
      { variables: { id: fileId } },
    );
    const node = (await res.json())?.data?.node;
    if (node?.fileStatus === "FAILED") {
      return { ok: false, error: "Shopify couldn’t process that image." };
    }
    if (node?.image?.url) {
      return {
        ok: true,
        item: {
          id: fileId,
          url: node.image.url,
          thumb: node.image.url,
          alt: node.alt ?? "",
          name: filename,
        },
      };
    }
  }
  return {
    ok: false,
    error:
      "The image is still processing in Shopify Files. Try choosing it again in a moment.",
  };
}

function videoItem(id: string, node: any): MediaItem | null {
  const mp4 = mp4Of(node);
  if (!mp4) return null;
  return {
    id,
    url: mp4,
    thumb: node.preview?.image?.thumb ?? "",
    poster: node.preview?.image?.poster ?? "",
    alt: node.alt ?? "",
    name: nameFrom(mp4),
  };
}

async function videoStatus(admin: any, id: string): Promise<VideoStatus> {
  const res = await admin.graphql(
    `#graphql
      query VideoReady($id: ID!) {
        node(id: $id) {
          ... on Video {
            fileStatus
            alt
            fileErrors { message }
            sources { url mimeType }
            preview {
              image {
                thumb: url(transform: { maxWidth: 200, maxHeight: 200 })
                poster: url(transform: { maxWidth: 1280 })
              }
            }
          }
        }
      }`,
    { variables: { id } },
  );
  const node = (await res.json())?.data?.node;
  if (!node) return { status: "failed", error: "That video wasn’t found." };
  if (node.fileStatus === "FAILED") {
    return {
      status: "failed",
      error:
        node.fileErrors?.[0]?.message ??
        "Shopify couldn’t process that video. Try an MP4 or MOV file.",
    };
  }
  // Ready as soon as a playable MP4 exists — Shopify can list one before it
  // flips the file to READY (it is still making other renditions), and that
  // is all a hotspot needs. Its preview still may come later; a card without
  // a poster shows the video's first frame.
  const item = videoItem(id, node);
  return item ? { status: "ready", item } : { status: "processing" };
}

/** MP4s stored as plain files (GenericFile), newest first. */
async function listPlainMp4s(admin: any, q: string): Promise<MediaItem[]> {
  const res = await admin.graphql(
    `#graphql
      query PlainVideos($q: String!) {
        files(first: 20, query: $q, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            alt
            fileStatus
            ... on GenericFile { url mimeType }
          }
        }
      }`,
    {
      variables: {
        q: `media_type:GENERIC_FILE filename:*${q ? `${q}*` : ""}.mp4`,
      },
    },
  );
  const nodes: any[] = (await res.json())?.data?.files?.nodes ?? [];
  return nodes
    .filter((n) => n.fileStatus === "READY" && n.url && /\.mp4(\?|$)/i.test(n.url))
    .map((n) => ({
      id: n.id,
      url: n.url,
      thumb: "",
      alt: n.alt ?? "",
      name: nameFrom(n.url),
    }));
}

/** A plain file's CDN URL, once Shopify has it (usually a second or two). */
async function plainFileReady(
  admin: any,
  id: string,
  filename: string,
): Promise<UploadResult> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 300 : 600));
    const res = await admin.graphql(
      `#graphql
        query PlainFileReady($id: ID!) {
          node(id: $id) {
            ... on GenericFile { fileStatus alt url }
          }
        }`,
      { variables: { id } },
    );
    const node = (await res.json())?.data?.node;
    if (node?.fileStatus === "FAILED") {
      return { ok: false, error: "Shopify couldn’t store that video." };
    }
    if (node?.url) {
      return {
        ok: true,
        item: { id, url: node.url, thumb: "", alt: node.alt ?? "", name: filename },
      };
    }
  }
  return { ok: false, error: "Shopify is still storing the video. Try choosing it again in a moment." };
}
