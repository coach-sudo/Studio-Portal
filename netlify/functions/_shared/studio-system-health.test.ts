// @vitest-environment node
import type { Context } from "@netlify/functions";
import { beforeEach, expect, it, vi } from "vitest";
import route from "../studio-system-health";

const mocks = vi.hoisted(() => ({
  actor: { id: "00000000-0000-4000-8000-000000000004" },
  verify: vi.fn(),
  membership: vi.fn(),
  eq: vi.fn(),
  read: vi.fn(),
  check: vi.fn(),
  rpc: vi.fn(),
  service: vi.fn(),
}));
vi.mock("./supabase", () => ({
  typedUserClient: () => ({
    auth: { getUser: mocks.verify },
    from: () => {
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => {
          mocks.eq(...args);
          return query;
        },
        maybeSingle: mocks.membership,
      };
      return query;
    },
  }),
  serviceClient: mocks.service,
}));
vi.mock("./studio-health", () => ({
  googleConfigured: () => true,
  readStudioHealth: mocks.read,
  runStudioHealth: mocks.check,
  healthRpc: mocks.rpc,
}));
vi.mock("./worker-controls", () => ({ workerEnabled: () => true }));

const studio = "00000000-0000-4000-8000-000000000001";
const issue = "00000000-0000-4000-8000-000000000003";
function request(
  action: string,
  authorization = "Bearer synthetic",
  body?: object,
) {
  return route(
    new Request(
      "https://local.test/api/v2/studio-health/" + action + "?studio=" + studio,
      {
        method: action === "status" ? "GET" : "POST",
        headers: { authorization },
        body: body ? JSON.stringify(body) : undefined,
      },
    ),
    { params: { action } } as unknown as Context,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ data: { user: mocks.actor } });
  mocks.membership.mockResolvedValue({ data: { id: "coach membership" } });
  mocks.read.mockResolvedValue({ state: "available" });
  mocks.check.mockResolvedValue({ state: "completed" });
  mocks.rpc.mockResolvedValue("queued");
});

it.each([
  "adult student",
  "dependent student",
  "financial guardian",
  "schedule-only contact",
  "unrelated user",
  "other studio coach",
])(
  "denies %s when the selected studio has no matching coach membership",
  async () => {
    mocks.membership.mockResolvedValue({ data: null });
    for (const action of ["status", "check", "retry"])
      expect((await request(action)).status).toBe(403);
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith("studio_id", studio);
    expect(mocks.eq).toHaveBeenCalledWith("user_id", mocks.actor.id);
    expect(mocks.eq).toHaveBeenCalledWith("role", "coach");
  },
);
it("requires an authenticated actor and separates the check from recovery", async () => {
  expect((await request("status", "")).status).toBe(401);
  expect((await request("check")).status).toBe(200);
  expect(mocks.check).toHaveBeenCalledWith(undefined, studio, false);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(
    (await request("retry", "Bearer synthetic", { service: "stripe", issue }))
      .status,
  ).toBe(400);
  const retry = await request("retry", "Bearer synthetic", {
    service: "calendar",
    issue,
  });
  expect(await retry.json()).toMatchObject({ result: "queued" });
  expect(mocks.rpc).toHaveBeenCalledWith(
    undefined,
    "studio_health_retry",
    expect.objectContaining({
      p_actor: mocks.actor.id,
      p_studio: studio,
      p_issue: issue,
      p_service: "calendar",
    }),
  );
});
