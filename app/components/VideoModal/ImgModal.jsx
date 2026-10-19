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
import CustomDatePicker from "../CustomDatePicker/CustomDatePicker";
import { ArrowRightIcon, CalendarIcon } from "@shopify/polaris-icons";
import AllIMG from "../AllIMG/AllIMG";
import ImgPreview from "../ImgPreview/ImgPreview";
import { useLoaderData } from "@remix-run/react";
import TextInput from "../TextInput/TextInput";
import "./imageModal.css";

const ImgModal = ({ img }) => {
  const {
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
    uploadedFile,
    uploadedAndSelectedFile,
    uploadedAndSelectedImg,
    setUploadedAndSelectedImg,
    uploadedAndSelectedLogo,
    setUploadedAndSelectedLogo,
    fileUpload,
    filteredFiles,
    selectedImgs,
    toggleImgSelection,
    setPreviewImg,
    isLoading,
    loadNextPage,
    loadPrevPage,
    pageInfo,
    imageUrl,
    setImageUrl,
    imageLogo,
    setImageLogo,
    uploadImage,
    addPosterModalActive,
    uploadProgress,
  } = img.img;

  const [paginationLoading, setPaginationLoading] = useState(false);
  const [isUploadingFromUrl, setIsUploadingFromUrl] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setPaginationLoading(false);
    }
  }, [isLoading, paginationLoading]);

  useEffect(() => {
    if (!isUploading) {
      setIsUploadingFromUrl(false);
      setAddPosterModalActive(false);
      setImageUrl("");
    }
  }, [filteredFiles?.[0]?.node?.id]);

  return (
    <>
      <Modal id="upload-img" variant="large">
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
                <Box minHeight="30px" overflowX="hidden" overflowY="hidden">
                  <DropZone
                    accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                    type="image"
                    outline={false}
                    variableHeight={true}
                  >
                    <DropZone.FileUpload />
                  </DropZone>
                </Box>
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
                  sm: previewImg ? 12 : 6,
                  md: previewImg ? 12 : 6,
                  lg: previewImg ? 12 : 6,
                  xl: previewImg ? 12 : 6,
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
                  <CustomBox
                    style={{
                      width: "100%",
                      height: "144px",
                      padding: "10px",
                      position: "relative",
                    }}
                  >
                    <DropZone
                      accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                      type="image"
                      allowMultiple={false}
                      onDrop={handleDropZoneDrop}
                      style={{ height: "144px" }}
                      disabled={isLoading || isUploadingFromUrl}
                    >
                      {isUploading || isUploadingFromUrl ? (
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
                            accessibilityLabel="Uploading image"
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
                    </DropZone>
                    {addPosterModalActive ? (
                      <CustomBox
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
                          label="Image URL"
                          position="top"
                          inputStyle={{
                            width: "100%",
                            maxWidth: "100%",
                            margin: "5px 0 5px 0",
                            minWidth: "200px",
                          }}
                          placeholder="https://example.com/image.jpg"
                          style={{ display: "grid", padding: "0px" }}
                          value={imageUrl}
                          onChange={setImageUrl}
                        />
                        <Box paddingBlockStart="400">
                          <InlineStack gap="300">
                            <Button
                              variant="primary"
                              tone="success"
                              loading={isUploadingFromUrl}
                              disabled={!imageUrl || isUploadingFromUrl}
                              onClick={() => {
                                setIsUploadingFromUrl(true);
                                uploadImage({
                                  name: "Image URL",
                                  type: "IMAGE",
                                  resourceUrl: imageUrl,
                                });
                              }}
                            >
                              Upload
                            </Button>
                            <Button
                              variant="secondary"
                              loading={isUploadingFromUrl}
                              disabled={isUploadingFromUrl}
                              onClick={() => {
                                setAddPosterModalActive(false);
                                setImageUrl("");
                              }}
                            >
                              Cancel
                            </Button>
                          </InlineStack>
                        </Box>
                      </CustomBox>
                    ) : null}
                  </CustomBox>

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
                        {(isUploading ||
                          isUploadingFromUrl ||
                          uploadProgress > 0) && (
                          <Grid.Cell
                            key="uploading-placeholder"
                            columnSpan={{
                              xs: previewImg ? 6 : 2,
                              sm: previewImg ? 6 : 2,
                              md: previewImg ? 3 : 1,
                              lg: previewImg ? 3 : 1,
                              xl: previewImg ? 3 : 1,
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
                              <Spinner
                                size="small"
                                accessibilityLabel="Processing upload"
                              />
                              <p
                                style={{
                                  fontSize: "12px",
                                  color: "var(--app-primary)",
                                  fontWeight: "500",
                                  margin: 0,
                                }}
                              >
                                Processing...
                              </p>
                            </CustomBox>
                          </Grid.Cell>
                        )}
                        {filteredFiles.map((item, index) => (
                          <Grid.Cell
                            key={"img" + index}
                            columnSpan={{
                              xs: previewImg ? 6 : 2,
                              sm: previewImg ? 6 : 2,
                              md: previewImg ? 3 : 1,
                              lg: previewImg ? 3 : 1,
                              xl: previewImg ? 3 : 1,
                            }}
                          >
                            <CustomBox
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                listStyle: "none",
                                border: "1px solid rgb(227 227 227)",
                              }}
                            >
                              <AllIMG
                                index={index}
                                item={item}
                                isGridView={isGridView}
                                selectedImgs={selectedImgs}
                                toggleImgSelection={toggleImgSelection}
                                previewImg={previewImg}
                                setPreviewImg={setPreviewImg}
                                isUploading={isUploading}
                              />
                            </CustomBox>
                          </Grid.Cell>
                        ))}
                      </Grid>
                    ) : (
                      <ResourceList
                        resourceName={{ singular: "file", plural: "files" }}
                        items={filteredFiles}
                        renderItem={(item, index) => (
                          <CustomBox onClick={(e) => e.stopPropagation()}>
                            <AllIMG
                              index={index}
                              isGridView={isGridView}
                              item={item}
                              selectedImgs={selectedImgs}
                              toggleImgSelection={toggleImgSelection}
                              previewImg={previewImg}
                              setPreviewImg={setPreviewImg}
                            />
                          </CustomBox>
                        )}
                      />
                    )}
                  </Card>
                </Scrollable>
              </Grid.Cell>
              {previewImg ? (
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
                  <ImgPreview
                    filteredFiles={filteredFiles}
                    previewImg={previewImg}
                    setPreviewImg={setPreviewImg}
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
                  loadPrevPage("image");
                  setPaginationLoading(true);
                }}
                hasNext={pageInfo.hasNextPage}
                onNext={() => {
                  loadNextPage("image");
                  setPaginationLoading(true);
                }}
              />
            </CustomBox>
          ) : null}
        </CustomBox>

        {/* </DropZone> */}
        <TitleBar title="Upload & Select Image">
          <CustomButton
            variant="primary"
            disabled={selectedImgs?.length === 0}
            onClick={() => {
              setUploadedAndSelectedImg(selectedImgs);
              shopify.modal.hide("upload-img");
            }}
          >
            Insert Selected
          </CustomButton>
          <CustomButton onClick={() => shopify.modal.hide("upload-img")}>
            Cancel
          </CustomButton>
        </TitleBar>
      </Modal>
      <Modal id="upload-img-logo" variant="large">
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
                <Box minHeight="30px" overflowX="hidden" overflowY="hidden">
                  <DropZone
                    accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                    type="image"
                    outline={false}
                    variableHeight={true}
                  >
                    <DropZone.FileUpload />
                  </DropZone>
                </Box>
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
                  sm: previewImg ? 12 : 6,
                  md: previewImg ? 12 : 6,
                  lg: previewImg ? 12 : 6,
                  xl: previewImg ? 12 : 6,
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
                      accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                      type="image"
                      allowMultiple={false}
                      onDrop={handleDropZoneDrop}
                      style={{ height: "144px" }}
                      disabled={isLoading}
                    >
                      {isUploading ? (
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
                            accessibilityLabel="Uploading image"
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
                        {filteredFiles.map((item, index) => (
                          <Grid.Cell
                            key={"img" + index}
                            columnSpan={{
                              xs: previewImg ? 6 : 2,
                              sm: previewImg ? 6 : 2,
                              md: previewImg ? 3 : 1,
                              lg: previewImg ? 3 : 1,
                              xl: previewImg ? 3 : 1,
                            }}
                          >
                            <CustomBox
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                listStyle: "none",
                                border: "1px solid rgb(227 227 227)",
                              }}
                            >
                              <AllIMG
                                index={index}
                                item={item}
                                isGridView={isGridView}
                                selectedImgs={selectedImgs}
                                toggleImgSelection={toggleImgSelection}
                                previewImg={previewImg}
                                setPreviewImg={setPreviewImg}
                                isUploading={isUploading}
                              />
                            </CustomBox>
                          </Grid.Cell>
                        ))}
                      </Grid>
                    ) : (
                      <ResourceList
                        resourceName={{ singular: "file", plural: "files" }}
                        items={filteredFiles}
                        renderItem={(item, index) => (
                          <CustomBox onClick={(e) => e.stopPropagation()}>
                            <AllIMG
                              index={index}
                              isGridView={isGridView}
                              item={item}
                              selectedImgs={selectedImgs}
                              toggleImgSelection={toggleImgSelection}
                              previewImg={previewImg}
                              setPreviewImg={setPreviewImg}
                            />
                          </CustomBox>
                        )}
                      />
                    )}
                  </Card>
                </Scrollable>
              </Grid.Cell>
              {previewImg ? (
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 6, xl: 6 }}>
                  <ImgPreview
                    filteredFiles={filteredFiles}
                    previewImg={previewImg}
                    setPreviewImg={setPreviewImg}
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
                  loadPrevPage("image");
                  setPaginationLoading(true);
                }}
                hasNext={pageInfo.hasNextPage}
                onNext={() => {
                  loadNextPage("image");
                  setPaginationLoading(true);
                }}
              />
            </CustomBox>
          ) : null}
        </CustomBox>

        {/* </DropZone> */}
        <TitleBar title="Upload & Select Image">
          <CustomButton
            variant="primary"
            disabled={selectedImgs?.length === 0}
            onClick={() => {
              setUploadedAndSelectedLogo(selectedImgs);
              shopify.modal.hide("upload-img-logo");
            }}
          >
            Insert Selected
          </CustomButton>
          <CustomButton onClick={() => shopify.modal.hide("upload-img-logo")}>
            Cancel
          </CustomButton>
        </TitleBar>
      </Modal>
    </>
  );
};

export default ImgModal;
