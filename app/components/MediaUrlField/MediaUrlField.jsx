import React from "react";
import { WebTextField } from "../PolarisWeb/fields";
import { showModal } from "../../utils/modal";

// URL field + "Upload" button that opens a media picker modal (audio or
// image picker). Replaces the hand-built `div.FileUpload` blocks.
export default function MediaUrlField({
  label,
  value = "",
  onChange,
  onUploadClick,
  modalId,
  placeholder = "Paste a URL or upload a file",
  buttonLabel = "",
  details,
  required = false,
}) {
  const openPicker = () => {
    if (onUploadClick) onUploadClick();
    else if (modalId) showModal(modalId);
  };

  // Help text sits under the input + button row so the Upload button stays
  // aligned with the input box.
  return (
    <s-stack gap="small-300">
      <s-grid
        gridTemplateColumns="minmax(0, 1fr) auto"
        gap="small"
        alignItems="end"
      >
        <WebTextField
          tag="s-url-field"
          label={label}
          value={value || ""}
          placeholder={placeholder}
          required={required || undefined}
          autocomplete="off"
          onChange={(v) => onChange?.(v)}
        />
        <s-button icon="upload" onClick={openPicker}>
          {buttonLabel}
        </s-button>
      </s-grid>
      {details ? <s-text color="subdued">{details}</s-text> : null}
    </s-stack>
  );
}
