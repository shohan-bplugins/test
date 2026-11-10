import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { ConfirmModal } from "~/components/polaris/ConfirmModal";
import { fieldChecked, fieldValue, flag } from "~/components/polaris/helpers";
import { useT } from "~/i18n";
import type { EditorProduct } from "~/lib/configurator/editor-state";

/*
 * Creates, updates and deletes the product's real Shopify variants from the
 * product page. Each change is posted to that route's action as JSON (intent
 * "variant", or "variant3d" for a variant's 3D setup); when it succeeds the
 * loader reruns with the new variants.
 * "Customize 3D" on a variant opens the 3D editor for that variant alone.
 */

type Variant = EditorProduct["variants"][number];
type Reply = { ok: boolean; message?: string; error?: string };
type Form =
  | { kind: "create" }
  | { kind: "option" }
  | { kind: "values"; name: string }
  | { kind: "prices" }
  | { kind: "edit"; id: string }
  | { kind: "copy3d"; id: string }
  | null;

const PRICE_OK = /^\d{1,9}(\.\d{1,2})?$/;
const QTY_OK = /^\d{1,9}$/;
/** From this many variants on, the list gets a search field. */
const SEARCH_FROM = 6;

const isDefaultOnly = (p: EditorProduct) =>
  p.options.length === 1 &&
  p.options[0].name === "Title" &&
  p.options[0].values.length === 1 &&
  p.options[0].values[0] === "Default Title";

