const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SESSION_COOKIE_NAME = "studio_student_session";
const DEFAULT_SESSION_MINUTES = 120;

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers
    },
    body: JSON.stringify(body)
  };
}

function getHeader(event, key) {
  const headers = event && event.headers ? event.headers : {};
  return headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()] || "";
}

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function getSessionSecret() {
  return getEnv("STUDENT_PORTAL_SESSION_SECRET");
}

function getAccessCode() {
  return getEnv("STUDENT_PORTAL_ACCESS_CODE");
}

function getSessionMinutes() {
  const value = Number(getEnv("STUDENT_PORTAL_SESSION_MINUTES", String(DEFAULT_SESSION_MINUTES)));
  return Number.isFinite(value) && value >= 15 ? value : DEFAULT_SESSION_MINUTES;
}

function getAppsScriptUrl() {
  return getEnv("GOOGLE_APPS_SCRIPT_URL") || getEnv("NETLIFY_GAS_URL");
}

function getAppsScriptToken() {
  return getEnv("GOOGLE_APPS_SCRIPT_TOKEN") || getEnv("STUDIO_PORTAL_TOKEN");
}

function parseCookies(event) {
  const raw = getHeader(event, "cookie");
  return raw.split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload) {
  const secret = getSessionSecret();
  if (!secret) throw new Error("Missing STUDENT_PORTAL_SESSION_SECRET.");
  return crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function createSignedSession(payload) {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

function verifySignedSession(token) {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) return null;

  const expected = signPayload(encodedPayload);
  const provided = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (provided.length !== expectedBuffer.length || !crypto.timingSafeEqual(provided, expectedBuffer)) {
    return null;
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload));
  if (!payload || !payload.student_id || !payload.email || !payload.exp) return null;
  if (Date.now() > Number(payload.exp)) return null;
  return payload;
}

function buildCookie(token) {
  const maxAge = getSessionMinutes() * 60;
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ].join("; ");
}

function clearCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0"
  ].join("; ");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function splitList(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getStudentContactEmails(student) {
  return Array.from(new Set([
    student && student.email,
    student && student.guardian_email,
    student && student.preferred_contact_email,
    ...splitList(student && student.additional_emails)
  ].map(normalizeEmail).filter(Boolean)));
}

function getIdentityForEmail(snapshot, email) {
  const normalizedEmail = normalizeEmail(email);
  const student = (snapshot.students || []).find((record) => getStudentContactEmails(record).includes(normalizedEmail));
  if (!student) return null;

  const directEmails = [
    student.email,
    ...splitList(student.additional_emails)
  ].map(normalizeEmail);
  const guardianEmails = [
    student.guardian_email,
    student.preferred_contact_email
  ].map(normalizeEmail);

  return {
    email: normalizedEmail,
    role: directEmails.includes(normalizedEmail)
      ? "STUDENT"
      : guardianEmails.includes(normalizedEmail)
        ? "GUARDIAN"
        : "CONTACT",
    student_id: student.student_id,
    student_name: student.full_name || [student.first_name, student.last_name].filter(Boolean).join(" "),
    issued_at: new Date().toISOString()
  };
}

async function fetchAppsScriptSnapshot() {
  const baseUrl = getAppsScriptUrl();
  if (!baseUrl) return null;

  const url = new URL(baseUrl);
  url.searchParams.set("action", "snapshot");
  const token = getAppsScriptToken();
  if (token) url.searchParams.set("token", token);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload || payload.ok === false) {
    throw new Error(payload.error || "Unable to load portal snapshot.");
  }

  return payload.snapshot || payload.data || null;
}

function loadLocalSampleSnapshot() {
  const schemaPath = path.resolve(__dirname, "../../assets/js/schema.js");
  const source = fs.readFileSync(schemaPath, "utf8");
  const sandbox = {
    console,
    Date,
    Math,
    JSON
  };
  const script = new vm.Script(`${source}
    ;({
      students: sampleStudents,
      lessons: sampleLessons,
      notes: sampleNotes,
      homework: sampleHomework,
      packages: samplePackages,
      payments: samplePayments,
      actorProfiles: sampleActorProfiles,
      files: sampleFiles
    });`);
  return script.runInNewContext(sandbox);
}

async function loadTrustedSnapshot() {
  const remoteSnapshot = await fetchAppsScriptSnapshot();
  if (remoteSnapshot) return remoteSnapshot;
  return loadLocalSampleSnapshot();
}

function normalizeNoteStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "PUBLISH") return "PUBLISHED";
  return normalized;
}

function normalizeMaterialVisibility(visibility) {
  const normalized = String(visibility || "").trim().toUpperCase();
  return ["ADMIN_ONLY", "STUDENT_VISIBLE", "HIDDEN"].includes(normalized) ? normalized : "ADMIN_ONLY";
}

function isArchived(record) {
  return Boolean(record && record.archived_at);
}

function normalizePaymentReviewState(payment) {
  const normalized = String(payment && payment.review_state || "").trim().toUpperCase();
  if (["CONFIRMED", "NEEDS_REVIEW", "IGNORED"].includes(normalized)) return normalized;
  return String(payment && payment.import_source || "").trim() ? "NEEDS_REVIEW" : "CONFIRMED";
}

