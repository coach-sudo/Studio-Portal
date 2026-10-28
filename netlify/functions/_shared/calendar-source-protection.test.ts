// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  calendarSourceObservation,
  observeCalendarProtection,
  resolveCalendarIdentity,
} from "./calendar-source-protection";
import type { serviceClient } from "./supabase";
afterEach(() => vi.unstubAllGlobals());
const source = {
  id: "synthetic-event",
  etag: "synthetic-etag",
  start: { dateTime: "2020-01-01T15:00:00Z" },
  end: { dateTime: "2020-01-01T16:00:00Z" },
};
const decision = "e8300000-0000-4000-8000-000000000001";
function client(value?: unknown) {
  const rpc = vi.fn(
    async (_name: string, args: { p_events: Array<{ id: string }> }) => ({
      data:
        value ??
        args.p_events.map((event) => ({
          eventId: event.id,
          state: "unprotected",
        })),
      error: null,
    }),
  );
  return {
    rpc,
    db: { rpc } as unknown as Pick<ReturnType<typeof serviceClient>, "rpc">,
  };
}
it("resolves the account-relative alias through a read-only metadata request", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      id: "canonical@example.test",
      privateProviderField: "excluded",
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(await resolveCalendarIdentity("synthetic-token", "primary")).toBe(
    "canonical@example.test",
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "https://www.googleapis.com/calendar/v3/calendars/primary?fields=id",
    expect.objectContaining({
      headers: { Authorization: "Bearer synthetic-token" },
      signal: expect.any(AbortSignal),
    }),
  );
});
it("encodes an explicit calendar ID once for the metadata read", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ id: "shared/calendar@example.test" }));
  vi.stubGlobal("fetch", fetchMock);
  await resolveCalendarIdentity("synthetic", "shared/calendar@example.test");
  expect(fetchMock.mock.calls[0][0]).toContain(
    "shared%2Fcalendar%40example.test?fields=id",
  );
});
it.each([403, 429, 503])(
  "does not turn metadata HTTP %s into an unprotected source assumption",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "synthetic-private-provider-detail" } },
          { status },
        ),
      ),
    );
    await expect(
      resolveCalendarIdentity("synthetic", "primary"),
    ).rejects.toThrow(
      /^PROVIDER_UNAVAILABLE: Calendar identity could not be verified/,
    );
  },
);
it.each([{}, [], { id: 123 }, { id: "primary" }])(
  "rejects incomplete or unresolved metadata %j",
  async (value) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(value)),
    );
    await expect(
      resolveCalendarIdentity("synthetic", "primary"),
    ).rejects.toThrow("Calendar identity could not be verified");
  },
);
it("sanitizes a network/timeout failure before canonical processing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Error("synthetic-private-network-detail");
    }),
  );
  await expect(resolveCalendarIdentity("synthetic", "primary")).rejects.toThrow(
    /^PROVIDER_UNAVAILABLE: Calendar identity could not be verified/,
  );
});
it("normalizes date-only observations without inventing an instant or retaining raw private fields", () => {
  const event = {
    id: "date-only",
    summary: "Synthetic private appointment",
    description: "Excluded body",
    attendees: [{ email: "private@example.test" }],
    start: { date: "2020-01-01" },
    end: { date: "2020-01-02" },
  };
  expect(calendarSourceObservation(event)).toEqual({
    id: "date-only",
    etag: null,
    status: "active",
    startsAt: null,
    endsAt: null,
    startDate: "2020-01-01",
    endDate: "2020-01-02",
  });
});
it("rejects nested source version payloads instead of retaining arbitrary provider data", () => {
  expect(() =>
    calendarSourceObservation({
      ...source,
      etag: { private: "excluded" },
    } as never),
  ).toThrow(
    /^PROVIDER_UNAVAILABLE: Calendar source identity or version is malformed/,
  );
});
it("rejects an unknown provider status instead of treating it as confirmed", () => {
  expect(() =>
    calendarSourceObservation({ ...source, status: "unknown-provider-state" }),
  ).toThrow("Calendar source status is malformed");
});
it("processes all 501 events in bounded batches without a total cap", async () => {
  const { db, rpc } = client();
  const events = Array.from({ length: 501 }, (_, i) => ({
    ...source,
    id: `event-${i}`,
  }));
  expect(
    (await observeCalendarProtection(db, "studio", "canonical", events)).size,
  ).toBe(0);
  expect(rpc.mock.calls.map((call) => call[1].p_events.length)).toEqual([
    250, 250, 1,
  ]);
});
it("keeps exact decisions and cross-calendar ambiguity protected", async () => {
  const { db } = client([
    {
      eventId: source.id,
      state: "protected",
      decisionId: decision,
      lessonId: null,
      disposition: "skipped",
      changed: false,
    },
    {
      eventId: "other",
      state: "ambiguous",
      decisionId: decision,
      lessonId: null,
      disposition: "not_lesson",
      changed: true,
    },
  ]);
  const rows = await observeCalendarProtection(db, "studio", "canonical", [
    source,
    { ...source, id: "other" },
  ]);
  expect(rows.get(source.id)?.[0]).toMatchObject({
    disposition: "skipped",
    changed: false,
  });
  expect(rows.get("other")?.[0].state).toBe("ambiguous");
});
it.each([
  [],
  true,
  [{ eventId: "wrong-event", state: "unprotected" }],
  [
    { eventId: source.id, state: "unprotected" },
    {
      eventId: source.id,
      state: "protected",
      decisionId: decision,
      lessonId: null,
      disposition: "skipped",
      changed: false,
    },
  ],
])(
  "fails closed on missing, extra or contradictory protection responses %j",
  async (value) => {
    const { db } = client(value);
    await expect(
      observeCalendarProtection(db, "studio", "canonical", [source]),
    ).rejects.toThrow(/^REVIEW_REQUIRED:/);
  },
);
it("deduplicates identical provider copies but rejects conflicting versions before any checkpoint", async () => {
  const { db, rpc } = client();
  await observeCalendarProtection(db, "studio", "canonical", [source, source]);
  expect(rpc.mock.calls[0][1].p_events).toHaveLength(1);
  rpc.mockClear();
  await expect(
    observeCalendarProtection(db, "studio", "canonical", [
      source,
      { ...source, etag: "different" },
    ]),
  ).rejects.toThrow("conflicting versions");
  expect(rpc).not.toHaveBeenCalled();
});
it("does not call the protection RPC for an empty event collection", async () => {
  const { db, rpc } = client();
  expect(
    (await observeCalendarProtection(db, "studio", "canonical", [])).size,
  ).toBe(0);
  expect(rpc).not.toHaveBeenCalled();
});
it("sanitizes an RPC error or lost response rather than continuing unprotected", async () => {
  const { db, rpc } = client();
  rpc.mockResolvedValueOnce({
    data: null,
    error: new Error("synthetic-private-database-detail"),
  } as never);
  await expect(
    observeCalendarProtection(db, "studio", "canonical", [source]),
  ).rejects.toThrow("Historical Calendar protection could not be checked");
  rpc.mockRejectedValueOnce(new Error("synthetic-private-transport-detail"));
  await expect(
    observeCalendarProtection(db, "studio", "canonical", [source]),
  ).rejects.toThrow("Historical Calendar protection could not be checked");
});
