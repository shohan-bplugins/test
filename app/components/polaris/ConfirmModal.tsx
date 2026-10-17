import { useOverlay, type OverlayElement } from "./helpers";
import { ModalAction } from "./ModalAction";

/**
 * A confirmation dialog for destructive actions.
 *
 * Replaces `window.confirm`, which an embedded app must not use: the browser
 * renders it chrome-level, outside the admin iframe and with the app's origin
 * in the title, so it looks like a phishing prompt rather than part of Shopify.
 * Built for Shopify treats native dialogs as a review failure for that reason.
 *
 * Opening, closing and the `hide` event are all handled by useOverlay — see
 * there for why none of it can be done with an `open` attribute.
 *
 * Both actions are `ModalAction`, not a bare `s-button` with onClick — see
 * there for why a React click handler is inert inside a modal.
 */
export function ConfirmModal({
  id,
  open,
  heading,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "critical",
  loading,
  onConfirm,
  onCancel,
}: {
  id: string;
  open: boolean;
  heading: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "critical" | "neutral";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useOverlay<OverlayElement>(open, onCancel);

  return (
    <s-modal ref={ref as never} id={id} heading={heading} accessibilityLabel={heading}>
      {children}
      <ModalAction
        slot="primary-action"
        variant="primary"
        tone={tone}
        loading={loading}
        onClick={onConfirm}
      >
        {confirmLabel}
      </ModalAction>
      <ModalAction slot="secondary-actions" onClick={onCancel}>
        {cancelLabel}
      </ModalAction>
    </s-modal>
  );
}
