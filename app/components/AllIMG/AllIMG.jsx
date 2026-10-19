import MediaCard from "../MediaCard/MediaCard";

/**
 * AllIMG — an image in the picker. Adapter over the shared MediaCard.
 *
 * This file previously carried ~110 lines of commented-out earlier markup
 * alongside the live copy; that is gone.
 */
const AllIMG = ({
  index,
  item,
  isGridView,
  selectedImgs,
  toggleImgSelection,
  previewImg,
  setPreviewImg,
}) => (
  <MediaCard
    index={index}
    item={item}
    isGridView={isGridView}
    selected={selectedImgs}
    onSelect={toggleImgSelection}
    previewIndex={previewImg}
    onPreview={setPreviewImg}
  />
);

export default AllIMG;
