import MediaCard from "../MediaCard/MediaCard";

/**
 * AllVideos — a video in the picker. Adapter over the shared MediaCard;
 * see that file for what changed.
 */
const AllVideos = ({
  index,
  item,
  isGridView,
  selectedFiles,
  toggleFileSelection,
  preview,
  setPreview,
}) => (
  <MediaCard
    index={index}
    item={item}
    isGridView={isGridView}
    selected={selectedFiles}
    onSelect={toggleFileSelection}
    previewIndex={preview}
    onPreview={setPreview}
  />
);

export default AllVideos;
