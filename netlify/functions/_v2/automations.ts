import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../../src/types/database.generated";
import { z } from "zod";
import { automationConfigSchema } from "../_shared/automation-config";
import { evaluateAndQueueRule } from "../_shared/automation-engine";
import {
  checkOutboxEligibility,
  suppressOutbox,
} from "../_shared/outbox-eligibility";
import { AppError, json } from "../_shared/http";
import { serviceClient } from "../_shared/supabase";
import type { V2CommandContext } from "./types";

export async function handleAutomationCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  if (ctx.domain !== "automations") return null;
  if (!ctx.input.entityId)
    throw AppError.validation({ entityId: "An entity ID is required." });
  const studioId = await ctx.requireCoach(),
    client = serviceClient(),
    db = client as SupabaseClient<Database>;
  if (ctx.input.command === "save_rule") {
    const value = automationConfigSchema.parse(ctx.input.payload);
    const before = await db
      .from("automation_rules")
      .select("*")
      .eq("id", ctx.input.entityId!)
      .eq("studio_id", studioId)
      .single();
    if (before.error) throw AppError.forbidden(before.error);
    const result = await db
      .from("automation_rules")
      .update({
        ...value,
        timing: value.timing as Json,
        escalation: value.escalation as Json,
        template: value.template as Json,
        version: ctx.input.expectedVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", before.data.id)
      .eq("version", ctx.input.expectedVersion)
      .select()
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data)
      throw new AppError("VERSION_CONFLICT", {
        status: 409,
        message: "The rule changed. Refresh and try again.",
      });
    if (!value.enabled || value.mode === "off") {
      const suppressed = await db
        .from("outbox_messages")
        .update({
          status: "cancelled",
          suppression_reason: "rule_off",
          updated_at: new Date().toISOString(),
        })
        .eq("studio_id", studioId)
        .eq("automation_rule_id", result.data.id)
        .in("status", ["draft", "approved", "queued", "failed"]);
      if (suppressed.error) throw suppressed.error;
    }
    return json({
      resource: result.data,
      auditEventId: await ctx.audit(
        studioId,
        "automation_rule",
        result.data.id,
        "automation.rule_saved",
        before.data,
        result.data,
      ),
      recommendations: [],
      queuedSideEffects: [],
    });
  }
  if (["test_rule", "run_rule"].includes(ctx.input.command)) {
    const value = z
      .object({
        studentId: z.string().uuid().optional(),
        entityId: z.string().uuid(),
      })
      .strict()
      .parse(ctx.input.payload);
    const rule = await db
      .from("automation_rules")
      .select("*")
      .eq("id", ctx.input.entityId!)
      .eq("studio_id", studioId)
      .single();
    if (rule.error) throw AppError.forbidden(rule.error);
    if (rule.data.version !== ctx.input.expectedVersion)
      throw new AppError("VERSION_CONFLICT", {
        status: 409,
        message: "The rule changed. Refresh before evaluating it.",
      });
    const result = await evaluateAndQueueRule(
      client,
      rule.data,
      value.entityId,
      value.studentId,
      ctx.id,
      ctx.input.command === "test_rule",
    );
    return json({
      resource: result,
      recommendations: [],
      queuedSideEffects:
        ctx.input.command === "test_rule" ? [] : ["outbox_worker"],
    });
  }
  if (
    ["cancel_message", "send_now", "retry_message"].includes(ctx.input.command)
  ) {
    const result = await db
      .from("outbox_messages")
      .select("*")
      .eq("id", ctx.input.entityId!)
      .eq("studio_id", studioId)
      .single();
    if (result.error) throw AppError.forbidden(result.error);
    const message = result.data;
    if (message.version !== ctx.input.expectedVersion)
      throw new AppError("VERSION_CONFLICT", {
        status: 409,
        message: "The message changed. Refresh before continuing.",
      });
    if (!["queued", "failed", "draft", "approved"].includes(message.status))
      throw AppError.validation({
        message: "This message cannot be changed after delivery has started.",
      });
    if (ctx.input.command === "cancel_message")
      await suppressOutbox(client, message, "coach_cancelled");
    else {
      const eligible = await checkOutboxEligibility(client, message);
      if (!eligible.allowed) {
        await suppressOutbox(client, message, eligible.reason);
        throw new AppError("VALIDATION_FAILED", {
          status: 422,
          message: "The message is no longer appropriate and was suppressed.",
          details: { reason: eligible.reason },
        });
      }
      const updated = await db
        .from("outbox_messages")
        .update({
          status: "queued",
          send_at: new Date().toISOString(),
          next_attempt_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
          version: message.version + 1,
        })
        .eq("id", message.id)
        .eq("version", message.version)
        .in("status", ["queued", "failed", "draft", "approved"]);
      if (updated.error) throw updated.error;
    }
    return json({
      resource: { id: message.id },
      auditEventId: await ctx.audit(
        studioId,
        "outbox_message",
        message.id,
        `outbox.${ctx.input.command}`,
        { status: message.status },
        { command: ctx.input.command },
      ),
      recommendations: [],
      queuedSideEffects: ["outbox_worker"],
    });
  }
  return null;
}
