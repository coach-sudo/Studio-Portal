import type { SupabaseClient } from "@supabase/supabase-js";
type CalendarEvent = {
  id?: string;
  etag?: string;
  recurrence?: string[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
};
type ClaimedItem = { projection: unknown; lesson: unknown };
type Projection = {
  id: string;
  claim_token: string;
  external_event_id?: string;
  conference_request_id?: string;
};
import type { Tables } from "../../../src/types/database.generated";
/** Recover a successful insert after losing its response without duplicating the event. */
export const lessonCalendarId = (lessonId: string) =>
  `coachd${lessonId.replaceAll("-", "").toLowerCase()}`;
export async function projectCalendarItem(
  db: SupabaseClient,
  item: ClaimedItem,
  accessToken: () => Promise<string>,
  calendarId: string,
) {
  const p = item.projection as Projection,
    l = item.lesson as Tables<"lessons">;
  let result: CalendarEvent = {};
  const finish = async (failed = false, errorCode?: string) => {
    const response = await db.rpc("finish_calendar_projection", {
      p_id: p.id,
      p_token: p.claim_token,
      p_failed: failed,
      p_result: {
        ...result,
        errorCode,
        joinUrl:
          result.hangoutLink ||
          result.conferenceData?.entryPoints?.find(
            (e) => e.entryPointType === "video",
          )?.uri,
      },
    });
    if (response.error) throw response.error;
    return response.data === true;
  };
  try {
    const token = await accessToken();
    const root = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const eventId = p.external_event_id || lessonCalendarId(l.id),
      url = `${root}/${encodeURIComponent(eventId)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const lookup = await fetch(url, { headers });
    const existing = lookup.ok
      ? ((await lookup.json()) as CalendarEvent)
      : null;
    if (!lookup.ok && ![404, 410].includes(lookup.status))
      throw new Error(`calendar_lookup_${lookup.status}`);
    if (existing?.recurrence?.length)
      throw new Error("calendar_series_requires_review");
    if (existing) result = existing;
    if (existing?.etag) headers["If-Match"] = existing.etag;
    const current = await db.rpc("calendar_claim_current", {
      p_id: p.id,
      p_token: p.claim_token,
    });
    if (current.error) throw current.error;
    if (!current.data) return await finish();
    if (["cancelled", "late_cancelled"].includes(l.status)) {
      if (existing) {
        const response = await fetch(`${url}?sendUpdates=all`, {
          method: "DELETE",
          headers,
        });
        if (!response.ok && ![404, 410].includes(response.status))
          throw new Error(`calendar_delete_${response.status}`);
      }
      return await finish();
    }
    if (p.external_event_id && !existing)
      throw new Error("calendar_event_missing_requires_review");
    const [
      { data: participants, error: participantError },
      { data: studio, error: studioError },
    ] = await Promise.all([
      db
        .from("lesson_participants")
        .select("email")
        .eq("lesson_id", l.id)
        .eq("status", "confirmed"),
      db.from("studios").select("name").eq("id", l.studio_id).single(),
    ]);
    if (participantError || studioError) throw participantError || studioError;
    const body: Record<string, unknown> = {
      summary: l.topic,
      start: { dateTime: l.starts_at },
      end: { dateTime: l.ends_at },
      location: l.location_label,
      description: [
        `Managed by ${studio?.name || "Studio"}`,
        l.join_url && l.meeting_provider !== "google_meet"
          ? `Join: ${l.join_url}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
      attendees: (participants || [])
        .filter((p) => p.email)
        .map((p) => ({ email: p.email })),
    };
    if (!existing) body.id = eventId;
    if (l.meeting_provider === "google_meet" && !existing)
      body.conferenceData = {
        createRequest: {
          requestId: p.conference_request_id || `meet-${l.id}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    const check = await db.rpc("calendar_claim_current", {
      p_id: p.id,
      p_token: p.claim_token,
    });
    if (check.error) throw check.error;
    if (!check.data) return await finish();
    const response = await fetch(
      `${existing ? url : root}?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: existing ? "PATCH" : "POST",
        headers,
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw new Error(`calendar_write_${response.status}`);
    result = (await response.json()) as CalendarEvent;
    return await finish();
  } catch (error) {
    await finish(
      true,
      error instanceof Error && /^calendar_/.test(error.message)
        ? error.message
        : "calendar_sync_failed",
    );
    return false;
  }
}
