import { seriesDates } from "./booking";
import type { Lesson, RecurringSeries } from "./model";
import { studioDateKey } from "./presentation";

/** Dates are calculated before exclusions so skipping a week never moves later lessons. */
export function selectRecurringOccurrences(
  candidates: readonly string[],
  skipped: readonly string[],
) {
  const requested = skipped.map((date) => Date.parse(date));
  const unique = new Set(requested);
  const valid = new Set(candidates.map((date) => Date.parse(date)));
  if (
    unique.size !== requested.length ||
    requested.some((date) => !Number.isFinite(date) || !valid.has(date))
  ) {
    throw new Error(
      "VALIDATION_FAILED: A skipped date is outside this booking proposal.",
    );
  }
  const selected = candidates.filter((date) => !unique.has(Date.parse(date)));
  if (!selected.length)
    throw new Error("VALIDATION_FAILED: Keep at least one proposed lesson.");
  return selected;
}

export type BookingContinuation = {
  sourceSeriesId: string;
  studentId: string;
  startsAt: string;
  cadence: "weekly" | "biweekly";
};

export function continuationStart(
  series: Pick<
    RecurringSeries,
    "kind" | "status" | "cadence" | "endsOn" | "recurrenceRule"
  >,
  lessons: readonly Pick<Lesson, "status" | "startsAt" | "endsAt">[],
  timezone: string,
  durationMinutes: number,
  now = Date.now(),
) {
  if (
    series.kind !== "fixed" ||
    !["active", "completed"].includes(series.status)
  )
    return undefined;

  const slots = series.recurrenceRule?.slots ?? [];
  if (
    slots.length !== 1 ||
    series.recurrenceRule.intervalWeeks !==
      (series.cadence === "weekly" ? 1 : 2)
  )
    return undefined;

  const anchor = [...lessons]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .at(-1);
  if (
    !anchor ||
    !["scheduled", "completed"].includes(anchor.status) ||
    Date.parse(anchor.endsAt) - Date.parse(anchor.startsAt) !==
      durationMinutes * 60_000
  )
    return undefined;

  const day = studioDateKey(anchor.startsAt, timezone);
  const weekday = new Date(day + "T12:00:00Z").getUTCDay();
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(anchor.startsAt));
  if (
    slots[0].weekday !== weekday ||
    slots[0].time.slice(0, 5) !== time ||
    (series.endsOn && series.endsOn.slice(0, 10) !== day)
  )
    return undefined;

  const next = seriesDates(anchor.startsAt, series.cadence, 2, timezone)[1];
  return Date.parse(next) >= Math.max(now, Date.parse(anchor.endsAt))
    ? next
    : undefined;
}
