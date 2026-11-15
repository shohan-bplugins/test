import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { useT } from "~/i18n";
import { useEd } from "~/lib/configurator/editor-state";
import { VariantEditForm, type VariantSave } from "./VariantEditModal";

type Reply = { ok: boolean; message?: string; error?: string };

/*
 * The 3D editor opened on one variant ("Customize 3D" on the product page):
 * that variant's own Shopify details — option values (its title), price,
 * compare-at price, SKU and quantity — in the left panel. Follows the variant
 * dropdown above it. Saves post `{ intent: "variant", op: "update" }` to the
 * editor route, which runs the same operation as the product page; the loader
 * then reruns and syncProduct brings the new values into the session.
 */
export function VariantDetailsPanel() {
  const t = useT("editor");
  const shopify = useAppBridge();
  const ed = useEd();
  const fetcher = useFetcher<Reply>();
  const [saving, setSaving] = useState<VariantSave | null>(null);
  const { product } = ed;
  const variant = product.variants.find((v) => v.id === ed.target) ?? null;
  const defaultOnly =
    product.options.length === 1 &&
    product.options[0].name === "Title" &&
    product.options[0].values.length === 1 &&
    product.options[0].values[0] === "Default Title";

  useEffect(() => {
    const d = fetcher.data;
    if (!d || fetcher.state !== "idle") return;
    setSaving(null);
    if (d.ok) shopify.toast.show(d.message ?? t("variantSaved"));
    else shopify.toast.show(d.error ?? t("errVariant"), { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  if (!variant) return null;
  return (
    <div className="ed-panel">
      <h2 className="ed-h">{t("variantDetails")}</h2>
      <VariantEditForm
        key={variant.id}
        variant={variant}
        options={product.options}
        showOptions={!defaultOnly}
        busy={fetcher.state !== "idle"}
        saving={saving}
        narrow
        onSave={(kind, body) => {
          setSaving(kind);
          fetcher.submit(JSON.stringify({ intent: "variant", ...body }), {
            method: "post",
            encType: "application/json",
          });
        }}
      />
    </div>
  );
}
