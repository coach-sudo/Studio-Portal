import type { ApiErrorShape } from "../../../src/domain/model";
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const correlationId = (request: Request, fallback: string) => request.headers.get("x-correlation-id") || fallback;
export function apiError(error: unknown, id: string): Response {
  const message = error instanceof Error ? error.message : String(error);
  const conflict = message.includes("VERSION_CONFLICT");
  const forbidden = message.includes("FORBIDDEN");
  const invalid = message.includes("INVALID_TRANSITION") || message.includes("ZodError");
  const body: ApiErrorShape = { code: conflict ? "VERSION_CONFLICT" : forbidden ? "FORBIDDEN" : invalid ? "VALIDATION_FAILED" : "INTERNAL_ERROR", message: conflict ? "This record changed since you opened it. Review the current version before trying again." : forbidden ? "You do not have access to this action." : invalid ? "The requested state change is not valid." : "The operation could not be completed.", retryable: !forbidden && !invalid && !conflict, conflict: conflict ? { detail: message } : undefined, correlationId: id };
  return json(body, conflict ? 409 : forbidden ? 403 : invalid ? 422 : 500);
}
