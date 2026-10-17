import { useState } from "react";
import { WebChangeField, WebSelect } from "../PolarisWeb/fields";

const PRESET_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "last7" },
  { label: "Last 30 days", value: "last30" },
  { label: "All time", value: "all" },
  { label: "Custom", value: "custom" },
];

function toYmd(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromYmd(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
}

function presetRange(value) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (value === "today") return { start: today, end: today };
  if (value === "last7") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start, end: today };
  }
  if (value === "last30") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { start, end: today };
  }
  return { start: null, end: null };
}

export default function DateFilter(props) {
  if (props.enableCustomRange) {
    return <DateRangeFilter {...props} />;
  }
  return <LegacyPresetSelect {...props} />;
}

function LegacyPresetSelect({ defaultValue = "today", submit }) {
  const [selected, setSelected] = useState(defaultValue);
  const options = PRESET_OPTIONS.filter((o) => o.value !== "custom");
  return (
    <WebSelect
      label="Date range"
      labelAccessibilityVisibility="exclusive"
      options={options}
      value={selected}
      onChange={(value) => {
        setSelected(value);
        const fd = new FormData();
        fd.append("filter", value);
        submit(fd, { method: "post" });
      }}
    />
  );
}

function initialRangeFor(defaultValue, defaultFrom, defaultTo) {
  if (defaultValue === "custom" && defaultFrom && defaultTo) {
    return { start: fromYmd(defaultFrom), end: fromYmd(defaultTo) };
  }
  return presetRange(defaultValue);
}

// Preset dropdown; "Custom" reveals two date fields (each with its own
// calendar) and an Apply button. Other presets apply immediately.
function DateRangeFilter({
  defaultValue = "today",
  defaultFrom = "",
  defaultTo = "",
  submit,
}) {
  const [preset, setPreset] = useState(defaultValue);
  const [range, setRange] = useState(() =>
    initialRangeFor(defaultValue, defaultFrom, defaultTo),
  );

  const handlePresetSelect = (value) => {
    setPreset(value);
    if (value === "custom") return;
    setRange(presetRange(value));
    const fd = new FormData();
    fd.append("filter", value);
    submit(fd, { method: "post" });
  };

  const handleFromChange = (value) => {
    const d = fromYmd(value);
    if (!d) return;
    setRange((r) => ({ start: d, end: r.end && r.end >= d ? r.end : d }));
  };

  const handleToChange = (value) => {
    const d = fromYmd(value);
    if (!d) return;
    setRange((r) => ({ start: r.start && r.start <= d ? r.start : d, end: d }));
  };

  const handleApply = () => {
    if (!range?.start || !range?.end) return;
    const fd = new FormData();
    fd.append("filter", "custom");
    fd.append("from", toYmd(range.start));
    fd.append("to", toYmd(range.end));
    submit(fd, { method: "post" });
  };

  return (
    <s-stack direction="inline" gap="small" alignItems="end">
      <WebSelect
        label="Date range"
        labelAccessibilityVisibility="exclusive"
        options={PRESET_OPTIONS}
        value={preset}
        onChange={handlePresetSelect}
      />
      {preset === "custom" ? (
        <>
          <WebChangeField
            tag="s-date-field"
            label="Starting"
            value={range?.start ? toYmd(range.start) : ""}
            onChange={handleFromChange}
          />
          <WebChangeField
            tag="s-date-field"
            label="Ending"
            value={range?.end ? toYmd(range.end) : ""}
            onChange={handleToChange}
          />
          <s-button
            variant="primary"
            disabled={!range?.start || !range?.end || undefined}
            onClick={handleApply}
          >
            Apply
          </s-button>
        </>
      ) : null}
    </s-stack>
  );
}
