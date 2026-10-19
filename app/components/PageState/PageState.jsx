import React from "react";

// Shared page states, so every page's "nothing here", "loading" and
// "something went wrong" look the same. Polaris web components only.

export const EMPTY_IMAGE =
  "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";

// Nothing to show yet: illustration, heading, explanation and next step.
// `action` / `secondaryAction` are elements (usually <s-button>).
export function EmptyState({
  heading,
  message,
  action = null,
  secondaryAction = null,
  image = EMPTY_IMAGE,
  compact = false,
}) {
  return (
    <s-box padding={compact ? "base" : "large"}>
      <s-stack gap="base" alignItems="center">
        {image ? (
          <s-box maxInlineSize={compact ? "120px" : "226px"}>
            <s-image src={image} alt="" aspectRatio="1/1"></s-image>
          </s-box>
        ) : null}
        <s-stack gap="small-200" alignItems="center">
          <s-heading>{heading}</s-heading>
          {message ? (
            <s-paragraph color="subdued">{message}</s-paragraph>
          ) : null}
        </s-stack>
        {action || secondaryAction ? (
          <s-stack direction="inline" gap="small-200" justifyContent="center">
            {action}
            {secondaryAction}
          </s-stack>
        ) : null}
      </s-stack>
    </s-box>
  );
}

// Something failed. `onRetry` shows "Try again"; `onSupport` shows
// "Contact support"; `showHome` links back to the Dashboard.
export function ErrorState({
  heading = "Something went wrong",
  message = "We couldn't load this. Please try again — if it keeps happening, contact support.",
  onRetry,
  retrying = false,
  onSupport,
  showHome = true,
}) {
  return (
    <s-box padding="large">
      <s-stack gap="base" alignItems="center">
        <s-icon type="alert-circle" tone="critical"></s-icon>
        <s-stack gap="small-200" alignItems="center">
          <s-heading>{heading}</s-heading>
          <s-paragraph color="subdued">{message}</s-paragraph>
        </s-stack>
        <s-stack direction="inline" gap="small-200" justifyContent="center">
          {onRetry ? (
            <s-button
              variant="primary"
              icon="refresh"
              loading={retrying || undefined}
              onClick={onRetry}
            >
              Try again
            </s-button>
          ) : null}
          {onSupport ? (
            <s-button icon="email" onClick={onSupport}>
              Contact support
            </s-button>
          ) : null}
          {showHome ? (
            <s-button
              icon="home"
              variant={onRetry ? undefined : "primary"}
              href="/app"
            >
              Back to Dashboard
            </s-button>
          ) : null}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

// Waiting on data that has no skeleton of its own.
export function LoadingState({ label = "Loading…" }) {
  return (
    <s-box padding="large">
      <s-stack gap="small" alignItems="center">
        <s-spinner size="large" accessibilityLabel={label}></s-spinner>
        <s-text color="subdued">{label}</s-text>
      </s-stack>
    </s-box>
  );
}
