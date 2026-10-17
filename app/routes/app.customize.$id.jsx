import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Outlet,
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import "../styles/plyr.css";
import "../styles/style.css";
import TextInput from "../components/TextInput/TextInput";
import SelectInput from "../components/SelectInput/SelectInput";
import { screenOne } from "../components/ScreenList/ScreenList";
import { authenticate } from "../shopify.server";
import { json } from "@remix-run/node";
// import Plyr from "plyr";
import NumberUnit from "../components/NumberUnit/NumberUnit";
import prisma from "../db.server";
import Collapse from "../components/Collapse/Collapse";
// import { ColorPicker } from "remix-panel";
import { ToggleControl } from "../components/ToggleControl/ToggleControl";
import ColorController from "../components/ColorController/ColorController";
// import ColorPicker from "../components/ColorPicker/ColorPicker";
import DraggableList from "../components/DraggableList/DraggableList";
import { CustomizeContext } from "../context/CustomizeContext";
import PlaylistAudioPlayer from "./app.customize.$id.playlist-audio";
import SingleAudioPlayer from "./app.customize.$id.single-audio";
import StickyPlayer from "./app.customize.$id.sticky-player";
import StickySB from "./app.customize.$id.sticky-single-button";
import { useSupport } from "../components/SupportForm/SupportProvider";
// import ScreenTwo from "../components/ScreenList/ScreenTwo";

