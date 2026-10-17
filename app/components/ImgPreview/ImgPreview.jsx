import MediaPreview from "../MediaPreview/MediaPreview";

/**
 * ImgPreview — image lightbox. Adapter over the shared MediaPreview.
 */
const renderMedia = (node) => {
  if (!node) return null;
  const src =
    node?.mediaContentType === "IMAGE"
      ? node?.preview?.image?.src || node?.preview?.image?.url
      : node?.url;

  return (
    <img
      key={`img-${node?.id}`}
      src={src}
      alt={node?.alt || "Preview"}
      width="100%"
      height="100%"
    />
  );
};

const ImgPreview = ({ filteredFiles, previewImg, setPreviewImg }) => (
  <MediaPreview
    filteredFiles={filteredFiles}
    index={previewImg}
    setIndex={setPreviewImg}
    getName={(node) => node?.alt}
    renderMedia={renderMedia}
  />
);

export default ImgPreview;
