export type UUID = string;
export type Role = "coach" | "student" | "guardian";
export type StudentStatus =
  "lead" | "active" | "paused" | "alumni" | "inactive";
export type LessonStatus =
  | "draft"
  | "scheduled"
  | "completed"
  | "cancelled"
  | "late_cancelled"
  | "no_show";
export type NoteStatus = "draft" | "published" | "archived";
export type AssignmentStatus =
  "assigned" | "in_progress" | "completed" | "reopened";
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
  "draft" | "approved" | "queued" | "sending" | "sent" | "failed" | "cancelled";
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
  "active" | "paused" | "cancel_at_period_end" | "cancelled" | "completed";
export type ParticipantStatus =
  "reserved" | "confirmed" | "cancelled" | "attended" | "no_show";
export type PolicySettlement =
  "original_payment" | "studio_credit" | "none" | "manual";

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
  timezoneConfirmed?: boolean;
  portalPreferences?: {
    compactView?: boolean;
    showProgress?: boolean;
    emailReminders?: boolean;
  };
  notificationPreferences?: NotificationPreferences;
  profilePhotoAssetId?: UUID;
  profilePhotoUrl?: string;
  profilePhotoPosition?: { x: number; y: number };
  stripeCustomerId?: string;
  paymentMethodSummary?: string;
  defaultRateMinor?: number;
  specialPricingEnabled?: boolean;
  tags?: string[];
  lastContactAt?: string;
  deletedAt?: string;
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
  sourceProvider?:
    | "studio"
    | "public_booking"
    | "google_calendar"
    | "gmail"
    | "lessonface"
    | "wyzant"
    | "lessons_com"
    | "acuity";
  sourceExternalId?: string;
  sourceConfidence?: number;
  importedAt?: string;
  paymentStatus?: "untracked" | "due" | "partially_paid" | "paid" | "paid_by_credit" | "waived" | "refunded";
  priceMinor?: number;
  paidMinor?: number;
  preparation?: {
    planned: boolean;
    setupReady: boolean;
    materialsReady: boolean;
  };
}
export interface IntegrationImport {
  id: UUID;
  studioId: UUID;
  provider:
    | "google_calendar"
    | "gmail"
    | "lessonface"
    | "wyzant"
    | "lessons_com"
    | "acuity";
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
  bufferByLocation: Partial<
    Record<MeetingProvider, { beforeMinutes: number; afterMinutes: number }>
  >;
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
export interface OfferingMessage {
  id: UUID;
  studioId: UUID;
  offeringId: UUID;
  authorUserId?: UUID;
  authorRole: "coach" | "student" | "guardian";
  authorName: string;
  body: string;
  createdAt: string;
}
export interface RecurringSeries extends Versioned {
  studioId: UUID;
  serviceId?: UUID;
  studentId?: UUID;
  kind: SeriesKind;
  cadence: Exclude<RecurrenceCadence, "none">;
  status: SeriesStatus;
  startsOn: string;
  endsOn?: string;
  occurrenceCount?: number;
  paymentPolicy: PaymentPolicy;
  nextBillingAt?: string;
  recurrenceRule: {
    intervalWeeks: number;
    slots: { weekday: number; time: string }[];
  };
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
  portalRequested?: boolean;
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
  activityType?: "instruction" | "qa" | "journal" | "multiple_choice" | "checklist";
  activityConfig?: { prompts?: string[]; options?: string[]; items?: string[] };
  responses?: Record<string, unknown>;
  progress?: number;
  studentResponse?: string;
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
  autoApply?: boolean;
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
  pricingServiceId?: UUID;
  pricingServiceVersion?: number;
  basePriceMinor?: number;
  discountType?: "none" | "fixed" | "percent";
  discountBasisPoints?: number;
  deliveryFormat?: "google_meet" | "in_person";
  giftable?: boolean;
  pricingStatus?: "current" | "changed" | "syncing" | "failed" | "legacy";
}
export type PackageRenewalMode =
  | "one_time"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "balance_threshold";
export interface PackageBillingOption extends Versioned {
  studioId: UUID;
  definitionId: UUID;
  renewalMode: PackageRenewalMode;
  balanceThreshold?: number;
  stripePriceId?: string;
  active: boolean;
}
export interface PackageSubscription extends Versioned {
  studioId: UUID;
  studentId: UUID;
  definitionId: UUID;
  billingOptionId: UUID;
  packageId?: UUID;
  renewalMode: Exclude<PackageRenewalMode, "one_time">;
  balanceThreshold?: number;
  autoApply: boolean;
  status:
    | "pending"
    | "active"
    | "past_due"
    | "paused"
    | "cancel_at_period_end"
    | "cancelled";
  nextBillingAt?: string;
}
export interface PackageGift extends Versioned {
  studioId: UUID;
  definitionId: UUID;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string;
  recipientEmail: string;
  message: string;
  deliverAt?: string;
  packageId?: UUID;
  claimedStudentId?: UUID;
  status: "pending_payment" | "purchased" | "delivered" | "claimed" | "expired" | "refunded";
  expiresAt: string;
}
export interface NotificationPreferences {
  lessonReminders: boolean;
  scheduleChanges: boolean;
  lessonContent: boolean;
  assignments: boolean;
  packageBalance: boolean;
  payments: boolean;
  accountAccess: boolean;
}
export interface LinkedContact extends Versioned {
  studioId: UUID;
  studentId: UUID;
  userId?: UUID;
  fullName: string;
  email: string;
  timezone?: string;
  timezoneConfirmed?: boolean;
  relationshipType: "guardian" | "support_person" | "other";
  relationshipLabel?: string;
  canViewSchedule: boolean;
  canManageLessons: boolean;
  canViewWork: boolean;
  canManageProfile: boolean;
  canViewFinance: boolean;
  canReceiveNotifications: boolean;
  notificationPreferences: NotificationPreferences;
  portalEnabled: boolean;
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
  locationPriceAdjustments?: Partial<Record<MeetingProvider, number>>;
  depositMinor?: number;
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
    profileLabel?: string;
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
    contactEmail?: string;
    contactPhone?: string;
    showEmail?: boolean;
    showPhone?: boolean;
    primaryHeadshotMaterialId?: string;
  };
}
export interface OutboxMessage extends Versioned {
  studentId?: UUID;
  lessonId?: UUID;
  correlationId?: string;
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
  bookingDefaults: {
    minimumNoticeHours: number;
    bookingHorizonDays: number;
    cancellationWindowHours: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    recurringHorizonWeeks: number;
    inPersonUpchargeMinor: number;
    requirePhone: boolean;
    allowRecurring: boolean;
    allowPayLater: boolean;
    showPrices: boolean;
    confirmationMessage: string;
    bookingButtonLabel: string;
  };
  meetingFormats: Record<
    string,
    { enabled: boolean; label: string; location?: string }
  >;
  coachEmails?: string[];
  branding: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    surfaceColor: string;
    logoUrl?: string;
    logoStoragePath?: string;
    coachProfilePhotoUrl?: string;
    coachProfilePhotoStoragePath?: string;
    coachProfilePhotoPosition?: { x: number; y: number };
  };
  bookingCopy: { eyebrow: string; headline: string; intro: string };
  bookingPage: {
    footerWebsiteUrl: string;
    footerWebsiteLabel: string;
    showCoachName: boolean;
    showTrustRow: boolean;
    showPolicies: boolean;
  };
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
    rescheduleSubject: string;
    rescheduleBody: string;
    cancellationSubject: string;
    cancellationBody: string;
    packageExpirySubject: string;
    packageExpiryBody: string;
    packageLowBalanceSubject?: string;
    packageLowBalanceBody?: string;
    paymentFailedSubject: string;
    paymentFailedBody: string;
  };
  portalDefaults: {
    compactView: boolean;
    showProgress: boolean;
    showActorPage: boolean;
  };
}
export interface StudioSnapshot {
  studioId: UUID;
  role: Role;
  displayName: string;
  currentLinkedContactId?: UUID;
  settings: StudioSettings;
  students: Student[];
  lessons: Lesson[];
  notes: Note[];
  assignments: Assignment[];
  materials: Material[];
  packages: PackageAccount[];
  packageDefinitions: PackageDefinition[];
  packageBillingOptions: PackageBillingOption[];
  packageSubscriptions: PackageSubscription[];
  packageGifts: PackageGift[];
  linkedContacts: LinkedContact[];
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
  offeringMessages: OfferingMessage[];
  recurringSeries: RecurringSeries[];
  bookings: Booking[];
  lessonParticipants: LessonParticipant[];
  lessonMessages: LessonMessage[];
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
