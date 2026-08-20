import { demoSnapshot } from "./demo";
import type {
  StudioSnapshot,
  StudentStatus,
  LessonStatus,
  Material,
} from "../domain/model";

type Row = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const num = (value: unknown) => Number(value || 0);
const bool = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;
const date = (value: unknown, fallback = new Date().toISOString()) => {
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
};
const status = (value: unknown): StudentStatus =>
  (({
    ACTIVE: "active",
    LEAD: "lead",
    PAUSED: "paused",
    ALUMNI: "alumni",
    INACTIVE: "inactive",
    EXPIRING: "active",
  })[text(value).toUpperCase()] as StudentStatus) || "lead";
const lessonStatus = (value: unknown): LessonStatus =>
  (({
    DRAFT: "draft",
    SCHEDULED: "scheduled",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
    CANCELED: "cancelled",
    LATE_CANCEL: "late_cancelled",
    NO_SHOW: "no_show",
  })[text(value).toUpperCase()] as LessonStatus) || "draft";
const rows = (value: unknown) => (Array.isArray(value) ? (value as Row[]) : []);

export function adaptLegacySnapshot(raw: unknown): StudioSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>,
    studentsRaw = rows(source.students);
  if (!studentsRaw.length) return null;
  const next = structuredClone(demoSnapshot),
    now = new Date().toISOString();
  next.students = studentsRaw.map((row) => ({
    id: text(row.student_id),
    studioId: next.studioId,
    fullName:
      text(row.full_name) ||
      [text(row.first_name), text(row.last_name)].filter(Boolean).join(" "),
    preferredName: text(row.preferred_name || row.first_name) || undefined,
    pronouns: text(row.pronouns) || undefined,
    email: text(row.email) || undefined,
    phone: text(row.phone) || undefined,
    guardianName: text(row.guardian_name) || undefined,
    guardianEmail: text(row.guardian_email) || undefined,
    status: status(row.studio_status),
    focusArea: text(row.focus_area) || undefined,
    isMinor: bool(row.student_is_minor),
    portalEnabled: row.portal_access_enabled !== false,
    portalUsername: text(row.portal_username) || undefined,
    actorPageEligible: bool(row.actor_page_eligible),
    leadSource:
      [text(row.lead_source), text(row.lead_source_detail)]
        .filter(Boolean)
        .join(" · ") || undefined,
    goals: text(row.goals || row.coaching_goals) || undefined,
    privateNotes: text(row.private_notes || row.coach_notes) || undefined,
    driveFolderUrl:
      text(row.drive_folder_url || row.google_drive_folder_url) || undefined,
    defaultRateMinor: num(row.default_lesson_rate)
      ? Math.round(num(row.default_lesson_rate) * 100)
      : undefined,
    tags: text(row.tags)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    lastContactAt: text(row.last_contact_at)
      ? date(row.last_contact_at)
      : undefined,
    version: num(row.version) || 1,
    updatedAt: date(row.updated_at || row.created_at, now),
  }));
  const studentIds = new Set(next.students.map((item) => item.id));
  next.lessons = rows(source.lessons)
    .filter((row) => studentIds.has(text(row.student_id)))
    .map((row) => ({
      id: text(row.lesson_id),
      studioId: next.studioId,
      studentId: text(row.student_id),
      topic: text(row.topic || row.lesson_type) || "Coaching lesson",
      startsAt: date(row.scheduled_start),
      endsAt: date(row.scheduled_end),
      status: lessonStatus(row.lesson_status),
      locationType:
        text(row.location_type).toUpperCase() === "IN_PERSON"
          ? "in_person"
          : "virtual",
      locationLabel:
        text(row.location_address || row.location_label || row.location_type) ||
        "Online",
      joinUrl: text(row.join_link || row.join_url) || undefined,
      packageId: text(row.package_id) || undefined,
      version: num(row.version) || 1,
      updatedAt: date(row.updated_at || row.scheduled_start, now),
    }));
  const lessonIds = new Set(next.lessons.map((item) => item.id));
  next.notes = rows(source.notes)
    .filter(
      (row) =>
        studentIds.has(text(row.student_id)) &&
        lessonIds.has(text(row.lesson_id)),
    )
    .map((row) => ({
      id: text(row.note_id),
      studentId: text(row.student_id),
      lessonId: text(row.lesson_id),
      title: text(row.title) || "Lesson note",
      body: text(row.body),
      status:
        text(row.status).toUpperCase() === "PUBLISHED"
          ? "published"
          : text(row.status).toUpperCase() === "ARCHIVED"
            ? "archived"
            : "draft",
      version: num(row.version) || 1,
      updatedAt: date(row.updated_at || row.published_at, now),
    }));
  next.assignments = rows(source.homework || source.assignments)
    .filter((row) => studentIds.has(text(row.student_id)))
    .map((row) => ({
      id: text(row.homework_id || row.assignment_id),
      studentId: text(row.student_id),
      lessonId: text(row.lesson_id) || undefined,
      title: text(row.title) || "Practice",
      details: text(row.details),
      dueAt: text(row.due_date) ? date(row.due_date) : undefined,
      status:
        text(row.status).toUpperCase() === "DONE" ||
        text(row.status).toUpperCase() === "COMPLETED"
          ? "completed"
          : "assigned",
      helpRequested: bool(row.reminder_requested || row.help_requested),
      version: num(row.version) || 1,
      updatedAt: date(row.updated_at || row.created_at, now),
    }));
  next.materials = rows(source.files || source.materials)
    .filter((row) => studentIds.has(text(row.student_id)))
    .map((row) => {
      const scope = text(row.scope).toUpperCase(),
        kind = text(row.material_kind).toUpperCase();
      return {
        id: text(row.file_id || row.material_id),
        studentId: text(row.student_id),
        lessonId: text(row.lesson_id) || undefined,
        title: text(row.title || row.file_name) || "Material",
        category: text(row.category) || "Other",
        role: (scope === "CURRENT_SCRIPT"
          ? "current_script"
          : scope === "LESSON_MATERIAL"
            ? "lesson_material"
            : kind.includes("ACTOR")
              ? "actor_material"
              : "library") as Material["role"],
        status:
          text(row.status).toUpperCase() === "VAULTED" ? "vaulted" : "active",
        approvalStatus:
          text(row.public_page_status).toUpperCase() === "APPROVED"
            ? "approved"
            : text(row.public_page_status).toUpperCase() === "PENDING_REVIEW"
              ? "pending_review"
              : "not_public",
        externalUrl:
          text(row.file_url || row.external_url || row.url) || undefined,
        version: num(row.version) || 1,
        updatedAt: date(row.updated_at || row.uploaded_at, now),
      };
    });
  next.packages = rows(source.packages)
    .filter((row) => studentIds.has(text(row.student_id)))
    .map((row) => ({
      id: text(row.package_id),
      studentId: text(row.student_id),
      name: text(row.package_name) || "Lesson package",
      expiresAt: text(row.expires_at || row.expires_on)
        ? date(row.expires_at || row.expires_on)
        : undefined,
      priceMinor: Math.round(num(row.package_price) * 100),
      currency: text(row.currency || "USD"),
      version: num(row.version) || 1,
      updatedAt: date(row.updated_at || row.created_at, now),
    }));
  next.creditEntries = next.packages.flatMap((pkg) => {
    const row =
      rows(source.packages).find((item) => text(item.package_id) === pkg.id) ??
      {};
    const total = Math.max(0, num(row.sessions_total) || 1),
      remaining = Math.max(0, num(row.sessions_remaining));
    return [
      {
        id: `${pkg.id}-purchase`,
        packageId: pkg.id,
        kind: "purchase" as const,
        quantity: total,
        reason: "Package sessions",
        createdAt: pkg.updatedAt,
      },
      ...(total > remaining
        ? [
            {
              id: `${pkg.id}-used`,
              packageId: pkg.id,
              kind: "adjustment" as const,
              quantity: -(total - remaining),
              reason: "Sessions used",
              createdAt: pkg.updatedAt,
            },
          ]
        : []),
    ];
  });
  next.payments = rows(source.payments)
    .filter((row) => studentIds.has(text(row.student_id)))
    .map((row) => ({
      id: text(row.payment_id),
      studentId: text(row.student_id),
      packageId: text(row.related_package_id) || undefined,
      kind: text(row.payment_type).toUpperCase().includes("REFUND")
        ? "refund"
        : "payment",
      amountMinor: Math.round(num(row.amount) * 100),
      currency: text(row.currency || "USD"),
      externalReference: text(row.external_reference) || undefined,
      reason: text(row.review_note || row.payment_type) || "Payment",
      createdAt: date(row.payment_date || row.created_at, now),
    }));
  next.actorProfiles = rows(source.actorProfiles || source.actor_profiles)
    .filter((row) => studentIds.has(text(row.student_id)))
    .map((row) => ({
      id: text(row.actor_profile_id) || `actor-${text(row.student_id)}`,
      studentId: text(row.student_id),
      slug:
        text(row.slug) ||
        text(row.display_name)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      displayName:
        text(row.display_name) ||
        next.students.find((item) => item.id === text(row.student_id))
          ?.fullName ||
        "Actor",
      bio: text(row.bio),
      status:
        text(row.status).toLowerCase() === "active" ? "published" : "draft",
      version: num(row.version) || 1,
      updatedAt: date(row.updated_at || row.created_at, now),
    }));
  next.readerRequests = rows(source.readerRequests || source.reader_requests)
    .filter((row) => studentIds.has(text(row.student_id)))
    .map((row) => ({
      id: text(row.reader_request_id),
      studentId: text(row.student_id),
      filmingAt: date(row.filming_at || row.filming_date),
      meetingMethod: text(row.meeting_method),
      instructions: text(row.instructions || row.notes),
      status: "submitted",
      version: num(row.version) || 1,
      updatedAt: date(row.updated_at || row.created_at, now),
    }));
  return next;
}
