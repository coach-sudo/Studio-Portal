import { zonedDateTimeToUtc } from "./booking";
import type { Lesson } from "./model";
export interface CalendarProposal {
  lesson?: Lesson;
  startsAt: string;
  endsAt: string;
  kind: "move" | "resize" | "create";
}
export function calendarSlot(date: string, minutes: number, timezone: string) {
  const [year, month, day] = date.split("-").map(Number),
    hour = Math.floor(minutes / 60),
    minute = minutes % 60;
  const result = zonedDateTimeToUtc(
    { year, month, day, hour, minute },
    timezone,
  );
  const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(result),
    get = (key: string) => Number(p.find((x) => x.type === key)?.value);
  if (
    get("year") !== year ||
    get("month") !== month ||
    get("day") !== day ||
    get("hour") !== hour ||
    get("minute") !== minute
  )
    throw new Error(
      "That local time does not exist because of daylight saving.",
    );
  return result.toISOString();
}
export function moveCalendarLesson(
  lesson: Lesson,
  date: string,
  minutes: number,
  timezone: string,
): CalendarProposal {
  const startsAt = calendarSlot(date, minutes, timezone),
    duration = Date.parse(lesson.endsAt) - Date.parse(lesson.startsAt);
  return {
    lesson,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + duration).toISOString(),
    kind: "move",
  };
}
export function resizeCalendarLesson(
  lesson: Lesson,
  deltaMinutes: number,
): CalendarProposal {
  const duration =
    (Date.parse(lesson.endsAt) - Date.parse(lesson.startsAt)) / 60000;
  const next = Math.round((duration + deltaMinutes) / 15) * 15;
  if (next < 15 || next > 720)
    throw new Error("Choose a duration between 15 minutes and 12 hours.");
  return {
    lesson,
    startsAt: lesson.startsAt,
    endsAt: new Date(Date.parse(lesson.startsAt) + next * 60000).toISOString(),
    kind: "resize",
  };
}
