// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import {
  loadStudentIdentity,
  previewStudentIdentity,
  saveStudentIdentity,
} from "./studentIdentity";
const f = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("./bookingCommands", () => ({ studioCommand: f.command }));
const current = "e8700000-0000-4000-8000-000000000010",
  duplicate = "e8700000-0000-4000-8000-000000000011",
  groupId = "e8700000-0000-4000-8000-000000000040";
const proposal = {
  action: "group" as const,
  currentStudentId: current,
  duplicateStudentId: duplicate,
  reason: "Explicit coach review",
};
const preview = {
  phase: "preview",
  stamp: "a".repeat(64),
  proposal,
  blockedReason: null,
  currentProfile: { id: current, name: "Current", version: 1 },
  duplicateProfile: { id: duplicate, name: "Original", version: 1 },
  group: null,
  financialEffects: [],
  permissionEffects: [],
  providerEffects: [],
  profilesDeleted: false,
};
beforeEach(() => vi.clearAllMocks());
it("keeps source preview uncommitted and validates explicit no-effect claims", async () => {
  f.command.mockResolvedValue({ resource: preview });
  expect(await previewStudentIdentity(proposal)).toEqual(preview);
  expect(f.command.mock.calls[0][1].command).toBe("preview_identity_change");
});
it("does not accept a contradictory financial or permission effect as an ordinary preview", async () => {
  f.command.mockResolvedValue({
    resource: { ...preview, permissionEffects: ["guardian_transfer"] },
  });
  await expect(previewStudentIdentity(proposal)).rejects.toThrow();
});
it("retries use the same complete proposal, stamp and caller-owned key", async () => {
  f.command.mockResolvedValue({
    resource: {
      groupId,
      version: 1,
      active: true,
      currentStudentId: current,
      profilesDeleted: false,
    },
    auditEventId: groupId,
    queuedSideEffects: [],
  });
  await saveStudentIdentity(proposal, "a".repeat(64), "saved-request-identity");
  await saveStudentIdentity(proposal, "a".repeat(64), "saved-request-identity");
  expect(f.command.mock.calls[1]).toEqual(f.command.mock.calls[0]);
  expect(f.command.mock.calls[0][1].idempotencyKey).toBe(
    "saved-request-identity",
  );
});
it("refuses to report physical deletion as successful grouping", async () => {
  f.command.mockResolvedValue({
    resource: {
      groupId,
      version: 1,
      active: true,
      currentStudentId: current,
      profilesDeleted: true,
    },
    auditEventId: groupId,
    queuedSideEffects: [],
  });
  await expect(
    saveStudentIdentity(proposal, "a".repeat(64), "saved-request-identity"),
  ).rejects.toThrow();
});
it("reads original student identity with its exact cursor and total", async () => {
  const resource = {
    group: null,
    members: [],
    total: 0,
    hasMore: false,
    nextAfterStudent: null,
    financialAccountsRemainSeparate: true,
    permissionsRemainSeparate: true,
  };
  f.command.mockResolvedValue({ resource });
  expect(await loadStudentIdentity(duplicate, current)).toEqual(resource);
  expect(f.command.mock.calls[0][1].payload).toEqual({
    studentId: duplicate,
    afterStudent: current,
  });
});
it("an API failure remains a failure", async () => {
  f.command.mockRejectedValue(Error("History unavailable"));
  await expect(loadStudentIdentity(current)).rejects.toThrow(
    "History unavailable",
  );
});
