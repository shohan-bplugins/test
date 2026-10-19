import { SaveBar } from "@shopify/app-bridge-react";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Collapse from "../components/Collapse/Collapse";
import SelectInput from "../components/SelectInput/SelectInput";
import DraggableList from "../components/DraggableList/DraggableList";
import ColorController from "../components/ColorController/ColorController";
import NumberUnit from "../components/NumberUnit/NumberUnit";
import { ToggleControl } from "../components/ToggleControl/ToggleControl";
import TextInput from "../components/TextInput/TextInput";
import { screenTwo } from "../components/ScreenList/ScreenTwo";
import { screenOne } from "../components/ScreenList/ScreenList";
import skinFusion from "../components/ScreenList/StickyPlayerOne";
import AudioUploadModal from "../components/AudioUploadModal/AudioUploadModal";
import {
  json,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import { useBackNavigation } from "../utils/useBackNavigation";
import ImgUploadModal from "../components/MediaImg";
import { playerIcon } from "../components/CustomIcons/CustomIcons";
import stickySBOne from "../components/ScreenList/StickySBOne";
import GradientSelector from "../components/GradientSelector/GradientSelector";
import { useCustomize } from "../context/CustomizeContext";
import { authenticate } from "../shopify.server";
import BoxShadow from "../components/BoxShadow/BoxShadow";
import prisma from "../db.server";
import { sanitizeCssValue } from "../lib/sanitize";
import MediaUrlField from "../components/MediaUrlField/MediaUrlField";
import { PreviewSkeleton } from "../components/Customize/CustomizeSkeleton";
import { showModal } from "../utils/modal";
import { maybeAskForReview } from "../utils/reviewPrompt";

const NOT_FOUND_MESSAGE = "This audio player doesn't exist or was deleted.";

// The audio player with this id if it belongs to `shop`, else null
// (also null for a malformed ObjectId, which Prisma would throw on).
async function findOwnAudio(id, shop) {
  if (!/^[a-f\d]{24}$/i.test(id || "")) return null;
  const audio = await prisma.audio.findUnique({ where: { id } });
  return audio && audio.shop === shop ? audio : null;
}

// The Audio model's per-skin JSON columns. `screen` from the client picks
// which one is written, so it must be one of these.
const ALLOWED_SCREENS = ["screenDefault", "screenOne", "screenTwo"];
const GENERIC_SAVE_ERROR = "Something went wrong while saving.";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPE = /^(audio|image|video)\//i;

// Validates the skin save fields. Returns { screen, screenData } or { error }.
function parseScreenUpdate(body) {
  const screen = body.get("screen");
  if (typeof screen !== "string" || !ALLOWED_SCREENS.includes(screen)) {
    return { error: "Invalid player skin." };
  }
  let screenData;
  try {
    screenData = JSON.parse(body.get("screenData"));
  } catch {
    return { error: "Invalid player settings." };
  }
  if (!screenData || typeof screenData !== "object" || Array.isArray(screenData)) {
    return { error: "Invalid player settings." };
  }
  return { screen, screenData };
}

// Validates upload metadata. Returns { name, type, size } or { error }.
function parseUploadMeta(body, { requireSize }) {
  const rawName = body.get("name");
  const type = body.get("type");
  if (typeof rawName !== "string" || !rawName.trim()) {
    return { error: "Invalid file name." };
  }
  if (typeof type !== "string" || !ALLOWED_UPLOAD_TYPE.test(type)) {
    return { error: "Unsupported file type." };
  }
  let size;
  if (requireSize) {
    size = Number(body.get("size"));
    if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
      return { error: "Invalid file size." };
    }
  }
  return { name: rawName.slice(0, 255), type, size };
}

