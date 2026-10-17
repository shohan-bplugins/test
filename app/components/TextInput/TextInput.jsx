/**
 * TextInput — labelled single-line field.
 *
 * Wraps Polaris' `TextField`. The prop contract is kept so the 13 existing call
 * sites work unchanged, but two things are gone because the field covers them
 * natively:
 *
 *   • the conic-gradient "loading" border — use `disable` and let the field
 *     read as disabled
 *   • `style` / `labelStyle` / `inputStyle` — every call site passed the same
 *     layout boilerplate (`display: grid`, `maxWidth: 100%`, margins) purely to
 *     make the old hand-rolled markup stack. The s-* fields lay themselves out,
 *     so these are accepted and ignored rather than churning the call sites.
 */
import { useState } from "react";
import { TextField, Button } from "@shopify/polaris";
import { HideIcon, ViewIcon } from "@shopify/polaris-icons";

const TextInput = ({
  type = "text",
  label,
  value,
  onChange,
  placeholder,
  requiredIndicator,
  disable,
  multiline,
  minLength,
  maxLength,
  error,
  helpText,
}) => {
  // `type="password"` gets a reveal toggle. Masked input is the right default
  // for a field whose value is a secret, but this one is set by the merchant
  // for their own viewers rather than typed from memory, so they need to be
  // able to check what they entered. Revealing swaps the type rather than the
  // value, so nothing about the stored password changes.
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";

  return (
    <TextField
      type={isPassword && revealed ? "text" : type}
      label={label}
      value={value ?? ""}
      onChange={(newValue) => onChange(newValue)}
      placeholder={placeholder || label}
      requiredIndicator={requiredIndicator}
      disabled={disable}
      multiline={multiline}
      minLength={minLength}
      maxLength={maxLength}
      error={error}
      helpText={helpText}
      suffix={
        isPassword ? (
          <Button
            variant="plain"
            icon={revealed ? HideIcon : ViewIcon}
            onClick={() => setRevealed((shown) => !shown)}
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            disabled={disable}
          />
        ) : undefined
      }
      autoComplete="off"
    />
  );
};

export default TextInput;
