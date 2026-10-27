// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Context } from "@netlify/functions";
import intake from "../provider-intake";
import intakeBackground from "../provider-intake-background";
import maintenance from "../booking-maintenance";
import maintenanceBackground from "../booking-maintenance-background";
import calendar from "../calendar-worker";
import outbox from "../outbox-worker";
import intakeAdmin from "../provider-intake-admin";
import { handleAdministrationCommands } from "../_v2/administration";
import { handleAutomationCommands } from "../_v2/automations";
import { handleMessagingCommands } from "../_v2/messaging";
import type { V2CommandContext } from "../_v2/types";
import {
  importCalendar,
  runProviderIntake,
  scanGmail,
} from "./provider-intake";
import { runBookingMaintenance } from "./booking-maintenance";
import { dispatchOutbox } from "./outbox-dispatch";
import { projectCalendarItem } from "./calendar-projection";
import {
  evaluateAndQueueRule,
  evaluateStudioAutomations,
} from "./automation-engine";
import { workerTelemetry } from "./worker-telemetry";
import { workerSettings } from "./worker-controls";

const f = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  service: vi.fn(),
  user: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  token: vi.fn(),
  send: vi.fn(),
  fetch: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  eligibility: vi.fn(),
}));
vi.mock("./supabase", () => ({ serviceClient: f.service, userClient: f.user }));
vi.mock("./google", async (original) => ({
  ...(await original<typeof import("./google")>()),
  googleAccessToken: f.token,
  sendGmail: f.send,
}));
vi.mock("./outbox-eligibility", () => ({
  checkOutboxEligibility: f.eligibility,
}));
const context = {
  requestId: "isolated-worker-controls",
  site: { name: "coachd-staging" },
  deploy: { id: "6ad8e4ee73c3bc97c37dd94f" },
} as Context;
const job = "10000000-0000-4000-8000-000000000001";
const db = { rpc: f.rpc, from: f.from };
function result(data: unknown) {
  const p = Promise.resolve({ data, error: null });
  return Object.assign(p, { abortSignal: () => p });
}
function request() {
  return new Request("https://isolated.example.test", { method: "POST" });
}
function delivery(worker: string) {
  const body = JSON.stringify({
    worker,
    jobId: job,
    deployId: context.deploy.id,
  });
  return new Request("https://isolated.example.test", {
    method: "POST",
    body,
    headers: {
      "x-worker-signature": createHmac("sha256", "test-only-key")
        .update("coachd-scheduled-worker-v1\n" + body)
        .digest("hex"),
    },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  f.env = {
    SITE_ID: "d83ff6cb-f57b-4741-8c3c-3eaae7adab19",
    CONTEXT: "production",
    SUPABASE_SERVICE_ROLE_KEY: "test-only-key",
  };
  vi.stubGlobal("Netlify", { env: { get: (key: string) => f.env[key] } });
  vi.stubGlobal("fetch", f.fetch);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  f.service.mockReturnValue(db);
  const q = {
    select: () => q,
    eq: f.eq.mockImplementation(() => q),
    update: f.update.mockImplementation(() => q),
    in: () => q,
    lte: () => q,
    limit: () => q,
    single: async () => ({
      data: { id: "approved-coach-membership" },
      error: null,
    }),
    then: (resolve: Parameters<Promise<unknown>["then"]>[0]) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  f.from.mockReturnValue(q);
  f.user.mockReturnValue(db);
  f.rpc.mockImplementation((name: string) =>
    result(
      name === "enqueue_scheduled_worker"
        ? job
        : name === "claim_scheduled_worker"
          ? "fenced-token"
          : true,
    ),
  );
  f.token.mockResolvedValue("test-only-token");
  f.fetch.mockResolvedValue(new Response(null, { status: 202 }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ["provider-intake", intake],
  ["booking-maintenance", maintenance],
  ["calendar", calendar],
  ["automations", outbox],
] as const)(
  "disabled %s schedule acknowledges before database construction, claims or dispatch",
  async (worker, handler) => {
    const response = await handler(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "disabled",
      worker,
    });
    expect(f.service).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.token).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  },
);
it.each([
  ["provider-intake", intakeBackground],
  ["booking-maintenance", maintenanceBackground],
] as const)(
  "disabled %s background rejects auth bypass and cannot process a valid direct delivery",
  async (worker, handler) => {
    await expect(handler(request(), context)).rejects.toThrow(
      "Worker operation failed.",
    );
    const response = await handler(delivery(worker), context);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      status: "disabled",
      worker,
    });
    expect(f.service).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.token).not.toHaveBeenCalled();
  },
);
it.each([undefined, "", "TRUE", "false", "1", " true", "true ", "yes", "null"])(
  "staging setting %s fails closed at the actual dispatcher",
  async (value) => {
    f.env.WORKER_PROVIDER_INTAKE_ENABLED = value;
    await intake(request(), context);
    expect(f.service).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  },
);
it("request headers and a production hostname cannot enable staging work", async () => {
  await intake(
    new Request("https://portal.d-a-j.com", {
      headers: {
        "x-worker-enabled": "true",
        "x-site-id": "93829451-dbcf-4863-a07f-fa448cb17494",
      },
    }),
    context,
  );
  expect(f.service).not.toHaveBeenCalled();
});
it("production defaults still dispatch, while an explicit production override contains work", async () => {
  f.env.SITE_ID = "93829451-dbcf-4863-a07f-fa448cb17494";
  expect((await intake(request(), context)).status).toBe(202);
  expect(f.rpc).toHaveBeenCalledWith("enqueue_scheduled_worker", {
    p_worker: "provider-intake",
  });
  f.rpc.mockClear();
  f.fetch.mockClear();
  f.env.WORKER_PROVIDER_INTAKE_ENABLED = "false";
  expect((await intake(request(), context)).status).toBe(200);
  expect(f.rpc).not.toHaveBeenCalled();
  expect(f.fetch).not.toHaveBeenCalled();
});
it("unknown primary site identity fails closed", async () => {
  delete f.env.SITE_ID;
  await intake(request(), context);
  expect(f.service).not.toHaveBeenCalled();
});
it("shared processors cannot bypass disabled entry points or advance review/credit/outbox records", async () => {
  await runProviderIntake();
  await expect(importCalendar("unused", {} as never, [])).rejects.toThrow(
    "disabled",
  );
  await expect(scanGmail("unused", {} as never, [])).rejects.toThrow(
    "disabled",
  );
  await runBookingMaintenance(workerTelemetry("booking-maintenance", "test"));
  await dispatchOutbox({ ids: ["pending-notification"] });
  await evaluateStudioAutomations(db as never, "studio", "test");
  await evaluateAndQueueRule(
    db as never,
    {} as never,
    "entity",
    undefined,
    "test",
  );
  await projectCalendarItem(db as never, {} as never, f.token, "unused");
  expect(f.service).not.toHaveBeenCalled();
  expect(f.rpc).not.toHaveBeenCalled();
  expect(f.from).not.toHaveBeenCalled();
  expect(f.token).not.toHaveBeenCalled();
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
});
it("manual intake still requires coach authorization before acknowledging containment", async () => {
  expect((await intakeAdmin(request(), context)).status).toBe(200);
  expect(f.user).toHaveBeenCalled();
  expect(f.service).not.toHaveBeenCalled();
  f.user.mockImplementation(() => {
    throw new Error("FORBIDDEN");
  });
  expect((await intakeAdmin(request(), context)).status).toBe(403);
});
it.each([
  "review_import",
  "retry_failed",
  "run_rule",
  "test_rule",
  "send_now",
  "retry_message",
])(
  "manual/replay command %s respects containment after authorization",
  async (command) => {
    const ctx = {
      domain: ["review_import", "retry_failed"].includes(command)
        ? "integrations"
        : "automations",
      input: { command, entityId: job },
      db,
      requireCoach: vi.fn(async () => "studio"),
    } as unknown as V2CommandContext;
    const handler =
      ctx.domain === "integrations"
        ? handleAdministrationCommands
        : handleAutomationCommands;
    expect((await handler(ctx))?.status).toBe(200);
    expect(ctx.requireCoach).toHaveBeenCalledOnce();
    expect(f.service).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalled();
    vi.mocked(ctx.requireCoach).mockRejectedValue(new Error("FORBIDDEN"));
    await expect(handler(ctx)).rejects.toThrow("FORBIDDEN");
  },
);
it("reenabling resumes the pending job; duplicate background delivery still cannot process twice", async () => {
  await intake(request(), context);
  expect(f.rpc).not.toHaveBeenCalled();
  f.env.WORKER_PROVIDER_INTAKE_ENABLED = "true";
  expect((await intake(request(), context)).status).toBe(202);
  await intakeBackground(delivery("provider-intake"), context);
  expect(f.token).toHaveBeenCalledOnce();
  expect(f.rpc).toHaveBeenLastCalledWith("finish_scheduled_worker", {
    p_worker: "provider-intake",
    p_job: job,
    p_token: "fenced-token",
  });
  f.rpc.mockImplementation(() => result(null));
  await intakeBackground(delivery("provider-intake"), context);
  expect(f.token).toHaveBeenCalledOnce();
});
it("disablement after enqueue prevents dispatch and preserves the pending receipt", async () => {
  f.env.WORKER_PROVIDER_INTAKE_ENABLED = "true";
  f.rpc.mockImplementation(() => {
    f.env.WORKER_PROVIDER_INTAKE_ENABLED = "false";
    return result(job);
  });
  expect((await intake(request(), context)).status).toBe(200);
  expect(f.rpc.mock.calls.map((c) => c[0])).toEqual([
    "enqueue_scheduled_worker",
  ]);
  expect(f.fetch).not.toHaveBeenCalled();
});
it("disablement after claim safely releases the fenced receipt as retryable unfinished work", async () => {
  f.env.WORKER_PROVIDER_INTAKE_ENABLED = "true";
  f.rpc.mockImplementation((name: string) => {
    if (name === "claim_scheduled_worker")
      f.env.WORKER_PROVIDER_INTAKE_ENABLED = "false";
    return result(name === "claim_scheduled_worker" ? "fenced-token" : true);
  });
  await intakeBackground(delivery("provider-intake"), context);
  expect(f.token).not.toHaveBeenCalled();
  expect(f.from).not.toHaveBeenCalled();
  expect(f.rpc).toHaveBeenLastCalledWith(
    "finish_scheduled_worker",
    expect.objectContaining({
      p_token: "fenced-token",
      p_error: "configuration",
    }),
  );
});
it("disablement after an outbox claim returns unstarted owned records to queued without delivery attempts", async () => {
  f.env.WORKER_AUTOMATIONS_ENABLED = "true";
  f.rpc.mockImplementation(() => {
    f.env.WORKER_AUTOMATIONS_ENABLED = "false";
    return result([{ id: "pending", version: 7, updated_at: "claim-time" }]);
  });
  expect(await dispatchOutbox()).toMatchObject({ status: "disabled", sent: 0 });
  expect(f.update).toHaveBeenCalledWith({ status: "queued" });
  expect(f.eq.mock.calls).toEqual([
    ["id", "pending"],
    ["status", "sending"],
    ["version", 7],
    ["updated_at", "claim-time"],
  ]);
  expect(f.from).toHaveBeenCalledTimes(1);
  expect(f.token).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
});
it("calendar disablement during OAuth stops provider access and settles only its fenced claim", async () => {
  f.env.WORKER_CALENDAR_ENABLED = "true";
  f.token.mockImplementation(async () => {
    f.env.WORKER_CALENDAR_ENABLED = "false";
    return "unused";
  });
  await projectCalendarItem(
    db as never,
    {
      projection: { id: "projection", claim_token: "owned-token" },
      lesson: { id: "lesson" },
    },
    f.token,
    "test",
  );
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.rpc).toHaveBeenCalledOnce();
  expect(f.rpc).toHaveBeenCalledWith(
    "finish_calendar_projection",
    expect.objectContaining({
      p_id: "projection",
      p_token: "owned-token",
      p_failed: true,
      p_result: expect.objectContaining({ errorCode: "worker_disabled" }),
    }),
  );
});
it("all four groups can be explicitly enabled independently", async () => {
  for (const key of Object.values(workerSettings)) f.env[key] = "true";
  f.rpc.mockImplementation((name: string) =>
    result(
      name === "claim_calendar_projections" ||
        name === "claim_booking_reminders"
        ? []
        : job,
    ),
  );
  await calendar();
  await outbox();
  expect(f.rpc.mock.calls.map((c) => c[0])).toContain(
    "claim_calendar_projections",
  );
  expect(f.rpc.mock.calls.map((c) => c[0])).toContain(
    "claim_booking_reminders",
  );
});

it.each(["retry_failed", "manual_send", "resend", "approve"])(
  "outbox command %s cannot bypass containment or authorization",
  async (command) => {
    const ctx = {
      domain: "outbox",
      input: { command, entityId: job },
      db,
      requireCoach: vi.fn(async () => "studio"),
    } as unknown as V2CommandContext;
    expect((await handleMessagingCommands(ctx))?.status).toBe(200);
    expect(ctx.requireCoach).toHaveBeenCalledOnce();
    expect(f.service).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalled();
    vi.mocked(ctx.requireCoach).mockRejectedValue(new Error("FORBIDDEN"));
    await expect(handleMessagingCommands(ctx)).rejects.toThrow("FORBIDDEN");
  },
);
