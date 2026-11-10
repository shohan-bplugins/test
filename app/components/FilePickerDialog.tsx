import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import {
  fieldValue,
  flag,
  useOverlay,
  type OverlayElement,
} from "~/components/polaris/helpers";

import type { FileItem } from "~/routes/api.files";
import { ModalAction } from "~/components/polaris/ModalAction";
import { CubeLoader } from "~/components/CubeLoader";
import { useT } from "~/i18n";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUrl: string | null;
  onSelect: (file: FileItem) => void;
  /**
   * Product this picker assigns to. Its own file stays selectable; every file
   * already on another product is offered as unavailable, since a 3D model
   * belongs to a single product.
   */
  productId?: string;
  /** Set for a product picker — blocks files another product already uses. */
  blockAssigned?: boolean;
};

function filesUrl(query: string, productId?: string) {
  const params = new URLSearchParams({ q: query });
  if (productId) params.set("productId", productId);
  return `/api/files?${params}`;
}

function formatBytes(n: number | null) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Picks an existing .glb/.gltf out of Shopify Files.
 *
 * Deliberately not App Bridge's `resourcePicker`: that picker only knows about
 * products, variants and collections, so it cannot list Files at all. This is
 * the one selection flow in the app that has to stay app-owned, so it is built
 * from `s-modal` and `s-table` to match the admin's own picker as closely as
 * the component set allows.
 */
export function FilePickerDialog({
  open,
  onOpenChange,
  currentUrl,
  onSelect,
  productId,
  blockAssigned = false,
}: Props) {
  const t = useT("media");
  const tc = useT("common");
  const fetcher = useFetcher<{ files: FileItem[] }>();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const modalRef = useOverlay<OverlayElement>(open, () => onOpenChange(false));

  useEffect(() => {
    if (!open) return;
    fetcher.load(filesUrl(query, productId));
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      fetcher.load(filesUrl(query, productId));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const loading = fetcher.state !== "idle";
  const files = fetcher.data?.files ?? [];
  const selected = files.find((f) => f.id === selectedId);
  const isBlocked = (file: FileItem) =>
    blockAssigned && Boolean(file.assignedTo);

  function handleConfirm() {
    if (selected && !isBlocked(selected)) {
      onSelect(selected);
      onOpenChange(false);
    }
  }

  return (
    <s-modal
      ref={modalRef as never}
      id="file-picker"
      heading={t("filePickerHeading")}
      size="large"
      accessibilityLabel={t("filePickerHeading")}
    >
      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">
          {t("filePickerIntro")}
          {blockAssigned ? ` ${t("filePickerBlockedNote")}` : ""}
        </s-paragraph>

        <s-search-field
          label={t("searchFiles")}
          labelAccessibilityVisibility="exclusive"
          placeholder={t("searchByFilename")}
          value={query}
          onInput={(e) => setQuery(fieldValue(e))}
        />

        {loading && files.length === 0 ? (
          <s-stack direction="block" gap="small" alignItems="center">
            <CubeLoader label={t("loadingFiles")} />
            <s-text color="subdued">{t("loadingFilesEllipsis")}</s-text>
          </s-stack>
        ) : files.length === 0 ? (
          <s-text color="subdued">{t("noModelFiles")}</s-text>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header />
              <s-table-header listSlot="primary">{t("colFile")}</s-table-header>
              <s-table-header format="numeric">{t("colSize")}</s-table-header>
              <s-table-header>{t("colStatus")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {files.map((file) => {
                const isCurrent = currentUrl === file.url;
                const blocked = isBlocked(file);
                return (
                  <s-table-row key={file.id}>
                    <s-table-cell>
                      {/*
                        A radio-style single choice expressed as a checkbox: the
                        component set has no standalone radio, and s-choice-list
                        cannot be spread across table cells. Selecting one row
                        replaces the selection rather than adding to it.
                      */}
                      <s-checkbox
                        accessibilityLabel={t("selectFile", { name: file.name })}
                        checked={flag(file.id === selectedId)}
                        disabled={flag(blocked)}
                        onInput={() =>
                          setSelectedId(file.id === selectedId ? null : file.id)
                        }
                      />
                    </s-table-cell>
                    <s-table-cell>{file.name}</s-table-cell>
                    <s-table-cell>{formatBytes(file.size)}</s-table-cell>
                    <s-table-cell>
                      {isCurrent ? (
                        <s-badge tone="info">{t("current")}</s-badge>
                      ) : file.assignedTo ? (
                        <s-badge tone="warning">
                          {t("inUseOn", { title: file.assignedTo.title })}
                        </s-badge>
                      ) : null}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-stack>

      <ModalAction
        slot="primary-action"
        variant="primary"
        disabled={!selected || isBlocked(selected)}
        onClick={handleConfirm}
      >
        {t("assignSelected")}
      </ModalAction>
      <ModalAction slot="secondary-actions" onClick={() => onOpenChange(false)}>
        {tc("cancel")}
      </ModalAction>
    </s-modal>
  );
}
