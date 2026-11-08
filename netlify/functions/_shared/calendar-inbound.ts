import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertWorkerEnabled } from "./worker-controls";

const tokenField = z.string().min(1).max(10000);
const sourceId = z.string().min(1).max(1024);
const datePart = z.object({
  dateTime: z.string().max(100).optional(),
  date: z.string().max(10).optional(),
});
const calendarPage = z.object({
  items: z
    .array(
      z.object({
        id: sourceId,
        etag: sourceId.optional(),
        status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
        transparency: z.enum(["opaque", "transparent"]).optional(),
        start: datePart.optional(),
        end: datePart.optional(),
        recurringEventId: sourceId.optional(),
        originalStartTime: datePart.optional(),
      }),
    )
    .max(50)
    .default([]),
  nextPageToken: tokenField.optional(),
  nextSyncToken: tokenField.optional(),
});
const checkpointSchema = z.object({
  revision: z.number().int().nonnegative(),
  pageToken: tokenField.nullable(),
  syncToken: tokenField.nullable(),
});
const commitSchema = z.discriminatedUnion("committed", [
  z.object({ committed: z.literal(false) }),
  z.object({
    committed: z.literal(true),
    imported: z.number(),
    review: z.number(),
  }),
]);

// Keep the normalization used by the draft historical review observations.
function calendarInstant(value?: string) {
  if (!value || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const instant = Date.parse(value);
  const day = Date.parse(value.slice(0, 10) + "T00:00:00Z");
  return Number.isFinite(instant) &&
    Number.isFinite(day) &&
    new Date(day).toISOString().slice(0, 10) === value.slice(0, 10)
    ? new Date(instant).toISOString()
    : null;
}

async function googleCalendarRead(url: string, token: string) {
  assertWorkerEnabled("provider-intake");
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
}

export async function syncInboundCalendar(
  db: Pick<SupabaseClient, "rpc">,
  studioId: string,
  configuredCalendar: string,
  token: string,
) {
  const root = "https://www.googleapis.com/calendar/v3/calendars/";
  // Resolve an account-relative alias before using it as a durable key.
  let calendar = sourceId.parse(configuredCalendar);
  if (calendar === "primary") {
    const metadata = await googleCalendarRead(
      root + "primary?fields=id",
      token,
    );
    if (!metadata.ok)
      throw new Error(`Calendar identity check failed (${metadata.status})`);
    calendar = z.object({ id: sourceId }).parse(await metadata.json()).id;
    if (calendar === "primary")
      throw new Error("Calendar identity is unresolved");
  }

  let imported = 0;
  let review = 0;
  // A bounded worker invocation can resume the current scan on its next tick.
  for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
    assertWorkerEnabled("provider-intake");
    const current = await db.rpc("calendar_inbound_checkpoint", {
      p_studio: studioId,
      p_calendar: calendar,
    });
    if (current.error) throw current.error;
    const checkpoint = checkpointSchema.parse(current.data);
    const query = new URLSearchParams({
      maxResults: "50",
      showDeleted: "true",
      singleEvents: "false",
      fields:
        "items(id,etag,status,transparency,start,end,recurringEventId,originalStartTime),nextPageToken,nextSyncToken",
    });
    if (checkpoint.syncToken) query.set("syncToken", checkpoint.syncToken);
    if (checkpoint.pageToken) query.set("pageToken", checkpoint.pageToken);
    const response = await googleCalendarRead(
      `${root}${encodeURIComponent(calendar)}/events?${query}`,
      token,
    );
    const reset =
      (response.status === 410 &&
        Boolean(checkpoint.syncToken || checkpoint.pageToken)) ||
      (response.status === 400 && Boolean(checkpoint.pageToken));
    if (!reset && !response.ok)
      throw new Error(`Calendar sync request failed (${response.status})`);
    const page = reset ? null : calendarPage.parse(await response.json());
    const observations = (page?.items ?? []).map((event) => ({
      id: event.id,
      etag: event.etag ?? null,
      status: event.status ?? "confirmed",
      transparency: event.transparency ?? "opaque",
      startsAt: calendarInstant(event.start?.dateTime),
      endsAt: calendarInstant(event.end?.dateTime),
      startDate: event.start?.date ?? null,
      endDate: event.end?.date ?? null,
      recurringEventId: event.recurringEventId ?? null,
      originalStart:
        calendarInstant(event.originalStartTime?.dateTime) ??
        event.originalStartTime?.date ??
        null,
    }));
    if (
      new Set(observations.map((event) => event.id)).size !==
      observations.length
    )
      throw new Error("Calendar returned duplicate source IDs on a page");
    assertWorkerEnabled("provider-intake");
    const committed = await db.rpc("commit_calendar_inbound_page", {
      p_studio: studioId,
      p_calendar: calendar,
      p_revision: checkpoint.revision,
      p_events: observations,
      p_next_page: page?.nextPageToken ?? null,
      p_next_sync: page?.nextSyncToken ?? null,
      p_reset: reset,
    });
    if (committed.error) throw committed.error;
    const result = commitSchema.parse(committed.data);
    if (!result.committed) break;
    imported += result.imported;
    review += result.review;
    if (page?.nextSyncToken) break;
  }
  return { imported, review };
}
