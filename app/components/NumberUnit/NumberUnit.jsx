import React, { useEffect } from "react";
import { WebNumberField, WebSelect } from "../PolarisWeb/fields";

const isMissing = (value) =>
  value === undefined ||
  value === null ||
  value === "" ||
  !Number.isFinite(parseFloat(value));

const splitValue = (value, fallbackUnit = "px") => {
  const str = String(value ?? "");
  const number = parseFloat(str);
  return {
    number: Number.isFinite(number) ? number : 0,
    // Unit = trailing letters/% after the number (e.g. "12px" -> "px").
    unit: str.match(/\d\s*([a-z%]+)\s*$/i)?.[1] || fallbackUnit,
  };
};

// Number + unit picker. Value in and out is a CSS length string ("12px").
const NumberUnit = ({
  label,
  options = [],
  value = "0px",
  onChange,
  min = 0,
  max = 1000,
  details = "",
  isProFeature = false,
  isProUser = true,
}) => {
  const locked = isProFeature && !isProUser;
  const fallbackUnit = options.some((o) => o.value === "px")
    ? "px"
    : options[0]?.value || "px";
  const { number, unit } = splitValue(value, fallbackUnit);

  // A missing value reports a real "0<unit>" once, so the preview CSS never
  // gets "undefined" (the previous control did this on every mount).
  useEffect(() => {
    if (isMissing(value)) onChange?.(`0${fallbackUnit}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <s-stack gap="small-300">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-text>{label}</s-text>
        {locked ? <s-badge tone="success">PRO</s-badge> : null}
      </s-stack>
      <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="small-200">
        <WebNumberField
          label={label}
          labelAccessibilityVisibility="exclusive"
          value={String(number)}
          min={min || 0}
          max={max}
          disabled={locked || undefined}
          onChange={(v) => {
            const n = parseFloat(v);
            if (!Number.isNaN(n) && n >= (min || 0)) onChange?.(`${n}${unit}`);
          }}
        />
        {options.length ? (
          <WebSelect
            label={`${label} unit`}
            labelAccessibilityVisibility="exclusive"
            value={unit}
            options={options}
            disabled={locked || undefined}
            onChange={(u) => onChange?.(`${number}${u}`)}
          />
        ) : null}
      </s-grid>
      {/* Help text under the row keeps the number and unit fields aligned. */}
      {details ? <s-text color="subdued">{details}</s-text> : null}
    </s-stack>
  );
};

export default NumberUnit;
