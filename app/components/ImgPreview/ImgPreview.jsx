import React from "react";

const ImgPreview = ({ filteredFiles, previewImg, setPreviewImg }) => {
  const node = filteredFiles[previewImg - 1]?.node;
  const alt = node?.alt || "";
  const dot = alt.lastIndexOf(".");

  const dateOptions = { year: "numeric", month: "long", day: "numeric" };
  const formattedDate = new Date(node?.createdAt)?.toLocaleDateString(
    "en-US",
    dateOptions,
  );

  const go = (e, to) => {
    e.stopPropagation();
    setPreviewImg(Number(to));
  };

  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="base">
        <s-grid gridTemplateColumns="minmax(0, 1fr) auto" alignItems="center">
          <s-heading>Preview</s-heading>
          <s-button
            variant="tertiary"
            icon="x-circle"
            accessibilityLabel="Close preview"
            onClick={(e) => go(e, 0)}
          ></s-button>
        </s-grid>

        <s-grid gridTemplateColumns="auto minmax(0, 1fr) auto" gap="small" alignItems="center">
          <s-button
            variant="tertiary"
            icon="chevron-left"
            accessibilityLabel="Previous image"
            disabled={Number(previewImg) === 1 || undefined}
            onClick={(e) => go(e, previewImg - 1)}
          ></s-button>
          <s-box padding="small" background="base" borderRadius="base">
            <s-image
              key={`img-${node?.id}`}
              src={
                node?.mediaContentType === "IMAGE"
                  ? node?.preview?.image?.src || node?.preview?.image?.url
                  : node?.url
              }
              alt={alt}
              objectFit="contain"
            ></s-image>
          </s-box>
          <s-button
            variant="tertiary"
            icon="chevron-right"
            accessibilityLabel="Next image"
            disabled={Number(previewImg) === filteredFiles?.length || undefined}
            onClick={(e) => go(e, previewImg + 1)}
          ></s-button>
        </s-grid>

        <s-stack gap="small-300">
          <s-text type="strong">{dot > -1 ? alt.substring(0, dot) : alt}</s-text>
          <s-text color="subdued">
            {formattedDate}
            {dot > -1 ? ` · ${alt.substring(dot + 1).toUpperCase()}` : ""}
          </s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );
};

export default ImgPreview;
