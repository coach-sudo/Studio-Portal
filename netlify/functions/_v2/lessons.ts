import { queueLessonChangeEmails } from "../_shared/booking-email";
import { googleAccessToken, googleFreeBusy } from "../_shared/google";
import { json } from "../_shared/http";
import { serviceClient } from "../_shared/supabase";
import type { V2CommandContext } from "./types";

export async function handleLessonsCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  const { audit, db, domain, id, input, requireCoach } = ctx;

  if (domain === "lessons" && input.command === "create") {
    const studioId = await requireCoach(),
      studentId = String(input.payload.studentId || ""),
      startsAt = String(input.payload.startsAt || ""),
      endsAt = String(input.payload.endsAt || "");
    if (
      !studentId ||
      !startsAt ||
      !endsAt ||
      new Date(endsAt) <= new Date(startsAt)
    )
      throw new Error("VALIDATION_FAILED");
    const cadence = String(input.payload.recurrence || "none");
    const occurrenceCount = Number(input.payload.occurrenceCount || 1);
    const { data, error } = await serviceClient().rpc("command_create_lesson", {
      target_studio: studioId,
      target_student: studentId,
      topic: String(input.payload.topic || "Private coaching"),
      starts_at: startsAt,
      ends_at: endsAt,
      location_type:
        input.payload.locationType === "in_person" ? "in_person" : "virtual",
      location_label: String(input.payload.locationLabel || "Google Meet"),
      student_name: String(input.payload.studentName || "Student"),
      student_email: String(input.payload.studentEmail || ""),
      recurrence: cadence,
      occurrence_count: occurrenceCount,
      timezone: String(input.payload.timezone || "America/New_York"),
    });
    if (error) throw error;
    const lesson = data.lesson;
    return json({
      resource: lesson,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "lesson",
        lesson.id,
        "lesson.created",
        null,
        data,
      ),
      queuedSideEffects: ["calendar_projection"],
    });
  }

  if (
    domain === "lessons" &&
    input.command === "make_recurring" &&
    input.entityId
  ) {
    const studioId = await requireCoach();
    const { data: lesson, error: readError } = await db
      .from("lessons")
      .select("id,studio_id")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    if (readError || !lesson) throw new Error("FORBIDDEN");
    const { data, error } = await serviceClient().rpc(
      "command_make_lesson_recurring",
      {
        p_lesson_id: lesson.id,
        p_expected_version: input.expectedVersion,
        p_cadence: String(input.payload.cadence || ""),
        p_occurrence_count: Number(input.payload.occurrenceCount || 0),
        p_timezone: String(input.payload.timezone || "America/New_York"),
      },
    );
    if (error) throw error;
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "lesson",
        lesson.id,
        "lesson.series_created",
        { version: input.expectedVersion },
        data,
      ),
      queuedSideEffects: ["calendar_projection"],
    });
  }

  if (domain === "lessons" && input.command === "prepare" && input.entityId) {
    const studioId = await requireCoach();
    const preparation = {
      planned: Boolean((input.payload.preparation as any)?.planned),
      setupReady: Boolean((input.payload.preparation as any)?.setupReady),
      materialsReady: Boolean(
        (input.payload.preparation as any)?.materialsReady,
      ),
    };
    const { data: before, error: readError } = await db
      .from("lessons")
      .select("*")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    const { data, error } = await serviceClient()
      .from("lessons")
      .update({
        preparation,
        version: input.expectedVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.entityId)
      .eq("version", input.expectedVersion)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "lesson",
        data.id,
        "lesson.preparation_updated",
        before.preparation,
        data.preparation,
      ),
      queuedSideEffects: [],
    });
  }

  if (
    domain === "lessons" &&
    input.command === "update_details" &&
    input.entityId
  ) {
    const studioId = await requireCoach();
    const { data: before, error: readError } = await db
      .from("lessons")
      .select("*")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    const { data, error } = await db.rpc("command_update_lesson_details", {
      target_lesson: before.id,
      expected_version: input.expectedVersion,
      next_topic: String(input.payload.topic || before.topic),
      next_location_type: before.location_type,
      next_location_label: String(
        input.payload.locationLabel || before.location_label,
      ),
      next_join_url:
        input.payload.joinUrl == null ? null : String(input.payload.joinUrl),
    });
    if (error) throw error;
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "lesson",
        before.id,
        "lesson.details_updated",
        before,
        data,
      ),
      queuedSideEffects: ["calendar_projection"],
    });
  }

  if (domain === "lessons" && input.command === "complete") {
    const { data, error } = await db.rpc("command_complete_lesson", {
      lesson_id: input.entityId,
      expected_version: input.expectedVersion,
      reason: input.reason,
      idempotency_key: input.idempotencyKey,
      correlation_id: id,
    });
    if (error) throw error;
    return json(data);
  }

  if (domain === "lessons" && input.command === "cancel" && input.entityId) {
    const studioId = await requireCoach(),
      { data: before, error: readError } = await db
        .from("lessons")
        .select("*")
        .eq("id", input.entityId)
        .eq("studio_id", studioId)
        .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    const service = serviceClient();
    const { data: changed, error } = await service.rpc(
      "command_change_lesson_state",
      {
        p_lesson_id: before.id,
        p_expected_version: input.expectedVersion,
        p_action: "cancel",
        p_starts_at: null,
        p_ends_at: null,
        p_queue_calendar: true,
      },
    );
    if (error) throw error;
    const data = changed.lesson;
    const emails = await queueLessonChangeEmails(
      service,
      before.id,
      "cancelled",
      id,
    );
    const auditEventId = await audit(
      studioId,
      "lesson",
      before.id,
      "lesson.cancelled",
      before,
      data,
    );
    return json({
      resource: data,
      recommendations: [],
      auditEventId,
      queuedSideEffects: [
        "calendar_projection",
        ...emails.map((message: any) => `email:${message.id}`),
      ],
      correlationId: id,
    });
  }

  if (
    domain === "lessons" &&
    input.command === "set_payment_status" &&
    input.entityId
  ) {
    const studioId = await requireCoach();
    const allowed = new Set([
      "untracked",
      "due",
      "partially_paid",
      "paid",
      "paid_by_credit",
      "waived",
      "refunded",
    ]);
    const paymentStatus = String(input.payload.paymentStatus || "");
    const priceMinor =
      input.payload.priceMinor == null
        ? null
        : Math.max(0, Math.round(Number(input.payload.priceMinor)));
    const paidMinor = Math.max(
      0,
      Math.round(Number(input.payload.paidMinor || 0)),
    );
    if (
      !allowed.has(paymentStatus) ||
      (priceMinor != null && paidMinor > priceMinor)
    )
      throw new Error(
        "VALIDATION_FAILED: Choose a valid payment status and amounts.",
      );
    const service = serviceClient();
    const { data: before, error: readError } = await service
      .from("lessons")
      .select("*")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    if (Number(before.version) !== Number(input.expectedVersion))
      throw new Error("VERSION_CONFLICT");
    const { data, error } = await service
      .from("lessons")
      .update({
        payment_status: paymentStatus,
        price_minor: priceMinor,
        paid_minor: paidMinor,
        version: Number(before.version) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", before.id)
      .eq("version", input.expectedVersion)
      .select()
      .single();
    if (error) throw error;
    const { data: participant } = await service
      .from("lesson_participants")
      .select("booking_id")
      .eq("lesson_id", before.id)
      .not("booking_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (participant?.booking_id) {
      const bookingStatus =
        paymentStatus === "paid_by_credit" || paymentStatus === "waived"
          ? "paid"
          : paymentStatus === "untracked"
            ? "due"
            : paymentStatus;
      await service
        .from("bookings")
        .update({
          payment_status: bookingStatus,
          ...(priceMinor == null ? {} : { total_minor: priceMinor }),
          paid_minor: paidMinor,
          updated_at: new Date().toISOString(),
        })
        .eq("id", participant.booking_id);
    }
    const auditEventId = await audit(
      studioId,
      "lesson",
      before.id,
      "lesson.payment_status_changed",
      before,
      data,
    );
    return json({ resource: data, auditEventId, correlationId: id });
  }

  if (
    domain === "lessons" &&
    input.command === "reschedule" &&
    input.entityId
  ) {
    const studioId = await requireCoach(),
      startsAt = String(input.payload.startsAt || ""),
      endsAt = String(input.payload.endsAt || "");
    if (
      !startsAt ||
      !endsAt ||
      !Number.isFinite(new Date(startsAt).getTime()) ||
      !Number.isFinite(new Date(endsAt).getTime()) ||
      new Date(endsAt) <= new Date(startsAt) ||
      new Date(startsAt) <= new Date()
    )
      throw new Error("VALIDATION_FAILED: A valid lesson time is required.");
    const service = serviceClient();
    const { data: before, error: readError } = await service
      .from("lessons")
      .select("*")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .maybeSingle();
    if (readError || !before) throw new Error("FORBIDDEN");
    if (before.status !== "scheduled")
      throw new Error(
        "VALIDATION_FAILED: Only scheduled lessons can be rescheduled.",
      );
    const token = await googleAccessToken();
    if (
      (await googleFreeBusy(token, startsAt, endsAt)).length &&
      !input.payload.allowConflict
    )
      throw new Error("SLOT_UNAVAILABLE");
    const { data: changed, error } = await service.rpc(
      "command_change_lesson_state",
      {
        p_lesson_id: input.entityId,
        p_expected_version: input.expectedVersion,
        p_action: "reschedule",
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_queue_calendar: true,
      },
    );
    if (error?.code === "23P01") throw new Error("SLOT_UNAVAILABLE");
    if (error) throw error;
    const data = changed.lesson;
    const emails = await queueLessonChangeEmails(
      service,
      input.entityId,
      "rescheduled",
      id,
    );
    const auditEventId = await audit(
      studioId,
      "lesson",
      data.id,
      "lesson.rescheduled",
      before,
      { starts_at: startsAt, ends_at: endsAt, version: data.version },
    );
    return json({
      resource: data,
      recommendations: [],
      auditEventId,
      queuedSideEffects: [
        "calendar_projection",
        ...emails.map((message: any) => `email:${message.id}`),
      ],
      correlationId: id,
    });
  }

  return null;
}
