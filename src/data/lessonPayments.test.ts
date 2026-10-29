import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ session: vi.fn(), command: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession: f.session } },
}));
vi.mock("./bookingCommands", () => ({ studioCommand: f.command }));
import {
  clearLessonPaymentAttempt,
  loadLessonPayment,
  saveLessonPayment,
} from "./lessonPayments";
import { ApiClientError } from "./apiClientError";
const lessonId = "e2930000-0000-4000-8000-000000000011";
const context = {
  lessonId,
  version: 1,
  studentId: "e2930000-0000-4000-8000-000000000012",
  participantId: null,
  bookingId: null,
  bookingVersion: null,
  currency: "USD",
  priceMinor: 6000,
  paidMinor: 0,
  remainingMinor: 6000,
  eligible: true,
  reasonCode: null,
  reviewToken: "a".repeat(64),
};
const value = {
  lessonId,
  version: 1,
  reviewToken: context.reviewToken,
  amountMinor: 1000,
  currency: "USD",
  method: "cash" as const,
  reason: "Cash already received",
};
const receipt = {
  receiptId: "e2930000-0000-4000-8000-000000000021",
  paymentEntryId: "e2930000-0000-4000-8000-000000000022",
  auditEventId: "e2930000-0000-4000-8000-000000000023",
  lessonId,
  studentId: context.studentId,
  bookingId: null,
  version: 2,
  amountMinor: 1000,
  paidMinor: 1000,
  remainingMinor: 5000,
  currency: "USD",
  queuedSideEffects: [],
};
beforeEach(async () => {
  sessionStorage.clear();
  f.session.mockReset().mockResolvedValue({
    data: { session: { user: { id: "actor-a" } } },
    error: null,
  });
  f.command.mockReset();
  await clearLessonPaymentAttempt(lessonId);
});
afterEach(() => vi.restoreAllMocks());
it("retains the same key and sealed request after an unknown committed response", async () => {
  f.command
    .mockRejectedValueOnce(Error("Synthetic lost response"))
    .mockResolvedValueOnce({ resource: receipt });
  await expect(saveLessonPayment(context, value)).rejects.toThrow(
    "lost response",
  );
  expect((await loadLessonPayment(lessonId)).attempt?.request).toEqual(value);
  await expect(saveLessonPayment(context, value)).resolves.toEqual(receipt);
  expect(f.command.mock.calls[1]).toEqual(f.command.mock.calls[0]);
  expect(f.command.mock.calls[0][1].idempotencyKey).toBeTruthy();
});
it("does not replace an unresolved payment with a changed amount", async () => {
  f.command.mockRejectedValueOnce(Error("Unknown outcome"));
  await expect(saveLessonPayment(context, value)).rejects.toThrow();
  await expect(
    saveLessonPayment(context, { ...value, amountMinor: 2000 }),
  ).rejects.toThrow(/Recover the pending payment/);
  expect(f.command).toHaveBeenCalledOnce();
});
it("keeps the original key across a lost response, revoked coach access and restored access", async () => {
  f.command
    .mockRejectedValueOnce(Error("Synthetic committed response lost"))
    .mockRejectedValueOnce(
      new ApiClientError(
        { code: "FORBIDDEN", message: "Coach revoked", retryable: false },
        403,
      ),
    )
    .mockResolvedValueOnce({ resource: receipt });
  await expect(saveLessonPayment(context, value)).rejects.toThrow(
    /response lost/,
  );
  const key = f.command.mock.calls[0][1].idempotencyKey;
  await expect(saveLessonPayment(context, value)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect((await loadLessonPayment(lessonId)).attempt?.key).toBe(key);
  await expect(saveLessonPayment(context, value)).resolves.toEqual(receipt);
  expect(f.command.mock.calls.map((call) => call[1].idempotencyKey)).toEqual([
    key,
    key,
    key,
  ]);
});
it.each(["IDEMPOTENCY_CONFLICT", "VERSION_CONFLICT"])(
  "retains stored pending identity on %s and refuses a fresh changed request",
  async (code) => {
    f.command.mockRejectedValueOnce(
      new ApiClientError(
        { code, message: "Key conflict", retryable: false },
        409,
      ),
    );
    await expect(saveLessonPayment(context, value)).rejects.toMatchObject({
      code,
    });
    const key = f.command.mock.calls[0][1].idempotencyKey;
    expect((await loadLessonPayment(lessonId)).attempt?.key).toBe(key);
    expect(
      JSON.parse(
        sessionStorage.getItem(`studio.lesson-payment.actor-a:${lessonId}`)!,
      ).key,
    ).toBe(key);
    await expect(
      saveLessonPayment(context, { ...value, amountMinor: 2000 }),
    ).rejects.toThrow(/Recover the pending payment/);
    expect(f.command).toHaveBeenCalledOnce();
  },
);
it("never hydrates another actor's pending request", async () => {
  f.command.mockRejectedValueOnce(Error("Unknown outcome"));
  await expect(saveLessonPayment(context, value)).rejects.toThrow();
  f.session.mockResolvedValue({
    data: { session: { user: { id: "actor-b" } } },
    error: null,
  });
  f.command.mockResolvedValue({ resource: context });
  expect((await loadLessonPayment(lessonId)).attempt).toBeUndefined();
  expect(f.command.mock.calls.at(-1)?.[1].command).toBe("payment_context");
});
it("retains recovery across token refresh for the same actual actor", async () => {
  f.command.mockRejectedValueOnce(Error("Unknown outcome"));
  await expect(saveLessonPayment(context, value)).rejects.toThrow();
  f.session.mockResolvedValue({
    data: {
      session: {
        user: { id: "actor-a" },
        access_token: "synthetic-new-session-token",
      },
    },
    error: null,
  });
  expect((await loadLessonPayment(lessonId)).attempt?.request).toEqual(value);
  expect(f.command).toHaveBeenCalledOnce();
});
it("rejects unverified actor state before recording or reading pending money", async () => {
  f.session.mockResolvedValue({ data: { session: null }, error: null });
  await expect(loadLessonPayment(lessonId)).rejects.toThrow(/Sign in/);
  expect(f.command).not.toHaveBeenCalled();
});
it("recovers a reload from actor-scoped session storage using the original key", async () => {
  f.command.mockRejectedValueOnce(Error("Unknown committed response"));
  await expect(saveLessonPayment(context, value)).rejects.toThrow();
  const original = f.command.mock.calls[0][1].idempotencyKey;
  vi.resetModules();
  const reloaded = await import("./lessonPayments");
  const loaded = await reloaded.loadLessonPayment(lessonId);
  expect(loaded.attempt?.key).toBe(original);
  f.command.mockResolvedValue({ resource: receipt });
  await reloaded.saveLessonPayment(loaded.context, loaded.attempt!.request);
  expect(f.command.mock.calls.at(-1)?.[1].idempotencyKey).toBe(original);
  expect(
    sessionStorage.getItem(`studio.lesson-payment.actor-a:${lessonId}`),
  ).toBeNull();
});
it("does not send a payment if the browser cannot preserve recovery identity", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("Storage unavailable");
  });
  await expect(saveLessonPayment(context, value)).rejects.toMatchObject({
    code: "VALIDATION_FAILED",
    message: expect.stringMatching(/Payment was not sent/),
  });
  expect(f.command).not.toHaveBeenCalled();
});