// Fallbacks for style values a skin has never saved, so the live preview CSS
// never receives "undefined" (these match what the editor used to fill in).
const SCREEN_DEFAULTS = {
  padding: "0px",
  margin: "0px",
  borderRadius: "0px",
  borderWidth: "0px",
  borderStyle: "solid",
  borderColor: "#dddddd",
  background: "#ffffff",
};

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
    const audio = await findOwnAudio(params.id, session?.shop);
    if (!audio) {
      throw json({ message: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    const [audios, totalAudio, users, planData] = await Promise.all([
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
      prisma.Users.findMany({ where: { shop: session?.shop } }),
      prisma.plans.findMany(),
    ]);

    let currentPlan = planData?.find((p) => {
      if (!users[0]?.planId) {
        if (p?.name === "Free") {
          return p;
        }
      } else if (p?.id === users[0]?.planId) {
        return p;
      }
    });

    const isPro = currentPlan ? currentPlan?.name !== "Free" : false;

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
      id: params.id,
      audioFiles,
      imageFiles: imageFiles?.files,
      pageInfoImage: imageFiles?.pageInfo,
      totalPages,
      page,
      pageSize,
      isPro,
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
        return json({ createAudio, updateScreen });
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

        return json({
          stagedUpload,
          // allFiles,
          // videoFiles: videoFiles?.files,
          // imageFiles: imageFiles?.files,
          // pageInfoImage,
          // pageInfoVideo,
        });
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
    throw error;
  }
}

const Customize = () => {
  const openSupport = useSupport();
  const location = useLocation();
  const nav = useNavigation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const action = useActionData();
  const loaderData = useLoaderData({ data: location.pathname.split("/")[3] });
  const [inputValues, setInputValues] = useState("");
  const actionData = useActionData();

  const [isValid, setIsValid] = useState(false);

  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]);

  const [player, setPlayer] = useState(null);

  const [title, setTitle] = useState(loaderData?.audio?.title);
  const [url, setUrl] = useState(loaderData?.audio?.url);
  const [mainColor, setMainColor] = useState(loaderData?.audio?.mainColor);
  const [selectedFile, setSelectedFile] = useState({});
  const [sbAlign, setSbAlign] = useState(
    loaderData?.audio?.sbAlign || "bottom-right",
  );

  const [screen, setScreen] = useState(loaderData?.audio?.selectedScreen);

  const screens = [
    { label: "Skin Default", value: "screenDefault" },
    { label: "Skin One", value: "screenOne" },
    { label: "Skin Two", value: "screenTwo" },
  ];

  loaderData?.audio?.screen?.map((item) =>
    screens.push({ label: item?.title, value: item?.id }),
  );

  const sbPosition = [
    { label: "Bottom Right", value: "bottom-right" },
    { label: "Bottom Left", value: "bottom-left" },
    { label: "Top Right", value: "top-right" },
    { label: "Top Left", value: "top-left" },
  ];

  const selectedScreen = loaderData?.audio?.[screen];

  const [width, setWidth] = useState(selectedScreen?.width);
  const [height, setHeight] = useState(selectedScreen?.height);

  useEffect(() => {
    if (loaderData?.audio?.playerType === "playlist-audio") {
      // Playlist heights are stored as %; unsaved skins default to 100%.
      const h = parseInt(height);
      setHeight(Number.isFinite(h) ? h + "%" : "100%");
    }
  }, []);

  const [borderRadius, setBorderRadius] = useState(
    selectedScreen?.borderRadius ?? SCREEN_DEFAULTS.borderRadius,
  );

  const [borderWidth, setBorderWidth] = useState(
    selectedScreen?.borderWidth ?? SCREEN_DEFAULTS.borderWidth,
  );
  const [borderStyle, setBorderStyle] = useState(
    selectedScreen?.borderStyle ?? SCREEN_DEFAULTS.borderStyle,
  );
  const [borderColor, setBorderColor] = useState(
    selectedScreen?.borderColor ?? SCREEN_DEFAULTS.borderColor,
  );
  const [iconSize, setIconSize] = useState(selectedScreen?.iconSize);
  const [iconColor, setIconColor] = useState(selectedScreen?.iconColor);
  const [background, setBackground] = useState(
    selectedScreen?.background ?? SCREEN_DEFAULTS.background,
  );
  const [sbAllSideGap, setSbAllSideGap] = useState(
    selectedScreen?.sbAllSideGap,
  );
  const [backgroundImage, setBackgroundImage] = useState(
    selectedScreen?.backgroundImage,
  );
  const [image, setImage] = useState(selectedScreen?.image);
  const [margin, setMargin] = useState(
    selectedScreen?.margin ?? SCREEN_DEFAULTS.margin,
  );
  const [padding, setPadding] = useState(
    selectedScreen?.padding ?? SCREEN_DEFAULTS.padding,
  );
  const [play, setPlay] = useState(
    selectedScreen?.controls?.play === undefined
      ? true
      : selectedScreen?.controls?.play,
  );
  const [progress, setProgress] = useState(selectedScreen?.controls?.progress);
  const [currentTime, setCurrentTime] = useState(
    selectedScreen?.controls?.currentTime,
  );
  const [mute, setMute] = useState(selectedScreen?.controls?.mute);
  const [volume, setVolume] = useState(selectedScreen?.controls?.volume);
  const [settings, setSettings] = useState(selectedScreen?.controls?.settings);
  const [duration, setDuration] = useState(selectedScreen?.controls?.duration);
  const [restart, setRestart] = useState(selectedScreen?.controls?.restart);
  const [rewind, setRewind] = useState(selectedScreen?.controls?.rewind);
  const [fastForward, setFastForward] = useState(
    selectedScreen?.controls?.fastForward,
  );
  const [download, setDownload] = useState(selectedScreen?.controls?.download);
  const [loop, setLoop] = useState(selectedScreen?.controls?.loop);
  const [initialVolume, setInitialVolume] = useState(
    selectedScreen?.controls?.initialVolume !== undefined
      ? selectedScreen?.controls?.initialVolume
      : 100,
  );
  const [airplay, setAirplay] = useState(selectedScreen?.controls?.airplay);
  const [showMessage, setShowMessage] = useState(selectedScreen?.showMessage);
  const [selectionType, setSelectionType] = useState(
    selectedScreen?.selectionType || "preset",
  );
  const [selectedPreset, setSelectedPreset] = useState(
    selectedScreen?.selectedPreset || 0,
  );
  const [selectedIconID, setSelectedIconID] = useState(
    selectedScreen?.selectedIconID || 1,
  );
  const [textColor, setTextColor] = useState(
    selectedScreen?.textColor || "#ffffff",
  );
  const [backgroundColor, setBackgroundColor] = useState(
    selectedScreen?.backgroundColor || "#000000",
  );
  const [messageShowDelay, setMessageShowDelay] = useState(
    selectedScreen?.messageShowDelay || "3s",
  );

  const [colors, setColors] = useState("#000000");

  useEffect(() => {
    setWidth(selectedScreen?.width);
    setHeight(
      selectedScreen?.height ??
        (loaderData?.audio?.playerType === "playlist-audio"
          ? "100%"
          : undefined),
    );
    setBorderRadius(
      selectedScreen?.borderRadius ?? SCREEN_DEFAULTS.borderRadius,
    );
    setBorderWidth(selectedScreen?.borderWidth ?? SCREEN_DEFAULTS.borderWidth);
    setBorderStyle(selectedScreen?.borderStyle ?? SCREEN_DEFAULTS.borderStyle);
    setBorderColor(selectedScreen?.borderColor ?? SCREEN_DEFAULTS.borderColor);
    setIconSize(selectedScreen?.iconSize);
    setIconColor(selectedScreen?.iconColor);
    setBackground(selectedScreen?.background ?? SCREEN_DEFAULTS.background);
    setTextColor(selectedScreen?.textColor);
    setBackgroundColor(selectedScreen?.backgroundColor);
    setSbAlign(selectedScreen?.sbAlign);
    setSbAllSideGap(selectedScreen?.sbAllSideGap);
    setShowMessage(selectedScreen?.showMessage);
    setSelectedIconID(selectedScreen?.iconID);
    setBackgroundImage(selectedScreen?.backgroundImage);
    setImage(selectedScreen?.image);
    setMargin(selectedScreen?.margin ?? SCREEN_DEFAULTS.margin);
    setPadding(selectedScreen?.padding ?? SCREEN_DEFAULTS.padding);
    setMessageShowDelay(selectedScreen?.messageShowDelay);
    setSelectionType(selectedScreen?.selectionType);
    setSelectedPreset(selectedScreen?.selectedPreset);
    setSelectedIconID(selectedScreen?.selectedIconID);
  }, [selectedScreen]);

  const isLoading =
    ["loading", "submitting"]?.includes(nav.state) &&
    ["POST"].includes(nav.formMethod);

  const [, setSearchParams] = useSearchParams();

  let controls = {
    controls: [
      play & "play",
      "progress",
      "current-time",
      "mute",
      "volume",
      "settings",
    ],
  };
  if (screen === "screenOne") {
    controls = {
      // controls: <ScreenTwo image={image} title={title}/>,
    };
  } else if (screen == "screenTwo") {
    // Plyr expects an HTML string of controls (was a broken <ScreenOne />).
    controls = { controls: screenOne(iconSize) };
  } else if (screen == "screenDefault") {
    controls = {
      controls: [
        play && "play",
        progress && "progress",
        currentTime && "current-time",
        duration && "duration",
        mute && "mute",
        volume && "volume",
        settings && "settings",
      ],
    };
  }

  // useEffect(() => {
  //   setSearchParams({ fullscreen: true });
  // }, []);

  useEffect(() => {
    if (action?.createAudio?.url) {
      setUrl(action?.createAudio?.url);
    }
  }, [action]);

  const handleBack = useCallback(() => {
    setSearchParams({});
    navigate("/app");
  }, []);

  const [items, setItems] = useState(() => {
    try {
      return loaderData?.audio?.audioPlayList !== "undefined" &&
        loaderData?.audio?.audioPlayList?.length > 0
        ? JSON.parse(loaderData?.audio?.audioPlayList)
        : [];
    } catch (error) {
      console.error("Error parsing JSON:", error);
      return [];
    }
  });

  const handleUpdateCSS = () => {
    submit(
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
          selectionType,
        ],
      },
      { method: "POST" },
    );
  };

  const handleUpdate = () => {
    handleUpdateCSS();
    const controls = {
      currentTime,
      mute,
      play,
      progress,
      settings,
      volume,
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

    submit(
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
    shopify.toast.show("Successfully Saved!");
  };
  const [validURL, setValidURL] = useState(
    "https://cdn.plyr.io/static/demo/Kishi_Bashi_-_It_All_Began_With_a_Burst.mp3",
  );
  const handleSubmitFile = (fileUrl, fileType, index) => {
    setLoading(true);
    const formData = new FormData();

    formData.append("async-upload", fileUrl[0]);
    const url = `https://files.bplugins.com/wp-json/media-upload/v1/image-upload`;
    fetch(url, {
      method: "POST",
      body: formData,
    })
      .then((res) => res.json())
      .then((imageData) => {
        if (imageData?.success) {
          const controls = {
            currentTime,
            mute,
            play,
            progress,
            settings,
            volume,
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
            showMessage,
            messageShowDelay,
            sbAlign: sbAlign,
            sbAllSideGap: sbAllSideGap,
            backgroundColor: backgroundColor,
            textColor,
            selectedIconID,
            selectionType,
            selectedPreset,
          };

          if (fileType == "playList" && url) {
            submit(
              {
                url: url,
                title: title,
                mainColor: mainColor,
                id: loaderData?.audio?.id,
                screen: screen,
                screenData: JSON.stringify(screenData),
                audioPlayList: items?.length
                  ? JSON.stringify([...items, (items[index].url = url)])
                  : [],
              },
              { method: "PATCH" },
            );
          } else if (fileType == "singlePlayer" && url) {
            submit(
              {
                url: url,
                title: title,
                mainColor: mainColor,
                id: loaderData?.audio?.id,
                screen: screen,
                screenData: JSON.stringify(screenData),
                audioPlayList: items?.length ? JSON.stringify(items) : [],
              },
              { method: "PATCH" },
            );
          }

          setFiles([]);
          setLoading(false);
          shopify.toast.show("Successfully Saved!");
        } else {
          setLoading(false);
          shopify.toast.show("Upload failed. Please try again.", {
            isError: true,
          });
        }
      })
      .catch((error) => {
        console.error("Upload error:", error);
        setLoading(false);
        shopify.toast.show("Upload failed. Please try again.", {
          isError: true,
        });
      });
  };

  function removeURLParams(url) {
    try {
      const parsedURL = new URL(url);
      return parsedURL.origin + parsedURL.pathname;
    } catch (error) {
      return null;
    }
  }

  function validateMediaURL(url) {
    if (url === null) {
      return false;
    }
    // Regular expression to check if URL is valid
    const urlPattern =
      /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})(\/[\w .-]*)*\/?$/;

    // Supported audio and video file extensions
    const mediaExtensions = [
      "mp3",
      "wav",
      "ogg",
      "aac",
      "flac", // audio formats
      "mp4",
      "mov",
      "avi",
      "mkv",
      "webm",
      "wmv",
    ]; // video formats

    // Check if URL is valid
    if (!urlPattern.test(url)) {
      return false;
    }

    // Extract the file name from the URL, ignoring query parameters
    const cleanURL = new URL(url).pathname;

    // Extract the file extension from the cleaned URL
    const extension = cleanURL.split(".").pop().toLowerCase();

    // Check if the URL has a valid audio or video extension
    return mediaExtensions.includes(extension);
  }

  useEffect(() => {
    setFiles([]);
    if (validateMediaURL(removeURLParams(url))) {
      setIsValid(true);
      setValidURL(url);
    } else {
      setIsValid(false);
    }
  }, [url]);

  const copyId = (id) => {
    navigator.clipboard.writeText(id);
    shopify.toast.show("I'd Copied Successfully");
  };

  useEffect(() => {
    const newItems = items?.map((item, index) => {
      return {
        ...item,
        screen,
        content: title,
        artist: item?.artist,
        poster: item?.poster,
      };
    });
    setItems(newItems);
  }, [screen]);

  const [file, setFile] = useState();
  const [isUploading, setIsUploading] = useState(false);

  const handleDropZoneDrop = useCallback(
    (_dropFiles, acceptedFiles, _rejectedFiles) => {
      setFile(acceptedFiles[0]);
      setIsUploading(true);
      submit(
        {
          name: acceptedFiles[0]?.name,
          type: acceptedFiles[0]?.type,
          size: acceptedFiles[0]?.size,
          file,
        },
        { method: "POST" },
      );
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
          const uploadResponse = await fetch(actionData?.stagedUpload?.url, {
            method: "POST",
            mode: "no-cors",
            headers: {
              // Set appropriate headers
              "Content-Type": file?.type, // Change if needed
              // Add any other headers if required (like Authorization)
              "Access-Control-Allow-Origin": "*",
            },
            body: formDataFile,
          });

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
          setTimeout(() => {
            // fetcher.load("/app/mediaaa"); // Triggers the loader to fetch new data
          }, 5000);
        } catch (error) {
          setIsUploading(false);
          setFile();
          console.error("Upload error:", error);
          shopify.toast.show("Upload failed. Please try again.", {
            isError: true,
          });
        }
      }
    };

    uploadFile();
  }, [actionData, file]);

  const data = {
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
    handleBack,
    loaderData,
    isLoading,
    sbPosition,
    sbAlign,
    setSbAlign,
    screen,
    screens,
    setScreen,
    items,
    handleDropZoneDrop,
    files,
    loading,
    setItems,
    handleSubmitFile,
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
    controls: {
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
      initialVolume,
      setInitialVolume,
      airplay,
      setAirplay,
    },
    backgroundImage,
    validateMediaURL,
    setUrl,
    setBackgroundImage,
    handleUpdate,
    setPlayer,
    player,
    removeURLParams,
    selectedFile,
    setSelectedFile,
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
  };

  useEffect(() => {
    if (location.pathname.split("/")?.length === 4) {
      return navigate(-1);
    }
  }, [location.pathname, location, navigate]);

  return (
    <CustomizeContext.Provider value={data}>
      <ui-title-bar title="Customize player">
        <button onClick={() => openSupport()}>Support</button>
      </ui-title-bar>
      <Outlet />
    </CustomizeContext.Provider>
  );
};

export default Customize;
