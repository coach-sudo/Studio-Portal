import type { StudioSnapshot } from "./model";

export type ActivityKind = "booking" | "material" | "assignment" | "note" | "import";
export interface ActivityItem {
  key: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  occurredAt: string;
  route: string;
}

const withinRetention = (value: string, now: number) =>
  new Date(value).getTime() >= now - 30 * 86_400_000;

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
  for (const booking of data.bookings) {
    if (!withinRetention(booking.updatedAt, now)) continue;
    items.push({
      key: `booking:${booking.id}:${booking.version}`,
      kind: "booking",
      title: booking.status === "confirmed" ? "Booking confirmed" : "Booking updated",
      detail: `${booking.guestName} · ${new Date(booking.startsAt).toLocaleString()}`,
      occurredAt: booking.updatedAt,
      route: audience === "coach" ? "/coach/bookings" : "/portal/bookings",
    });
  }
  for (const material of data.materials) {
    if (!withinRetention(material.updatedAt, now)) continue;
    items.push({
      key: `material:${material.id}:${material.version}`,
      kind: "material",
      title: material.approvalStatus === "pending_review" ? "Material submitted" : "Material updated",
      detail: `${student(material.studentId)} · ${material.title}`,
      occurredAt: material.updatedAt,
      route: audience === "coach" ? "/coach/materials" : "/portal/work",
    });
  }
  for (const assignment of data.assignments) {
    if (!withinRetention(assignment.updatedAt, now)) continue;
    items.push({
      key: `assignment:${assignment.id}:${assignment.version}`,
      kind: "assignment",
      title: assignment.helpRequested ? "Practice help requested" : assignment.status === "completed" ? "Assignment completed" : "Assignment updated",
      detail: `${student(assignment.studentId)} · ${assignment.title}`,
      occurredAt: assignment.updatedAt,
      route: audience === "coach" ? `/coach/students/${assignment.studentId}/work` : "/portal/work",
    });
  }
  for (const note of data.notes) {
    if (!withinRetention(note.updatedAt, now)) continue;
    items.push({
      key: `note:${note.id}:${note.version}`,
      kind: "note",
      title: note.status === "published" ? "Lesson note published" : "Note draft updated",
      detail: `${student(note.studentId)} · ${note.title}`,
      occurredAt: note.updatedAt,
      route: audience === "coach" ? `/coach/students/${note.studentId}/notes` : "/portal/notes",
    });
  }
  if (audience === "coach") {
    for (const item of data.integrationImports) {
      if (item.status !== "needs_review" || !withinRetention(item.updatedAt, now)) continue;
      items.push({
        key: `import:${item.id}:${item.updatedAt}`,
        kind: "import",
        title: "Incoming lesson needs verification",
        detail: `${item.detectedSource.replaceAll("_", " ")} · ${String(item.payload?.summary || "Calendar or email lesson")}`,
        occurredAt: item.updatedAt,
        route: "/coach/today#verification",
      });
    }
  }
  return items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 40);
}
