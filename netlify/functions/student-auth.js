const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SESSION_COOKIE_NAME = "studio_student_session";
const DEFAULT_SESSION_MINUTES = 120;
const DEFAULT_INVITE_HOURS = 72;
const PASSWORD_HASH_ITERATIONS = 210000;

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

function getAdminToken() {
  return getEnv("STUDENT_PORTAL_ADMIN_TOKEN");
}

function getSessionMinutes() {
  const value = Number(getEnv("STUDENT_PORTAL_SESSION_MINUTES", String(DEFAULT_SESSION_MINUTES)));
  return Number.isFinite(value) && value >= 15 ? value : DEFAULT_SESSION_MINUTES;
}

function getInviteHours() {
  const value = Number(getEnv("STUDENT_PORTAL_INVITE_HOURS", String(DEFAULT_INVITE_HOURS)));
  return Number.isFinite(value) && value >= 1 ? value : DEFAULT_INVITE_HOURS;
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

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function hashPassword(password, salt = randomToken(18)) {
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, PASSWORD_HASH_ITERATIONS, 32, "sha256").toString("base64url");
  return `pbkdf2_sha256$${PASSWORD_HASH_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isFinite(iterations) || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, "sha256").toString("base64url");
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
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

function normalizeAccountRole(role) {
  const normalized = String(role || "").trim().toUpperCase();
  return ["STUDENT", "GUARDIAN"].includes(normalized) ? normalized : "STUDENT";
}

function getStudentForAccount(snapshot, account) {
  return (snapshot.students || []).find((student) => student.student_id === account.student_id) || null;
}

function getAccountByEmail(snapshot, email) {
  const normalizedEmail = normalizeEmail(email);
  return (snapshot.studentAccounts || []).find((account) => normalizeEmail(account.email) === normalizedEmail) || null;
}

function getIdentityForAccount(snapshot, account) {
  if (!account || String(account.status || "").toUpperCase() !== "ACTIVE") return null;
  const student = getStudentForAccount(snapshot, account);
  if (!student || student.portal_access_enabled === false) return null;
  const role = normalizeAccountRole(account.role);
  if (role !== "STUDENT" && student.guardian_portal_access_enabled === false) return null;
  return {
    email: normalizeEmail(account.email),
    role,
    student_id: student.student_id,
    account_id: account.account_id,
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
      files: sampleFiles,
      studentAccounts: typeof sampleStudentAccounts !== "undefined" ? sampleStudentAccounts : []
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
  const ownedKinds = ["lesson", "note", "homework", "material", "script", "payment", "package"];
  const recordStudentId = String(record.student_id || "").trim();
  const identityStudentId = String(identity.student_id || "").trim();
  if (ownedKinds.includes(kind)) {
    if (!recordStudentId || recordStudentId !== identityStudentId) return false;
  } else if (recordStudentId && recordStudentId !== identityStudentId) {
    return false;
  }
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

function getSiteBaseUrl(event) {
  const envUrl = getEnv("URL") || getEnv("DEPLOY_PRIME_URL");
  if (envUrl) return envUrl.replace(/\/$/, "");
  const headers = event && event.headers ? event.headers : {};
  const protocol = getHeader(event, "x-forwarded-proto") || "https";
  const host = headers.host || headers.Host || "";
  return host ? `${protocol}://${host}` : "";
}

function buildPortalSetupUrl(event, token) {
  const siteUrl = getSiteBaseUrl(event);
  const path = `/portal?setup=${encodeURIComponent(token)}`;
  return siteUrl ? `${siteUrl}${path}` : path;
}

function assertAdminToken(body) {
  const expected = getAdminToken();
  if (!expected) {
    throw new Error("Student account admin actions require STUDENT_PORTAL_ADMIN_TOKEN.");
  }
  const provided = String(body.admin_token || body.adminToken || "").trim();
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (!provided || providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new Error("Invalid student account admin token.");
  }
}

function getDefaultAccountEmail(student, role) {
  if (!student) return "";
  if (role === "GUARDIAN") return normalizeEmail(student.guardian_email || student.preferred_contact_email);
  return normalizeEmail(student.email || splitList(student.additional_emails)[0]);
}

function sanitizeAccountForCoach(account, setupToken = "", setupUrl = "") {
  if (!account) return null;
  return {
    account_id: account.account_id,
    student_id: account.student_id,
    role: normalizeAccountRole(account.role),
    email: normalizeEmail(account.email),
    status: String(account.status || "INVITED").toUpperCase(),
    invited_at: account.invited_at || "",
    invite_expires_at: account.invite_expires_at || "",
    last_login_at: account.last_login_at || "",
    setup_token: setupToken,
    setup_url: setupUrl
  };
}

