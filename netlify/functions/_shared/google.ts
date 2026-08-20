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
  const body = (await response.json()) as {
    access_token?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token)
    throw new Error(body.error_description || "Google token refresh failed.");
  return body.access_token;
}
export async function sendGmail(
  token: string,
  message: { recipient: string; subject: string; body: string },
) {
  const raw = Buffer.from(
    `To: ${message.recipient}\r\nSubject: ${message.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message.body}`,
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
  const payload = await response.json();
  if (!response.ok)
    throw new Error(`Gmail delivery failed: ${JSON.stringify(payload)}`);
  return payload as { id?: string };
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
  const payload = (await response.json()) as {
    error?: { message?: string };
    calendars?: Record<
      string,
      {
        busy?: { start: string; end: string }[];
        errors?: { reason?: string }[];
      }
    >;
  };
  const calendarError = payload.calendars?.[calendarId]?.errors?.[0]?.reason;
  if (!response.ok || calendarError)
    throw new Error(
      `CALENDAR_UNAVAILABLE (${response.status}: ${payload.error?.message || calendarError || "provider error"})`,
    );
  return payload.calendars?.[calendarId]?.busy ?? [];
}
