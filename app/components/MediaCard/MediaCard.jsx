import "./MediaCard.css";
import { CustomBox, CustomSpan, CustomButton } from "../../utils/polarisWebComponents";

/**
 * MediaCard — one file in a media picker, in grid or list layout.
 *
 * AllVideos and AllIMG were byte-for-byte near-duplicates (their stylesheets
 * differed by a single grey), so both now adapt onto this. They stay as thin
 * wrappers because their prop names differ (selectedFiles/selectedImgs,
 * preview/previewImg), which keeps every call site untouched.
 *
 * Fixed while converting:
 *
 *   • the title read `alt?.slice(0, 15) + "..." || "NaN"`, which parses as
 *     `(alt.slice(…) + "...") || "NaN"`. With no alt that is the string
 *     "undefined...", which is truthy — so the fallback never ran and the card
 *     showed "undefined...". Truncation is now CSS, so full names survive in
 *     the tooltip and for screen readers.
 *   • the whole card was a <CustomBox onClick> with a <Button> nested inside it —
 *     one tab stop, no keyboard access to select, and a nested control. It is
 *     now an s-clickable for select plus a separate s-button for preview.
 *
 * The old `.fileCardItem .Polaris-Thumbnail { background: #000 }` is gone:
 * s-thumbnail renders into shadow DOM and cannot be reached from here.
 *
 * Note s-thumbnail takes `src`, NOT Polaris React's `source` — the wrong name
 * renders an empty placeholder silently.
 */
const MediaCard = ({
  index,
  item,
  isGridView,
  selected,
  onSelect,
  previewIndex,
  onPreview,
}) => {
  const node = item?.node;
  const i = Number(index);

  const isGrid = isGridView === "grid_view";
  const isSelected = node?.id && node?.id === selected?.id;
  const isPreviewing = Number(previewIndex) - 1 === i;

  const src = node?.type?.startsWith("image")
    ? node?.url
    : node?.preview?.image?.url || node?.preview?.image?.src;
  const isReady = Boolean(
    node?.preview?.image?.url || node?.preview?.image?.src || node?.url,
  );
  const name = node?.alt || node?.name || "Untitled";

  const classes = [
    "media-card",
    isGrid ? "is-grid" : "is-list",
    isSelected ? "is-selected" : "",
    isPreviewing ? "is-previewing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <s-box class={classes}>
      <s-clickable
        onClick={() => onSelect?.(node)}
        accessibilityLabel={`Select ${name}`}
      >
        <s-stack
          direction={isGrid ? "block" : "inline"}
          gap="small-200"
          alignItems="center"
        >
          {isReady ? (
            <s-thumbnail src={src} alt={name} size="large" />
          ) : (
            <s-stack direction="block" gap="small-100" alignItems="center">
              <s-spinner accessibilityLabel="Processing" size="large" />
              <s-text color="subdued">Processing</s-text>
            </s-stack>
          )}
          <s-text class="media-card-name">{name}</s-text>
        </s-stack>
      </s-clickable>

      <s-box class="media-card-preview">
        <s-button
          icon="view"
          variant="secondary"
          accessibilityLabel={`Preview ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onPreview?.(i + 1);
          }}
        />
      </s-box>
    </s-box>
  );
};

export default MediaCard;
