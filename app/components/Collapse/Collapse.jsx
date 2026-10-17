import React, { useState } from "react";

// Settings section with a clickable header that shows/hides its controls.
// `height`/`unit` are accepted for compatibility; content now sizes itself.
const Collapse = ({
  title,
  children,
  pro = false,
  defaultOpen = false,
  leftIcon,
  activeOption = "",
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <s-box border="base" borderRadius="base" background="base">
      <s-clickable
        padding="small"
        borderRadius="base"
        accessibilityLabel={`${isOpen ? "Hide" : "Show"} ${title}`}
        onClick={() => setIsOpen((o) => !o)}
      >
        <s-grid
          gridTemplateColumns="minmax(0, 1fr) auto auto"
          gap="small"
          alignItems="center"
        >
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {leftIcon}
            <s-text type="strong">{title}</s-text>
            {pro ? <s-badge tone="info">Pro</s-badge> : null}
          </s-stack>
          {activeOption === "" ? (
            <span />
          ) : (
            <s-badge tone={activeOption ? "info" : undefined}>
              {activeOption ? "Active" : "Inactive"}
            </s-badge>
          )}
          <s-icon type={isOpen ? "chevron-up" : "chevron-down"}></s-icon>
        </s-grid>
      </s-clickable>
      {isOpen ? (
        <s-box padding="small" paddingBlockStart="none">
          <s-stack gap="base">{children}</s-stack>
        </s-box>
      ) : null}
    </s-box>
  );
};

export default Collapse;
