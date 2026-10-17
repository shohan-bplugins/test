import React, { useEffect, useState } from "react";
import AllIMG from "./AllIMG/AllIMG";
import ImgPreview from "./ImgPreview/ImgPreview";
import { useNavigation } from "@remix-run/react";
import { EmptyState } from "./PageState/PageState";
import { WebDropZone, WebSelect } from "./PolarisWeb/fields";
import { hideModal } from "../utils/modal";

const ImgModal = ({ img }) => {
  const {
    setAddPosterModalActive,
    options,
    handleSelectChange,
    isGridView,
    previewImg,
    handleDropZoneDrop,
    isUploading,
    fileProgress,
    uploadedFile,
    uploadedAndSelectedFile,
    uploadedAndSelectedImg,
    setUploadedAndSelectedImg,
    filteredFiles,
    selectedImgs,
    toggleImgSelection,
    setPreviewImg,
    isLoading,
    loadNextPage,
    loadPrevPage,
    pageInfo,
  } = img.img;

  const nav = useNavigation();
  const [paginationLoading, setPaginationLoading] = useState(false);
  // Next/previous page is a PUT submit, which `isLoading` (POST only) misses,
  // so track it here until that request settles.
  const isPaging = paginationLoading && nav.state !== "idle";

  useEffect(() => {
    if (nav.state === "idle") {
      setPaginationLoading(false);
    }
  }, [nav.state]);

  const busy = isLoading || isUploading || fileProgress;

  return (
    <s-modal
      id="upload-img"
      heading="Upload / Select Image"
      size="large-100"
    >
      <s-stack gap="base">
        <s-grid
          gridTemplateColumns="minmax(0, 1fr) auto"
          gap="base"
          alignItems="center"
        >
          <s-text color="subdued">
            Uploading and processing can take some time based on file size.
          </s-text>
          <WebSelect
            label="View"
            labelAccessibilityVisibility="exclusive"
            options={options}
            value={isGridView}
            onChange={handleSelectChange}
          />
        </s-grid>

        <s-grid
          gridTemplateColumns={previewImg ? "minmax(0, 1fr) minmax(0, 1fr)" : "1fr"}
          gap="base"
        >
          <s-stack gap="base">
            {isUploading || fileProgress ? (
              <s-box padding="large" border="base" borderRadius="base">
                <s-stack direction="inline" gap="small" justifyContent="center">
                  <s-spinner size="base" accessibilityLabel="Uploading image"></s-spinner>
                  <s-text color="subdued">
                    {fileProgress ? "Processing..." : "Uploading..."}
                  </s-text>
                </s-stack>
              </s-box>
            ) : (
              <WebDropZone
                accept="image/*"
                label="Drop an image here, or click to browse"
                disabled={busy || undefined}
                onDrop={(dropped) => handleDropZoneDrop(dropped, dropped, [])}
              />
            )}

            {isLoading || isPaging ? (
              <s-box padding="large-500">
                <s-stack alignItems="center">
                  <s-spinner accessibilityLabel="Loading images" size="large"></s-spinner>
                </s-stack>
              </s-box>
            ) : !filteredFiles?.length ? (
              <EmptyState
                compact
                heading="No images yet"
                message="Upload an image to use it in your player."
              />
            ) : isGridView == "grid_view" ? (
              <s-grid
                gridTemplateColumns="repeat(auto-fill, minmax(120px, 1fr))"
                gap="small"
              >
                {filteredFiles?.map((item, index) => (
                  <AllIMG
                    key={"img" + index + selectedImgs?.node?.id}
                    index={index}
                    item={item}
                    isGridView={isGridView}
                    selectedImgs={selectedImgs}
                    toggleImgSelection={toggleImgSelection}
                    previewImg={previewImg}
                    setPreviewImg={setPreviewImg}
                  />
                ))}
              </s-grid>
            ) : (
              <s-stack gap="small-200">
                {filteredFiles?.map((item, index) => (
                  <AllIMG
                    key={"img-list" + index}
                    index={index}
                    isGridView={isGridView}
                    item={item}
                    selectedImgs={selectedImgs}
                    toggleImgSelection={toggleImgSelection}
                    previewImg={previewImg}
                    setPreviewImg={setPreviewImg}
                  />
                ))}
              </s-stack>
            )}

            {pageInfo?.hasPreviousPage || pageInfo?.hasNextPage ? (
              <s-stack direction="inline" gap="small" justifyContent="center">
                <s-button
                  icon="chevron-left"
                  accessibilityLabel="Previous page"
                  disabled={!pageInfo.hasPreviousPage || isPaging || undefined}
                  onClick={() => {
                    loadPrevPage("image");
                    setPaginationLoading(true);
                  }}
                ></s-button>
                <s-button
                  icon="chevron-right"
                  accessibilityLabel="Next page"
                  disabled={!pageInfo.hasNextPage || isPaging || undefined}
                  onClick={() => {
                    loadNextPage("image");
                    setPaginationLoading(true);
                  }}
                ></s-button>
              </s-stack>
            ) : null}
          </s-stack>

          {previewImg ? (
            <ImgPreview
              filteredFiles={filteredFiles}
              previewImg={previewImg}
              setPreviewImg={setPreviewImg}
            />
          ) : null}
        </s-grid>
      </s-stack>

      <s-button
        slot="primary-action"
        variant="primary"
        disabled={selectedImgs?.length === 0 || undefined}
        onClick={() => {
          setUploadedAndSelectedImg(selectedImgs);
          hideModal("upload-img");
        }}
      >
        Insert Selected
      </s-button>
      <s-button slot="secondary-actions" onClick={() => hideModal("upload-img")}>
        Cancel
      </s-button>
    </s-modal>
  );
};

export default ImgModal;
