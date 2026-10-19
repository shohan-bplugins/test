/**
 * ColorController — hex field with a colour swatch.
 *
 * <s-color-field> is this component: a text field for the hex value with a
 * swatch in its prefix that opens the picker. That replaces the old pairing of
 * a text input with a circular div layered over an invisible
 * <input type="color">.
 *
 * The previous version also carried an unused `useState("#000000")`; the value
 * has always been owned by the parent.
 */
function ColorController({
  label = "Color Control Panel",
  value = "#ffffff",
  onChange,
}) {
  return (
    <s-color-field
      label={label}
      value={value}
      onInput={(event) => onChange(event.target.value)}
    />
  );
}

export default ColorController;
