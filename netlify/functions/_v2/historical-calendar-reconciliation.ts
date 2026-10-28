import { z } from "zod";
import { json } from "../_shared/http";
import type { V2CommandContext } from "./types";

const common = {
  studentId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  acknowledgeSourceDifference: z.boolean().optional(),
  acknowledgeDuplicateReview: z.boolean().optional(),
};
const proposal = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("link"),
      lessonId: z.string().uuid(),
      lessonVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("create"),
      startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }),
      timezone: z
        .string()
        .min(1)
        .max(100)
        .refine((value) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: value });
            return true;
          } catch {
            return false;
          }
        }, "Choose an explicit valid timezone."),
      topic: z.string().trim().min(1).max(300),
      locationType: z.enum(["in_person", "virtual"]),
      locationLabel: z.string().trim().min(1).max(500),
    })
    .strict()
    .refine(
      (value) => Date.parse(value.endsAt) > Date.parse(value.startsAt),
      "Choose an increasing interval.",
    ),
]);
const candidateSchema = z.object({ candidateId: z.string().uuid() }).strict();
const previewSchema = candidateSchema.extend({ proposal }).strict();
const commandSchema = previewSchema
  .extend({ stamp: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict();

export async function handleHistoricalCalendarReconciliation(
  ctx: V2CommandContext,
): Promise<Response | null> {
  if (
    ctx.domain !== "integrations" ||
    ![
      "preview_historical_calendar_reconciliation",
      "historical_calendar_reconciliation",
      "preview_historical_calendar_reopening",
      "historical_calendar_decision_history",
    ].includes(ctx.input.command)
  )
    return null;
  await ctx.requireCoach();
  if (ctx.input.command === "historical_calendar_decision_history") {
    const value = candidateSchema
      .extend({ beforeVersion: z.number().int().positive().optional() })
      .strict()
      .parse(ctx.input.payload);
    const result = await ctx.db.rpc("historical_calendar_decision_history", {
      p_candidate: value.candidateId,
      p_before_version: value.beforeVersion,
    });
    if (result.error) throw result.error;
    return json({ resource: result.data });
  }
  if (ctx.input.command === "preview_historical_calendar_reopening") {
    const value = candidateSchema.parse(ctx.input.payload);
    const result = await ctx.db.rpc("preview_historical_calendar_reopening", {
      p_candidate: value.candidateId,
    });
    if (result.error) throw result.error;
    return json({ resource: result.data, processing: "reopen_preview" });
  }
  if (ctx.input.command === "preview_historical_calendar_reconciliation") {
    const value = previewSchema.parse(ctx.input.payload);
    const result = await ctx.db.rpc(
      "preview_historical_calendar_reconciliation",
      { p_candidate: value.candidateId, p_value: value.proposal },
    );
    if (result.error) throw result.error;
    return json({ resource: result.data, processing: "preview" });
  }
  const value = commandSchema.parse(ctx.input.payload);
  const result = await ctx.db.rpc(
    "command_historical_calendar_reconciliation",
    {
      p_candidate: value.candidateId,
      p_value: value.proposal,
      p_stamp: value.stamp,
      p_key: ctx.input.idempotencyKey,
    },
  );
  if (result.error) throw result.error;
  return json(result.data);
}
