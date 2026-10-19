import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Reuse the Videos page's create/staged-upload/fileCreate/poll/pagination action
// verbatim. It is route-agnostic, so the inline player creator on the product
// page can POST/PUT here exactly like the Videos page does.
export { action } from "./pages/index/action";

// Lean loader: only the Shopify file library the media pickers need. We
// deliberately skip the theme/settings/users work the Videos loader does so
// opening the inline modal stays fast.
async function fetchFilesByMediaType(admin, mediaType) {
  const query = `
    #graphql
    query FetchFiles {
      files(reverse: true, first: 50, query:"${mediaType}") {
        edges {
          node {
            id
            alt
            createdAt
            preview {
              image {
                url(transform: {})
                src
              }
            }
            ... on GenericFile {
              id
              url
              mimeType
              alt
              originalFileSize
            }
            ... on MediaImage {
              id
              preview {
                image {
                  src
                }
              }
              mediaContentType
            }
            ... on ExternalVideo {
              id
              alt
              createdAt
              embedUrl
              embeddedUrl
              host
              mediaContentType
              originUrl
            }
            ... on Video {
              id
              mediaContentType
              sources {
                fileSize
                url
              }
              preview {
                image {
                  src
                }
              }
              sources {
                fileSize
                format
                mimeType
                url
              }
              filename
              originalSource {
                fileSize
                mimeType
              }
            }
          }
        }
        pageInfo {
          hasPreviousPage
          hasNextPage
          endCursor
          startCursor
        }
      }
    }
  `;

  const response = await admin.graphql(query);
  const result = await response.json();
  return {
    files: result?.data?.files?.edges || [],
    pageInfo: result?.data?.files?.pageInfo,
  };
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const [videoFiles, imageFiles] = await Promise.all([
    fetchFilesByMediaType(admin, "media_type:Video OR media_type:ExternalVideo"),
    fetchFilesByMediaType(admin, "media_type:Image"),
  ]);

  return json({
    videoFiles: videoFiles?.files,
    imageFiles: imageFiles?.files,
    pageInfoVideo: videoFiles?.pageInfo,
    pageInfoImage: imageFiles?.pageInfo,
  });
};
