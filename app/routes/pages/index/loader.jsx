import prisma from "../../../db.server";
import { authenticate } from "../../../shopify.server";
import { json, redirect } from "@remix-run/node";
import { verifyShopPlan } from "../../../utils/planSync.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  // Confirm the stored plan against Shopify billing before anything reads it.
  await verifyShopPlan(admin, session.shop);
  try {
    const [user, allPlans] = await Promise.all([
      prisma.Users.findMany({ where: { shop: session.shop } }),
      // The plan catalogue: this page enforces the player limit, so it needs
      // the same numbers the dashboard displays.
      prisma.plans.findMany({ orderBy: { price: "asc" } }),
    ]);
    // Step 1: Get the theme ID and settings_data.json using GraphQL
    let themeId;
    let appBlock = null;

    try {
      const response = await admin.graphql(
        `#graphql
        query getThemeFiles {
          themes(roles: [MAIN], first: 1) {
            nodes {
              id
              files(filenames: ["config/settings_data.json"]) {
                nodes {
                  body {
                    ... on OnlineStoreThemeFileBodyText {
                      content
                    }
                  }
                }
              }
            }
          }
        }`,
      );

      const responseData = await response.json();
      const mainTheme = responseData?.data?.themes?.nodes?.[0];
      themeId = mainTheme?.id;

      const content = mainTheme?.files?.nodes?.[0]?.body?.content;

      if (content) {
        const appBlockVale = JSON.parse(content);
        if (appBlockVale?.current?.blocks) {
          appBlock = Object.values(appBlockVale.current.blocks).find((block) =>
            block?.type?.includes(
              "apps/video-player-by-bplugins/blocks/video_player_by_bplugins_script",
            ),
          );
        }
      }
    } catch (e) {
      console.error("Non-critical GraphQL error fetching theme files:", e);
    }

    try {
      await Promise.all([
        admin.graphql(
          `#graphql
        mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition {
              id
              name
            }
            userErrors {
              field
              message
              code
            }
          }
        }`,
          {
            variables: {
              definition: {
                name: "Select Video",
                namespace: "Video_player",
                key: "custom",
                description: "Add a Video For Product Page.",
                type: "file_reference",
                pin: true,
                ownerType: "PRODUCT",
              },
            },
          },
        ),
        admin.graphql(
          `#graphql
        mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition {
              id
              name
            }
            userErrors {
              field
              message
              code
            }
          }
        }`,
          {
            variables: {
              definition: {
                name: "Select Video Poster",
                namespace: "video_poster",
                key: "custom",
                description: "Input a Video Poster.",
                type: "file_reference",
                pin: true,
                ownerType: "PRODUCT",
              },
            },
          },
        ),
      ]);
    } catch (error) {
      // Creating these is a first-visit side effect, not something this page
      // needs in order to render. It used to rethrow, so one throttled or
      // failed mutation took the whole app down on every subsequent load.
      console.error("Non-critical error ensuring metafield definitions:", error);
    }

    const charge = await prisma.Charges.findMany({
      where: { shop: session.shop },
    });

    const url = new URL(request.url);
    // Bounded: 0, negative or non-numeric pages used to produce a negative/NaN
    // skip and a 500.
    const page = Math.min(
      Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1),
      10000,
    );
    const search = url.searchParams.get("search")?.trim() || "";
    const videoTypes = (url.searchParams.get("videoType") || "")
      .split(",")
      .filter(Boolean);
    const sort = url.searchParams.get("sort") || "newest";
    const limit = 10;
    const skip = (page - 1) * limit;

    const videoWhere = {
      shop: session.shop,
      ...(search && { title: { contains: search, mode: "insensitive" } }),
      ...(videoTypes.length > 0 && { videoType: { in: videoTypes } }),
    };

    // Title sorting must go through aggregateRaw: Prisma orderBy on MongoDB is
    // case-sensitive (all uppercase titles would sort before any lowercase
    // ones), and only the raw aggregate command accepts a collation.
    async function findVideosSortedByTitle(direction) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const raw = await prisma.video.aggregateRaw({
        pipeline: [
          {
            $match: {
              shop: session.shop,
              ...(search && {
                title: { $regex: escapedSearch, $options: "i" },
              }),
              ...(videoTypes.length > 0 && {
                videoType: { $in: videoTypes },
              }),
            },
          },
          { $sort: { title: direction, _id: 1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { title: 1, url: 1, shop: 1, videoType: 1 } },
        ],
        options: { collation: { locale: "en", strength: 2 } },
      });
      return raw.map((doc) => ({
        id: doc._id?.$oid || String(doc._id),
        title: doc.title,
        url: doc.url,
        shop: doc.shop,
        videoType: doc.videoType,
      }));
    }

    const findVideosSortedByDate = (direction) =>
      prisma.video.findMany({
        where: videoWhere,
        select: {
          id: true,
          title: true,
          url: true,
          shop: true,
          videoType: true,
        },
        // id tiebreak keeps pages stable when rows share the same createdAt
        orderBy: [{ createdAt: direction }, { id: direction }],
        take: limit,
        skip: skip,
      });

    const [video, totalVideos, totalAllVideos] = await Promise.all([
      sort === "title-asc"
        ? findVideosSortedByTitle(1)
        : sort === "title-desc"
          ? findVideosSortedByTitle(-1)
          : findVideosSortedByDate(sort === "oldest" ? "asc" : "desc"),
      prisma.video.count({
        where: videoWhere,
      }),
      // Unfiltered count for the plan-limit check, so an active search/filter
      // can't make the shop look like it has fewer players than it does
      prisma.video.count({
        where: { shop: session.shop },
      }),
    ]);

    if (totalVideos > 0 && skip >= totalVideos) {
      const lastValidPage = Math.max(1, Math.ceil(totalVideos / limit));
      url.searchParams.set("page", lastValidPage);
      return redirect(url.pathname + url.search);
    }

    const paginationInfo = {
      hasNextPage: skip + limit < totalVideos,
      hasPreviousPage: page > 1,
      page,
      totalVideos,
    };

    // Helper function to fetch files
    async function fetchFilesByMediaType(mediaType) {
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

    // Fetch videos and images in parallel
    const [videoFiles, imageFiles] = await Promise.all([
      fetchFilesByMediaType("media_type:Video OR media_type:ExternalVideo"),
      fetchFilesByMediaType("media_type:Image"),
    ]);

    return json({
      appEmbed: appBlock ? (appBlock?.disabled ? true : false) : true,
      videos: video,
      totalAllVideos,
      paginationInfo,
      user: user[0],
      allPlans: allPlans || [],
      shop: session.shop,
      allFiles: [...videoFiles?.files, ...imageFiles?.files],
      themeId,
      // result: result?.data,
      apiKey: process.env.SHOPIFY_API_KEY,
      result: "",
      videoFiles: videoFiles?.files,
      imageFiles: imageFiles?.files,
      pageInfoVideo: videoFiles?.pageInfo,
      pageInfoImage: imageFiles?.pageInfo,
    });
  } catch (error) {
    console.error("Error fetching Audios Loading:", error);
    throw error;
  }
};
