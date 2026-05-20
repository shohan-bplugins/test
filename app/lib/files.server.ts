export type StagedTarget = { url: string; resourceUrl: string };

export async function stagedUploadAndCreate(
  admin: any,
  file: File,
  alt: string,
): Promise<
  | { ok: true; fileGid: string; fileUrl: string | null }
  | { ok: false; error: string }
> {
  const stagedRes = await admin.graphql(
    `#graphql
      mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters { name value }
          }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        input: [
          {
            filename: file.name,
            mimeType: file.type || "model/gltf-binary",
            resource: "FILE",
            fileSize: String(file.size),
            httpMethod: "POST",
          },
        ],
      },
    },
  );
  const stagedJson: any = await stagedRes.json();
  const target = stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) return { ok: false, error: "Failed to create staged upload" };

  const fd = new FormData();
  for (const p of target.parameters) fd.append(p.name, p.value);
  fd.append("file", file);

  const uploadRes = await fetch(target.url, { method: "POST", body: fd });
  if (!uploadRes.ok) {
    return { ok: false, error: "Upload to Shopify Files failed" };
  }

  const fileCreateRes = await admin.graphql(
    `#graphql
      mutation FileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            ... on GenericFile { url }
          }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        files: [
          {
            originalSource: target.resourceUrl,
            contentType: "FILE",
            alt,
          },
        ],
      },
    },
  );
  const fileJson: any = await fileCreateRes.json();
  const errs = fileJson?.data?.fileCreate?.userErrors ?? [];
  if (errs.length) {
    return {
      ok: false,
      error: errs.map((e: any) => e.message).join("; "),
    };
  }
  const node = fileJson?.data?.fileCreate?.files?.[0];
  if (!node?.id) {
    return { ok: false, error: "Shopify did not return a file id" };
  }
  return { ok: true, fileGid: node.id, fileUrl: node.url ?? null };
}

export async function resolveFileUrl(
  admin: any,
  fileGid: string,
): Promise<string | null> {
  try {
    const res = await admin.graphql(
      `#graphql
        query FileById($id: ID!) {
          node(id: $id) {
            ... on GenericFile { url }
            ... on MediaImage { image { url } }
          }
        }`,
      { variables: { id: fileGid } },
    );
    const json: any = await res.json();
    const node = json?.data?.node;
    return node?.url ?? node?.image?.url ?? null;
  } catch {
    return null;
  }
}

export { isValidModelFilename } from "./files";
