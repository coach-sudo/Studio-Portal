// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { Context } from "@netlify/functions";
import {
  dispatchScheduledWorker,
  runScheduledWorker,
} from "./scheduled-worker";
import { safeWorkerError } from "./worker-telemetry";

const f = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabase", () => ({ serviceClient: () => ({ rpc: f.rpc }) }));
const job = "10000000-0000-4000-8000-000000000001";
const context = {
  requestId: "execution-test",
  site: { name: "e2e-test" },
  deploy: { id: "6ad8e4ee73c3bc97c37dd94f" },
} as Context;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("Netlify", {
    env: {
      get: (key: string) =>
        key.startsWith("WORKER_") ? "true" : "isolated-test-key",
    },
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  f.rpc
    .mockReset()
    .mockImplementation((name: string) =>
      response(
        name === "enqueue_scheduled_worker"
          ? job
          : name === "claim_scheduled_worker"
            ? "claim-token"
            : true,
      ),
    );
});
function response(data: unknown) {
  const promise = Promise.resolve({ data, error: null });
  return Object.assign(promise, { abortSignal: () => promise });
}
async function dispatchedRequest() {
  const fetch = vi.fn(async () => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetch);
  await dispatchScheduledWorker("provider-intake", context);
  const [url, options] = fetch.mock.calls[0] as unknown as [
    string,
    ConstructorParameters<typeof Request>[1],
  ];
  return new Request(url, options);
}
it("awaits accepted delivery to the same artifact before acknowledging", async () => {
  const request = await dispatchedRequest();
  expect(request.url).toBe(
    `https://${context.deploy.id}--e2e-test.netlify.app/.netlify/functions/provider-intake-background`,
  );
  expect(request.headers.get("x-worker-signature")).toMatch(/^[a-f0-9]{64}$/);
  expect(await request.text()).not.toContain("isolated-test-key");
});
it.each([200, 401, 404, 500])(
  "rejects a dispatch response of %s without dropping its pending receipt",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    await expect(
      dispatchScheduledWorker("provider-intake", context),
    ).rejects.toThrow("Provider operation failed.");
    expect(f.rpc.mock.calls.map((c) => c[0])).toEqual([
      "enqueue_scheduled_worker",
    ]);
  },
);
it("leaves an ambiguous transport delivery recoverable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new DOMException("sensitive upstream", "TimeoutError");
    }),
  );
  await expect(
    dispatchScheduledWorker("provider-intake", context),
  ).rejects.toThrow("timed out");
  expect(f.rpc).toHaveBeenCalledTimes(1);
});
it("does not dispatch while the persisted lease is active", async () => {
  f.rpc.mockReturnValue(response(null));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(
    (await dispatchScheduledWorker("provider-intake", context)).status,
  ).toBe(200);
  expect(fetch).not.toHaveBeenCalled();
});
it("authenticates and completes a claimed job", async () => {
  const request = await dispatchedRequest(),
    process = vi.fn(async () => {});
  await runScheduledWorker("provider-intake", request, context, process);
  expect(process).toHaveBeenCalledOnce();
  expect(f.rpc).toHaveBeenLastCalledWith(
    "finish_scheduled_worker",
    expect.objectContaining({ p_job: job, p_token: "claim-token" }),
  );
});
it("retains accepted dispatch separately from completed processing", async () => {
  const request = await dispatchedRequest();
  expect(f.rpc).toHaveBeenCalledWith(
    "observe_scheduled_worker",
    expect.objectContaining({ p_event: "accepted", p_job: job }),
  );
  await expect(
    runScheduledWorker("provider-intake", request, context, async (log) => {
      log.stage("calendar_processing");
      log.stage("gmail_processing");
      log.failure({
        code: "GMAIL_READ_PERMISSION",
        message: "private provider body",
      });
      throw new Error("PROVIDER_UNAVAILABLE: partial processing");
    }),
  ).rejects.toThrow();
  const observations = f.rpc.mock.calls
    .filter((c) => c[0] === "observe_scheduled_worker")
    .map((c) => c[1]);
  expect(observations).toContainEqual(
    expect.objectContaining({
      p_stage: "calendar_processing",
      p_event: "stage_completed",
    }),
  );
  expect(observations).toContainEqual(
    expect.objectContaining({
      p_stage: "gmail_processing",
      p_event: "stage_failed",
      p_error: "gmail_read_permission",
    }),
  );
  expect(observations).not.toContainEqual(
    expect.objectContaining({
      p_stage: "gmail_processing",
      p_event: "stage_completed",
    }),
  );
  expect(JSON.stringify(observations)).not.toContain("private provider body");
});
it("rejects unsigned and tampered deliveries before claiming or mutating", async () => {
  const valid = await dispatchedRequest(),
    body = await valid.text();
  f.rpc.mockClear();
  const process = vi.fn();
  for (const request of [
    new Request(valid.url, { method: "POST", body }),
    new Request(valid.url, {
      method: "POST",
      body: body + " ",
      headers: valid.headers,
    }),
  ])
    await expect(
      runScheduledWorker("provider-intake", request, context, process),
    ).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();
  expect(process).not.toHaveBeenCalled();
});
it("rejects cross-worker and cross-deploy replay", async () => {
  const request = await dispatchedRequest();
  const process = vi.fn();
  await expect(
    runScheduledWorker(
      "booking-maintenance",
      request.clone(),
      context,
      process,
    ),
  ).rejects.toThrow();
  await expect(
    runScheduledWorker(
      "provider-intake",
      request,
      { ...context, deploy: { ...context.deploy, id: "different-deploy" } },
      process,
    ),
  ).rejects.toThrow();
  expect(process).not.toHaveBeenCalled();
});
it("does not process a duplicate delivery whose claim is unavailable", async () => {
  const request = await dispatchedRequest();
  f.rpc.mockResolvedValue({ data: null, error: null });
  const process = vi.fn();
  await runScheduledWorker("provider-intake", request, context, process);
  expect(process).not.toHaveBeenCalled();
});
it("persists safe failure and throws so the background platform can retry", async () => {
  const request = await dispatchedRequest();
  await expect(
    runScheduledWorker("provider-intake", request, context, async (log) => {
      log.stage("gmail_processing");
      throw {
        code: "40001",
        message: "private student/token data",
        details: "secret",
      };
    }),
  ).rejects.toThrow("Database operation failed.");
  expect(f.rpc).toHaveBeenLastCalledWith(
    "finish_scheduled_worker",
    expect.objectContaining({ p_error: "database" }),
  );
  const logs = JSON.stringify(vi.mocked(console.error).mock.calls);
  expect(logs).toContain("gmail_processing");
  expect(logs).toContain("execution-test");
  expect(logs).not.toMatch(/private|secret|student\/token/);
});
it("classifies object errors without serializing unsafe messages", () => {
  expect(
    safeWorkerError({ code: "23505", message: "private row" }),
  ).toMatchObject({ category: "database", retryable: false });
  expect(
    safeWorkerError(new DOMException("private", "TimeoutError")),
  ).toMatchObject({ category: "timeout", retryable: true });
});
