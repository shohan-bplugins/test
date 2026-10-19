import React, { useState, useEffect, useRef, useCallback } from "react";
import { useFetcher } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import AudioUploadModal from "../AudioUploadModal/AudioUploadModal";
import ImageUploadModal from "../ImageUploadModal/ImageUploadModal";
import PlayerTypePicker, {
  playerTypeLabel,
} from "../PlayerTypePicker/PlayerTypePicker";
import MediaUrlField from "../MediaUrlField/MediaUrlField";
import { WebTextField } from "../PolarisWeb/fields";
import "./Onboarding.css";
import { showModal } from "../../utils/modal";

export default function Onboarding({ loaderData, apiKey, onComplete }) {
  const shopify = useAppBridge();
  const user = loaderData?.user || {};
  const [step, setStep] = useState(user?.onboardingStep || 0);
  const [direction, setDirection] = useState("next");
  const [animating, setAnimating] = useState(false);
  const [dismissed, setDismissed] = useState(user?.onboardingDone || false);

  const [playerType, setPlayerType] = useState("single-audio");

  // Step 2 — shared config
  const [audioTitle, setAudioTitle] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  // Playlist tracks
  const [tracks, setTracks] = useState([{ title: "", url: "" }]);
  const [copiedField, setCopiedField] = useState(null);
  // Image URL (for sticky-player thumbnail)
  const [imageUrl, setImageUrl] = useState("");

  // Audio upload modal state
  const activeAudioOnChange = useRef(null);
  const [audioSelectedFile, setAudioSelectedFile] = useState(null);
  const [uploadAndSelectedFile, setUploadAndSelectedFile] = useState(null);

  // Image upload modal state
  const activeImageOnChange = useRef(null);
  const [imageSelectedFile, setImageSelectedFile] = useState(null);
  const [uploadAndSelectedImage, setUploadAndSelectedImage] = useState(null);

  const handleOpenAudioModal = useCallback(
    (onChangeFn) => {
      activeAudioOnChange.current = onChangeFn;
      setAudioSelectedFile(null);
      showModal("upload-audio");
    },
    [shopify],
  );

  const handleOpenImageModal = useCallback(
    (onChangeFn) => {
      activeImageOnChange.current = onChangeFn;
      setImageSelectedFile(null);
      showModal("upload-image");
    },
    [shopify],
  );

  useEffect(() => {
    if (uploadAndSelectedFile?.node?.url) {
      if (activeAudioOnChange.current) {
        activeAudioOnChange.current(uploadAndSelectedFile.node.url);
        activeAudioOnChange.current = null;
      }
      setUploadAndSelectedFile(null);
    }
  }, [uploadAndSelectedFile]);

  useEffect(() => {
    const imgUrl =
      uploadAndSelectedImage?.node?.url ||
      uploadAndSelectedImage?.node?.preview?.image?.url ||
      uploadAndSelectedImage?.node?.preview?.image?.src;
    if (imgUrl) {
      if (activeImageOnChange.current) {
        activeImageOnChange.current(imgUrl);
        activeImageOnChange.current = null;
      }
      setUploadAndSelectedImage(null);
    }
  }, [uploadAndSelectedImage]);

  const fetcher = useFetcher();
  const onboardingFetcher = useFetcher();

  const handleCopyWithAnimation = (text, field) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    shopify.toast.show("Copied to clipboard!");
    setTimeout(() => setCopiedField(null), 2000);
  };

  const saveOnboarding = (updates) => {
    const formData = new FormData();
    formData.append("intent", "updateOnboarding");
    if (updates.onboardingStep !== undefined)
      formData.append("onboardingStep", updates.onboardingStep);
    if (updates.onboardingDone !== undefined)
      formData.append("onboardingDone", updates.onboardingDone);
    if (updates.onboardingPlayerType !== undefined)
      formData.append("onboardingPlayerType", updates.onboardingPlayerType);
    onboardingFetcher.submit(formData, { method: "POST" });
  };

  // Creating the player failed: say so (the step stays put).
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.result === "pleaseTryAgain") {
      shopify.toast.show(
        "Couldn't create the player. Please try again, or contact support.",
        { isError: true },
      );
    }
  }, [fetcher.state, fetcher.data]);

  // Auto advance to step 3 when player is created successfully
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
      // Step 2 → create player
      createPlayer();
    } else {
      goTo(step + 1, "next");
      saveOnboarding({ onboardingStep: step + 1 });
    }
  };

  const back = () => {
    goTo(step - 1, "prev");
    saveOnboarding({ onboardingStep: step - 1 });
  };

  const finish = () => {
    setDismissed(true);
    saveOnboarding({ onboardingStep: 5, onboardingDone: true });
    if (onComplete) onComplete();
  };

  const skip = () => finish();

  const createPlayer = () => {
    const formData = new FormData();
    formData.append("data", playerType);
    formData.append("preventRedirect", "true");
    formData.append("ob_title", audioTitle);
    formData.append("ob_url", audioUrl);
    if (playerType === "playlist-audio") {
      formData.append("ob_tracks", JSON.stringify(tracks));
    }
    if (playerType === "sticky-player" && imageUrl) {
      formData.append("ob_imageUrl", imageUrl);
    }
    fetcher.submit(formData, { method: "POST", action: "/app?index" });
  };

  if (dismissed) return null;
  const embedCode = `<div class="html5-audio-plyr" data-id="${fetcher.data?.id || ""}"></div>`;
  const isCreating = fetcher.state !== "idle";

  const copyButton = (text, field, label) => (
    <s-button
      icon={copiedField === field ? "check" : "clipboard"}
      disabled={!fetcher.data?.id || undefined}
      onClick={() => handleCopyWithAnimation(text, field)}
    >
      {copiedField === field ? "Copied!" : label}
    </s-button>
  );

  // ── Step content ──────────────────────────────────────────────
  const renderStepContent = () => {
    // STEP 0 — Welcome
    if (step === 0) {
      return (
        <s-stack gap="base" alignItems="center">
          <div className="ob-card-emoji">👋</div>
          <s-stack gap="small-300" alignItems="center">
            <s-heading>Welcome to Audio Player</s-heading>
            <s-text color="subdued">by bPlugins</s-text>
          </s-stack>
          <s-paragraph>
            Beautiful, customizable audio players for your Shopify store.
            Let&apos;s set everything up in just a few quick steps.
          </s-paragraph>
          <s-stack gap="small">
            {[
              { icon: "sound", text: "MP3, WAV & audio support" },
              { icon: "paint-brush-flat", text: "Full visual customization" },
              { icon: "mobile", text: "Mobile-responsive layouts" },
            ].map((f) => (
              <s-stack
                key={f.text}
                direction="inline"
                gap="small-200"
                alignItems="center"
              >
                <s-icon type={f.icon} tone="success"></s-icon>
                <s-text>{f.text}</s-text>
              </s-stack>
            ))}
          </s-stack>
        </s-stack>
      );
    }

    // STEP 1 — Select Player Type
    if (step === 1) {
      return (
        <s-stack gap="base">
          <s-stack gap="small-300">
            <s-heading>Select player type</s-heading>
            <s-paragraph color="subdued">
              Choose an audio layout that fits your needs. You can always create
              more players later.
            </s-paragraph>
          </s-stack>
          <PlayerTypePicker
            value={playerType}
            onChange={(value) => {
              setPlayerType(value);
              saveOnboarding({ onboardingPlayerType: value });
            }}
          />
        </s-stack>
      );
    }

    // STEP 2 — Player-type-specific config
    if (step === 2) {
      const addTrack = () => setTracks((t) => [...t, { title: "", url: "" }]);
      const removeTrack = (i) =>
        setTracks((t) => t.filter((_, idx) => idx !== i));
      const updateTrack = (i, field, val) =>
        setTracks((t) =>
          t.map((tr, idx) => (idx === i ? { ...tr, [field]: val } : tr)),
        );

      const titleField = (label, placeholder) => (
        <WebTextField
          label={label}
          placeholder={placeholder}
          value={audioTitle}
          disabled={isCreating || undefined}
          autocomplete="off"
          onChange={setAudioTitle}
        />
      );
      const audioField = (
        <MediaUrlField
          label="Audio file"
          value={audioUrl}
          placeholder="https://example.com/audio.mp3"
          onChange={setAudioUrl}
          onUploadClick={() => handleOpenAudioModal(setAudioUrl)}
        />
      );

      const configs = {
        "single-audio": (
          <>
            {titleField("Player title", "e.g. My Favourite Track")}
            {audioField}
          </>
        ),
        "playlist-audio": (
          <>
            {titleField("Playlist title", "e.g. My Playlist")}
            {tracks.map((tr, i) => (
              <s-box
                key={i}
                padding="small"
                border="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack gap="small">
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-badge tone="info">Track {i + 1}</s-badge>
                    {tracks.length > 1 ? (
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        icon="x"
                        accessibilityLabel={`Remove track ${i + 1}`}
                        disabled={isCreating || undefined}
                        onClick={() => removeTrack(i)}
                      ></s-button>
                    ) : null}
                  </s-stack>
                  <WebTextField
                    label={`Track ${i + 1} title`}
                    labelAccessibilityVisibility="exclusive"
                    placeholder={`Track ${i + 1} title`}
                    value={tr.title}
                    disabled={isCreating || undefined}
                    autocomplete="off"
                    onChange={(v) => updateTrack(i, "title", v)}
                  />
                  <MediaUrlField
                    label={`Track ${i + 1} audio`}
                    value={tr.url}
                    placeholder="https://example.com/audio.mp3"
                    onChange={(v) => updateTrack(i, "url", v)}
                    onUploadClick={() =>
                      handleOpenAudioModal((v) => updateTrack(i, "url", v))
                    }
                  />
                </s-stack>
              </s-box>
            ))}
            <s-stack direction="inline">
              <s-button
                icon="plus"
                disabled={isCreating || tracks.length >= 10 || undefined}
                onClick={addTrack}
              >
                Add track
              </s-button>
            </s-stack>
          </>
        ),
        "sticky-player": (
          <>
            {titleField("Player title", "e.g. Now Playing")}
            {audioField}
            <MediaUrlField
              label="Player image"
              value={imageUrl}
              placeholder="https://example.com/image.jpg"
              onChange={setImageUrl}
              onUploadClick={() => handleOpenImageModal(setImageUrl)}
            />
          </>
        ),
        "sticky-single-button": (
          <>
            {titleField("Player title", "e.g. Background Music")}
            {audioField}
          </>
        ),
      };

      return (
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-heading>Configure your player</s-heading>
            <s-badge tone="info">{playerTypeLabel(playerType)}</s-badge>
          </s-stack>
          <s-paragraph color="subdued">
            Set up the basics — you can fine-tune every detail later in the
            editor.
          </s-paragraph>
          {configs[playerType] || configs["single-audio"]}
        </s-stack>
      );
    }

    // STEP 3 — Display on Store
    if (step === 3) {
      return (
        <s-stack gap="base">
          <s-stack gap="small-300">
            <s-heading>You&apos;re all set! 🎉</s-heading>
            <s-paragraph color="subdued">
              Your audio player has been created. Follow these 2 simple steps to
              display it on your store.
            </s-paragraph>
          </s-stack>

          <s-section>
            <s-stack gap="small">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-badge tone="info">1</s-badge>
                <s-heading>Enable App Embed</s-heading>
              </s-stack>
              <s-paragraph>
                First, enable our core script in your Shopify theme. The button
                below opens your Theme Editor and activates it.{" "}
                <s-text type="strong">
                  Don&apos;t forget to click Save in the top right corner!
                </s-text>
              </s-paragraph>
              {apiKey && loaderData?.shop && loaderData?.themeId ? (
                <s-stack direction="inline">
                  <s-button
                    variant="primary"
                    icon="external"
                    onClick={() =>
                      window.open(
                        `https://${loaderData.shop}/admin/themes/${loaderData.themeId}/editor?context=apps&activateAppId=${apiKey}/audio_player_by_bplugins_script`,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    Enable App Embed
                  </s-button>
                </s-stack>
              ) : null}
            </s-stack>
          </s-section>

          <s-section>
            <s-stack gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-badge tone="info">2</s-badge>
                <s-heading>Display the audio player</s-heading>
              </s-stack>
              <s-paragraph>
                Add the audio player anywhere on your store using a{" "}
                <s-text type="strong">Theme Block</s-text> or the{" "}
                <s-text type="strong">HTML embed code</s-text>.
              </s-paragraph>

              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-text type="strong">Option A — Theme App Block</s-text>
                  <s-badge tone="success">Recommended</s-badge>
                </s-stack>
                <s-text color="subdued">
                  In the Theme Editor, add the Audio Player block and paste this
                  Player ID into its settings, then click Save.
                </s-text>
                <s-grid
                  gridTemplateColumns="minmax(0, 1fr) auto"
                  gap="small"
                  alignItems="center"
                >
                  <s-text>
                    Player ID:{" "}
                    <s-text type="strong">{fetcher.data?.id || "—"}</s-text>
                  </s-text>
                  {copyButton(fetcher.data?.id || "", "playerId", "Copy ID")}
                </s-grid>
              </s-stack>

              <s-divider></s-divider>

              <s-stack gap="small-200">
                <s-text type="strong">Option B — HTML embed code</s-text>
                <s-text color="subdued">
                  Paste this code inside any custom HTML block, page, or product
                  description.
                </s-text>
                <s-grid
                  gridTemplateColumns="minmax(0, 1fr) auto"
                  gap="small"
                  alignItems="center"
                >
                  <s-box
                    padding="small-200"
                    background="subdued"
                    borderRadius="base"
                  >
                    <s-text>{embedCode}</s-text>
                  </s-box>
                  {copyButton(embedCode, "embedCode", "Copy HTML")}
                </s-grid>
              </s-stack>
            </s-stack>
          </s-section>
        </s-stack>
      );
    }
    return null;
  };

  const TOTAL_STEPS = 4;
  const STEP_LABELS = ["Welcome", "Player Type", "Audio Setup", "Display"];

  return (
    <div className="ob-fullscreen">
      <div className="ob-bg-blob ob-bg-blob--1"></div>
      <div className="ob-bg-blob ob-bg-blob--2"></div>
      <div className="ob-container">
        {/* Stepper — no Polaris web equivalent, so it stays custom. */}
        <div className="ob-stepper">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <React.Fragment key={i}>
              <div
                className={`ob-stepper-dot ${step >= i ? "ob-stepper-dot--active" : ""} ${step > i ? "ob-stepper-dot--done" : ""}`}
              >
                {step > i ? <s-icon type="check"></s-icon> : i + 1}
              </div>
              {i < TOTAL_STEPS - 1 && (
                <div
                  className={`ob-stepper-line ${step > i ? "ob-stepper-line--done" : ""}`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="small">
          {STEP_LABELS.map((label, i) => (
            <s-text key={label} color={step === i ? undefined : "subdued"}>
              {label}
            </s-text>
          ))}
        </s-grid>

        {/* Card (slide animation classes) */}
        <div
          className={`ob-card ${animating ? `ob-card--exit-${direction}` : ""}`}
        >
          {renderStepContent()}
        </div>

        {/* Footer: Back / Skip on the left, primary action on the right */}
        <s-stack
          direction="inline"
          justifyContent="space-between"
          alignItems="center"
          gap="base"
        >
          <s-stack direction="inline" gap="small-200">
            {step > 0 && step < 3 ? (
              <s-button
                icon="arrow-left"
                disabled={animating || isCreating || undefined}
                onClick={back}
              >
                Back
              </s-button>
            ) : null}
            {step < 3 ? (
              <s-button
                variant="tertiary"
                disabled={animating || undefined}
                onClick={skip}
              >
                Skip setup
              </s-button>
            ) : null}
          </s-stack>

          {step < 2 ? (
            <s-button
              variant="primary"
              icon="arrow-right"
              disabled={animating || undefined}
              onClick={next}
            >
              Next step
            </s-button>
          ) : null}
          {step === 2 ? (
            <s-button
              variant="primary"
              loading={isCreating || undefined}
              disabled={animating || isCreating || undefined}
              onClick={next}
            >
              {isCreating ? "Creating player…" : "Create player"}
            </s-button>
          ) : null}
          {step === 3 ? (
            <s-button variant="primary" icon="check" onClick={finish}>
              Finish
            </s-button>
          ) : null}
        </s-stack>
      </div>

      <AudioUploadModal
        setUploadAndSelectedFile={setUploadAndSelectedFile}
        items={loaderData?.audioFiles?.files || loaderData?.audioFiles}
        files={[]}
        setFiles={() => {}}
        selectedFile={audioSelectedFile}
        setSelectedFile={setAudioSelectedFile}
        isUploading={false}
        fileProgress={false}
      />

      {/* Image picker modal — for sticky-player thumbnail */}
      <ImageUploadModal
        modalId="upload-image"
        items={loaderData?.imageFiles || []}
        selectedFile={imageSelectedFile}
        setSelectedFile={setImageSelectedFile}
        setUploadAndSelectedFile={setUploadAndSelectedImage}
      />
    </div>
  );
}
