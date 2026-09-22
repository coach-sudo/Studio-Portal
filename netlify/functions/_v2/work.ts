import { json } from "../_shared/http";
import { serviceClient } from "../_shared/supabase";
import type { V2CommandContext } from "./types";

export async function handleWorkCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  const { audit, db, domain, input, requireCoach, requireMaterialManager } =
    ctx;

  if (
    domain === "offerings" &&
    input.command === "create_assignment" &&
    input.entityId
  ) {
    const studioId = await requireCoach();
    const title = String(input.payload.title || "").trim();
    const details = String(input.payload.details || "").trim();
    if (!title || !details)
      throw new Error(
        "VALIDATION_FAILED: Add an assignment title and instructions.",
      );
    const service = serviceClient();
    const { data: offering, error: offeringError } = await service
      .from("service_offerings")
      .select("id,lesson_ids")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    if (offeringError || !offering) throw new Error("FORBIDDEN");
    const { data: participants, error: participantError } = await service
      .from("lesson_participants")
      .select("student_id")
      .in("lesson_id", offering.lesson_ids || [])
      .not("student_id", "is", null);
    if (participantError) throw participantError;
    const studentIds = [
      ...new Set(
        (participants || []).map((item) => item.student_id).filter(Boolean),
      ),
    ];
    if (!studentIds.length)
      throw new Error(
        "VALIDATION_FAILED: Enroll at least one student before assigning class work.",
      );
    const groupKey = `class:${offering.id}:${input.idempotencyKey}`;
    const rows = studentIds.map((studentId) => ({
      student_id: studentId,
      lesson_id: offering.lesson_ids?.[0] || null,
      title,
      details,
      due_at: input.payload.dueAt || null,
      status: "assigned",
      category: "practice",
      priority: 2,
      activity_type: "instruction",
      activity_config: {},
      responses: {},
      group_key: groupKey,
    }));
    const { data, error } = await service
      .from("assignments")
      .upsert(rows, {
        onConflict: "student_id,group_key",
        ignoreDuplicates: true,
      })
      .select();
    if (error) throw error;
    return json(
      {
        resource: data || [],
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "service_offering",
          offering.id,
          "offering.assignment_created",
          null,
          { recipients: studentIds.length, title },
        ),
        queuedSideEffects: [],
      },
      201,
    );
  }

  if (domain === "work" && input.command === "create") {
    const studioId = await requireCoach(),
      studentId = String(input.payload.studentId || "");
    if (!studentId) throw new Error("VALIDATION_FAILED");
    const { data, error } = await db
      .from("assignments")
      .insert({
        student_id: studentId,
        lesson_id: input.payload.lessonId || null,
        title: String(input.payload.title || "").trim(),
        details: String(input.payload.details || ""),
        due_at: input.payload.dueAt || null,
        status: "assigned",
        category: String(input.payload.category || "practice"),
        priority: Number(input.payload.priority || 2),
        activity_type: String(input.payload.activityType || "instruction"),
        activity_config: input.payload.activityConfig || {},
        responses: {},
      })
      .select("*,students!inner(studio_id)")
      .single();
    if (error || data.students.studio_id !== studioId)
      throw error || new Error("FORBIDDEN");
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "assignment",
        data.id,
        "assignment.created",
        null,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (domain === "notes" && input.command === "create") {
    const studioId = await requireCoach(),
      lessonId = String(input.payload.lessonId || ""),
      studentId = String(input.payload.studentId || ""),
      title = String(input.payload.title || "").trim(),
      body = String(input.payload.body || "").trim();
    if (!lessonId || !studentId || !title || !body)
      throw new Error("VALIDATION_FAILED");
    const status = input.payload.status === "draft" ? "draft" : "published";
    const { data, error } = await db
      .from("notes")
      .insert({
        lesson_id: lessonId,
        student_id: studentId,
        title,
        body,
        body_html: String(input.payload.bodyHtml || body),
        rich_content: input.payload.richContent || { version: 1, blocks: [] },
        category: String(input.payload.category || "lesson_note"),
        tags: input.payload.tags || [],
        pinned: Boolean(input.payload.pinned),
        status,
        published_at: status === "published" ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (error) throw error;
    await serviceClient()
      .from("recommendations")
      .update({ status: "resolved", updated_at: new Date().toISOString() })
      .eq("entity_type", "lesson")
      .eq("entity_id", lessonId)
      .in("reason_code", ["lesson_note_missing", "lesson_note_due_48h"]);
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "note",
        data.id,
        status === "published" ? "note.published" : "note.drafted",
        null,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (domain === "notes" && input.command === "update" && input.entityId) {
    const studioId = await requireCoach();
    const { data: before, error: readError } = await db
      .from("notes")
      .select("*,students!inner(studio_id)")
      .eq("id", input.entityId)
      .single();
    if (readError || !before || before.students.studio_id !== studioId)
      throw new Error("FORBIDDEN");
    const status = ["draft", "published", "archived"].includes(
      String(input.payload.status),
    )
      ? String(input.payload.status)
      : before.status;
    const changes = {
      title: String(input.payload.title ?? before.title).trim(),
      body: String(input.payload.body ?? before.body).trim(),
      body_html: String(
        input.payload.bodyHtml ?? before.body_html ?? before.body,
      ),
      rich_content: input.payload.richContent ?? before.rich_content,
      category: String(input.payload.category ?? before.category),
      tags: input.payload.tags ?? before.tags,
      pinned: Boolean(input.payload.pinned ?? before.pinned),
      status,
      published_at:
        status === "published"
          ? before.published_at || new Date().toISOString()
          : null,
      version: input.expectedVersion + 1,
      updated_at: new Date().toISOString(),
    };
    if (!changes.title || !changes.body) throw new Error("VALIDATION_FAILED");
    const { data, error } = await serviceClient()
      .from("notes")
      .update(changes)
      .eq("id", before.id)
      .eq("version", input.expectedVersion)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    if (status === "published")
      await serviceClient()
        .from("recommendations")
        .update({ status: "resolved", updated_at: new Date().toISOString() })
        .eq("entity_type", "lesson")
        .eq("entity_id", before.lesson_id)
        .in("reason_code", ["lesson_note_missing", "lesson_note_due_48h"]);
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "note",
        data.id,
        "note.updated",
        before,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (domain === "notes" && input.command === "delete" && input.entityId) {
    const studioId = await requireCoach(),
      { data: before, error: readError } = await db
        .from("notes")
        .select("*,students!inner(studio_id)")
        .eq("id", input.entityId)
        .single();
    if (readError || !before || before.students.studio_id !== studioId)
      throw new Error("FORBIDDEN");
    const { error } = await serviceClient()
      .from("notes")
      .delete()
      .eq("id", before.id)
      .eq("version", input.expectedVersion);
    if (error) throw error;
    return json({
      resource: { id: before.id, deleted: true },
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "note",
        before.id,
        "note.deleted",
        before,
        null,
      ),
      queuedSideEffects: [],
    });
  }

  if (domain === "materials" && input.command === "create") {
    const studentId = String(input.payload.studentId || ""),
      { data: student, error: studentError } = await db
        .from("students")
        .select("id,studio_id")
        .eq("id", studentId)
        .single();
    if (studentError || !student) throw new Error("FORBIDDEN");
    const materialRole = String(input.payload.role || "library");
    if (materialRole === "current_script") {
      const { data: currentLinks } = await serviceClient()
        .from("material_links")
        .select("material_id")
        .eq("student_id", student.id)
        .eq("role", "current_script");
      const currentIds = (currentLinks || []).map((item) => item.material_id);
      if (currentIds.length)
        await serviceClient()
          .from("materials")
          .update({
            status: "archived",
            updated_at: new Date().toISOString(),
          })
          .in("id", currentIds)
          .eq("status", "active");
    }
    const { data, error } = await serviceClient()
      .from("materials")
      .insert({
        studio_id: student.studio_id,
        owner_student_id: student.id,
        title: String(input.payload.title || "").trim(),
        category: String(input.payload.category || "Other"),
        storage_path: input.payload.storagePath || null,
        external_url: input.payload.externalUrl || null,
        status: "active",
        approval_status:
          input.payload.role === "actor_material"
            ? "pending_review"
            : "not_public",
        caption: String(input.payload.caption || ""),
        mime_type: input.payload.mimeType || null,
        file_size_bytes: input.payload.fileSizeBytes || null,
        media_kind: String(input.payload.mediaKind || "document"),
        public_embed: Boolean(input.payload.publicEmbed),
      })
      .select()
      .single();
    if (error) throw error;
    await serviceClient()
      .from("material_links")
      .insert({
        material_id: data.id,
        student_id: student.id,
        lesson_id: input.payload.lessonId || null,
        role: materialRole,
        visible_to_student: true,
      });
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        student.studio_id,
        "material",
        data.id,
        "material.created",
        null,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (domain === "materials" && input.command === "approve" && input.entityId) {
    const studioId = await requireCoach(),
      { data: before, error: readError } = await db
        .from("materials")
        .select("*")
        .eq("id", input.entityId)
        .eq("studio_id", studioId)
        .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    const { data, error } = await serviceClient()
      .from("materials")
      .update({
        approval_status: String(input.payload.status || "approved"),
        public_embed: Boolean(input.payload.publicEmbed ?? true),
        version: input.expectedVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", before.id)
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
        "material",
        data.id,
        "material.reviewed",
        before,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (
    domain === "materials" &&
    input.command === "update_status" &&
    input.entityId
  ) {
    const { studioId, before } = await requireMaterialManager(input.entityId);
    const status = String(input.payload.status || "");
    if (!["active", "archived"].includes(status))
      throw new Error("VALIDATION_FAILED");
    const { data, error } = await serviceClient()
      .from("materials")
      .update({
        status,
        version: input.expectedVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", before.id)
      .eq("version", input.expectedVersion)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    return json({
      resource: data,
      auditEventId: await audit(
        studioId,
        "material",
        data.id,
        "material.status_updated",
        before,
        data,
      ),
      queuedSideEffects: [],
      recommendations: [],
    });
  }

  if (domain === "materials" && input.command === "delete" && input.entityId) {
    const { studioId, before } = await requireMaterialManager(input.entityId);
    const service = serviceClient();
    if (before.version !== input.expectedVersion)
      throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    const { data: deleted, error: deleteError } = await service
      .from("materials")
      .delete()
      .eq("id", before.id)
      .eq("version", before.version)
      .select("id")
      .maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    let storageWarning = false;
    if (before.storage_path) {
      const storageResult = await service.storage
        .from("studio-materials")
        .remove([before.storage_path]);
      storageWarning = Boolean(storageResult.error);
      if (!storageWarning) {
        const { error: assetDeleteError } = await service
          .from("file_assets")
          .delete()
          .eq("storage_path", before.storage_path);
        if (assetDeleteError) storageWarning = true;
      }
    }
    return json({
      resource: { id: before.id, deleted: true, storageWarning },
      auditEventId: await audit(
        studioId,
        "material",
        before.id,
        "material.deleted",
        before,
        { deleted: true, storage_warning: storageWarning },
      ),
      queuedSideEffects: [],
      recommendations: storageWarning
        ? [
            {
              title: "A removed file needs storage cleanup",
              suggestedAction: "open_integrations",
            },
          ]
        : [],
    });
  }

  if (domain === "actor-pages" && input.command === "create") {
    const studioId = await requireCoach(),
      studentId = String(input.payload.studentId || ""),
      { data: student, error: studentError } = await db
        .from("students")
        .select("*")
        .eq("id", studentId)
        .eq("studio_id", studioId)
        .single();
    if (studentError || !student || !student.actor_page_eligible)
      throw new Error(
        "VALIDATION_FAILED: Enable actor-page eligibility first.",
      );
    const slug = String(input.payload.slug || student.full_name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const { data, error } = await serviceClient()
      .from("actor_profiles")
      .insert({
        student_id: student.id,
        slug,
        display_name: student.full_name,
        bio: "",
        status: "draft",
      })
      .select()
      .single();
    if (error) throw error;
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "actor_profile",
        data.id,
        "actor_profile.created",
        null,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (
    domain === "work" &&
    ["complete", "help", "save_response"].includes(input.command) &&
    input.entityId
  ) {
    const { data: before, error: readError } = await db
      .from("assignments")
      .select("*,students!inner(studio_id)")
      .eq("id", input.entityId)
      .single();
    if (readError || !before) throw readError || new Error("FORBIDDEN");
    const changes =
      input.command === "complete"
        ? {
            status: "completed",
            version: input.expectedVersion + 1,
            updated_at: new Date().toISOString(),
          }
        : input.command === "help"
          ? {
              help_requested: true,
              version: input.expectedVersion + 1,
              updated_at: new Date().toISOString(),
            }
          : {
              responses: input.payload.responses || {},
              progress: Math.max(
                0,
                Math.min(100, Number(input.payload.progress || 25)),
              ),
              status:
                before.status === "assigned" ? "in_progress" : before.status,
              version: input.expectedVersion + 1,
              updated_at: new Date().toISOString(),
            };
    const { data, error } = await serviceClient()
      .from("assignments")
      .update(changes)
      .eq("id", input.entityId)
      .eq("version", input.expectedVersion)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    if (input.command === "help") {
      await serviceClient()
        .from("recommendations")
        .upsert(
          {
            studio_id: before.students.studio_id,
            student_id: before.student_id,
            entity_type: "assignment",
            entity_id: before.id,
            reason_code: "practice_help_requested",
            title: `${before.title}: student asked for help`,
            explanation: "The student used Ask coach from their practice page.",
            evidence: [
              before.details || "Practice assignment",
              `Requested ${new Date().toISOString()}`,
            ],
            urgency: 4,
            suggested_action: "open_student_work",
            requires_confirmation: false,
            status: "open",
            dedupe_key: `assignment:${before.id}:help`,
            due_at: new Date().toISOString(),
          },
          { onConflict: "dedupe_key" },
        );
    }
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        before.students.studio_id,
        "assignment",
        data.id,
        `assignment.${input.command}`,
        before,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (
    domain === "actor-pages" &&
    ["save", "review"].includes(input.command) &&
    input.entityId
  ) {
    const { data: before, error: readError } = await db
      .from("actor_profiles")
      .select("*,students!inner(studio_id)")
      .eq("id", input.entityId)
      .single();
    if (readError || !before) throw readError || new Error("FORBIDDEN");
    let nextStatus = String(input.payload.status || "draft");
    if (input.command === "review") {
      const studioId = await requireCoach();
      if (
        studioId !== before.students.studio_id ||
        !["changes_requested", "approved", "published"].includes(nextStatus)
      )
        throw new Error("FORBIDDEN");
    } else if (!["draft", "review_requested"].includes(nextStatus))
      throw new Error("INVALID_TRANSITION");
    const changes: Record<string, unknown> = {
      status: nextStatus,
      version: input.expectedVersion + 1,
      updated_at: new Date().toISOString(),
    };
    if (input.command === "save") {
      changes.display_name = String(
        input.payload.displayName || before.display_name,
      ).trim();
      changes.bio = String(input.payload.bio || before.bio).trim();
      changes.draft_content = {
        ...(before.draft_content || {}),
        ...(typeof input.payload.portfolio === "object" &&
        input.payload.portfolio
          ? input.payload.portfolio
          : {}),
      };
    }
    if (nextStatus === "published") {
      const service = serviceClient(),
        { count } = await service
          .from("actor_profile_revisions")
          .select("id", { count: "exact", head: true })
          .eq("actor_profile_id", before.id),
        { data: revision, error: revisionError } = await service
          .from("actor_profile_revisions")
          .insert({
            actor_profile_id: before.id,
            revision_number: (count || 0) + 1,
            content: {
              displayName: before.display_name,
              bio: before.bio,
              slug: before.slug,
              ...(before.draft_content || {}),
            },
          })
          .select("id")
          .single();
      if (revisionError) throw revisionError;
      changes.published_revision_id = revision.id;
    }
    const { data, error } = await serviceClient()
      .from("actor_profiles")
      .update(changes)
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
        before.students.studio_id,
        "actor_profile",
        data.id,
        `actor_profile.${nextStatus}`,
        before,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  return null;
}
