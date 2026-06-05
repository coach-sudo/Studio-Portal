const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SESSION_COOKIE_NAME = "studio_student_session";
const DEFAULT_SESSION_MINUTES = 120;
const DEFAULT_INVITE_HOURS = 72;
const PASSWORD_HASH_ITERATIONS = 210000;
const PORTAL_BLOB_STORE_NAME = "studio-portal-state";
const PORTAL_BLOB_OVERLAY_KEY = "student-auth-overlay.json";
const BLOB_MUTATION_COLLECTIONS = [
  "students",
  "homework",
  "actorProfiles",
  "files",
  "studentAccounts",
  "readerRequests",
  "lessonComments"
];

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

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getHeader(event, key) {
  const headers = event && event.headers ? event.headers : {};
  return headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()] || "";
}

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function getNetlifyBlobCredentials() {
  return {
    siteID: getEnv("NETLIFY_BLOBS_SITE_ID") || getEnv("NETLIFY_SITE_ID") || getEnv("SITE_ID"),
    token: getEnv("NETLIFY_BLOBS_TOKEN") || getEnv("NETLIFY_AUTH_TOKEN") || getEnv("NETLIFY_API_TOKEN")
  };
}

async function getConfiguredBlobStore(name, options = {}) {
  const { getStore } = await import("@netlify/blobs");
  const credentials = getNetlifyBlobCredentials();
  const storeOptions = {
    name,
    consistency: options.consistency || "strong"
  };
  if (credentials.siteID && credentials.token) {
    storeOptions.siteID = credentials.siteID;
    storeOptions.token = credentials.token;
  }
  return getStore(storeOptions);
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

function getBookingUrl() {
  return getEnv("STUDENT_PORTAL_BOOKING_URL", "https://coach.as.me");
}

function getStudentPortalPublicSettings() {
  return {
    studio_name: getEnv("STUDIO_PORTAL_STUDIO_NAME", "Stage & Story"),
    studio_tagline: getEnv("STUDIO_PORTAL_TAGLINE", "Studio Management"),
    coach_name: getEnv("STUDIO_PORTAL_COACH_NAME", "Darius A. Journigan"),
    coach_title: getEnv("STUDIO_PORTAL_COACH_TITLE", "Acting Coach"),
    coach_contact_email: getEnv("STUDENT_PORTAL_COACH_EMAIL", "coach@d-a-j.com"),
    coach_contact_phone: getEnv("STUDENT_PORTAL_COACH_PHONE", "9292160175"),
    student_portal_label: getEnv("STUDENT_PORTAL_LABEL", "Student Workspace"),
    student_welcome_message: getEnv("STUDENT_PORTAL_WELCOME", "Your lessons, homework, materials, and actor page drafts live here."),
    student_show_contact_buttons: getEnv("STUDENT_PORTAL_SHOW_CONTACT", "true") !== "false",
    student_show_booking_button: getEnv("STUDENT_PORTAL_SHOW_BOOKING", "true") !== "false",
    student_show_drive_folder: getEnv("STUDENT_PORTAL_SHOW_DRIVE", "true") !== "false"
  };
}

function getGoogleAccountEmail() {
  return getEnv("GOOGLE_ACCOUNT_EMAIL", "coach@d-a-j.com");
}

function getGoogleClientId() {
  return getEnv("GOOGLE_OAUTH_CLIENT_ID");
}

function getGoogleClientSecret() {
  return getEnv("GOOGLE_OAUTH_CLIENT_SECRET");
}

function getGoogleRefreshToken() {
  return getEnv("GOOGLE_REFRESH_TOKEN");
}

function sanitizeUploadFileName(value) {
  return String(value || "student-upload")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 120) || "student-upload";
}

function parseDataUrlUpload(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match || !match[2]) return null;
  return {
    mimeType: match[1] || "application/octet-stream",
    buffer: Buffer.from(match[3] || "", "base64")
  };
}

