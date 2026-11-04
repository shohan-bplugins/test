import { useState } from "react";

import { FilePickerDialog } from "~/components/FilePickerDialog";
import { useT } from "~/i18n";
import { isRule, setLayerModel, useEd } from "~/lib/configurator/editor-state";

/**
 * For the selected variant or option value: use the product's 3D model, or
 * pick a different one from Shopify Files. The viewport switches to it at
 * once, and parts / materials set on this layer belong to that model.
 */
export function LayerModelControl() {
  const t = useT("editor");
  const ed = useEd();
  const [open, setOpen] = useState(false);
  if (ed.target === "default") return null;

  const layer = isRule(ed.target)
    ? ed.draft.rules[ed.target.slice("rule:".length)]
    : ed.draft.variants[ed.target];
  const own = layer?.modelFileId ?? null;
  const name = own ? (ed.modelNames[own] ?? own.split("/").pop() ?? own) : "";

  return (
    <div className="ed-layermodel">
      <p className="ed-sub">{t("layerModel")}</p>
      <p className="ed-help">{own ? t("layerModelOwn", { name }) : t("layerModelDefault")}</p>
      <s-stack direction="inline" gap="small">
        <s-button icon="product" onClick={() => setOpen(true)}>
          {t("chooseModel")}
        </s-button>
        {own ? (
          <s-button variant="tertiary" onClick={() => setLayerModel(null)}>
            {t("useDefaultModel")}
          </s-button>
        ) : null}
      </s-stack>
      <p className="ed-help">{t("layerModelHelp")}</p>
      <FilePickerDialog
        open={open}
        onOpenChange={setOpen}
        currentUrl={own ? (ed.modelUrls[own] ?? null) : null}
        onSelect={(file) => setLayerModel(file.id, file.url, file.name)}
      />
    </div>
  );
}
