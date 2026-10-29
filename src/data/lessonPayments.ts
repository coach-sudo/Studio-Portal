import { supabase } from "../lib/supabase";
import { studioCommand } from "./bookingCommands";
import { ApiClientError } from "./apiClientError";
import {
  lessonPaymentContextSchema,
  lessonPaymentReceiptSchema,
  lessonPaymentRequestSchema,
  type LessonPaymentContext,
  type LessonPaymentRequest,
} from "../domain/lessonPayment";
export type PaymentAttempt = {
  request: LessonPaymentRequest;
  key: string;
  context: LessonPaymentContext;
};
const pending = new Map<string, PaymentAttempt>();
const storageKey = (owner: string) => `studio.lesson-payment.${owner}`;
function recovery(owner: string): PaymentAttempt | undefined {
  const cached = pending.get(owner);
  if (cached) return cached;
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(storageKey(owner));
  } catch {
    throw new ApiClientError(
      {
        code: "VALIDATION_FAILED",
        message:
          "Payment was not sent. This tab must allow session storage to preserve its recovery key.",
        retryable: false,
      },
      422,
    );
  }
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as PaymentAttempt;
    const attempt = {
      request: lessonPaymentRequestSchema.parse(value.request),
      context: lessonPaymentContextSchema.parse(value.context),
      key: value.key,
    };
    if (
      typeof attempt.key !== "string" ||
      attempt.key.length < 8 ||
      attempt.request.lessonId !== attempt.context.lessonId ||
      !owner.endsWith(`:${attempt.request.lessonId}`)
    )
      throw Error("Invalid saved receipt identity");
    pending.set(owner, attempt);
    return attempt;
  } catch {
    throw new ApiClientError(
      {
        code: "REVIEW_REQUIRED",
        message:
          "Saved payment recovery data needs review. Check accounting before starting another payment.",
        retryable: false,
      },
      409,
    );
  }
}
function forget(owner: string) {
  pending.delete(owner);
  // A committed receipt remains success even if browser storage cleanup fails.
  // A retained envelope will only recover the same immutable database receipt.
  try {
    sessionStorage.removeItem(storageKey(owner));
  } catch {
    /* safe replay remains */
  }
}
function forgetMatchingAttempt(owner: string, key: string) {
  // Resolve no current session here: an old request may finish after an account
  // switch. Remove only its captured owner's exact still-current envelope.
  if (pending.get(owner)?.key !== key) return;
  try {
    const raw = sessionStorage.getItem(storageKey(owner));
    if (!raw || JSON.parse(raw).key !== key) return;
  } catch {
    return;
  }
  forget(owner);
}
async function identity(lessonId: string) {
  if (!supabase) throw Error("The studio database is not configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user.id)
    throw Error("Sign in as the coach to record a payment.");
  return `${data.session.user.id}:${lessonId}`;
}
export async function loadLessonPayment(lessonId: string) {
  const owner = await identity(lessonId),
    attempt = recovery(owner);
  if (attempt) return { context: attempt.context, attempt };
  const response = await studioCommand(
    "lessons",
    {
      command: "payment_context",
      entityId: lessonId,
      expectedVersion: 1,
      payload: {},
      reason: "Review the lesson payment context",
    },
    owner.split(":")[0],
  );
  return {
    context: lessonPaymentContextSchema.parse(response.resource),
    attempt: undefined,
  };
}
export async function saveLessonPayment(
  context: LessonPaymentContext,
  value: LessonPaymentRequest,
) {
  const request = lessonPaymentRequestSchema.parse(value),
    owner = await identity(request.lessonId);
  let attempt = recovery(owner);
  const wasPending = !!attempt;
  if (attempt && JSON.stringify(attempt.request) !== JSON.stringify(request))
    throw Error("Recover the pending payment before changing its request.");
  if (!attempt) {
    attempt = { request, context, key: crypto.randomUUID() };
    try {
      sessionStorage.setItem(storageKey(owner), JSON.stringify(attempt));
    } catch {
      throw new ApiClientError(
        {
          code: "VALIDATION_FAILED",
          message:
            "Payment was not sent. This tab could not preserve its recovery key. Enable session storage and retry.",
          retryable: false,
        },
        422,
      );
    }
    pending.set(owner, attempt);
  }
  try {
    const response = await studioCommand(
      "lessons",
      {
        command: "record_payment",
        entityId: request.lessonId,
        expectedVersion: request.version,
        idempotencyKey: attempt.key,
        payload: {
          reviewToken: request.reviewToken,
          amountMinor: request.amountMinor,
          currency: request.currency,
          method: request.method,
        },
        reason: request.reason,
      },
      owner.split(":")[0],
    );
    const receipt = lessonPaymentReceiptSchema.parse(response.resource);
    forgetMatchingAttempt(owner, attempt.key);
    return receipt;
  } catch (error) {
    if (
      !wasPending &&
      error instanceof ApiClientError &&
      ["VALIDATION_FAILED", "REVIEW_REQUIRED"].includes(error.code)
    )
      forgetMatchingAttempt(owner, attempt.key);
    throw error;
  }
}
