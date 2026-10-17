import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher } from "@remix-run/react";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { WebDropZone } from "../PolarisWeb/fields";
import { hideModal } from "../../utils/modal";
import "./ImageUploadModal.css";

const ImageUploadModal = ({
  modalId = "upload-image",
  items = [],
  selectedFile,
  setSelectedFile,
  setUploadAndSelectedFile,
}) => {
  const shopify = useAppBridge();
  const uploadFetcher = useFetcher();
  const pendingFileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  // Uploaded-this-session images prepended to the list
  const [localItems, setLocalItems] = useState([]);

  const stripQuery = (url) => {
    try { return new URL(url).pathname; } catch { return url; }
  };

  // When the loader refreshes, promote selectedFile to the real Shopify item.
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

  // Local placeholders first (visible & selected right after upload),
  // then real items — deduplicated so no item appears twice.
  const realPaths = new Set(
    (items || []).map((i) => stripQuery(i?.node?.url)).filter(Boolean),
  );
  const allItems = [
    ...localItems.filter((l) => !realPaths.has(stripQuery(l?.node?.url))),
    ...(items || []),
  ];

  // Step 2: S3 upload → then create file in Shopify
  useEffect(() => {
    if (!uploadFetcher.data?.stagedUpload || !pendingFileRef.current) return;
    const { url, resourceUrl, parameters } = uploadFetcher.data.stagedUpload;
    const file = pendingFileRef.current;

    setUploading(true);

    const s3Form = new FormData();
    parameters.forEach(({ name, value }) => s3Form.append(name, value));
    s3Form.append("file", file);

    fetch(url, { method: "POST", body: s3Form })
      .then((res) => {
        if (!res.ok) throw new Error("S3 upload failed");
        const meta = new FormData();
        meta.append("name", file.name);
        meta.append("type", file.type);
        meta.append("resourceUrl", resourceUrl);
        uploadFetcher.submit(meta, { method: "PUT", action: "/app/upload" });
      })
      .catch(() => {
        shopify.toast.show("Upload failed — please try again.", { isError: true });
        setUploading(false);
        pendingFileRef.current = null;
      });
  }, [uploadFetcher.data?.stagedUpload]);

  // Step 4: file is ready in Shopify — add to local list and auto-select it.
  // Do NOT close the modal or set the parent URL yet.
  useEffect(() => {
    if (!uploadFetcher.data?.fileUrl) return;
    const fileUrl = uploadFetcher.data.fileUrl;
    pendingFileRef.current = null;
    setUploading(false);
    shopify.toast.show("Image uploaded — click Insert Selected to use it.");

    const newItem = {
      node: {
        id: `local-${Date.now()}`,
        url: fileUrl,
        alt: "",
        preview: { image: { url: fileUrl } },
      },
    };
    setLocalItems((prev) => [newItem, ...prev]);
    setSelectedFile(newItem);
  }, [uploadFetcher.data?.fileUrl]);

  const handleDrop = useCallback(
    (droppedFiles) => {
      const file = droppedFiles?.[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) {
        shopify.toast.show("Image must be 20 MB or less.", { isError: true });
        return;
      }
      pendingFileRef.current = file;
      shopify.toast.show("Uploading image…");
      const meta = new FormData();
      meta.append("name", file.name);
      meta.append("type", file.type);
      meta.append("size", String(file.size));
      uploadFetcher.submit(meta, { method: "POST", action: "/app/upload" });
    },
    [shopify],
  );

  const isLocalUploading = uploading || uploadFetcher.state !== "idle";

  const getImageUrl = (item) =>
    item?.node?.url ||
    item?.node?.preview?.image?.url ||
    item?.node?.preview?.image?.src;

  const isItemSelected = (item) =>
    selectedFile?.node?.id
      ? selectedFile.node.id === item?.node?.id
      : selectedFile === item;

  return (
    <s-modal id={modalId} heading="Select or Upload an Image" size="large">
      <s-stack gap="base">
        {isLocalUploading ? (
          <s-box padding="large" border="base" borderRadius="base">
            <s-stack direction="inline" gap="small" justifyContent="center">
              <s-spinner size="base" accessibilityLabel="Uploading image"></s-spinner>
              <s-text color="subdued">Uploading…</s-text>
            </s-stack>
          </s-box>
        ) : (
          <s-stack gap="small-300">
            <WebDropZone
              accept="image/*"
              label="Drop an image here, or click to browse"
              onDrop={handleDrop}
            />
            <s-text color="subdued">PNG, JPG, GIF, WebP · max 20 MB</s-text>
          </s-stack>
        )}

        {allItems.length > 0 ? (
          <s-grid
            gridTemplateColumns="repeat(auto-fill, minmax(140px, 1fr))"
            gap="base"
          >
            {allItems.map((item, i) => {
              const url = getImageUrl(item);
              if (!url) return null;
              const isSelected = isItemSelected(item);
              return (
                <s-clickable
                  key={item?.node?.id || i}
                  className={`imu-cell ${isSelected ? "imu-cell--selected" : ""}`}
                  accessibilityLabel={item?.node?.alt || "Select image"}
                  onClick={() => setSelectedFile(item)}
                >
                  <s-image
                    src={url}
                    alt={item?.node?.alt || "Image"}
                    aspectRatio="1/1"
                    objectFit="cover"
                  ></s-image>
                  {isSelected ? (
                    <s-box className="imu-check">
                      <s-icon type="check-circle-filled" tone="success"></s-icon>
                    </s-box>
                  ) : null}
                  {item?.node?.alt ? (
                    <s-box padding="small-300">
                      <s-text>{item.node.alt.slice(0, 24)}</s-text>
                    </s-box>
                  ) : null}
                </s-clickable>
              );
            })}
          </s-grid>
        ) : (
          <s-paragraph color="subdued">
            No images in your Shopify files yet. Drop one above to upload.
          </s-paragraph>
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

export default ImageUploadModal;
