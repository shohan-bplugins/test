import { useEffect, useRef } from "react";

// React 18 doesn't attach `onChange`-style handlers to custom elements, so
// Polaris web components (s-select, s-search-field, s-checkbox…) need a real
// DOM listener. Always calls the latest handler without re-subscribing.
export function useWebComponentEvent(ref, eventName, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const listener = (event) => handlerRef.current?.(event);
    el.addEventListener(eventName, listener);
    return () => el.removeEventListener(eventName, listener);
  }, [ref, eventName]);
}
