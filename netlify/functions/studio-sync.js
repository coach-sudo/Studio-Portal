function json(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function getAppsScriptUrl() {
  return String(process.env.GOOGLE_APPS_SCRIPT_URL || process.env.NETLIFY_GAS_URL || "").trim();
}

function getAppsScriptToken() {
  return String(process.env.GOOGLE_APPS_SCRIPT_TOKEN || process.env.STUDIO_PORTAL_TOKEN || "").trim();
}

function getGoogleAccountEmail() {
  return String(process.env.GOOGLE_ACCOUNT_EMAIL || "coach@d-a-j.com").trim();
}

function getGoogleClientId() {
  return String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
}

function getGoogleClientSecret() {
  return String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
}

function getGoogleRedirectUri() {
  return String(process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim();
}

function getGoogleRefreshToken() {
  return String(process.env.GOOGLE_REFRESH_TOKEN || "").trim();
}

function getGoogleCalendarId() {
  return String(process.env.GOOGLE_CALENDAR_ID || "primary").trim();
}

function getGmailMaxResults() {
  var value = Number(process.env.GMAIL_SYNC_MAX_RESULTS || 25);
  if (!value || Number.isNaN(value)) return 25;
  return Math.min(Math.max(value, 1), 100);
}

function getGmailSyncQuery() {
  return String(
    process.env.GMAIL_SYNC_QUERY ||
    'newer_than:120d ((from:lessons.com OR from:lessonface.com OR from:acuityscheduling.com) OR (subject:booking OR subject:appointment OR subject:"upcoming booking" OR subject:lesson OR subject:session OR subject:payment OR subject:"new order" OR subject:cancel OR subject:cancelled OR subject:canceled OR subject:rescheduled OR subject:reschedule OR subject:changed OR subject:updated))'
  ).trim();
}

function getCalendarSyncWindowDays() {
  return {
    past: 30,
    future: 60
  };
}

function getBooleanEnv(name) {
  var raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function getAccessTokenFromRefreshToken() {
  var clientId = getGoogleClientId();
  var clientSecret = getGoogleClientSecret();
  var refreshToken = getGoogleRefreshToken();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google OAuth is not fully configured yet.");
  }

  var body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("refresh_token", refreshToken);
  body.set("grant_type", "refresh_token");

  var response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  var payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Unable to refresh Google access token.");
  }

  return payload.access_token;
}

async function fetchGoogleJson(url, accessToken) {
  var response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + accessToken
    }
  });

  var payload = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    throw new Error(payload.error && payload.error.message ? payload.error.message : "Google API request failed.");
  }

  return payload;
}

