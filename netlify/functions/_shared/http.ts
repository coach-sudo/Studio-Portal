import { ZodError } from "zod";
import type { ApiErrorShape } from "../../../src/domain/model";

export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });

export const correlationId = (request: Request, fallback: string) =>
  request.headers.get("x-correlation-id") || fallback;

export type AppErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "BOOKING_CAPACITY"
  | "SLOT_UNAVAILABLE"
  | "BOOKING_PROCESSING"
  | "RATE_LIMITED"
  | "PAYMENT_FAILED"
  | "PROVIDER_UNAVAILABLE"
  | "CALENDAR_UNAVAILABLE"
  | "METHOD_NOT_ALLOWED"
  | "UNKNOWN_COMMAND"
  | "INTERNAL_ERROR";

export interface AppErrorOptions {
  status: number;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: AppErrorCode, options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }

  static forbidden(cause?: unknown) {
    return new AppError("FORBIDDEN", {
      status: 403,
      message: "You do not have access to this action.",
      cause,
    });
  }

  static validation(details?: Record<string, unknown>, cause?: unknown) {
    return new AppError("VALIDATION_FAILED", {
      status: 422,
      message: "The requested details are not valid.",
      details,
      cause,
    });
  }
}

const includesAny = (message: string, values: string[]) =>
  values.some((value) => message.includes(value));

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError)
    return AppError.validation(
      { fieldErrors: error.flatten().fieldErrors },
      error,
    );

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("VERSION_CONFLICT")) {
    const expectedVersion = Number(message.split(":")[1]);
    return new AppError("VERSION_CONFLICT", {
      status: 409,
      message:
        "This record changed since you opened it. Review the current version before trying again.",
      details: Number.isSafeInteger(expectedVersion)
        ? { expectedVersion }
        : undefined,
      cause: error,
    });
  }
  if (message.includes("BOOKING_PROCESSING"))
    return new AppError("BOOKING_PROCESSING", {
      status: 409,
      message:
        "This booking request is still processing. Check its status before retrying.",
      retryable: true,
      cause: error,
    });
  if (message.includes("RATE_LIMITED"))
    return new AppError("RATE_LIMITED", {
      status: 429,
      message:
        "Too many booking requests were received. Wait a moment and try again.",
      retryable: true,
      cause: error,
    });
  if (message.includes("FORBIDDEN")) return AppError.forbidden(error);
  if (message.includes("AUTHENTICATION_REQUIRED"))
    return new AppError("AUTHENTICATION_REQUIRED", {
      status: 401,
      message: "Sign in to continue.",
      cause: error,
    });
  if (message.includes("OFFERING_FULL"))
    return new AppError("BOOKING_CAPACITY", {
      status: 409,
      message: "That offering no longer has available capacity.",
      cause: error,
    });
  if (includesAny(message, ["SLOT_UNAVAILABLE", "CALENDAR_CONFLICT"]))
    return new AppError("SLOT_UNAVAILABLE", {
      status: 409,
      message: "That time is no longer available. Choose another opening.",
      retryable: true,
      cause: error,
    });
  if (message.includes("CALENDAR_UNAVAILABLE"))
    return new AppError("CALENDAR_UNAVAILABLE", {
      status: 503,
      message: "Live calendar availability cannot be verified right now.",
      retryable: true,
      cause: error,
    });
  if (
    includesAny(message, [
      "INVALID_TRANSITION",
      "RESCHEDULE_LIMIT_REACHED",
      "VALIDATION_FAILED",
      "SERVICE_NOT_FOUND",
      "ZodError",
    ])
  )
    return new AppError("VALIDATION_FAILED", {
      status: 422,
      message: message.includes("RESCHEDULE_LIMIT_REACHED")
        ? "This booking has used its self-service reschedule allowance. Contact the studio for help."
        : "The requested details are not valid.",
      cause: error,
    });
  if (message.includes("NOT_FOUND"))
    return new AppError("NOT_FOUND", {
      status: 404,
      message: "The requested resource was not found.",
      cause: error,
    });
  if (includesAny(message, ["Stripe", "PAYMENT_FAILED"]))
    return new AppError("PAYMENT_FAILED", {
      status: 502,
      message: "The payment provider could not complete this request.",
      retryable: true,
      cause: error,
    });
  if (
    includesAny(message, [
      "Supabase is not configured",
      "Supabase service role is not configured",
      "PROVIDER_UNAVAILABLE",
    ])
  )
    return new AppError("PROVIDER_UNAVAILABLE", {
      status: 503,
      message: "A required service is temporarily unavailable.",
      retryable: true,
      cause: error,
    });
  return new AppError("INTERNAL_ERROR", {
    status: 500,
    message: "The operation could not be completed.",
    retryable: true,
    cause: error,
  });
}

export function apiError(error: unknown, id: string): Response {
  const appError = toAppError(error);
  console.error("[api-error]", {
    correlationId: id,
    code: appError.code,
    status: appError.status,
    error,
  });
  const body: ApiErrorShape = {
    code: appError.code,
    message: appError.message,
    retryable: appError.retryable,
    correlationId: id,
    details: appError.details,
  };
  return json(body, appError.status);
}
