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

export async function queueLessonChangeEmails(
  client: SupabaseClient,
  lessonId: string,
  kind: "rescheduled" | "cancelled",
  correlationId: string,
) {
  const db = client as SupabaseClient<Database>;
  const { data: lesson, error } = await db
    .from("lessons")
    .select("*")
    .eq("id", lessonId)
    .single();
  if (error) throw error;
  const [
    { data: studio, error: studioError },
    { data: participants, error: participantsError },
    { data: student, error: studentError },
    rule,
  ] = await Promise.all([
    db
      .from("studios")
      .select("name,settings")
      .eq("id", lesson.studio_id)
      .single(),
    db
      .from("lesson_participants")
      .select("booking_id,student_id,email")
      .eq("lesson_id", lesson.id),
    lesson.student_id
      ? db
          .from("students")
          .select("full_name,preferred_name")
          .eq("id", lesson.student_id)
          .single()
      : Promise.resolve({
          data: { full_name: "Class participants", preferred_name: null },
          error: null,
        }),
    compatibleRule(client, lesson.studio_id, "lesson_reminder"),
  ]);
  if (studioError || participantsError || studentError)
    throw studioError || participantsError || studentError;
  const settings = studio!.settings as {
    emailAutomations?: typeof emailDefaults;
    reminderHours?: number[];
    timezone?: string;
    contactEmail?: string;
    coachName?: string;
    branding?: { logoUrl?: string };
  };
  const automation = { ...emailDefaults, ...settings.emailAutomations };
  if (!automation.enabled) return [];
  const origin = portalOrigin();
  const bookingId = participants?.find(
    (item) => item.student_id === lesson.student_id,
  )?.booking_id;
  const recipients = new Set(
    lesson.student_id
      ? (
          await resolveEventRecipients(
            client,
            lesson.student_id,
            kind === "cancelled" ? "cancellation" : "schedule_change",
            { mandatory: true },
          )
        ).recipients.map((item) => item.email)
      : [],
  );
  // Group participants are resolved through their own identity and permissions, not raw emails.
  for (const participant of participants ?? [])
    if (participant.student_id && participant.student_id !== lesson.student_id)
      for (const recipient of (
        await resolveEventRecipients(
          client,
          participant.student_id,
          kind === "cancelled" ? "cancellation" : "schedule_change",
          { mandatory: true },
        )
      ).recipients)
        recipients.add(recipient.email);
  const canceled = await db
    .from("outbox_messages")
    .update({
      status: "cancelled",
      suppression_reason:
        kind === "cancelled" ? "lesson_cancelled" : "lesson_rescheduled",
      updated_at: new Date().toISOString(),
    })
    .in("status", ["draft", "approved", "queued", "failed"])
    .eq("event_key", "booking.reminder.student")
    .or(
      `lesson_id.eq.${lesson.id}${bookingId ? `,booking_id.eq.${bookingId}` : ""}`,
    );
  if (canceled.error) throw canceled.error;
  const values = {
    studioName: studio!.name,
    studentName: student!.preferred_name || student!.full_name,
    serviceName: lesson.topic,
    startsAt: new Intl.DateTimeFormat("en-US", {
      timeZone: settings.timezone || "America/New_York",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(lesson.starts_at)),
    location: lesson.location_label,
    reference: "",
    manageUrl: portalActionUrl(origin, "lesson", lesson.id),
    hours: "",
    meetingDetails: "Open your lesson for meeting details.",
  };
  const subject = renderEmailTemplate(
    kind === "rescheduled"
      ? automation.rescheduleSubject
      : automation.cancellationSubject,
    values,
  );
  const body = renderEmailTemplate(
    kind === "rescheduled"
      ? automation.rescheduleBody
      : automation.cancellationBody,
    values,
  );
  const base = {
    studio_id: lesson.studio_id,
    student_id: lesson.student_id,
    lesson_id: lesson.id,
    booking_id: bookingId,
    correlation_id: correlationId,
    channel: "email",
    entity_snapshot: { startsAt: lesson.starts_at, endsAt: lesson.ends_at },
    status: "queued" as const,
  };
  const messages: TablesInsert<"outbox_messages">[] = [...recipients].map(
    (recipient) => ({
      ...base,
      recipient,
      subject,
      body,
      recipient_intent:
        kind === "cancelled" ? "cancellation" : "schedule_change",
      send_at: new Date().toISOString(),
      event_key: `lesson.${kind}.student`,
      dedupe_key: `lesson:${lesson.id}:${lesson.version}:${kind}:student:${recipient}`,
    }),
  );
  if (settings.contactEmail)
    messages.push({
      ...base,
      recipient: settings.contactEmail,
      subject: `${values.studentName}: ${subject}`,
      body,
      send_at: new Date().toISOString(),
      event_key: `lesson.${kind}.coach`,
      dedupe_key: `lesson:${lesson.id}:${lesson.version}:${kind}:coach`,
    });
  const reminderStatus = compatibleQueueStatus(rule, automation.reminders);
  if (kind === "rescheduled" && reminderStatus) {
    const timing = rule?.timing as { hoursBefore?: number[] } | undefined;
    const reminderRecipients = new Map<string, { email: string }>();
    const reminderStudentIds = new Set(
      [
        lesson.student_id,
        ...(participants ?? []).map((participant) => participant.student_id),
      ].filter((id): id is string => Boolean(id)),
    );
    for (const studentId of reminderStudentIds)
      for (const recipient of (
        await resolveEventRecipients(client, studentId, "lesson_reminder")
      ).recipients)
        reminderRecipients.set(recipient.email, recipient);
    for (const recipient of reminderRecipients.values())
      for (const hours of timing?.hoursBefore ??
        settings.reminderHours ?? [24, 2]) {
        const sendAt = new Date(
          Date.parse(lesson.starts_at) - hours * 3_600_000,
        );
        if (
          !Number.isFinite(hours) ||
          hours <= 0 ||
          sendAt.getTime() <= Date.now()
        )
          continue;
        messages.push({
          ...base,
          recipient: recipient.email,
          recipient_intent: "lesson_reminder",
          automation_rule_id: rule?.id,
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
          dedupe_key: `lesson:${lesson.id}:starts:${lesson.starts_at}:reminder:${hours}:${recipient.email}`,
        });
      }
  }
  return queuePresentedMessages(
    client,
    messages,
    { name: studio!.name, settings },
    origin,
  );
}
