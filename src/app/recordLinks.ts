import type { Role, StudioSnapshot } from "../domain/model";

export const recordKinds = [
  "student",
  "lesson",
  "booking",
  "resource",
  "note",
] as const;
export type RecordKind = (typeof recordKinds)[number];
export type RecordTarget = {
  kind: RecordKind;
  id: string;
  studentId?: string | null;
  lessonId?: string | null;
  assignmentId?: string | null;
};
export const isRecordKind = (value: string): value is RecordKind =>
  recordKinds.includes(value as RecordKind);

/** Accept only in-app return paths; URLs never carry record titles or snippets. */
export function safeReturnPath(value: unknown, fallback: string) {
  return typeof value === "string" &&
    /^\/(coach|portal)(?:[/?#]|$)/.test(value) &&
    !value.includes("\\") &&
    ![...value].some((char) => char.charCodeAt(0) < 32)
    ? value
    : fallback;
}
export function recordLink(
  role: Role,
  record: RecordTarget,
  studentId?: string,
) {
  const shell = role === "coach" ? "/coach" : "/portal";
  const params = new URLSearchParams();
  if (studentId || record.studentId)
    params.set("student", studentId || record.studentId!);
  if (record.kind === "resource" && record.assignmentId)
    params.set("assignment", record.assignmentId);
  return `${shell}/records/${record.kind}/${encodeURIComponent(record.id)}${params.size ? `?${params}` : ""}`;
}
/** Call only with an authorized backend result, never an arbitrary route ID. */
export function resolvedRecordLink(role: Role, record: RecordTarget) {
  const coach = role === "coach",
    p = new URLSearchParams();
  if (!coach && record.studentId) p.set("student", record.studentId);
  let path: string;
  switch (record.kind) {
    case "student":
      path = coach
        ? `/coach/students/${encodeURIComponent(record.id)}`
        : "/portal";
      break;
    case "lesson":
      path =
        coach && record.studentId
          ? `/coach/students/${encodeURIComponent(record.studentId)}/lessons/${encodeURIComponent(record.id)}`
          : coach
            ? "/coach/bookings"
            : `/portal/lessons/${encodeURIComponent(record.id)}`;
      if (coach && !record.studentId) p.set("lesson", record.id);
      break;
    case "booking":
      path = coach ? "/coach/bookings" : "/portal/bookings";
      p.set("booking", record.id);
      break;
    case "resource":
      path = coach ? "/coach/materials" : "/portal/work";
      p.set("resource", record.id);
      if (record.assignmentId) p.set("assignment", record.assignmentId);
      break;
    case "note":
      path = coach
        ? `/coach/students/${encodeURIComponent(record.studentId || "")}/notes`
        : "/portal/notes";
      p.set("note", record.id);
      break;
  }
  return path + (p.size ? `?${p}` : "");
}

export function demoRecord(
  data: StudioSnapshot,
  kind: string,
  id: string,
): RecordTarget | null {
  if (!isRecordKind(kind)) return null;
  if (kind === "student")
    return data.role === "coach" && data.students.some((s) => s.id === id)
      ? { kind, id, studentId: id }
      : null;
  if (kind === "lesson") {
    const r = data.lessons.find((r) => r.id === id);
    return r ? { kind, id, studentId: r.studentId } : null;
  }
  if (kind === "booking") {
    const r = data.bookings.find((r) => r.id === id);
    return r ? { kind, id, studentId: r.studentId } : null;
  }
  if (kind === "resource") {
    const r = data.materials.find((r) => (r.resourceId || r.id) === id);
    return r
      ? {
          kind,
          id,
          studentId: r.studentId,
          assignmentId: r.id,
          lessonId: r.lessonId,
        }
      : null;
  }
  const r = data.notes.find(
    (r) => r.id === id && (data.role === "coach" || r.status === "published"),
  );
  return r ? { kind, id, studentId: r.studentId, lessonId: r.lessonId } : null;
}
