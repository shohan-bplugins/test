import React from "react";
import { WebNumberField, WebTextField } from "../PolarisWeb/fields";

// Text (or number / url) field. Legacy style props are accepted but ignored.
const TextInput = ({ type = "text", label = "", value, onChange }) => {
  if (type === "number") {
    return (
      <WebNumberField
        label={label}
        value={value ?? ""}
        onChange={(v) => onChange?.(v)}
      />
    );
  }
  return (
    <WebTextField
      tag={type === "url" ? "s-url-field" : "s-text-field"}
      label={label}
      value={value ?? ""}
      autocomplete="off"
      onChange={(v) => onChange?.(v)}
    />
  );
};

export default TextInput;
