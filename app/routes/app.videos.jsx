import {
  DropZone,
  Frame,
  Icon,
  Page,
  Thumbnail,
  Toast,
  Box,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Spinner,
  Badge,
  Banner,
} from "@shopify/polaris";
import {
  NoteIcon,
  DragHandleIcon,
  ListBulletedIcon,
} from "@shopify/polaris-icons";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Link,
  isRouteErrorResponse,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
  useSubmit,
  useSearchParams,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { ClientOnly } from "remix-utils/client-only";
import FileUploadModal from "../components/Mediaaa";
import { Modal, TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import "../styles/plyr.css";
import "../styles/styles.css";
import "../styles/MultipleVideoItems.css";
import ImgUploadModal from "../components/MediaImg";
import { loader as handleIndexLoader } from "./pages/index/loader";
import { action as handleIndexAction } from "./pages/index/action";
import { VideoList } from "./pages/index/components/VideoList";
import {
  CustomButton,
  CustomSpan,
  CustomBox,
  flag,
  useGo,
} from "../utils/polarisWebComponents";
import { resolvePlan, planUsage } from "../utils/planLimits";
import { appBridge } from "../utils/appBridge";

export const loader = handleIndexLoader;

export const action = handleIndexAction;

export default function Index() {
  const nav = useNavigation();
  const submit = useSubmit();
  const actionData = useActionData();
  const loaderData = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const { allFiles: initialFiles } = useLoaderData();
  const [files, setFiles] = useState(initialFiles);
  const apiKey = loaderData?.apiKey;

  const isLoading =
    (["loading", "submitting"].includes(nav.state) &&
      nav.formMethod === "POST") ||
    nav.formMethod === "PUT" ||
    nav.formMethod === "DELETE";

  const [warningBannerIsActive, setWarningBannerIsActive] = useState(true);
  const [player, setPlayer] = useState(null);

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

  const go = useGo();
  const [active, setActive] = useState(false);

  // The create-player dialog is an App Bridge <ui-modal>, which is shown and
  // hidden imperatively by id. `active` stays the source of truth so every
  // existing caller (toggleModal, handleClose, the ?action=new deep link)
  // keeps working unchanged.
  useEffect(() => {
    const bridge = appBridge();
    if (!bridge) return;
    if (active) bridge.modal.show("create-player-modal");
    else bridge.modal.hide("create-player-modal");
  }, [active]);

  // Esc and the dialog's own close button never route through handleClose, so
  // without this `active` would stay true and the modal could not reopen.
  useEffect(() => {
    const el = document.getElementById("create-player-modal");
    if (!el) return;
    const onHide = () => setActive(false);
    el.addEventListener("hide", onHide);
    return () => el.removeEventListener("hide", onHide);
  }, []);

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setActive(true);
      // Remove the search param so it doesn't re-trigger on refresh
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState([]);
  const [uploadedAndSelectedFile, setUploadedAndSelectedFile] = useState([]);
  const [uploadedAndSelectedImg, setUploadedAndSelectedImg] = useState([]);
  const [title, setTitle] = useState("");
  const [video, setVideo] = useState(loaderData?.videos?.url);
  const [selectedPlayerType, setSelectedPlayerType] = useState("single");

  // Shared resolver — same plan, credits and limit the dashboard shows. The
  // magic `> 5` this replaced was the Free allowance hardcoded in four files.
  const currentPlan = resolvePlan({
    plans: loaderData?.allPlans || [],
    user: loaderData?.user || actionData?.user,
  });

  const playerCount = loaderData?.totalAllVideos ?? loaderData?.videos?.length;
  const usage = planUsage(playerCount, currentPlan);

  const isPremium = currentPlan.isPaid;
  const isAtPlayerLimit = usage.atLimit;
  const handleTitleChange = useCallback((newValue) => setTitle(newValue), []);

  const toggleModal = useCallback(() => {
    setActive((active) => !active);
    setSelectedPlayerType("single");
    ready.current = true;
  }, []);

  const handleSubmitVideo = useCallback(() => {
    let videoType = "html5";
    if (url?.includes("youtu")) {
      videoType = "youtube";
    } else if (url?.includes("player.vimeo")) {
      videoType = "vimeo";
    }
    submit(
      {
        id: uploadedAndSelectedFile?.id || "052020",
        title,
        url: url,
        videoType: videoType,
        poster: poster,
      },
      { replace: true, method: "POST" },
    );
    setLoading(true);
  });

  const handleCreatePlayer = useCallback(() => {
    const isSingle = selectedPlayerType === "single";
    const submitData = {
      id: "052020",
      title: isSingle ? "Single Video" : "Multiple Video",
      url: "",
      videoType: "html5",
      poster: "",
      playerType: selectedPlayerType,
    };
    if (!isSingle) {
      submitData.items = JSON.stringify([{ video: "", poster: "" }]);
    }
    submit(submitData, { replace: true, method: "POST" });
    setLoading(true);
    setActive(false);
  }, [selectedPlayerType, submit]);

  const copyId = (id) => {
    navigator.clipboard.writeText(id);
    shopify.toast.show("Successfully Copy ID!!");
  };
  const copyEmbed = (id, title) => {
    const embedCode = `<s-box class="video-plyr-by-bplugins" data-id="${id}"></s-box>`;

    navigator.clipboard.writeText(embedCode);
    shopify.toast.show("Successfully Copy Embed Code!!");
  };

  useEffect(() => {
    if (actionData?.createVideo?.id) {
      setTitle("");
    }
  }, [actionData]);

  const handleClose = () => {
    setTitle("");
    setUrl("");
    setPoster("");
    setUploadedAndSelectedFile([]);
    setUploadedAndSelectedImg([]);
    setFile([]);
    toggleModal();
  };

  //=====================================================================================================================================//
  //-------------------------File Upload Modal---------------------------//
  //=====================================================================================================================================//

  const [inputValues, setInputValues] = useState({});

  const playerRef = useRef(null);
  const [poster, setPoster] = useState(
    uploadedAndSelectedFile?.preview?.image?.url ||
      uploadedAndSelectedFile?.preview?.image?.src ||
      uploadedAndSelectedImg?.preview?.image?.url ||
      uploadedAndSelectedImg?.preview?.image?.src ||
      "",
  );

  useEffect(() => {
    if (uploadedAndSelectedFile?.filename) {
      setTitle(uploadedAndSelectedFile?.filename);
    }
    const fileImage =
      uploadedAndSelectedFile?.preview?.image?.url ||
      uploadedAndSelectedFile?.preview?.image?.src;
    if (fileImage) {
      setPoster(fileImage);
    }
  }, [uploadedAndSelectedFile]);

  useEffect(() => {
    const selectedImage =
      uploadedAndSelectedImg?.preview?.image?.url ||
      uploadedAndSelectedImg?.preview?.image?.src;
    if (selectedImage) {
      setPoster(selectedImage);
    }
  }, [uploadedAndSelectedImg]);
  const [url, setUrl] = useState(
    (uploadedAndSelectedFile?.mediaContentType === "VIDEO"
      ? uploadedAndSelectedFile?.sources?.find((a) => a.format == "mp4")?.url
      : uploadedAndSelectedFile?.url) || uploadedAndSelectedFile?.embedUrl,
  );

  useEffect(() => {
    setUrl(
      (uploadedAndSelectedFile?.mediaContentType === "VIDEO"
        ? uploadedAndSelectedFile?.sources?.find((a) => a.format == "mp4")?.url
        : uploadedAndSelectedFile?.url) || uploadedAndSelectedFile?.embedUrl,
    );
  }, [uploadedAndSelectedFile]);

  const [filteredFiles, setFilteredFiles] = useState(files);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedImgs, setSelectedImgs] = useState([]);
  const [youtubeVimeo, setYoutubeVimeo] = useState(false);
  const [addUrlModalActive, setAddUrlModalActive] = useState(false);
  const [addPosterModalActive, setAddPosterModalActive] = useState(false);
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
    // `?? []` and the optional chain are load-bearing: `files?.filter(...)`
    // returns undefined when there are no files, and the `.sort()` on the next
    // line then throws — which, with no boundary on this route, took the whole
    // admin app down rather than just this list.
    const filteredFiles = (files ?? []).filter((item) => {
      const itemDate = item?.node?.createdAt?.split("T")[0];
      if (!itemDate) return false;

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
  }, [inputValues, initialFiles, actionData, files]);

  const [isUploading, setIsUploading] = useState(false);
  // Was never declared, yet setUploadProgress() was called below — every
  // completed staged upload threw a ReferenceError. Both media modals already
  // render a progress bar from this value (VideoModal.jsx:214, ImgModal.jsx:204),
  // so the state simply had to exist and be passed down.
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    let interval = null;

    if (actionData?.createFileResult?.id || actionData?.status?.[0]?.id) {
      if (actionData?.status?.[0].fileStatus == "FAILED") {
        toggleFileSelection(null);
        toggleImgSelection(null);
        clearInterval(interval);
        setIsUploading(false);

        const allVideoFiles = actionData?.videoFiles.filter(
          (item) => item?.none?.id != actionData?.status?.[0]?.id,
        );
        const allImageFiles = actionData?.imageFiles.filter(
          (item) => item?.node?.id != actionData?.status?.[0]?.id,
        );

        setVideoFiles(allVideoFiles);
        setImageFiles(allImageFiles);

        setToastContent({
          content: "File upload failed. Please try again.",
          error: true,
        });
        setToastActive(true);

        console.error("File upload failed:", actionData?.videoFiles);
      } else if (actionData?.status?.[0].fileStatus !== "READY") {
        // setFiles(actionData?.allFiles);
        setVideoFiles(actionData?.videoFiles);
        setImageFiles(actionData?.imageFiles);
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
      } else if (actionData?.status?.[0]?.fileStatus == "READY") {
        setVideoFiles(actionData?.videoFiles);
        setImageFiles(actionData?.imageFiles);
        setFiles(actionData?.allFiles);
        toggleFileSelection(videoFiles[0]?.node);
        toggleImgSelection(imageFiles[0]?.node);
        setUploadProgress(100);
        setIsUploading(false);
        setTimeout(() => setUploadProgress(0), 1000);
        clearInterval(interval);
      }
    }

    return () => {
      clearInterval(interval);
    };
  }, [
    actionData,
    actionData?.createFileResult?.id,
    actionData?.status?.[0]?.fileStatus,
    submit,
    loaderData,
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
    if (newUrl) {
      submit(
        {
          contentType: "EXTERNAL_VIDEO",
          originalSource: newUrl,
        },
        { method: "PUT" },
      );
      setFileToRename(null);
      setToastContent({ content: "Add New URL successfully", error: false });
      setToastActive(true);
    }
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
          await fetch(actionData?.stagedUpload?.url, {
            method: "POST",
            mode: "no-cors",
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
        } catch (error) {
          setIsUploading(false);
          console.error("Upload error:", error);
        }
      }
    };

    uploadFile();
  }, [actionData, file]);
  const validImageTypes = ["image/gif", "image/jpeg", "image/png"];

  const fileUpload = (
    <InlineStack gap="300" blockAlign="center" align="center">
      <DropZone.FileUpload>
        {/* Deliberately a <CustomSpan>, not a button. DropZone.FileUpload renders its
            own label + input, so a real button here was a focusable control with
            no onClick sitting inside that label — a keyboard dead end. This is
            purely the visual affordance; DropZone handles activation. */}
        <CustomBox className="vp-dz-cta">
          <CustomSpan className="modern-btn modern-btn-primary">
            Click to Upload Files
          </CustomSpan>
        </CustomBox>
      </DropZone.FileUpload>
      <Button
        onClick={(e) => {
          e.stopPropagation();
          setAddUrlModalActive(true);
        }}
        disabled={flag(isLoading)}
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
        disabled={flag(isLoading)}
      >
        Upload From URL
      </Button>
    </InlineStack>
  );
  const uploadedFile = file && (
    <InlineStack gap="300" blockAlign="center">
      {/* Thumbnail stays Polaris React: s-thumbnail exists but its attribute
          names are unverified, and a wrong one renders nothing at all. */}
      <Thumbnail
        size="small"
        alt={file.name}
        source={
          validImageTypes.includes(file.type)
            ? typeof window !== "undefined"
              ? window.URL.createObjectURL(file)
              : NoteIcon
            : NoteIcon
        }
      />
      <BlockStack gap="0">
        <Text as="span">{file.name}</Text>
        <Text as="span" tone="subdued">
          {file.size} bytes
        </Text>
      </BlockStack>
    </InlineStack>
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

  const ready = useRef(false);

  useEffect(() => {
    if (ready.current) {
      if (!addPosterModalActive) {
        setActive(true);
      } else {
        // shopify.modal.hide("upload-img");
        setActive(false);
      }
    }
  }, [addPosterModalActive]);

  const handleUploadPoster = (e) => {
    e.preventDefault();
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setIsUploading(true);
    submit(
      {
        name: selectedFile?.name,
        type: selectedFile?.type,
        size: selectedFile?.size,
        file,
      },
      { method: "POST" },
    );
  };

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

  const handleEnableAppEmbed = (app) => {
    const themeEditorUrl = `https://${loaderData?.shop}/admin/themes/${loaderData?.themeId}/editor?context=apps&activateAppId=${apiKey}/video_player_by_bplugins_script`;

    window.open(themeEditorUrl, "_blank");
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

  useEffect(() => {
    let playerInt = null;
    // Bounded poll. `playerRef` is only attached once a preview is rendered, so
    // on a normal page load this used to spin at 10Hz forever with nothing to
    // find. 50 tries = 5s, which is well past when the element can appear.
    let attempts = 0;
    const interval = setInterval(() => {
      const media = playerRef.current;
      if (media && !playerInt && typeof Plyr !== "undefined") {
        playerInt = new Plyr(media, { playsInline: true });
        setPlayer(playerInt);
        clearInterval(interval);
      } else if (++attempts > 50) {
        clearInterval(interval);
      }
    }, 100);
    return () => {
      clearInterval(interval);
      if (playerInt) {
        try {
          playerInt.destroy();
        } catch (e) {}
      }
    };
  }, [uploadedAndSelectedFile, playerRef]);

  useEffect(() => {
    if (!player || !poster) return;

    const posterEl = player.elements?.poster;
    if (posterEl) {
      posterEl.style.backgroundImage = `url(${poster})`;
      posterEl.style.backgroundSize = "cover";
      posterEl.style.display = "block";
      posterEl.style.opacity = 1;
    }
  }, [player, poster]);

  // The two player-type cards differ only in copy, icon and the Pro badge.
  const PLAYER_TYPES = [
    {
      value: "single",
      title: "Single Video Player",
      label: "Single video player — one video with full customization",
      description:
        "Create a player for a single video with full customization options including controls, styles, and overlays.",
      icon: (
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <polygon
            points="10,8.5 16,12 10,15.5"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      ),
    },
    {
      value: "multiple",
      title: "Multiple / Grid Video Player",
      label:
        "Multiple or grid video player — a grid or carousel of several videos",
      description:
        "Create a grid or carousel of multiple videos. Add items, reorder with drag-and-drop, and control layout per device.",
      pro: false,
      icon: (
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="2" y="3" width="8" height="7" rx="1" />
          <rect x="14" y="3" width="8" height="7" rx="1" />
          <rect x="2" y="14" width="8" height="7" rx="1" />
          <rect x="14" y="14" width="8" height="7" rx="1" />
        </svg>
      ),
    },
  ];

  return (
    <Page>
      <ui-title-bar title="My Videos">
        <CustomButton variant="primary" onClick={toggleModal}>
          Add New Player
        </CustomButton>
      </ui-title-bar>
      <ClientOnly
        fallback={
          <CustomBox className="vp-videos-loading">
            <Spinner
              accessibilityLabel="Loading your video players"
              size="large"
            />
          </CustomBox>
        }
      >
        {() => (
          <>
            <Box as="section" aria-label="Video players">
              <VideoList
                isLoading={isLoading}
                videos={loaderData?.videos}
                paginationInfo={loaderData?.paginationInfo}
                submit={submit}
                nav={nav}
                toggleModal={toggleModal}
              />
            </Box>
          </>
        )}
      </ClientOnly>
      {/* Create-New-Player dialog on App Bridge's <ui-modal> (the primitive
          SupportTicketModal and the Dashboard video modals already use), rather
          than Polaris React's Modal wrapped in a <Frame>. The <Frame> below is
          kept only because the two media-picker modals render {toastMarkup}
          inside it, and Polaris Toast needs a Frame ancestor. */}
      <Modal id="create-player-modal" variant="base">
        <TitleBar title="Create New Player">
          <CustomButton
            variant="primary"
            onClick={() => {
              if (isAtPlayerLimit) return;
              handleCreatePlayer();
            }}
            disabled={isAtPlayerLimit || loading ? true : undefined}
          >
            {loading ? "Creating…" : "Next"}
          </CustomButton>
          <CustomButton
            onClick={handleClose}
            disabled={loading ? true : undefined}
          >
            Cancel
          </CustomButton>
        </TitleBar>

        <Box padding="400">
          {isAtPlayerLimit ? (
            <BlockStack gap="400">
              <Banner
                tone="critical"
                title={`You've reached your plan limit of ${usage.max} players`}
              >
                <Text as="p">
                  Upgrade your plan to create more video players.
                </Text>
                <Box paddingBlockStart="400">
                  <s-button
                    variant="primary"
                    href="/app/pricing"
                    onClick={go("/app/pricing")}
                    loading={flag(isLoading)}
                  >
                    Upgrade
                  </s-button>
                </Box>
              </Banner>
            </BlockStack>
          ) : (
            <BlockStack gap="400">
              <Text as="p" fontWeight="bold">
                Choose the type of video player you want to create:
              </Text>

              {/* s-clickable, not <CustomBox onClick>: the original cards exposed no
                  role, were not focusable and could not be activated from the
                  keyboard, so the player type could not be chosen without a
                  mouse.

                  The two cards were near-identical blocks of markup; they are
                  one data-driven map now. Only the radio indicator and the
                  illustrations stay hand-rolled — Polaris has no icon for
                  either, and the radio is a CSS-only affordance. */}
              <BlockStack gap="300">
                {PLAYER_TYPES.map((type) => {
                  const selected = selectedPlayerType === type.value;
                  return (
                    <CustomBox
                      key={type.value}
                      role="button"
                      tabIndex={0}
                      aria-label={type.label}
                      aria-pressed={selected ? "true" : "false"}
                      onClick={() => setSelectedPlayerType(type.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedPlayerType(type.value);
                        }
                      }}
                      className={`pts-option${selected ? " selected" : ""}`}
                    >
                      <InlineStack gap="300" blockAlign="start" wrap={false}>
                        <CustomBox className="pts-radio">
                          <CustomBox className="pts-radio-dot" />
                        </CustomBox>
                        <CustomBox style={{ flexGrow: 1 }}>
                          <BlockStack gap="500">
                            <InlineStack gap="300" blockAlign="center">
                              <Text as="span" fontWeight="bold">
                                {type.title}
                              </Text>
                              {type.pro && !isPremium && (
                                <Badge tone="info">Pro</Badge>
                              )}
                            </InlineStack>
                            <Text as="p" tone="subdued">
                              {type.description}
                            </Text>
                          </BlockStack>
                        </CustomBox>
                        <CustomBox className="pts-option-icon">
                          {type.icon}
                        </CustomBox>
                      </InlineStack>
                    </CustomBox>
                  );
                })}
              </BlockStack>
            </BlockStack>
          )}
        </Box>
      </Modal>

      {/* This box and the <Frame> exist only so the two shared media-picker
          modals can render {toastMarkup} — Polaris Toast needs a Frame
          ancestor. Both go when those shared modals are migrated. */}
      <CustomBox className="vp-media-frame">
        <Frame>
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
            uploadProgress={uploadProgress}
            uploadedFile={uploadedFile}
            fileUpload={fileUpload}
            filteredFiles={videoFiles}
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
            toggleModal={toggleModal}
            loadNextPage={loadNextPage}
            loadPrevPage={loadPrevPage}
            pageInfo={videoPageInfo}
          />

          <ImgUploadModal
            loaderData={loaderData}
            inputValues={inputValues}
            setInputValues={setInputValues}
            isHiddenUploadOption={isHiddenUploadOption}
            setAddPosterModalActive={setAddPosterModalActive}
            options={options}
            handleSelectChange={handleSelectChange}
            isGridView={isGridView}
            previewImg={previewImg}
            handleScroll={handleScroll}
            handleDropZoneDrop={handleDropZoneDrop}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            uploadedFile={uploadedFile}
            fileUpload={imgUpload}
            filteredFiles={imageFiles}
            selectedImgs={selectedImgs}
            toggleImgSelection={toggleImgSelection}
            addPosterModalActive={addPosterModalActive}
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
            uploadImage={uploadImage}
            loadNextPage={loadNextPage}
            loadPrevPage={loadPrevPage}
            pageInfo={imagePageInfo}
          />
        </Frame>
      </CustomBox>
    </Page>
  );
}

/**
 * Keeps a failure on this page inside this page.
 *
 * app.jsx's boundary is Shopify's `boundary.error()`, which handles thrown
 * Responses and re-throws everything else — so before this existed, one bad
 * value in the list or a loader hiccup escaped to the root and replaced the
 * entire embedded app with Remix's default error page.
 *
 * Thrown Responses still go to Shopify's helper untouched: that is how the
 * 401/410 re-authorize handshake reaches App Bridge, and swallowing it here
 * would leave the app unable to recover an expired session.
 */
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return boundary.error(error);
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  return (
    <Page>
      <ui-title-bar title="My Videos" />
      <Box paddingBlockStart="400">
        <Banner
          tone="critical"
          title="This page could not be loaded"
          action={{
            content: "Reload",
            onAction: () => window.location.reload(),
          }}
        >
          <BlockStack gap="200">
            <Text as="p">
              Your video players are safe — only this screen failed to render.
              Send the message below to support if it keeps happening.
            </Text>
            <Text as="p" breakWord>
              <code>{message}</code>
            </Text>
          </BlockStack>
        </Banner>
      </Box>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
