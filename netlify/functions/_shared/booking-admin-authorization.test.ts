// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  actor: "coach" as string | null,
  authError: false,
  membershipError: false,
  targetStudio: "studio-b",
  memberships: [] as Array<Record<string, string>>,
  queries: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  service: vi.fn(),
  stripe: vi.fn(),
  refund: vi.fn(),
  subscription: vi.fn(),
  google: vi.fn(),
}));
function visible() {
  return {
    id: "e2910000-0000-4000-8000-000000000001",
    studio_id: f.targetStudio,
    version: 1,
    location: "in_person",
    status: "confirmed",
    paid_minor: 6000,
    payment_status: "paid",
    currency: "USD",
    stripe_checkout_session_id: "cs_synthetic",
    stripe_subscription_id: "sub_synthetic",
    lesson_ids: [],
  };
}
vi.mock("./supabase", () => ({
  userClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: f.actor ? { id: f.actor } : null },
        error: f.authError ? Error("Synthetic invalid session") : null,
      }),
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      f.queries.push({ table, filters });
      const q: Record<string, unknown> = {};
      for (const method of ["select", "limit", "not"]) q[method] = () => q;
      q.eq = (key: string, value: unknown) => {
        filters[key] = value;
        return q;
      };
      q.single = async () => ({
        data:
          table === "memberships"
            ? (f.memberships.find((m) =>
                Object.entries(filters).every(
                  ([key, value]) => m[key] === value,
                ),
              ) ?? null)
            : visible(),
        error:
          table === "memberships" && f.membershipError
            ? Error("Synthetic membership failure")
            : null,
      });
      q.then = (resolve: Parameters<Promise<unknown>["then"]>[0]) =>
        Promise.resolve({ data: [], count: 0, error: null }).then(resolve);
      return q;
    },
  }),
  serviceClient: (...args: unknown[]) => f.service(...args),
}));
vi.mock("./google", () => ({
  googleAccessToken: f.google,
  googleCalendarConflicts: f.google,
}));
vi.mock("stripe", () => ({
  default: class SyntheticStripe {
    constructor() {
      f.stripe();
    }
    checkout = {
      sessions: { retrieve: async () => ({ payment_intent: "pi_synthetic" }) },
    };
    refunds = { create: f.refund };
    subscriptions = { update: f.subscription, cancel: f.subscription };
  },
}));
import handler from "../booking-admin";
const actions = [
  {
    resource: "bookings",
    command: "confirm_location",
    payload: { location: "Synthetic studio" },
  },
  { resource: "bookings", command: "cancel", payload: { useCredit: false } },
  { resource: "bookings", command: "refund", payload: {} },
  { resource: "series", command: "update", payload: { status: "paused" } },
  { resource: "offerings", command: "delete", payload: {} },
];
const call = (action = actions[0]) =>
  handler(
    new Request(
      `https://example.test/api/v2/admin/booking/${action.resource}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: action.command,
          id: "e2910000-0000-4000-8000-000000000001",
          expectedVersion: 1,
          payload: action.payload,
        }),
      },
    ),
    {
      params: { resource: action.resource },
      requestId: "synthetic-authority",
    } as never,
  );
beforeEach(() => {
  vi.clearAllMocks();
  f.actor = "coach";
  f.authError = false;
  f.membershipError = false;
  f.targetStudio = "studio-b";
  f.memberships = [{ user_id: "coach", studio_id: "studio-b", role: "coach" }];
  f.queries = [];
  f.refund.mockResolvedValue({ id: "re_synthetic" });
  f.subscription.mockResolvedValue({ id: "sub_synthetic" });
  f.service.mockImplementation(() => ({
    rpc: async () => ({ data: { booking: visible() }, error: null }),
    from: () => {
      const q: Record<string, unknown> = {};
      for (const method of [
        "select",
        "insert",
        "update",
        "delete",
        "eq",
        "in",
        "limit",
        "gt",
      ])
        q[method] = () => q;
      q.single = async () => ({ data: visible(), error: null });
      q.then = (resolve: Parameters<Promise<unknown>["then"]>[0]) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return q;
    },
  }));
  vi.stubGlobal("Netlify", { env: { get: () => "synthetic-provider-config" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
for (const role of ["student", "guardian", "unrelated"])
  it.each(actions)(
    `denies ${role} $resource/$command before privileged or provider work`,
    async (action) => {
      f.actor = role;
      // A visible coach row must not become the current actor's authority.
      f.memberships.push({ user_id: role, studio_id: "studio-b", role });
      expect((await call(action)).status).toBe(403);
      expect(f.service).not.toHaveBeenCalled();
      expect(f.stripe).not.toHaveBeenCalled();
      expect(f.refund).not.toHaveBeenCalled();
      expect(f.google).not.toHaveBeenCalled();
      expect(f.queries.every((query) => query.table === "memberships")).toBe(
        true,
      );
      expect(f.queries[0].filters).toMatchObject({
        user_id: role,
        role: "coach",
      });
    },
  );
it.each(actions)(
  "denies a coach of another studio for $resource/$command",
  async (action) => {
    f.memberships = [
      { user_id: "coach", studio_id: "studio-a", role: "coach" },
      { user_id: "coach", studio_id: "studio-b", role: "student" },
      { user_id: "another-coach", studio_id: "studio-b", role: "coach" },
    ];
    expect((await call(action)).status).toBe(403);
    expect(f.service).not.toHaveBeenCalled();
    expect(f.stripe).not.toHaveBeenCalled();
    expect(f.queries.at(-1)?.filters).toMatchObject({
      user_id: "coach",
      studio_id: "studio-b",
      role: "coach",
    });
  },
);
it.each(actions)(
  "retains target studio coach $resource/$command",
  async (action) => {
    expect((await call(action)).status).toBe(200);
    expect(f.service).toHaveBeenCalledOnce();
    expect(
      f.queries.filter((q) => q.table === "memberships").at(-1)?.filters,
    ).toMatchObject({ user_id: "coach", studio_id: "studio-b", role: "coach" });
  },
);
it("accepts the target studio when a coach belongs to more than one studio", async () => {
  f.memberships.unshift({
    user_id: "coach",
    studio_id: "studio-a",
    role: "coach",
  });
  expect((await call()).status).toBe(200);
  expect(f.service).toHaveBeenCalledOnce();
});
it.each([null, "invalid-session"])(
  "denies unauthenticated actor %s before membership or provider work",
  async (actor) => {
    f.actor = actor;
    f.authError = actor === "invalid-session";
    expect((await call()).status).toBe(401);
    expect(f.queries).toEqual([]);
    expect(f.service).not.toHaveBeenCalled();
    expect(f.stripe).not.toHaveBeenCalled();
  },
);

for (const role of ["student", "guardian", "unrelated"])
  it.each(["check_conflicts", "create_manual"])(
    `denies ${role} %s despite another visible coach row`,
    async (command) => {
      f.actor = role;
      f.memberships.push({ user_id: role, studio_id: "studio-b", role });
      expect(
        (await call({ resource: "bookings", command, payload: {} })).status,
      ).toBe(403);
      expect(f.google).not.toHaveBeenCalled();
      expect(f.service).not.toHaveBeenCalled();
      expect(f.stripe).not.toHaveBeenCalled();
      expect(f.queries[0].filters).toMatchObject({
        user_id: role,
        role: "coach",
      });
    },
  );
it("fails closed when coach membership verification fails", async () => {
  f.membershipError = true;
  expect((await call()).status).toBe(403);
  expect(f.service).not.toHaveBeenCalled();
  expect(f.stripe).not.toHaveBeenCalled();
  expect(f.google).not.toHaveBeenCalled();
});
it("fails closed when the visible record has no target studio", async () => {
  f.targetStudio = "";
  expect((await call()).status).toBe(403);
  expect(f.service).not.toHaveBeenCalled();
  expect(f.stripe).not.toHaveBeenCalled();
});