function addDays(date, days) {
  var next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeBase64Url(value) {
  if (!value) return "";
  return Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function getHeaderValue(headers, name) {
  var target = String(name || "").toLowerCase();
  var found = (headers || []).find(function (header) {
    return String(header.name || "").toLowerCase() === target;
  });
  return found ? String(found.value || "").trim() : "";
}

function collectMessageBodies(part, chunks) {
  if (!part) return;
  var mimeType = String(part.mimeType || "").toLowerCase();
  var bodyData = part.body && part.body.data ? decodeBase64Url(part.body.data) : "";

  if (bodyData && mimeType === "text/plain") {
    chunks.plain.push(bodyData);
  } else if (bodyData && mimeType === "text/html") {
    chunks.html.push(bodyData);
  }

  (part.parts || []).forEach(function (child) {
    collectMessageBodies(child, chunks);
  });
}

function getMessageBodyText(payload) {
  var chunks = {
    plain: [],
    html: []
  };

  collectMessageBodies(payload, chunks);
  if (chunks.plain.length) {
    return chunks.plain.join("\n").trim();
  }
  if (chunks.html.length) {
    return stripHtml(chunks.html.join("\n"));
  }
  return "";
}

function isLikelyLessonCalendarEventBackend(event) {
  var blob = ((event.summary || "") + "\n" + (event.description || "")).toLowerCase();
  if (/^busy\b|\bto do\b|\bpop up\b|\bbackstage\b|\bpersonal\b/.test(blob)) return false;
  return /\blesson\b|\bacting\b|\baudition\b|\bcoaching\b|\bintro session\b|\blessonface\b|\bacuity\b|\bpublic speaking\b|\bservice:\b/.test(blob);
}

function isLikelyLessonGmailMessageBackend(message) {
  var blob = ((message.subject || "") + "\n" + (message.body || "") + "\n" + (message.from || "")).toLowerCase();
  return /\blesson\b|\bacting\b|\baudition\b|\bcoaching\b|\blessonface\b|\bacuity\b|\bservice:\b|\bjoin zoom\b|\bpaid online\b|\bupcoming booking\b|\bview booking\b|\blessons\.com\b|\bpayment\b|\bnew order\b|\bcancel(?:led|ed|lation)?\b|\breschedul(?:e|ed|ing)\b|\bappointment (?:updated|changed)\b|\bbooking (?:updated|changed|cancelled|canceled)\b/.test(blob);
}

function inferCalendarLocation(event) {
  if (event.location) return String(event.location).trim();
  return "";
}

function inferCalendarDescription(event) {
  return String(event.description || "").trim();
}

function getRelevantAttendee(event) {
  var accountEmail = getGoogleAccountEmail().toLowerCase();
  var attendees = Array.isArray(event.attendees) ? event.attendees : [];
  return attendees.find(function (attendee) {
    var email = String(attendee.email || "").toLowerCase();
    return email && email !== accountEmail && attendee.self !== true;
  }) || null;
}

function normalizeCalendarEvent(event) {
  var attendee = getRelevantAttendee(event);
  return {
    id: String(event.id || "").trim(),
    calendar_id: getGoogleCalendarId(),
    title: String(event.summary || "").trim(),
    description: inferCalendarDescription(event),
    location: inferCalendarLocation(event),
    start: event.start && (event.start.dateTime || event.start.date) ? String(event.start.dateTime || event.start.date).trim() : "",
    end: event.end && (event.end.dateTime || event.end.date) ? String(event.end.dateTime || event.end.date).trim() : "",
    updated_at: String(event.updated || "").trim(),
    attendee_email: attendee ? String(attendee.email || "").trim() : "",
    attendee_name: attendee ? String(attendee.displayName || "").trim() : ""
  };
}

function normalizeGmailMessage(message) {
  var headers = message.payload && Array.isArray(message.payload.headers) ? message.payload.headers : [];
  var receivedAtRaw = getHeaderValue(headers, "Date");
  var receivedAtDate = receivedAtRaw ? new Date(receivedAtRaw) : null;
  return {
    id: String(message.id || "").trim(),
    thread_id: String(message.threadId || "").trim(),
    subject: getHeaderValue(headers, "Subject"),
    from: getHeaderValue(headers, "From"),
    reply_to: getHeaderValue(headers, "Reply-To"),
    received_at: receivedAtDate && !Number.isNaN(receivedAtDate.getTime()) ? receivedAtDate.toISOString() : "",
    body: getMessageBodyText(message.payload || {})
  };
}

async function fetchLiveCalendarEvents() {
  var accessToken = await getAccessTokenFromRefreshToken();
  var windowDays = getCalendarSyncWindowDays();
  var now = new Date();
  var timeMin = addDays(now, -1 * windowDays.past).toISOString();
  var timeMax = addDays(now, windowDays.future).toISOString();
  var url = new URL("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(getGoogleCalendarId()) + "/events");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");

  var payload = await fetchGoogleJson(url.toString(), accessToken);
  return (payload.items || [])
    .filter(isLikelyLessonCalendarEventBackend)
    .map(normalizeCalendarEvent)
    .filter(function (event) {
      return event.id && event.start;
    });
}

async function fetchLiveGmailMessages() {
  var accessToken = await getAccessTokenFromRefreshToken();
  var listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", String(getGmailMaxResults()));
  listUrl.searchParams.set("q", getGmailSyncQuery());

  var payload = await fetchGoogleJson(listUrl.toString(), accessToken);
  var messages = Array.isArray(payload.messages) ? payload.messages : [];
  var results = [];

  for (var i = 0; i < messages.length; i += 1) {
    var messageRef = messages[i];
    var detailUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + encodeURIComponent(messageRef.id) + "?format=full";
    var detail = await fetchGoogleJson(detailUrl, accessToken);
    var normalized = normalizeGmailMessage(detail);
    if (isLikelyLessonGmailMessageBackend(normalized)) {
      results.push(normalized);
    }
  }

  return results;
}

function getSiteUrl(event) {
  var envUrl = String(process.env.URL || process.env.DEPLOY_PRIME_URL || "").trim();
  if (envUrl) {
    return envUrl.replace(/\/$/, "");
  }

  var headers = event && event.headers ? event.headers : {};
  var protocol = String(headers["x-forwarded-proto"] || headers["X-Forwarded-Proto"] || "https").trim();
  var host = String(headers.host || headers.Host || "").trim();
  if (!host) return "";
  return protocol + "://" + host;
}

function getGoogleIntegrationStatusPayload(event) {
  var calendarReady = getBooleanEnv("GOOGLE_CALENDAR_LIVE_READY");
  var gmailReady = getBooleanEnv("GOOGLE_GMAIL_LIVE_READY");
  var oauthConfigured = Boolean(getGoogleClientId() && getGoogleClientSecret());
  var refreshTokenPresent = Boolean(getGoogleRefreshToken());
  var siteUrl = getSiteUrl(event);
  var authStartUrl = siteUrl ? siteUrl + "/api/google-oauth-start" : "/api/google-oauth-start";

  return {
    ok: true,
    google: {
      account_email: getGoogleAccountEmail(),
      sync_mode: "manual",
      gmail_filter_scope: "booking_and_payments",
      import_review_mode: "review_first",
      oauth_configured: oauthConfigured,
      refresh_token_present: refreshTokenPresent,
      auth_start_url: authStartUrl,
      calendar: {
        status: oauthConfigured ? (refreshTokenPresent ? (calendarReady ? "live_ready" : "connected") : "auth_needed") : "backend_incomplete"
      },
      gmail: {
        status: oauthConfigured ? (refreshTokenPresent ? (gmailReady ? "live_ready" : "connected") : "auth_needed") : "backend_incomplete"
      }
    }
  };
}

function buildTargetUrl(action) {
  var baseUrl = getAppsScriptUrl();
  if (!baseUrl) {
    throw new Error("Missing GOOGLE_APPS_SCRIPT_URL environment variable.");
  }

  var url = new URL(baseUrl);
  if (action) {
    url.searchParams.set("action", action);
  }

  var token = getAppsScriptToken();
  if (token) {
    url.searchParams.set("token", token);
  }

  return url.toString();
}

async function proxyPing() {
  var response = await fetch(buildTargetUrl("ping"), {
    method: "GET"
  });

  if (!response.ok) {
    return json(response.status, {
      ok: false,
      error: "Apps Script ping failed."
    });
  }

  var payload = await response.json().catch(function () {
    return { ok: true, service: "studio-portal-backend" };
  });

  return json(200, payload);
}

async function proxySnapshot() {
  var response = await fetch(buildTargetUrl("snapshot"), {
    method: "GET"
  });

  if (!response.ok) {
    return json(response.status, {
      ok: false,
      error: "Apps Script snapshot pull failed."
    });
  }

  var payload = await response.json();
  return json(200, payload);
}

async function proxyPush(eventBody) {
  var body = eventBody || {};
  var response = await fetch(buildTargetUrl("push_snapshot"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "push_snapshot",
      token: getAppsScriptToken(),
      snapshot: body.snapshot || {},
      shapes: body.shapes || {}
    })
  });

  if (!response.ok) {
    return json(response.status, {
      ok: false,
      error: "Apps Script snapshot push failed."
    });
  }

  var payload = await response.json().catch(function () {
    return { ok: true };
  });
  return json(200, payload);
}

