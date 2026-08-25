import type { Config } from "@netlify/functions";
import { serviceClient } from "./_shared/supabase";

export default async () => {
  const db = serviceClient();
  const maintenanceTime = new Date();
  const runDailyStorageCleanup =
    maintenanceTime.getUTCHours() === 8 &&
    maintenanceTime.getUTCMinutes() < 5;
  const [
    { data: expired, error },
    { data: extended, error: extendError },
    { data: cleaned, error: cleanupError },
  ] = await Promise.all([
    db.rpc("expire_booking_holds"),
    db.rpc("extend_ongoing_series"),
    runDailyStorageCleanup
      ? db.rpc("cleanup_transient_studio_data")
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (error || extendError || cleanupError)
    throw error || extendError || cleanupError;
  const grace = new Date(Date.now() - 7 * 86400000).toISOString(), now = new Date().toISOString();
  const { data: delinquent } = await db.from("bookings").select("id,series_id,offering_id").eq("payment_status", "past_due").lte("updated_at", grace);
  if (delinquent?.length) {
    await db.from("bookings").update({ status: "cancelled", updated_at: now }).in("id", delinquent.map((item) => item.id));
    const seriesIds = delinquent.map((item) => item.series_id).filter(Boolean);
    if (seriesIds.length) {
      const { data: lessons } = await db.from("lessons").select("id").in("series_id", seriesIds).gte("starts_at", now).eq("status", "scheduled"), lessonIds = (lessons ?? []).map((item) => item.id);
      if (lessonIds.length) await Promise.all([db.from("lessons").update({ status: "cancelled", updated_at: now }).in("id", lessonIds), db.from("calendar_projections").update({ status: "queued", last_error: null }).in("lesson_id", lessonIds)]);
      await db.from("recurring_series").update({ status: "cancelled", updated_at: now }).in("id", seriesIds);
    }
    for (const booking of delinquent.filter((item) => item.offering_id)) {
      const { data: participants } = await db.from("lesson_participants").update({ status: "cancelled" }).eq("booking_id", booking.id).select("lesson_id"), lessonIds = (participants || []).map((item) => item.lesson_id);
      if (lessonIds.length) await db.from("calendar_projections").update({ status: "queued", last_error: null }).in("lesson_id", lessonIds);
      await db.rpc("release_offering_seat", { target_offering: booking.offering_id });
    }
  }

  const { data: recentLessons } = await db.from("lessons").select("id,studio_id,student_id,topic,ends_at,status").lte("ends_at", now).not("status", "in", '(cancelled,late_cancelled)').gte("ends_at", new Date(Date.now() - 30 * 86400000).toISOString());
  let noteReminders = 0;
  for (const lesson of recentLessons || []) {
    const { count } = await db.from("notes").select("id", { count: "exact", head: true }).eq("lesson_id", lesson.id).eq("status", "published");
    if (count) { await db.from("recommendations").update({ status: "resolved", updated_at: now }).eq("dedupe_key", `lesson:${lesson.id}:note-48h`); continue; }
    const dueAt = new Date(new Date(lesson.ends_at).getTime() + 48 * 3_600_000).toISOString();
    await db.from("recommendations").upsert({ studio_id: lesson.studio_id, student_id: lesson.student_id, entity_type: "lesson", entity_id: lesson.id, reason_code: "lesson_note_due_48h", title: `Write follow-up for ${lesson.topic}`, explanation: "Lesson notes are due within 48 hours of the lesson ending.", evidence: [`Lesson ended ${new Date(lesson.ends_at).toLocaleString("en-US", { timeZone: "America/New_York" })}`, `Due ${new Date(dueAt).toLocaleString("en-US", { timeZone: "America/New_York" })}`], urgency: new Date(dueAt) <= new Date() ? 5 : 4, due_at: dueAt, suggested_action: "write_note", requires_confirmation: false, status: "open", dedupe_key: `lesson:${lesson.id}:note-48h`, updated_at: now }, { onConflict: "dedupe_key" });
    noteReminders++;
  }
  return Response.json({ ok: true, expiredHolds: expired || 0, extendedOccurrences: extended || 0, transientCleanup: cleaned || {}, storageCleanupRan: runDailyStorageCleanup, delinquentCancelled: delinquent?.length || 0, noteReminders });
};

export const config: Config = { schedule: "*/5 * * * *" };
