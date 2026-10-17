import React, { useEffect, useRef, useState } from "react";
import FileUploadModal from "../../../../components/Mediaaa";

const VideoUpload = () => {
  //=====================================================================================================================================//
  //-------------------------File Upload Modal---------------------------//
  //=====================================================================================================================================//
  const [uploadedAndSelectedFile, setUploadedAndSelectedFile] = useState([]);
  const [uploadedAndSelectedImg, setUploadedAndSelectedImg] = useState([]);
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
    setTitle(uploadedAndSelectedFile?.filename);
    setPoster(
      uploadedAndSelectedFile?.preview?.image?.url ||
        uploadedAndSelectedFile?.preview?.image?.src ||
        uploadedAndSelectedImg?.preview?.image?.url ||
        uploadedAndSelectedImg?.preview?.image?.src,
    );
  }, [uploadedAndSelectedFile, uploadedAndSelectedImg]);
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
    const filteredFiles = files?.filter((item) => {
      // Combine into desired format
      const itemDate = item.node.createdAt.split("T")[0];

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

  useEffect(() => {
    let interval = null;

    if (actionData?.createFileResult?.id || actionData?.status?.[0]?.id) {
      if (actionData?.status?.[0].fileStatus !== "READY") {
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        width: "100%",
      }}
    >
      <DropZone.FileUpload>
        <div style={{ textAlign: "center", padding: "20px" }}>
          <button className="modern-btn modern-btn-primary">
            Click to Upload Files
          </button>
        </div>
      </DropZone.FileUpload>
      <button
        className="modern-btn"
        onClick={(e) => {
          e.stopPropagation();
          setAddUrlModalActive(true);
        }}
        disabled={isLoading}
      >
        Upload From YouTube/Vimeo
      </button>
    </div>
  );
  const imgUpload = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        width: "100%",
      }}
    >
      <DropZone.FileUpload />
      <button
        className="modern-btn"
        onClick={(e) => {
          e.stopPropagation();
          setAddPosterModalActive(true);
        }}
        disabled={isLoading}
      >
        Upload From URL
      </button>
    </div>
  );
  const uploadedFile = file && (
    <LegacyStack>
      <Thumbnail
        size="small"
        alt={file.name}
        source={
          validImageTypes.includes(file.type)
            ? window.URL.createObjectURL(file)
            : NoteIcon
        }
      />
      <s-box>
        {file.name}{" "}
        <s-text color="subdued">{file.size} bytes</s-text>
      </s-box>
    </LegacyStack>
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

  const handleEnableAppEmbed = () => {
    window.open(
      `https://admin.shopify.com/store/${loaderData?.shop?.split(".")[0]}/themes/${loaderData?.themeId}/editor?context=apps`,
    );
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

    handleModalChange();
  });
  return (
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
  );
};

export default VideoUpload;
