import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Generous server-side bounds; the upload modals enforce tighter limits
// (18 MB audio, 20 MB image) before ever calling this route.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPE = /^(audio|image|video)\//i;

/**
 * POST  { name, type, size }  →  { stagedUpload: { url, resourceUrl, parameters } }
 * PUT   { name, type, resourceUrl }  →  { fileUrl, fileId }
 */
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const body = await request.formData();

  const rawName = body.get("name");
  const type = body.get("type");

  if (request.method === "POST" || request.method === "PUT") {
    if (typeof rawName !== "string" || !rawName.trim()) {
      return json({ error: "Invalid file name." }, { status: 400 });
    }
    if (typeof type !== "string" || !ALLOWED_UPLOAD_TYPE.test(type)) {
      return json({ error: "Unsupported file type." }, { status: 400 });
    }
  }
  const name = typeof rawName === "string" ? rawName.slice(0, 255) : rawName;

  if (request.method === "POST") {
    const size = Number(body.get("size"));
    if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
      return json({ error: "Invalid file size." }, { status: 400 });
    }
    const topLevel = type?.split("/")[0]?.toUpperCase();
    const resource = topLevel === "AUDIO" ? "FILE" : topLevel ?? "FILE";

    const response = await admin.graphql(
      `#graphql
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
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
          input: [{ filename: name, mimeType: type, httpMethod: "POST", resource, fileSize: String(size) }],
        },
      },
    );

    const result = await response.json();
    const stagedUpload = result?.data?.stagedUploadsCreate?.stagedTargets?.[0];

    if (!stagedUpload) {
      return json({ error: "Failed to create staged upload" }, { status: 500 });
    }

    return json({ stagedUpload });
  }

  if (request.method === "PUT") {
    const resourceUrl = body.get("resourceUrl");
    const topLevel = type?.split("/")[0]?.toUpperCase();
    const contentType = topLevel === "AUDIO" ? "FILE" : topLevel ?? "FILE";

    const createResponse = await admin.graphql(
      `#graphql
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
            ... on GenericFile { id url }
            ... on MediaImage { id preview { image { url } } }
          }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          files: { alt: name, contentType, originalSource: resourceUrl },
        },
      },
    );

    const createResult = await createResponse.json();
    const createdFile = createResult?.data?.fileCreate?.files?.[0];

    if (!createdFile) {
      return json({ error: "Failed to create file" }, { status: 500 });
    }

    // Poll for the URL (file processing can take a moment)
    let fileUrl = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((r) => setTimeout(r, 1200));
      const pollResponse = await admin.graphql(
        `query GetFile($id: ID!) {
          node(id: $id) {
            ... on GenericFile { id url }
            ... on MediaImage { id preview { image { url } } }
          }
        }`,
        { variables: { id: createdFile.id } },
      );
      const pollResult = await pollResponse.json();
      const node = pollResult?.data?.node;
      fileUrl = node?.url || node?.preview?.image?.url;
      if (fileUrl) break;
    }

    return json({ fileUrl, fileId: createdFile.id });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
};
