import { useRouteNav } from "~/components/polaris/helpers";

/**
 * The page's breadcrumb: a link back to its parent, labelled with the parent's
 * name — the "Products" in Shopify's own `Products > Bag`.
 *
 * `to` is required, and is always a fixed parent rather than `navigate(-1)`.
 * History-back is not a breadcrumb: it returns wherever the merchant happened
 * to arrive from, so the same page leads somewhere different every visit, and
 * after a redirect — the billing return, an OAuth bounce — the previous entry
 * is outside the app entirely and "back" leaves it. A breadcrumb has to name
 * one fixed place in the hierarchy, which is also what makes it announceable:
 * "Back to Products" tells a screen reader user where they are, "Go back"
 * does not.
 *
 * Rendered into `s-page`'s `breadcrumb-actions` slot, so the admin places and
 * styles it exactly as it does on its own pages.
 *
 * `s-link`, not `s-button`: that slot accepts only Link elements and rejects
 * everything else outright. What the page finally paints is not this element
 * anyway — Polaris reads the href, label and children off it and renders its
 * own link in the header, followed by the chevron divider, forwarding clicks
 * back here so the router still handles them. That is also why there is no
 * `arrow-left` icon any more: the admin draws the breadcrumb's own affordance,
 * and an `s-icon` child would be taken as a request to *replace* the text with
 * that icon rather than to sit beside it.
 */
export function BackButton({
  to,
  label,
  showLabel = true,
}: {
  /** The parent page's path. */
  to: string;
  /** The parent page's name, as the merchant knows it. */
  label: string;
  /** Set false for an icon-only breadcrumb, still announced in full. */
  showLabel?: boolean;
}) {
  const routeTo = useRouteNav();
  return (
    <s-link
      slot="breadcrumb-actions"
      // A real href, so middle-click and "copy link address" behave; the
      // handler keeps an ordinary click inside the client-side router.
      href={to}
      accessibilityLabel={`Back to ${label}`}
      onClick={routeTo(to)}
    >
      {showLabel ? label : <s-icon type="arrow-left" />}
    </s-link>
  );
}
