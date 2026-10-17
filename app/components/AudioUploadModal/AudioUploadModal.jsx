import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher } from "@remix-run/react";
import AllAudio from "../AllAudio/AllAudio";
import "./AudioUploadModal.css";
import { WebDropZone, WebSearchField } from "../PolarisWeb/fields";
import { audioLabel } from "../AllAudio/audioMeta";
import { EmptyState } from "../PageState/PageState";
import { hideModal } from "../../utils/modal";
import { useWebComponentEvent } from "../../utils/useWebComponentEvent";

// Upload constraints. These are shown to the merchant in the drop zone so the
// rules are visible before a file is picked, not only after one is refused.
const MAX_FILE_SIZE_MB = 18;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_FORMATS_LABEL = "MP3, M4A, WAV, OGG, FLAC or AAC";

// Shopify occasionally reports an upload as application/octet-stream, so the
// extension is checked alongside the mime type.
const AUDIO_EXTENSIONS =
  /\.(mp3|m4a|m4b|aac|wav|wave|ogg|oga|opus|flac|weba|wma|aif|aiff)$/i;

// Browsers disagree on the mime type of some audio containers: Firefox reports
// .ogg as video/ogg (Chrome says audio/ogg), and .weba/.m4a can come through as
// video/webm or video/mp4. /app/upload picks the Shopify resource from the
// mime type, so a video/* type would stage the file as a VIDEO and fail.
const AUDIO_MIME_BY_EXT = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  wave: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  weba: "audio/webm",
  wma: "audio/x-ms-wma",
  aif: "audio/aiff",
  aiff: "audio/aiff",
};

// The audio mime type to send for this file — the extension wins, and the
// browser-reported type is only used when the extension is unknown.
const audioMimeType = (file) => {
  const ext = (file?.name || "").split(".").pop().toLowerCase();
  return AUDIO_MIME_BY_EXT[ext] || file?.type || "";
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Returns null when the file is usable, otherwise the reason it was refused —
// worded for the merchant and naming the file, so the message is actionable.
const validateAudioFile = (file) => {
  if (!file) return null;
  const name = file.name || "This file";
  const type = audioMimeType(file);
  const looksLikeAudio =
    type.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name || "");

  if (type.startsWith("video/") || !looksLikeAudio) {
    return `“${name}” isn’t an audio file. Accepted formats: ${ACCEPTED_FORMATS_LABEL}.`;
  }
  if (file.size === 0) {
    return `“${name}” is empty (0 KB). Check the file and try again.`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `“${name}” is ${formatBytes(file.size)} — the limit is ${MAX_FILE_SIZE_MB} MB. Compress it or upload a shorter clip.`;
  }
  return null;
};

// What the merchant sees at each step of the upload. There is no byte-level
// progress available (the S3 POST is a plain fetch), so the bar advances by
// stage rather than pretending to measure throughput.
const STAGE_LABELS = {
  preparing: "Preparing upload…",
  uploading: "Uploading to Shopify…",
  processing: "Processing — this can take a few seconds…",
};

// The success banner clears itself; failures stay until dismissed so the
// merchant can read the reason and act on it.
const AUTO_DISMISS_MS = 6000;

