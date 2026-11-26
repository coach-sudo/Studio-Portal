import { describe, expect, it, vi } from "vitest";
import type { V2CommandContext } from "./types";
import { handleWorkCommands } from "./work";

const { serviceClient, mutation } = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  mutation: vi.fn(),
}));
vi.mock("../_shared/supabase", () => ({ serviceClient }));

const learner = "70000000-0000-4000-8000-000000000001";
const parent = "70000000-0000-4000-8000-000000000002";
function assignmentContext(actor: string, command: string) {
  const assignment = {
    id: "assignment",
    student_id: "student",
    status: "assigned",
    students: {
      studio_id: "studio",
      user_id: learner,
      portal_enabled: true,
      deleted_at: null,
    },
  };
  return {
    domain: "work",
    input: {
      command,
      entityId: assignment.id,
      expectedVersion: 1,
      payload: {},
    },
    db: {
      from: () => ({
        select: () => ({
          eq: () => ({ single: () => ({ data: assignment }) }),
        }),
      }),
      auth: { getUser: () => ({ data: { user: { id: actor } } }) },
    },
    audit: vi.fn().mockResolvedValue("audit"),
  } as unknown as V2CommandContext;
}

describe("Student assignment submission", () => {
  it("only completes the authorized learner's exact assignment and version", async () => {
    const writes = {
      eq: vi.fn(() => writes),
      select: () => ({
        maybeSingle: () => ({ data: { status: "completed" } }),
      }),
    };
    mutation.mockReturnValue(writes);
    serviceClient.mockReturnValue({ from: () => ({ update: mutation }) });
    const response = await handleWorkCommands(assignmentContext(learner, "complete"));
    expect(mutation).toHaveBeenCalledWith(expect.objectContaining({ status: "completed", version: 2 }));
    expect(writes.eq.mock.calls).toEqual([
      ["id", "assignment"],
      ["student_id", "student"],
      ["version", 1],
    ]);
    expect(await response?.json()).toMatchObject({ resource: { status: "completed" } });
  });

  it.each(["complete", "save_response", "help"])(
    "denies %s when a household account can read the assignment",
    async (command) => {
      serviceClient.mockClear();
      await expect(handleWorkCommands(assignmentContext(parent, command))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(serviceClient).not.toHaveBeenCalled();
    },
  );
});
