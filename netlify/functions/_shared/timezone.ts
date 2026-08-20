type WallTime = { year: number; month: number; day: number; hour: number; minute: number };
export const wallParts = (date: Date, timeZone: string): WallTime => {
  const values = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(values.find((item) => item.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
};
const offset = (timestamp: number, timeZone: string) => { const value = parts(new Date(timestamp), timeZone); return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute) - Math.floor(timestamp / 60_000) * 60_000; };
const parts = wallParts;
export const zonedDateTimeToUtc = (value: WallTime, timeZone: string) => { const wall = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute); let result = wall - offset(wall, timeZone); result = wall - offset(result, timeZone); return new Date(result); };
export const recurringDates = (startsAt: string, cadence: "weekly" | "biweekly", count: number, timeZone: string) => { const first = parts(new Date(startsAt), timeZone); return Array.from({ length: count }, (_, index) => { const day = new Date(Date.UTC(first.year, first.month - 1, first.day + index * (cadence === "weekly" ? 7 : 14))); return zonedDateTimeToUtc({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: first.hour, minute: first.minute }, timeZone).toISOString(); }); };
