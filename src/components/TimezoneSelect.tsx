import { useMemo } from "react";

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
  const timezones = useMemo(worldTimezones, []);
  const listId = `${id || "timezone"}-options`;

  return (
    <>
      <input
        id={id}
        list={listId}
        value={value}
        required={required}
        autoComplete="off"
        placeholder="Search city or region"
        onChange={(event) => {
          const next = event.target.value;
          event.target.setCustomValidity(
            next && !isValidTimezone(next)
              ? "Choose a valid IANA timezone from the list."
              : "",
          );
          onChange(next);
        }}
        onBlur={(event) => {
          event.currentTarget.setCustomValidity(
            event.currentTarget.value && !isValidTimezone(event.currentTarget.value)
              ? "Choose a valid IANA timezone from the list."
              : "",
          );
        }}
      />
      <datalist id={listId}>
        {timezones.map((timezone) => (
          <option key={timezone} value={timezone} />
        ))}
      </datalist>
    </>
  );
}
