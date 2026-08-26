import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { commandSchema } from "./_shared/schemas";
import { apiError, correlationId, json } from "./_shared/http";
import { userClient } from "./_shared/supabase";
import { serviceClient } from "./_shared/supabase";
import { googleAccessToken, googleFreeBusy } from "./_shared/google";
import { mapStudentChanges } from "./_shared/student-updates";
import { queueLessonChangeEmails } from "./_shared/booking-email";
import { findAuthUserByEmail } from "./_shared/auth-users";

const domains = new Set([
  "students",
  "lessons",
  "notes",
  "materials",
  "messages",
  "work",
  "finance",
  "packages",
  "credits",
  "discounts",
  "whiteboards",
  "actor-pages",
  "outbox",
  "integrations",
  "recommendations",
  "settings",
]);
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
export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    const domain = context.params.domain;
    if (!domains.has(domain))
      return json(
        {
          code: "NOT_FOUND",
          message: "Unknown API domain.",
          retryable: false,
          correlationId: id,
        },
        404,
      );
    if (request.method === "GET")
      return json({
        ok: true,
        domain,
        message: "Reads use Supabase RLS-backed query models.",
        correlationId: id,
      });
    if (request.method !== "POST")
      return json(
        {
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed.",
          retryable: false,
          correlationId: id,
        },
        405,
      );
    const input = commandSchema.parse(await request.json());
    const db = userClient(request);
    const requireCoach = async () => {
      const { data, error } = await db
        .from("memberships")
        .select("studio_id")
        .eq("role", "coach")
        .limit(1)
        .single();
      if (error || !data) throw new Error("FORBIDDEN");
      return data.studio_id as string;
    };
    const requireMaterialManager = async (materialId: string) => {
      const service = serviceClient();
      const [{ data: material, error: materialError }, { data: authData }] =
        await Promise.all([
          service.from("materials").select("*").eq("id", materialId).single(),
          db.auth.getUser(),
        ]);
      if (materialError || !material || !authData.user)
        throw new Error("FORBIDDEN");
      const [{ data: coach }, { data: owner }, { data: guardian }] =
        await Promise.all([
          service
            .from("memberships")
            .select("id")
            .eq("studio_id", material.studio_id)
            .eq("user_id", authData.user.id)
            .eq("role", "coach")
            .maybeSingle(),
          material.owner_student_id
            ? service
                .from("students")
                .select("id")
                .eq("id", material.owner_student_id)
                .eq("user_id", authData.user.id)
                .is("deleted_at", null)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          material.owner_student_id
            ? service
                .from("student_relationships")
                .select("id")
                .eq("student_id", material.owner_student_id)
                .eq("user_id", authData.user.id)
                .eq("can_manage_profile", true)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
      if (!coach && !owner && !guardian) throw new Error("FORBIDDEN");
      return {
        studioId: material.studio_id as string,
        before: material,
        isCoach: Boolean(coach),
      };
    };
    const audit = async (
      studioId: string,
      entityType: string,
      entityId: string,
      action: string,
      beforeState: unknown,
      afterState: unknown,
    ) => {
      const { data, error } = await serviceClient()
        .from("audit_events")
        .insert({
          studio_id: studioId,
          entity_type: entityType,
          entity_id: entityId,
          action,
          reason: input.reason,
          correlation_id: id,
          source: "studio_command",
          before_state: beforeState,
          after_state: afterState,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    };
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
    if (domain === "messages" && input.command === "create") {
      const body = String(input.payload.body || "").trim(),
        studentId = String(input.payload.studentId || ""),
        lessonId = String(input.entityId || input.payload.lessonId || "");
      if (!lessonId || !studentId || body.length < 1 || body.length > 4000)
        throw new Error(
          "VALIDATION_FAILED: Write a message between 1 and 4,000 characters.",
        );
      const [{ data: lesson, error: lessonError }, { data: participant }] =
        await Promise.all([
          db
            .from("lessons")
            .select("id,studio_id,student_id")
            .eq("id", lessonId)
            .single(),
          db
            .from("lesson_participants")
            .select("id")
            .eq("lesson_id", lessonId)
            .eq("student_id", studentId)
            .maybeSingle(),
        ]);
      if (
        lessonError ||
        !lesson ||
        (lesson.student_id !== studentId && !participant)
      )
        throw new Error("FORBIDDEN");
      const [{ data: coachMembership }, { data: authData }] = await Promise.all(
        [
          db
            .from("memberships")
            .select("id")
            .eq("studio_id", lesson.studio_id)
            .eq("role", "coach")
            .maybeSingle(),
          db.auth.getUser(),
        ],
      );
      const user = authData.user;
      if (!user) throw new Error("FORBIDDEN");
      let authorRole: "coach" | "student" | "guardian" = coachMembership
        ? "coach"
        : "student";
      if (!coachMembership) {
        const { data: relationship } = await db
          .from("student_relationships")
          .select("id")
          .eq("student_id", studentId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (relationship) authorRole = "guardian";
      }
      const { data, error } = await serviceClient()
        .from("lesson_messages")
        .insert({
          lesson_id: lesson.id,
          student_id: studentId,
          author_user_id: user.id,
          author_role: authorRole,
          body,
        })
        .select()
        .single();
      if (error) throw error;
      return json(
        {
          resource: data,
          recommendations: [],
          auditEventId: await audit(
            lesson.studio_id,
            "lesson_message",
            data.id,
            "lesson_message.created",
            null,
            { lesson_id: lesson.id, author_role: authorRole },
          ),
          queuedSideEffects: [],
        },
        201,
      );
    }
    if (domain === "students" && input.command === "invite" && input.entityId) {
      const studioId = await requireCoach(),
        { data: student, error } = await db
          .from("students")
          .select("*")
          .eq("id", input.entityId)
          .eq("studio_id", studioId)
          .single();
      if (error || !student) throw new Error("FORBIDDEN");
      const email = String(
        student.is_minor ? student.guardian_email : student.email || "",
      ).toLowerCase();
      if (!email)
        throw new Error(
          "VALIDATION_FAILED: An adult student email or minor guardian email is required.",
        );
      const service = serviceClient();
      let invited = await service.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${new URL(request.url).origin}/login`,
        }),
        user = invited.data.user;
      if (invited.error) {
        user = (await findAuthUserByEmail(service, email)) ?? null;
        if (!user) throw invited.error;
      }
      if (student.is_minor)
        await service.from("student_relationships").upsert(
          {
            student_id: student.id,
            user_id: user!.id,
            relationship: "guardian",
            can_view_finance: true,
            can_manage_profile: true,
          },
          { onConflict: "student_id,user_id" },
        );
      else
        await service
          .from("students")
          .update({ user_id: user!.id })
          .eq("id", student.id);
      const { data: updated, error: updateError } = await service
        .from("students")
        .update({
          portal_enabled: true,
          version: student.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", student.id)
        .eq("version", student.version)
        .select()
        .single();
      if (updateError) throw updateError;
      return json({
        resource: updated,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "student",
          student.id,
          "portal.invited",
          student,
          updated,
        ),
        queuedSideEffects: ["supabase_invitation"],
      });
    }
    if (
      domain === "students" &&
      input.command === "set_credentials" &&
      input.entityId
    ) {
      const studioId = await requireCoach();
      const username = String(input.payload.username || "")
        .trim()
        .toLowerCase();
      const password = String(input.payload.password || "");
      if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username))
        throw new Error(
          "VALIDATION_FAILED: Username must be 3–32 characters and begin with a letter.",
        );
      if (
        password.length < 12 ||
        !/[a-z]/.test(password) ||
        !/[A-Z]/.test(password) ||
        !/\d/.test(password) ||
        !/[^A-Za-z0-9]/.test(password)
      )
        throw new Error(
          "VALIDATION_FAILED: Temporary password must be 12+ characters with upper/lowercase letters, a number, and a symbol.",
        );
      const service = serviceClient();
      const { data: student, error: studentError } = await service
        .from("students")
        .select("*")
        .eq("id", input.entityId)
        .eq("studio_id", studioId)
        .single();
      if (studentError || !student) throw new Error("FORBIDDEN");
      if (student.version !== input.expectedVersion)
        throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
      const email = String(
        student.is_minor ? student.guardian_email : student.email || "",
      )
        .trim()
        .toLowerCase();
      if (!email.includes("@"))
        throw new Error(
          "VALIDATION_FAILED: Add an adult student email or minor guardian email first.",
        );
      const { data: duplicate } = await service
        .from("students")
        .select("id")
        .eq("studio_id", studioId)
        .ilike("portal_username", username)
        .neq("id", student.id)
        .maybeSingle();
      if (duplicate)
        throw new Error("VALIDATION_FAILED: That username is already in use.");
      let authUser: { id: string } | undefined = student.user_id
        ? { id: student.user_id }
        : undefined;
      if (!authUser && student.is_minor) {
        const { data: existingRelationship } = await service
          .from("student_relationships")
          .select("user_id")
          .eq("student_id", student.id)
          .eq("relationship", "guardian")
          .limit(1)
          .maybeSingle();
        if (existingRelationship?.user_id)
          authUser = { id: existingRelationship.user_id };
      }
      if (!authUser) authUser = await findAuthUserByEmail(service, email);
      if (authUser) {
        const updatedAuth = await service.auth.admin.updateUserById(
          authUser.id,
          {
            password,
            email_confirm: true,
            user_metadata: {
              portal_role: student.is_minor ? "guardian" : "student",
            },
          },
        );
        if (updatedAuth.error) throw updatedAuth.error;
      } else {
        const createdAuth = await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            portal_role: student.is_minor ? "guardian" : "student",
          },
        });
        if (createdAuth.error || !createdAuth.data.user)
          throw (
            createdAuth.error ||
            new Error("Portal identity could not be created.")
          );
        authUser = createdAuth.data.user;
      }
      if (student.is_minor) {
        const { error: relationshipError } = await service
          .from("student_relationships")
          .upsert(
            {
              student_id: student.id,
              user_id: authUser.id,
              relationship: "guardian",
              can_view_finance: true,
              can_manage_profile: true,
            },
            { onConflict: "student_id,user_id" },
          );
        if (relationshipError) throw relationshipError;
      }
      const { data: updated, error: updateError } = await service
        .from("students")
        .update({
          user_id: student.is_minor ? student.user_id : authUser.id,
          portal_username: username,
          portal_enabled: true,
          version: student.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", student.id)
        .eq("version", student.version)
        .select()
        .single();
      if (updateError) throw updateError;
      return json({
        resource: updated,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "student",
          student.id,
          "portal.credentials_set",
          { portal_username: student.portal_username || null },
          { portal_username: username },
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
            "portalUsername",
          ]
        : [
            "preferredName",
            "pronouns",
            "email",
            "phone",
            "timezone",
            "portalPreferences",
            "portalUsername",
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
        portalUsername: "portal_username",
        portalPreferences: "portal_preferences",
      };
      Object.assign(changes, mapStudentChanges(payload, allowed, columns));
      const { data, error } = await serviceClient()
        .from("students")
        .update(changes)
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
          before.studio_id,
          "student",
          before.id,
          isCoach ? "student.updated" : "student.self_updated",
          before,
          data,
        ),
        queuedSideEffects: [],
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
      const { data, error } = await serviceClient().rpc(
        "command_create_lesson",
        {
          target_studio: studioId,
          target_student: studentId,
          topic: String(input.payload.topic || "Private coaching"),
          starts_at: startsAt,
          ends_at: endsAt,
          location_type:
            input.payload.locationType === "in_person"
              ? "in_person"
              : "virtual",
          location_label: String(input.payload.locationLabel || "Google Meet"),
          student_name: String(input.payload.studentName || "Student"),
          student_email: String(input.payload.studentEmail || ""),
          recurrence: cadence,
          occurrence_count: occurrenceCount,
          timezone: String(input.payload.timezone || "America/New_York"),
        },
      );
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
          published_at:
            status === "published" ? new Date().toISOString() : null,
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
        body_html: String(input.payload.bodyHtml ?? before.body_html ?? before.body),
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
    if (
      domain === "whiteboards" &&
      input.command === "save" &&
      input.entityId
    ) {
      const { data: lesson, error: lessonError } = await db
        .from("lessons")
        .select("id,studio_id,student_id")
        .eq("id", input.entityId)
        .single();
      if (lessonError || !lesson) throw new Error("FORBIDDEN");
      const elements = Array.isArray((input.payload.document as any)?.elements)
        ? (input.payload.document as any).elements
        : [];
      if (elements.length > 500)
        throw new Error(
          "VALIDATION_FAILED: A whiteboard can contain up to 500 items.",
        );
      const document = { version: 1, elements };
      const service = serviceClient();
      const { data: before } = await service
        .from("lesson_whiteboards")
        .select("*")
        .eq("lesson_id", lesson.id)
        .maybeSingle();
      if (before && before.version !== input.expectedVersion)
        throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
      const { data, error } = before
        ? await service
            .from("lesson_whiteboards")
            .update({
              document,
              version: before.version + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", before.id)
            .eq("version", before.version)
            .select()
            .single()
        : await service
            .from("lesson_whiteboards")
            .insert({
              studio_id: lesson.studio_id,
              lesson_id: lesson.id,
              document,
            })
            .select()
            .single();
      if (error) throw error;
      return json({
        resource: data,
        recommendations: [],
        auditEventId: await audit(
          lesson.studio_id,
          "lesson_whiteboard",
          data.id,
          "lesson_whiteboard.saved",
          before,
          data,
        ),
        queuedSideEffects: [],
      });
    }
    if (
      domain === "materials" &&
      input.command === "approve" &&
      input.entityId
    ) {
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
    if (
      domain === "materials" &&
      input.command === "delete" &&
      input.entityId
    ) {
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
      if (!deleted)
        throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
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
      ["complete", "help"].includes(input.command) &&
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
          : {
              help_requested: true,
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
              explanation:
                "The student used Ask coach from their practice page.",
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
                meeting_provider: candidate.joinUrl
                  ? "google_meet"
                  : "in_person",
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
    if (domain === "packages" && input.command === "assign") {
      const studioId = await requireCoach(),
        definitionId = String(input.payload.definitionId || ""),
        studentId = String(input.payload.studentId || ""),
        service = serviceClient();
      const [
        { data: definition, error: definitionError },
        { data: student, error: studentError },
      ] = await Promise.all([
        db
          .from("package_definitions")
          .select("*")
          .eq("id", definitionId)
          .eq("studio_id", studioId)
          .eq("active", true)
          .single(),
        db
          .from("students")
          .select("id")
          .eq("id", studentId)
          .eq("studio_id", studioId)
          .single(),
      ]);
      if (definitionError || studentError || !definition || !student)
        throw new Error(
          "VALIDATION_FAILED: Choose an active package and studio student.",
        );
      const expiresAt = definition.expiration_days
          ? new Date(
              Date.now() + Number(definition.expiration_days) * 86400000,
            ).toISOString()
          : null,
        { data: pkg, error: packageError } = await service
          .from("packages")
          .insert({
            student_id: student.id,
            definition_id: definition.id,
            name: definition.name,
            price_minor: definition.price_minor,
            currency: definition.currency,
            expires_at: expiresAt,
            stripe_price_id: definition.stripe_price_id,
            credit_quantity: definition.session_count,
          })
          .select()
          .single();
      if (packageError) throw packageError;
      const { error: creditError } = await service
        .from("package_credit_entries")
        .insert({
          package_id: pkg.id,
          kind: "adjustment",
          quantity: definition.session_count,
          reason: String(input.payload.reason || "Coach assigned package"),
          idempotency_key: `coach-package:${input.idempotencyKey}`,
        });
      if (creditError) {
        await service.from("packages").delete().eq("id", pkg.id);
        throw creditError;
      }
      return json({
        resource: pkg,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "package",
          pkg.id,
          "package.assigned",
          null,
          pkg,
        ),
        queuedSideEffects: [],
      });
    }
    if (domain === "packages" && ["create", "update"].includes(input.command)) {
      const studioId = await requireCoach();
      const payload = input.payload as Record<string, any>;
      const service = serviceClient();
      const values: Record<string, unknown> = {
        studio_id: studioId,
        name: String(payload.name || "").trim(),
        description: String(payload.description || ""),
        session_count: Number(payload.sessionCount),
        session_duration_minutes: Number(payload.sessionDurationMinutes),
        price_minor: Number(payload.priceMinor),
        discount_minor: Number(payload.discountMinor || 0),
        currency: String(payload.currency || "USD"),
        expiration_days: payload.expirationDays
          ? Number(payload.expirationDays)
          : null,
        eligible_service_ids: Array.isArray(payload.eligibleServiceIds)
          ? payload.eligibleServiceIds
          : [],
        meeting_providers:
          Array.isArray(payload.meetingProviders) &&
          payload.meetingProviders.length
            ? payload.meetingProviders
            : ["google_meet", "in_person"],
        recurring_eligible: Boolean(payload.recurringEligible),
        visibility: payload.visibility === "public" ? "public" : "private",
        direct_purchase: Boolean(payload.directPurchase),
        active: payload.active !== false,
      };
      if (
        !values.name ||
        Number(values.session_count) <= 0 ||
        Number(values.session_duration_minutes) < 15 ||
        Number(values.price_minor) < 0
      )
        throw new Error(
          "VALIDATION_FAILED: Package name, sessions, duration, and price are required.",
        );
      let before: any = null;
      if (input.command === "update") {
        const read = await db
          .from("package_definitions")
          .select("*")
          .eq("id", input.entityId)
          .eq("studio_id", studioId)
          .single();
        if (read.error || !read.data) throw new Error("FORBIDDEN");
        before = read.data;
        if (before.version !== input.expectedVersion)
          throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
      }
      if (values.direct_purchase) {
        const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
        if (!stripeKey) throw new Error("Stripe is not configured.");
        const stripe = new Stripe(stripeKey, {
          apiVersion: "2026-07-29.dahlia",
        });
        let productId: string | undefined;
        if (before?.stripe_price_id) {
          try {
            const oldPrice = await stripe.prices.retrieve(
              before.stripe_price_id,
            );
            productId =
              typeof oldPrice.product === "string"
                ? oldPrice.product
                : oldPrice.product?.id;
          } catch {
            /* create a replacement product */
          }
        }
        if (!productId) {
          const product = await stripe.products.create({
            name: String(values.name),
            description: String(values.description) || undefined,
            metadata: { studio_id: studioId, kind: "lesson_package" },
          });
          productId = product.id;
        }
        const price = await stripe.prices.create({
          product: productId,
          unit_amount: Number(values.price_minor),
          currency: String(values.currency).toLowerCase(),
          metadata: {
            studio_id: studioId,
            session_count: String(values.session_count),
            duration_minutes: String(values.session_duration_minutes),
          },
        });
        values.stripe_price_id = price.id;
      }
      const query =
        input.command === "create"
          ? service.from("package_definitions").insert(values)
          : service
              .from("package_definitions")
              .update({
                ...values,
                version: input.expectedVersion + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("id", input.entityId)
              .eq("version", input.expectedVersion);
      const { data, error } = await query.select().maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
      return json({
        resource: data,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "package_definition",
          data.id,
          `package_definition.${input.command}d`,
          before,
          data,
        ),
        queuedSideEffects: values.direct_purchase
          ? ["stripe_price_created"]
          : [],
      });
    }
    if (
      domain === "packages" &&
      input.command === "toggle_auto_apply" &&
      input.entityId
    ) {
      const { data: before, error: readError } = await db
        .from("packages")
        .select("*,students!inner(studio_id)")
        .eq("id", input.entityId)
        .single();
      if (readError || !before) throw new Error("FORBIDDEN");
      const enabled = Boolean(input.payload.enabled);
      const service = serviceClient();
      const { data, error } = await service
        .from("packages")
        .update({
          auto_apply: enabled,
          version: input.expectedVersion + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", before.id)
        .eq("version", input.expectedVersion)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
      let applied = 0;
      if (enabled) {
        const { data: lessons } = await service
          .from("lessons")
          .select("id")
          .eq("student_id", before.student_id)
          .eq("status", "scheduled")
          .is("package_id", null)
          .gte("starts_at", new Date().toISOString())
          .order("starts_at")
          .limit(50);
        for (const lesson of lessons || []) {
          const { data: packageId } = await service.rpc(
            "reserve_package_credit_for_lesson",
            { p_lesson_id: lesson.id, p_package_id: before.id },
          );
          if (packageId) applied += 1;
        }
      }
      return json({
        resource: { ...data, applied },
        recommendations: [],
        auditEventId: await audit(
          before.students.studio_id,
          "package",
          before.id,
          enabled ? "package.auto_apply_enabled" : "package.auto_apply_disabled",
          before,
          data,
        ),
        queuedSideEffects: applied ? [`credits_applied:${applied}`] : [],
      });
    }
    if (domain === "credits" && input.command === "grant") {
      const studioId = await requireCoach(),
        studentId = String(input.payload.studentId || ""),
        quantity = Number(input.payload.quantity || 0),
        reason = String(
          input.payload.reason || "Coach credit adjustment",
        ).trim();
      if (
        !studentId ||
        !Number.isInteger(quantity) ||
        quantity === 0 ||
        Math.abs(quantity) > 100 ||
        reason.length < 3
      )
        throw new Error(
          "VALIDATION_FAILED: Enter a student, a non-zero credit quantity, and a reason.",
        );
      const service = serviceClient(),
        { data: student, error: studentError } = await service
          .from("students")
          .select("id")
          .eq("id", studentId)
          .eq("studio_id", studioId)
          .single();
      if (studentError || !student) throw new Error("FORBIDDEN");
      let { data: pkg } = await service
        .from("packages")
        .select("id")
        .eq("student_id", studentId)
        .eq("name", "Studio lesson credits")
        .maybeSingle();
      if (!pkg) {
        const created = await service
          .from("packages")
          .insert({
            student_id: studentId,
            name: "Studio lesson credits",
            price_minor: 0,
            currency: "USD",
            credit_quantity: 1,
          })
          .select("id")
          .single();
        if (created.error) throw created.error;
        pkg = created.data;
      }
      const lessonId = String(input.payload.lessonId || "") || null;
      if (lessonId) {
        const linked = await service
          .from("lessons")
          .select("id")
          .eq("id", lessonId)
          .eq("studio_id", studioId)
          .eq("student_id", studentId)
          .single();
        if (linked.error)
          throw new Error(
            "VALIDATION_FAILED: The lesson does not belong to this student.",
          );
      }
      const { data, error } = await service
        .from("package_credit_entries")
        .insert({
          package_id: pkg.id,
          lesson_id: lessonId,
          kind: "adjustment",
          quantity,
          reason,
          idempotency_key: `coach-credit:${input.idempotencyKey}`,
        })
        .select()
        .single();
      if (error) throw error;
      return json({
        resource: data,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "credit",
          data.id,
          "credit.granted",
          null,
          data,
        ),
        queuedSideEffects: [],
      });
    }
    if (
      domain === "credits" &&
      input.command === "use_for_lesson" &&
      input.entityId
    ) {
      const studioId = await requireCoach(),
        service = serviceClient();
      const { data: lesson, error: lessonError } = await service
        .from("lessons")
        .select("*")
        .eq("id", input.entityId)
        .eq("studio_id", studioId)
        .single();
      if (lessonError || !lesson || !lesson.student_id)
        throw new Error("FORBIDDEN");
      if (["cancelled", "late_cancelled"].includes(lesson.status))
        throw new Error(
          "INVALID_TRANSITION: A cancelled lesson cannot use a credit.",
        );
      const requestedPackage = String(input.payload.packageId || "");
      const { data: applied, error: applyError } = await service.rpc(
        "command_apply_lesson_credit",
        {
          target_lesson: lesson.id,
          requested_package: requestedPackage || null,
          entry_reason: String(
            input.payload.reason || `Credit used for ${lesson.topic}`,
          ),
          entry_idempotency_key: `lesson-credit:${lesson.id}`,
        },
      );
      if (applyError) throw applyError;
      const entry = applied.entry;
      return json({
        resource: entry,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "lesson",
          lesson.id,
          "lesson.paid_by_credit",
          lesson,
          { package_id: entry.package_id, credit_entry_id: entry.id },
        ),
        queuedSideEffects: [],
      });
    }
    if (
      domain === "discounts" &&
      ["create", "update", "archive"].includes(input.command)
    ) {
      const studioId = await requireCoach(),
        service = serviceClient(),
        payload = input.payload as Record<string, any>;
      let before: any = null;
      if (input.command !== "create") {
        const read = await service
          .from("discount_codes")
          .select("*")
          .eq("id", input.entityId)
          .eq("studio_id", studioId)
          .single();
        if (read.error || !read.data) throw new Error("FORBIDDEN");
        before = read.data;
        if (before.version !== input.expectedVersion)
          throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
      }
      if (input.command === "archive") {
        const updated = await service
          .from("discount_codes")
          .update({
            active: false,
            version: before.version + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", before.id)
          .eq("version", before.version)
          .select()
          .single();
        if (updated.error) throw updated.error;
        return json({
          resource: updated.data,
          recommendations: [],
          auditEventId: await audit(
            studioId,
            "discount_code",
            before.id,
            "discount_code.archived",
            before,
            updated.data,
          ),
          queuedSideEffects: [],
        });
      }
      const code = String(payload.code || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, "");
      const discountType =
          payload.discountType === "fixed" ? "fixed" : "percent",
        amount = Number(payload.amount || 0);
      if (
        code.length < 3 ||
        amount <= 0 ||
        (discountType === "percent" && amount > 100)
      )
        throw new Error(
          "VALIDATION_FAILED: Use a 3+ character code and a valid discount amount.",
        );
      const values = {
        studio_id: studioId,
        code,
        description: String(payload.description || ""),
        discount_type: discountType,
        amount,
        currency: String(payload.currency || "USD").toUpperCase(),
        service_ids: Array.isArray(payload.serviceIds)
          ? payload.serviceIds
          : [],
        active: payload.active !== false,
        starts_at: payload.startsAt || null,
        ends_at: payload.endsAt || null,
        max_redemptions: payload.maxRedemptions
          ? Number(payload.maxRedemptions)
          : null,
      };
      const result =
        input.command === "create"
          ? await service
              .from("discount_codes")
              .insert(values)
              .select()
              .single()
          : await service
              .from("discount_codes")
              .update({
                ...values,
                version: before.version + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("id", before.id)
              .eq("version", before.version)
              .select()
              .single();
      if (result.error) throw result.error;
      return json({
        resource: result.data,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "discount_code",
          result.data.id,
          `discount_code.${input.command}d`,
          before,
          result.data,
        ),
        queuedSideEffects: [],
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
            (nextSettings as Record<string, unknown>).timezone ||
              before.timezone,
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
        throw new Error("VALIDATION_FAILED: Only scheduled lessons can be rescheduled.");
      const token = await googleAccessToken();
      if ((await googleFreeBusy(token, startsAt, endsAt)).length)
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
    if (domain === "finance" && input.command === "checkout_definition") {
      const definitionId = String(input.payload.packageDefinitionId || "");
      const [
        { data: student, error: studentError },
        { data: definition, error: definitionError },
      ] = await Promise.all([
        db.from("students").select("id,studio_id").limit(1).single(),
        db
          .from("package_definitions")
          .select("*")
          .eq("id", definitionId)
          .eq("active", true)
          .eq("visibility", "public")
          .eq("direct_purchase", true)
          .single(),
      ]);
      if (
        studentError ||
        definitionError ||
        !student ||
        !definition ||
        student.studio_id !== definition.studio_id ||
        !definition.stripe_price_id
      )
        throw new Error(
          "VALIDATION_FAILED: This package is not available for direct purchase.",
        );
      const service = serviceClient();
      const expiresAt = definition.expiration_days
        ? new Date(
            Date.now() + Number(definition.expiration_days) * 86400000,
          ).toISOString()
        : null;
      const { data: pkg, error: packageError } = await service
        .from("packages")
        .insert({
          student_id: student.id,
          definition_id: definition.id,
          name: definition.name,
          price_minor: definition.price_minor,
          currency: definition.currency,
          expires_at: expiresAt,
          stripe_price_id: definition.stripe_price_id,
          credit_quantity: definition.session_count,
        })
        .select()
        .single();
      if (packageError) throw packageError;
      try {
        const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
        if (!stripeKey) throw new Error("Stripe is not configured.");
        const stripe = new Stripe(stripeKey, {
          apiVersion: "2026-07-29.dahlia",
        });
        const origin = new URL(request.url).origin;
        const checkout = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            line_items: [{ price: definition.stripe_price_id, quantity: 1 }],
            client_reference_id: `${student.id}:${pkg.id}`,
            success_url: `${origin}/portal/payments?checkout=processing`,
            cancel_url: `${origin}/portal/payments?checkout=cancelled`,
            metadata: {
              student_id: student.id,
              package_id: pkg.id,
              package_definition_id: definition.id,
              idempotency_key: input.idempotencyKey,
            },
          },
          { idempotencyKey: input.idempotencyKey },
        );
        return json({
          resource: { id: checkout.id, url: checkout.url },
          recommendations: [],
          auditEventId: null,
          queuedSideEffects: ["stripe_webhook"],
        });
      } catch (error) {
        await service.from("packages").delete().eq("id", pkg.id);
        throw error;
      }
    }
    if (domain === "finance" && input.command === "checkout") {
      const packageId = String(input.payload.packageId || "");
      const { data: pkg, error: pkgError } = await db
        .from("packages")
        .select("id,student_id,name,stripe_price_id")
        .eq("id", packageId)
        .single();
      if (pkgError || !pkg?.stripe_price_id)
        throw new Error("VALIDATION_FAILED: Package price is not configured.");
      const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("Stripe is not configured.");
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-07-29.dahlia" });
      const origin = new URL(request.url).origin;
      const checkout = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: pkg.stripe_price_id, quantity: 1 }],
        client_reference_id: `${pkg.student_id}:${pkg.id}`,
        success_url: `${origin}/portal/payments?checkout=processing`,
        cancel_url: `${origin}/portal/payments?checkout=cancelled`,
        metadata: {
          student_id: pkg.student_id,
          package_id: pkg.id,
          idempotency_key: input.idempotencyKey,
        },
      });
      return json({
        resource: { id: checkout.id, url: checkout.url },
        recommendations: [],
        auditEventId: null,
        queuedSideEffects: ["stripe_webhook"],
      });
    }
    if (
      input.command === "transition" &&
      input.entityType &&
      input.entityId &&
      input.nextStatus
    ) {
      const { data, error } = await db.rpc("command_transition", {
        entity_type: input.entityType,
        entity_id: input.entityId,
        expected_version: input.expectedVersion,
        next_status: input.nextStatus,
        reason: input.reason,
        idempotency_key: input.idempotencyKey,
        correlation_id: id,
      });
      if (error) throw error;
      return json(data);
    }
    return json(
      {
        code: "UNKNOWN_COMMAND",
        message: "Unknown command for this domain.",
        retryable: false,
        correlationId: id,
      },
      422,
    );
  } catch (error) {
    return apiError(error, id);
  }
};
export const config: Config = { path: "/api/v2/:domain" };
