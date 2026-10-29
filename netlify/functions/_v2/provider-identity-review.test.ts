// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { handleAdministrationCommands } from "./administration";
import type { V2CommandContext } from "./types";
const f = vi.hoisted(() => ({
  rpc: vi.fn(),
  coach: vi.fn(),
  enabled: vi.fn(),
}));
vi.mock("../_shared/worker-controls", () => ({
  workerEnabled: f.enabled,
  disabledWorkerResponse: () => new Response("disabled", { status: 409 }),
}));
function ctx(payload: Record<string, unknown> = {}) {
  return {
    domain: "integrations",
    input: {
      command: "review_import",
      entityId: "synthetic-import",
      payload,
      idempotencyKey: "retained-review-key",
    },
    requireCoach: f.coach,
    db: { rpc: f.rpc },
  } as unknown as V2CommandContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  f.coach.mockResolvedValue("studio");
  f.enabled.mockReturnValue(true);
  f.rpc.mockResolvedValue({
    data: { resource: { reviewed: 1 }, queuedSideEffects: [] },
    error: null,
  });
});
it.each(["original-student", "", false, 42, {}])(
  "rejects a legacy merge instruction %j without silently discarding it",
  async (mergeStudentId) => {
    await expect(
      handleAdministrationCommands(
        ctx({
          action: "existing",
          studentId: "selected-student",
          mergeStudentId,
        }),
      ),
    ).rejects.toThrow("REVIEW_REQUIRED");
    expect(f.rpc).not.toHaveBeenCalled();
  },
);
it("authenticates before disclosing the legacy policy response", async () => {
  f.coach.mockRejectedValue(Error("FORBIDDEN"));
  await expect(
    handleAdministrationCommands(ctx({ mergeStudentId: "original-student" })),
  ).rejects.toThrow("FORBIDDEN");
  expect(f.rpc).not.toHaveBeenCalled();
});
it("keeps disabled intake disabled for ordinary review", async () => {
  f.enabled.mockReturnValue(false);
  const response = await handleAdministrationCommands(
    ctx({ action: "existing", studentId: "original-student" }),
  );
  expect(response!.status).toBe(409);
  expect(f.rpc).not.toHaveBeenCalled();
});
it("passes ordinary explicit identity review unchanged to the authenticated transaction", async () => {
  const payload = {
    action: "existing",
    studentId: "original-student",
    note: "Coach verified source identity",
  };
  const response = await handleAdministrationCommands(ctx(payload));
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    "command_review_provider_import",
    {
      p_import: "synthetic-import",
      p_payload: payload,
      p_key: "retained-review-key",
    },
  );
  expect(await response!.json()).toMatchObject({ resource: { reviewed: 1 } });
});
it("preserves database review holds instead of reporting success", async () => {
  f.rpc.mockResolvedValue({
    data: null,
    error: Error("REVIEW_REQUIRED: original lesson identity"),
  });
  await expect(
    handleAdministrationCommands(
      ctx({ action: "existing", studentId: "original-student" }),
    ),
  ).rejects.toThrow("REVIEW_REQUIRED");
});