async function storePortalUpload(identity, body, fallbackPrefix = "material") {
  const parsed = parseDataUrlUpload(body.file_data_url || body.upload_data_url || "");
  if (!parsed) return null;
  const maxBytes = 4.5 * 1024 * 1024;
  if (parsed.buffer.length > maxBytes) {
    throw httpError(413, "Direct uploads must be 4.5 MB or smaller. Use a share link for larger videos or PDFs.");
  }
  const fileName = sanitizeUploadFileName(body.file_name || body.upload_name || body.title || fallbackPrefix);
  const key = `student-uploads/${identity.student_id}/${Date.now()}-${randomToken(8)}-${fileName}`;
  const store = await getConfiguredBlobStore("studio-portal-files");
  await store.set(key, parsed.buffer, {
    metadata: {
      contentType: String(body.mime_type || body.upload_mime_type || parsed.mimeType || "application/octet-stream").trim(),
      fileName,
      studentId: identity.student_id,
      uploadedAt: new Date().toISOString()
    }
  });
  return {
    key,
    fileName,
    mimeType: String(body.mime_type || body.upload_mime_type || parsed.mimeType || "application/octet-stream").trim(),
    url: `/api/material-file?key=${encodeURIComponent(key)}`
  };
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

function parseStudentPortalAccounts(student) {
  try {
    const parsed = JSON.parse(String(student && student.portal_account_data || "[]"));
    return Array.isArray(parsed) ? parsed.filter((account) => account && account.account_id) : [];
  } catch (error) {
    return [];
  }
}

function ensureStudentAccounts(snapshot) {
  snapshot.studentAccounts = Array.isArray(snapshot.studentAccounts) ? snapshot.studentAccounts : [];
  const byId = new Map(snapshot.studentAccounts.map((account) => [account.account_id, account]));
  (snapshot.students || []).forEach((student) => {
    parseStudentPortalAccounts(student).forEach((account) => {
      if (!byId.has(account.account_id)) {
        const hydrated = {
          ...account,
          student_id: account.student_id || student.student_id
        };
        snapshot.studentAccounts.push(hydrated);
        byId.set(hydrated.account_id, hydrated);
      }
    });
  });
  return snapshot.studentAccounts;
}

function mirrorStudentAccountsToStudents(snapshot) {
  ensureStudentAccounts(snapshot);
  (snapshot.students || []).forEach((student) => {
    const accounts = snapshot.studentAccounts
      .filter((account) => account.student_id === student.student_id)
      .map((account) => ({ ...account }));
    student.portal_account_data = accounts.length ? JSON.stringify(accounts) : "";
  });
  return snapshot;
}

function getAccountByEmail(snapshot, email) {
  ensureStudentAccounts(snapshot);
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

function getCollectionIdField(collectionKey) {
  return {
    students: "student_id",
    homework: "homework_id",
    actorProfiles: "actor_profile_id",
    files: "file_id",
    studentAccounts: "account_id",
    readerRequests: "reader_request_id",
    lessonComments: "lesson_comment_id"
  }[collectionKey] || "";
}

function mergeCollectionById(baseRows, overlayRows, idField) {
  if (!idField) return Array.isArray(overlayRows) ? overlayRows.slice() : (Array.isArray(baseRows) ? baseRows.slice() : []);
  const rows = Array.isArray(baseRows) ? baseRows.map((row) => ({ ...row })) : [];
  const indexById = new Map(rows.map((row, index) => [String(row && row[idField] || ""), index]).filter(([id]) => id));
  (Array.isArray(overlayRows) ? overlayRows : []).forEach((overlay) => {
    const id = String(overlay && overlay[idField] || "");
    if (!id) return;
    if (indexById.has(id)) {
      rows[indexById.get(id)] = { ...rows[indexById.get(id)], ...overlay };
    } else {
      indexById.set(id, rows.length);
      rows.push({ ...overlay });
    }
  });
  return rows;
}

async function loadBlobOverlay() {
  try {
    const store = await getConfiguredBlobStore(PORTAL_BLOB_STORE_NAME);
    const overlay = await store.get(PORTAL_BLOB_OVERLAY_KEY, { type: "json" });
    return overlay && typeof overlay === "object" ? overlay : {};
  } catch (error) {
    return {};
  }
}

function applyBlobOverlay(snapshot, overlay) {
  const merged = { ...snapshot };
  BLOB_MUTATION_COLLECTIONS.forEach((collectionKey) => {
    if (!Array.isArray(overlay && overlay[collectionKey])) return;
    merged[collectionKey] = mergeCollectionById(
      merged[collectionKey],
      overlay[collectionKey],
      getCollectionIdField(collectionKey)
    );
  });
  return merged;
}

function buildBlobOverlay(snapshot) {
  const overlay = {
    updated_at: new Date().toISOString()
  };
  BLOB_MUTATION_COLLECTIONS.forEach((collectionKey) => {
    overlay[collectionKey] = Array.isArray(snapshot[collectionKey])
      ? snapshot[collectionKey].map((row) => ({ ...row }))
      : [];
  });
  return overlay;
}

async function saveBlobOverlay(snapshot) {
  const store = await getConfiguredBlobStore(PORTAL_BLOB_STORE_NAME);
  await store.setJSON(PORTAL_BLOB_OVERLAY_KEY, buildBlobOverlay(snapshot));
}

async function persistTrustedSnapshot(snapshot) {
  mirrorStudentAccountsToStudents(snapshot);
  let blobWarning = "";
  try {
    await saveBlobOverlay(snapshot);
  } catch (error) {
    blobWarning = error && error.message ? error.message : "Netlify Blobs did not save.";
  }
  try {
    await pushAppsScriptSnapshot(snapshot);
    return { persisted: blobWarning ? "sheets" : "blobs_and_sheets", warning: blobWarning };
  } catch (error) {
    if (blobWarning) {
      throw new Error(`Unable to save portal update. Netlify Blobs: ${blobWarning}. Google Sheets: ${error && error.message ? error.message : error}`);
    }
    return {
      persisted: "blobs",
      warning: error && error.message ? error.message : "Google Sheets sync did not finish."
    };
  }
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
      studentAccounts: typeof sampleStudentAccounts !== "undefined" ? sampleStudentAccounts : [],
      readerRequests: typeof sampleReaderRequests !== "undefined" ? sampleReaderRequests : [],
      lessonComments: typeof sampleLessonComments !== "undefined" ? sampleLessonComments : []
    });`);
  return script.runInNewContext(sandbox);
}

async function loadTrustedSnapshot() {
  const remoteSnapshot = await fetchAppsScriptSnapshot();
  const baseSnapshot = remoteSnapshot || loadLocalSampleSnapshot();
  const overlay = await loadBlobOverlay();
  return applyBlobOverlay(baseSnapshot, overlay);
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
  const ownedKinds = ["lesson", "note", "homework", "material", "script", "payment", "package", "readerRequest", "lessonComment"];
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
  if (kind === "readerRequest") return true;
  if (kind === "lessonComment") return true;

  return true;
}

function sanitizeReaderRequestForPortal(request) {
  if (!request) return null;
  return {
    reader_request_id: request.reader_request_id,
    student_id: request.student_id,
    filming_date: request.filming_date,
    filming_time: request.filming_time,
    timezone: request.timezone,
    duration_minutes: request.duration_minutes,
    meeting_method: request.meeting_method,
    meeting_details: request.meeting_details,
    sides_url: request.sides_url,
    instructions_url: request.instructions_url,
    upload_name: request.upload_name,
    upload_url: request.upload_url,
    upload_mime_type: request.upload_mime_type,
    notes: request.notes,
    status: request.status,
    blast_status: request.blast_status,
    reader_name: request.reader_name,
    created_at: request.created_at,
    updated_at: request.updated_at
  };
}

function sanitizeLessonCommentForPortal(comment) {
  if (!comment) return null;
  return {
    lesson_comment_id: comment.lesson_comment_id,
    lesson_id: comment.lesson_id,
    student_id: comment.student_id,
    author_role: comment.author_role,
    author_email: comment.author_email,
    body: comment.body,
    coach_read_at: comment.coach_read_at,
    resolved_at: comment.resolved_at,
    created_at: comment.created_at,
    updated_at: comment.updated_at
  };
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
    materials,
    readerRequests: (snapshot.readerRequests || [])
      .filter((request) => canViewRecord(scopedIdentity, request, "readerRequest"))
      .sort((a, b) => new Date(b.created_at || b.updated_at || 0).getTime() - new Date(a.created_at || a.updated_at || 0).getTime())
      .map(sanitizeReaderRequestForPortal),
    lessonComments: (snapshot.lessonComments || [])
      .filter((comment) => canViewRecord(scopedIdentity, comment, "lessonComment"))
      .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
      .map(sanitizeLessonCommentForPortal),
    settings: {
      ...getStudentPortalPublicSettings(),
      booking_url: getBookingUrl(),
      stripe_checkout_enabled: Boolean(getEnv("STRIPE_SECRET_KEY")),
      reader_uploads_enabled: true
    }
  };
}

async function getSessionIdentity(event) {
  const cookies = parseCookies(event);
  const session = verifySignedSession(cookies[SESSION_COOKIE_NAME]);
  if (!session) return null;

  const snapshot = await loadTrustedSnapshot();
  ensureStudentAccounts(snapshot);
  const sessionAccount = session.account_id
    ? (snapshot.studentAccounts || []).find((account) => account.account_id === session.account_id)
    : null;
  const identity = sessionAccount
    ? getIdentityForAccount(snapshot, sessionAccount)
    : getIdentityForEmail(snapshot, session.email);
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

function buildPortalTokenUrl(event, token, tokenType = "setup") {
  const siteUrl = getSiteBaseUrl(event);
  const paramName = tokenType === "reset" ? "reset" : "setup";
  const path = `/portal?${paramName}=${encodeURIComponent(token)}`;
  return siteUrl ? `${siteUrl}${path}` : path;
}

function buildPortalSetupUrl(event, token) {
  return buildPortalTokenUrl(event, token, "setup");
}

function buildPortalResetUrl(event, token) {
  return buildPortalTokenUrl(event, token, "reset");
}

function assertAdminToken(body) {
  const expected = getAdminToken();
  if (!expected) {
    throw httpError(500, "Student account admin actions require STUDENT_PORTAL_ADMIN_TOKEN.");
  }
  const provided = String(body.admin_token || body.adminToken || "").trim();
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (!provided || providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw httpError(403, "Invalid student account admin token.");
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
  ensureStudentAccounts(snapshot);
  const role = normalizeAccountRole(body.role);
  const studentId = String(body.student_id || "").trim();
  const student = (snapshot.students || []).find((row) => row.student_id === studentId);
  if (!student) throw httpError(404, "Student not found for account invite.");
  const email = normalizeEmail(body.email || getDefaultAccountEmail(student, role));
  if (!email) throw httpError(400, "An email is required to create a student account invite.");

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
  ensureStudentAccounts(snapshot);
  const tokenHash = hashToken(token);
  return (snapshot.studentAccounts || []).find((account) => account[fieldName] === tokenHash) || null;
}

function completeAccountInvite(snapshot, body) {
  const token = String(body.token || body.setup_token || "").trim();
  const password = String(body.password || "").trim();
  if (!token) throw httpError(400, "Invite token is required.");
  if (password.length < 8) throw httpError(400, "Password must be at least 8 characters.");
  const account = findAccountByToken(snapshot, token, "invite_token_hash");
  if (!account) throw httpError(400, "Invite link is invalid or has already been used.");
  const expiresAt = new Date(account.invite_expires_at || 0);
  if (!account.invite_expires_at || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    throw httpError(400, "Invite link has expired.");
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
  if (!email) throw httpError(400, "Email is required.");
  const canReturnResetLink = Boolean(String(body.admin_token || body.adminToken || "").trim());
  if (canReturnResetLink) assertAdminToken(body);
  const account = getAccountByEmail(snapshot, email);
  if (!account || String(account.status || "").toUpperCase() === "DISABLED") {
    return { sent: true };
  }
  if (!canReturnResetLink) {
    return { sent: true };
  }
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + getInviteHours() * 60 * 60 * 1000).toISOString();
  account.reset_token_hash = hashToken(token);
  account.reset_expires_at = expiresAt;
  account.updated_at = new Date().toISOString();
  return { sent: true, reset_token: token, reset_url: buildPortalResetUrl(event, token) };
}

function completeAccountReset(snapshot, body) {
  const token = String(body.token || body.reset_token || "").trim();
  const password = String(body.password || "").trim();
  if (!token) throw httpError(400, "Reset token is required.");
  if (password.length < 8) throw httpError(400, "Password must be at least 8 characters.");
  const account = findAccountByToken(snapshot, token, "reset_token_hash");
  if (!account) throw httpError(400, "Reset link is invalid or has already been used.");
  const expiresAt = new Date(account.reset_expires_at || 0);
  if (!account.reset_expires_at || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    throw httpError(400, "Reset link has expired.");
  }
  account.password_hash = hashPassword(password);
  account.status = "ACTIVE";
  account.reset_token_hash = "";
  account.reset_expires_at = "";
  account.updated_at = new Date().toISOString();
  return sanitizeAccountForCoach(account);
}

function disableAccount(snapshot, body) {
  assertAdminToken(body);
  ensureStudentAccounts(snapshot);
  const accountId = String(body.account_id || "").trim();
  const email = normalizeEmail(body.email);
  const account = (snapshot.studentAccounts || []).find((row) => (
    accountId ? row.account_id === accountId : normalizeEmail(row.email) === email
  ));
  if (!account) throw httpError(404, "Student account not found.");
  account.status = "DISABLED";
  account.invite_token_hash = "";
  account.invite_expires_at = "";
  account.reset_token_hash = "";
  account.reset_expires_at = "";
  account.updated_at = new Date().toISOString();
  return sanitizeAccountForCoach(account);
}

function seedAidenDemoAccount(snapshot, body) {
  assertAdminToken(body);
  if (getEnv("ENABLE_DEMO_STUDENT_SEED", "false") !== "true") {
    throw httpError(403, "Demo account seeding is disabled. Set ENABLE_DEMO_STUDENT_SEED=true to use this action.");
  }
  ensureStudentAccounts(snapshot);
  const email = normalizeEmail(body.email || "aiden@example.com");
  const password = String(body.password || body.demo_password || "").trim();
  if (!password || password.length < 8) throw httpError(400, "Demo password must be at least 8 characters.");
  const student = (snapshot.students || []).find((row) => normalizeEmail(row.email) === email || row.student_id === "STU-000004");
  if (!student) throw httpError(404, "Aiden Liu was not found in this snapshot.");
  if (student.portal_access_enabled === false) student.portal_access_enabled = true;
  const now = new Date().toISOString();
  let account = (snapshot.studentAccounts || []).find((row) => normalizeEmail(row.email) === email && row.student_id === student.student_id) || null;
  if (!account) {
    account = {
      account_id: nextId(snapshot.studentAccounts, "ACCT", "account_id"),
      student_id: student.student_id,
      role: "STUDENT",
      email,
      created_at: now
    };
    snapshot.studentAccounts.push(account);
  }
  account.role = "STUDENT";
  account.email = email;
  account.status = "ACTIVE";
  account.password_hash = hashPassword(password);
  account.invite_token_hash = "";
  account.invite_expires_at = "";
  account.reset_token_hash = "";
  account.reset_expires_at = "";
  account.activated_at = account.activated_at || now;
  account.updated_at = now;
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
  const mutationResult = await Promise.resolve(mutator(result.snapshot, scopedIdentity, body, event));
  const persistence = await persistTrustedSnapshot(result.snapshot);
  return json(200, {
    ok: true,
    action,
    result: mutationResult,
    persistence,
    data: getScopedPortalData(result.snapshot, result.identity)
  });
}

async function handleSnapshotMutation(event, action, mutator) {
  const snapshot = await loadTrustedSnapshot();
  ensureStudentAccounts(snapshot);
  const body = JSON.parse(event.body || "{}");
  const mutationResult = mutator(snapshot, body, event);
  const persistence = await persistTrustedSnapshot(snapshot);
  return json(200, {
    ok: true,
    action,
    result: mutationResult,
    persistence
  });
}

async function createPortalMaterial(snapshot, identity, body) {
  if (!canViewRecord(identity, identity.student, "public")) {
    throw httpError(403, "Public page controls are not enabled for this portal account.");
  }
  snapshot.files = Array.isArray(snapshot.files) ? snapshot.files : [];
  const now = new Date().toISOString();
  const upload = await storePortalUpload(identity, body, "public-material");
  const category = String(body.category || "Public Page").trim();
  const sourceType = upload ? "UPLOAD" : String(body.source_type || "LINK").trim().toUpperCase();
  const externalUrl = upload ? "" : String(body.external_url || "").trim();
  const fileUrl = upload ? upload.url : String(body.file_url || "").trim();
  if (!externalUrl && !fileUrl) {
    throw httpError(400, "Add a file upload or a share link.");
  }
  const material = {
    file_id: nextId(snapshot.files, "FILE", "file_id"),
    student_id: identity.student_id,
    lesson_id: null,
    homework_id: null,
    file_name: upload ? upload.fileName : String(body.file_name || body.title || "Student Material").trim(),
    title: String(body.title || body.file_name || "Student Material").trim(),
    source_type: sourceType,
    external_url: externalUrl,
    file_url: fileUrl,
    mime_type: upload ? upload.mimeType : String(body.mime_type || "").trim(),
    material_kind: String(body.material_kind || "DOCUMENT").trim().toUpperCase(),
    category,
    public_page_featured: category.toLowerCase() === "headshot" ? "HEADSHOT" : "",
    scope: "ACTOR_MATERIAL",
    visibility: "ADMIN_ONLY",
    public_page_status: "PENDING_REVIEW",
    submitted_by: "STUDENT_PORTAL",
    submitted_at: now,
    reviewed_at: "",
    reviewed_by: "",
    notes: String(body.notes || (upload ? `Uploaded file key: ${upload.key}` : "Submitted from student portal.")).trim(),
    status: "Active",
    uploaded_at: now
  };
  snapshot.files.push(material);
  return material;
}

function saveCurrentScript(snapshot, identity, body) {
  if (identity.student && identity.student.portal_script_access === false) {
    throw httpError(403, "Current script access is not enabled for this portal account.");
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
    throw httpError(403, "Current script access is not enabled for this portal account.");
  }
  const script = getCurrentScriptRecord(snapshot, identity.student_id);
  if (!script) throw httpError(404, "No current script is active.");
  const notes = parseJsonObject(script.notes, { script_text: "", comments: [] });
  const comment = {
    id: `SCOM-${Date.now()}`,
    author_role: identity.role,
    author_email: identity.email,
    body: String(body.comment || "").trim(),
    created_at: new Date().toISOString()
  };
  if (!comment.body) throw httpError(400, "Comment text is required.");
  notes.comments = Array.isArray(notes.comments) ? notes.comments : [];
  notes.comments.unshift(comment);
  script.notes = encodeScriptNotes(notes);
  return comment;
}

function archiveCurrentScript(snapshot, identity) {
  if (identity.student && identity.student.portal_script_access === false) {
    throw httpError(403, "Current script access is not enabled for this portal account.");
  }
  const script = getCurrentScriptRecord(snapshot, identity.student_id);
  if (!script) throw httpError(404, "No current script is active.");
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
    throw httpError(403, "Homework access is not enabled for this portal account.");
  }
  const homeworkId = String(body.homework_id || "").trim();
  const item = (snapshot.homework || []).find((row) => row.homework_id === homeworkId && row.student_id === identity.student_id);
  if (!item) throw httpError(404, "Homework item not found.");

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

function isValidReaderMeetingMethod(value) {
  return [
    "ZOOM",
    "GOOGLE_MEET",
    "TEAMS",
    "PHONE",
    "WHATSAPP",
    "SOCIAL_MEDIA",
    "IN_PERSON"
  ].includes(String(value || "").trim().toUpperCase());
}

function normalizeReaderMeetingMethod(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized === "MEET") return "GOOGLE_MEET";
  if (normalized === "MICROSOFT_TEAMS") return "TEAMS";
  if (normalized === "PHONE_CALL") return "PHONE";
  return normalized;
}

async function refreshGoogleAccessToken() {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  const refreshToken = getGoogleRefreshToken();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google OAuth is not configured for Gmail notifications.");
  }
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
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Unable to refresh Google access token.");
  }
  return payload.access_token;
}

function encodeGmailMessage({ to, subject, text }) {
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    text
  ].join("\r\n");
  return Buffer.from(raw, "utf8").toString("base64url");
}

function buildReaderRequestEmail(identity, request) {
  return [
    `Reader request from ${request.student_name || identity.student_name}`,
    "",
    `Student: ${request.student_name || identity.student_name}`,
    `Email: ${request.student_email || identity.email}`,
    `Filming: ${request.filming_date} ${request.filming_time} ${request.timezone || ""}`.trim(),
    `Expected duration: ${request.duration_minutes} minutes`,
    `Meeting method: ${request.meeting_method}`,
    `Meeting details: ${request.meeting_details || "Not provided"}`,
    request.sides_url ? `Sides: ${request.sides_url}` : "",
    request.instructions_url ? `Instructions: ${request.instructions_url}` : "",
    request.upload_name ? `Upload: ${request.upload_name}` : "",
    "",
    request.notes ? `Notes:\n${request.notes}` : "No notes."
  ].filter(Boolean).join("\n");
}

async function notifyCoachOfReaderRequest(identity, request) {
  const accessToken = await refreshGoogleAccessToken();
  const to = getGoogleAccountEmail();
  const subject = `Reader request: ${request.student_name || identity.student_name} on ${request.filming_date}`;
  const raw = encodeGmailMessage({
    to,
    subject,
    text: buildReaderRequestEmail(identity, request)
  });
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error && payload.error.message ? payload.error.message : "Gmail notification failed.");
  }
  return payload;
}

async function createReaderRequest(snapshot, identity, body) {
  snapshot.readerRequests = Array.isArray(snapshot.readerRequests) ? snapshot.readerRequests : [];
  const filmingDate = String(body.filming_date || "").trim();
  const filmingTime = String(body.filming_time || "").trim();
  const durationMinutes = Number(body.duration_minutes || 0);
  const meetingMethod = normalizeReaderMeetingMethod(body.meeting_method);
  if (!filmingDate) throw httpError(400, "Filming date is required.");
  if (!filmingTime) throw httpError(400, "Filming time is required.");
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 360) {
    throw httpError(400, "Expected duration must be between 15 and 360 minutes.");
  }
  if (!isValidReaderMeetingMethod(meetingMethod)) {
    throw httpError(400, "Choose a supported meeting method.");
  }
  const now = new Date().toISOString();
  const upload = await storePortalUpload(identity, body, "reader-sides");
  const request = {
    reader_request_id: nextId(snapshot.readerRequests, "READ", "reader_request_id"),
    student_id: identity.student_id,
    student_name: identity.student_name || "",
    student_email: identity.email || "",
    filming_date: filmingDate,
    filming_time: filmingTime,
    timezone: String(body.timezone || identity.student?.timezone || "America/New_York").trim(),
    duration_minutes: String(Math.round(durationMinutes)),
    meeting_method: meetingMethod,
    meeting_details: String(body.meeting_details || "").trim(),
    sides_url: String(body.sides_url || "").trim(),
    instructions_url: String(body.instructions_url || "").trim(),
    upload_name: upload ? upload.fileName : String(body.upload_name || "").trim(),
    upload_url: upload ? upload.url : String(body.upload_url || "").trim(),
    upload_mime_type: upload ? upload.mimeType : String(body.upload_mime_type || "").trim(),
    notes: String(body.notes || "").trim(),
    status: "SUBMITTED",
    coach_notified_at: "",
    blast_status: "NOT_STARTED",
    blast_sent_at: "",
    reader_name: "",
    resolved_at: "",
    created_at: now,
    updated_at: now
  };
  if (!request.sides_url && !request.upload_url) {
    throw httpError(400, "Add sides as a link or upload.");
  }
  snapshot.readerRequests.push(request);
  return request;
}

function addLessonComment(snapshot, identity, body) {
  snapshot.lessonComments = Array.isArray(snapshot.lessonComments) ? snapshot.lessonComments : [];
  const lessonId = String(body.lesson_id || "").trim();
  const commentBody = String(body.body || body.comment || "").trim();
  if (!lessonId) throw httpError(400, "Lesson is required.");
  if (!commentBody) throw httpError(400, "Comment is required.");
  if (commentBody.length > 2000) throw httpError(400, "Comment must be 2,000 characters or fewer.");
  const lesson = (snapshot.lessons || []).find((row) => row.lesson_id === lessonId && row.student_id === identity.student_id);
  if (!lesson || !canViewRecord(identity, lesson, "lesson")) {
    throw httpError(404, "Lesson not found.");
  }
  const now = new Date().toISOString();
  const comment = {
    lesson_comment_id: nextId(snapshot.lessonComments, "LCOM", "lesson_comment_id"),
    lesson_id: lessonId,
    student_id: identity.student_id,
    author_role: identity.role || "STUDENT",
    author_email: identity.email || "",
    body: commentBody,
    coach_read_at: "",
    resolved_at: "",
    created_at: now,
    updated_at: now
  };
  snapshot.lessonComments.push(comment);
  return sanitizeLessonCommentForPortal(comment);
}

async function handleLogin(event) {
  if (!getSessionSecret()) {
    return json(500, {
      ok: false,
      error: "Student portal auth is missing STUDENT_PORTAL_SESSION_SECRET."
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

  if (!getAccessCode()) {
    return json(500, {
      ok: false,
      error: "Legacy access-code login is missing STUDENT_PORTAL_ACCESS_CODE. Use student account password login instead."
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
      if (action === "disable_account") {
        return await handleSnapshotMutation(event, action, disableAccount);
      }
      if (action === "seed_aiden_demo_account") {
        return await handleSnapshotMutation(event, action, seedAidenDemoAccount);
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
      if (action === "request_reader") {
        return await handlePortalMutation(event, action, async (snapshot, identity, body) => {
          const request = createReaderRequest(snapshot, identity, body);
          try {
            await notifyCoachOfReaderRequest(identity, request);
            request.coach_notified_at = new Date().toISOString();
            request.updated_at = request.coach_notified_at;
          } catch (error) {
            request.notes = [
              request.notes,
              `Coach Gmail notification pending: ${String(error && error.message ? error.message : error || "Gmail unavailable.")}`
            ].filter(Boolean).join("\n\n");
          }
          return sanitizeReaderRequestForPortal(request);
        });
      }
      if (action === "add_lesson_comment") {
        return await handlePortalMutation(event, action, addLessonComment);
      }
      return json(404, { ok: false, error: "Unsupported student auth action." });
    }

    return json(405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    return json(error && error.statusCode ? error.statusCode : 500, {
      ok: false,
      error: String(error && error.message ? error.message : error || "Student auth failed.")
    });
  }
};