async function getGoogleStatus(event) {
  var payload = getGoogleIntegrationStatusPayload(event);

  if (!payload.google.oauth_configured || !payload.google.refresh_token_present) {
    return json(200, payload);
  }

  try {
    await getAccessTokenFromRefreshToken();
    return json(200, payload);
  } catch (error) {
    payload.google.calendar.status = "error";
    payload.google.gmail.status = "error";
    payload.google.error = String(error && error.message ? error.message : error || "Unable to validate Google token.");
    return json(200, payload);
  }
}

async function runCalendarSync() {
  var statusPayload = getGoogleIntegrationStatusPayload();
  if (statusPayload.google.calendar.status === "backend_incomplete" || statusPayload.google.calendar.status === "auth_needed") {
    return json(200, {
      ok: true,
      status: statusPayload.google.calendar.status,
      source: "backend",
      imported: 0,
      updated: 0,
      flagged: 0,
      skipped: 0,
      message: statusPayload.google.calendar.status === "auth_needed"
        ? "Google OAuth is configured, but Netlify still needs a refresh token before live Calendar sync can run."
        : "Google OAuth client credentials are not configured in Netlify yet.",
      google: statusPayload.google
    });
  }

  try {
    await getAccessTokenFromRefreshToken();
  } catch (error) {
    return json(200, {
      ok: true,
      status: "error",
      source: "backend",
      imported: 0,
      updated: 0,
      flagged: 0,
      skipped: 0,
      message: String(error && error.message ? error.message : error || "Unable to validate Google Calendar credentials."),
      google: statusPayload.google
    });
  }

  if (statusPayload.google.calendar.status !== "live_ready") {
    return json(200, {
      ok: true,
      status: "connected",
      source: "backend",
      imported: 0,
      updated: 0,
      flagged: 0,
      skipped: 0,
      message: "Google Calendar authentication is live, but the server-side event pull is still the next step. The portal can keep using the current intake feed for now.",
      google: statusPayload.google
    });
  }

  var events = await fetchLiveCalendarEvents();
  return json(200, {
    ok: true,
    status: "live_ready",
    source: "backend",
    events: events,
    imported: events.length,
    updated: 0,
    flagged: 0,
    skipped: 0,
    message: events.length ? "Live Google Calendar events pulled through the backend." : "Live Google Calendar sync ran, but no lesson-like events were found in the current window.",
    google: statusPayload.google
  });
}

