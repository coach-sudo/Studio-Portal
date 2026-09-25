import { z } from "zod";

const googleErrorSchema = z
  .object({ message: z.string().optional() })
  .passthrough()
  .optional();
const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1).optional(),
    error_description: z.string().optional(),
  })
  .passthrough();
const gmailResponseSchema = z
  .object({ id: z.string().optional(), error: googleErrorSchema })
  .passthrough();
const freeBusyResponseSchema = z
  .object({
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

export async function googleAccessToken() {
  const clientId =
      Netlify.env.get("GOOGLE_CLIENT_ID") ||
      Netlify.env.get("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret =
      Netlify.env.get("GOOGLE_CLIENT_SECRET") ||
      Netlify.env.get("GOOGLE_OAUTH_CLIENT_SECRET"),
    refreshToken = Netlify.env.get("GOOGLE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken)
    throw new Error("Google OAuth requires reconnecting in Settings.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = parseGooglePayload(tokenResponseSchema, await response.json());
  if (!response.ok || !body.access_token)
    throw new Error(body.error_description || "Google token refresh failed.");
  return body.access_token;
}
export async function sendGmail(
  token: string,
  message: { recipient: string; subject: string; body: string },
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
  const raw = Buffer.from(
    `MIME-Version: 1.0\r\nTo: ${message.recipient}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}`,
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
) {
  const calendarId = Netlify.env.get("GOOGLE_CALENDAR_ID") || "primary";
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        timeZone: "UTC",
        items: [{ id: calendarId }],
      }),
    },
  );
  const payload = parseGooglePayload(
    freeBusyResponseSchema,
    await response.json(),
  );
  const calendarError = payload.calendars?.[calendarId]?.errors?.[0]?.reason;
  if (!response.ok || calendarError)
    throw new Error(
      `CALENDAR_UNAVAILABLE (${response.status}: ${payload.error?.message || calendarError || "provider error"})`,
    );
  return payload.calendars?.[calendarId]?.busy ?? [];
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
) {
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
      headers: { Authorization: `Bearer ${token}` },
    },
  );
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
