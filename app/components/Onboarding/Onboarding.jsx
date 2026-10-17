import React, { useState, useEffect, useRef, useCallback } from "react";
import { flag, CustomSpan, CustomBox } from "../../utils/polarisWebComponents";
import { useFetcher, useSubmit, useActionData } from "@remix-run/react";
import {
  Box,
  Text,
  BlockStack,
  InlineStack,
  InlineGrid,
  Button,
  TextField,
  Divider,
  Scrollable,
  List,
  Link,
  Icon,
} from "@shopify/polaris";
import {
  UploadIcon,
  CheckIcon,
  ClipboardIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalIcon,
} from "@shopify/polaris-icons";
import { ToggleControl } from "../ToggleControl/ToggleControl";
import { useAppBridge } from "@shopify/app-bridge-react";
import FileUploadModal from "../Mediaaa";
import ImgUploadModal from "../MediaImg";
import ColorController from "../ColorController/ColorController";
import "./Onboarding.css";
import "../../styles/styles.css";
import "../../styles/MultipleVideoItems.css";
import TextInput from "../TextInput/TextInput";
import MultipleVideoItems from "../MultipleVideoItems/MultipleVideoItems";

const STORAGE_KEY = "vp_onboarding_done";

// The emoji stay as plain text nodes: they are decorative brand flavour, and
// s-icon only renders Polaris's own icon set.
const WELCOME_FEATURES = [
  { icon: "\u{1F3AC}", text: "YouTube, Vimeo & MP4 support" },
  { icon: "\u{1F3A8}", text: "Full visual customization" },
  { icon: "\u{1F4F1}", text: "Mobile-responsive layouts" },
];

