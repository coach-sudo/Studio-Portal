// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { handleStudentIdentity } from "./student-identity";
import type { V2CommandContext } from "./types";
const f = vi.hoisted(() => ({ rpc: vi.fn(), coach: vi.fn() }));
const currentStudentId = "e8700000-0000-4000-8000-000000000010",
  duplicateStudentId = "e8700000-0000-4000-8000-000000000011";
const proposal = {
  action: "group",
  currentStudentId,
  duplicateStudentId,
  reason: "Coach reviewed duplicate profiles",
};
function ctx(
  command = "identity_change",
  payload: unknown = { proposal, stamp: "a".repeat(64) },
) {
  return {
    domain: "students",
    input: { command, payload, idempotencyKey: "synthetic-identity-key" },
    requireCoach: f.coach,
    db: { rpc: f.rpc },
  } as unknown as V2CommandContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  f.coach.mockResolvedValue("studio");
  f.rpc.mockResolvedValue({
    data: { resource: { profilesDeleted: false }, queuedSideEffects: [] },
    error: null,
  });
});
it("passes the exact reviewed proposal, stamp and durable key to the authenticated transaction", async () => {
  const response = await handleStudentIdentity(ctx());
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    "command_student_identity_change",
    {
      p_value: proposal,
      p_stamp: "a".repeat(64),
      p_key: "synthetic-identity-key",
    },
  );
  expect(await response!.json()).toMatchObject({
    resource: { profilesDeleted: false },
    queuedSideEffects: [],
  });
});
it("keeps preview distinct from execution", async () => {
  const response = await handleStudentIdentity(
    ctx("preview_identity_change", { proposal }),
  );
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
    "preview_student_identity_change",
    { p_value: proposal },
  );
  expect(await response!.json()).toMatchObject({ processing: "preview" });
});
it("legacy merge requests stop before any database mutation", async () => {
  await expect(
    handleStudentIdentity(
      ctx("merge", { removeStudentId: duplicateStudentId }),
    ),
  ).rejects.toThrow("REVIEW_REQUIRED");
  expect(f.rpc).not.toHaveBeenCalled();
});
it("authorization precedes even the legacy policy response", async () => {
  f.coach.mockRejectedValue(Error("FORBIDDEN"));
  await expect(handleStudentIdentity(ctx("merge"))).rejects.toThrow(
    "FORBIDDEN",
  );
  expect(f.rpc).not.toHaveBeenCalled();
});
it("read cursor preserves the exact original profile identity", async () => {
  await handleStudentIdentity(
    ctx("identity_group", {
      studentId: duplicateStudentId,
      afterStudent: currentStudentId,
    }),
  );
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith("student_identity_group", {
    p_student: duplicateStudentId,
    p_after_student: currentStudentId,
  });
});
it("reversal requires an explicit separate action/reason and no duplicate transfer", async () => {
  const dissolve = {
    action: "dissolve",
    currentStudentId,
    reason: "Coach reversed incorrect grouping",
  };
  await handleStudentIdentity(
    ctx("identity_change", { proposal: dissolve, stamp: "a".repeat(64) }),
  );
  expect(f.rpc.mock.calls[0][1].p_value).toEqual(dissolve);
});
it.each([
  { combineBalances: true },
  { transferGuardianAccess: true },
  { stripeCustomerId: "cus_synthetic" },
  { removeStudentId: duplicateStudentId },
  { reason: " " },
  { action: "delete" },
])(
  "rejects unsupported consolidation or malformed proposal %j",
  async (patch) => {
    await expect(
      handleStudentIdentity(
        ctx("identity_change", {
          proposal: { ...proposal, ...patch },
          stamp: "a".repeat(64),
        }),
      ),
    ).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  },
);
it("does not turn a failed database write into success", async () => {
  f.rpc.mockResolvedValue({
    data: null,
    error: Error("SYNTHETIC_RECEIPT_FAILURE"),
  });
  await expect(handleStudentIdentity(ctx())).rejects.toThrow(
    "SYNTHETIC_RECEIPT_FAILURE",
  );
});
it("ignores unrelated student commands", async () => {
  expect(await handleStudentIdentity(ctx("create"))).toBeNull();
  expect(f.coach).not.toHaveBeenCalled();
});
