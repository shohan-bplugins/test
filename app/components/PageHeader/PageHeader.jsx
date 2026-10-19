import { useNavigation } from "@remix-run/react";
import { useGoBack } from "../../utils/useGoBack";
import { flag } from "../../utils/polarisWebComponents";
import "./PageHeader.css";

/**
 * Page header: back button, heading, optional subheading and actions.
 *
 * `title` is often a node rather than a string (several routes pass an
 * s-stack with a badge in it), so it is rendered as children rather than an
 * attribute.
 *
 * The back button used to be brand green. s-button renders into shadow DOM and
 * does not honour the --p-color-* overrides in theme-overrides.css, so it now
 * uses the admin's own button colours — see the note in
 * app/utils/polarisWebComponents.js. Its spinner is s-button's own `loading`
 * state, which replaces the hand-rolled .vp-back-spinner keyframe.
 */
export default function PageHeader({ title, subtitle, onBack, actions }) {
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const goBack = useGoBack();
  const handleBack = onBack || goBack;

  return (
    <s-box paddingBlockEnd="base">
      <s-grid
        gridTemplateColumns="auto 1fr auto"
        gap="small-300"
        alignItems="center"
      >
        <s-button
          variant="tertiary"
          icon="chevron-left"
          accessibilityLabel="Go back"
          loading={flag(isLoading)}
          disabled={isLoading}
          onClick={handleBack}
        />

        {title || subtitle ? (
          <s-stack direction="block" gap="small-100">
            {title ? <s-heading>{title}</s-heading> : <s-box />}
            {subtitle && <s-text color="subdued">{subtitle}</s-text>}
          </s-stack>
        ) : (
          <s-box />
        )}

        {actions ? <s-box>{actions}</s-box> : <s-box />}
      </s-grid>
    </s-box>
  );
}
