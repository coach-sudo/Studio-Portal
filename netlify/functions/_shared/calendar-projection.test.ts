// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lessonCalendarId, projectCalendarItem } from "./calendar-projection";
const lesson = {
  id: "a6000000-0000-4000-8000-000000000001",
  studio_id: "studio",
  version: 2,
  status: "scheduled",
  topic: "Lesson",
  starts_at: "2099-01-01T12:00:00Z",
  ends_at: "2099-01-01T13:00:00Z",
  meeting_provider: "in_person",
};
function client(current = true) {
  const rpc = vi.fn(async (name: string) => ({
    data: name === "calendar_claim_current" ? current : true,
    error: null,
  }));
  const db = {
    rpc,
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({ data: { name: "Studio" }, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data:
              table === "lesson_participants"
                ? [{ email: "affected@example.test" }]
                : [],
            error: null,
          }).then(resolve),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, rpc };
}
const item = (status = "scheduled", external?: string) => ({
  lesson: { ...lesson, status },
  projection: {
    id: "projection",
    claim_token: "lease",
    external_event_id: external,
  },
});
afterEach(() => vi.unstubAllGlobals());
describe("calendar occurrence synchronization recovery", () => {
  it("deletes only an individual event using its current etag", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ id: "one-instance", etag: '"etag"' }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const { db } = client();
    expect(
      await projectCalendarItem(
        db,
        item("cancelled", "one-instance"),
        async () => "token",
        "primary",
      ),
    ).toBe(true);
    expect(fetch.mock.calls[1][0]).toContain("/one-instance?sendUpdates=all");
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: "DELETE",
      headers: { "If-Match": '"etag"' },
    });
  });
  it("refuses a provider recurring master rather than deleting the whole series", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ id: "master", recurrence: ["RRULE:FREQ=WEEKLY"] }),
      );
    vi.stubGlobal("fetch", fetch);
    const { db, rpc } = client();
    expect(
      await projectCalendarItem(
        db,
        item("cancelled", "master"),
        async () => "token",
        "primary",
      ),
    ).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith(
      "finish_calendar_projection",
      expect.objectContaining({
        p_failed: true,
        p_result: expect.objectContaining({
          errorCode: "calendar_series_requires_review",
        }),
      }),
    );
  });
  it("does not write obsolete claims and retains an obtained identity", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ id: "instance", etag: "etag" }));
    vi.stubGlobal("fetch", fetch);
    const { db, rpc } = client(false);
    await projectCalendarItem(
      db,
      item("scheduled", "instance"),
      async () => "token",
      "primary",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith(
      "finish_calendar_projection",
      expect.objectContaining({
        p_result: expect.objectContaining({ id: "instance" }),
      }),
    );
  });
  it("recovers a lost insert response through deterministic identity and updates the existing event", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(
        Response.json({ id: lessonCalendarId(lesson.id), etag: "first-etag" }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: lessonCalendarId(lesson.id), etag: "second-etag" }),
      );
    vi.stubGlobal("fetch", fetch);
    const { db } = client();
    expect(
      await projectCalendarItem(db, item(), async () => "token", "primary"),
    ).toBe(false);
    expect(
      await projectCalendarItem(db, item(), async () => "token", "primary"),
    ).toBe(true);
    expect(JSON.parse(fetch.mock.calls[1][1].body).id).toBe(
      lessonCalendarId(lesson.id),
    );
    expect(fetch.mock.calls[3][1].method).toBe("PATCH");
    expect(
      fetch.mock.calls.filter(([, o]) => o.method === "POST"),
    ).toHaveLength(1);
  });
  it("records recoverable token failures without abandoning a projecting item", async () => {
    const { db, rpc } = client();
    expect(
      await projectCalendarItem(
        db,
        item(),
        async () => {
          throw Error("credential failure");
        },
        "primary",
      ),
    ).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      "finish_calendar_projection",
      expect.objectContaining({
        p_failed: true,
        p_result: expect.objectContaining({
          errorCode: "calendar_sync_failed",
        }),
      }),
    );
  });
});
