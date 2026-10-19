import React, { useEffect, useId, useRef } from "react";
import { useWebComponentEvent } from "../../utils/useWebComponentEvent";

// Controlled <s-modal> with the same props the app used on Polaris React's
// Modal (open / onClose / title / size / primaryAction / secondaryActions), so
// call sites only swap the import. Children render only while open, so an
// embedded video stops when the modal closes.
function actionButton(action, slot, key) {
  return (
    <s-button
      key={key}
      slot={slot}
      variant={slot === "primary-action" ? "primary" : undefined}
      tone={action.destructive ? "critical" : undefined}
      loading={action.loading || undefined}
      disabled={action.disabled || undefined}
      onClick={action.onAction}
    >
      {action.content}
    </s-button>
  );
}

export default function Modal({
  open = false,
  onClose,
  title,
  size,
  primaryAction,
  secondaryActions = [],
  children,
  id,
  ...props
}) {
  const ref = useRef(null);
  // In the embedded admin, s-modal opens and closes through App Bridge by id,
  // so a modal without one can be opened but never closed.
  const autoId = `modal-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    customElements.whenDefined("s-modal").then(() => {
      const el = ref.current;
      if (cancelled || !el) return;
      if (open) el.showOverlay?.();
      else el.hideOverlay?.();
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Esc, the close button and backdrop clicks all end in `hide`.
  useWebComponentEvent(ref, "hide", () => {
    if (open) onClose?.();
  });

  return (
    <s-modal
      ref={ref}
      id={id || autoId}
      heading={title}
      size={size === "large" ? "large" : undefined}
      {...props}
    >
      {open ? children : null}
      {primaryAction ? actionButton(primaryAction, "primary-action") : null}
      {secondaryActions.map((a, i) =>
        actionButton(a, "secondary-actions", i),
      )}
    </s-modal>
  );
}

Modal.Section = function ModalSection({ children }) {
  return <>{children}</>;
};
