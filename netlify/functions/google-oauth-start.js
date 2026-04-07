const crypto = require("crypto");

function buildJson(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
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

function getScopes() {
  return String(
    process.env.GOOGLE_OAUTH_SCOPES ||
    "https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/gmail.readonly"
  ).trim();
}

function getLoginHint() {
  return String(process.env.GOOGLE_ACCOUNT_EMAIL || "coach@d-a-j.com").trim();
}

function toBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signState(payload) {
  return crypto
    .createHmac("sha256", getClientSecret())
    .update(payload)
    .digest("base64url");
}

function createSignedState() {
  const payload = JSON.stringify({
    ts: Date.now(),
    account: getLoginHint()
  });
  const encodedPayload = toBase64Url(payload);
  const signature = signState(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

exports.handler = async function (event) {
  try {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const redirectUri = getRedirectUri(event);

    if (!clientId || !clientSecret || !redirectUri) {
      return buildJson(500, {
        ok: false,
        error: "Missing Google OAuth environment variables. Add client id, client secret, and redirect URI in Netlify first."
      });
    }

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", getScopes());
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("login_hint", getLoginHint());
    authUrl.searchParams.set("state", createSignedState());

    return {
      statusCode: 302,
      headers: {
        Location: authUrl.toString(),
        "Cache-Control": "no-store"
      },
      body: ""
    };
  } catch (error) {
    return buildJson(500, {
      ok: false,
      error: String(error && error.message ? error.message : error || "Unable to start Google OAuth.")
    });
  }
};
