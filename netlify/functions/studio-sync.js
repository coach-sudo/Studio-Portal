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

function getBooleanEnv(name) {
  var raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function getGoogleIntegrationStatusPayload() {
  var calendarReady = getBooleanEnv("GOOGLE_CALENDAR_LIVE_READY");
  var gmailReady = getBooleanEnv("GOOGLE_GMAIL_LIVE_READY");

  return {
    ok: true,
    google: {
      account_email: getGoogleAccountEmail(),
      sync_mode: "manual",
      gmail_filter_scope: "booking_only",
      import_review_mode: "review_first",
      calendar: {
        status: calendarReady ? "live_ready" : "demo_ready"
      },
      gmail: {
        status: gmailReady ? "live_ready" : "demo_ready"
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

async function getGoogleStatus() {
  return json(200, getGoogleIntegrationStatusPayload());
}

async function runCalendarSync() {
  var statusPayload = getGoogleIntegrationStatusPayload();
  if (statusPayload.google.calendar.status !== "live_ready") {
    return json(200, {
      ok: true,
      status: "demo_ready",
      source: "backend",
      imported: 0,
      updated: 0,
      flagged: 0,
      skipped: 0,
      message: "Live Google Calendar sync is not configured in Netlify yet. The portal can keep using the current demo intake feed until OAuth is added.",
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
  if (statusPayload.google.gmail.status !== "live_ready") {
    return json(200, {
      ok: true,
      status: "demo_ready",
      source: "backend",
      imported: 0,
      flagged: 0,
      skipped: 0,
      message: "Live Gmail sync is not configured in Netlify yet. The portal can keep using the current Gmail assist demo feed until OAuth is added.",
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

    if (!getAppsScriptUrl()) {
      return json(500, {
        ok: false,
        error: "Netlify function is missing GOOGLE_APPS_SCRIPT_URL."
      });
    }

    if (method === "GET") {
      var action = String((event.queryStringParameters && event.queryStringParameters.action) || "").trim();

      if (action === "ping") {
        return await proxyPing();
      }

      if (action === "snapshot") {
        return await proxySnapshot();
      }

      if (action === "google_status") {
        return await getGoogleStatus();
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
