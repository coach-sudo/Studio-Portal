import { settingsPatch } from "../../../src/domain/settingsPatch";
import { settingsWriteValues } from "../../../src/domain/settingsAssets";
import { campaignContentSchema } from "../../../src/domain/campaignBlocks";
import { unknownCampaignTokens } from "../../../src/domain/campaignTemplates";
import { json } from "../_shared/http";
import { serviceClient } from "../_shared/supabase";
import type { V2CommandContext } from "./types";

const sourceLabelServer = (value: string) =>
  (
    ({
      lessonface: "Lessonface",
      wyzant: "Wyzant",
      lessons_com: "Lessons.com",
      acuity: "Acuity",
      google_calendar: "Google Calendar",
      gmail: "Gmail",
    }) as Record<string, string>
  )[value] || value;

export async function handleAdministrationCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  const { audit, db, domain, input, requireCoach } = ctx;

  if (
    domain === "integrations" &&
    input.command === "review_import" &&
    input.entityId
  ) {
    const studioId = await requireCoach(),
      service = serviceClient(),
      {
        data: { user },
      } = await db.auth.getUser();
    if (!user) throw new Error("FORBIDDEN");
    const { data: before, error: readError } = await db
      .from("integration_imports")
      .select("*")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    const action = String(input.payload.action || "");
    let imports = [before];
    if (input.payload.applySimilar) {
      const { data: candidates, error: candidatesError } = await db
        .from("integration_imports")
        .select("*")
        .eq("studio_id", studioId)
        .eq("status", "needs_review")
        .eq("detected_source", before.detected_source);
      if (candidatesError) throw candidatesError;
      const signature = (row: any) =>
        String(
          row.payload?.summary ||
            row.payload?.headers?.subject ||
            row.payload?.snippet ||
            row.external_id,
        );
      imports = (candidates || []).filter(
        (row) => signature(row) === signature(before),
      );
    }
    const importIds = imports.map((row) => row.id);
    if (action === "ignore") {
      const { data, error } = await service
        .from("integration_imports")
        .update({
          status: "ignored",
          matched_by: "coach review",
          verified_at: new Date().toISOString(),
          verified_by: user.id,
          verification_note: String(input.payload.note || "Ignored by coach"),
          updated_at: new Date().toISOString(),
        })
        .in("id", importIds)
        .select();
      if (error) throw error;
      return json({
        resource: { reviewed: data?.length || 0 },
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "integration_import",
          before.id,
          "integration_import.ignored",
          imports,
          data,
        ),
        queuedSideEffects: [],
      });
    }
    let targetStudentId = String(input.payload.studentId || "");
    if (action === "create") {
      const fullName = String(input.payload.fullName || "").trim(),
        email = String(input.payload.email || "")
          .trim()
          .toLowerCase();
      if (fullName.length < 2)
        throw new Error("VALIDATION_FAILED: Enter the student's name.");
      const { data: created, error: createError } = await service
        .from("students")
        .insert({
          studio_id: studioId,
          full_name: fullName,
          email: email || null,
          status: "lead",
          portal_enabled: false,
          lead_source: String(before.detected_source || before.provider),
        })
        .select("id")
        .single();
      if (createError) throw createError;
      targetStudentId = created.id;
    }
    if (!targetStudentId)
      throw new Error("VALIDATION_FAILED: Choose or create a student.");
    const { data: target, error: targetError } = await db
      .from("students")
      .select("id")
      .eq("id", targetStudentId)
      .eq("studio_id", studioId)
      .single();
    if (targetError || !target) throw new Error("FORBIDDEN");
    const mergeStudentId = String(input.payload.mergeStudentId || "");
    if (mergeStudentId && mergeStudentId !== targetStudentId) {
      const { error: mergeError } = await db.rpc("merge_studio_students", {
        keep_student_id: targetStudentId,
        remove_student_id: mergeStudentId,
      });
      if (mergeError) throw mergeError;
    }
    for (const item of imports) {
      let lessonId = item.lesson_id as string | undefined;
      if (lessonId) {
        const { error: lessonError } = await service
          .from("lessons")
          .update({
            student_id: targetStudentId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", lessonId)
          .eq("studio_id", studioId);
        if (lessonError) throw lessonError;
        const { error: participantError } = await service
          .from("lesson_participants")
          .update({ student_id: targetStudentId })
          .eq("lesson_id", lessonId);
        if (participantError) throw participantError;
      } else {
        const candidate = item.payload?.candidate as
          | {
              startsAt?: string;
              endsAt?: string;
              topic?: string;
              locationLabel?: string;
              joinUrl?: string;
            }
          | undefined;
        if (candidate?.startsAt && candidate?.endsAt) {
          const created = await service
            .from("lessons")
            .insert({
              studio_id: studioId,
              student_id: targetStudentId,
              topic:
                candidate.topic ||
                `${sourceLabelServer(item.detected_source)} lesson`,
              starts_at: candidate.startsAt,
              ends_at: candidate.endsAt,
              status:
                new Date(candidate.endsAt) < new Date()
                  ? "completed"
                  : "scheduled",
              location_type: candidate.joinUrl ? "virtual" : "in_person",
              location_label:
                candidate.locationLabel ||
                (candidate.joinUrl ? "Online" : "Provider booking"),
              join_url: candidate.joinUrl || null,
              meeting_provider: candidate.joinUrl ? "google_meet" : "in_person",
              source_provider: item.detected_source || item.provider,
              source_external_id: item.external_id,
              source_confidence: 1,
              imported_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (created.error) throw created.error;
          lessonId = created.data.id;
          const { data: targetStudent } = await service
            .from("students")
            .select("full_name,preferred_name,email")
            .eq("id", targetStudentId)
            .single();
          await service.from("lesson_participants").insert({
            lesson_id: lessonId,
            student_id: targetStudentId,
            display_name:
              targetStudent?.preferred_name ||
              targetStudent?.full_name ||
              "Student",
            email: targetStudent?.email || "",
            status: "confirmed",
          });
          await service
            .from("integration_imports")
            .update({ lesson_id: lessonId })
            .eq("id", item.id);
        }
      }
    }
    const { data, error } = await service
      .from("integration_imports")
      .update({
        student_id: targetStudentId,
        status: "imported",
        confidence: 1,
        matched_by: "coach confirmation",
        verified_at: new Date().toISOString(),
        verified_by: user.id,
        verification_note: String(
          input.payload.note || "Student and lesson confirmed",
        ),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .in("id", importIds)
      .select();
    if (error) throw error;
    const coverage = await service.rpc("reserve_student_upcoming_credits", {
      p_student: targetStudentId,
    });
    if (coverage.error) throw coverage.error;
    return json({
      resource: {
        reviewed: data?.length || 0,
        studentId: targetStudentId,
        creditCoverage: coverage.data,
      },
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "integration_import",
        before.id,
        "integration_import.confirmed",
        imports,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (domain === "integrations" && input.command === "retry_failed") {
    const studioId = await requireCoach(),
      service = serviceClient(),
      now = new Date().toISOString();
    const { data: lessonRows, error: lessonsError } = await service
      .from("lessons")
      .select("id")
      .eq("studio_id", studioId);
    if (lessonsError) throw lessonsError;
    const lessonIds = (lessonRows || []).map((row) => row.id);
    let calendar: Array<{ id: string }> = [];
    if (lessonIds.length) {
      const calendarResult = await service
        .from("calendar_projections")
        .update({ status: "queued", last_error: null })
        .in("lesson_id", lessonIds)
        .eq("status", "failed")
        .select("id");
      if (calendarResult.error) throw calendarResult.error;
      calendar = calendarResult.data || [];
    }
    const emailResult = await service
      .from("outbox_messages")
      .update({
        status: "queued",
        next_attempt_at: now,
        last_error: null,
        updated_at: now,
      })
      .eq("studio_id", studioId)
      .eq("status", "failed")
      .select("id");
    if (emailResult.error) throw emailResult.error;
    const result = {
      calendar: calendar.length,
      email: emailResult.data?.length || 0,
    };
    return json({
      resource: result,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "studio",
        studioId,
        "integrations.retry_failed",
        null,
        result,
      ),
      queuedSideEffects: ["calendar_worker", "outbox_worker"],
    });
  }

  if (domain === "settings" && input.command === "cleanup_storage") {
    await requireCoach();
    return json(
      {
        code: "CONFIGURATION_REQUIRED",
        message:
          "Project-wide retention is operator-managed. No records were changed.",
        retryable: false,
        correlationId: ctx.id,
      },
      409,
    );
  }

  if (domain === "settings" && input.command === "update") {
    const studioId = await requireCoach(),
      { data: before, error: readError } = await db
        .from("studios")
        .select("*")
        .eq("id", studioId)
        .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    const incomingSettings = settingsWriteValues(
      (input.payload.settings as Record<string, any>) || {},
    );
    if (incomingSettings.branding) {
      for (const [key, visibility] of [
        ["logoStoragePath", "public_actor"],
        ["coachProfilePhotoStoragePath", "private"],
      ]) {
        const path = incomingSettings.branding[key];
        if (!path) continue;
        if (typeof path !== "string" || !path.startsWith(`${studioId}/`))
          throw new Error(
            "VALIDATION_FAILED: This image does not belong to the studio.",
          );
        const { data: asset, error } = await db
          .from("file_assets")
          .select("id,mime_type,visibility,owner_student_id,file_size_bytes")
          .eq("studio_id", studioId)
          .eq("storage_path", path)
          .maybeSingle();
        if (
          error ||
          !asset ||
          asset.visibility !== visibility ||
          asset.owner_student_id ||
          !["image/png", "image/jpeg", "image/webp"].includes(
            asset.mime_type,
          ) ||
          Number(asset.file_size_bytes) > 5 * 1024 * 1024
        )
          throw new Error(
            "VALIDATION_FAILED: Choose an authorized studio image, up to 5 MB.",
          );
      }
    }
    if (incomingSettings.dailyPopup) {
      const popup = incomingSettings.dailyPopup;
      if (
        typeof popup !== "object" ||
        typeof popup.enabled !== "boolean" ||
        typeof popup.heading !== "string" ||
        popup.heading.length > 120 ||
        typeof popup.body !== "string" ||
        popup.body.length > 1600 ||
        (popup.enabled && (!popup.heading.trim() || !popup.body.trim())) ||
        !/^#[0-9a-f]{6}$/i.test(String(popup.backgroundColor || "")) ||
        !["light", "dark"].includes(popup.textTone) ||
        !["left", "center"].includes(popup.alignment) ||
        !["simple", "framed"].includes(popup.style) ||
        typeof popup.backgroundImageUrl !== "string" ||
        (popup.backgroundImageUrl &&
          !/^https:\/\//i.test(popup.backgroundImageUrl))
      )
        throw new Error("VALIDATION_FAILED: Check the daily popup fields.");
      if (popup.backgroundImageStoragePath) {
        const path = String(popup.backgroundImageStoragePath);
        if (!path.startsWith(`${studioId}/`))
          throw new Error(
            "VALIDATION_FAILED: This background image does not belong to the studio.",
          );
        const { data: asset, error: assetError } = await serviceClient()
          .from("file_assets")
          .select("id,mime_type")
          .eq("studio_id", studioId)
          .eq("storage_path", path)
          .maybeSingle();
        if (
          assetError ||
          !asset ||
          !["image/jpeg", "image/png", "image/webp"].includes(asset.mime_type)
        )
          throw new Error(
            "VALIDATION_FAILED: Choose a studio image for the popup background.",
          );
      }
    }
    if (incomingSettings.campaignTemplates !== undefined) {
      const templates = incomingSettings.campaignTemplates;
      if (
        !Array.isArray(templates) ||
        templates.length > 50 ||
        templates.some(
          (template) =>
            !template ||
            typeof template !== "object" ||
            !/^[0-9a-f-]{36}$/i.test(String(template.id || "")) ||
            typeof template.name !== "string" ||
            template.name.trim().length < 2 ||
            template.name.length > 120 ||
            typeof template.subject !== "string" ||
            template.subject.trim().length < 2 ||
            template.subject.length > 200 ||
            typeof template.body !== "string" ||
            template.body.trim().length < 2 ||
            template.body.length > 10000 ||
            (template.content &&
              !campaignContentSchema.safeParse(template.content).success) ||
            unknownCampaignTokens(`${template.subject}\n${template.body}`)
              .length > 0,
        )
      )
        throw new Error("VALIDATION_FAILED: Check the campaign templates.");
    }
    if (incomingSettings.actorPageCta) {
      const cta = incomingSettings.actorPageCta;
      if (
        typeof cta !== "object" ||
        typeof cta.label !== "string" ||
        !cta.label.trim() ||
        cta.label.length > 60 ||
        typeof cta.url !== "string" ||
        !(
          (cta.url.startsWith("/") && !cta.url.startsWith("//")) ||
          (() => {
            try {
              return new URL(cta.url).protocol === "https:";
            } catch {
              return false;
            }
          })()
        )
      )
        throw new Error("VALIDATION_FAILED: Check the actor-page action.");
    }
    if (incomingSettings.referralProgram) {
      const referral = incomingSettings.referralProgram;
      if (
        typeof referral !== "object" ||
        (referral.enabled != null && typeof referral.enabled !== "boolean") ||
        (referral.paidLessonRewardMinor != null &&
          (!Number.isInteger(referral.paidLessonRewardMinor) ||
            referral.paidLessonRewardMinor < 0 ||
            referral.paidLessonRewardMinor > 100000)) ||
        (referral.recurringSlotRewardSessionMinutes != null &&
          (!Number.isInteger(referral.recurringSlotRewardSessionMinutes) ||
            referral.recurringSlotRewardSessionMinutes < 15 ||
            referral.recurringSlotRewardSessionMinutes > 240)) ||
        (referral.referredPersonBenefit != null &&
          (typeof referral.referredPersonBenefit !== "string" ||
            referral.referredPersonBenefit.length > 200))
      )
        throw new Error("VALIDATION_FAILED: Check the referral offer.");
    }
    const base = input.payload.baseSettings
      ? settingsWriteValues(
          input.payload.baseSettings as Record<string, unknown>,
          true,
        )
      : undefined;
    const patch = base
      ? settingsPatch(base, incomingSettings)
      : incomingSettings;
    const applied = await db.rpc(
      "command_patch_studio_settings" as never,
      {
        p_patch: patch,
        p_base: base || null,
        p_key: input.idempotencyKey,
      } as never,
    );
    if (applied.error) throw applied.error;
    return json(applied.data);
  }

  return null;
}
