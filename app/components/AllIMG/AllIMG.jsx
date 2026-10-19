import React from "react";
import "./AllIMG.css";

const AllIMG = ({
  index,
  item,
  isGridView,
  selectedImgs,
  toggleImgSelection,
  previewImg,
  setPreviewImg,
}) => {
  const i = Number(index);
  const isSelected = item?.node?.id === selectedImgs?.id;
  const isReady = Boolean(
    item?.node?.preview?.image?.url ||
      item?.node?.preview?.image?.src ||
      item?.node?.url,
  );
  const src = item?.node?.type?.startsWith("image")
    ? item?.node?.url
    : item?.node?.preview?.image?.url || item?.node?.preview?.image?.src;

  const previewButton = (
    <s-button
      variant="secondary"
      icon="view"
      accessibilityLabel="Preview"
      onClick={(e) => {
        e.stopPropagation();
        setPreviewImg(Number(i + 1));
      }}
    ></s-button>
  );

  if (isGridView === "grid_view") {
    return (
      <s-clickable
        className={`fileCardItemImage ${isSelected ? "is-selected" : ""}`}
        border="base"
        borderRadius="base"
        background={isSelected ? "strong" : "base"}
        accessibilityLabel={item?.node?.alt || "Select image"}
        onClick={() => toggleImgSelection(item?.node)}
      >
        {isReady ? null : (
          <s-box className="fileCardItemImage__processing">
            <s-text color="subdued">Processing</s-text>
          </s-box>
        )}
        <s-box padding="small-300" className={isReady ? "" : "is-hidden"}>
          <s-image
            src={src}
            alt={item?.node?.name}
            aspectRatio="4/3"
            objectFit="cover"
            borderRadius="base"
          ></s-image>
        </s-box>
        <s-box
          className={`button ${previewImg - 1 == i ? "is-active" : ""}`}
        >
          {previewButton}
        </s-box>
        <s-box paddingInline="small-300" paddingBlockEnd="small-300">
          <s-text>{item?.node?.alt?.slice(0, 15) + "..." || "NaN"}</s-text>
        </s-box>
      </s-clickable>
    );
  }

  return (
    <s-clickable
      className={`fileCardItemListImage ${isSelected ? "is-selected" : ""}`}
      border="base"
      borderRadius="base"
      padding="small"
      background={isSelected ? "strong" : "base"}
      accessibilityLabel={item?.node?.alt || "Select image"}
      onClick={() => toggleImgSelection(item?.node)}
    >
      <s-grid
        gridTemplateColumns="auto minmax(0, 1fr) auto"
        gap="base"
        alignItems="center"
      >
        <s-thumbnail src={src} alt={item?.node?.name} size="large"></s-thumbnail>
        <s-text>{item?.node?.alt || "..."}</s-text>
        {previewButton}
      </s-grid>
    </s-clickable>
  );
};

export default AllIMG;
