import type { Lesson, Material, Note, Student } from "../domain/model";
import type { Database } from "../types/database.generated";

type StudentRow = Database["public"]["Tables"]["students"]["Row"];
type LessonRow = Database["public"]["Tables"]["lessons"]["Row"];
type NoteRow = Database["public"]["Tables"]["notes"]["Row"];
type MaterialRow = Database["public"]["Tables"]["materials"]["Row"];
type MaterialLinkRow = Database["public"]["Tables"]["material_links"]["Row"];
type MaterialLibraryRow =
  Database["public"]["Views"]["material_library_rows"]["Row"];

export const mapStudentRow = (
  row: StudentRow,
  profilePhotoUrl?: string,
): Student => ({
  id: row.id,
  studioId: row.studio_id,
  fullName: row.full_name,
  status: row.status,
  email: row.email ?? undefined,
  phone: row.phone ?? undefined,
  guardianName: row.guardian_name ?? undefined,
  guardianEmail: row.guardian_email ?? undefined,
  focusArea: row.focus_area ?? undefined,
  isMinor: row.is_minor,
  portalEnabled: row.portal_enabled,
  portalUsername: row.portal_username ?? undefined,
  actorPageEligible: row.actor_page_eligible,
  preferredName: row.preferred_name ?? undefined,
  pronouns: row.pronouns ?? undefined,
  goals: row.goals ?? undefined,
  leadSource: row.lead_source ?? undefined,
  tags: row.tags ?? undefined,
  driveFolderUrl: row.drive_folder_url ?? undefined,
  timezone: row.timezone ?? undefined,
  timezoneConfirmed: Boolean(row.timezone_confirmed),
  privateNotes: row.internal_notes ?? undefined,
  defaultRateMinor: row.default_rate_minor ?? undefined,
  specialPricingEnabled: Boolean(row.special_pricing_enabled),
  portalPreferences:
    (row.portal_preferences as Student["portalPreferences"]) ?? undefined,
  notificationPreferences:
    (row.notification_preferences as unknown as Student["notificationPreferences"]) ??
    undefined,
  profilePhotoAssetId: row.profile_photo_asset_id ?? undefined,
  profilePhotoUrl,
  profilePhotoPosition:
    (row.profile_photo_position as Student["profilePhotoPosition"]) ??
    undefined,
  stripeCustomerId: row.stripe_customer_id ?? undefined,
  paymentMethodSummary:
    typeof row.payment_method_summary === "string"
      ? row.payment_method_summary
      : ((row.payment_method_summary as { label?: string } | null)?.label ??
        ""),
  deletedAt: row.deleted_at ?? undefined,
  version: row.version,
  updatedAt: row.updated_at,
});

export const mapLessonRow = (row: LessonRow): Lesson => ({
  id: row.id,
  studioId: row.studio_id,
  studentId: row.student_id ?? "",
  topic: row.topic,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  status: row.status,
  locationType: row.location_type as Lesson["locationType"],
  locationLabel: row.location_label,
  joinUrl: row.join_url ?? undefined,
  packageId: row.package_id ?? undefined,
  serviceId: row.service_id ?? undefined,
  offeringId: row.offering_id ?? undefined,
  seriesId: row.series_id ?? undefined,
  meetingProvider:
    (row.meeting_provider as Lesson["meetingProvider"]) ?? undefined,
  capacity: row.capacity ?? undefined,
  sourceProvider: row.source_provider as Lesson["sourceProvider"],
  sourceExternalId: row.source_external_id ?? undefined,
  sourceConfidence:
    row.source_confidence == null ? undefined : Number(row.source_confidence),
  importedAt: row.imported_at ?? undefined,
  paymentStatus: row.payment_status as Lesson["paymentStatus"],
  priceMinor: row.price_minor == null ? undefined : Number(row.price_minor),
  paidMinor: Number(row.paid_minor || 0),
  preparation: (row.preparation as Lesson["preparation"]) ?? {
    planned: false,
    setupReady: false,
    materialsReady: false,
  },
  version: row.version,
  updatedAt: row.updated_at,
});

export const mapNoteRow = (row: NoteRow): Note => ({
  id: row.id,
  lessonId: row.lesson_id,
  studentId: row.student_id,
  title: row.title,
  body: row.body,
  bodyHtml: row.body_html ?? undefined,
  richContent: (row.rich_content as Note["richContent"]) ?? undefined,
  tags: row.tags ?? undefined,
  category: row.category ?? undefined,
  pinned: row.pinned ?? undefined,
  status: row.status,
  version: row.version,
  updatedAt: row.updated_at,
});

export const mapMaterialRow = (
  row: MaterialRow,
  link?: MaterialLinkRow,
  signedUrl?: string,
): Material => ({
  id: row.id,
  studentId: row.owner_student_id ?? "",
  lessonId: link?.lesson_id ?? undefined,
  title: row.title,
  category: row.category,
  role: (link?.role as Material["role"]) ?? "library",
  status: row.status,
  approvalStatus: row.approval_status,
  storagePath: row.storage_path ?? undefined,
  externalUrl: signedUrl ?? row.external_url ?? undefined,
  caption: row.caption ?? undefined,
  mimeType: row.mime_type ?? undefined,
  fileSizeBytes:
    row.file_size_bytes == null ? undefined : Number(row.file_size_bytes),
  mediaKind: row.media_kind as Material["mediaKind"],
  publicEmbed: row.public_embed ?? undefined,
  sortOrder: row.sort_order ?? undefined,
  version: row.version,
  updatedAt: row.updated_at,
});

export const mapMaterialLibraryRow = (row: MaterialLibraryRow): Material => ({
  id: row.id ?? "",
  studentId: row.owner_student_id ?? row.link_student_id ?? "",
  lessonId: row.lesson_id ?? undefined,
  title: row.title ?? "Untitled material",
  category: row.category ?? "Other",
  role: (row.link_role as Material["role"]) ?? "library",
  status: row.status ?? "active",
  approvalStatus: row.approval_status ?? "not_public",
  storagePath: row.storage_path ?? undefined,
  externalUrl: row.external_url ?? undefined,
  caption: row.caption ?? undefined,
  mimeType: row.mime_type ?? undefined,
  fileSizeBytes:
    row.file_size_bytes == null ? undefined : Number(row.file_size_bytes),
  mediaKind: row.media_kind as Material["mediaKind"],
  publicEmbed: row.public_embed ?? undefined,
  sortOrder: row.sort_order ?? undefined,
  version: row.version ?? 1,
  updatedAt: row.updated_at ?? row.created_at ?? new Date(0).toISOString(),
});