async function runGmailSync() {
  var statusPayload = getGoogleIntegrationStatusPayload();
  if (statusPayload.google.gmail.status === "backend_incomplete" || statusPayload.google.gmail.status === "auth_needed") {
    return json(200, {
      ok: true,
      status: statusPayload.google.gmail.status,
      source: "backend",
      imported: 0,
      flagged: 0,
      skipped: 0,
      message: statusPayload.google.gmail.status === "auth_needed"
        ? "Google OAuth is configured, but Netlify still needs a refresh token before live Gmail sync can run."
        : "Google OAuth client credentials are not configured in Netlify yet.",
      google: statusPayload.google
    });
  }

  try {
    await getAccessTokenFromRefreshToken();
  } catch (error) {
    return json(200, {
      ok: true,
      status: "error",
      source: "backend",
      imported: 0,
      flagged: 0,
      skipped: 0,
      message: String(error && error.message ? error.message : error || "Unable to validate Gmail credentials."),
      google: statusPayload.google
    });
  }

  if (statusPayload.google.gmail.status !== "live_ready") {
    return json(200, {
      ok: true,
      status: "connected",
      source: "backend",
      imported: 0,
      flagged: 0,
      skipped: 0,
      message: "Gmail authentication is live, but the server-side booking email pull is still the next step. The portal can keep using the current Gmail assist feed for now.",
      google: statusPayload.google
    });
  }

  var messages = await fetchLiveGmailMessages();
  return json(200, {
    ok: true,
    status: "live_ready",
    source: "backend",
    messages: messages,
    imported: messages.length,
    flagged: 0,
    skipped: 0,
    message: messages.length ? "Live Gmail booking messages pulled through the backend." : "Live Gmail sync ran, but no booking-like emails matched the current filter.",
    google: statusPayload.google
  });
}

exports.handler = async function (event) {
  try {
    var method = String(event.httpMethod || "GET").toUpperCase();

    var requestedAction = "";
    if (method === "GET") {
      requestedAction = String((event.queryStringParameters && event.queryStringParameters.action) || "").trim();
    } else if (method === "POST" && event.body) {
      try {
        requestedAction = String((JSON.parse(event.body).action || "")).trim();
      } catch (error) {
        requestedAction = "";
      }
    }

    var appsScriptRequired = ["ping", "snapshot", "push_snapshot"].indexOf(requestedAction) !== -1;
    if (appsScriptRequired && !getAppsScriptUrl()) {
      return json(500, {
        ok: false,
        error: "Netlify function is missing GOOGLE_APPS_SCRIPT_URL."
      });
    }

    if (method === "GET") {
      var action = requestedAction;

      if (action === "ping") {
        return await proxyPing();
      }

      if (action === "snapshot") {
        return await proxySnapshot();
      }

      if (action === "google_status") {
        return await getGoogleStatus(event);
      }

      return json(400, {
        ok: false,
        error: "Unsupported action."
      });
    }

    if (method === "POST") {
      var body = {};
      if (event.body) {
        body = JSON.parse(event.body);
      }

      if (String(body.action || "").trim() === "push_snapshot") {
        return await proxyPush(body);
      }

      if (String(body.action || "").trim() === "calendar_sync") {
        return await runCalendarSync();
      }

      if (String(body.action || "").trim() === "gmail_sync") {
        return await runGmailSync();
      }

      return json(400, {
        ok: false,
        error: "Unsupported action."
      });
    }

    return json(405, {
      ok: false,
      error: "Method not allowed."
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: String(error && error.message ? error.message : error || "Unknown proxy error.")
    });
  }
};
