const crypto = require("crypto");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function assertAdminToken(body) {
  const expected = getEnv("STUDENT_PORTAL_ADMIN_TOKEN");
  const provided = String(body.admin_token || body.adminToken || "").trim();
  if (!expected) throw new Error("Missing STUDENT_PORTAL_ADMIN_TOKEN.");
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (!provided || providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    const error = new Error("Invalid admin token.");
    error.statusCode = 403;
    throw error;
  }
}

async function refreshGoogleAccessToken() {
  const clientId = getEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = getEnv("GOOGLE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google OAuth is not configured.");
  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("refresh_token", refreshToken);
  body.set("grant_type", "refresh_token");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || "Unable to refresh Google token.");
  return payload.access_token;
}

async function googleJson(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : "Google API request failed.");
  return payload;
}

async function getContactGroupEmails(groupLabel, accessToken) {
  const groupsPayload = await googleJson("https://people.googleapis.com/v1/contactGroups?groupFields=name,formattedName,memberCount", accessToken);
  const group = (groupsPayload.contactGroups || []).find((item) => (
    String(item.formattedName || "").toLowerCase() === String(groupLabel || "").toLowerCase() ||
    String(item.name || "").toLowerCase() === String(groupLabel || "").toLowerCase()
  ));
  if (!group) throw new Error(`Google Contacts group not found: ${groupLabel}`);
  const groupPayload = await googleJson(`https://people.googleapis.com/v1/${encodeURIComponent(group.resourceName || group.name)}?maxMembers=1000`, accessToken);
  const members = groupPayload.memberResourceNames || [];
  if (!members.length) return [];
  const url = new URL("https://people.googleapis.com/v1/people:batchGet");
  members.slice(0, 200).forEach((resourceName) => url.searchParams.append("resourceNames", resourceName));
  url.searchParams.set("personFields", "names,emailAddresses");
  const peoplePayload = await googleJson(url.toString(), accessToken);
  return Array.from(new Set((peoplePayload.responses || [])
    .flatMap((entry) => entry.person && entry.person.emailAddresses ? entry.person.emailAddresses : [])
    .map((email) => String(email.value || "").trim())
    .filter(Boolean)));
}

function encodeGmailMessage({ to, bcc, subject, text }) {
  const raw = [
    `To: ${to}`,
    bcc.length ? `Bcc: ${bcc.join(", ")}` : "",
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    text
  ].filter(Boolean).join("\r\n");
  return Buffer.from(raw, "utf8").toString("base64url");
}

async function sendGmail({ to, bcc, subject, text }, accessToken) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: encodeGmailMessage({ to, bcc, subject, text }) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : "Unable to send Gmail blast.");
  return payload;
}

exports.handler = async function (event) {
  try {
    if (String(event.httpMethod || "").toUpperCase() !== "POST") return json(405, { ok: false, error: "Method not allowed." });
    const body = JSON.parse(event.body || "{}");
    assertAdminToken(body);
    const group = String(body.contacts_group || getEnv("READER_CONTACTS_GROUP") || "Readers").trim();
    const studentName = String(body.student_name || "A student").trim();
    const filming = String(body.filming_label || "").trim();
    const details = String(body.details || "").trim();
    const accessToken = await refreshGoogleAccessToken();
    const recipients = await getContactGroupEmails(group, accessToken);
    if (!recipients.length) return json(400, { ok: false, error: "Reader contacts group has no email recipients." });
    const subject = `Reader needed: ${studentName}${filming ? ` (${filming})` : ""}`;
    const text = [
      `Hi all,`,
      "",
      `${studentName} is looking for a reader${filming ? ` for ${filming}` : ""}.`,
      "",
      details || "Reply if you are available and I will connect you with the student.",
      "",
      "Thank you!"
    ].join("\n");
    const message = await sendGmail({
      to: getEnv("GOOGLE_ACCOUNT_EMAIL", "coach@d-a-j.com"),
      bcc: recipients,
      subject,
      text
    }, accessToken);
    return json(200, { ok: true, sent_to_count: recipients.length, message_id: message.id || "" });
  } catch (error) {
    return json(error.statusCode || 500, {
      ok: false,
      error: String(error && error.message ? error.message : error || "Reader blast failed.")
    });
  }
};
