import { z } from "zod";
import { json } from "../_shared/http";
import type { V2CommandContext } from "./types";

const candidateSchema = z.object({ candidateId: z.string().uuid() }).strict();
const decisionSchema = candidateSchema
  .extend({
    stamp: z.string().regex(/^[0-9a-f]{64}$/),
    action: z.enum(["not_lesson", "skip", "reopen"]),
    reason: z.string().trim().min(3).max(500),
    legacyImportId: z.string().uuid().optional(),
    legacyUpdatedAt: z.string().datetime({ offset: true }).optional(),
    acknowledgeUnscoped: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasLegacy = value.legacyImportId !== undefined;
    if (
      (hasLegacy && (value.action !== "reopen" || !value.legacyUpdatedAt)) ||
      (!hasLegacy &&
        (value.legacyUpdatedAt !== undefined ||
          value.acknowledgeUnscoped !== undefined))
    )
      ctx.addIssue({
        code: "custom",
        message: "Reopen one exact ignored signal from its preview.",
      });
  });

export async function handleHistoricalCalendarReview(
  ctx: V2CommandContext,
): Promise<Response | null> {
  if (
    ctx.domain !== "integrations" ||
    ![
      "preview_historical_calendar_review",
      "historical_calendar_review",
    ].includes(ctx.input.command)
  )
    return null;
  await ctx.requireCoach();
  // Use only the authenticated JWT. This command has no service/provider client,
  // worker flag, credential read or external side effect.
  if (ctx.input.command === "preview_historical_calendar_review") {
    const value = candidateSchema.parse(ctx.input.payload);
    const result = await ctx.db.rpc("preview_historical_calendar_review", {
      p_candidate: value.candidateId,
    });
    if (result.error) throw result.error;
    return json({ resource: result.data });
  }
  const { candidateId, ...value } = decisionSchema.parse(ctx.input.payload);
  const result = await ctx.db.rpc("command_historical_calendar_review", {
    p_candidate: candidateId,
    p_payload: value,
    p_key: ctx.input.idempotencyKey,
  });
  if (result.error) throw result.error;
  return json(result.data);
}
