// Open/close a modal by id. Media pickers are Polaris <s-modal> elements
// (opened through the element itself); anything still on App Bridge's
// <ui-modal> goes through shopify.modal.
export function showModal(id) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el?.showOverlay) el.showOverlay();
  else if (typeof shopify !== "undefined") shopify.modal.show(id);
}

export function hideModal(id) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el?.hideOverlay) el.hideOverlay();
  else if (typeof shopify !== "undefined") shopify.modal.hide(id);
}
