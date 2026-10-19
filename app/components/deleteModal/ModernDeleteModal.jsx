import { Modal, TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect } from "react";
import {
  Box,
  BlockStack,
  InlineStack,
  Banner,
  Text,
  Icon,
  Badge,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import { appBridge } from "../../utils/appBridge";

const MODAL_ID = "modern-delete-modal";

/**
 * ModernDeleteModal - delete confirmation, built entirely from Polaris web
 * components inside an App Bridge <ui-modal>.
 *
 * @param {boolean} open - Whether the modal is open
 * @param {function} onClose - Callback to close the modal
 * @param {function} onConfirm - Callback to trigger the deletion
 * @param {Array} selectedItems - Array of video objects to delete
 * @param {boolean} isBulk - Whether this is a bulk deletion
 */
export default function ModernDeleteModal({
  open,
  onClose,
  onConfirm,
  selectedItems = [],
  isBulk = false,
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  // Reset when the modal closes.
  useEffect(() => {
    if (open) return;
    setIsDeleting(false);
  }, [open]);

  const handleConfirm = useCallback(() => {
    setIsDeleting(true);
    onConfirm();
  }, [onConfirm]);

  const itemCount = isBulk ? selectedItems.length : 1;
  const itemName = itemCount === 1 ? "video player" : "video players";
  const canDelete = !isDeleting;

  // The dialog is an App Bridge <ui-modal>, shown and hidden imperatively by
  // id. The `open` prop stays the source of truth, so callers are unchanged.
  useEffect(() => {
    // Guarded: this runs at hydration, when `window.shopify` may not exist yet.
    // An unguarded reference here threw a ReferenceError inside <Await>, which
    // is why the whole videos page died before anything rendered.
    const bridge = appBridge();
    if (!bridge) return;
    if (open) bridge.modal.show(MODAL_ID);
    else bridge.modal.hide(MODAL_ID);
  }, [open]);

  // Esc and the dialog's own close button never route through onClose, so
  // without this `open` would stay true and the modal could not reopen.
  useEffect(() => {
    const el = document.getElementById(MODAL_ID);
    if (!el) return;
    el.addEventListener("hide", onClose);
    return () => el.removeEventListener("hide", onClose);
  }, [onClose]);

  const summary = isBulk
    ? selectedItems
        .slice(0, 3)
        .map((i) => i.title || "Untitled")
        .join(", ") +
      (selectedItems.length > 3 ? ` +${selectedItems.length - 3} more` : "")
    : selectedItems[0]?.title || "Untitled Player";

  return (
    <Modal id={MODAL_ID}>
      {/* The two <button>s are App Bridge's own API for declaring a modal's
          actions — TitleBar takes plain buttons, not components. */}
      <TitleBar
        title={isBulk ? "Delete Selected Players?" : "Delete Video Player?"}
      >
        <button
          variant="primary"
          tone="critical"
          onClick={handleConfirm}
          disabled={canDelete ? undefined : true}
        >
          {isDeleting
            ? "Deleting..."
            : `Delete ${isBulk ? "players" : "player"}`}
        </button>
        <button onClick={onClose} disabled={isDeleting ? true : undefined}>
          Cancel
        </button>
      </TitleBar>

      <Box padding="400">
        <BlockStack gap="400">
          <Banner tone="warning" title="This is a permanent action">
            <Text as="p">
              All associated settings and configurations will be removed from
              your store.
            </Text>
          </Banner>

          {/* What is about to be deleted. */}
          <Box
            padding="400"
            borderRadius="200"
            background="bg-surface-secondary"
          >
            <InlineStack align="space-between" blockAlign="center" gap="400">
              <InlineStack blockAlign="center" gap="300">
                <Icon source={DeleteIcon} tone="critical" />
                <BlockStack gap="0">
                  <Text fontWeight="bold" as="span">
                    {itemCount} {itemName} selected
                  </Text>
                  <Text tone="subdued" as="span">
                    {summary}
                  </Text>
                </BlockStack>
              </InlineStack>
              {isDeleting && <Badge tone="critical">Deleting</Badge>}
            </InlineStack>
          </Box>

          <Text as="p">
            Deleting{" "}
            {isBulk ? "all selected video players" : "this video player"} will{" "}
            <Text fontWeight="bold" as="span">
              permanently remove them
            </Text>{" "}
            and all associated settings. This action can&rsquo;t be undone.
          </Text>
        </BlockStack>
      </Box>
    </Modal>
  );
}
