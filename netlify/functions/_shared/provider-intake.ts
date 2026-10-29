import {
  assertWorkerEnabled,
  workerEnabled,
  disabledWorkerResult,
  WorkerDisabledError,
} from "./worker-controls";
import { checkedAll, checkedQuery } from "./checked-query";
import { z } from "zod";
import { googleAccessToken } from "./google";
import {
  observeCalendarProtection,
  resolveCalendarIdentity,
} from "./calendar-source-protection";
import { serviceClient } from "./supabase";
import type { WorkerTelemetry } from "./worker-telemetry";
import { zonedDateTimeToUtc } from "./timezone";
import { queueLessonChangeEmails } from "./booking-email";
import {
  pastOccurrence,
  staleReviewPayload,
} from "../../../src/domain/intakeRecency";
import {
  classifyProviderIntake,
  matchStudentIdentity,
  providerFromText,
  type IntakeChangeType,
} from "./provider-classification";

type StudentRow = {
  id: string;
  full_name: string;
  preferred_name?: string | null;
  email?: string | null;
  guardian_name?: string | null;
  guardian_email?: string | null;
};
type CalendarEvent = {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  organizer?: { email?: string; self?: boolean };
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean }>;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  updated?: string;
};
type ManagedLesson = {
  id: string;
  studio_id: string;
  student_id?: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  version: number;
};
type CalendarProjection = {
  lesson_id: string;
  external_event_id: string;
  external_version?: string | null;
  projected_version: number;
};
type GmailLessonCandidate = ReturnType<typeof gmailCandidate>;
type ExistingLessonCandidate = {
  id: string;
  student_id?: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  source_provider?: string | null;
  topic?: string | null;
};
const calendarListSchema = z
  .object({
    items: z
      .array(z.object({ id: z.string().min(1) }).passthrough())
      .optional(),
    nextPageToken: z.string().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();
const gmailListSchema = z
  .object({
    messages: z.array(z.object({ id: z.string().min(1) })).optional(),
    nextPageToken: z.string().optional(),
    error: z
      .object({ message: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
const gmailMessageSchema = z
  .object({
    id: z.string().optional(),
    threadId: z.string().optional(),
    snippet: z.string().optional(),
    payload: z
      .object({
        headers: z
          .array(
            z.object({
              name: z.string(),
              value: z.string().optional(),
            }),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function providerPayload<T extends z.ZodType>(schema: T, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error("PROVIDER_UNAVAILABLE: Provider payload was invalid.");
  return result.data as z.infer<T>;
}
const normalize = (value?: string | null) =>
  (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();
const personKey = (value?: string | null) =>
  normalize(value)
    .split(" ")
    .filter((part) => part.length > 1)
    .join(" ");
const provider = providerFromText;
const displayProvider = (value: string) =>
  (
    ({
      lessonface: "Lessonface",
      wyzant: "Wyzant",
      lessons_com: "Lessons.com",
      acuity: "Acuity",
      superprof: "Superprof",
      google_calendar: "Google Calendar",
      gmail: "Gmail",
    }) as Record<string, string>
  )[value] || value;
export const gmailChangeType = (text: string) =>
  /\b(cancelled|canceled|cancellation)\b/i.test(text)
    ? "cancellation"
    : /\b(rescheduled|reschedule|new (?:date|time))\b/i.test(text)
      ? "reschedule"
      : "confirmation";
export function gmailProviderMessageKind(
  text: string,
  candidate?: GmailLessonCandidate,
) {
  const hasLessonContext =
      /\b(lesson|session|class|coaching|appointment|booking)\b/i.test(text),
    cancellation =
      /\b(?:lesson|session|class|appointment|booking)\s+(?:(?:was|has been|is)\s+)?(?:cancelled|canceled)\b|\b(?:cancelled|canceled)\s*:\s*(?:lesson|session|class|appointment|booking)\b|\b(?:lesson|session|class|appointment|booking)\s+cancellation\b(?!\s+policy)/i.test(
        text,
      ),
    reschedule =
      /\b(?:lesson|session|class|appointment|booking)\s+(?:(?:was|has been|is)\s+)?rescheduled\b|\brescheduled\s*:\s*(?:lesson|session|class|appointment|booking)\b|\bnew (?:date|time) for (?:your |the )?(?:lesson|session|class|appointment|booking)\b/i.test(
        text,
      ),
    explicitBooking =
      /\b(booked|booking (?:confirmed|confirmation)|confirmed|scheduled|upcoming|new (?:lesson|session|booking|appointment)|(?:lesson|session) (?:request )?accepted|reservation|lesson reminder|session reminder|starts? (?:soon|in))\b/i.test(
        text,
      ),
    nonBooking =
      /\b(newsletter|digest|inquiry|new message|unread message|review request|profile|billing|payment|payout|receipt|invoice|promotion|special offer)\b/i.test(
        text,
      );
  if (!hasLessonContext) return undefined;
  if (cancellation) return "cancellation" as const;
  if (reschedule) return "reschedule" as const;
  if (
    !candidate ||
    !explicitBooking ||
    (nonBooking &&
      !/\b(booked|booking (?:confirmed|confirmation)|confirmed|scheduled|new (?:lesson|session|booking|appointment))\b/i.test(
        text,
      ))
  )
    return undefined;
  return "confirmation" as const;
}

export function isSameScheduledLesson(
  candidate: NonNullable<GmailLessonCandidate>,
  lesson: ExistingLessonCandidate,
  detectedProvider: string,
  matchedStudentId?: string,
) {
  if (["cancelled", "late_cancelled"].includes(lesson.status)) return false;
  const startDelta = Math.abs(
      new Date(lesson.starts_at).getTime() -
        new Date(candidate.startsAt).getTime(),
    ),
    endDelta = Math.abs(
      new Date(lesson.ends_at).getTime() - new Date(candidate.endsAt).getTime(),
    ),
    identityMatches = Boolean(
      matchedStudentId && lesson.student_id === matchedStudentId,
    ),
    providerMatches = lesson.source_provider === detectedProvider,
    topicMatches = normalize(lesson.topic).includes(
      normalize(displayProvider(detectedProvider)),
    );
  return (
    startDelta <= 5 * 60000 &&
    endDelta <= 5 * 60000 &&
    (matchedStudentId
      ? identityMatches
      : Boolean(lesson.student_id == null && (providerMatches || topicMatches)))
  );
}
export function managedCalendarChange(
  event: CalendarEvent,
  lesson: Pick<ManagedLesson, "starts_at" | "ends_at" | "status">,
) {
  if (event.status === "cancelled")
    return ["cancelled", "late_cancelled"].includes(lesson.status)
      ? undefined
      : "cancellation";
  if (
    !event.start?.dateTime ||
    !event.end?.dateTime ||
    lesson.status !== "scheduled"
  )
    return undefined;
  return new Date(event.start.dateTime).getTime() !==
    new Date(lesson.starts_at).getTime() ||
    new Date(event.end.dateTime).getTime() !==
      new Date(lesson.ends_at).getTime()
    ? "reschedule"
    : undefined;
}
const coachEmailKeys = (studio: any) =>
  [
    ...(studio.settings?.coachEmails || []),
    studio.settings?.contactEmail,
    Netlify.env.get("GOOGLE_ACCOUNT_EMAIL"),
  ]
    .filter(Boolean)
    .map((value: string) => normalize(value));
const eligibleStudents = (studio: any, students: StudentRow[]) => {
  const coachName = personKey(studio.settings?.coachName),
    coachEmails = coachEmailKeys(studio);
  return students.filter(
    (student) =>
      personKey(student.full_name) !== coachName &&
      ![student.email, student.guardian_email].some(
        (value) => value && coachEmails.includes(normalize(value)),
      ),
  );
};
function titleIdentity(summary: string) {
  const preferred = summary.match(/\((?!coach\b)([^)]+)\)/i)?.[1]?.trim(),
    withoutParenthetical = summary.replace(/\([^)]*\)/g, " "),
    prefix = withoutParenthetical.includes(":")
      ? withoutParenthetical.split(":")[0]
      : withoutParenthetical.split(
          /\s+for\s+\d+\s*min|\s+-\s+acting|\s+acting\s+(?:lesson|session|coaching)|\s+(?:lesson|session|coaching)$/i,
        )[0],
    fullName = prefix
      .replace(
        /\b\d+\s*min\b|\bprepaid\b|lessonface|wyzant|lessons\.com|superprof|acuity|confirmed|booking/gi,
        " ",
      )
      .replace(/[^a-zA-Z' -]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return fullName &&
    !/^(acting|lesson|session|coaching|private)$/i.test(fullName)
    ? { fullName, preferred }
    : undefined;
}

function messageText(message: any) {
  const chunks: string[] = [];
  const walk = (part: any) => {
    if (part?.body?.data) {
      try {
        chunks.push(
          Buffer.from(
            String(part.body.data).replace(/-/g, "+").replace(/_/g, "/"),
            "base64",
          ).toString("utf8"),
        );
      } catch {}
    }
    for (const child of part?.parts || []) walk(child);
  };
  walk(message.payload);
  return [message.snippet, ...chunks]
    .filter(Boolean)
    .join("\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ");
}
export function gmailCandidate(
  text: string,
  headers: Record<string, string>,
  timeZone: string,
) {
  const iso = text.match(
    /20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})/i,
  )?.[0];
  const natural = text.match(
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Fri|Sat|Sun)?,?\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s+(?:ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT))?/i,
  )?.[0];
  let start = iso ? new Date(iso) : undefined;
  if (!start && natural) {
    const parsed = natural.match(
      /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)/i,
    );
    if (parsed) {
      const months = [
          "jan",
          "feb",
          "mar",
          "apr",
          "may",
          "jun",
          "jul",
          "aug",
          "sep",
          "oct",
          "nov",
          "dec",
        ],
        hour12 = Number(parsed[4]),
        hour = (hour12 % 12) + (parsed[6].toLowerCase() === "pm" ? 12 : 0);
      start = zonedDateTimeToUtc(
        {
          year: Number(parsed[3]),
          month: months.indexOf(parsed[1].toLowerCase().slice(0, 3)) + 1,
          day: Number(parsed[2]),
          hour,
          minute: Number(parsed[5]),
        },
        timeZone,
      );
    }
  }
  if (!start || Number.isNaN(start.getTime())) return undefined;
  const duration = Number(
      text.match(/(30|45|60|75|90|120)\s*(?:minutes?|mins?)\b/i)?.[1] || 60,
    ),
    joinUrl = text.match(
      /https:\/\/(?:meet\.google\.com|lessonface\.com|www\.lessonface\.com|zoom\.us)\/[^\s"'<>]+/i,
    )?.[0];
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + duration * 60000).toISOString(),
    topic: headers.subject || "Imported lesson",
    locationLabel: joinUrl
      ? /lessonface/i.test(joinUrl)
        ? "Lessonface"
        : "Online"
      : "Provider booking",
    joinUrl,
    timeZone,
  };
}

const slicesOf = <T>(items: T[], size = 100) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
};

async function listCalendarEvents(
  token: string,
  calendar: string,
  from: string,
  to: string,
) {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
        singleEvents: "true",
        showDeleted: "true",
        orderBy: "startTime",
        timeMin: from,
        timeMax: to,
        maxResults: "250",
      }),
      suffix = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events?${params.toString()}${suffix}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000),
        },
      ),
      payload = providerPayload(calendarListSchema, await response.json()) as {
        items?: CalendarEvent[];
        nextPageToken?: string;
        error?: unknown;
      };
    if (!response.ok)
      throw new Error(
        `Calendar intake failed: ${JSON.stringify(payload.error || payload)}`,
      );
    events.push(...(payload.items || []));
    pageToken = payload.nextPageToken;
  } while (pageToken);
  return events;
}

