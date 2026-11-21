import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { ViewerConfig } from "~/components/ViewerPreview";
import {
  hotspotBlockOrder,
  type HotspotBlock,
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
  type HotspotText,
} from "~/lib/hotspots";
import type { ShopLocale } from "~/lib/shop-locales";
import { STOREFRONT_LOCALES } from "~/lib/storefront-strings";
import { useLocale } from "~/i18n";
import { fieldChecked, fieldValue, flag } from "~/components/polaris/helpers";
import { useAppBridge } from "@shopify/app-bridge-react";
import { MediaPickerModal } from "~/components/MediaPickerModal";
import { useT } from "~/i18n";

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
  /**
   * The shop's published languages, primary first (fetchShopLocales). With
   * more than one, the panel offers a language switcher for the hotspot text.
   */
  shopLocales?: ShopLocale[];
  /** The language being edited; null for the primary (the base text). */
  editLocale?: string | null;
  onEditLocaleChange?: (locale: string | null) => void;
};

export function HotspotsEditor({
  config,
  onChange,
  placing,
  onPlacingChange,
  onPreview,
  locked,
  shopLocales = [],
  editLocale = null,
  onEditLocaleChange,
}: Props) {
  const t = useT("hotspots");
  const tc = useT("common");
  const [openId, setOpenId] = useState<string | null>(null);
  // Dragging a hotspot to a new place in the list: which one, and the order
  // as it stands mid-drag (rows, and their numbers, move as the pointer
  // passes over them; saved on drop).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draftIds, setDraftIds] = useState<string[] | null>(null);
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

  // Translating: the text fields edit the selected language's translation,
  // with the base (primary-language) text as each one's placeholder. An empty
  // field falls back to the base text on the storefront.
  //
  // Offered: the shop's published languages, then every other language the
  // storefront viewer is translated into — marked as not published yet, so a
  // merchant can prepare translations before switching a language on. Names
  // in the admin's language, with a flag where there is an obvious one.
  const adminLocale = useLocale();
  const languages = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([adminLocale], { type: "language" });
    } catch {
      // Older browsers: Shopify's own name, else the code.
    }
    const flagOf = (code: string) =>
      STOREFRONT_LOCALES.find((l) => l.code.toLowerCase() === code.toLowerCase())?.flag;
    const label = (code: string, fallback: string) => {
      const name = names?.of(code) ?? fallback;
      const flag = flagOf(code);
      return flag ? `${flag} ${name}` : name;
    };
    const published = shopLocales.map((l) => ({
      locale: l.locale,
      name: label(l.locale, l.name),
      primary: l.primary,
      published: true,
    }));
    const has = (code: string) =>
      published.some((l) => l.locale.toLowerCase() === code.toLowerCase());
    if (!published.some((l) => l.primary)) {
      // Locales unreadable (scope not granted yet): assume English primary.
      published.unshift({ locale: "en", name: label("en", "English"), primary: true, published: true });
    }
    const more = STOREFRONT_LOCALES.filter((l) => !has(l.code) && l.code !== "en").map((l) => ({
      locale: l.code,
      name: label(l.code, l.name),
      primary: false,
      published: false,
    }));
    return [...published, ...more];
  }, [shopLocales, adminLocale]);
  const primaryLocale = languages.find((l) => l.primary) ?? languages[0];
  const otherLocales = languages.filter((l) => l !== primaryLocale);
  const editing = editLocale
    ? languages.find((l) => l.locale === editLocale) ?? null
    : null;
  const translationOf = (h: Hotspot): HotspotText =>
    (editing && h.translations?.[editing.locale]) || {};
  const updateText = (
    id: string,
    field: "title" | "description" | "linkLabel",
    value: string,
  ) => {
    if (!editing) return update(id, { [field]: value });
    const locale = editing.locale;
    onChange((c) => ({
      ...c,
      hotspots: c.hotspots.map((h) => {
        if (h.id !== id) return h;
        const text: HotspotText = { ...h.translations?.[locale] };
        if (value) text[field] = value;
        else delete text[field];
        const translations = { ...h.translations };
        if (Object.keys(text).length) translations[locale] = text;
        else delete translations[locale];
        const { translations: _old, ...rest } = h;
        return Object.keys(translations).length
          ? { ...rest, translations }
          : rest;
      }),
    }));
  };
  const remove = (id: string) =>
    onChange((c) => ({
      ...c,
      hotspots: c.hotspots.filter((h) => h.id !== id),
    }));
  const endItemDrag = () => {
    setDraggingId(null);
    setDraftIds(null);
  };
  const reorder = (ids: string[]) =>
    onChange((c) => {
      const byId = new Map(c.hotspots.map((h) => [h.id, h]));
      const list = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      // Anything not in the drag's snapshot keeps its place at the end.
      const rest = c.hotspots.filter((h) => !ids.includes(h.id));
      return { ...c, hotspots: [...list, ...rest] };
    });
  const shownHotspots = draftIds
    ? draftIds.flatMap((id) => hotspots.filter((h) => h.id === id))
    : hotspots;
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
          <s-text>{t("lockedHeading")}</s-text>
        </s-stack>
        <s-paragraph color="subdued">{t("lockedBody")}</s-paragraph>
        <s-button variant="primary" icon="lock" href="/app/pricing">
          {t("lockedUpgrade")}
        </s-button>
        <style>{HS_CSS}</style>
      </s-stack>
    );
  }

  return (
    <s-stack direction="block" gap="base">
      <style>{HS_CSS}</style>

      {placing ? (
        <s-banner tone="info" heading={t("placingHeading")}>
          <s-paragraph>{t("placingBody")}</s-paragraph>
          <s-button
            slot="secondary-actions"
            onClick={() => onPlacingChange(false)}
          >
            {tc("cancel")}
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
            {t("addHotspot")}
          </s-button>
          <s-text color="subdued">
            {full
              ? t("limitReached", { max: MAX_HOTSPOTS })
              : t("countOfMax", { current: hotspots.length, max: MAX_HOTSPOTS })}
          </s-text>
        </s-stack>
      )}

      {primaryLocale && otherLocales.length > 0 && hotspots.length > 0 ? (
        <s-stack direction="block" gap="small-200">
          <s-select
            label={t("language")}
            value={editing?.locale ?? ""}
            onInput={(e) => onEditLocaleChange?.(fieldValue(e) || null)}
          >
            <s-option value="">
              {t("languageDefault", { language: primaryLocale.name })}
            </s-option>
            {otherLocales.map((l) => (
              <s-option key={l.locale} value={l.locale}>
                {l.published
                  ? l.name
                  : t("languageNotPublished", { language: l.name })}
              </s-option>
            ))}
          </s-select>
          {editing ? (
            <s-text color="subdued">
              {t("translatingHelp", {
                language: editing.name,
                primary: primaryLocale.name,
              })}
            </s-text>
          ) : null}
          {editing && !editing.published ? (
            <s-banner tone="info">
              {t("languageNotPublishedHelp", { language: editing.name })}
            </s-banner>
          ) : null}
        </s-stack>
      ) : null}

      {hotspots.length === 0 && !placing ? (
        <s-paragraph color="subdued">{t("empty")}</s-paragraph>
      ) : null}

      <div className="hs-list">
        {shownHotspots.map((h, i) => {
          const open = openId === h.id;
          const badUrl = !!h.linkUrl && !safeHotspotUrl(h.linkUrl);
          return (
            <div
              key={h.id}
              className="hs-item"
              data-open={open ? "" : undefined}
              data-dragging={draggingId === h.id ? "" : undefined}
              onDragOver={(e) => {
                // Only a hotspot being dragged; a content block being dragged
                // inside an open hotspot is that block's business.
                if (!draggingId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (draggingId === h.id) return;
                setDraftIds((ids) => {
                  const base = ids ?? hotspots.map((x) => x.id);
                  const next = base.filter((x) => x !== draggingId);
                  next.splice(i, 0, draggingId);
                  return next;
                });
              }}
              onDrop={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                if (draftIds) reorder(draftIds);
                endItemDrag();
              }}
            >
              <div className="hs-row">
                <span
                  className="hs-drag"
                  draggable
                  aria-hidden="true"
                  title={t("dragToReorder")}
                  onDragStart={(e) => {
                    const item = (e.currentTarget as HTMLElement).closest(
                      ".hs-item",
                    );
                    if (item) e.dataTransfer.setDragImage(item, 20, 18);
                    e.dataTransfer.effectAllowed = "move";
                    // Firefox starts no drag without data.
                    e.dataTransfer.setData("text/plain", h.id);
                    setDraggingId(h.id);
                    setDraftIds(hotspots.map((x) => x.id));
                  }}
                  onDragEnd={endItemDrag}
                >
                  ⠿
                </span>
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
                  <span className="hs-title-text">
                    {translationOf(h).title || h.title || `Hotspot ${i + 1}`}
                  </span>
                  {/*
                    Under the title rather than beside it: the row already
                    holds four icon buttons in a narrow column, and a badge
                    there squeezed the title down to its first letter.
                  */}
                  {editing && !translationOf(h).title ? (
                    <span className="hs-untranslated">{t("untranslated")}</span>
                  ) : null}
                </button>
                <s-button
                  variant="tertiary"
                  icon="view"
                  accessibilityLabel={t("previewHotspot", { number: i + 1 })}
                  onClick={() => onPreview(h.id)}
                />
                <s-button
                  variant="tertiary"
                  icon="chevron-up"
                  accessibilityLabel={t("moveUp")}
                  disabled={flag(i === 0)}
                  onClick={() => move(h.id, -1)}
                />
                <s-button
                  variant="tertiary"
                  icon="chevron-down"
                  accessibilityLabel={t("moveDown")}
                  disabled={flag(i === hotspots.length - 1)}
                  onClick={() => move(h.id, 1)}
                />
                <s-button
                  variant="tertiary"
                  tone="critical"
                  icon="delete"
                  accessibilityLabel={t("deleteHotspot", { number: i + 1 })}
                  onClick={() => {
                    remove(h.id);
                    if (open) setOpenId(null);
                  }}
                />
              </div>

              {open ? (
                <div className="hs-form">
                  {/* Always the top of the card, so not among the blocks. */}
                  <s-text-field
                    label={
                      editing
                        ? t("titleIn", { language: editing.name })
                        : t("title")
                    }
                    value={editing ? translationOf(h).title ?? "" : h.title}
                    placeholder={editing ? h.title : undefined}
                    maxLength={MAX_TITLE}
                    onInput={(e) => updateText(h.id, "title", fieldValue(e))}
                  />
                  <HotspotExtras
                    hotspot={h}
                    update={(patch) => update(h.id, patch)}
                    onChooseMedia={(type) => setPicker({ id: h.id, type })}
                    text={
                      <>
                        <s-text-area
                          label={
                            editing
                              ? t("descriptionIn", { language: editing.name })
                              : t("description")
                          }
                          rows={3}
                          value={
                            editing
                              ? translationOf(h).description ?? ""
                              : h.description
                          }
                          placeholder={editing ? h.description : undefined}
                          maxLength={MAX_DESCRIPTION}
                          details={`${(editing ? translationOf(h).description ?? "" : h.description).length}/${MAX_DESCRIPTION}`}
                          onInput={(e) =>
                            updateText(h.id, "description", fieldValue(e))
                          }
                        />
                        <s-grid
                          gridTemplateColumns="repeat(auto-fit, minmax(min(100%, 160px), 1fr))"
                          gap="small"
                        >
                          <s-text-field
                            label={
                              editing
                                ? t("linkTextIn", { language: editing.name })
                                : t("linkTextOptional")
                            }
                            placeholder={
                              editing
                                ? h.linkLabel || t("linkTextPlaceholder")
                                : t("linkTextPlaceholder")
                            }
                            value={
                              editing
                                ? translationOf(h).linkLabel ?? ""
                                : h.linkLabel
                            }
                            maxLength={MAX_LINK_LABEL}
                            onInput={(e) =>
                              updateText(h.id, "linkLabel", fieldValue(e))
                            }
                          />
                          <s-url-field
                            label={t("linkUrlOptional")}
                            placeholder={t("linkUrlPlaceholder")}
                            value={h.linkUrl}
                            error={
                              badUrl
                                ? t("linkUrlInvalid")
                                : undefined
                            }
                            onInput={(e) =>
                              update(h.id, { linkUrl: fieldValue(e) })
                            }
                          />
                        </s-grid>
                      </>
                    }
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
                    {t("moveToNewSpot")}
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
        label={t("showOnStorefront")}
        checked={flag(config.showHotspots)}
        onInput={(e) =>
          onChange((c) => ({ ...c, showHotspots: fieldChecked(e) }))
        }
      />
      <s-color-field
        label={t("color")}
        value={config.hotspotColor}
        onChange={(e) => {
          const v = fieldValue(e);
          if (/^#[0-9a-f]{6}$/i.test(v)) {
            onChange((c) => ({ ...c, hotspotColor: v }));
          }
        }}
      />
      <s-select
        label={t("pinShows")}
        value={config.hotspotLabel}
        onInput={(e) =>
          onChange((c) => ({
            ...c,
            hotspotLabel: fieldValue(e) === "title" ? "title" : "number",
          }))
        }
      >
        <s-option value="number">{t("pinShowsNumber")}</s-option>
        <s-option value="title">{t("pinShowsTitle")}</s-option>
      </s-select>
      <s-select
        label={t("openOn")}
        details={t("openOnDetails")}
        value={config.hotspotTrigger}
        onInput={(e) =>
          onChange((c) => ({
            ...c,
            hotspotTrigger: fieldValue(e) === "hover" ? "hover" : "click",
          }))
        }
      >
        <s-option value="click">{t("openOnClick")}</s-option>
        <s-option value="hover">{t("openOnHover")}</s-option>
      </s-select>
      <s-text color="subdued">{t("notInAr")}</s-text>
    </s-stack>
  );
}

/**
 * The card's content below its title (which always leads): one block each
 * for the text (description and link), an image, a video, and a product with
 * Add to cart / Buy now. The blocks are
 * listed in the order the shopper's card shows them, and that order is
 * changed right here — drag a block by its header, or use its arrows
 * (keyboard and touch, where drag and drop does not work). Image, video and
 * product can each be added and removed independently.
 */
function HotspotExtras({
  hotspot: h,
  update,
  onChooseMedia,
  text,
}: {
  hotspot: Hotspot;
  update: (patch: Partial<Hotspot>) => void;
  onChooseMedia: (type: "image" | "video") => void;
  /** The text block's fields (description and link), built by the list above. */
  text: ReactNode;
}) {
  const shopify = useAppBridge();
  const t = useT("hotspots");
  const tc = useT("common");
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

  // The blocks' order, and a draft of it while a drag is under way so the
  // blocks move as the pointer passes over them.
  const saved = hotspotBlockOrder(h);
  const [dragging, setDragging] = useState<HotspotBlock | null>(null);
  const [draft, setDraft] = useState<HotspotBlock[] | null>(null);
  const order = draft ?? saved;
  const moveTo = (from: HotspotBlock[], b: HotspotBlock, to: number) => {
    const next = from.filter((x) => x !== b);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, b);
    return next;
  };
  const endDrag = () => {
    setDragging(null);
    setDraft(null);
  };

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
        shopify.toast.show(t("productNoVariant"), {
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

  /*
   * Each block: its header actions and its body. Image and Video start as a
   * single "Add" button each; their options (choose / upload, paste a link,
   * alt text) open only when wanted, or straight away when the hotspot
   * already has one.
   */
  const blocks: Record<HotspotBlock, { actions: ReactNode; body: ReactNode }> =
    {
      text: { actions: null, body: text },
      image: {
        actions: h.image ? (
          <s-button
            variant="tertiary"
            tone="critical"
            onClick={() => {
              update({ image: null });
              setImageOpen(false);
            }}
          >
            {tc("remove")}
          </s-button>
        ) : imageOpen ? (
          <s-button variant="tertiary" onClick={() => setImageOpen(false)}>
            {tc("cancel")}
          </s-button>
        ) : null,
        body:
          !h.image && !imageOpen ? (
            <s-button icon="image" onClick={() => setImageOpen(true)}>
              {t("addImage")}
            </s-button>
          ) : (
            <>
              {h.image ? (
                <img className="hs-thumb" src={h.image.url} alt="" />
              ) : null}
              <s-stack direction="inline" gap="small">
                <s-button icon="image" onClick={() => onChooseMedia("image")}>
                  {h.image ? t("changeImage") : t("chooseOrUpload")}
                </s-button>
              </s-stack>
              <s-url-field
                label={t("imageLink")}
                placeholder="https://…"
                value={imageDraft}
                error={imageBad ? t("imageLinkInvalid") : undefined}
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
                  label={t("imageAlt")}
                  value={h.image.alt}
                  maxLength={200}
                  onInput={(e) =>
                    update({ image: { url: h.image!.url, alt: fieldValue(e) } })
                  }
                />
              ) : null}
            </>
          ),
      },
      video: {
        actions: h.video ? (
          <s-button
            variant="tertiary"
            tone="critical"
            onClick={() => {
              update({ video: null });
              setVideoOpen(false);
            }}
          >
            {tc("remove")}
          </s-button>
        ) : videoOpen ? (
          <s-button variant="tertiary" onClick={() => setVideoOpen(false)}>
            {tc("cancel")}
          </s-button>
        ) : null,
        body:
          !h.video && !videoOpen ? (
            <s-button icon="play" onClick={() => setVideoOpen(true)}>
              {t("addVideo")}
            </s-button>
          ) : (
            <>
              <s-url-field
                label={t("videoLink")}
                placeholder="https://youtube.com/watch?v=…"
                value={videoDraft}
                error={
                  videoBad
                    ? t("videoLinkInvalid")
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
                  {h.video?.kind === "file"
                    ? t("changeVideo")
                    : t("chooseOrUpload")}
                </s-button>
              </s-stack>
              <s-text color="subdued">{t("videoHelp")}</s-text>
            </>
          ),
      },
      product: {
        actions: h.product ? (
          <s-button
            variant="tertiary"
            tone="critical"
            onClick={() => update({ product: null })}
          >
            {tc("remove")}
          </s-button>
        ) : null,
        body: h.product ? (
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
              label={t("showAddToCart")}
              checked={flag(h.product.addToCart)}
              onInput={(e) =>
                update({
                  product: { ...h.product!, addToCart: fieldChecked(e) },
                })
              }
            />
            <s-checkbox
              label={t("showBuyNow")}
              checked={flag(h.product.buyNow)}
              onInput={(e) =>
                update({ product: { ...h.product!, buyNow: fieldChecked(e) } })
              }
            />
            <s-button onClick={chooseProduct}>{t("changeProduct")}</s-button>
            <s-text color="subdued">{t("productHelp")}</s-text>
          </>
        ) : (
          <s-button icon="product" onClick={chooseProduct}>
            {t("selectProduct")}
          </s-button>
        ),
      },
    };

  return (
    <div className="hs-extras">
      <s-text color="subdued">{t("blocksHelp")}</s-text>
      {order.map((b, i) => (
        <div
          key={b}
          className="hs-block"
          data-block={b}
          data-dragging={dragging === b ? "" : undefined}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragging !== b)
              setDraft((d) => moveTo(d ?? saved, dragging, i));
          }}
          onDrop={(e) => {
            if (!dragging) return;
            e.preventDefault();
            if (draft) update({ order: draft });
            endDrag();
          }}
        >
          <div className="hs-block-head">
            <div className="hs-block-title">
              {/*
                Only the handle starts a drag — a draggable block would stop
                text being selected in its fields. The whole block is what
                follows the pointer.
              */}
              <span
                className="hs-drag"
                draggable
                aria-hidden="true"
                title={t("dragToReorder")}
                onDragStart={(e) => {
                  const box = (e.currentTarget as HTMLElement).closest(
                    ".hs-block",
                  );
                  if (box) e.dataTransfer.setDragImage(box, 20, 20);
                  e.dataTransfer.effectAllowed = "move";
                  // Firefox starts no drag without data.
                  e.dataTransfer.setData("text/plain", b);
                  setDragging(b);
                  setDraft(saved);
                }}
                onDragEnd={endDrag}
              >
                ⠿
              </span>
              <s-text type="strong">{t(BLOCK_NAMES[b])}</s-text>
            </div>
            <div className="hs-block-actions">
              {blocks[b].actions}
              <s-button
                variant="tertiary"
                icon="chevron-up"
                accessibilityLabel={t("moveBlockUp", { block: t(BLOCK_NAMES[b]) })}
                disabled={flag(i === 0)}
                onClick={() => update({ order: moveTo(saved, b, i - 1) })}
              />
              <s-button
                variant="tertiary"
                icon="chevron-down"
                accessibilityLabel={t("moveBlockDown", { block: t(BLOCK_NAMES[b]) })}
                disabled={flag(i === order.length - 1)}
                onClick={() => update({ order: moveTo(saved, b, i + 1) })}
              />
            </div>
          </div>
          {blocks[b].body}
        </div>
      ))}
    </div>
  );
}

// Message keys (namespace "hotspots"), translated at render.
const BLOCK_NAMES: Record<HotspotBlock, string> = {
  image: "blockImage",
  video: "blockVideo",
  text: "blockDescription",
  product: "blockProduct",
};

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
    ...(from?.order ? { order: from.order } : {}),
    ...(from?.translations ? { translations: from.translations } : {}),
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
.hs-item[data-dragging] { opacity: 0.45; border-color: #2a78d6; }
.hs-row { display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 6px; }
.hs-num {
  flex: none; width: 22px; height: 22px; border-radius: 50%; color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
}
.hs-title {
  flex: 1; min-width: 0; text-align: start; font: inherit; color: inherit;
  background: none; border: 0; padding: 4px 6px; cursor: pointer;
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
}
.hs-title-text {
  max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hs-untranslated {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  font-size: 11px; line-height: 14px; color: #8a6116;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hs-untranslated::before {
  content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: #e8a33d;
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
.hs-block[data-dragging] { opacity: 0.45; border-color: #2a78d6; border-style: solid; }
.hs-block-title { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.hs-drag {
  display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 28px;
  margin-inline-start: -4px; border-radius: 6px; color: #8a8a8a; font-size: 16px; cursor: grab;
  user-select: none; -webkit-user-select: none;
}
.hs-drag:hover { background: #f1f1f1; color: #303030; }
.hs-drag:active { cursor: grabbing; }
.hs-block-actions { display: flex; align-items: center; gap: 2px; }
.hs-product-price { color: #616161; font-size: 12px; }
@media (prefers-color-scheme: dark) {
  .hs-item { border-color: #3a3a3a; }
}
`;