export async function loader({ params, request }) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page"))) || 1);
  const pageSize = 10;
  const skip = (page - 1) * pageSize;
  try {
    // Scoped to this shop; a bad or foreign id is a 404, not a crash.
    const audio = await findOwnAudio(params?.id, session?.shop);
    if (!audio) {
      throw json({ message: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    const [audios, totalAudio] = await Promise.all([
      prisma.audio.findMany({
        where: {
          shop: session?.shop,
        },
        skip,
        take: pageSize,
        select: {
          id: true,
          title: true,
          url: true,
          shop: true,
        },
        orderBy: {
          createdAt: "desc", // Replace 'createdAt' with your actual timestamp column
        },
      }),
      prisma.audio.count({
        where: {
          shop: session?.shop, // Same filter as above
        },
      }),
    ]);

    const totalPages = Math.ceil(totalAudio / pageSize);

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

    // Fetch Audio
    const audioFiles = await fetchFilesByMediaType("media_type:GenericFile");

    // Fetch images
    const imageFiles = await fetchFilesByMediaType("media_type:Image");

    return {
      audio,
      id: params?.id,
      audioFiles,
      imageFiles: imageFiles?.files,
      pageInfoImage: imageFiles?.pageInfo,
      totalPages,
      page,
      pageSize,
    };
  } catch (error) {
    // Let the 404 above reach the error page as-is.
    if (error instanceof Response) throw error;
    console.error("Error fetching Audio:", error);
    throw error;
  }
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.formData();

  const data = body.get("data");

  let stagedUpload;

  try {
    let createAudio = "";
    let updateScreen = "";
    let audioFiles = [];
    let imageFiles = [];
    let allFiles = [];
    let pageInfoImage = {};
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

    // Fetch videos
    audioFiles = await fetchFilesByMediaType("media_type:GenericFile");

    if (body.get("endCursor")) {
      // Helper function to fetch files
      async function fetchFilesByMediaType(mediaType) {
        const query = `
          #graphql
          query FetchFiles($query: String, $after: String) {
            files(reverse: true, first: 50, query: $query, after: $after) {
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

        const response = await admin.graphql(query, { variables: { query: mediaType, after: body.get("endCursor") || null } });
        const result = await response.json();
        return {
          files: result?.data?.files?.edges || [],
          pageInfo: result?.data?.files?.pageInfo,
        };
      }

      // Fetch images
      imageFiles = await fetchFilesByMediaType("media_type:Image");

      pageInfoImage = imageFiles?.pageInfo;

      allFiles = [...imageFiles?.files];

      return json({
        allFiles: [...imageFiles?.files],
        imageFiles: imageFiles?.files,
        pageInfoImage: imageFiles?.pageInfo,
      });
    } else if (body.get("startCursor")) {
      // Helper function to fetch files
      async function fetchFilesByMediaType(mediaType) {
        const query = `
      #graphql
      query FetchFiles($query: String, $before: String) {
        files(reverse: true, last: 50, query: $query, before: $before) {
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

        const response = await admin.graphql(query, { variables: { query: mediaType, before: body.get("startCursor") || null } });
        const result = await response.json();
        return {
          files: result?.data?.files?.edges || [],
          pageInfo: result?.data?.files?.pageInfo,
        };
      }

      // Fetch images
      imageFiles = await fetchFilesByMediaType("media_type:Image");

      allFiles = [...imageFiles?.files];
      pageInfoImage = imageFiles?.pageInfo;

      return json({
        allFiles: [...imageFiles?.files],
        imageFiles: imageFiles?.files,
        pageInfoImage: imageFiles?.pageInfo,
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
      // Fetch images
      imageFiles = await fetchFilesByMediaType("media_type:Image");
      pageInfoImage = imageFiles?.pageInfo;
      allFiles = [...imageFiles?.files];
    }

    if (request.method === "PATCH") {
      if (!(await findOwnAudio(body.get("id"), session?.shop))) {
        return json(
          { success: false, error: NOT_FOUND_MESSAGE },
          { status: 404 },
        );
      }
      const response = await admin.graphql(
        `#graphql
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          alt
          createdAt
        }
      }
    }`,
        {
          variables: {
            files: {
              alt: "fallback text for an File",
              contentType: "FILE",
              originalSource: body.get("url"),
            },
          },
        },
      );
      const responseJson = await response.json();
      const getUrlPromise = new Promise((resolve, reject) => {
        setTimeout(async () => {
          const responseAudioUrl = await admin.graphql(
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
          const responseAudioUrlJson = await responseAudioUrl.json();
          resolve({ responseAudioUrlJson });
        }, [1000]);
      });
      const { responseAudioUrlJson } = await getUrlPromise;
      createAudio = await prisma.audio.update({
        where: {
          id: body.get("id"),
          shop: session?.shop,
        },
        data: {
          title: body.get("title"),
          url: responseAudioUrlJson.data.node.url,
          mainColor: body.get("mainColor"),
        },
      });

      return json({ createAudio, updateScreen });
    } else if (request.method === "POST") {
      if (!body.get("name")) {
        if (!body.get("title") || !body.get("url")) {
          return json({ success: false, error: "Title and URL are required." });
        }
        if (!(await findOwnAudio(body.get("id"), session?.shop))) {
          return json(
            { success: false, error: NOT_FOUND_MESSAGE },
            { status: 404 },
          );
        }
        const screenUpdate = parseScreenUpdate(body);
        if (screenUpdate.error) {
          return json({ success: false, error: screenUpdate.error }, { status: 400 });
        }
        createAudio = await prisma.audio.update({
          where: {
            id: body.get("id"),
            shop: session?.shop,
          },
          data: {
            title: body.get("title"),
            url: body.get("url"),
            mainColor: body.get("mainColor"),
            [screenUpdate.screen]: screenUpdate.screenData,
            selectedScreen: screenUpdate.screen,
            audioPlayList: body.get("audioPlayList") || {},
          },
        });
        return json({ success: true, createAudio, updateScreen });
      } else {
        const uploadMeta = parseUploadMeta(body, { requireSize: true });
        if (uploadMeta.error) {
          return json({ success: false, error: uploadMeta.error }, { status: 400 });
        }
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
                  filename: uploadMeta.name,
                  mimeType: uploadMeta.type,
                  httpMethod: "POST",
                  resource:
                    uploadMeta.type.split("/")[0].toUpperCase() === "AUDIO"
                      ? "FILE"
                      : uploadMeta.type.split("/")[0].toUpperCase(),
                  fileSize: String(uploadMeta.size),
                },
              ],
            },
          },
        );

        const stagedUploadResult = await response.json();

        stagedUpload =
          stagedUploadResult?.data?.stagedUploadsCreate?.stagedTargets?.[0];

        return json({ stagedUpload });
      }
    } else if (request.method === "PUT") {
      if (body.get("ids")) {
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
              ids: [body.get("ids")],
            },
          },
        );
        const statusResult = await status.json();
        return json({ statusResult, imageFiles: imageFiles?.files });
      }

      const fileMeta = parseUploadMeta(body, { requireSize: false });
      if (fileMeta.error) {
        return json({ success: false, error: fileMeta.error }, { status: 400 });
      }

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
            files: {
              alt: fileMeta.name,
              contentType:
                fileMeta.type.split("/")[0].toUpperCase() === "AUDIO"
                  ? "FILE"
                  : fileMeta.type.split("/")[0].toUpperCase(),
              originalSource: body.get("resourceUrl"),
            },
          },
        },
      );

      const createFileResult = await createFileQuery.json();

      // // const createFileResult = await makeGraphQLRequest(createFileQuery, createFileVariables);
      const uploadedFile = createFileResult?.fileCreate?.files[0];

      return json({
        id: uploadedFile?.id,
        name: uploadedFile?.filename,
        url: uploadedFile?.url,
        size: uploadedFile?.originalFileSize,
        createFileResult: createFileResult?.data?.fileCreate?.files?.[0],
        audioFiles,
        imageFiles: imageFiles?.files,
      });
    }

    return data;
  } catch (error) {
    console.error("Error fetching Audio Update:", error);
    return json(
      {
        success: false,
        error: GENERIC_SAVE_ERROR,
      },
      { status: 500 },
    );
  }
}

