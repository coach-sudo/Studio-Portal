import type { Material } from "./model";

const DEFAULT_TIMEZONE = "America/New_York";
const timezoneCache = new Map<string, string>();
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function observedTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const formatter = (
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
) => {
  const key = `${locale || "default"}:${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(locale, options);
  formatterCache.set(key, created);
  return created;
};

export function safeStudioTimezone(timezone?: string) {
  const candidate = timezone || DEFAULT_TIMEZONE;
  const cached = timezoneCache.get(candidate);
  if (cached) return cached;
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
    timezoneCache.set(candidate, candidate);
    return candidate;
  } catch {
    timezoneCache.set(candidate, DEFAULT_TIMEZONE);
    return DEFAULT_TIMEZONE;
  }
}

const withoutSeconds = (options: Intl.DateTimeFormatOptions) => ({
  ...options,
  second: undefined,
  fractionalSecondDigits: undefined,
});

export function formatStudioDateTime(
  value: string | Date,
  timezone?: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  return formatter(undefined, {
    timeZone: safeStudioTimezone(timezone),
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...withoutSeconds(options),
  }).format(new Date(value));
}

export function formatStudioDate(
  value: string | Date,
  timezone?: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  return formatter(undefined, {
    timeZone: safeStudioTimezone(timezone),
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(new Date(value));
}

export function formatStudioTime(
  value: string | Date,
  timezone?: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  return formatter(undefined, {
    timeZone: safeStudioTimezone(timezone),
    hour: "numeric",
    minute: "2-digit",
    ...withoutSeconds(options),
  }).format(new Date(value));
}

export function studioDateKey(value: string | Date, timezone?: string) {
  const parts = formatter("en-CA", {
    timeZone: safeStudioTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Formats a calendar-only YYYY-MM-DD value without shifting it across zones. */
export function formatCalendarDateKey(
  value: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  return formatter(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(new Date(`${value}T12:00:00.000Z`));
}

/** Converts an instant to a local-noon Date used only as a calendar cursor. */
export function studioCalendarDate(value: string | Date, timezone?: string) {
  const [year, month, day] = studioDateKey(value, timezone)
    .split("-")
    .map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/** Returns the YYYY-MM-DD represented by a calendar cursor's local fields. */
export function calendarDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export type MaterialDisplayKind =
  | "Current script"
  | "Lesson resource"
  | "Shared resource"
  | "Headshot"
  | "Gallery image"
  | "Reel"
  | "Resume"
  | "Actor-page media";

type PresentableMaterial = Pick<
  Material,
  "role" | "mediaKind" | "title" | "category" | "externalUrl"
>;

const extension = (material: PresentableMaterial) => {
  const source = material.externalUrl || material.title;
  return source.split(/[?#]/)[0]?.split(".").at(-1)?.toLowerCase() || "";
};

export function materialDisplayKind(
  material: PresentableMaterial,
): MaterialDisplayKind {
  if (material.role === "current_script") return "Current script";
  if (material.role === "lesson_material") return "Lesson resource";
  if (material.role === "library") return "Shared resource";

  const text = `${material.title} ${material.category}`.toLowerCase();
  const ext = extension(material);
  const image =
    material.mediaKind === "image" ||
    ["jpg", "jpeg", "png", "webp", "gif", "avif", "heic"].includes(ext);
  const video =
    material.mediaKind === "video" ||
    ["mp4", "mov", "webm", "m4v"].includes(ext) ||
    /(?:youtube\.com|youtu\.be|vimeo\.com)/i.test(material.externalUrl || "");
  const document =
    material.mediaKind === "document" ||
    ["pdf", "doc", "docx"].includes(ext);

  if (video || /\b(reel|performance clip)\b/.test(text)) return "Reel";
  if (document && /\b(resume|résumé|cv)\b/.test(text)) return "Resume";
  if (image && /\b(headshot|main photo|profile photo)\b/.test(text))
    return "Headshot";
  if (image) return "Gallery image";
  return "Actor-page media";
}
