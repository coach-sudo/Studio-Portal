import { beforeEach, describe, expect, it, vi } from "vitest";
import type { V2CommandContext } from "./types";
import { handleSetupCommands } from "./setup";

const { rpc, invite } = vi.hoisted(() => ({ rpc: vi.fn(), invite: vi.fn() }));
vi.mock("../_shared/supabase", () => ({ serviceClient: () => ({ rpc }) }));
vi.mock("./students", () => ({ handleStudentsCommands: invite }));
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
  beforeEach(() => {
    rpc.mockReset();
    invite.mockReset();
  });
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

const contactId = "f5500000-0000-4000-8000-000000000041";
const invitationId = "f5500000-0000-4000-8000-000000000042";
const pendingContact = {
  id: contactId,
  kind: "contact",
  payload: {
    fullName: "Restricted Guardian",
    email: "guardian@example.test",
    relationshipType: "guardian",
    isPrimaryPayer: false,
    isPrimarySchedulingContact: false,
    canViewWork: false,
    canViewSchedule: true,
    canViewFinance: false,
    canManageLessons: false,
    canManageProfile: false,
    canReceiveNotifications: false,
    portalEnabled: true,
  },
};
const invitation = {
  id: invitationId,
  kind: "invitation",
  payload: {
    accountType: "guardian",
    consentConfirmed: true,
    contactActionId: contactId,
    expectedRecipient: "guardian@example.test",
  },
};
function connected(command: string) {
  const ctx = context();
  ctx.input.command = command;
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({
      data: {
        is_minor: false,
        email: "learner@example.test",
        guardian_email: null,
      },
      error: null,
    }),
  };
  ctx.db.from = vi.fn(() => query) as unknown as typeof ctx.db.from;
  return ctx;
}
describe("reviewed guardian setup invitations", () => {
  beforeEach(() => {
    rpc.mockReset();
    invite.mockReset();
  });
  it("freezes the selected pending contact instead of dropping its permission association", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        version: 1,
        draft: { step: 5, actions: [pendingContact, invitation] },
        results: {},
      },
    });
    rpc.mockResolvedValueOnce({ data: { version: 1, draft: {}, results: {} } });
    await handleSetupCommands(connected("review"));
    const actions = rpc.mock.calls[1][1].p_value.actions;
    expect(actions[1].payload).toMatchObject({
      contactActionId: contactId,
      expectedRecipient: "guardian@example.test",
    });
    expect(actions[0].payload.canViewFinance).toBe(false);
    expect(invite).not.toHaveBeenCalled();
  });
  it("rejects a forged pending-contact action before provisioning", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        version: 1,
        draft: {
          step: 5,
          actions: [
            pendingContact,
            {
              ...invitation,
              payload: { ...invitation.payload, contactActionId: invitationId },
            },
          ],
        },
        results: {},
      },
    });
    await expect(handleSetupCommands(connected("review"))).rejects.toThrow(
      "REVIEW_REQUIRED",
    );
    expect(invite).not.toHaveBeenCalled();
  });
  it.each(["resource", "student"])(
    "resolves the succeeded contact receipt and propagates the %s version",
    async (field) => {
      rpc.mockResolvedValueOnce({
        data: {
          action: invitation,
          key: "review:invitation",
          studentVersion: 5,
        },
      });
      rpc.mockResolvedValueOnce({
        data: {
          version: 1,
          draft: {},
          results: {
            [contactId]: {
              status: "succeeded",
              key: "contact-key",
              result: { resource: { id: contactId, version: 2 } },
            },
          },
        },
      });
      rpc.mockResolvedValueOnce({
        data: { version: 1, draft: {}, results: {} },
      });
      invite.mockResolvedValueOnce(
        Response.json({
          [field]: { id: "student", version: 6 },
          instructionsQueued: true,
        }),
      );
      const ctx = connected("execute_action");
      ctx.input.payload = { reviewId: "review", actionId: invitationId };
      await handleSetupCommands(ctx);
      expect(invite.mock.calls[0][0].input.payload).toMatchObject({
        linkedContactId: contactId,
        contactVersion: 2,
        expectedRecipient: "guardian@example.test",
        resetExisting: false,
      });
      expect(rpc.mock.calls[2][1].p_value.result.studentVersion).toBe(6);
    },
  );
  it("never provisions when the pending contact has not completed", async () => {
    rpc.mockResolvedValueOnce({
      data: { action: invitation, key: "review:invitation", studentVersion: 5 },
    });
    rpc.mockResolvedValueOnce({ data: { version: 1, draft: {}, results: {} } });
    rpc.mockResolvedValueOnce({ data: { version: 1, draft: {}, results: {} } });
    const ctx = connected("execute_action");
    ctx.input.payload = { reviewId: "review", actionId: invitationId };
    await expect(handleSetupCommands(ctx)).rejects.toThrow(
      "Complete the reviewed contact action",
    );
    expect(invite).not.toHaveBeenCalled();
  });
});