const StickySB = () => {
  const data = useCustomize();
  const playerRef = useRef(null);
  const playerInstance = useRef(null);
  const loaderData = useLoaderData();
  const nav = useNavigation();
  const navigate = useNavigate();
  const { goBack, isNavigating } = useBackNavigation("/app/audios");
  const actionData = useActionData();
  const [uploadAndSelectedFile, setUploadAndSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [fileProgress, setFileProgress] = useState(false);
  const [files, setFiles] = useState([]);
  const submit = useSubmit();
  const pageLoading = nav.state == "loading";

  // Live preview skeleton until Plyr has built the player (3s fallback so it
  // never sticks, e.g. when there's no audio source yet).
  const [previewReady, setPreviewReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPreviewReady(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  const selectedScreen = loaderData?.audio?.[loaderData?.audio?.selectedScreen];

  const [boxShadow, setBoxShadow] = useState(
    loaderData?.audio?.[loaderData?.audio?.selectedScreen]?.boxShadow || [
      {
        hOffset: "0px",
        vOffset: "0px",
        blur: "0px",
        spreed: "0px",
        color: "#dddddd",
        isInset: false,
      },
    ],
  );
  const [initialVolume, setInitialVolume] = useState(() => {
    return (
      loaderData?.audio?.screenDefault?.initialVolume ??
      loaderData?.audio?.screenOne?.initialVolume ??
      loaderData?.audio?.screenTwo?.initialVolume
    );
  });
  const [shadow, setShadow] = useState("");

  useEffect(() => {
    const getMultiShadowCSS = (value, type = "box") => {
      let styles = "";

      value?.map((item, index) => {
        const {
          hOffset = "0px",
          vOffset = "0px",
          blur = "0px",
          spreed = "0px",
          color = "#dddddd",
          isInset = false,
        } = item || {};

        const inset = isInset ? "inset" : "";
        const offsetBlur = `${parseInt(hOffset)}px ${parseInt(vOffset)}px ${parseInt(blur)}px`;
        const isComa = index + 1 >= value.length ? "" : ", ";

        styles +=
          "text" === type
            ? `${offsetBlur} ${color}${isComa}`
            : `${offsetBlur} ${parseInt(spreed)}px ${color} ${inset}${isComa}`;
      });

      return setShadow(styles || "none");
    };
    getMultiShadowCSS(boxShadow, "box");
  }, [boxShadow]);

  const handleSubmitFile = useCallback(
    (_dropFiles, acceptedFiles, _rejectedFiles) => {
      setIsUploading(true);

      setFiles((prevFiles) => {
        const updatedFiles = [...acceptedFiles];

        if (updatedFiles.length > 0) {
          submit(
            {
              name: updatedFiles[0]?.name,
              type: updatedFiles[0]?.type,
              size: updatedFiles[0]?.size,
              file: updatedFiles[0],
            },
            { method: "POST" },
          );
        }

        return updatedFiles;
      });
    },
    [],
  );

  const [imagePageInfo, setImagePageInfo] = useState(
    actionData?.pageInfoImage || loaderData?.pageInfoImage,
  );

  useEffect(() => {
    setImagePageInfo(actionData?.pageInfoImage || loaderData?.pageInfoImage);
  }, [actionData, loaderData]);

  const {
    selectedPreset,
    setSelectedPreset,
    selectionType,
    setSelectionType,
    messageShowDelay,
    setMessageShowDelay,
    backgroundColor,
    setBackgroundColor,
    textColor,
    setTextColor,
    selectedIconID,
    setSelectedIconID,
    sbAllSideGap,
    setSbAllSideGap,
    showMessage,
    setShowMessage,
    inputValues,
    setInputValues,
    selectedFile,
    setSelectedFile,
    handleBack,
    isLoading,
    sbPosition,
    sbAlign,
    setSbAlign,
    screen,
    screens,
    setScreen,
    items,
    handleDropZoneDrop,
    loading,
    setItems,
    iconColor,
    setIconColor,
    mainColor,
    setMainColor,
    background,
    setBackground,
    width,
    setWidth,
    height,
    setHeight,
    iconSize,
    setIconSize,
    borderRadius,
    setBorderRadius,
    borderWidth,
    setBorderWidth,
    borderStyle,
    setBorderStyle,
    borderColor,
    setBorderColor,
    controls,
    backgroundImage,
    validateMediaURL,
    setUrl,
    setBackgroundImage,
    setPlayer,
    removeURLParams,
    validURL,
    setValidURL,
    padding,
    setPadding,
    margin,
    setMargin,
    url,
    title,
    setTitle,
    image,
    setImage,
  } = data || {};
  const {
    play,
    setPlay,
    progress,
    setProgress,
    currentTime,
    setCurrentTime,
    mute,
    setMute,
    volume,
    setVolume,
    settings,
    setSettings,
    duration,
    setDuration,
    restart,
    setRestart,
    rewind,
    setRewind,
    fastForward,
    setFastForward,
    download,
    setDownload,
    loop,
    setLoop,
    airplay,
    setAirplay,
  } = controls;

  // Provide a safe default for updatedControls
  let updatedControls = [];

  const [gradientColor, setGradientColor] = useState("");

  updatedControls = [
    play && "play",
    progress && "progress",
    currentTime && "current-time",
    mute && "mute",
    volume && "volume",
    settings && "settings",
    duration && "duration",
    restart && "restart",
    rewind && "rewind",
    fastForward && "fast-forward",
    download && "download",
    loop && "loop",
    airplay && "airplay",
  ].filter((control) => control);
  const [images, setImages] = useState(loaderData?.imageFiles);

  useEffect(() => {
    if (screen == "screenDefault") {
      updatedControls = [
        play && "play",
        progress && "progress",
        currentTime && "current-time",
        mute && "mute",
        volume && "volume",
        settings && "settings",
        duration && "duration",
        restart && "restart",
        rewind && "rewind",
        fastForward && "fast-forward",
        download && "download",
        loop && "loop",
        airplay && "airplay",
      ].filter((control) => control);
    } else if (screen == "screenOne") {
      updatedControls = screenOne;
    }

    if (!backgroundColor) {
      setBackgroundColor("linear-gradient(to bottom right, #FF5E5E, #2ECECE)");
      setTextColor("#FFFFFF");
    }

    if (showMessage) {
      setTimeout(
        () => {
          const greeting = window?.document?.getElementById(
            "SBO-greeting--opened",
          );
          if (greeting) {
            greeting.style.display = "flex"; // Show the element
            // Force a reflow to ensure opacity transition works
            void greeting.offsetWidth;
            greeting.style.opacity = "1"; // Fade in
          }
        },
        parseInt(messageShowDelay) * 1000,
      ); // Convert seconds to milliseconds
    }

    const player = new Plyr(
      playerRef?.current?.querySelector(`#audio-${loaderData?.audio?.id}`),
      {
        controls: stickySBOne(
          title,
          sbAlign,
          selectedIconID,
          iconSize,
          backgroundColor,
          textColor,
          boxShadow,
        ),
        loop: { active: true },
        muted: mute,
        volume: (parseInt(initialVolume) || 0) / 100,
        storage: { enabled: false },
        debug: true,
      },
    );
    setPreviewReady(true);
    playerInstance.current = player;
    window.player = player;

    player.on("ready", () => {
      player.muted = mute;
      player.volume = (parseInt(initialVolume) || 0) / 100;
    });

    return () => {
      player?.destroy();
    };
  }, [
    JSON.stringify(screen, controls),
    title,
    url,
    image,
    messageShowDelay,
    sbAlign,
    showMessage,
    backgroundColor,
    textColor,
    iconColor,
    selectedIconID,
    iconSize,
    gradientColor,
    boxShadow,
    pageLoading,
    initialVolume,
  ]);

  const [stickyOneisMinimized, setStickyOneisMinimized] = useState(false);
  const draggableRef = useRef(null);
  const [position, setPosition] = useState({ x: 880, y: 745 });
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e) => {
    setDragging(true);
    setOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  // const handleMouseMove = (e) => {
  //     if (!dragging) return;
  //     setPosition({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  // };

  // const handleMouseUp = () => {
  //     setDragging(false);
  // };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragging) return;
      setPosition({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, offset]);

  useEffect(() => {
    if (!actionData?.stagedUpload?.url || files.length === 0) return;

    const uploadFile = async () => {
      const formDataFile = new FormData();

      actionData?.stagedUpload?.parameters.forEach(({ name, value }) => {
        formDataFile.append(name, value);
      });
      formDataFile.append("file", files[0]);

      try {
        setIsUploading(true);

        const response = await fetch(actionData?.stagedUpload?.url, {
          method: "POST",
          body: formDataFile,
        });

        if (!response.ok) {
          throw new Error("File upload failed");
        }

        // Artificial delay to ensure "Uploading..." is visible to the user before "Processing..."
        await new Promise((resolve) => setTimeout(resolve, 1500));

        submit(
          {
            name: files[0].name,
            type: files[0].type,
            resourceUrl: actionData?.stagedUpload?.resourceUrl,
          },
          { method: "PUT" },
        );

        setFiles([]);
      } catch (error) {
        console.error("Upload error:", error);
        setFiles([]);
        shopify.toast.show("Upload failed. Please try again.", {
          isError: true,
        });
      } finally {
        setIsUploading(false);
      }
    };

    uploadFile();
  }, [actionData?.stagedUpload?.url, files]);

  useEffect(() => {
    let interval = null;

    if (actionData?.createFileResult?.id || actionData?.status?.[0]?.id) {
      if (actionData?.status?.[0].fileStatus !== "READY") {
        setFileProgress(true);
        // setFiles(actionData?.allFiles);
        setItems(actionData?.audioFiles?.files);
        interval = setInterval(() => {
          submit(
            {
              ids: [
                actionData?.createFileResult?.id || actionData?.status?.[0]?.id,
              ],
            },
            { method: "PUT" },
          );
        }, 2000);
      } else {
        setFileProgress(false);
        setImages(actionData?.imageFiles);
        clearInterval(interval);
      }
    }

    return () => {
      setFileProgress(false);
      clearInterval(interval);
    };
  }, [actionData, submit]);

  const [isGridView, setIsGridView] = useState("grid_view");
  const [isHiddenUploadOption, setIsHiddenUploadOption] = useState(false);
  const [previewImg, setPreviewImg] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadedAndSelectedImg, setUploadedAndSelectedImg] = useState([]);
  const handleSelectChange = useCallback((value) => setIsGridView(value), []);
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

  const [selectedImgs, setSelectedImgs] = useState([]);
  const toggleImgSelection = useCallback((img) => {
    setSelectedImgs(img);
  }, []);
  const [addPosterModalActive, setAddPosterModalActive] = useState(false);

  const handleScroll = (e) => {
    const scrollTop = e.target.scrollTop;
    if (scrollTop >= 50) {
      setIsHiddenUploadOption(true); // Hide the div
    } else {
      setIsHiddenUploadOption(false); // Show the div
    }
  };

  useEffect(() => {
    if (actionData?.imageFiles?.length > 0) {
      setImages(actionData?.imageFiles);
    }
  }, [actionData]);

  useEffect(() => {
    if (uploadedAndSelectedImg?.preview?.image?.src) {
      setImage(uploadedAndSelectedImg?.preview?.image?.src);
    }
    if (uploadAndSelectedFile?.node?.url) {
      setUrl(uploadAndSelectedFile?.node?.url);
    }
  }, [uploadedAndSelectedImg, uploadAndSelectedFile]);

  let playerPosition = { bottom: "20px", left: "20px" };

  if (sbAlign == "top-left") {
    playerPosition = {
      top: sbAllSideGap?.top || "20px",
      left: sbAllSideGap?.left || "20px",
    };
  }
  if (sbAlign == "top-right") {
    playerPosition = {
      top: sbAllSideGap?.top || "20px",
      right: sbAllSideGap?.right || "20px",
    };
  }
  if (sbAlign == "bottom-left") {
    playerPosition = {
      bottom: sbAllSideGap?.bottom || "20px",
      left: sbAllSideGap?.left || "20px",
    };
  }
  if (sbAlign == "bottom-right") {
    playerPosition = {
      bottom: sbAllSideGap?.bottom || "20px",
      right: sbAllSideGap?.right || "20px",
    };
  }

  const boxRef = useRef(null);

  // useEffect(() => {
  //     const dragItem = playerRef.current;
  //     if (!dragItem) return;

  //     let isDragging = false;
  //     let offsetX = 0;
  //     let offsetY = 0;

  //     const handleMouseDown = (e) => {
  //         isDragging = true;
  //         offsetX = e.clientX - dragItem.offsetLeft;
  //         offsetY = e.clientY - dragItem.offsetTop;
  //         dragItem.style.cursor = "grabbing";
  //     };

  //     console.log({offsetX, offsetY})

  //     const handleMouseMove = (e) => {
  //         if (isDragging) {
  //             dragItem.style.left = `${e.clientX - offsetX}px`;
  //             dragItem.style.top = `${e.clientY - offsetY}px`;
  //         }
  //     };

  //     const handleMouseUp = () => {
  //         if (isDragging) {
  //             isDragging = false;
  //             dragItem.style.cursor = "grab";
  //             localStorage.setItem(
  //                 "dragPosition",
  //                 JSON.stringify({
  //                     left: dragItem.style.left,
  //                     top: dragItem.style.top,
  //                 })
  //             );
  //         }
  //     };

  //     // Restore position
  //     const saved = localStorage.getItem("dragPosition");
  //     if (saved) {
  //         const { left, top } = JSON.parse(saved);
  //         dragItem.style.left = left;
  //         dragItem.style.top = top;
  //     }

  //     dragItem.addEventListener("mousedown", handleMouseDown);
  //     document.addEventListener("mousemove", handleMouseMove);
  //     document.addEventListener("mouseup", handleMouseUp);

  //     return () => {
  //         dragItem.removeEventListener("mousedown", handleMouseDown);
  //         document.removeEventListener("mousemove", handleMouseMove);
  //         document.removeEventListener("mouseup", handleMouseUp);
  //     };
  // }, []);

  // A player needs a title and an audio source before it can be copied/embedded.
  const getMissingFields = () => {
    const missing = [];
    if (!title || !String(title).trim()) missing.push("title");
    let hasSource = !!(url && String(url).trim());
    if (!hasSource && Array.isArray(items)) {
      hasSource = items.some((t) => t?.url && String(t.url).trim());
    }
    if (!hasSource) missing.push("audio source");
    return missing;
  };
  const copyId = (id) => {
    const missing = getMissingFields();
    if (missing.length) {
      shopify.toast.show(
        `Add a ${missing.join(" and ")} to this player before copying its ID.`,
        { isError: true },
      );
      return;
    }
    navigator.clipboard.writeText(id);
    shopify.toast.show("ID Copied Successfully");
  };
  const copyEmbed = (id, title) => {
    const missing = getMissingFields();
    if (missing.length) {
      shopify.toast.show(
        `Add a ${missing.join(" and ")} to this player before copying its embed code.`,
        { isError: true },
      );
      return;
    }
    const embedCode = `<div class="html5-audio-plyr" data-id="${id}"></div>`;

    navigator.clipboard.writeText(embedCode);
    shopify.toast.show("Embed Code Successfully Copied ");
  };

  const handleUpdateCSS = (send = submit) => {
    send(
      {
        data: [
          selectedScreen?.id,
          width,
          height,
          borderRadius,
          borderWidth,
          borderStyle,
          borderColor,
          iconSize,
          background,
          backgroundImage,
          image,
          backgroundColor,
          textColor,
          selectedIconID,
          sbAlign,
          sbAllSideGap,
          showMessage,
          image,
          margin,
          padding,
          messageShowDelay,
          selectionType,
          boxShadow,
        ],
      },
      { method: "POST" },
    );
  };

  const handleUpdate = (send = submit) => {
    // handleUpdateCSS();
    const controls = {
      currentTime,
      mute,
      play,
      progress,
      settings,
      volume,
      initialVolume,
    };
    const screenData = {
      ...selectedScreen,
      width: width,
      height: height,
      borderRadius: borderRadius,
      borderWidth: borderWidth,
      borderStyle: borderStyle,
      borderColor: borderColor,
      iconSize: iconSize,
      iconColor: iconColor,
      background: background,
      backgroundImage: backgroundImage,
      image: image,
      margin: margin,
      padding: padding,
      controls,
      boxShadow,
      sbAlign: sbAlign,
      sbAllSideGap: sbAllSideGap,
      backgroundColor: backgroundColor,
      textColor,
      selectedIconID,
      messageShowDelay,
      showMessage,
      selectionType,
      selectedPreset,
    };

    send(
      {
        url: url,
        title: title,
        mainColor: mainColor,
        id: loaderData?.audio?.id,
        screen: screen,
        screenData: JSON.stringify(screenData),
        audioPlayList: items?.length ? JSON.stringify(items) : [],
      },
      { method: "POST" },
    );
  };

  useEffect(() => {
    if (actionData) {
      if (actionData?.success) {
        shopify.toast.show("Successfully Saved!");
        maybeAskForReview();
      } else if (actionData?.error) {
        // A failed request also ends any upload that was waiting on it.
        setIsUploading(false);
        setFileProgress(false);
        shopify.toast.show(`⚠️ Error: ${actionData?.error}`, { isError: true });
      }
    }
  }, [actionData]);

  // Unsaved-changes tracking for the App Bridge save bar: build exactly what
  // Save would submit (without sending it) and compare it with a snapshot
  // taken once the page has settled after load / after the last save.
  const captureSave = () => {
    const calls = [];
    handleUpdate((payload) => calls.push(payload));
    return JSON.stringify(calls);
  };
  const saveSnapshot = captureSave();
  const saveSnapshotRef = useRef(saveSnapshot);
  saveSnapshotRef.current = saveSnapshot;
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  useEffect(() => {
    const timer = setTimeout(
      () => setSavedSnapshot(saveSnapshotRef.current),
      800,
    );
    return () => clearTimeout(timer);
  }, []);
  const hasUnsavedChanges =
    savedSnapshot !== null && saveSnapshot !== savedSnapshot;
  const isSaving = nav.state === "submitting";
  const handleSave = () => {
    handleUpdate();
    setSavedSnapshot(saveSnapshot);
  };
  const handleDiscard = () => {
    setSavedSnapshot(saveSnapshot);
    // Reload to restore the last saved settings (state is seeded from the loader).
    window.location.reload();
  };

  return (
    <>
      <>
        <SaveBar id="customize-save-bar" open={hasUnsavedChanges}>
          <button
            variant="primary"
            onClick={handleSave}
            loading={isSaving ? "" : undefined}
          >
            Save
          </button>
          <button onClick={handleDiscard} disabled={isSaving || undefined}>
            Discard
          </button>
        </SaveBar>
        <s-box padding="small" background="base" borderColor="base">
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
            gap="base"
          >
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-button
                icon="arrow-left"
                variant="tertiary"
                accessibilityLabel="Back"
                loading={isNavigating || undefined}
                onClick={goBack}
              ></s-button>
              <s-heading>Customize player</s-heading>
              <s-badge>Single Button Player</s-badge>
            </s-stack>
            <s-stack direction="inline" gap="small-200">
              <s-button
                variant="primary"
                icon="code"
                disabled={
                  isLoading ||
                  pageLoading ||
                  getMissingFields().length > 0 ||
                  undefined
                }
                onClick={() => copyEmbed(loaderData?.id, "")}
              >
                Copy Embed Code
              </s-button>
              <s-button
                variant="primary"
                icon="clipboard"
                disabled={
                  isLoading ||
                  pageLoading ||
                  getMissingFields().length > 0 ||
                  undefined
                }
                onClick={() => copyId(loaderData?.id)}
              >
                Copy ID
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
        <div className="main-container">
          <div className="sidebar sticky-player">
            <s-box padding="base">
              <s-stack gap="small">
                <s-heading>Player settings</s-heading>

                <Collapse
                  title="Player Configuration"
                  height={screen == "screenTwo" ? 500 : 400}
                  unit="%"
                  defaultOpen={true}
                >
                  {/* <SelectInput
                label="Player Skins"
                options={screens}
                value={screen}
                onChange={setScreen}
              /> */}

                  <MediaUrlField
                    label="Audio Source"
                    value={url || ""}
                    onChange={(v) => setUrl(v)}
                    onUploadClick={() => {
                      // setActiveId(item.id)
                      const currentSelectedFile =
                        loaderData?.audioFiles?.files?.find((f) => {
                          return f?.node?.url === url;
                        });

                      setSelectedFile(currentSelectedFile || null);
                      showModal("upload-audio");
                    }}
                    required
                    details="Please Upload or choose a Audio file."
                  />

                  <s-stack gap="base">
                    <ToggleControl
                      label="Show Message"
                      value={showMessage}
                      onChange={setShowMessage}
                    />

                    {showMessage && (
                      <>
                        <TextInput
                          type="text"
                          label="Message"
                          position="top"
                          inputStyle={{
                            maxWidth: "100%",
                            margin: "5px 0 10px 0",
                          }}
                          style={{ display: "grid", padding: "0px" }}
                          value={title}
                          onChange={(value) => setTitle(value)}
                        />
                        <NumberUnit
                          type="number"
                          label="Display after"
                          min={0}
                          max={60}
                          options={[{ label: "S", value: "s" }]}
                          value={messageShowDelay}
                          onChange={(value) => {
                            if (parseInt(value) >= 0 && parseInt(value) <= 60) {
                              setMessageShowDelay(value);
                            }
                          }}
                        />
                      </>
                    )}

                    <NumberUnit
                      type="number"
                      label="Initial Volume"
                      details="Set the initial volume level of the player."
                      options={[{ label: "%", value: "%" }]}
                      value={`${initialVolume || 100}%`}
                      onChange={(val) => setInitialVolume(parseInt(val))}
                      min={0}
                      max={100}
                    />
                  </s-stack>
                </Collapse>

                <Collapse title="Icons" height={600} unit="%">
                  <s-text type="strong">Select icon</s-text>
                  <s-grid
                    gridTemplateColumns="repeat(2, minmax(0, 1fr))"
                    gap="small"
                  >
                    {playerIcon?.map((icon, index) => {
                      const selected = selectedIconID == icon?.id;
                      return (
                        <s-clickable
                          key={index}
                          padding="small"
                          borderRadius="base"
                          border={selected ? "base strong" : "base"}
                          background={selected ? "subdued" : undefined}
                          accessibilityLabel={`Icon set ${index + 1}`}
                          onClick={() => setSelectedIconID(icon?.id)}
                        >
                          <s-stack
                            direction="inline"
                            justifyContent="space-around"
                            alignItems="center"
                          >
                            {/* Icon SVGs come from the player data. */}
                            <div
                              className="icon-choice"
                              dangerouslySetInnerHTML={{ __html: icon?.pause }}
                            />
                            <div
                              className="icon-choice"
                              dangerouslySetInnerHTML={{ __html: icon?.play }}
                            />
                            {selected ? (
                              <s-icon
                                type="check-circle"
                                tone="success"
                              ></s-icon>
                            ) : null}
                          </s-stack>
                        </s-clickable>
                      );
                    })}
                  </s-grid>
                  <NumberUnit
                    type="number"
                    label="Icon Size"
                    min={0}
                    max={500}
                    options={[
                      { label: "PX", value: "px" },
                      { label: "%", value: "%" },
                      { label: "REM", value: "rem" },
                    ]}
                    value={iconSize}
                    onChange={(value) => {
                      if (parseInt(value) >= 0 && parseInt(value) <= 500) {
                        setIconSize(value);
                      }
                    }}
                  />
                </Collapse>

                <Collapse title="Colors" height={600}>
                  <GradientSelector
                    textColor={textColor}
                    setTextColor={setTextColor}
                    backgroundColor={backgroundColor}
                    setBackgroundColor={setBackgroundColor}
                    selectedPreset={selectedPreset}
                    setSelectedPreset={setSelectedPreset}
                    selectionType={selectionType}
                    setSelectionType={setSelectionType}
                  />
                </Collapse>

                <Collapse title="Position" height={600}>
                  <SelectInput
                    position="top"
                    label="Position"
                    options={sbPosition}
                    value={sbAlign}
                    onChange={setSbAlign}
                  />
                  <NumberUnit
                    position={"top"}
                    type="number"
                    label={`Distance from the ${sbAlign?.split("-")[0] == "top" ? "Top" : "Bottom"}`}
                    min={-1000}
                    max={1000}
                    options={[{ label: "PX", value: "px" }]}
                    value={
                      sbAllSideGap?.[
                        sbAlign?.split("-")[0] == "top" ? "top" : "bottom"
                      ]
                    }
                    onChange={(value) => {
                      if (parseInt(value) >= -1000 && parseInt(value) <= 1000) {
                        setSbAllSideGap({
                          ...sbAllSideGap,
                          [sbAlign?.split("-")[0] == "top" ? "top" : "bottom"]:
                            value,
                        });
                      }
                    }}
                  />
                  <NumberUnit
                    position={"top"}
                    type="number"
                    label={`Distance from the ${sbAlign?.split("-")[1] == "left" ? "Left" : "Right"}`}
                    min={-1000}
                    max={1000}
                    options={[{ label: "PX", value: "px" }]}
                    value={
                      sbAllSideGap?.[
                        sbAlign?.split("-")[1] == "left" ? "left" : "right"
                      ]
                    }
                    onChange={(value) => {
                      if (parseInt(value) >= -1000 && parseInt(value) <= 1000) {
                        setSbAllSideGap({
                          ...sbAllSideGap,
                          [sbAlign?.split("-")[1] == "left" ? "left" : "right"]:
                            value,
                        });
                      }
                    }}
                  />
                </Collapse>
                <Collapse title="Style" height={100} defaultOpen={false}>
                  <BoxShadow value={boxShadow} onChange={setBoxShadow} />
                </Collapse>
              </s-stack>
            </s-box>
          </div>
          <div className="content">
            {!previewReady ? (
              <div className="cz-sk-overlay">
                <PreviewSkeleton />
              </div>
            ) : null}
            {pageLoading ? (
              <PreviewSkeleton />
            ) : (
              <>
                {url == "" ? (
                  <s-banner tone="warning" heading="Player inactive">
                    Select an audio file in the sidebar configuration to enable
                    playback.
                  </s-banner>
                ) : null}
                <div
                  dangerouslySetInnerHTML={{
                    __html: `<style>


          ${
            screen === "screenDefault" &&
            `
            
          .plyr {
            --plyr-control-icon-size:${sanitizeCssValue(iconSize)};
            --plyr-audio-control-color:${sanitizeCssValue(iconColor)};
            --plyr-audio-controls-background:${sanitizeCssValue(background)};
            --plyr-menu-border-color:${sanitizeCssValue(borderColor)};
            --plyr-range-thumb-height:15px;
            --plyr-menu-color:${sanitizeCssValue(iconColor)};

          }
          .plyr--audio .plyr__controls {
              border-radius:${sanitizeCssValue(borderRadius)};
              background-color: ${sanitizeCssValue(background)};
          }
            .plyr.plyr--full-ui.plyr--audio.plyr--html5.plyr--paused ,
            .plyr.plyr--full-ui.plyr--audio.plyr--html5.plyr--playing {
              display: flex;
              justify-content: center;
              align-items: center;
              max-width: 100%;
              width:${sanitizeCssValue(width)};
            height:${sanitizeCssValue(height)};
          }`
          }

          

       .plyr .media-controls {
            background:${sanitizeCssValue(background)};
            border-radius: ${sanitizeCssValue(borderRadius)};
            width:${sanitizeCssValue(width)};
            height:${sanitizeCssValue(height)};
            border:${sanitizeCssValue(borderWidth + " " + borderStyle + " " + borderColor)}
          }
          .demo-1 .screen-container {
            background:${sanitizeCssValue(background)};
            border-radius: ${sanitizeCssValue(borderRadius)};
            width:${sanitizeCssValue(width)};
            height:${sanitizeCssValue(height)};
            border:${sanitizeCssValue(borderWidth + " " + borderStyle + " " + borderColor)};
            }
            .plyr .media-controls {
            background:${sanitizeCssValue(background)};
            border:${sanitizeCssValue(borderWidth + " " + borderStyle + " " + borderColor)};
            }
          .demo-1 .screen-container .controls{
            background:${sanitizeCssValue(background)};
          }
        
          .plyr .media-controls svg,
          .plyr .controls svg {
            width: ${sanitizeCssValue(parseInt(iconSize) + iconSize?.match(/[a-z%]+/i)[0])};
            height: ${sanitizeCssValue(parseInt(iconSize) + iconSize?.match(/[a-z%]+/i)[0])};
            color: ${sanitizeCssValue(iconColor)};
            }
            .demo-1 button.play.plyr__control--pressed .pause-icon{
              color: ${sanitizeCssValue(iconColor)} !important;
            }
          .demo-1 .screen-container .image-box {
            background-image: url("${sanitizeCssValue(backgroundImage ? backgroundImage : "https://img.freepik.com/free-photo/painting-mountain-lake-with-mountain-background_188544-9126.jpg")}")
          }
          .plyr {
            --plyr-color-main:${sanitizeCssValue(mainColor)};
          }

          #player .plyr.plyr--full-ui.plyr--audio.plyr--html5 {
            width: auto;
            max-width: fit-content;
            min-width: 60px;
            height: auto;
          }
        
      </style>`,
                  }}
                />

                <div
                  className=""
                  style={{
                    background: "#f3f9ff",
                    width: "100%",
                    height: "100%",
                  }}
                >
                  {validateMediaURL(removeURLParams(validURL)) ? (
                    // <div id="draggable" ref={boxRef} style={{ cursor: "grab" }}>
                    <div
                      ref={playerRef}
                      key={url}
                      style={{
                        position: "absolute",
                        ...playerPosition,
                        zIndex: 9999,
                        maxWidth: "fit-content",
                        display: "flex",
                        flexDirection: "column",
                        minWidth: "65px",
                        width: "100%",
                      }}
                      className={`plyr ${stickyOneisMinimized ? "minimized" : ""}`}
                      id="player"
                    >
                      <audio
                        id={`audio-${loaderData?.audio?.id}`}
                        src={url}
                        autoPlay={true}
                        muted={mute}
                      ></audio>
                    </div>
                  ) : (
                    // </div>

                    <s-text tone="critical">Invalid Url</s-text>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </>

      <AudioUploadModal
        handleSubmitFile={handleSubmitFile}
        setUploadAndSelectedFile={setUploadAndSelectedFile}
        items={loaderData?.audioFiles?.files}
        files={files}
        setFiles={setFiles}
        selectedFile={selectedFile}
        setSelectedFile={setSelectedFile}
        isUploading={isUploading}
        fileProgress={fileProgress}
      />

      <ImgUploadModal
        inputValues={inputValues}
        setInputValues={setInputValues}
        isHiddenUploadOption={isHiddenUploadOption}
        // setAddPosterModalActive={setAddPosterModalActive}
        options={[
          {
            label: "Grid View",
            value: "grid_view",
          },
          {
            label: "List View",
            value: "list_view",
          },
        ]}
        handleSelectChange={handleSelectChange}
        isGridView={isGridView}
        previewImg={previewImg}
        handleScroll={handleScroll}
        handleDropZoneDrop={handleDropZoneDrop}
        isUploading={isUploading}
        fileProgress={fileProgress}
        uploadedFiles={uploadedFiles}
        uploadedAndSelectedImg={uploadedAndSelectedImg}
        setUploadedAndSelectedImg={setUploadedAndSelectedImg}
        filteredFiles={images}
        selectedImgs={selectedImgs}
        toggleImgSelection={toggleImgSelection}
        setPreviewImg={setPreviewImg}
        files={files}
        addPosterModalActive={addPosterModalActive}
        actionData={actionData}
        isLoading={isLoading}
        uploadImage={uploadImage}
        loadNextPage={loadNextPage}
        loadPrevPage={loadPrevPage}
        pageInfo={imagePageInfo}
      />
    </>
  );
};

export default StickySB;
