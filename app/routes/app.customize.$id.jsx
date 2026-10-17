import {
  json,
  Link,
  NavLink,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import { useGoBack } from "../utils/useGoBack";
import { detectVideoCodec } from "../utils/videoCodec.client";
import {
  cssValue,
  escapeHtml,
  parseSettings,
  safeUrl,
  sanitizeSettings,
  sanitizeVideoRecord,
  validateUpload,
} from "../utils/sanitize";
import { verifyShopPlan } from "../utils/planSync.server";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import {
  NoteIcon,
  DragHandleIcon,
  ListBulletedIcon,
  GlobeIcon,
  LayoutBlockIcon,
  ShieldCheckMarkIcon,
  ColorNoneIcon,
  SunIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  ClipboardIcon,
} from "@shopify/polaris-icons";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  DropZone,
  Frame,
  Divider,
  Icon,
  InlineGrid,
  InlineStack,
  LegacyStack,
  Text,
  Thumbnail,
  Toast,
} from "@shopify/polaris";
import stylesUrl from "../styles/styles.css?url";
import plyrUrl from "../styles/plyr.css?url";
import multiVideoUrl from "../styles/MultipleVideoItems.css?url";
import captionsUrl from "../styles/captions.css?url";
import "../components/PageHeader/PageHeader.css";

export const links = () => [
  { rel: "stylesheet", href: stylesUrl },
  { rel: "stylesheet", href: plyrUrl },
  { rel: "stylesheet", href: multiVideoUrl },
  { rel: "stylesheet", href: captionsUrl },
];
import { flag, CustomBox, CustomButton } from "../utils/polarisWebComponents";
import { useAppBridge } from "@shopify/app-bridge-react";
import Collapse, { Accordion } from "../components/Collapse/Collapse";
import TextInput from "../components/TextInput/TextInput";
import UploadField from "../components/UploadField/UploadField";
import { ToggleControl } from "../components/ToggleControl/ToggleControl";
import NumberUnit from "../components/NumberUnit/NumberUnit";
import { authenticate } from "../shopify.server";
import SelectInput from "../components/SelectInput/SelectInput";
import ColorController from "../components/ColorController/ColorController";
import { PrismaClient } from "@prisma/client";
import FileUploadModal from "../components/Mediaaa";
import ImgUploadModal from "../components/MediaImg";
import SpacingGroup from "../components/SpaceingSize/SpacingSize";
import RangeSlider from "../components/RangeSlider/RangeSlider";
import { ClientOnly } from "remix-utils/client-only";
import MobileIcon from "../components/icons/MobileIcon";
import TabletIcon from "../components/icons/TabletIcon";
import DesktopIcon from "../components/icons/DesktopIcon";
import MultipleVideoItems from "../components/MultipleVideoItems/MultipleVideoItems";
import GridSettings from "../components/GridSettings/GridSettings";
import PlyrGridItem from "../components/PlyrGridItem/PlyrGridItem";
import {
  toVtt,
  hasCues,
  guessLangFromFilename,
  languageName,
  CAPTION_LANGUAGE_OPTIONS,
} from "../utils/captions";
import { resolvePlan, isPaidCredits } from "../utils/planLimits";

const prisma = new PrismaClient();

