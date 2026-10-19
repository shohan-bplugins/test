import { useEffect, useState } from "react";
import { CustomBox, CustomSpan, CustomButton } from "../../utils/polarisWebComponents";
import "./MediaPreview.css";

/**
 * MediaPreview — the lightbox shell shared by the image and video pickers.
 *
 * VideoPreview and ImgPreview were the same component twice over; they
 * differed only in the media element they render and which field holds the
 * file name. Both are now thin adapters passing `renderMedia` and `getName`.
 *
 * Fixed while converting:
 *
 *   • ImgPreview crashed on a file with no `alt`: one of its two
 *     `.substring()` calls was reached through `.alt.substring(` with no
 *     optional chain, so opening the preview threw. Name parsing is now one
 *     guarded helper.
 *   • the nav and close controls were raw <CustomButton>s carrying
 *     `accessibilityLabel`, which is not a DOM attribute — React dropped it,
 *     so all three buttons were unlabelled. They are s-buttons now.
 *   • `.leftButton` / `.rightButton` were swapped (the previous-button carried
 *     the "rightButton" class).
 *   • the old stylesheet quoted its values (`background: "none"`), so every
 *     declaration in it was invalid and ignored except `opacity`. Only the
 *     hover reveal ever worked, and that is what is kept.
 */
const DATE_OPTIONS = { year: "numeric", month: "long", day: "numeric" };

/** "clip.final.mp4" -> ["clip.final", "MP4"] */
const splitName = (name) => {
  if (!name) return ["Untitled", ""];
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? [name.slice(0, dot), name.slice(dot + 1).toUpperCase()]
    : [name, ""];
};

/** The iframe fallback needs pixel dimensions, so this survives the rewrite. */
const useViewportSize = () => {
  const [size, setSize] = useState({ width: 320, height: 240 });
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth <= 576) setSize({ width: 150, height: 90 });
      else if (window.innerWidth <= 768) setSize({ width: 280, height: 190 });
      else setSize({ width: 320, height: 240 });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
};

const MediaPreview = ({
  filteredFiles = [],
  index,
  setIndex,
  getName,
  renderMedia,
}) => {
  const size = useViewportSize();
  const current = Number(index);
  const node = filteredFiles[current - 1]?.node;
  const [baseName, extension] = splitName(getName?.(node));

  const created = node?.createdAt ? new Date(node.createdAt) : null;
  const formattedDate =
    created && !Number.isNaN(created.valueOf())
      ? created.toLocaleDateString("en-US", DATE_OPTIONS)
      : "";

  const step = (delta) => (event) => {
    event.stopPropagation();
    setIndex(current + delta);
  };

  return (
    <s-box class="media-preview">
      <s-box class="media-preview-header">
        <s-stack
          direction="inline"
          gap="small-200"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-heading>Preview</s-heading>
          <s-button
            icon="x"
            variant="tertiary"
            accessibilityLabel="Close preview"
            onClick={(event) => {
              event.stopPropagation();
              setIndex(0);
            }}
          />
        </s-stack>
      </s-box>

      <s-box class="media-preview-stage">
        <s-stack direction="inline" gap="small-100" alignItems="center">
          <s-box class="media-preview-nav">
            <s-button
              icon="chevron-left"
              variant="tertiary"
              accessibilityLabel="Previous file"
              disabled={current <= 1}
              onClick={step(-1)}
            />
          </s-box>

          <s-box padding="base" background="subdued" borderRadius="base">
            {renderMedia?.(node, size)}
          </s-box>

          <s-box class="media-preview-nav">
            <s-button
              icon="chevron-right"
              variant="tertiary"
              accessibilityLabel="Next file"
              disabled={current >= filteredFiles.length}
              onClick={step(1)}
            />
          </s-box>
        </s-stack>
      </s-box>

      <s-box class="media-preview-meta">
        <s-stack direction="block" gap="small-100">
          <s-heading>{baseName}</s-heading>
          <s-text color="subdued">
            {[formattedDate, extension].filter(Boolean).join(" · ")}
          </s-text>
        </s-stack>
      </s-box>
    </s-box>
  );
};

export default MediaPreview;
