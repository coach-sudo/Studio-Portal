import { json } from "../_shared/http";
import { serviceClient } from "../_shared/supabase";
import {
  studentSetupSchema,
  type SetupAction,
  type StudentSetupState,
} from "../../../src/domain/studentSetup";
import { handleStudentsCommands } from "./students";
import { handleLessonsCommands } from "./lessons";
import { handleFinanceCommands } from "./finance";
import { quotePackageDefinition } from "../_shared/package-pricing";
import type { V2CommandContext } from "./types";

export async function handleSetupCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  if (ctx.domain !== "setup") return null;
  const studioId = await ctx.requireCoach(),
    studentId = ctx.input.entityId;
  if (!studentId) throw new Error("VALIDATION_FAILED");
  const { data: auth, error: authError } = await ctx.db.auth.getUser();
  if (authError || !auth.user) throw new Error("FORBIDDEN");
  const service = serviceClient();
  const manage = async (
    command: string,
    value: Record<string, unknown> = {},
    key = ctx.input.idempotencyKey,
  ) => {
    const result = await service.rpc(
      "manage_student_setup" as never,
      {
        p_actor: auth.user!.id,
        p_student: studentId,
        p_command: command,
        p_value: value,
        p_version: ctx.input.expectedVersion,
        p_key: key,
      } as never,
    );
    if (result.error) throw result.error;
    return result.data as unknown as StudentSetupState;
  };
  if (ctx.input.command === "read")
    return json({ resource: await manage("read") });
  if (ctx.input.command === "save")
    return json({
      resource: await manage(
        "save",
        studentSetupSchema.parse(ctx.input.payload),
      ),
    });
  if (ctx.input.command === "review") {
    const current = await manage("read"),
      draft = studentSetupSchema.parse(current.draft);
    const order = {
      details: 0,
      contact: 1,
      lesson: 2,
      package: 3,
      access: 4,
      invitation: 5,
    };
    draft.actions.sort((a, b) => order[a.kind] - order[b.kind]);
    const identity = await ctx.db
      .from("students")
      .select("email,guardian_email")
      .eq("id", studentId)
      .eq("studio_id", studioId)
      .single();
    if (identity.error || !identity.data) throw new Error("FORBIDDEN");
    const proposedDetails = draft.actions.find(
      (a) =>
        a.kind === "details" && current.results[a.id]?.status !== "succeeded",
    );
    for (const action of draft.actions) {
      if (current.results[action.id]?.status === "succeeded") {
        const previous = current.review?.actions.find(
          (a) => a.id === action.id,
        );
        if (previous) Object.assign(action, previous);
        continue;
      }
      if (action.kind === "contact" && action.payload.sourceContactId) {
        const c = await ctx.db
          .from("linked_contacts")
          .select("full_name,email,version")
          .eq("id", action.payload.sourceContactId)
          .eq("studio_id", studioId)
          .single();
        if (c.error || !c.data) throw new Error("FORBIDDEN");
        Object.assign(action.payload, {
          fullName: c.data.full_name,
          email: c.data.email,
          sourceVersion: c.data.version,
        });
      }
      if (action.kind === "invitation") {
        let recipient =
          action.payload.accountType === "student"
            ? proposedDetails?.kind === "details"
              ? (proposedDetails.payload.email ?? identity.data.email)
              : identity.data.email
            : identity.data.guardian_email;
        if (action.payload.linkedContactId) {
          const c = await ctx.db
            .from("linked_contacts")
            .select("email,version")
            .eq("id", action.payload.linkedContactId)
            .eq("student_id", studentId)
            .eq("studio_id", studioId)
            .single();
          if (c.error || !c.data) throw new Error("FORBIDDEN");
          recipient = c.data.email;
          action.payload.contactVersion = c.data.version;
        } else if (action.payload.accountType === "guardian" && !recipient) {
          const guardian = draft.actions.find(
            (a) =>
              a.kind === "contact" && a.payload.relationshipType === "guardian",
          );
          if (guardian?.kind === "contact") recipient = guardian.payload.email;
        }
        if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
          throw new Error(
            "VALIDATION_FAILED: Add the invitation recipient's email before review.",
          );
        action.payload.expectedRecipient = recipient.trim().toLowerCase();
      }
      if (action.kind === "package") {
        const definition = await ctx.db
          .from("package_definitions")
          .select("*")
          .eq("id", action.payload.definitionId)
          .eq("studio_id", studioId)
          .eq("active", true)
          .single();
        if (definition.error || !definition.data)
          throw new Error("VALIDATION_FAILED: Package unavailable.");
        const quote = await quotePackageDefinition(
          service,
          definition.data,
          studentId,
        );
        action.payload.expectedPriceMinor = Number(quote.price_minor);
        action.payload.expectedCurrency = quote.currency;
        action.payload.definitionVersion = definition.data.version;
      }
    }
    return json({
      resource: await manage("review", { actions: draft.actions }),
    });
  }
  if (ctx.input.command !== "execute_action")
    throw new Error("UNKNOWN_COMMAND");
  const reviewId = String(ctx.input.payload.reviewId || ""),
    actionId = String(ctx.input.payload.actionId || "");
  const claimed = (await manage("claim", {
    reviewId,
    actionId,
  })) as unknown as {
    completed?: boolean;
    entry?: unknown;
    action: SetupAction;
    key: string;
    studentVersion: number;
  };
  if (claimed.completed)
    return json({ resource: claimed.entry, alreadyCompleted: true });
  const action = claimed.action,
    key = claimed.key;
  try {
    let response: Response | null = null;
    const nested = (
      domain: string,
      command: string,
      payload: Record<string, unknown>,
    ) => ({
      ...ctx,
      domain,
      input: {
        ...ctx.input,
        command,
        payload,
        entityId: studentId,
        expectedVersion: claimed.studentVersion,
        idempotencyKey: key,
      },
    });
    if (
      action.kind === "details" ||
      action.kind === "contact" ||
      action.kind === "access"
    ) {
      const applied = await ctx.db.rpc(
        "command_apply_setup_record" as never,
        {
          p_student: studentId,
          p_kind: action.kind,
          p_value: action.payload,
          p_version: claimed.studentVersion,
          p_key: key,
        } as never,
      );
      if (applied.error) throw applied.error;
      response = json(applied.data);
    } else if (action.kind === "lesson")
      response = await handleLessonsCommands(
        nested("lessons", "create", { ...action.payload, studentId }),
      );
    else if (action.kind === "package") {
      const check = await ctx.db
        .from("package_definitions")
        .select("version")
        .eq("id", action.payload.definitionId)
        .eq("studio_id", studioId)
        .single();
      if (
        check.error ||
        check.data.version !== action.payload.definitionVersion
      )
        throw new Error("VERSION_CONFLICT: Package changed after review.");
      response = await handleFinanceCommands(
        nested("packages", "assign", { ...action.payload, studentId }),
      );
    } else {
      const student = await ctx.db
        .from("students")
        .select("is_minor,guardian_email")
        .eq("id", studentId)
        .eq("studio_id", studioId)
        .single();
      if (student.error || !student.data) throw new Error("FORBIDDEN");
      if (
        student.data.is_minor &&
        (!action.payload.consentConfirmed || !student.data.guardian_email)
      )
        throw new Error(
          "VALIDATION_FAILED: Confirm guardian consent and add guardian contact details first.",
        );
      response = await handleStudentsCommands(
        nested("students", "invite", {
          ...action.payload,
          resetExisting: false,
        }),
      );
    }
    if (!response) throw new Error("UNKNOWN_COMMAND");
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Setup action failed.");
    await manage(
      "finish",
      { reviewId, actionId, ok: response.ok, result },
      key,
    );
    return json({ resource: result, completed: response.ok });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error
          ? String(error.message)
          : "Action failed";
    await manage(
      "finish",
      {
        reviewId,
        actionId,
        ok: false,
        uncertain: action.kind === "invitation",
        message,
      },
      key,
    );
    throw error;
  }
}
