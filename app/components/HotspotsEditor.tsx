import { useEffect, useState } from "react";

import type { ViewerConfig } from "~/components/ViewerPreview";
import {
  MAX_DESCRIPTION,
  MAX_HOTSPOTS,
  MAX_LINK_LABEL,
  MAX_TITLE,
  newHotspotId,
  parseVideoUrl,
  safeHotspotUrl,
  safeImageUrl,
  videoDisplayUrl,
  type Hotspot,
} from "~/lib/hotspots";
import { fieldChecked, fieldValue, flag } from "~/components/polaris/helpers";
import { useAppBridge } from "@shopify/app-bridge-react";
import { MediaPickerModal } from "~/components/MediaPickerModal";

/*
 * The Hotspots panel on the product and library editors. Edits
 * config.hotspots like any other viewer setting — saved with the page's Save —
 * and drives the live preview's placement mode through `placing`.
 *
 * Paid plans only: on Free the panel shows what it does, tagged PRO, with an
 * upgrade link. The save actions enforce the same rule on the server.
 */

type Props = {
  config: ViewerConfig;
  onChange: (updater: (c: ViewerConfig) => ViewerConfig) => void;
  /** Placement mode: the preview's next click on the model places a hotspot. */
  placing: boolean;
  onPlacingChange: (placing: boolean) => void;
  /** Open a hotspot in the preview, as a shopper would see it. */
  onPreview: (id: string) => void;
  locked: boolean;
};

