import { json } from "../_shared/http";
import type { Json } from "../../../src/types/database.generated";
import type { V2CommandContext } from "./types";

export async function handleLessonDatetimeCorrections(
  ctx: V2CommandContext,
): Promise<Response | null> {
  const { domain, input, db } = ctx;
  if (
    domain !== "lessons" ||
    !input.entityId ||
    ![
      "preview_datetime_correction",
      "correct_datetime",
      "datetime_correction_history",
      "review_datetime_correction",
    ].includes(input.command)
  )
    return null;
  await ctx.requireCoach();
  const value = {
    ...input.payload,
    lessonId: input.entityId,
    version: input.expectedVersion,
    lessonVersion: input.expectedVersion,
    reason: input.reason,
  } as Json;
  const result =
    input.command === "preview_datetime_correction"
      ? await db.rpc("preview_lesson_datetime_correction", { p_value: value })
      : input.command === "correct_datetime"
        ? await db.rpc("correct_lesson_datetime", {
            p_value: value,
            p_key: input.idempotencyKey,
          })
        : input.command === "datetime_correction_history"
          ? await db.rpc("lesson_datetime_correction_history", {
              p_lesson: input.entityId,
              p_cursor: (input.payload.cursor as Json) ?? undefined,
            })
          : await db.rpc("record_datetime_correction_review", {
              p_value: value,
              p_key: input.idempotencyKey,
            });
  if (result.error?.code === "23P01") throw new Error("SLOT_UNAVAILABLE");
  if (result.error) throw result.error;
  return json({
    resource: result.data,
    queuedSideEffects: [],
    correlationId: ctx.id,
  });
}
