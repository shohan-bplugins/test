import React, { useEffect } from "react";
import MediaUrlField from "../MediaUrlField/MediaUrlField";
import TextInput from "../TextInput/TextInput";
import { showModal } from "../../utils/modal";

// Per-track editor inside the playlist's DraggableList (moved out of the
// playlist route to break the route <-> component circular import).
const ItemSettings = ({
  items,
  index,
  item,
  onChange,
  loading = false,
  screen,
  files,
  setFiles,
  setIsUploading,
  selectedFile,
  uploadAndSelectedFile,
  setUploadAndSelectedFile,
  uploadedAndSelectedImg,
  setUploadedAndSelectedImg,
  activeId,
  setSelectedFile,
  setSelectedImgs,
  loaderData,
}) => {
  const updateData = (value, i, property) => {
    const updatedItems = items?.map((item, idx) =>
      idx === i ? { ...item, [property]: value } : item,
    );
    onChange(updatedItems);
  };

  useEffect(() => {
    if (uploadAndSelectedFile && activeId && activeId === item.id) {
      const updatedItems = items?.map((mapedItem, idx) => {
        return mapedItem?.id == activeId
          ? {
              ...mapedItem,
              url: uploadAndSelectedFile?.node?.url,
            }
          : mapedItem;
      });

      onChange(updatedItems);
      // setTimeout(() => {
      setUploadAndSelectedFile();
      // }, 100);
    }

    if (uploadedAndSelectedImg && activeId && activeId === item.id) {
      const updatedItems = items?.map((mapedItem, idx) =>
        mapedItem?.id === activeId
          ? {
              ...mapedItem,
              poster: uploadedAndSelectedImg?.preview?.image?.url,
            }
          : mapedItem,
      );

      onChange(updatedItems);

      setUploadedAndSelectedImg();
    }
  }, [uploadAndSelectedFile, activeId, uploadedAndSelectedImg]);

  useEffect(() => {
    function getFileNameWithoutExtension(url) {
      try {
        if (!url) return "";
        const lastSegment = url.split("/").pop();
        const fileWithExtension = lastSegment?.split("?")[0] || "";
        const fileName = fileWithExtension.replace(/\.[^/.]+$/, "");
        return fileName;
      } catch (error) {
        console.error("Invalid URL:", error);
        return "";
      }
    }
    if (!item?.title) {
      updateData(getFileNameWithoutExtension(item?.url), index, "title");
    }
  }, [item?.url]);

  return (
    <>
      <MediaUrlField
        label="Source"
        value={item.url || ""}
        onChange={(v) => {
          updateData(v || " ", index, "url");
        }}
        onUploadClick={() => {
          const currentSelectedFile = loaderData?.audioFiles?.files?.find(
            (f) => {
              return f?.node?.url === item.url;
            },
          );

          setSelectedFile(currentSelectedFile || null);
          showModal("upload-audio");
        }}
        required
      />
      <TextInput
        type="text"
        label="Audio Title"
        position="top"
        inputStyle={{ maxWidth: "100%", margin: "5px 0 10px 0" }}
        style={{ display: "grid", padding: "0px" }}
        value={item.title}
        onChange={(value) => updateData(value, index, "title")}
      />

      {screen === "screenTwo" && (
        <>
          <TextInput
            type="text"
            label="Artist"
            position="top"
            inputStyle={{ maxWidth: "100%", margin: "5px 0 10px 0" }}
            style={{ display: "grid", padding: "0px" }}
            value={item?.artist}
            onChange={(value) => updateData(value, index, "artist")}
          />
          <MediaUrlField
            label="Thumbnail"
            value={
              item?.poster?.length > 5
                ? item?.poster
                : "https://placehold.co/500x500/15803d/fff/svg?text=Placeholder+Image\n+\nAudio+Player\nby+bPlugins&font=roboto"
            }
            onChange={(v) => updateData(v, index, "poster")}
            onUploadClick={() => {
              const currentSelectedImg = loaderData?.imageFiles?.find((f) => {
                return (
                  f?.node?.preview?.image?.url === item?.poster ||
                  f?.node?.preview?.image?.src === item?.poster
                );
              });

              setSelectedImgs(currentSelectedImg?.node || null);

              showModal("upload-img");
            }}
          />
        </>
      )}
    </>
  );
};

export { ItemSettings };
export default ItemSettings;