export const loader = async ({ params, request }) => {
  const { admin, session } = await authenticate.admin(request);
  // Confirm the stored plan against Shopify billing before anything reads it.
  await verifyShopPlan(admin, session.shop);
  try {
    // Scoped to the session's shop: player ids are public (they sit in every
    // storefront's HTML), so an id alone must never open another shop's player.
    const stored = await prisma.Video.findFirst({
      where: { id: params.id, shop: session.shop },
    });
    if (!stored) throw new Response("Player not found", { status: 404 });
    // Records saved before input sanitising existed are cleaned on the way out
    // too, so an old payload renders as text in the editor instead of running.
    const video = sanitizeVideoRecord(stored);
    const user = await prisma.Users.findFirst({
      where: { shop: session.shop },
    });
    // Needed so this page gates Pro features on the same resolved plan the
    // dashboard and the players list use, rather than an inlined `> 5`.
    const allPlans = await prisma.plans.findMany({ orderBy: { price: "asc" } });

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
            fileStatus
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

      // 👇 filter out FAILED or PROCESSING items
      let readyFiles =
        result?.data?.files?.edges?.filter(
          (edge) =>
            edge?.node?.fileStatus === "READY" ||
            edge?.node?.fileStatus === "PROCESSING",
        ) || [];

      // Filter GenericFile to only include video mimeTypes
      if (mediaType.includes("GenericFile")) {
        const videoMimeTypes = [
          "video/mp4",
          "video/quicktime",
          "video/webm",
          "video/x-msvideo",
          "video/x-matroska",
          "video/mpeg",
        ];
        readyFiles = readyFiles.filter((edge) => {
          if (edge?.node?.__typename !== "GenericFile") return true;
          return (
            videoMimeTypes.includes(edge?.node?.mimeType) ||
            edge?.node?.mimeType?.startsWith("video/")
          );
        });
      }

      return {
        files: readyFiles,
        pageInfo: result?.data?.files?.pageInfo,
        user,
      };
    }

    // Fetch videos
    const videoFiles = await fetchFilesByMediaType(
      "media_type:Video OR media_type:ExternalVideo OR media_type:GenericFile",
    );

    // Fetch images
    const imageFiles = await fetchFilesByMediaType("media_type:Image");
    return json({
      video,
      id: params.id,
      allFiles: [...videoFiles?.files, ...imageFiles?.files],
      videoFiles: videoFiles?.files,
      imageFiles: imageFiles?.files,
      pageInfoVideo: videoFiles?.pageInfo,
      pageInfoImage: imageFiles?.pageInfo,
      user,
      allPlans: allPlans || [],
    });
  } catch (error) {
    console.error("Error fetching Videos Loading:", error);
    throw error;
  }
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  // Confirm the stored plan against Shopify billing before anything reads it.
  await verifyShopPlan(admin, session.shop);
  const formData = await request.formData();
  const file = formData.get("file");

  let updateUrl;
  let updateVideo;
  let stagedUpload;
  let allFiles;
  let videoFiles;
  let imageFiles;
  let pageInfoVideo;
  let pageInfoImage;
  let user;

  try {
    user = await prisma.users.findFirst({
      where: { shop: session?.shop },
    });
  } catch (error) {
    throw new Error("Error fetching user:", error);
  }

  // Every write below is keyed on the client-supplied id, so make sure that
  // player belongs to this shop before touching it.
  const targetId = formData.get("id");
  if (targetId) {
    const owned = await prisma.video
      .findFirst({ where: { id: String(targetId), shop: session.shop }, select: { id: true } })
      .catch(() => null);
    if (!owned) return json({ error: "Player not found" }, { status: 404 });
  }

  // Pagination cursors are opaque base64 tokens from Shopify; anything else is
  // dropped so it cannot alter the GraphQL query it is spliced into.
  const endCursor = String(formData.get("endCursor") || "").replace(/[^A-Za-z0-9+/=_-]/g, "");
  const startCursor = String(formData.get("startCursor") || "").replace(/[^A-Za-z0-9+/=_-]/g, "");

  if (endCursor) {
    // Helper function to fetch files
    async function fetchFilesByMediaType(mediaType) {
      const query = `
  #graphql
  query FetchFiles {
    files(reverse: true, first: 50, query:"${mediaType}",after:"${endCursor}") {
      edges {
        node {
          id
          alt
          createdAt
          fileStatus
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
      let readyFiles =
        result?.data?.files?.edges?.filter(
          (edge) =>
            edge?.node?.fileStatus === "READY" ||
            edge?.node?.fileStatus === "PROCESSING",
        ) || [];

      if (mediaType.includes("GenericFile")) {
        const videoMimeTypes = [
          "video/mp4",
          "video/quicktime",
          "video/webm",
          "video/x-msvideo",
          "video/x-matroska",
          "video/mpeg",
        ];
        readyFiles = readyFiles.filter((edge) => {
          if (edge?.node?.__typename !== "GenericFile") return true;
          return (
            videoMimeTypes.includes(edge?.node?.mimeType) ||
            edge?.node?.mimeType?.startsWith("video/")
          );
        });
      }
      return {
        files: readyFiles,
        pageInfo: result?.data?.files?.pageInfo,
      };
    }

    // Fetch videos
    videoFiles = await fetchFilesByMediaType(
      "media_type:Video OR media_type:ExternalVideo OR media_type:GenericFile",
    );

    // Fetch images
    imageFiles = await fetchFilesByMediaType("media_type:Image");
    pageInfoVideo = videoFiles?.pageInfo;
    pageInfoImage = imageFiles?.pageInfo;

    allFiles = [...videoFiles?.files, ...imageFiles?.files];

    return json({
      allFiles: [...videoFiles?.files, ...imageFiles?.files],
      videoFiles: videoFiles?.files,
      imageFiles: imageFiles?.files,
      pageInfoVideo: videoFiles?.pageInfo,
      pageInfoImage: imageFiles?.pageInfo,
      user,
    });
  } else if (startCursor) {
    // Helper function to fetch files
    async function fetchFilesByMediaType(mediaType) {
      const query = `
  #graphql
  query FetchFiles {
    files(reverse: true, last: 50, query:"${mediaType}",before:"${startCursor}") {
      edges {
        node {
          id
          alt
          createdAt
          fileStatus
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
      let readyFiles =
        result?.data?.files?.edges?.filter(
          (edge) =>
            edge?.node?.fileStatus === "READY" ||
            edge?.node?.fileStatus === "PROCESSING",
        ) || [];

      if (mediaType.includes("GenericFile")) {
        const videoMimeTypes = [
          "video/mp4",
          "video/quicktime",
          "video/webm",
          "video/x-msvideo",
          "video/x-matroska",
          "video/mpeg",
        ];
        readyFiles = readyFiles.filter((edge) => {
          if (edge?.node?.__typename !== "GenericFile") return true;
          return (
            videoMimeTypes.includes(edge?.node?.mimeType) ||
            edge?.node?.mimeType?.startsWith("video/")
          );
        });
      }
      return {
        files: readyFiles,
        pageInfo: result?.data?.files?.pageInfo,
      };
    }

    // Fetch videos
    videoFiles = await fetchFilesByMediaType(
      "media_type:Video OR media_type:ExternalVideo OR media_type:GenericFile",
    );

    // Fetch images
    imageFiles = await fetchFilesByMediaType("media_type:Image");
    pageInfoVideo = videoFiles?.pageInfo;
    pageInfoImage = imageFiles?.pageInfo;

    allFiles = [...videoFiles?.files, ...imageFiles?.files];

    return json({
      allFiles: [...videoFiles?.files, ...imageFiles?.files],
      videoFiles: videoFiles?.files,
      imageFiles: imageFiles?.files,
      pageInfoVideo: videoFiles?.pageInfo,
      pageInfoImage: imageFiles?.pageInfo,
      user,
    });
  } else {
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
          fileStatus
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
      let readyFiles =
        result?.data?.files?.edges?.filter(
          (edge) =>
            edge?.node?.fileStatus === "READY" ||
            edge?.node?.fileStatus === "PROCESSING",
        ) || [];

      if (mediaType.includes("GenericFile")) {
        const videoMimeTypes = [
          "video/mp4",
          "video/quicktime",
          "video/webm",
          "video/x-msvideo",
          "video/x-matroska",
          "video/mpeg",
        ];
        readyFiles = readyFiles.filter((edge) => {
          if (edge?.node?.__typename !== "GenericFile") return true;
          return (
            videoMimeTypes.includes(edge?.node?.mimeType) ||
            edge?.node?.mimeType?.startsWith("video/")
          );
        });
      }
      return {
        files: readyFiles,
        pageInfo: result?.data?.files?.pageInfo,
      };
    }

    // Fetch videos
    videoFiles = await fetchFilesByMediaType(
      "media_type:Video OR media_type:ExternalVideo OR media_type:GenericFile",
    );

    // Fetch images
    imageFiles = await fetchFilesByMediaType("media_type:Image");
    pageInfoVideo = videoFiles?.pageInfo;
    pageInfoImage = imageFiles?.pageInfo;
    allFiles = [...videoFiles?.files, ...imageFiles?.files];
  }
  if (request.method === "POST") {
    const url = formData.get("url");
    let name = formData.get("name");
    let type = formData.get("type");
    let size = formData.get("size");

    // Only proceed if file metadata is present
    if (name && type && size) {
      const upload = validateUpload({ name, type, size });
      if (!upload.ok) return json({ error: upload.error }, { status: 400 });
      ({ name, type, size } = upload);
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
                filename: name,
                mimeType: type,
                httpMethod: "POST",
                resource:
                  type?.split("/")[0].toUpperCase() === "AUDIO"
                    ? "FILE"
                    : type?.split("/")[0].toUpperCase(),
                fileSize: String(size),
              },
            ],
          },
        },
      );

      const stagedUploadResult = await response.json();

      stagedUpload =
        stagedUploadResult?.data?.stagedUploadsCreate?.stagedTargets?.[0];
      return json({ stagedUpload, user });
    } else if (url && url.length > 0) {
      const response = await admin.graphql(
        `#graphql
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
            }
          }
        }`,
        {
          variables: {
            files: {
              alt: "Video",
              contentType: "FILE",
              originalSource: url,
            },
          },
        },
      );
      const responseJson = await response.json();

      const getUrlPromise = new Promise((resolve, reject) => {
        setTimeout(async () => {
          const responsevideoUrl = await admin.graphql(
            `#graphql
      query {
      node(id: "${responseJson?.data?.fileCreate?.files[0]?.id}") {
          ... on GenericFile {
              id
              url
          }
      }
  }
      `,
          );
          const responsevideoUrlJson = await responsevideoUrl.json();
          resolve({ responsevideoUrlJson });
        }, [1000]);
      });

      const { responsevideoUrlJson } = await getUrlPromise;

      if (responsevideoUrlJson.data.node.url) {
        updateUrl = await prisma.video.update({
          where: {
            id: formData.get("id"),
          },
          data: { url: responsevideoUrlJson.data.node.url },
        });
      }
    } else {
      console.error("Invalid URL");
      return { error: "Invalid URL" };
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
        videoFiles: videoFiles?.files,
        imageFiles: imageFiles?.files,
        pageInfoImage,
        pageInfoVideo,
        user,
      });
    } else if (formData.get("refreshFiles")) {
      // Fresh fetch of all file lists after a successful upload
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
          fileStatus
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
          ... on Video {
            id
            sources {
              url
              format
              mimeType
            }
          }
          ... on ExternalVideo {
            id
            originUrl
            embeddedUrl
          }
          ... on MediaImage {
            id
            image { url src }
          }
        }
      }
      pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
    }
  }`;
        const result = await admin.graphql(query);
        const resultJson = await result.json();
        const videoMimeTypes = [
          "video/mp4",
          "video/webm",
          "video/ogg",
          "video/quicktime",
          "video/x-msvideo",
          "video/mpeg",
        ];
        // Keep the {node: ...} wrapper so components can use item.node consistently
        const allEdges = resultJson?.data?.files?.edges || [];
        let readyFiles;
        if (mediaType.includes("Image")) {
          readyFiles = allEdges.filter(
            ({ node }) => node?.preview?.image?.url || node?.image?.url,
          );
        } else {
          readyFiles = allEdges.filter(
            ({ node }) =>
              videoMimeTypes.includes(node?.mimeType) ||
              node?.mimeType?.startsWith("video/") ||
              node?.sources?.length > 0 ||
              node?.originUrl,
          );
        }
        return {
          files: readyFiles,
          pageInfo: resultJson?.data?.files?.pageInfo,
        };
      }
      const freshVideoFiles = await fetchFilesByMediaType(
        "media_type:Video OR media_type:ExternalVideo OR media_type:GenericFile",
      );
      const freshImageFiles = await fetchFilesByMediaType("media_type:Image");
      return json({
        videoFiles: freshVideoFiles?.files,
        imageFiles: freshImageFiles?.files,
        pageInfoVideo: freshVideoFiles?.pageInfo,
        pageInfoImage: freshImageFiles?.pageInfo,
        allFiles: [
          ...(freshVideoFiles?.files || []),
          ...(freshImageFiles?.files || []),
        ],
        user,
        refreshed: true,
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
        id: formData.get("ids"),
        allFiles,
        videoFiles: videoFiles?.files,
        imageFiles: imageFiles?.files,
        pageInfoImage,
        pageInfoVideo,
        user,
      });
    } else if (formData.get("name")) {
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
                  formData.get("type")?.split("/")[0].toUpperCase() === "AUDIO"
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
        videoFiles: videoFiles?.files,
        imageFiles: imageFiles?.files,
        pageInfoImage,
        pageInfoVideo,
        user,
      });
    } else {
      try {
        // Everything the client sends is parsed AND sanitised: tags stripped
        // from text, non-http(s) URLs dropped, CSS/enum values defanged.
        const proOptionData = {
          controlsByDevice: parseSettings(formData.get("controlsByDevice")),
          passwordProtected: parseSettings(formData.get("passwordProtected")),
          watermark: parseSettings(formData.get("watermark")),
          overlay: parseSettings(formData.get("overlay")),
          captions: parseSettings(formData.get("captions")),
        };

        // Merge multi-video data into the data payload
        const playerType =
          formData.get("playerType") === "multiple" ? "multiple" : "single";
        const multiVideoData = { playerType };
        if (playerType === "multiple") {
          const items = parseSettings(formData.get("multiItems"), []);
          multiVideoData.items = Array.isArray(items) ? items : [];
          const rawGridSettings = formData.get("gridSettings");
          multiVideoData.gridSettings = rawGridSettings
            ? parseSettings(rawGridSettings)
            : {
                viewMode: "grid",
                columns: { desktop: 3, tablet: 2, mobile: 1 },
                gap: 16,
              };
        }

        const mergedData = isPaidCredits(user?.cardits)
          ? { ...proOptionData, ...multiVideoData }
          : { ...multiVideoData };

        updateVideo = await prisma.video.update({
          where: { id: formData.get("id") },
          data: {
            title: sanitizeSettings(String(formData.get("title") ?? ""), "title"),
            videoType: cssValue(formData.get("videoType") ?? ""),
            url: safeUrl(String(formData.get("url") ?? "")),
            vimeo: safeUrl(String(formData.get("vimeo") ?? "")),
            youtube: safeUrl(String(formData.get("youtube") ?? "")),
            resetOnEnd: formData.get("resetOnEnd") === "true" ? true : false,
            poster: safeUrl(String(formData.get("poster") ?? "")),
            autoPlay: formData.get("autoPlay") === "true" ? true : false,
            repeat: formData.get("repeat") === "true" ? true : false,
            controls: parseSettings(formData.get("controls")),
            styles: parseSettings(formData.get("styles")),
            options: parseSettings(formData.get("options")),
            data: mergedData,
          },
        });
      } catch (error) {
        console.error("Error updating video:", error);
        // throw new Error("Error",error);
      }
    }
  } else if (request.method === "PATCH") {
    const poster = formData.get("poster");
    if (poster && poster.length > 0) {
      const response = await admin.graphql(
        `#graphql
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
            }
          }
        }`,
        {
          variables: {
            files: {
              alt: "IMAGE",
              contentType: "IMAGE",
              originalSource: poster,
            },
          },
        },
      );
      const responseJson = await response.json();

      const getUrlPromise = new Promise((resolve, reject) => {
        setTimeout(async () => {
          const responsevideoUrl = await admin.graphql(
            `#graphql
      query {
      node(id: "${responseJson?.data?.fileCreate?.files[0]?.id}") {
          ... on GenericFile {
              id
              url
          }
      }
  }
      `,
          );
          const responsevideoUrlJson = await responsevideoUrl.json();
          resolve({ responsevideoUrlJson });
        }, [1000]);
      });

      const { responsevideoUrlJson } = await getUrlPromise;

      if (responsevideoUrlJson.data.node.url) {
        updateUrl = await prisma.video.update({
          where: {
            id: formData.get("id"),
          },
          data: { poster: responsevideoUrlJson.data.node.url },
        });
      }
    } else {
      console.error("Invalid poster URL");
      return { error: "Invalid poster URL" };
    }
  }

  return {
    updateUrl,
    allFiles,
    videoFiles: videoFiles?.files,
    imageFiles: imageFiles?.files,
    pageInfoImage,
    pageInfoVideo,
    user,
  };
};

const Customize = () => {
  const nav = useNavigation();
  const submit = useSubmit();
  const actionData = useActionData();
  const location = useLocation();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const loaderData = useLoaderData({ data: location?.pathname?.split("/")[3] });
  const [isVideoReady, setIsVideoReady] = useState(false);

  const { allFiles: initialFiles } = useLoaderData();
  const [files, setFiles] = useState(initialFiles);

  const isPremium = resolvePlan({
    plans: loaderData?.allPlans || [],
    user: loaderData?.user || actionData?.user,
  }).isPaid;

  // useEffect(() => {
  //   if (initialFiles?.length > files?.length) {
  //     setFiles(initialFiles);
  //   }
  // }, [initialFiles, files, actionData]);

  // useEffect(() => {
  //   if (actionData?.allFiles?.length > 0) {
  //     setFiles(actionData?.allFiles);
  //   }
  // }, [actionData]);

  const defaultPasswordProtected = {
    enabled: false,
    title: "Enter Password",
    message: "Wrong Password !!!",
    buttonText: "Access",
    password: "12345",
  };

  const [passwordProtect, setPasswordProtect] = useState(
    loaderData?.video?.data?.passwordProtected || defaultPasswordProtected,
  );

  // Password rules: 4-10 characters, letters, numbers and symbols, but no
  // whitespace anywhere. A leading or trailing space is invisible in a masked
  // field and would be silently lost on the storefront side, so it is rejected
  // rather than trimmed.
  const PASSWORD_MIN_LENGTH = 4;
  const PASSWORD_MAX_LENGTH = 10;

  // Keeps typing inside the rules: drop whitespace (\s covers the tab and the
  // non-breaking space a paste can carry in) and never let the value grow past
  // the maximum.
  const sanitizePassword = (value) =>
    String(value ?? "")
      .replace(/\s/g, "")
      .slice(0, PASSWORD_MAX_LENGTH);

  // Returns the message to show, or false when the password is valid.
  const getPasswordError = (value) => {
    const password = String(value ?? "");
    if (!password) return "Password is required";
    if (/\s/.test(password)) return "Password cannot contain spaces";
    if (password.length < PASSWORD_MIN_LENGTH)
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
    if (password.length > PASSWORD_MAX_LENGTH)
      return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
    return false;
  };
  const defaultOverlay = {
    enabled: false,
    text: "Video Player by bPlugins",
    opacity: 1,
    fontSize: "16px",
    color: "#ffffffff",
    backgroundColor: "#00000080",
    position: "top_right",
    type: "text",
    url: "https://bplugins.com",
  };

  const [overlay, setOverlay] = useState(
    loaderData?.video?.data?.overlay || defaultOverlay,
  );
  const defaultWatermark = {
    enabled: false,
    text: "Video Player by bPlugins",
    color: "#ff0000ff",
    type: "domain",
  };

  const [watermark, setWatermark] = useState(
    loaderData?.video?.data?.watermark || defaultWatermark,
  );

  // ── Captions / subtitles (Pro) ──────────────────────────────────────────
  // Tracks hold WebVTT content inline rather than a file URL: SRT is not a
  // format any browser understands, so uploads are converted to VTT here and
  // stored as text. That also sidesteps cross-origin fetch failures at
  // playback, since the storefront builds a same-origin blob URL from it.
  const defaultCaptions = { enabled: false, tracks: [] };
  const [captions, setCaptions] = useState(
    loaderData?.video?.data?.captions || defaultCaptions,
  );
  const [captionError, setCaptionError] = useState("");

  // Blob URLs for the preview player's <track> elements.
  //
  // Cached BY VTT CONTENT: editing a track's label or language must not mint a
  // new blob URL, because a changed `src` tears down and rebuilds the preview
  // player (see captionTrackKey below) — which made the preview flicker and
  // break on every keystroke while typing a label.
  const captionBlobCache = useRef(new Map());
  const previewCaptionTracks = useMemo(() => {
    if (typeof window === "undefined") return [];
    const usable =
      captions?.enabled && Array.isArray(captions?.tracks)
        ? captions.tracks.filter((t) => t?.content)
        : [];
    const cache = captionBlobCache.current;
    return usable.map((t, i) => {
      let src = cache.get(t.content);
      if (!src) {
        src = URL.createObjectURL(new Blob([t.content], { type: "text/vtt" }));
        cache.set(t.content, src);
      }
      return {
        label: t.label || t.srclang || "Captions",
        srclang: t.srclang || "en",
        // Only the first default-flagged track keeps `default`.
        default: !!t.default && usable.findIndex((x) => x.default) === i,
        src,
      };
    });
  }, [captions]);

  // Revoke only on unmount. Revoking mid-edit would leave the <track> elements
  // that are still on screen pointing at dead URLs.
  useEffect(
    () => () => {
      captionBlobCache.current.forEach((url) => URL.revokeObjectURL(url));
      captionBlobCache.current.clear();
    },
    [],
  );

  // Stable dependency for the player effect: changes only when something the
  // player actually needs to be rebuilt for changes (a file added/removed, a
  // language switched, or a different default track) — NOT when a label is
  // being typed.
  const captionTrackKey = previewCaptionTracks
    .map((t) => `${t.srclang}|${t.default ? 1 : 0}|${t.src}`)
    .join("~");

  // Plyr's captions LANGUAGE picker lives inside the settings menu, so the
  // preview has to force the "settings" control on when there is more than one
  // track to choose between — and ONLY then. It used to be forced on for every
  // premium HTML5 video, which meant switching Settings off in the control list
  // did nothing in the preview even though the storefront hid it correctly.
  // Same rule as extensions/star-video-player/assets/svp-player.js.
  const previewNeedsSettingsForCaptions = previewCaptionTracks.length > 1;

  const updateCaptionTrack = (index, patch) =>
    setCaptions((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));

  const removeCaptionTrack = (index) =>
    setCaptions((prev) => ({
      ...prev,
      tracks: prev.tracks.filter((_, i) => i !== index),
    }));

  // Only one track can be the browser default, so setting one clears the rest.
  const setDefaultCaptionTrack = (index) =>
    setCaptions((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t, i) => ({ ...t, default: i === index })),
    }));

  // ── Reorder caption tracks by dragging the language chips ────────────────
  // Track order is meaningful: <track> elements are emitted in this order, and
  // the player's language menu lists them in that same order.
  //
  // State is a single INSERTION INDEX (0..length) rather than a hovered index
  // plus a side — it's what both the drop and the on-screen indicator need, so
  // there's one source of truth and no off-by-one drift between them.
  const [capDragIndex, setCapDragIndex] = useState(null);
  const [capInsertAt, setCapInsertAt] = useState(null);
  // A completed drag can be followed by a click on some browsers; this stops
  // that stray click from also re-assigning the default track.
  const capDraggedRef = useRef(false);

  const moveCaptionTrack = (from, to) => {
    setCaptions((prev) => {
      const tracks = [...(prev.tracks || [])];
      if (from < 0 || from >= tracks.length) return prev;
      const [moved] = tracks.splice(from, 1);
      // Account for the removed item shifting later positions left by one.
      const target = from < to ? to - 1 : to;
      tracks.splice(Math.max(0, Math.min(target, tracks.length)), 0, moved);
      return { ...prev, tracks };
    });
  };

  const capDragReset = () => {
    setCapDragIndex(null);
    setCapInsertAt(null);
  };

  const capDnd = {
    start: (e, i) => {
      capDraggedRef.current = false;
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", String(i));
        // Use the chip itself as the drag ghost, grabbed at the cursor, so the
        // image tracks the pointer instead of the browser's washed-out default.
        const rect = e.currentTarget.getBoundingClientRect();
        e.dataTransfer.setDragImage(
          e.currentTarget,
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
      } catch (err) {
        /* setData/setDragImage unsupported — fall back to default ghost */
      }
      // Defer so the browser doesn't abort the drag when the source restyles.
      setTimeout(() => {
        setCapDragIndex(i);
        setCapInsertAt(i);
      }, 0);
    },
    over: (e, i) => {
      if (capDragIndex === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      // Chips flow horizontally, so the drop side follows the cursor's X.
      const rect = e.currentTarget.getBoundingClientRect();
      const at = e.clientX - rect.left > rect.width / 2 ? i + 1 : i;
      if (at !== capInsertAt) setCapInsertAt(at);
    },
    // Dropping on the container's empty space appends to the end.
    overContainer: (e) => {
      if (capDragIndex === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    drop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      capDraggedRef.current = true;
      if (capDragIndex !== null && capInsertAt !== null) {
        moveCaptionTrack(capDragIndex, capInsertAt);
      }
      capDragReset();
    },
    end: () => {
      capDragReset();
      // Release the click guard after the browser's post-drag click would fire.
      setTimeout(() => {
        capDraggedRef.current = false;
      }, 0);
    },
    // Move a chip with the keyboard so reordering isn't mouse-only.
    keyDown: (e, i) => {
      const total = (captions?.tracks || []).length;
      if (e.key === "ArrowLeft" && i > 0) {
        e.preventDefault();
        moveCaptionTrack(i, i - 1);
      } else if (e.key === "ArrowRight" && i < total - 1) {
        e.preventDefault();
        moveCaptionTrack(i, i + 2);
      }
    },
  };

  // Accepts several files at once so a merchant can add every language in one
  // go (e.g. subs.en.srt, subs.es.srt, subs.fr.vtt). Each file's language is
  // guessed from its name and can be corrected afterwards.
  const handleCaptionFile = async (event) => {
    const files = Array.from(event.target.files || []);
    // Reset so picking the same file(s) again still fires onChange.
    event.target.value = "";
    if (!files.length) return;
    setCaptionError("");

    const added = [];
    const problems = [];

    for (const file of files) {
      const name = file.name || "file";
      if (!/\.(srt|vtt)$/i.test(name)) {
        problems.push(`${name}: not a .srt or .vtt file`);
        continue;
      }
      // Caption files are text and tiny; anything this large is the wrong file.
      if (file.size > 1024 * 1024) {
        problems.push(`${name}: too large (max 1 MB)`);
        continue;
      }
      try {
        const raw = await file.text();
        if (!hasCues(raw)) {
          problems.push(`${name}: no subtitles found inside`);
          continue;
        }
        const lang = guessLangFromFilename(name) || "en";
        added.push({
          label: languageName(lang),
          srclang: lang,
          content: toVtt(raw),
          filename: name,
        });
      } catch (e) {
        problems.push(`${name}: could not be read`);
      }
    }

    if (added.length) {
      setCaptions((prev) => {
        const existing = prev.tracks || [];
        const tracks = [...existing, ...added];
        // First track overall becomes the default shown on play.
        const hasDefault = tracks.some((t) => t.default);
        return {
          enabled: true,
          tracks: tracks.map((t, i) => ({
            ...t,
            default: hasDefault ? !!t.default : i === 0,
          })),
        };
      });
    }

    if (problems.length) {
      setCaptionError(
        `${problems.length} file${problems.length > 1 ? "s" : ""} skipped — ${problems.join("; ")}`,
      );
    }
  };

  // Languages already used, so the UI can flag a duplicate (two tracks with the
  // same srclang make Plyr's language menu ambiguous).
  const duplicateCaptionLangs = (() => {
    const seen = new Map();
    (captions?.tracks || []).forEach((t) => {
      const k = (t.srclang || "").toLowerCase();
      seen.set(k, (seen.get(k) || 0) + 1);
    });
    return new Set(
      [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k),
    );
  })();

  // Multi-video player state
  const playerType = loaderData?.video?.data?.playerType || "single";
  const isMultiplePlayer = playerType === "multiple";

  const passwordError =
    !isMultiplePlayer && passwordProtect?.enabled
      ? getPasswordError(passwordProtect?.password)
      : false;

  const [multiItems, setMultiItems] = useState(
    loaderData?.video?.data?.items || [{ video: "", poster: "" }],
  );

  const defaultGridSettings = {
    viewMode: "grid",
    columns: { desktop: 3, tablet: 2, mobile: 1 },
    gap: 16,
    autoplay: false,
    autoplaySpeed: 3,
  };

  const [gridSettings, setGridSettings] = useState(
    loaderData?.video?.data?.gridSettings || defaultGridSettings,
  );

  // Track which item index the upload modal should target for multi-video
  const [activeItemIndex, setActiveItemIndex] = useState(null);

  const [videoFiles, setVideoFiles] = useState(
    loaderData?.videoFiles || actionData?.videoFiles,
  );
  const [imageFiles, setImageFiles] = useState(
    loaderData?.imageFiles || actionData?.imageFiles,
  );
  const [videoPageInfo, setVideoPageInfo] = useState(
    loaderData?.pageInfoVideo || actionData?.pageInfoVideo,
  );
  const [imagePageInfo, setImagePageInfo] = useState(
    loaderData?.pageInfoImage || actionData?.pageInfoImage,
  );

  useEffect(() => {
    if (actionData?.refreshed) {
      // Fresh file list after a completed upload — update state and select the newest file
      setVideoFiles(actionData?.videoFiles);
      setImageFiles(actionData?.imageFiles);
      setVideoPageInfo(actionData?.pageInfoVideo);
      setImagePageInfo(actionData?.pageInfoImage);
      toggleFileSelection(
        actionData?.videoFiles?.[0]?.node ?? actionData?.videoFiles?.[0],
      );
      toggleImgSelection(
        actionData?.imageFiles?.[0]?.node ?? actionData?.imageFiles?.[0],
      );
      return;
    }
    if (loaderData?.videoFiles?.length < actionData?.videoFiles?.length) {
      setVideoFiles(actionData?.videoFiles);
      setVideoPageInfo(actionData?.pageInfoVideo);
    }
    if (loaderData?.imageFiles?.length < actionData?.imageFiles?.length) {
      setImageFiles(actionData?.imageFiles);
      setImagePageInfo(actionData?.pageInfoImage);
    }

    if (actionData?.videoFiles?.length > 0) {
      setVideoFiles(actionData?.videoFiles);
      setVideoPageInfo(actionData?.pageInfoVideo);
    }
    if (actionData?.imageFiles?.length > 0) {
      setImageFiles(actionData?.imageFiles);
      setImagePageInfo(actionData?.pageInfoImage);
    }
  }, [loaderData, actionData]);

  const isLoading =
    (["loading", "submitting"].includes(nav.state) &&
      nav.formMethod === "POST") ||
    nav.formMethod === "PUT" ||
    nav.formMethod === "DELETE";
  const [file, setFile] = useState([]);
  const [uploadedAndSelectedFile, setUploadedAndSelectedFile] = useState([]);
  const [uploadedAndSelectedImg, setUploadedAndSelectedImg] = useState([]);
  const [uploadedAndSelectedLogo, setUploadedAndSelectedLogo] = useState([]);
  const loading =
    ["loading", "submitting"]?.includes(nav.state) && nav.formMethod === "PUT";

  const controlsData = loaderData?.video?.controls;

  // Controls that earn their place on a desktop control bar but not on a phone.
  // Volume is dead weight on mobile whatever the player type — iOS ignores
  // programmatic volume entirely, so the slider renders and does nothing. For a
  // single player, picture-in-picture and the settings menu go too: PiP out of a
  // full-width phone video has nowhere to float to, and the settings menu's
  // quality/speed lists open as an overlay that swallows most of the frame. A
  // multiple player only drops volume, since its cells are already narrow and
  // its global defaults keep PiP off anyway.
  //
  // These are only a starting point: desktop and tablet keep whatever the
  // player's global controls say, the merchant can switch any of them back on
  // per device, and once the choice is saved this default never runs again.
  const mobileControlDefaults = isMultiplePlayer
    ? { volume: false }
    : { volume: false, pip: false, settings: false };

  const defaultControlsByDevice = {
    enabled: false,
    desktop: { ...controlsData },
    tablet: { ...controlsData },
    mobile: { ...controlsData, ...mobileControlDefaults },
  };

  const [controlsByDevice, setControlsByDevice] = useState(
    loaderData?.video?.data?.controlsByDevice || defaultControlsByDevice,
  );

  const stylesData = loaderData?.video?.styles;
  const [title, setTitle] = useState(loaderData?.video?.title);
  const [videoType, setVideoType] = useState(loaderData?.video?.videoType);
  const [url, setUrl] = useState(loaderData?.video?.url);

  // A video can look perfect here and be blank for most of the store's
  // visitors: H.265/HEVC (an iPhone's default recording format, and what
  // Shopify serves untranscoded for clips added under Content > Files) plays
  // in Safari but not in Chrome or Firefox. The merchant previewing it is the
  // least likely person to hit that, so read the codec out of the file rather
  // than trusting this browser, and say so before the video goes live.
  const [codecWarning, setCodecWarning] = useState(null);
  useEffect(() => {
    setCodecWarning(null);
    if (!url) return;
    const controller = new AbortController();
    detectVideoCodec(url, { signal: controller.signal }).then((codec) => {
      if (codec && !codec.universal) setCodecWarning(codec);
    });
    return () => controller.abort();
  }, [url]);

  // Captions render from <track> elements inside an HTML5 <video>. YouTube and
  // Vimeo play through their own iframe embeds, which have no <video> to attach
  // tracks to (they serve their own captions), so the feature doesn't apply to
  // them. Must stay below the videoType/url declarations it reads.
  const isEmbeddedProvider =
    videoType === "youtube" ||
    videoType === "vimeo" ||
    /youtube\.com|youtu\.be|vimeo\.com/i.test(url || "");

  // Which provider a URL belongs to. The video field accepts a pasted link, so
  // this must be re-derived whenever the URL changes — otherwise videoType
  // keeps its previous value and the storefront picks the wrong player type
  // (a YouTube link saved as "html5" renders an HTML5 <video>, which can't
  // play a YouTube page URL).
  const detectVideoType = (value) => {
    const v = String(value || "").toLowerCase();
    if (v.includes("youtu")) return "youtube";
    if (v.includes("vimeo.com")) return "vimeo";
    return "html5";
  };

  const [vimeo, setVimeo] = useState(loaderData?.video?.vimeo);
  const [youtube, setYoutube] = useState(loaderData?.video?.youtube);
  const [poster, setPoster] = useState(loaderData?.video?.poster || "");
  const [repeat, setRepeat] = useState(loaderData?.video?.repeat);
  const [autoPlay, setAutoPlay] = useState(loaderData?.video?.autoPlay);
  const [muted, setMuted] = useState(controlsData?.muted);
  const [mutedOptions, setMutedOptions] = useState(
    loaderData?.video?.options?.muted,
  );
  const [resetOnEnd, setResetOnEnd] = useState(loaderData?.video?.resetOnEnd);
  const [hideControls, setHideControls] = useState(true);
  const [playLarge, setPlayLarge] = useState(controlsData?.playLarge);
  const [restart, setRestart] = useState(controlsData?.restart);
  const [rewind, setRewind] = useState(controlsData?.rewind);
  const [play, setPlay] = useState(controlsData?.play);
  const [fastForward, setFastForward] = useState(controlsData?.fastForward);
  const [progress, setProgress] = useState(controlsData?.progress);
  const [currentTime, setCurrentTime] = useState(controlsData?.currentTime);
  const [duration, setDuration] = useState(controlsData?.duration);
  // const [mute, setMute] = useState(true);
  const [activeDevice, setActiveDevice] = useState("desktop");

  const [volume, setVolume] = useState(controlsData?.volume);
  const [pip, setPip] = useState(controlsData?.pip);
  const [airplay, setAirplay] = useState(controlsData?.airplay);
  const [settings, setSettings] = useState(controlsData?.settings);
  const [download, setDownload] = useState(controlsData?.download);
  const [fullscreen, setFullscreen] = useState(controlsData?.fullscreen);
  const [player, setPlayer] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [width, setWidth] = useState(stylesData?.width || "100%");
  const [brandColor, setBrandColor] = useState(
    stylesData?.brandColor || "#00b3ff",
  );
  const [round, setRound] = useState(stylesData?.borderRadius || "0px");

  useEffect(() => {
    if (
      url !== actionData?.updateUrl?.url &&
      actionData?.updateUrl?.controls !== "undefined"
    ) {
      setUrl(actionData?.updateUrl?.url || url);

      const videoControls = actionData?.updateUrl?.controls;
    }
    if (
      poster !== actionData?.updateUrl?.poster &&
      actionData !== "undefined"
    ) {
      setPoster(actionData?.updateUrl?.poster || poster);
    }
  }, [actionData, url, poster]);

  const playerRef = useRef(null);

  let controls = [];

  const controlsObject = {
    playLarge,
    restart,
    rewind,
    play,
    fastForward,
    progress,
    currentTime,
    duration,
    muted,
    volume,
    pip,
    airplay,
    settings,
    download,
    fullscreen,
  };

  Object.keys(controlsByDevice?.[activeDevice])?.map((control, index) => {
    if (controlsByDevice?.[activeDevice]?.[control]) {
      if (control === "fastForward") {
        return controls.push("fast-forward");
      }
      return controls.push(control);
    }
  });

  // useEffect(() => {
  //   if (poster !== loaderData?.video?.poster) {
  //     submit(
  //       { poster: poster, id: location?.pathname?.split("/")[3] },
  //       { method: "PATCH" },
  //     );
  //   }
  // }, [poster]);

  const [isValidVideo, setIsValidVideo] = useState(false);
  // Tracks the currently active device (global for all groups)

  // Helper function to validate the video URL

  const prevControlsRef = useRef([]);
  const prevControlsByDeviceEnabledRef = useRef(null);
  let playerOptions = "";

  useEffect(() => {
    if (!player || !poster) return;

    if (player?.elements?.poster) {
      const el = player.elements.poster;
      el.style.backgroundImage = `url(${poster})`;
      el.style.backgroundSize = "cover";
      el.style.opacity = "1";
    }

    document.querySelectorAll(".plyr__poster").forEach((el) => {
      el.style.backgroundImage = `url(${poster})`;
      el.style.backgroundSize = "cover";
      el.style.opacity = "1";
    });
  }, [player, poster]);

  useEffect(() => {
    if (!uploadedAndSelectedFile || Array.isArray(uploadedAndSelectedFile))
      return;

    // Extract URL from any Shopify file node shape:
    // - Video: has sources[] array (no direct .url, no mediaContentType from refreshFiles query)
    // - GenericFile: has .url directly
    // - ExternalVideo: has .embedUrl or .originUrl
    const f = uploadedAndSelectedFile;
    const isVideo =
      f?.mediaContentType === "VIDEO" ||
      f?.__typename === "Video" ||
      (Array.isArray(f?.sources) && f.sources.length > 0);

    const currentUrl = isVideo
      ? f?.sources?.find((a) => a.format?.toLowerCase() === "mp4")?.url ||
        f?.sources?.[0]?.url
      : f?.url || // GenericFile
        f?.embedUrl || // ExternalVideo (legacy)
        f?.originUrl; // ExternalVideo

    // If multi-video mode and an item index is active, always update that item
    if (isMultiplePlayer && activeItemIndex !== null) {
      if (currentUrl) {
        setMultiItems((prev) =>
          prev.map((item, i) =>
            i === activeItemIndex ? { ...item, video: currentUrl } : item,
          ),
        );
      }
      setActiveItemIndex(null);
      return;
    }

    // Single player: update url
    const singleUrl = currentUrl || url;
    setUrl(singleUrl);
    setVideoType(detectVideoType(singleUrl));
  }, [uploadedAndSelectedFile]);

  useEffect(() => {
    const fileThumb =
      uploadedAndSelectedFile?.preview?.image?.url ||
      uploadedAndSelectedFile?.preview?.image?.src;
    if (fileThumb) {
      // For multi-video, update the active item's poster from video thumbnail
      if (isMultiplePlayer && activeItemIndex !== null) {
        setMultiItems((prev) =>
          prev.map((item, i) =>
            i === activeItemIndex ? { ...item, poster: fileThumb } : item,
          ),
        );
      } else {
        setPoster(fileThumb);
      }
    }
  }, [uploadedAndSelectedFile]);

  useEffect(() => {
    const imgThumb =
      uploadedAndSelectedImg?.preview?.image?.url ||
      uploadedAndSelectedImg?.preview?.image?.src;
    if (imgThumb) {
      // For multi-video, update the active item's poster
      if (isMultiplePlayer && activeItemIndex !== null) {
        setMultiItems((prev) =>
          prev.map((item, i) =>
            i === activeItemIndex ? { ...item, poster: imgThumb } : item,
          ),
        );
        setActiveItemIndex(null);
      } else {
        setPoster(imgThumb);
      }
    }
  }, [uploadedAndSelectedImg]);
  useEffect(() => {
    setOverlay((prev) => ({
      ...prev,
      logo:
        uploadedAndSelectedLogo?.preview?.image?.url ||
        uploadedAndSelectedLogo?.preview?.image?.src ||
        overlay.logo,
    }));
  }, [uploadedAndSelectedLogo]);

  // Autoplay Logic for Multiple Video Player
  useEffect(() => {
    if (
      !isMultiplePlayer ||
      !gridSettings.autoplay ||
      gridSettings.viewMode === "grid"
    ) {
      return;
    }

    const trackId =
      gridSettings.viewMode === "carousel"
        ? "multi-carousel-track"
        : "multi-slider-track";
    let isPaused = false;

    // A video playing in picture-in-picture is detached from the page, so
    // scrolling the track out from under it is never what the merchant wants.
    // Checked per tick rather than via events so Safari's presentation-mode
    // PiP (which reports no standard PiP element) is covered too.
    const isPipActive = () => {
      if (typeof document === "undefined") return false;
      if (document.pictureInPictureElement) return true;
      const track = document.getElementById(trackId);
      if (!track) return false;
      return Array.from(track.querySelectorAll("video")).some(
        (v) => v.webkitPresentationMode === "picture-in-picture",
      );
    };

    const intervalId = setInterval(
      () => {
        if (isPaused || isPipActive()) return;

        const track = document.getElementById(trackId);
        if (!track) return;

        const isEnd =
          track.scrollLeft + track.offsetWidth >= track.scrollWidth - 10;

        if (isEnd) {
          track.scrollTo({ left: 0, behavior: "smooth" });
        } else {
          const step =
            gridSettings.viewMode === "carousel"
              ? track.offsetWidth / (gridSettings.columns[activeDevice] || 1)
              : track.offsetWidth;

          track.scrollBy({ left: step, behavior: "smooth" });
        }
      },
      (gridSettings.autoplaySpeed || 3) * 1000,
    );

    const handleMouseEnter = () => (isPaused = true);
    const handleMouseLeave = () => (isPaused = false);

    const trackElement = document.getElementById(trackId);
    if (trackElement) {
      trackElement.addEventListener("mouseenter", handleMouseEnter);
      trackElement.addEventListener("mouseleave", handleMouseLeave);
    }

    return () => {
      clearInterval(intervalId);
      if (trackElement) {
        trackElement.removeEventListener("mouseenter", handleMouseEnter);
        trackElement.removeEventListener("mouseleave", handleMouseLeave);
      }
    };
  }, [
    isMultiplePlayer,
    gridSettings.autoplay,
    gridSettings.autoplaySpeed,
    gridSettings.viewMode,
    gridSettings.columns,
    activeDevice,
    multiItems.length,
  ]);

  function htmlToElement(html) {
    let temp = document.createElement("template");
    temp.innerHTML = html.trim();
    return temp.content.firstChild;
  }

  const isGridType = ["grid", "carousel", "slider"].includes(
    gridSettings?.viewMode,
  );

  let size = 70;

  if (isGridType) {
    if (
      activeDevice === "mobile" ||
      (gridSettings?.viewMode !== "slider" &&
        (gridSettings?.columns?.desktop > 1 ||
          gridSettings?.columns?.tablet > 1))
    ) {
      size = 40;
    }
  }

  const overlayImgStyle = `max-width: ${size}px; max-height: ${size}px;`;

  const applyOverlay = useCallback(() => {
    if (!player?.elements?.container) return;

    const playerContainer = player.elements.container;

    const inject = () => {
      let wrapper = playerContainer.querySelector(".h5vp_overlay_wrapper");

      if (!overlay.enabled) {
        if (wrapper) wrapper.remove();
        return;
      }

      if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "h5vp_overlay_wrapper";
        playerContainer.appendChild(wrapper);
      }

      // Values are escaped for the context they land in, so overlay text that
      // contains markup shows as text instead of running in the admin.
      const ov = {
        color: cssValue(overlay?.color),
        fontSize: cssValue(overlay?.fontSize),
        backgroundColor: cssValue(overlay?.backgroundColor),
        opacity: cssValue(overlay?.opacity),
        position: cssValue(overlay?.position),
        url: escapeHtml(safeUrl(overlay?.url)),
        logo: escapeHtml(safeUrl(overlay?.logo)),
        text: escapeHtml(overlay?.text),
      };
      const innerContent = `
        <style>
          .h5vp_overlay_customize p {
            padding: 5px 12px;
            cursor: pointer;
            color: ${ov.color || "#ffffff"};
            font-size: ${ov.fontSize || "16px"};
            background-color: ${ov.backgroundColor || "rgba(0, 0, 0, 0.5)"};
            border-radius: 3px;
            opacity: ${ov.opacity || "0.7"};
            overflow: hidden;
            display: block;
          }
          .h5vp_overlay_customize a {
            color: ${ov.color || "#ffffff"};
            font-size: ${ov.fontSize || "16px"};
            text-decoration: none !important;
          }
          .h5vp_overlay_customize p:hover {
            background-color: ${ov.color || "rgba(255, 255, 255, 0.7)"};
            color: ${ov.backgroundColor || "#000000"};
          }
          .h5vp_overlay_customize p:hover a {
            color: ${ov.backgroundColor || "#000000"};
          }
          .h5vp_overlay {
            position: absolute;
            z-index: 99;
          }
          .h5vp_overlay img {
            ${overlayImgStyle}
            width: 100%;
            height: 100%;
            object-fit: cover;
            overflow: hidden;
            border-radius: 3px;
            opacity: ${ov.opacity || "0.7"};
          }
          .h5vp_overlay.bottom_right { bottom: 10px; right: 10px; }
          .h5vp_overlay.top_right { top: 10px; right: 10px; }
          .h5vp_overlay.bottom_left { bottom: 10px; left: 10px; }
          .h5vp_overlay.top_left { top: 10px; left: 10px; }
        </style>
        <div class="h5vp_overlay ${ov.position || "top_right"} h5vp_overlay_customize">
          ${
            overlay?.type === "text"
              ? `
            <p style="margin: 0;">
              ${
                overlay?.url
                  ? `<a href="${ov.url}" rel="noreferrer" target="_blank">${ov.text}</a>`
                  : ov.text
              }
            </p>
          `
              : overlay?.url
                ? `<a href="${ov.url}" rel="noreferrer" target="_blank"><img src="${ov.logo}" /></a>`
                : `<img src="${ov.logo}" />`
          }
        </div>
      `;

      wrapper.innerHTML = innerContent;
    };

    // Guarantee injection survives Plyr's asynchronous DOM wipe
    inject();
    player.on("ready", inject);

    // Fallback exactly in sync with Plyr's 500ms poster-loading phase
    const timeout = setTimeout(inject, 550);
    return () => clearTimeout(timeout);
  }, [player, overlay, overlayImgStyle]);

  useEffect(() => {
    let watermarkInterval;
    let currentTag = "";

    const applyWatermark = () => {
      if (!player?.elements?.container || !watermark.enabled) return;

      const playerContainer = player.elements.container;
      const content =
        watermark.type === "domain"
          ? "your-shop.myshopify.com"
          : watermark.text;
      const color = watermark.color || "#ff0000ff";

      const cleanup = () => {
        if (currentTag) {
          const el = playerContainer.querySelector(currentTag);
          if (el) el.remove();
        }
      };

      player.on("play", () => {
        watermarkInterval = setInterval(() => {
          cleanup();
          currentTag = "watermark-" + Math.round(Math.random() * 1000);
          const span = document.createElement(currentTag);
          span.innerText = content;
          span.setAttribute(
            "style",
            `position:absolute; display:block !important; opacity:1 !important; z-index: 100; color: ${color}; top: ${Math.round(
              Math.random() * 90,
            )}% !important; left: ${Math.round(
              Math.random() * 70,
            )}% !important; transform: none !important; pointer-events: none;`,
          );
          playerContainer.appendChild(span);
        }, 2000);
      });

      player.on("pause", () => {
        clearInterval(watermarkInterval);
        cleanup(currentTag);
      });
    };

    applyOverlay();
    applyWatermark();

    return () => {
      clearInterval(watermarkInterval);
      if (player?.elements?.container && currentTag) {
        const el = player.elements.container.querySelector(currentTag);
        if (el) el.remove();
      }
    };
  }, [player, overlay, watermark, applyOverlay]);

  //=====================================================================================================================================//
  //-------------------------File Upload Modal---------------------------//
  //=====================================================================================================================================//

  const [inputValues, setInputValues] = useState({});

  const [filteredFiles, setFilteredFiles] = useState(files);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedImgs, setSelectedImgs] = useState([]);
  const [youtubeVimeo, setYoutubeVimeo] = useState(false);
  const [addUrlModalActive, setAddUrlModalActive] = useState(false);
  const [addPosterModalActive, setAddPosterModalActive] = useState(false);
  const [addOverlayLogoModalActive, setAddOverlayLogoModalActive] =
    useState(false);
  const [fileToRename, setFileToRename] = useState(null);
  const [newUrl, setNewUrl] = useState("");
  const [preview, setPreview] = useState(0);
  const [previewImg, setPreviewImg] = useState(0);
  const [toastActive, setToastActive] = useState(false);
  const [isGridView, setIsGridView] = useState("grid_view");

  const [toastContent, setToastContent] = useState({
    content: "",
    error: false,
  });
  const [isHiddenUploadOption, setIsHiddenUploadOption] = useState(false);

  const shopify = useAppBridge();

  const handleScroll = (e) => {
    const scrollTop = e.target.scrollTop;
    if (scrollTop >= 50) {
      setIsHiddenUploadOption(true); // Hide the div
    } else {
      setIsHiddenUploadOption(false); // Show the div
    }
  };

  useEffect(() => {
    const filteredFiles = initialFiles.filter((item) => {
      // Combine into desired format
      const itemDate = item.node.createdAt.split("T")[0];

      return itemDate >= inputValues?.since && itemDate <= inputValues?.until;
    });
    filteredFiles.sort((a, b) => {
      const dateA = new Date(a?.node?.date);
      const dateB = new Date(b?.node?.date);

      // Handle invalid or missing dates
      if (isNaN(dateA) || isNaN(dateB)) return 0; // Treat as equal
      return dateA - dateB;
    });
    if (inputValues?.since && inputValues?.until) {
      setFilteredFiles(filteredFiles);
    }
  }, [inputValues, initialFiles, actionData]);

  // --- File validation constants ---
  const MAX_VIDEO_SIZE = 1 * 1024 * 1024 * 1024; // 1GB
  const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
  const VALID_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
  const VALID_VIDEO_EXTENSIONS = ["MP4", "MOV", "WebM"];
  const VALID_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ];
  const VALID_IMAGE_EXTENSIONS = ["JPG", "PNG", "GIF", "WebP", "SVG"];

  const formatFileSize = (bytes) => {
    if (bytes >= 1024 * 1024 * 1024)
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
    return bytes + " bytes";
  };

  const getFileExtension = (filename) => {
    const ext = filename?.split(".")?.pop()?.toUpperCase();
    return ext ? `.${ext}` : "unknown";
  };

  // Map Shopify error codes to user-friendly messages
  const getUploadErrorMessage = (errorCode) => {
    const errorMessages = {
      INVALID_SIGNED_URL:
        "The upload session expired. Please try uploading again.",
      INVALID_IMAGE_FILE_SIZE: "The image file size exceeds the allowed limit.",
      INVALID_IMAGE_FILE_FORMAT:
        "The image format is not supported. Please use JPG, PNG, GIF, WebP, or SVG.",
      INVALID_VIDEO_FILE_SIZE:
        "The video file size exceeds the allowed limit (max 1GB).",
      INVALID_VIDEO_FILE_FORMAT:
        "The video format is not supported. Please use MP4, MOV, or WebM.",
      MEDIA_TIMEOUT_ERROR:
        "The upload timed out. Please check your internet connection and try again.",
      FILE_STORAGE_LIMIT_EXCEEDED:
        "Your Shopify store has reached its file storage limit. Please free up space or upgrade your plan.",
      GENERIC_FILE_DOWNLOAD_FAILURE:
        "Shopify could not download the file. Please check the URL and try again.",
      EXTERNAL_VIDEO_NOT_FOUND:
        "The video could not be found. Please check the URL and try again.",
      EXTERNAL_VIDEO_UNLISTED:
        "This video is unlisted or private. Please make it public and try again.",
      EXTERNAL_VIDEO_INVALID_ASPECT_RATIO:
        "The video has an unsupported aspect ratio.",
      EXTERNAL_VIDEO_EMBED_DISABLED:
        "Embedding is disabled for this video. Please enable embedding in the video settings.",
      EXTERNAL_VIDEO_EMBED_NOT_FOUND_OR_TRANSCODING:
        "The video is still being processed or was not found. Please try again later.",
      MODEL3D_VALIDATION_ERROR: "The 3D model file is invalid.",
      UNKNOWN: "An unknown error occurred. Please try again.",
    };
    return (
      errorMessages[errorCode] ||
      `Upload failed: ${errorCode}. Please try again.`
    );
  };

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const uploadIntervalRef = useRef(null);

  useEffect(() => {
    const fileId =
      actionData?.createFileResult?.id || actionData?.status?.[0]?.id;
    if (!fileId) return;

    const fileStatus = actionData?.status?.[0]?.fileStatus;

    if (
      fileStatus === "FAILED" ||
      actionData?.status?.[0]?.fileErrors?.length > 0
    ) {
      // Upload failed — clear and show error
      if (uploadIntervalRef.current) {
        clearInterval(uploadIntervalRef.current);
        uploadIntervalRef.current = null;
      }
      toggleFileSelection(null);
      toggleImgSelection(null);
      setIsUploading(false);
      setUploadProgress(0);
      const errorCode =
        actionData?.status?.[0]?.fileErrors?.[0]?.code || "UNKNOWN";
      setToastContent({
        content: getUploadErrorMessage(errorCode),
        error: true,
      });
      setToastActive(true);
    } else if (fileStatus === "READY") {
      // File is ready — stop polling and fetch fresh list
      if (uploadIntervalRef.current) {
        clearInterval(uploadIntervalRef.current);
        uploadIntervalRef.current = null;
      }
      setUploadProgress(100);
      setIsUploading(false);
      setTimeout(() => setUploadProgress(0), 1500);
      // Fetch fresh file lists so the new file appears without reload
      submit({ refreshFiles: "true" }, { method: "PUT" });
    } else if (!fileStatus || (fileStatus && fileStatus !== "READY")) {
      // Status is still PROCESSING / UPLOADING, or we just got createFileResult with no status yet
      // → start polling
      setUploadProgress((prev) => Math.min(prev + 15, 90));
      if (!uploadIntervalRef.current) {
        uploadIntervalRef.current = setInterval(() => {
          setUploadProgress((prev) => Math.min(prev + 5, 95));
          submit({ ids: [fileId] }, { method: "PUT" });
        }, 2000);
      }
    }

    return () => {
      if (uploadIntervalRef.current) {
        clearInterval(uploadIntervalRef.current);
        uploadIntervalRef.current = null;
      }
    };
  }, [
    actionData?.createFileResult?.id,
    actionData?.status?.[0]?.fileStatus,
    actionData?.status?.[0]?.id,
  ]);

  const toggleFileSelection = useCallback((file) => {
    setSelectedFiles(file);
  }, []);
  const toggleImgSelection = useCallback((img) => {
    setSelectedImgs(img);
  }, []);

  useEffect(() => {
    const youtube = newUrl.startsWith("https://www.youtube.com");
    const vimeo = newUrl.startsWith("https://vimeo.com");
    if (youtube || vimeo) {
      setYoutubeVimeo(true);
    } else {
      setYoutubeVimeo(false);
    }
  }, [newUrl]);

  const confirmNewURL = useCallback(() => {
    if (!newUrl) return;

    const isYouTube = newUrl.match(
      /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/,
    );
    const isVimeo = newUrl.match(
      /^https?:\/\/(www\.)?(vimeo\.com\/|player\.vimeo\.com\/video\/)/,
    );

    if (!isYouTube && !isVimeo) {
      setToastContent({
        content:
          "Please enter a valid YouTube or Vimeo URL (e.g. https://www.youtube.com/watch?v=... or https://vimeo.com/...)",
        error: true,
      });
      setToastActive(true);
      return;
    }

    submit(
      {
        contentType: "EXTERNAL_VIDEO",
        originalSource: newUrl,
      },
      { method: "PUT" },
    );
    setFileToRename(null);
    setToastContent({ content: "Video URL added successfully!", error: false });
    setToastActive(true);
  }, [newUrl]);

  const toastMarkup = toastActive ? (
    <Toast
      content={toastContent.content}
      error={toastContent.error}
      onDismiss={() => setToastActive(false)}
    />
  ) : null;

  const handleDropZoneDrop = useCallback(
    (_dropFiles, acceptedFiles, _rejectedFiles) => {
      // Handle rejected files first
      if (_rejectedFiles && _rejectedFiles.length > 0) {
        const rejected = _rejectedFiles[0];
        const ext = getFileExtension(rejected.name);
        if (!VALID_VIDEO_TYPES.includes(rejected.type)) {
          setToastContent({
            content: `Unsupported file type (${ext}). Please upload ${VALID_VIDEO_EXTENSIONS.join(", ")} files only.`,
            error: true,
          });
        } else {
          setToastContent({
            content: `File rejected. Please check the file and try again.`,
            error: true,
          });
        }
        setToastActive(true);
        return;
      }

      if (acceptedFiles && acceptedFiles.length > 0) {
        const droppedFile = acceptedFiles[0];

        // Validate file type
        if (!VALID_VIDEO_TYPES.includes(droppedFile.type)) {
          setToastContent({
            content: `Unsupported file type (${getFileExtension(droppedFile.name)}). Please upload ${VALID_VIDEO_EXTENSIONS.join(", ")} files only.`,
            error: true,
          });
          setToastActive(true);
          return;
        }

        // Validate file size
        if (droppedFile.size > MAX_VIDEO_SIZE) {
          setToastContent({
            content: `File is too large (${formatFileSize(droppedFile.size)}). Maximum size for videos is 1GB.`,
            error: true,
          });
          setToastActive(true);
          return;
        }

        setFile(droppedFile);
        setIsUploading(true);
        setUploadProgress(10);
        submit(
          {
            name: droppedFile.name,
            type: droppedFile.type,
            size: droppedFile.size,
            file,
          },
          { method: "POST" },
        );
      }
    },
    [],
  );

  const handleImageDrop = useCallback(
    (_dropFiles, acceptedFiles, _rejectedFiles) => {
      // Handle rejected files first
      if (_rejectedFiles && _rejectedFiles.length > 0) {
        const rejected = _rejectedFiles[0];
        const ext = getFileExtension(rejected.name);
        if (!VALID_IMAGE_TYPES.includes(rejected.type)) {
          setToastContent({
            content: `Unsupported file type (${ext}). Please upload ${VALID_IMAGE_EXTENSIONS.join(", ")} files only.`,
            error: true,
          });
        } else {
          setToastContent({
            content: `File rejected. Please check the file and try again.`,
            error: true,
          });
        }
        setToastActive(true);
        return;
      }

      if (acceptedFiles && acceptedFiles.length > 0) {
        const droppedFile = acceptedFiles[0];

        // Validate file type
        if (!VALID_IMAGE_TYPES.includes(droppedFile.type)) {
          setToastContent({
            content: `Unsupported file type (${getFileExtension(droppedFile.name)}). Please upload ${VALID_IMAGE_EXTENSIONS.join(", ")} files only.`,
            error: true,
          });
          setToastActive(true);
          return;
        }

        // Validate file size
        if (droppedFile.size > MAX_IMAGE_SIZE) {
          setToastContent({
            content: `File is too large (${formatFileSize(droppedFile.size)}). Maximum size for images is 20MB.`,
            error: true,
          });
          setToastActive(true);
          return;
        }

        setFile(droppedFile);
        setIsUploading(true);
        setUploadProgress(10);
        submit(
          {
            name: droppedFile.name,
            type: droppedFile.type,
            size: droppedFile.size,
            file,
          },
          { method: "POST" },
        );
      }
    },
    [],
  );

  useEffect(() => {
    const uploadFile = async () => {
      if (actionData?.stagedUpload?.url && file) {
        const formDataFile = new FormData();
        actionData?.stagedUpload.parameters.forEach(({ name, value }) => {
          formDataFile.append(name, value);
        });
        formDataFile.append("file", file);

        try {
          setUploadProgress(30);
          await fetch(actionData?.stagedUpload?.url, {
            method: "POST",
            mode: "no-cors",
            body: formDataFile,
          });

          setUploadProgress(60);
          submit(
            {
              name: file.name,
              type: file.type,
              resourceUrl: actionData?.stagedUpload?.resourceUrl,
            },
            { method: "PUT" },
          );
          setFile();
          setIsUploading(false);
        } catch (error) {
          setIsUploading(false);
          setUploadProgress(0);
          setToastContent({
            content:
              "Upload failed due to a network error. Please check your internet connection and try again.",
            error: true,
          });
          setToastActive(true);
          console.error("Upload error:", error);
        }
      }
    };

    uploadFile();
  }, [actionData, file]);
  const validImageTypes = ["image/gif", "image/jpeg", "image/png"];

  const fileUpload = (
    <BlockStack gap="150" inlineAlign="center">
      <InlineStack gap="300" blockAlign="center">
        <DropZone.FileUpload />
        <Button
          onClick={(e) => {
            e.stopPropagation();
            setAddUrlModalActive(true);
          }}
          disabled={isLoading}
        >
          Upload From YouTube/Vimeo
        </Button>
      </InlineStack>
      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
        Accepted: MP4, MOV, WebM &bull; Max size: 1GB
      </Text>
    </BlockStack>
  );
  const imgUpload = (
    <BlockStack gap="150" inlineAlign="center">
      <InlineStack gap="300" blockAlign="center">
        <DropZone.FileUpload />
        <Button
          onClick={(e) => {
            e.stopPropagation();
            setAddPosterModalActive(!addPosterModalActive);
          }}
          disabled={isLoading}
        >
          Upload From URL
        </Button>
      </InlineStack>
      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
        Accepted: JPG, PNG, GIF, WebP, SVG &bull; Max size: 20MB
      </Text>
    </BlockStack>
  );
  const uploadedFile = file && (
    <LegacyStack>
      <Thumbnail
        size="small"
        alt={file.name}
        source={
          validImageTypes.includes(file.type)
            ? window.URL.createObjectURL(file)
            : NoteIcon
        }
      />
      <Box>
        {file.name}{" "}
        <Text variant="bodySm" as="p">
          {file.size} bytes
        </Text>
      </Box>
    </LegacyStack>
  );

  const options = [
    {
      label: "Grid View",
      value: "grid_view",
      prefix: <Icon source={DragHandleIcon} />,
    },
    {
      label: "List View",
      value: "list_view",
      prefix: <Icon source={ListBulletedIcon} />,
    },
  ];

  const handleSelectChange = useCallback((value) => setIsGridView(value), []);

  // useEffect(() => {
  //   if (addPosterModalActive) {
  //     shopify.modal.hide("upload-img");
  //   }
  // }, [addPosterModalActive]);

  const uploadImage = (f) => {
    submit(
      {
        name: f.name,
        type: f.type,
        resourceUrl: f?.resourceUrl,
      },
      { method: "PUT" },
    );
  };

  const loadNextPage = (fileType) => {
    submit(
      {
        endCursor:
          fileType == "video"
            ? videoPageInfo?.endCursor
            : imagePageInfo?.endCursor,
      },
      { method: "PUT" },
    );
  };
  const loadPrevPage = (fileType) => {
    submit(
      {
        startCursor:
          fileType == "video"
            ? videoPageInfo?.startCursor
            : imagePageInfo?.startCursor,
      },
      { method: "PUT" },
    );
  };

  // Function to handle device switch
  const handleDeviceChange = useCallback((device) => {
    setActiveDevice(device);
  }, []);

  // --- State Initialization: Unit is now stored PER DEVICE ---
  const [paddingState, setPaddingState] = useState(
    loaderData?.video?.styles?.padding || {
      devices: {
        desktop: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
        tablet: null,
        mobile: null,
      },
    },
  );

  const [marginState, setMarginState] = useState(
    loaderData?.video?.styles?.margin || {
      devices: {
        desktop: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
        tablet: null,
        mobile: null,
      },
    },
  );
  function formatBorderRadius(value) {
    if (!value) return null;

    // If value is a string like "5px", "10%", "1.2em", "8rem"
    if (typeof value === "string") {
      // Extract number + unit using regex
      const match = value.match(/^([\d.]+)(px|%|em|rem)$/);

      if (match) {
        const number = parseFloat(match[1]);
        const unit = match[2];

        return {
          devices: {
            desktop: {
              values: [number, number, number, number],
              isLinked: true,
              unit,
            },
            tablet: {
              values: [number, number, number, number],
              isLinked: true,
              unit,
            },
            mobile: {
              values: [number, number, number, number],
              isLinked: true,
              unit,
            },
          },
        };
      }
    }

    // If it's already formatted, just return it
    return value;
  }

  const [roundState, setRoundState] = useState(
    formatBorderRadius(loaderData?.video?.styles?.borderRadius) || {
      devices: {
        desktop: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
        tablet: null,
        mobile: null,
      },
    },
  );

  const [dimensionsState, setDimensionsState] = useState(
    loaderData?.video?.styles?.dimension || {
      devices: {
        desktop: { values: [0, 100], isLinked: false, unit: "%" }, // [Height, Width]
        tablet: { values: [0, 100], isLinked: false, unit: "%" },
        mobile: { values: [0, 100], isLinked: false, unit: "%" }, // Mobile now uses vh
      },
    },
  );
  const [ratioState, setRatioState] = useState(
    loaderData?.video?.styles?.videoRatio || {
      devices: {
        desktop: { values: [16, 9], isLinked: false, unit: "ratio" }, // 16:9
        tablet: { values: [4, 3], isLinked: false, unit: "ratio" }, // 4:3
        mobile: { values: [1, 1], isLinked: false, unit: "ratio" }, // 1:1
      },
    },
  );

  // Generic handler for value change
  const handleValueChange = useCallback(
    (key, index, rawValue) => {
      let value = parseInt(rawValue, 10);
      value = Math.max(0, value || 0); // Enforce non-negative integer

      const setStateMap = {
        padding: setPaddingState,
        margin: setMarginState,
        borderRadius: setRoundState,
        dimensions: setDimensionsState,
        ratio: setRatioState,
      };

      const setState = setStateMap[key];

      // Update the state using the functional form to ensure we have the latest data
      setState((prev) => {
        let deviceData = prev.devices[activeDevice];

        // If device data is null, initialize it from desktop data
        if (!deviceData) {
          deviceData = { ...prev.devices.desktop };
        }

        let newDeviceData = { ...deviceData };

        // 1. Determine new values array
        let newValues = [...newDeviceData.values];

        // Only apply linking logic if it's a padding or margin group AND linked
        if (
          newDeviceData.isLinked &&
          (key === "padding" || key === "margin" || key === "borderRadius")
        ) {
          newValues = newValues.map(() => value); // Set all to the new value
        } else {
          newValues[index] = value; // Update specific index
        }

        newDeviceData.values = newValues;

        // 2. Return the new overall state object, updating only the active device's data
        return {
          ...prev,
          devices: {
            ...prev.devices,
            [activeDevice]: newDeviceData,
          },
        };
      });
    },
    [activeDevice],
  ); // activeDevice is required here

  // Generic handler for unit change (Unit is now defined per device)
  const handleUnitChange = useCallback(
    (key, newUnit) => {
      const setStateMap = {
        padding: setPaddingState,
        margin: setMarginState,
        borderRadius: setRoundState,
        dimensions: setDimensionsState,
        ratio: setRatioState,
      };

      const setState = setStateMap[key];

      setState((prev) => {
        let deviceData = prev.devices[activeDevice];

        // If device data is null, initialize it from desktop data
        if (!deviceData) {
          deviceData = { ...prev.devices.desktop };
        }

        // Update only the unit for the currently active device
        const newDeviceData = { ...deviceData, unit: newUnit };

        return {
          ...prev,
          devices: {
            ...prev.devices,
            [activeDevice]: newDeviceData,
          },
        };
      });
    },
    [activeDevice],
  ); // activeDevice is required here to know which unit to update

  // Generic handler for link toggle (only used for padding/margin)
  const handleLinkToggle = useCallback(
    (key) => {
      const setState =
        key === "padding"
          ? setPaddingState
          : key === "borderRadius"
            ? setRoundState
            : setMarginState;

      setState((prev) => {
        let deviceData = prev.devices[activeDevice];

        // If device data is null, initialize it from desktop data
        if (!deviceData) {
          deviceData = { ...prev.devices.desktop };
        }

        let isNowLinked = !deviceData.isLinked;
        let newDeviceData = { ...deviceData, isLinked: isNowLinked };

        // When linking, set all values to the Top value for consistency
        let newValues = [...newDeviceData.values];
        if (isNowLinked) {
          const topValue = newValues[0];
          newValues = [topValue, topValue, topValue, topValue];
        }

        newDeviceData.values = newValues;

        return {
          ...prev,
          devices: {
            ...prev.devices,
            [activeDevice]: newDeviceData,
          },
        };
      });
    },
    [activeDevice],
  );

  // Get the currently active device's data for each group
  // If tablet/mobile are null, fallback to desktop values
  const currentPaddingData =
    paddingState.devices[activeDevice] || paddingState.devices.desktop;
  const currentMarginData =
    marginState.devices[activeDevice] || marginState.devices.desktop;
  const currentRoundData =
    roundState.devices[activeDevice] || roundState.devices.desktop;
  const currentDimensionsData = dimensionsState.devices[activeDevice];
  const currentRatioData = ratioState.devices[activeDevice];

  useEffect(() => {
    const controls = [
      controlsByDevice?.[activeDevice]?.playLarge && "play-large",
      controlsByDevice?.[activeDevice]?.restart && "restart",
      controlsByDevice?.[activeDevice]?.rewind && "rewind",
      controlsByDevice?.[activeDevice]?.play && "play",
      controlsByDevice?.[activeDevice]?.fastForward && "fast-forward",
      controlsByDevice?.[activeDevice]?.progress && "progress",
      controlsByDevice?.[activeDevice]?.currentTime && "current-time",
      controlsByDevice?.[activeDevice]?.duration && "duration",
      controlsByDevice?.[activeDevice]?.muted && "mute",
      controlsByDevice?.[activeDevice]?.volume && "volume",
      controlsByDevice?.[activeDevice]?.pip && "pip",
      controlsByDevice?.[activeDevice]?.airplay && "airplay",
      controlsByDevice?.[activeDevice]?.settings && "settings",
      controlsByDevice?.[activeDevice]?.download && "download",
      controlsByDevice?.[activeDevice]?.fullscreen && "fullscreen",
    ].filter(Boolean);

    const playerOptions = {
      autoPlay,
      poster,
      muted: mutedOptions,
      controls: controls,
      debug: false,
      loop: { active: repeat },
      playsInline: true,
      hideControls,
    };

    // Caption support for the preview.
    //
    // Configured UNCONDITIONALLY (whenever captions could apply), not only when
    // tracks already exist. The controls list is fixed at init — Plyr builds its
    // control bar once — so if we only added the "captions" control when tracks
    // were present, the merchant's first upload would need a full player
    // rebuild to get a CC button, and rebuilding is exactly what broke the
    // preview. With the control always present, Plyr hides it by itself until
    // tracks exist, and `update: true` makes Plyr watch media.textTracks so
    // <track> elements React adds later are picked up live.
    // Skipped for YouTube/Vimeo: their embeds have no <video> to attach to.
    if (isPremium && !isEmbeddedProvider) {
      if (!playerOptions.controls.includes("captions")) {
        playerOptions.controls = [...playerOptions.controls, "captions"];
      }
      // The language picker lives in the settings menu, which Plyr only renders
      // when "settings" is among the controls — so override the merchant's
      // choice only when there are several languages to switch between.
      if (
        previewNeedsSettingsForCaptions &&
        !playerOptions.controls.includes("settings")
      ) {
        playerOptions.controls = [...playerOptions.controls, "settings"];
      }
      playerOptions.settings = ["captions", "quality", "speed"];
      // Start on the merchant's default track, not Plyr's "auto" (which would
      // follow the admin's own browser language and ignore the chosen default).
      const defaultPreviewTrack =
        previewCaptionTracks.find((t) => t.default) || previewCaptionTracks[0];
      playerOptions.captions = {
        active: previewCaptionTracks.some((t) => t.default),
        language: (defaultPreviewTrack?.srclang || "en").toLowerCase(),
        update: true,
      };
    }

    let playerInstance = null;
    const interval = setInterval(() => {
      const media = playerRef.current;
      if (!media) return;

      if (player) player.destroy();

      if (autoPlay || mutedOptions) {
        try {
          localStorage.removeItem("plyr");
        } catch (e) {}
      }

      playerInstance = new Plyr(media, playerOptions);

      // Plyr re-runs its captions setup() on every language pick from the
      // settings menu, and that re-reads config.captions — with Plyr storage
      // unused here, the merchant's default would be re-applied and override
      // the selection. Keep config in step with the live state so switching
      // language and "Disabled" both stick. (Same fix as the storefront.)
      if (playerOptions.captions) {
        const syncCaptionConfig = () => {
          try {
            if (!playerInstance?.config?.captions) return;
            if (playerInstance.captions?.language) {
              playerInstance.config.captions.language =
                playerInstance.captions.language;
            }
            playerInstance.config.captions.active =
              !!playerInstance.captions?.toggled;
          } catch (e) {}
        };
        playerInstance.on("languagechange", syncCaptionConfig);
        playerInstance.on("captionsenabled", syncCaptionConfig);
        playerInstance.on("captionsdisabled", syncCaptionConfig);
      }

      setPlayer(playerInstance);
      clearInterval(interval);

      if (
        videoType === "youtube" ||
        videoType === "vimeo" ||
        url?.startsWith("https://youtu") ||
        url?.startsWith("https://vimeo") ||
        url?.startsWith("https://www.youtube") ||
        url?.startsWith("https://player.vimeo.com/video")
      ) {
        setTimeout(() => {
          document.querySelectorAll(".plyr__poster").forEach((el) => {
            el.style.backgroundImage = `url(${poster})`;
            el.style.backgroundSize = "cover";
          });
        }, 600);
      }
      setIsVideoReady(true);
    }, 100);

    return () => {
      clearInterval(interval);
      if (playerInstance) playerInstance.destroy();
      else if (player) player.destroy();
    };
  }, [
    url,
    // Read by the effect (provider checks / isEmbeddedProvider) — it changes
    // alongside `url` in practice, but list it so the two can't drift.
    videoType,
    poster,
    activeDevice,
    controlsByDevice,
    mutedOptions,
    autoPlay,
    repeat,
    hideControls,
    uploadedAndSelectedFile,
    uploadedAndSelectedImg,
    brandColor,
    roundState,
    paddingState,
    marginState,
    dimensionsState,
    ratioState,
    watermark,
    overlay,
    // A plain boolean, so unlike the tracks themselves it only changes when the
    // count crosses one track — never while a caption is being edited. Safe to
    // depend on, and the player does need rebuilding when it flips, because the
    // controls list is fixed at init.
    previewNeedsSettingsForCaptions,
    // NOTE: captions are deliberately NOT a dependency here. Rebuilding the
    // Plyr instance on every caption change is what made the preview break
    // when uploading or editing a subtitle track. Instead the caption controls
    // are always configured above, React renders the <track> elements, and
    // Plyr's own textTracks watcher (captions.update: true) picks up additions
    // and removals live. The separate effect below applies the merchant's
    // chosen default track to the running player.
  ]);

  // Apply caption changes to the LIVE preview player rather than rebuilding it.
  // Plyr discovers added/removed <track> elements on its own, so all that's left
  // is selecting whichever track the merchant marked as default (or switching
  // captions off when none is). Deferred a tick so the browser has registered
  // the new <track> in media.textTracks before we index into them.
  useEffect(() => {
    if (!player || !isPremium || isEmbeddedProvider) return;
    const defaultIndex = previewCaptionTracks.findIndex((t) => t.default);
    const timer = setTimeout(() => {
      try {
        if (defaultIndex >= 0) {
          // Setting currentTrack also switches captions on.
          player.currentTrack = defaultIndex;
        } else if (player.captions?.toggled) {
          player.toggleCaptions(false);
        }
      } catch (e) {
        /* player torn down mid-timeout — nothing to do */
      }
    }, 120);
    return () => clearTimeout(timer);
    // captionTrackKey is a stable string: it changes when a track is added or
    // removed, its language changes, or a different track becomes default —
    // but NOT while a label is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, captionTrackKey, isPremium, isEmbeddedProvider]);

  const save = () => {
    const controls = {
      playLarge,
      restart,
      rewind,
      play,
      fastForward,
      progress,
      currentTime,
      duration,
      muted,
      volume,
      pip,
      airplay,
      settings,
      download,
      fullscreen,
    };
    const styles = {
      width,
      brandColor,
      borderRadius: roundState || round,
      padding: paddingState,
      margin: marginState,
      dimension: dimensionsState,
      videoRatio: ratioState,
    };

    const options = { muted: mutedOptions, autoHideControls: hideControls };

    // Video and poster are both required on a single-video player. A grid
    // player has neither field — each of its items carries its own video — so
    // it is exempt.
    const missing = [];
    if (!isMultiplePlayer) {
      if (!url || !String(url).trim()) missing.push("video");
      if (!poster || !String(poster).trim()) missing.push("poster");
    }

    if (missing.length) {
      setToastContent({
        content: `Please add a ${missing.join(" and ")} before saving.`,
        error: true,
      });
      setToastActive(true);
      return;
    }

    // Password protection is only valid with a 4-10 character alphanumeric
    // password, so block the save rather than storing an unusable one.
    if (!isMultiplePlayer && passwordProtect?.enabled) {
      const passwordIssue = getPasswordError(passwordProtect?.password);
      if (passwordIssue) {
        setToastContent({ content: passwordIssue, error: true });
        setToastActive(true);
        return;
      }
    }

    const canSave = true;

    if (canSave) {
      const saveData = {
        id: location?.pathname?.split("/")[3],
        title,
        videoType,
        url: url || "",
        youtube,
        vimeo,
        resetOnEnd,
        poster: poster || "",
        autoPlay,
        repeat,
        passwordProtected: null,
        watermark: null,
        overlay: null,
        captions: null,
        controls: JSON.stringify(controls),
        controlsByDevice: null,
        styles: JSON.stringify(styles),
        options: JSON.stringify(options),
        playerType: playerType,
      };

      // Include multi-video data
      if (isMultiplePlayer) {
        saveData.multiItems = JSON.stringify(multiItems);
        saveData.gridSettings = JSON.stringify(gridSettings);
      }

      if (isPremium) {
        saveData.passwordProtected = JSON.stringify(passwordProtect);
        saveData.watermark = JSON.stringify(watermark);
        saveData.overlay = JSON.stringify(overlay);
        saveData.captions = JSON.stringify(captions);
        saveData.controlsByDevice = JSON.stringify(controlsByDevice);
      } else {
        saveData.styles = JSON.stringify({
          width,
          brandColor,
          borderRadius: {
            devices: {
              desktop: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
              tablet: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
              mobile: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
            },
          },
          padding: {
            devices: {
              desktop: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
              tablet: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
              mobile: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
            },
          },
          margin: {
            devices: {
              desktop: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
              tablet: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
              mobile: { values: [0, 0, 0, 0], isLinked: true, unit: "px" },
            },
          },
          dimension: {
            devices: {
              desktop: { values: [0, 100], isLinked: false, unit: "%" },
              tablet: { values: [0, 100], isLinked: false, unit: "%" },
              mobile: { values: [0, 100], isLinked: false, unit: "%" },
            },
          },
          videoRatio: {
            devices: {
              desktop: { values: [16, 9], isLinked: false, unit: "ratio" },
              tablet: { values: [4, 3], isLinked: false, unit: "ratio" },
              mobile: { values: [1, 1], isLinked: false, unit: "ratio" },
            },
          },
        });
      }

      return submit(saveData, { method: "PUT" });
    } else {
      return console.error("Please enter a valid Data", { url: url });
    }
  };

  // ✅ 1. Initialize the ref (this persists across renders)
  const isFirstLoad = useRef(true);

  useEffect(() => {
    if (!isFirstLoad.current) {
      if (autoPlay) {
        // Autoplay requires muted — force it and clear Plyr's localStorage
        // so it doesn't override the muted state on next init
        setMutedOptions(true);
        try {
          localStorage.removeItem("plyr");
        } catch (e) {
          /* ignore */
        }
      }
    } else {
      isFirstLoad.current = false;
    }
  }, [autoPlay]); // Only re-run when autoPlay changes

  useEffect(() => {
    document.querySelectorAll(".plyr__poster").forEach((el) => {
      el.style.backgroundSize = "cover";
      el.style.opacity = "1";
    });
  });

  const previewGridOptions = useMemo(() => {
    const computedControls = [
      controlsByDevice?.[activeDevice]?.playLarge && "play-large",
      controlsByDevice?.[activeDevice]?.restart && "restart",
      controlsByDevice?.[activeDevice]?.rewind && "rewind",
      controlsByDevice?.[activeDevice]?.play && "play",
      controlsByDevice?.[activeDevice]?.fastForward && "fast-forward",
      controlsByDevice?.[activeDevice]?.progress && "progress",
      controlsByDevice?.[activeDevice]?.currentTime && "current-time",
      controlsByDevice?.[activeDevice]?.duration && "duration",
      controlsByDevice?.[activeDevice]?.muted && "mute",
      controlsByDevice?.[activeDevice]?.volume && "volume",
      controlsByDevice?.[activeDevice]?.pip && "pip",
      controlsByDevice?.[activeDevice]?.airplay && "airplay",
      controlsByDevice?.[activeDevice]?.settings && "settings",
      controlsByDevice?.[activeDevice]?.download && "download",
      controlsByDevice?.[activeDevice]?.fullscreen && "fullscreen",
    ].filter(Boolean);

    return {
      autoPlay,
      muted: mutedOptions,
      controls: computedControls.length ? computedControls : undefined,
      debug: false,
      loop: { active: repeat },
      playsInline: true,
      hideControls,
    };
  }, [
    controlsByDevice,
    activeDevice,
    autoPlay,
    mutedOptions,
    repeat,
    hideControls,
  ]);

  const [copying, setCopying] = useState({ embedCode: false, id: false });

  const handleCopy = (type) => {
    setCopying({ ...copying, [type]: true });
    setTimeout(() => {
      setCopying({ ...copying, [type]: false });
    }, 1000);
  };

  const playerReinitKey = JSON.stringify({
    controlsByDevice,
    autoPlay,
    mutedOptions,
    repeat,
    hideControls,
    brandColor,
    roundState,
    paddingState,
    marginState,
    dimensionsState,
    ratioState,
    videoType,
    url,
    poster,
    activeDevice,
    watermark,
    overlay,
  });

  return (
    <Box>
      <Frame>
        <div className="header">
          <InlineStack gap="small-200" alignItems="center">
            <Button
              icon={ChevronLeftIcon}
              variant="tertiary"
              accessibilityLabel="Back"
              onClick={goBack}
            />
            <Text as="h3" variant="headingMd">
              Player Settings
            </Text>
          </InlineStack>

          {/* Device switcher. The bespoke silhouettes stay as inline SVG —
              polaris-1.js has no desktop/tablet/mobile icon. The active state
              is now s-button's primary variant rather than a green top rule,
              because s-button renders into shadow DOM and cannot take the
              brand colour (see app/utils/polarisWebComponents.js). */}
          <ButtonGroup segmented>
            <Button
              size="micro"
              pressed={activeDevice === "desktop"}
              aria-pressed={activeDevice === "desktop"}
              accessibilityLabel="Desktop preview"
              onClick={() => setActiveDevice("desktop")}
            >
              <DesktopIcon active={activeDevice === "desktop"} />
            </Button>
            <Button
              size="micro"
              pressed={activeDevice === "tablet"}
              aria-pressed={activeDevice === "tablet"}
              accessibilityLabel="Tablet preview"
              onClick={() => setActiveDevice("tablet")}
            >
              <TabletIcon active={activeDevice === "tablet"} />
            </Button>
            <Button
              size="micro"
              pressed={activeDevice === "mobile"}
              aria-pressed={activeDevice === "mobile"}
              accessibilityLabel="Mobile preview"
              onClick={() => setActiveDevice("mobile")}
            >
              <MobileIcon active={activeDevice === "mobile"} />
            </Button>
          </ButtonGroup>

          <ButtonGroup>
            <Button
              icon={copying.embedCode ? CheckIcon : ClipboardIcon}
              onClick={() => {
                handleCopy("embedCode");
                navigator.clipboard.writeText(
                  `<div class="video-plyr-by-bplugins" data-id="${loaderData?.id}"></div>`,
                );
                shopify.toast.show("Successfully Copy Embed Code!!");
              }}
            >
              Copy Embed Code
            </Button>
            <Button
              icon={copying.id ? CheckIcon : ClipboardIcon}
              onClick={() => {
                handleCopy("id");
                navigator.clipboard.writeText(loaderData?.id);
                shopify.toast.show("Successfully Copy ID!!");
              }}
            >
              Copy ID
            </Button>
            <Button
              variant="primary"
              disabled={
                Boolean(passwordError) ||
                (isMultiplePlayer ? !title : !url || !title || !poster)
              }
              loading={flag(loading)}
              onClick={() => {
                if (isMultiplePlayer || url) {
                  save();
                  shopify.toast.show("Successfully Saving...");
                } else {
                  shopify.toast.show("Please Provide Valid URL !", {
                    isError: true,
                  });
                }
              }}
            >
              Save
            </Button>
          </ButtonGroup>
        </div>
        <div className="main-container">
          <div className="sidebar">
            <Accordion
              defaultOpenId={
                isMultiplePlayer ? "Video Items" : "Global Settings"
              }
            >
              {/* <Text as="h3" variant="headingMd" class="title">Player Settings</Text> */}
              {/* Video Items section - only for Multiple Video Player */}
              {isMultiplePlayer && (
                <Collapse
                  title="Video Items"
                  height={600}
                  defaultOpen={true}
                  leftIcon={<Icon source={ListBulletedIcon} />}
                >
                  <MultipleVideoItems
                    items={multiItems}
                    setItems={setMultiItems}
                    shopify={shopify}
                    videoFiles={videoFiles}
                    imageFiles={imageFiles}
                    toggleFileSelection={toggleFileSelection}
                    toggleImgSelection={toggleImgSelection}
                    setUploadedAndSelectedFile={setUploadedAndSelectedFile}
                    setUploadedAndSelectedImg={setUploadedAndSelectedImg}
                    activeItemIndex={activeItemIndex}
                    setActiveItemIndex={setActiveItemIndex}
                  />
                </Collapse>
              )}

              <Collapse
                title="Global Settings"
                height={600}
                defaultOpen={!isMultiplePlayer}
                leftIcon={<Icon source={GlobeIcon} />}
              >
                <TextInput
                  type="text"
                  label="Title"
                  position="top"
                  inputStyle={{ maxWidth: "100%", margin: "5px 0 15px 0" }}
                  style={{ display: "grid", padding: "0px" }}
                  value={title}
                  onChange={setTitle}
                />

                {/* Video and Poster inputs - hidden for multiple player */}
                {!isMultiplePlayer && (
                  <>
                    <UploadField
                      label="Add Video"
                      required
                      value={url}
                      onChange={(next) => {
                        // Re-derive the provider from the pasted link. Without
                        // this, videoType kept its old value and a YouTube or
                        // Vimeo URL was saved as "html5" — which the storefront
                        // then tried to play as a raw media file.
                        setUrl(next);
                        setVideoType(detectVideoType(next));
                      }}
                      pickLabel="Choose a video"
                      onPick={() => {
                        videoFiles.filter((file) => {
                          const currentUrl =
                            file?.node?.mediaContentType === "VIDEO"
                              ? file?.node?.sources?.find(
                                  (a) => a.format == "mp4",
                                )?.url
                              : file?.node?.url || file?.node?.embedUrl;
                          if (currentUrl === url) {
                            return toggleFileSelection(file?.node);
                          }
                        });
                        shopify.modal.show("upload-video");
                      }}
                    />

                    {codecWarning && (
                      <Box paddingBlockEnd="300">
                        <Banner
                          tone="warning"
                          title={`This video is ${codecWarning.name}`}
                        >
                          <Text as="p">
                            Chrome and Firefox cannot play {codecWarning.name},
                            so most visitors will see an empty player even
                            though it plays here. Re-encode the file as H.264
                            MP4, or add it to Shopify as a{" "}
                            <Text as="span" fontWeight="bold">
                              Video
                            </Text>{" "}
                            (Shopify transcodes those automatically) instead of
                            as a file under Content &rarr; Files.
                          </Text>
                        </Banner>
                      </Box>
                    )}

                    <UploadField
                      label="Add Poster"
                      required
                      value={poster}
                      onChange={setPoster}
                      disabled={isLoading}
                      pickLabel="Choose a poster image"
                      onPick={() => {
                        shopify.modal.show("upload-img");
                        imageFiles.filter((file) => {
                          const currentUrl =
                            file?.node?.preview?.image?.url ||
                            file?.node?.preview?.image?.src;
                          if (currentUrl === poster) {
                            return toggleImgSelection(file?.node);
                          }
                        });
                      }}
                    />
                  </>
                )}

                <Divider />
                <ColorController
                  label="Select Brand Color"
                  value={brandColor}
                  onChange={setBrandColor}
                />
                <Divider />

                <ToggleControl
                  label="Repeat"
                  value={repeat}
                  onChange={setRepeat}
                />
                <ToggleControl
                  label="Autoplay"
                  value={autoPlay}
                  onChange={setAutoPlay}
                  details={`${isMultiplePlayer ? "If enable auto play then auto play only first video, " : ""} Autoplay might require muting based on the browser.`}
                  detailsTone="warning"
                />
                <ToggleControl
                  label="Muted"
                  value={mutedOptions}
                  onChange={setMutedOptions}
                />
                <ToggleControl
                  label="Reset On End"
                  value={resetOnEnd}
                  onChange={setResetOnEnd}
                />
                <ToggleControl
                  label="Auto Hide Controls"
                  value={hideControls}
                  onChange={setHideControls}
                />
              </Collapse>

              {/* Grid Settings section - only for Multiple Video Player */}
              {isMultiplePlayer && (
                <Collapse
                  title="Grid / Layout Settings"
                  height={600}
                  leftIcon={<Icon source={LayoutBlockIcon} />}
                >
                  <GridSettings
                    gridSettings={gridSettings}
                    setGridSettings={setGridSettings}
                    activeDevice={activeDevice}
                  />
                </Collapse>
              )}

              <Collapse
                title="Controls by device"
                height={600}
                pro={!isPremium}
                leftIcon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" />
                    <path d="M10 19v-3.96 3.15" />
                    <path d="M7 19h5" />
                    <rect width="6" height="10" x="16" y="12" rx="2" />
                  </svg>
                }
              >
                <>
                  {/* Device switch. Was .sc-dev-switch/.sc-dev-btn, styled from
                    SpacingControl.css — a stylesheet that only reached the page
                    as a side effect of importing a component this route never
                    rendered. It matches the header and GridSettings switchers
                    now, so it no longer depends on that. */}
                  <Box
                    paddingBlockStart="small-400"
                    paddingBlockEnd="small-300"
                  >
                    <ButtonGroup>
                      {["desktop", "tablet", "mobile"].map((d) => (
                        <Button
                          key={d}
                          variant={activeDevice === d ? "primary" : "secondary"}
                          aria-pressed={activeDevice === d}
                          onClick={() => setActiveDevice(d)}
                        >
                          {d}
                        </Button>
                      ))}
                    </ButtonGroup>
                  </Box>

                  <ToggleControl
                    label="Play Large"
                    value={controlsByDevice?.[activeDevice]?.playLarge}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          playLarge: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Restart"
                    value={controlsByDevice?.[activeDevice]?.restart}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          restart: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Rewind"
                    value={controlsByDevice?.[activeDevice]?.rewind}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          rewind: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Play"
                    value={controlsByDevice?.[activeDevice]?.play}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          play: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Fast Forward"
                    value={controlsByDevice?.[activeDevice]?.fastForward}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          fastForward: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Progress"
                    value={controlsByDevice?.[activeDevice]?.progress}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          progress: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Current Time"
                    value={controlsByDevice?.[activeDevice]?.currentTime}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          currentTime: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Duration"
                    value={controlsByDevice?.[activeDevice]?.duration}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          duration: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Mute"
                    value={controlsByDevice?.[activeDevice]?.muted}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          muted: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Volume"
                    value={controlsByDevice?.[activeDevice]?.volume}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          volume: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="PIP"
                    value={
                      videoType === "youtube" || videoType === "vimeo"
                        ? false
                        : controlsByDevice?.[activeDevice]?.pip
                    }
                    disabled={videoType === "youtube" || videoType === "vimeo"}
                    details={
                      "Picture-in-Picture is not supported for YouTube/Vimeo videos."
                    }
                    detailsTone="warning"
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          pip: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Airplay"
                    value={controlsByDevice?.[activeDevice]?.airplay}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          airplay: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Settings"
                    value={controlsByDevice?.[activeDevice]?.settings}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          settings: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Download"
                    value={controlsByDevice?.[activeDevice]?.download}
                    disabled={videoType === "youtube" || videoType === "vimeo"}
                    details={
                      "Download is not supported for YouTube/Vimeo videos."
                    }
                    detailsTone="warning"
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          download: newValue,
                        },
                      }))
                    }
                  />
                  <ToggleControl
                    label="Fullscreen"
                    value={controlsByDevice?.[activeDevice]?.fullscreen}
                    onChange={(newValue) =>
                      setControlsByDevice((prev) => ({
                        ...prev,
                        [activeDevice]: {
                          ...prev[activeDevice],
                          fullscreen: newValue,
                        },
                      }))
                    }
                  />
                </>
                {/* )} */}
              </Collapse>
              {!isMultiplePlayer && (
                <Collapse
                  title="Password Protect"
                  height={600}
                  pro={!isPremium}
                  leftIcon={<Icon source={ShieldCheckMarkIcon} />}
                  activeOption={passwordProtect?.enabled}
                >
                  <ToggleControl
                    label="Enable Password Protect"
                    value={passwordProtect?.enabled}
                    onChange={(newValue) =>
                      setPasswordProtect((prev) => ({
                        ...prev,
                        enabled: newValue,
                      }))
                    }
                  />
                  {passwordProtect?.enabled && (
                    <>
                      <TextInput
                        type="password"
                        label="Password"
                        requiredIndicator={true}
                        minLength={PASSWORD_MIN_LENGTH}
                        maxLength={PASSWORD_MAX_LENGTH}
                        helpText={`${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters. Letters, numbers and symbols are allowed — no spaces.`}
                        error={passwordError}
                        position="top"
                        inputStyle={{
                          maxWidth: "100%",
                          margin: "5px 0 15px 0",
                        }}
                        style={{ display: "grid", padding: "0px" }}
                        value={passwordProtect?.password}
                        onChange={(newValue) =>
                          setPasswordProtect((prev) => ({
                            ...prev,
                            password: sanitizePassword(newValue),
                          }))
                        }
                      />
                      <TextInput
                        type="text"
                        label="Heading"
                        position="top"
                        inputStyle={{
                          maxWidth: "100%",
                          margin: "5px 0 15px 0",
                        }}
                        style={{ display: "grid", padding: "0px" }}
                        value={passwordProtect?.title}
                        onChange={(newValue) =>
                          setPasswordProtect((prev) => ({
                            ...prev,
                            title: newValue,
                          }))
                        }
                      />
                      <TextInput
                        type="text"
                        label="Password Incorrect message"
                        position="top"
                        inputStyle={{
                          maxWidth: "100%",
                          margin: "5px 0 15px 0",
                        }}
                        style={{ display: "grid", padding: "0px" }}
                        value={passwordProtect?.message}
                        onChange={(newValue) =>
                          setPasswordProtect((prev) => ({
                            ...prev,
                            message: newValue,
                          }))
                        }
                      />
                      <TextInput
                        type="text"
                        label="Button Text"
                        position="top"
                        inputStyle={{
                          maxWidth: "100%",
                          margin: "5px 0 15px 0",
                        }}
                        style={{ display: "grid", padding: "0px" }}
                        value={passwordProtect?.buttonText}
                        onChange={(newValue) =>
                          setPasswordProtect((prev) => ({
                            ...prev,
                            buttonText: newValue,
                          }))
                        }
                      />
                    </>
                  )}
                </Collapse>
              )}

              <Collapse
                title="Watermark"
                height={600}
                pro={!isPremium}
                leftIcon={<Icon source={ColorNoneIcon} />}
                activeOption={watermark?.enabled}
              >
                <ToggleControl
                  label="Enabe Watermark"
                  value={watermark?.enabled}
                  onChange={(newValue) =>
                    setWatermark((prev) => ({ ...prev, enabled: newValue }))
                  }
                />
                {watermark.enabled && (
                  <>
                    <SelectInput
                      position="top"
                      label="Watermark Type"
                      options={[
                        { label: "Custom Text", value: "text" },
                        { label: "Domain", value: "domain" },
                      ]}
                      value={watermark?.type}
                      onChange={(newValue) =>
                        setWatermark((prev) => ({ ...prev, type: newValue }))
                      }
                    />
                    {watermark?.type === "text" && (
                      <TextInput
                        type="text"
                        label="Custom Watermark Text"
                        position="top"
                        inputStyle={{
                          maxWidth: "100%",
                          margin: "5px 0 15px 0",
                        }}
                        style={{ display: "grid", padding: "0px" }}
                        value={watermark?.text}
                        onChange={(newValue) =>
                          setWatermark((prev) => ({ ...prev, text: newValue }))
                        }
                      />
                    )}

                    <ColorController
                      label="Watermark Color"
                      value={watermark.color}
                      onChange={(newValue) =>
                        setWatermark((prev) => ({ ...prev, color: newValue }))
                      }
                    />
                  </>
                )}
              </Collapse>

              {/* Captions are per-video, so they only apply to a single-video
                player. A grid player holds many different videos, which would
                each need their own subtitle file. YouTube and Vimeo are also
                excluded — see isEmbeddedProvider. */}
              {!isMultiplePlayer && !isEmbeddedProvider && (
                <Collapse
                  title="Captions / Subtitles"
                  height={600}
                  pro={!isPremium}
                  leftIcon={
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <path d="M7 15h4M14 15h3" />
                    </svg>
                  }
                  activeOption={
                    captions?.enabled && captions?.tracks?.length > 0
                  }
                >
                  <ToggleControl
                    label="Enable Captions"
                    details="Upload .srt or .vtt files — one per language. Viewers switch language from the player's settings menu."
                    value={captions?.enabled}
                    onChange={(newValue) =>
                      setCaptions((prev) => ({ ...prev, enabled: newValue }))
                    }
                  />

                  {captions?.enabled && (
                    <>
                      {(captions?.tracks || []).length > 0 && (
                        <>
                          <div
                            className={`vp-cap-chips${capDragIndex !== null ? " dragging" : ""}`}
                            onDragOver={capDnd.overContainer}
                            onDrop={capDnd.drop}
                          >
                            {(captions.tracks || []).map((t, i) => (
                              <React.Fragment key={i}>
                                {capInsertAt === i && capDragIndex !== null && (
                                  <span
                                    className="vp-cap-bar"
                                    aria-hidden="true"
                                  />
                                )}
                                <CustomButton
                                  type="button"
                                  draggable
                                  onDragStart={(e) => capDnd.start(e, i)}
                                  onDragOver={(e) => capDnd.over(e, i)}
                                  onDrop={capDnd.drop}
                                  onDragEnd={capDnd.end}
                                  onKeyDown={(e) => capDnd.keyDown(e, i)}
                                  onClick={() => {
                                    // Ignore the stray click that can follow a drop.
                                    if (capDraggedRef.current) return;
                                    setDefaultCaptionTrack(i);
                                  }}
                                  className={`vp-cap-chip${t.default ? " is-default" : ""}${
                                    capDragIndex === i ? " is-dragging" : ""
                                  }`}
                                  title={
                                    t.default
                                      ? `${languageName(t.srclang)} — shown by default. Drag or press ← → to reorder.`
                                      : `Click to make ${languageName(t.srclang)} the default. Drag or press ← → to reorder.`
                                  }
                                >
                                  {t.default && (
                                    <Text as="span" aria-hidden="true">
                                      ★
                                    </Text>
                                  )}
                                  {languageName(t.srclang)}
                                </CustomButton>
                              </React.Fragment>
                            ))}
                            {/* Marker for dropping after the last chip. */}
                            {capDragIndex !== null &&
                              capInsertAt ===
                                (captions.tracks || []).length && (
                                <span
                                  className="vp-cap-bar"
                                  aria-hidden="true"
                                />
                              )}
                          </div>
                          <Box paddingBlockEnd="150">
                            <Text as="p" variant="bodyXs" tone="subdued">
                              Click a language to show it by default (★). Drag —
                              or focus a chip and press ← → — to change the
                              order they appear in the player's menu.
                            </Text>
                          </Box>
                        </>
                      )}

                      {(captions?.tracks || []).map((track, index) => (
                        <div
                          key={index}
                          className={`vp-cap-track${
                            duplicateCaptionLangs.has(
                              (track.srclang || "").toLowerCase(),
                            )
                              ? " is-duplicate"
                              : ""
                          }`}
                        >
                          <InlineStack
                            gap="200"
                            blockAlign="center"
                            align="space-between"
                          >
                            <Text
                              as="span"
                              variant="bodySm"
                              fontWeight="semibold"
                              truncate
                            >
                              {track?.filename
                                ? track.filename
                                : "Unnamed file"}
                            </Text>
                            <Button
                              tone="critical"
                              accessibilityLabel={`Remove ${track.filename || "caption track"}`}
                              onClick={() => removeCaptionTrack(index)}
                            >
                              Remove
                            </Button>
                          </InlineStack>

                          <TextInput
                            type="text"
                            label="Label shown in player"
                            position="top"
                            inputStyle={{
                              maxWidth: "100%",
                              margin: "5px 0 10px 0",
                            }}
                            style={{ display: "grid", padding: "0px" }}
                            value={track.label}
                            onChange={(newValue) =>
                              updateCaptionTrack(index, { label: newValue })
                            }
                          />

                          <SelectInput
                            position="top"
                            label="Language"
                            options={CAPTION_LANGUAGE_OPTIONS}
                            value={track.srclang}
                            onChange={(newValue) =>
                              updateCaptionTrack(index, {
                                srclang: newValue,
                                // Keep the player label in step with the language
                                // unless the merchant renamed it themselves.
                                label:
                                  track.label === languageName(track.srclang)
                                    ? languageName(newValue)
                                    : track.label,
                              })
                            }
                          />

                          {duplicateCaptionLangs.has(
                            (track.srclang || "").toLowerCase(),
                          ) && (
                            <Text as="span" tone="critical">
                              Another track uses this language — pick a
                              different one so viewers can tell them apart.
                            </Text>
                          )}

                          <ToggleControl
                            label="Show by default"
                            value={!!track.default}
                            onChange={(newValue) =>
                              newValue
                                ? setDefaultCaptionTrack(index)
                                : updateCaptionTrack(index, { default: false })
                            }
                          />
                        </div>
                      ))}

                      {(captions?.tracks || []).length === 0 &&
                        !captionError && (
                          <Box paddingBlockStart="200">
                            <Text as="p" variant="bodySm" tone="subdued">
                              No caption files yet. Select several files at once
                              to add multiple languages — SRT is converted to
                              WebVTT automatically, and a language named in the
                              filename (like
                              <code> subs.es.srt</code>) is detected for you.
                            </Text>
                          </Box>
                        )}

                      {/* Sticky upload bar: stays pinned to the bottom of the
                        Collapse's scroll area, so the add button is reachable
                        no matter how many language tracks are listed above.
                        Negative margins bleed it to the panel edges (the
                        .collapse-content padding is 10px 15px), and `bottom`
                        cancels that bottom padding so it sits flush. */}
                      <CustomBox
                        style={{
                          position: "sticky",
                          bottom: "-10px",
                          zIndex: 2,
                          margin: "10px -15px -10px",
                          padding: "10px 15px",
                          background: "var(--app-bg-surface, #fff)",
                          borderTop: "1px solid var(--app-border, #e1e3e5)",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            padding: "12px",
                            border:
                              "1px dashed var(--app-border-medium, #c9cccf)",
                            borderRadius: "8px",
                            cursor: "pointer",
                            fontSize: "13px",
                            fontWeight: 600,
                            color: "var(--app-primary, #1a8d5a)",
                            background: "var(--app-bg-surface, #fff)",
                          }}
                        >
                          <input
                            type="file"
                            multiple
                            accept=".srt,.vtt,text/vtt,application/x-subrip"
                            onChange={handleCaptionFile}
                            style={{ display: "none" }}
                          />
                          + Add language files (.srt or .vtt)
                        </label>

                        {captionError && (
                          <Box paddingBlockStart="200">
                            <Text as="p" variant="bodySm" tone="critical">
                              {captionError}
                            </Text>
                          </Box>
                        )}
                      </CustomBox>
                    </>
                  )}
                </Collapse>
              )}

              <Collapse
                title="Overlay"
                height={1000}
                pro={!isPremium}
                leftIcon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="9" cy="9" r="7" />
                    <circle cx="15" cy="15" r="7" />
                  </svg>
                }
                activeOption={overlay?.enabled}
              >
                <ToggleControl
                  label="Enable Overlay"
                  value={overlay?.enabled}
                  onChange={(newValue) =>
                    setOverlay((prev) => ({ ...prev, enabled: newValue }))
                  }
                />

                {overlay.enabled && (
                  <>
                    <SelectInput
                      position="top"
                      label="Position"
                      options={[
                        { label: "Top Right", value: "top_right" },
                        { label: "Top Left", value: "top_left" },
                        {
                          label: "Bottom Right",
                          value: "bottom_right",
                          disabled: true,
                        },
                        {
                          label: "Bottom Left",
                          value: "bottom_left",
                          disabled: true,
                        },
                      ]}
                      value={overlay.position}
                      onChange={(newValue) =>
                        setOverlay((prev) => ({ ...prev, position: newValue }))
                      }
                    />
                    <SelectInput
                      position="top"
                      label="Type"
                      options={[
                        { label: "Custom Text", value: "text" },
                        { label: "Logo", value: "logo" },
                      ]}
                      value={overlay.type}
                      onChange={(newValue) =>
                        setOverlay((prev) => ({ ...prev, type: newValue }))
                      }
                    />

                    {overlay.type === "text" ? (
                      <>
                        <TextInput
                          type="text"
                          label="Overlay Text"
                          position="top"
                          inputStyle={{
                            maxWidth: "100%",
                            margin: "5px 0 10px 0",
                          }}
                          style={{ display: "grid", padding: "0px" }}
                          value={overlay.text}
                          onChange={(newValue) =>
                            setOverlay((prev) => ({ ...prev, text: newValue }))
                          }
                        />
                      </>
                    ) : (
                      <>
                        <UploadField
                          label="Logo"
                          value={overlay.logo}
                          onChange={(next) =>
                            setOverlay((prev) => ({ ...prev, logo: next }))
                          }
                          disabled={isLoading}
                          pickLabel="Choose a logo image"
                          onPick={() => shopify.modal.show("upload-img-logo")}
                        />
                      </>
                    )}
                    <TextInput
                      type="url"
                      label="Overlay Link"
                      position="top"
                      inputStyle={{ maxWidth: "100%", margin: "5px 0 15px 0" }}
                      style={{ display: "grid", padding: "0px" }}
                      value={overlay.url}
                      onChange={(newValue) =>
                        setOverlay((prev) => ({ ...prev, url: newValue }))
                      }
                    />
                    {overlay.type === "text" && (
                      <>
                        <NumberUnit
                          label="Font Size"
                          position="top"
                          options={[
                            { value: "px", label: "PX" },
                            { value: "rem", label: "REM" },
                            { value: "em", label: "EM" },
                          ]}
                          value={overlay.fontSize}
                          onChange={(newValue) =>
                            setOverlay((prev) => ({
                              ...prev,
                              fontSize: newValue,
                            }))
                          }
                          max={100}
                          min={0}
                        />
                        <ColorController
                          label="Color"
                          value={overlay.color}
                          onChange={(newValue) =>
                            setOverlay((prev) => ({ ...prev, color: newValue }))
                          }
                        />
                        <ColorController
                          label="Background Color"
                          value={overlay.backgroundColor}
                          onChange={(newValue) =>
                            setOverlay((prev) => ({
                              ...prev,
                              backgroundColor: newValue,
                            }))
                          }
                        />
                      </>
                    )}

                    <RangeSlider
                      label="Opacity"
                      min={0}
                      max={1}
                      step={0.1}
                      value={overlay.opacity}
                      onChange={(newValue) =>
                        setOverlay((prev) => ({ ...prev, opacity: newValue }))
                      }
                    />
                  </>
                )}
              </Collapse>
              <Collapse
                title="Advanced"
                height={1500}
                pro={!isPremium}
                leftIcon={<Icon source={SunIcon} />}
              >
                <SpacingGroup
                  type="PADDING"
                  values={currentPaddingData.values}
                  unit={currentPaddingData.unit} // <-- Unit is now device-specific
                  isLinked={currentPaddingData.isLinked}
                  activeDevice={activeDevice}
                  onValueChange={(i, v) => handleValueChange("padding", i, v)}
                  onUnitChange={(u) => handleUnitChange("padding", u)}
                  onLinkToggle={() => handleLinkToggle("padding")}
                  onDeviceChange={handleDeviceChange}
                />

                {/* MARGIN GROUP: Passes active device's data */}
                <SpacingGroup
                  type="MARGIN"
                  values={currentMarginData.values}
                  unit={currentMarginData.unit} // <-- Unit is now device-specific
                  isLinked={currentMarginData.isLinked}
                  activeDevice={activeDevice}
                  onValueChange={(i, v) => handleValueChange("margin", i, v)}
                  onUnitChange={(u) => handleUnitChange("margin", u)}
                  onLinkToggle={() => handleLinkToggle("margin")}
                  onDeviceChange={handleDeviceChange}
                />
                <SpacingGroup
                  type="Round Corner"
                  values={currentRoundData.values}
                  unit={currentRoundData.unit} // <-- Unit is now device-specific
                  isLinked={currentRoundData.isLinked}
                  activeDevice={activeDevice}
                  onValueChange={(i, v) =>
                    handleValueChange("borderRadius", i, v)
                  }
                  onUnitChange={(u) => handleUnitChange("borderRadius", u)}
                  onLinkToggle={() => handleLinkToggle("borderRadius")}
                  onDeviceChange={handleDeviceChange}
                />

                {/* DIMENSIONS GROUP: Passes active device's data */}
                <SpacingGroup
                  type="DIMENSIONS"
                  values={currentDimensionsData.values}
                  unit={currentDimensionsData.unit} // <-- Unit is now device-specific
                  isLinked={currentDimensionsData.isLinked}
                  activeDevice={activeDevice}
                  onValueChange={(i, v) =>
                    handleValueChange("dimensions", i, v)
                  }
                  onUnitChange={(u) => handleUnitChange("dimensions", u)}
                  onLinkToggle={() => {}}
                  onDeviceChange={handleDeviceChange}
                />
                <SpacingGroup
                  type="VIDEO_RATIO"
                  values={currentRatioData.values}
                  unit={currentRatioData.unit} // <-- Unit is now device-specific
                  isLinked={currentRatioData.isLinked}
                  activeDevice={activeDevice}
                  onValueChange={(i, v) => handleValueChange("ratio", i, v)}
                  onUnitChange={(u) => handleUnitChange("ratio", u)}
                  onLinkToggle={() => {}}
                  onDeviceChange={handleDeviceChange}
                />
              </Collapse>
            </Accordion>
          </div>
          <div className="content">
            <Box
              dangerouslySetInnerHTML={{
                __html: `<style>
             :root {
             --plyr-color-main: ${cssValue(brandColor)};
              .starVideoPlayer {
                border-radius: ${cssValue(currentRoundData || round)};
                overflow: hidden;
                aspect-ratio: ${cssValue(currentRatioData.values[0])}/${cssValue(currentRatioData.values[1])};
                width: 100%;
              }
              }
               .starVideoPlayer .plyr--video {
                  height: 100% !important;
                  width: 100% !important;
                  border-radius: ${[0, 1, 2, 3].map((i) => `${cssValue(currentRoundData.values[i])}${cssValue(currentRoundData.unit)}`).join(" ")} !important;
                }
          </style>`,
              }}
            />
            <div
              className={
                activeDevice == "mobile"
                  ? "smartphone"
                  : activeDevice == "tablet"
                    ? "tablet"
                    : "desktop"
              }
            >
              <div className="content">
                {(() => {
                  const skeletonLoaderJSX = (
                    <CustomBox
                      className="wrapper"
                      style={{
                        padding: "0px",
                        width: "100%",
                        aspectRatio: `${currentRatioData.values[0]}/${currentRatioData.values[1]}`,
                      }}
                    >
                      <div
                        aria-busy="true"
                        aria-label="Loading video"
                        style={{
                          width: "100%",
                          height: "100%",
                          backgroundColor: "rgba(0,0,0,0.05)",
                          animation: "pulse 1.5s infinite ease-in-out",
                          borderRadius: `${currentRoundData.values[0]}${currentRoundData.unit} ${currentRoundData.values[1]}${currentRoundData.unit} ${currentRoundData.values[2]}${currentRoundData.unit} ${currentRoundData.values[3]}${currentRoundData.unit}`,
                        }}
                      ></div>
                      <style>{`
                        @keyframes pulse {
                          0% { opacity: 1; }
                          50% { opacity: 0.5; }
                          100% { opacity: 1; }
                        }
                      `}</style>
                    </CustomBox>
                  );

                  {
                    /* ===== MULTIPLE VIDEO GRID PREVIEW ===== */
                  }
                  return isMultiplePlayer ? (
                    <CustomBox
                      style={{
                        width:
                          currentDimensionsData.values[1] +
                          currentDimensionsData.unit,
                        maxWidth: "100%", // ensuring it doesn't break out of the preview area
                        padding: "20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                        maxHeight: "calc(100vh - 60px)",
                        overflowY: "auto",
                        margin: "0 auto", // center the container if it's smaller than full width
                      }}
                    >
                      {gridSettings?.viewMode === "grid" ? (
                        /* ===== GRID VIEW ===== */
                        <InlineGrid
                          columns={gridSettings?.columns?.[activeDevice] || 1}
                          gap="400"
                        >
                          {multiItems.map((item, idx) => (
                            <Box
                              key={`grid-${idx}-${item.video}-${playerReinitKey}`}
                            >
                              {nav.state === "loading" ? (
                                skeletonLoaderJSX
                              ) : (
                                <ClientOnly fallback={skeletonLoaderJSX}>
                                  {() => (
                                    <PlyrGridItem
                                      video={item.video}
                                      poster={item.poster}
                                      borderRadius={`${currentRoundData.values[0]}${currentRoundData.unit} ${currentRoundData.values[1]}${currentRoundData.unit} ${currentRoundData.values[2]}${currentRoundData.unit} ${currentRoundData.values[3]}${currentRoundData.unit}`}
                                      options={{
                                        ...previewGridOptions,
                                        autoPlay: idx === 0 ? autoPlay : false,
                                      }}
                                      overlay={overlay}
                                      watermark={watermark}
                                      columns={gridSettings?.columns}
                                      viewMode={gridSettings?.viewMode}
                                      activeDevice={activeDevice}
                                    />
                                  )}
                                </ClientOnly>
                              )}
                            </Box>
                          ))}
                        </InlineGrid>
                      ) : gridSettings?.viewMode === "carousel" ? (
                        /* ===== CAROUSEL VIEW ===== */
                        <CustomBox
                          style={{ position: "relative", width: "100%" }}
                        >
                          <CustomBox
                            id="multi-carousel-track"
                            onScroll={(e) => {
                              const track = e.currentTarget;
                              let index = Math.round(
                                track.scrollLeft / track.offsetWidth,
                              );

                              if (
                                Math.ceil(
                                  track.scrollLeft + track.clientWidth,
                                ) >=
                                track.scrollWidth - 10
                              ) {
                                index =
                                  Math.ceil(
                                    track.children.length /
                                      (gridSettings?.columns?.[activeDevice] ||
                                        1),
                                  ) - 1;
                              }
                              const dots =
                                track.parentElement?.querySelectorAll(
                                  ".carousel-dot",
                                );
                              if (dots) {
                                dots.forEach((dot, i) => {
                                  if (i === index) {
                                    dot.style.background =
                                      brandColor || "var(--app-primary)";
                                    dot.style.transform = "scale(1.2)";
                                  } else {
                                    dot.style.background = "#c9ccd0";
                                    dot.style.transform = "none";
                                  }
                                });
                              }
                            }}
                            style={{
                              display: "flex",
                              gap: `${gridSettings?.gap || 16}px`,
                              overflowX: "auto",
                              scrollSnapType: "x mandatory",
                              scrollBehavior: "smooth",
                              WebkitOverflowScrolling: "touch",
                              scrollbarWidth: "none",
                              msOverflowStyle: "none",
                              paddingBottom: "4px",
                            }}
                          >
                            {multiItems.map((item, idx) => (
                              <CustomBox
                                key={`carousel-${idx}-${item.video}-${playerReinitKey}`}
                                style={{
                                  flex: `0 0 calc(${100 / (gridSettings?.columns?.[activeDevice] || 1)}% - ${(((gridSettings?.columns?.[activeDevice] || 1) - 1) * (gridSettings?.gap || 16)) / (gridSettings?.columns?.[activeDevice] || 1)}px)`,
                                  scrollSnapAlign: "start",
                                  minWidth: 0,
                                }}
                              >
                                {nav.state === "loading" ? (
                                  skeletonLoaderJSX
                                ) : (
                                  <ClientOnly fallback={skeletonLoaderJSX}>
                                    {() => (
                                      <PlyrGridItem
                                        video={item.video}
                                        poster={item.poster}
                                        borderRadius={`${currentRoundData.values[0]}${currentRoundData.unit} ${currentRoundData.values[1]}${currentRoundData.unit} ${currentRoundData.values[2]}${currentRoundData.unit} ${currentRoundData.values[3]}${currentRoundData.unit}`}
                                        options={{
                                          ...previewGridOptions,
                                          autoPlay:
                                            idx === 0 ? autoPlay : false,
                                        }}
                                        overlay={overlay}
                                        watermark={watermark}
                                        columns={gridSettings?.columns}
                                        viewMode={gridSettings?.viewMode}
                                        activeDevice={activeDevice}
                                      />
                                    )}
                                  </ClientOnly>
                                )}
                              </CustomBox>
                            ))}
                          </CustomBox>
                          {/* Carousel navigation arrows */}
                          {multiItems.length >
                            (gridSettings?.columns?.[activeDevice] || 1) && (
                            <>
                              <CustomButton
                                onClick={() => {
                                  const track = document.getElementById(
                                    "multi-carousel-track",
                                  );
                                  if (track) {
                                    if (track.scrollLeft <= 0) {
                                      // At first slide → go to last
                                      track.scrollTo({
                                        left:
                                          track.scrollWidth - track.clientWidth,
                                        behavior: "smooth",
                                      });
                                    } else {
                                      track.scrollBy({
                                        left: -track.offsetWidth,
                                        behavior: "smooth",
                                      });
                                    }
                                  }
                                }}
                                className="nav-arrow prev"
                                style={{
                                  position: "absolute",
                                  left: "-14px",
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  width: "28px",
                                  height: "28px",
                                  borderRadius: "50%",
                                  border: "1px solid #dfe3e8",
                                  background: "#fff",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                                  zIndex: 5,
                                }}
                              >
                                <Icon source={ChevronLeftIcon} />
                              </CustomButton>
                              <CustomButton
                                onClick={() => {
                                  const track = document.getElementById(
                                    "multi-carousel-track",
                                  );
                                  if (track) {
                                    if (
                                      Math.ceil(
                                        track.scrollLeft + track.clientWidth,
                                      ) >=
                                      track.scrollWidth - 10
                                    ) {
                                      // At last slide → go to first
                                      track.scrollTo({
                                        left: 0,
                                        behavior: "smooth",
                                      });
                                    } else {
                                      track.scrollBy({
                                        left: track.offsetWidth,
                                        behavior: "smooth",
                                      });
                                    }
                                  }
                                }}
                                className="nav-arrow next"
                                style={{
                                  position: "absolute",
                                  right: "-14px",
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  width: "28px",
                                  height: "28px",
                                  borderRadius: "50%",
                                  border: "1px solid #dfe3e8",
                                  background: "#fff",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                                  zIndex: 5,
                                }}
                              >
                                <Icon source={ChevronRightIcon} />
                              </CustomButton>

                              {/* Dot Indicators */}
                              <CustomBox
                                className="carousel-dots-container"
                                style={{
                                  display: "flex",
                                  justifyContent: "center",
                                  flexWrap: "wrap",
                                  gap: "8px",
                                  margin: "16px auto 0 auto",
                                  width: "100%",
                                  alignItems: "center",
                                }}
                              >
                                {Array.from({
                                  length: Math.ceil(
                                    multiItems.length /
                                      (gridSettings?.columns?.[activeDevice] ||
                                        1),
                                  ),
                                }).map((_, i) => (
                                  <CustomBox
                                    key={`carousel-dot-${i}`}
                                    className={`carousel-dot`}
                                    style={{
                                      flex: "0 0 10px",
                                      width: "10px",
                                      height: "10px",
                                      minWidth: "10px",
                                      minHeight: "10px",
                                      borderRadius: "50%",
                                      cursor: "pointer",
                                      display: "inline-block",
                                      padding: "0",
                                      boxSizing: "border-box",
                                      transition:
                                        "transform 0.3s ease, background 0.3s ease",
                                      background:
                                        i === 0
                                          ? brandColor || "var(--app-primary)"
                                          : "#c9ccd0",
                                      transform:
                                        i === 0 ? "scale(1.2)" : "none",
                                    }}
                                    onClick={(e) => {
                                      const track = document.getElementById(
                                        "multi-carousel-track",
                                      );
                                      if (track) {
                                        track.scrollTo({
                                          left: track.offsetWidth * i,
                                          behavior: "smooth",
                                        });
                                      }
                                    }}
                                  />
                                ))}
                              </CustomBox>
                            </>
                          )}
                        </CustomBox>
                      ) : (
                        /* ===== SLIDER VIEW ===== */
                        <CustomBox
                          style={{
                            position: "relative",
                            width: "100%",
                            textAlign: "center",
                          }}
                        >
                          <CustomBox
                            id="multi-slider-track"
                            onScroll={(e) => {
                              const track = e.currentTarget;
                              const index = Math.round(
                                track.scrollLeft / track.offsetWidth,
                              );
                              const dots =
                                track.parentElement?.querySelectorAll(
                                  ".slider-dot",
                                );
                              if (dots) {
                                dots.forEach((dot, i) => {
                                  if (i === index) {
                                    dot.style.background =
                                      brandColor || "var(--app-primary)";
                                    dot.classList.add("active");
                                  } else {
                                    dot.style.background = "#c9ccd0";
                                    dot.classList.remove("active");
                                  }
                                });
                              }
                            }}
                            style={{
                              display: "flex",
                              gap: "0px",
                              overflowX: "auto",
                              scrollSnapType: "x mandatory",
                              scrollBehavior: "smooth",
                              WebkitOverflowScrolling: "touch",
                              scrollbarWidth: "none",
                              msOverflowStyle: "none",
                              width: "100%",
                              maxWidth: "100%",
                            }}
                          >
                            {multiItems.map((item, idx) => (
                              <CustomBox
                                key={`slider-${idx}-${item.video}-${playerReinitKey}`}
                                style={{
                                  flex: "0 0 100%",
                                  scrollSnapAlign: "start",
                                  minWidth: 0,
                                }}
                              >
                                {nav.state === "loading" ? (
                                  skeletonLoaderJSX
                                ) : (
                                  <ClientOnly fallback={skeletonLoaderJSX}>
                                    {() => (
                                      <PlyrGridItem
                                        video={item.video}
                                        poster={item.poster}
                                        borderRadius={`${currentRoundData.values[0]}${currentRoundData.unit} ${currentRoundData.values[1]}${currentRoundData.unit} ${currentRoundData.values[2]}${currentRoundData.unit} ${currentRoundData.values[3]}${currentRoundData.unit}`}
                                        options={{
                                          ...previewGridOptions,
                                          autoPlay:
                                            idx === 0 ? autoPlay : false,
                                        }}
                                        overlay={overlay}
                                        watermark={watermark}
                                        columns={gridSettings?.columns}
                                        viewMode={gridSettings?.viewMode}
                                        activeDevice={activeDevice}
                                      />
                                    )}
                                  </ClientOnly>
                                )}
                              </CustomBox>
                            ))}
                          </CustomBox>

                          {/* Navigation Arrows */}
                          {multiItems.length > 1 && (
                            <>
                              <CustomButton
                                onClick={() => {
                                  const track =
                                    document.getElementById(
                                      "multi-slider-track",
                                    );
                                  if (track) {
                                    if (track.scrollLeft <= 0) {
                                      // At first slide → go to last
                                      track.scrollTo({
                                        left:
                                          track.scrollWidth - track.clientWidth,
                                        behavior: "smooth",
                                      });
                                    } else {
                                      track.scrollBy({
                                        left: -track.offsetWidth,
                                        behavior: "smooth",
                                      });
                                    }
                                  }
                                }}
                                style={{
                                  position: "absolute",
                                  left: "10px",
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  width: "32px",
                                  height: "32px",
                                  borderRadius: "50%",
                                  border: "none",
                                  background: "rgba(255,255,255,0.8)",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                                  zIndex: 5,
                                }}
                              >
                                <Icon source={ChevronLeftIcon} />
                              </CustomButton>
                              <CustomButton
                                onClick={() => {
                                  const track =
                                    document.getElementById(
                                      "multi-slider-track",
                                    );
                                  if (track) {
                                    if (
                                      Math.ceil(
                                        track.scrollLeft + track.clientWidth,
                                      ) >=
                                      track.scrollWidth - 10
                                    ) {
                                      // At last slide → go to first
                                      track.scrollTo({
                                        left: 0,
                                        behavior: "smooth",
                                      });
                                    } else {
                                      track.scrollBy({
                                        left: track.offsetWidth,
                                        behavior: "smooth",
                                      });
                                    }
                                  }
                                }}
                                style={{
                                  position: "absolute",
                                  right: "10px",
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  width: "32px",
                                  height: "32px",
                                  borderRadius: "50%",
                                  border: "none",
                                  background: "rgba(255,255,255,0.8)",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                                  zIndex: 5,
                                }}
                              >
                                <Icon source={ChevronRightIcon} />
                              </CustomButton>

                              {/* Dot Indicators */}
                              <CustomBox
                                className="slider-dots-container"
                                style={{
                                  display: "flex",
                                  justifyContent: "center",
                                  flexWrap: "wrap",
                                  gap: "8px",
                                  margin: "16px auto 0 auto",
                                  width: "100%",
                                  alignItems: "center",
                                }}
                              >
                                {multiItems.map((_, i) => (
                                  <CustomBox
                                    key={`dot-${i}`}
                                    className={`slider-dot`}
                                    style={{
                                      flex: "0 0 10px",
                                      width: "10px",
                                      height: "10px",
                                      minWidth: "10px",
                                      minHeight: "10px",
                                      borderRadius: "50%",
                                      cursor: "pointer",
                                      display: "inline-block",
                                      padding: "0",
                                      boxSizing: "border-box",
                                      transition:
                                        "transform 0.3s ease, background 0.3s ease",
                                      // Fallback for active state if we don't have deep state tracking
                                      background:
                                        i === 0
                                          ? brandColor || "var(--app-primary)"
                                          : "#c9ccd0",
                                      transform:
                                        i === 0 ? "scale(1.2)" : "none",
                                    }}
                                    onClick={(e) => {
                                      const track =
                                        document.getElementById(
                                          "multi-slider-track",
                                        );
                                      if (track) {
                                        track.scrollTo({
                                          left: track.offsetWidth * i,
                                          behavior: "smooth",
                                        });
                                      }
                                    }}
                                  />
                                ))}
                              </CustomBox>
                            </>
                          )}
                        </CustomBox>
                      )}
                    </CustomBox>
                  ) : (
                    <>
                      {!isVideoReady || nav.state == "loading" ? (
                        <CustomBox
                          style={{
                            width:
                              currentDimensionsData.values[1] +
                              currentDimensionsData.unit,
                            aspectRatio:
                              currentRatioData.values[0] +
                              "/" +
                              currentRatioData.values[1],
                            maxWidth: "calc(100% - 20%)",
                            margin: `${currentMarginData.values[0]}${currentMarginData.unit} ${currentMarginData.values[1]}${currentMarginData.unit} ${currentMarginData.values[2]}${currentMarginData.unit} ${currentMarginData.values[3]}${currentMarginData.unit}`,
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                          }}
                        >
                          {skeletonLoaderJSX}
                        </CustomBox>
                      ) : null}
                      <CustomBox
                        className="starVideoPlayer"
                        key={`plyr-${playerReinitKey}`}
                        style={{
                          width:
                            currentDimensionsData.values[1] +
                            currentDimensionsData.unit,
                          aspectRatio:
                            currentRatioData.values[0] +
                            "/" +
                            currentRatioData.values[1],
                          maxWidth: "calc(100% - 20%)",
                          position: "relative",
                          cursor: videoType ? "not-allowed" : "auto",
                          display:
                            isVideoReady && nav.state != "loading"
                              ? "block"
                              : "none",
                          padding: `${currentPaddingData.values[0]}${currentPaddingData.unit} ${currentPaddingData.values[1]}${currentPaddingData.unit} ${currentPaddingData.values[2]}${currentPaddingData.unit} ${currentPaddingData.values[3]}${currentPaddingData.unit}`,
                          margin: `${currentMarginData.values[0]}${currentMarginData.unit} ${currentMarginData.values[1]}${currentMarginData.unit} ${currentMarginData.values[2]}${currentMarginData.unit} ${currentMarginData.values[3]}${currentMarginData.unit}`,
                          borderRadius: `${currentRoundData.values[0]}${currentRoundData.unit} ${currentRoundData.values[1]}${currentRoundData.unit} ${currentRoundData.values[2]}${currentRoundData.unit} ${currentRoundData.values[3]}${currentRoundData.unit}`,
                        }}
                      >
                        {videoType == "youtube" ||
                        videoType == "vimeo" ||
                        url?.startsWith("https://youtu") ||
                        url?.startsWith("https://vimeo") ||
                        url?.startsWith("https://www.youtube") ||
                        url?.startsWith("https://player.vimeo.com/video") ? (
                          <>
                            <CustomBox
                              key={`yt-vimeo-${playerReinitKey}`}
                              className="plyr__video-embed"
                              id="player"
                              ref={playerRef}
                              data-poster={poster || ""}
                              style={{
                                pointerEvents: "none",
                                width: "100%",
                                height: "100%",
                                borderRadius: `${currentRoundData.values[0]}${currentRoundData.unit} ${currentRoundData.values[1]}${currentRoundData.unit} ${currentRoundData.values[2]}${currentRoundData.unit} ${currentRoundData.values[3]}${currentRoundData.unit}`,
                                aspectRatio:
                                  currentRatioData.values[0] +
                                  "/" +
                                  currentRatioData.values[1],
                              }}
                            >
                              <iframe
                                /* No `origin=` param. It used to say
                                   `origin=https://admin.shopify.com`, which is
                                   the TOP frame — this document's real origin
                                   is the app's own host. YouTube cross-checks
                                   that value against the actual embedder and
                                   refuses to start the player when they
                                   disagree ("Error 153"). Omitting it is
                                   supported; the YT IFrame API works it out. */
                                src={`https://${videoType == "youtube" || url?.startsWith("https://www.youtu") || url?.startsWith("https://youtu") ? "www.youtube.com/embed" : "player.vimeo.com/video"}/${url?.split("/")[4] || url?.split("/")[3]}?iv_load_policy=3&modestbranding=1&playsinline=1&showinfo=0&rel=0&enablejsapi=1`}
                                allowtransparency="true"
                                /* Only covers the moment before Plyr swaps this
                                   element out — the player Plyr ends up with is
                                   built by the YT API and takes no such
                                   attribute, so it relies on the document-level
                                   meta in app/root.jsx instead. */
                                referrerPolicy="strict-origin-when-cross-origin"
                              ></iframe>
                            </CustomBox>
                          </>
                        ) : (
                          <CustomBox
                            key={`html5-${playerReinitKey}`}
                            style={{
                              pointerEvents: "none",
                              width: "100%",
                              height: "100%",
                              borderRadius: `${currentRoundData.values[0]}${currentRoundData.unit} ${currentRoundData.values[1]}${currentRoundData.unit} ${currentRoundData.values[2]}${currentRoundData.unit} ${currentRoundData.values[3]}${currentRoundData.unit}`,
                              aspectRatio:
                                currentRatioData.values[0] +
                                "/" +
                                currentRatioData.values[1],
                            }}
                          >
                            <video
                              id="player-html5"
                              playsInline
                              ref={playerRef}
                              poster={poster || ""}
                            >
                              <source src={url} type="video/mp4" />
                              {isPremium &&
                                previewCaptionTracks.map((t, i) => (
                                  <track
                                    key={`${t.srclang}-${i}`}
                                    kind="captions"
                                    label={t.label}
                                    srcLang={t.srclang}
                                    src={t.src}
                                    default={t.default}
                                  />
                                ))}
                            </video>
                          </CustomBox>
                        )}
                      </CustomBox>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
        <FileUploadModal
          inputValues={inputValues}
          setInputValues={setInputValues}
          isHiddenUploadOption={isHiddenUploadOption}
          setAddUrlModalActive={setAddUrlModalActive}
          options={options}
          handleSelectChange={handleSelectChange}
          isGridView={isGridView}
          preview={preview}
          handleScroll={handleScroll}
          handleDropZoneDrop={handleDropZoneDrop}
          isUploading={isUploading}
          uploadedFile={uploadedFile}
          fileUpload={fileUpload}
          filteredFiles={videoFiles}
          // filteredFiles={filteredFiles.filter(
          //   (file) =>
          //     file?.node?.mimeType?.includes("video") === true ||
          //     file.node.mediaContentType === "EXTERNAL_VIDEO" ||
          //     file.node.mediaContentType === "VIDEO",
          // )}
          selectedFiles={selectedFiles}
          toggleFileSelection={toggleFileSelection}
          addUrlModalActive={addUrlModalActive}
          confirmNewURL={confirmNewURL}
          newUrl={newUrl}
          setNewUrl={setNewUrl}
          toastMarkup={toastMarkup}
          isLoading={isLoading}
          setPreview={setPreview}
          actionData={actionData}
          files={videoFiles}
          uploadedAndSelectedFile={uploadedAndSelectedFile}
          setUploadedAndSelectedFile={setUploadedAndSelectedFile}
          loadNextPage={loadNextPage}
          loadPrevPage={loadPrevPage}
          pageInfo={videoPageInfo}
          uploadProgress={uploadProgress}
        />
        <ClientOnly fallback={null}>
          {() => (
            <ImgUploadModal
              inputValues={inputValues}
              setInputValues={setInputValues}
              isHiddenUploadOption={isHiddenUploadOption}
              setAddUrlModalActive={setAddUrlModalActive}
              options={options}
              handleSelectChange={handleSelectChange}
              isGridView={isGridView}
              previewImg={previewImg}
              handleScroll={handleScroll}
              handleDropZoneDrop={handleImageDrop}
              isUploading={isUploading}
              uploadedFile={uploadedFile}
              fileUpload={imgUpload}
              filteredFiles={imageFiles}
              selectedImgs={selectedImgs}
              toggleImgSelection={toggleImgSelection}
              addPosterModalActive={addPosterModalActive}
              setAddPosterModalActive={setAddPosterModalActive}
              addOverlayLogoModalActive={addOverlayLogoModalActive}
              setAddOverlayLogoModalActive={setAddOverlayLogoModalActive}
              confirmNewURL={confirmNewURL}
              newUrl={newUrl}
              setNewUrl={setNewUrl}
              toastMarkup={toastMarkup}
              isLoading={isLoading}
              setPreviewImg={setPreviewImg}
              actionData={actionData}
              files={imageFiles}
              uploadedAndSelectedImg={uploadedAndSelectedImg}
              setUploadedAndSelectedImg={setUploadedAndSelectedImg}
              uploadedAndSelectedLogo={uploadedAndSelectedLogo}
              setUploadedAndSelectedLogo={setUploadedAndSelectedLogo}
              uploadImage={uploadImage}
              loaderData={loaderData}
              loadNextPage={loadNextPage}
              loadPrevPage={loadPrevPage}
              pageInfo={imagePageInfo}
              uploadProgress={uploadProgress}
            />
          )}
        </ClientOnly>
      </Frame>
    </Box>
  );
};

export default Customize;
