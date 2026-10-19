import React from "react";

// Shown by the root ErrorBoundary for missing pages and unexpected errors.
const NotFound = ({
  heading = "Page not found",
  message = "The page you're looking for doesn't exist, was removed, or is temporarily unavailable.",
}) => (
  <s-box padding="large">
    <s-section>
      <s-stack gap="base" alignItems="center">
        <s-heading>{heading}</s-heading>
        <s-paragraph color="subdued">{message}</s-paragraph>
        <s-button variant="primary" icon="home" href="/app">
          Back to Dashboard
        </s-button>
      </s-stack>
    </s-section>
  </s-box>
);

export default NotFound;
