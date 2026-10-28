// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  accessibleCalendarPage,
  calendarDiscoveryPage,
} from "./calendar-discovery";
afterEach(() => vi.unstubAllGlobals());
it("keeps bounded preview text valid for PostgreSQL JSON and rejects duplicate identities within one page", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        items: [{ id: "unicode-title", summary: "A" + "😀".repeat(600) }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: "duplicate" }, { id: "duplicate" }] }),
    );
  vi.stubGlobal("fetch", fetcher);
  const page = await calendarDiscoveryPage("token", claim);
  expect(page.items[0].summary.length).toBeLessThanOrEqual(1000);
  expect(JSON.stringify(page.items[0].summary)).not.toMatch(
    /\\ud[89ab][0-9a-f]{2}/i,
  );
  await expect(calendarDiscoveryPage("token", claim)).rejects.toMatchObject({
    code: "invalid_payload",
  });
});
const claim = {
  calendarId: "lesson/calendar@example.test",
  from: "2000-01-01T00:00:00Z",
  to: "2035-01-01T00:00:00Z",
  calendarTimezone: "UTC",
  pageToken: null,
};
it("continues beyond 250, including an empty intermediate page, without treating size as total coverage", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        items: Array.from({ length: 250 }, (_, n) => ({
          id: `event-${n}`,
          status: "confirmed",
          start: { dateTime: "2020-01-01T10:00:00Z" },
          end: { dateTime: "2020-01-01T11:00:00Z" },
        })),
        nextPageToken: "page-two",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ items: [], nextPageToken: "page-three" }),
    )
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: "event-250", status: "cancelled" }] }),
    );
  vi.stubGlobal("fetch", fetcher);
  const first = await calendarDiscoveryPage("private-token", claim),
    second = await calendarDiscoveryPage("private-token", {
      ...claim,
      pageToken: first.nextPageToken,
    }),
    third = await calendarDiscoveryPage("private-token", {
      ...claim,
      pageToken: second.nextPageToken,
    });
  expect(first.items).toHaveLength(250);
  expect(second).toEqual({ items: [], nextPageToken: "page-three" });
  expect(third.items).toHaveLength(1);
  expect(third.nextPageToken).toBeNull();
  const urls = fetcher.mock.calls.map((c) => c[0] as URL);
  expect(urls[0].pathname).toContain("lesson%2Fcalendar%40example.test");
  expect(urls[2].searchParams.get("pageToken")).toBe("page-three");
  expect(urls[0].searchParams.get("singleEvents")).toBe("true");
  expect(urls[0].searchParams.get("showDeleted")).toBe("true");
});
it("retains date-only entries, recurring exceptions and cancellation tombstones as review evidence, without inventing attendance or time", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        timeZone: "Asia/Tokyo",
        items: [
          {
            id: "all-day",
            summary: "Possible coaching",
            start: { date: "2020-01-01" },
            end: { date: "2020-01-02" },
            description: "private provider body",
          },
          {
            id: "exception",
            recurringEventId: "series",
            originalStartTime: { dateTime: "2020-01-01T10:00:00+09:00" },
            start: { dateTime: "2020-01-02T10:00:00+09:00" },
            end: { dateTime: "2020-01-02T11:00:00+09:00" },
          },
          {
            id: "deleted-occurrence",
            status: "cancelled",
            recurringEventId: "series",
            originalStartTime: { date: "2020-01-03" },
          },
          {
            id: "bad-date",
            start: { date: "2020-99-99" },
            end: { date: "2020-99-99" },
          },
        ],
      }),
    ),
  );
  const page = await calendarDiscoveryPage("private-token", claim);
  expect(page.items[0]).toMatchObject({
    startsAt: null,
    endsAt: null,
    startDate: "2020-01-01",
    endDate: "2020-01-02",
    timezone: "Asia/Tokyo",
    reasonCode: "date_only_requires_time",
  });
  expect(page.items[1]).toMatchObject({
    recurringEventId: "series",
    originalStart: "2020-01-01T10:00:00+09:00",
    startsAt: "2020-01-02T01:00:00.000Z",
  });
  expect(page.items[2]).toMatchObject({
    status: "cancelled",
    startsAt: null,
    originalStart: "2020-01-03",
    reasonCode: "cancelled_source_requires_review",
  });
  expect(page.items[3].reasonCode).toBe("invalid_time_requires_review");
  expect(JSON.stringify(page)).not.toMatch(
    /private provider body|completed|attended|private-token/,
  );
});
it("lists accessible calendar metadata by page with explicit read permissions", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      items: [
        {
          id: "one",
          summary: "Studio",
          accessRole: "owner",
          timeZone: "UTC",
          primary: true,
        },
        { id: "two", accessRole: "freeBusyReader" },
        { id: "deleted", accessRole: "reader", deleted: true },
      ],
      nextPageToken: "next-list",
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const page = await accessibleCalendarPage("token", "prior-list");
  expect(page.items).toHaveLength(2);
  expect(page.items[0]).toMatchObject({ selectable: true, primary: true });
  expect(page.items[1].selectable).toBe(false);
  expect(page).toMatchObject({ hasMore: true, nextCursor: "next-list" });
  expect((fetcher.mock.calls[0][0] as URL).searchParams.get("pageToken")).toBe(
    "prior-list",
  );
});
it.each([
  [403, "access_denied"],
  [429, "rate_limited"],
  [503, "provider_unavailable"],
])("sanitizes provider HTTP %s", async (status, code) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { message: "private-token private-student" } },
          { status: Number(status) },
        ),
      ),
  );
  await expect(
    calendarDiscoveryPage("private-token", claim),
  ).rejects.toMatchObject({ code, message: code });
});
it("preserves a retryable timeout failure without exposing its provider details", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("private-token timeout")),
  );
  await expect(calendarDiscoveryPage("token", claim)).rejects.toMatchObject({
    code: "provider_unavailable",
    message: "provider_unavailable",
  });
});
it("rejects invalid payloads and repeated continuation tokens", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ items: [{ summary: "No source identity" }] }),
    )
    .mockResolvedValueOnce(Response.json({ items: [], nextPageToken: "same" }));
  vi.stubGlobal("fetch", fetcher);
  await expect(calendarDiscoveryPage("token", claim)).rejects.toMatchObject({
    code: "invalid_payload",
  });
  await expect(
    calendarDiscoveryPage("token", { ...claim, pageToken: "same" }),
  ).rejects.toMatchObject({ code: "invalid_pagination" });
});
