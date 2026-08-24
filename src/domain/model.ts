export type UUID = string;
export type Role = "coach" | "student" | "guardian";
export type StudentStatus =
  | "lead"
  | "active"
  | "paused"
  | "alumni"
  | "inactive";
export type LessonStatus =
  | "draft"
  | "scheduled"
  | "completed"
  | "cancelled"
  | "late_cancelled"
  | "no_show";
export type NoteStatus = "draft" | "published" | "archived";
export type AssignmentStatus =
  | "assigned"
  | "in_progress"
  | "completed"
  | "reopened";
export type MaterialStatus = "active" | "vaulted" | "archived";
export type ApprovalStatus =
  | "not_public"
  | "pending_review"
  | "changes_requested"
  | "approved"
  | "removed";
export type ActorProfileStatus =
  | "draft"
  | "review_requested"
  | "changes_requested"
  | "approved"
  | "published"
  | "archived";
export type CreditEntryKind =
  | "purchase"
  | "reservation"
  | "consumption"
  | "release"
  | "adjustment"
  | "expiration";
export type PaymentEntryKind = "payment" | "refund" | "adjustment";
export type DeliveryStatus =
  | "draft"
  | "approved"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";
export type ServiceCategory = "private" | "group_class" | "course";
export type MeetingProvider = "google_meet" | "in_person";
export type RecurrenceCadence = "none" | "weekly" | "biweekly" | "custom";
export type DepositType = "none" | "fixed" | "percentage" | "full";
export type PaymentPolicy =
  | "pay_now"
  | "pay_later"
  | "deposit"
  | "credits"
  | "installments"
  | "subscription";
export type BookingStatus =
  | "held"
  | "pending_payment"
  | "confirmed"
  | "cancelled"
  | "late_cancelled"
  | "completed"
  | "expired"
  | "needs_attention";
export type BookingPaymentStatus =
  | "not_required"
  | "due"
  | "processing"
  | "paid"
  | "partially_paid"
  | "past_due"
  | "refunded"
  | "failed";
export type SeriesKind = "fixed" | "ongoing" | "course";
export type SeriesStatus =
  | "active"
  | "paused"
  | "cancel_at_period_end"
  | "cancelled"
  | "completed";
export type ParticipantStatus =
  | "reserved"
  | "confirmed"
  | "cancelled"
  | "attended"
  | "no_show";
export type PolicySettlement =
  | "original_payment"
  | "studio_credit"
  | "none"
  | "manual";

