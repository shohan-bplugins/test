import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

export type FileItem = {
  id: string;
  url: string;
  name: string;
  size: number | null;
  createdAt: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";

  const filterQuery = [
    "media_type:GENERIC_FILE",
    query.trim() ? `filename:*${query.trim().replace(/[*?"]/g, "")}*` : null,
  ]
    .filter(Boolean)
    .join(" ");

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
                preview { image { url } }
              }
            }
          }
        }
      }`,
    { variables: { q: filterQuery, first: 100 } },
  );

  const json = await res.json();
  const edges = json?.data?.files?.edges ?? [];

  const files: FileItem[] = edges
    .map((e: any) => {
      const node = e.node ?? {};
      const fileUrl: string | null = node.url ?? null;
      if (!fileUrl) return null;
      const lower = fileUrl.toLowerCase();
      const name = decodeURIComponent(
        fileUrl.split("?")[0]?.split("/").pop() ?? "(unnamed)",
      );
      if (!lower.includes(".glb") && !lower.includes(".gltf")) return null;
      return {
        id: node.id,
        url: fileUrl,
        name,
        size: node.originalFileSize ?? null,
        createdAt: node.createdAt ?? "",
      } satisfies FileItem;
    })
    .filter(Boolean);

  return { files };
};
