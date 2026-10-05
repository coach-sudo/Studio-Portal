import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  TablesInsert,
} from "../../../src/types/database.generated";
import { emailDefaults, renderEmailTemplate } from "./email-templates";
import { resolveEventRecipients } from "./notification-recipients";
import {
  compatibleQueueStatus,
  compatibleRule,
  queuePresentedMessages,
} from "./outbox-queue";
import { portalActionUrl, portalOrigin } from "./portal-url";

export async function queueBookingEmails(
  client: SupabaseClient,
  bookingId: string,
  manageToken?: string,
  _origin?: string,
) {
  const db = client as SupabaseClient<Database>;
  const { data: booking, error } = await db
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();
  if (error) throw error;
  const [
    { data: studio, error: studioError },
    { data: service, error: serviceError },
    { data: participant, error: participantError },
    confirmationRule,
    reminderRule,
  ] = await Promise.all([
    db
      .from("studios")
      .select("name,settings")
      .eq("id", booking.studio_id)
      .single(),
    db
      .from("booking_services")
      .select("name")
      .eq("id", booking.service_id)
      .single(),
    db
      .from("lesson_participants")
      .select("lesson_id")
      .eq("booking_id", booking.id)
      .limit(1)
      .maybeSingle(),
    compatibleRule(client, booking.studio_id, "booking_confirmation"),
    compatibleRule(client, booking.studio_id, "lesson_reminder"),
  ]);
  if (studioError || serviceError || participantError)
    throw studioError || serviceError || participantError;
  const settings = studio!.settings as Record<string, unknown> & {
    emailAutomations?: typeof emailDefaults;
    reminderHours?: number[];
    contactEmail?: string;
    coachName?: string;
    branding?: { logoUrl?: string };
  };
  const automation = { ...emailDefaults, ...settings.emailAutomations };
  if (!automation.enabled) return [];
  const origin = portalOrigin();
  const manageUrl = portalActionUrl(origin, "booking", manageToken);
  const values = {
    studioName: studio!.name,
    studentName: booking.guest_name,
    serviceName: service!.name,
    startsAt: new Intl.DateTimeFormat("en-US", {
      timeZone: booking.timezone,
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(booking.starts_at)),
    location: booking.location === "in_person" ? "In person" : "Google Meet",
    reference: booking.reference,
    manageUrl,
    hours: "",
    meetingDetails:
      booking.location === "google_meet"
        ? "Open your lesson for meeting details."
        : "Your coach will confirm the location.",
  };
  const confirmationRecipients = booking.student_id
    ? (
        await resolveEventRecipients(
          client,
          booking.student_id,
          "lesson_confirmation",
          { mandatory: true },
        )
      ).recipients.map((item) => item.email)
    : [
        ...new Set(
          [booking.guest_email, booking.guardian_email]
            .filter((email): email is string => Boolean(email))
            .map((email) => email.trim().toLowerCase()),
        ),
      ];
  const reminderRecipients = booking.student_id
    ? (
        await resolveEventRecipients(
          client,
          booking.student_id,
          "lesson_reminder",
        )
      ).recipients.map((item) => item.email)
    : confirmationRecipients;
  const base = {
    studio_id: booking.studio_id,
    student_id: booking.student_id,
    booking_id: booking.id,
    lesson_id: participant?.lesson_id,
    channel: "email",
    entity_snapshot: { startsAt: booking.starts_at, endsAt: booking.ends_at },
    correlation_id: `booking:${booking.id}`,
  };
  const messages: TablesInsert<"outbox_messages">[] = [];
  const confirmationStatus = compatibleQueueStatus(
    confirmationRule,
    automation.studentConfirmation,
  );
  if (confirmationStatus)
    for (const recipient of confirmationRecipients)
      messages.push({
        ...base,
        recipient,
        subject: renderEmailTemplate(automation.confirmationSubject, values),
        body: renderEmailTemplate(automation.confirmationBody, values),
        status: confirmationStatus,
        send_at: new Date().toISOString(),
        event_key: "booking.confirmed.student",
        recipient_intent: "lesson_confirmation",
        automation_rule_id: confirmationRule?.id,
        dedupe_key: `booking:${booking.id}:confirmed:student:${recipient}`,
        priority: 80,
      });
  if (automation.coachNewBooking && settings.contactEmail)
    messages.push({
      ...base,
      recipient: settings.contactEmail,
      subject: renderEmailTemplate(automation.coachSubject, values),
      body: renderEmailTemplate(automation.coachBody, values),
      status: "queued",
      send_at: new Date().toISOString(),
      event_key: "booking.confirmed.coach",
      dedupe_key: `booking:${booking.id}:confirmed:coach`,
    });
  const reminderStatus = compatibleQueueStatus(
    reminderRule,
    automation.reminders,
  );
  const timing = reminderRule?.timing as { hoursBefore?: number[] } | undefined;
  if (reminderStatus)
    for (const recipient of reminderRecipients)
      for (const hours of timing?.hoursBefore ??
        settings.reminderHours ?? [72, 24, 2]) {
        const sendAt = new Date(
          Date.parse(booking.starts_at) - hours * 3_600_000,
        );
        if (
          !Number.isFinite(hours) ||
          hours <= 0 ||
          sendAt.getTime() <= Date.now()
        )
          continue;
        messages.push({
          ...base,
          recipient,
          subject: renderEmailTemplate(automation.reminderSubject, {
            ...values,
            hours: String(hours),
          }),
          body: renderEmailTemplate(automation.reminderBody, {
            ...values,
            hours: String(hours),
          }),
          status: reminderStatus,
          send_at: sendAt.toISOString(),
          event_key: "booking.reminder.student",
          recipient_intent: "lesson_reminder",
          automation_rule_id: reminderRule?.id,
          dedupe_key: `lesson:${participant?.lesson_id ?? booking.id}:starts:${booking.starts_at}:reminder:${hours}:${recipient}`,
          priority: 50,
        });
      }
  const confirmation = messages.filter(
    (message) => message.recipient_intent !== "lesson_reminder",
  );
  const reminders = messages.filter(
    (message) => message.recipient_intent === "lesson_reminder",
  );
  return [
    ...(await queuePresentedMessages(
      client,
      confirmation,
      { name: studio!.name, settings },
      origin,
      { label: "View / Manage Booking", url: manageUrl },
    )),
    ...(await queuePresentedMessages(
      client,
      reminders,
      { name: studio!.name, settings },
      origin,
      {
        label: "View Lesson",
        url: portalActionUrl(origin, "lesson", participant?.lesson_id),
      },
    )),
  ];
}
