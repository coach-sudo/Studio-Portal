import { lessonPaymentRequestSchema } from "../../../src/domain/lessonPayment";
import { AppError, json } from "../_shared/http";
import type { V2CommandContext } from "./types";
export async function handleLessonPaymentCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  const { domain, input, db } = ctx;
  if (
    domain !== "lessons" ||
    !input.entityId ||
    !["payment_context", "record_payment", "set_payment_status"].includes(
      input.command,
    )
  )
    return null;
  // The caller's JWT enters the database; the RPC authorizes the actual actor
  // against this exact lesson's studio, including receipt recovery.
  if (input.command !== "record_payment") {
    const result = await db.rpc("lesson_payment_context", {
      p_lesson: input.entityId,
    });
    if (result.error) throw result.error;
    if (input.command === "set_payment_status")
      throw new AppError("REVIEW_REQUIRED", {
        status: 409,
        message:
          "Use Record payment or the linked invoice. Status edits cannot reprice, refund, waive or invent a payment.",
      });
    return json({ resource: result.data, queuedSideEffects: [] });
  }
  const value = lessonPaymentRequestSchema.parse({
    ...input.payload,
    lessonId: input.entityId,
    version: input.expectedVersion,
    reason: input.reason,
  });
  const result = await db.rpc("record_lesson_payment", {
    p_value: value,
    p_key: input.idempotencyKey,
  });
  if (result.error) throw result.error;
  return json({ resource: result.data, queuedSideEffects: [] });
}
