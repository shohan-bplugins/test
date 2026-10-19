import React, { useEffect, useRef, useState } from "react";
import { CustomButton, CustomBox } from "../../utils/polarisWebComponents";
import { Modal, TitleBar } from "@shopify/app-bridge-react";
import {
  Grid,
  LegacyStack,
  ResourceList,
  Scrollable,
  DropZone,
  Spinner,
  Button,
  Select,
  Card,
  Popover,
  InlineGrid,
  Box,
  OptionList,
  BlockStack,
  InlineStack,
  TextField,
  DatePicker,
  useBreakpoints,
  Pagination,
} from "@shopify/polaris";
import AllVideos from "../AllVideos/AllVideos";
import CustomDatePicker from "../CustomDatePicker/CustomDatePicker";
import { ArrowRightIcon, CalendarIcon } from "@shopify/polaris-icons";
import VideoPreview from "../VideoPreview/VideoPreview";
import TextInput from "../TextInput/TextInput";

const VideoModal = ({ video }) => {
  const {
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
    setNewUrl,
    newUrl,
    addUrlModalActive,
    confirmNewURL,
    uploadProgress,
  } = video.video;

  const [paginationLoading, setPaginationLoading] = useState(false);
  const [isUploadingFromUrl, setIsUploadingFromUrl] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setPaginationLoading(false);
    }
  }, [isLoading, paginationLoading]);

  useEffect(() => {
    if (!isUploading) {
      setIsUploadingFromUrl(false);
      setAddUrlModalActive(false);
      setNewUrl("");
    }
  }, [filteredFiles?.[0]?.node?.id]);

  useEffect(() => {
    let timer;

    if (isUploading) {
      setLoading(true);
    } else {
      timer = setTimeout(() => {
        setLoading(false);
      }, 6500);
    }

    return () => clearTimeout(timer);
  }, [isUploading, loading]);

  return (
    <>
      <Modal id="upload-video" variant="large">
        {/* <DropZone
          allowMultiple={false}
          onDrop={handleDropZoneDrop}
          outline={false}
        > */}
        <CustomBox onClick={(e) => e.stopPropagation()}>
          <Box
            padding="300"
            paddingBlockEnd="500"
            overflowX="hidden"
            overflowY="hidden"
          >
            <InlineStack align="space-between" blockAlign="center" wrap={false}>
              <CustomDatePicker
                inputValues={inputValues}
                setInputValues={setInputValues}
              />
              {/* Rendered conditionally rather than toggled with display:none —
                  same result, one less wrapper, and the DropZone stops being a
                  focusable target while hidden. */}
              {isHiddenUploadOption && (
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  wrap={false}
                >
                  <Box minHeight="30px" overflowX="hidden" overflowY="hidden">
                    <DropZone
                      accept="video/mp4,video/quicktime,video/webm"
                      type="video"
                      outline={false}
                      variableHeight={true}
                    >
                      <DropZone.FileUpload />
                    </DropZone>
                  </Box>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddUrlModalActive(true);
                    }}
                  >
                    Upload From YouTube/Vimeo
                  </Button>
                </InlineStack>
              )}
              <Select
                options={options}
                onChange={handleSelectChange}
                value={isGridView}
              />
            </InlineStack>
          </Box>
          <LegacyStack vertical>
            <Grid>
              <Grid.Cell
                columnSpan={{
                  xs: 3,
                  sm: preview ? 12 : 6,
                  md: preview ? 12 : 6,
                  lg: preview ? 12 : 6,
                  xl: preview ? 12 : 6,
                }}
              >
                <Scrollable
                  scrollbarWidth="none"
                  onScroll={handleScroll}
                  shadow={isHiddenUploadOption}
                  style={{
                    maxHeight: "90vh",
                    minHeight: "500px",
                  }}
                  focusable
                >
                  <Box width="100%" minHeight="144px" padding="300">
                    <DropZone
                      accept="video/mp4,video/quicktime,video/webm"
                      type="video"
                      allowMultiple={false}
                      onDrop={handleDropZoneDrop}
                      style={{ height: "144px" }}
                      disabled={isUploading || loading}
                    >
                      {isUploading || loading ? (
                        <CustomBox
                          className="upload-progress-container"
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            flexDirection: "column",
                            gap: "10px",
                            position: "absolute",
                            left: 0,
                            top: 0,
                            zIndex: 1050,
                          }}
                        >
                          <Spinner
                            accessibilityLabel="Uploading video"
                            size="large"
                          />
                          <p className="upload-progress-text">
                            {uploadProgress > 0 && uploadProgress < 100
                              ? `Uploading & Processing... ${uploadProgress}%`
                              : uploadProgress >= 100
                                ? "Upload complete!"
                                : "Preparing upload..."}
                          </p>
                          {uploadProgress > 0 && (
                            <CustomBox className="upload-progress-bar-track">
                              <CustomBox
                                className="upload-progress-bar-fill"
                                style={{ width: `${uploadProgress}%` }}
                              />
                            </CustomBox>
                          )}
                        </CustomBox>
                      ) : (
                        fileUpload
                      )}

                      {addUrlModalActive ? (
                        <CustomBox
                          onClick={(e) => e.stopPropagation()}
                          className="imageUploadFromURLCard"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "7px 20px",
                            gap: "10px",
                            borderRadius: "10px",
                            marginBottom: "10px",
                            marginLeft: "1%",
                            maxWidth: "98%",
                            backgroundColor: "#ffffffff",
                            boxShadow: "rgb(7 7 7 / 80%) 0px 10px 20px 6px",
                            position: "absolute",
                            top: "60%",
                            left: "50%",
                            zIndex: 1000,
                            transform: "translate(-10%,10%)",
                          }}
                        >
                          <TextInput
                            type="url"
                            label="Youtube/Vimeo Video URL"
                            position="top"
                            inputStyle={{
                              width: "100%",
                              maxWidth: "100%",
                              margin: "5px 0 5px 0",
                              minWidth: "200px",
                            }}
                            placeholder="https://www.youtube.com/watch?v=9tYK6ZgsDVk"
                            style={{ display: "grid", padding: "0px" }}
                            value={newUrl}
                            onChange={setNewUrl}
                          />
                          <Box paddingBlockStart="400">
                            <InlineStack gap="300">
                              <Button
                                variant="primary"
                                tone="success"
                                loading={isUploadingFromUrl}
                                disabled={!newUrl || isUploadingFromUrl}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIsUploadingFromUrl(true);
                                  confirmNewURL();
                                }}
                              >
                                Upload
                              </Button>
                              <Button
                                variant="secondary"
                                loading={isUploadingFromUrl}
                                disabled={isUploadingFromUrl}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAddUrlModalActive(false);
                                  setNewUrl("");
                                }}
                              >
                                Cancel
                              </Button>
                            </InlineStack>
                          </Box>
                        </CustomBox>
                      ) : null}
                    </DropZone>
                  </Box>
                  <Card background={"black"}>
                    {isLoading && paginationLoading ? (
                      <CustomBox
                        style={{
                          height: "350px",
                          width: "100%",
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <Spinner
                          accessibilityLabel="Spinner example"
                          size="large"
                        />
                      </CustomBox>
                    ) : isGridView == "grid_view" ? (
                      <Grid>
                        {/* {(isUploading || loading || uploadProgress > 0) && (
                          <Grid.Cell
                            key="uploading-placeholder"
                            columnSpan={{
                              xs: preview ? 6 : 2,
                              sm: preview ? 6 : 2,
                              md: preview ? 3 : 1,
                              lg: preview ? 3 : 1,
                              xl: preview ? 3 : 1,
                            }}
                          >
                            <CustomBox
                              className="upload-placeholder-card"
                              style={{
                                listStyle: "none",
                                border: "2px dashed var(--app-primary)",
                                borderRadius: "5px",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                                alignItems: "center",
                                minHeight: "130px",
                                gap: "8px",
                                background: "#f0f5ff",
                              }}
                            >
                              <Spinner size="small" accessibilityLabel="Processing upload" />
                              <p style={{ fontSize: "12px", color: "var(--app-primary)", fontWeight: "500", margin: 0 }}>
                                Processing...
                              </p>
                            </CustomBox>
                          </Grid.Cell>
                        )} */}
                        {filteredFiles.map((item, index) => {
                          if (item.node.fileStatus == "FAILED") {
                            return null;
                          } else {
                            return (
                              <Grid.Cell
                                key={"video" + index}
                                columnSpan={{
                                  xs: preview ? 6 : 2,
                                  sm: preview ? 6 : 2,
                                  md: preview ? 3 : 1,
                                  lg: preview ? 3 : 1,
                                  xl: preview ? 3 : 1,
                                }}
                              >
                                <CustomBox
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    listStyle: "none",
                                    border: "1px solid rgb(227 227 227)",
                                  }}
                                >
                                  <AllVideos
                                    index={index}
                                    item={item}
                                    isGridView={isGridView}
                                    selectedFiles={selectedFiles}
                                    toggleFileSelection={toggleFileSelection}
                                    preview={preview}
                                    setPreview={setPreview}
                                    isUploading={isUploading}
                                  />
                                </CustomBox>
                              </Grid.Cell>
                            );
                          }
                        })}
                      </Grid>
                    ) : (
                      <ResourceList
                        resourceName={{ singular: "file", plural: "files" }}
                        items={filteredFiles}
                        renderItem={(item, index) => (
                          <CustomBox
                            key={"video" + index}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <AllVideos
                              isGridView={isGridView}
                              item={item}
                              selectedFiles={selectedFiles}
                              toggleFileSelection={toggleFileSelection}
                              preview={preview}
                              setPreview={setPreview}
                            />
                          </CustomBox>
                        )}
                      />
                    )}
                  </Card>
                </Scrollable>
              </Grid.Cell>
              {preview ? (
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
                  <VideoPreview
                    filteredFiles={filteredFiles}
                    preview={preview}
                    setPreview={setPreview}
                  />
                </Grid.Cell>
              ) : null}
            </Grid>
          </LegacyStack>
          {pageInfo?.hasPreviousPage || pageInfo?.hasNextPage ? (
            <CustomBox
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-evenly",
                alignItems: "center",
                position: "fixed",
                bottom: 0,
                backgroundColor: "rgba(192, 192, 192, 0.73)",
                paddingBottom: "10px",
                paddingTop: "10px",
              }}
            >
              <Pagination
                hasPrevious={pageInfo.hasPreviousPage}
                onPrevious={() => {
                  loadPrevPage("video");
                  setPaginationLoading(true);
                }}
                hasNext={pageInfo.hasNextPage}
                onNext={() => {
                  loadNextPage("video");
                  setPaginationLoading(true);
                }}
              />
            </CustomBox>
          ) : null}
        </CustomBox>

        {/* </DropZone> */}
        <TitleBar title="Upload / Select Video - Uploading and Processing of the video could take some time based on file size.">
          <CustomButton
            variant="primary"
            disabled={selectedFiles?.length === 0}
            onClick={() => {
              setUploadedAndSelectedFile(selectedFiles);
              shopify.modal.hide("upload-video");
            }}
          >
            Insert Selected
          </CustomButton>
          <CustomButton onClick={() => shopify.modal.hide("upload-video")}>
            Cancel
          </CustomButton>
        </TitleBar>
      </Modal>
    </>
  );
};

export default VideoModal;
