import { json } from "../_shared/http";
import { dispatchOutbox } from "../_shared/outbox-dispatch";
import { provisionPortalAccount } from "../_shared/portal-access";
import { mapStudentChanges } from "../_shared/student-updates";
import { serviceClient } from "../_shared/supabase";
import type { V2CommandContext } from "./types";

export async function handleStudentsCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  const { audit, context, db, domain, id, input, requireCoach } = ctx;

  if (domain === "students" && input.command === "create") {
    const studioId = await requireCoach(),
      fullName = String(input.payload.fullName || "").trim(),
      email = String(input.payload.email || "")
        .trim()
        .toLowerCase(),
      isMinor = Boolean(input.payload.isMinor),
      guardianEmail = String(input.payload.guardianEmail || "")
        .trim()
        .toLowerCase();
    if (
      fullName.length < 2 ||
      (!isMinor && !email.includes("@")) ||
      (isMinor && !guardianEmail.includes("@"))
    )
      throw new Error("VALIDATION_FAILED");
    const { data, error } = await db
      .from("students")
      .insert({
        studio_id: studioId,
        full_name: fullName,
        email: email || null,
        phone: String(input.payload.phone || "").trim() || null,
        focus_area: String(input.payload.focusArea || "") || null,
        lead_source: String(input.payload.leadSource || "") || null,
        is_minor: isMinor,
        guardian_name: String(input.payload.guardianName || "") || null,
        guardian_email: guardianEmail || null,
        status: "lead",
        portal_enabled: false,
      })
      .select()
      .single();
    if (error) throw error;
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "student",
        data.id,
        "student.created",
        null,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (domain === "students" && input.command === "invite" && input.entityId) {
    const studioId = await requireCoach();
    const result = await provisionPortalAccount(serviceClient(), {
      studioId,
      studentId: input.entityId,
      accountType:
        input.payload.accountType === "guardian" ? "guardian" : "student",
      resetExisting: true,
      expectedVersion: input.expectedVersion,
      linkedContactId: String(input.payload.linkedContactId || "") || undefined,
    });
    const undoUntil = new Date(Date.now() + 8_000).toISOString();
    if (result.outboxMessageId) {
      const { error: deferError } = await serviceClient()
        .from("outbox_messages")
        .update({
          send_at: undoUntil,
          next_attempt_at: undoUntil,
          event_key: "manual.portal_invite",
        })
        .eq("id", result.outboxMessageId)
        .eq("status", "queued");
      if (deferError) throw deferError;
      context.waitUntil(
        new Promise((resolve) => setTimeout(resolve, 8_250)).then(() =>
          dispatchOutbox({ ids: [result.outboxMessageId!] }),
        ),
      );
    }
    return json({
      resource: result.student,
      outboxMessageId: result.outboxMessageId,
      undoUntil,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "student",
        input.entityId,
        "portal.invited",
        null,
        {
          accountType: result.accountType,
          recipient: result.recipient,
          username: result.username,
        },
      ),
      queuedSideEffects: result.outboxMessageId
        ? ["credential_email_after_undo_window", "outbox_worker_fallback"]
        : [],
    });
  }

  if (
    domain === "students" &&
    ["set_credentials", "send_login_instructions"].includes(input.command) &&
    input.entityId
  ) {
    const studioId = await requireCoach();
    const result = await provisionPortalAccount(serviceClient(), {
      studioId,
      studentId: input.entityId,
      accountType:
        input.payload.accountType === "guardian" ? "guardian" : "student",
      resetExisting: true,
      expectedVersion: input.expectedVersion,
      linkedContactId: String(input.payload.linkedContactId || "") || undefined,
    });
    const undoUntil = new Date(Date.now() + 8_000).toISOString();
    if (result.outboxMessageId) {
      const { error: deferError } = await serviceClient()
        .from("outbox_messages")
        .update({
          send_at: undoUntil,
          next_attempt_at: undoUntil,
          event_key: "manual.portal_invite",
        })
        .eq("id", result.outboxMessageId)
        .eq("status", "queued");
      if (deferError) throw deferError;
      context.waitUntil(
        new Promise((resolve) => setTimeout(resolve, 8_250)).then(() =>
          dispatchOutbox({ ids: [result.outboxMessageId!] }),
        ),
      );
    }
    return json({
      resource: result.student,
      outboxMessageId: result.outboxMessageId,
      undoUntil,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "student",
        input.entityId,
        "portal.invited",
        null,
        {
          accountType: result.accountType,
          recipient: result.recipient,
          username: result.username,
        },
      ),
      queuedSideEffects: result.outboxMessageId
        ? ["credential_email_after_undo_window", "outbox_worker_fallback"]
        : [],
    });
  }

  if (
    domain === "students" &&
    input.command === "save_linked_contact" &&
    input.entityId
  ) {
    const studioId = await requireCoach();
    const service = serviceClient();
    const { data: student } = await service
      .from("students")
      .select("*")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    if (!student) throw new Error("FORBIDDEN");
    const fullName = String(input.payload.fullName || "").trim();
    const email = String(input.payload.email || "")
      .trim()
      .toLowerCase();
    if (fullName.length < 2 || !email.includes("@"))
      throw new Error("VALIDATION_FAILED: Add a name and valid email.");
    const relationshipType = ["guardian", "support_person", "other"].includes(
      String(input.payload.relationshipType),
    )
      ? String(input.payload.relationshipType)
      : "support_person";
    const values = {
      studio_id: studioId,
      student_id: student.id,
      full_name: fullName,
      email,
      relationship_type: relationshipType,
      relationship_label: String(input.payload.relationshipLabel || "").trim(),
      can_view_schedule: input.payload.canViewSchedule !== false,
      can_manage_lessons: Boolean(input.payload.canManageLessons),
      can_view_work: input.payload.canViewWork !== false,
      can_manage_profile: Boolean(input.payload.canManageProfile),
      can_view_finance: Boolean(input.payload.canViewFinance),
      can_receive_notifications:
        input.payload.canReceiveNotifications !== false,
      notification_preferences: input.payload.notificationPreferences || {},
      portal_enabled: input.payload.portalEnabled !== false,
      updated_at: new Date().toISOString(),
    };
    let contactId = String(input.payload.contactId || "");
    let before: any = null;
    if (contactId) {
      const found = await service
        .from("linked_contacts")
        .select("*")
        .eq("id", contactId)
        .eq("student_id", student.id)
        .maybeSingle();
      if (found.error || !found.data) throw new Error("FORBIDDEN");
      before = found.data;
      const duplicate = await service
        .from("linked_contacts")
        .select("id")
        .eq("student_id", student.id)
        .ilike("email", email)
        .neq("id", contactId)
        .maybeSingle();
      if (duplicate.data)
        throw new Error(
          "VALIDATION_FAILED: That email is already linked to this student. Open that household profile instead.",
        );
    } else {
      const found = await service
        .from("linked_contacts")
        .select("*")
        .eq("student_id", student.id)
        .ilike("email", email)
        .maybeSingle();
      if (found.error) throw found.error;
      if (found.data) {
        before = found.data;
        contactId = found.data.id;
      }
    }
    const query = contactId
      ? service
          .from("linked_contacts")
          .update({ ...values, version: Number(before.version) + 1 })
          .eq("id", contactId)
          .eq("student_id", student.id)
          .eq("version", before.version)
      : service.from("linked_contacts").insert(values);
    const { data, error } = await query.select().maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    if (
      relationshipType === "guardian" &&
      (!student.guardian_email ||
        !before ||
        String(student.guardian_email).toLowerCase() ===
          String(before.email).toLowerCase())
    ) {
      await service
        .from("students")
        .update({
          guardian_name: fullName,
          guardian_email: email,
          version: student.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", student.id)
        .eq("version", student.version);
    }
    const { data: queuedCalendarUpdates } = await service.rpc(
      "sync_future_contact_details",
      {
        p_student_id: student.id,
        p_old_email: before?.email || email,
        p_new_email: email,
        p_old_name: before?.full_name || fullName,
        p_new_name: fullName,
        p_old_phone: null,
        p_new_phone: null,
        p_contact_kind: "household",
      },
    );
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "linked_contact",
        data.id,
        before
          ? before.portal_enabled
            ? "linked_contact.updated"
            : "linked_contact.restored"
          : "linked_contact.created",
        before,
        data,
      ),
      queuedSideEffects: Number(queuedCalendarUpdates || 0)
        ? [`calendar_attendees_queued:${queuedCalendarUpdates}`]
        : [],
    });
  }

  if (
    domain === "students" &&
    input.command === "remove_linked_contact" &&
    input.entityId
  ) {
    const studioId = await requireCoach();
    const service = serviceClient();
    const contactId = String(input.payload.contactId || "");
    const { data: before, error: readError } = await service
      .from("linked_contacts")
      .select("*")
      .eq("id", contactId)
      .eq("student_id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    const { data, error } = await service
      .from("linked_contacts")
      .update({
        portal_enabled: false,
        can_receive_notifications: false,
        version: before.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", before.id)
      .eq("version", before.version)
      .select()
      .single();
    if (error) throw error;
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "linked_contact",
        before.id,
        "linked_contact.disabled",
        before,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (
    domain === "students" &&
    ["update", "update_self"].includes(input.command) &&
    input.entityId
  ) {
    const { data: before, error: readError } = await db
      .from("students")
      .select("*")
      .eq("id", input.entityId)
      .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    const isCoach = input.command === "update";
    if (isCoach) {
      const studioId = await requireCoach();
      if (studioId !== before.studio_id) throw new Error("FORBIDDEN");
    }
    if (!isCoach) {
      const { data: authData } = await db.auth.getUser();
      if (!authData.user) throw new Error("FORBIDDEN");
      if (before.user_id !== authData.user.id) {
        const { data: relationship } = await serviceClient()
          .from("student_relationships")
          .select("can_manage_profile")
          .eq("student_id", before.id)
          .eq("user_id", authData.user.id)
          .maybeSingle();
        if (!relationship?.can_manage_profile) throw new Error("FORBIDDEN");
      }
    }
    const allowed = isCoach
      ? [
          "fullName",
          "preferredName",
          "pronouns",
          "email",
          "phone",
          "isMinor",
          "guardianName",
          "guardianEmail",
          "status",
          "focusArea",
          "goals",
          "privateNotes",
          "leadSource",
          "tags",
          "driveFolderUrl",
          "actorPageEligible",
          "portalEnabled",
          "timezone",
          "defaultRateMinor",
          "specialPricingEnabled",
          "portalUsername",
          "notificationPreferences",
          "profilePhotoAssetId",
          "profilePhotoPosition",
        ]
      : [
          "preferredName",
          "pronouns",
          "email",
          "phone",
          "timezone",
          "portalPreferences",
          "portalUsername",
          "notificationPreferences",
          "profilePhotoAssetId",
          "profilePhotoPosition",
        ];
    const payload = input.payload as Record<string, unknown>,
      changes: Record<string, unknown> = {
        version: input.expectedVersion + 1,
        updated_at: new Date().toISOString(),
      };
    const columns: Record<string, string> = {
      fullName: "full_name",
      preferredName: "preferred_name",
      pronouns: "pronouns",
      email: "email",
      phone: "phone",
      isMinor: "is_minor",
      guardianName: "guardian_name",
      guardianEmail: "guardian_email",
      status: "status",
      focusArea: "focus_area",
      goals: "goals",
      privateNotes: "internal_notes",
      leadSource: "lead_source",
      tags: "tags",
      driveFolderUrl: "drive_folder_url",
      actorPageEligible: "actor_page_eligible",
      portalEnabled: "portal_enabled",
      timezone: "timezone",
      defaultRateMinor: "default_rate_minor",
      specialPricingEnabled: "special_pricing_enabled",
      portalUsername: "portal_username",
      portalPreferences: "portal_preferences",
      notificationPreferences: "notification_preferences",
      profilePhotoAssetId: "profile_photo_asset_id",
      profilePhotoPosition: "profile_photo_position",
    };
    if (Object.prototype.hasOwnProperty.call(payload, "timezone")) {
      try {
        new Intl.DateTimeFormat("en-US", {
          timeZone: String(payload.timezone),
        }).format();
      } catch {
        throw new Error("VALIDATION_FAILED: Choose a valid timezone.");
      }
    }
    Object.assign(changes, mapStudentChanges(payload, allowed, columns));
    if (Object.prototype.hasOwnProperty.call(payload, "timezone"))
      changes.timezone_confirmed = true;
    const { data, error } = await serviceClient()
      .from("students")
      .update(changes)
      .eq("id", before.id)
      .eq("version", input.expectedVersion)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    const service = serviceClient();
    let queuedCalendarUpdates = 0;
    const studentIdentityChanged = [
      "fullName",
      "preferredName",
      "email",
      "phone",
    ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
    if (studentIdentityChanged) {
      const { data: queued } = await service.rpc(
        "sync_future_contact_details",
        {
          p_student_id: before.id,
          p_old_email: before.email || "",
          p_new_email: data.email || "",
          p_old_name: before.preferred_name || before.full_name,
          p_new_name: data.preferred_name || data.full_name,
          p_old_phone: before.phone || null,
          p_new_phone: data.phone || null,
          p_contact_kind: "student",
        },
      );
      queuedCalendarUpdates = Math.max(
        queuedCalendarUpdates,
        Number(queued || 0),
      );
    }
    if (
      isCoach &&
      Object.prototype.hasOwnProperty.call(payload, "guardianEmail") &&
      data.guardian_email
    ) {
      const oldGuardianEmail = String(
        before.guardian_email || "",
      ).toLowerCase();
      const newGuardianEmail = String(data.guardian_email).trim().toLowerCase();
      const newGuardianName = String(data.guardian_name || "Guardian").trim();
      let { data: household } = await service
        .from("linked_contacts")
        .select("*")
        .eq("student_id", before.id)
        .ilike("email", newGuardianEmail)
        .maybeSingle();
      if (!household && oldGuardianEmail) {
        const found = await service
          .from("linked_contacts")
          .select("*")
          .eq("student_id", before.id)
          .ilike("email", oldGuardianEmail)
          .maybeSingle();
        household = found.data;
      }
      const householdValues = {
        studio_id: before.studio_id,
        student_id: before.id,
        full_name: newGuardianName,
        email: newGuardianEmail,
        relationship_type: "guardian",
        relationship_label:
          household?.relationship_label || "Parent or guardian",
        can_view_schedule: household?.can_view_schedule ?? true,
        can_manage_lessons: household?.can_manage_lessons ?? true,
        can_view_work: household?.can_view_work ?? true,
        can_manage_profile: household?.can_manage_profile ?? true,
        can_view_finance: household?.can_view_finance ?? true,
        can_receive_notifications: household?.can_receive_notifications ?? true,
        notification_preferences:
          household?.notification_preferences ||
          data.notification_preferences ||
          {},
        portal_enabled: household?.portal_enabled ?? false,
        updated_at: new Date().toISOString(),
      };
      const savedHousehold = household
        ? await service
            .from("linked_contacts")
            .update({ ...householdValues, version: household.version + 1 })
            .eq("id", household.id)
            .eq("version", household.version)
        : await service.from("linked_contacts").insert(householdValues);
      if (savedHousehold.error) throw savedHousehold.error;
      const { data: queued } = await service.rpc(
        "sync_future_contact_details",
        {
          p_student_id: before.id,
          p_old_email: household?.email || oldGuardianEmail || newGuardianEmail,
          p_new_email: newGuardianEmail,
          p_old_name:
            household?.full_name || before.guardian_name || newGuardianName,
          p_new_name: newGuardianName,
          p_old_phone: null,
          p_new_phone: null,
          p_contact_kind: "household",
        },
      );
      queuedCalendarUpdates = Math.max(
        queuedCalendarUpdates,
        Number(queued || 0),
      );
    }
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        before.studio_id,
        "student",
        before.id,
        isCoach ? "student.updated" : "student.self_updated",
        before,
        data,
      ),
      queuedSideEffects: queuedCalendarUpdates
        ? [`calendar_attendees_queued:${queuedCalendarUpdates}`]
        : [],
    });
  }

  if (domain === "pricing" && input.command === "upsert_student_rate") {
    const studioId = await requireCoach();
    const studentId = String(input.payload.studentId || ""),
      serviceId = String(input.payload.serviceId || "");
    const priceMinor = Math.max(
      0,
      Math.round(Number(input.payload.priceMinor)),
    );
    if (!studentId || !serviceId || !Number.isFinite(priceMinor))
      throw new Error(
        "VALIDATION_FAILED: Student, service, and price are required.",
      );
    const service = serviceClient();
    const [{ data: student }, { data: bookingService }] = await Promise.all([
      service
        .from("students")
        .select("id")
        .eq("id", studentId)
        .eq("studio_id", studioId)
        .single(),
      service
        .from("booking_services")
        .select("id")
        .eq("id", serviceId)
        .eq("studio_id", studioId)
        .single(),
    ]);
    if (!student || !bookingService) throw new Error("FORBIDDEN");
    const { data: existing } = await service
      .from("student_pricing_rules")
      .select("*")
      .eq("student_id", studentId)
      .eq("service_id", serviceId)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = {
      studio_id: studioId,
      student_id: studentId,
      service_id: serviceId,
      price_minor: priceMinor,
      deposit_minor:
        input.payload.depositMinor == null
          ? null
          : Math.max(0, Math.round(Number(input.payload.depositMinor))),
      location_price_adjustments: input.payload.locationPriceAdjustments || {},
      reason: String(input.payload.reason || "Student-specific pricing"),
      starts_at: existing?.starts_at || new Date().toISOString(),
      active: true,
      updated_at: new Date().toISOString(),
    };
    const query = existing
      ? service
          .from("student_pricing_rules")
          .update({ ...row, version: Number(existing.version) + 1 })
          .eq("id", existing.id)
          .eq("version", existing.version)
      : service.from("student_pricing_rules").insert(row);
    const { data, error } = await query.select().single();
    if (error) throw error;
    return json({
      resource: data,
      auditEventId: await audit(
        studioId,
        "student_pricing_rule",
        data.id,
        existing ? "student_pricing.updated" : "student_pricing.created",
        existing,
        data,
      ),
      correlationId: id,
    });
  }

  if (
    domain === "pricing" &&
    input.command === "delete_student_rate" &&
    input.entityId
  ) {
    const studioId = await requireCoach();
    const service = serviceClient();
    const { data: before } = await service
      .from("student_pricing_rules")
      .select("*")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    if (!before) throw new Error("FORBIDDEN");
    const { error } = await service
      .from("student_pricing_rules")
      .delete()
      .eq("id", before.id);
    if (error) throw error;
    return json({
      resource: { id: before.id, deleted: true },
      auditEventId: await audit(
        studioId,
        "student_pricing_rule",
        before.id,
        "student_pricing.deleted",
        before,
        null,
      ),
      correlationId: id,
    });
  }

  if (domain === "students" && input.command === "remove" && input.entityId) {
    const studioId = await requireCoach();
    const service = serviceClient();
    const { data: before, error: readError } = await service
      .from("students")
      .select("*")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .is("deleted_at", null)
      .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    if (before.version !== input.expectedVersion)
      throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    const { data: authData } = await db.auth.getUser();
    const { data: removed, error: removeError } = await service.rpc(
      "command_remove_student",
      {
        target_student: before.id,
        expected_version: input.expectedVersion,
        removed_by: authData.user?.id || null,
      },
    );
    if (removeError) throw removeError;
    return json({
      resource: removed,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "student",
        before.id,
        "student.removed",
        before,
        removed,
      ),
      queuedSideEffects: Number(removed?.cancelledLessons || 0)
        ? ["calendar_projection"]
        : [],
    });
  }

  if (domain === "students" && input.command === "merge" && input.entityId) {
    const studioId = await requireCoach(),
      removeStudentId = String(input.payload.removeStudentId || "");
    const { data: keep, error: keepError } = await db
      .from("students")
      .select("id,studio_id")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    const { data: remove, error: removeError } = await db
      .from("students")
      .select("id,studio_id")
      .eq("id", removeStudentId)
      .eq("studio_id", studioId)
      .single();
    if (keepError || removeError || !keep || !remove)
      throw new Error("FORBIDDEN");
    const { data, error } = await db.rpc("merge_studio_students", {
      keep_student_id: keep.id,
      remove_student_id: remove.id,
    });
    if (error) throw error;
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "student",
        keep.id,
        "student.merged",
        { keep, remove },
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (
    domain === "students" &&
    input.command === "update_linked_contact_self" &&
    input.entityId
  ) {
    const { data: authData } = await db.auth.getUser();
    if (!authData.user) throw new Error("FORBIDDEN");
    const service = serviceClient();
    const { data: before, error: readError } = await service
      .from("linked_contacts")
      .select("*")
      .eq("id", input.entityId)
      .eq("user_id", authData.user.id)
      .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    const email = String(input.payload.email || before.email)
      .trim()
      .toLowerCase();
    const fullName = String(input.payload.fullName || before.full_name).trim();
    if (!email.includes("@") || fullName.length < 2)
      throw new Error("VALIDATION_FAILED: Add a name and valid email.");
    const timezone = String(
      input.payload.timezone || before.timezone || "",
    ).trim();
    if (timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      } catch {
        throw new Error("VALIDATION_FAILED: Choose a valid timezone.");
      }
    }
    const { data, error } = await service
      .from("linked_contacts")
      .update({
        full_name: fullName,
        email,
        timezone: timezone || null,
        timezone_confirmed: Boolean(timezone),
        notification_preferences:
          input.payload.notificationPreferences ||
          before.notification_preferences,
        portal_preferences:
          input.payload.portalPreferences || before.portal_preferences || {},
        version: before.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", before.id)
      .eq("version", input.expectedVersion)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    const { data: queued } = await service.rpc("sync_future_contact_details", {
      p_student_id: before.student_id,
      p_old_email: before.email || "",
      p_new_email: data.email || "",
      p_old_name: before.full_name,
      p_new_name: data.full_name,
      p_old_phone: null,
      p_new_phone: null,
      p_contact_kind: "household",
    });
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        before.studio_id,
        "linked_contact",
        before.id,
        "linked_contact.self_updated",
        before,
        data,
      ),
      queuedSideEffects: Number(queued || 0)
        ? [`calendar_attendees_queued:${queued}`]
        : [],
    });
  }

  return null;
}
