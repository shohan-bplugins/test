import React from "react";
import { WebSelect } from "../PolarisWeb/fields";

const SelectInput = ({
  label,
  options = [],
  value = "",
  onChange,
  name = "select_input",
  disabled = false,
}) => (
  <WebSelect
    label={label || name}
    labelAccessibilityVisibility={label ? undefined : "exclusive"}
    name={name}
    value={value}
    options={options}
    disabled={disabled || undefined}
    onChange={(v) => onChange?.(v)}
  />
);

export default SelectInput;
