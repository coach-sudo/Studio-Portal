import { calendarOAuthConfig, calendarOAuthStudio } from "./calendar-oauth";
import { activeCalendarRoles } from "./calendar-roles";
import {
  gmailGrantStatus,
  gmailOAuthConfig,
  legacyGoogleCredential,
} from "./gmail-oauth";
import { serviceClient } from "./supabase";
import { z } from "zod";

const googleErrorSchema = z
  .object({ message: z.string().optional() })
  .passthrough()
  .optional();
const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1).optional(),
    error: z.string().optional(),
  })
  .passthrough();
const gmailResponseSchema = z
  .object({ id: z.string().optional(), error: googleErrorSchema })
  .passthrough();
const providerInstant = z.iso.datetime({ offset: true });
const freeBusyResponseSchema = z
  .object({
    timeMin: z.string().optional(),
    timeMax: z.string().optional(),
    error: googleErrorSchema,
    calendars: z
      .record(
        z.string(),
        z
          .object({
            busy: z
              .array(z.object({ start: z.string(), end: z.string() }))
              .optional(),
            errors: z
              .array(z.object({ reason: z.string().optional() }).passthrough())
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
const calendarEventsResponseSchema = z
  .object({
    error: googleErrorSchema,
    items: z
      .array(
        z
          .object({
            id: z.string().optional(),
            summary: z.string().optional(),
            status: z.string().optional(),
            transparency: z.string().optional(),
            start: z
              .object({
                dateTime: z.string().optional(),
                date: z.string().optional(),
              })
              .optional(),
            end: z
              .object({
                dateTime: z.string().optional(),
                date: z.string().optional(),
              })
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

function parseGooglePayload<T extends z.ZodType>(schema: T, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "PROVIDER_UNAVAILABLE: Google returned an invalid payload.",
    );
  return parsed.data as z.infer<T>;
}

export class GoogleAvailabilityError extends Error {
  constructor(
    message: string,
    readonly throttled = false,
    readonly retryable = false,
    readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

function availabilityError(response: Response, reason?: string) {
  const throttled =
    response.status === 429 ||
    ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(
      reason ?? "",
    );
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMs = !retryAfter
    ? 0
    : /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
  return new GoogleAvailabilityError(
    "CALENDAR_UNAVAILABLE: Google availability could not be verified.",
    throttled,
    throttled ||
      response.status >= 500 ||
      reason === "internalError" ||
      reason === "backendError",
    retryAfterMs,
  );
}

export class GoogleAuthorizationError extends Error {
  constructor(readonly reason: "configuration" | "authorization") {
    super("Google authorization requires review.");
  }
}

export async function googleAccessToken(
  signal?: AbortSignal,
  lane: "calendar" | "gmail" | { gmailDeliveryStudio: string } = "calendar",
) {
  let { clientId, clientSecret, refreshToken } = legacyGoogleCredential();
  if (typeof lane === "object") {
    const db = serviceClient();
    const studio = await calendarOAuthStudio(db);
    if (studio === lane.gmailDeliveryStudio) {
      const config = gmailOAuthConfig();
      const grant = await gmailGrantStatus(db, studio, config?.clientId);
      if (grant) {
        if (!config || !grant.clientMatches || grant.account !== config.account)
          throw new GoogleAuthorizationError("configuration");
        const stored = await db
          .rpc("gmail_delivery_oauth_refresh", {
            p_studio: studio,
            p_email: config.account,
            p_client: config.clientId,
          })
          .abortSignal(signal ?? AbortSignal.timeout(3000));
        if (stored.error)
          throw new Error("Gmail authorization could not be read.");
        if (typeof stored.data !== "string" || !stored.data)
          throw new GoogleAuthorizationError("authorization");
        ({ clientId, clientSecret } = config);
        refreshToken = stored.data;
      }
    }
  }
  const oauth = lane === "calendar" ? calendarOAuthConfig() : null;
  if (oauth) {
    const db = serviceClient();
    const studio = await calendarOAuthStudio(db);
    if (!studio) throw new GoogleAuthorizationError("configuration");
    const stored = await db
      .rpc("calendar_oauth_refresh", {
        p_studio: studio,
        p_email: oauth.account,
      })
      .abortSignal(signal ?? AbortSignal.timeout(3000));
    if (stored.error)
      throw new Error("Calendar authorization could not be read.");
    if (typeof stored.data === "string" && stored.data)
      refreshToken = stored.data;
  }
  if (!clientId || !clientSecret || !refreshToken)
    throw new GoogleAuthorizationError("configuration");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (signal && (response.status === 429 || response.status >= 500))
    throw availabilityError(response);
  const body = parseGooglePayload(tokenResponseSchema, await response.json());
  if (!response.ok || !body.access_token) {
    if (body.error === "invalid_client" || body.error === "unauthorized_client")
      throw new GoogleAuthorizationError("configuration");
    if (body.error === "invalid_grant" || response.status === 401)
      throw new GoogleAuthorizationError("authorization");
    throw new Error("Google token refresh failed.");
  }
  return body.access_token;
}
export async function sendGmail(
  token: string,
  message: {
    recipient: string;
    subject: string;
    body: string;
    html_body?: string | null;
  },
) {
  const clean = (value: string) =>
    value
      .replace(/\u00e2\u20ac\u201d/g, "—")
      .replace(/\u00e2\u20ac\u2122/g, "’")
      .replace(/\u00e2\u20ac\u00a2/g, "•")
      .replace(/\u00c2\u00a0/g, " ")
      .normalize("NFC")
      .replace(/[\u200B-\u200D\uFEFF\uFFFD]/g, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\r?\n/g, "\r\n");
  const subject = `=?UTF-8?B?${Buffer.from(clean(message.subject), "utf8").toString("base64")}?=`;
  const encodedBody = Buffer.from(clean(message.body), "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n")
    .trim();
  // New branded mail keeps an independent text alternative. Legacy plain-text mail is unchanged.
  const boundary = `coachd_${crypto.randomUUID().replaceAll("-", "")}`;
  const encodedHtml =
    message.html_body &&
    Buffer.from(clean(message.html_body), "utf8")
      .toString("base64")
      .replace(/.{1,76}/g, "$&\r\n")
      .trim();
  const content = encodedHtml
    ? `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedHtml}\r\n--${boundary}--`
    : `Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}`;
  if (/[\r\n]/.test(message.recipient))
    throw new Error("VALIDATION_FAILED: Invalid email recipient.");
  const raw = Buffer.from(
    `MIME-Version: 1.0\r\nTo: ${message.recipient}\r\nSubject: ${subject}\r\n${content}`,
  ).toString("base64url");
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  const payload = parseGooglePayload(
    gmailResponseSchema,
    await response.json(),
  );
  if (!response.ok)
    throw new Error(`Gmail delivery failed: ${JSON.stringify(payload)}`);
  return payload;
}
export async function googleFreeBusy(
  token: string,
  timeMin: string,
  timeMax: string,
  options?: { signal: AbortSignal; requireComplete: true },
) {
  const { availability } = await activeCalendarRoles();
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      method: "POST",
      signal: options?.signal ?? AbortSignal.timeout(5000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        timeZone: "UTC",
        items: availability.map((id) => ({ id })),
      }),
    },
  );
  if (response.status === 429 || response.status >= 500)
    throw availabilityError(response);
  const raw: unknown = await response.json();
  if (!response.ok) {
    const failure = z
      .object({
        error: z
          .object({
            errors: z
              .array(z.object({ reason: z.string().optional() }))
              .optional(),
          })
          .optional(),
      })
      .safeParse(raw);
    throw availabilityError(response, failure.data?.error?.errors?.[0]?.reason);
  }
  const payload = parseGooglePayload(freeBusyResponseSchema, raw);
  const calendars = payload.calendars ?? {};
  const entries = Object.values(calendars);
  if (
    payload.error ||
    Date.parse(payload.timeMin ?? "") !== Date.parse(timeMin) ||
    Date.parse(payload.timeMax ?? "") !== Date.parse(timeMax)
  )
    throw availabilityError(response);
  return availability.flatMap((id) => {
    // An unmanaged primary alias can be normalized to its actual calendar ID.
    const calendar =
      calendars[id] ??
      (id === "primary" && availability.length === 1 && entries.length === 1
        ? entries[0]
        : undefined);
    if (calendar?.errors?.length)
      throw availabilityError(response, calendar.errors[0].reason);
    if (
      !calendar?.busy ||
      calendar.busy.some(
        ({ start, end }) =>
          !providerInstant.safeParse(start).success ||
          !providerInstant.safeParse(end).success ||
          !(Date.parse(start) < Date.parse(end)),
      )
    )
      throw availabilityError(response);
    return calendar.busy;
  });
}

export interface GoogleCalendarConflict {
  id: string;
  summary: string;
  start: string;
  end: string;
}
export async function googleCalendarConflicts(
  token: string,
  timeMin: string,
  timeMax: string,
  signal?: AbortSignal,
) {
  if (calendarOAuthConfig()) {
    const busy = await googleFreeBusy(token, timeMin, timeMax, {
      signal: signal ?? AbortSignal.timeout(5000),
      requireComplete: true,
    });
    return busy.map(({ start, end }) => ({
      id: `busy:${start}:${end}`,
      summary: "Busy calendar time",
      start,
      end,
    }));
  }
  const calendarId = Netlify.env.get("GOOGLE_CALENDAR_ID") || "primary";
  const query = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
    {
      signal,
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (signal && (response.status === 429 || response.status >= 500))
    throw availabilityError(response);
  const payload = parseGooglePayload(
    calendarEventsResponseSchema,
    await response.json(),
  );
  if (!response.ok)
    throw new Error(
      `CALENDAR_UNAVAILABLE (${response.status}: ${payload.error?.message || "provider error"})`,
    );
  return (payload.items || [])
    .filter(
      (item) =>
        item.status !== "cancelled" &&
        item.transparency !== "transparent" &&
        item.start &&
        item.end,
    )
    .map((item) => ({
      id: item.id || "calendar-event",
      summary: item.summary || "Busy calendar event",
      start: item.start?.dateTime || item.start?.date || timeMin,
      end: item.end?.dateTime || item.end?.date || timeMax,
    }));
}
