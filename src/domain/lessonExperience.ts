import type { Assignment, Lesson } from "./model";

export type LessonTimingState =
  "past" | "recent" | "joinable" | "today" | "upcoming";

export type LessonDeliveryState =
  "in_person" | "pending" | "ready" | "available" | "failed" | "cancelled";

export interface LessonDeliveryPresentation {
  state: LessonDeliveryState;
  label: string;
  detail: string;
  actionLabel?: string;
  tone: "neutral" | "good" | "warn";
}

const ACTIVE_STATUSES = new Set<Lesson["status"]>(["draft", "scheduled"]);

export function getLessonTimingState(
  lesson: Pick<Lesson, "startsAt" | "endsAt" | "status">,
  now = new Date(),
): LessonTimingState {
  const current = now.getTime();
  const starts = new Date(lesson.startsAt).getTime();
  const ends = new Date(lesson.endsAt).getTime();
  const window = 30 * 60 * 1000;
  if (
    ACTIVE_STATUSES.has(lesson.status) &&
    current >= starts - window &&
    current <= ends + window
  )
    return "joinable";
  if (current > ends && current <= ends + window) return "recent";
  if (current > ends || !ACTIVE_STATUSES.has(lesson.status)) return "past";
  if (new Date(lesson.startsAt).toDateString() === now.toDateString())
    return "today";
  return "upcoming";
}

export function isJoinableLesson(
  lesson: Pick<Lesson, "startsAt" | "endsAt" | "status" | "joinUrl">,
  now = new Date(),
) {
  return (
    Boolean(lesson.joinUrl) && getLessonTimingState(lesson, now) === "joinable"
  );
}

export function selectLessonDelivery(
  lesson: Pick<
    Lesson,
    | "startsAt"
    | "endsAt"
    | "status"
    | "joinUrl"
    | "locationType"
    | "meetingProvider"
  >,
  options: { calendarStatus?: string; now?: Date } = {},
): LessonDeliveryPresentation {
  if (["cancelled", "late_cancelled"].includes(lesson.status))
    return {
      state: "cancelled",
      label: "Lesson cancelled",
      detail: "This lesson is no longer scheduled.",
      tone: "warn",
    };
  const virtual =
    lesson.locationType === "virtual" ||
    lesson.meetingProvider === "google_meet";
  if (!virtual)
    return {
      state: "in_person",
      label: "In-person lesson",
      detail: "No online joining link is needed.",
      tone: "neutral",
    };
  if (lesson.joinUrl && isJoinableLesson(lesson, options.now))
    return {
      state: "available",
      label: "Google Meet is open",
      detail: "The lesson can be joined now.",
      actionLabel: "Join Google Meet",
      tone: "good",
    };
  if (lesson.joinUrl)
    return {
      state: "ready",
      label: "Google Meet link ready",
      detail: "The join button opens 30 minutes before the lesson.",
      tone: "good",
    };
  if (options.calendarStatus === "failed")
    return {
      state: "failed",
      label: "Google Meet needs attention",
      detail: "The studio is reviewing the calendar invitation.",
      tone: "warn",
    };
  return {
    state: "pending",
    label: "Google Meet is being prepared",
    detail: "The joining link will appear here when it is ready.",
    tone: "neutral",
  };
}

export function splitLessons(lessons: Lesson[], now = new Date()) {
  const active = lessons
    .filter(
      (lesson) =>
        ACTIVE_STATUSES.has(lesson.status) &&
        new Date(lesson.endsAt).getTime() >= now.getTime() - 30 * 60 * 1000,
    )
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
      .sort(
        (a, b) =>
          Number(b.helpRequested) - Number(a.helpRequested) ||
          due(a).localeCompare(due(b)) ||
          b.updatedAt.localeCompare(a.updatedAt),
      ),
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
