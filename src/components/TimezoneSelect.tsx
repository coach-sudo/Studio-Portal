import { useEffect, useMemo } from "react";
import { observedTimezone } from "../domain/presentation";

const fallbackTimezones = [
  "Africa/Cairo",
  "Africa/Johannesburg",
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Chicago",
  "America/Denver",
  "America/Halifax",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Sao_Paulo",
  "America/Toronto",
  "America/Vancouver",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Kolkata",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Rome",
  "Pacific/Auckland",
  "Pacific/Honolulu",
  "UTC",
];

export function worldTimezones() {
  try {
    const values = (
      Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }
    ).supportedValuesOf?.("timeZone");
    return values?.length ? values : fallbackTimezones;
  } catch {
    return fallbackTimezones;
  }
}

export function isValidTimezone(value: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function TimezoneSelect({
  value,
  onChange,
  id,
  required = true,
}: {
  value: string;
  onChange: (timezone: string) => void;
  id?: string;
  required?: boolean;
}) {
  const detected = useMemo(observedTimezone, []);
  const timezones = useMemo(
    () => [...new Set([detected, value, ...worldTimezones()].filter(Boolean))],
    [detected, value],
  );
  useEffect(() => {
    if (!value) onChange(detected);
  }, [detected, onChange, value]);

  return (
    <select
      id={id}
      value={value || detected}
      required={required}
      onChange={(event) => onChange(event.target.value)}
      aria-label={id ? undefined : "Timezone"}
    >
      {timezones.map((timezone) => (
        <option key={timezone} value={timezone}>
          {timezone === detected ? `Device timezone — ${timezone}` : timezone.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}
