/**
 * ToggleControl — labelled on/off switch.
 *
 * A thin wrapper over <s-switch>. The prop contract is deliberately unchanged
 * so the ~25 call sites in the customizer and Onboarding keep working as-is:
 * `value` is the current boolean and `onChange` receives the new one, which is
 * what lets `onChange={setAutoPlay}` keep working.
 *
 * Two deliberate behaviour changes:
 *
 *   • `details` was a Polaris Tooltip hidden behind an info icon; it is now
 *     s-switch's own help text, rendered under the label. That is the
 *     Polaris-native treatment and does not require a hover to discover.
 *   • `detailsTone` therefore no longer applies — s-switch has no tone for
 *     help text. It is still accepted so existing call sites do not break.
 *
 * The s-box only exists to reproduce the 8px gap the old markup carried as a
 * margin; toggles are rendered as bare siblings inside <Collapse>.
 */
export function ToggleControl({
  value = true,
  onChange = () => {},
  label,
  details = "",
  // eslint-disable-next-line no-unused-vars -- accepted for call-site compatibility; see above
  detailsTone = "subdued",
  disabled = false,
}) {
  return (
    <s-switch
      label={label}
      details={details || undefined}
      checked={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
