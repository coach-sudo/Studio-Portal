/** Offset-free form controls are wall times in an explicitly named IANA zone. */
function formatter(timeZone: string) {
  if (!timeZone.trim()) throw new RangeError("Choose an explicit timezone.");
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}
function parts(date: Date, format: Intl.DateTimeFormat) {
  const values = format.formatToParts(date);
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(values.find((p) => p.type === type)?.value);
  return {
    year: n("year"),
    month: n("month"),
    day: n("day"),
    hour: n("hour"),
    minute: n("minute"),
    second: n("second"),
  };
}
function wallMillis(p: ReturnType<typeof parts>) {
  const d = new Date(0);
  d.setUTCFullYear(p.year, p.month - 1, p.day);
  d.setUTCHours(p.hour, p.minute, p.second, 0);
  return d.getTime();
}
export function formatZonedInput(instant: string | Date, timeZone: string) {
  const p = parts(new Date(instant), formatter(timeZone));
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
/** Zero matches means invalid/gap; two means a fold requiring an explicit choice. */
export function zonedInputInstants(value: string, timeZone: string): string[] {
  let format: Intl.DateTimeFormat;
  try {
    format = formatter(timeZone);
  } catch {
    return [];
  }
  const match = /^(\d{4,6})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(value);
  if (!match) return [];
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = wallMillis({ year, month, day, hour, minute, second: 0 });
  const d = new Date(wall);
  if (
    !Number.isFinite(wall) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute
  )
    return [];
  const offsets = new Set<number>();
  for (let shift = -36; shift <= 36; shift += 6) {
    const probe = wall + shift * 3600000;
    offsets.add(wallMillis(parts(new Date(probe), format)) - probe);
  }
  return [
    ...new Set(
      [...offsets]
        .map((offset) => new Date(wall - offset))
        .filter((candidate) => formatZonedInput(candidate, timeZone) === value)
        .map((candidate) => candidate.toISOString()),
    ),
  ].sort();
}
