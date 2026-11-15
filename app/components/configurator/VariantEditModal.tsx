import { useEffect, useState } from "react";

import { ModalAction } from "~/components/polaris/ModalAction";
import {
  fieldChecked,
  fieldValue,
  flag,
  useOverlay,
  type OverlayElement,
} from "~/components/polaris/helpers";
import { useT } from "~/i18n";
import type { EditorProduct } from "~/lib/configurator/editor-state";

type Variant = EditorProduct["variants"][number];
type Option = EditorProduct["options"][number];
export type VariantSave = "options" | "price" | "stock";

const PRICE_OK = /^\d{1,9}(\.\d{1,2})?$/;
const QTY_OK = /^\d{1,9}$/;

/*
 * Edits one variant in a modal: its option values, its price, and its stock.
 * Each of the three saves on its own and sends only its own fields, so saving
 * a price never touches inventory and renaming a value never touches price.
 * Everything applies to this variant alone. Changing its "Color" from Red to
 * Crimson moves only this variant to Crimson; other Red variants keep Red.
 *
 * Every button in here is a ModalAction: s-modal lifts its content out of
 * React's root, so a React onClick inside it never fires (see ModalAction).
 */
export function VariantEditModal({
  variant,
  options,
  showOptions,
  busy,
  saving,
  onSave,
  onClose,
}: {
  /** The variant being edited; null keeps the modal closed. */
  variant: Variant | null;
  options: Option[];
  /** False for a product with only Shopify's placeholder "Default Title". */
  showOptions: boolean;
  busy: boolean;
  /** Which section's save is in flight, for its spinner. */
  saving: VariantSave | null;
  onSave: (kind: VariantSave, body: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const t = useT("editor");
  const tc = useT("common");
  const ref = useOverlay<OverlayElement>(!!variant, onClose);
  return (
    <s-modal
      ref={ref as never}
      id="variant-edit-modal"
      heading={
        variant
          ? t("editVariantHeading", { name: variant.title })
          : t("editDetails")
      }
      accessibilityLabel={t("editDetails")}
    >
      {variant ? (
        <VariantEditForm
          variant={variant}
          options={options}
          showOptions={showOptions}
          busy={busy}
          saving={saving}
          onSave={onSave}
        />
      ) : null}
      <ModalAction slot="secondary-actions" onClick={onClose}>
        {tc("close")}
      </ModalAction>
    </s-modal>
  );
}

/*
 * The modal's body on its own: also shown in the 3D editor's left panel when
 * it is opened on one variant. Its buttons are ModalActions, which work both
 * inside an s-modal and outside one.
 */
export function VariantEditForm({
  variant,
  options,
  showOptions,
  busy,
  saving,
  onSave,
  narrow = false,
}: {
  variant: Variant;
  options: Option[];
  showOptions: boolean;
  busy: boolean;
  saving: VariantSave | null;
  onSave: (kind: VariantSave, body: Record<string, unknown>) => void;
  /** Stacks the price fields, for a narrow column like the editor's sidebar. */
  narrow?: boolean;
}) {
  const t = useT("editor");
  const [fields, setFields] = useState<Record<string, string>>({});

  // Fill the fields from the variant each time the modal opens on one. A save
  // reloads the variant, but the fields already hold what was saved.
  useEffect(() => {
    if (!variant) return;
    setFields({
      price: variant.price ?? "",
      compareAt: variant.compareAtPrice ?? "",
      sku: variant.sku ?? "",
      unlimited: variant.tracked === false ? "1" : "",
      qty: variant.quantity != null ? String(variant.quantity) : "",
      ...Object.fromEntries(
        options.map((o) => [`opt:${o.name}`, variant.options[o.name] ?? ""]),
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant?.id]);

  const field = (k: string) => fields[k] ?? "";
  // Read now: React clears event.currentTarget once the handler returns.
  const set = (k: string) => (e: unknown) => {
    const v = fieldValue(e as never);
    setFields((f) => ({ ...f, [k]: v }));
  };
  const toggle = (k: string) => (e: unknown) => {
    const on = fieldChecked(e as never);
    setFields((f) => ({ ...f, [k]: on ? "1" : "" }));
  };

  const v = variant;

  // Option values
  const optionValues = Object.fromEntries(
    options.map((o) => [o.name, field(`opt:${o.name}`).trim()]),
  );
  const optionsChanged =
    !!v &&
    options.some((o) => optionValues[o.name] !== (v.options[o.name] ?? ""));
  const optionsInvalid = options.some((o) => !optionValues[o.name]);

  // Price
  const price = field("price").trim();
  const compareAt = field("compareAt").trim();
  const priceChanged =
    !!v &&
    (price !== (v.price ?? "") ||
      compareAt !== (v.compareAtPrice ?? "") ||
      field("sku") !== (v.sku ?? ""));
  const priceInvalid =
    !PRICE_OK.test(price) || (!!compareAt && !PRICE_OK.test(compareAt));

  // Stock
  const unlimited = !!field("unlimited");
  const qty = field("qty").trim();
  const stockChanged =
    !!v &&
    (unlimited !== (v.tracked === false) ||
      (!unlimited && qty !== (v.quantity != null ? String(v.quantity) : "")));
  const stockInvalid = !unlimited && !QTY_OK.test(qty);

  // One collapsible section per save. Native <details>: it toggles without a
  // React handler, so it works inside s-modal's top layer too. A shared `name`
  // makes them an accordion (opening one closes the others); the first starts
  // open. The header shows the saved value, and flags edits left unsaved in a
  // closed section.
  const group = `vef-${v.id}`;
  let first = true;
  const section = (
    heading: string,
    meta: string,
    changed: boolean,
    body: React.ReactNode,
    kind: VariantSave,
    label: string,
    disabled: boolean,
    save: () => void,
  ) => {
    const open = first;
    first = false;
    return (
      <details className="vef-sec" name={group} open={open}>
        <summary>
          <span className="vef-sec__title">{heading}</span>
          {changed ? (
            <s-badge tone="warning">{t("unsaved")}</s-badge>
          ) : meta ? (
            <span className="vef-sec__meta">{meta}</span>
          ) : null}
          <span className="vef-sec__chev" aria-hidden="true">
            <s-icon type="chevron-down" size="small" />
          </span>
        </summary>
        <div className="vef-sec__body">
          <s-stack gap="small">
            {body}
            <s-stack direction="inline" gap="small">
              <ModalAction
                variant="primary"
                loading={saving === kind}
                disabled={busy || disabled}
                onClick={save}
              >
                {label}
              </ModalAction>
            </s-stack>
          </s-stack>
        </div>
      </details>
    );
  };

  return (
    <s-stack gap="small">
      <style>{SECTION_CSS}</style>
      <s-paragraph color="subdued">{t("editVariantHelp")}</s-paragraph>

      {showOptions
        ? section(
            t("optionsHeading"),
            v.title,
            optionsChanged,
            <>
              {options.map((o) => (
                <s-text-field
                  key={o.name}
                  label={o.name}
                  value={field(`opt:${o.name}`)}
                  onInput={set(`opt:${o.name}`)}
                />
              ))}
              <s-text color="subdued">{t("optionsThisVariantOnly")}</s-text>
            </>,
            "options",
            t("saveOptions"),
            !optionsChanged || optionsInvalid,
            () =>
              onSave("options", {
                op: "update",
                variantId: v.id,
                options: optionValues,
              }),
          )
        : null}

      {section(
        t("priceHeading"),
        v.price ?? "",
        priceChanged,
        <>
          <s-grid gridTemplateColumns={narrow ? "1fr" : "1fr 1fr"} gap="small">
            <s-text-field
              label={t("variantPrice")}
              value={field("price")}
              onInput={set("price")}
            />
            <s-text-field
              label={t("variantCompareAt")}
              value={field("compareAt")}
              onInput={set("compareAt")}
            />
          </s-grid>
          <s-text-field
            label={t("variantSku")}
            value={field("sku")}
            onInput={set("sku")}
          />
        </>,
        "price",
        t("savePrice"),
        !priceChanged || priceInvalid,
        () =>
          onSave("price", {
            op: "update",
            variantId: v.id,
            price,
            compareAtPrice: compareAt,
            sku: field("sku"),
          }),
      )}

      {section(
        t("quantityHeading"),
        v.tracked === false
          ? t("unlimitedQuantity")
          : v.quantity != null
            ? String(v.quantity)
            : "",
        stockChanged,
        <>
          <s-checkbox
            label={t("unlimitedQuantity")}
            checked={flag(unlimited)}
            onInput={toggle("unlimited")}
          />
          {unlimited ? null : (
            <s-text-field
              label={t("variantQuantity")}
              value={field("qty")}
              onInput={set("qty")}
            />
          )}
        </>,
        "stock",
        t("saveQuantity"),
        !stockChanged || stockInvalid,
        () =>
          onSave("stock", {
            op: "update",
            variantId: v.id,
            stock: unlimited
              ? { unlimited: true }
              : { unlimited: false, quantity: Number(qty) },
          }),
      )}
    </s-stack>
  );
}

const SECTION_CSS = `
.vef-sec { border: 1px solid #e3e3e3; border-radius: 10px; background: #fff; overflow: hidden; }
.vef-sec > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-weight: 650; transition: background 120ms ease, color 120ms ease; }
.vef-sec > summary::-webkit-details-marker { display: none; }
.vef-sec > summary:hover { background: #f4f8fe; color: #005bd3; }
.vef-sec > summary:focus-visible { outline: none; box-shadow: inset 0 0 0 2px #005bd3; }
.vef-sec__title { flex: none; }
.vef-sec__meta { margin-inline-start: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; color: #616161; }
.vef-sec > summary s-badge { margin-inline-start: auto; }
.vef-sec__chev { display: grid; place-items: center; flex: none; color: #8a8a8a; transition: transform 200ms ease; }
.vef-sec > summary:not(:has(.vef-sec__meta, s-badge)) .vef-sec__chev { margin-inline-start: auto; }
.vef-sec[open] > summary { color: #005bd3; border-bottom: 1px solid #ebebeb; }
.vef-sec[open] > summary .vef-sec__chev { transform: rotate(180deg); color: #005bd3; }
.vef-sec__body { padding: 12px; }
`;
