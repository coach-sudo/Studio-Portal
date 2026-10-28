// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { importCalendar, scanGmail } from "./provider-intake";

const f = vi.hoisted(() => ({
  service: vi.fn(),
  writes: [] as Array<{
    table: string;
    method: string;
    value: Record<string, unknown>;
  }>,
  collision: false,
}));
vi.mock("./supabase", () => ({ serviceClient: f.service }));
const student = {
  id: "synthetic-student",
  full_name: "Synthetic Learner",
  email: "learner@example.test",
};
const studio = { id: "synthetic-studio", timezone: "UTC" };
const starts = "2031-11-03T18:00:00Z",
  ends = "2031-11-03T19:00:00Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2031-11-03T18:59:59Z"));
  vi.stubGlobal("Netlify", {
    env: {
      get: (key: string) =>
        key === "WORKER_PROVIDER_INTAKE_ENABLED" ? "true" : undefined,
    },
  });
  f.writes = [];
  f.collision = false;
  f.service.mockReturnValue({
    rpc: (name: string, args: Record<string, unknown>) =>
      Promise.resolve({
        data:
          name === "observe_protected_calendar_sources"
            ? (args.p_events as Array<{ id: string }>).map((event) => ({
                eventId: event.id,
                state: "unprotected",
              }))
            : true,
        error: null,
      }),
    from: (table: string) => {
      let method = "select";
      const q = {
        select: () => q,
        update: () => q,
        eq: () => q,
        in: () => q,
        not: () => q,
        gte: () => q,
        lte: () => q,
        limit: () => {
          if (table === "lessons")
            vi.setSystemTime(new Date("2031-11-03T19:00:01Z"));
          return q;
        },
        insert: (value: Record<string, unknown>) => {
          method = "insert";
          f.writes.push({ table, method, value });
          return q;
        },
        upsert: (value: Record<string, unknown>) => {
          method = "upsert";
          f.writes.push({ table, method, value });
          return q;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({
          data: f.collision ? null : { id: "synthetic-lesson", version: 1 },
          error: f.collision
            ? { code: "23505", message: "Synthetic existing source collision" }
            : null,
        }),
        then: (resolve: Parameters<Promise<unknown>["then"]>[0]) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return q;
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function calendarFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("?fields=id")
        ? Response.json({ id: "synthetic-calendar" })
        : Response.json({
            items: [
              {
                id: "synthetic-event",
                summary: "Lessonface lesson: Synthetic Learner",
                attendees: [{ email: student.email }],
                start: { dateTime: starts },
                end: { dateTime: ends },
              },
            ],
          }),
    ),
  );
}
it("Calendar discovery crossing the end time establishes schedule without attendance", async () => {
  calendarFetch();
  const result = await importCalendar("synthetic-token", studio, [student]);
  expect(result.imported).toBe(1);
  expect(f.writes.find((w) => w.table === "lessons")).toMatchObject({
    method: "insert",
    value: { status: "scheduled" },
  });
  expect(f.writes.find((w) => w.table === "lesson_participants")).toMatchObject(
    { value: { status: "confirmed" } },
  );
  expect(Date.now()).toBeGreaterThan(Date.parse(ends));
});
it("an existing Calendar source collision fails without upserting its completed outcome", async () => {
  calendarFetch();
  f.collision = true;
  await expect(
    importCalendar("synthetic-token", studio, [student]),
  ).rejects.toMatchObject({ code: "23505" });
  expect(
    f.writes.filter((w) => w.table === "lessons").map((w) => w.method),
  ).toEqual(["insert"]);
  expect(f.writes.filter((w) => w.table === "lesson_participants")).toEqual([]);
});
it("Gmail discovery crossing the end time establishes schedule without attendance", async () => {
  const body = `Lessonface lesson confirmed for ${student.full_name} ${student.email} ${starts} 60 minutes`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/messages?")
        ? Response.json({ messages: [{ id: "synthetic-message" }] })
        : Response.json({
            id: "synthetic-message",
            payload: {
              headers: [
                { name: "Subject", value: "Lessonface lesson confirmed" },
              ],
              body: { data: Buffer.from(body).toString("base64url") },
            },
          }),
    ),
  );
  const result = await scanGmail("synthetic-token", studio, [student]);
  expect(result.imported).toBe(1);
  expect(f.writes.find((w) => w.table === "lessons")).toMatchObject({
    method: "insert",
    value: { status: "scheduled" },
  });
  expect(f.writes.find((w) => w.table === "lesson_participants")).toMatchObject(
    { value: { status: "confirmed" } },
  );
});
