import type { Lesson, PackageDefinition } from "./model";

export function recentLessonDuration(lessons: Lesson[], studentId: string, now = Date.now()) {
  const lesson = lessons
    .filter((item) => item.studentId === studentId && item.status !== "cancelled" && item.status !== "late_cancelled" && new Date(item.startsAt).getTime() <= now)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  if (!lesson) return undefined;
  return Math.max(1, Math.round((new Date(lesson.endsAt).getTime() - new Date(lesson.startsAt).getTime()) / 60_000));
}

export function sortPackageDefinitions(definitions: PackageDefinition[], preferredDuration?: number) {
  return [...definitions].sort((a, b) => {
    const aMatch = a.sessionDurationMinutes === preferredDuration ? 0 : 1;
    const bMatch = b.sessionDurationMinutes === preferredDuration ? 0 : 1;
    return aMatch - bMatch || a.sessionDurationMinutes - b.sessionDurationMinutes || a.sessionCount - b.sessionCount || a.name.localeCompare(b.name);
  });
}
