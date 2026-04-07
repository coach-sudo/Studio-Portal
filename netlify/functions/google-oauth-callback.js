const crypto = require("crypto");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlPage(title, bodyMarkup, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; background:#f7f2ea; color:#2a241f; margin:0; padding:32px 18px; }
      .card { max-width:820px; margin:0 auto; background:#fff; border:1px solid #e9ddcc; border-radius:18px; padding:24px; box-shadow:0 12px 40px rgba(38,26,17,.06); }
      h1 { margin:0 0 10px; font-size:28px; }
      p { line-height:1.55; }
      .meta { display:flex; flex-wrap:wrap; gap:10px; margin:14px 0 18px; }
      .pill { padding:6px 10px; border-radius:999px; background:#f7f2ea; border:1px solid #e9ddcc; font-size:12px; }
      textarea { width:100%; min-height:160px; padding:12px; border-radius:12px; border:1px solid #d9c9b4; font-family: Consolas, monospace; font-size:13px; }
      code { background:#f7f2ea; padding:2px 6px; border-radius:6px; }
      ol { padding-left:20px; }
      .warn { color:#7d2b2b; }
    </style>
  </head>
  <body>
    <div class="card">
      ${bodyMarkup}
    </div>
  </body>
</html>`
  };
}

function getHeader(event, key) {
  const headers = event && event.headers ? event.headers : {};
  return headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()] || "";
}

function getSiteUrl(event) {
  const envUrl = String(process.env.URL || process.env.DEPLOY_PRIME_URL || "").trim();
  if (envUrl) return envUrl.replace(/\/$/, "");

  const protocol = String(getHeader(event, "x-forwarded-proto") || "https").trim();
  const host = String(getHeader(event, "host") || "").trim();
  if (!host) return "";
  return `${protocol}://${host}`;
}

function getClientId() {
  return String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
}

function getClientSecret() {
  return String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
}

function getRedirectUri(event) {
  return String(process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim() || `${getSiteUrl(event)}/api/google-oauth-callback`;
}

function getLoginHint() {
  return String(process.env.GOOGLE_ACCOUNT_EMAIL || "coach@d-a-j.com").trim();
}

function signState(payload) {
  return crypto
    .createHmac("sha256", getClientSecret())
    .update(payload)
    .digest("base64url");
}

function verifyState(state) {
  if (!state || !state.includes(".")) return false;
  const [payload, signature] = String(state).split(".");
  if (!payload || !signature) return false;
  if (signState(payload) !== signature) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const ageMs = Date.now() - Number(decoded.ts || 0);
    if (!decoded.ts || ageMs < 0 || ageMs > 15 * 60 * 1000) return false;
    return true;
  } catch (error) {
    return false;
  }
}

async function exchangeCodeForTokens(code, event) {
  const body = new URLSearchParams({
    code: String(code || "").trim(),
    client_id: getClientId(),
    client_secret: getClientSecret(),
    redirect_uri: getRedirectUri(event),
    grant_type: "authorization_code"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `Google token exchange failed (${response.status}).`);
  }

  return payload;
}

exports.handler = async function (event) {
  try {
    const query = event && event.queryStringParameters ? event.queryStringParameters : {};
    const error = String(query.error || "").trim();
    const errorDescription = String(query.error_description || "").trim();
    const code = String(query.code || "").trim();
    const state = String(query.state || "").trim();

    if (!getClientId() || !getClientSecret()) {
      return htmlPage(
        "Google OAuth Not Ready",
        `<h1>Google OAuth is not configured yet</h1>
         <p>Add <code>GOOGLE_OAUTH_CLIENT_ID</code> and <code>GOOGLE_OAUTH_CLIENT_SECRET</code> in Netlify first, then try again.</p>`,
        500
      );
    }

    if (error) {
      return htmlPage(
        "Google Access Not Granted",
        `<h1>Google access wasn’t completed</h1>
         <p class="warn">${escapeHtml(errorDescription || error)}</p>
         <p>Return to the portal and try the Google connection again.</p>`,
        400
      );
    }

    if (!verifyState(state)) {
      return htmlPage(
        "Invalid OAuth State",
        `<h1>This Google connection link expired</h1>
         <p>Start the Google connection again from the portal so Netlify can create a fresh secure state token.</p>`,
        400
      );
    }

    if (!code) {
      return htmlPage(
        "Missing OAuth Code",
        `<h1>Google didn’t return an authorization code</h1>
         <p>Start the Google connection again from the portal.</p>`,
        400
      );
    }

    const tokens = await exchangeCodeForTokens(code, event);
    const refreshToken = String(tokens.refresh_token || "").trim();

    if (!refreshToken) {
      return htmlPage(
        "Refresh Token Not Returned",
        `<h1>Google signed in, but no refresh token was returned</h1>
         <p>This usually means Google thinks this app was already approved before. Re-run the OAuth flow after revoking prior access for <strong>${escapeHtml(getLoginHint())}</strong>, or keep <code>prompt=consent</code> and try again.</p>
         <p>Manage prior access here: <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google Account Permissions</a></p>`,
        400
      );
    }

    return htmlPage(
      "Google Refresh Token Ready",
      `<h1>Google connection succeeded</h1>
       <p>Copy this refresh token into the Netlify environment variable <code>GOOGLE_REFRESH_TOKEN</code>, then redeploy the site.</p>
       <div class="meta">
         <span class="pill">Account: ${escapeHtml(getLoginHint())}</span>
         <span class="pill">Redirect URI: ${escapeHtml(getRedirectUri(event))}</span>
       </div>
       <textarea readonly onclick="this.select()">${escapeHtml(refreshToken)}</textarea>
       <ol>
         <li>Open Netlify for the <strong>studio-portal</strong> site.</li>
         <li>Go to <strong>Site configuration → Environment variables</strong>.</li>
         <li>Add or update <code>GOOGLE_REFRESH_TOKEN</code> with the token above.</li>
         <li>Redeploy the site.</li>
         <li>Back in the portal, go to <strong>Settings → Google Connections</strong> and click <strong>Refresh Google Status</strong>.</li>
       </ol>
       <p class="warn">Treat this token like a password. Once it is saved in Netlify, you can close this page.</p>`
    );
  } catch (error) {
    return htmlPage(
      "Google OAuth Failed",
      `<h1>Google OAuth failed</h1>
       <p class="warn">${escapeHtml(error && error.message ? error.message : error || "Unknown Google OAuth error.")}</p>
       <p>Double-check the OAuth client settings, redirect URI, and Netlify environment variables, then try again.</p>`,
      500
    );
  }
};
