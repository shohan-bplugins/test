import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useNavigate } from "react-router";

/*
 * Shared plumbing for Polaris web components (the `s-*` elements defined by
 * Shopify's polaris.js) under React 18.
 *
 * React 18 predates custom-element support in react-dom, and two of its gaps
 * are silent rather than loud. Both are verified against the copy of react-dom
 * in node_modules, not assumed:
 *
 *   1. `onChange` never fires. React routes onChange through ChangeEventPlugin,
 *      whose extractEvents only picks a handler for <select>, <input type=file>,
 *      text inputs and checkbox/radio (react-dom.development.js, extractEvents$1).
 *      A custom element matches none of them, so the prop is simply dropped.
 *      `input` *is* in simpleEventPluginEvents, so `onInput` is delivered to any
 *      element — hence every field below listens on input, never change.
 *
 *   2. Boolean `false` becomes the string "false". On a custom element React
 *      only removes an attribute for null/undefined (shouldRemoveAttribute);
 *      anything else is stringified. `disabled={false}` therefore renders
 *      disabled="false", and a boolean attribute is true whenever it is
 *      present. `flag()` below is the fix, and it is not optional.
 *
 * If this app ever moves to React 19 — which sets properties on custom elements
 * and forwards arbitrary events — `flag` and `useCustomEvent` become no-ops
 * worth deleting, and onInput can go back to onChange. Until then, everything
 * here is load-bearing.
 */

/**
 * Render a boolean attribute only when it is true.
 *
 * `disabled={flag(isBusy)}` is correct; `disabled={isBusy}` disables the
 * control permanently the moment isBusy is false. See note 2 above.
 */
export function flag(value: boolean | undefined): true | undefined {
  return value ? true : undefined;
}

/**
 * Read the current value out of an `input`/`change` event fired by a Polaris
 * field. The event target is the s-* element itself, which mirrors its value to
 * a `value` property.
 */
export function fieldValue(event: Event): string {
  const target = event.currentTarget as (HTMLElement & { value?: string }) | null;
  return target?.value ?? "";
}

/**
 * Read the checked state out of an event from s-switch / s-checkbox.
 */
export function fieldChecked(event: Event): boolean {
  const target = event.currentTarget as
    | (HTMLElement & { checked?: boolean })
    | null;
  return Boolean(target?.checked);
}

/**
 * Subscribe to a DOM event React 18 will not forward.
 *
 * Only events in react-dom's simpleEventPluginEvents list (click, input, focus,
 * keydown, …) reach a custom element through JSX. Everything Polaris and App
 * Bridge define on top of those — a modal's `hide`, a banner's `dismiss` — has
 * to be bound by hand, or React will stringify the handler into an inert
 * `onhide="function () { … }"` attribute.
 */
export function useCustomEvent<T extends HTMLElement>(
  ref: RefObject<T | null>,
  eventName: string,
  handler: ((event: Event) => void) | undefined
) {
  // Kept in a ref so re-rendering with a fresh closure does not detach and
  // reattach the listener on every render.
  const saved = useRef(handler);
  useEffect(() => {
    saved.current = handler;
  }, [handler]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !handler) return;
    const listener = (event: Event) => saved.current?.(event);
    node.addEventListener(eventName, listener);
    return () => node.removeEventListener(eventName, listener);
    // `handler` is only read to decide whether to bind at all; the ref carries
    // the current one, so identity changes must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, eventName, Boolean(handler)]);
}

/**
 * Keep an `href` on a Polaris link or button inside the client-side router.
 *
 * The admin is a single embedded document: letting an anchor navigate normally
 * tears down the React tree and re-runs the whole App Bridge handshake, which
 * is the "full page reload" Built for Shopify explicitly checks for. Rendering
 * the real href anyway (rather than a bare onClick) is what keeps middle-click,
 * cmd-click and "copy link address" working, so the guard below deliberately
 * lets modified clicks fall through to the browser.
 */
export function useRouteNav() {
  const navigate = useNavigate();
  return useCallback(
    (to: string) => (event: Event) => {
      const mouse = event as MouseEvent;
      if (
        mouse.metaKey ||
        mouse.ctrlKey ||
        mouse.shiftKey ||
        mouse.altKey ||
        mouse.button === 1
      ) {
        return;
      }
      event.preventDefault();
      navigate(to);
    },
    [navigate]
  );
}

/**
 * `inlineSize="fill"` for a Polaris button.
 *
 * The Button *element* accepts `inlineSize: 'auto' | 'fill' | 'fit-content'`,
 * but its React binding is typed from a narrowed prop set that leaves the
 * property out, so it cannot be written as an ordinary JSX prop. Spread instead:
 *
 *   <s-button {...BUTTON_FILL}>Add</s-button>
 *
 * Without it a button always shrink-wraps its label, which is why two buttons
 * with different words come out different widths even inside a fixed grid
 * track — a grid item only stretches when its own size is `auto`.
 *
 * Cast because the omission is in the typings, not the component: the attribute
 * is real and documented on the element.
 */
export const BUTTON_FILL = { inlineSize: "fill" } as any;

/** The imperative half of an overlay element (`s-modal`, `s-menu`, …). */
export type OverlayElement = HTMLElement & {
  showOverlay?: () => void;
  hideOverlay?: () => void;
};

/**
 * Drive a Polaris overlay from React state.
 *
 * Returns a ref to put on the `s-modal`. Three things this handles that a bare
 * pair of effects does not:
 *
 *  - `open` is applied through showOverlay()/hideOverlay(), never an attribute.
 *    React 18 stringifies booleans onto custom elements, so `open={false}`
 *    renders open="false" — present, and therefore true.
 *
 *  - It waits for the element to upgrade. If state opens the overlay before
 *    polaris.js has defined it, `showOverlay` does not exist yet; calling it
 *    optionally is silent, and the effect never runs again, so the dialog stays
 *    shut forever. whenDefined re-applies once the definition lands.
 *
 *  - It listens for `hide`, which React does not forward, so dismissing via the
 *    X or the backdrop puts the caller's state back. Without it the state stays
 *    true, and the next attempt to open the same overlay does nothing.
 *
 *  - `onOpen` does the same for `show`, which matters when something *else*
 *    opens the overlay — a button elsewhere on the page using command/commandFor
 *    rather than this component's own state. Without it the overlay would appear
 *    while the owning component still believed it was closed, so anything keyed
 *    to opening (loading data, resetting a form) would never run.
 */
export function useOverlay<T extends OverlayElement>(
  open: boolean,
  onClose: () => void,
  onOpen?: () => void,
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      if (open) node.showOverlay?.();
      else node.hideOverlay?.();
    };

    if (typeof customElements !== "undefined" && !node.showOverlay) {
      // Settled either way — a rejected whenDefined still means "stop waiting".
      customElements.whenDefined(node.localName).then(apply, apply);
    } else {
      apply();
    }

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Held in a ref so a fresh closure each render does not detach and reattach
  // the listener, and so the effect below can run exactly once.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onHide = () => onCloseRef.current();
    const onShow = () => onOpenRef.current?.();
    node.addEventListener("hide", onHide);
    node.addEventListener("show", onShow);
    return () => {
      node.removeEventListener("hide", onHide);
      node.removeEventListener("show", onShow);
    };
  }, []);

  return ref;
}
