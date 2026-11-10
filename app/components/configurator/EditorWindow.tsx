import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

/*
 * App Bridge types <s-app-window> without a `ref`, but the element's show()
 * is the only way to open it — so it is rendered through an untyped alias.
 */
const AppWindow = "s-app-window" as unknown as React.ElementType;

type AppWindowElement = HTMLElement & {
  src?: string;
  show?: () => Promise<void>;
};

/** Crisp's launcher would sit on top of the editor window, so hide it while open. */
function setChatVisible(visible: boolean) {
  const crisp = (window as { $crisp?: unknown[] }).$crisp;
  crisp?.push(["do", visible ? "chat:show" : "chat:hide"]);
}

/**
 * Opens the 3D editor (/app/products/:id/editor) in an App Bridge
 * <s-app-window> — the admin's full-screen window for one app page.
 *
 * Returns the element to render once on the page and an
 * `open(productId, variantId?)`; with a variant the editor sets up only that one.
 * When the window closes, the page's loaders re-run, so a save made in the
 * editor shows up behind it (publish state, option groups…).
 */
export function useEditorWindow() {
  const ref = useRef<AppWindowElement | null>(null);
  const revalidator = useRevalidator();
  const [request, setRequest] = useState<{ id: string; variant?: string; n: number } | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onHide = () => {
      setChatVisible(true);
      revalidator.revalidate();
    };
    node.addEventListener("hide", onHide);
    return () => node.removeEventListener("hide", onHide);
  }, [revalidator]);

  // Show after React has written the new src, so the window opens on the
  // right product. The counter re-opens the same product after a close.
  useEffect(() => {
    const node = ref.current;
    if (!request || !node) return;
    const show = () => node.show?.();
    if (typeof customElements !== "undefined" && !node.show) {
      customElements.whenDefined("s-app-window").then(show, () => {});
    } else {
      show();
    }
  }, [request]);

  const src = request
    ? `/app/products/${request.id}/editor${request.variant ? `?variant=${request.variant}` : ""}`
    : "/app";

  return {
    open: (productId: string, variantId?: string) => {
      setChatVisible(false);
      setRequest((r) => ({ id: productId, variant: variantId, n: (r?.n ?? 0) + 1 }));
    },
    element: <AppWindow ref={ref} id="editor-3d-window" src={src} />,
  };
}
