import MediaPreview from "../MediaPreview/MediaPreview";

/**
 * VideoPreview — video lightbox. Adapter over the shared MediaPreview; the
 * <video>/<iframe> stay raw because Polaris has no player element.
 */
const mp4Source = (node) =>
  node?.mediaContentType === "VIDEO"
    ? node?.sources?.find((s) => s.format === "mp4")
    : null;

const renderMedia = (node, size) => {
  if (!node) return null;

  const isVideo =
    node?.mimeType?.includes("video") === true ||
    node?.mediaContentType === "VIDEO";

  if (!isVideo) {
    return (
      <iframe
        src={node?.embedUrl}
        height={size?.height}
        width={size?.width}
        title="Video preview"
      />
    );
  }

  const source = mp4Source(node);
  const sources = node?.sources;

  return (
    <video key={`video-${node?.id}`} width="100%" height="auto" controls>
      <source
        src={source ? source.url : sources?.url}
        type={source ? source.mimeType : sources?.[sources.length - 1]?.mimeType}
      />
    </video>
  );
};

const VideoPreview = ({ filteredFiles, preview, setPreview }) => (
  <MediaPreview
    filteredFiles={filteredFiles}
    index={preview}
    setIndex={setPreview}
    getName={(node) => node?.filename}
    renderMedia={renderMedia}
  />
);

export default VideoPreview;
