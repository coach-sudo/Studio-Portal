import type { Config } from "@netlify/functions";
import { serviceClient } from "./_shared/supabase";
import { queueLessonChangeEmails } from "./_shared/booking-email";

const render = (template: string, values: Record<string, string>) =>
  template.replace(/{{([a-zA-Z]+)}}/g, (_, key: string) => values[key] ?? "");

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
  if (runDailyStorageCleanup) {
    const credentialRetention = new Date(Date.now() - 7 * 86400000).toISOString();
    await db
      .from("outbox_messages")
      .update({ body: "Temporary portal credentials removed after delivery retention period." })
      .eq("event_key", "portal.credentials")
      .eq("status", "sent")
      .lt("updated_at", credentialRetention);
  }
  const grace = new Date(Date.now() - 7 * 86400000).toISOString(), now = new Date().toISOString();
  const { data: delinquent } = await db.from("bookings").select("id,series_id,offering_id").eq("payment_status", "past_due").lte("updated_at", grace);
  if (delinquent?.length) {
    for (const booking of delinquent) {
      const { data: expiredBooking, error: delinquentError } = await db.rpc(
        "expire_delinquent_booking",
        { target_booking: booking.id },
      );
      if (delinquentError) throw delinquentError;
      for (const lessonId of Array.isArray(expiredBooking?.lessonIds) ? expiredBooking.lessonIds : [])
        await queueLessonChangeEmails(db, lessonId, "cancelled", `delinquent:${booking.id}`);
    }
  }

  const notePriorityStart = new Date(Date.now() - 8 * 86400000).toISOString();
  const [{ data: staleLessons }, { data: studios }] = await Promise.all([
    db.from("lessons").select("id").lt("ends_at", notePriorityStart),
    db.from("studios").select("id,name,timezone,settings"),
  ]);
  const staleLessonIds = (staleLessons || []).map((lesson) => lesson.id);
  if (staleLessonIds.length)
    await db.from("recommendations").update({ status: "resolved", updated_at: now }).eq("reason_code", "lesson_note_due_48h").eq("status", "open").in("entity_id", staleLessonIds);
  const studioSettings = new Map((studios || []).map((studio) => [studio.id, studio]));
  const { data: recentLessons } = await db.from("lessons").select("id,studio_id,student_id,topic,ends_at,status").lte("ends_at", now).not("status", "in", '(cancelled,late_cancelled)').gte("ends_at", notePriorityStart);
  let noteReminders = 0;
  for (const lesson of recentLessons || []) {
    const { count } = await db.from("notes").select("id", { count: "exact", head: true }).eq("lesson_id", lesson.id).eq("status", "published");
    if (count) { await db.from("recommendations").update({ status: "resolved", updated_at: now }).eq("dedupe_key", `lesson:${lesson.id}:note-48h`); continue; }
    const dueAt = new Date(new Date(lesson.ends_at).getTime() + 48 * 3_600_000).toISOString();
    const timeZone = studioSettings.get(lesson.studio_id)?.timezone || "America/New_York";
    await db.from("recommendations").upsert({ studio_id: lesson.studio_id, student_id: lesson.student_id, entity_type: "lesson", entity_id: lesson.id, reason_code: "lesson_note_due_48h", title: `Write follow-up for ${lesson.topic}`, explanation: "Lesson notes are due within 48 hours of the lesson ending.", evidence: [`Lesson ended ${new Date(lesson.ends_at).toLocaleString("en-US", { timeZone })}`, `Due ${new Date(dueAt).toLocaleString("en-US", { timeZone })}`], urgency: new Date(dueAt) <= new Date() ? 5 : 4, due_at: dueAt, suggested_action: "write_note", requires_confirmation: false, status: "open", dedupe_key: `lesson:${lesson.id}:note-48h`, updated_at: now }, { onConflict: "dedupe_key" });
    noteReminders++;
  }

  const upcomingLimit = new Date(Date.now() + 45 * 86400000).toISOString();
  const { data: autoLessons } = await db
    .from("lessons")
    .select("id")
    .eq("status", "scheduled")
    .is("package_id", null)
    .gte("starts_at", now)
    .lte("starts_at", upcomingLimit)
    .order("starts_at")
    .limit(100);
  let autoCreditsApplied = 0;
  for (const lesson of autoLessons || []) {
    const { data: packageId, error: creditError } = await db.rpc(
      "reserve_package_credit_for_lesson",
      { p_lesson_id: lesson.id },
    );
    if (creditError) throw creditError;
    if (packageId) autoCreditsApplied += 1;
  }

  const expiryLimit = new Date(Date.now() + 30 * 86400000).toISOString();
  const { data: expiringPackages } = await db
    .from("packages")
    .select("id,student_id,name,expires_at,students!inner(studio_id,email,guardian_email,full_name,preferred_name,is_minor)")
    .gt("expires_at", now)
    .lte("expires_at", expiryLimit)
    .order("expires_at");
  let packageReminders = 0;
  for (const pkg of expiringPackages || []) {
    const { data: entries } = await db
      .from("package_credit_entries")
      .select("quantity")
      .eq("package_id", pkg.id);
    const balance = (entries || []).reduce(
      (total, entry) => total + Number(entry.quantity),
      0,
    );
    if (balance <= 0) continue;
    const days = Math.max(
      1,
      Math.ceil((new Date(pkg.expires_at).getTime() - Date.now()) / 86400000),
    );
    const threshold = days <= 7 ? 7 : days <= 14 ? 14 : 30;
    const student = Array.isArray(pkg.students) ? pkg.students[0] : pkg.students;
    if (!student) continue;
    const studentName = student.preferred_name || student.full_name;
    const studio = studioSettings.get(student.studio_id);
    const timeZone = studio?.timezone || "America/New_York";
    const recipient = student.is_minor
      ? student.guardian_email || student.email
      : student.email || student.guardian_email;
    const dedupe = `package:${pkg.id}:expiry:${threshold}`;
    await db.from("recommendations").upsert(
      {
        studio_id: student.studio_id,
        student_id: pkg.student_id,
        entity_type: "package",
        entity_id: pkg.id,
        reason_code: "package_expiring",
        title: `${studentName}'s ${pkg.name} expires soon`,
        explanation: `${balance} lesson credit${balance === 1 ? "" : "s"} expire${balance === 1 ? "s" : ""} in ${days} day${days === 1 ? "" : "s"}.`,
        evidence: [`Expires ${new Date(pkg.expires_at).toLocaleDateString("en-US", { timeZone })}`, `${balance} credits remaining`],
        urgency: days <= 7 ? 5 : days <= 14 ? 4 : 3,
        due_at: pkg.expires_at,
        suggested_action: "review_package",
        requires_confirmation: false,
        status: "open",
        dedupe_key: `${dedupe}:coach`,
        updated_at: now,
      },
      { onConflict: "dedupe_key" },
    );
    if (recipient) {
      const automation = studio?.settings?.emailAutomations || {};
      if (automation.enabled === false) continue;
      const expiresAt = new Date(pkg.expires_at).toLocaleDateString("en-US", { timeZone });
      const templateValues = {
        studioName: String(studio?.name || "Studio"),
        studentName,
        packageName: pkg.name,
        days: String(days),
        credits: String(balance),
        expiresAt,
      };
      const { error: emailError } = await db.from("outbox_messages").upsert(
        {
          studio_id: student.studio_id,
          student_id: pkg.student_id,
          channel: "email",
          recipient,
          subject: render(automation.packageExpirySubject || "{{packageName}} expires in {{days}} days", templateValues),
          body: render(automation.packageExpiryBody || "Hi {{studentName}},\n\nYour {{packageName}} has {{credits}} credits remaining and expires on {{expiresAt}}. You can book or review your package from your studio portal.", templateValues),
          status: "queued",
          send_at: now,
          event_key: "package.expiring.student",
          dedupe_key: `${dedupe}:student`,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      );
      if (emailError) throw emailError;
      packageReminders += 1;
    }
  }
  return Response.json({ ok: true, expiredHolds: expired || 0, extendedOccurrences: extended || 0, transientCleanup: cleaned || {}, storageCleanupRan: runDailyStorageCleanup, delinquentCancelled: delinquent?.length || 0, noteReminders, autoCreditsApplied, packageReminders });
};

export const config: Config = { schedule: "*/5 * * * *" };
