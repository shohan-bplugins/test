import React, { useState, useCallback, useEffect, useRef } from "react";
import { useSubmit, useFetcher, useNavigation } from "@remix-run/react";
import { Modal } from "@shopify/polaris";
import "../styles/mediaUpload.css";
import {
  DragHandleIcon,
  ListBulletedIcon,
  NoteIcon,
  PlusIcon,
} from "@shopify/polaris-icons";

import VideoModal from "./VideoModal/VideoModal";
import { useAppBridge } from "@shopify/app-bridge-react";

// This would typically be in a separate file
const SHOPIFY_SHOP = "shohan01.myshopify.com";
const SHOPIFY_ACCESS_TOKEN = "shpua_e3777422dcfdcf5320cabd7861f4a44f";

export default function FileUploadModal({
  inputValues,
  setInputValues,
  isHiddenUploadOption,
  setAddUrlModalActive,
  options,
  handleSelectChange,
  isGridView,
  preview,
  handleScroll,
  handleDropZoneDrop,
  isUploading,
  uploadedFile,
  uploadedAndSelectedFile,
  setUploadedAndSelectedFile,
  fileUpload,
  filteredFiles,
  selectedFiles,
  toggleFileSelection,
  setPreview,
  files,
  addUrlModalActive,
  confirmNewURL,
  newUrl,
  setNewUrl,
  toastMarkup,
  actionData,
  isLoading,
  toggleModal,
  loadNextPage,
  loadPrevPage,
  pageInfo,
  uploadProgress,
}) {
  return (
    <s-box>
      <VideoModal
        video={{
          video: {
            inputValues,
            setInputValues,
            isHiddenUploadOption,
            setAddUrlModalActive,
            options,
            handleSelectChange,
            isGridView,
            preview,
            handleScroll,
            handleDropZoneDrop,
            isUploading,
            uploadedFile,
            uploadedAndSelectedFile,
            setUploadedAndSelectedFile,
            fileUpload,
            filteredFiles,
            selectedFiles,
            toggleFileSelection,
            setPreview,
            isLoading,
            loadNextPage,
            loadPrevPage,
            pageInfo,
            addUrlModalActive,
            newUrl,
            setNewUrl,
            confirmNewURL,
            uploadProgress,
          },
        }}
      />
      <Modal
        // open={addUrlModalActive}
        onClose={() => {
          setAddUrlModalActive(false);
          shopify.modal.show("upload-video");
          toggleModal(true);
        }}
        title="Youtube/Vimeo"
        primaryAction={{
          content: "Add New Video",
          onAction: confirmNewURL,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setAddUrlModalActive(false);
              shopify.modal.show("upload-video");
            },
          },
        ]}
      >
        <Modal.Section>
          <s-url-field
            label="YouTube/Vimeo Video URL"
            value={newUrl}
            onInput={(e) => setNewUrl(e.target.value)}
            autocomplete="off"
          />
        </Modal.Section>
      </Modal>

      {toastMarkup}
    </s-box>
  );
}
