import { json } from "../_shared/http";
import { dispatchOutbox } from "../_shared/outbox-dispatch";
import { serviceClient } from "../_shared/supabase";
import type { V2CommandContext } from "./types";

export async function handleMessagingCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  const { audit, context, db, domain, id, input, requireCoach } = ctx;

  if (
    domain === "messages" &&
    ["send", "undo", "mark_read", "save_draft"].includes(input.command)
  ) {
    const service = serviceClient();
    const { data: authData } = await db.auth.getUser();
    const user = authData.user;
    if (!user) throw new Error("FORBIDDEN");

    if (["mark_read", "save_draft"].includes(input.command)) {
      const conversationId = String(
        input.entityId || input.payload.conversationId || "",
      );
      const { data: conversation, error: conversationError } = await db
        .from("conversations")
        .select("id,studio_id")
        .eq("id", conversationId)
        .single();
      if (conversationError || !conversation) throw new Error("FORBIDDEN");
      const draftBody =
        input.command === "save_draft"
          ? String(input.payload.body || "").slice(0, 4000)
          : undefined;
      const state: Record<string, unknown> = {
        conversation_id: conversation.id,
        user_id: user.id,
        ...(input.command === "mark_read"
          ? { last_read_at: new Date().toISOString() }
          : { draft_body: draftBody }),
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await service
        .from("conversation_states")
        .upsert(state, { onConflict: "conversation_id,user_id" })
        .select()
        .single();
      if (error) throw error;
      return json({
        resource: data,
        recommendations: [],
        queuedSideEffects: [],
      });
    }

    if (input.command === "undo") {
      const messageId = String(input.entityId || "");
      const { data: before, error: messageError } = await service
        .from("conversation_messages")
        .select("*,conversations!inner(studio_id)")
        .eq("id", messageId)
        .is("deleted_at", null)
        .single();
      if (
        messageError ||
        !before ||
        before.author_user_id !== user.id ||
        Date.now() - new Date(before.created_at).getTime() > 12_000
      )
        throw new Error(
          "VALIDATION_FAILED: This message can no longer be undone.",
        );
      const { data, error } = await service
        .from("conversation_messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", messageId)
        .eq("author_user_id", user.id)
        .is("deleted_at", null)
        .select()
        .single();
      if (error) throw error;
      const studioId = Array.isArray(before.conversations)
        ? before.conversations[0]?.studio_id
        : before.conversations?.studio_id;
      return json({
        resource: data,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "conversation_message",
          messageId,
          "conversation_message.undone",
          before,
          data,
        ),
        queuedSideEffects: [],
      });
    }

    const body = String(input.payload.body || "").trim();
    const requestedConversationId = String(input.payload.conversationId || "");
    const studentId = String(input.payload.studentId || "");
    const offeringId = String(input.payload.offeringId || "");
    if (
      !body ||
      body.length > 4000 ||
      (!requestedConversationId && !studentId && !offeringId)
    )
      throw new Error(
        "VALIDATION_FAILED: Write a message between 1 and 4,000 characters.",
      );

    let conversation: any;
    if (requestedConversationId) {
      const result = await db
        .from("conversations")
        .select("*")
        .eq("id", requestedConversationId)
        .single();
      if (result.error) throw new Error("FORBIDDEN");
      conversation = result.data;
    } else if (studentId) {
      const { data: student, error: studentError } = await service
        .from("students")
        .select("id,studio_id,full_name,preferred_name,user_id")
        .eq("id", studentId)
        .is("deleted_at", null)
        .single();
      if (studentError || !student) throw new Error("FORBIDDEN");
      const allowed = await db
        .from("students")
        .select("id")
        .eq("id", student.id)
        .maybeSingle();
      if (allowed.error || !allowed.data) throw new Error("FORBIDDEN");
      const existing = await service
        .from("conversations")
        .select("*")
        .eq("student_id", student.id)
        .eq("kind", "direct")
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) conversation = existing.data;
      else {
        const created = await service
          .from("conversations")
          .insert({
            studio_id: student.studio_id,
            kind: "direct",
            student_id: student.id,
            title: student.preferred_name || student.full_name,
          })
          .select()
          .single();
        if (created.error) {
          const retry = await service
            .from("conversations")
            .select("*")
            .eq("student_id", student.id)
            .eq("kind", "direct")
            .single();
          if (retry.error) throw created.error;
          conversation = retry.data;
        } else conversation = created.data;
      }
    } else {
      const { data: offering, error: offeringError } = await service
        .from("service_offerings")
        .select("id,studio_id,title")
        .eq("id", offeringId)
        .single();
      if (offeringError || !offering) throw new Error("FORBIDDEN");
      const allowed = await db
        .from("service_offerings")
        .select("id")
        .eq("id", offering.id)
        .maybeSingle();
      if (allowed.error || !allowed.data) throw new Error("FORBIDDEN");
      const existing = await service
        .from("conversations")
        .select("*")
        .eq("offering_id", offering.id)
        .eq("kind", "class")
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) conversation = existing.data;
      else {
        const created = await service
          .from("conversations")
          .insert({
            studio_id: offering.studio_id,
            kind: "class",
            offering_id: offering.id,
            title: offering.title,
          })
          .select()
          .single();
        if (created.error) {
          const retry = await service
            .from("conversations")
            .select("*")
            .eq("offering_id", offering.id)
            .eq("kind", "class")
            .single();
          if (retry.error) throw created.error;
          conversation = retry.data;
        } else conversation = created.data;
      }
    }

    const [{ data: coach }, { data: ownedStudent }, { data: linkedContact }] =
      await Promise.all([
        service
          .from("memberships")
          .select("display_name")
          .eq("studio_id", conversation.studio_id)
          .eq("user_id", user.id)
          .eq("role", "coach")
          .maybeSingle(),
        conversation.student_id
          ? service
              .from("students")
              .select("id,preferred_name,full_name")
              .eq("id", conversation.student_id)
              .eq("user_id", user.id)
              .maybeSingle()
          : service
              .from("students")
              .select("id,preferred_name,full_name")
              .eq("studio_id", conversation.studio_id)
              .eq("user_id", user.id)
              .limit(1)
              .maybeSingle(),
        service
          .from("linked_contacts")
          .select("full_name,student_id")
          .eq("studio_id", conversation.studio_id)
          .eq("user_id", user.id)
          .eq("portal_enabled", true)
          .limit(1)
          .maybeSingle(),
      ]);
    // The user-scoped reads above already enforce the conversation or
    // offering RLS policy, including enrolled-class access.
    const classParticipant = conversation.kind === "class";
    const directAllowed =
      conversation.kind === "direct" &&
      (ownedStudent || linkedContact?.student_id === conversation.student_id);
    if (!coach && !directAllowed && !classParticipant)
      throw new Error("FORBIDDEN");
    const authorRole = coach ? "coach" : linkedContact ? "guardian" : "student";
    const authorName =
      coach?.display_name ||
      linkedContact?.full_name ||
      ownedStudent?.preferred_name ||
      ownedStudent?.full_name ||
      (authorRole === "guardian" ? "Support person" : "Student");
    const { data, error } = await service
      .from("conversation_messages")
      .insert({
        conversation_id: conversation.id,
        studio_id: conversation.studio_id,
        author_user_id: user.id,
        author_role: authorRole,
        author_name: authorName,
        body,
      })
      .select()
      .single();
    if (error) throw error;
    await service
      .from("conversations")
      .update({
        last_message_at: data.created_at,
        updated_at: data.created_at,
        version: conversation.version + 1,
      })
      .eq("id", conversation.id);
    await service.from("conversation_states").upsert(
      {
        conversation_id: conversation.id,
        user_id: user.id,
        last_read_at: data.created_at,
        draft_body: "",
        updated_at: data.created_at,
      },
      { onConflict: "conversation_id,user_id" },
    );
    return json(
      {
        resource: { ...data, conversation_id: conversation.id },
        recommendations: [],
        auditEventId: await audit(
          conversation.studio_id,
          "conversation_message",
          data.id,
          "conversation_message.created",
          null,
          { conversation_id: conversation.id, author_role: authorRole },
        ),
        queuedSideEffects: [],
      },
      201,
    );
  }

  if (domain === "outbox" && input.command === "retry_failed") {
    const studioId = await requireCoach(),
      { data, error } = await serviceClient()
        .from("outbox_messages")
        .update({
          status: "queued",
          next_attempt_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("studio_id", studioId)
        .eq("status", "failed")
        .select("id");
    if (error) throw error;
    return json({
      resource: { retried: data?.length || 0 },
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "outbox",
        studioId,
        "outbox.retry_failed",
        null,
        { retried: data?.length || 0 },
      ),
      queuedSideEffects: ["outbox_worker"],
    });
  }

  if (
    domain === "outbox" &&
    ["manual_send", "resend", "cancel_manual"].includes(input.command)
  ) {
    const studioId = await requireCoach();
    const service = serviceClient();
    if (input.command === "cancel_manual") {
      const { data: before, error: beforeError } = await service
        .from("outbox_messages")
        .select("*")
        .eq("id", input.entityId)
        .eq("studio_id", studioId)
        .eq("status", "queued")
        .like("event_key", "manual.%")
        .single();
      if (beforeError || !before)
        throw new Error(
          "VALIDATION_FAILED: This email has already started sending and can no longer be undone.",
        );
      const { data, error } = await service
        .from("outbox_messages")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
          version: Number(before.version || 1) + 1,
        })
        .eq("id", before.id)
        .eq("status", "queued")
        .select()
        .single();
      if (error)
        throw new Error(
          "VALIDATION_FAILED: This email has already started sending and can no longer be undone.",
        );
      return json({
        resource: data,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "outbox_message",
          data.id,
          "outbox.manual_send_undone",
          before,
          data,
        ),
        queuedSideEffects: [],
      });
    }

    let recipient = String(input.payload.recipient || "")
      .trim()
      .toLowerCase();
    let subject = String(input.payload.subject || "").trim();
    let body = String(input.payload.body || "").trim();
    let studentId = String(input.payload.studentId || "") || null;
    let lessonId = String(input.payload.lessonId || "") || null;
    if (input.command === "resend") {
      const { data: source, error: sourceError } = await service
        .from("outbox_messages")
        .select("*")
        .eq("id", input.entityId)
        .eq("studio_id", studioId)
        .single();
      if (sourceError || !source)
        throw new Error(
          "VALIDATION_FAILED: The original email could not be found.",
        );
      if (source.campaign_id)
        throw new Error(
          "VALIDATION_FAILED: Campaign email must be sent from Campaigns so unsubscribes are respected.",
        );
      recipient = source.recipient;
      subject = source.subject;
      body = source.body;
      studentId = source.student_id;
      lessonId = source.lesson_id;
    }
    if (!recipient.includes("@") || subject.length < 2 || body.length < 2)
      throw new Error(
        "VALIDATION_FAILED: Add a recipient, subject, and message.",
      );
    const sendAt = new Date(Date.now() + 8_000).toISOString();
    const { data, error } = await service
      .from("outbox_messages")
      .insert({
        studio_id: studioId,
        student_id: studentId,
        lesson_id: lessonId,
        channel: "email",
        recipient,
        subject,
        body,
        status: "queued",
        send_at: sendAt,
        next_attempt_at: sendAt,
        event_key:
          input.command === "resend" ? "manual.resend" : "manual.email",
        dedupe_key: `manual:${input.idempotencyKey}`,
        priority: 100,
      })
      .select()
      .single();
    if (error) throw error;
    context.waitUntil(
      new Promise((resolve) => setTimeout(resolve, 8_250)).then(() =>
        dispatchOutbox({ ids: [data.id] }),
      ),
    );
    return json(
      {
        resource: data,
        undoUntil: sendAt,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "outbox_message",
          data.id,
          input.command === "resend"
            ? "outbox.resent_manually"
            : "outbox.manual_send_queued",
          null,
          data,
        ),
        queuedSideEffects: [
          "email_after_undo_window",
          "outbox_worker_fallback",
        ],
      },
      201,
    );
  }

  if (domain === "outbox" && input.command === "approve") {
    const { data, error } = await db.rpc("command_approve_outbox", {
      message_id: input.entityId,
      expected_version: input.expectedVersion,
      reason: input.reason,
      idempotency_key: input.idempotencyKey,
      correlation_id: id,
    });
    if (error) throw error;
    return json(data);
  }

  return null;
}
