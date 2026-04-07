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
      gmail_filter_scope: "booking_only",
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

  return json(200, {
    ok: true,
    status: "live_ready",
    source: "backend",
    imported: 0,
    updated: 0,
    flagged: 0,
    skipped: 0,
    message: "Google Calendar backend is marked live-ready. Add the server-side Calendar sync implementation next.",
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

  return json(200, {
    ok: true,
    status: "live_ready",
    source: "backend",
    imported: 0,
    flagged: 0,
    skipped: 0,
    message: "Gmail backend is marked live-ready. Add the server-side Gmail pull implementation next.",
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
