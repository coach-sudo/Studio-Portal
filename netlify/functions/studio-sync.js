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

