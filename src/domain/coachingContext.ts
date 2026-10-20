import type { Lesson, StudioSnapshot } from "./model";
import { sortAssignments } from "./lessonExperience";

/** Compose existing authorized records; never substitute another student. */
export function coachingContext(
  data: StudioSnapshot,
  studentId: string,
  now = Date.now(),
) {
  const student = data.students.find((item) => item.id === studentId);
  if (!student) return undefined;
  const lessons = data.lessons.filter(
    (lesson) =>
      lesson.studentId === studentId ||
      data.lessonParticipants.some(
        (p) =>
          p.lessonId === lesson.id &&
          p.studentId === studentId &&
          p.status !== "cancelled",
      ),
  );
  const upcoming = lessons
    .filter(
      (lesson) =>
        lesson.status === "scheduled" && Date.parse(lesson.endsAt) >= now,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const seen = new Set<string>();
  const scripts = data.materials
    .filter(
      (item) =>
        item.studentId === studentId &&
        item.role === "current_script" &&
        item.status === "active",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((item) => {
      const id = item.resourceId || item.id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  const practice = sortAssignments(
    data.assignments.filter((item) => item.studentId === studentId),
  );
  const feedback = data.notes
    .filter(
      (item) => item.studentId === studentId && item.status === "published",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    student,
    lessons,
    upcoming,
    nextLesson: upcoming[0],
    scripts,
    practice,
    feedback,
  };
}

export function lessonDraft(
  data: StudioSnapshot,
  studentId: string,
  lessonId: string,
) {
  return data.notes
    .filter(
      (note) =>
        note.studentId === studentId &&
        note.lessonId === lessonId &&
        note.status === "draft",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function portalContextLink(path: string, studentId: string) {
  const [relative, hash] = path.split("#");
  const [pathname, query = ""] = relative.split("?");
  const params = new URLSearchParams(query);
  params.set("student", studentId);
  return `${pathname}?${params}${hash ? `#${hash}` : ""}`;
}

export function coachLessonLink(lesson: Lesson, writeNote = false) {
  if (lesson.offeringId)
    return `/coach/classes/${encodeURIComponent(lesson.offeringId)}`;
  if (!lesson.studentId)
    return `/coach/bookings?lesson=${encodeURIComponent(lesson.id)}`;
  return `/coach/students/${encodeURIComponent(lesson.studentId)}/lessons/${encodeURIComponent(lesson.id)}${writeNote ? `?writeNote=${encodeURIComponent(lesson.id)}` : ""}`;
}

export function isSharedLesson(data: StudioSnapshot, lesson: Lesson) {
  return (
    !!lesson.offeringId ||
    new Set(
      [
        lesson.studentId,
        ...data.lessonParticipants
          .filter((p) => p.lessonId === lesson.id && p.status !== "cancelled")
          .map((p) => p.studentId),
      ].filter(Boolean),
    ).size > 1
  );
}
