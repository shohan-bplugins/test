import { useRef, type ReactNode } from "react";

import { flag, useCustomEvent } from "./helpers";

/**
 * An action button in an `s-modal` footer.
 *
 * The click is bound with `useCustomEvent` — a listener on the element itself —
 * rather than a React `onClick`, and that is the whole point of this component.
 *
 * React 18 delivers click by delegation from its root container. `s-modal`
 * lifts its content into the browser's top layer, outside that container, so a
 * delegated listener never sees the click: the dialog opens, the buttons
 * render, and pressing one does nothing at all. No error, no request, nothing
 * to notice — which is how "Reset settings" and "Delete" on the model page
 * shipped inert. A listener bound straight to the element is not delegated and
 * fires wherever Polaris puts it.
 *
 * The same trap applies to any interactive control inside a modal. Page-level
 * actions (`slot` on `s-page`) are unaffected — they stay inside React's tree.
 *
 * On React 19 this becomes unnecessary; see the note at the top of helpers.tsx.
 */
export function ModalAction({
  slot,
  variant,
  tone,
  disabled,
  loading,
  onClick,
  children,
}: {
  slot: "primary-action" | "secondary-actions";
  variant?: "primary" | "secondary" | "tertiary";
  tone?: "critical" | "neutral" | "auto";
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);

  /*
   * Unbound entirely while disabled or busy, rather than guarded inside the
   * handler. A native listener does not inherit a disabled button's suppression
   * of click, so without this a "loading" primary action would happily submit
   * twice.
   */
  useCustomEvent(ref, "click", disabled || loading ? undefined : onClick);

  return (
    <s-button
      ref={ref as never}
      slot={slot}
      variant={variant}
      tone={tone}
      disabled={flag(disabled)}
      loading={flag(loading)}
    >
      {children}
    </s-button>
  );
}
