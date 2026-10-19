import { TextField, Button, Icon } from "@shopify/polaris";
import { UploadIcon } from "@shopify/polaris-icons";

const UploadField = ({
  label,
  value,
  onChange,
  onPick,
  pickLabel,
  required = false,
  disabled = false,
}) => (
  <div>
    <TextField
      label={label}
      value={value ?? ""}
      onChange={onChange}
      requiredIndicator={required}
      disabled={disabled}
      autoComplete="off"
      connectedRight={
        <Button
          icon={<Icon source={UploadIcon} />}
          accessibilityLabel={pickLabel || `Choose ${label}`}
          disabled={disabled}
          onClick={onPick}
        />
      }
    />
  </div>
);

export default UploadField;