const AudioUploadModal = ({
  modalId = "upload-audio",
  handleSubmitFile,
  items,
  files,
  setFiles,
  selectedFile,
  setSelectedFile,
  isUploading,
  fileProgress,
  setUploadAndSelectedFile,
}) => {
  const shopify = useAppBridge();
  const bannerRef = useRef(null);
  const uploadFetcher = useFetcher();
  const pendingFileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  // Uploaded-this-session files prepended to the list
  const [localItems, setLocalItems] = useState([]);
  // Inline result shown inside the modal: { tone, title, message }. Toasts are
  // transient; this stays put so the merchant can read why an upload failed.
  const [status, setStatus] = useState(null);
  // null | "preparing" | "uploading" | "processing"
  const [uploadStage, setUploadStage] = useState(null);
  // Name/size of the file being uploaded, for the progress panel.
  const [pendingInfo, setPendingInfo] = useState(null);
  // Close the success banner once the countdown bar has run its course. The
  // bar itself is animated in CSS, so this only needs one timer rather than a
  // tick that re-renders. Errors never start a timer — they wait to be read.
  useEffect(() => {
    if (status?.tone !== "success") return undefined;
    const timer = setTimeout(() => setStatus(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const stripQuery = (url) => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  };

  // The loaders fetch "media_type:GenericFile", which is every non-image,
  // non-video file in Files — PDFs, ZIPs, fonts and so on — so narrow it to
  // audio here.
  const isAudioFile = (node) => {
    if (!node) return false;
    if (typeof node.mimeType === "string" && node.mimeType.startsWith("audio/"))
      return true;
    if (typeof node.mimeType === "string" && node.mimeType.startsWith("video/"))
      return false;
    return AUDIO_EXTENSIONS.test(stripQuery(node.url || ""));
  };

  // When the loader refreshes and the real Shopify item arrives in `items`,
  // replace the local synthetic item with the real one so selection is correct.
  useEffect(() => {
    if (!selectedFile?.node?.id?.startsWith?.("local-")) return;
    const localPath = stripQuery(selectedFile?.node?.url);
    const realItem = (items || []).find(
      (i) => stripQuery(i?.node?.url) === localPath,
    );
    if (realItem) {
      setSelectedFile(realItem);
      setLocalItems((prev) =>
        prev.filter((l) => stripQuery(l?.node?.url) !== localPath),
      );
    }
  }, [items]);

  // Real items first; local placeholders only while loader hasn't caught up yet
  const realPaths = new Set(
    (items || []).map((i) => stripQuery(i?.node?.url)).filter(Boolean),
  );
  const allItems = [
    ...(items || []),
    ...localItems.filter((l) => !realPaths.has(stripQuery(l?.node?.url))),
  ].filter((item) => isAudioFile(item?.node));

  // Step 2: when staged upload URL arrives, upload to S3 then create file
  useEffect(() => {
    if (!uploadFetcher.data?.stagedUpload || !pendingFileRef.current) return;
    const { url, resourceUrl, parameters } = uploadFetcher.data.stagedUpload;
    const file = pendingFileRef.current;

    setUploading(true);
    setUploadStage("uploading");

    const s3Form = new FormData();
    parameters.forEach(({ name, value }) => s3Form.append(name, value));
    s3Form.append("file", file);

    fetch(url, { method: "POST", body: s3Form })
      .then((res) => {
        if (!res.ok) throw new Error("S3 upload failed");
        setUploadStage("processing");
        const meta = new FormData();
        meta.append("name", file.name);
        meta.append("type", audioMimeType(file));
        meta.append("resourceUrl", resourceUrl);
        uploadFetcher.submit(meta, { method: "PUT", action: "/app/upload" });
      })
      .catch(() => {
        const message = `“${file.name}” didn’t finish uploading. Check your connection and try again.`;
        setStatus({ tone: "critical", title: "Upload failed", message });
        shopify.toast.show(message, { isError: true });
        setUploading(false);
        setUploadStage(null);
        setPendingInfo(null);
        setFiles([]);
        pendingFileRef.current = null;
      });
  }, [uploadFetcher.data?.stagedUpload]);

  // Step 3b: /app/upload answers { error } when Shopify refuses the staged
  // upload or the file create. Nothing consumed it before, so a failure left
  // the drop zone spinning with no explanation.
  useEffect(() => {
    if (!uploadFetcher.data?.error) return;
    const name = pendingFileRef.current?.name;
    const message = name
      ? `Shopify couldn’t store “${name}”. ${uploadFetcher.data.error}`
      : uploadFetcher.data.error;
    setStatus({ tone: "critical", title: "Upload failed", message });
    shopify.toast.show(message, { isError: true });
    setUploading(false);
    setUploadStage(null);
    setPendingInfo(null);
    setFiles([]);
    pendingFileRef.current = null;
  }, [uploadFetcher.data?.error]);

  // Step 4: file ready — add to local list and auto-select. Modal stays open.
  useEffect(() => {
    if (!uploadFetcher.data?.fileUrl) return;
    const fileUrl = uploadFetcher.data.fileUrl;
    const uploadedName = pendingFileRef.current?.name;
    pendingFileRef.current = null;
    setUploading(false);
    setUploadStage(null);
    setPendingInfo(null);
    setFiles([]);
    setStatus({
      id: Date.now(),
      tone: "success",
      title: "Upload complete",
      message: uploadedName
        ? `“${uploadedName}” is ready — click Insert Selected to use it.`
        : "Audio uploaded — click Insert Selected to use it.",
    });
    shopify.toast.show("Audio uploaded — click Insert Selected to use it.");

    const newItem = {
      node: {
        id: `local-${Date.now()}`,
        url: fileUrl,
        alt: "",
        mimeType: "audio/mpeg",
        preview: { image: { url: fileUrl } },
      },
    };
    setLocalItems((prev) => [newItem, ...prev]);
    setSelectedFile(newItem);
  }, [uploadFetcher.data?.fileUrl]);

  // Validate every dropped file ourselves rather than relying on DropZone's
  // accept split: it lets us name the file and the exact reason, and it still
  // accepts a valid .mp3 whose browser-reported type is blank.
  const handleInternalDrop = useCallback(
    (dropFiles) => {
      const file = dropFiles?.[0];
      if (!file) return;

      const problem = validateAudioFile(file);
      if (problem) {
        setStatus({
          tone: "critical",
          title: "File not uploaded",
          message: problem,
        });
        shopify.toast.show(problem, { isError: true });
        return;
      }

      setStatus(null);
      setUploadStage("preparing");
      setPendingInfo({ name: file.name, size: file.size });
      pendingFileRef.current = file;
      setFiles([file]);
      const meta = new FormData();
      meta.append("name", file.name);
      meta.append("type", audioMimeType(file));
      meta.append("size", String(file.size));
      uploadFetcher.submit(meta, { method: "POST", action: "/app/upload" });
    },
    [shopify],
  );

  const isLocalUploading = uploading || uploadFetcher.state !== "idle";

  const [isGridView, setIsGridView] = useState("grid_view");

  useWebComponentEvent(bannerRef, "dismiss", () => setStatus(null));

  const requirementsLine = (
    <s-text color="subdued">
      Accepted formats: {ACCEPTED_FORMATS_LABEL} &middot; Maximum size:{" "}
      {MAX_FILE_SIZE_MB} MB
    </s-text>
  );

  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visibleItems = q
    ? allItems.filter((item) =>
        audioLabel(item?.node).name.toLowerCase().includes(q),
      )
    : allItems;

  const busy = isLocalUploading || isUploading || fileProgress;

  return (
    <s-modal id={modalId} heading="Upload / Select Audio" size="large">
      <s-stack gap="base">
        {status ? (
          <s-banner
            ref={bannerRef}
            tone={status.tone}
            heading={status.title}
            dismissible
          >
            <s-paragraph>{status.message}</s-paragraph>
            {status.tone === "success" ? (
              <s-box className="audioUploadDismiss__track">
                {/* key restarts the keyframe for each new upload */}
                <s-box
                  key={status.id}
                  className="audioUploadDismiss__bar"
                  style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }}
                ></s-box>
              </s-box>
            ) : null}
          </s-banner>
        ) : null}

        {busy ? (
          <s-box padding="large" border="base" borderRadius="base">
            <s-stack gap="small-200" alignItems="center">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-spinner size="base" accessibilityLabel="Uploading audio file"></s-spinner>
                <s-text type="strong">
                  {STAGE_LABELS[uploadStage] ||
                    (fileProgress ? "Processing…" : "Uploading…")}
                </s-text>
              </s-stack>
              {pendingInfo ? (
                <s-text color="subdued">
                  {pendingInfo.name} · {formatBytes(pendingInfo.size)}
                </s-text>
              ) : null}
            </s-stack>
          </s-box>
        ) : (
          <s-stack gap="small-300">
            <WebDropZone
              accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac"
              label="Upload audio"
              onDrop={handleInternalDrop}
            />
            {requirementsLine}
          </s-stack>
        )}

        {allItems?.length > 0 ? (
          <s-grid
            gridTemplateColumns="minmax(0, 1fr) auto"
            gap="small"
            alignItems="center"
          >
            <WebSearchField
              label="Search audio"
              labelAccessibilityVisibility="exclusive"
              placeholder={`Search ${allItems.length} audio files`}
              value={query}
              onChange={setQuery}
            />
            <s-stack direction="inline" gap="small-300">
              <s-button
                icon="grid"
                variant={isGridView === "grid_view" ? "secondary" : "tertiary"}
                accessibilityLabel="Grid view"
                onClick={() => setIsGridView("grid_view")}
              ></s-button>
              <s-button
                icon="list-bulleted"
                variant={isGridView === "list_view" ? "secondary" : "tertiary"}
                accessibilityLabel="List view"
                onClick={() => setIsGridView("list_view")}
              ></s-button>
            </s-stack>
          </s-grid>
        ) : null}

        {allItems?.length > 0 && !visibleItems.length ? (
          <EmptyState
            compact
            image={null}
            heading={`No audio matches “${query.trim()}”`}
            message="Try a different name, or clear the search."
            action={<s-button onClick={() => setQuery("")}>Clear search</s-button>}
          />
        ) : visibleItems.length > 0 ? (
          <s-grid
            gridTemplateColumns={
              isGridView === "grid_view"
                ? "repeat(auto-fill, minmax(220px, 1fr))"
                : "1fr"
            }
            gap="small"
          >
            {visibleItems.map((item, index) => (
              <AllAudio
                key={item?.node?.id || "audio" + index}
                item={item}
                selectedFile={selectedFile}
                setSelectedFile={setSelectedFile}
              />
            ))}
          </s-grid>
        ) : (
          <EmptyState
            compact
            heading="Upload an audio file to get started"
            message="Drop an audio file above, or upload one to your store's Files section and it will show up here."
          />
        )}
      </s-stack>

      <s-button
        slot="primary-action"
        variant="primary"
        disabled={!selectedFile || undefined}
        onClick={() => {
          if (selectedFile) {
            setUploadAndSelectedFile(selectedFile);
            hideModal(modalId);
          }
        }}
      >
        Insert Selected
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() => {
          setSelectedFile(null);
          hideModal(modalId);
        }}
      >
        Cancel
      </s-button>
    </s-modal>
  );
};

export default AudioUploadModal;
