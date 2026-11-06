import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { getSession: fixture.getSession } },
}));
import { studioCommand } from "./bookingCommands";
const session = (id = "coach", token = `synthetic-${id}`) => ({
  data: { session: { user: { id }, access_token: token } },
  error: null,
});
const input = () => ({
  command: "review",
  entityType: "lesson",
  entityId: "synthetic-lesson",
  expectedVersion: 1,
  nextStatus: "scheduled",
  reason: "Review source evidence",
  payload: { value: "same" },
});
type Resolvers<T> = Parameters<ConstructorParameters<typeof Promise<T>>[0]>;
type Pending = {
  body: ReturnType<typeof input> & { idempotencyKey: string };
  authorization: string;
  finish: Resolvers<Response>[0];
  fail: Resolvers<Response>[1];
};
let pending: Pending[],
  active: Promise<unknown>[],
  fetchMock: ReturnType<typeof vi.fn>;
function submit(value = input(), domain = "synthetic") {
  const request = studioCommand(domain, value);
  active.push(request);
  return request;
}
async function reached(count: number) {
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(count));
}
beforeEach(() => {
  pending = [];
  active = [];
  fixture.getSession.mockReset().mockResolvedValue(session());
  fetchMock = vi.fn(
    (_url: string, init: NonNullable<Parameters<typeof fetch>[1]>) =>
      new Promise<Response>((finish, fail) => {
        pending.push({
          body: JSON.parse(String(init.body)),
          authorization: new Headers(init.headers).get("Authorization")!,
          finish,
          fail,
        });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  for (const request of pending)
    request.finish(Response.json({ cleanup: true }));
  await Promise.allSettled(active);
  vi.unstubAllGlobals();
});
describe("studio command request boundaries", () => {
  it("does not send a recovery envelope after its owning actor changes", async () => {
    fixture.getSession.mockResolvedValue(session("other-coach"));
    await expect(
      studioCommand("lessons", input(), "original-coach"),
    ).rejects.toThrow(/signed-in account changed/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixture.getSession).toHaveBeenCalledOnce();
  });
  it("uses the matching actor's captured refreshed token for receipt recovery", async () => {
    fixture.getSession.mockResolvedValue(
      session("coach", "synthetic-refreshed"),
    );
    const request = studioCommand("lessons", input(), "coach");
    active.push(request);
    await reached(1);
    expect(pending[0].authorization).toBe("Bearer synthetic-refreshed");
    pending[0].finish(Response.json({ receipt: "original-owner" }));
    await expect(request).resolves.toEqual({ receipt: "original-owner" });
  });
  it("coalesces identical simultaneous commands without generating a second wire command", async () => {
    const first = submit(),
      second = submit();
    await reached(1);
    expect(pending[0].body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    pending[0].finish(Response.json({ receipt: "same" }));
    expect(await first).toEqual(await second);
    expect(fixture.getSession).toHaveBeenCalledTimes(2);
  });
  it("keeps an identical explicit replay key on one in-flight wire request", async () => {
    const value = { ...input(), idempotencyKey: "stable-key" };
    const first = submit(value),
      second = submit(value);
    await reached(1);
    expect(pending[0].body.idempotencyKey).toBe("stable-key");
    pending[0].finish(Response.json({ receipt: "same" }));
    expect(await first).toEqual(await second);
  });
  it("does not share delayed coach results with a different session", async () => {
    const coach = submit();
    await reached(1);
    fixture.getSession.mockResolvedValue(session("student"));
    const student = submit();
    await reached(2);
    expect(pending.map((p) => p.authorization)).toEqual([
      "Bearer synthetic-coach",
      "Bearer synthetic-student",
    ]);
    pending[0].finish(Response.json({ owner: "coach" }));
    pending[1].finish(Response.json({ owner: "student" }));
    expect(await coach).toEqual({ owner: "coach" });
    expect(await student).toEqual({ owner: "student" });
  });
  it("isolates a refreshed token for the same principal", async () => {
    const first = submit();
    await reached(1);
    fixture.getSession.mockResolvedValue(
      session("coach", "synthetic-refreshed"),
    );
    const refreshed = submit();
    await reached(2);
    pending[0].finish(Response.json({ request: "old" }));
    pending[1].finish(Response.json({ request: "refreshed" }));
    expect(await first).toEqual({ request: "old" });
    expect(await refreshed).toEqual({ request: "refreshed" });
  });
  it("rejects a signed-out invocation instead of joining a signed-in request", async () => {
    const first = submit();
    await reached(1);
    fixture.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    await expect(submit()).rejects.toThrow("Sign in to make this change.");
    expect(fetchMock).toHaveBeenCalledOnce();
    pending[0].finish(Response.json({ receipt: "coach" }));
    await first;
  });
  it("rejects auth lookup failure without disclosing its raw error or sending a command", async () => {
    fixture.getSession.mockResolvedValue({
      ...session(),
      error: new Error("synthetic-private-auth-detail"),
    });
    await expect(submit()).rejects.toThrow(/^Sign in to make this change\.$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ["expectedVersion", 2],
    ["reason", "Different review"],
    ["nextStatus", "cancelled"],
    ["entityType", "booking"],
    ["entityId", "other-record"],
    ["command", "correct"],
    ["idempotencyKey", "explicit-other-key"],
    ["payload", { value: "different" }],
  ])(
    "sends changed %s separately instead of returning the first command's result",
    async (field, value) => {
      const first = submit();
      await reached(1);
      const changed = submit({ ...input(), [String(field)]: value });
      await reached(2);
      expect(pending[1].body[String(field) as keyof Pending["body"]]).toEqual(
        value,
      );
      pending[0].finish(Response.json({ receipt: "first" }));
      pending[1].finish(Response.json({ receipt: "changed" }));
      expect(await first).toEqual({ receipt: "first" });
      expect(await changed).toEqual({ receipt: "changed" });
    },
  );
  it("keeps different domains separate", async () => {
    const first = submit();
    await reached(1);
    const second = submit(input(), "other");
    await reached(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/v2/synthetic",
      "/api/v2/other",
    ]);
    pending[0].finish(Response.json({ domain: "first" }));
    pending[1].finish(Response.json({ domain: "other" }));
    await Promise.all([first, second]);
  });
  it("lets the server reject changed-payload reuse of an explicit key", async () => {
    const value = { ...input(), idempotencyKey: "same-key" };
    const first = submit(value);
    await reached(1);
    const changed = submit({ ...value, expectedVersion: 2 });
    const rejection = expect(changed).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    });
    await reached(2);
    expect(pending.map((p) => p.body.idempotencyKey)).toEqual([
      "same-key",
      "same-key",
    ]);
    pending[1].finish(
      Response.json(
        {
          code: "IDEMPOTENCY_CONFLICT",
          message: "Request changed.",
          retryable: false,
          correlationId: "synthetic",
        },
        { status: 409 },
      ),
    );
    pending[0].finish(Response.json({ receipt: "first" }));
    await first;
    await rejection;
  });
  it("snapshots nested payload and metadata before a delayed auth lookup, then uses its token once", async () => {
    let finishAuth!: Resolvers<ReturnType<typeof session>>[0];
    fixture.getSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAuth = resolve;
        }),
    );
    const value = input(),
      first = submit(value);
    value.payload.value = "edited while waiting";
    value.reason = "Edited reason";
    value.expectedVersion = 9;
    fixture.getSession.mockResolvedValue(session("student"));
    finishAuth(session());
    await reached(1);
    expect(pending[0]).toMatchObject({
      authorization: "Bearer synthetic-coach",
      body: {
        payload: { value: "same" },
        reason: "Review source evidence",
        expectedVersion: 1,
      },
    });
    expect(fixture.getSession).toHaveBeenCalledOnce();
    pending[0].finish(Response.json({ receipt: "original" }));
    await first;
  });
  it("releases a network failure so an identical explicit key can recover its receipt", async () => {
    const value = { ...input(), idempotencyKey: "recover-key" };
    const first = submit(value),
      failure = expect(first).rejects.toThrow("Synthetic response lost");
    await reached(1);
    pending[0].fail(new Error("Synthetic response lost"));
    await failure;
    const retry = submit(value);
    await reached(2);
    expect(pending[1].body.idempotencyKey).toBe("recover-key");
    pending[1].finish(Response.json({ receipt: "committed" }));
    expect(await retry).toEqual({ receipt: "committed" });
  });
  it("releases structured HTTP failures so corrected or retried requests reach the server", async () => {
    const first = submit(),
      failure = expect(first).rejects.toMatchObject({
        status: 503,
        retryable: true,
      });
    await reached(1);
    pending[0].finish(new Response("unavailable", { status: 503 }));
    await failure;
    const retry = submit();
    await reached(2);
    pending[1].finish(Response.json({ receipt: "recovered" }));
    expect(await retry).toEqual({ receipt: "recovered" });
  });
  it("an older session's failure does not evict a newer session's active request", async () => {
    const first = submit(),
      failure = expect(first).rejects.toThrow("Synthetic old failure");
    await reached(1);
    fixture.getSession.mockResolvedValue(session("student"));
    const second = submit();
    await reached(2);
    pending[0].fail(new Error("Synthetic old failure"));
    await failure;
    const repeated = submit();
    await vi.waitFor(() => expect(fixture.getSession).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending[1].finish(Response.json({ receipt: "student" }));
    expect(await second).toEqual(await repeated);
  });
  it("does not turn completed in-flight coalescing into a persistent response cache", async () => {
    const first = submit();
    await reached(1);
    pending[0].finish(Response.json({ receipt: "first" }));
    await first;
    const later = submit();
    await reached(2);
    pending[1].finish(Response.json({ receipt: "later" }));
    expect(await later).toEqual({ receipt: "later" });
  });
});
