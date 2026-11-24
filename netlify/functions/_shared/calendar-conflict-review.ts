import { activeCalendarRoles } from "./calendar-roles";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.generated";
import {
  googleAccessToken,
  GoogleAuthorizationError,
  GoogleAvailabilityError,
} from "./google";
import { AppError } from "./http";
import { healthRpc, readStudioHealth } from "./studio-health";
import { workerEnabled } from "./worker-controls";

const eventSchema = z.object({
  id: z.string(),
  etag: z.string().min(1).max(256),
  status: z.enum(["confirmed", "tentative"]),
  htmlLink: z.url().optional(),
  start: z.object({ dateTime: z.iso.datetime({ offset: true }) }),
  end: z.object({ dateTime: z.iso.datetime({ offset: true }) }),
  recurrence: z.array(z.string()).optional(),
  recurringEventId: z.string().optional(),
});

export const calendarReviewRequest = z
  .object({
    issue: z.uuid(),
    confirm: z
      .object({
        version: z.number().int().nonnegative(),
        etag: z.string().min(1).max(256),
      })
      .strict()
      .optional(),
  })
  .strict();

export async function reviewCalendarConflict(
  db: SupabaseClient<Database>,
  studio: string,
  actor: string,
  correlation: string,
  { issue, confirm }: z.infer<typeof calendarReviewRequest>,
) {
  const get = (name: string) => Netlify.env.get(name);
  const studioId = get("STUDIO_ID");
  const owner = studioId
    ? studio === studioId
    : (await healthRpc<string | null>(db, "studio_health_studio_slug", {
        p_studio: studio,
      })) === (get("STUDIO_SLUG") || "stage-story");
  if (!owner) throw AppError.forbidden();

  const health = await readStudioHealth(db, studio, issue);
  const problem = health.issues.find(
    (item) =>
      item.id === issue &&
      item.category === "calendar_review" &&
      !item.resolvedAt,
  );
  if (!problem?.lessonId) return { state: "unavailable" } as const;
  const [lessonResult, projectionResult] = await Promise.all([
    db
      .from("lessons")
      .select("id,version,status,starts_at,ends_at")
      .eq("studio_id", studio)
      .eq("id", problem.lessonId)
      .maybeSingle(),
    db
      .from("calendar_projections")
      .select("external_event_id,last_error")
      .eq("lesson_id", problem.lessonId)
      .maybeSingle(),
  ]);
  if (lessonResult.error || projectionResult.error)
    throw new Error("Calendar review source unavailable.");
  const lesson = lessonResult.data;
  const projection = projectionResult.data;
  if (!lesson || !projection?.external_event_id)
    return { state: "unavailable" } as const;

  const signal = AbortSignal.timeout(4500);
  let response: Response;
  try {
    const token = await googleAccessToken(signal);
    const calendar = encodeURIComponent((await activeCalendarRoles()).outgoing);
    const eventId = encodeURIComponent(projection.external_event_id);
    response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${eventId}?fields=id,etag,status,htmlLink,start,end,recurrence,recurringEventId`,
      {
        headers: { Authorization: "Bearer " + token },
        signal,
        redirect: "error",
      },
    );
  } catch (error) {
    if (error instanceof GoogleAuthorizationError)
      return { state: error.reason } as const;
    if (error instanceof GoogleAvailabilityError && error.throttled)
      return { state: "throttled" } as const;
    return { state: "provider_unavailable" } as const;
  }
  if (response.status === 401) return { state: "authorization" } as const;
  if (response.status === 403) {
    const body = (await response.json().catch(() => null)) as {
      error?: { errors?: { reason?: string }[] };
    } | null;
    const throttled = body?.error?.errors?.some(({ reason }) =>
      ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(
        reason ?? "",
      ),
    );
    return { state: throttled ? "throttled" : "permission" } as const;
  }
  if ([404, 410].includes(response.status))
    return { state: "event_missing" } as const;
  if (response.status === 429) return { state: "throttled" } as const;
  if (!response.ok) return { state: "provider_unavailable" } as const;
  const event = eventSchema.safeParse(await response.json().catch(() => null));
  if (
    !event.success ||
    event.data.id !== projection.external_event_id ||
    event.data.recurrence?.length ||
    event.data.recurringEventId ||
    Date.parse(event.data.start.dateTime) >= Date.parse(event.data.end.dateTime)
  ) {
    return { state: "ambiguous" } as const;
  }

  const historical =
    lesson.status === "completed" && Date.parse(lesson.ends_at) < Date.now();
  const timingMatches =
    Date.parse(lesson.starts_at) === Date.parse(event.data.start.dateTime) &&
    Date.parse(lesson.ends_at) === Date.parse(event.data.end.dateTime);
  const canConfirm =
    !workerEnabled("provider-intake") &&
    projection.last_error === "synchronization_review_required" &&
    (historical || (lesson.status === "scheduled" && timingMatches));
  if (confirm) {
    if (
      !canConfirm ||
      confirm.version !== lesson.version ||
      confirm.etag !== event.data.etag
    )
      return { state: "changed" } as const;
    const { data, error } = await db.rpc("confirm_calendar_conflict_review", {
      p_studio: studio,
      p_actor: actor,
      p_lesson: lesson.id,
      p_version: lesson.version,
      p_event_id: event.data.id,
      p_event_revision: event.data.etag,
      p_starts_at: event.data.start.dateTime,
      p_ends_at: event.data.end.dateTime,
      p_correlation: correlation,
    });
    if (error) throw new Error("Calendar review could not be confirmed.");
    return {
      state:
        data === "reviewed" || data === "already_reviewed"
          ? "reviewed"
          : "changed",
    } as const;
  }
  const eventUrl = event.data.htmlLink && new URL(event.data.htmlLink);
  const googleEventLink =
    eventUrl &&
    (eventUrl.origin === "https://calendar.google.com" ||
      (eventUrl.origin === "https://www.google.com" &&
        eventUrl.pathname === "/calendar/event"));
  return {
    state: "comparison",
    historical,
    canConfirm,
    timingMatches,
    lesson: { start: lesson.starts_at, end: lesson.ends_at },
    event: { start: event.data.start.dateTime, end: event.data.end.dateTime },
    eventUrl: googleEventLink ? eventUrl.href : null,
    version: lesson.version,
    etag: event.data.etag,
  } as const;
}