export interface Versioned {
  id: UUID;
  version: number;
  updatedAt: string;
}
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
  portalUsername?: string;
  actorPageEligible: boolean;
  preferredName?: string;
  pronouns?: string;
  dateOfBirth?: string;
  address?: string;
  leadSource?: string;
  goals?: string;
  privateNotes?: string;
    driveFolderUrl?: string;
    timezone?: string;
    portalPreferences?: { compactView?: boolean; showProgress?: boolean; emailReminders?: boolean };
    stripeCustomerId?: string;
    paymentMethodSummary?: string;
    defaultRateMinor?: number;
  tags?: string[];
  lastContactAt?: string;
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
  serviceId?: UUID;
  offeringId?: UUID;
  seriesId?: UUID;
  meetingProvider?: MeetingProvider;
  capacity?: number;
  sourceProvider?: "studio" | "public_booking" | "google_calendar" | "gmail" | "lessonface" | "wyzant" | "lessons_com" | "acuity";
  sourceExternalId?: string;
  sourceConfidence?: number;
  importedAt?: string;
}
export interface IntegrationImport {
  id: UUID;
  studioId: UUID;
  provider: "google_calendar" | "gmail" | "lessonface" | "wyzant" | "lessons_com" | "acuity";
  externalId: string;
  detectedSource: string;
  studentId?: UUID;
  lessonId?: UUID;
  status: "imported" | "needs_review" | "ignored" | "failed";
  confidence: number;
  matchedBy?: string;
  verifiedAt?: string;
  verifiedBy?: UUID;
  verificationNote?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
export interface BookingPolicy {
  cancellationWindowHours: number;
  rescheduleLimit: number;
  settlement: PolicySettlement;
  lateSettlement: PolicySettlement;
}
export interface BookingService extends Versioned {
  studioId: UUID;
  slug: string;
  name: string;
  description: string;
  category: ServiceCategory;
  durationMinutes: number;
  priceMinor: number;
  depositMinor: number;
  depositType: DepositType;
  depositPercentage?: number;
  balanceDueTiming: "at_booking" | "before_start" | "manual";
  balanceDueHours?: number;
  autoChargeBalance: boolean;
  currency: string;
  capacity: number;
  locationOptions: MeetingProvider[];
  defaultLocation: MeetingProvider;
  recurrenceOptions: RecurrenceCadence[];
  paymentPolicies: PaymentPolicy[];
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  bufferByLocation: Partial<Record<MeetingProvider, { beforeMinutes: number; afterMinutes: number }>>;
  locationPriceAdjustments: Partial<Record<MeetingProvider, number>>;
  minimumNoticeHours: number;
  bookingHorizonDays: number;
  slotIntervalMinutes: number;
  policy: BookingPolicy;
  policyVersion: number;
  published: boolean;
}
export interface AvailabilityRule extends Versioned {
  studioId: UUID;
  serviceId?: UUID;
  weekday: number;
  startsAtLocal: string;
  endsAtLocal: string;
  timezone: string;
  active: boolean;
}
export interface AvailabilityException extends Versioned {
  studioId: UUID;
  serviceId?: UUID;
  startsAt: string;
  endsAt: string;
  kind: "unavailable" | "available";
  label: string;
}
export interface ServiceOffering extends Versioned {
  studioId: UUID;
  serviceId: UUID;
  title: string;
  startsAt: string;
  endsAt: string;
  enrollmentClosesAt: string;
  capacity: number;
  enrolled: number;
  lessonIds: UUID[];
  published: boolean;
  description?: string;
  meetingUrl?: string;
  resourceLinks?: { label: string; url: string }[];
}
export interface RecurringSeries extends Versioned {
  studioId: UUID;
  serviceId: UUID;
  studentId?: UUID;
  kind: SeriesKind;
  cadence: Exclude<RecurrenceCadence, "none">;
  status: SeriesStatus;
  startsOn: string;
  endsOn?: string;
  occurrenceCount?: number;
  paymentPolicy: PaymentPolicy;
  nextBillingAt?: string;
  recurrenceRule: { intervalWeeks: number; slots: { weekday: number; time: string }[] };
  studentCanModify: boolean;
  priceMinor?: number;
  discountMinor: number;
  meetingProvider?: MeetingProvider;
  pausedAt?: string;
}
export interface Booking extends Versioned {
  studioId: UUID;
  reference: string;
  serviceId: UUID;
  offeringId?: UUID;
  seriesId?: UUID;
  studentId?: UUID;
  guestName: string;
  guestEmail: string;
  guardianName?: string;
  guardianEmail?: string;
  forMinor: boolean;
  startsAt: string;
  endsAt: string;
  timezone: string;
  location: MeetingProvider;
  inPersonLocation?: string;
  locationConfirmedAt?: string;
  status: BookingStatus;
  paymentPolicy: PaymentPolicy;
  paymentStatus: BookingPaymentStatus;
  totalMinor: number;
  paidMinor: number;
  discountCodeId?: UUID;
  discountMinor?: number;
  currency: string;
  policySnapshot: BookingPolicy;
  pricingSnapshot?: Record<string, unknown>;
  balanceDueAt?: string;
  autoChargeBalance?: boolean;
  adminOverride?: Record<string, unknown>;
  rescheduleCount: number;
  manageToken?: string;
}
export interface BookingHold {
  id: UUID;
  serviceId: UUID;
  offeringId?: UUID;
  startsAt: string;
  endsAt: string;
  quantity: number;
  expiresAt: string;
  status: "active" | "converted" | "expired";
  checkoutSessionId?: string;
}
export interface LessonParticipant {
  id: UUID;
  lessonId: UUID;
  bookingId?: UUID;
  studentId?: UUID;
  displayName: string;
  email: string;
  status: ParticipantStatus;
}
export interface LessonMessage {
  id: UUID;
  lessonId: UUID;
  studentId: UUID;
  authorUserId?: UUID;
  authorRole: Role;
  body: string;
  createdAt: string;
}
export type WhiteboardElement =
  | { id: UUID; type: "path"; points: { x: number; y: number }[]; color: string; width: number; highlighted?: boolean }
  | { id: UUID; type: "text"; x: number; y: number; width: number; height: number; text: string; color: string; fontSize: number; fontFamily: string; underline?: boolean; highlighted?: boolean }
  | { id: UUID; type: "table"; x: number; y: number; width: number; height: number; rows: number; columns: number; cells: string[] }
  | { id: UUID; type: "pdf"; x: number; y: number; width: number; height: number; materialId: UUID; page?: number };
export interface LessonWhiteboard extends Versioned {
  studioId: UUID;
  lessonId: UUID;
  document: { version: number; elements: WhiteboardElement[] };
}
export interface Note extends Versioned {
  lessonId: UUID;
  studentId: UUID;
  title: string;
    body: string;
    bodyHtml?: string;
    richContent?: Record<string, unknown>;
    tags?: string[];
    category?: string;
    pinned?: boolean;
    status: NoteStatus;
}
export interface Assignment extends Versioned {
  lessonId?: UUID;
  studentId: UUID;
  title: string;
  details: string;
  dueAt?: string;
  status: AssignmentStatus;
  helpRequested: boolean;
}
export interface Material extends Versioned {
  studentId: UUID;
  lessonId?: UUID;
  title: string;
  category: string;
  role: "current_script" | "lesson_material" | "library" | "actor_material";
  status: MaterialStatus;
  approvalStatus: ApprovalStatus;
  storagePath?: string;
  externalUrl?: string;
  caption?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  mediaKind?: "image" | "video" | "audio" | "document" | "link";
  publicEmbed?: boolean;
  sortOrder?: number;
}
export interface PackageAccount extends Versioned {
  studentId: UUID;
  name: string;
  expiresAt?: string;
  priceMinor: number;
  currency: string;
}
export interface PackageDefinition extends Versioned {
  studioId: UUID;
  name: string;
  description: string;
  sessionCount: number;
  sessionDurationMinutes: number;
  priceMinor: number;
  discountMinor: number;
  currency: string;
  expirationDays?: number;
  eligibleServiceIds: UUID[];
  meetingProviders: MeetingProvider[];
  recurringEligible: boolean;
  visibility: "public" | "private";
  directPurchase: boolean;
  active: boolean;
}
export interface DiscountCode extends Versioned {
  studioId: UUID;
  code: string;
  description: string;
  discountType: "percent" | "fixed";
  amount: number;
  currency: string;
  serviceIds: UUID[];
  active: boolean;
  startsAt?: string;
  endsAt?: string;
  maxRedemptions?: number;
  redemptionCount: number;
}
export interface StudentPricingRule extends Versioned {
  studioId: UUID;
  studentId: UUID;
  serviceId?: UUID;
  priceMinor: number;
  reason: string;
  startsAt: string;
  endsAt?: string;
  active: boolean;
}
export interface CreditEntry {
  id: UUID;
  packageId: UUID;
  lessonId?: UUID;
  kind: CreditEntryKind;
  quantity: number;
  reason: string;
  createdAt: string;
}
export interface PaymentEntry {
  id: UUID;
  studentId: UUID;
  packageId?: UUID;
  kind: PaymentEntryKind;
  amountMinor: number;
  currency: string;
  externalReference?: string;
  reason: string;
  createdAt: string;
}
export interface ActorProfile extends Versioned {
  studentId: UUID;
  slug: string;
  displayName: string;
  bio: string;
  status: ActorProfileStatus;
  publishedRevisionId?: UUID;
  draftContent?: {
    headline?: string;
    unionStatus?: string;
    location?: string;
    playingAge?: string;
    height?: string;
    eyeColor?: string;
    hairColor?: string;
    website?: string;
    representation?: string;
    accentColor?: string;
  };
}
export interface OutboxMessage extends Versioned {
  studentId?: UUID;
  channel: "email" | "sms";
  recipient: string;
  subject: string;
  body: string;
  status: DeliveryStatus;
  attempts: number;
  lastError?: string;
}
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
export interface AuditEvent {
  id: UUID;
  actorId?: UUID;
  action: string;
  entityType: string;
  entityId: UUID;
  reason: string;
  correlationId: string;
  source: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}
export interface StudioSettings {
  studioName: string;
  studioTagline: string;
  coachName: string;
  coachTitle: string;
  contactEmail: string;
  contactPhone: string;
  timezone: string;
  currency: string;
  bookingUrl: string;
  portalLabel: string;
  welcomeMessage: string;
  showContactButtons: boolean;
  showBookingButton: boolean;
  showDriveFolder: boolean;
  reminderHours: number[];
  lessonRatesMinor: { 30: number; 60: number; 90: number; intro: number };
  bookingDefaults: { minimumNoticeHours: number; bookingHorizonDays: number; cancellationWindowHours: number; bufferBeforeMinutes: number; bufferAfterMinutes: number; recurringHorizonWeeks: number; inPersonUpchargeMinor: number };
  meetingFormats: Record<string, { enabled: boolean; label: string; location?: string }>;
  coachEmails?: string[];
  branding: { primaryColor: string; secondaryColor: string; accentColor: string; surfaceColor: string; logoUrl?: string; logoStoragePath?: string };
  bookingCopy: { eyebrow: string; headline: string; intro: string };
  bookingPage: { footerWebsiteUrl: string; footerWebsiteLabel: string; showCoachName: boolean; showTrustRow: boolean; showPolicies: boolean };
  emailAutomations: {
    enabled: boolean;
    coachNewBooking: boolean;
    studentConfirmation: boolean;
    reminders: boolean;
    confirmationSubject: string;
    confirmationBody: string;
    coachSubject: string;
    coachBody: string;
    reminderSubject: string;
    reminderBody: string;
    paymentFailedSubject: string;
    paymentFailedBody: string;
  };
  portalDefaults: { compactView: boolean; showProgress: boolean; showActorPage: boolean };
}
export interface StudioSnapshot {
  studioId: UUID;
  role: Role;
  displayName: string;
  settings: StudioSettings;
  students: Student[];
  lessons: Lesson[];
  notes: Note[];
  assignments: Assignment[];
  materials: Material[];
  packages: PackageAccount[];
  packageDefinitions: PackageDefinition[];
  studentPricingRules: StudentPricingRule[];
  creditEntries: CreditEntry[];
  payments: PaymentEntry[];
  actorProfiles: ActorProfile[];
  outbox: OutboxMessage[];
  recommendations: Recommendation[];
  bookingServices: BookingService[];
  availabilityRules: AvailabilityRule[];
  availabilityExceptions: AvailabilityException[];
  serviceOfferings: ServiceOffering[];
  recurringSeries: RecurringSeries[];
  bookings: Booking[];
  lessonParticipants: LessonParticipant[];
  lessonMessages: LessonMessage[];
  lessonWhiteboards: LessonWhiteboard[];
  integrationImports: IntegrationImport[];
  discountCodes: DiscountCode[];
}

export interface CommandEnvelope<T> {
  idempotencyKey: string;
  expectedVersion: number;
  reason: string;
  payload: T;
}
export interface CommandResult<T> {
  resource: T;
  recommendations: Recommendation[];
  auditEventId: UUID;
  queuedSideEffects: string[];
}
export interface ApiErrorShape {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  retryable: boolean;
  conflict?: unknown;
  correlationId: string;
}
