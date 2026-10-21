import { queueLessonChangeEmails } from "../_shared/booking-email";
import { googleAccessToken, googleFreeBusy } from "../_shared/google";
import { json } from "../_shared/http";
import { serviceClient } from "../_shared/supabase";
import type { V2CommandContext } from "./types";
import { handleLessonBulkCommands } from "./lesson-bulk";
import { seriesDates } from "../../../src/domain/booking";

export async function handleLessonsCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  const { audit, db, domain, id, input, requireCoach } = ctx;
  const bulk = await handleLessonBulkCommands(ctx);
  if (bulk) return bulk;

  if (
    domain === "lessons" &&
    ["preview_change", "execute_change"].includes(input.command) &&
    input.entityId
  ) {
    const studioId = await requireCoach();
    const user = await db.auth.getUser();
    if (user.error || !user.data.user) throw new Error("FORBIDDEN");
    const service = serviceClient();
    const before = await service
      .from("lessons")
      .select("id,version")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .maybeSingle();
    if (before.error || !before.data) throw new Error("FORBIDDEN");
    // Replayed execution validates its persisted receipt even after the lesson version changes.
    if (
      input.command === "preview_change" &&
      before.data.version !== input.expectedVersion
    )
      throw new Error("VERSION_CONFLICT");
    const value: Record<string, unknown> = {
      ...input.payload,
      lessonId: input.entityId,
      reason: input.reason,
    };
    if (input.command === "preview_change") {
      const preview = await service.rpc("preview_lesson_occurrence_change", {
        p_actor: user.data.user.id,
        p_value: value,
      });
      if (preview.error) throw preview.error;
      return json({ resource: preview.data });
    }
    const replay = await service.rpc("lesson_change_replay", {
      p_actor: user.data.user.id,
      p_key: input.idempotencyKey,
      p_value: value,
    });
    if (replay.error) throw replay.error;
    if (replay.data)
      return json({
        resource: replay.data,
        queuedSideEffects: [
          "calendar_projection",
          "lesson_change_notifications",
        ],
        correlationId: id,
      });
    // Evaluate every reviewed time against the existing provider conflict policy before execution.
    if (value.action === "reschedule") {
      const preview = await service.rpc("preview_lesson_occurrence_change", {
        p_actor: user.data.user.id,
        p_value: value,
      });
      if (preview.error) throw preview.error;
      const token = Netlify.env.get("GOOGLE_REFRESH_TOKEN")
        ? await googleAccessToken()
        : null;
      for (const item of preview.data.items)
        if (
          token &&
          (await googleFreeBusy(token, item.newStartsAt, item.newEndsAt))
            .length &&
          !input.payload.allowConflict
        )
          throw new Error("SLOT_UNAVAILABLE");
    }
    const changed = await service.rpc("execute_lesson_occurrence_change", {
      p_actor: user.data.user.id,
      p_key: input.idempotencyKey,
      p_value: value,
    });
    if (changed.error?.code === "23P01") throw new Error("SLOT_UNAVAILABLE");
    if (changed.error) throw changed.error;
    // Durable intents recover queue failures; mutation success is separate from external delivery.
    return json({
      resource: changed.data,
      queuedSideEffects: ["calendar_projection", "lesson_change_notifications"],
      correlationId: id,
    });
  }

  if (domain === "lessons" && input.command === "create") {
    await requireCoach();
    const studentId = String(input.payload.studentId || ""),
      startsAt = String(input.payload.startsAt || ""),
      endsAt = String(input.payload.endsAt || "");
    if (
      !studentId ||
      !startsAt ||
      !endsAt ||
      !Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) ||
      new Date(endsAt) <= new Date(startsAt)
    )
      throw new Error("VALIDATION_FAILED");
    const cadence = String(input.payload.recurrence || "none");
    const occurrenceCount = Number(input.payload.occurrenceCount || 1);
    if (!["none","weekly","biweekly"].includes(cadence) || !Number.isInteger(occurrenceCount) || occurrenceCount < 1 || occurrenceCount > 52) throw new Error("VALIDATION_FAILED");
    const value = {
      ...input.payload,
      studentId,
      recurrence: cadence,
      occurrenceCount,
    };
    const replay = await db.rpc(
      "read_studio_operation" as never,
      {
        p_command: "lesson.create",
        p_value: value,
        p_key: input.idempotencyKey,
      } as never,
    );
    if (replay.error) throw replay.error;
    if (replay.data) {
      const previous = replay.data as unknown as {
        lesson: unknown;
        auditEventId: string;
      };
      return json({
        resource: previous.lesson,
        auditEventId: previous.auditEventId,
        alreadyCreated: true,
        queuedSideEffects: ["calendar_projection"],
      });
    }
    if (Netlify.env.get("GOOGLE_REFRESH_TOKEN")) {
      const token = await googleAccessToken();
      const tz = String(input.payload.timezone || "America/New_York");
      const starts = cadence === "none" ? [startsAt] : seriesDates(startsAt,cadence as "weekly"|"biweekly",occurrenceCount,tz);
      const ends = cadence === "none" ? [endsAt] : seriesDates(endsAt,cadence as "weekly"|"biweekly",occurrenceCount,tz);
      for (let i=0;i<starts.length;i++)
        if ((await googleFreeBusy(token,starts[i],ends[i])).length && !input.payload.allowConflict) throw new Error("SLOT_UNAVAILABLE");
    }
    const created = await db.rpc(
      "command_create_lesson_once" as never,
      {
        p_value: value,
        p_key: input.idempotencyKey,
      } as never,
    );
    if (created.error) throw created.error;
    const data = created.data as unknown as {
      lesson: any;
      auditEventId: string;
    };
    const lesson = data.lesson;
    return json({
      resource: lesson,
      recommendations: [],
      auditEventId: data.auditEventId,
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
    if (before.version !== input.expectedVersion)
      throw new Error("VERSION_CONFLICT");
    const user = await db.auth.getUser();
    if (!user.data.user) throw new Error("FORBIDDEN");
    const value = {
      lessonId: before.id,
      action: "cancel",
      scope: "occurrence",
      useCredit: input.payload.useCredit === true,
      wholeClass: false,
      reason: input.reason,
    };
    const preview = await service.rpc("preview_lesson_occurrence_change", {
      p_actor: user.data.user.id,
      p_value: value,
    });
    if (preview.error) throw preview.error;
    const changed = await service.rpc("execute_lesson_occurrence_change", {
      p_actor: user.data.user.id,
      p_key: input.idempotencyKey,
      p_value: { ...value, reviewToken: preview.data.reviewToken },
    });
    if (changed.error) throw changed.error;
    const result = changed.data.results.find((r: any) => r.lesson),
      data = result.lesson,
      auditEventId = result.auditEventId;
    let emails: { id: string }[] = [];
    try {
      emails = await queueLessonChangeEmails(
        service,
        before.id,
        "cancelled",
        id,
      );
    } catch {
      /* committed notification intent remains recoverable */
    }
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
    if (before.invoice_id)
      throw new Error(
        "INVALID_TRANSITION: Record payments and credits through the linked invoice.",
      );
    if (before.student_id) {
      const coverage = await service
        .from("package_credit_entries")
        .select("quantity,packages!inner(student_id)")
        .eq("lesson_id", before.id)
        .eq("packages.student_id", before.student_id);
      if (coverage.error) throw coverage.error;
      if (
        (coverage.data ?? []).reduce(
          (total: number, entry: { quantity: number }) =>
            total + entry.quantity,
          0,
        ) < 0
      )
        throw new Error(
          "INVALID_TRANSITION: A lesson credit is attached. Cancellation lets you return or use that credit.",
        );
    }
    if (paymentStatus === "paid_by_credit")
      throw new Error(
        "VALIDATION_FAILED: Apply a lesson credit using the credit action.",
      );
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
    if (before.version !== input.expectedVersion)
      throw new Error("VERSION_CONFLICT");
    const user = await db.auth.getUser();
    if (!user.data.user) throw new Error("FORBIDDEN");
    const value = {
      lessonId: before.id,
      action: "reschedule",
      scope: "occurrence",
      startsAt,
      endsAt,
      useCredit: false,
      wholeClass: false,
      reason: input.reason,
    };
    const preview = await service.rpc("preview_lesson_occurrence_change", {
      p_actor: user.data.user.id,
      p_value: value,
    });
    if (preview.error) throw preview.error;
    const changed = await service.rpc("execute_lesson_occurrence_change", {
      p_actor: user.data.user.id,
      p_key: input.idempotencyKey,
      p_value: { ...value, reviewToken: preview.data.reviewToken },
    });
    if (changed.error?.code === "23P01") throw new Error("SLOT_UNAVAILABLE");
    if (changed.error) throw changed.error;
    const result = changed.data.results.find((r: any) => r.lesson),
      data = result.lesson,
      auditEventId = result.auditEventId;
    let emails: { id: string }[] = [];
    try {
      emails = await queueLessonChangeEmails(
        service,
        before.id,
        "rescheduled",
        id,
      );
    } catch {
      /* committed notification intent remains recoverable */
    }
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
