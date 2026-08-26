import type { Config } from "@netlify/functions";
import { googleAccessToken } from "./_shared/google";
import { serviceClient } from "./_shared/supabase";
import { zonedDateTimeToUtc } from "./_shared/timezone";
import { queueLessonChangeEmails } from "./_shared/booking-email";

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
const provider = (text: string) =>
  /lessonface/i.test(text)
    ? "lessonface"
    : /wyzant/i.test(text)
      ? "wyzant"
      : /lessons\.com/i.test(text)
        ? "lessons_com"
        : /(acuity|squarespace scheduling)/i.test(text)
          ? "acuity"
          : undefined;
const displayProvider = (value: string) =>
  (
    ({
      lessonface: "Lessonface",
      wyzant: "Wyzant",
      lessons_com: "Lessons.com",
      acuity: "Acuity",
      google_calendar: "Google Calendar",
      gmail: "Gmail",
    }) as Record<string, string>
  )[value] || value;
const looksLikeLesson = (text: string) =>
  /(lesson|coaching|acting|audition|session|class|consultation|rehearsal)/i.test(
    text,
  );
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
      !/\b(booked|booking (?:confirmed|confirmation)|confirmed|scheduled|new (?:lesson|session|booking|appointment))\b/i.test(text))
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
    (identityMatches || providerMatches || topicMatches)
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
        /\b\d+\s*min\b|\bprepaid\b|lessonface|wyzant|lessons\.com|acuity|confirmed|booking/gi,
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

