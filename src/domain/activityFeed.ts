import type { StudioSnapshot } from "./model";
import { formatStudioDateTime } from "./presentation";

export type ActivityKind = "booking" | "lesson" | "material" | "assignment" | "note" | "import" | "message";
export type ActivityPriority = "action" | "update";
export interface ActivityItem {
  key: string;
  entityKey: string;
  kind: ActivityKind;
  priority: ActivityPriority;
  title: string;
  detail: string;
  occurredAt: string;
  route: string;
}

const withinRetention = (value: string, now: number) =>
  new Date(value).getTime() >= now - 30 * 86_400_000;

const priorityRank: Record<ActivityPriority, number> = { action: 0, update: 1 };

function lessonRoute(
  audience: "coach" | "student" | "guardian",
  studentId: string,
  lessonId: string,
) {
  const encodedLessonId = encodeURIComponent(lessonId);
  return audience === "coach"
    ? `/coach/students/${encodeURIComponent(studentId)}/lessons/${encodedLessonId}`
    : `/portal/lessons/${encodedLessonId}`;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function semanticHash(value: unknown) {
  const input = stableValue(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function collapseByEntity(items: ActivityItem[]) {
  const latest = new Map<string, ActivityItem>();
  for (const item of items) {
    const current = latest.get(item.entityKey);
    if (
      !current
      || item.occurredAt > current.occurredAt
      || (item.occurredAt === current.occurredAt && item.key > current.key)
    ) latest.set(item.entityKey, item);
  }
  return [...latest.values()];
}

export function buildActivityFeed(
  data: StudioSnapshot,
  audience: "coach" | "student" | "guardian",
  now = Date.now(),
): ActivityItem[] {
  const student = (id?: string) => {
    const item = data.students.find((row) => row.id === id);
    return item?.preferredName || item?.fullName || "Student";
  };
  const items: ActivityItem[] = [];
  for (const message of data.conversationMessages) {
    if (!withinRetention(message.createdAt, now)) continue;
    const incoming = audience === "coach"
      ? message.authorRole !== "coach"
      : message.authorRole === "coach";
    if (!incoming) continue;
    const conversation = data.conversations.find((item) => item.id === message.conversationId);
    if (!conversation) continue;
    items.push({
      key: `message:${message.id}`,
      entityKey: `conversation:${conversation.id}`,
      kind: "message",
      priority: "action",
      title: conversation.kind === "class" ? `New class message` : `New message from ${message.authorName}`,
      detail: `${conversation.title} · ${message.body}`,
      occurredAt: message.createdAt,
      route: `${audience === "coach" ? "/coach" : "/portal"}/inbox?conversation=${encodeURIComponent(conversation.id)}`,
    });
  }
  for (const booking of data.bookings) {
    if (!withinRetention(booking.updatedAt, now)) continue;
    const participant = data.lessonParticipants.find((item) => item.bookingId === booking.id);
    const linkedLesson = participant
      ? data.lessons.find((item) => item.id === participant.lessonId)
      : undefined;
    items.push({
      key: `booking:${booking.id}:${booking.version}`,
      entityKey: `booking:${booking.id}`,
      kind: "booking",
      priority: booking.status === "needs_attention" || booking.paymentStatus === "failed" || booking.paymentStatus === "past_due" ? "action" : "update",
      title: booking.status === "confirmed" ? "Booking confirmed" : "Booking updated",
      detail: `${booking.guestName} · ${formatStudioDateTime(booking.startsAt, data.settings.timezone)}`,
      occurredAt: booking.updatedAt,
      route: linkedLesson
        ? lessonRoute(audience, linkedLesson.studentId, linkedLesson.id)
        : booking.manageToken
          ? `/booking/${encodeURIComponent(booking.manageToken)}`
          : audience === "coach" ? "/coach/bookings?view=overview" : "/portal/bookings",
    });
  }
  for (const lesson of data.lessons) {
    if (!withinRetention(lesson.updatedAt, now)) continue;
    items.push({
      key: `lesson:${lesson.id}:${lesson.version}`,
      entityKey: `lesson:${lesson.id}`,
      kind: "lesson",
      priority: lesson.paymentStatus === "due" || lesson.paymentStatus === "partially_paid" ? "action" : "update",
      title: lesson.status === "cancelled" || lesson.status === "late_cancelled"
        ? "Lesson cancelled"
        : lesson.status === "completed" ? "Lesson completed" : "Lesson updated",
      detail: `${student(lesson.studentId)} · ${formatStudioDateTime(lesson.startsAt, data.settings.timezone)}`,
      occurredAt: lesson.updatedAt,
      route: lessonRoute(audience, lesson.studentId, lesson.id),
    });
  }
  for (const material of data.materials) {
    if (!withinRetention(material.updatedAt, now)) continue;
    items.push({
      key: `material:${material.id}:${material.version}`,
      entityKey: `material:${material.id}`,
      kind: "material",
      priority: audience === "coach"
        ? material.approvalStatus === "pending_review" ? "action" : "update"
        : material.approvalStatus === "changes_requested" ? "action" : "update",
      title: material.approvalStatus === "pending_review" ? "Material submitted" : "Material updated",
      detail: `${student(material.studentId)} · ${material.title}`,
      occurredAt: material.updatedAt,
      route: material.lessonId
        ? lessonRoute(audience, material.studentId, material.lessonId)
        : material.role === "actor_material"
          ? audience === "coach" ? `/coach/students/${encodeURIComponent(material.studentId)}/actor-page` : "/portal/actor-page"
          : audience === "coach" ? `/coach/students/${encodeURIComponent(material.studentId)}/work` : "/portal/work",
    });
  }
  for (const assignment of data.assignments) {
    if (!withinRetention(assignment.updatedAt, now)) continue;
    items.push({
      key: `assignment:${assignment.id}:${assignment.version}`,
      entityKey: `assignment:${assignment.id}`,
      kind: "assignment",
      priority: audience === "coach"
        ? assignment.helpRequested || assignment.status === "completed" ? "action" : "update"
        : assignment.status === "assigned" || assignment.status === "in_progress" || assignment.status === "reopened" ? "action" : "update",
      title: assignment.helpRequested ? "Practice help requested" : assignment.status === "completed" ? "Assignment completed" : "Assignment updated",
      detail: `${student(assignment.studentId)} · ${assignment.title}`,
      occurredAt: assignment.updatedAt,
      route: assignment.lessonId
        ? lessonRoute(audience, assignment.studentId, assignment.lessonId)
        : audience === "coach" ? `/coach/students/${encodeURIComponent(assignment.studentId)}/work` : "/portal/work",
    });
  }
  for (const note of data.notes) {
    if (!withinRetention(note.updatedAt, now)) continue;
    items.push({
      key: `note:${note.id}:${note.version}`,
      entityKey: `note:${note.id}`,
      kind: "note",
      priority: audience === "coach" && note.status === "draft" ? "action" : "update",
      title: note.status === "published" ? "Lesson note published" : "Note draft updated",
      detail: `${student(note.studentId)} · ${note.title}`,
      occurredAt: note.updatedAt,
      route: note.lessonId
        ? lessonRoute(audience, note.studentId, note.lessonId)
        : audience === "coach" ? `/coach/students/${encodeURIComponent(note.studentId)}/notes` : "/portal/notes",
    });
  }
  if (audience === "coach") {
    for (const item of data.integrationImports) {
      if (item.status !== "needs_review" || !withinRetention(item.updatedAt, now)) continue;
      items.push({
        key: `import:${item.id}:${semanticHash({
          status: item.status,
          studentId: item.studentId,
          lessonId: item.lessonId,
          detectedSource: item.detectedSource,
          matchedBy: item.matchedBy,
          verificationNote: item.verificationNote,
          payload: item.payload,
        })}`,
        entityKey: `import:${item.id}`,
        kind: "import",
        priority: "action",
        title: "Incoming lesson needs verification",
        detail: `${item.detectedSource.replaceAll("_", " ")} · ${String(item.payload?.summary || "Calendar or email lesson")}`,
        occurredAt: item.updatedAt,
        route: "/coach/today#verification",
      });
    }
  }
  return collapseByEntity(items)
    .sort((a, b) =>
      priorityRank[a.priority] - priorityRank[b.priority]
      || b.occurredAt.localeCompare(a.occurredAt)
      || a.entityKey.localeCompare(b.entityKey),
    )
    .slice(0, 40);
}
