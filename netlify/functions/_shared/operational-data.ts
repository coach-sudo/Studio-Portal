import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../../../src/types/database.generated";
import type { ReadinessData } from "../../../src/domain/lessonReadiness";
import type {
  Booking,
  Lesson,
  PackageDefinition,
} from "../../../src/domain/model";
import { notificationRecipientContext } from "./notification-recipients";
import { emailDefaults } from "./email-templates";
import { z } from "zod";
import { AppError } from "./http";

/** Failure alerts are studio-scoped even when an invite/guest/campaign has no student. */
export async function loadDeliveryFailureData(
  client: SupabaseClient,
  studioId: string,
  messageId: string,
): Promise<ReadinessData> {
  const db = client as SupabaseClient<Database>;
  const [message, studio] = await Promise.all([
    db
      .from("outbox_messages")
      .select("*")
      .eq("id", messageId)
      .eq("studio_id", studioId)
      .single(),
    db.from("studios").select("settings,timezone").eq("id", studioId).single(),
  ]);
  if (message.error || !message.data) throw AppError.forbidden(message.error);
  if (studio.error) throw studio.error;
  const settings = studio.data.settings as {
    emailAutomations?: typeof emailDefaults;
    currency?: string;
  };
  const row = message.data;
  return {
    students: [],
    lessons: [],
    bookings: [],
    lessonParticipants: [],
    packages: [],
    packageDefinitions: [],
    creditEntries: [],
    payments: [],
    studentPricingRules: [],
    linkedContacts: [],
    settings: {
      timezone: studio.data.timezone,
      currency: settings.currency ?? "USD",
      emailAutomations: { ...emailDefaults, ...settings.emailAutomations },
    },
    outbox: [
      {
        id: row.id,
        studentId: row.student_id ?? undefined,
        lessonId: row.lesson_id ?? undefined,
        recipient: row.recipient,
        subject: row.subject,
        body: row.body,
        status: row.status,
        channel: z.enum(["email", "sms"]).parse(row.channel),
        attempts: row.attempts,
        eventKey: row.event_key ?? undefined,
        version: row.version,
        updatedAt: row.updated_at,
      },
    ],
  };
}

async function completeRows<T>(
  page: (
    start: number,
    end: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const data: T[] = [];
  for (let start = 0; ; start += 500) {
    const result = await page(start, start + 499);
    if (result.error) throw result.error;
    data.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) return { data, error: null };
  }
}

