import React from "react";
import "../styles/mediaUpload.css";
import ImgModal from "./ImgModal";

export default function ImgUploadModal({
  inputValues,
  setInputValues,
  isHiddenUploadOption,
  setAddPosterModalActive,
  options,
  handleSelectChange,
  isGridView,
  previewImg,
  handleScroll,
  handleDropZoneDrop,
  isUploading,
  fileProgress,
  uploadedFile,
  uploadedAndSelectedImg,
  setUploadedAndSelectedImg,
  fileUpload,
  filteredFiles,
  selectedImgs,
  toggleImgSelection,
  setPreviewImg,
  files,
  addPosterModalActive,
  toastMarkup,
  actionData,
  isLoading,
  uploadImage,
  loadNextPage,
  loadPrevPage,
  pageInfo,
}) {
  return (
    <>
      <ImgModal
        img={{
          img: {
            inputValues,
            setInputValues,
            isHiddenUploadOption,
            setAddPosterModalActive,
            options,
            handleSelectChange,
            isGridView,
            previewImg,
            handleScroll,
            handleDropZoneDrop,
            isUploading,
            fileProgress,
            uploadedFile,
            uploadedAndSelectedImg,
            setUploadedAndSelectedImg,
            fileUpload,
            filteredFiles,
            selectedImgs,
            toggleImgSelection,
            setPreviewImg,
            isLoading,
            actionData,
            loadNextPage,
            loadPrevPage,
            pageInfo,
          },
        }}
      />
      {toastMarkup}
    </>
  );
}
