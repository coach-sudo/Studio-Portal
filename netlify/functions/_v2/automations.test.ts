import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAutomationCommands } from "./automations";
import { AppError } from "../_shared/http";
import type { V2CommandContext } from "./types";
vi.mock("../_shared/supabase", () => ({ serviceClient: vi.fn() }));
import { serviceClient } from "../_shared/supabase";
vi.mock("../_shared/outbox-eligibility", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_shared/outbox-eligibility")>()),
  checkOutboxEligibility: vi.fn(),
  suppressOutbox: vi.fn(),
}));
import {
  checkOutboxEligibility,
  suppressOutbox,
} from "../_shared/outbox-eligibility";
beforeEach(() => {
  vi.clearAllMocks();
});
describe("automation API role boundary", () => {
  it.each([
    "test_rule",
    "run_rule",
    "save_rule",
    "send_now",
    "approve_message",
  ])(
    "denies non-coach %s before service-role reads or writes",
    async (command) => {
      const ctx = {
        domain: "automations",
        input: { command, entityId: "rule" },
        requireCoach: async () => {
          throw AppError.forbidden();
        },
      } as unknown as V2CommandContext;
      await expect(handleAutomationCommands(ctx)).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
      expect(serviceClient).not.toHaveBeenCalled();
    },
  );
});

describe("scheduled reminder approval", () => {
  function fixture(
    options: {
      status?: string;
      version?: number;
      race?: boolean;
      sendAt?: string;
      recipientIntent?: string;
    } = {},
  ) {
    const message = {
      id: "message",
      studio_id: "studio",
      version: 3,
      status: options.status ?? "draft",
      recipient_intent: options.recipientIntent ?? null,
      send_at: options.sendAt ?? "2099-10-06T12:00:00Z",
      entity_snapshot: { startsAt: "2099-10-07T12:00:00Z" },
    };
    const update = vi.fn();
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      update: vi.fn((value: unknown) => {
        update(value);
        return query;
      }),
      single: async () => ({ data: message, error: null }),
      maybeSingle: async () => ({
        data: options.race ? null : { id: message.id },
        error: null,
      }),
    };
    vi.mocked(serviceClient).mockReturnValue({
      from: () => query,
    } as unknown as ReturnType<typeof serviceClient>);
    vi.mocked(checkOutboxEligibility).mockResolvedValue({ allowed: true });
    const ctx = {
      domain: "automations",
      input: {
        command: "approve_message",
        entityId: "message",
        expectedVersion: options.version ?? 3,
      },
      requireCoach: async () => "studio",
      audit: vi.fn(async () => "audit"),
    } as unknown as V2CommandContext;
    return { ctx, update, query };
  }
  it("retains the future scheduled time, records approval and preserves the occurrence snapshot", async () => {
    const f = fixture();
    expect((await handleAutomationCommands(f.ctx))?.status).toBe(200);
    expect(f.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "queued",
        send_at: "2099-10-06T12:00:00.000Z",
        next_attempt_at: "2099-10-06T12:00:00.000Z",
        version: 4,
        entity_snapshot: {
          startsAt: "2099-10-07T12:00:00Z",
          approvedAt: expect.any(String),
        },
      }),
    );
    expect(f.query.eq).toHaveBeenCalledWith("studio_id", "studio");
    expect(f.query.eq).toHaveBeenCalledWith("status", "draft");
  });
  it("uses the approval time when the proposed schedule has elapsed", async () => {
    const f = fixture({ sendAt: "2000-01-01T00:00:00Z" });
    const before = Date.now();
    await handleAutomationCommands(f.ctx);
    expect(
      Date.parse(f.update.mock.calls[0][0].send_at),
    ).toBeGreaterThanOrEqual(before);
  });
  it("rejects stale versions without mutating the draft", async () => {
    const f = fixture({ version: 2 });
    await expect(handleAutomationCommands(f.ctx)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect(f.update).not.toHaveBeenCalled();
  });
  it("rejects an already queued message without resetting its schedule", async () => {
    const f = fixture({ status: "queued" });
    await expect(handleAutomationCommands(f.ctx)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(f.update).not.toHaveBeenCalled();
  });
  it("permits scheduled approval of a legacy queued payer reminder without changing its due time", async () => {
    const f = fixture({ status: "queued", recipientIntent: "payment_due" });
    expect((await handleAutomationCommands(f.ctx))?.status).toBe(200);
    expect(f.update).toHaveBeenCalledWith(
      expect.objectContaining({ send_at: "2099-10-06T12:00:00.000Z" }),
    );
  });
  it("suppresses a resolved balance rather than approving stale content", async () => {
    const f = fixture();
    vi.mocked(checkOutboxEligibility).mockResolvedValue({
      allowed: false,
      reason: "financial_condition_resolved",
    });
    await expect(handleAutomationCommands(f.ctx)).rejects.toMatchObject({
      status: 422,
    });
    expect(suppressOutbox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "message" }),
      "financial_condition_resolved",
    );
    expect(f.update).not.toHaveBeenCalled();
  });
  it("reports a concurrent change instead of auditing a successful approval", async () => {
    const f = fixture({ race: true });
    await expect(handleAutomationCommands(f.ctx)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect(f.ctx.audit).not.toHaveBeenCalled();
  });
});
