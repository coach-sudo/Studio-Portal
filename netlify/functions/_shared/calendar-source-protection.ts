import { z } from "zod";
import { calendarDay, calendarInstant } from "./calendar-observation";
import type { Json } from "../../../src/types/database.generated";
import type { serviceClient } from "./supabase";

export interface ProtectedCalendarEvent {
  id?: string;
  etag?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}
const observationSchema = z.object({
  id: z.string().min(1).max(1024),
  etag: z.string().max(1024).nullable(),
  status: z.enum(["active", "cancelled"]),
  startsAt: z.string().max(100).nullable(),
  endsAt: z.string().max(100).nullable(),
  startDate: z.string().max(100).nullable(),
  endDate: z.string().max(100).nullable(),
});
export function calendarSourceObservation(event: ProtectedCalendarEvent) {
  if (
    event.status !== undefined &&
    !["active", "confirmed", "tentative", "cancelled"].includes(event.status)
  )
    throw new Error(
      "PROVIDER_UNAVAILABLE: Calendar source status is malformed. No source changes were applied.",
    );
  const parsed = observationSchema.safeParse({
    id: event.id!,
    etag: event.etag ?? null,
    status: event.status === "cancelled" ? "cancelled" : "active",
    startsAt: event.start?.dateTime ?? null,
    endsAt: event.end?.dateTime ?? null,
    startDate: event.start?.date ?? null,
    endDate: event.end?.date ?? null,
  });
  if (!parsed.success)
    throw new Error(
      "PROVIDER_UNAVAILABLE: Calendar source identity or version is malformed. No source changes were applied.",
    );
  const startsAt = calendarInstant(parsed.data.startsAt),
    endsAt = calendarInstant(parsed.data.endsAt),
    valid = startsAt && endsAt && Date.parse(endsAt) > Date.parse(startsAt);
  return {
    ...parsed.data,
    startsAt: valid ? startsAt : null,
    endsAt: valid ? endsAt : null,
    startDate: calendarDay(parsed.data.startDate),
    endDate: calendarDay(parsed.data.endDate),
  };
}

const metadataSchema = z.object({ id: z.string().min(1).max(1024) });
export async function resolveCalendarIdentity(
  token: string,
  configured: string,
) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(configured)}?fields=id`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error();
    const value = metadataSchema.parse(await response.json());
    if (value.id === "primary") throw new Error();
    return value.id;
  } catch {
    throw new Error(
      "PROVIDER_UNAVAILABLE: Calendar identity could not be verified. Review Calendar read permissions; no source changes were applied.",
    );
  }
}

const protectionSchema = z.array(
  z.discriminatedUnion("state", [
    z.object({ eventId: z.string().min(1), state: z.literal("unprotected") }),
    z.object({
      eventId: z.string().min(1),
      state: z.enum(["protected", "ambiguous"]),
      decisionId: z.string().uuid(),
      lessonId: z.string().uuid().nullable(),
      disposition: z.enum(["linked", "not_lesson", "skipped", "review"]),
      changed: z.boolean(),
    }),
  ]),
);
export type CalendarSourceProtection = Exclude<
  z.infer<typeof protectionSchema>[number],
  { state: "unprotected" }
>;

export async function observeCalendarProtection(
  db: Pick<ReturnType<typeof serviceClient>, "rpc">,
  studioId: string,
  calendarId: string,
  events: ProtectedCalendarEvent[],
) {
  const protectedEvents = new Map<string, CalendarSourceProtection[]>();
  const identified = events.filter(
    (event): event is ProtectedCalendarEvent & { id: string } =>
      Boolean(event.id),
  );
  // A bounded RPC batch is not a scan cap. Deduplicate repeated source IDs
  // conservatively: conflicting versions require a new provider read.
  const byId = new Map<string, ReturnType<typeof calendarSourceObservation>>();
  for (const event of identified) {
    const value = calendarSourceObservation(event),
      prior = byId.get(event.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(value))
      throw new Error(
        "REVIEW_REQUIRED: Calendar returned conflicting versions of one source. Retry the saved scan.",
      );
    byId.set(event.id, value);
  }
  const observations = [...byId.values()];
  for (let offset = 0; offset < observations.length; offset += 250) {
    const batch = observations.slice(offset, offset + 250);
    const result = await Promise.resolve(
      db.rpc("observe_protected_calendar_sources", {
        p_studio: studioId,
        p_calendar: calendarId,
        p_events: batch as Json,
      }),
    ).catch(() => {
      throw new Error(
        "REVIEW_REQUIRED: Historical Calendar protection could not be checked. No source changes were applied.",
      );
    });
    if (result.error)
      throw new Error(
        "REVIEW_REQUIRED: Historical Calendar protection could not be checked. No source changes were applied.",
      );
    const parsed = protectionSchema.safeParse(result.data);
    const requested = new Set(batch.map((event) => event.id));
    if (
      !parsed.success ||
      parsed.data.some((item) => !requested.has(item.eventId)) ||
      requested.size !== new Set(parsed.data.map((item) => item.eventId)).size
    )
      throw new Error(
        "REVIEW_REQUIRED: Historical Calendar protection returned an incomplete response. No source changes were applied.",
      );
    for (const eventId of requested) {
      const items = parsed.data.filter((item) => item.eventId === eventId);
      if (
        items.some((item) => item.state === "unprotected") &&
        items.length !== 1
      )
        throw new Error(
          "REVIEW_REQUIRED: Historical Calendar protection returned conflicting decisions.",
        );
      const held = items.filter(
        (item): item is CalendarSourceProtection =>
          item.state !== "unprotected",
      );
      if (held.length) protectedEvents.set(eventId, held);
    }
  }
  return protectedEvents;
}
