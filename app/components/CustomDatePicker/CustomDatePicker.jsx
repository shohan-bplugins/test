import {
  BlockStack,
  Box,
  Button,
  DatePicker,
  Icon,
  InlineGrid,
  InlineStack,
  OptionList,
  Popover,
  Scrollable,
  Select,
  TextField,
  useBreakpoints,
  Card
} from "@shopify/polaris";
import { CalendarIcon, ArrowRightIcon } from "@shopify/polaris-icons";
import { useEffect, useRef, useState } from "react";

// This example is for guidance purposes. Copying it will come with caveats.
export default function CustomDatePicker({ inputValues, setInputValues }) {
  const { mdDown, lgUp } = useBreakpoints();
  const shouldShowMultiMonth = lgUp;
  // Helper function to calculate relative dates, handling month/year overflow correctly
  function calculateRelativeDate(baseDate, offsetInDays) {
    const result = new Date(baseDate);
    result.setDate(baseDate.getDate() + offsetInDays);
    result.setHours(0, 0, 0, 0); // Ensure the time is set to the start of the day
    return result;
  }

  // Get today's date
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize to start of the day

  // Calculate key dates
  const yesterday = calculateRelativeDate(today, -1);
  const last7DaysStart = calculateRelativeDate(today, -7);
  const last30DaysStart = calculateRelativeDate(today, -30);
  const last365DaysStart = calculateRelativeDate(today, -365);

  // Define ranges
  const ranges = [
    {
      title: "All",
      alias: "all",
      period: {
        since: new Date(0), // Unix epoch start: January 1, 1970
        until: today,
      },
    },
    {
      title: "Today",
      alias: "today",
      period: {
        since: today,
        until: today,
      },
    },
    {
      title: "Yesterday",
      alias: "yesterday",
      period: {
        since: yesterday,
        until: yesterday,
      },
    },
    {
      title: "Last 7 days",
      alias: "last7days",
      period: {
        since: last7DaysStart,
        until: yesterday,
      },
    },
    {
      title: "Last 30 days",
      alias: "last30days",
      period: {
        since: last30DaysStart,
        until: yesterday,
      },
    },
    {
      title: "Last 365 days",
      alias: "last365days",
      period: {
        since: last365DaysStart,
        until: yesterday,
      },
    },
  ];

  const [popoverActive, setPopoverActive] = useState(false);
  const [activeDateRange, setActiveDateRange] = useState(ranges[0]);

  const [{ month, year }, setDate] = useState({
    month: activeDateRange?.period.since.getMonth(),
    year: activeDateRange?.period.since.getFullYear(),
  });
  const datePickerRef = useRef(null);
  const VALID_YYYY_MM_DD_DATE_REGEX = /^\d{4}-\d{1,2}-\d{1,2}/;
  function isDate(date) {
    return !isNaN(new Date(date).getDate());
  }
  function isValidYearMonthDayDateString(date) {
    return VALID_YYYY_MM_DD_DATE_REGEX.test(date) && isDate(date);
  }
  function isValidDate(date) {
    return date.length === 10 && isValidYearMonthDayDateString(date);
  }
  function parseYearMonthDayDateString(input) {
    // Date-only strings (e.g. "1970-01-01") are treated as UTC, not local time
    // when using new Date()
    // We need to split year, month, day to pass into new Date() separately
    // to get a localized Date
    const [year, month, day] = input?.split("-");
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  function formatDateToYearMonthDayDateString(date) {
    const year = String(date.getFullYear());
    let month = String(date.getMonth() + 1);
    let day = String(date.getDate());
    if (month.length < 2) {
      month = String(month).padStart(2, "0");
    }
    if (day.length < 2) {
      day = String(day).padStart(2, "0");
    }
    return [year, month, day].join("-");
  }
  function formatDate(date) {
    return formatDateToYearMonthDayDateString(date);
  }
  function nodeContainsDescendant(rootNode, descendant) {
    if (rootNode === descendant) {
      return true;
    }
    let parent = descendant.parentNode;
    while (parent != null) {
      if (parent === rootNode) {
        return true;
      }
      parent = parent.parentNode;
    }
    return false;
  }
  function isNodeWithinPopover(node) {
    return datePickerRef?.current
      ? nodeContainsDescendant(datePickerRef.current, node)
      : false;
  }
  function handleStartInputValueChange(value) {
    setInputValues((prevState) => {
      return { ...prevState, since: value };
    });
    if (isValidDate(value)) {
      const newSince = parseYearMonthDayDateString(value);
      setActiveDateRange((prevState) => {
        const newPeriod =
          prevState?.period && newSince <= prevState?.period.until
            ? { since: newSince, until: prevState?.period.until }
            : { since: newSince, until: newSince };
        return {
          ...prevState,
          period: newPeriod,
        };
      });
    }
  }
  function handleEndInputValueChange(value) {
    setInputValues((prevState) => ({ ...prevState, until: value }));
    if (isValidDate(value)) {
      const newUntil = parseYearMonthDayDateString(value);
      setActiveDateRange((prevState) => {
        const newPeriod =
          prevState?.period && newUntil >= prevState?.period.since
            ? { since: prevState?.period.since, until: newUntil }
            : { since: newUntil, until: newUntil };
        return {
          ...prevState,
          period: newPeriod,
        };
      });
    }
  }
  function handleInputBlur({ relatedTarget }) {
    const isRelatedTargetWithinPopover =
      relatedTarget != null && isNodeWithinPopover(relatedTarget);
    // If focus moves from the TextField to the Popover
    // we don't want to close the popover
    if (isRelatedTargetWithinPopover) {
      return;
    }
    setPopoverActive(false);
  }
  function handleMonthChange(month, year) {
    setDate({ month, year });
  }
  function handleCalendarChange({ start, end }) {
    const newDateRange = ranges.find((range) => {
      return (
        range?.period.since.valueOf() === start.valueOf() &&
        range?.period.until.valueOf() === end.valueOf()
      );
    }) || {
      alias: "custom",
      title: "Custom",
      period: {
        since: start,
        until: end,
      },
    };
    setActiveDateRange(newDateRange);
  }
  function apply() {
    setPopoverActive(false);
  }
  function cancel() {
    setPopoverActive(false);
  }
  useEffect(() => {
    if (activeDateRange) {
      setInputValues({
        since: formatDate(activeDateRange?.period?.since),
        until: formatDate(activeDateRange?.period?.until),
      });
      function monthDiff(referenceDate, newDate) {
        return (
          newDate.month -
          referenceDate.month +
          12 * (referenceDate.year - newDate.year)
        );
      }
      const monthDifference = monthDiff(
        { year, month },
        {
          year: activeDateRange?.period?.until?.getFullYear(),
          month: activeDateRange?.period?.until?.getMonth(),
        },
      );
      if (monthDifference > 1 || monthDifference < 0) {
        setDate({
          month: activeDateRange?.period?.until?.getMonth(),
          year: activeDateRange?.period?.until?.getFullYear(),
        });
      }
    }
  }, [activeDateRange]);
  const buttonValue =
    activeDateRange?.title === "Custom"
      ? activeDateRange?.period?.since?.toDateString() +
        " - " +
        activeDateRange?.period?.until?.toDateString()
      : activeDateRange?.title;

  return (
    <s-box>
          <Button
            size="slim"
            icon={CalendarIcon}
            onClick={() => setPopoverActive(!popoverActive)}
          >
            {buttonValue}
          </Button>
        {popoverActive && <s-box><Card><Popover.Pane >
          <InlineGrid
            columns={{
              xs: "1fr",
              mdDown: "1fr",
              md: "max-content max-content",
            }}
            gap={0}
            ref={datePickerRef}
          >
            <Box
              maxWidth={mdDown ? "516px" : "212px"}
              width={mdDown ? "100%" : "212px"}
              padding={{ xs: 500, md: 0 }}
              paddingBlockEnd={{ xs: 100, md: 0 }}
            >
              {mdDown ? (
                <Select
                  label="dateRangeLabel"
                  labelHidden
                  onChange={(value) => {
                    const result = ranges.find(
                      ({ title, alias }) => title === value || alias === value,
                    );
                    setActiveDateRange(result);
                  }}
                  value={activeDateRange?.title || activeDateRange?.alias || ""}
                  options={ranges.map(({ alias, title }) => title || alias)}
                />
              ) : (
                <Scrollable style={{ height: "334px" }}>
                  <OptionList
                    options={ranges.map((range) => ({
                      value: range?.alias,
                      label: range?.title,
                    }))}
                    selected={activeDateRange?.alias}
                    onChange={(value) => {
                      setActiveDateRange(
                        ranges.find((range) => range?.alias === value[0]),
                      );
                    }}
                  />
                </Scrollable>
              )}
            </Box>
            <Box padding={{ xs: 500 }} maxWidth={mdDown ? "320px" : "516px"}>
              <BlockStack gap="400">
                <InlineStack gap="200">
                  <div style={{ flexGrow: 1 }}>
                    <TextField
                      role="combobox"
                      label={"Since"}
                      labelHidden
                      prefix={<Icon source={CalendarIcon} />}
                      value={inputValues.since}
                      onChange={handleStartInputValueChange}
                      onBlur={handleInputBlur}
                      autoComplete="off"
                    />
                  </div>
                  <Icon source={ArrowRightIcon} />
                  <div style={{ flexGrow: 1 }}>
                    <TextField
                      role="combobox"
                      label={"Until"}
                      labelHidden
                      prefix={<Icon source={CalendarIcon} />}
                      value={inputValues.until}
                      onChange={handleEndInputValueChange}
                      onBlur={handleInputBlur}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
                <s-box>
                  <DatePicker
                    month={month}
                    year={year}
                    selected={{
                      start: activeDateRange?.period.since,
                      end: activeDateRange?.period.until,
                    }}
                    onMonthChange={handleMonthChange}
                    onChange={handleCalendarChange}
                    multiMonth={shouldShowMultiMonth}
                    allowRange
                  />
                </s-box>
              </BlockStack>
            </Box>
          </InlineGrid>
        </Popover.Pane>
        <Popover.Pane fixed>
          <Popover.Section>
            <InlineStack align="end">
              <Button onClick={cancel}>Cancel</Button>
              <Button primary onClick={apply}>
                Apply
              </Button>
            </InlineStack>
          </Popover.Section>
        </Popover.Pane></Card></s-box>}
    </s-box>
  );
}
