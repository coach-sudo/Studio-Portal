import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, AppError, toAppError } from "./http";

afterEach(() => vi.restoreAllMocks());

describe("structured API errors", () => {
  it.each([
    ["FORBIDDEN", "FORBIDDEN", 403, false],
    ["VERSION_CONFLICT:7", "VERSION_CONFLICT", 409, false],
    ["OFFERING_FULL", "BOOKING_CAPACITY", 409, false],
    ["SLOT_UNAVAILABLE", "SLOT_UNAVAILABLE", 409, true],
    ["Stripe is not configured.", "PAYMENT_FAILED", 502, true],
  ] as const)(
    "maps the legacy %s signal to a stable contract",
    (message, code, status, retryable) => {
      const error = toAppError(new Error(message));
      expect(error).toMatchObject({ code, status, retryable });
    },
  );

  it("returns only safe fields while logging the internal cause with correlation", async () => {
    const logging = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const response = apiError(
      new Error("database password and provider payload must stay internal"),
      "correlation-test",
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: "INTERNAL_ERROR",
      message: "The operation could not be completed.",
      retryable: true,
      correlationId: "correlation-test",
    });
    expect(logging).toHaveBeenCalledWith(
      "[api-error]",
      expect.objectContaining({
        correlationId: "correlation-test",
        error: expect.any(Error),
      }),
    );
  });

  it("preserves explicitly safe details from AppError", async () => {
    const logging = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const response = apiError(
      new AppError("VALIDATION_FAILED", {
        status: 422,
        message: "Check the highlighted fields.",
        details: { fields: ["email"] },
      }),
      "correlation-safe",
    );
    expect(await response.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fields: ["email"] },
    });
    expect(logging).toHaveBeenCalledOnce();
  });
});