export function VariantsPanel({
  product,
  customized,
  fallbackImage,
  onCustomize,
  selectedId = null,
  onSelect,
}: {
  product: EditorProduct;
  /** Variants that have their own 3D setup. */
  customized: string[];
  /** Shown for a variant without its own image (the product's image). */
  fallbackImage?: string | null;
  /** Opens the 3D editor on one variant; omitted while there is no model. */
  onCustomize?: (variantId: string) => void;
  /** The variant shown in the live preview; its row is highlighted. */
  selectedId?: string | null;
  /** Clicking a row shows that variant in the live preview (again: back to default). */
  onSelect?: (variantId: string) => void;
}) {
  const t = useT("editor");
  const tc = useT("common");
  const shopify = useAppBridge();
  const fetcher = useFetcher<Reply>();
  const [form, setForm] = useState<Form>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [optionRows, setOptionRows] = useState(1);
  const [showOptions, setShowOptions] = useState(false);
  const [query, setQuery] = useState("");
  const [copyTo, setCopyTo] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<Variant | null>(null);
  const [resetting, setResetting] = useState<Variant | null>(null);
  const [removing, setRemoving] = useState<{
    name: string;
    value?: string;
  } | null>(null);
  const busy = fetcher.state !== "idle";
  const defaultOnly = isDefaultOnly(product);

  const send = (body: Record<string, unknown>, intent = "variant") =>
    fetcher.submit(JSON.stringify({ intent, ...body }), {
      method: "post",
      encType: "application/json",
    });

  useEffect(() => {
    const d = fetcher.data;
    if (!d || fetcher.state !== "idle") return;
    if (d.ok) {
      shopify.toast.show(d.message ?? t("variantSaved"));
      setForm(null);
      setConfirm(null);
      setResetting(null);
      setRemoving(null);
    } else {
      shopify.toast.show(d.error ?? t("errVariant"), { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  const field = (k: string) => fields[k] ?? "";
  // Read the checkbox now: React clears event.currentTarget after the handler.
  const toggle = (k: string) => (e: unknown) => {
    const on = fieldChecked(e as never);
    setFields((f) => ({ ...f, [k]: on ? "1" : "" }));
  };
  /** Stock payload from a form's two fields, or undefined when nothing was chosen. */
  const stockOf = (unlimited: string, qty: string) =>
    unlimited
      ? { unlimited: true }
      : qty.trim()
        ? { unlimited: false, quantity: Number(qty) }
        : undefined;
  const set = (k: string) => (e: unknown) => {
    // Read now: React clears event.currentTarget once the handler returns, and
    // the updater below can run after that.
    const v = fieldValue(e as never);
    setFields((f) => ({ ...f, [k]: v }));
  };

  const open = (next: Form) => {
    setFields({});
    setForm(next);
  };
  const openOption = () => {
    setOptionRows(1);
    open({ kind: "option" });
  };
  const openEdit = (v: Variant) => {
    setFields({
      price: v.price ?? "",
      compareAt: v.compareAtPrice ?? "",
      sku: v.sku ?? "",
      unlimited: v.tracked === false ? "1" : "",
      qty: v.quantity != null ? String(v.quantity) : "",
    });
    setForm({ kind: "edit", id: v.id });
  };
  const openCopy = (v: Variant) => {
    setCopyTo([]);
    setForm({ kind: "copy3d", id: v.id });
  };

  // Variants a price rule would touch: every chosen value must match, and an
  // option left on "Any" matches everything — so one option, two, or all.
  const priceTargets = product.variants.filter((v) =>
    product.options.every((o) => {
      const want = field(`pm:${o.name}`);
      return !want || v.options[o.name] === want;
    }),
  );

  const missingValue = product.options.some(
    (o) => !field(`opt:${o.name}`).trim(),
  );

  // Option rows in the form: Shopify allows three options per product, and the
  // default-only product's placeholder "Title" option is replaced, not counted.
  const maxRows = Math.max(1, 3 - (defaultOnly ? 0 : product.options.length));
  const row = (i: number) => ({
    name: field(i ? `optionName${i}` : "optionName"),
    values: field(i ? `optionValues${i}` : "optionValues"),
  });
  const rows = Array.from({ length: optionRows }, (_, i) => row(i));
  const rowsValid = rows.every((r) => r.name.trim() && r.values.trim());

  const shown = query
    ? product.variants.filter((v) =>
        v.title.toLowerCase().includes(query.toLowerCase()),
      )
    : product.variants;

  const stockBadge = (v: Variant) =>
    v.tracked === false ? (
      <s-badge>{t("stockUnlimited")}</s-badge>
    ) : (v.quantity ?? 0) > 0 ? (
      <s-badge tone="success">
        {t("stockIn", { count: v.quantity ?? 0 })}
      </s-badge>
    ) : (
      <s-badge tone="critical">{t("stockOut")}</s-badge>
    );

  const formButtons = (
    label: string,
    disabled: boolean,
    onClick: () => void,
  ) => (
    <s-stack direction="inline" gap="small">
      <s-button
        variant="primary"
        loading={flag(busy)}
        disabled={flag(disabled)}
        onClick={onClick}
      >
        {label}
      </s-button>
      <s-button onClick={() => setForm(null)}>{tc("cancel")}</s-button>
    </s-stack>
  );

  const actions = (
    <s-stack direction="inline" gap="small">
      <s-button icon="plus" onClick={() => open({ kind: "create" })}>
        {t("addVariant")}
      </s-button>
      <s-button
        icon="menu-horizontal"
        commandFor="variants-more"
        command="--show"
      >
        {t("moreActions")}
      </s-button>
      <s-menu id="variants-more" accessibilityLabel={t("moreActions")}>
        <s-button icon="money" onClick={() => open({ kind: "prices" })}>
          {t("setPrices")}
        </s-button>
        {product.options.length < 3 ? (
          <s-button icon="plus" onClick={openOption}>
            {t("addAnotherOption")}
          </s-button>
        ) : null}
        <s-button icon="variant" onClick={() => setShowOptions((s) => !s)}>
          {showOptions ? t("hideOptions") : t("manageOptions")}
        </s-button>
      </s-menu>
    </s-stack>
  );

  const optionForm = (
    <s-box padding="small" borderWidth="base" borderRadius="base">
      <s-stack gap="small">
        <s-paragraph color="subdued">
          {defaultOnly ? t("addOptionProductHelp") : t("addOptionMoreHelp")}
        </s-paragraph>
        {rows.map((_, i) => (
          <s-stack key={i} gap="small">
            <s-text-field
              label={t("optionNameLabel")}
              placeholder={t("optionNamePlaceholder")}
              value={row(i).name}
              onInput={set(i ? `optionName${i}` : "optionName")}
            />
            <s-text-field
              label={t("optionValuesLabel")}
              details={t("optionValuesHelp")}
              value={row(i).values}
              onInput={set(i ? `optionValues${i}` : "optionValues")}
            />
          </s-stack>
        ))}
        {optionRows < maxRows ? (
          <s-button
            variant="tertiary"
            icon="plus"
            onClick={() => setOptionRows((n) => n + 1)}
          >
            {t("addAnotherOption")}
          </s-button>
        ) : null}
        {formButtons(t("createOption"), !rowsValid, () =>
          send({
            op: "addOption",
            options: rows.map((r) => ({
              name: r.name,
              values: r.values.split(","),
            })),
          }),
        )}
      </s-stack>
    </s-box>
  );

  const editForm = (v: Variant) => (
    <s-stack gap="small">
      <s-grid gridTemplateColumns="1fr 1fr" gap="small">
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
      <s-checkbox
        label={t("unlimitedQuantity")}
        checked={flag(!!field("unlimited"))}
        onInput={toggle("unlimited")}
      />
      {field("unlimited") ? null : (
        <s-text-field
          label={t("variantQuantity")}
          value={field("qty")}
          onInput={set("qty")}
        />
      )}
      {formButtons(
        t("saveVariant"),
        !field("price").trim() ||
          (!field("unlimited") &&
            !!field("qty").trim() &&
            !QTY_OK.test(field("qty").trim())),
        () => {
          // Only send stock that changed, so a price edit never touches
          // inventory (or needs its permission).
          const was = v.tracked === false;
          const stock = stockOf(field("unlimited"), field("qty"));
          const changed =
            stock &&
            (stock.unlimited !== was ||
              (!stock.unlimited &&
                String(stock.quantity) !== String(v.quantity ?? "")));
          send({
            op: "update",
            variantId: v.id,
            price: field("price"),
            compareAtPrice: field("compareAt"),
            sku: field("sku"),
            ...(changed ? { stock } : {}),
          });
        },
      )}
    </s-stack>
  );

  const copyForm = (v: Variant) => {
    const others = product.variants.filter((o) => o.id !== v.id);
    const all = others.length > 0 && copyTo.length === others.length;
    return (
      <s-stack gap="small">
        <s-paragraph color="subdued">
          {t("copy3dHelp", { name: v.title })}
        </s-paragraph>
        <s-checkbox
          label={t("selectAllVariants")}
          checked={flag(all)}
          onInput={() => setCopyTo(all ? [] : others.map((o) => o.id))}
        />
        {others.map((o) => (
          <s-checkbox
            key={o.id}
            label={o.title}
            checked={flag(copyTo.includes(o.id))}
            onInput={() =>
              setCopyTo((c) =>
                c.includes(o.id) ? c.filter((x) => x !== o.id) : [...c, o.id],
              )
            }
          />
        ))}
        {formButtons(
          t("copy3dApply", { count: copyTo.length }),
          !copyTo.length,
          () => send({ op: "copy", from: v.id, to: copyTo }, "variant3d"),
        )}
      </s-stack>
    );
  };

  const variantRow = (v: Variant) => {
    const menuId = `variant-actions-${v.id}`;
    const own = customized.includes(v.id);
    const editing = form && "id" in form && form.id === v.id ? form.kind : null;
    const image = v.image ?? fallbackImage;
    const selected = selectedId === v.id;
    const summary = (
      <s-grid
        gridTemplateColumns={image ? "auto 1fr" : "1fr"}
        gap="small"
        alignItems="start"
      >
        {image ? <s-thumbnail src={image} alt="" size="small" /> : null}
        <s-stack gap="small-300">
              <s-text type="strong">{v.title}</s-text>
              <s-stack direction="inline" gap="small-300" alignItems="center">
                {v.price ? <s-text>{v.price}</s-text> : null}
                {v.compareAtPrice ? (
                  <s-text color="subdued">
                    <s>{v.compareAtPrice}</s>
                  </s-text>
                ) : null}
              </s-stack>
              <s-stack direction="inline" gap="small-300">
                {stockBadge(v)}
                {own ? (
                  <s-badge tone="info" icon="three-d-environment">
                    {t("variantHas3d")}
                  </s-badge>
                ) : (
                  <s-badge>{t("usesDefault3d")}</s-badge>
                )}
                {selected ? (
                  <s-badge tone="success" icon="view">
                    {t("inPreview")}
                  </s-badge>
                ) : null}
              </s-stack>
            </s-stack>
      </s-grid>
    );
    return (
      <s-box
        key={v.id}
        padding="small"
        // A heavier border marks the variant the live preview is showing.
        borderWidth={selected ? "large" : "base"}
        borderColor={selected ? "strong" : "base"}
        borderRadius="base"
        background={selected ? "subdued" : "base"}
      >
        <s-stack gap="small">
          <s-grid gridTemplateColumns="1fr auto" gap="small" alignItems="start">
            {onSelect ? (
              <s-clickable
                inlineSize="100%"
                borderRadius="base"
                accessibilityLabel={t("previewVariant", { name: v.title })}
                onClick={() => onSelect(v.id)}
              >
                {summary}
              </s-clickable>
            ) : (
              summary
            )}
            <s-button
              variant="tertiary"
              icon="menu-horizontal"
              accessibilityLabel={t("actionsForVariant", { name: v.title })}
              commandFor={menuId}
              command="--show"
            />
          </s-grid>
          {onCustomize || onSelect ? (
            <s-stack direction="inline" gap="small-200">
              {onCustomize ? (
                <s-button
                  icon="three-d-environment"
                  onClick={() => onCustomize(v.id)}
                >
                  {own ? t("edit3d") : t("customize3d")}
                </s-button>
              ) : null}
              {onSelect ? (
                // Shows this variant in the live preview; pressed again, back
                // to the product default.
                <s-button
                  icon="view"
                  variant={selected ? "primary" : "secondary"}
                  accessibilityLabel={t("previewVariant", { name: v.title })}
                  onClick={() => onSelect(v.id)}
                >
                  {t("previewButton")}
                </s-button>
              ) : null}
            </s-stack>
          ) : null}
          {editing === "edit"
            ? editForm(v)
            : editing === "copy3d"
              ? copyForm(v)
              : null}
        </s-stack>
        <s-menu
          id={menuId}
          accessibilityLabel={t("actionsForVariant", { name: v.title })}
        >
          <s-button
            icon="edit"
            onClick={() => (editing === "edit" ? setForm(null) : openEdit(v))}
          >
            {t("editDetails")}
          </s-button>
          {onCustomize ? (
            // The snapshot is taken in the 3D editor, opened on this variant.
            <s-button icon="camera" onClick={() => onCustomize(v.id)}>
              {t("imageFrom3d")}
            </s-button>
          ) : null}
          {own && product.variants.length > 1 ? (
            <s-button icon="duplicate" onClick={() => openCopy(v)}>
              {t("copy3d")}
            </s-button>
          ) : null}
          {/*
            The two items that open a confirmation hide the menu and open the
            modal a frame later, so the menu's teardown can't take the modal
            down with it (see the row menu in app.models._index.tsx).
          */}
          {own ? (
            <s-button
              icon="reset"
              commandFor={menuId}
              command="--hide"
              onClick={() => requestAnimationFrame(() => setResetting(v))}
            >
              {t("reset3d")}
            </s-button>
          ) : null}
          <s-button
            tone="critical"
            icon="delete"
            disabled={flag(product.variants.length <= 1)}
            commandFor={menuId}
            command="--hide"
            onClick={() => requestAnimationFrame(() => setConfirm(v))}
          >
            {t("deleteVariant", { name: v.title })}
          </s-button>
        </s-menu>
      </s-box>
    );
  };

  const optionsBlock = (
    <s-box
      padding="small"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
    >
      <s-stack gap="base">
        {product.options.map((o) => (
          <s-stack key={o.name} gap="small">
            <s-grid gridTemplateColumns="1fr auto auto" alignItems="center">
              <s-text type="strong">{o.name}</s-text>
              <s-button
                variant="tertiary"
                icon="plus"
                accessibilityLabel={t("addValues")}
                onClick={() =>
                  form?.kind === "values" && form.name === o.name
                    ? setForm(null)
                    : open({ kind: "values", name: o.name })
                }
              />
              <s-button
                variant="tertiary"
                tone="critical"
                icon="delete"
                disabled={flag(product.options.length <= 1)}
                accessibilityLabel={t("removeOptionLabel", { name: o.name })}
                onClick={() => setRemoving({ name: o.name })}
              />
            </s-grid>
            <s-stack direction="inline" gap="small-300">
              {o.values.map((val) =>
                o.values.length > 1 ? (
                  <s-clickable-chip
                    key={val}
                    removable
                    accessibilityLabel={t("removeValueLabel", { value: val })}
                    onRemove={() => setRemoving({ name: o.name, value: val })}
                  >
                    {val}
                  </s-clickable-chip>
                ) : (
                  <s-chip key={val}>{val}</s-chip>
                ),
              )}
            </s-stack>
            {form?.kind === "values" && form.name === o.name ? (
              <s-stack gap="small">
                <s-text-field
                  label={t("addValues")}
                  details={t("addValuesHelp")}
                  placeholder={
                    o.name.toLowerCase() === "size" ? "XL, XXL" : undefined
                  }
                  value={field("newValues")}
                  onInput={set("newValues")}
                />
                {formButtons(t("addValues"), !field("newValues").trim(), () =>
                  send({
                    op: "addValues",
                    name: o.name,
                    values: field("newValues").split(","),
                  }),
                )}
              </s-stack>
            ) : null}
          </s-stack>
        ))}
      </s-stack>
    </s-box>
  );

  const pricesForm = (
    <s-box padding="small" borderWidth="base" borderRadius="base">
      <s-stack gap="small">
        <s-text type="strong">{t("setPrices")}</s-text>
        <s-paragraph color="subdued">{t("setPricesHelp")}</s-paragraph>
        {product.options.map((o) => (
          <s-select
            key={o.name}
            label={o.name}
            value={field(`pm:${o.name}`)}
            onInput={set(`pm:${o.name}`)}
          >
            <s-option value="">{t("anyOption", { name: o.name })}</s-option>
            {o.values.map((val) => (
              <s-option key={val} value={val}>
                {val}
              </s-option>
            ))}
          </s-select>
        ))}
        <s-grid gridTemplateColumns="1fr 1fr" gap="small">
          <s-text-field
            label={t("variantPrice")}
            value={field("pp")}
            onInput={set("pp")}
          />
          <s-text-field
            label={t("variantCompareAt")}
            details={t("compareAtKeep")}
            value={field("pc")}
            onInput={set("pc")}
          />
        </s-grid>
        <s-checkbox
          label={t("unlimitedQuantity")}
          checked={flag(!!field("pu"))}
          onInput={toggle("pu")}
        />
        {field("pu") ? null : (
          <s-text-field
            label={t("variantQuantity")}
            details={t("stockKeep")}
            value={field("pq")}
            onInput={set("pq")}
          />
        )}
        <s-text color="subdued">
          {t("appliesTo", { count: priceTargets.length })}
        </s-text>
        {formButtons(
          t("applyPrices"),
          !priceTargets.length ||
            (!!field("pp").trim() && !PRICE_OK.test(field("pp").trim())) ||
            (!field("pu") &&
              !!field("pq").trim() &&
              !QTY_OK.test(field("pq").trim())) ||
            !(
              field("pp").trim() ||
              field("pc").trim() ||
              field("pu") ||
              field("pq").trim()
            ),
          () => {
            const stock = stockOf(field("pu"), field("pq"));
            send({
              op: "setPrices",
              variantIds: priceTargets.map((v) => v.id),
              ...(field("pp").trim() ? { price: field("pp").trim() } : {}),
              ...(field("pc").trim()
                ? { compareAtPrice: field("pc").trim() }
                : {}),
              ...(stock ? { stock } : {}),
            });
          },
        )}
      </s-stack>
    </s-box>
  );

  const createForm = (
    <s-box padding="small" borderWidth="base" borderRadius="base">
      <s-stack gap="small">
        <s-text type="strong">{t("addVariant")}</s-text>
        <s-paragraph color="subdued">{t("addVariantHelp")}</s-paragraph>
        {product.options.map((o) => (
          <s-text-field
            key={o.name}
            label={o.name}
            placeholder={o.values[0]}
            value={field(`opt:${o.name}`)}
            onInput={set(`opt:${o.name}`)}
          />
        ))}
        <s-text-field
          label={t("variantPrice")}
          details={t("variantPriceHelp")}
          value={field("price")}
          onInput={set("price")}
        />
        {formButtons(t("createVariant"), missingValue, () =>
          send({
            op: "create",
            options: Object.fromEntries(
              product.options.map((o) => [o.name, field(`opt:${o.name}`)]),
            ),
            price: field("price") || undefined,
          }),
        )}
      </s-stack>
    </s-box>
  );

  return (
    <s-stack gap="base">
      {defaultOnly ? (
        form?.kind === "option" ? (
          optionForm
        ) : (
          <s-stack gap="small">
            <s-paragraph color="subdued">{t("noVariants")}</s-paragraph>
            <s-button icon="plus" onClick={openOption}>
              {t("addOptionProduct")}
            </s-button>
          </s-stack>
        )
      ) : (
        <>
          {/* The count is in the section header (app.products.$id.tsx). */}
          {product.variants.length >= SEARCH_FROM ? (
            <s-search-field
              label={t("findVariant")}
              labelAccessibilityVisibility="exclusive"
              placeholder={t("findVariant")}
              value={query}
              onInput={(e) => setQuery(fieldValue(e))}
            />
          ) : null}

          <s-stack gap="small">
            {shown.map(variantRow)}
            {query && !shown.length ? (
              <s-text color="subdued">{t("noVariantMatches")}</s-text>
            ) : null}
          </s-stack>

          {showOptions ? optionsBlock : null}

          {form?.kind === "prices"
            ? pricesForm
            : form?.kind === "create"
              ? createForm
              : form?.kind === "option"
                ? optionForm
                : actions}
        </>
      )}

      <ConfirmModal
        id="ed-remove-option"
        open={!!removing}
        heading={
          removing?.value ? t("removeValueHeading") : t("removeOptionHeading")
        }
        confirmLabel={tc("delete")}
        loading={busy}
        onConfirm={() =>
          removing &&
          send(
            removing.value
              ? {
                  op: "removeValue",
                  name: removing.name,
                  value: removing.value,
                }
              : { op: "removeOption", name: removing.name },
          )
        }
        onCancel={() => setRemoving(null)}
      >
        <s-paragraph>
          {removing?.value
            ? t("removeValueBody", {
                value: removing.value,
                name: removing.name,
              })
            : t("removeOptionBody", { name: removing?.name ?? "" })}
        </s-paragraph>
      </ConfirmModal>

      <ConfirmModal
        id="ed-delete-variant"
        open={!!confirm}
        heading={t("deleteVariantHeading")}
        confirmLabel={t("deleteVariant", { name: confirm?.title ?? "" })}
        loading={busy}
        onConfirm={() =>
          confirm && send({ op: "delete", variantId: confirm.id })
        }
        onCancel={() => setConfirm(null)}
      >
        <s-paragraph>
          {t("deleteVariantBody", { name: confirm?.title ?? "" })}
        </s-paragraph>
      </ConfirmModal>

      <ConfirmModal
        id="ed-reset-variant-3d"
        open={!!resetting}
        heading={t("reset3dHeading", { name: resetting?.title ?? "" })}
        confirmLabel={t("reset3d")}
        loading={busy}
        onConfirm={() =>
          resetting &&
          send({ op: "reset", variantId: resetting.id }, "variant3d")
        }
        onCancel={() => setResetting(null)}
      >
        <s-paragraph>{t("reset3dBody")}</s-paragraph>
      </ConfirmModal>
    </s-stack>
  );
}
