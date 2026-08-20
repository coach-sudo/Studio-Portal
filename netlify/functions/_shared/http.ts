import type { ApiErrorShape } from "../../../src/domain/model";
import { ZodError } from "zod";
export const json = (body: unknown, status = 200, headers: Record<string,string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
export const correlationId = (request: Request, fallback: string) =>
  request.headers.get("x-correlation-id") || fallback;
export function apiError(error: unknown, id: string): Response {
  console.error("[api-error]", { correlationId: id, error });
  const message = error instanceof Error ? error.message : String(error);
  const conflict = message.includes("VERSION_CONFLICT");
  const forbidden = message.includes("FORBIDDEN");
  const invalid =
    error instanceof ZodError ||
    message.includes("INVALID_TRANSITION") ||
    message.includes("RESCHEDULE_LIMIT_REACHED") ||
    message.includes("ZodError");
  const unavailable =
    message.includes("SLOT_UNAVAILABLE") || message.includes("OFFERING_FULL");
  const calendarUnavailable = message.includes("CALENDAR_UNAVAILABLE");
  const processing = message.includes("BOOKING_PROCESSING");
  const rateLimited = message.includes("RATE_LIMITED");
  const validation =
    invalid ||
    message.includes("VALIDATION_FAILED") ||
    message.includes("SERVICE_NOT_FOUND");
  const body: ApiErrorShape = {
    code: conflict
      ? "VERSION_CONFLICT"
      : processing
        ? "BOOKING_PROCESSING"
        : rateLimited
          ? "RATE_LIMITED"
          : forbidden
            ? "FORBIDDEN"
            : unavailable
              ? "SLOT_UNAVAILABLE"
              : calendarUnavailable
                ? "CALENDAR_UNAVAILABLE"
                : validation
                  ? "VALIDATION_FAILED"
                  : "INTERNAL_ERROR",
    message: conflict
      ? "This record changed since you opened it. Review the current version before trying again."
      : processing
        ? "This booking request is still processing. Check its status before retrying."
        : rateLimited
          ? "Too many booking requests were received. Wait a moment and try again."
          : forbidden
            ? "You do not have access to this action."
            : unavailable
              ? "That time is no longer available. Choose another opening."
              : calendarUnavailable
                ? "Live calendar availability cannot be verified right now."
                : message.includes("RESCHEDULE_LIMIT_REACHED")
                  ? "This booking has used its self-service reschedule allowance. Contact the studio for help."
                  : validation
                    ? "The requested booking details are not valid."
                    : "The operation could not be completed.",
    retryable:
      processing ||
      rateLimited ||
      unavailable ||
      calendarUnavailable ||
      (!forbidden && !validation && !conflict),
    conflict: conflict ? { detail: message } : undefined,
    correlationId: id,
  };
  return json(
    body,
    rateLimited
      ? 429
      : conflict || processing || unavailable
        ? 409
        : forbidden
          ? 403
          : validation
            ? 422
            : calendarUnavailable
              ? 503
              : 500,
  );
}
