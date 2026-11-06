// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  coach: true,
  configured: false,
  target: {
    id: "selected",
    status: "scheduled",
    offering_id: null as string | null,
  } as Record<string, unknown> | null,
  rows: [] as Record<string, unknown>[],
  readError: false,
  google: vi.fn(),
  access: vi.fn(),
  queries: [] as string[],
}));
vi.mock("./supabase", () => ({
  userClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "synthetic-coach" } },
        error: null,
      }),
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const method of ["eq", "limit", "in", "lt", "gt"])
        q[method] = () => q;
      q.select = (columns: string) => {
        fixture.queries.push(`${table}:${columns}`);
        return q;
      };
      q.single = async () => ({
        data: fixture.coach ? { studio_id: "owned-studio" } : null,
        error: null,
      });
      q.maybeSingle = async () => ({
        data: fixture.target,
        error: fixture.readError ? new Error("Synthetic read failed") : null,
      });
      q.then = (resolve: Parameters<Promise<unknown>["then"]>[0]) =>
        Promise.resolve({
          data: fixture.rows,
          error: fixture.readError ? new Error("Synthetic read failed") : null,
        }).then(resolve);
      return q;
    },
  }),
  serviceClient: () => {
    throw Error("Conflict preview cannot write canonical records");
  },
}));
vi.mock("./google", () => ({
  googleAccessToken: fixture.access,
  googleCalendarConflicts: fixture.google,
}));
import handler from "../booking-admin";
const call = async (lessonId: string | undefined = "selected") =>
  handler(
    new Request("https://example.test/api/v2/admin/booking/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "check_conflicts",
        payload: {
          starts_at: "2031-11-10T18:00:00Z",
          ends_at: "2031-11-10T19:00:00Z",
          lesson_id: lessonId,
        },
      }),
    }),
    {
      params: { resource: "bookings" },
      requestId: "synthetic-conflict",
    } as never,
  );
beforeEach(() => {
  fixture.coach = true;
  fixture.configured = false;
  fixture.readError = false;
  fixture.queries = [];
  fixture.target = { id: "selected", status: "scheduled", offering_id: null };
  fixture.rows = [
    {
      id: "other",
      topic: "Private lesson",
      starts_at: "2031-11-10T18:00:00Z",
      ends_at: "2031-11-10T19:00:00Z",
      status: "scheduled",
      offering_id: null,
    },
  ];
  fixture.google.mockReset().mockResolvedValue([]);
  fixture.access.mockReset().mockResolvedValue("synthetic");
  vi.stubGlobal("Netlify", {
    env: {
      get: () => (fixture.configured ? "synthetic-configuration" : undefined),
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("classifies private scheduled overlaps as database-blocked without requiring Google", async () => {
  const response = await call(),
    body = await response.json();
  expect(response.status).toBe(200);
  expect(body.resource).toMatchObject({
    externalCalendarChecked: false,
    conflicts: [
      {
        id: "other",
        source: "studio",
        policy: "private_overlap",
        blocksChange: true,
      },
    ],
  });
  expect(fixture.access).not.toHaveBeenCalled();
  expect(fixture.queries).toContain("lessons:id,status,offering_id");
});
it.each([
  [
    "target class",
    { status: "scheduled", offering_id: "offering" },
    { status: "scheduled", offering_id: null },
  ],
  [
    "target draft",
    { status: "draft", offering_id: null },
    { status: "scheduled", offering_id: null },
  ],
  [
    "other class",
    { status: "scheduled", offering_id: null },
    { status: "scheduled", offering_id: "offering" },
  ],
  [
    "other draft",
    { status: "scheduled", offering_id: null },
    { status: "draft", offering_id: null },
  ],
])(
  "reports %s overlap as advisory without inventing a database exclusion",
  async (_label, target, other) => {
    fixture.target = { id: "selected", ...target };
    fixture.rows = [{ ...fixture.rows[0], ...other }];
    expect((await (await call()).json()).resource.conflicts[0]).toMatchObject({
      policy: "studio_advisory",
      blocksChange: false,
    });
  },
);
it("assumes a new private scheduled lesson only when no existing target was supplied", async () => {
  expect(
    (await (await call("")).json()).resource.conflicts[0].blocksChange,
  ).toBe(true);
  expect(fixture.queries).not.toContain("lessons:id,status,offering_id");
});
it("excludes the current occurrence from its own conflicts", async () => {
  fixture.rows = [{ ...fixture.rows[0], id: "selected" }];
  expect((await (await call()).json()).resource.conflicts).toEqual([]);
});
it("does not expose other-studio target details or proceed to provider reads", async () => {
  fixture.target = null;
  fixture.configured = true;
  expect((await call()).status).toBe(403);
  expect(fixture.access).not.toHaveBeenCalled();
});
it("requires coach authority before target, overlap or provider reads", async () => {
  fixture.coach = false;
  fixture.configured = true;
  expect((await call()).status).toBe(403);
  expect(fixture.queries).toEqual(["memberships:studio_id"]);
  expect(fixture.access).not.toHaveBeenCalled();
});
it("does not convert a database read failure into an empty successful check", async () => {
  fixture.readError = true;
  fixture.configured = true;
  expect((await call()).status).toBeGreaterThanOrEqual(500);
  expect(fixture.access).not.toHaveBeenCalled();
});
it("preserves distinct studio and Google warnings with the same ID and interval", async () => {
  fixture.configured = true;
  fixture.google.mockResolvedValue([
    {
      id: "other",
      summary: "Private lesson",
      start: "2031-11-10T18:00:00Z",
      end: "2031-11-10T19:00:00Z",
    },
  ]);
  const body = await (await call()).json();
  expect(body.resource.externalCalendarChecked).toBe(true);
  expect(
    body.resource.conflicts.map((item: Record<string, unknown>) => [
      item.source,
      item.policy,
      item.blocksChange,
    ]),
  ).toEqual([
    ["studio", "private_overlap", true],
    ["google", "google_busy", false],
  ]);
});
it("returns a sanitized recoverable provider error instead of declaring availability", async () => {
  fixture.configured = true;
  fixture.access.mockRejectedValue(Error("Synthetic private OAuth payload"));
  const response = await call(),
    body = await response.json();
  expect(response.status).toBe(503);
  expect(body).toMatchObject({ code: "CALENDAR_UNAVAILABLE", retryable: true });
  expect(body.message).toContain("Nothing was changed");
  expect(JSON.stringify(body)).not.toContain("private OAuth");
});
