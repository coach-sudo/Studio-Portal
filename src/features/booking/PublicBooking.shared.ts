import { seriesDates } from "../../domain/booking";
import type {
  Booking,
  BookingService,
  MeetingProvider,
  PaymentPolicy,
  RecurrenceCadence,
  ServiceOffering,
  StudioSnapshot,
} from "../../domain/model";
import {
  formatStudioDate,
  formatStudioDateTime,
  safeStudioTimezone,
} from "../../domain/presentation";

export const visitorTimezone = () =>
  safeStudioTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
export const formatDate = (
  value: string,
  options: Intl.DateTimeFormatOptions = {},
  timezone = visitorTimezone(),
) => {
  const dateOptions = {
    weekday: "short" as const,
    month: "short" as const,
    day: "numeric" as const,
    year: undefined,
    ...options,
  };
  return options.hour || options.minute
    ? formatStudioDateTime(value, timezone, dateOptions)
    : formatStudioDate(value, timezone, dateOptions);
};
export const locationLabel = (value: MeetingProvider) =>
  value === "google_meet" ? "Google Meet" : "In person";
export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export type PublicStudio = {
  name: string;
  coachName?: string;
  branding: StudioSnapshot["settings"]["branding"];
  bookingCopy: StudioSnapshot["settings"]["bookingCopy"];
  bookingPage: StudioSnapshot["settings"]["bookingPage"];
  bookingDefaults: StudioSnapshot["settings"]["bookingDefaults"];
  contactEmail?: string;
};
export type AuthenticatedBooker = {
  studentId: string;
  name: string;
  email: string;
  forMinor: boolean;
  guardianName?: string;
  guardianEmail?: string;
};

export const mapService = (row: any): BookingService => ({
  id: row.id,
  version: row.version,
  updatedAt: row.updated_at,
  studioId: row.studio_id ?? "",
  slug: row.slug,
  name: row.name,
  description: row.description,
  category: row.category,
  durationMinutes: row.duration_minutes,
  priceMinor: Number(row.price_minor),
  depositMinor: Number(row.deposit_minor),
  depositType:
    row.deposit_type ?? (Number(row.deposit_minor) > 0 ? "fixed" : "none"),
  depositPercentage:
    row.deposit_percentage == null ? undefined : Number(row.deposit_percentage),
  balanceDueTiming: row.balance_due_timing ?? "at_booking",
  balanceDueHours: row.balance_due_hours ?? undefined,
  autoChargeBalance: Boolean(row.auto_charge_balance),
  currency: row.currency,
  capacity: row.capacity,
  locationOptions: row.location_options,
  defaultLocation: row.default_location,
  recurrenceOptions: row.recurrence_options,
  paymentPolicies: row.payment_policies,
  bufferBeforeMinutes: row.buffer_before_minutes,
  bufferAfterMinutes: row.buffer_after_minutes,
  bufferByLocation: row.buffer_by_location ?? {},
  locationPriceAdjustments: row.location_price_adjustments ?? {},
  minimumNoticeHours: row.minimum_notice_hours,
  bookingHorizonDays: row.booking_horizon_days,
  slotIntervalMinutes: row.slot_interval_minutes,
  policy: row.policy,
  policyVersion: row.policy_version ?? 1,
  published: true,
});
export const mapOffering = (row: any): ServiceOffering => ({
  id: row.id,
  version: row.version,
  updatedAt: row.updated_at,
  studioId: row.studio_id ?? "",
  serviceId: row.service_id,
  title: row.title,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  enrollmentClosesAt: row.enrollment_closes_at,
  capacity: row.capacity,
  enrolled: row.enrolled,
  lessonIds: row.lesson_ids,
  published: true,
  description: row.description || undefined,
  meetingUrl: row.meeting_url || undefined,
  resourceLinks: row.resource_links ?? [],
});

