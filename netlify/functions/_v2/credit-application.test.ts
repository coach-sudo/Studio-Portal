import { beforeEach, expect, it, vi } from "vitest";
import type { V2CommandContext } from "./types";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../_shared/supabase", () => ({ serviceClient: () => ({ rpc }) }));
import { handleFinanceCommands } from "./finance";
function fixture() {
  const q = {
    select: () => q,
    eq: () => q,
    is: () => q,
    single: async () => ({ data: { id: "student" }, error: null }),
  };
  return {
    domain: "credits",
    input: {
      command: "apply_upcoming",
      expectedVersion: 3,
      idempotencyKey: "stable-command",
      payload: { studentId: "student" },
    },
    requireCoach: async () => "studio",
    db: {
      from: () => q,
      auth: {
        getUser: async () => ({ data: { user: { id: "coach" } }, error: null }),
      },
    },
    audit: vi.fn(),
  } as unknown as V2CommandContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      autoApply: true,
      applied: 3,
      alreadyCovered: 2,
      skipped: 1,
      failed: 0,
      version: 6,
      auditEventId: "transactional-audit",
    },
    error: null,
  });
});
it("forwards authoritative new/already/skipped counts and stable keys to the atomic command", async () => {
  const ctx = fixture();
  const response = await handleFinanceCommands(ctx);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "command_student_credit_settings",
    {
      p_student: "student",
      p_command: "apply_upcoming",
      p_value: { studentId: "student" },
      p_version: 3,
      p_key: "stable-command",
      p_actor: "coach",
    },
  );
  expect(await response!.json()).toMatchObject({
    resource: {
      applied: 3,
      alreadyCovered: 2,
      skipped: 1,
      failed: 0,
      autoApply: true,
    },
    auditEventId: "transactional-audit",
  });
  expect(ctx.audit).not.toHaveBeenCalled();
});
it("rejects a disabled preference without silently enabling it", async () => {
  rpc.mockResolvedValue({
    data: null,
    error: new Error("Review and enable automatic credit use first"),
  });
  await expect(handleFinanceCommands(fixture())).rejects.toThrow(
    "Review and enable",
  );
  expect(rpc).not.toHaveBeenCalledWith(
    "set_student_credit_auto",
    expect.anything(),
  );
});
it("requires coach access before reserving credits", async () => {
  const ctx = fixture();
  ctx.requireCoach = async () => {
    throw new Error("FORBIDDEN");
  };
  await expect(handleFinanceCommands(ctx)).rejects.toThrow("FORBIDDEN");
  expect(rpc).not.toHaveBeenCalled();
});
it("propagates transaction conflicts without a second audit or recalculated result", async () => {
  rpc.mockResolvedValue({
    data: null,
    error: new Error("IDEMPOTENCY_CONFLICT"),
  });
  const ctx = fixture();
  await expect(handleFinanceCommands(ctx)).rejects.toThrow(
    "IDEMPOTENCY_CONFLICT",
  );
  expect(ctx.audit).not.toHaveBeenCalled();
});