function createOrRefreshInvite(snapshot, body, event) {
  assertAdminToken(body);
  snapshot.studentAccounts = Array.isArray(snapshot.studentAccounts) ? snapshot.studentAccounts : [];
  const role = normalizeAccountRole(body.role);
  const studentId = String(body.student_id || "").trim();
  const student = (snapshot.students || []).find((row) => row.student_id === studentId);
  if (!student) throw new Error("Student not found for account invite.");
  const email = normalizeEmail(body.email || getDefaultAccountEmail(student, role));
  if (!email) throw new Error("An email is required to create a student account invite.");

  const now = new Date();
  const token = randomToken(32);
  const inviteExpiresAt = new Date(now.getTime() + getInviteHours() * 60 * 60 * 1000).toISOString();
  let account = snapshot.studentAccounts.find((row) => normalizeEmail(row.email) === email && row.student_id === studentId) || null;
  if (!account) {
    account = {
      account_id: nextId(snapshot.studentAccounts, "ACCT", "account_id"),
      student_id: studentId,
      role,
      email,
      status: "INVITED",
      created_at: now.toISOString()
    };
    snapshot.studentAccounts.push(account);
  }

  account.role = role;
  account.email = email;
  account.status = String(account.status || "").toUpperCase() === "ACTIVE" ? "ACTIVE" : "INVITED";
  account.invite_token_hash = hashToken(token);
  account.invite_expires_at = inviteExpiresAt;
  account.invited_at = now.toISOString();
  account.updated_at = now.toISOString();

  const setupUrl = buildPortalSetupUrl(event, token);
  return sanitizeAccountForCoach(account, token, setupUrl);
}

function findAccountByToken(snapshot, token, fieldName) {
  const tokenHash = hashToken(token);
  return (snapshot.studentAccounts || []).find((account) => account[fieldName] === tokenHash) || null;
}

function completeAccountInvite(snapshot, body) {
  const token = String(body.token || body.setup_token || "").trim();
  const password = String(body.password || "").trim();
  if (!token) throw new Error("Invite token is required.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const account = findAccountByToken(snapshot, token, "invite_token_hash");
  if (!account) throw new Error("Invite link is invalid or has already been used.");
  const expiresAt = new Date(account.invite_expires_at || 0);
  if (!account.invite_expires_at || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    throw new Error("Invite link has expired.");
  }
  account.password_hash = hashPassword(password);
  account.status = "ACTIVE";
  account.invite_token_hash = "";
  account.invite_expires_at = "";
  account.activated_at = account.activated_at || new Date().toISOString();
  account.updated_at = new Date().toISOString();
  return sanitizeAccountForCoach(account);
}

function requestAccountReset(snapshot, body, event) {
  const email = normalizeEmail(body.email);
  if (!email) throw new Error("Email is required.");
  const canReturnResetLink = Boolean(String(body.admin_token || body.adminToken || "").trim());
  if (canReturnResetLink) assertAdminToken(body);
  const account = getAccountByEmail(snapshot, email);
  if (!account || String(account.status || "").toUpperCase() === "DISABLED") {
    return { sent: true };
  }
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + getInviteHours() * 60 * 60 * 1000).toISOString();
  account.reset_token_hash = hashToken(token);
  account.reset_expires_at = expiresAt;
  account.updated_at = new Date().toISOString();
  return canReturnResetLink
    ? { sent: true, reset_token: token, reset_url: buildPortalSetupUrl(event, token) }
    : { sent: true };
}

