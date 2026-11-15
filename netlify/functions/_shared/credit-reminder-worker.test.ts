// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { runCreditReminderBatch } from "./credit-reminder-worker";

const message = {
  recipient: "synthetic@example.test",
  subject: "Lesson credit reminder",
  body: "Review credits",
  actionPath: "/portal/credits?student=synthetic",
};
function fixture(
  options: { enabled?: boolean; ephemeral?: boolean; allowed?: boolean } = {},
) {
  vi.stubGlobal("Netlify", {
    env: {
      get: (name: string) => {
        if (name === "WORKER_AUTOMATIONS_ENABLED") return "true";
        if (name === "WORKER_CREDIT_REMINDERS_ENABLED" && options.enabled)
          return "true";
        if (name === "E2E_EPHEMERAL" && options.ephemeral) return "true";
      },
    },
  });
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === "claim_credit_reminder_email"
        ? [{ id: "delivery", token: "token" }]
        : name === "begin_credit_reminder_email"
          ? options.allowed === false
            ? null
            : message
          : true,
    error: null,
  }));
  const transport = {
    authorize: vi.fn(async () => "synthetic-token"),
    send: vi.fn(async () => ({ id: "provider-ack" })),
    origin: vi.fn(() => "https://example.test"),
  };
  const run = () =>
    runCreditReminderBatch({ rpc } as never, Date.now() + 30_000, transport);
  return { rpc, transport, run };
}

afterEach(() => vi.unstubAllGlobals());

it("requires the separate release flag before touching the database or provider", async () => {
  const { rpc, transport, run } = fixture();
  await run();
  expect(rpc).not.toHaveBeenCalled();
  expect(transport.authorize).not.toHaveBeenCalled();
});

it("creates conditions in isolated mode without reaching Gmail", async () => {
  const { rpc, transport, run } = fixture({ enabled: true, ephemeral: true });
  await run();
  expect(rpc.mock.calls).toEqual([["scan_credit_reminders", { p_limit: 8 }]]);
  expect(transport.authorize).not.toHaveBeenCalled();
});

it("sends only after the database rechecks the claimed recipient and coverage", async () => {
  const { rpc, transport, run } = fixture({ enabled: true });
  await run();
  expect(transport.send).toHaveBeenCalledWith("synthetic-token", {
    recipient: message.recipient,
    subject: message.subject,
    body: message.body + "\n\nhttps://example.test" + message.actionPath,
  });
  expect(rpc).toHaveBeenCalledWith("finish_credit_reminder_email", {
    p_delivery: "delivery",
    p_token: "token",
    p_outcome: "sent",
    p_reference: "provider-ack",
  });
  expect(transport.send.mock.invocationCallOrder[0]).toBeGreaterThan(
    rpc.mock.invocationCallOrder[2],
  );
});

it("skips delivery when current authorization has changed", async () => {
  const { transport, run } = fixture({ enabled: true, allowed: false });
  await run();
  expect(transport.send).not.toHaveBeenCalled();
});

it("distinguishes a failed authorization from an uncertain send", async () => {
  const { rpc, transport, run } = fixture({ enabled: true });
  transport.authorize.mockRejectedValueOnce(new Error("Token failed"));
  await run();
  expect(transport.send).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenLastCalledWith(
    "finish_credit_reminder_email",
    expect.objectContaining({ p_outcome: "retry_before_send" }),
  );
  transport.send.mockRejectedValueOnce(new Error("Connection dropped"));
  await run();
  expect(transport.send).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenLastCalledWith(
    "finish_credit_reminder_email",
    expect.objectContaining({ p_outcome: "uncertain" }),
  );
});
