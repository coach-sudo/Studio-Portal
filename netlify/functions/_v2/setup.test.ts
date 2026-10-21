import { describe, expect, it, vi } from "vitest";
import type { V2CommandContext } from "./types";
import { handleSetupCommands } from "./setup";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../_shared/supabase", () => ({ serviceClient: () => ({ rpc }) }));
vi.mock("./students", () => ({ handleStudentsCommands: vi.fn() }));
vi.mock("./lessons", () => ({ handleLessonsCommands: vi.fn() }));
vi.mock("./finance", () => ({ handleFinanceCommands: vi.fn() }));

const context = () =>
  ({
    domain: "setup",
    input: { command: "read", entityId: "student", idempotencyKey: "read" },
    requireCoach: vi.fn().mockResolvedValue("studio"),
    db: {
      auth: {
        getUser: async () => ({ data: { user: { id: "coach" } }, error: null }),
      },
    },
  }) as unknown as V2CommandContext;

describe("first Guided Setup read", () => {
  it("opens a usable empty draft for an absent PostgreSQL composite row without writing", async () => {
    rpc.mockResolvedValueOnce({
      data: { student_id: null, version: null, draft: null, results: null },
      error: null,
    });
    const response = await handleSetupCommands(context());
    expect(await response!.json()).toMatchObject({
      resource: { version: 0, draft: { step: 0, actions: [] }, results: {} },
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "manage_student_setup",
      expect.objectContaining({ p_command: "read", p_student: "student" }),
    );
  });

  it("preserves an existing draft, review and completed-action receipts", async () => {
    const existing = {
      version: 4,
      draft: { step: 5, actions: [{ id: "action" }] },
      results: { action: { status: "succeeded", key: "stable" } },
      review: { id: "review" },
    };
    rpc.mockResolvedValueOnce({ data: existing, error: null });
    expect(await (await handleSetupCommands(context()))!.json()).toEqual({
      resource: existing,
    });
  });

  it("still rejects an unauthorized read", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(handleSetupCommands(context())).rejects.toMatchObject({
      code: "42501",
    });
  });
});
