// Inline loading indicator (kept as a component so callers don't change).
export default function CustomLoader({ active = true }) {
  if (!active) return null;
  return <s-spinner size="base" accessibilityLabel="Loading"></s-spinner>;
}