function completeAccountReset(snapshot, body) {
  const token = String(body.token || body.reset_token || "").trim();
  const password = String(body.password || "").trim();
  if (!token) throw new Error("Reset token is required.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const account = findAccountByToken(snapshot, token, "reset_token_hash");
  if (!account) throw new Error("Reset link is invalid or has already been used.");
  const expiresAt = new Date(account.reset_expires_at || 0);
  if (!account.reset_expires_at || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    throw new Error("Reset link has expired.");
  }
  account.password_hash = hashPassword(password);
  account.status = "ACTIVE";
  account.reset_token_hash = "";
  account.reset_expires_at = "";
  account.updated_at = new Date().toISOString();
  return sanitizeAccountForCoach(account);
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
  const readEditableProfileField = (fieldName, fallback = "") => (
    Object.prototype.hasOwnProperty.call(updates, fieldName)
      ? String(updates[fieldName] || "").trim()
      : String(fallback || "").trim()
  );
  profile.display_name = readEditableProfileField("display_name", profile.display_name);
  profile.bio = readEditableProfileField("bio", profile.bio);
  profile.location = readEditableProfileField("location", profile.location);
  profile.height = readEditableProfileField("height", profile.height);
  profile.weight = readEditableProfileField("weight", profile.weight);
  profile.eye_color = readEditableProfileField("eye_color", profile.eye_color);
  profile.hair_color = readEditableProfileField("hair_color", profile.hair_color);
  profile.background_color = readEditableProfileField("background_color", profile.background_color);
  profile.headshot_file_id = readEditableProfileField("headshot_file_id", profile.headshot_file_id);
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

async function handleSnapshotMutation(event, action, mutator) {
  const snapshot = await loadTrustedSnapshot();
  const body = JSON.parse(event.body || "{}");
  const mutationResult = mutator(snapshot, body, event);
  await pushAppsScriptSnapshot(snapshot);
  return json(200, {
    ok: true,
    action,
    result: mutationResult
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
    public_page_featured: String(body.category || "").trim().toLowerCase() === "headshot" ? "HEADSHOT" : "",
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
  if (identity.student && identity.student.portal_script_access === false) {
    throw new Error("Current script access is not enabled for this portal account.");
  }
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
  if (identity.student && identity.student.portal_script_access === false) {
    throw new Error("Current script access is not enabled for this portal account.");
  }
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

function updateHomeworkFromPortal(snapshot, identity, body) {
  if (identity.student && identity.student.portal_homework_access === false) {
    throw new Error("Homework access is not enabled for this portal account.");
  }
  const homeworkId = String(body.homework_id || "").trim();
  const item = (snapshot.homework || []).find((row) => row.homework_id === homeworkId && row.student_id === identity.student_id);
  if (!item) throw new Error("Homework item not found.");

  const now = new Date().toISOString();
  if (body.completed === true) {
    item.status = "COMPLETED";
    item.completed_at = item.completed_at || now;
    item.student_completed_at = now;
  } else if (body.completed === false) {
    item.status = "ASSIGNED";
    item.completed_at = "";
    item.student_completed_at = "";
  }
  if (body.reminder_requested === true) {
    item.student_reminder_requested_at = now;
  }
  return item;
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
  const password = String(body.password || "");

  if (!email) {
    return json(400, { ok: false, error: "Email is required." });
  }

  const snapshot = await loadTrustedSnapshot();

  if (password) {
    const account = getAccountByEmail(snapshot, email);
    if (!account || String(account.status || "").toUpperCase() !== "ACTIVE" || !verifyPassword(password, account.password_hash)) {
      return json(401, { ok: false, error: "Invalid email or password." });
    }
    const identity = getIdentityForAccount(snapshot, account);
    if (!identity) {
      return json(401, { ok: false, error: "This account is not enabled for student portal access." });
    }
    account.last_login_at = new Date().toISOString();
    account.updated_at = account.last_login_at;
    try {
      await pushAppsScriptSnapshot(snapshot);
    } catch (error) {
      // Login should not fail only because last-login bookkeeping could not persist.
    }
    const expiresAt = Date.now() + getSessionMinutes() * 60 * 1000;
    const token = createSignedSession({
      email: identity.email,
      role: identity.role,
      student_id: identity.student_id,
      account_id: identity.account_id,
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

  if (accessCode !== getAccessCode()) {
    return json(401, { ok: false, error: "Invalid access code." });
  }

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
      if (action === "session") return await handleSession(event, false);
      if (action === "portal_data") return await handleSession(event, true);
      return json(404, { ok: false, error: "Unsupported student auth action." });
    }

    if (method === "POST") {
      if (action === "login") return await handleLogin(event);
      if (action === "logout") return handleLogout();
      if (action === "create_invite") {
        return await handleSnapshotMutation(event, action, createOrRefreshInvite);
      }
      if (action === "complete_invite") {
        return await handleSnapshotMutation(event, action, completeAccountInvite);
      }
      if (action === "request_reset") {
        return await handleSnapshotMutation(event, action, requestAccountReset);
      }
      if (action === "complete_reset") {
        return await handleSnapshotMutation(event, action, completeAccountReset);
      }
      if (action === "update_public_profile") {
        return await handlePortalMutation(event, action, (snapshot, identity, body) => upsertActorProfile(snapshot, identity, body));
      }
      if (action === "submit_public_material") {
        return await handlePortalMutation(event, action, createPortalMaterial);
      }
      if (action === "save_current_script") {
        return await handlePortalMutation(event, action, saveCurrentScript);
      }
      if (action === "add_script_comment") {
        return await handlePortalMutation(event, action, addScriptComment);
      }
      if (action === "archive_current_script") {
        return await handlePortalMutation(event, action, archiveCurrentScript);
      }
      if (action === "update_homework") {
        return await handlePortalMutation(event, action, updateHomeworkFromPortal);
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
