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
import { resolveBookingGuestRecipients } from "../../../src/domain/bookingGuestRecipients";

async function queueLessonChangeMessages(
  client: SupabaseClient,
  lessonId: string,
  kind: "rescheduled" | "cancelled",
  correlationId: string,
  scope?: { studentId: string; bookingId: string },
  effect?: {
    id: string;
    participant_ids: string[];
    student_ids: string[];
    snapshot: { startsAt: string; endsAt: string; status: string };
  },
) {
  const db = client as SupabaseClient<Database>;
  const { data: lesson, error } = await db
    .from("lessons")
    .select("*")
    .eq("id", lessonId)
    .single();
  if (error) throw error;
  if (
    effect &&
    (Date.parse(effect.snapshot.startsAt) !== Date.parse(lesson.starts_at) ||
      Date.parse(effect.snapshot.endsAt) !== Date.parse(lesson.ends_at) ||
      effect.snapshot.status !== lesson.status)
  )
    return [];
  const studentId =
    scope?.studentId ??
    (effect
      ? effect.student_ids.includes(lesson.student_id || "")
        ? lesson.student_id
        : null
      : lesson.student_id);
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
      .select("id,booking_id,student_id,email,status")
      .eq("lesson_id", lesson.id)
      .match(
        scope
          ? { booking_id: scope.bookingId, student_id: scope.studentId }
          : {},
      ),
    studentId
      ? db
          .from("students")
          .select("full_name,preferred_name")
          .eq("id", studentId)
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
  const bookingId =
    scope?.bookingId ??
    participants?.find((item) => item.student_id === studentId)?.booking_id;
  const recipientStudents = new Map<string, string>();
  const recipientBookings = new Map<string, string>();
  const selectedParticipants = (participants || []).filter((p) =>
    effect
      ? effect.participant_ids.includes(p.id)
      : ["reserved", "confirmed"].includes(p.status),
  );
  const recipients = new Set(
    studentId
      ? (
          await resolveEventRecipients(
            client,
            studentId,
            kind === "cancelled" ? "cancellation" : "schedule_change",
            { mandatory: true },
          )
        ).recipients.map((item) => item.email)
      : [],
  );
  // Group participants are resolved through their own identity and permissions, not raw emails.
  for (const email of recipients)
    if (studentId) {
      recipientStudents.set(email, studentId);
      if (bookingId) recipientBookings.set(email, bookingId);
    }
  for (const participant of selectedParticipants)
    if (participant.student_id && participant.student_id !== studentId)
      for (const recipient of (
        await resolveEventRecipients(
          client,
          participant.student_id,
          kind === "cancelled" ? "cancellation" : "schedule_change",
          { mandatory: true },
        )
      ).recipients) {
        recipients.add(recipient.email);
        recipientStudents.set(recipient.email, participant.student_id);
        if (participant.booking_id)
          recipientBookings.set(recipient.email, participant.booking_id);
      }
  for (const guestBooking of new Set(
    selectedParticipants
      .filter((p) => !p.student_id && p.booking_id)
      .map((p) => p.booking_id!),
  )) {
    const guest = await db
      .from("bookings")
      .select("for_minor,guest_email,guardian_email")
      .eq("id", guestBooking)
      .eq("studio_id", lesson.studio_id)
      .single();
    if (guest.error) throw guest.error;
    for (const recipient of resolveBookingGuestRecipients(
      guest.data,
      kind === "cancelled" ? "cancellation" : "schedule_change",
    ).recipients) {
      recipients.add(recipient.email);
      recipientBookings.set(recipient.email, guestBooking);
    }
  }
  let cancelQuery = db
    .from("outbox_messages")
    .update({
      status: "cancelled",
      suppression_reason:
        kind === "cancelled" ? "lesson_cancelled" : "lesson_rescheduled",
      updated_at: new Date().toISOString(),
    })
    .in("status", ["draft", "approved", "queued", "failed"])
    .eq("event_key", "booking.reminder.student")
    .eq("lesson_id", lesson.id);
  if (scope) cancelQuery = cancelQuery.eq("booking_id", scope.bookingId);
  const canceled = await cancelQuery;
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
    student_id: studentId,
    lesson_id: lesson.id,
    booking_id: bookingId,
    correlation_id: correlationId,
    channel: "email",
    entity_snapshot: {
      startsAt: lesson.starts_at,
      endsAt: lesson.ends_at,
      changeId: effect?.id,
      changedStatus: effect?.snapshot.status,
    },
    status: "queued" as const,
  };
  const messages: TablesInsert<"outbox_messages">[] = [...recipients].map(
    (recipient) => ({
      ...base,
      student_id: recipientStudents.get(recipient) || studentId,
      booking_id: recipientBookings.get(recipient) || bookingId,
      recipient,
      subject,
      body,
      recipient_intent:
        kind === "cancelled" ? "cancellation" : "schedule_change",
      send_at: new Date().toISOString(),
      event_key: `lesson.${kind}.student`,
      dedupe_key: `lesson:${lesson.id}:${effect?.id || lesson.version}:${kind}${scope ? `:${scope.bookingId}` : ""}:student:${recipient}`,
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
      dedupe_key: `lesson:${lesson.id}:${effect?.id || lesson.version}:${kind}${scope ? `:${scope.bookingId}` : ""}:coach`,
    });
  const reminderStatus = compatibleQueueStatus(rule, automation.reminders);
  if (kind === "rescheduled" && reminderStatus) {
    const timing = rule?.timing as { hoursBefore?: number[] } | undefined;
    const reminderRecipients = new Map<
      string,
      { email: string; studentId: string }
    >();
    const reminderStudentIds = new Set(
      [
        studentId,
        ...selectedParticipants.map((participant) => participant.student_id),
      ].filter((id): id is string => Boolean(id)),
    );
    for (const studentId of reminderStudentIds)
      for (const recipient of (
        await resolveEventRecipients(client, studentId, "lesson_reminder")
      ).recipients)
        reminderRecipients.set(recipient.email, { ...recipient, studentId });
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
          student_id: recipient.studentId,
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
    undefined,
    values,
  );
}