// Server projection shares the pure evaluator; no browser client or demo snapshot is imported.
export async function loadOperationalData(
  client: SupabaseClient,
  studioId: string,
  studentId: string,
): Promise<ReadinessData> {
  const db = client as SupabaseClient<Database>;
  const context = await notificationRecipientContext(client, studentId);
  if (context.student.studioId !== studioId) throw AppError.forbidden();
  const results = await Promise.all([
    db.from("studios").select("settings,timezone").eq("id", studioId).single(),
    completeRows<Tables<"lessons">>((start, end) =>
      db
        .from("lessons")
        .select("*")
        .eq("studio_id", studioId)
        .eq("student_id", studentId)
        .order("id")
        .range(start, end),
    ),
    completeRows<Tables<"bookings">>((start, end) =>
      db
        .from("bookings")
        .select("*")
        .eq("studio_id", studioId)
        .eq("student_id", studentId)
        .order("id")
        .range(start, end),
    ),
    completeRows<Tables<"lesson_participants">>((start, end) =>
      db
        .from("lesson_participants")
        .select("*")
        .eq("student_id", studentId)
        .order("id")
        .range(start, end),
    ),
    completeRows<Tables<"packages">>((start, end) =>
      db
        .from("packages")
        .select("*")
        .eq("student_id", studentId)
        .order("id")
        .range(start, end),
    ),
    completeRows<Tables<"package_definitions">>((start, end) =>
      db
        .from("package_definitions")
        .select("*")
        .eq("studio_id", studioId)
        .order("id")
        .range(start, end),
    ),
    completeRows<Tables<"student_pricing_rules">>((start, end) =>
      db
        .from("student_pricing_rules")
        .select("*")
        .eq("studio_id", studioId)
        .eq("student_id", studentId)
        .order("id")
        .range(start, end),
    ),
    db
      .from("outbox_messages")
      .select("*")
      .eq("studio_id", studioId)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const [
    studio,
    lessons,
    bookings,
    participants,
    packages,
    definitions,
    pricing,
    outbox,
  ] = results;
  // Ledger must be complete: never calculate balances from a truncated first page.
  const credits: Tables<"package_credit_entries">[] = [];
  const packageIds = (packages.data ?? []).map((row) => row.id);
  if (packageIds.length)
    for (let page = 0; ; page++) {
      const result = await db
        .from("package_credit_entries")
        .select("*")
        .in("package_id", packageIds)
        .order("id")
        .range(page * 500, page * 500 + 499);
      if (result.error) throw result.error;
      credits.push(...result.data);
      if (result.data.length < 500) break;
    }
  const settings = (studio.data?.settings ?? {}) as {
    currency?: string;
    emailAutomations?: Partial<typeof emailDefaults>;
  };
  return {
    students: [context.student],
    linkedContacts: context.contacts,
    settings: {
      timezone: studio.data?.timezone ?? "America/New_York",
      currency: settings.currency ?? "USD",
      emailAutomations: { ...emailDefaults, ...settings.emailAutomations },
    },
    lessons: (lessons.data ?? []).map((row) => ({
      id: row.id,
      studioId: row.studio_id,
      studentId: row.student_id ?? "",
      topic: row.topic,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      locationType: z.enum(["virtual", "in_person"]).parse(row.location_type),
      locationLabel: row.location_label,
      joinUrl: row.join_url ?? undefined,
      packageId: row.package_id ?? undefined,
      serviceId: row.service_id ?? undefined,
      meetingProvider:
        z
          .enum(["google_meet", "in_person"])
          .nullish()
          .parse(row.meeting_provider) ?? undefined,
      sourceProvider:
        z
          .enum([
            "studio",
            "public_booking",
            "google_calendar",
            "gmail",
            "lessonface",
            "wyzant",
            "lessons_com",
            "acuity",
          ])
          .nullish()
          .parse(row.source_provider) ?? undefined,
      sourceExternalId: row.source_external_id ?? undefined,
      paymentStatus:
        z
          .enum([
            "untracked",
            "due",
            "partially_paid",
            "paid",
            "paid_by_credit",
            "waived",
            "refunded",
          ])
          .nullish()
          .parse(row.payment_status) ?? undefined,
      priceMinor: row.price_minor ?? undefined,
      paidMinor: row.paid_minor ?? 0,
      preparation: row.preparation as Lesson["preparation"],
      version: row.version,
      updatedAt: row.updated_at,
    })),
    bookings: (bookings.data ?? []).map((row) => ({
      id: row.id,
      studioId: row.studio_id,
      reference: row.reference,
      serviceId: row.service_id,
      studentId: row.student_id ?? undefined,
      guestName: row.guest_name,
      guestEmail: row.guest_email,
      forMinor: row.for_minor,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timezone: row.timezone,
      location: z.enum(["google_meet", "in_person"]).parse(row.location),
      status: z
        .enum([
          "held",
          "pending_payment",
          "confirmed",
          "cancelled",
          "late_cancelled",
          "completed",
          "expired",
          "needs_attention",
        ])
        .parse(row.status),
      paymentPolicy: z
        .enum([
          "pay_now",
          "pay_later",
          "deposit",
          "credits",
          "installments",
          "subscription",
        ])
        .parse(row.payment_policy),
      paymentStatus: z
        .enum([
          "not_required",
          "due",
          "processing",
          "paid",
          "partially_paid",
          "past_due",
          "refunded",
          "failed",
        ])
        .parse(row.payment_status),
      totalMinor: row.total_minor,
      paidMinor: row.paid_minor,
      currency: row.currency,
      policySnapshot:
        row.policy_snapshot as unknown as Booking["policySnapshot"],
      balanceDueAt: row.balance_due_at ?? undefined,
      rescheduleCount: row.reschedule_count,
      version: row.version,
      updatedAt: row.updated_at,
    })),
    lessonParticipants: (participants.data ?? []).map((row) => ({
      id: row.id,
      lessonId: row.lesson_id,
      bookingId: row.booking_id ?? undefined,
      studentId: row.student_id ?? undefined,
      displayName: row.display_name,
      email: row.email,
      status: z
        .enum(["reserved", "confirmed", "cancelled", "attended", "no_show"])
        .parse(row.status),
    })),
    packages: (packages.data ?? []).map((row) => ({
      id: row.id,
      definitionId: row.definition_id ?? undefined,
      studentId: row.student_id,
      name: row.name,
      expiresAt: row.expires_at ?? undefined,
      priceMinor: row.price_minor,
      currency: row.currency,
      autoApply: row.auto_apply,
      version: row.version,
      updatedAt: row.updated_at,
    })),
    packageDefinitions: (definitions.data ?? []).map((row) => ({
      id: row.id,
      studioId: row.studio_id,
      name: row.name,
      description: row.description,
      sessionCount: row.session_count,
      sessionDurationMinutes: row.session_duration_minutes,
      priceMinor: row.price_minor,
      discountMinor: row.discount_minor,
      currency: row.currency,
      expirationDays: row.expiration_days ?? undefined,
      eligibleServiceIds: row.eligible_service_ids,
      meetingProviders:
        row.meeting_providers as PackageDefinition["meetingProviders"],
      recurringEligible: row.recurring_eligible,
      visibility: z.enum(["public", "private"]).parse(row.visibility),
      directPurchase: row.direct_purchase,
      active: row.active,
      version: row.version,
      updatedAt: row.updated_at,
    })),
    studentPricingRules: (pricing.data ?? []).map((row) => ({
      id: row.id,
      studioId: row.studio_id,
      studentId: row.student_id,
      serviceId: row.service_id ?? undefined,
      priceMinor: row.price_minor,
      reason: row.reason,
      startsAt: row.starts_at,
      endsAt: row.ends_at ?? undefined,
      active: row.active,
      version: row.version,
      updatedAt: row.updated_at,
    })),
    creditEntries: credits.map((row) => ({
      id: row.id,
      packageId: row.package_id,
      lessonId: row.lesson_id ?? undefined,
      kind: row.kind,
      quantity: row.quantity,
      reason: row.reason,
      createdAt: row.created_at,
    })),
    payments: [],
    outbox: (outbox.data ?? []).map((row) => ({
      id: row.id,
      studentId: row.student_id ?? undefined,
      lessonId: row.lesson_id ?? undefined,
      recipient: row.recipient,
      subject: row.subject,
      body: row.body,
      status: row.status,
      channel: z.enum(["email", "sms"]).parse(row.channel),
      attempts: row.attempts,
      eventKey: row.event_key ?? undefined,
      sendAt: row.send_at ?? undefined,
      version: row.version,
      updatedAt: row.updated_at,
    })),
  };
}
