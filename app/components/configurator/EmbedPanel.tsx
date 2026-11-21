import { useAppBridge } from "@shopify/app-bridge-react";

import { flag, fieldChecked, fieldValue } from "~/components/polaris/helpers";
import { useT } from "~/i18n";
import {
  buildConfiguratorEmbed,
  DEFAULT_EMBED_OPTIONS,
  type EmbedOptions,
} from "~/lib/configurator/embed-snippet";

/*
 * "Embed with iframe" on the product page: the Product configurator block's
 * settings plus the embed's width, and the two snippets they produce.
 * Controlled: the product page saves the options with its other settings (save
 * bar), so the snippet a merchant copies always matches what is saved.
 */
export function EmbedPanel({
  handle,
  value: o,
  onChange,
}: {
  handle: string;
  value: EmbedOptions;
  onChange: (next: EmbedOptions) => void;
}) {
  const t = useT("product");
  const set = <K extends keyof EmbedOptions>(key: K, value: EmbedOptions[K]) =>
    onChange({ ...o, [key]: value });
  const num = (e: Event, fallback: number) => {
    const n = Number(fieldValue(e));
    return Number.isFinite(n) && fieldValue(e) !== "" ? n : fallback;
  };

  return (
    <s-stack direction="block" gap="base">
      <s-paragraph color="subdued">{t("embedHelp")}</s-paragraph>

      <s-heading>{t("embedLayoutHeading")}</s-heading>
      <s-grid gridTemplateColumns="1fr 1fr" gap="base">
        <s-select
          label={t("embedDefaultMedia")}
          value={o.media}
          onInput={(e) => set("media", fieldValue(e) === "image" ? "image" : "3d")}
        >
          <s-option value="3d">{t("embedMedia3d")}</s-option>
          <s-option value="image">{t("embedMediaImage")}</s-option>
        </s-select>
        <s-select
          label={t("embedGalleryPosition")}
          value={o.position}
          onInput={(e) => set("position", fieldValue(e) === "right" ? "right" : "left")}
        >
          <s-option value="left">{t("embedLeft")}</s-option>
          <s-option value="right">{t("embedRight")}</s-option>
        </s-select>
        <s-number-field
          label={t("embedGalleryHeight")}
          suffix="px"
          min={300}
          max={800}
          step={50}
          value={String(o.height)}
          onInput={(e) => set("height", num(e, o.height))}
        />
        <s-color-field
          label={t("embedBackground")}
          value={o.bg}
          onInput={(e) => set("bg", fieldValue(e))}
        />
      </s-grid>

      <s-heading>{t("embedWidthHeading")}</s-heading>
      <s-grid gridTemplateColumns="1fr 1fr" gap="base">
        <s-select
          label={t("embedWidth")}
          value={o.width}
          onInput={(e) => set("width", fieldValue(e) === "custom" ? "custom" : "full")}
        >
          <s-option value="full">{t("embedWidthFull")}</s-option>
          <s-option value="custom">{t("embedWidthCustom")}</s-option>
        </s-select>
        {o.width === "custom" ? (
          <s-stack direction="inline" gap="small-200">
            <s-number-field
              label={t("embedMaxWidth")}
              details={t("embedMaxWidthDetails")}
              min={o.maxWidthUnit === "%" ? 10 : 320}
              max={o.maxWidthUnit === "%" ? 100 : 4000}
              step={o.maxWidthUnit === "%" ? 5 : 10}
              value={String(o.maxWidth)}
              onInput={(e) => set("maxWidth", num(e, o.maxWidth))}
            />
            <s-select
              label={t("embedUnit")}
              value={o.maxWidthUnit}
              onInput={(e) => {
                const unit = fieldValue(e) === "%" ? "%" : "px";
                onChange({
                  ...o,
                  maxWidthUnit: unit,
                  // Keep the number sensible for the new unit.
                  maxWidth: unit === "%" ? 100 : 1200,
                });
              }}
            >
              <s-option value="px">px</s-option>
              <s-option value="%">%</s-option>
            </s-select>
          </s-stack>
        ) : null}
      </s-grid>

      <s-heading>{t("embedDetailsHeading")}</s-heading>
      <s-grid gridTemplateColumns="1fr 1fr" gap="base">
        <s-select
          label={t("embedVariantPicker")}
          value={o.variantStyle}
          onInput={(e) => set("variantStyle", fieldValue(e) === "dropdown" ? "dropdown" : "pills")}
        >
          <s-option value="pills">{t("embedPills")}</s-option>
          <s-option value="dropdown">{t("embedDropdown")}</s-option>
        </s-select>
        <s-select
          label={t("embedAfterAdd")}
          value={o.afterAdd}
          onInput={(e) => set("afterAdd", fieldValue(e) === "cart" ? "cart" : "update")}
        >
          <s-option value="update">{t("embedAfterAddUpdate")}</s-option>
          <s-option value="cart">{t("embedAfterAddCart")}</s-option>
        </s-select>
      </s-grid>
      <s-stack direction="block" gap="small-200">
        <s-checkbox
          label={t("embedShowVendor")}
          checked={flag(o.vendor)}
          onInput={(e) => set("vendor", fieldChecked(e))}
        />
        <s-checkbox
          label={t("embedShowSku")}
          checked={flag(o.sku)}
          onInput={(e) => set("sku", fieldChecked(e))}
        />
        <s-checkbox
          label={t("embedShowQuantity")}
          checked={flag(o.quantity)}
          onInput={(e) => set("quantity", fieldChecked(e))}
        />
        <s-checkbox
          label={t("embedShowBuyNow")}
          checked={flag(o.buyNow)}
          onInput={(e) => set("buyNow", fieldChecked(e))}
        />
        <s-checkbox
          label={t("embedShowDescription")}
          checked={flag(o.description)}
          onInput={(e) => set("description", fieldChecked(e))}
        />
      </s-stack>
      <s-stack direction="inline">
        <s-button variant="tertiary" onClick={() => onChange(DEFAULT_EMBED_OPTIONS)}>
          {t("embedReset")}
        </s-button>
      </s-stack>

      <s-divider />

      <EmbedCode label={t("embedThisProduct")} code={buildConfiguratorEmbed(handle, o)} />
      <EmbedCode
        label={t("embedTemplate")}
        details={t("embedTemplateHelp")}
        code={buildConfiguratorEmbed("{{ product.handle }}", o)}
      />
    </s-stack>
  );
}

/** One embed snippet, read-only, with a copy button. */
function EmbedCode({ label, details, code }: { label: string; details?: string; code: string }) {
  const t = useT("product");
  const shopify = useAppBridge();
  return (
    <s-stack direction="block" gap="small-200">
      <s-text-area label={label} details={details} rows={4} value={code} readOnly />
      <s-stack direction="inline">
        <s-button
          icon="clipboard"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              shopify.toast.show(t("embedCopied"));
            } catch {
              shopify.toast.show(t("embedCopyFailed"), { isError: true });
            }
          }}
        >
          {t("embedCopy")}
        </s-button>
      </s-stack>
    </s-stack>
  );
}
