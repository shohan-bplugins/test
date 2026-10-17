import prisma from "../../../db.server";
import { authenticate } from "../../../shopify.server";
import { json, redirect } from "@remix-run/node";
import {
  cssValue,
  parseSettings,
  safeUrl,
  sanitizeSettings,
  validateUpload,
} from "../../../utils/sanitize";
import { resolvePlan, planUsage } from "../../../utils/planLimits";
import { verifyShopPlan } from "../../../utils/planSync.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const method = request.method;

  // Helper function to fetch files (Lifted to top scope with pagination support)
  async function fetchFilesByMediaType(mediaType, cursor = null, direction = "after") {
    // Cursors are opaque base64 tokens from Shopify; anything else is dropped
    // so a forged value cannot rewrite the query it is spliced into.
    const safeCursor = String(cursor || "").replace(/[^A-Za-z0-9+/=_-]/g, "");
    const paginationArg = safeCursor ? `, ${direction}: "${safeCursor}"` : "";
    const firstLast = direction === "before" ? "last: 50" : "first: 50";

    const query = `
    #graphql
    query FetchFiles {
      files(reverse: true, ${firstLast}, query:"${mediaType}"${paginationArg}) {
        edges {
          node {
            id
            alt
            fileStatus
            createdAt
            preview {
              image {
                url(transform: {})
                src
              }
            }
            ... on GenericFile {
              id
              fileStatus
              url
              mimeType
              alt
              originalFileSize
            }
            ... on MediaImage {
              id
              fileStatus
              preview {
                image {
                  src
                }
              }
              mediaContentType
            }
            ... on ExternalVideo {
              id
              fileStatus
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
              fileStatus
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

  // Handle Deletion first for performance and reliability
  const url = new URL(request.url);
  const intent = formData.get("intent") || url.searchParams.get("intent");
  const shop = session.shop || session?.shop || url.searchParams.get("shop");

  if (method === "DELETE" || intent === "delete") {
    const videoListRaw = formData.get("videoList") || url.searchParams.get("videoList");
    const singleId = formData.get("data") || url.searchParams.get("data");

    console.log("Delete Action Triggered:", { videoListRaw, singleId, intent, shop });

    try {
      if (videoListRaw) {
        const videoIds = JSON.parse(videoListRaw);
        if (Array.isArray(videoIds) && videoIds.length > 0) {
          // Delete associated analytics first
          await prisma.videoPlay.deleteMany({
            where: {
              videoId: { in: videoIds },
              shop: shop
            },
          });
          
          await prisma.Video.deleteMany({
            where: { 
              id: { in: videoIds },
              shop: shop
            },
          });
        }
      } else if (singleId) {
        // Delete associated analytics first
        await prisma.videoPlay.deleteMany({
          where: {
            videoId: singleId,
            shop: shop
          },
        });
        
        await prisma.Video.deleteMany({
          where: { 
            id: singleId,
            shop: shop
          },
        });
      }
    } catch (error) {
      console.error("Deletion Error:", error);
    }
  }

  // Fall through to fetch files (Previous version style)
  // Removed early return that was blocking player creation


  const file = formData.get("file");

  try {
    let stagedUpload;
    let allFiles;
    let videoFiles;
    let imageFiles;
    let pageInfoVideo;
    let pageInfoImage;

    if (formData.get("endCursor")) {
      const [videoFilesData, imageFilesData] = await Promise.all([
        fetchFilesByMediaType(`media_type:Video OR media_type:ExternalVideo`, formData.get("endCursor"), "after"),
        fetchFilesByMediaType(`media_type:Image`, formData.get("endCursor"), "after")
      ]);

      return json({
        allFiles: [...videoFilesData?.files, ...imageFilesData?.files],
        videoFiles: videoFilesData?.files,
        imageFiles: imageFilesData?.files,
        pageInfoVideo: videoFilesData?.pageInfo,
        pageInfoImage: imageFilesData?.pageInfo,
      });
    } else if (formData.get("startCursor")) {
      const [videoFilesData, imageFilesData] = await Promise.all([
        fetchFilesByMediaType(`media_type:Video OR media_type:ExternalVideo`, formData.get("startCursor"), "before"),
        fetchFilesByMediaType(`media_type:Image`, formData.get("startCursor"), "before")
      ]);

      return json({
        allFiles: [...videoFilesData?.files, ...imageFilesData?.files],
        videoFiles: videoFilesData?.files,
        imageFiles: imageFilesData?.files,
        pageInfoVideo: videoFilesData?.pageInfo,
        pageInfoImage: imageFilesData?.pageInfo,
      });
    } else {
      const [videoFilesData, imageFilesData] = await Promise.all([
        fetchFilesByMediaType("media_type:Video OR media_type:ExternalVideo"),
        fetchFilesByMediaType("media_type:Image")
      ]);

      allFiles = [...videoFilesData?.files, ...imageFilesData?.files];
      videoFiles = videoFilesData?.files;
      imageFiles = imageFilesData?.files;
      pageInfoVideo = videoFilesData?.pageInfo;
      pageInfoImage = imageFilesData?.pageInfo;
    }

    if (request.method === "POST") {
      if (formData.get("id")) {
        // Player limit, enforced here as well as in the browser (which can be
        // bypassed by posting directly). Same plan resolution and counting as
        // the videos page: the shop's verified plan vs. all of its players.
        await verifyShopPlan(admin, session.shop);
        const [limitUser, limitPlans, playerCount] = await Promise.all([
          prisma.users.findUnique({ where: { shop: session.shop } }),
          prisma.plans.findMany({ orderBy: { price: "asc" } }),
          prisma.video.count({ where: { shop: session.shop } }),
        ]);
        const usage = planUsage(
          playerCount,
          resolvePlan({ plans: limitPlans, user: limitUser }),
        );
        if (usage.atLimit) {
          return json(
            {
              error: `You've reached your plan's limit of ${usage.max} players. Upgrade your plan to create more.`,
              limitReached: true,
            },
            { status: 403 },
          );
        }

        // Determine player type and build data payload
        const playerType =
          formData.get("playerType") === "multiple" ? "multiple" : "single";
        let dataPayload = { playerType };

        // Client JSON is parsed and sanitised (tags stripped, non-http(s) URLs
        // dropped, CSS/enum values defanged) before it is stored.
        if (playerType === "multiple") {
          const items = parseSettings(formData.get("items"), null);
          dataPayload.items = Array.isArray(items)
            ? items
            : [{ video: "", poster: "" }];

          const rawGrid = formData.get("gridSettings");
          dataPayload.gridSettings = rawGrid ? parseSettings(rawGrid) : {
            viewMode: "grid",
            columns: { desktop: 3, tablet: 2, mobile: 1 },
            gap: 16,
          };
        }

        const rawStyles = formData.get("styles");
        const parsedStyles = rawStyles ? parseSettings(rawStyles) : {
          width: "100%",
          borderRadius: "5px",
          brandColor: "#1a8d5a",
        };

        const rawControls = formData.get("controls");
        const parsedControls = rawControls ? parseSettings(rawControls) : (
          playerType == "single" ? {
            playLarge: true,
            restart: false,
            rewind: false,
            play: true,
            fastForward: false,
            progress: true,
            currentTime: true,
            duration: true,
            muted: true,
            volume: true,
            pip: true,
            airplay: true,
            settings: true,
            download: false,
            fullscreen: true,
          } : {
            playLarge: true,
            restart: false,
            rewind: false,
            play: true,
            fastForward: false,
            progress: true,
            currentTime: false,
            duration: true,
            muted: true,
            volume: false,
            pip: false,
            airplay: true,
            settings: true,
            download: false,
            fullscreen: true,
          }
        );

        const rawOptions = formData.get("options");
        const parsedOptions = rawOptions ? parseSettings(rawOptions) : {
          muted: false,
          autoHideControls: true,
        };

        const createVideo = await prisma.video.create({
          data: {
            shop: session.shop,
            title: sanitizeSettings(String(formData.get("title") ?? ""), "title"),
            url: safeUrl(String(formData.get("url") || "")),
            videoType: cssValue(formData.get("videoType") ?? ""),
            vimeo: "",
            youtube: "",
            poster: safeUrl(String(formData.get("poster") || "")),
            resetOnEnd: formData.get("resetOnEnd") === "true",
            autoPlay: formData.get("autoPlay") === "true",
            repeat: formData.get("repeat") === "true",
            controls: parsedControls,
            options: parsedOptions,
            styles: parsedStyles,
            data: dataPayload,
          },
        });

        const audioCount = await prisma.video.findMany({
          where: { shop: session.shop },
        });

        const accessToken = session.accessToken;

        const responseShopData = await fetch(
          `https://${session.shop}/admin/api/2026-07/shop.json`,
          {
            method: "GET",
            headers: {
              "X-Shopify-Access-Token": accessToken,
              "Content-Type": "application/json",
            },
          },
        );

        if (!responseShopData.ok) {
          const errorText = await responseShopData.text();
          console.error("Shopify Error:", errorText);
          throw new Error(`Failed: ${responseShopData.status}`);
        }

        const shopDataFromApi = await responseShopData.json();

        fetch(
          "https://integrations-api.swipeone.com/webhooks/apps/generic-webhooks/68f1d267d1a678d9726d5287",
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify([
              {
                type: `app.created_player_${Number(audioCount?.length) || 1}`,
                app_name: "video-player",
                app_full_name: "Video Player by bPlugins",
                app_slug: "video-player-by-bplugins",
                success: true,
                shop: session.shop,
                user_id: session?.id,
                install_id: "",
                data: {
                  name: shopDataFromApi?.shop?.shop_owner || "",
                  email: shopDataFromApi?.shop?.email || "",
                  country_name: shopDataFromApi?.shop?.country_name || "",
                  address1: shopDataFromApi?.shop?.address1 || "",
                  address2: shopDataFromApi?.shop?.address2 || "",
                  phone: shopDataFromApi?.shop?.phone || "",
                  created_at: shopDataFromApi?.shop?.created_at || "",
                  domain:
                    shopDataFromApi?.shop?.domain || session.shop,
                  myshopify_domain:
                    shopDataFromApi?.shop?.myshopify_domain || "",
                  plan_display_name:
                    shopDataFromApi?.shop?.plan_display_name || "",
                },
                id: session?.id,
                created: new Date()
                  .toISOString()
                  .slice(0, 19)
                  .replace("T", " "),
                objects: {
                  user: {
                    email: shopDataFromApi?.shop?.email,
                  },
                },
              },
            ]),
          },
        );

        if (formData.get("preventRedirect") === "true") {
          return json({ id: createVideo?.id });
        }
        return redirect(`/app/customize/${createVideo?.id}`);
      } else {
        // A POST with no file metadata isn't an upload — just hand back the
        // file lists, as before (the staged upload used to come back empty).
        if (!formData.get("name") && !formData.get("type") && !formData.get("size")) {
          return json({ stagedUpload: undefined, allFiles, videoFiles, imageFiles, pageInfoImage, pageInfoVideo });
        }

        // The browser's type/size checks can be bypassed; repeat them here.
        const upload = validateUpload({
          name: formData.get("name"),
          type: formData.get("type"),
          size: formData.get("size"),
        });
        if (!upload.ok) return json({ error: upload.error }, { status: 400 });

        // Step 1: Create a staged upload
        const response = await admin.graphql(
          `#graphql
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets {
               url
               resourceUrl
              parameters {
                 name
               value
              }
            }
           }
         }`,
          {
            variables: {
              input: [
                {
                  filename: upload.name,
                  mimeType: upload.type,
                  httpMethod: "POST",
                  resource:
                    upload.type.split("/")[0].toUpperCase() ===
                    "AUDIO"
                      ? "FILE"
                      : upload.type.split("/")[0].toUpperCase(),
                  fileSize: upload.size,
                },
              ],
            },
          },
        );

        const stagedUploadResult = await response.json();

        stagedUpload =
          stagedUploadResult?.data?.stagedUploadsCreate?.stagedTargets?.[0];

        return json({
          stagedUpload,
          allFiles,
          videoFiles: videoFiles,
          imageFiles: imageFiles,
          pageInfoImage,
          pageInfoVideo,
        });
      }
    } else if (request.method === "PUT") {
      if (formData.get("contentType") === "EXTERNAL_VIDEO") {
        const createFileQuery = await admin.graphql(
          `#graphql
            mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
              files {
                id
                fileStatus
              }
              userErrors {
                field
                message
              }
            }
        }
            `,
          {
            variables: {
              files: {
                contentType: "EXTERNAL_VIDEO",
                originalSource: formData.get("originalSource"),
              },
            },
          },
        );
        const createFileResult = await createFileQuery.json();
        return json({
          createFileResult: createFileResult?.data?.fileCreate?.files?.[0],
          allFiles,
          videoFiles: videoFiles,
          imageFiles: imageFiles,
          pageInfoImage,
          pageInfoVideo,
        });
      } else if (formData.get("ids")) {
        const status = await admin.graphql(
          `
           query FileStatusPoll($ids: [ID!]!) {
              nodes(ids: $ids) {
                __typename
                ... on Node {
                  id
                  __typename
                }
                ... on File {
                  alt
                  fileStatus
                  fileErrors {
                    code
                    __typename
                  }
                  __typename
                }
                ... on GenericFile {
                  id
                  originalFileSize
                  url
                  __typename
                }
                ... on MediaImage {
                  id
                  image {
                    id
                    thumbnail: url(transform: {maxWidth: 150})
                    preview: url(transform: {maxWidth: 430})
                    original: url
                    width
                    height
                    __typename
                  }
                  __typename
                }
                ...VideoFragment
              }
            }

            fragment VideoFragment on Video {
              id
              alt
              duration
              originalSource {
                url
                width
                height
                format
                mimeType
                __typename
              }
              sources {
                url
                width
                height
                format
                mimeType
                __typename
              }
              ...FilePreviewFragment
              __typename
            }

            fragment FilePreviewFragment on File {
              preview {
                status
                image {
                  id
                  width
                  height
                  url
                  transformedSrc: url(transform: {maxWidth: 200, maxHeight: 200})
                  __typename
                }
                __typename
              }
              __typename
            }


            `,
          {
            variables: {
              ids: [formData.get("ids")],
            },
          },
        );
        const statusResult = await status.json();

        return json({
          status: statusResult?.data?.nodes,
          errors: statusResult?.data?.nodes[0]?.fileErrors,
          id: formData.get("ids"),
          allFiles,
          videoFiles: videoFiles,
          imageFiles: imageFiles,
          pageInfoImage,
          pageInfoVideo,
        });
      } else {
        // Step 3: Create the file record in Shopify

        const createFileQuery = await admin.graphql(
          `#graphql
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
              fileStatus
            }
            userErrors {
              field
              message
            }
          }
        }`,
          {
            variables: {
              files: [
                {
                  alt: formData.get("name"),
                  contentType:
                    formData.get("type")?.split("/")[0].toUpperCase() ===
                    "AUDIO"
                      ? "FILE"
                      : formData.get("type")?.split("/")[0].toUpperCase(),
                  originalSource: formData.get("resourceUrl"),
                },
              ],
            },
          },
        );

        // Log the entire response

        const createFileResult = await createFileQuery.json();

        // // const createFileResult = await makeGraphQLRequest(createFileQuery, createFileVariables);
        const uploadedFile = createFileResult?.fileCreate?.files[0];
        return json({
          id: uploadedFile?.id,
          name: uploadedFile?.filename,
          url: uploadedFile?.url,
          size: uploadedFile?.originalFileSize,
          type: file?.type,
          createFileResult: createFileResult?.data?.fileCreate?.files?.[0],
          allFiles,
          videoFiles: videoFiles,
          imageFiles: imageFiles,
          pageInfoImage,
          pageInfoVideo,
        });
      }
    }

    return json({
      stagedUpload,
      allFiles,
      videoFiles,
      imageFiles,
      pageInfoImage,
      pageInfoVideo,
    });
  } catch (error) {
    console.error("Action Error:", error);
    return json({ error: error.message }, { status: 500 });
  }
};
