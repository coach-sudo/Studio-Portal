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
    return json({
      resource: { reviewed: data?.length || 0, studentId: targetStudentId },
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
    const studioId = await requireCoach();
    const { data, error } = await serviceClient().rpc(
      "cleanup_transient_studio_data",
    );
    if (error) throw error;
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "studio",
        studioId,
        "studio.transient_storage_cleaned",
        null,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (domain === "settings" && input.command === "update") {
    const studioId = await requireCoach(),
      { data: before, error: readError } = await db
        .from("studios")
        .select("*")
        .eq("id", studioId)
        .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    const incomingSettings =
      (input.payload.settings as Record<string, any>) || {};
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
            unknownCampaignTokens(`${template.subject}\n${template.body}`)
              .length > 0,
        )
      )
        throw new Error("VALIDATION_FAILED: Check the campaign templates.");
    }
    const nextSettings = {
      ...(before.settings || {}),
      ...incomingSettings,
    };
    for (const key of [
      "branding",
      "bookingCopy",
      "bookingPage",
      "bookingDefaults",
      "meetingFormats",
      "emailAutomations",
      "portalDefaults",
    ]) {
      if (incomingSettings[key])
        (nextSettings as any)[key] = {
          ...((before.settings || {})[key] || {}),
          ...incomingSettings[key],
        };
    }
    const name = String(
      (nextSettings as Record<string, unknown>).studioName || before.name,
    ).trim();
    if (!name) throw new Error("VALIDATION_FAILED");
    const { data, error } = await serviceClient()
      .from("studios")
      .update({
        name,
        timezone: String(
          (nextSettings as Record<string, unknown>).timezone || before.timezone,
        ),
        settings: nextSettings,
        updated_at: new Date().toISOString(),
      })
      .eq("id", studioId)
      .select()
      .single();
    if (error) throw error;
    const bookingDefaults = (input.payload.settings as any)?.bookingDefaults;
    if (bookingDefaults?.inPersonUpchargeMinor != null) {
      const service = serviceClient();
      const { data: bookingServices, error: servicesError } = await service
        .from("booking_services")
        .select("id,location_price_adjustments")
        .eq("studio_id", studioId);
      if (servicesError) throw servicesError;
      for (const item of bookingServices || []) {
        const adjustments = {
          ...(item.location_price_adjustments || {}),
          in_person: Number(bookingDefaults.inPersonUpchargeMinor),
        };
        const { error: updateError } = await service
          .from("booking_services")
          .update({
            location_price_adjustments: adjustments,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        if (updateError) throw updateError;
      }
    }
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "studio",
        studioId,
        "studio.settings_updated",
        before,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  return null;
}
