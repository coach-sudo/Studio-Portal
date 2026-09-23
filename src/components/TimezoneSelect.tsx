import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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

const commonUsTimezones = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

const timezoneSearchAliases: Record<string, string[]> = {
  "America/New_York": ["Eastern", "Eastern Time", "ET"],
  "America/Chicago": ["Central", "Central Time", "CT"],
  "America/Denver": ["Mountain", "Mountain Time", "MT"],
  "America/Phoenix": ["Arizona", "Mountain Standard Time", "MST"],
  "America/Los_Angeles": ["Pacific", "Pacific Time", "PT"],
  "America/Anchorage": ["Alaska", "Alaska Time", "AKT"],
  "Pacific/Honolulu": ["Hawaii", "Hawaii Time", "HST"],
};

function timezoneLabel(timezone: string, detected: string) {
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value;
  const name = timezone.replaceAll("_", " ");
  return `${timezone === detected ? "Device timezone — " : ""}${name}${offset ? ` (${offset})` : ""}`;
}

export function worldTimezones() {
  try {
    const values = (
      Intl as typeof Intl & {
        supportedValuesOf?: (key: "timeZone") => string[];
      }
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
    () => [
      ...new Set(
        [detected, value, ...commonUsTimezones, ...worldTimezones()].filter(
          Boolean,
        ),
      ),
    ],
    [detected, value],
  );
  const [query, setQuery] = useState(
    timezoneLabel(value || detected, detected),
  );
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const selectedLabel = timezoneLabel(
      value || detected,
      detected,
    ).toLowerCase();
    if (!needle || needle === selectedLabel) return timezones;
    const normalizedNeedle = needle.replaceAll(/[/_-]+/g, " ");
    return timezones.filter((timezone) => {
      const searchable = [
        timezone,
        timezone.replaceAll(/[/_-]+/g, " "),
        ...(timezoneSearchAliases[timezone] ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return (
        searchable.includes(needle) || searchable.includes(normalizedNeedle)
      );
    });
  }, [detected, query, timezones, value]);
  useEffect(() => {
    if (!value) onChange(detected);
  }, [detected, onChange, value]);
  useEffect(() => {
    if (value) setQuery(timezoneLabel(value, detected));
  }, [detected, value]);

  const choose = (timezone: string) => {
    onChange(timezone);
    setQuery(timezoneLabel(timezone, detected));
    setOpen(false);
  };
  const updatePopupDirection = () => {
    const bounds = inputRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const navigation = document
      .querySelector(".mobile-nav")
      ?.getBoundingClientRect();
    const navigationTop =
      navigation && navigation.height > 0 ? navigation.top : window.innerHeight;
    const below = navigationTop - bounds.bottom;
    setOpenUp(below < 250 && bounds.top > below);
  };
  const keepInputAboveMobileNavigation = () => {
    const input = inputRef.current;
    const navigation = document.querySelector(".mobile-nav");
    if (!input || !navigation) return;
    const navigationBounds = navigation.getBoundingClientRect();
    if (
      navigationBounds.height > 0 &&
      input.getBoundingClientRect().bottom > navigationBounds.top - 12
    ) {
      input.scrollIntoView({ block: "center", behavior: "instant" });
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        event.key === "ArrowDown"
          ? Math.min(current + 1, Math.max(0, filtered.length - 1))
          : Math.max(0, current - 1),
      );
    } else if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery(timezoneLabel(value || detected, detected));
    }
  };

  return (
    <div className="timezone-combobox">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        type="text"
        required={required}
        value={query}
        aria-label={id ? undefined : "Timezone"}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && filtered[activeIndex]
            ? `${listId}-option-${activeIndex}`
            : undefined
        }
        onFocus={() => {
          keepInputAboveMobileNavigation();
          updatePopupDirection();
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 100)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          updatePopupDirection();
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
      />
      {open && (
        <div
          className={`timezone-options${openUp ? " timezone-options-up" : ""}`}
          id={listId}
          role="listbox"
        >
          {filtered.map((timezone, index) => (
            <button
              type="button"
              role="option"
              id={`${listId}-option-${index}`}
              aria-selected={timezone === (value || detected)}
              className={index === activeIndex ? "active" : ""}
              key={timezone}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(timezone)}
            >
              {timezoneLabel(timezone, detected)}
            </button>
          ))}
          {!filtered.length && (
            <p role="status">No matching timezone. Try a city or region.</p>
          )}
        </div>
      )}
    </div>
  );
}
