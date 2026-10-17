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

  let fileUrl: string | null = node.url ?? null;
  for (let attempt = 0; !fileUrl && attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    fileUrl = await resolveFileUrl(admin, node.id);
  }

  return { ok: true, fileGid: node.id, fileUrl };
}

/** A file's address and, where Shopify reports one, its size in bytes. */
export type ResolvedFile = { url: string; size: number | null };

/**
 * Like `resolveFileUrl`, but also returns the byte size.
 *
 * Shopify reports the size under a different field per file type —
 * `originalFileSize` on a GenericFile, `filesize` on each source of a Model3d —
 * so both are asked for and the first that answers wins, matching how
 * routes/api.files.tsx reads it for the picker.
 *
 * This exists because a model added from Shopify Files used to be stored with
 * no size at all: only the upload path knew one, from the File object in the
 * browser. Every model imported through "Choose from Files" therefore showed a
 * dash in the library's Size column forever.
 */
export async function resolveFile(
  admin: any,
  fileGid: string,
): Promise<ResolvedFile | null> {
  try {
    const res = await admin.graphql(
      `#graphql
        query FileWithSizeById($id: ID!) {
          node(id: $id) {
            ... on GenericFile { url originalFileSize }
            ... on MediaImage { image { url } }
            ... on Model3d {
              originalSource { url filesize }
              sources { url format filesize }
            }
          }
        }`,
      { variables: { id: fileGid } },
    );
    const json: any = await res.json();
    const node: any = json?.data?.node;
    if (!node) return null;

    const sources: any[] = Array.isArray(node.sources) ? node.sources : [];
    const glb = sources.find((s: any) =>
      (s?.url ?? "").toLowerCase().includes(".glb"),
    );
    const url: string | null =
      node.url ??
      node.image?.url ??
      node.originalSource?.url ??
      glb?.url ??
      sources[0]?.url ??
      null;
    if (!url) return null;

    const raw =
      node.originalFileSize ??
      node.originalSource?.filesize ??
      glb?.filesize ??
      sources[0]?.filesize ??
      null;
    const size =
      typeof raw === "number" ? raw : raw ? Number(raw) || null : null;

    return { url, size };
  } catch {
    return null;
  }
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
            ... on Model3d {
              originalSource { url }
              sources { url format }
            }
          }
        }`,
      { variables: { id: fileGid } },
    );
    const json: any = await res.json();
    const node: any = json?.data?.node;
    if (!node) return null;
    if (node.url) return node.url;
    if (node.image?.url) return node.image.url;
    if (node.originalSource?.url) return node.originalSource.url;
    if (Array.isArray(node.sources)) {
      const glb = node.sources.find((s: any) =>
        (s?.url ?? "").toLowerCase().includes(".glb"),
      );
      return glb?.url ?? node.sources[0]?.url ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export { isValidModelFilename } from "./files";
