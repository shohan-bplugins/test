import React from "react";

// Numbered "how it works" list: steps = [{ title, desc }] (desc may be JSX).
export default function HowItWorksSteps({ steps }) {
  return (
    <s-stack gap="base">
      {steps.map((step, i) => (
        <s-grid
          key={step.title}
          gridTemplateColumns="auto minmax(0, 1fr)"
          gap="small"
          alignItems="start"
        >
          <s-badge tone="info">{i + 1}</s-badge>
          <s-stack gap="small-500">
            <s-heading>{step.title}</s-heading>
            <s-paragraph color="subdued">{step.desc}</s-paragraph>
          </s-stack>
        </s-grid>
      ))}
    </s-stack>
  );
}
