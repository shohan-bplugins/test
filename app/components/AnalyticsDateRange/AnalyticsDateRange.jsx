import {
  Popover,
  Button,
  Select,
  TextField,
  DatePicker,
  BlockStack,
  InlineGrid,
  InlineStack,
  Box,
  Text,
  Icon,
  useBreakpoints,
} from "@shopify/polaris";
import { CalendarIcon } from "@shopify/polaris-icons";
import { useEffect, useState } from "react";

/* ---------- date helpers ---------- */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function fmt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function parse(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValid(str) {
  return DATE_RE.test(str) && !isNaN(parse(str).getTime());
}

// Anchor the calendar one month back so the multi-month view shows the
// previous month on the left and the given (current) month on the right.
function prevMonthAnchor(date) {
  const d = startOfDay(date);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { month: d.getMonth(), year: d.getFullYear() };
}

function buildPresets(today) {
  const t = startOfDay(today);
  const rel = (n) => {
    const d = startOfDay(today);
    d.setDate(d.getDate() + n);
    return d;
  };
  return [
    { alias: "today", title: "Today", since: t, until: t },
    { alias: "yesterday", title: "Yesterday", since: rel(-1), until: rel(-1) },
    { alias: "7d", title: "Last 7 days", since: rel(-6), until: t },
    { alias: "30d", title: "Last 30 days", since: rel(-29), until: t },
    { alias: "90d", title: "Last 90 days", since: rel(-89), until: t },
    { alias: "365d", title: "Last 365 days", since: rel(-364), until: t },
    { alias: "all", title: "All time", since: new Date(2000, 0, 1), until: t },
  ];
}

function tzLabel() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Local";
  const city = tz.split("/").pop()?.replace(/_/g, " ") || tz;
  const offMin = -new Date().getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const h = String(Math.floor(Math.abs(offMin) / 60)).padStart(2, "0");
  const m = String(Math.abs(offMin) % 60).padStart(2, "0");
  return `${city} (GMT${sign}${h}:${m})`;
}

/**
 * Date-range picker popover.
 * @param {{since:string, until:string}} value  YYYY-MM-DD strings
 * @param {(range:{since:string,until:string}) => void} onApply
 */
export default function AnalyticsDateRange({ value, onApply, disabled }) {
  const { mdUp } = useBreakpoints();
  const today = startOfDay(new Date());
  const presets = buildPresets(today);

  const [active, setActive] = useState(false);
  const [since, setSince] = useState(value.since);
  const [until, setUntil] = useState(value.until);
  const [{ month, year }, setMonth] = useState(() => {
    const base = isValid(value.until) ? parse(value.until) : today;
    return prevMonthAnchor(base);
  });

  // Re-sync working copy whenever the popover opens or props change.
  useEffect(() => {
    setSince(value.since);
    setUntil(value.until);
  }, [value.since, value.until]);

  const matchedPreset = presets.find(
    (p) => fmt(p.since) === since && fmt(p.until) === until,
  );
  const selectValue = matchedPreset ? matchedPreset.alias : "custom";

  const selectOptions = [
    ...presets.map((p) => ({ label: p.title, value: p.alias })),
    ...(matchedPreset ? [] : [{ label: "Custom", value: "custom" }]),
  ];

  const triggerLabel = matchedPreset
    ? matchedPreset.title
    : `${since} – ${until}`;

  const applyPreset = (alias) => {
    const p = presets.find((x) => x.alias === alias);
    if (!p) return;
    setSince(fmt(p.since));
    setUntil(fmt(p.until));
    setMonth(prevMonthAnchor(p.until));
  };

  const onCalendarChange = ({ start, end }) => {
    setSince(fmt(start));
    setUntil(fmt(end));
  };

  const canApply = isValid(since) && isValid(until) && parse(since) <= parse(until);

  const cancel = () => {
    setSince(value.since);
    setUntil(value.until);
    setActive(false);
  };

  const apply = () => {
    if (!canApply) return;
    onApply({ since, until });
    setActive(false);
  };

  const selected =
    isValid(since) && isValid(until)
      ? { start: parse(since), end: parse(until) }
      : undefined;

  const activator = (
    <Button
      disclosure="down"
      onClick={() => setActive((a) => !a)}
      disabled={disabled}
      fullWidth
      textAlign="start"
    >
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        <Icon source={CalendarIcon} tone="base" />
        <Text as="span">{triggerLabel}</Text>
      </InlineStack>
    </Button>
  );

  return (
    <Popover
      active={active}
      activator={activator}
      onClose={cancel}
      preferredAlignment="left"
      fluidContent
      autofocusTarget="none"
    >
      <div
        className="AnalyticsDateRange"
        style={mdUp ? { width: 540 } : { maxWidth: 340 }}
      >
        <Box padding="400">
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                Date range
              </Text>
              <Select
                label="Date range"
                labelHidden
                options={selectOptions}
                value={selectValue}
                onChange={(v) => v !== "custom" && applyPreset(v)}
              />
            </BlockStack>

            {selectValue !== "all" && (
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                <TextField
                  label="Starting"
                  value={since}
                  onChange={setSince}
                  autoComplete="off"
                  error={since && !isValid(since) ? "Invalid date" : undefined}
                />
                <TextField
                  label="Ending"
                  value={until}
                  onChange={setUntil}
                  autoComplete="off"
                  error={until && !isValid(until) ? "Invalid date" : undefined}
                />
              </InlineGrid>
            )}

            {selectValue !== "all" && (
              <DatePicker
                month={month}
                year={year}
                selected={selected}
                onMonthChange={(m, y) => setMonth({ month: m, year: y })}
                onChange={onCalendarChange}
                disableDatesAfter={today}
                multiMonth={mdUp}
                allowRange
              />
            )}

            <Text as="span" variant="bodySm" tone="subdued">
              {tzLabel()}
            </Text>
          </BlockStack>
        </Box>

        <div
          style={{ borderTop: "1px solid var(--p-color-border, #e1e3e5)" }}
        />
        <Box padding="300">
          <InlineStack align="space-between">
            <Button onClick={cancel}>Cancel</Button>
            <Button variant="primary" onClick={apply} disabled={!canApply}>
              Apply
            </Button>
          </InlineStack>
        </Box>
      </div>
    </Popover>
  );
}
