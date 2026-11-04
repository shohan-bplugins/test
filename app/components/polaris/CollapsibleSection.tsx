import { useState, type ReactNode } from "react";

import { fieldValue } from "~/components/polaris/helpers";

/**
 * An s-section whose header opens and closes it, for the product page's
 * aside column — collapsing the cards a merchant isn't working on keeps the
 * one they are on in view.
 *
 * s-section's own heading can't toggle, so the header is drawn here, and the
 * open card is ringed in the admin's selection blue: neither s-section nor
 * s-box takes a coloured border or background. Hovering or focusing the
 * header previews that same look.
 *
 * Uncontrolled by default; pass `open` and `onOpenChange` to drive it from
 * outside (the product page's Expand all / Collapse all).
 *
 * Always its own card. Put several in a CollapsibleGroup to set the space
 * between them — s-page spaces its aside cards itself, and the app can't
 * change that.
 *
 * The header is a plain <button>, not s-clickable: s-clickable paints its own
 * grey hover inside its shadow root, which would sit on top of the blue.
 */
export function CollapsibleSection({
  heading,
  summary,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  slot,
  hidden = false,
  children,
}: {
  heading: string;
  /** One line under the heading, shown open or closed (a count, a file name…). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  slot?: "aside";
  /** Left out of the page, keeping its open state (the settings search). */
  hidden?: boolean;
  children: ReactNode;
}) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = openProp ?? ownOpen;
  const toggle = () => {
    setOwnOpen(!open);
    onOpenChange?.(!open);
  };
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const lit = open || hover || focus;
  if (hidden) return null;
  return (
    <s-section slot={slot} padding="none" accessibilityLabel={heading}>
      <div
        style={{
          borderRadius: 12,
          boxShadow: lit ? "inset 0 0 0 2px #005bd3" : undefined,
          background: lit ? "#f4f8fe" : undefined,
          transition: "box-shadow 120ms ease, background 120ms ease",
        }}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          // Keyboard focus only: a mouse click would otherwise leave the card
          // lit after the pointer has moved away.
          onFocus={(e) => setFocus(e.currentTarget.matches(":focus-visible"))}
          onBlur={() => setFocus(false)}
          style={{
            all: "unset",
            boxSizing: "border-box",
            display: "block",
            inlineSize: "100%",
            padding: 16,
            borderRadius: 12,
            cursor: "pointer",
          }}
        >
          <s-grid
            gridTemplateColumns="1fr auto"
            gap="small"
            alignItems="center"
          >
            <s-stack gap="small-300">
              <s-heading>{heading}</s-heading>
              {summary ? <s-text color="subdued">{summary}</s-text> : null}
            </s-stack>
            <s-icon type={open ? "chevron-up" : "chevron-down"} />
          </s-grid>
        </button>
        {open ? (
          <s-box paddingInline="base" paddingBlockEnd="base">
            {children}
          </s-box>
        ) : null}
      </div>
    </s-section>
  );
}

/**
 * Stacks CollapsibleSections (given no `slot`) 16px apart, in one slot of the
 * page. A plain div, so the gap is the app's own and not s-page's.
 */
export function CollapsibleGroup({
  label,
  slot,
  children,
}: {
  /** Names the group for screen readers; nothing is shown. */
  label: string;
  slot?: "aside";
  children: ReactNode;
}) {
  return (
    <div
      slot={slot}
      role="group"
      aria-label={label}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {children}
    </div>
  );
}

/**
 * "Expand all" and "Collapse all" as icon buttons across the top of a
 * CollapsibleGroup, with an optional search field filling the rest of the row.
 * Plain <button>s: they take the cards' blue on hover. Each is disabled when
 * there is nothing left for it to do; the label is its tooltip and its name
 * for screen readers.
 */
export function CollapsibleGroupToggle({
  allOpen,
  allClosed,
  expandLabel,
  collapseLabel,
  onExpand,
  onCollapse,
  search,
}: {
  allOpen: boolean;
  allClosed: boolean;
  expandLabel: string;
  collapseLabel: string;
  onExpand: () => void;
  onCollapse: () => void;
  search?: {
    label: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
  };
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: search ? "1fr auto auto" : "auto auto",
        justifyContent: search ? undefined : "end",
        alignItems: "center",
        gap: 8,
      }}
    >
      {search ? (
        <s-search-field
          label={search.label}
          labelAccessibilityVisibility="exclusive"
          placeholder={search.placeholder}
          value={search.value}
          onInput={(e) => search.onChange(fieldValue(e))}
        />
      ) : null}
      <BarButton
        icon="chevron-down"
        label={expandLabel}
        disabled={allOpen}
        onClick={onExpand}
      />
      <BarButton
        icon="chevron-up"
        label={collapseLabel}
        disabled={allClosed}
        onClick={onCollapse}
      />
    </div>
  );
}

function BarButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: "chevron-down" | "chevron-up";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const lit = hover && !disabled;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={label}
      title={label}
      style={{
        // `all: unset` also resets display to inline; set it back here.
        all: "unset",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        inlineSize: 32,
        blockSize: 32,
        borderRadius: 8,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        color: lit ? "#005bd3" : "#303030",
        background: lit ? "#f4f8fe" : "#fff",
        boxShadow: lit ? "inset 0 0 0 2px #005bd3" : "inset 0 0 0 1px #e3e3e3",
        transition:
          "box-shadow 120ms ease, background 120ms ease, color 120ms ease",
      }}
    >
      <s-icon type={icon} size="small" />
    </button>
  );
}
