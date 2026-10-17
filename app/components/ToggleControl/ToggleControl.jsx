import { WebSwitch } from "../PolarisWeb/fields";

// Labelled on/off switch (Polaris renders the label + help text beside the
// switch). Pro-only switches are disabled with a PRO badge on free plans.
export function ToggleControl({
  value = true,
  onChange = () => {},
  label,
  details = "",
  isProFeature = false,
  isProUser = true,
}) {
  const locked = isProFeature && !isProUser;
  return (
    <s-stack gap="small-300">
      <WebSwitch
        label={label}
        details={details || undefined}
        checked={!!value}
        disabled={locked || undefined}
        onChange={(checked) => onChange(checked)}
      />
      {locked ? (
        <s-stack direction="inline">
          <s-badge tone="success">PRO</s-badge>
        </s-stack>
      ) : null}
    </s-stack>
  );
}