export interface DemoBookingInput {
  service: BookingService;
  offering?: ServiceOffering;
  startsAt: string;
  endsAt: string;
  location: MeetingProvider;
  recurrence: RecurrenceCadence;
  paymentPolicy: PaymentPolicy;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  forMinor: boolean;
  guardianName?: string;
  guardianEmail?: string;
  createPortalProfile: boolean;
  timezone: string;
}

export function createDemoBooking(
  draft: StudioSnapshot,
  input: DemoBookingInput,
) {
  const now = new Date().toISOString();
  let student = draft.students.find(
    (item) => item.email?.toLowerCase() === input.guestEmail.toLowerCase(),
  );
  if (!student) {
    student = {
      id: uid("student"),
      studioId: draft.studioId,
      fullName: input.guestName,
      email: input.guestEmail.toLowerCase(),
      status: "lead",
      isMinor: input.forMinor,
      guardianName: input.guardianName,
      guardianEmail: input.guardianEmail,
      portalEnabled: input.createPortalProfile,
      actorPageEligible: false,
      version: 1,
      updatedAt: now,
    };
    draft.students.push(student);
  }
  if (input.createPortalProfile) student.portalEnabled = true;
  const occurrenceCount = input.offering
    ? Math.max(1, input.offering.lessonIds.length)
    : input.recurrence === "none"
      ? 1
      : input.paymentPolicy === "subscription"
        ? 12
        : 6;
  const totalMinor =
    input.service.category === "private" &&
    input.recurrence !== "none" &&
    input.paymentPolicy !== "subscription"
      ? input.service.priceMinor * occurrenceCount
      : input.service.priceMinor;
  let paidMinor =
    input.paymentPolicy === "pay_now"
      ? totalMinor
      : input.paymentPolicy === "deposit"
        ? input.service.depositMinor
        : input.paymentPolicy === "credits"
          ? totalMinor
          : input.paymentPolicy === "installments"
            ? Math.floor(totalMinor / occurrenceCount)
            : input.paymentPolicy === "subscription"
              ? input.service.priceMinor
              : 0;
  let creditEntry: StudioSnapshot["creditEntries"][number] | undefined;
  if (input.paymentPolicy === "credits") {
    const packages = draft.packages.filter(
      (item) => item.studentId === student!.id,
    );
    const available = packages.find(
      (item) =>
        draft.creditEntries
          .filter((entry) => entry.packageId === item.id)
          .reduce((sum, entry) => sum + entry.quantity, 0) >= occurrenceCount,
    );
    if (!available)
      throw new Error(
        "This demo student does not have enough lesson credits. Use maya@example.com or choose another payment option.",
      );
    creditEntry = {
      id: uid("credit"),
      packageId: available.id,
      kind: "reservation",
      quantity: -occurrenceCount,
      reason: "Interactive demo booking",
      createdAt: now,
    };
    draft.creditEntries.push(creditEntry);
  }
  const seriesId =
    input.service.category === "private" && input.recurrence !== "none"
      ? uid("series")
      : undefined;
  if (seriesId)
    draft.recurringSeries.push({
      id: seriesId,
      studioId: draft.studioId,
      serviceId: input.service.id,
      studentId: student.id,
      kind: input.paymentPolicy === "subscription" ? "ongoing" : "fixed",
      cadence: input.recurrence as "weekly" | "biweekly",
      status: "active",
      startsOn: input.startsAt,
      occurrenceCount:
        input.paymentPolicy === "subscription" ? undefined : occurrenceCount,
      paymentPolicy: input.paymentPolicy,
      nextBillingAt:
        input.paymentPolicy === "subscription"
          ? seriesDates(
              input.startsAt,
              input.recurrence as "weekly" | "biweekly",
              2,
              input.timezone,
            )[1]
          : undefined,
      recurrenceRule: {
        intervalWeeks: input.recurrence === "biweekly" ? 2 : 1,
        slots: [],
      },
      studentCanModify: false,
      discountMinor: 0,
      meetingProvider: input.location,
      version: 1,
      updatedAt: now,
    });
  if (input.offering) {
    const offering = draft.serviceOfferings.find(
      (item) => item.id === input.offering!.id,
    );
    if (!offering || offering.enrolled >= offering.capacity)
      throw new Error("That class is sold out.");
    offering.enrolled += 1;
    offering.version += 1;
    offering.updatedAt = now;
  }
  const manageToken = `demo-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const booking: Booking = {
    id: uid("booking"),
    studioId: draft.studioId,
    reference: `SS-${Math.floor(100000 + Math.random() * 899999)}`,
    serviceId: input.service.id,
    offeringId: input.offering?.id,
    seriesId,
    studentId: student.id,
    guestName: input.guestName,
    guestEmail: input.guestEmail.toLowerCase(),
    guardianName: input.guardianName,
    guardianEmail: input.guardianEmail,
    forMinor: input.forMinor,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timezone: input.timezone,
    location: input.location,
    status: "confirmed",
    paymentPolicy: input.paymentPolicy,
    paymentStatus:
      input.paymentPolicy === "pay_later"
        ? "due"
        : input.paymentPolicy === "deposit" ||
            input.paymentPolicy === "installments"
          ? "partially_paid"
          : "paid",
    totalMinor,
    paidMinor,
    currency: input.service.currency,
    policySnapshot: structuredClone(input.service.policy),
    rescheduleCount: 0,
    manageToken,
    version: 1,
    updatedAt: now,
  };
  draft.bookings.push(booking);

  const occurrenceStarts = input.offering
    ? seriesDates(
        input.startsAt,
        "weekly",
        Math.max(1, input.offering.lessonIds.length),
        input.timezone,
      )
    : input.recurrence === "none"
      ? [input.startsAt]
      : seriesDates(
          input.startsAt,
          input.recurrence as "weekly" | "biweekly",
          occurrenceCount,
          input.timezone,
        );
  occurrenceStarts.forEach((startsAt, index) => {
    const lessonId = input.offering?.lessonIds[index] ?? uid("lesson");
    const endsAt = new Date(
      new Date(startsAt).getTime() + input.service.durationMinutes * 60_000,
    ).toISOString();
    if (!draft.lessons.some((item) => item.id === lessonId))
      draft.lessons.push({
        id: lessonId,
        studioId: draft.studioId,
        studentId: student!.id,
        topic: input.offering?.title ?? input.service.name,
        startsAt,
        endsAt,
        status: "scheduled",
        locationType: input.location === "in_person" ? "in_person" : "virtual",
        locationLabel:
          input.location === "in_person"
            ? `${draft.settings.studioName} studio`
            : "Google Meet pending",
        serviceId: input.service.id,
        offeringId: input.offering?.id,
        seriesId,
        meetingProvider: input.location,
        capacity: input.offering?.capacity ?? 1,
        version: 1,
        updatedAt: now,
      });
    draft.lessonParticipants.push({
      id: uid("participant"),
      lessonId,
      bookingId: booking.id,
      studentId: student!.id,
      displayName: input.guestName,
      email: input.guestEmail.toLowerCase(),
      status: "confirmed",
    });
  });
  if (creditEntry)
    creditEntry.lessonId =
      input.offering?.lessonIds[0] ??
      draft.lessonParticipants.find((item) => item.bookingId === booking.id)
        ?.lessonId;
  if (paidMinor > 0 && input.paymentPolicy !== "credits")
    draft.payments.push({
      id: uid("payment"),
      studentId: student.id,
      kind: "payment",
      amountMinor: paidMinor,
      currency: input.service.currency,
      externalReference: `demo:${booking.id}`,
      reason: "Interactive demo payment",
      createdAt: now,
    });
  draft.outbox.push({
    id: uid("outbox"),
    studentId: student.id,
    channel: "email",
    recipient: input.guardianEmail || input.guestEmail,
    subject: `Your ${draft.settings.studioName} booking is confirmed`,
    body: `${input.service.name}\nManage booking: /booking/${manageToken}`,
    status: "sent",
    attempts: 1,
    version: 1,
    updatedAt: now,
  });
  return booking;
}