export async function processLessonChangeEffects(
  client: SupabaseClient,
  lessonId?: string,
) {
  const claim = await client.rpc("claim_lesson_change_effects", {
    p_limit: 25,
    p_lesson: lessonId || null,
  });
  if (claim.error) throw claim.error;
  const messages: { id: string }[] = [];
  let failed = 0;
  for (const effect of claim.data.effects) {
    try {
      const scope =
        effect.booking_id && effect.student_ids.length === 1
          ? { bookingId: effect.booking_id, studentId: effect.student_ids[0] }
          : undefined;
      const queued = await queueLessonChangeMessages(
        client,
        effect.lesson_id,
        effect.kind,
        effect.correlation_id,
        scope,
        effect,
      );
      const finished = await client.rpc("finish_lesson_change_effect", {
        p_id: effect.id,
        p_token: effect.claim_token,
        p_outbox: queued.map((m: { id: string }) => m.id),
        p_failed: false,
      });
      if (finished.error) throw finished.error;
      messages.push(...queued);
    } catch {
      const finished = await client.rpc("finish_lesson_change_effect", {
        p_id: effect.id,
        p_token: effect.claim_token,
        p_outbox: [],
        p_failed: true,
      });
      if (finished.error) throw finished.error;
      failed++;
    }
  }
  return {
    messages,
    failed,
    processed: claim.data.effects.length,
    tracked: claim.data.tracked,
  };
}
export async function queueLessonChangeEmails(
  client: SupabaseClient,
  lessonId: string,
  kind: "rescheduled" | "cancelled",
  correlationId: string,
  scope?: { studentId: string; bookingId: string },
) {
  const processed = await processLessonChangeEffects(client, lessonId);
  if (processed.tracked) return processed.messages;
  return queueLessonChangeMessages(
    client,
    lessonId,
    kind,
    correlationId,
    scope,
  );
}
