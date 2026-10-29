import {
  workerEnabled,
  disabledWorkerResponse,
} from "../_shared/worker-controls";
import { settingsPatch } from "../../../src/domain/settingsPatch";
import { settingsWriteValues } from "../../../src/domain/settingsAssets";
import { campaignContentSchema } from "../../../src/domain/campaignBlocks";
import { unknownCampaignTokens } from "../../../src/domain/campaignTemplates";
import { json } from "../_shared/http";
import { serviceClient } from "../_shared/supabase";
import type { V2CommandContext } from "./types";

export async function handleAdministrationCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  const { audit, db, domain, input, requireCoach } = ctx;

  if (
    domain === "integrations" &&
    input.command === "review_import" &&
    input.entityId
  ) {
    await requireCoach();
    if (input.payload.mergeStudentId != null)
      throw new Error(
        "REVIEW_REQUIRED: Review duplicate profile links separately in Students. Existing records and permissions have not moved.",
      );
    if (!workerEnabled("provider-intake"))
      return disabledWorkerResponse("provider-intake");
    const { data, error } = await db.rpc("command_review_provider_import", {
      p_import: input.entityId,
      p_payload: input.payload,
      p_key: input.idempotencyKey,
    });
    if (error) throw error;
    return json(data);
  }

  if (domain === "integrations" && input.command === "retry_failed") {
    const studioId = await requireCoach();
    if (!workerEnabled("calendar")) return disabledWorkerResponse("calendar");
    if (!workerEnabled("automations"))
      return disabledWorkerResponse("automations");
    const service = serviceClient(),
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
