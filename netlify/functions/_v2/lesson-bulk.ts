import { json } from "../_shared/http";
import { serviceClient } from "../_shared/supabase";
import type { V2CommandContext } from "./types";

export async function handleLessonBulkCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  const { input } = ctx;
  if (
    ctx.domain !== "lessons" ||
    ![
      "preview_bulk",
      "execute_bulk",
      "retry_bulk",
      "bulk_progress",
      "bulk_candidates",
      "record_history",
    ].includes(input.command)
  )
    return null;
  const studioId = await ctx.requireCoach();
  const actor = await ctx.db.auth.getUser();
  if (actor.error || !actor.data.user) throw new Error("FORBIDDEN");
  const db = serviceClient(),
    actorId = actor.data.user.id;
  const payload = input.payload;
  let result;
  switch (input.command) {
    case "preview_bulk":
      result = await db.rpc("preview_lesson_bulk", {
        p_actor: actorId,
        p_studio: studioId,
        p_key: input.idempotencyKey,
        p_value: { ...payload, reason: input.reason },
      });
      break;
    case "execute_bulk":
    case "retry_bulk":
      result = await db.rpc(
        input.command === "execute_bulk"
          ? "execute_lesson_bulk"
          : "retry_lesson_bulk",
        {
          p_actor: actorId,
          p_job: String(payload.jobId),
          p_token: String(payload.reviewToken),
          p_key: input.idempotencyKey,
        },
      );
      break;
    case "bulk_candidates":
      result = await db.rpc("lesson_bulk_candidates", {
        p_actor: actorId,
        p_studio: studioId,
        p_filter: payload.filter as Record<string, never>,
        p_offset: Number(payload.offset),
        p_limit: Number(payload.limit),
      });
      break;
    case "record_history":
      result = await db.rpc("lesson_record_history", {
        p_actor: actorId,
        p_studio: studioId,
        p_lesson: String(payload.lessonId),
      });
      break;
    default:
      result = await db.rpc("lesson_bulk_progress", {
        p_actor: actorId,
        p_job: String(payload.jobId),
        p_offset: Number(payload.offset),
        p_limit: Number(payload.limit),
      });
  }
  if (result.error) throw result.error;
  return json({
    resource: result.data,
    correlationId: ctx.id,
    queuedSideEffects: ["execute_bulk", "retry_bulk"].includes(input.command)
      ? ["lesson_bulk_job"]
      : [],
  });
}
