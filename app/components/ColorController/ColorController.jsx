import React from "react";
import { WebChangeField } from "../PolarisWeb/fields";

// Colour picker with a hex/rgba text input (Polaris s-color-field).
function ColorController({ label = "Color", value = "#ffffff", onChange }) {
  return (
    <WebChangeField
      tag="s-color-field"
      label={label}
      value={value}
      alpha
      onChange={(v) => v && onChange?.(v)}
    />
  );
}

export default ColorController;
