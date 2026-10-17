import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { hotspotsAllowed } from "~/lib/hotspots.server";

/*
 * Images and videos from the store's Shopify Files, for hotspot cards — and
 * image upload into Files. Used by components/MediaPickerModal.tsx.
 *
 *   GET  ?type=image|video&q=…   newest first, 40 at a time
 *   POST multipart "file"        an image, up to 10MB → its CDN URL
 *
 * Uploads go to Shopify Files (stagedUploadsCreate → fileCreate), so the
 * image is served from Shopify's CDN and listed in the merchant's Files like
 * any other — this app stores only the URL.
 */

export type MediaItem = {
  id: string;
  /** The URL to store: the image itself, or the video's playable source. */
  url: string;
  /** A small preview for the picker grid. */
  thumb: string;
  alt: string;
  name: string;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const nameFrom = (url: string) =>
  decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const type = params.get("type") === "video" ? "VIDEO" : "IMAGE";
  const q = (params.get("q") ?? "").trim().replace(/[*?"]/g, "");
  const query = [`media_type:${type}`, q ? `filename:*${q}*` : ""]
    .filter(Boolean)
    .join(" ");

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
              preview { image { url(transform: { maxWidth: 200, maxHeight: 200 }) } }
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
      // The mp4 source plays everywhere; HLS (m3u8) would need a player.
      const mp4 = (n.sources ?? []).find(
        (s: any) => s.mimeType === "video/mp4",
      );
      return mp4
        ? {
            id: n.id,
            url: mp4.url,
            thumb: n.preview?.image?.url ?? "",
            alt: n.alt ?? "",
            name: nameFrom(mp4.url),
          }
        : null;
    })
    .filter((x): x is MediaItem => x !== null);

  // Labelled, so the picker can tell an image list from a video list and
  // never shows one while the other is loading.
  return {
    type: type === "IMAGE" ? ("image" as const) : ("video" as const),
    items,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Hotspot media is part of a paid feature; uploading into a store's Files
  // is not something a Free store reaches through this route.
  if (!(await hotspotsAllowed(admin, session?.shop ?? ""))) {
    return { ok: false, error: "Hotspots are available on paid plans." };
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image to upload." };
  }
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
    return { ok: false, error: "Use a PNG, JPG, WebP or GIF image." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Images can be up to 10 MB." };
  }

  const staged = await admin.graphql(
    `#graphql
      mutation StageImage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { message }
        }
      }`,
    {
      variables: {
        input: [
          {
            filename: file.name,
            mimeType: file.type,
            resource: "IMAGE",
            fileSize: String(file.size),
            httpMethod: "POST",
          },
        ],
      },
    },
  );
  const target = (await staged.json())?.data?.stagedUploadsCreate
    ?.stagedTargets?.[0];
  if (!target) return { ok: false, error: "Shopify didn’t accept the upload." };

  const body = new FormData();
  for (const p of target.parameters) body.append(p.name, p.value);
  body.append("file", file);
  const uploaded = await fetch(target.url, { method: "POST", body });
  if (!uploaded.ok)
    return { ok: false, error: "The upload to Shopify failed." };

  const created = await admin.graphql(
    `#graphql
      mutation CreateImage($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id }
          userErrors { message }
        }
      }`,
    {
      variables: {
        files: [
          {
            originalSource: target.resourceUrl,
            contentType: "IMAGE",
            alt: file.name.replace(/\.[^.]+$/, ""),
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
          name: file.name,
        } satisfies MediaItem,
      };
    }
  }
  return {
    ok: false,
    error:
      "The image is still processing in Shopify Files. Try choosing it again in a moment.",
  };
};
