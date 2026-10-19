import { useState, createContext, useContext, useEffect } from "react";
import { useNavigate } from "@remix-run/react";
import {
  Box,
  InlineStack,
  Text,
  Badge,
  Icon,
  BlockStack,
  Tooltip,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  LockIcon,
} from "@shopify/polaris-icons";
import "./Collapse.css";

export const AccordionContext = createContext(null);

export const Accordion = ({ children, defaultOpenId = null }) => {
  const [openId, setOpenId] = useState(defaultOpenId);
  return (
    <AccordionContext.Provider value={{ openId, setOpenId }}>
      {children}
    </AccordionContext.Provider>
  );
};

/**
 * Collapse — an expandable settings section for the customizer sidebar.
 */
const Collapse = ({
  title,
  children,
  pro = false,
  toggleable = false,
  toggleLabel = "",
  toggleValue = false,
  toggleOnChange = () => {},
  defaultOpen = false,
  leftIcon,
  activeOption = "",
}) => {
  const accordion = useContext(AccordionContext);
  const [localIsOpen, setLocalIsOpen] = useState(defaultOpen);
  const [isHovered, setIsHovered] = useState(false);
  const navigate = useNavigate();

  // If inside an Accordion, we sync with it
  const isOpen = accordion ? accordion.openId === title : localIsOpen;

  // Initial sync for defaultOpen if inside Accordion
  useEffect(() => {
    if (accordion && defaultOpen && accordion.openId === null) {
      accordion.setOpenId(title);
    }
  }, []);

  const handleToggle = () => {
    if (accordion) {
      accordion.setOpenId(accordion.openId === title ? null : title);
    } else {
      setLocalIsOpen((open) => !open);
    }
  };

  return (
    <Box paddingBlockEnd="400">
      <Box
        background="bg-surface"
        borderRadius="200"
        shadow="100"
        overflowX="hidden"
        overflowY="hidden"
      >
        <div
          onClick={handleToggle}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${title}`}
          style={{
            cursor: "pointer",
            padding: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            outline: "none",
            background: isOpen
              ? "var(--p-color-bg-surface-secondary)"
              : isHovered
                ? "var(--p-color-bg-surface-hover)"
                : "transparent",
            transition: "background 0.2s ease",
          }}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleToggle();
            }
          }}
        >
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            {toggleable && (
              <div onClick={(e) => e.stopPropagation()}>
                <s-switch
                  label={toggleLabel || title}
                  labelAccessibilityVisibility="exclusive"
                  checked={toggleValue}
                  disabled={pro}
                  onChange={(event) => toggleOnChange(event.target.checked)}
                />
              </div>
            )}

            <InlineStack gap="300" blockAlign="center" wrap={false}>
              {leftIcon && <Box color="text-brand">{leftIcon}</Box>}
              <Text variant="headingSm" as="h3" fontWeight="semibold">
                {title}
              </Text>
            </InlineStack>
          </InlineStack>

          <InlineStack gap="300" blockAlign="center" wrap={false}>
            {pro && (
              <Tooltip content="Requires Pro Plan">
                <Badge tone="magic" icon={LockIcon}>
                  Pro
                </Badge>
              </Tooltip>
            )}
            {activeOption !== "" && (
              <Badge tone={activeOption ? "success" : "default"}>
                {activeOption ? "Active" : "Inactive"}
              </Badge>
            )}
            <Icon
              source={isOpen ? ChevronUpIcon : ChevronDownIcon}
              tone="subdued"
            />
          </InlineStack>
        </div>

        {isOpen && (
          <Box
            padding="400"
            borderBlockStartWidth="025"
            borderColor="border-secondary"
          >
            {pro ? (
              <div className="pro-wrapper">
                <BlockStack gap="400">{children}</BlockStack>
                {/* A real <button>, not a div with role="button": the div had
                    no keydown handler, so it took focus but could not be
                    activated from the keyboard. */}
                <button
                  type="button"
                  className="pro-overlay"
                  onClick={() => navigate("/app/pricing")}
                  aria-label={`Upgrade to Pro to unlock ${title}`}
                >
                  <span className="pro-label">Upgrade to Pro</span>
                </button>
              </div>
            ) : (
              <BlockStack gap="400">{children}</BlockStack>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default Collapse;