function canViewRecord(identity, record, kind) {
  if (!identity || !record) return false;
  if (record.student_id && record.student_id !== identity.student_id) return false;

  if (kind === "note") return normalizeNoteStatus(record.status) === "PUBLISHED";
  if (kind === "material") return normalizeMaterialVisibility(record.visibility) === "STUDENT_VISIBLE";
  if (kind === "payment") return !isArchived(record) && normalizePaymentReviewState(record) !== "NEEDS_REVIEW";
  if (kind === "package") return !isArchived(record);

  return true;
}

function getScopedPortalData(snapshot, identity) {
  return {
    student: (snapshot.students || []).find((student) => student.student_id === identity.student_id) || null,
    lessons: (snapshot.lessons || [])
      .filter((lesson) => canViewRecord(identity, lesson, "lesson"))
      .sort((a, b) => new Date(a.scheduled_start || 0).getTime() - new Date(b.scheduled_start || 0).getTime()),
    notes: (snapshot.notes || [])
      .filter((note) => canViewRecord(identity, note, "note"))
      .sort((a, b) => new Date(b.published_at || b.updated_at || 0).getTime() - new Date(a.published_at || a.updated_at || 0).getTime()),
    homework: (snapshot.homework || [])
      .filter((item) => canViewRecord(identity, item, "homework"))
      .sort((a, b) => new Date(a.due_date || a.assigned_at || 0).getTime() - new Date(b.due_date || b.assigned_at || 0).getTime()),
    packages: (snapshot.packages || []).filter((pkg) => canViewRecord(identity, pkg, "package")),
    payments: (snapshot.payments || [])
      .filter((payment) => canViewRecord(identity, payment, "payment"))
      .sort((a, b) => new Date(b.payment_date || b.created_at || 0).getTime() - new Date(a.payment_date || a.created_at || 0).getTime()),
    materials: (snapshot.files || []).filter((file) => canViewRecord(identity, file, "material"))
  };
}

async function getSessionIdentity(event) {
  const cookies = parseCookies(event);
  const session = verifySignedSession(cookies[SESSION_COOKIE_NAME]);
  if (!session) return null;

  const snapshot = await loadTrustedSnapshot();
  const identity = getIdentityForEmail(snapshot, session.email);
  if (!identity || identity.student_id !== session.student_id) return null;

  return {
    identity: {
      ...identity,
      expires_at: new Date(Number(session.exp)).toISOString()
    },
    snapshot
  };
}

async function handleLogin(event) {
  if (!getSessionSecret()) {
    return json(500, {
      ok: false,
      error: "Student portal auth is missing STUDENT_PORTAL_SESSION_SECRET."
    });
  }

  if (!getAccessCode()) {
    return json(500, {
      ok: false,
      error: "Student portal auth is missing STUDENT_PORTAL_ACCESS_CODE."
    });
  }

  const body = JSON.parse(event.body || "{}");
  const email = normalizeEmail(body.email);
  const accessCode = String(body.access_code || "").trim();

  if (!email) {
    return json(400, { ok: false, error: "Email is required." });
  }

  if (accessCode !== getAccessCode()) {
    return json(401, { ok: false, error: "Invalid access code." });
  }

  const snapshot = await loadTrustedSnapshot();
  const identity = getIdentityForEmail(snapshot, email);
  if (!identity) {
    return json(401, { ok: false, error: "No student or guardian contact matched that email." });
  }

  const expiresAt = Date.now() + getSessionMinutes() * 60 * 1000;
  const token = createSignedSession({
    email: identity.email,
    role: identity.role,
    student_id: identity.student_id,
    iat: Date.now(),
    exp: expiresAt
  });

  return json(200, {
    ok: true,
    identity: {
      ...identity,
      expires_at: new Date(expiresAt).toISOString()
    }
  }, {
    "Set-Cookie": buildCookie(token)
  });
}

async function handleSession(event, includeData) {
  const result = await getSessionIdentity(event);
  if (!result) {
    return json(401, {
      ok: false,
      error: "Not signed in."
    }, {
      "Set-Cookie": clearCookie()
    });
  }

  return json(200, {
    ok: true,
    identity: result.identity,
    data: includeData ? getScopedPortalData(result.snapshot, result.identity) : undefined
  });
}

function handleLogout() {
  return json(200, { ok: true }, { "Set-Cookie": clearCookie() });
}

exports.handler = async function (event) {
  try {
    const method = String(event.httpMethod || "GET").toUpperCase();
    const action = method === "GET"
      ? String((event.queryStringParameters && event.queryStringParameters.action) || "session").trim()
      : String((JSON.parse(event.body || "{}").action || "")).trim();

    if (method === "GET") {
      if (action === "session") return handleSession(event, false);
      if (action === "portal_data") return handleSession(event, true);
      return json(404, { ok: false, error: "Unsupported student auth action." });
    }

    if (method === "POST") {
      if (action === "login") return handleLogin(event);
      if (action === "logout") return handleLogout();
      return json(404, { ok: false, error: "Unsupported student auth action." });
    }

    return json(405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    return json(500, {
      ok: false,
      error: String(error && error.message ? error.message : error || "Student auth failed.")
    });
  }
};
