import { useState } from "react";
import { WebChangeField, WebSelect } from "../PolarisWeb/fields";
import { presetDates, todayYmd } from "../../lib/analytics-shared";

const PRESET_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "last7" },
  { label: "Last 30 days", value: "last30" },
  { label: "All time", value: "all" },
  { label: "Custom", value: "custom" },
];

// Presets of the Analytics & Reports range picker. `free` is the label suffix
// Free plans see: "" (full), "(Limited)", or "(Pro)". All stay selectable.
const RANGE_OPTIONS = [
  { label: "Today", value: "today", free: "" },
  { label: "Yesterday", value: "yesterday", free: " (Limited)" },
  { label: "Last 7 days", value: "last7", free: " (Limited)" },
  { label: "Last 30 days", value: "last30", free: " (Pro)" },
  { label: "All time", value: "all", free: " (Pro)" },
  { label: "Custom", value: "custom", free: " (Pro)" },
];

// The browser's own date: what "Today" means to the merchant.
const browserToday = () => todayYmd(new Date().getTimezoneOffset());

// Form data for a preset, with its dates in the browser's calendar.
export function presetSubmitData(filter) {
  const { since, until } = presetDates(filter, browserToday());
  const fd = new FormData();
  fd.append("filter", filter);
  fd.append("since", since);
  fd.append("until", until);
  return fd;
}

// Next URL search params for a range picked in DateFilter. Always sends the
// browser's timezone offset so the server knows the merchant's "today".
export function rangeSearchParams(searchParams, formData) {
  const next = new URLSearchParams(searchParams);
  const filter = formData.get("filter") || "today";
  next.set("filter", filter);
  next.set("tzo", String(new Date().getTimezoneOffset()));
  // Older links used from/to.
  next.delete("from");
  next.delete("to");
  const since = formData.get("since");
  const until = formData.get("until");
  if (filter !== "all" && since && until) {
    next.set("since", since);
    next.set("until", until);
  } else {
    next.delete("since");
    next.delete("until");
  }
  return next;
}

// Human label for the active range, shown next to the ranking heading.
export function periodLabelFor(filter) {
  switch (filter) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "last7":
      return "Last 7 days";
    case "last30":
      return "Last 30 days";
    case "custom":
      return "Selected range";
    default:
      return "All time";
  }
}

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

// Preset dropdown; "Custom" reveals two date fields (each with its own
// calendar) and an Apply button. Other presets apply immediately.
function DateRangeFilter({
  defaultValue = "today",
  defaultSince = "",
  defaultUntil = "",
  isFree = false,
  submit,
}) {
  const [preset, setPreset] = useState(defaultValue);
  const [range, setRange] = useState(() => ({
    start: fromYmd(defaultSince),
    end: fromYmd(defaultUntil),
  }));

  const options = RANGE_OPTIONS.map(({ label, value, free }) => ({
    label: isFree ? `${label}${free}` : label,
    value,
  }));

  const handlePresetSelect = (value) => {
    setPreset(value);
    if (value === "custom") return;
    const fd = presetSubmitData(value);
    setRange({
      start: fromYmd(fd.get("since")),
      end: fromYmd(fd.get("until")),
    });
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
    fd.append("since", toYmd(range.start));
    fd.append("until", toYmd(range.end));
    submit(fd, { method: "post" });
  };

  return (
    <s-stack direction="inline" gap="small" alignItems="end">
      <WebSelect
        label="Date range"
        labelAccessibilityVisibility="exclusive"
        options={options}
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
