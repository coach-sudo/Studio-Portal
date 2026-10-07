import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { rpc: vi.fn(), from: vi.fn() },
  eligibility: vi.fn(),
  suppress: vi.fn(),
  token: vi.fn(),
  send: vi.fn(),
}));
vi.mock("./supabase", () => ({ serviceClient: () => mocks.db }));
vi.mock("./outbox-eligibility", () => ({
  checkOutboxEligibility: mocks.eligibility,
  suppressOutbox: mocks.suppress,
}));
vi.mock("./google", () => ({
  googleAccessToken: mocks.token,
  sendGmail: mocks.send,
}));
vi.mock("./release", () => ({
  releaseMetadata: () => ({ context: "deploy-preview" }),
}));
import { dispatchOutbox } from "./outbox-dispatch";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.rpc.mockResolvedValue({
    data: [{ id: "message", correlation_id: "fixture-run" }],
    error: null,
  });
  mocks.suppress.mockResolvedValue(undefined);
  const query = {
    update: vi.fn(() => query),
    insert: vi.fn(() => query),
    eq: vi.fn(() => query),
    then: (resolve: (value: unknown) => void) => resolve({ error: null }),
  };
  mocks.db.from.mockReturnValue(query);
  vi.stubGlobal("Netlify", { env: { get: () => undefined } });
});
describe("outbox remains the sole delivery boundary", () => {
  it("returns an unapproved legacy payer reminder to draft without provider access", async () => {
    mocks.eligibility.mockResolvedValue({
      allowed: false,
      reason: "approval_required",
    });
    expect(await dispatchOutbox()).toMatchObject({ processed: 1, sent: 0 });
    expect(mocks.db.from().update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft" }),
    );
    expect(mocks.suppress).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([
    "financial_condition_resolved",
    "recipient_no_longer_eligible",
    "lesson_rescheduled",
  ])("suppresses %s before acquiring provider credentials", async (reason) => {
    mocks.eligibility.mockResolvedValue({ allowed: false, reason });
    expect(await dispatchOutbox()).toMatchObject({
      processed: 1,
      suppressed: 1,
      sent: 0,
    });
    expect(mocks.suppress).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({ id: "message" }),
      reason,
    );
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("an isolated browser run cannot acquire a Gmail token even with eligible queued messages", async () => {
    vi.stubGlobal("Netlify", {
      env: {
        get: (key: string) => (key === "E2E_EPHEMERAL" ? "true" : undefined),
      },
    });
    mocks.eligibility.mockResolvedValue({ allowed: true });
    expect(await dispatchOutbox()).toMatchObject({ sent: 0 });
    expect(mocks.db.from).toHaveBeenCalledWith("outbox_messages");
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("provider failures log only safe structured evidence, never a token or internal error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.eligibility.mockResolvedValue({ allowed: true });
    mocks.token.mockRejectedValue(new Error("private-provider-detail"));
    expect(await dispatchOutbox()).toMatchObject({ sent: 0 });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"code":"PROVIDER_UNAVAILABLE"'),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private-provider-detail",
    );
    log.mockRestore();
  });
});