async function managedCalendarRows(db: any, events: CalendarEvent[]) {
  const externalIds = events.map((event) => event.id).filter(Boolean),
    projections: CalendarProjection[] = [];
  for (const ids of slicesOf(externalIds)) {
    const { data, error } = await db
      .from("calendar_projections")
      .select("lesson_id,external_event_id,external_version,projected_version")
      .in("external_event_id", ids);
    if (error) throw error;
    projections.push(...(data || []));
  }
  const lessons: ManagedLesson[] = [];
  for (const ids of slicesOf([
    ...new Set(projections.map((projection) => projection.lesson_id)),
  ])) {
    const { data, error } = await db
      .from("lessons")
      .select("id,studio_id,student_id,starts_at,ends_at,status,version")
      .in("id", ids);
    if (error) throw error;
    lessons.push(...(data || []));
  }
  return {
    projections: new Map(
      projections.map((projection) => [
        projection.external_event_id,
        projection,
      ]),
    ),
    lessons: new Map(lessons.map((lesson) => [lesson.id, lesson])),
  };
}

async function reconcileManagedCalendarEvent(
  db: any,
  studio: any,
  event: CalendarEvent,
  projection: CalendarProjection,
  lesson: ManagedLesson,
) {
  const change = managedCalendarChange(event, lesson),
    externalVersion = event.etag || event.updated || null;
  if (!change) {
    if (externalVersion && externalVersion !== projection.external_version)
      await db
        .from("calendar_projections")
        .update({ external_version: externalVersion })
        .eq("lesson_id", lesson.id);
    return false;
  }
  const correlation = `calendar-${change}:${event.id}:${event.updated || event.etag || "unknown"}`,
    { error: changeError } = await checkedQuery(
      db.rpc("command_change_lesson_state", {
        p_lesson_id: lesson.id,
        p_expected_version: lesson.version,
        p_action: change === "cancellation" ? "cancel" : "reschedule",
        p_starts_at: change === "reschedule" ? event.start?.dateTime : null,
        p_ends_at: change === "reschedule" ? event.end?.dateTime : null,
        // Google is the source of this mutation. Re-projecting it would create a loop.
        p_queue_calendar: false,
      }),
    );
  if (changeError) {
    await checkedAll([
      checkedQuery(
        db.from("sync_conflicts").insert({
          studio_id: studio.id,
          entity_type: "lesson",
          entity_id: lesson.id,
          source: "google_calendar",
          internal_version: lesson.version,
          external_payload: event,
          status: "open",
        }),
      ),
      checkedQuery(
        db.from("recommendations").upsert(
          {
            studio_id: studio.id,
            student_id: lesson.student_id || null,
            entity_type: "lesson",
            entity_id: lesson.id,
            reason_code: "calendar_change_needs_review",
            title: "Review a Calendar lesson change",
            explanation:
              "Google Calendar changed this lesson while the portal record was also changing. Review it before applying either version.",
            evidence: [String(changeError)],
            urgency: 4,
            suggested_action: "review_calendar_change",
            requires_confirmation: true,
            status: "open",
            dedupe_key: `lesson:${lesson.id}:calendar-conflict:${event.updated || event.etag || "unknown"}`,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "dedupe_key" },
        ),
      ),
    ]);
    return false;
  }
  const { data: updatedLesson, error: refreshError } = await db
    .from("lessons")
    .select("version,status,starts_at,ends_at")
    .eq("id", lesson.id)
    .single();
  if (refreshError) throw refreshError;
  const emailAction = change === "cancellation" ? "cancelled" : "rescheduled";
  await queueLessonChangeEmails(db, lesson.id, emailAction, correlation);
  await checkedAll([
    db
      .from("calendar_projections")
      .update({
        status: "projected",
        external_version: externalVersion,
        projected_version: updatedLesson.version,
        last_projected_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("lesson_id", lesson.id),
    checkedQuery(
      db.from("integration_imports").upsert(
        {
          studio_id: studio.id,
          provider: "google_calendar",
          external_id: event.id,
          detected_source: "studio_calendar",
          student_id: lesson.student_id || null,
          lesson_id: lesson.id,
          status: "imported",
          confidence: 1,
          matched_by: "calendar projection",
          payload: event,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "studio_id,provider,external_id" },
      ),
    ),
    checkedQuery(
      db.from("recommendations").upsert(
        {
          studio_id: studio.id,
          student_id: lesson.student_id || null,
          entity_type: "lesson",
          entity_id: lesson.id,
          reason_code: `calendar_${change}_applied`,
          title:
            change === "cancellation"
              ? "Calendar cancellation applied"
              : "Calendar reschedule applied",
          explanation:
            change === "cancellation"
              ? "A cancellation made in Google Calendar was applied to the portal lesson."
              : "A new time from Google Calendar was applied to the portal lesson.",
          evidence:
            change === "cancellation"
              ? ["The linked Google Calendar event was cancelled."]
              : [
                  `New start: ${event.start?.dateTime}`,
                  `New end: ${event.end?.dateTime}`,
                ],
          urgency: 2,
          suggested_action: "view_lesson",
          requires_confirmation: false,
          status: "open",
          dedupe_key: `lesson:${lesson.id}:calendar-${change}:${event.updated || event.etag || "unknown"}`,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "dedupe_key" },
      ),
    ),
    checkedQuery(
      db.from("audit_events").insert({
        studio_id: studio.id,
        entity_type: "lesson",
        entity_id: lesson.id,
        action:
          change === "cancellation"
            ? "lesson.cancelled_from_calendar"
            : "lesson.rescheduled_from_calendar",
        reason: `Linked Google Calendar event was ${emailAction}`,
        correlation_id: correlation,
        source: "provider_intake",
        before_state: lesson,
        after_state: updatedLesson,
      }),
    ),
  ]);
  return true;
}

export async function importCalendar(
  token: string,
  studio: any,
  students: StudentRow[],
) {
  assertWorkerEnabled("provider-intake");
  const db = serviceClient(),
    calendarId = await resolveCalendarIdentity(
      token,
      Netlify.env.get("GOOGLE_CALENDAR_ID") || "primary",
    ),
    calendar = encodeURIComponent(calendarId),
    from = new Date(Date.now() - 14 * 86400000).toISOString(),
    to = new Date(Date.now() + 90 * 86400000).toISOString();
  const events = await listCalendarEvents(token, calendar, from, to),
    protectedEvents = await observeCalendarProtection(
      db,
      studio.id,
      calendarId,
      events,
    ),
    managed = await managedCalendarRows(
      db,
      events.filter((event) => !event.id || !protectedEvents.has(event.id)),
    );
  let imported = 0,
    review = 0;
  const failures: unknown[] = [];
  for (const event of events) {
    assertWorkerEnabled("provider-intake");
    try {
      if (!event.id) continue;
      const protectedSource = protectedEvents.get(event.id);
      if (protectedSource) {
        if (
          protectedSource.some(
            (item) =>
              item.changed ||
              item.state === "ambiguous" ||
              item.disposition === "review",
          )
        )
          review++;
        continue;
      }
      const projection = managed.projections.get(event.id),
        managedLesson = projection
          ? managed.lessons.get(projection.lesson_id)
          : undefined;
      if (projection && managedLesson) {
        if (managedLesson.studio_id !== studio.id) continue;
        if (
          await reconcileManagedCalendarEvent(
            db,
            studio,
            event,
            projection,
            managedLesson,
          )
        )
          imported++;
        continue;
      }
      if (event.status === "cancelled") {
        const { data: prior } = await db
          .from("integration_imports")
          .select("id,lesson_id")
          .eq("studio_id", studio.id)
          .eq("provider", "google_calendar")
          .eq("external_id", event.id)
          .maybeSingle();
        if (prior?.lesson_id) {
          const { data: lesson } = await db
            .from("lessons")
            .select("id,version,status")
            .eq("id", prior.lesson_id)
            .maybeSingle();
          if (
            lesson &&
            !["cancelled", "late_cancelled"].includes(lesson.status)
          ) {
            const correlation = `calendar-cancel:${event.id}:${event.updated || "unknown"}`;
            const { error: changeError } = await checkedQuery(
              db.rpc("command_change_lesson_state", {
                p_lesson_id: lesson.id,
                p_expected_version: lesson.version,
                p_action: "cancel",
                p_starts_at: null,
                p_ends_at: null,
                p_queue_calendar: false,
              }),
            );
            if (changeError) throw changeError;
            await queueLessonChangeEmails(
              db,
              lesson.id,
              "cancelled",
              correlation,
            );
            await checkedAll([
              db
                .from("calendar_projections")
                .update({
                  status: "projected",
                  external_version: event.etag || event.updated || null,
                  last_projected_at: new Date().toISOString(),
                  last_error: null,
                })
                .eq("lesson_id", lesson.id),
              checkedQuery(
                db.from("audit_events").insert({
                  studio_id: studio.id,
                  entity_type: "lesson",
                  entity_id: lesson.id,
                  action: "lesson.cancelled_from_calendar",
                  reason: "Google Calendar event was cancelled",
                  correlation_id: correlation,
                  source: "provider_intake",
                  before_state: { status: lesson.status },
                  after_state: { status: "cancelled" },
                }),
              ),
            ]);
            imported++;
          }
          await db
            .from("integration_imports")
            .update({
              status: "imported",
              payload: event,
              updated_at: new Date().toISOString(),
            })
            .eq("id", prior.id);
        }
        continue;
      }
      if (!event.start?.dateTime || !event.end?.dateTime) continue;
      const text = [
        event.summary,
        event.description,
        event.location,
        event.organizer?.email,
        ...(event.attendees || []).flatMap((item) => [
          item.email,
          item.displayName,
        ]),
      ]
        .filter(Boolean)
        .join(" ");
      if (/managed by /i.test(event.description || "")) continue;
      const selfEmails = (event.attendees || [])
          .filter((item) => item.self)
          .map((item) => normalize(item.email)),
        coachEmails = [...new Set([...coachEmailKeys(studio), ...selfEmails])],
        externalAttendees = (event.attendees || []).filter(
          (item) => !item.self && !coachEmails.includes(normalize(item.email)),
        ),
        emails = externalAttendees
          .map((item) => item.email || "")
          .filter(Boolean),
        matchText = [
          event.summary,
          ...externalAttendees.map((item) => item.displayName),
        ]
          .filter(Boolean)
          .join(" "),
        detected = provider(text),
        candidates = eligibleStudents(studio, students).filter(
          (item) =>
            ![item.email, item.guardian_email].some(
              (value) => value && coachEmails.includes(normalize(value)),
            ),
        ),
        match = matchStudentIdentity(candidates, matchText, emails),
        identity = titleIdentity(event.summary || "");
      const source = detected || "google_calendar";
      const { data: prior, error: priorError } = await db
        .from("integration_imports")
        .select("id,lesson_id,status")
        .eq("studio_id", studio.id)
        .eq("provider", "google_calendar")
        .eq("external_id", event.id)
        .maybeSingle();
      if (priorError) throw priorError;
      if (prior?.status === "ignored") continue;
      // A reviewed cross-signal link is authoritative. Its external event ID
      // need not be the lesson's original provider ID or calendar projection.
      if (prior?.lesson_id) {
        const { data: linked, error: linkedError } = await db
          .from("lessons")
          .select("id,student_id,starts_at,ends_at,status")
          .eq("studio_id", studio.id)
          .eq("id", prior.lesson_id)
          .maybeSingle();
        if (linkedError) throw linkedError;
        if (!linked)
          throw new Error(
            "REVIEW_REQUIRED: Linked Calendar lesson is unavailable.",
          );
        if (managedCalendarChange(event, linked) === "reschedule") {
          const { error } = await db
            .from("integration_imports")
            .update({
              status: "needs_review",
              payload: { ...event, changeType: "reschedule" },
              updated_at: new Date().toISOString(),
            })
            .eq("studio_id", studio.id)
            .eq("id", prior.id);
          if (error) throw error;
          review++;
        }
        continue;
      }
      if (
        !prior?.lesson_id &&
        pastOccurrence(event.start?.dateTime, event.end?.dateTime)
      ) {
        if (prior?.status === "needs_review")
          await db
            .from("integration_imports")
            .update({
              status: "ignored",
              matched_by: "past_appointment",
              updated_at: new Date().toISOString(),
            })
            .eq("id", prior.id);
        continue;
      }
      const intakeDecision = classifyProviderIntake({
        source: "google_calendar",
        text,
        provider: detected || "google_calendar",
        parsedOccurrence: {
          startsAt: event.start.dateTime,
          endsAt: event.end.dateTime,
        },
        matchContext: {
          studentId: match?.student.id,
          matchedBy: match?.matchedBy,
          confidence: match?.confidence,
          identityEvidence: Boolean(
            (identity?.fullName && emails[0]) || (detected && emails[0]),
          ),
        },
      });
      if (intakeDecision.disposition === "ignore") {
        if (prior)
          await db
            .from("integration_imports")
            .update({
              status: "ignored",
              confidence: intakeDecision.confidence,
              matched_by: `classifier:${intakeDecision.reasonCode}`,
              payload: event,
              updated_at: new Date().toISOString(),
            })
            .eq("id", prior.id);
        continue;
      }
      if (intakeDecision.disposition === "needs_review" || !match) {
        await checkedQuery(
          db.from("integration_imports").upsert(
            {
              studio_id: studio.id,
              provider: "google_calendar",
              external_id: event.id,
              detected_source: source,
              student_id: match?.student.id || null,
              lesson_id: prior?.lesson_id || null,
              status: "needs_review",
              confidence: intakeDecision.confidence,
              matched_by: `classifier:${intakeDecision.reasonCode}`,
              payload: event,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "studio_id,provider,external_id" },
          ),
        );
        review++;
        continue;
      }
      const student = match!.student;
      const confidence = Math.max(
        intakeDecision.confidence,
        match?.confidence ||
          (student && identity?.fullName ? 0.88 : detected?.length ? 0.7 : 0.5),
      );
      let lessonId: string | undefined;
      // A Gmail confirmation may already have created this exact occurrence.
      // Review its external identity without replacing participants or payment data.
      if (student && !prior?.lesson_id) {
        const { data: existing, error: existingError } = await db
          .from("lessons")
          .select("id,version")
          .eq("studio_id", studio.id)
          .eq("student_id", student.id)
          .eq("starts_at", event.start.dateTime)
          .eq("ends_at", event.end.dateTime)
          .not("status", "in", "(cancelled,late_cancelled)")
          .limit(2);
        if (existingError) throw existingError;
        if (existing?.length) {
          const { error: importError } = await db
            .from("integration_imports")
            .upsert(
              {
                studio_id: studio.id,
                provider: "google_calendar",
                external_id: event.id,
                detected_source: source,
                student_id: student.id,
                lesson_id: existing.length === 1 ? existing[0].id : null,
                status: "needs_review",
                confidence,
                matched_by: "cross_signal_occurrence_review",
                payload: event,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "studio_id,provider,external_id" },
            );
          if (importError) throw importError;
          review++;
          continue;
        }
      }

      if (student) {
        const { data: lesson, error } = await db
          .from("lessons")
          .insert({
            studio_id: studio.id,
            student_id: student.id,
            topic: event.summary || `${displayProvider(source)} lesson`,
            starts_at: event.start.dateTime,
            ends_at: event.end.dateTime,
            status: "scheduled",
            location_type: event.hangoutLink ? "virtual" : "in_person",
            location_label: event.hangoutLink
              ? "Google Meet"
              : event.location || displayProvider(source),
            join_url: event.hangoutLink || null,
            meeting_provider: event.hangoutLink ? "google_meet" : "in_person",
            source_provider: source,
            source_external_id: event.id,
            source_confidence: confidence,
            imported_at: new Date().toISOString(),
          })
          .select("id,version")
          .single();
        // A source may establish a schedule, never overwrite an existing outcome.
        // A unique source collision remains a retry/review failure, not an upsert.
        if (error) throw error;
        if (!error && lesson) {
          lessonId = lesson.id;
          await checkedAll([
            checkedQuery(
              db.from("lesson_participants").insert({
                lesson_id: lesson.id,
                student_id: student.id,
                display_name: student.preferred_name || student.full_name,
                email: student.email || emails[0] || "",
                status: "confirmed",
              }),
            ),
            checkedQuery(
              db.from("calendar_projections").upsert(
                {
                  lesson_id: lesson.id,
                  external_event_id: event.id,
                  external_version: event.etag || event.updated,
                  projected_version: lesson.version,
                  status: "projected",
                  last_projected_at: new Date().toISOString(),
                  last_error: null,
                },
                { onConflict: "lesson_id" },
              ),
            ),
          ]);
          const coverage = await checkedQuery(
            db.rpc("reserve_student_upcoming_credits", {
              p_student: student.id,
            }),
          );
          if (coverage.error) throw coverage.error;
          imported++;
        }
      }
      await checkedQuery(
        db.from("integration_imports").upsert(
          {
            studio_id: studio.id,
            provider: "google_calendar",
            external_id: event.id,
            detected_source: source,
            student_id: student?.id || null,
            lesson_id: lessonId || null,
            status: lessonId ? "imported" : "needs_review",
            confidence,
            matched_by:
              match?.matchedBy ||
              (student && identity
                ? "calendar event title"
                : `classifier:${intakeDecision.reasonCode}`),
            payload: event,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "studio_id,provider,external_id" },
        ),
      );
    } catch (error) {
      if (error instanceof WorkerDisabledError) throw error;
      failures.push(error);
    }
  }
  if (failures.length) throw failures[0];
  return { imported, review };
}

export async function scanGmail(
  token: string,
  studio: any,
  students: StudentRow[],
) {
  assertWorkerEnabled("provider-intake");
  const db = serviceClient(),
    query = encodeURIComponent(
      'newer_than:90d {lessonface wyzant "lessons.com" superprof acuity "squarespace scheduling"}',
    ),
    messageIds: Array<{ id: string }> = [];
  let pageToken: string | undefined;
  do {
    assertWorkerEnabled("provider-intake");
    const list = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000),
        },
      ),
      payload = providerPayload(gmailListSchema, await list.json());
    if (!list.ok) {
      if (![401, 403].includes(list.status))
        throw new Error("PROVIDER_UNAVAILABLE: Gmail listing is unavailable.");
      await checkedQuery(
        db.from("recommendations").upsert(
          {
            studio_id: studio.id,
            entity_type: "integration",
            reason_code: "gmail_read_scope_required",
            title: "Reconnect Google to import booking emails",
            explanation:
              "Sending email works, but smart booking intake also needs read-only Gmail permission.",
            evidence: [
              "Gmail read permission is unavailable. Reconnect and verify the read-only scope in a controlled account.",
            ],
            urgency: 3,
            suggested_action: "open_integrations",
            requires_confirmation: false,
            status: "open",
            dedupe_key: `studio:${studio.id}:gmail-read`,
          },
          { onConflict: "dedupe_key" },
        ),
      );
      return { review: 0, imported: 0, scope: false };
    }
    messageIds.push(...(payload.messages || []));
    pageToken = payload.nextPageToken;
  } while (pageToken);
  let review = 0,
    imported = 0;
  const failures: unknown[] = [];
  for (const item of messageIds) {
    assertWorkerEnabled("provider-intake");
    try {
      const response = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
          },
        ),
        message = providerPayload(gmailMessageSchema, await response.json());
      if (!response.ok)
        throw new Error("PROVIDER_UNAVAILABLE: Gmail message unavailable.");
      const headers = Object.fromEntries(
          (message.payload?.headers || []).map((header: any) => [
            String(header.name).toLowerCase(),
            header.value,
          ]),
        ),
        body = messageText(message),
        text = [headers.subject, headers.from, headers.to, body]
          .filter(Boolean)
          .join(" "),
        detected = provider(text);
      if (!detected) continue;
      const emails = (
          text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []
        ).filter(
          (value: string) => !coachEmailKeys(studio).includes(normalize(value)),
        ),
        match = matchStudentIdentity(
          eligibleStudents(studio, students),
          text,
          emails,
        ),
        candidate = gmailCandidate(
          body,
          headers,
          studio.timezone || "America/New_York",
        ),
        messageKind = gmailProviderMessageKind(text, candidate);
      const { data: prior } = await db
        .from("integration_imports")
        .select("id,lesson_id,status")
        .eq("studio_id", studio.id)
        .eq("provider", "gmail")
        .eq("external_id", item.id)
        .maybeSingle();
      // A Gmail message is immutable. Completed/ignored review is final for this
      // message ID; later provider updates arrive under a different message ID.
      if (
        prior?.status === "ignored" ||
        (prior?.status === "imported" && prior.lesson_id)
      )
        continue;
      if (!prior?.lesson_id && staleReviewPayload({ candidate, headers })) {
        if (prior?.status === "needs_review")
          await db
            .from("integration_imports")
            .update({
              status: "ignored",
              matched_by: "past_appointment",
              updated_at: new Date().toISOString(),
            })
            .eq("id", prior.id);
        continue;
      }
      const changeType: IntakeChangeType = messageKind || gmailChangeType(text),
        intakeDecision = classifyProviderIntake({
          source: "gmail",
          text,
          provider: detected,
          changeType,
          parsedOccurrence: candidate
            ? { startsAt: candidate.startsAt, endsAt: candidate.endsAt }
            : undefined,
          matchContext: {
            studentId: match?.student.id,
            lessonId: prior?.lesson_id || undefined,
            matchedBy: match?.matchedBy,
            confidence: match?.confidence,
          },
        });
      if (prior?.status === "ignored") continue;
      if (intakeDecision.disposition === "ignore") {
        if (prior?.status === "needs_review")
          await db
            .from("integration_imports")
            .update({
              status: "ignored",
              confidence: intakeDecision.confidence,
              matched_by: `classifier:${intakeDecision.reasonCode}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", prior.id);
        continue;
      }
      if (
        intakeDecision.disposition === "needs_review" ||
        changeType !== "confirmation"
      ) {
        await checkedQuery(
          db.from("integration_imports").upsert(
            {
              studio_id: studio.id,
              provider: "gmail",
              external_id: item.id,
              detected_source: detected,
              student_id: match?.student.id || null,
              lesson_id: prior?.lesson_id || null,
              status: "needs_review",
              confidence: intakeDecision.confidence,
              matched_by: `classifier:${intakeDecision.reasonCode}`,
              payload: {
                headers,
                snippet: message.snippet,
                threadId: message.threadId,
                candidate,
                changeType,
              },
              updated_at: new Date().toISOString(),
            },
            { onConflict: "studio_id,provider,external_id" },
          ),
        );
        review++;
        continue;
      }
      if (prior?.status === "ignored") continue;
      if (prior?.status === "imported" && prior.lesson_id) continue;
      let lessonId = prior?.lesson_id as string | undefined;
      let createdFromGmail = false;
      if (candidate && !lessonId) {
        const { data: possible, error: possibleError } = await db
          .from("lessons")
          .select(
            "id,student_id,starts_at,ends_at,status,source_provider,topic",
          )
          .eq("studio_id", studio.id)
          .gte(
            "starts_at",
            new Date(
              new Date(candidate.startsAt).getTime() - 5 * 60000,
            ).toISOString(),
          )
          .lte(
            "starts_at",
            new Date(
              new Date(candidate.startsAt).getTime() + 5 * 60000,
            ).toISOString(),
          )
          .limit(5);
        if (possibleError) throw possibleError;
        const duplicates = (possible || []).filter(
          (lesson: ExistingLessonCandidate) =>
            isSameScheduledLesson(
              candidate,
              lesson,
              detected,
              match?.student.id,
            ),
        );
        if (duplicates.length === 1) {
          const duplicateDecision = classifyProviderIntake({
            source: "gmail",
            text,
            provider: detected,
            changeType,
            parsedOccurrence: {
              startsAt: candidate.startsAt,
              endsAt: candidate.endsAt,
            },
            matchContext: {
              studentId: match?.student.id,
              lessonId: duplicates[0].id,
              matchedBy: match?.matchedBy,
              confidence: match?.confidence,
            },
            duplicate: true,
          });
          await checkedQuery(
            db.from("integration_imports").upsert(
              {
                studio_id: studio.id,
                provider: "gmail",
                external_id: item.id,
                detected_source: detected,
                student_id:
                  match?.student.id || duplicates[0].student_id || null,
                lesson_id: duplicates[0].id,
                status: "ignored",
                confidence: duplicateDecision.confidence,
                matched_by: `classifier:${duplicateDecision.reasonCode}`,
                payload: {
                  headers,
                  snippet: message.snippet,
                  threadId: message.threadId,
                  candidate,
                  changeType,
                },
                updated_at: new Date().toISOString(),
              },
              { onConflict: "studio_id,provider,external_id" },
            ),
          );
          continue;
        }
      }
      if (match && candidate && !lessonId) {
        const created = await db
          .from("lessons")
          .insert({
            studio_id: studio.id,
            student_id: match.student.id,
            topic: candidate.topic,
            starts_at: candidate.startsAt,
            ends_at: candidate.endsAt,
            status: "scheduled",
            location_type: candidate.joinUrl ? "virtual" : "in_person",
            location_label: candidate.locationLabel,
            join_url: candidate.joinUrl || null,
            // Preserve a provider's own classroom URL. Only native Meet URLs
            // should ask the Calendar worker to provision a Google conference.
            meeting_provider: candidate.joinUrl
              ? /meet\.google\.com/i.test(candidate.joinUrl)
                ? "google_meet"
                : null
              : "in_person",
            source_provider: detected,
            source_external_id: item.id,
            source_confidence: match.confidence,
            imported_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (created.error) throw created.error;
        if (!created.error && created.data) {
          lessonId = created.data.id;
          createdFromGmail = true;
          const { error: participantError } = await db
            .from("lesson_participants")
            .insert({
              lesson_id: lessonId,
              student_id: match.student.id,
              display_name:
                match.student.preferred_name || match.student.full_name,
              email: match.student.email || "",
              status: "confirmed",
            });
          if (participantError) throw participantError;
        }
      }
      if (
        createdFromGmail &&
        lessonId &&
        candidate &&
        new Date(candidate.endsAt).getTime() > Date.now()
      ) {
        const { error: projectionError } = await db
          .from("calendar_projections")
          .upsert(
            { lesson_id: lessonId, status: "queued", last_error: null },
            { onConflict: "lesson_id" },
          );
        if (projectionError) throw projectionError;
      }
      const status = lessonId ? "imported" : "needs_review";
      const persisted = await checkedQuery(
        db.from("integration_imports").upsert(
          {
            studio_id: studio.id,
            provider: "gmail",
            external_id: item.id,
            detected_source: detected,
            student_id: match?.student.id || null,
            lesson_id: lessonId || null,
            status,
            confidence: Math.max(
              intakeDecision.confidence,
              match?.confidence || 0.65,
            ),
            matched_by: lessonId
              ? `${match?.matchedBy || "provider message"}; classifier:${intakeDecision.reasonCode}`
              : `classifier:${intakeDecision.reasonCode}`,
            payload: {
              headers,
              snippet: message.snippet,
              threadId: message.threadId,
              candidate,
              changeType,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "studio_id,provider,external_id" },
        ),
      );
      if (persisted.error) throw persisted.error;
      if (lessonId && match) {
        const coverage = await checkedQuery(
          db.rpc("reserve_student_upcoming_credits", {
            p_student: match.student.id,
          }),
        );
        if (coverage.error) throw coverage.error;
      }
      if (lessonId) imported++;
      else review++;
    } catch (error) {
      if (error instanceof WorkerDisabledError) throw error;
      failures.push(error);
    }
  }
  if (failures.length) throw failures[0];
  await db
    .from("recommendations")
    .update({ status: "resolved", updated_at: new Date().toISOString() })
    .eq("dedupe_key", `studio:${studio.id}:gmail-read`);
  return { review, imported, scope: true };
}

export async function runProviderIntake(telemetry?: WorkerTelemetry) {
  if (!workerEnabled("provider-intake"))
    return disabledWorkerResult("provider-intake");
  telemetry?.stage("studios_and_stale_reviews");
  const db = serviceClient(),
    { data: studios, error } = await db
      .from("studios")
      .select("id,settings,timezone");
  if (error) throw error;
  const { data: pendingReviews, error: pendingError } = await db
    .from("integration_imports")
    .select("id,payload")
    .eq("status", "needs_review");
  if (pendingError) throw pendingError;
  const staleIds = (pendingReviews || [])
    .filter((item) => staleReviewPayload(item.payload))
    .map((item) => item.id);
  assertWorkerEnabled("provider-intake");
  if (staleIds.length) {
    const { error: cleanupError } = await db
      .from("integration_imports")
      .update({
        status: "ignored",
        matched_by: "past_appointment",
        updated_at: new Date().toISOString(),
      })
      .in("id", staleIds);
    if (cleanupError) throw cleanupError;
  }
  assertWorkerEnabled("provider-intake");
  telemetry?.stage("google_token");
  const token = await googleAccessToken();
  let calendarImported = 0,
    calendarReview = 0,
    gmailImported = 0,
    gmailReview = 0,
    gmailScope = true;
  const failures: unknown[] = [];
  for (const studio of studios || []) {
    assertWorkerEnabled("provider-intake");
    telemetry?.stage("student_identities");
    const { data: students, error: studentError } = await db
      .from("students")
      .select("id,full_name,preferred_name,email,guardian_name,guardian_email")
      .eq("studio_id", studio.id)
      .is("deleted_at", null);
    if (studentError) {
      telemetry?.failure(studentError);
      failures.push(studentError);
      continue;
    }
    telemetry?.stage("calendar_processing");
    try {
      const calendar = await importCalendar(token, studio, students || []);
      calendarImported += calendar.imported;
      calendarReview += calendar.review;
    } catch (error) {
      telemetry?.failure(error);
      failures.push(error);
    }
    assertWorkerEnabled("provider-intake");
    telemetry?.stage("gmail_processing");
    try {
      const gmail = await scanGmail(token, studio, students || []);
      gmailImported += gmail.imported;
      gmailReview += gmail.review;
      gmailScope = gmailScope && gmail.scope;
      if (!gmail.scope) {
        const permission = { code: "GMAIL_READ_PERMISSION" };
        telemetry?.failure(permission);
        failures.push(permission);
      }
    } catch (error) {
      telemetry?.failure(error);
      failures.push(error);
    }
  }
  if (failures.length) {
    // Close the actual final processing stage before rejecting the aggregate.
    // Its success must not become a false Gmail failure. Retain the underlying
    // category/retry guidance; the scheduled wrapper sanitizes it for receipts.
    telemetry?.stage("completion");
    throw failures[0];
  }
  return {
    ok: true,
    calendarImported,
    calendarReview,
    gmailImported,
    gmailReview,
    gmailScope,
  };
}