export default function Onboarding({ loaderData, apiKey, onComplete }) {
  const shopify = useAppBridge();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState("next");
  const [animating, setAnimating] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  // Customization State
  const [playerType, setPlayerType] = useState("single");
  const [gridSettings, setGridSettings] = useState({
    viewMode: "grid",
    columns: { desktop: 3, tablet: 2, mobile: 1 },
    gap: 16,
    autoplay: false,
    autoplaySpeed: 3,
  });
  const [videoItems, setVideoItems] = useState([
    { video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", poster: "" },
  ]);

  // Single Player Global Settings
  const [singleTitle, setSingleTitle] = useState("My Single Player");
  const [multipleTitle, setMultipleTitle] = useState("My Video Gallery");
  const [singleUrl, setSingleUrl] = useState("");
  const [singlePoster, setSinglePoster] = useState("");
  const [globalStyles, setGlobalStyles] = useState({
    brandColor: "#00A550",
    borderRadius: "5px",
    width: "100%",
  });

  // Global Toggles
  const [repeat, setRepeat] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [mutedOptions, setMutedOptions] = useState(false);
  const [resetOnEnd, setResetOnEnd] = useState(false);
  const [hideControls, setHideControls] = useState(true);

  // Auto-enable muted when autoPlay is turned on (browsers require this)
  const isFirstLoad = useRef(true);
  useEffect(() => {
    if (!isFirstLoad.current) {
      if (autoPlay) {
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
  }, [autoPlay]);

  const fetcher = useFetcher();
  const submit = useSubmit();
  const actionData = useActionData();

  // MEDIA MODAL STATE
  const [videoFiles, setVideoFiles] = useState(loaderData?.videoFiles || []);
  const [imageFiles, setImageFiles] = useState(loaderData?.imageFiles || []);
  const [videoPageInfo, setVideoPageInfo] = useState(
    loaderData?.pageInfoVideo || {},
  );
  const [imagePageInfo, setImagePageInfo] = useState(
    loaderData?.pageInfoImage || {},
  );
  const [inputValues, setInputValues] = useState({});
  const [isHiddenUploadOption, setIsHiddenUploadOption] = useState(false);
  const [addUrlModalActive, setAddUrlModalActive] = useState(false);
  const [addPosterModalActive, setAddPosterModalActive] = useState(false);
  const options = [
    { label: "Grid View", value: "grid_view" },
    { label: "List View", value: "list_view" },
  ];
  const [isGridView, setIsGridView] = useState("grid_view");
  const [preview, setPreview] = useState(0);
  const [previewImg, setPreviewImg] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedAndSelectedFile, setUploadedAndSelectedFile] = useState(null);
  const [uploadedAndSelectedImg, setUploadedAndSelectedImg] = useState(null);
  const [file, setFile] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedImgs, setSelectedImgs] = useState([]);
  const [newUrl, setNewUrl] = useState("");
  const [toastContent, setToastContent] = useState({
    content: "",
    error: false,
  });
  const [toastActive, setToastActive] = useState(false);
  const [copiedField, setCopiedField] = useState(null);

  const handleCopyWithAnimation = (text, field) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    shopify.toast.show("Copied to clipboard!");
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Track which field is currently being edited so we can apply the selected file URL
  const [activeItemIndex, setActiveItemIndex] = useState(null);
  const [uploadingTarget, setUploadingTarget] = useState(null);

  const handleSetActiveItemIndex = (index) => {
    setActiveItemIndex(index);
    if (index !== null) setUploadingTarget(null);
  };

  useEffect(() => {
    // If the store already has one or more players AND we haven't started onboarding, skip it entirely.
    // We check step === 0 so we don't accidentally dismiss mid-way through if we submit a new player.
    if ((loaderData?.videos?.length || 0) > 0 && step === 0) {
      setDismissed(true);
      return;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const savedStep = Number(saved);
      if (saved === "5") {
        setDismissed(true);
      } else {
        setDismissed(false);
        if (savedStep > 0 && savedStep < 5) {
          setStep(savedStep);
        }
        const savedType = localStorage.getItem("vp_onboarding_playerType");
        if (savedType === "single" || savedType === "multiple") {
          setPlayerType(savedType);
        }
      }
    } catch (e) {
      setDismissed(false);
    }
  }, [loaderData?.videos?.length, step]);

  useEffect(() => {
    if (fetcher.data && fetcher.data.id && step === 2) {
      setAnimating(true);
      setDirection("next");
      setTimeout(() => {
        setStep(3);
        setDirection("enter");
        setAnimating(false);
      }, 300);
    }
  }, [fetcher.data, step]);

  // MEDIA MODAL FUNCTIONS
  const handleSelectChange = () => {};
  const handleScroll = (e) => {
    const scrollTop = e.target.scrollTop;
    setIsHiddenUploadOption(scrollTop >= 50);
  };
  const handleDropZoneDrop = useCallback(
    (_dropFiles, acceptedFiles, _rejectedFiles) => {
      setFile(acceptedFiles[0]);
      setIsUploading(true);
      submit(
        {
          name: acceptedFiles[0]?.name,
          type: acceptedFiles[0]?.type,
          size: acceptedFiles[0]?.size,
          file: acceptedFiles[0],
        },
        { method: "POST", action: "/app/videos" },
      );
    },
    [submit],
  );

  const toggleFileSelection = useCallback((file) => setSelectedFiles(file), []);
  const toggleImgSelection = useCallback((img) => setSelectedImgs(img), []);

  const confirmNewURL = useCallback(() => {
    if (newUrl) {
      submit(
        { contentType: "EXTERNAL_VIDEO", originalSource: newUrl },
        { method: "PUT", action: "/app/videos" },
      );
      setToastContent({ content: "Add New URL successfully", error: false });
      setToastActive(true);
      setAddUrlModalActive(false);
    }
  }, [newUrl, submit]);

  const toggleModal = () => {};
  const loadNextPage = () => {};
  const loadPrevPage = () => {};

  // APPLY SELECTED URL TO TARGET FIELD
  useEffect(() => {
    if (
      uploadedAndSelectedFile &&
      (uploadingTarget || activeItemIndex !== null)
    ) {
      const file = Array.isArray(uploadedAndSelectedFile)
        ? uploadedAndSelectedFile[0]
        : uploadedAndSelectedFile;
      const selectedUrl =
        (file?.mediaContentType === "VIDEO" || file?.__typename === "Video"
          ? file?.sources?.find((a) => a.format?.toLowerCase() === "mp4")
              ?.url || file?.sources?.[0]?.url
          : file?.url) ||
        file?.embedUrl ||
        file?.originalSource?.url ||
        file?.originUrl;

      if (selectedUrl) {
        if (activeItemIndex !== null) {
          const newItems = [...videoItems];
          newItems[activeItemIndex].video = selectedUrl;
          setVideoItems(newItems);
          setActiveItemIndex(null);
        } else if (uploadingTarget?.field === "singleUrl") {
          setSingleUrl(selectedUrl);
        } else if (
          (uploadingTarget?.field === "video" ||
            uploadingTarget?.field === "multiple-video") &&
          uploadingTarget?.index !== null
        ) {
          const newItems = [...videoItems];
          newItems[uploadingTarget.index].video = selectedUrl;
          setVideoItems(newItems);
        }
      }
    }
  }, [uploadedAndSelectedFile]);

  useEffect(() => {
    if (
      uploadedAndSelectedImg &&
      (uploadingTarget || activeItemIndex !== null)
    ) {
      const file = Array.isArray(uploadedAndSelectedImg)
        ? uploadedAndSelectedImg[0]
        : uploadedAndSelectedImg;
      const selectedImgUrl =
        file?.preview?.image?.url || file?.preview?.image?.src || file?.url;
      if (selectedImgUrl) {
        if (activeItemIndex !== null) {
          const newItems = [...videoItems];
          newItems[activeItemIndex].poster = selectedImgUrl;
          setVideoItems(newItems);
          setActiveItemIndex(null);
        } else if (uploadingTarget?.field === "singlePoster") {
          setSinglePoster(selectedImgUrl);
        } else if (
          (uploadingTarget?.field === "poster" ||
            uploadingTarget?.field === "multiple-poster") &&
          uploadingTarget?.index !== null
        ) {
          const newItems = [...videoItems];
          newItems[uploadingTarget.index].poster = selectedImgUrl;
          setVideoItems(newItems);
        }
      }
    }
  }, [uploadedAndSelectedImg]);

  const openUploadModal = (field, index = null, type = "video") => {
    setUploadingTarget({ field, index });
    setUploadedAndSelectedFile(null);
    setUploadedAndSelectedImg(null);
    setActiveItemIndex(null);
    if (type === "video") {
      if (shopify) shopify.modal.show("upload-video");
    } else {
      if (shopify) shopify.modal.show("upload-img");
    }
  };

  const goTo = (nextIdx, dir = "next") => {
    if (animating) return;
    setAnimating(true);
    setDirection(dir);
    setTimeout(() => {
      setStep(nextIdx);
      setDirection("enter");
      setAnimating(false);
    }, 300);
  };

  const next = () => {
    if (step === 2) {
      createPlayer();
    } else if (step === 3) {
      finish();
    } else {
      goTo(step + 1, "next");
      localStorage.setItem(STORAGE_KEY, step + 1);
    }
  };

  const back = () => {
    localStorage.setItem(STORAGE_KEY, step - 1);
    goTo(step - 1, "prev");
  };

  const finish = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "5");
    } catch (e) {}
    if (onComplete) onComplete();
  };

  const skip = () => finish();

  const createPlayer = () => {
    const submitData = {
      id: "052020",
      title:
        playerType === "single"
          ? singleTitle || "My Single Player"
          : multipleTitle || "My Video Gallery",
      url: playerType === "single" ? singleUrl : "",
      videoType:
        playerType === "single"
          ? singleUrl.includes("youtu")
            ? "youtube"
            : singleUrl.includes("vimeo")
              ? "vimeo"
              : "html5"
          : "html5",
      poster: playerType === "single" ? singlePoster : "",
      playerType: playerType,
      styles: JSON.stringify(globalStyles),
      repeat: repeat.toString(),
      autoPlay: autoPlay.toString(),
      resetOnEnd: resetOnEnd.toString(),
      options: JSON.stringify({
        muted: mutedOptions,
        autoHideControls: hideControls,
      }),
      preventRedirect: "true",
    };

    if (playerType === "multiple") {
      submitData.items = JSON.stringify(videoItems);
      submitData.gridSettings = JSON.stringify(gridSettings);
    }
    fetcher.submit(submitData, { method: "POST", action: "/app/videos" });
  };

  if (dismissed) return null;

  const renderStepContent = () => {
    if (step === 0) {
      return (
        <>
          <CustomBox className="ob-card-emoji">👋</CustomBox>
          <Text as="h2" variant="headingLg" fontWeight="bold">Welcome to Video Player</Text>
          <Text as="p" tone="subdued">by bPlugins</Text>
          <CustomBox className="ob-card-desc">
            <Text as="p">
              Beautiful, customizable video players for your Shopify store. Let's
              set everything up in just a few quick steps.
            </Text>
          </CustomBox>
          <BlockStack
            gap="200"
            inlineAlign="center"
          >
            <CustomBox className="ob-features" style={{ width: '100%', maxWidth: '340px' }}>
              <BlockStack gap="200">
                {WELCOME_FEATURES.map(({ icon, text }) => (
                  <Box
                    key={text}
                    background="bg-surface-secondary"
                    borderRadius="200"
                    paddingBlock="200"
                    paddingInline="100"
                  >
                    <CustomBox className="ob-feature">
                      <InlineStack gap="300" blockAlign="center" wrap={false}>
                        <CustomBox className="ob-feature-icon">{icon}</CustomBox>
                        <Text as="span">{text}</Text>
                      </InlineStack>
                    </CustomBox>
                  </Box>
                ))}
              </BlockStack>
            </CustomBox>
          </BlockStack>
        </>
      );
    } else if (step === 1) {
      return (
        <>
          <Text as="h2" variant="headingLg" fontWeight="bold">Player Type Selection</Text>
          <CustomBox className="ob-card-desc" style={{ marginTop: 'var(--p-space-200)', marginBottom: 'var(--p-space-400)' }}>
            <Text as="p" tone="subdued">
              Choose a layout that fits your needs. You can always create more
              players later.
            </Text>
          </CustomBox>
          
          <InlineGrid
            columns={{ xs: 1, md: 2 }}
            gap="400"
          >
            <CustomBox
              role="button"
              tabIndex={0}
              aria-label="Single video — one focused player with full controls"
              aria-pressed={playerType === "single" ? "true" : "false"}
              onClick={() => {
                setPlayerType("single");
                localStorage.setItem("vp_onboarding_playerType", "single");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setPlayerType("single");
                  localStorage.setItem("vp_onboarding_playerType", "single");
                }
              }}
              className="vp-unstyled-button"
            >
              <CustomBox
                className={`ob-option-card ${playerType === "single" ? "active-type" : ""}`}
              >
                <BlockStack
                  gap="300"
                  inlineAlign="center"
                >
                  <CustomBox className="ob-option-icon">▶️</CustomBox>
                  <Text as="span" fontWeight="bold">Single Video</Text>
                  <Text tone="subdued" as="span">
                    One focused player with full controls
                  </Text>
                </BlockStack>
              </CustomBox>
            </CustomBox>
            <CustomBox
              role="button"
              tabIndex={0}
              aria-label="Multiple videos — grid, carousel, or slider layout"
              aria-pressed={playerType === "multiple" ? "true" : "false"}
              onClick={() => {
                setPlayerType("multiple");
                localStorage.setItem("vp_onboarding_playerType", "multiple");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setPlayerType("multiple");
                  localStorage.setItem("vp_onboarding_playerType", "multiple");
                }
              }}
              className="vp-unstyled-button"
            >
              <CustomBox
                className={`ob-option-card ${playerType === "multiple" ? "active-type" : ""}`}
              >
                <BlockStack
                  gap="300"
                  inlineAlign="center"
                >
                  <CustomBox className="ob-option-icon">🎞️</CustomBox>
                  <Text as="span" fontWeight="bold">Multiple Videos</Text>
                  <Text tone="subdued" as="span">
                    Grid, carousel, or slider layout
                  </Text>
                </BlockStack>
              </CustomBox>
            </CustomBox>
          </InlineGrid>
        </>
      );
    } else if (step === 2) {
      return (
        <CustomBox className="ob-step2">
          <CustomBox className="ob-card-title ob-center">
            <Text as="h2" variant="headingLg" fontWeight="bold">
              Configure Your{" "}
              {playerType === "single" ? "Single Video" : "Multiple Video"} Player
            </Text>
          </CustomBox>
          <CustomBox className="ob-card-desc ob-center ob-step2-desc">
            <Text as="p" tone="subdued">
              {playerType === "single"
                ? "Adjust your global player settings below."
                : "Configure your grid and video items."}
            </Text>
          </CustomBox>

          <Box
            padding="400"
            background="bg-surface-secondary"
            borderRadius="200"
            borderWidth="025"
            borderColor="border"
          >
            <Scrollable style={{ maxHeight: "400px" }} focusable>
              {playerType === "single" ? (
                <CustomBox className="ob-global-settings">
                  <Box paddingBlockEnd="400">
                    <Text as="h3" variant="headingMd" fontWeight="bold">Global Settings</Text>
                  </Box>
                  <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                    <BlockStack gap="400">
                      <TextField
                        type="text"
                        label="Title"
                        value={singleTitle}
                        onChange={setSingleTitle}
                        autoComplete="off"
                      />
                      <TextField
                        label="Add Video"
                        value={singleUrl}
                        onChange={setSingleUrl}
                        placeholder="https://www.youtube.com/watch?v=..."
                        autoComplete="off"
                        connectedRight={
                          <Button
                            icon={UploadIcon}
                            variant="tertiary"
                            accessibilityLabel="Choose a video from your Shopify files"
                            onClick={() =>
                              openUploadModal("singleUrl", null, "video")
                            }
                          />
                        }
                      />
                      <TextField
                        label="Poster URL (Optional image cover)"
                        value={singlePoster}
                        onChange={setSinglePoster}
                        placeholder="https://example.com/poster.jpg"
                        autoComplete="off"
                        connectedRight={
                          <Button
                            icon={UploadIcon}
                            variant="tertiary"
                            accessibilityLabel="Choose a poster image from your Shopify files"
                            onClick={() =>
                              openUploadModal("singlePoster", null, "image")
                            }
                          />
                        }
                      />
                    </BlockStack>
                    
                    <BlockStack gap="300">
                      <ColorController
                        label="Select Brand Color"
                        value={globalStyles.brandColor}
                        onChange={(color) =>
                          setGlobalStyles({
                            ...globalStyles,
                            brandColor: color,
                          })
                        }
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
                        details="Autoplay might require muting based on the browser."
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
                    </BlockStack>
                  </InlineGrid>
                </CustomBox>
              ) : (
                <CustomBox className="ob-multiple-settings">
                  <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                    <BlockStack gap="400">
                      <Text as="h3" variant="headingMd" fontWeight="bold">Video Items</Text>
                      <CustomBox className="ob-fill">
                        <MultipleVideoItems
                          items={videoItems}
                          setItems={setVideoItems}
                          shopify={shopify}
                          activeItemIndex={activeItemIndex}
                          setActiveItemIndex={handleSetActiveItemIndex}
                          setUploadedAndSelectedFile={
                            setUploadedAndSelectedFile
                          }
                          setUploadedAndSelectedImg={setUploadedAndSelectedImg}
                        />
                      </CustomBox>
                    </BlockStack>

                    <BlockStack gap="300">
                      <TextField
                        type="text"
                        label="Gallery Title"
                        value={multipleTitle}
                        onChange={setMultipleTitle}
                        autoComplete="off"
                      />

                      <Divider />

                      <Text as="h3" variant="headingMd" fontWeight="bold">Global Settings</Text>
                      <ColorController
                        label="Select Brand Color"
                        value={globalStyles.brandColor}
                        onChange={(color) =>
                          setGlobalStyles({
                            ...globalStyles,
                            brandColor: color,
                          })
                        }
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
                        details="If enabled, auto play only the first video. Autoplay might require muting based on the browser."
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
                    </BlockStack>
                  </InlineGrid>
                </CustomBox>
              )}
            </Scrollable>
          </Box>
        </CustomBox>
      );
    } else if (step === 3) {
      const embedCode = `<s-box class="video-plyr-by-bplugins" data-id="${fetcher.data?.id}"></s-box>`;
      const themeEditorUrl =
        apiKey && loaderData?.shop && loaderData?.themeId
          ? `https://${loaderData.shop}/admin/themes/${loaderData.themeId}/editor?context=apps&activateAppId=${apiKey}/video_player_by_bplugins_script`
          : null;
      return (
        <>
          <Text as="h2" variant="headingLg" fontWeight="bold">You're All Set!</Text>
          <CustomBox className="ob-card-desc" style={{ marginTop: 'var(--p-space-200)', marginBottom: 'var(--p-space-400)' }}>
            <Text as="p" tone="subdued">
              Your video player has been created. Follow these 2 simple steps to
              display it on your store.
            </Text>
          </CustomBox>

          <CustomBox className="ob-final-steps">
            <List type="number">
              <List.Item>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd" fontWeight="bold">Enable App Embed</Text>
                  <Text as="p">
                    First, enable our core script in your Shopify Theme.
                    Clicking the button below will open your Theme Editor and
                    automatically activate it.{" "}
                    <Text as="span" fontWeight="bold">
                      Don't forget to click Save in the top right corner!
                    </Text>
                  </Text>
                  {themeEditorUrl && (
                    <InlineStack>
                      <Button
                        variant="primary"
                        icon={ExternalIcon}
                        url={themeEditorUrl}
                        target="_blank"
                      >
                        Enable App Embed
                      </Button>
                    </InlineStack>
                  )}
                </BlockStack>
              </List.Item>

              <List.Item>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd" fontWeight="bold">Display the Video</Text>
                  <Text as="p">
                    Now you can add the video player anywhere on your store
                    using <Text as="span" fontWeight="bold">Theme Blocks</Text> or the{" "}
                    <Text as="span" fontWeight="bold">HTML Embed Code</Text>.
                  </Text>

                  <Box
                    padding="300"
                    borderRadius="200"
                    background="bg-surface-secondary"
                  >
                    <BlockStack gap="300">
                      <Text as="span" fontWeight="bold">
                        Option A: Theme App Block (Recommended)
                      </Text>
                      <Text as="p" tone="subdued">
                        In your Theme Editor, click "Add section" or
                        "Add block" and search for "Video
                        Embed: Single Video". Then paste the Player ID
                        below.
                      </Text>
                      <CustomBox className="ob-copy-row">
                        <code className="ob-code">
                          <CustomSpan className="ob-code-label">Player ID: </CustomSpan>
                          {fetcher.data?.id || "—"}
                        </code>
                        <Button
                          icon={
                            copiedField === "playerId" ? CheckIcon : ClipboardIcon
                          }
                          onClick={() =>
                            handleCopyWithAnimation(
                              fetcher.data?.id || "",
                              "playerId",
                            )
                          }
                        >
                          {copiedField === "playerId" ? "Copied!" : "Copy ID"}
                        </Button>
                      </CustomBox>
                    </BlockStack>
                  </Box>

                  <Box
                    padding="300"
                    borderRadius="200"
                    background="bg-surface-secondary"
                  >
                    <BlockStack gap="300">
                      <Text as="span" fontWeight="bold">Option B: HTML Embed Code</Text>
                      <Text as="p" tone="subdued">
                        Paste this code inside any custom HTML block, page, or
                        product description.
                      </Text>
                      <CustomBox className="ob-copy-row">
                        <code className="ob-code ob-code--nowrap">
                          {embedCode}
                        </code>
                        <Button
                          icon={
                            copiedField === "embedCode" ? CheckIcon : ClipboardIcon
                          }
                          onClick={() =>
                            handleCopyWithAnimation(embedCode, "embedCode")
                          }
                        >
                          {copiedField === "embedCode"
                            ? "Copied!"
                            : "Copy Code"}
                        </Button>
                      </CustomBox>
                    </BlockStack>
                  </Box>
                </BlockStack>
              </List.Item>
            </List>
          </CustomBox>
        </>
      );
    }
  };

  const isSubmitting =
    fetcher.state === "submitting" || fetcher.state === "loading";

  return (
    <CustomBox className="ob-fullscreen">
      <CustomBox className="ob-bg-blob ob-bg-blob--1" />
      <CustomBox className="ob-bg-blob ob-bg-blob--2" />

      <CustomBox
        className="ob-container"
        style={{ width: "100%", maxWidth: "950px", display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--p-space-800)' }}
      >
        <CustomBox className="ob-stepper">
          {[0, 1, 2, 3].map((i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <CustomBox
                  className={`ob-stepper-line${i <= step ? " ob-stepper-line--done" : ""}`}
                />
              )}
              <CustomBox
                className={`ob-stepper-dot${i < step ? " ob-stepper-dot--done" : ""}${i === step ? " ob-stepper-dot--active" : ""}`}
              >
                {i < step ? (
                  <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
                    <path
                      d="M5 10.5l3 3 7-7"
                      stroke="#fff"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <Text as="span">{i + 1}</Text>
                )}
              </CustomBox>
            </React.Fragment>
          ))}
        </CustomBox>

        <CustomBox
          className={`ob-card${animating ? ` ob-card--exit-${direction}` : ""}`}
          key={step}
        >
          {renderStepContent()}
        </CustomBox>

        <CustomBox
          className="ob-footer"
          style={{ width: "100%", display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--p-space-200)' }}
        >
          <CustomBox className="ob-footer-left">
            {step > 0 && step < 3 && (
              <Button
                variant="tertiary"
                icon={ArrowLeftIcon}
                onClick={back}
                disabled={flag(isSubmitting)}
              >
                Back
              </Button>
            )}
          </CustomBox>

          {step < 3 && (
            <Button
              variant="tertiary"
              onClick={skip}
              disabled={flag(isSubmitting)}
            >
              Skip setup
            </Button>
          )}

          <Button
            variant="primary"
            icon={step < 3 ? ArrowRightIcon : undefined}
            onClick={next}
            loading={flag(isSubmitting)}
            disabled={flag(isSubmitting)}
          >
            {step === 0
              ? "Let's Get Started"
              : step === 1
                ? "Next Step"
                : step === 2
                  ? "Make a Player"
                  : "Done"}
          </Button>
        </CustomBox>
      </CustomBox>

      {/* RENDER THE DEFAULT UPLOAD MODALS */}
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
        uploadedFile={null}
        fileUpload={file}
        filteredFiles={videoFiles}
        selectedFiles={selectedFiles}
        toggleFileSelection={toggleFileSelection}
        addUrlModalActive={addUrlModalActive}
        confirmNewURL={confirmNewURL}
        newUrl={newUrl}
        setNewUrl={setNewUrl}
        toastMarkup={null}
        isLoading={false}
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
        uploadedAndSelectedImg={uploadedAndSelectedImg}
        setUploadedAndSelectedImg={setUploadedAndSelectedImg}
        fileUpload={file}
        filteredFiles={imageFiles}
        selectedImgs={selectedImgs}
        toggleImgSelection={toggleImgSelection}
        addPosterModalActive={addPosterModalActive}
        confirmNewPoster={confirmNewURL}
        newPoster={newUrl}
        setNewPoster={setNewUrl}
        toastMarkup={null}
        isLoading={false}
        setPreviewImg={setPreviewImg}
        actionData={actionData}
        imageFiles={imageFiles}
        toggleModal={toggleModal}
        loadNextPage={loadNextPage}
        loadPrevPage={loadPrevPage}
        pageInfo={imagePageInfo}
      />
    </CustomBox>
  );
}
