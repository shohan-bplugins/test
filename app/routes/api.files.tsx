import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { getAssignedModelGids } from "~/lib/billing.server";
import { isValidModelFilename } from "~/lib/files";

export type FileItem = {
  id: string;
  url: string;
  name: string;
  size: number | null;
  createdAt: string;
  /**
   * The product already using this file as its 3D model, if any. A model
   * belongs to one product, so the picker offers these as unavailable.
   */
  assignedTo: { id: string; title: string } | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  // The product doing the asking: its own file is not "taken" from its view.
  const ownProductId = url.searchParams.get("productId");
  const ownProductGid = ownProductId
    ? ownProductId.startsWith("gid://")
      ? ownProductId
      : `gid://shopify/Product/${ownProductId}`
    : null;

  const filterQuery = query.trim()
    ? `filename:*${query.trim().replace(/[*?"]/g, "")}*`
    : "";

  const res = await admin.graphql(
    `#graphql
      query Files($q: String!, $first: Int!) {
        files(first: $first, query: $q, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              createdAt
              ... on GenericFile {
                url
                originalFileSize
                mimeType
                alt
                fileStatus
              }
              ... on Model3d {
                originalSource { url format filesize mimeType }
                sources { url format filesize mimeType }
                alt
                fileStatus
              }
            }
          }
        }
      }`,
    { variables: { q: filterQuery, first: 100 } },
  );

  const assigned = await getAssignedModelGids(admin, session?.shop ?? "");
  const json = await res.json();
  const edges = json?.data?.files?.edges ?? [];

  const files: FileItem[] = edges
    .map((e: any) => {
      const node = e.node ?? {};
      const glbSource =
        node.originalSource?.url ||
        (Array.isArray(node.sources)
          ? node.sources.find((s: any) =>
              (s?.url ?? "").toLowerCase().includes(".glb"),
            )?.url ?? node.sources[0]?.url
          : null);
      const fileUrl: string | null = node.url ?? glbSource ?? null;
      if (!fileUrl) return null;
      const name = decodeURIComponent(
        fileUrl.split("?")[0]?.split("/").pop() ?? "(unnamed)",
      );
      if (!isValidModelFilename(fileUrl.split("?")[0] ?? fileUrl)) return null;
      const size =
        node.originalFileSize ??
        node.originalSource?.filesize ??
        (Array.isArray(node.sources) ? node.sources[0]?.filesize : null) ??
        null;
      const owner =
        (assigned.owners.get(node.id) ?? []).find(
          (p) => p.id !== ownProductGid,
        ) ?? null;
      return {
        id: node.id,
        url: fileUrl,
        name,
        size: typeof size === "number" ? size : size ? Number(size) : null,
        createdAt: node.createdAt ?? "",
        assignedTo: owner,
      } satisfies FileItem;
    })
    .filter(Boolean);

  return { files };
};
