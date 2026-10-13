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
      payload: { studentId: "student" },
    },
    requireCoach: async () => "studio",
    db: { from: () => q },
    audit: vi.fn(),
  } as unknown as V2CommandContext;
}
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === "student_credit_summary"
        ? { autoApply: true, reserved: 2, available: 5, version: 3 }
        : {
            autoApply: true,
            reserved: 5,
            available: 2,
            version: 6,
            applied: 16,
          },
    error: null,
  }));
});
it("applies upcoming credits through the version-protected account operation and reports only new reservations", async () => {
  const response = await handleFinanceCommands(fixture());
  expect(rpc).toHaveBeenCalledWith("set_student_credit_auto", {
    p_student: "student",
    p_enabled: true,
    p_version: 3,
  });
  expect((await response!.json()).resource.applied).toBe(3);
});
it("does not silently enable automatic use when it is off", async () => {
  rpc.mockResolvedValue({ data: { autoApply: false }, error: null });
  await expect(handleFinanceCommands(fixture())).rejects.toThrow(
    "Enable automatic credit use",
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
