import React, { useRef } from "react";
import { useWebComponentEvent } from "../../utils/useWebComponentEvent";

// Thin React wrappers for Polaris web component form fields. React 18 doesn't
// attach onChange-style props to custom elements, so each wrapper listens to
// the element's DOM event and hands back a plain value.

export function WebTextField({ onChange, tag = "s-text-field", ...props }) {
  const ref = useRef(null);
  useWebComponentEvent(ref, "input", (e) =>
    onChange?.(e.currentTarget.value ?? ""),
  );
  const Tag = tag;
  return <Tag ref={ref} {...props}></Tag>;
}

export function WebSearchField({ onChange, ...props }) {
  const ref = useRef(null);
  useWebComponentEvent(ref, "input", (e) =>
    onChange?.(e.currentTarget.value ?? ""),
  );
  return <s-search-field ref={ref} {...props}></s-search-field>;
}

// For fields that report a committed value on `change` (e.g. s-color-field).
export function WebChangeField({ onChange, tag, ...props }) {
  const ref = useRef(null);
  useWebComponentEvent(ref, "change", (e) =>
    onChange?.(e.currentTarget.value ?? ""),
  );
  const Tag = tag;
  return <Tag ref={ref} {...props}></Tag>;
}

export function WebSelect({ options = [], onChange, ...props }) {
  const ref = useRef(null);
  useWebComponentEvent(ref, "change", (e) =>
    onChange?.(e.currentTarget.value ?? ""),
  );
  return (
    <s-select ref={ref} {...props}>
      {options.map((o) => (
        <s-option key={o.value} value={o.value}>
          {o.label}
        </s-option>
      ))}
    </s-select>
  );
}

export function WebCheckbox({ checked, indeterminate, onChange, ...props }) {
  const ref = useRef(null);
  useWebComponentEvent(ref, "change", (e) =>
    onChange?.(e.currentTarget.checked),
  );
  return (
    <s-checkbox
      ref={ref}
      checked={checked || undefined}
      indeterminate={indeterminate || undefined}
      {...props}
    ></s-checkbox>
  );
}

export function WebSwitch({ checked, onChange, ...props }) {
  const ref = useRef(null);
  useWebComponentEvent(ref, "change", (e) =>
    onChange?.(e.currentTarget.checked),
  );
  return (
    <s-switch ref={ref} checked={checked || undefined} {...props}></s-switch>
  );
}

export function WebNumberField({ onChange, ...props }) {
  const ref = useRef(null);
  useWebComponentEvent(ref, "input", (e) =>
    onChange?.(e.currentTarget.value ?? ""),
  );
  return <s-number-field ref={ref} {...props}></s-number-field>;
}

// s-drop-zone reports picked/dropped files on `change` via element.files.
export function WebDropZone({ onDrop, children, ...props }) {
  const ref = useRef(null);
  useWebComponentEvent(ref, "change", (e) =>
    onDrop?.(Array.from(e.currentTarget.files ?? [])),
  );
  return (
    <s-drop-zone ref={ref} {...props}>
      {children}
    </s-drop-zone>
  );
}
