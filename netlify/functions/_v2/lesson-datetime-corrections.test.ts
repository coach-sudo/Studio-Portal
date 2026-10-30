// @vitest-environment node
import { expect, it, vi } from "vitest";
import { handleLessonDatetimeCorrections } from "./lesson-datetime-corrections";
import type { V2CommandContext } from "./types";
function context(command: string) {
  return {
    domain: "lessons",
    id: "synthetic-correction",
    input: {
      command,
      entityId: "synthetic-lesson",
      expectedVersion: 4,
      idempotencyKey: "synthetic-stable-key",
      reason: "Correct original record",
      payload: {
        lessonId: "forged",
        version: 99,
        startsAt: "2020-01-01T10:00:00Z",
        endsAt: "2020-01-01T11:00:00Z",
        timezone: "UTC",
      },
    },
    requireCoach: vi.fn().mockResolvedValue("synthetic-studio"),
    db: {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: { corrected: true }, error: null }),
    },
  } as unknown as V2CommandContext;
}
it.each([
  ["preview_datetime_correction", "preview_lesson_datetime_correction"],
  ["correct_datetime", "correct_lesson_datetime"],
  ["datetime_correction_history", "lesson_datetime_correction_history"],
  ["review_datetime_correction", "record_datetime_correction_review"],
])("routes %s through coach JWT database authority", async (command, rpc) => {
  const ctx = context(command);
  const response = await handleLessonDatetimeCorrections(ctx);
  expect(ctx.requireCoach).toHaveBeenCalledOnce();
  expect(ctx.db.rpc).toHaveBeenCalledWith(rpc, expect.any(Object));
  expect(await response?.json()).toMatchObject({
    resource: { corrected: true },
    queuedSideEffects: [],
  });
  if (command === "correct_datetime")
    expect(ctx.db.rpc).toHaveBeenCalledWith(rpc, {
      p_key: "synthetic-stable-key",
      p_value: expect.objectContaining({
        lessonId: "synthetic-lesson",
        version: 4,
        reason: "Correct original record",
      }),
    });
});
it("rejects a non-coach before any RPC even if the payload claims authority", async () => {
  const ctx = context("correct_datetime");
  vi.mocked(ctx.requireCoach).mockRejectedValue(new Error("FORBIDDEN"));
  await expect(handleLessonDatetimeCorrections(ctx)).rejects.toThrow(
    "FORBIDDEN",
  );
  expect(ctx.db.rpc).not.toHaveBeenCalled();
});
it("never reports a failed SQL transaction as successful", async () => {
  const ctx = context("correct_datetime");
  vi.mocked(ctx.db.rpc).mockResolvedValue({
    data: null,
    error: { message: "Synthetic late audit failure" },
  } as never);
  await expect(handleLessonDatetimeCorrections(ctx)).rejects.toMatchObject({
    message: "Synthetic late audit failure",
  });
});
