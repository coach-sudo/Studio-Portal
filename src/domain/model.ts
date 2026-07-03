export type UUID = string;
export type Role = "coach" | "student" | "guardian";
export type StudentStatus = "lead" | "active" | "paused" | "alumni" | "inactive";
export type LessonStatus = "draft" | "scheduled" | "completed" | "cancelled" | "late_cancelled" | "no_show";
export type NoteStatus = "draft" | "published" | "archived";
export type AssignmentStatus = "assigned" | "in_progress" | "completed" | "reopened";
export type MaterialStatus = "active" | "vaulted" | "archived";
export type ApprovalStatus = "not_public" | "pending_review" | "changes_requested" | "approved" | "removed";
export type ActorProfileStatus = "draft" | "review_requested" | "changes_requested" | "approved" | "published" | "archived";
export type ReaderRequestStatus = "submitted" | "coach_review" | "approved" | "queued" | "sent" | "fulfilled" | "cancelled";
export type CreditEntryKind = "purchase" | "reservation" | "consumption" | "release" | "adjustment" | "expiration";
export type PaymentEntryKind = "payment" | "refund" | "adjustment";
export type DeliveryStatus = "draft" | "approved" | "queued" | "sending" | "sent" | "failed" | "cancelled";

export interface Versioned { id: UUID; version: number; updatedAt: string }
export interface Student extends Versioned {
  studioId: UUID;
  fullName: string;
  status: StudentStatus;
  email?: string;
  phone?: string;
  guardianName?: string;
  guardianEmail?: string;
  focusArea?: string;
  isMinor: boolean;
  portalEnabled: boolean;
  actorPageEligible: boolean;
}
export interface Lesson extends Versioned {
  studioId: UUID;
  studentId: UUID;
  topic: string;
  startsAt: string;
  endsAt: string;
  status: LessonStatus;
  locationType: "virtual" | "in_person";
  locationLabel: string;
  joinUrl?: string;
  packageId?: UUID;
}
export interface Note extends Versioned { lessonId: UUID; studentId: UUID; title: string; body: string; status: NoteStatus }
export interface Assignment extends Versioned { lessonId?: UUID; studentId: UUID; title: string; details: string; dueAt?: string; status: AssignmentStatus; helpRequested: boolean }
export interface Material extends Versioned { studentId: UUID; lessonId?: UUID; title: string; category: string; role: "current_script" | "lesson_material" | "library" | "actor_material"; status: MaterialStatus; approvalStatus: ApprovalStatus; storagePath?: string; externalUrl?: string }
export interface PackageAccount extends Versioned { studentId: UUID; name: string; expiresAt?: string; priceMinor: number; currency: string }
export interface CreditEntry { id: UUID; packageId: UUID; lessonId?: UUID; kind: CreditEntryKind; quantity: number; reason: string; createdAt: string }
export interface PaymentEntry { id: UUID; studentId: UUID; packageId?: UUID; kind: PaymentEntryKind; amountMinor: number; currency: string; externalReference?: string; reason: string; createdAt: string }
export interface ActorProfile extends Versioned { studentId: UUID; slug: string; displayName: string; bio: string; status: ActorProfileStatus; publishedRevisionId?: UUID }
export interface ReaderRequest extends Versioned { studentId: UUID; filmingAt: string; meetingMethod: string; instructions: string; status: ReaderRequestStatus }
export interface OutboxMessage extends Versioned { studentId?: UUID; channel: "email" | "sms"; recipient: string; subject: string; body: string; status: DeliveryStatus; attempts: number; lastError?: string }
export interface Recommendation {
  id: UUID;
  studioId: UUID;
  studentId?: UUID;
  entityType: string;
  entityId?: UUID;
  reasonCode: string;
  title: string;
  explanation: string;
  evidence: string[];
  urgency: 1 | 2 | 3 | 4 | 5;
  dueAt?: string;
  suggestedAction: string;
  requiresConfirmation: boolean;
}
export interface AuditEvent { id: UUID; actorId?: UUID; action: string; entityType: string; entityId: UUID; reason: string; correlationId: string; source: string; before?: unknown; after?: unknown; createdAt: string }
export interface StudioSnapshot {
  studioId: UUID;
  role: Role;
  displayName: string;
  students: Student[];
  lessons: Lesson[];
  notes: Note[];
  assignments: Assignment[];
  materials: Material[];
  packages: PackageAccount[];
  creditEntries: CreditEntry[];
  payments: PaymentEntry[];
  actorProfiles: ActorProfile[];
  readerRequests: ReaderRequest[];
  outbox: OutboxMessage[];
  recommendations: Recommendation[];
}

export interface CommandEnvelope<T> {
  idempotencyKey: string;
  expectedVersion: number;
  reason: string;
  payload: T;
}
export interface CommandResult<T> { resource: T; recommendations: Recommendation[]; auditEventId: UUID; queuedSideEffects: string[] }
export interface ApiErrorShape { code: string; message: string; fieldErrors?: Record<string, string[]>; retryable: boolean; conflict?: unknown; correlationId: string }