export function HotspotsEditor({
  config,
  onChange,
  placing,
  onPlacingChange,
  onPreview,
  locked,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Which hotspot the Files picker is choosing media for.
  const [picker, setPicker] = useState<{
    id: string;
    type: "image" | "video";
  } | null>(null);
  const hotspots = config.hotspots;

  // A hotspot just placed opens straight into its form, ready to be named.
  const lastId = hotspots[hotspots.length - 1]?.id ?? null;
  const [seenCount, setSeenCount] = useState(hotspots.length);
  useEffect(() => {
    if (hotspots.length > seenCount && lastId) setOpenId(lastId);
    setSeenCount(hotspots.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotspots.length]);
  const full = hotspots.length >= MAX_HOTSPOTS;

  const update = (id: string, patch: Partial<Hotspot>) =>
    onChange((c) => ({
      ...c,
      hotspots: c.hotspots.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    }));
  const remove = (id: string) =>
    onChange((c) => ({
      ...c,
      hotspots: c.hotspots.filter((h) => h.id !== id),
    }));
  const move = (id: string, by: -1 | 1) =>
    onChange((c) => {
      const list = [...c.hotspots];
      const i = list.findIndex((h) => h.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= list.length) return c;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...c, hotspots: list };
    });

  if (locked) {
    return (
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <span className="hs-pro">PRO</span>
          <s-text>Point out details right on the model.</s-text>
        </s-stack>
        <s-paragraph color="subdued">
          Add numbered hotspots — “Water-resistant zipper”, “Real leather
          handle” — that shoppers tap to read a note while the camera turns to
          that spot.
        </s-paragraph>
        <s-button variant="primary" icon="lock" href="/app/pricing">
          Upgrade to add hotspots
        </s-button>
        <style>{HS_CSS}</style>
      </s-stack>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      <style>{HS_CSS}</style>

      {placing ? (
        <s-banner tone="info" heading="Click the model to place the hotspot">
          <s-paragraph>
            Turn the model to the side you want first — the hotspot opens from
            this same angle for shoppers.
          </s-paragraph>
          <s-button
            slot="secondary-actions"
            onClick={() => onPlacingChange(false)}
          >
            Cancel
          </s-button>
        </s-banner>
      ) : (
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-button
            variant="primary"
            icon="plus"
            disabled={flag(full)}
            onClick={() => onPlacingChange(true)}
          >
            Add hotspot
          </s-button>
          <s-text color="subdued">
            {full
              ? `Up to ${MAX_HOTSPOTS} hotspots per model.`
              : `${hotspots.length} of ${MAX_HOTSPOTS}`}
          </s-text>
        </s-stack>
      )}

      {hotspots.length === 0 && !placing ? (
        <s-paragraph color="subdued">
          No hotspots yet. Add one, then click the spot on the model in the
          preview.
        </s-paragraph>
      ) : null}

      <div className="hs-list">
        {hotspots.map((h, i) => {
          const open = openId === h.id;
          const badUrl = !!h.linkUrl && !safeHotspotUrl(h.linkUrl);
          return (
            <div
              key={h.id}
              className="hs-item"
              data-open={open ? "" : undefined}
            >
              <div className="hs-row">
                <span
                  className="hs-num"
                  style={{ background: config.hotspotColor }}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <button
                  type="button"
                  className="hs-title"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : h.id)}
                >
                  {h.title || `Hotspot ${i + 1}`}
                </button>
                <s-button
                  variant="tertiary"
                  icon="view"
                  accessibilityLabel={`Preview hotspot ${i + 1}`}
                  onClick={() => onPreview(h.id)}
                />
                <s-button
                  variant="tertiary"
                  icon="chevron-up"
                  accessibilityLabel="Move up"
                  disabled={flag(i === 0)}
                  onClick={() => move(h.id, -1)}
                />
                <s-button
                  variant="tertiary"
                  icon="chevron-down"
                  accessibilityLabel="Move down"
                  disabled={flag(i === hotspots.length - 1)}
                  onClick={() => move(h.id, 1)}
                />
                <s-button
                  variant="tertiary"
                  tone="critical"
                  icon="delete"
                  accessibilityLabel={`Delete hotspot ${i + 1}`}
                  onClick={() => {
                    remove(h.id);
                    if (open) setOpenId(null);
                  }}
                />
              </div>

              {open ? (
                <div className="hs-form">
                  <s-text-field
                    label="Title"
                    value={h.title}
                    maxLength={MAX_TITLE}
                    onInput={(e) => update(h.id, { title: fieldValue(e) })}
                  />
                  <s-text-area
                    label="Description"
                    rows={3}
                    value={h.description}
                    maxLength={MAX_DESCRIPTION}
                    details={`${h.description.length}/${MAX_DESCRIPTION}`}
                    onInput={(e) =>
                      update(h.id, { description: fieldValue(e) })
                    }
                  />
                  <s-grid
                    gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 160px), 1fr))"
                    gap="small"
                  >
                    <s-text-field
                      label="Link text (optional)"
                      placeholder="Learn more"
                      value={h.linkLabel}
                      maxLength={MAX_LINK_LABEL}
                      onInput={(e) =>
                        update(h.id, { linkLabel: fieldValue(e) })
                      }
                    />
                    <s-url-field
                      label="Link URL (optional)"
                      placeholder="https://… or /pages/…"
                      value={h.linkUrl}
                      error={
                        badUrl
                          ? "Use an https:// address or a path like /pages/size-guide"
                          : undefined
                      }
                      onInput={(e) => update(h.id, { linkUrl: fieldValue(e) })}
                    />
                  </s-grid>
                  <HotspotExtras
                    hotspot={h}
                    update={(patch) => update(h.id, patch)}
                    onChooseMedia={(type) => setPicker({ id: h.id, type })}
                  />
                  <s-button
                    variant="secondary"
                    icon="target"
                    onClick={() => {
                      remove(h.id);
                      setOpenId(null);
                      onPlacingChange(true);
                      // Re-placed as a new hotspot with the same text.
                      pendingReplace = h;
                    }}
                  >
                    Move to a new spot
                  </s-button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <MediaPickerModal
        open={picker !== null}
        type={picker?.type ?? "image"}
        currentUrl={(() => {
          const h = hotspots.find((x) => x.id === picker?.id);
          if (!h || !picker) return "";
          if (picker.type === "image") return h.image?.url ?? "";
          return h.video?.kind === "file" ? h.video.url : "";
        })()}
        onClose={() => setPicker(null)}
        onPick={(item) => {
          if (!picker) return;
          if (picker.type === "image") {
            update(picker.id, { image: { url: item.url, alt: item.alt } });
          } else {
            update(picker.id, {
              video: {
                kind: "file",
                id: "",
                url: item.url,
                ...(item.poster ? { poster: item.poster } : {}),
              },
            });
          }
        }}
      />

      <s-divider />

      <s-switch
        label="Show hotspots on the storefront"
        checked={flag(config.showHotspots)}
        onInput={(e) =>
          onChange((c) => ({ ...c, showHotspots: fieldChecked(e) }))
        }
      />
      <s-color-field
        label="Hotspot color"
        value={config.hotspotColor}
        onChange={(e) => {
          const v = fieldValue(e);
          if (/^#[0-9a-f]{6}$/i.test(v)) {
            onChange((c) => ({ ...c, hotspotColor: v }));
          }
        }}
      />
      <s-select
        label="Pin shows"
        value={config.hotspotLabel}
        onInput={(e) =>
          onChange((c) => ({
            ...c,
            hotspotLabel: fieldValue(e) === "title" ? "title" : "number",
          }))
        }
      >
        <s-option value="number">Number</s-option>
        <s-option value="title">Title</s-option>
      </s-select>
      <s-select
        label="Open hotspot on"
        details="On touch screens hotspots always open with a tap."
        value={config.hotspotTrigger}
        onInput={(e) =>
          onChange((c) => ({
            ...c,
            hotspotTrigger: fieldValue(e) === "hover" ? "hover" : "click",
          }))
        }
      >
        <s-option value="click">Click</s-option>
        <s-option value="hover">Hover</s-option>
      </s-select>
      <s-text color="subdued">
        Hotspots don’t appear in AR — iPhone and Android AR viewers don’t
        support them.
      </s-text>
    </s-stack>
  );
}

/**
 * The card's optional content beyond text: an image, a video, and a product
 * with Add to cart / Buy now. Each is its own small block that can be added
 * and removed independently.
 */
function HotspotExtras({
  hotspot: h,
  update,
  onChooseMedia,
}: {
  hotspot: Hotspot;
  update: (patch: Partial<Hotspot>) => void;
  onChooseMedia: (type: "image" | "video") => void;
}) {
  const shopify = useAppBridge();
  // Pasted links are drafts until they parse — so typing half a URL does not
  // wipe the saved one or flash an error mid-word.
  const [imageDraft, setImageDraft] = useState(h.image?.url ?? "");
  const [videoDraft, setVideoDraft] = useState(videoDisplayUrl(h.video));
  useEffect(() => setImageDraft(h.image?.url ?? ""), [h.image?.url]);
  useEffect(() => setVideoDraft(videoDisplayUrl(h.video)), [h.video]);

  // Whether the Image / Video options are showing while nothing is set yet.
  const [imageOpen, setImageOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);

  const imageBad = !!imageDraft && !safeImageUrl(imageDraft);
  const videoBad = !!videoDraft && !parseVideoUrl(videoDraft);

  async function chooseProduct() {
    try {
      const picked: any = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: false,
      });
      const p = picked?.[0];
      if (!p) return;
      const variant = p.variants?.[0];
      const numeric = (gid: string) =>
        String(gid ?? "")
          .split("/")
          .pop() ?? "";
      if (!variant || !p.handle) {
        shopify.toast.show("That product has no variant to sell.", {
          isError: true,
        });
        return;
      }
      update({
        product: {
          id: numeric(p.id),
          variantId: numeric(variant.id),
          handle: p.handle,
          title: p.title ?? p.handle,
          imageUrl: p.images?.[0]?.originalSrc ?? p.images?.[0]?.url ?? "",
          price: String(variant.price ?? ""),
          addToCart: h.product?.addToCart ?? true,
          buyNow: h.product?.buyNow ?? false,
        },
      });
    } catch {
      // Picker dismissed.
    }
  }

  return (
    <div className="hs-extras">
      {/*
        Image and Video start as a single "Add" button each; their options
        (choose / upload, paste a link, alt text) open only when wanted, or
        straight away when the hotspot already has one.
      */}
      {/* Image */}
      <div className="hs-block">
        <div className="hs-block-head">
          <s-text type="strong">Image</s-text>
          {h.image ? (
            <s-button
              variant="tertiary"
              tone="critical"
              onClick={() => {
                update({ image: null });
                setImageOpen(false);
              }}
            >
              Remove
            </s-button>
          ) : imageOpen ? (
            <s-button variant="tertiary" onClick={() => setImageOpen(false)}>
              Cancel
            </s-button>
          ) : null}
        </div>
        {!h.image && !imageOpen ? (
          <s-button icon="image" onClick={() => setImageOpen(true)}>
            Add image
          </s-button>
        ) : (
          <>
            {h.image ? (
              <img className="hs-thumb" src={h.image.url} alt="" />
            ) : null}
            <s-stack direction="inline" gap="small">
              <s-button icon="image" onClick={() => onChooseMedia("image")}>
                {h.image ? "Change image" : "Choose or upload"}
              </s-button>
            </s-stack>
            <s-url-field
              label="Or paste an image link"
              placeholder="https://…"
              value={imageDraft}
              error={imageBad ? "Use an https:// image link" : undefined}
              onInput={(e) => {
                const v = fieldValue(e);
                setImageDraft(v);
                const url = safeImageUrl(v);
                if (url) update({ image: { url, alt: h.image?.alt ?? "" } });
                else if (!v) update({ image: null });
              }}
            />
            {h.image ? (
              <s-text-field
                label="Image description (alt text)"
                value={h.image.alt}
                maxLength={200}
                onInput={(e) =>
                  update({ image: { url: h.image!.url, alt: fieldValue(e) } })
                }
              />
            ) : null}
          </>
        )}
      </div>

      {/* Video */}
      <div className="hs-block">
        <div className="hs-block-head">
          <s-text type="strong">Video</s-text>
          {h.video ? (
            <s-button
              variant="tertiary"
              tone="critical"
              onClick={() => {
                update({ video: null });
                setVideoOpen(false);
              }}
            >
              Remove
            </s-button>
          ) : videoOpen ? (
            <s-button variant="tertiary" onClick={() => setVideoOpen(false)}>
              Cancel
            </s-button>
          ) : null}
        </div>
        {!h.video && !videoOpen ? (
          <s-button icon="play" onClick={() => setVideoOpen(true)}>
            Add video
          </s-button>
        ) : (
          <>
            <s-url-field
              label="YouTube, Vimeo or video file link"
              placeholder="https://youtube.com/watch?v=…"
              value={videoDraft}
              error={
                videoBad
                  ? "Paste a YouTube or Vimeo link, or an https link to an .mp4 file"
                  : undefined
              }
              onInput={(e) => {
                const v = fieldValue(e);
                setVideoDraft(v);
                const parsed = parseVideoUrl(v);
                if (parsed) update({ video: parsed });
                else if (!v) update({ video: null });
              }}
            />
            <s-stack direction="inline" gap="small">
              <s-button icon="play" onClick={() => onChooseMedia("video")}>
                {h.video?.kind === "file" ? "Change video" : "Choose or upload"}
              </s-button>
            </s-stack>
            <s-text color="subdued">
              Shoppers see a thumbnail; the video loads only when they press
              play.
            </s-text>
          </>
        )}
      </div>

      {/* Product */}
      <div className="hs-block">
        <div className="hs-block-head">
          <s-text type="strong">Product</s-text>
          {h.product ? (
            <s-button
              variant="tertiary"
              tone="critical"
              onClick={() => update({ product: null })}
            >
              Remove
            </s-button>
          ) : null}
        </div>
        {h.product ? (
          <>
            <div className="hs-product">
              {h.product.imageUrl ? (
                <img src={h.product.imageUrl} alt="" />
              ) : (
                <span className="hs-product-noimg" />
              )}
              <div>
                <div className="hs-product-title">{h.product.title}</div>
                {h.product.price ? (
                  <div className="hs-product-price">{h.product.price}</div>
                ) : null}
              </div>
            </div>
            <s-checkbox
              label="Show “Add to cart” button"
              checked={flag(h.product.addToCart)}
              onInput={(e) =>
                update({
                  product: { ...h.product!, addToCart: fieldChecked(e) },
                })
              }
            />
            <s-checkbox
              label="Show “Buy now” button (straight to checkout)"
              checked={flag(h.product.buyNow)}
              onInput={(e) =>
                update({ product: { ...h.product!, buyNow: fieldChecked(e) } })
              }
            />
            <s-button onClick={chooseProduct}>Change product</s-button>
            <s-text color="subdued">
              Price and stock are read live from your store when a shopper opens
              the hotspot.
            </s-text>
          </>
        ) : (
          <s-button icon="product" onClick={chooseProduct}>
            Select product
          </s-button>
        )}
      </div>
    </div>
  );
}

/*
 * "Move to a new spot" removes the hotspot and enters placement mode; the next
 * placement takes its text from here instead of starting blank. Module-level
 * because the placement arrives through the page (createHotspot below), not
 * through this component.
 */
let pendingReplace: Hotspot | null = null;

/** Builds the hotspot a placement click creates. */
export function createHotspot(
  anchor: Pick<
    Hotspot,
    "meshIndex" | "faceIndex" | "weights" | "position" | "focus"
  >,
  index: number,
): Hotspot {
  const from = pendingReplace;
  pendingReplace = null;
  return {
    id: newHotspotId(),
    title: from?.title ?? `Hotspot ${index + 1}`,
    description: from?.description ?? "",
    linkLabel: from?.linkLabel ?? "",
    linkUrl: from?.linkUrl ?? "",
    image: from?.image ?? null,
    video: from?.video ?? null,
    product: from?.product ?? null,
    ...anchor,
  };
}

const HS_CSS = `
.hs-pro {
  display: inline-flex; align-items: center; height: 20px; padding: 0 8px;
  border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  color: #fff; background: linear-gradient(135deg, #7c3aed, #2a78d6);
}
.hs-list { display: flex; flex-direction: column; gap: 8px; }
.hs-item { border: 1px solid #e3e3e3; border-radius: 10px; }
.hs-item[data-open] { border-color: #b5b5b5; }
.hs-row { display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 10px; }
.hs-num {
  flex: none; width: 22px; height: 22px; border-radius: 50%; color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
}
.hs-title {
  flex: 1; min-width: 0; text-align: left; font: inherit; color: inherit;
  background: none; border: 0; padding: 4px 6px; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hs-form { display: flex; flex-direction: column; gap: 12px; padding: 4px 12px 12px; }
.hs-extras { display: flex; flex-direction: column; gap: 10px; }
.hs-block {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px; border: 1px dashed #d4d4d4; border-radius: 8px;
}
.hs-block-head { display: flex; align-items: center; justify-content: space-between; min-height: 28px; }
.hs-thumb { width: 100%; max-height: 140px; object-fit: cover; border-radius: 6px; }
.hs-product { display: flex; gap: 10px; align-items: center; }
.hs-product img, .hs-product-noimg {
  width: 44px; height: 44px; object-fit: cover; border-radius: 6px; background: #f1f1f1; flex: none;
}
.hs-product-title { font-weight: 600; }
.hs-product-price { color: #616161; font-size: 12px; }
@media (prefers-color-scheme: dark) {
  .hs-item { border-color: #3a3a3a; }
}
`;
