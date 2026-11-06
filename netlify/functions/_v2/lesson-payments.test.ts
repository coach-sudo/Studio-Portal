// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { handleLessonPaymentCommands } from "./lesson-payments";
import type { V2CommandContext } from "./types";
const rpc = vi.fn();
const lessonId = "e2920000-0000-4000-8000-000000000011";
const context = (command: string, payload: Record<string, unknown> = {}) =>
  ({
    domain: "lessons",
    input: {
      command,
      entityId: lessonId,
      expectedVersion: 1,
      idempotencyKey: "e2e-cash-payment",
      reason: "Cash received in studio",
      payload,
    },
    db: { rpc },
    id: "synthetic",
  }) as unknown as V2CommandContext;
beforeEach(() =>
  rpc.mockReset().mockResolvedValue({ data: { saved: true }, error: null }),
);
it("reads the exact lesson using the caller JWT database client", async () => {
  expect(
    (await handleLessonPaymentCommands(context("payment_context")))?.status,
  ).toBe(200);
  expect(rpc).toHaveBeenCalledWith("lesson_payment_context", {
    p_lesson: lessonId,
  });
});
it("delegates the full stable identity and checked receipt command", async () => {
  await handleLessonPaymentCommands(
    context("record_payment", {
      reviewToken: "a".repeat(64),
      amountMinor: 1200,
      currency: "USD",
      method: "cash",
    }),
  );
  expect(rpc).toHaveBeenCalledWith("record_lesson_payment", {
    p_key: "e2e-cash-payment",
    p_value: {
      lessonId,
      version: 1,
      reviewToken: "a".repeat(64),
      amountMinor: 1200,
      currency: "USD",
      method: "cash",
      reason: "Cash received in studio",
    },
  });
});
it("never falls through to the old fragmented financial write", async () => {
  await expect(
    handleLessonPaymentCommands(
      context("set_payment_status", { paymentStatus: "paid", paidMinor: 6000 }),
    ),
  ).rejects.toMatchObject({ code: "REVIEW_REQUIRED", status: 409 });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("lesson_payment_context", {
    p_lesson: lessonId,
  });
});
it.each(["priceMinor", "paidMinor", "paymentStatus", "studentId"])(
  "rejects unexpected financial authority %s",
  async (field) => {
    await expect(
      handleLessonPaymentCommands(
        context("record_payment", {
          reviewToken: "a".repeat(64),
          amountMinor: 1200,
          currency: "USD",
          method: "cash",
          [field]: "synthetic",
        }),
      ),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  },
);
it.each(["FORBIDDEN", "SYNTHETIC_LEDGER_FAILURE", "IDEMPOTENCY_CONFLICT"])(
  "propagates %s without a success body",
  async (message) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(
      handleLessonPaymentCommands(
        context("record_payment", {
          reviewToken: "a".repeat(64),
          amountMinor: 1200,
          currency: "USD",
          method: "bank",
        }),
      ),
    ).rejects.toMatchObject({ message });
  },
);
