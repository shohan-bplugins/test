/**
 * SelectInput — labelled dropdown.
 *
 * Wraps <s-select>. Same prop contract as before; `position` is accepted and
 * ignored (it positioned the label in the old hand-rolled markup, which
 * s-select handles itself), and the hand-drawn dual-chevron is gone in favour
 * of the platform control.
 *
 * The old implementation generated its id with Math.random(), which differs
 * between server and client render — a latent hydration mismatch that goes
 * away with the id now being the element's own concern.
 */
const SelectInput = ({
  label,
  options = [],
  value = "",
  onChange,
  name = "select_input",
  disabled = false,
}) => (
  <s-select
    label={label}
    name={name}
    value={value}
    disabled={disabled}
    onChange={(event) => onChange?.(event.target.value)}
  >
    {options.map((option, i) => (
      <s-option
        key={option.value ?? i}
        value={option.value}
        disabled={option?.disabled}
      >
        {option.label}
      </s-option>
    ))}
  </s-select>
);

export default SelectInput;
