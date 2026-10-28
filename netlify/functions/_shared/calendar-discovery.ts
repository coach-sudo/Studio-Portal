import { z } from "zod";
import {
  calendarInstant as instant,
  calendarDay as day,
} from "./calendar-observation";

const datePart = z.object({
  dateTime: z.string().optional(),
  date: z.string().optional(),
  timeZone: z.string().optional(),
});
const eventsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(1024),
        etag: z.string().max(1024).optional(),
        summary: z.string().optional(),
        status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
        start: datePart.optional(),
        end: datePart.optional(),
        recurringEventId: z.string().max(1024).optional(),
        originalStartTime: datePart.optional(),
      }),
    )
    .max(250)
    .optional(),
  nextPageToken: z.string().max(10000).optional(),
  timeZone: z.string().optional(),
});
const calendarsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(1024),
        summary: z.string().optional(),
        accessRole: z.string(),
        timeZone: z.string().optional(),
        primary: z.boolean().optional(),
        deleted: z.boolean().optional(),
      }),
    )
    .max(100)
    .optional(),
  nextPageToken: z.string().max(10000).optional(),
});
export type DiscoveryFailureCode =
  | "access_denied"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_payload"
  | "invalid_pagination"
  | "checkpoint_unconfirmed";
export class DiscoveryProviderError extends Error {
  constructor(readonly code: DiscoveryFailureCode) {
    super(code);
  }
}
const previewText = (value: string) =>
  value.slice(0, 1000).replace(/[\uD800-\uDBFF]$/u, "");

async function providerJson<T extends z.ZodType>(
  url: URL,
  token: string,
  schema: T,
): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new DiscoveryProviderError("provider_unavailable");
  }
  if (!response.ok) {
    // Never return Google's raw error, payload or OAuth details to the client.
    throw new DiscoveryProviderError(
      response.status === 401 || response.status === 403
        ? "access_denied"
        : response.status === 429
          ? "rate_limited"
          : "provider_unavailable",
    );
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new DiscoveryProviderError("invalid_payload");
  }
}
export async function accessibleCalendarPage(token: string, cursor?: string) {
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
  );
  url.search = new URLSearchParams({
    maxResults: "100",
    minAccessRole: "reader",
    showHidden: "true",
    fields:
      "items(id,summary,accessRole,timeZone,primary,deleted),nextPageToken",
    ...(cursor ? { pageToken: cursor } : {}),
  }).toString();
  const result = await providerJson(url, token, calendarsSchema);
  return {
    items: (result.items || [])
      .filter((row) => !row.deleted)
      .map((row) => ({
        id: row.id,
        label: previewText(row.summary || row.id),
        timezone: row.timeZone || null,
        accessRole: row.accessRole,
        primary: row.primary === true,
        selectable: [
          "reader",
          "writer",
          "writerWithoutPrivateAccess",
          "owner",
        ].includes(row.accessRole),
      })),
    nextCursor: result.nextPageToken || null,
    hasMore: Boolean(result.nextPageToken),
  };
}

export async function calendarDiscoveryPage(
  token: string,
  claim: {
    calendarId: string;
    from: string;
    to: string;
    calendarTimezone: string | null;
    pageToken: string | null;
  },
) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(claim.calendarId)}/events`,
  );
  url.search = new URLSearchParams({
    singleEvents: "true",
    showDeleted: "true",
    orderBy: "startTime",
    timeMin: claim.from,
    timeMax: claim.to,
    maxResults: "250",
    fields:
      "items(id,etag,status,summary,start,end,recurringEventId,originalStartTime),nextPageToken,timeZone",
    ...(claim.pageToken ? { pageToken: claim.pageToken } : {}),
  }).toString();
  const result = await providerJson(url, token, eventsSchema);
  const ids = (result.items || []).map((event) => event.id);
  if (new Set(ids).size !== ids.length)
    throw new DiscoveryProviderError("invalid_payload");
  if (result.nextPageToken && result.nextPageToken === claim.pageToken)
    throw new DiscoveryProviderError("invalid_pagination");
  return {
    nextPageToken: result.nextPageToken || null,
    items: (result.items || []).map((event) => {
      const startsAt = instant(event.start?.dateTime),
        endsAt = instant(event.end?.dateTime),
        startDate = day(event.start?.date),
        endDate = day(event.end?.date),
        cancelled = event.status === "cancelled",
        valid = startsAt && endsAt && Date.parse(endsAt) > Date.parse(startsAt);
      return {
        id: event.id,
        etag: event.etag || null,
        summary: previewText(
          event.summary ||
            (cancelled ? "Cancelled source event" : "Untitled Calendar event"),
        ),
        status: cancelled ? "cancelled" : "active",
        startsAt: valid ? startsAt : null,
        endsAt: valid ? endsAt : null,
        startDate,
        endDate,
        timezone:
          event.start?.timeZone || result.timeZone || claim.calendarTimezone,
        recurringEventId: event.recurringEventId || null,
        originalStart:
          event.originalStartTime?.dateTime ||
          event.originalStartTime?.date ||
          null,
        reasonCode: cancelled
          ? "cancelled_source_requires_review"
          : startDate && endDate
            ? "date_only_requires_time"
            : valid
              ? "event_detected"
              : "invalid_time_requires_review",
      };
    }),
  };
}
