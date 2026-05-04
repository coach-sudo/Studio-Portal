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

  const role = directEmails.includes(normalizedEmail)
    ? "STUDENT"
    : guardianEmails.includes(normalizedEmail)
      ? "GUARDIAN"
      : "CONTACT";

  if (student.portal_access_enabled === false) return null;
  if (role !== "STUDENT" && student.guardian_portal_access_enabled === false) return null;

  return {
    email: normalizedEmail,
    role,
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

async function pushAppsScriptSnapshot(snapshot) {
  const baseUrl = getAppsScriptUrl();
  if (!baseUrl) {
    throw new Error("Portal data updates require GOOGLE_APPS_SCRIPT_URL.");
  }

  const url = new URL(baseUrl);
  url.searchParams.set("action", "push_snapshot");
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      action: "push_snapshot",
      token: getAppsScriptToken(),
      snapshot
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload || payload.ok === false) {
    throw new Error(payload.error || "Unable to save portal update.");
  }

  return payload;
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

function canViewFinance(identity) {
  const student = identity && identity.student ? identity.student : {};
  if (identity.role === "STUDENT" && student.portal_student_finance_access === false) return false;
  if (identity.role !== "STUDENT" && student.portal_guardian_finance_access !== true) return false;
  if (student.student_is_minor === true && student.portal_minor_finance_access !== true) return false;
  return true;
}

function getPortalPermissions(identity) {
  const student = identity && identity.student ? identity.student : {};
  return {
    role: identity.role,
    finance: canViewFinance(identity),
    notes: student.portal_notes_access !== false,
    homework: student.portal_homework_access !== false,
    materials: student.portal_materials_access !== false,
    publicPage: student.portal_public_page_access !== false,
    script: student.portal_script_access !== false
  };
}

function canViewRecord(identity, record, kind) {
  if (!identity || !record) return false;
  if (record.student_id && record.student_id !== identity.student_id) return false;
  const student = identity.student || {};

  if (kind === "note") return student.portal_notes_access !== false && normalizeNoteStatus(record.status) === "PUBLISHED";
  if (kind === "homework") return student.portal_homework_access !== false;
  if (kind === "material") {
    const isApprovedVisible = normalizeMaterialVisibility(record.visibility) === "STUDENT_VISIBLE";
    const isOwnPublicSubmission = String(record.submitted_by || "").toUpperCase() === "STUDENT_PORTAL" &&
      ["PENDING_REVIEW", "REJECTED"].includes(String(record.public_page_status || "").toUpperCase());
    return student.portal_materials_access !== false && (isApprovedVisible || isOwnPublicSubmission);
  }
  if (kind === "script") {
    return student.portal_script_access !== false &&
      normalizeMaterialVisibility(record.visibility) === "STUDENT_VISIBLE" &&
      String(record.category || "").toUpperCase() === "CURRENT_SCRIPT";
  }
  if (kind === "public") return student.portal_public_page_access !== false;
  if (kind === "payment") return canViewFinance(identity) && !isArchived(record) && normalizePaymentReviewState(record) !== "NEEDS_REVIEW";
  if (kind === "package") return canViewFinance(identity) && !isArchived(record);

  return true;
}

function getScopedPortalData(snapshot, identity) {
  const student = (snapshot.students || []).find((row) => row.student_id === identity.student_id) || null;
  const scopedIdentity = { ...identity, student };
  const materials = (snapshot.files || []).filter((file) => canViewRecord(scopedIdentity, file, "material"));
  const currentScript = materials
    .filter((file) => canViewRecord(scopedIdentity, file, "script"))
    .filter((file) => !isArchived(file) && String(file.status || "").toUpperCase() !== "ARCHIVED")
    .sort((a, b) => new Date(b.uploaded_at || 0).getTime() - new Date(a.uploaded_at || 0).getTime())[0] || null;

  return {
    permissions: getPortalPermissions(scopedIdentity),
    student,
    publicProfile: canViewRecord(scopedIdentity, student, "public")
      ? (snapshot.actorProfiles || []).find((profile) => profile.student_id === identity.student_id) || null
      : null,
    currentScript,
    lessons: (snapshot.lessons || [])
      .filter((lesson) => canViewRecord(scopedIdentity, lesson, "lesson"))
      .sort((a, b) => new Date(a.scheduled_start || 0).getTime() - new Date(b.scheduled_start || 0).getTime()),
    notes: (snapshot.notes || [])
      .filter((note) => canViewRecord(scopedIdentity, note, "note"))
      .sort((a, b) => new Date(b.published_at || b.updated_at || 0).getTime() - new Date(a.published_at || a.updated_at || 0).getTime()),
    homework: (snapshot.homework || [])
      .filter((item) => canViewRecord(scopedIdentity, item, "homework"))
      .sort((a, b) => new Date(a.due_date || a.assigned_at || 0).getTime() - new Date(b.due_date || b.assigned_at || 0).getTime()),
    packages: (snapshot.packages || []).filter((pkg) => canViewRecord(scopedIdentity, pkg, "package")),
    payments: (snapshot.payments || [])
      .filter((payment) => canViewRecord(scopedIdentity, payment, "payment"))
      .sort((a, b) => new Date(b.payment_date || b.created_at || 0).getTime() - new Date(a.payment_date || a.created_at || 0).getTime()),
    materials
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

function nextId(records, prefix, fieldName) {
  const year = new Date().getFullYear();
  const max = (records || []).reduce((value, record) => {
    const match = String(record[fieldName] || "").match(new RegExp(`^${prefix}-${year}-(\\d{6})$`));
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `${prefix}-${year}-${String(max + 1).padStart(6, "0")}`;
}

function parseJsonObject(value, fallback = {}) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function getCurrentScriptRecord(snapshot, studentId) {
  return (snapshot.files || [])
    .filter((file) => file.student_id === studentId)
    .filter((file) => String(file.category || "").toUpperCase() === "CURRENT_SCRIPT")
    .filter((file) => String(file.status || "").toUpperCase() !== "ARCHIVED" && !file.archived_at)
    .sort((a, b) => new Date(b.uploaded_at || 0).getTime() - new Date(a.uploaded_at || 0).getTime())[0] || null;
}

function encodeScriptNotes(data) {
  return JSON.stringify({
    kind: "CURRENT_SCRIPT",
    script_text: String(data.script_text || ""),
    comments: Array.isArray(data.comments) ? data.comments : [],
    archived_at: data.archived_at || ""
  });
}

function upsertActorProfile(snapshot, identity, updates) {
  snapshot.actorProfiles = Array.isArray(snapshot.actorProfiles) ? snapshot.actorProfiles : [];
  let profile = snapshot.actorProfiles.find((row) => row.student_id === identity.student_id);
  const now = new Date().toISOString();
  if (!profile) {
    profile = {
      actor_profile_id: nextId(snapshot.actorProfiles, "ACT", "actor_profile_id"),
      student_id: identity.student_id,
      slug: String(identity.student_name || identity.student_id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      status: "Draft",
      display_name: identity.student_name || "",
      bio: "",
      updated_at: now
    };
    snapshot.actorProfiles.push(profile);
  }
  profile.display_name = String(updates.display_name || profile.display_name || "").trim();
  profile.bio = String(updates.bio || profile.bio || "").trim();
  const wantsLive = String(updates.status || "").toLowerCase() === "active";
  profile.status = identity.student && identity.student.actor_page_eligible === true && wantsLive ? "Active" : "Draft";
  profile.updated_at = now;
  const student = (snapshot.students || []).find((row) => row.student_id === identity.student_id);
  if (student) student.actor_page_status = profile.status;
  return profile;
}

async function handlePortalMutation(event, action, mutator) {
  const result = await getSessionIdentity(event);
  if (!result) return json(401, { ok: false, error: "Not signed in." }, { "Set-Cookie": clearCookie() });
  const scopedIdentity = {
    ...result.identity,
    student: (result.snapshot.students || []).find((row) => row.student_id === result.identity.student_id) || null
  };
  const body = JSON.parse(event.body || "{}");
  const mutationResult = mutator(result.snapshot, scopedIdentity, body);
  await pushAppsScriptSnapshot(result.snapshot);
  return json(200, {
    ok: true,
    action,
    result: mutationResult,
    data: getScopedPortalData(result.snapshot, result.identity)
  });
}

function createPortalMaterial(snapshot, identity, body) {
  if (!canViewRecord(identity, identity.student, "public")) {
    throw new Error("Public page controls are not enabled for this portal account.");
  }
  snapshot.files = Array.isArray(snapshot.files) ? snapshot.files : [];
  const now = new Date().toISOString();
  const material = {
    file_id: nextId(snapshot.files, "FILE", "file_id"),
    student_id: identity.student_id,
    lesson_id: null,
    homework_id: null,
    file_name: String(body.file_name || body.title || "Student Material").trim(),
    title: String(body.title || body.file_name || "Student Material").trim(),
    source_type: String(body.source_type || "LINK").trim().toUpperCase(),
    external_url: String(body.external_url || "").trim(),
    file_url: String(body.file_url || "").trim(),
    mime_type: String(body.mime_type || "").trim(),
    material_kind: String(body.material_kind || "DOCUMENT").trim().toUpperCase(),
    category: String(body.category || "Public Page").trim(),
    scope: "ACTOR_MATERIAL",
    visibility: "ADMIN_ONLY",
    public_page_status: "PENDING_REVIEW",
    submitted_by: "STUDENT_PORTAL",
    submitted_at: now,
    reviewed_at: "",
    reviewed_by: "",
    notes: String(body.notes || "Submitted from student portal.").trim(),
    status: "Active",
    uploaded_at: now
  };
  snapshot.files.push(material);
  return material;
}

function saveCurrentScript(snapshot, identity, body) {
  if (identity.student && identity.student.portal_script_access === false) {
    throw new Error("Current script access is not enabled for this portal account.");
  }
  snapshot.files = Array.isArray(snapshot.files) ? snapshot.files : [];
  const now = new Date().toISOString();
  let script = getCurrentScriptRecord(snapshot, identity.student_id);
  if (!script) {
    script = {
      file_id: nextId(snapshot.files, "FILE", "file_id"),
      student_id: identity.student_id,
      lesson_id: null,
      homework_id: null,
      file_name: String(body.title || "Current Script").trim(),
      title: String(body.title || "Current Script").trim(),
      source_type: body.script_url ? "LINK" : "TEXT",
      external_url: String(body.script_url || "").trim(),
      file_url: "",
      mime_type: body.script_url ? "application/pdf" : "text/plain",
      material_kind: "SCRIPT",
      category: "CURRENT_SCRIPT",
      scope: "COACHING_MATERIAL",
      visibility: "STUDENT_VISIBLE",
      notes: "",
      status: "Active",
      uploaded_at: now
    };
    snapshot.files.push(script);
  }
  const notes = parseJsonObject(script.notes, { comments: [] });
  script.title = String(body.title || script.title || "Current Script").trim();
  script.file_name = script.title;
  script.external_url = String(body.script_url || script.external_url || "").trim();
  script.source_type = script.external_url ? "LINK" : "TEXT";
  script.mime_type = script.external_url ? "application/pdf" : "text/plain";
  script.notes = encodeScriptNotes({
    ...notes,
    script_text: String(body.script_text || notes.script_text || "")
  });
  script.status = "Active";
  script.uploaded_at = script.uploaded_at || now;
  return script;
}

function addScriptComment(snapshot, identity, body) {
  const script = getCurrentScriptRecord(snapshot, identity.student_id);
  if (!script) throw new Error("No current script is active.");
  const notes = parseJsonObject(script.notes, { script_text: "", comments: [] });
  const comment = {
    id: `SCOM-${Date.now()}`,
    author_role: identity.role,
    author_email: identity.email,
    body: String(body.comment || "").trim(),
    created_at: new Date().toISOString()
  };
  if (!comment.body) throw new Error("Comment text is required.");
  notes.comments = Array.isArray(notes.comments) ? notes.comments : [];
  notes.comments.unshift(comment);
  script.notes = encodeScriptNotes(notes);
  return comment;
}

function archiveCurrentScript(snapshot, identity) {
  const script = getCurrentScriptRecord(snapshot, identity.student_id);
  if (!script) throw new Error("No current script is active.");
  const now = new Date().toISOString();
  const notes = parseJsonObject(script.notes, { comments: [] });
  notes.archived_at = now;
  script.notes = encodeScriptNotes(notes);
  script.status = "Archived";
  script.archived_at = now;
  return script;
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
      if (action === "update_public_profile") {
        return handlePortalMutation(event, action, (snapshot, identity, body) => upsertActorProfile(snapshot, identity, body));
      }
      if (action === "submit_public_material") {
        return handlePortalMutation(event, action, createPortalMaterial);
      }
      if (action === "save_current_script") {
        return handlePortalMutation(event, action, saveCurrentScript);
      }
      if (action === "add_script_comment") {
        return handlePortalMutation(event, action, addScriptComment);
      }
      if (action === "archive_current_script") {
        return handlePortalMutation(event, action, archiveCurrentScript);
      }
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
