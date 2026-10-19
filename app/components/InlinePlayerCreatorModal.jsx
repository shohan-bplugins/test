import { useCallback, useEffect, useRef, useState } from "react";
import { CustomSpan, CustomBox } from "../utils/polarisWebComponents";
import { useFetcher, useNavigate } from "@remix-run/react";
import {
  Modal,
  DropZone,
  Box,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Thumbnail,
  TextField,
  Icon,
} from "@shopify/polaris";
import { DragHandleIcon, ListBulletedIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import "../styles/inlinePlayerCreator.css";
import FileUploadModal from "./Mediaaa";
import ImgUploadModal from "./MediaImg";

const MEDIA_ENDPOINT = "/app/api/media";
const DEFAULT_BRAND_COLOR = "#1a8d5a";
const validImageTypes = ["image/gif", "image/jpeg", "image/png"];

/**
 * Inline player creation for the Product Video page.
 *
 * Reuses the Videos page's media-library pickers (FileUploadModal /
 * ImgUploadModal — App Bridge modals) and the route-agnostic create/upload
 * action at /app/api/media. The user picks a brand color, a video, and a
 * poster, then the player is created (with preventRedirect) and handed back to
 * the parent for assignment — no navigation away from the product page.
 *
 * Props:
 *  - open: boolean
 *  - playerType: "single" | "multiple"
 *  - onAssigned: (newVideoId) => void   // persist the assignment
 *  - onClose: () => void
 */
export default function InlinePlayerCreatorModal({
  open,
  playerType = "single",
  onAssigned,
  onClose,
}) {
  const shopify = useAppBridge();
  const navigate = useNavigate();

  // Two fetchers, both pointed at /app/api/media:
  //  - mediaFetcher: file library load + staged upload + fileCreate + poll + pagination
  //  - createFetcher: the final create-player POST (keeps {id} response isolated)
  const mediaFetcher = useFetcher();
  const createFetcher = useFetcher();

  const [step, setStep] = useState("essentials"); // "essentials" | "done"
  const [newId, setNewId] = useState(null);

  // --- chosen values -------------------------------------------------------
  const [title, setTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [url, setUrl] = useState("");
  const [videoType, setVideoType] = useState("html5");
  const [poster, setPoster] = useState("");
  // Grid/multiple players hold a list of videos: [{ video, poster, label }].
  const [gridItems, setGridItems] = useState([]);

  // --- media library state (ported from app.videos.jsx) --------------------
  const [videoFiles, setVideoFiles] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [videoPageInfo, setVideoPageInfo] = useState(null);
  const [imagePageInfo, setImagePageInfo] = useState(null);

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedImgs, setSelectedImgs] = useState([]);
  const [uploadedAndSelectedFile, setUploadedAndSelectedFile] = useState([]);
  const [uploadedAndSelectedImg, setUploadedAndSelectedImg] = useState([]);

  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [newUrl, setNewUrl] = useState("");
  const [addUrlModalActive, setAddUrlModalActive] = useState(false);
  const [addPosterModalActive, setAddPosterModalActive] = useState(false);

  const [inputValues, setInputValues] = useState({});
  const [isGridView, setIsGridView] = useState("grid_view");
  const [isHiddenUploadOption, setIsHiddenUploadOption] = useState(false);
  const [preview, setPreview] = useState(0);
  const [previewImg, setPreviewImg] = useState(0);

  const loadedRef = useRef(false);
  const isLoading = mediaFetcher.state !== "idle";

  const defaultTitle =
    playerType === "single" ? "Single Video" : "Multiple Video";

  // Load the file library the first time the modal opens.
  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      mediaFetcher.load(MEDIA_ENDPOINT);
    }
  }, [open, mediaFetcher]);

  // Seed a sensible default title when the modal opens (until the user edits it).
  useEffect(() => {
    if (open && !titleEdited) setTitle(defaultTitle);
  }, [open, defaultTitle, titleEdited]);

  // Keep the library lists in sync with whatever the media action returns
  // (initial load, pagination, post-upload refresh).
  useEffect(() => {
    const d = mediaFetcher.data;
    if (!d) return;
    if (d.videoFiles) setVideoFiles(d.videoFiles);
    if (d.imageFiles) setImageFiles(d.imageFiles);
    if (d.pageInfoVideo) setVideoPageInfo(d.pageInfoVideo);
    if (d.pageInfoImage) setImagePageInfo(d.pageInfoImage);
  }, [mediaFetcher.data]);

  // Staged upload: once the action hands back a staged target, push the file
  // to Shopify, then register it with fileCreate (resourceUrl).
  useEffect(() => {
    const uploadFile = async () => {
      const staged = mediaFetcher.data?.stagedUpload;
      if (staged?.url && file) {
        const body = new FormData();
        staged.parameters.forEach(({ name, value }) =>
          body.append(name, value),
        );
        body.append("file", file);
        try {
          await fetch(staged.url, { method: "POST", mode: "no-cors", body });
          mediaFetcher.submit(
            {
              name: file.name,
              type: file.type,
              resourceUrl: staged.resourceUrl,
            },
            { method: "PUT", action: MEDIA_ENDPOINT },
          );
          setFile(null);
        } catch (error) {
          setIsUploading(false);
          console.error("Upload error:", error);
        }
      }
    };
    uploadFile();
  }, [mediaFetcher.data, file]);

  // Poll the uploaded file's processing status until READY, refreshing lists
  // (mirrors the customize page's upload flow: animated progress while
  // processing, toast on failure, fresh library list without a reload).
  useEffect(() => {
    let interval = null;
    const d = mediaFetcher.data;
    if (d?.createFileResult?.id || d?.status?.[0]?.id) {
      const status = d?.status?.[0]?.fileStatus;
      if (status === "FAILED" || d?.status?.[0]?.fileErrors?.length > 0) {
        setIsUploading(false);
        setUploadProgress(0);
        try {
          shopify.toast.show("File upload failed. Please try again.", {
            isError: true,
          });
        } catch (e) {
          /* toast unavailable outside the admin — ignore */
        }
      } else if (status !== "READY") {
        if (d?.videoFiles) setVideoFiles(d.videoFiles);
        if (d?.imageFiles) setImageFiles(d.imageFiles);
        setUploadProgress((prev) => Math.min((prev || 15) + 5, 95));
        interval = setInterval(() => {
          mediaFetcher.submit(
            { ids: [d?.createFileResult?.id || d?.status?.[0]?.id] },
            { method: "PUT", action: MEDIA_ENDPOINT },
          );
        }, 2000);
      } else {
        if (d?.videoFiles) setVideoFiles(d.videoFiles);
        if (d?.imageFiles) setImageFiles(d.imageFiles);
        // Auto-select the file that just finished processing, so the user
        // doesn't have to find it in the library and pick it by hand. Videos
        // become the player's video; images become the poster.
        const readyId = d?.status?.[0]?.id;
        const isImage = d?.status?.[0]?.__typename === "MediaImage";
        const list = isImage ? d?.imageFiles : d?.videoFiles;
        const node =
          list?.find((e) => e?.node?.id === readyId)?.node || list?.[0]?.node;
        if (node) {
          if (isImage) {
            setSelectedImgs(node);
            setUploadedAndSelectedImg(node);
            try {
              shopify.modal.hide("upload-img");
            } catch (e) {
              /* picker already closed — ignore */
            }
          } else {
            setSelectedFiles(node);
            setUploadedAndSelectedFile(node);
            try {
              shopify.modal.hide("upload-video");
            } catch (e) {
              /* picker already closed — ignore */
            }
          }
        }
        setUploadProgress(100);
        setIsUploading(false);
        setTimeout(() => setUploadProgress(0), 1000);
        clearInterval(interval);
      }
    }
    return () => clearInterval(interval);
  }, [mediaFetcher.data]);

  // Derive the chosen video from the selected library video. Single players
  // keep one url/poster; grid players append each pick to gridItems.
  useEffect(() => {
    const f = uploadedAndSelectedFile;
    if (!f || Array.isArray(f)) return;
    const u =
      (f?.mediaContentType === "VIDEO"
        ? f?.sources?.find((a) => a.format === "mp4")?.url
        : f?.url) ||
      f?.embedUrl ||
      "";
    if (!u) return;
    const p = f?.preview?.image?.url || f?.preview?.image?.src || "";
    const label = f?.filename || f?.alt || "Video";

    if (playerType === "multiple") {
      setGridItems((prev) => [...prev, { video: u, poster: p, label }]);
      return;
    }

    setUrl(u);
    let vt = "html5";
    if (u.includes("youtu")) vt = "youtube";
    else if (u.includes("vimeo")) vt = "vimeo";
    setVideoType(vt);
    if (p) setPoster((prev) => prev || p);
    // Suggest the file's name as the title until the user types their own.
    if (!titleEdited && f?.filename) setTitle(f.filename);
  }, [uploadedAndSelectedFile]);

  // Derive the poster from the selected library image (single players only —
  // grid items take their poster from each video's thumbnail).
  useEffect(() => {
    if (playerType === "multiple") return;
    const img = uploadedAndSelectedImg;
    if (!img || Array.isArray(img)) return;
    const p = img?.preview?.image?.url || img?.preview?.image?.src;
    if (p) setPoster(p);
  }, [uploadedAndSelectedImg]);

  // Create succeeded → assign and advance to the "done" step.
  useEffect(() => {
    if (createFetcher.state === "idle" && createFetcher.data?.id) {
      setNewId(createFetcher.data.id);
      onAssigned?.(createFetcher.data.id);
      setStep("done");
    }
  }, [createFetcher.state, createFetcher.data]);

  // --- handlers (ported) ---------------------------------------------------
  const handleScroll = (e) => {
    setIsHiddenUploadOption(e.target.scrollTop >= 50);
  };
  const handleSelectChange = useCallback((value) => setIsGridView(value), []);
  const toggleFileSelection = useCallback((f) => setSelectedFiles(f), []);
  const toggleImgSelection = useCallback((img) => setSelectedImgs(img), []);

  const handleDropZoneDrop = useCallback(
    (_dropFiles, acceptedFiles) => {
      const accepted = acceptedFiles[0];
      setFile(accepted);
      setIsUploading(true);
      mediaFetcher.submit(
        { name: accepted?.name, type: accepted?.type, size: accepted?.size },
        { method: "POST", action: MEDIA_ENDPOINT },
      );
    },
    [mediaFetcher],
  );

  const confirmNewURL = useCallback(() => {
    if (newUrl) {
      setIsUploading(true);
      mediaFetcher.submit(
        { contentType: "EXTERNAL_VIDEO", originalSource: newUrl },
        { method: "PUT", action: MEDIA_ENDPOINT },
      );
    }
  }, [newUrl, mediaFetcher]);

  const uploadImage = useCallback(
    (f) => {
      mediaFetcher.submit(
        { name: f.name, type: f.type, resourceUrl: f?.resourceUrl },
        { method: "PUT", action: MEDIA_ENDPOINT },
      );
    },
    [mediaFetcher],
  );

  const loadNextPage = (fileType) => {
    mediaFetcher.submit(
      {
        endCursor:
          fileType === "video"
            ? videoPageInfo?.endCursor
            : imagePageInfo?.endCursor,
      },
      { method: "PUT", action: MEDIA_ENDPOINT },
    );
  };
  const loadPrevPage = (fileType) => {
    mediaFetcher.submit(
      {
        startCursor:
          fileType === "video"
            ? videoPageInfo?.startCursor
            : imagePageInfo?.startCursor,
      },
      { method: "PUT", action: MEDIA_ENDPOINT },
    );
  };

  const handleCreate = () => {
    const isSingle = playerType === "single";
    const payload = {
      id: "052020",
      title: (title || "").trim() || defaultTitle,
      playerType,
      styles: JSON.stringify({
        width: "100%",
        borderRadius: "5px",
        brandColor,
      }),
      preventRedirect: "true",
    };
    if (isSingle) {
      payload.url = url || "";
      payload.videoType = videoType || "html5";
      payload.poster = poster || "";
    } else {
      payload.url = "";
      payload.videoType = "html5";
      payload.poster = "";
      payload.items = JSON.stringify(
        gridItems.map((it) => ({ video: it.video, poster: it.poster })),
      );
    }
    createFetcher.submit(payload, { method: "POST", action: MEDIA_ENDPOINT });
  };

  const handleClose = () => {
    // Reset so a re-open starts clean.
    setStep("essentials");
    setNewId(null);
    setTitle("");
    setTitleEdited(false);
    setBrandColor(DEFAULT_BRAND_COLOR);
    setUrl("");
    setVideoType("html5");
    setPoster("");
    setGridItems([]);
    setSelectedFiles([]);
    setSelectedImgs([]);
    setUploadedAndSelectedFile([]);
    setUploadedAndSelectedImg([]);
    onClose?.();
  };

  // --- picker markup (ported) ---------------------------------------------
  const fileUpload = (
    <InlineStack gap="300" blockAlign="center" align="center">
      <DropZone.FileUpload>
        <Box padding="400">
          <Button variant="primary">Click to Upload Files</Button>
        </Box>
      </DropZone.FileUpload>
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
  );

  const imgUpload = (
    <InlineStack gap="300" blockAlign="center" align="center">
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
  );

  const uploadedFile = file && (
    <InlineStack gap="200" blockAlign="center">
      {/* s-thumbnail takes `src`, not Polaris React's `source`. It has no
          icon fallback, so an unpreviewable file just shows the empty
          placeholder rather than a note glyph. */}
      <Thumbnail
        size="small"
        alt={file.name}
        source={
          validImageTypes.includes(file.type) && typeof window !== "undefined"
            ? window.URL.createObjectURL(file)
            : ""
        }
      />
      <BlockStack gap="100">
        <Text as="span">{file.name}</Text>
        <Text as="span" tone="subdued">
          {file.size} bytes
        </Text>
      </BlockStack>
    </InlineStack>
  );

  const viewOptions = [
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

  const noop = () => {};

  const isSingle = playerType === "single";
  const videoChosen = !Array.isArray(uploadedAndSelectedFile) && !!url;
  // A single-video player needs both a video and a poster. A grid player has
  // neither field — each item brings its own video, and its poster is taken
  // from that video's thumbnail — so it only needs at least one item.
  const canCreate = isSingle ? videoChosen && !!poster : gridItems.length > 0;
  const videoThumb =
    uploadedAndSelectedFile?.preview?.image?.url ||
    uploadedAndSelectedFile?.preview?.image?.src ||
    "";
  const videoLabel =
    uploadedAndSelectedFile?.filename ||
    uploadedAndSelectedFile?.alt ||
    "Video selected";

  // Compact media-picker row: preview box + label + action button.
  const MediaRow = ({
    thumb,
    placeholder,
    primaryText,
    helpText,
    chosen,
    onPick,
  }) => (
    <CustomBox className={`ipcm-row${chosen ? " is-chosen" : ""}`}>
      <Box
        borderColor="border"
        borderWidth="025"
        borderRadius="200"
        padding="400"
      >
        <InlineStack gap="400" blockAlign="center" wrap={false}>
          <CustomBox className="ipcm-row-thumb">
            {thumb ? <img src={thumb} alt="" /> : placeholder}
          </CustomBox>
          <CustomBox className="ipcm-row-body" style={{ flexGrow: 1 }}>
            <BlockStack gap="100">
              <Text as="span" fontWeight="bold">
                {primaryText}
              </Text>
              <Text as="span" tone="subdued">
                {helpText}
              </Text>
            </BlockStack>
          </CustomBox>
          <Button onClick={onPick}>{chosen ? "Change" : "Select"}</Button>
        </InlineStack>
      </Box>
    </CustomBox>
  );

  const videoIcon = (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M10.5 9.2v5.6l4.5-2.8-4.5-2.8Z" fill="currentColor" />
    </svg>
  );
  const imageIcon = (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="4.5"
        width="18"
        height="15"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
      <path
        d="M5 17l4.5-4.5 3 3L16 12l3 3.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <>
      {/* Essentials step */}
      <Modal
        open={open && step === "essentials"}
        onClose={handleClose}
        title={
          isSingle
            ? "Create & assign a player"
            : "Create & assign a grid player"
        }
        primaryAction={{
          content: "Create player",
          onAction: handleCreate,
          loading: createFetcher.state !== "idle",
          disabled: !canCreate || createFetcher.state !== "idle",
        }}
        secondaryActions={[{ content: "Cancel", onAction: handleClose }]}
      >
        <Modal.Section>
          <BlockStack gap="500">
            {/* Title */}
            <TextField
              label="Player title"
              value={title}
              onChange={(value) => {
                setTitle(value);
                setTitleEdited(true);
              }}
              placeholder={defaultTitle}
              autoComplete="off"
              helpText="Shown in your players list. You can change it later."
            />

            {/* Brand color */}
            <BlockStack gap="200">
              <TextField
                label="Brand color"
                value={brandColor}
                onChange={(value) => setBrandColor(value)}
                helpText="Player accent (controls, progress bar)"
                prefix={
                  <input
                    type="color"
                    value={brandColor}
                    onChange={(e) => setBrandColor(e.target.value)}
                    style={{
                      border: "none",
                      padding: 0,
                      width: "24px",
                      height: "24px",
                      cursor: "pointer",
                      background: "none",
                    }}
                  />
                }
              />
            </BlockStack>

            {isSingle ? (
              <>
                {/* Video */}
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Video{" "}
                    <Text as="span" tone="critical">
                      *
                    </Text>
                  </Text>
                  <MediaRow
                    thumb={videoThumb}
                    placeholder={videoIcon}
                    chosen={videoChosen}
                    primaryText={videoChosen ? videoLabel : "No video selected"}
                    helpText={
                      videoChosen
                        ? "Tap Change to pick another from your library"
                        : "Required — choose or upload a video from your Shopify library"
                    }
                    onPick={() => shopify.modal.show("upload-video")}
                  />
                </BlockStack>

                {/* Poster */}
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Poster image{" "}
                    <Text as="span" tone="critical">
                      *
                    </Text>
                  </Text>
                  <MediaRow
                    thumb={poster}
                    placeholder={imageIcon}
                    chosen={!!poster}
                    primaryText={
                      poster ? "Poster selected" : "No poster selected"
                    }
                    helpText={
                      poster
                        ? "Shown before the video plays"
                        : "Required — the image shown before the video plays"
                    }
                    onPick={() => shopify.modal.show("upload-img")}
                  />
                </BlockStack>

                {/* Explain the disabled Create button instead of leaving the
                    merchant guessing what's still missing. */}
                {!canCreate && (
                  <Text as="p" tone="critical">
                    {`Add a ${[
                      !videoChosen && "video",
                      !poster && "poster image",
                    ]
                      .filter(Boolean)
                      .join(" and ")} to create this player.`}
                  </Text>
                )}
              </>
            ) : (
              /* Grid videos */
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">
                    Videos{gridItems.length ? ` (${gridItems.length})` : ""}
                  </Text>
                  <Button
                    variant="tertiary"
                    onClick={() => shopify.modal.show("upload-video")}
                  >
                    + Add video
                  </Button>
                </InlineStack>

                {gridItems.length === 0 ? (
                  <CustomBox className="ipcm-empty">
                    <BlockStack gap="200" inlineAlign="center">
                      {videoIcon}
                      <Text as="span" tone="subdued">
                        No videos yet — add one or more videos for your grid.
                      </Text>
                    </BlockStack>
                  </CustomBox>
                ) : (
                  <BlockStack gap="300">
                    {gridItems.map((it, i) => (
                      <CustomBox
                        key={`${it.video}-${i}`}
                        className="ipcm-row is-chosen"
                      >
                        <Box
                          padding="300"
                          borderWidth="025"
                          borderColor="border"
                          borderRadius="200"
                        >
                          <InlineStack gap="300" blockAlign="center">
                            <CustomBox className="ipcm-row-thumb is-small">
                              {it.poster ? (
                                <img src={it.poster} alt="" />
                              ) : (
                                videoIcon
                              )}
                            </CustomBox>
                            <CustomBox
                              className="ipcm-row-body"
                              style={{ flexGrow: 1 }}
                            >
                              <Text
                                as="span"
                                fontWeight="bold"
                                className="ipcm-row-title"
                              >
                                {it.label || `Video ${i + 1}`}
                              </Text>
                            </CustomBox>
                            <Button
                              variant="tertiary"
                              tone="critical"
                              onClick={() =>
                                setGridItems((prev) =>
                                  prev.filter((_, idx) => idx !== i),
                                )
                              }
                              accessibilityLabel={`Remove video ${i + 1}`}
                            >
                              Remove
                            </Button>
                          </InlineStack>
                        </Box>
                      </CustomBox>
                    ))}
                  </BlockStack>
                )}
                <Text as="span" tone="subdued">
                  Each video uses its own thumbnail as the poster. Fine-tune
                  posters and layout later in More customize.
                </Text>
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Done step — "more customize or not" */}
      <Modal
        open={open && step === "done"}
        onClose={handleClose}
        title="Player created & assigned"
        primaryAction={{ content: "Done", onAction: handleClose }}
        secondaryActions={[
          {
            content: "More customize",
            onAction: () => newId && navigate(`/app/customize/${newId}`),
          },
        ]}
      >
        <Modal.Section>
          <Box paddingBlock="300">
            <BlockStack gap="400" inlineAlign="center">
              <CustomBox
                style={{ position: "relative", width: 76, height: 76 }}
              >
                <CustomSpan className="ipcm-ring" />
                <CustomBox className="ipcm-confetti" aria-hidden="true">
                  {Array.from({ length: 16 }).map((_, i) => {
                    const colors = [
                      "#0c8a52",
                      "#1a8d5a",
                      "#7bdcab",
                      "#ffd24a",
                      "#ff7a59",
                      "#4aa3ff",
                    ];
                    const ang = (i / 16) * Math.PI * 2;
                    const dist = 54 + (i % 3) * 12;
                    return (
                      <i
                        key={i}
                        style={{
                          "--tx": `${Math.round(Math.cos(ang) * dist)}px`,
                          "--ty": `${Math.round(Math.sin(ang) * dist)}px`,
                          "--r": `${(i * 67) % 360}deg`,
                          background: colors[i % colors.length],
                          animationDelay: `${0.45 + (i % 4) * 0.05}s`,
                        }}
                      />
                    );
                  })}
                </CustomBox>
                <CustomBox
                  className="ipcm-badge"
                  style={{
                    position: "relative",
                    width: 76,
                    height: 76,
                    borderRadius: "50%",
                    background: "#0c8a52",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 6px 18px rgba(0,0,0,0.30)",
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="40"
                    height="40"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      className="ipcm-check"
                      d="M5 12.5l4 4 10-10"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </CustomBox>
              </CustomBox>
              <CustomBox className="ipcm-text" style={{ textAlign: "center" }}>
                <BlockStack gap="200" inlineAlign="center">
                  {/* `className` and `color` were silently dropped here: Text
                      forwards neither. `tone` is the real prop, and alignment
                      replaces the <br /> that was faking a centred second line. */}
                  <Text
                    as="h3"
                    variant="headingMd"
                    tone="success"
                    alignment="center"
                  >
                    Successfully Created &amp; Assigned
                  </Text>
                </BlockStack>
              </CustomBox>
            </BlockStack>
          </Box>
        </Modal.Section>
      </Modal>

      {/* Always-mounted App Bridge media pickers (shown via shopify.modal.show) */}
      {open && (
        <>
          <FileUploadModal
            inputValues={inputValues}
            setInputValues={setInputValues}
            isHiddenUploadOption={isHiddenUploadOption}
            setAddUrlModalActive={setAddUrlModalActive}
            options={viewOptions}
            handleSelectChange={handleSelectChange}
            isGridView={isGridView}
            preview={preview}
            handleScroll={handleScroll}
            handleDropZoneDrop={handleDropZoneDrop}
            isUploading={isUploading}
            uploadedFile={uploadedFile}
            fileUpload={fileUpload}
            filteredFiles={videoFiles || []}
            selectedFiles={selectedFiles}
            toggleFileSelection={toggleFileSelection}
            addUrlModalActive={addUrlModalActive}
            confirmNewURL={confirmNewURL}
            newUrl={newUrl}
            setNewUrl={setNewUrl}
            toastMarkup={null}
            isLoading={isLoading}
            setPreview={setPreview}
            actionData={mediaFetcher.data}
            files={videoFiles || []}
            uploadedAndSelectedFile={uploadedAndSelectedFile}
            setUploadedAndSelectedFile={setUploadedAndSelectedFile}
            toggleModal={noop}
            loadNextPage={loadNextPage}
            loadPrevPage={loadPrevPage}
            pageInfo={videoPageInfo}
            uploadProgress={uploadProgress}
          />
          <ImgUploadModal
            inputValues={inputValues}
            setInputValues={setInputValues}
            isHiddenUploadOption={isHiddenUploadOption}
            setAddPosterModalActive={setAddPosterModalActive}
            setAddOverlayLogoModalActive={noop}
            options={viewOptions}
            handleSelectChange={handleSelectChange}
            isGridView={isGridView}
            previewImg={previewImg}
            handleScroll={handleScroll}
            handleDropZoneDrop={handleDropZoneDrop}
            isUploading={isUploading}
            uploadedFile={uploadedFile}
            uploadedAndSelectedImg={uploadedAndSelectedImg}
            setUploadedAndSelectedImg={setUploadedAndSelectedImg}
            uploadedAndSelectedLogo={[]}
            setUploadedAndSelectedLogo={noop}
            fileUpload={imgUpload}
            filteredFiles={imageFiles || []}
            selectedImgs={selectedImgs}
            toggleImgSelection={toggleImgSelection}
            setPreviewImg={setPreviewImg}
            files={imageFiles || []}
            addPosterModalActive={addPosterModalActive}
            confirmNewURL={confirmNewURL}
            newUrl={newUrl}
            setNewUrl={setNewUrl}
            toastMarkup={null}
            actionData={mediaFetcher.data}
            isLoading={isLoading}
            uploadImage={uploadImage}
            loadNextPage={loadNextPage}
            loadPrevPage={loadPrevPage}
            pageInfo={imagePageInfo}
            addOverlayLogoModalActive={false}
            uploadProgress={uploadProgress}
          />
        </>
      )}
    </>
  );
}
