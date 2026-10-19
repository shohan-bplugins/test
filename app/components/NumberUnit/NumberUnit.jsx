/**
 * NumberUnit — a number paired with a unit (12 + "px").
 *
 * Built from <s-number-field> + <s-select>, replacing an <input type=number>
 * welded to a Polaris <Select> by negative margins and border-radius surgery.
 *
 * Two bugs from the previous version are gone:
 *
 *   • `value.match(/[a-z%]+/i)[0]` threw on a unitless value ("12"), because
 *     `.match()` returns null. The unit now falls back to the first option.
 *   • the value was mirrored into local state and pushed back out through an
 *     effect on mount, so simply rendering the control reported a change and
 *     marked the customizer dirty. It is now derived straight from props.
 */
const UNIT_PATTERN = /[a-z%]+/i;

const NumberUnit = ({
  label,
  options = [],
  value,
  onChange,
  max = 1500,
  min = -100,
}) => {
  const unit = value?.match(UNIT_PATTERN)?.[0] ?? options[0]?.value ?? "px";
  const parsed = Number.parseInt(value, 10);
  const amount = Number.isNaN(parsed) ? 0 : parsed;

  const emit = (nextAmount, nextUnit) => onChange(`${nextAmount}${nextUnit}`);

  return (
    <s-grid gridTemplateColumns="1fr auto" gap="small-100" alignItems="end">
      <s-number-field
        label={label}
        value={String(amount)}
        min={min}
        max={max}
        onInput={(event) => {
          // s-number-field reports a string, and "" while the field is empty.
          const next = Number.parseInt(event.target.value, 10);
          emit(Number.isNaN(next) ? 0 : next, unit);
        }}
      />
      <s-select
        label="Unit"
        labelAccessibilityVisibility="exclusive"
        value={unit}
        onChange={(event) => emit(amount, event.target.value)}
      >
        {options.map((option) => (
          <s-option key={option.value} value={option.value}>
            {option.label}
          </s-option>
        ))}
      </s-select>
    </s-grid>
  );
};

export default NumberUnit;