function matchStudent(students: StudentRow[], text: string, emails: string[]) {
  const normalizedEmails = emails.map((value) => normalize(value));
  const byEmail = students.find((student) =>
    [student.email, student.guardian_email].some(
      (value) => value && normalizedEmails.includes(normalize(value)),
    ),
  );
  if (byEmail)
    return { student: byEmail, matchedBy: "email", confidence: 0.99 };
  const haystack = ` ${normalize(text)} `;
  const byName = students.find((student) =>
    [student.full_name, student.preferred_name, student.guardian_name]
      .filter(Boolean)
      .some((value) => {
        const name = normalize(value);
        return name.length >= 4 && haystack.includes(` ${name} `);
      }),
  );
  return byName
    ? {
        student: byName,
        matchedBy: "student or guardian name",
        confidence: 0.91,
      }
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
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      payload = (await response.json()) as {
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
      .select(
        "lesson_id,external_event_id,external_version,projected_version",
      )
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
      projections.map((projection) => [projection.external_event_id, projection]),
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
    { error: changeError } = await db.rpc("command_change_lesson_state", {
      p_lesson_id: lesson.id,
      p_expected_version: lesson.version,
      p_action: change === "cancellation" ? "cancel" : "reschedule",
      p_starts_at: change === "reschedule" ? event.start?.dateTime : null,
      p_ends_at: change === "reschedule" ? event.end?.dateTime : null,
      // Google is the source of this mutation. Re-projecting it would create a loop.
      p_queue_calendar: false,
    });
  if (changeError) {
    await Promise.all([
      db.from("sync_conflicts").insert({
        studio_id: studio.id,
        entity_type: "lesson",
        entity_id: lesson.id,
        source: "google_calendar",
        internal_version: lesson.version,
        external_payload: event,
        status: "open",
      }),
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
  await Promise.all([
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
  ]);
  return true;
}

async function importCalendar(
  token: string,
  studio: any,
  students: StudentRow[],
) {
  const db = serviceClient(),
    calendar = encodeURIComponent(
      Netlify.env.get("GOOGLE_CALENDAR_ID") || "primary",
    ),
    from = new Date(Date.now() - 14 * 86400000).toISOString(),
    to = new Date(Date.now() + 90 * 86400000).toISOString();
  const events = await listCalendarEvents(token, calendar, from, to),
    managed = await managedCalendarRows(db, events);
  let imported = 0,
    review = 0;
  for (const event of events) {
    if (!event.id) continue;
    const projection = managed.projections.get(event.id),
      managedLesson = projection
        ? managed.lessons.get(projection.lesson_id)
        : undefined;
    if (projection && managedLesson) {
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
          const { error: changeError } = await db.rpc(
            "command_change_lesson_state",
            {
              p_lesson_id: lesson.id,
              p_expected_version: lesson.version,
              p_action: "cancel",
              p_starts_at: null,
              p_ends_at: null,
              p_queue_calendar: false,
            },
          );
          if (changeError) throw changeError;
          await queueLessonChangeEmails(db, lesson.id, "cancelled", correlation);
          await Promise.all([
            db
              .from("calendar_projections")
              .update({
                status: "projected",
                external_version: event.etag || event.updated || null,
                last_projected_at: new Date().toISOString(),
                last_error: null,
              })
              .eq("lesson_id", lesson.id),
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
      match = matchStudent(candidates, matchText, emails),
      identity = titleIdentity(event.summary || "");
    if (!detected && !match && !identity) continue;
    if (!looksLikeLesson(text) && !detected) continue;
    const source = detected || "google_calendar";
    const { data: prior } = await db
      .from("integration_imports")
      .select("id,lesson_id,status")
      .eq("studio_id", studio.id)
      .eq("provider", "google_calendar")
      .eq("external_id", event.id)
      .maybeSingle();
    let student = match?.student;
    if (!student && identity) {
      student = candidates.find(
        (item) => normalize(item.full_name) === normalize(identity.fullName),
      );
      if (!student && emails[0]) {
        const { data: created, error } = await db
          .from("students")
          .insert({
            studio_id: studio.id,
            full_name: identity.fullName,
            preferred_name: identity.preferred || null,
            email: emails[0].toLowerCase(),
            status: "lead",
            lead_source: displayProvider(source),
            portal_enabled: false,
          })
          .select(
            "id,full_name,preferred_name,email,guardian_name,guardian_email",
          )
          .single();
        if (!error && created) {
          student = created;
          students.push(created);
        }
      }
    }
    if (!student && detected && emails[0]) {
      const fallback =
        (event.summary || displayProvider(detected))
          .replace(
            /lessonface|wyzant|lessons\.com|acuity|confirmed|booking|lesson|session/gi,
            " ",
          )
          .replace(/\s+/g, " ")
          .trim() || `${displayProvider(detected)} student`;
      const { data: created, error } = await db
        .from("students")
        .insert({
          studio_id: studio.id,
          full_name: fallback,
          email: emails[0].toLowerCase(),
          status: "lead",
          lead_source: displayProvider(detected),
          portal_enabled: false,
        })
        .select(
          "id,full_name,preferred_name,email,guardian_name,guardian_email",
        )
        .single();
      if (!error && created) {
        student = created;
        students.push(created);
      }
    }
    const confidence =
      match?.confidence ||
      (student && identity?.fullName ? 0.88 : detected?.length ? 0.7 : 0.5);
    let lessonId: string | undefined;
    if (student) {
      const { data: lesson, error } = await db
        .from("lessons")
        .upsert(
          {
            studio_id: studio.id,
            student_id: student.id,
            topic: event.summary || `${displayProvider(source)} lesson`,
            starts_at: event.start.dateTime,
            ends_at: event.end.dateTime,
            status:
              new Date(event.end.dateTime) < new Date()
                ? "completed"
                : "scheduled",
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
          },
          { onConflict: "studio_id,source_provider,source_external_id" },
        )
        .select("id,version")
        .single();
      if (!error && lesson) {
        lessonId = lesson.id;
        await db
          .from("lesson_participants")
          .delete()
          .eq("lesson_id", lesson.id);
        await Promise.all([
          db.from("lesson_participants").insert({
            lesson_id: lesson.id,
            student_id: student.id,
            display_name: student.preferred_name || student.full_name,
            email: student.email || emails[0] || "",
            status: "confirmed",
          }),
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
        ]);
        imported++;
      }
    } else {
      if (prior?.lesson_id)
        await db
          .from("lessons")
          .delete()
          .eq("id", prior.lesson_id)
          .eq("source_provider", source);
      review++;
    }
    await db.from("integration_imports").upsert(
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
          (student && identity ? "calendar event title" : null),
        payload: event,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "studio_id,provider,external_id" },
    );
  }
  return { imported, review };
}

async function scanGmail(token: string, studio: any, students: StudentRow[]) {
  const db = serviceClient(),
    query = encodeURIComponent(
      'newer_than:90d {lessonface wyzant "lessons.com" acuity "squarespace scheduling"}',
    ),
    messageIds: Array<{ id: string }> = [];
  let pageToken: string | undefined;
  do {
    const list = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      payload = (await list.json()) as {
        messages?: Array<{ id: string }>;
        nextPageToken?: string;
        error?: any;
      };
    if (!list.ok) {
      await db.from("recommendations").upsert(
        {
          studio_id: studio.id,
          entity_type: "integration",
          reason_code: "gmail_read_scope_required",
          title: "Reconnect Google to import booking emails",
          explanation:
            "Sending email works, but smart booking intake also needs read-only Gmail permission.",
          evidence: [payload.error?.message || "Gmail read unavailable"],
          urgency: 3,
          suggested_action: "open_integrations",
          requires_confirmation: false,
          status: "open",
          dedupe_key: `studio:${studio.id}:gmail-read`,
        },
        { onConflict: "dedupe_key" },
      );
      return { review: 0, imported: 0, scope: false };
    }
    messageIds.push(...(payload.messages || []));
    pageToken = payload.nextPageToken;
  } while (pageToken);
  let review = 0,
    imported = 0;
  for (const item of messageIds) {
    const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      message = (await response.json()) as any;
    if (!response.ok) continue;
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
      match = matchStudent(eligibleStudents(studio, students), text, emails),
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
    if (!messageKind) {
      if (prior?.status === "needs_review")
        await db
          .from("integration_imports")
          .update({
            status: "ignored",
            confidence: 0,
            matched_by: "Filtered: not a booking or lesson change",
            updated_at: new Date().toISOString(),
          })
          .eq("id", prior.id);
      continue;
    }
    const changeType = messageKind;
    const isCancellation = changeType === "cancellation";
    const isReschedule = changeType === "reschedule";
    if (prior?.status === "ignored") continue;
    if (
      prior?.status === "imported" &&
      prior.lesson_id &&
      !isCancellation &&
      !isReschedule
    )
      continue;
    let lessonId = prior?.lesson_id as string | undefined;
    if (match && (isCancellation || isReschedule) && !lessonId) {
      let candidatesQuery = db
        .from("lessons")
        .select("id,starts_at,ends_at,status,version")
        .eq("studio_id", studio.id)
        .eq("student_id", match.student.id)
        .eq("source_provider", detected)
        .neq("status", "cancelled")
        .order("starts_at");
      if (candidate)
        candidatesQuery = candidatesQuery
          .gte(
            "starts_at",
            new Date(
              new Date(candidate.startsAt).getTime() - 14 * 86400000,
            ).toISOString(),
          )
          .lte(
            "starts_at",
            new Date(
              new Date(candidate.startsAt).getTime() + 14 * 86400000,
            ).toISOString(),
          );
      else
        candidatesQuery = candidatesQuery.gte(
          "starts_at",
          new Date(Date.now() - 7 * 86400000).toISOString(),
        );
      const { data: possible } = await candidatesQuery.limit(3);
      const target =
        possible?.length === 1
          ? possible[0]
          : candidate
            ? possible?.sort(
                (left, right) =>
                  Math.abs(
                    new Date(left.starts_at).getTime() -
                      new Date(candidate.startsAt).getTime(),
                  ) -
                  Math.abs(
                    new Date(right.starts_at).getTime() -
                      new Date(candidate.startsAt).getTime(),
                  ),
              )[0]
            : undefined;
      if (target) {
        lessonId = target.id;
        const correlation = `gmail-change:${item.id}`;
        if (isCancellation) {
          const { error: changeError } = await db.rpc(
            "command_change_lesson_state",
            {
              p_lesson_id: target.id,
              p_expected_version: target.version,
              p_action: "cancel",
              p_starts_at: null,
              p_ends_at: null,
              p_queue_calendar: true,
            },
          );
          if (changeError) throw changeError;
          await queueLessonChangeEmails(db, target.id, "cancelled", correlation);
        } else if (candidate) {
          const { error: changeError } = await db.rpc(
            "command_change_lesson_state",
            {
              p_lesson_id: target.id,
              p_expected_version: target.version,
              p_action: "reschedule",
              p_starts_at: candidate.startsAt,
              p_ends_at: candidate.endsAt,
              p_queue_calendar: true,
            },
          );
          if (changeError) throw changeError;
          await db.from("lessons").update({ topic: candidate.topic }).eq("id", target.id);
          await queueLessonChangeEmails(db, target.id, "rescheduled", correlation);
        }
        await db.from("audit_events").insert({
          studio_id: studio.id,
          entity_type: "lesson",
          entity_id: target.id,
          action: isCancellation
            ? "lesson.cancelled_from_email"
            : "lesson.rescheduled_from_email",
          reason: `${displayProvider(detected)} email update`,
          correlation_id: correlation,
          source: "provider_intake",
          before_state: target,
          after_state: isCancellation ? { status: "cancelled" } : candidate,
        });
      }
    }
    let createdFromGmail = false;
    if (candidate && !lessonId && !isCancellation && !isReschedule) {
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
      const duplicates = (possible || []).filter((lesson: ExistingLessonCandidate) =>
        isSameScheduledLesson(
          candidate,
          lesson,
          detected,
          match?.student.id,
        ),
      );
      if (duplicates.length === 1) lessonId = duplicates[0].id;
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
          status:
            new Date(candidate.endsAt) < new Date()
              ? "completed"
              : "scheduled",
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
            email: match.student.email || emails[0] || "",
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
    await db.from("integration_imports").upsert(
      {
        studio_id: studio.id,
        provider: "gmail",
        external_id: item.id,
        detected_source: detected,
        student_id: match?.student.id || null,
        lesson_id: lessonId || null,
        status,
        confidence: match?.confidence || 0.65,
        matched_by: lessonId
          ? `${match?.matchedBy || "provider message"}; Gmail lesson parsed`
          : match?.matchedBy || null,
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
    );
    if (lessonId) imported++;
    else review++;
  }
  await db
    .from("recommendations")
    .update({ status: "resolved", updated_at: new Date().toISOString() })
    .eq("dedupe_key", `studio:${studio.id}:gmail-read`);
  return { review, imported, scope: true };
}

export async function runProviderIntake() {
  const db = serviceClient(),
    { data: studios, error } = await db
      .from("studios")
      .select("id,settings,timezone");
  if (error) throw error;
  const token = await googleAccessToken();
  let calendarImported = 0,
    calendarReview = 0,
    gmailImported = 0,
    gmailReview = 0,
    gmailScope = true;
  for (const studio of studios || []) {
    const { data: students } = await db
      .from("students")
      .select("id,full_name,preferred_name,email,guardian_name,guardian_email")
      .eq("studio_id", studio.id)
      .is("deleted_at", null);
    const calendar = await importCalendar(token, studio, students || []);
    calendarImported += calendar.imported;
    calendarReview += calendar.review;
    const gmail = await scanGmail(token, studio, students || []);
    gmailImported += gmail.imported;
    gmailReview += gmail.review;
    gmailScope = gmailScope && gmail.scope;
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
export default async () => Response.json(await runProviderIntake());
export const config: Config = { schedule: "*/10 * * * *" };
