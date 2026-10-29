// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runProviderIntake } from "./provider-intake";
import {
  safeWorkerError,
  workerTelemetry,
  type WorkerObservation,
} from "./worker-telemetry";
type Resolve = Parameters<ConstructorParameters<PromiseConstructor>[0]>[0];
const f = vi.hoisted(() => ({
  calendarFailure: true,
  gmailStatus: 200,
  rpc: vi.fn(),
  writes: [] as string[],
}));
vi.mock("./google", () => ({
  googleAccessToken: async () => "synthetic-provider-token",
}));
vi.mock("./supabase", () => ({
  serviceClient: () => ({
    rpc: f.rpc,
    from: (table: string) => {
      const data =
        table === "studios"
          ? [{ id: "synthetic-studio", timezone: "UTC", settings: {} }]
          : table === "calendar_projections"
            ? [
                {
                  lesson_id: "synthetic-lesson",
                  external_event_id: "synthetic-event",
                },
              ]
            : table === "lessons"
              ? [
                  {
                    id: "synthetic-lesson",
                    studio_id: "synthetic-studio",
                    student_id: null,
                    starts_at: "2099-01-01T15:00:00Z",
                    ends_at: "2099-01-01T16:00:00Z",
                    status: "scheduled",
                    version: 1,
                  },
                ]
              : [];
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        in: () => query,
        update: () => {
          f.writes.push(table);
          return query;
        },
        upsert: () => {
          f.writes.push(table);
          return query;
        },
        insert: () => {
          f.writes.push(table);
          return query;
        },
        abortSignal: () => query,
        then: (resolve: Resolve) => resolve({ data, error: null }),
      };
      return query;
    },
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  f.calendarFailure = true;
  f.gmailStatus = 200;
  f.writes.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  f.rpc.mockImplementation(
    (name: string, args: { p_events?: { id: string }[] }) => {
      if (name === "observe_protected_calendar_sources")
        return Promise.resolve({
          data: args.p_events!.map((event) => ({
            eventId: event.id,
            state: "unprotected",
          })),
          error: null,
        });
      const result = Promise.resolve({
        data: null,
        error: {
          code: "P0001",
          message:
            "REVIEW_REQUIRED: synchronization_review_required; synthetic-private-message",
        },
      });
      return Object.assign(result, { abortSignal: () => result });
    },
  );
  vi.stubGlobal("Netlify", {
    env: {
      get: (key: string) =>
        key === "WORKER_PROVIDER_INTAKE_ENABLED" ? "true" : undefined,
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("calendar/v3/calendars/") && !url.includes("/events"))
        return Response.json({ id: "synthetic-canonical-calendar" });
      if (url.includes("calendar/v3/calendars/"))
        return Response.json({
          items: f.calendarFailure
            ? [
                {
                  id: "synthetic-event",
                  status: "cancelled",
                  etag: "synthetic-version",
                },
              ]
            : [],
        });
      if (
        url.startsWith(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages?",
        )
      ) {
        if (f.gmailStatus === -1)
          throw new DOMException("synthetic-private-timeout", "TimeoutError");
        return Response.json(
          f.gmailStatus === 200
            ? { messages: [] }
            : { error: { message: "synthetic-private-provider-error" } },
          { status: f.gmailStatus },
        );
      }
      throw Error("Unexpected provider request");
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function outcomes() {
  const telemetry = workerTelemetry("provider-intake", "synthetic-execution"),
    events: WorkerObservation[] = [];
  telemetry.persistWith(async (value) => {
    events.push(value);
  });
  let failure: ReturnType<typeof safeWorkerError> | null = null;
  try {
    await runProviderIntake(telemetry);
    telemetry.stage("completion");
  } catch (error) {
    failure = telemetry.failure(error);
  }
  await telemetry.flush();
  return { events, failure };
}
it("retains a Calendar review hold while marking the later successful Gmail stage completed", async () => {
  const { events, failure } = await outcomes();
  expect(events).toContainEqual({
    event: "stage_failed",
    stage: "calendar_processing",
    category: "database",
  });
  expect(
    events.filter(
      (e) => e.stage === "gmail_processing" && e.event === "stage_failed",
    ),
  ).toEqual([]);
  expect(events).toContainEqual({
    event: "stage_completed",
    stage: "gmail_processing",
    category: undefined,
  });
  expect(events).toContainEqual({
    event: "stage_failed",
    stage: "completion",
    category: "database",
  });
  expect(failure).toMatchObject({ category: "database", retryable: false });
  expect(f.rpc).toHaveBeenCalledWith(
    "command_change_lesson_state",
    expect.objectContaining({ p_queue_calendar: false }),
  );
});
it("retains genuine Gmail permission failure after Calendar succeeds", async () => {
  f.calendarFailure = false;
  f.gmailStatus = 403;
  const { events, failure } = await outcomes();
  expect(events).toContainEqual({
    event: "stage_completed",
    stage: "calendar_processing",
    category: undefined,
  });
  expect(events).toContainEqual({
    event: "stage_failed",
    stage: "gmail_processing",
    category: "gmail_read_permission",
  });
  expect(failure).toMatchObject({
    category: "gmail_read_permission",
    retryable: false,
  });
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    "synthetic-private-provider-error",
  );
});
it.each([429, 503])(
  "Gmail HTTP %s remains a provider outage, not a reconnect-permission request",
  async (status) => {
    f.calendarFailure = false;
    f.gmailStatus = status;
    const { events, failure } = await outcomes();
    expect(events).toContainEqual({
      event: "stage_failed",
      stage: "gmail_processing",
      category: "provider",
    });
    expect(failure).toMatchObject({ category: "provider", retryable: true });
    expect(f.writes).toEqual([]);
  },
);
it("retains both failed stages while the completion receipt uses the first actual failure", async () => {
  f.gmailStatus = 403;
  const { events, failure } = await outcomes();
  expect(
    events
      .filter((e) => e.event === "stage_failed")
      .map((e) => [e.stage, e.category]),
  ).toEqual([
    ["calendar_processing", "database"],
    ["gmail_processing", "gmail_read_permission"],
    ["completion", "database"],
  ]);
  expect(failure?.category).toBe("database");
});
it("preserves a Gmail timeout category and excludes raw error text", async () => {
  f.calendarFailure = false;
  f.gmailStatus = -1;
  const { events, failure } = await outcomes();
  expect(events).toContainEqual({
    event: "stage_failed",
    stage: "gmail_processing",
    category: "timeout",
  });
  expect(failure).toMatchObject({ category: "timeout", retryable: true });
  expect(JSON.stringify(events)).not.toContain("synthetic-private-timeout");
});
it("closes both successful stages without inventing a partial failure", async () => {
  f.calendarFailure = false;
  const { events, failure } = await outcomes();
  expect(failure).toBeNull();
  expect(events.filter((e) => e.event === "stage_failed")).toEqual([]);
  expect(events).toContainEqual({
    event: "stage_completed",
    stage: "calendar_processing",
    category: undefined,
  });
  expect(events).toContainEqual({
    event: "stage_completed",
    stage: "gmail_processing",
    category: undefined,
  });
  expect(f.rpc).not.toHaveBeenCalled();
});
