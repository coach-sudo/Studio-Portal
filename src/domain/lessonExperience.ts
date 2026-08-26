import type { Assignment, Lesson } from "./model";

export type LessonTimingState =
  | "past"
  | "recent"
  | "joinable"
  | "today"
  | "upcoming";

const ACTIVE_STATUSES = new Set<Lesson["status"]>(["draft", "scheduled"]);

export function getLessonTimingState(
  lesson: Pick<Lesson, "startsAt" | "endsAt" | "status">,
  now = new Date(),
): LessonTimingState {
  const current = now.getTime();
  const starts = new Date(lesson.startsAt).getTime();
  const ends = new Date(lesson.endsAt).getTime();
  const window = 30 * 60 * 1000;
  if (ACTIVE_STATUSES.has(lesson.status) && current >= starts - window && current <= ends + window)
    return "joinable";
  if (current > ends && current <= ends + window) return "recent";
  if (current > ends || !ACTIVE_STATUSES.has(lesson.status)) return "past";
  if (new Date(lesson.startsAt).toDateString() === now.toDateString()) return "today";
  return "upcoming";
}

export function isJoinableLesson(
  lesson: Pick<Lesson, "startsAt" | "endsAt" | "status" | "joinUrl">,
  now = new Date(),
) {
  return Boolean(lesson.joinUrl) && getLessonTimingState(lesson, now) === "joinable";
}

export function splitLessons(lessons: Lesson[], now = new Date()) {
  const active = lessons
    .filter((lesson) => ACTIVE_STATUSES.has(lesson.status) && new Date(lesson.endsAt).getTime() >= now.getTime() - 30 * 60 * 1000)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const history = lessons
    .filter((lesson) => !active.some((item) => item.id === lesson.id))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { active, history };
}

export function sortAssignments(assignments: Assignment[]) {
  const due = (item: Assignment) => item.dueAt ?? "9999-12-31T23:59:59.999Z";
  return {
    active: assignments
      .filter((item) => item.status !== "completed")
      .sort((a, b) => Number(b.helpRequested) - Number(a.helpRequested) || due(a).localeCompare(due(b)) || b.updatedAt.localeCompare(a.updatedAt)),
    completed: assignments
      .filter((item) => item.status === "completed")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

export function lessonDateLabel(lesson: Pick<Lesson, "startsAt">) {
  return new Date(lesson.startsAt).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
