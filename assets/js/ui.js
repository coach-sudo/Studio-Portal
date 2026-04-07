/*********************************
 * UI STATE
 *********************************/
let selectedStudentId = null;
let editingStudentId = null;
let editingLessonId = null;
let profilePreviousLessonsVisibleCount = 3;
let currentLessonsStatusFilter = "all";
let currentLessonsStudentFilter = "all";
let currentLessonsSearchQuery = "";
let currentLessonsDateRangeFilter = "all";
let currentScheduleView = "calendar";
let currentScheduleCalendarMode = "month";
let currentScheduleTimingFilter = "upcoming";
let currentScheduleReviewFilter = "action-needed";
let currentScheduleSourceFilter = "all";
let currentScheduleSearchQuery = "";
const initialScheduleDate = new Date();
let currentScheduleCalendarMonth = new Date(initialScheduleDate.getFullYear(), initialScheduleDate.getMonth(), 1);
let currentScheduleSelectedDate = `${initialScheduleDate.getFullYear()}-${String(initialScheduleDate.getMonth() + 1).padStart(2, "0")}-${String(initialScheduleDate.getDate()).padStart(2, "0")}`;
let currentNotesQueueFilter = "all";
let currentNotesQueueSearchQuery = "";
let currentNotesQueueShowWorkflow = false;
let activeLessonDetailId = null;
let profileNotesVisibleCount = 3;
let currentProfileNotesFilter = "all";
let activeLessonDetailTab = "notes";
let showProfileMaterialsVault = false;
let editingHomeworkId = null;
let editingMaterialId = null;
let currentFinanceTab = "packages";
let currentFinanceSearchQuery = "";
let currentFinanceBillingFilter = "all";
let currentFinanceStatusFilter = "all";
let currentFinanceHistoryMode = "active";
let editingPackageId = null;
let editingPaymentId = null;
let importedStudentRows = [];
let importedStudentFileName = "";
let currentStudentFilters = new Set(["all"]);
const CALENDAR_SYNC_STORAGE_KEY = "studioPortal.googleCalendarSync";
const AUTOMATION_SETTINGS_STORAGE_KEY = "studioPortal.automationSettings";
const UI_PREFERENCES_STORAGE_KEY = "studioPortal.uiPreferences";
const NOTIFICATION_CENTER_STORAGE_KEY = "studioPortal.notifications";
const DEFAULT_CALENDAR_SYNC_STATE = {
  connected: false,
  selected_calendar_id: "primary",
  selected_calendar_label: "Main Calendar",
  connection_mode: "local-demo",
  sync_window_past_days: 30,
  sync_window_future_days: 60,
  import_mode: "lesson_like_only",
  last_sync_at: "",
  last_sync_summary: null,
  gmail_connected: false,
  gmail_last_sync_at: "",
  gmail_last_sync_summary: null
};
const DEFAULT_AUTOMATION_SETTINGS = {
  notes_follow_up: true,
  stale_draft_cleanup: true,
  intake_review: true,
  external_change_watch: true,
  public_page_policy: true
};
const DEFAULT_UI_PREFERENCES = {
  compact: {
    students: false,
    lessons: false,
    notes: false,
    finance: false,
    schedule: false
  }
};

function loadUiPreferences() {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_UI_PREFERENCES));
    return {
      ...DEFAULT_UI_PREFERENCES,
      ...JSON.parse(raw),
      compact: {
        ...DEFAULT_UI_PREFERENCES.compact,
        ...(JSON.parse(raw).compact || {})
      }
    };
  } catch (error) {
    return JSON.parse(JSON.stringify(DEFAULT_UI_PREFERENCES));
  }
}

function saveUiPreferences() {
  try {
    localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(uiPreferences));
  } catch (error) {
    // Ignore storage issues and keep in-memory preferences.
  }
}

function loadNotificationCenterItems() {
  try {
    const raw = localStorage.getItem(NOTIFICATION_CENTER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveNotificationCenterItems() {
  try {
    localStorage.setItem(NOTIFICATION_CENTER_STORAGE_KEY, JSON.stringify(notificationCenterItems.slice(0, 30)));
  } catch (error) {
    // Ignore storage issues and keep in-memory notifications.
  }
}

function loadAutomationSettings() {
  try {
    const raw = localStorage.getItem(AUTOMATION_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUTOMATION_SETTINGS };
    return {
      ...DEFAULT_AUTOMATION_SETTINGS,
      ...JSON.parse(raw)
    };
  } catch (error) {
    return { ...DEFAULT_AUTOMATION_SETTINGS };
  }
}

function saveAutomationSettings() {
  try {
    localStorage.setItem(AUTOMATION_SETTINGS_STORAGE_KEY, JSON.stringify(automationSettings));
  } catch (error) {
    // Ignore storage issues and keep the in-memory state.
  }
}

function isCompactView(pageKey) {
  return Boolean(uiPreferences?.compact?.[pageKey]);
}

function toggleCompactView(pageKey) {
  uiPreferences = {
    ...uiPreferences,
    compact: {
      ...uiPreferences.compact,
      [pageKey]: !isCompactView(pageKey)
    }
  };
  saveUiPreferences();
  renderCurrentPage();
}

function getCompactToggleLabel(pageKey) {
  return isCompactView(pageKey) ? "Comfortable View" : "Compact View";
}

function getToastToneClasses(tone = "warm") {
  if (tone === "success") return "border-sage/20 bg-sage/5 text-sage";
  if (tone === "error") return "border-burgundy/20 bg-burgundy/5 text-burgundy";
  return "border-gold/20 bg-white text-warmblack";
}

function pushNotificationItem({ title, message, tone = "warm", source = "system" }) {
  const item = {
    id: `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: String(title || "Studio Portal").trim() || "Studio Portal",
    message: String(message || "").trim(),
    tone,
    source,
    created_at: new Date().toISOString()
  };

  notificationCenterItems = [item, ...notificationCenterItems].slice(0, 30);
  saveNotificationCenterItems();
}

function showToast(message, tone = "warm", title = "") {
  const root = document.getElementById("toast-root");
  const safeMessage = String(message || "").trim();
  if (!root || !safeMessage) return;

  const toast = document.createElement("div");
  toast.className = `toast-card ${getToastToneClasses(tone)} fade-in`;
  toast.innerHTML = `
    ${title ? `<p class="text-xs uppercase tracking-wider font-medium mb-1">${escapeHtml(title)}</p>` : ""}
    <p class="text-sm">${escapeHtml(safeMessage)}</p>
  `;
  root.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

function notifyUser({ title = "", message = "", tone = "warm", source = "system", toast = true }) {
  if (!message) return;
  pushNotificationItem({ title, message, tone, source });
  if (toast) {
    showToast(message, tone, title);
  }
}

function getNotificationAttentionRows() {
  const rows = [];
  const noteSummary = typeof getDashboardNotesAlertSummary === "function" ? getDashboardNotesAlertSummary() : null;
  if (noteSummary?.actionable?.length) {
    rows.push({
      title: "Urgent Notes",
      message: `${noteSummary.actionable.length} recent completed lessons still need note follow-up.`,
      tone: noteSummary.overdue.length ? "error" : "warm",
      action: "navigateTo('notes')"
    });
  }

  const intakeRows = typeof getScheduleIntakeRows === "function" ? getScheduleIntakeRows().filter((row) => row.action_required) : [];
  if (intakeRows.length) {
    rows.push({
      title: "Schedule Intake",
      message: `${intakeRows.length} imported lessons still need review.`,
      tone: "warm",
      action: "openAutomationIntakeReview()"
    });
  }

  const outstandingRows = typeof getOutstandingBalanceRows === "function" ? getOutstandingBalanceRows() : [];
  if (outstandingRows.length) {
    rows.push({
      title: "Outstanding Balances",
      message: `${outstandingRows.length} student balances are still open.`,
      tone: "warm",
      action: "navigateTo('finance')"
    });
  }

  return rows;
}

function closeNotificationCenter() {
  const overlay = document.getElementById("notification-center-overlay");
  if (overlay) overlay.remove();
}

function openNotificationCenter() {
  closeNotificationCenter();

  const overlay = document.createElement("div");
  overlay.id = "notification-center-overlay";
  overlay.className = "fixed inset-0 z-[110] bg-black/40 flex items-start justify-end p-4";

  const attentionRows = getNotificationAttentionRows();
  overlay.innerHTML = `
    <div class="notification-sheet app-modal-shell bg-white rounded-2xl border border-cream w-full max-w-xl p-4 sm:p-5">
      <div class="app-modal-header flex items-start justify-between gap-4 mb-4">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Notification Center</p>
          <h3 class="font-display text-xl font-semibold text-warmblack mt-1">Recent updates and attention items</h3>
        </div>
        <button type="button" id="close-notification-center" class="text-sm text-warmgray">Close</button>
      </div>

      ${
        attentionRows.length
          ? `
            <div class="space-y-3 mb-5">
              ${attentionRows.map((row) => `
                <button type="button" class="w-full text-left rounded-2xl border border-cream bg-parchment/70 p-4 card-hover" onclick="${row.action}; closeNotificationCenter();">
                  <p class="text-sm font-semibold ${row.tone === "error" ? "text-burgundy" : "text-warmblack"}">${escapeHtml(row.title)}</p>
                  <p class="text-xs text-warmgray mt-1">${escapeHtml(row.message)}</p>
                </button>
              `).join("")}
            </div>
          `
          : ""
      }

      <div class="space-y-3">
        ${
          notificationCenterItems.length
            ? notificationCenterItems.map((item) => `
              <div class="rounded-2xl border ${getToastToneClasses(item.tone)} p-4">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-sm font-semibold text-warmblack">${escapeHtml(item.title)}</p>
                  <span class="text-[11px] text-warmgray">${escapeHtml(formatLastSyncMeta(item.created_at))}</span>
                </div>
                <p class="text-sm mt-2 ${item.tone === "error" ? "text-burgundy" : "text-warmblack"}">${escapeHtml(item.message)}</p>
              </div>
            `).join("")
            : `<div class="page-empty-state"><p class="text-sm font-medium text-warmblack">No notifications yet</p><p class="text-xs text-warmgray mt-1">Saves, syncs, and workflow prompts will land here.</p></div>`
        }
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const closeBtn = document.getElementById("close-notification-center");
  if (closeBtn) closeBtn.onclick = closeNotificationCenter;
  overlay.onclick = (event) => {
    if (event.target === overlay) closeNotificationCenter();
  };
}

function getStatusFilterPill(label, value) {
  return `<span class="page-filter-pill">${escapeHtml(label)} · ${escapeHtml(value)}</span>`;
}

function saveAdminAuthSettings() {
  try {
    localStorage.setItem(ADMIN_AUTH_SETTINGS_STORAGE_KEY, JSON.stringify(adminAuthSettings));
  } catch (error) {
    // Ignore storage issues and keep the in-memory state.
  }
}

function requiresAdminUnlock() {
  return adminAuthSettings.require_unlock && Boolean(String(adminAuthSettings.local_passcode || "").trim());
}

function isAdminSessionUnlocked() {
  try {
    return sessionStorage.getItem(ADMIN_AUTH_SESSION_KEY) === "true";
  } catch (error) {
    return false;
  }
}

function setAdminSessionUnlocked(unlocked) {
  try {
    sessionStorage.setItem(ADMIN_AUTH_SESSION_KEY, unlocked ? "true" : "false");
    if (unlocked) {
      sessionStorage.setItem(ADMIN_AUTH_ACTIVITY_KEY, new Date().toISOString());
    } else {
      sessionStorage.removeItem(ADMIN_AUTH_ACTIVITY_KEY);
    }
  } catch (error) {
    // Ignore storage issues and still update the UI state.
  }
}

function recordAdminSessionActivity() {
  if (!requiresAdminUnlock() || !isAdminSessionUnlocked()) return;
  try {
    sessionStorage.setItem(ADMIN_AUTH_ACTIVITY_KEY, new Date().toISOString());
  } catch (error) {
    // Ignore storage issues.
  }
}

function getAdminSessionExpired() {
  if (!requiresAdminUnlock() || !isAdminSessionUnlocked()) return false;

  try {
    const raw = sessionStorage.getItem(ADMIN_AUTH_ACTIVITY_KEY);
    if (!raw) return true;
    const lastActivity = new Date(raw);
    if (Number.isNaN(lastActivity.getTime())) return true;
    const expiresAt = lastActivity.getTime() + (Number(adminAuthSettings.session_timeout_minutes || 30) * 60 * 1000);
    return Date.now() >= expiresAt;
  } catch (error) {
    return true;
  }
}

function isPortalLocked() {
  if (!requiresAdminUnlock()) return false;
  if (getAdminSessionExpired()) {
    setAdminSessionUnlocked(false);
    return true;
  }
  return !isAdminSessionUnlocked();
}

function setAdminAuthMessage(message, tone = "warm") {
  adminAuthMessage = String(message || "").trim();
  adminAuthTone = tone || "warm";
}

function clearAdminAuthMessage() {
  adminAuthMessage = "";
  adminAuthTone = "warm";
}

function getAdminAuthMessageMarkup() {
  if (!adminAuthMessage) return "";
  const toneClass =
    adminAuthTone === "error"
      ? "border-burgundy/20 bg-burgundy/5 text-burgundy"
      : adminAuthTone === "success"
        ? "border-sage/20 bg-sage/5 text-sage"
        : "border-gold/20 bg-gold/5 text-warmblack";

  return `
    <div class="rounded-xl border ${toneClass} px-4 py-3 mb-4">
      <p class="text-sm wrap-anywhere">${escapeHtml(adminAuthMessage)}</p>
    </div>
  `;
}

function renderAdminAuthOverlay() {
  const root = document.getElementById("admin-auth-root");
  if (!root) return;

  if (!isPortalLocked()) {
    root.innerHTML = "";
    document.body.classList.remove("app-locked");
    return;
  }

  document.body.classList.add("app-locked");

  root.innerHTML = `
    <div class="admin-auth-overlay fixed inset-0 z-[120] bg-black/55 flex items-center justify-center p-4">
      <div class="w-full max-w-md rounded-3xl border border-white/10 theatrical-gradient text-cream p-6 sm:p-7 shadow-2xl">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-11 h-11 rounded-2xl gold-gradient flex items-center justify-center text-warmblack">
            <i data-lucide="shield-check" class="w-5 h-5"></i>
          </div>
          <div class="min-w-0">
            <p class="text-xs uppercase tracking-wider text-warmgray">Admin Access</p>
            <h2 class="font-display text-2xl font-bold text-white">Unlock Studio Portal</h2>
          </div>
        </div>

        <p class="text-sm text-cream/80 mb-4">This portal is locked to protect student records, notes, and finance data on the live site.</p>
        ${getAdminAuthMessageMarkup()}

        <form class="space-y-4" onsubmit="submitAdminUnlock(event)">
          <div>
            <label class="block text-xs uppercase tracking-wider text-warmgray mb-2">Passcode</label>
            <input
              id="admin-unlock-passcode"
              type="password"
              autocomplete="current-password"
              class="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-cream/40"
              placeholder="Enter admin passcode"
            />
          </div>
          <button type="submit" class="w-full px-4 py-3 rounded-xl gold-gradient text-warmblack text-sm font-semibold card-hover">Unlock Portal</button>
        </form>
      </div>
    </div>
  `;

  lucide.createIcons();
}

function updateSidebarLockButtonState() {
  const button = document.getElementById("sidebar-lock-btn");
  if (!button) return;

  const enabled = requiresAdminUnlock();
  button.disabled = !enabled;
  button.classList.toggle("opacity-50", !enabled);
  button.classList.toggle("cursor-not-allowed", !enabled);
  button.textContent = enabled ? "Lock Portal" : "Lock Disabled";
  button.title = enabled ? "Lock the admin session" : "Set an admin passcode in Settings first";
}

function applyAdminAccessState() {
  updateSidebarLockButtonState();
  renderAdminAuthOverlay();
}

function lockPortalSession(message = "") {
  if (!requiresAdminUnlock()) return;
  setAdminSessionUnlocked(false);
  setAdminAuthMessage(message || "Portal locked. Enter your passcode to continue.", message ? "warm" : "warm");
  applyAdminAccessState();
}

function submitAdminUnlock(event) {
  if (event) event.preventDefault();

  const passcodeInput = document.getElementById("admin-unlock-passcode");
  const submitted = String(passcodeInput?.value || "").trim();
  const expected = String(adminAuthSettings.local_passcode || "").trim();

  if (!submitted || submitted !== expected) {
    setAdminAuthMessage("That passcode didn’t match. Try again.", "error");
    applyAdminAccessState();
    return;
  }

  clearAdminAuthMessage();
  setAdminSessionUnlocked(true);
  recordAdminSessionActivity();
  applyAdminAccessState();
  renderCurrentPage();
}

function initializeAdminAccess() {
  if (adminAuthActivityInterval) {
    clearInterval(adminAuthActivityInterval);
  }

  document.addEventListener("click", recordAdminSessionActivity, true);
  document.addEventListener("keydown", recordAdminSessionActivity, true);
  adminAuthActivityInterval = setInterval(() => {
    if (isPortalLocked()) {
      setAdminAuthMessage("Your admin session timed out. Unlock the portal to continue.", "warm");
      applyAdminAccessState();
    }
  }, 30000);

  applyAdminAccessState();
}

let automationSettings = loadAutomationSettings();
let uiPreferences = loadUiPreferences();
let notificationCenterItems = loadNotificationCenterItems();
let settingsActionMessage = "";
let settingsActionTone = "warm";
const ADMIN_AUTH_SETTINGS_STORAGE_KEY = "studioPortal.adminAuthSettings";
const ADMIN_AUTH_SESSION_KEY = "studioPortal.adminSessionUnlocked";
const ADMIN_AUTH_ACTIVITY_KEY = "studioPortal.adminSessionLastActivity";
const DEFAULT_ADMIN_AUTH_SETTINGS = {
  require_unlock: false,
  local_passcode: "",
  session_timeout_minutes: 30
};
let adminAuthMessage = "";
let adminAuthTone = "warm";

function loadAdminAuthSettings() {
  try {
    const raw = localStorage.getItem(ADMIN_AUTH_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ADMIN_AUTH_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_ADMIN_AUTH_SETTINGS,
      ...parsed,
      require_unlock: parsed.require_unlock === true,
      local_passcode: String(parsed.local_passcode || "").trim(),
      session_timeout_minutes: Math.max(5, Number(parsed.session_timeout_minutes || DEFAULT_ADMIN_AUTH_SETTINGS.session_timeout_minutes))
    };
  } catch (error) {
    return { ...DEFAULT_ADMIN_AUTH_SETTINGS };
  }
}

let adminAuthSettings = loadAdminAuthSettings();
let adminAuthActivityInterval = null;


/*********************************
 * BASIC LOOKUP HELPERS
 *********************************/
function getStatusColor(status) {
  if (status === "active") {
    return { bg: "bg-sage/10", text: "text-sage", dot: "bg-sage", label: "Active" };
  }

  if (status === "expiring") {
    return { bg: "bg-gold/10", text: "text-gold", dot: "bg-gold", label: "Expiring" };
  }

  return { bg: "bg-warmgray/10", text: "text-warmgray", dot: "bg-warmgray", label: "Inactive" };
}

function getStudentById(studentId) {
  return students.find((student) => student.id === studentId) || null;
}

function getSchemaStudentById(studentId) {
  return getStudentRecords().find((student) => student.student_id === studentId) || null;
}

function getSchemaLessonById(lessonId) {
  return getLessonRecords().find((lesson) => lesson.lesson_id === lessonId) || null;
}

function getActorProfileByStudentId(studentId) {
  return getActorProfileRecords().find((profile) => profile.student_id === studentId) || null;
}

function getFilesByStudentId(studentId) {
  return getFileRecords().filter((file) => file.student_id === studentId);
}

function getFileById(fileId) {
  return getFileRecords().find((file) => file.file_id === fileId) || null;
}

function getLessonFiles(lessonId) {
  return getFileRecords()
    .filter((file) => file.lesson_id === lessonId && String(file.status || "").toLowerCase() !== "vaulted")
    .sort((a, b) => new Date(b.uploaded_at || 0).getTime() - new Date(a.uploaded_at || 0).getTime());
}

function getNotesByStudentId(studentId) {
  return getNoteRecords()
    .filter((note) => note.student_id === studentId)
    .sort((a, b) => getNoteSortTime(b) - getNoteSortTime(a));
}

function getLessonsByStudentId(studentId) {
  return getLessonRecords()
    .filter((lesson) => lesson.student_id === studentId)
    .sort((a, b) => new Date(b.scheduled_start).getTime() - new Date(a.scheduled_start).getTime());
}

function getLessonNoteByLessonId(lessonId) {
  return getNoteRecords().find((note) => note.lesson_id === lessonId) || null;
}

function getPackageByStudentId(studentId) {
  return getPackageRecords().find((pkg) => pkg.student_id === studentId) || null;
}

/*********************************
 * FORMATTING HELPERS
 *********************************/
function getLessonSourceLabel(source) {
  const normalized = String(source || "").toLowerCase();

  const labels = {
    manual: "Manual",
    google_calendar: "Google Calendar",
    gmail: "Gmail Assist",
    lessonface: "Lessonface",
    lessons_com: "Lessons.com",
    acuity: "Acuity"
  };

  return labels[normalized] || "Manual";
}

function getStudentLeadSourceLabel(source) {
  const normalized = String(source || "").trim().toUpperCase();

  const labels = {
    LESSONS_COM: "Lessons.com",
    LESSONFACE: "Lessonface",
    ACUITY: "Acuity",
    WORD_OF_MOUTH: "Word of Mouth",
    FLYER: "Flyer",
    GOOGLE: "Google",
    DIRECT: "Direct",
    REFERRAL: "Referral",
    OTHER: "Other"
  };

  return labels[normalized] || "Not Tracked";
}

function normalizePhoneForMatch(phone) {
  const digits = String(phone || "").replace(/\D+/g, "");
  if (!digits) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeNameForMatch(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNameMatchVariants(name) {
  const rawName = String(name || "").trim();
  if (!rawName) return [];

  const variants = new Set();
  const pushVariant = (value) => {
    const normalized = normalizeNameForMatch(value);
    if (normalized) variants.add(normalized);
  };

  pushVariant(rawName);
  pushVariant(rawName.replace(/\([^)]*\)/g, " "));

  const parentheticalMatches = Array.from(rawName.matchAll(/\(([^)]*)\)/g));
  parentheticalMatches.forEach((match) => {
    pushVariant(match[1]);
  });

  return Array.from(variants);
}

function getNameTokensForMatch(name) {
  return normalizeNameForMatch(name)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasStrongNameTokenOverlap(sourceName, targetName) {
  const sourceTokens = getNameTokensForMatch(sourceName);
  const targetTokens = getNameTokensForMatch(targetName);

  if (sourceTokens.length < 2 || targetTokens.length < 2) return false;

  const sourceSet = new Set(sourceTokens);
  const targetSet = new Set(targetTokens);
  const overlap = sourceTokens.filter((token) => targetSet.has(token)).length;
  const smallerSize = Math.min(sourceSet.size, targetSet.size);

  return smallerSize >= 2 && overlap >= smallerSize - 0;
}

function parseCsvText(csvText) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((header) => String(header || "").trim());
  return rows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, headerIndex) => {
      record[header] = String(values[headerIndex] || "").trim();
    });
    return record;
  });
}

function extractImportedLeadSource(record) {
  const noteBlob = [record["Notes"], record["Organization Name"], record["Labels"]]
    .filter(Boolean)
    .join("\n");

  if (/lessons\.com/i.test(noteBlob)) return { source: "LESSONS_COM", detail: "Imported from Lessons.com contact" };
  if (/lessonface/i.test(noteBlob)) return { source: "LESSONFACE", detail: "Imported from Lessonface contact" };
  if (/acuity/i.test(noteBlob)) return { source: "ACUITY", detail: "Imported from Acuity contact" };
  if (/google/i.test(noteBlob)) return { source: "GOOGLE", detail: "" };

  return { source: "", detail: "" };
}

function getImportedContactValue(record, keys) {
  for (const key of keys) {
    const value = String(record[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function findPotentialStudentMatches({ full_name, email, phone }) {
  const targetNameVariants = getNameMatchVariants(full_name);
  const targetEmail = String(email || "").trim().toLowerCase();
  const targetPhone = normalizePhoneForMatch(phone);

  return getStudentRecords()
    .map((student) => {
      let score = 0;
      const reasons = [];
      const studentNameVariants = [
        ...getNameMatchVariants(student.full_name || ""),
        ...getNameMatchVariants(student.guardian_name || "")
      ];
      const exactNameMatch = targetNameVariants.some((variant) => studentNameVariants.includes(variant));
      const strongNameOverlap = !exactNameMatch && (
        hasStrongNameTokenOverlap(full_name, student.full_name) ||
        hasStrongNameTokenOverlap(full_name, student.guardian_name || "")
      );
      const studentEmails = [
        String(student.email || "").trim().toLowerCase(),
        ...parseStoredEmailList(student.additional_emails || ""),
        String(student.guardian_email || "").trim().toLowerCase()
      ].filter(Boolean);
      const studentPhones = [
        normalizePhoneForMatch(student.phone),
        normalizePhoneForMatch(student.guardian_phone)
      ].filter(Boolean);
      const emailMatch = targetEmail && studentEmails.includes(targetEmail);
      const phoneMatch = targetPhone && studentPhones.includes(targetPhone);

      if (emailMatch) {
        score += 6;
        reasons.push(student.guardian_email && String(student.guardian_email).trim().toLowerCase() === targetEmail ? "Guardian email match" : "Email match");
      }

      if (phoneMatch) {
        score += 5;
        reasons.push(student.guardian_phone && normalizePhoneForMatch(student.guardian_phone) === targetPhone ? "Guardian phone match" : "Phone match");
      }

      if (exactNameMatch) {
        score += 4;
        reasons.push("Name match");
      } else if (strongNameOverlap) {
        score += 2;
        reasons.push("Close name match");
      }

      if ((exactNameMatch || strongNameOverlap) && emailMatch) {
        score += 3;
        reasons.push("Name + email");
      }

      if ((exactNameMatch || strongNameOverlap) && phoneMatch) {
        score += 3;
        reasons.push("Name + phone");
      }

      return {
        student,
        score,
        reasons,
        exact_name_match: exactNameMatch,
        strong_name_overlap: strongNameOverlap,
        email_match: Boolean(emailMatch),
        phone_match: Boolean(phoneMatch),
        merge_ready: Boolean((exactNameMatch || strongNameOverlap) && (emailMatch || phoneMatch))
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      if (a.merge_ready !== b.merge_ready) return a.merge_ready ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      return a.student.full_name.localeCompare(b.student.full_name);
    });
}

function buildImportedStudentRowsFromCsvRecords(records) {
  return records.map((record, index) => {
    const firstName = getImportedContactValue(record, ["First Name"]);
    const middleName = getImportedContactValue(record, ["Middle Name"]);
    const lastName = getImportedContactValue(record, ["Last Name"]);
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ").trim();
    const primaryEmail = getImportedContactValue(record, ["E-mail 1 - Value"]);
    const secondaryEmail = getImportedContactValue(record, ["E-mail 2 - Value"]);
    const email = primaryEmail || secondaryEmail;
    const additionalEmails = primaryEmail && secondaryEmail && primaryEmail !== secondaryEmail ? secondaryEmail : "";
    const phone = getImportedContactValue(record, ["Phone 1 - Value", "Phone 2 - Value"]);
    const leadSourceInfo = extractImportedLeadSource(record);
    const matches = findPotentialStudentMatches({
      full_name: fullName,
      email,
      phone
    });
    const issues = [];

    if (!fullName) {
      issues.push("Missing full name");
    }

    if (!email && !phone) {
      issues.push("Missing both email and phone");
    }

    const duplicate = matches.length > 0;

    return {
      import_id: `import-row-${index + 1}`,
      source_row_number: index + 2,
      full_name: fullName,
      email,
      additional_emails: additionalEmails,
      phone,
      lead_source: leadSourceInfo.source,
      lead_source_detail: leadSourceInfo.detail,
      focus_area: "",
      studio_status: "INACTIVE",
      billing_model: "PAYG",
      booking_behavior: "SELF_BOOKING",
      raw_record: record,
      issues,
      matches,
      action: issues.length ? "skip" : duplicate ? "review" : "import",
      selected_match_id: matches[0]?.student?.student_id || "",
      duplicate
    };
  });
}

function getImportedStudentSummary(rows = importedStudentRows) {
  return {
    total: rows.length,
    ready: rows.filter((row) => row.action === "import" || row.action === "create_new" || row.action === "update_existing").length,
    review: rows.filter((row) => row.action === "review").length,
    duplicates: rows.filter((row) => row.duplicate).length,
    skipped: rows.filter((row) => row.action === "skip").length,
    issues: rows.filter((row) => row.issues.length > 0).length
  };
}

function closeStudentImportModal() {
  const overlay = document.getElementById("student-import-modal-overlay");
  if (overlay) overlay.remove();
  importedStudentRows = [];
  importedStudentFileName = "";
}

function getImportedStudentActionOptions(row) {
  if (row.issues.length > 0) {
    return [{ value: "skip", label: "Skip Row" }];
  }

  if (row.duplicate) {
    return [
      { value: "review", label: "Needs Review" },
      { value: "update_existing", label: "Match Existing Student" },
      { value: "create_new", label: "Create New Anyway" },
      { value: "skip", label: "Skip Row" }
    ];
  }

  return [
    { value: "import", label: "Import New Student" },
    { value: "skip", label: "Skip Row" }
  ];
}

function getImportedStudentActionLabel(action) {
  const labels = {
    review: "Needs Review",
    import: "Import New Student",
    create_new: "Create New Anyway",
    update_existing: "Match Existing Student",
    skip: "Skip Row"
  };

  return labels[action] || "Needs Review";
}

function setImportedStudentRowAction(importId, nextAction) {
  importedStudentRows = importedStudentRows.map((row) => {
    if (row.import_id !== importId) return row;

    const allowed = getImportedStudentActionOptions(row).map((option) => option.value);
    const action = allowed.includes(nextAction) ? nextAction : row.action;

    return {
      ...row,
      action
    };
  });

  renderStudentImportModalBody();
}

function setImportedStudentRowMatch(importId, studentId) {
  importedStudentRows = importedStudentRows.map((row) => (
    row.import_id === importId
      ? {
          ...row,
          selected_match_id: studentId
        }
      : row
  ));

  renderStudentImportModalBody();
}

function buildImportedStudentCreatePayload(row) {
  return {
    full_name: row.full_name,
    email: row.email,
    additional_emails: row.additional_emails || "",
    phone: row.phone,
    guardian_name: "",
    guardian_email: "",
    guardian_phone: "",
    timezone: "",
    studio_status: row.studio_status || "LEAD",
    billing_model: row.billing_model || "PAYG",
    booking_behavior: row.booking_behavior || "SELF_BOOKING",
    lead_source: row.lead_source || "",
    lead_source_detail: row.lead_source_detail || "",
    focus_area: row.focus_area || "",
    actor_page_eligible: false
  };
}

function buildImportedStudentUpdatePayload(row, existingStudent) {
  const payload = {};

  if (row.email && !existingStudent.email) {
    payload.email = row.email;
  } else if (
    row.email &&
    String(existingStudent.email || "").trim().toLowerCase() !== String(row.email).trim().toLowerCase() &&
    !parseStoredEmailList(existingStudent.additional_emails || "").includes(String(row.email).trim().toLowerCase())
  ) {
    payload.additional_emails = appendEmailToList(existingStudent.additional_emails || "", row.email);
  }
  if (row.phone && !existingStudent.phone) payload.phone = row.phone;
  if (row.lead_source && !existingStudent.lead_source) payload.lead_source = row.lead_source;
  if (row.lead_source_detail && !existingStudent.lead_source_detail) payload.lead_source_detail = row.lead_source_detail;

  return payload;
}

function handleStudentImportFileChange(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;

  importedStudentFileName = file.name;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const records = parseCsvText(String(reader.result || ""));
      if (!records.length) {
        notifyUser({
          title: "Student Import",
          message: "This CSV did not contain any rows to import.",
          tone: "warm",
          source: "students"
        });
        importedStudentRows = [];
        renderStudentImportModalBody();
        return;
      }

      importedStudentRows = buildImportedStudentRowsFromCsvRecords(records);
      renderStudentImportModalBody();
    } catch (error) {
      console.error(error);
      notifyUser({
        title: "Student Import",
        message: "Unable to read that CSV file.",
        tone: "error",
        source: "students"
      });
    }
  };

  reader.readAsText(file);
}

function executeStudentCsvImport() {
  const unresolvedRows = importedStudentRows.filter((row) => row.action === "review");
  if (unresolvedRows.length > 0) {
    notifyUser({
      title: "Student Import",
      message: "Review each flagged duplicate row before importing.",
      tone: "error",
      source: "students"
    });
    return;
  }

  const actionableRows = importedStudentRows.filter((row) => ["import", "create_new", "update_existing"].includes(row.action));
  if (!actionableRows.length) {
    notifyUser({
      title: "Student Import",
      message: "There are no rows ready to import.",
      tone: "warm",
      source: "students"
    });
    return;
  }

  const errors = [];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = importedStudentRows.filter((row) => row.action === "skip").length;

  actionableRows.forEach((row) => {
    if (row.action === "update_existing") {
      const existingStudent = getSchemaStudentById(row.selected_match_id);
      if (!existingStudent) {
        errors.push(`${row.full_name || `Row ${row.source_row_number}`}: no student selected for match.`);
        return;
      }

      const payload = buildImportedStudentUpdatePayload(row, existingStudent);
      if (!Object.keys(payload).length) {
        skippedCount += 1;
        return;
      }

      const result = updateStudent(existingStudent.student_id, payload);
      if (!result || result.ok === false) {
        errors.push(`${row.full_name || existingStudent.full_name}: ${(result?.errors || ["Unable to update existing student."]).join(", ")}`);
        return;
      }

      updatedCount += 1;
      return;
    }

    const result = createStudent(buildImportedStudentCreatePayload(row));
    if (!result || result.ok === false) {
      errors.push(`${row.full_name || `Row ${row.source_row_number}`}: ${(result?.errors || ["Unable to create student."]).join(", ")}`);
      return;
    }

    createdCount += 1;
  });

  if (errors.length > 0) {
    notifyUser({
      title: "Student Import",
      message: errors[0],
      tone: "error",
      source: "students"
    });
    return;
  }

  renderAppFromSchema();
  closeStudentImportModal();
  notifyUser({
    title: "Student Import Complete",
    message: `Created ${createdCount}, matched ${updatedCount}, skipped ${skippedCount}.`,
    tone: "success",
    source: "students"
  });
}

function renderStudentImportModalBody() {
  const container = document.getElementById("student-import-modal-content");
  if (!container) return;

  const summary = getImportedStudentSummary();
  const unresolved = summary.review;

  container.innerHTML = `
    <div class="space-y-5">
      <div class="rounded-2xl border border-cream bg-parchment/70 p-4">
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-warmblack">Import Students from CSV</p>
            <p class="text-xs text-warmgray mt-1">Upload a contacts export, review potential duplicates, and choose exactly how each flagged row should be handled before anything is imported.</p>
            ${importedStudentFileName ? `<p class="text-xs text-warmgray mt-2">Loaded file: <span class="font-medium text-warmblack">${escapeHtml(importedStudentFileName)}</span></p>` : ""}
          </div>
          <label class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack cursor-pointer self-start">
            <i data-lucide="upload" class="w-4 h-4"></i>
            Choose CSV
            <input id="student-import-file-input" type="file" accept=".csv,text/csv" class="hidden" />
          </label>
        </div>
      </div>

      ${
        importedStudentRows.length
          ? `
            <div class="grid grid-cols-2 xl:grid-cols-5 gap-3">
              <div class="rounded-2xl border border-cream bg-white p-3">
                <p class="text-[11px] uppercase tracking-wider text-warmgray">Rows</p>
                <p class="text-lg font-semibold text-warmblack mt-1">${summary.total}</p>
              </div>
              <div class="rounded-2xl border border-cream bg-white p-3">
                <p class="text-[11px] uppercase tracking-wider text-warmgray">Ready</p>
                <p class="text-lg font-semibold text-sage mt-1">${summary.ready}</p>
              </div>
              <div class="rounded-2xl border border-cream bg-white p-3">
                <p class="text-[11px] uppercase tracking-wider text-warmgray">Needs Review</p>
                <p class="text-lg font-semibold text-burgundy mt-1">${summary.review}</p>
              </div>
              <div class="rounded-2xl border border-cream bg-white p-3">
                <p class="text-[11px] uppercase tracking-wider text-warmgray">Possible Duplicates</p>
                <p class="text-lg font-semibold text-warmblack mt-1">${summary.duplicates}</p>
              </div>
              <div class="rounded-2xl border border-cream bg-white p-3">
                <p class="text-[11px] uppercase tracking-wider text-warmgray">Skipped / Invalid</p>
                <p class="text-lg font-semibold text-warmgray mt-1">${summary.skipped}</p>
              </div>
            </div>

            ${
              unresolved
                ? `<div class="rounded-2xl border border-burgundy/20 bg-burgundy/5 p-4">
                    <p class="text-sm font-semibold text-burgundy">Duplicate review is still required</p>
                    <p class="text-xs text-warmgray mt-1">${unresolved} row${unresolved === 1 ? "" : "s"} still need an explicit decision before import can run.</p>
                  </div>`
                : ""
            }

            <div class="rounded-2xl border border-cream bg-white overflow-hidden">
              <div class="overflow-x-auto">
                <table class="min-w-full text-sm">
                  <thead class="bg-parchment/70 text-warmgray">
                    <tr>
                      <th class="text-left px-4 py-3 font-medium">Row</th>
                      <th class="text-left px-4 py-3 font-medium">Student</th>
                      <th class="text-left px-4 py-3 font-medium">Detected Source</th>
                      <th class="text-left px-4 py-3 font-medium">Match Review</th>
                      <th class="text-left px-4 py-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${
                      importedStudentRows.map((row) => {
                        const rowStatusClass = row.issues.length
                          ? "border-l-4 border-burgundy/40"
                          : row.action === "review"
                            ? "border-l-4 border-gold/50"
                            : "border-l-4 border-transparent";
                        return `
                          <tr class="border-t border-cream align-top ${rowStatusClass}">
                            <td class="px-4 py-4 text-xs text-warmgray whitespace-nowrap">#${row.source_row_number}</td>
                            <td class="px-4 py-4 min-w-[240px]">
                              <p class="font-semibold text-warmblack">${escapeHtml(row.full_name || "Unnamed Contact")}</p>
                              <div class="mt-1 space-y-1 text-xs text-warmgray">
                                ${row.email ? `<p>${escapeHtml(row.email)}</p>` : ""}
                                ${row.phone ? `<p>${escapeHtml(row.phone)}</p>` : ""}
                              </div>
                              ${
                                row.issues.length
                                  ? `<div class="mt-2 flex flex-wrap gap-2">${row.issues.map((issue) => `<span class="inline-flex items-center px-2 py-1 rounded-full bg-burgundy/10 text-burgundy text-[11px] font-medium">${escapeHtml(issue)}</span>`).join("")}</div>`
                                  : ""
                              }
                            </td>
                            <td class="px-4 py-4 min-w-[170px]">
                              <p class="text-sm text-warmblack">${escapeHtml(getStudentLeadSourceLabel(row.lead_source))}</p>
                              <p class="text-xs text-warmgray mt-1">${escapeHtml(row.lead_source_detail || "No source detail detected")}</p>
                            </td>
                            <td class="px-4 py-4 min-w-[260px]">
                              ${
                                row.matches.length
                                  ? `
                                    <div class="space-y-2">
                                      ${row.matches.map((candidate) => `
                                        <div class="rounded-xl border border-cream bg-parchment/60 px-3 py-2">
                                          <p class="text-sm font-medium text-warmblack">${escapeHtml(candidate.student.full_name || "Unknown Student")}</p>
                                          <p class="text-xs text-warmgray mt-1">Match score ${candidate.score} · ${escapeHtml(candidate.student.email || "No email on file")}</p>
                                        </div>
                                      `).join("")}
                                      ${
                                        row.action === "update_existing"
                                          ? `
                                            <select
                                              class="w-full rounded-xl border border-cream bg-white px-3 py-2.5 text-sm"
                                              onchange="setImportedStudentRowMatch('${row.import_id}', this.value)"
                                            >
                                              ${row.matches.map((candidate) => `
                                                <option value="${candidate.student.student_id}" ${row.selected_match_id === candidate.student.student_id ? "selected" : ""}>
                                                  ${escapeHtml(candidate.student.full_name)} (${escapeHtml(candidate.student.student_id)})
                                                </option>
                                              `).join("")}
                                            </select>
                                          `
                                          : ""
                                      }
                                    </div>
                                  `
                                  : `<p class="text-xs text-warmgray">No duplicate match detected.</p>`
                              }
                            </td>
                            <td class="px-4 py-4 min-w-[220px]">
                              <select
                                class="w-full rounded-xl border border-cream bg-white px-3 py-2.5 text-sm"
                                onchange="setImportedStudentRowAction('${row.import_id}', this.value)"
                              >
                                ${getImportedStudentActionOptions(row).map((option) => `
                                  <option value="${option.value}" ${row.action === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>
                                `).join("")}
                              </select>
                              <p class="text-xs text-warmgray mt-2">${escapeHtml(getImportedStudentActionLabel(row.action))}</p>
                            </td>
                          </tr>
                        `;
                      }).join("")
                    }
                  </tbody>
                </table>
              </div>
            </div>
          `
          : `
            <div class="rounded-2xl border border-dashed border-cream bg-white p-8 text-center">
              <i data-lucide="file-text" class="w-8 h-8 mx-auto text-warmgray/50"></i>
              <p class="text-sm font-semibold text-warmblack mt-3">No CSV loaded yet</p>
              <p class="text-xs text-warmgray mt-1">Start with a contacts export, then review each detected duplicate before import.</p>
            </div>
          `
      }
    </div>
  `;

  const fileInput = document.getElementById("student-import-file-input");
  if (fileInput) {
    fileInput.onchange = handleStudentImportFileChange;
  }

  const importBtn = document.getElementById("run-student-import-btn");
  if (importBtn) {
    importBtn.disabled = importedStudentRows.length === 0 || unresolved > 0;
    importBtn.classList.toggle("opacity-50", importBtn.disabled);
    importBtn.classList.toggle("cursor-not-allowed", importBtn.disabled);
  }

  lucide.createIcons();
}

function openStudentImportModal() {
  closeStudentImportModal();

  const overlay = document.createElement("div");
  overlay.id = "student-import-modal-overlay";
  overlay.className = "fixed inset-0 z-[80] bg-black/55 flex items-center justify-center p-4";
  overlay.innerHTML = `
    <div class="app-modal-shell bg-white rounded-2xl border border-cream w-full max-w-6xl p-4 sm:p-6 max-h-[92vh] overflow-y-auto">
      <div class="app-modal-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div class="min-w-0">
          <h3 class="font-display text-xl font-bold text-warmblack">Student CSV Import</h3>
          <p class="text-sm text-warmgray mt-1">Import existing contacts, then manually resolve any possible duplicate before it changes your student records.</p>
        </div>
        <button type="button" id="close-student-import-modal" class="self-start text-sm text-warmgray">Close</button>
      </div>

      <div id="student-import-modal-content"></div>

      <div class="app-modal-footer mt-5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
        <p class="text-xs text-warmgray">Duplicate matches stay blocked until you review them.</p>
        <div class="flex flex-col-reverse sm:flex-row gap-2">
          <button type="button" id="cancel-student-import-btn" class="px-4 py-2.5 rounded-xl border border-cream text-sm font-medium text-warmgray bg-white">Cancel</button>
          <button type="button" id="run-student-import-btn" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">Import Reviewed Rows</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = document.getElementById("close-student-import-modal");
  const cancelBtn = document.getElementById("cancel-student-import-btn");
  const importBtn = document.getElementById("run-student-import-btn");

  if (closeBtn) closeBtn.onclick = closeStudentImportModal;
  if (cancelBtn) cancelBtn.onclick = closeStudentImportModal;
  if (importBtn) importBtn.onclick = executeStudentCsvImport;

  renderStudentImportModalBody();
}

function loadCalendarSyncState() {
  try {
    const raw = window.localStorage ? localStorage.getItem(CALENDAR_SYNC_STORAGE_KEY) : "";
    if (!raw) return { ...DEFAULT_CALENDAR_SYNC_STATE };
    return {
      ...DEFAULT_CALENDAR_SYNC_STATE,
      ...JSON.parse(raw)
    };
  } catch (error) {
    console.warn("Unable to load calendar sync state.", error);
    return { ...DEFAULT_CALENDAR_SYNC_STATE };
  }
}

let calendarSyncState = loadCalendarSyncState();

function saveCalendarSyncState() {
  try {
    if (window.localStorage) {
      localStorage.setItem(CALENDAR_SYNC_STORAGE_KEY, JSON.stringify(calendarSyncState));
    }
  } catch (error) {
    console.warn("Unable to save calendar sync state.", error);
  }
}

function setCalendarSyncState(updates = {}) {
  calendarSyncState = {
    ...calendarSyncState,
    ...updates
  };
  saveCalendarSyncState();
  return calendarSyncState;
}

function syncCalendarStateFromBackendSettings() {
  if (typeof studioDataService === "undefined" || !studioDataService?.getBackendSettings) {
    return calendarSyncState;
  }

  const backend = studioDataService.getBackendSettings();
  const hasGoogleAccount = Boolean(String(backend.google_account_email || "").trim());

  calendarSyncState = {
    ...calendarSyncState,
    connected: hasGoogleAccount,
    gmail_connected: hasGoogleAccount,
    selected_calendar_id: "primary",
    selected_calendar_label: "Main Calendar",
    connection_mode: hasGoogleAccount ? "backend-manual" : "local-demo"
  };
  saveCalendarSyncState();
  return calendarSyncState;
}

function getGoogleServiceStatusBadgeClass(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["live_ready", "connected", "success"].includes(normalized)) return "bg-sage/10 text-sage";
  if (normalized === "auth_needed") return "bg-gold/10 text-warmblack";
  if (normalized === "backend_incomplete") return "bg-burgundy/10 text-burgundy";
  if (["demo_ready", "demo-fallback", "manual"].includes(normalized)) return "bg-gold/10 text-warmblack";
  if (["error", "failed"].includes(normalized)) return "bg-burgundy/10 text-burgundy";
  return "bg-warmgray/10 text-warmgray";
}

function getGoogleServiceStatusLabel(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "backend_incomplete") return "Backend Incomplete";
  if (normalized === "auth_needed") return "Auth Needed";
  if (normalized === "live_ready") return "Live Ready";
  if (normalized === "connected") return "Connected";
  if (normalized === "demo_ready") return "Demo Ready";
  if (normalized === "demo-fallback") return "Demo Fallback";
  if (normalized === "success") return "Synced";
  if (normalized === "error") return "Needs Attention";
  if (normalized === "failed") return "Failed";
  return "Not Checked";
}

function getGoogleOAuthStartUrl() {
  const backend = studioDataService.getBackendSettings();
  if (backend.google_auth_start_url) return backend.google_auth_start_url;

  const configuredBackendUrl = String(backend.google_sheets_web_app_url || "").trim();
  if (!configuredBackendUrl) return "/api/google-oauth-start";

  try {
    const url = new URL(configuredBackendUrl, window.location.origin);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/api\/studio-sync$/, "/api/google-oauth-start");
    return url.toString();
  } catch (error) {
    return "/api/google-oauth-start";
  }
}

function startGoogleOAuthFlow() {
  const url = getGoogleOAuthStartUrl();
  window.open(url, "_blank", "noopener,noreferrer");
}

syncCalendarStateFromBackendSettings();

const sampleGoogleCalendarFeed = [
  {
    id: "gcal_evt_20260408_maya_callback",
    calendar_id: "primary",
    title: "Maya Kim: 60min Acting Coaching",
    description: "SERVICE: 60min - Acting\nNAME: Maya Kim\nEMAIL: maya@example.com\nPROVIDER: Darius A. Journigan\nJoin Zoom\nhttps://zoom.us/j/2045550001",
    start: "2026-04-08T18:00:00",
    end: "2026-04-08T19:00:00",
    updated_at: "2026-04-07T12:10:00"
  },
  {
    id: "gcal_evt_20260409_aiden_series",
    calendar_id: "primary",
    title: "Aiden Liu for 60min - Audition Coaching",
    description: "SERVICE: 60min - Audition Coaching\nNAME: Aiden Liu\nEMAIL: aiden@example.com\nJoin Zoom\nhttps://zoom.us/j/2045550002",
    start: "2026-04-09T14:00:00",
    end: "2026-04-09T15:00:00",
    updated_at: "2026-04-07T08:20:00"
  },
  {
    id: "gcal_evt_20260410_sarah_intro",
    calendar_id: "primary",
    title: "Sarah Patterson for 30min - Intro Session",
    description: "SERVICE: 30min - Intro Session\nNAME: Sarah Patterson\nEMAIL: sarah@example.com\nJoin Zoom\nhttps://zoom.us/j/2045550003",
    start: "2026-04-10T11:00:00",
    end: "2026-04-10T11:30:00",
    updated_at: "2026-04-07T07:39:00"
  },
  {
    id: "gcal_evt_20260411_bailen_acuity",
    calendar_id: "primary",
    title: "Bailen Estrada: 90Min Acting Lesson (Coach: Darius)",
    description: "Name: Bailen Estrada\nPhone: (779) 771-0394\nEmail: bailen.estrada22@gmail.com\nPrice: $72.00\nPaid Online: $72.00\nClick to join meeting:\nhttps://app.acuityscheduling.com/schedule.php?owner=35125432\nAcuityID=1683115138",
    start: "2026-04-11T20:00:00",
    end: "2026-04-11T21:30:00",
    updated_at: "2026-04-07T06:45:00"
  },
  {
    id: "gcal_evt_20260412_rosaria_acuity",
    calendar_id: "primary",
    title: "Rosaria Arancio (Sofia) for 30min - Acting",
    description: "Join Zoom\nhttps://us06web.zoom.us/j/2070316865\nSERVICE: 30min - Acting\nPROVIDER: Darius A. Journigan\nNAME: Rosaria Arancio (Sofia)\nEMAIL: roarancio@gmail.com",
    start: "2026-04-12T13:00:00",
    end: "2026-04-12T13:30:00",
    updated_at: "2026-04-07T06:50:00"
  },
  {
    id: "gcal_evt_20260413_kayla_lessonface",
    calendar_id: "primary",
    title: "Acting Lesson with Kayla M. Hollis (Lessonface)",
    description: "This event was created via Gemini from an email.\nLessonface booking confirmation\nStudent Email: kayla.hollis@example.com",
    start: "2026-04-13T17:00:00",
    end: "2026-04-13T18:00:00",
    updated_at: "2026-04-07T07:05:00"
  },
  {
    id: "gcal_evt_20260413_johnathan_lessonface",
    calendar_id: "primary",
    title: "Lessonface Session with Johnathan Stiggons",
    description: "Lessonface Session with Johnathan Stiggons\nStudent Email: johnathan.stiggons@example.com",
    start: "2026-04-13T20:00:00",
    end: "2026-04-13T21:00:00",
    updated_at: "2026-04-07T07:10:00"
  },
  {
    id: "gcal_evt_20260414_busy_block",
    calendar_id: "primary",
    title: "busy",
    description: "Personal block",
    start: "2026-04-14T15:45:00",
    end: "2026-04-14T16:15:00",
    updated_at: "2026-04-07T07:00:00"
  }
];

const sampleGmailLessonFeed = [
  {
    id: "gmail_msg_lessons_dahvey_20260328",
    subject: "Your upcoming booking — Saturday, Mar 28 at 3:00 PM",
    from: "do-not-reply@lessons.com",
    received_at: "2026-03-26T10:10:00",
    body: "Lessons.com\nUnpaid\nUpcoming booking with Dahvey Hicks\nSaturday, March 28, 2026 • Recurring\n3:00 PM-4:00 PM EDT\nActing - Online Lessons - 60 Minutes\nOnline\n$50\nView booking\nView customer"
  },
  {
    id: "gmail_msg_acuity_bailen_20260411",
    subject: "New Appointment: 90min Acting Lesson (Bailen Estrada) on Wednesday, April 8, 2026 8:00pm EDT with Coach Darius",
    from: "no-reply@acuityscheduling.com",
    reply_to: "Bailen Estrada <bailen.estrada22@gmail.com>",
    received_at: "2026-04-07T06:46:00",
    body: "Scheduled by coach@d-a-j.com via Mobile App\nBelow is your copy of the client's confirmation email.\nAppointment Scheduled\nfor Bailen Estrada\nWhat 90min Acting Lesson (Coach Darius)\nWhen Wednesday, April 8, 2026 8:00pm (1 hour 30 minutes)\nWhere Click to join meeting:\nhttps://app.acuityscheduling.com/schedule.php?owner=35125432&action=zoom&uniqueID=779cadbeddf9db6a1a3b452550fc52c1&ownerID=35125432\nThank you, your appointment has been successfully scheduled."
  },
  {
    id: "gmail_msg_acuity_rosaria_20260412",
    subject: "Rosaria Arancio (Sofia) for 30min - Acting",
    from: "notifications@acuityscheduling.com",
    received_at: "2026-04-07T06:51:00",
    body: "Thursday, April 9 · 1:00 - 1:30pm\nJoin Zoom\nhttps://us06web.zoom.us/j/2070316865\nSERVICE: 30min - Acting\nPROVIDER: Darius A. Journigan\nNAME: Rosaria Arancio (Sofia)\nEMAIL: roarancio@gmail.com"
  },
  {
    id: "gmail_msg_lessonface_kayla_20260413",
    subject: "New Booking on Lessonface - Student: Kayla M. Hollis",
    from: "support@lessonface.com",
    received_at: "2026-04-07T07:06:00",
    body: "New Booking on Lessonface\nHi Darius,\nYou have a new booking on Lessonface.\nBooking Details\nDate and Time: Saturday, April 11th, 2026 - 5:00pm EDT\nStudent: Kayla M. Hollis\nInstrument: Acting\nDuration: 60 minutes\nSend the student a message and review your booking schedule from your dashboard."
  },
  {
    id: "gmail_msg_lessonface_johnathan_20260413",
    subject: "Lessonface Session with Johnathan Stiggons",
    from: "bookings@lessonface.com",
    received_at: "2026-04-07T07:11:00",
    body: "Saturday, March 21 · 8:00 - 9:00pm\nLessonface Session with Johnathan Stiggons\nStudent Email: johnathan.stiggons@example.com"
  },
  {
    id: "gmail_msg_misc_newsletter",
    subject: "Your weekly creator digest",
    from: "updates@example.com",
    received_at: "2026-04-07T08:30:00",
    body: "Not a lesson email."
  }
];

function getCalendarSyncWindow() {
  const now = getReferenceNow();
  return {
    start: startOfLocalDay(addDaysToDate(now, -1 * Number(calendarSyncState.sync_window_past_days || 30))),
    end: endOfLocalDay(addDaysToDate(now, Number(calendarSyncState.sync_window_future_days || 60)))
  };
}

function extractFirstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : "";
}

function sanitizeImportedContactText(value) {
  const htmlNormalized = String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/p>/gi, "\n");

  return String(stripHtmlForPreview(htmlNormalized) || htmlNormalized)
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractEmailsFromText(value) {
  return Array.from(new Set(
    sanitizeImportedContactText(value)
      .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []
  )).map((entry) => entry.toLowerCase());
}

function extractPhonesFromText(value) {
  return Array.from(new Set(
    (sanitizeImportedContactText(value).match(/(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/g) || [])
      .map((entry) => entry.trim())
      .filter(Boolean)
  ));
}

function cleanImportedContactName(value) {
  return sanitizeImportedContactText(value)
    .replace(/\bEMAIL\b\s*:\s*[^\n\r]+/gi, "")
    .replace(/\bPHONE\b\s*:\s*[^\n\r]+/gi, "")
    .replace(/\bPAID ONLINE\b\s*:\s*[^\n\r]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEmailListForStorage(value) {
  return Array.from(new Set(
    String(value || "")
      .split(/[,\n;]/)
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean)
  )).join(", ");
}

function parseStoredEmailList(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);
}

function appendEmailToList(existing, nextEmail) {
  return normalizeEmailListForStorage([
    ...parseStoredEmailList(existing),
    String(nextEmail || "").trim().toLowerCase()
  ].filter(Boolean).join(", "));
}

function parseImportedContactIdentity(rawName) {
  const cleanedName = cleanImportedContactName(rawName);
  const parentheticalMatch = cleanedName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);

  if (!parentheticalMatch) {
    return {
      student_full_name: cleanedName || "Imported Student",
      guardian_name: "",
      display_name: cleanedName || "Imported Student"
    };
  }

  const outsideName = String(parentheticalMatch[1] || "").trim();
  const insideName = String(parentheticalMatch[2] || "").trim();
  const outsideTokens = outsideName.split(/\s+/).filter(Boolean);
  const insideTokens = insideName.split(/\s+/).filter(Boolean);

  if (outsideTokens.length >= 2 && insideTokens.length >= 1 && insideTokens.length <= 3) {
    const inferredStudentName = insideTokens.length === 1
      ? `${insideTokens[0]} ${outsideTokens[outsideTokens.length - 1]}`
      : insideName;

    return {
      student_full_name: inferredStudentName.trim(),
      guardian_name: outsideName,
      display_name: `${inferredStudentName.trim()} (guardian: ${outsideName})`
    };
  }

  return {
    student_full_name: cleanedName || "Imported Student",
    guardian_name: "",
    display_name: cleanedName || "Imported Student"
  };
}

function getImportedLessonContactInfo(lesson) {
  const rawName = cleanImportedContactName(lesson?.external_contact_name || "");
  const identity = parseImportedContactIdentity(rawName);
  const importedEmail = extractEmailsFromText(`${lesson?.external_contact_email || ""}\n${lesson?.external_contact_name || ""}`)[0] || "";
  const importedPhone = extractPhonesFromText(`${lesson?.external_contact_phone || ""}\n${lesson?.external_contact_name || ""}`)[0] || "";

  return {
    raw_name: rawName,
    student_full_name: identity.student_full_name,
    guardian_name: identity.guardian_name,
    display_name: identity.display_name,
    email: importedEmail,
    phone: importedPhone
  };
}

function extractNamedValue(text, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sanitizeImportedContactText(text).match(new RegExp(`${escapedLabel}\\s*[:=]\\s*([^\\n\\r]+)`, "i"));
  return match ? String(match[1] || "").trim() : "";
}

function inferCalendarPlatformHint(event) {
  const blob = `${event.title || ""}\n${event.description || ""}`;
  if (/lessonface/i.test(blob)) return "LESSONFACE";
  if (/acuity/i.test(blob)) return "ACUITY";
  if (/lessons\.com/i.test(blob)) return "LESSONS_COM";
  return "GOOGLE";
}

function inferGmailPlatformHint(message) {
  const blob = `${message.subject || ""}\n${message.body || ""}\n${message.from || ""}`;
  if (/lessonface/i.test(blob)) return "LESSONFACE";
  if (/acuity/i.test(blob)) return "ACUITY";
  if (/lessons\.com/i.test(blob)) return "LESSONS_COM";
  return "GOOGLE";
}

function inferLessonTypeFromCalendarEvent(event) {
  const blob = `${event.title || ""}\n${event.description || ""}`;
  const service = extractNamedValue(blob, "SERVICE");
  const candidate = service || event.title || "";
  const normalized = candidate.toLowerCase();

  if (normalized.includes("intro")) return "Intro Session";
  if (normalized.includes("public speaking")) return "Public Speaking";
  if (normalized.includes("role")) return "Role Coaching";
  if (normalized.includes("audition")) return "Audition Coaching";
  return "Acting Coaching";
}

function inferLessonTopicFromCalendarEvent(event) {
  const title = String(event.title || "").trim();
  if (!title) return "Imported Google Calendar Lesson";
  return title;
}

function inferLessonTopicFromGmailMessage(message) {
  const subject = String(message.subject || "").trim();
  if (!subject) return "Imported Gmail Lesson";
  if (/upcoming booking/i.test(subject)) {
    const name = inferExternalContactNameFromGmail(message);
    return name ? `Upcoming booking with ${name}` : "Upcoming booking";
  }
  return subject;
}

function inferExternalContactName(event) {
  const blob = sanitizeImportedContactText(`${event.title || ""}\n${event.description || ""}`);
  const explicitName =
    extractNamedValue(blob, "NAME") ||
    extractNamedValue(blob, "Name") ||
    extractNamedValue(blob, "Student Name");

  if (explicitName) return cleanImportedContactName(explicitName);

  const title = String(event.title || "");
  let match = title.match(/^(.+?)\s*:\s*\d+\s*min/i);
  if (match) return cleanImportedContactName(match[1] || "");
  match = title.match(/^(.+?)\s+for\s+\d+\s*min/i);
  if (match) return cleanImportedContactName(match[1] || "");
  match = title.match(/with\s+(.+?)(?:\s+\(|$)/i);
  if (match) return cleanImportedContactName(match[1] || "");

  return "";
}

function inferExternalContactNameFromGmail(message) {
  const blob = sanitizeImportedContactText(`${message.subject || ""}\n${message.body || ""}`);
  const explicitName =
    extractNamedValue(blob, "Student") ||
    extractNamedValue(blob, "NAME") ||
    extractNamedValue(blob, "Name") ||
    extractNamedValue(blob, "Student Name");

  if (explicitName) return cleanImportedContactName(explicitName);

  const subject = String(message.subject || "");
  let match = subject.match(/Student:\s*([^\n\r]+)/i);
  if (match) return cleanImportedContactName(match[1] || "");
  match = subject.match(/New Appointment:\s*.+?\(([^)]+)\)\s+on/i);
  if (match) return cleanImportedContactName(match[1] || "");
  match = subject.match(/^(.+?)\s*:\s*\d+\s*min/i);
  if (match) return cleanImportedContactName(match[1] || "");
  match = subject.match(/^(.+?)\s+for\s+\d+\s*min/i);
  if (match) return cleanImportedContactName(match[1] || "");
  match = subject.match(/with\s+(.+?)(?:\s+\(|$)/i);
  if (match) return cleanImportedContactName(match[1] || "");
  match = blob.match(/upcoming booking with\s+([^\n\r]+)/i);
  if (match) return cleanImportedContactName(match[1] || "");
  match = blob.match(/\bfor\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.() -]+)+)\b/i);
  if (match) return cleanImportedContactName(match[1] || "");

  return "";
}

function inferExternalContactEmail(event) {
  const blob = sanitizeImportedContactText(`${event.title || ""}\n${event.description || ""}`);
  return (
    extractNamedValue(blob, "EMAIL") ||
    extractNamedValue(blob, "Email") ||
    extractNamedValue(blob, "Student Email") ||
    extractEmailsFromText(blob)[0] ||
    ""
  );
}

function inferExternalContactPhone(event) {
  const blob = sanitizeImportedContactText(`${event.title || ""}\n${event.description || ""}`);
  return extractNamedValue(blob, "PHONE") || extractNamedValue(blob, "Phone") || extractPhonesFromText(blob)[0] || "";
}

function inferExternalContactEmailFromGmail(message) {
  const replyTo = String(message.reply_to || "");
  const blob = sanitizeImportedContactText(`${message.subject || ""}\n${message.body || ""}\n${replyTo}`);
  return (
    extractEmailsFromText(replyTo)[0] ||
    extractNamedValue(blob, "EMAIL") ||
    extractNamedValue(blob, "Email") ||
    extractNamedValue(blob, "Student Email") ||
    extractEmailsFromText(blob)[0] ||
    ""
  );
}

function inferExternalContactPhoneFromGmail(message) {
  const blob = sanitizeImportedContactText(`${message.subject || ""}\n${message.body || ""}`);
  return extractNamedValue(blob, "PHONE") || extractNamedValue(blob, "Phone") || extractPhonesFromText(blob)[0] || "";
}

function isLikelyLessonCalendarEvent(event) {
  const blob = `${event.title || ""}\n${event.description || ""}`.toLowerCase();
  const exclusionPatterns = [/^busy\b/i, /\bto do\b/i, /\bpop up\b/i, /\bbackstage\b/i, /\bpersonal\b/i];
  if (exclusionPatterns.some((pattern) => pattern.test(blob))) return false;

  const includePatterns = [
    /\blesson\b/i,
    /\bacting\b/i,
    /\baudition\b/i,
    /\bcoaching\b/i,
    /\bintro session\b/i,
    /\blessonface\b/i,
    /\bacuity\b/i,
    /\bpublic speaking\b/i,
    /\bservice:\b/i
  ];

  return includePatterns.some((pattern) => pattern.test(blob));
}

function isLikelyLessonGmailMessage(message) {
  const blob = `${message.subject || ""}\n${message.body || ""}\n${message.from || ""}`.toLowerCase();
  const includePatterns = [
    /\blesson\b/i,
    /\bacting\b/i,
    /\baudition\b/i,
    /\bcoaching\b/i,
    /\blessonface\b/i,
    /\bacuity\b/i,
    /\bservice:\b/i,
    /\bjoin zoom\b/i,
    /\bpaid online\b/i,
    /\bupcoming booking\b/i,
    /\bview booking\b/i,
    /\blessons\.com\b/i
  ];

  return includePatterns.some((pattern) => pattern.test(blob));
}

function inferLessonTypeFromGmailMessage(message) {
  const blob = `${message.subject || ""}\n${message.body || ""}`;
  const lessonsComServiceLineMatch = blob.match(/([^\n\r]+?)\s*-\s*(?:Online Lessons|Online|In-?Person)\s*-\s*\d+\s*Minutes/i);
  const service =
    extractNamedValue(blob, "SERVICE") ||
    extractNamedValue(blob, "Instrument") ||
    extractNamedValue(blob, "What") ||
    (lessonsComServiceLineMatch ? lessonsComServiceLineMatch[1] : "");
  const lessonsLineMatch = blob.match(/\n([^\n\r]*-\s*(?:\d+)\s*Minutes)\b/i);
  const candidate = service || (lessonsLineMatch ? lessonsLineMatch[1] : "") || message.subject || "";
  const normalized = candidate.toLowerCase();

  if (normalized.includes("intro")) return "Intro Session";
  if (normalized.includes("public speaking")) return "Public Speaking";
  if (normalized.includes("role")) return "Role Coaching";
  if (normalized.includes("audition")) return "Audition Coaching";
  return "Acting Coaching";
}

function inferLocationTypeFromGmailMessage(message, joinLink) {
  if (joinLink) return "VIRTUAL";

  const blob = `${message.subject || ""}\n${message.body || ""}`;
  if (/\bonline\b|\bzoom\b|\bvirtual\b|\bjoin meeting\b/i.test(blob)) return "VIRTUAL";
  if (/\bin[- ]person\b|\bstudio\b|\baddress\b|\bin person\b/i.test(blob)) return "IN_PERSON";

  return "IN_PERSON";
}

function parseDurationMinutesFromEmailText(rawText) {
  const text = String(rawText || "");
  if (!text) return 0;

  let match = text.match(/Duration\s*:\s*(\d+)\s*minutes?/i);
  if (match) return Number(match[1] || 0);

  match = text.match(/\((\d+)\s*hour(?:s)?(?:\s+(\d+)\s*minutes?)?\)/i);
  if (match) {
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    return (hours * 60) + minutes;
  }

  match = text.match(/\((\d+)\s*minutes?\)/i);
  if (match) return Number(match[1] || 0);

  match = text.match(/\b(\d+)\s*min(?:ute)?s?\b/i);
  if (match) return Number(match[1] || 0);

  return 0;
}

function parseDateTimeFromEmailText(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;

  const durationMinutes = parseDurationMinutesFromEmailText(text);
  const year = getReferenceNow().getFullYear();
  const normalized = text
    .replace(/·/g, " ")
    .replace(/(\d)(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const dateTimePattern = "([A-Za-z]+,\\s+[A-Za-z]+\\s+\\d{1,2}(?:,\\s+\\d{4})?)";
  const timePattern = "(\\d{1,2}:\\d{2}\\s*(?:am|pm))";

  let match = normalized.match(new RegExp(`${dateTimePattern}.*?${timePattern}\\s*-\\s*${timePattern}`, "i"));
  if (match) {
    const datePart = /,\s+\d{4}/.test(match[1]) ? match[1] : `${match[1]}, ${year}`;
    const start = new Date(`${datePart} ${match[2]}`);
    const end = new Date(`${datePart} ${match[3]}`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return {
        start: start.toISOString(),
        end: end.toISOString()
      };
    }
  }

  match = normalized.match(new RegExp(`Date and Time\\s*:\\s*${dateTimePattern}\\s*-\\s*${timePattern}`, "i"));
  if (match) {
    const datePart = /,\s+\d{4}/.test(match[1]) ? match[1] : `${match[1]}, ${year}`;
    const start = new Date(`${datePart} ${match[2]}`);
    if (!Number.isNaN(start.getTime())) {
      return {
        start: start.toISOString(),
        end: durationMinutes ? addMinutesToIso(start.toISOString(), durationMinutes) : ""
      };
    }
  }

  match = normalized.match(new RegExp(`When\\s+${dateTimePattern}\\s+${timePattern}`, "i"));
  if (match) {
    const datePart = /,\s+\d{4}/.test(match[1]) ? match[1] : `${match[1]}, ${year}`;
    const start = new Date(`${datePart} ${match[2]}`);
    if (!Number.isNaN(start.getTime())) {
      return {
        start: start.toISOString(),
        end: durationMinutes ? addMinutesToIso(start.toISOString(), durationMinutes) : ""
      };
    }
  }

  return null;
}

function buildImportedLessonFromCalendarEvent(event) {
  const platformHint = inferCalendarPlatformHint(event);
  const externalContactName = inferExternalContactName(event);
  const externalContactEmail = inferExternalContactEmail(event);
  const externalContactPhone = inferExternalContactPhone(event);
  const contactIdentity = parseImportedContactIdentity(externalContactName);
  const matchCandidates = findPotentialStudentMatches({
    full_name: contactIdentity.student_full_name,
    email: externalContactEmail,
    phone: externalContactPhone
  });

  const highConfidenceMatch = matchCandidates.find((candidate) => candidate.score >= 3) || null;
  const matchedStudent = highConfidenceMatch ? highConfidenceMatch.student : null;
  const joinLink = extractFirstUrl(event.description || "");
  const hasJoinLink = Boolean(joinLink);

  return {
    student_id: matchedStudent?.student_id || "",
    scheduled_start: event.start,
    scheduled_end: event.end,
    lesson_status: "SCHEDULED",
    lesson_type: inferLessonTypeFromCalendarEvent(event),
    manual_payment_status: "",
    location_type: hasJoinLink ? "VIRTUAL" : "IN_PERSON",
    location_address: hasJoinLink ? "" : (event.location || "Imported location details pending"),
    topic: inferLessonTopicFromCalendarEvent(event),
    join_link: joinLink,
    actual_completion_date: "",
    cancellation_type: "",
    source: "google_calendar",
    external_event_id: event.id,
    source_calendar_id: event.calendar_id || "primary",
    external_platform_hint: platformHint,
    external_event_title: event.title || "",
    external_contact_name: externalContactName,
    external_contact_email: externalContactEmail,
    external_contact_phone: externalContactPhone,
    sync_state: "SYNCED",
    intake_review_state: matchedStudent ? "UNREVIEWED" : "NEEDS_ATTENTION",
    imported_at: "",
    last_synced_at: "",
    external_updated_at: event.updated_at || "",
    intake_conflict_note: matchedStudent
      ? "Verify this imported calendar event is matched to the correct student before relying on it."
      : "No student match found from this calendar event. Match an existing student or create a new student from intake.",
    pending_external_start: "",
    pending_external_end: "",
    match_candidates: matchCandidates
  };
}

function buildImportedLessonFromGmailMessage(message) {
  const platformHint = inferGmailPlatformHint(message);
  const externalContactName = inferExternalContactNameFromGmail(message);
  const externalContactEmail = inferExternalContactEmailFromGmail(message);
  const externalContactPhone = inferExternalContactPhoneFromGmail(message);
  const contactIdentity = parseImportedContactIdentity(externalContactName);
  const matchCandidates = findPotentialStudentMatches({
    full_name: contactIdentity.student_full_name,
    email: externalContactEmail,
    phone: externalContactPhone
  });
  const highConfidenceMatch = matchCandidates.find((candidate) => candidate.score >= 3) || null;
  const matchedStudent = highConfidenceMatch ? highConfidenceMatch.student : null;
  const timeRange = parseDateTimeFromEmailText(message.body || "");
  const joinLink = extractFirstUrl(message.body || "");
  const hasJoinLink = Boolean(joinLink);
  const hasTimeRange = Boolean(timeRange?.start);
  const hasResolvedEnd = Boolean(timeRange?.end);
  const locationType = inferLocationTypeFromGmailMessage(message, joinLink);

  return {
    student_id: matchedStudent?.student_id || "",
    scheduled_start: hasTimeRange ? timeRange.start : "",
    scheduled_end: hasResolvedEnd ? timeRange.end : "",
    lesson_status: "SCHEDULED",
    lesson_type: inferLessonTypeFromGmailMessage(message),
    manual_payment_status: "",
    location_type: locationType,
    location_address: locationType === "VIRTUAL" ? "" : "Email-derived location pending review",
    topic: inferLessonTopicFromGmailMessage(message),
    join_link: joinLink,
    actual_completion_date: "",
    cancellation_type: "",
    source: "gmail",
    external_event_id: message.id,
    source_calendar_id: "",
    external_platform_hint: platformHint,
    external_event_title: message.subject || "",
    external_contact_name: externalContactName,
    external_contact_email: externalContactEmail,
    external_contact_phone: externalContactPhone,
    sync_state: "SYNCED",
    intake_review_state: matchedStudent ? "UNREVIEWED" : "NEEDS_ATTENTION",
    imported_at: "",
    last_synced_at: "",
    external_updated_at: message.received_at || "",
    intake_conflict_note: !hasTimeRange
      ? "Lesson-like email found, but the session time needs manual review."
      : !hasResolvedEnd
        ? "Lesson start time was extracted from email, but the duration needs review before relying on the end time."
      : matchedStudent
        ? "Imported from Gmail. Cross-check this booking against calendar intake before confirming it."
        : "No student match found from this lesson email. Match an existing student or create a new student from intake.",
    pending_external_start: "",
    pending_external_end: "",
    match_candidates: matchCandidates
  };
}

function getImportedLessonPlatformLabel(platformHint) {
  if (!platformHint) return "Unknown Platform";
  return getStudentLeadSourceLabel(platformHint);
}

function getLeadSourceFromImportedLesson(lesson) {
  const platformHint = String(lesson?.external_platform_hint || "").trim().toUpperCase();
  if (["LESSONS_COM", "LESSONFACE", "ACUITY", "WORD_OF_MOUTH", "FLYER", "GOOGLE", "DIRECT", "REFERRAL", "OTHER"].includes(platformHint)) {
    return platformHint;
  }
  return "GOOGLE";
}

function findLessonByExternalEventId(externalEventId) {
  return getLessonRecords().find((lesson) => String(lesson.external_event_id || "") === String(externalEventId || "")) || null;
}

function normalizeIntakeComparableValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getImportedCandidateContactInfo(candidate) {
  const parsed = parseImportedContactIdentity(candidate?.external_contact_name || "");
  return {
    student_full_name: normalizeIntakeComparableValue(parsed.student_full_name),
    guardian_name: normalizeIntakeComparableValue(parsed.guardian_name),
    email: normalizeIntakeComparableValue(candidate?.external_contact_email || ""),
    phone: normalizeIntakeComparableValue(candidate?.external_contact_phone || ""),
    join_link: normalizeIntakeComparableValue(candidate?.join_link || ""),
    lesson_type: normalizeIntakeComparableValue(candidate?.lesson_type || ""),
    topic: normalizeIntakeComparableValue(candidate?.topic || ""),
    source: normalizeIntakeComparableValue(candidate?.source || ""),
    external_event_id: normalizeIntakeComparableValue(candidate?.external_event_id || "")
  };
}

function getExistingLessonContactInfoForIntake(lesson) {
  const importedContact = getImportedLessonContactInfo(lesson);
  const student = lesson?.student_id ? getSchemaStudentById(lesson.student_id) : null;
  const studentEmails = parseStoredEmailList(student?.additional_emails || "");

  return {
    student_full_name: normalizeIntakeComparableValue(importedContact.student_full_name || student?.full_name || ""),
    guardian_name: normalizeIntakeComparableValue(importedContact.guardian_name || student?.guardian_name || ""),
    email_values: Array.from(new Set([
      normalizeIntakeComparableValue(importedContact.email || ""),
      normalizeIntakeComparableValue(student?.email || ""),
      normalizeIntakeComparableValue(student?.guardian_email || ""),
      ...studentEmails.map((entry) => normalizeIntakeComparableValue(entry))
    ].filter(Boolean))),
    phone_values: Array.from(new Set([
      normalizeIntakeComparableValue(importedContact.phone || ""),
      normalizeIntakeComparableValue(student?.phone || ""),
      normalizeIntakeComparableValue(student?.guardian_phone || "")
    ].filter(Boolean))),
    join_link: normalizeIntakeComparableValue(lesson?.join_link || ""),
    lesson_type: normalizeIntakeComparableValue(lesson?.lesson_type || ""),
    topic: normalizeIntakeComparableValue(lesson?.topic || ""),
    source: normalizeIntakeComparableValue(lesson?.source || ""),
    external_event_id: normalizeIntakeComparableValue(lesson?.external_event_id || "")
  };
}

function getLessonTimeDistanceMinutes(startA, startB) {
  const dateA = startA ? new Date(startA) : null;
  const dateB = startB ? new Date(startB) : null;
  if (!dateA || !dateB || Number.isNaN(dateA.getTime()) || Number.isNaN(dateB.getTime())) return Number.POSITIVE_INFINITY;
  return Math.abs(dateA.getTime() - dateB.getTime()) / (60 * 1000);
}

function compareImportedCandidateToExistingLesson(candidate, lesson) {
  const candidateInfo = getImportedCandidateContactInfo(candidate);
  const lessonInfo = getExistingLessonContactInfoForIntake(lesson);
  const reasons = [];
  let score = 0;

  const timeDistanceMinutes = getLessonTimeDistanceMinutes(candidate?.scheduled_start, lesson?.scheduled_start);
  const candidateDurationMinutes = getLessonDurationMinutes(candidate?.scheduled_start, candidate?.scheduled_end);
  const lessonDurationMinutes = getLessonDurationMinutes(lesson?.scheduled_start, lesson?.scheduled_end);
  const sameExternalRecord = Boolean(candidateInfo.external_event_id && candidateInfo.external_event_id === lessonInfo.external_event_id);
  const sameStudent = Boolean(candidate?.student_id && lesson?.student_id && candidate.student_id === lesson.student_id);
  const sameEmail = Boolean(candidateInfo.email && lessonInfo.email_values.includes(candidateInfo.email));
  const samePhone = Boolean(candidateInfo.phone && lessonInfo.phone_values.includes(candidateInfo.phone));
  const sameName = Boolean(
    candidateInfo.student_full_name &&
    (candidateInfo.student_full_name === lessonInfo.student_full_name || candidateInfo.student_full_name === lessonInfo.guardian_name)
  );
  const sameJoinLink = Boolean(candidateInfo.join_link && candidateInfo.join_link === lessonInfo.join_link);
  const sameLessonType = Boolean(candidateInfo.lesson_type && candidateInfo.lesson_type === lessonInfo.lesson_type);
  const sameTopic = Boolean(candidateInfo.topic && candidateInfo.topic === lessonInfo.topic);
  const sameDay = timeDistanceMinutes <= (24 * 60);

  if (sameExternalRecord) {
    score += 100;
    reasons.push("same external record");
  }

  if (sameStudent) {
    score += 6;
    reasons.push("same student");
  }

  if (sameEmail) {
    score += 5;
    reasons.push("same email");
  }

  if (samePhone) {
    score += 4;
    reasons.push("same phone");
  }

  if (sameName) {
    score += 3;
    reasons.push("same name");
  }

  if (timeDistanceMinutes <= 10) {
    score += 5;
    reasons.push("same start time");
  } else if (timeDistanceMinutes <= 30) {
    score += 3;
    reasons.push("nearby start time");
  } else if (timeDistanceMinutes <= 120) {
    score += 1;
    reasons.push("same session window");
  }

  if (candidateDurationMinutes && lessonDurationMinutes && Math.abs(candidateDurationMinutes - lessonDurationMinutes) <= 5) {
    score += 2;
    reasons.push("same duration");
  }

  if (sameJoinLink) {
    score += 2;
    reasons.push("same meeting link");
  }

  if (sameLessonType) {
    score += 1;
    reasons.push("same lesson type");
  }

  if (sameTopic) {
    score += 1;
    reasons.push("same topic");
  }

  if (sameDay && candidateInfo.source && lessonInfo.source && candidateInfo.source !== lessonInfo.source) {
    score += 1;
    reasons.push("cross-source confirmation");
  }

  let relation = "unrelated";
  if (sameExternalRecord) {
    relation = "exact";
  } else if (score >= 10) {
    relation = "likely_duplicate";
  } else if (score >= 6) {
    relation = "possible_duplicate";
  }

  let confidence = "low";
  if (relation === "exact" || score >= 12) {
    confidence = "high";
  } else if (score >= 7) {
    confidence = "medium";
  }

  return {
    lesson,
    score,
    confidence,
    relation,
    time_distance_minutes: timeDistanceMinutes,
    reasons: Array.from(new Set(reasons))
  };
}

function findPotentialExistingLessonFromImportedCandidate(candidate, options = {}) {
  const ignoreLessonId = String(options.ignoreLessonId || "").trim();
  const comparisons = getLessonRecords()
    .filter((lesson) => lesson.lesson_id !== ignoreLessonId)
    .map((lesson) => compareImportedCandidateToExistingLesson(candidate, lesson))
    .filter((comparison) => comparison.relation !== "unrelated")
    .sort((left, right) => right.score - left.score);

  return comparisons[0] || null;
}

function getChangedCalendarFields(existingLesson, candidate) {
  const changedFields = [];
  if (existingLesson.scheduled_start !== candidate.scheduled_start) changedFields.push("start time");
  if (existingLesson.scheduled_end !== candidate.scheduled_end) changedFields.push("end time");
  if (String(existingLesson.join_link || "") !== String(candidate.join_link || "")) changedFields.push("meeting link");
  if (String(existingLesson.topic || "") !== String(candidate.topic || "")) changedFields.push("title");
  if (String(existingLesson.lesson_type || "") !== String(candidate.lesson_type || "")) changedFields.push("lesson type");
  if (String(existingLesson.location_type || "") !== String(candidate.location_type || "")) changedFields.push("location type");
  if (String(existingLesson.location_address || "") !== String(candidate.location_address || "")) changedFields.push("location details");
  if (String(existingLesson.external_contact_name || "") !== String(candidate.external_contact_name || "")) changedFields.push("contact name");
  if (String(existingLesson.external_contact_email || "") !== String(candidate.external_contact_email || "")) changedFields.push("contact email");
  if (String(existingLesson.external_contact_phone || "") !== String(candidate.external_contact_phone || "")) changedFields.push("contact phone");
  return changedFields;
}

function getImportedLessonReviewGuidance(lesson) {
  const reviewState = normalizeLessonIntakeReviewStateValue(lesson?.intake_review_state, lesson?.source);
  const syncState = normalizeLessonSyncStateValue(lesson?.sync_state, lesson?.source);
  const candidateContact = getImportedLessonContactInfo(lesson);
  const matchCandidates = findPotentialStudentMatches({
    full_name: candidateContact.student_full_name,
    email: candidateContact.email,
    phone: candidateContact.phone
  });
  const highConfidenceMatches = matchCandidates.filter((candidate) => candidate.score >= 3);
  const selectedStudent = lesson?.student_id ? getSchemaStudentById(lesson.student_id) : null;
  const mergePatch = selectedStudent ? getImportedLessonStudentMergePatch(lesson, selectedStudent) : {};
  const reasons = [];
  let priority = "low";
  let recommendedAction = "confirm";
  let blocking = false;
  const crossSourceMatch = findPotentialExistingLessonFromImportedCandidate(lesson, {
    ignoreLessonId: lesson?.lesson_id || ""
  });

  if (!lesson?.student_id) {
    blocking = true;
    priority = "high";
    if (highConfidenceMatches.length > 1) {
      reasons.push(`Multiple possible students (${highConfidenceMatches.length})`);
      recommendedAction = "match_student";
    } else if (highConfidenceMatches.length === 1) {
      reasons.push(`Likely student match found: ${highConfidenceMatches[0].student.full_name}`);
      recommendedAction = "match_student";
    } else {
      reasons.push("No student linked yet");
      recommendedAction = "create_student";
    }
  }

  if (!lesson?.scheduled_start) {
    blocking = true;
    priority = "high";
    reasons.push("Lesson time is missing");
    recommendedAction = "review";
  }

  if (!lesson?.scheduled_end) {
    blocking = true;
    priority = "high";
    reasons.push("End time still needs review");
    recommendedAction = "review";
  }

  if (lesson?.pending_external_start || lesson?.pending_external_end) {
    blocking = true;
    priority = "high";
    reasons.push("External source changed the lesson timing");
    recommendedAction = "review_change";
  }

  if (syncState === "UPDATED_EXTERNALLY" || syncState === "NEEDS_REVIEW") {
    priority = priority === "high" ? "high" : "medium";
    reasons.push("Sync needs manual verification");
    if (!blocking) recommendedAction = "review";
  }

  if (lesson?.source === "gmail" && crossSourceMatch?.lesson?.source && crossSourceMatch.lesson.source !== lesson.source) {
    reasons.push(`Cross-check against ${getLessonSourceLabel(crossSourceMatch.lesson.source)} import`);
    if (!blocking && recommendedAction === "confirm") recommendedAction = "review";
  }

  if (Object.keys(mergePatch).length) {
    reasons.push(`Student record can be enriched (${getImportedLessonStudentMergeSummary(mergePatch).join(", ")})`);
    if (!blocking && recommendedAction === "confirm") recommendedAction = "pull_contact";
  }

  if (reviewState === "UNREVIEWED" && !reasons.length) {
    reasons.push("Imported lesson is ready for final confirmation");
  }

  if (reviewState === "CONFIRMED" && !reasons.length) {
    reasons.push("Already confirmed");
    recommendedAction = "open";
  }

  if (reviewState === "IGNORED") {
    reasons.push("Ignored from active intake");
    recommendedAction = "open";
  }

  const priorityLabelMap = {
    high: "High Priority",
    medium: "Review Soon",
    low: "Ready"
  };
  const priorityBadgeMap = {
    high: "bg-burgundy/10 text-burgundy",
    medium: "bg-gold/15 text-warmblack",
    low: "bg-sage/10 text-sage"
  };
  const actionLabelMap = {
    confirm: "Confirm Intake",
    create_student: "Create Student",
    match_student: "Match Student",
    review: "Review Details",
    review_change: "Review Change",
    pull_contact: "Pull Contact",
    open: "Open Lesson"
  };

  return {
    reasons: Array.from(new Set(reasons)),
    blocking,
    priority,
    priority_label: priorityLabelMap[priority],
    priority_badge: priorityBadgeMap[priority],
    recommended_action: recommendedAction,
    recommended_action_label: actionLabelMap[recommendedAction] || "Review"
  };
}

function processGoogleCalendarImportFeed(feed = []) {
  const nowIso = new Date().toISOString();
  const syncWindow = getCalendarSyncWindow();
  let importedCount = 0;
  let updatedCount = 0;
  let flaggedCount = 0;
  let skippedCount = 0;

  (Array.isArray(feed) ? feed : []).forEach((event) => {
    const eventStart = event.start ? new Date(event.start) : null;
    if (!eventStart || Number.isNaN(eventStart.getTime())) {
      skippedCount += 1;
      return;
    }

    if (eventStart < syncWindow.start || eventStart > syncWindow.end) {
      skippedCount += 1;
      return;
    }

    if (!isLikelyLessonCalendarEvent(event)) {
      skippedCount += 1;
      return;
    }

    const candidate = buildImportedLessonFromCalendarEvent(event);
    const existingLesson = findLessonByExternalEventId(event.id);

    if (!existingLesson) {
      const relatedLesson = findPotentialExistingLessonFromImportedCandidate(candidate);

      if (relatedLesson?.relation === "likely_duplicate") {
        const matchedLesson = relatedLesson.lesson;
        const sameTiming = matchedLesson.scheduled_start === candidate.scheduled_start && matchedLesson.scheduled_end === candidate.scheduled_end;
        const preservedConfirmed = normalizeLessonIntakeReviewStateValue(matchedLesson.intake_review_state, matchedLesson.source) === "CONFIRMED" && sameTiming;
        const result = updateLesson(matchedLesson.lesson_id, {
          source: "google_calendar",
          external_event_id: candidate.external_event_id,
          source_calendar_id: candidate.source_calendar_id,
          external_platform_hint: candidate.external_platform_hint,
          external_event_title: candidate.external_event_title,
          external_contact_name: candidate.external_contact_name || matchedLesson.external_contact_name || "",
          external_contact_email: candidate.external_contact_email || matchedLesson.external_contact_email || "",
          external_contact_phone: candidate.external_contact_phone || matchedLesson.external_contact_phone || "",
          last_synced_at: nowIso,
          external_updated_at: event.updated_at || nowIso,
          sync_state: sameTiming ? "SYNCED" : "UPDATED_EXTERNALLY",
          intake_review_state: preservedConfirmed ? "CONFIRMED" : sameTiming ? "UNREVIEWED" : "NEEDS_ATTENTION",
          intake_conflict_note: preservedConfirmed ? "" : sameTiming
            ? `Google Calendar matched this lesson with high confidence (${relatedLesson.reasons.join(", ")}). Confirm once before relying on it.`
            : `Google Calendar likely matches this lesson (${relatedLesson.reasons.join(", ")}), but timing/details changed. Review before trusting it.`,
          pending_external_start: sameTiming ? "" : candidate.scheduled_start,
          pending_external_end: sameTiming ? "" : candidate.scheduled_end,
          student_id: matchedLesson.student_id || candidate.student_id || matchedLesson.student_id
        });

        if (result && result.ok) {
          flaggedCount += 1;
        } else {
          skippedCount += 1;
        }
        return;
      }

      if (relatedLesson?.relation === "possible_duplicate") {
        candidate.intake_review_state = "NEEDS_ATTENTION";
        candidate.intake_conflict_note = `Possible duplicate of ${relatedLesson.lesson.lesson_id} (${relatedLesson.reasons.join(", ")}). Review before keeping both lesson records.`;
      }

      const result = createLesson({
        ...candidate,
        imported_at: nowIso,
        last_synced_at: nowIso
      });

      if (result && result.ok) {
        importedCount += 1;
      } else {
        skippedCount += 1;
      }
      return;
    }

    const changedFields = getChangedCalendarFields(existingLesson, candidate);
    if (changedFields.length > 0) {
      const result = updateLesson(existingLesson.lesson_id, {
        last_synced_at: nowIso,
        external_updated_at: event.updated_at || nowIso,
        sync_state: "UPDATED_EXTERNALLY",
        intake_review_state: "NEEDS_ATTENTION",
        intake_conflict_note: `Google Calendar changed ${changedFields.join(", ")}. Review before trusting this lesson.`,
        pending_external_start: candidate.scheduled_start,
        pending_external_end: candidate.scheduled_end,
        external_event_title: candidate.external_event_title,
        external_contact_name: candidate.external_contact_name,
        external_contact_email: candidate.external_contact_email,
        external_contact_phone: candidate.external_contact_phone,
        external_platform_hint: candidate.external_platform_hint,
        source_calendar_id: candidate.source_calendar_id
      });

      if (result && result.ok) {
        flaggedCount += 1;
      } else {
        skippedCount += 1;
      }
      return;
    }

    const result = updateLesson(existingLesson.lesson_id, {
      last_synced_at: nowIso,
      external_updated_at: event.updated_at || nowIso,
      sync_state: "SYNCED",
      pending_external_start: "",
      pending_external_end: "",
      intake_conflict_note: existingLesson.intake_review_state === "CONFIRMED" ? "" : existingLesson.intake_conflict_note || "",
      external_event_title: candidate.external_event_title,
      external_contact_name: candidate.external_contact_name,
      external_contact_email: candidate.external_contact_email,
      external_contact_phone: candidate.external_contact_phone,
      external_platform_hint: candidate.external_platform_hint,
      source_calendar_id: candidate.source_calendar_id,
      student_id: existingLesson.student_id || candidate.student_id || existingLesson.student_id
    });

    if (result && result.ok) {
      updatedCount += 1;
    } else {
      skippedCount += 1;
    }
  });

  return {
    imported: importedCount,
    updated: updatedCount,
    flagged: flaggedCount,
    skipped: skippedCount,
    synced_at: nowIso
  };
}

function runDemoGoogleCalendarSync() {
  if (!calendarSyncState.connected) {
    notifyUser({
      title: "Calendar Sync",
      message: "Add your Google account in Settings before running sync.",
      tone: "error",
      source: "schedule"
    });
    return;
  }

  const summary = processGoogleCalendarImportFeed(sampleGoogleCalendarFeed);
  setCalendarSyncState({
    last_sync_at: summary.synced_at,
    last_sync_summary: {
      imported: summary.imported,
      updated: summary.updated,
      flagged: summary.flagged,
      skipped: summary.skipped
    }
  });

  renderAppFromSchema();
  notifyUser({
    title: "Calendar Sync Complete",
    message: `Imported ${summary.imported}, updated ${summary.updated}, flagged ${summary.flagged}, skipped ${summary.skipped}.`,
    tone: "success",
    source: "schedule"
  });
}

async function runGoogleCalendarSync() {
  syncCalendarStateFromBackendSettings();

  const backend = studioDataService.getBackendSettings();
  if (!backend.google_account_email) {
    notifyUser({
      title: "Calendar Sync",
      message: "Add your Google account email in Settings before running calendar sync.",
      tone: "error",
      source: "schedule"
    });
    return;
  }

  if (backend.google_sheets_web_app_url) {
    try {
      const payload = await studioDataService.runGoogleCalendarSync();
      if (payload?.google?.calendar?.status === "live_ready" && Array.isArray(payload?.events)) {
        const summary = processGoogleCalendarImportFeed(payload.events);
        setCalendarSyncState({
          last_sync_at: summary.synced_at,
          last_sync_summary: {
            imported: summary.imported,
            updated: summary.updated,
            flagged: summary.flagged,
            skipped: summary.skipped
          }
        });
        renderAppFromSchema();
        notifyUser({
          title: "Calendar Sync Complete",
          message: `Imported ${summary.imported}, updated ${summary.updated}, flagged ${summary.flagged}, skipped ${summary.skipped}.`,
          tone: "success",
          source: "schedule"
        });
        return;
      }

      if (payload?.google?.calendar?.status === "live_ready") {
        notifyUser({
          title: "Calendar Sync",
          message: payload.message || "Google Calendar backend is connected, but no event payload came back yet.",
          tone: "warm",
          source: "schedule"
        });
        renderSchedulePage();
        return;
      }

      if (payload?.message) {
        notifyUser({
          title: "Calendar Sync",
          message: `${payload.message} The portal will use the current intake feed for now so your workflow keeps moving.`,
          tone: "warm",
          source: "schedule"
        });
      }
    } catch (error) {
      notifyUser({
        title: "Calendar Sync",
        message: `${error.message || "Unable to reach the Google Calendar backend."} The portal will use the current intake feed for now.`,
        tone: "error",
        source: "schedule"
      });
    }
  }

  runDemoGoogleCalendarSync();
}

function processGmailImportFeed(feed = []) {
  const nowIso = new Date().toISOString();
  const syncWindow = getCalendarSyncWindow();
  let importedCount = 0;
  let flaggedCount = 0;
  let skippedCount = 0;

  (Array.isArray(feed) ? feed : []).forEach((message) => {
    if (!isLikelyLessonGmailMessage(message)) {
      skippedCount += 1;
      return;
    }

    const candidate = buildImportedLessonFromGmailMessage(message);
    const messageStart = candidate.scheduled_start ? new Date(candidate.scheduled_start) : null;

    if (!messageStart || Number.isNaN(messageStart.getTime())) {
      skippedCount += 1;
      return;
    }

    if (messageStart < syncWindow.start || messageStart > syncWindow.end) {
      skippedCount += 1;
      return;
    }

    const existingByMessageId = findLessonByExternalEventId(message.id);
    if (existingByMessageId) {
      const updateResult = updateLesson(existingByMessageId.lesson_id, {
        last_synced_at: nowIso,
        external_updated_at: message.received_at || nowIso,
        external_event_title: candidate.external_event_title,
        external_contact_name: candidate.external_contact_name,
        external_contact_email: candidate.external_contact_email,
        external_contact_phone: candidate.external_contact_phone,
        external_platform_hint: candidate.external_platform_hint,
        sync_state: "SYNCED"
      });

      if (updateResult && updateResult.ok) {
        flaggedCount += 1;
      } else {
        skippedCount += 1;
      }
      return;
    }

    const overlappingLesson = findPotentialExistingLessonFromImportedCandidate(candidate);
    if (overlappingLesson) {
      const matchedLesson = overlappingLesson.lesson;
      const isLikelyDuplicate = overlappingLesson.relation === "likely_duplicate";
      const preservedConfirmed = normalizeLessonIntakeReviewStateValue(matchedLesson.intake_review_state, matchedLesson.source) === "CONFIRMED" && isLikelyDuplicate;
      const updateResult = updateLesson(matchedLesson.lesson_id, {
        last_synced_at: nowIso,
        external_updated_at: message.received_at || nowIso,
        sync_state: isLikelyDuplicate ? "SYNCED" : "NEEDS_REVIEW",
        intake_review_state: preservedConfirmed ? "CONFIRMED" : isLikelyDuplicate ? "UNREVIEWED" : "NEEDS_ATTENTION",
        intake_conflict_note: preservedConfirmed ? "" : isLikelyDuplicate
          ? `Gmail confirmation likely matches this lesson (${overlappingLesson.reasons.join(", ")}). Confirm once before relying on it.`
          : `Gmail confirmation may match this lesson (${overlappingLesson.reasons.join(", ")}). Review before keeping both records.`,
        external_platform_hint: candidate.external_platform_hint,
        external_contact_name: candidate.external_contact_name || matchedLesson.external_contact_name || "",
        external_contact_email: candidate.external_contact_email || matchedLesson.external_contact_email || "",
        external_contact_phone: candidate.external_contact_phone || matchedLesson.external_contact_phone || "",
        join_link: matchedLesson.join_link || candidate.join_link || "",
        student_id: matchedLesson.student_id || candidate.student_id || matchedLesson.student_id
      });

      if (updateResult && updateResult.ok) {
        flaggedCount += 1;
      } else {
        skippedCount += 1;
      }
      return;
    }

    const createResult = createLesson({
      ...candidate,
      intake_review_state: candidate.student_id && candidate.scheduled_end ? "UNREVIEWED" : "NEEDS_ATTENTION",
      imported_at: nowIso,
      last_synced_at: nowIso
    });

    if (createResult && createResult.ok) {
      importedCount += 1;
    } else {
      skippedCount += 1;
    }
  });

  return {
    imported: importedCount,
    flagged: flaggedCount,
    skipped: skippedCount,
    synced_at: nowIso
  };
}

function runDemoGmailAssistSync() {
  if (!calendarSyncState.gmail_connected) {
    notifyUser({
      title: "Gmail Assist",
      message: "Add your Google account in Settings before running Gmail assist.",
      tone: "error",
      source: "schedule"
    });
    return;
  }

  const summary = processGmailImportFeed(sampleGmailLessonFeed);
  setCalendarSyncState({
    gmail_last_sync_at: summary.synced_at,
    gmail_last_sync_summary: {
      imported: summary.imported,
      flagged: summary.flagged,
      skipped: summary.skipped
    }
  });

  renderAppFromSchema();
  notifyUser({
    title: "Gmail Assist Complete",
    message: `Imported ${summary.imported}, flagged ${summary.flagged}, skipped ${summary.skipped}.`,
    tone: "success",
    source: "schedule"
  });
}

async function runGmailAssistSync() {
  syncCalendarStateFromBackendSettings();

  const backend = studioDataService.getBackendSettings();
  if (!backend.google_account_email) {
    notifyUser({
      title: "Gmail Assist",
      message: "Add your Google account email in Settings before running Gmail assist.",
      tone: "error",
      source: "schedule"
    });
    return;
  }

  if (backend.google_sheets_web_app_url) {
    try {
      const payload = await studioDataService.runGmailSync();
      if (payload?.google?.gmail?.status === "live_ready" && Array.isArray(payload?.messages)) {
        const summary = processGmailImportFeed(payload.messages);
        setCalendarSyncState({
          gmail_last_sync_at: summary.synced_at,
          gmail_last_sync_summary: {
            imported: summary.imported,
            flagged: summary.flagged,
            skipped: summary.skipped
          }
        });
        renderAppFromSchema();
        notifyUser({
          title: "Gmail Assist Complete",
          message: `Imported ${summary.imported}, flagged ${summary.flagged}, skipped ${summary.skipped}.`,
          tone: "success",
          source: "schedule"
        });
        return;
      }

      if (payload?.google?.gmail?.status === "live_ready") {
        notifyUser({
          title: "Gmail Assist",
          message: payload.message || "Gmail backend is connected, but no message payload came back yet.",
          tone: "warm",
          source: "schedule"
        });
        renderSchedulePage();
        return;
      }

      if (payload?.message) {
        notifyUser({
          title: "Gmail Assist",
          message: `${payload.message} The portal will use the current Gmail intake feed for now so review can keep working.`,
          tone: "warm",
          source: "schedule"
        });
      }
    } catch (error) {
      notifyUser({
        title: "Gmail Assist",
        message: `${error.message || "Unable to reach the Gmail backend."} The portal will use the current Gmail intake feed for now.`,
        tone: "error",
        source: "schedule"
      });
    }
  }

  runDemoGmailAssistSync();
}

async function checkGoogleConnectionStatus() {
  const backend = studioDataService.getBackendSettings();
  if (!backend.google_sheets_web_app_url) {
    notifyUser({
      title: "Google Connections",
      message: "Add your backend / proxy URL in Settings before checking Google connection status.",
      tone: "error",
      source: "settings"
    });
    return;
  }

  try {
    const google = await studioDataService.getGoogleStatus();
    syncCalendarStateFromBackendSettings();
    const calendarLabel = getGoogleServiceStatusLabel(google?.calendar?.status);
    const gmailLabel = getGoogleServiceStatusLabel(google?.gmail?.status);
    const authHint = google?.calendar?.status === "auth_needed" || google?.gmail?.status === "auth_needed"
      ? " Next step: use Connect Google Account in Settings."
      : "";
    notifyUser({
      title: "Google Connections Refreshed",
      message: `Account ${google?.account_email || backend.google_account_email}. Calendar: ${calendarLabel}. Gmail: ${gmailLabel}.${authHint}`,
      tone: "info",
      source: "settings"
    });
  } catch (error) {
    notifyUser({
      title: "Google Connections",
      message: error.message || "Unable to check Google connection status.",
      tone: "error",
      source: "settings"
    });
  }

  renderCurrentPage();
}

function saveGoogleConnectionSettings(event) {
  event.preventDefault();
  const form = document.getElementById("settings-google-connections-form");
  if (!form) return;

  const accountEmail = String(form.google_account_email.value || "").trim().toLowerCase();
  if (!accountEmail) {
    setSettingsActionFeedback("Add the Google account email before saving Google connection settings.", "error");
    renderSettingsPage();
    return;
  }

  studioDataService.updateBackendSettings({
    google_account_email: accountEmail,
    google_sync_mode: "manual",
    gmail_filter_scope: "booking_only",
    import_review_mode: "review_first"
  });
  syncCalendarStateFromBackendSettings();
  setSettingsActionFeedback("Google connection preferences saved. Calendar and Gmail are set to one shared account, manual sync first, booking-only Gmail, and review-first intake.", "success");
  renderSettingsPage();
}

function createStudentFromImportedLesson(lessonId) {
  const lesson = getSchemaLessonById(lessonId);
  if (!lesson) return;
  const contact = getImportedLessonContactInfo(lesson);

  const payload = {
    full_name: contact.student_full_name || "Imported Student",
    email: contact.guardian_name ? "" : contact.email,
    additional_emails: "",
    phone: contact.guardian_name ? "" : contact.phone,
    guardian_name: contact.guardian_name || "",
    guardian_email: contact.guardian_name ? contact.email : "",
    guardian_phone: contact.guardian_name ? contact.phone : "",
    timezone: "America/New_York",
    studio_status: "INACTIVE",
    billing_model: "PAYG",
    booking_behavior: "SELF_BOOKING",
    lead_source: getLeadSourceFromImportedLesson(lesson),
    lead_source_detail: lesson.source === "google_calendar"
      ? `Created from Google Calendar intake${contact.guardian_name ? ` · Guardian contact: ${contact.guardian_name}` : ""}`
      : contact.guardian_name
        ? `Created from intake · Guardian contact: ${contact.guardian_name}`
        : "",
    focus_area: "",
    actor_page_eligible: false
  };

  const result = createStudent(payload);
  if (!result || result.ok === false) {
    notifyUser({
      title: "Schedule Intake",
      message: (result?.errors || ["Unable to create student from imported lesson."]).join(" "),
      tone: "error",
      source: "schedule"
    });
    return;
  }

  updateLesson(lessonId, {
    student_id: result.student.student_id,
    intake_review_state: "UNREVIEWED",
    intake_conflict_note: "Student created from imported calendar event. Review and confirm before relying on this lesson."
  });

  renderAppFromSchema();
  notifyUser({
    title: "Student Created",
    message: `${payload.full_name} was created from imported lesson details and left inactive for review.`,
    tone: "success",
    source: "schedule"
  });
}

function getImportedLessonStudentMergePatch(lesson, student) {
  if (!lesson || !student) return {};

  const patch = {};
  const contact = getImportedLessonContactInfo(lesson);
  const importedLeadSource = getLeadSourceFromImportedLesson(lesson);
  const importedLeadDetail = lesson.source === "gmail_assist"
    ? "Matched from Gmail-assisted intake"
    : lesson.source === "google_calendar"
      ? "Matched from Google Calendar intake"
      : lesson.external_platform_hint
        ? `Matched from ${getImportedLessonPlatformLabel(lesson.external_platform_hint)} intake`
        : "";

  if (contact.guardian_name) {
    if (!String(student.guardian_name || "").trim()) {
      patch.guardian_name = contact.guardian_name;
    }
    if (contact.email) {
      if (!String(student.guardian_email || "").trim()) {
        patch.guardian_email = contact.email;
      } else if (
        String(student.guardian_email || "").trim().toLowerCase() !== contact.email.toLowerCase() &&
        !parseStoredEmailList(student.additional_emails || "").includes(contact.email.toLowerCase()) &&
        String(student.email || "").trim().toLowerCase() !== contact.email.toLowerCase()
      ) {
        patch.additional_emails = appendEmailToList(student.additional_emails || "", contact.email);
      }
    }
    if (contact.phone && !String(student.guardian_phone || "").trim()) {
      patch.guardian_phone = contact.phone;
    }
  } else {
    if (contact.email) {
      if (!String(student.email || "").trim()) {
        patch.email = contact.email;
      } else if (
        String(student.email || "").trim().toLowerCase() !== contact.email.toLowerCase() &&
        !parseStoredEmailList(student.additional_emails || "").includes(contact.email.toLowerCase())
      ) {
        patch.additional_emails = appendEmailToList(student.additional_emails || "", contact.email);
      }
    }

    if (contact.phone && !String(student.phone || "").trim()) {
      patch.phone = contact.phone;
    }
  }

  if (!String(student.lead_source || "").trim() && importedLeadSource) {
    patch.lead_source = importedLeadSource;
  }

  if (!String(student.lead_source_detail || "").trim() && importedLeadDetail) {
    patch.lead_source_detail = importedLeadDetail;
  }

  return patch;
}

function getImportedLessonStudentMergeSummary(patch) {
  const updates = [];
  if (patch.email) updates.push("email");
  if (patch.additional_emails) updates.push("additional emails");
  if (patch.phone) updates.push("phone");
  if (patch.guardian_name) updates.push("guardian name");
  if (patch.guardian_email) updates.push("guardian email");
  if (patch.guardian_phone) updates.push("guardian phone");
  if (patch.lead_source) updates.push("lead source");
  if (patch.lead_source_detail && !patch.lead_source) updates.push("lead source detail");
  return updates;
}

function mergeImportedLessonIntoStudentRecord(lessonId, studentId) {
  const lesson = getSchemaLessonById(lessonId);
  const student = getSchemaStudentById(studentId);
  if (!lesson || !student) {
    return {
      ok: false,
      errors: ["Unable to load the imported lesson or student for merging."]
    };
  }

  const patch = getImportedLessonStudentMergePatch(lesson, student);
  let studentResult = null;

  if (Object.keys(patch).length) {
    studentResult = updateStudent(studentId, patch);
    if (!studentResult || studentResult.ok === false) {
      return {
        ok: false,
        errors: studentResult?.errors || ["Unable to merge imported lesson info into the student record."]
      };
    }
  }

  const mergedFields = getImportedLessonStudentMergeSummary(patch);
  const intakeNote = mergedFields.length
    ? `Matched to an existing student and merged ${mergedFields.join(", ")} from the imported lesson. Review and confirm this intake item.`
    : "Matched to an existing student. Review and confirm this intake item.";

  const lessonResult = updateLesson(lessonId, {
    student_id: studentId,
    intake_review_state: "UNREVIEWED",
    intake_conflict_note: intakeNote
  });

  if (!lessonResult || lessonResult.ok === false) {
    return {
      ok: false,
      errors: lessonResult?.errors || ["Unable to attach the imported lesson to the selected student."]
    };
  }

  return {
    ok: true,
    merged_fields: mergedFields,
    student_result: studentResult,
    lesson_result: lessonResult
  };
}

function pullStudentInfoFromLesson(lessonId) {
  const lesson = getSchemaLessonById(lessonId);
  if (!lesson || !lesson.student_id) {
    notifyUser({
      title: "Imported Contact",
      message: "Match this lesson to a student before pulling contact details into the profile.",
      tone: "error",
      source: "schedule"
    });
    return;
  }

  const result = mergeImportedLessonIntoStudentRecord(lessonId, lesson.student_id);
  if (!result || result.ok === false) {
    notifyUser({
      title: "Imported Contact",
      message: (result?.errors || ["Unable to pull imported student info from this lesson."]).join(" "),
      tone: "error",
      source: "schedule"
    });
    return;
  }

  renderAppFromSchema();
  notifyUser({
    title: "Student Updated",
    message: result.merged_fields.length ? `Pulled ${result.merged_fields.join(", ")} into the student record.` : "Student was already up to date with the imported lesson details.",
    tone: "success",
    source: "schedule"
  });
}

function closeScheduleStudentMatchModal() {
  const modal = document.getElementById("schedule-student-match-modal");
  if (modal) modal.remove();
}

function saveScheduleStudentMatch(lessonId) {
  const select = document.getElementById("schedule-student-match-select");
  if (!select) return;

  const studentId = select.value;
  if (!studentId) {
    notifyUser({
      title: "Schedule Intake",
      message: "Choose a student to merge this lesson with.",
      tone: "error",
      source: "schedule"
    });
    return;
  }

  const result = mergeImportedLessonIntoStudentRecord(lessonId, studentId);

  if (!result || result.ok === false) {
    notifyUser({
      title: "Schedule Intake",
      message: (result?.errors || ["Unable to merge this imported lesson with the selected student."]).join(" "),
      tone: "error",
      source: "schedule"
    });
    return;
  }

  closeScheduleStudentMatchModal();
  renderAppFromSchema();
  notifyUser({
    title: "Lesson Matched",
    message: result.merged_fields.length ? `Lesson merged with the selected student and updated ${result.merged_fields.join(", ")}.` : "Lesson matched to the selected student.",
    tone: "success",
    source: "schedule"
  });
}

function openScheduleStudentMatchModal(lessonId) {
  const lesson = getSchemaLessonById(lessonId);
  if (!lesson) return;

  closeScheduleStudentMatchModal();
  const contact = getImportedLessonContactInfo(lesson);

  const candidates = findPotentialStudentMatches({
    full_name: contact.student_full_name || "",
    email: contact.email || "",
    phone: contact.phone || ""
  });
  const recommendedStudentId = candidates.find((candidate) => candidate.merge_ready)?.student?.student_id || candidates[0]?.student?.student_id || "";

  const overlay = document.createElement("div");
  overlay.id = "schedule-student-match-modal";
  overlay.className = "fixed inset-0 z-[80] bg-black/55 flex items-center justify-center p-4";
  overlay.innerHTML = `
    <div class="app-modal-shell bg-white rounded-2xl border border-cream w-full max-w-2xl p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
      <div class="app-modal-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div class="min-w-0">
          <h3 class="font-display text-xl font-bold text-warmblack">Match Imported Lesson</h3>
          <p class="text-sm text-warmgray mt-1">Merge this lesson with an existing student when the contact details line up, or create a new inactive student from intake.</p>
        </div>
        <button type="button" id="close-schedule-student-match-modal" class="self-start text-sm text-warmgray">Close</button>
      </div>

      <div class="space-y-4">
        <div class="rounded-2xl border border-cream bg-parchment p-4">
          <p class="text-sm font-semibold text-warmblack">${escapeHtml(contact.display_name || lesson.external_event_title || "Imported Lesson")}</p>
          <p class="text-xs text-warmgray mt-1">${escapeHtml(contact.email || "No email detected")} ${contact.phone ? `· ${escapeHtml(contact.phone)}` : ""}</p>
          <p class="text-xs text-warmgray mt-2">Source · ${escapeHtml(getLessonSourceLabel(lesson.source))}${lesson.external_platform_hint ? ` · ${escapeHtml(getImportedLessonPlatformLabel(lesson.external_platform_hint))}` : ""}</p>
        </div>

        ${
          candidates.length
            ? `
              <div class="space-y-2">
                ${candidates.map((candidate) => `
                  <div class="rounded-xl border border-cream bg-white px-4 py-3">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="min-w-0">
                        <p class="text-sm font-semibold text-warmblack">${escapeHtml(candidate.student.full_name)}</p>
                        <p class="text-xs text-warmgray mt-1">${escapeHtml(candidate.student.email || "No email on file")}${candidate.student.phone ? ` · ${escapeHtml(candidate.student.phone)}` : ""}</p>
                      </div>
                      <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${candidate.merge_ready ? "bg-sage/10 text-sage" : "bg-parchment text-warmgray border border-cream"}">
                        ${candidate.merge_ready ? "Ready to Merge" : "Possible Match"}
                      </span>
                    </div>
                    <p class="text-xs text-warmgray mt-2">Match score ${candidate.score}${candidate.reasons.length ? ` · ${escapeHtml(candidate.reasons.join(", "))}` : ""}</p>
                  </div>
                `).join("")}
              </div>
            `
            : `<div class="rounded-xl border border-burgundy/20 bg-burgundy/5 px-4 py-3 text-sm text-warmblack">No strong student matches were found automatically. You can still choose any student below or create a new student from intake.</div>`
        }

        <div>
          <label class="block text-xs font-medium text-warmgray mb-1">Student</label>
          <select id="schedule-student-match-select" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
            ${getStudentRecords().slice().sort((a, b) => a.full_name.localeCompare(b.full_name)).map((student) => `
              <option value="${student.student_id}" ${recommendedStudentId === student.student_id ? "selected" : ""}>${escapeHtml(student.full_name)} (${escapeHtml(student.student_id)})</option>
            `).join("")}
          </select>
          <p class="text-xs text-warmgray mt-2">Choosing a student here will also pull missing email, phone, and intake source details from the lesson into that student record when available.</p>
        </div>

        <div class="app-modal-footer flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
          <button type="button" id="cancel-schedule-student-match-modal" class="px-4 py-2.5 rounded-xl border border-cream bg-parchment text-sm font-medium">Cancel</button>
          <button type="button" id="save-schedule-student-match-modal" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">Merge & Match Student</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = document.getElementById("close-schedule-student-match-modal");
  const cancelBtn = document.getElementById("cancel-schedule-student-match-modal");
  const saveBtn = document.getElementById("save-schedule-student-match-modal");
  if (closeBtn) closeBtn.onclick = closeScheduleStudentMatchModal;
  if (cancelBtn) cancelBtn.onclick = closeScheduleStudentMatchModal;
  if (saveBtn) saveBtn.onclick = () => saveScheduleStudentMatch(lessonId);
}

function getLessonSyncStateLabel(state, source = "manual") {
  const normalized = normalizeLessonSyncStateValue(state, source);

  const labels = {
    MANUAL: "Manual Entry",
    SYNCED: "Synced",
    UPDATED_EXTERNALLY: "Updated Externally",
    NEEDS_REVIEW: "Needs Review",
    DISCONNECTED: "Disconnected"
  };

  return labels[normalized] || labels.MANUAL;
}

function getLessonSyncStateBadge(state, source = "manual") {
  const normalized = normalizeLessonSyncStateValue(state, source);

  if (normalized === "SYNCED") return "bg-sage/10 text-sage";
  if (normalized === "UPDATED_EXTERNALLY" || normalized === "NEEDS_REVIEW") return "bg-burgundy/10 text-burgundy";
  if (normalized === "DISCONNECTED") return "bg-warmgray/10 text-warmgray";

  return "bg-parchment text-warmgray";
}

function getLessonIntakeReviewStateLabel(state, source = "manual") {
  const normalized = normalizeLessonIntakeReviewStateValue(state, source);

  const labels = {
    MANUAL: "Manual",
    UNREVIEWED: "Unreviewed",
    CONFIRMED: "Confirmed",
    NEEDS_ATTENTION: "Needs Attention",
    IGNORED: "Ignored"
  };

  return labels[normalized] || labels.MANUAL;
}

function getLessonIntakeReviewStateBadge(state, source = "manual") {
  const normalized = normalizeLessonIntakeReviewStateValue(state, source);

  if (normalized === "CONFIRMED") return "bg-sage/10 text-sage";
  if (normalized === "UNREVIEWED") return "bg-gold/10 text-gold";
  if (normalized === "NEEDS_ATTENTION") return "bg-burgundy/10 text-burgundy";
  if (normalized === "IGNORED") return "bg-warmgray/10 text-warmgray";

  return "bg-parchment text-warmgray";
}

function formatLastSyncMeta(dateString) {
  if (!dateString) return "Not synced yet";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Not synced yet";

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getReferenceNow() {
  return typeof APP_NOW !== "undefined" ? APP_NOW : new Date();
}

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDaysToDate(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getStartOfWeek(date) {
  const d = startOfLocalDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function getEndOfWeek(date) {
  return endOfLocalDay(addDaysToDate(getStartOfWeek(date), 6));
}

function getStartOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getEndOfMonth(date) {
  return endOfLocalDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function formatLongDate(dateString) {
  if (!dateString || dateString === "—") return "—";

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatLessonDate(dateString) {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatLessonTime(dateString) {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatLessonTimeRange(startString, endString) {
  const start = formatLessonTime(startString);
  const end = formatLessonTime(endString);

  if (start === "—" && end === "—") return "—";
  if (end === "—") return start;
  return `${start} – ${end}`;
}

function formatDueDate(dateString) {
  if (!dateString) return "No due date";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "No due date";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatDateTimeLocalValue(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getLessonStartFieldParts(dateString) {
  if (!dateString) {
    return {
      date: "",
      hour: "10",
      minute: "00",
      period: "AM"
    };
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return {
      date: "",
      hour: "10",
      minute: "00",
      period: "AM"
    };
  }

  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const hour24 = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, "0");
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  return {
    date: localDate,
    hour: String(hour12),
    minute,
    period
  };
}

function buildLessonStartIso(form) {
  const date = String(form?.elements?.scheduled_start_date?.value || "").trim();
  const hour = Number(form?.elements?.scheduled_start_hour?.value || 0);
  const minute = String(form?.elements?.scheduled_start_minute?.value || "00").trim();
  const period = String(form?.elements?.scheduled_start_period?.value || "AM").trim().toUpperCase();

  if (!date || !hour || !["00", "15", "30", "45"].includes(minute) || !["AM", "PM"].includes(period)) {
    return "";
  }

  let hour24 = hour % 12;
  if (period === "PM") {
    hour24 += 12;
  }

  const localValue = `${date}T${String(hour24).padStart(2, "0")}:${minute}`;
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toISOString();
}

function populateLessonStartFields(form, dateString) {
  if (!form) return;

  const parts = getLessonStartFieldParts(dateString);

  if (form.elements.scheduled_start_date) {
    form.elements.scheduled_start_date.value = parts.date;
  }

  if (form.elements.scheduled_start_hour) {
    form.elements.scheduled_start_hour.value = parts.hour;
  }

  if (form.elements.scheduled_start_minute) {
    form.elements.scheduled_start_minute.value = ["00", "15", "30", "45"].includes(parts.minute) ? parts.minute : "00";
  }

  if (form.elements.scheduled_start_period) {
    form.elements.scheduled_start_period.value = parts.period;
  }
}

function getLessonLocationType(lesson) {
  const explicitType = String(lesson?.location_type || "").trim().toUpperCase();
  if (explicitType === "VIRTUAL" || explicitType === "IN_PERSON") {
    return explicitType;
  }

  return lesson?.join_link ? "VIRTUAL" : "IN_PERSON";
}

function getLessonLocationLabel(lesson) {
  return getLessonLocationType(lesson) === "VIRTUAL" ? "Virtual" : "In Person";
}

function updateLessonLocationFieldsVisibility(form) {
  const targetForm = form || document.getElementById("lesson-form");
  if (!targetForm) return;

  const locationType = String(targetForm.elements.location_type?.value || "VIRTUAL").toUpperCase();
  const virtualField = targetForm.querySelector('[data-location-field="virtual"]');
  const inPersonField = targetForm.querySelector('[data-location-field="in-person"]');

  if (virtualField) {
    virtualField.classList.toggle("hidden", locationType !== "VIRTUAL");
  }

  if (inPersonField) {
    inPersonField.classList.toggle("hidden", locationType !== "IN_PERSON");
  }
}

function addMinutesToIso(isoString, minutes) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";

  date.setMinutes(date.getMinutes() + Number(minutes || 0));
  return date.toISOString();
}

function getDurationFromLesson(lesson) {
  if (!lesson?.scheduled_start || !lesson?.scheduled_end) return "60";

  const start = new Date(lesson.scheduled_start).getTime();
  const end = new Date(lesson.scheduled_end).getTime();

  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return "60";

  const diffMinutes = Math.round((end - start) / 60000);
  if ([15, 30, 60, 90].includes(diffMinutes)) return String(diffMinutes);

  return "60";
}

function formatLessonStatusBadge(status) {
  const normalized = normalizeLessonStatusValue(status);

  if (normalized === "COMPLETED") return "bg-sage/10 text-sage";
  if (normalized === "SCHEDULED") return "bg-gold/10 text-gold";
  if (normalized === "LATE_CANCEL") return "bg-burgundy/10 text-burgundy";
  if (normalized === "NO_SHOW") return "bg-burgundy/10 text-burgundy";
  if (normalized === "CANCELLED") return "bg-warmgray/10 text-warmgray";

  return "bg-warmgray/10 text-warmgray";
}

function getLessonStatusLabel(status) {
  const normalized = normalizeLessonStatusValue(status);

  const labels = {
    SCHEDULED: "Scheduled",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    LATE_CANCEL: "Late Cancel",
    NO_SHOW: "No Show"
  };

  return labels[normalized] || normalized;
}

function getLessonManualPaymentStatusBadge(status) {
  const normalized = normalizeLessonManualPaymentStatusValue(status);
  if (normalized === "PAID") return "bg-sage/10 text-sage";
  if (normalized === "UNPAID") return "bg-burgundy/10 text-burgundy";
  return "bg-warmgray/10 text-warmgray";
}

function getLessonRescheduleHistoryLabel(lesson) {
  if (!lesson?.previous_scheduled_start && !lesson?.previous_scheduled_end) return "";

  const previousDate = formatLessonDate(lesson.previous_scheduled_start);
  const previousTime = formatLessonTimeRange(lesson.previous_scheduled_start, lesson.previous_scheduled_end);
  return `${previousDate} · ${previousTime}`;
}

/*********************************
 * HOMEWORK HELPERS
 *********************************/
function resetProfilePreviousLessonsVisibleCount() {
  profilePreviousLessonsVisibleCount = 3;
}

function showMorePreviousLessons() {
  profilePreviousLessonsVisibleCount += 3;
  if (selectedStudentId) {
    renderProfileLessons(selectedStudentId);
    lucide.createIcons();
  }
}

function hidePreviousLessons() {
  profilePreviousLessonsVisibleCount = 3;
  if (selectedStudentId) {
    renderProfileLessons(selectedStudentId);
    lucide.createIcons();
  }
}

function getHomeworkByStudentId(studentId) {
  return getHomeworkRecords()
    .filter((hw) => hw.student_id === studentId)
    .sort((a, b) => {
      const aAssigned = new Date(a.assigned_at || 0).getTime();
      const bAssigned = new Date(b.assigned_at || 0).getTime();
      return bAssigned - aAssigned;
    });
}

function getNextHomeworkId() {
  const year = String(new Date().getFullYear());

  const maxId = getHomeworkRecords().reduce((max, hw) => {
    const match = String(hw.homework_id || "").match(/^HW-(\d{4})-(\d{6})$/);
    if (!match) return max;
    if (match[1] !== year) return max;
    return Math.max(max, Number(match[2]));
  }, 0);

  return `HW-${year}-${String(maxId + 1).padStart(6, "0")}`;
}

function getHomeworkByLessonId(lessonId) {
  return getHomeworkRecords()
    .filter((hw) => hw.lesson_id === lessonId)
    .sort((a, b) => {
      const aTime = new Date(a.assigned_at || 0).getTime();
      const bTime = new Date(b.assigned_at || 0).getTime();
      return bTime - aTime;
    });
}

function isHomeworkOverdue(hw) {
  if (!hw || hw.status === "DONE" || !hw.due_date) return false;

  const due = new Date(`${hw.due_date}T23:59:59`);
  if (Number.isNaN(due.getTime())) return false;

  return due < APP_NOW;
}

function getHomeworkStatusClasses(hw) {
  if (hw.status === "DONE") {
    return {
      badge: "bg-sage/10 text-sage",
      label: "Done"
    };
  }

  if (isHomeworkOverdue(hw)) {
    return {
      badge: "bg-burgundy/10 text-burgundy",
      label: "Overdue"
    };
  }

  return {
    badge: "bg-gold/10 text-gold",
    label: "Assigned"
  };
}

function getHomeworkById(homeworkId) {
  return getHomeworkRecords().find((hw) => hw.homework_id === homeworkId) || null;
}

function deleteHomeworkItem(homeworkId) {
  const existing = getHomeworkById(homeworkId);
  if (!existing) {
    return { ok: false, errors: ["Homework item not found."] };
  }

  removeRecordById("homework", homeworkId);

  return { ok: true };
}

function toggleHomeworkStatus(homeworkId, isDone) {
  const item = getHomeworkRecords().find((hw) => hw.homework_id === homeworkId);
  if (!item) return { ok: false, errors: ["Homework item not found."] };

  const updated = patchRecordById("homework", homeworkId, {
    status: isDone ? "DONE" : "ASSIGNED",
    completed_at: isDone ? new Date().toISOString() : ""
  });

  return { ok: true, homework: updated };
}

function getVisibleHomeworkForProfile(studentId) {
  const now = APP_NOW;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 14);

  const all = getHomeworkByStudentId(studentId);

  const active = all
    .filter((hw) => hw.status !== "DONE")
    .sort((a, b) => {
      const aDue = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bDue = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return aDue - bDue;
    });

  const recentlyDone = all
    .filter((hw) => hw.status === "DONE" && hw.completed_at && new Date(hw.completed_at) >= cutoff)
    .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());

  return [...active, ...recentlyDone];
}

function upsertHomeworkItem({ homework_id, lesson_id, student_id, title, details, due_date, status }) {
  const cleanTitle = String(title || "").trim();
  const cleanDetails = String(details || "").trim();
  const cleanDueDate = String(due_date || "").trim();
  const cleanStatus = String(status || "ASSIGNED").toUpperCase() === "DONE" ? "DONE" : "ASSIGNED";

  if (!lesson_id) return { ok: false, errors: ["Lesson is required for homework."] };
  if (!student_id) return { ok: false, errors: ["Student is required for homework."] };
  if (!cleanTitle) return { ok: false, errors: ["Homework title is required."] };

  const existing = homework_id
    ? getHomeworkRecords().find((hw) => hw.homework_id === homework_id)
    : null;

  if (existing) {
    const updated = patchRecordById("homework", homework_id, {
      title: cleanTitle,
      details: cleanDetails,
      due_date: cleanDueDate,
      status: cleanStatus,
      completed_at: cleanStatus === "DONE" ? (existing.completed_at || new Date().toISOString()) : ""
    });

    return { ok: true, homework: updated };
  }

  const newHomework = {
    homework_id: getNextHomeworkId(),
    lesson_id,
    student_id,
    title: cleanTitle,
    details: cleanDetails,
    assigned_at: new Date().toISOString(),
    due_date: cleanDueDate,
    status: cleanStatus,
    completed_at: cleanStatus === "DONE" ? new Date().toISOString() : ""
  };

  insertRecord("homework", newHomework, { prepend: true });

  return { ok: true, homework: newHomework };
}

function renderProfileHomeworkTab(studentId) {
  const homeworkContainer = document.getElementById("profile-tab-homework");
  if (!homeworkContainer) return;

  const homeworkItems = getVisibleHomeworkForProfile(studentId);

  if (!homeworkItems.length) {
    homeworkContainer.innerHTML = `
      <div class="p-6 bg-parchment rounded-xl border border-cream text-sm text-warmgray">
        No current homework.
      </div>
    `;
    return;
  }

  homeworkContainer.innerHTML = `
    <div class="max-h-[420px] overflow-y-auto space-y-3 pr-1">
      ${homeworkItems.map((hw) => {
        const lesson = getSchemaLessonById(hw.lesson_id);
        const hwMeta = getHomeworkStatusClasses(hw);

        return `
          <div class="flex items-start gap-3 p-4 rounded-xl border border-cream bg-parchment">
            <input
              type="checkbox"
              class="checkbox-custom mt-0.5"
              ${hw.status === "DONE" ? "checked" : ""}
              onchange="toggleHomeworkStatusFromProfile('${hw.homework_id}', this.checked)"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-4">
                <p class="text-sm font-medium ${hw.status === "DONE" ? "line-through text-warmgray" : isHomeworkOverdue(hw) ? "text-burgundy" : "text-warmblack"}">
                  ${escapeHtml(hw.title)}
                </p>
                <span class="text-[11px] px-2 py-0.5 rounded-full ${hwMeta.badge}">
                  ${hwMeta.label}
                </span>
              </div>

              ${hw.details ? `<p class="text-xs text-warmgray mt-1">${escapeHtml(hw.details)}</p>` : ""}

              <div class="flex items-center justify-between mt-2 gap-3">
                <p class="text-xs text-warmgray">
                  ${escapeHtml(lesson?.topic || "Lesson")} · Due ${escapeHtml(formatDueDate(hw.due_date))}
                </p>

                <button
                  type="button"
                  class="text-xs font-medium text-gold hover:underline shrink-0"
                  onclick="openLessonDetailModal('${hw.lesson_id}')"
                >
                  Open Lesson
                </button>
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function toggleHomeworkStatusFromProfile(homeworkId, isDone) {
  const result = toggleHomeworkStatus(homeworkId, isDone);
  if (!result || result.ok === false) {
    const errors = result?.errors || ["Unable to update homework."];
    notifyUser({
      title: "Homework Update",
      message: errors.join(" "),
      tone: "error",
      source: "profile"
    });
    return;
  }

  if (selectedStudentId) {
    renderProfileHomeworkTab(selectedStudentId);
  }

  notifyUser({
    title: "Homework Updated",
    message: `Homework was marked ${isDone ? "done" : "not done"}.`,
    tone: "success",
    source: "profile",
    toast: true
  });
}

function switchLessonDetailTab(tab) {
  activeLessonDetailTab = tab;

  const notesTab = document.getElementById("lesson-detail-tab-notes");
  const homeworkTab = document.getElementById("lesson-detail-tab-homework");
  const notesBtn = document.getElementById("lesson-detail-tab-btn-notes");
  const homeworkBtn = document.getElementById("lesson-detail-tab-btn-homework");

  if (notesTab) notesTab.style.display = tab === "notes" ? "block" : "none";
  if (homeworkTab) homeworkTab.style.display = tab === "homework" ? "block" : "none";

  [notesBtn, homeworkBtn].forEach((btn) => {
    if (!btn) return;
    btn.classList.remove("text-gold", "border-gold");
    btn.classList.add("text-warmgray", "border-transparent");
  });

  const activeBtn = tab === "notes" ? notesBtn : homeworkBtn;
  if (activeBtn) {
    activeBtn.classList.add("text-gold", "border-gold");
    activeBtn.classList.remove("text-warmgray", "border-transparent");
  }
}

function toggleHomeworkStatusFromDetail(homeworkId, isDone, lessonId) {
  const result = toggleHomeworkStatus(homeworkId, isDone);
  if (!result || result.ok === false) {
    const errors = result?.errors || ["Unable to update homework."];
    notifyUser({
      title: "Homework Update",
      message: errors.join(" "),
      tone: "error",
      source: "lessons"
    });
    return;
  }

  if (selectedStudentId) {
    renderProfileHomeworkTab(selectedStudentId);
  }

  activeLessonDetailTab = "homework";
  openLessonDetailModal(lessonId);
  notifyUser({
    title: "Homework Updated",
    message: `Homework was marked ${isDone ? "done" : "not done"}.`,
    tone: "success",
    source: "lessons",
    toast: true
  });
}

function resetLessonHomeworkForm() {
  editingHomeworkId = null;

  const titleEl = document.getElementById("lesson-homework-title");
  const detailsEl = document.getElementById("lesson-homework-details");
  const dueDateEl = document.getElementById("lesson-homework-due-date");
  const statusEl = document.getElementById("lesson-homework-status");
  const saveBtn = document.getElementById("add-homework-btn");
  const cancelBtn = document.getElementById("cancel-homework-edit-btn");

  if (titleEl) titleEl.value = "";
  if (detailsEl) detailsEl.value = "";
  if (dueDateEl) dueDateEl.value = "";
  if (statusEl) statusEl.value = "ASSIGNED";
  if (saveBtn) saveBtn.textContent = "Save Homework";
  if (cancelBtn) cancelBtn.style.display = "none";
}

function loadHomeworkIntoLessonForm(homeworkId) {
  const hw = getHomeworkById(homeworkId);
  if (!hw) return;

  editingHomeworkId = homeworkId;

  const titleEl = document.getElementById("lesson-homework-title");
  const detailsEl = document.getElementById("lesson-homework-details");
  const dueDateEl = document.getElementById("lesson-homework-due-date");
  const statusEl = document.getElementById("lesson-homework-status");
  const saveBtn = document.getElementById("add-homework-btn");
  const cancelBtn = document.getElementById("cancel-homework-edit-btn");

  if (titleEl) titleEl.value = hw.title || "";
  if (detailsEl) detailsEl.value = hw.details || "";
  if (dueDateEl) dueDateEl.value = hw.due_date || "";
  if (statusEl) statusEl.value = hw.status || "ASSIGNED";
  if (saveBtn) saveBtn.textContent = "Update Homework";
  if (cancelBtn) cancelBtn.style.display = "inline-flex";
}

function beginHomeworkEdit(homeworkId, lessonId) {
  activeLessonDetailTab = "homework";
  openLessonDetailModal(lessonId);

  setTimeout(() => {
    loadHomeworkIntoLessonForm(homeworkId);
  }, 0);
}

function removeHomeworkFromLessonDetail(homeworkId, lessonId) {
  const confirmed = window.confirm("Delete this homework item?");
  if (!confirmed) return;

  const result = deleteHomeworkItem(homeworkId);

  if (!result || result.ok === false) {
    const errors = result?.errors || ["Unable to delete homework."];
    notifyUser({
      title: "Homework Delete",
      message: errors.join(" "),
      tone: "error",
      source: "lessons"
    });
    return;
  }

  if (selectedStudentId) {
    renderProfileHomeworkTab(selectedStudentId);
  }

  activeLessonDetailTab = "homework";
  openLessonDetailModal(lessonId);
  notifyUser({
    title: "Homework Deleted",
    message: "The homework item was removed from this lesson.",
    tone: "success",
    source: "lessons"
  });
}

function saveHomeworkFromLessonDetail(lessonId, studentId) {
  const titleEl = document.getElementById("lesson-homework-title");
  const detailsEl = document.getElementById("lesson-homework-details");
  const dueDateEl = document.getElementById("lesson-homework-due-date");
  const statusEl = document.getElementById("lesson-homework-status");
  const wasEditingHomework = Boolean(editingHomeworkId);

  const result = upsertHomeworkItem({
    homework_id: editingHomeworkId,
    lesson_id: lessonId,
    student_id: studentId,
    title: titleEl ? titleEl.value : "",
    details: detailsEl ? detailsEl.value : "",
    due_date: dueDateEl ? dueDateEl.value : "",
    status: statusEl ? statusEl.value : "ASSIGNED"
  });

  if (!result || result.ok === false) {
    const errors = result?.errors || ["Unable to save homework."];
    notifyUser({
      title: "Homework Save",
      message: errors.join(" "),
      tone: "error",
      source: "lessons"
    });
    return;
  }

  if (selectedStudentId) {
    renderProfileHomeworkTab(selectedStudentId);
  }

  editingHomeworkId = null;
  activeLessonDetailTab = "homework";
  openLessonDetailModal(lessonId);
  notifyUser({
    title: wasEditingHomework ? "Homework Updated" : "Homework Added",
    message: "Homework is saved and linked to this lesson.",
    tone: "success",
    source: "lessons"
  });
}

/*********************************
 * NOTE + RICH TEXT HELPERS
 *********************************/
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeRichText(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(html || "");

  const allowedTags = new Set([
    "B", "STRONG",
    "I", "EM",
    "U",
    "UL", "OL", "LI",
    "P", "BR", "DIV"
  ]);

  const cleanNode = (node) => {
    const children = Array.from(node.childNodes);

    children.forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!allowedTags.has(child.tagName)) {
          const fragment = document.createDocumentFragment();
          while (child.firstChild) {
            fragment.appendChild(child.firstChild);
          }
          child.replaceWith(fragment);
          return;
        }

        Array.from(child.attributes).forEach((attr) => {
          child.removeAttribute(attr.name);
        });

        cleanNode(child);
      }
    });
  };

  cleanNode(wrapper);
  return wrapper.innerHTML;
}

function normalizeEditorHtml(html) {
  const cleaned = sanitizeRichText(html || "").trim();
  return cleaned === "<br>" ? "" : cleaned;
}

function execNoteCommand(command) {
  document.execCommand(command, false, null);
}

function setNoteBulletList() {
  document.execCommand("insertUnorderedList", false, null);
}

function getNextNoteId() {
  const year = String(new Date().getFullYear());

  const maxId = getNoteRecords().reduce((max, note) => {
    const match = String(note.note_id || "").match(/^NOTE-(\d{4})-(\d{6})$/);
    if (!match) return max;
    if (match[1] !== year) return max;
    return Math.max(max, Number(match[2]));
  }, 0);

  return `NOTE-${year}-${String(maxId + 1).padStart(6, "0")}`;
}

function upsertLessonNote({ lesson_id, title, body, status }) {
  const lesson = getSchemaLessonById(lesson_id);
  if (!lesson) {
    return { ok: false, errors: ["Lesson not found."] };
  }

  const normalizedStatus = normalizeNoteStatus(status || "DRAFT");
  const cleanTitle = String(title || "").trim() || lesson.topic || "Lesson Note";
  const cleanBody = String(body || "").trim();

  const existing = getLessonNoteByLessonId(lesson_id);

  if (existing) {
    const updated = patchRecordById("notes", existing.note_id, {
      title: cleanTitle,
      body: cleanBody,
      status: normalizedStatus,
      student_id: lesson.student_id,
      updated_at: new Date().toISOString(),
      published_at:
        normalizedStatus === "PUBLISHED"
          ? (existing.published_at || new Date().toISOString())
          : normalizedStatus === "DRAFT" || normalizedStatus === "NO_NOTES"
            ? null
            : existing.published_at || null
    });

    return { ok: true, note: updated };
  }

  const newNote = {
    note_id: getNextNoteId(),
    lesson_id,
    student_id: lesson.student_id,
    status: normalizedStatus,
    title: cleanTitle,
    body: cleanBody,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    published_at: normalizedStatus === "PUBLISHED" ? new Date().toISOString() : null
  };

  insertRecord("notes", newNote, { prepend: true });

  return { ok: true, note: newNote };
}

function stripHtmlForPreview(html) {
  const temp = document.createElement("div");
  temp.innerHTML = String(html || "");
  return temp.textContent || temp.innerText || "";
}

function getFirstLines(text, lineCount = 10) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n");

  return lines.slice(0, lineCount).join("\n").trim();
}

function formatPreviewTextAsHtml(text) {
  return escapeHtml(String(text || "")).replace(/\n/g, "<br>");
}

function normalizeNoteStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();

  if (normalized === "NO_NOTES" || normalized === "NO NOTES" || normalized === "NONE") return "NO_NOTES";
  if (normalized === "PUBLISHED" || normalized === "PUBLISH") return "PUBLISHED";
  if (normalized === "ARCHIVED" || normalized === "ARCHIVE") return "ARCHIVED";
  return "DRAFT";
}

function getNoteStatusLabel(status) {
  const normalized = normalizeNoteStatus(status);

  if (normalized === "NO_NOTES") return "No Notes";
  if (normalized === "PUBLISHED") return "Published";
  if (normalized === "ARCHIVED") return "Archived";
  return "Draft";
}

function getNoteStatusBadge(status) {
  const normalized = normalizeNoteStatus(status);

  if (normalized === "NO_NOTES") return "bg-blue-100 text-blue-700";
  if (normalized === "PUBLISHED") return "bg-sage/10 text-sage";
  if (normalized === "ARCHIVED") return "bg-warmgray/10 text-warmgray";
  return "bg-gold/10 text-gold";
}

function getNoteStateGuidance(status) {
  const normalized = normalizeNoteStatus(status);

  if (normalized === "NO_NOTES") {
    return "Use this when no written note needs to be sent for the lesson. It counts as complete for follow-up but stays admin-only.";
  }

  if (normalized === "PUBLISHED") {
    return "This note is student-ready and counts as complete for follow-up.";
  }

  if (normalized === "ARCHIVED") {
    return "This note is preserved for history but does not count as the published student version.";
  }

  return "This note is still in progress and needs to be published to complete follow-up.";
}

function getQueueNoteStateMeta(noteStatus) {
  if (noteStatus === "MISSING") {
    return {
      label: "Missing",
      badge: "bg-burgundy/10 text-burgundy",
      actionLabel: "Write Note"
    };
  }

  const normalized = normalizeNoteStatus(noteStatus);

  if (normalized === "NO_NOTES") {
    return {
      label: "No Notes",
      badge: "bg-blue-100 text-blue-700",
      actionLabel: "View Decision"
    };
  }

  if (normalized === "PUBLISHED") {
    return {
      label: "Published",
      badge: "bg-sage/10 text-sage",
      actionLabel: "View Note"
    };
  }

  if (normalized === "ARCHIVED") {
    return {
      label: "Archived",
      badge: "bg-warmgray/10 text-warmgray",
      actionLabel: "Review Note"
    };
  }

  return {
    label: "Draft",
    badge: "bg-gold/10 text-gold",
    actionLabel: "Finish Draft"
  };
}

function getMaterialStatusBadge(status) {
  return String(status || "").toLowerCase() === "vaulted"
    ? "bg-warmgray/10 text-warmgray"
    : "bg-sage/10 text-sage";
}

function getMaterialStatusLabel(status) {
  return String(status || "").toLowerCase() === "vaulted" ? "Vaulted" : "Active";
}

function normalizeMaterialSourceType(value) {
  return String(value || "").trim().toUpperCase() === "LINK" ? "LINK" : "FILE";
}

function normalizeMaterialKind(value, sourceType = "FILE") {
  const normalized = String(value || "").trim().toUpperCase();
  const allowed = ["DOCUMENT", "VIDEO", "IMAGE", "LINK", "AUDIO", "OTHER"];
  if (allowed.includes(normalized)) return normalized;
  return sourceType === "LINK" ? "LINK" : "DOCUMENT";
}

function normalizeMaterialScope(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const allowed = ["ACTOR_MATERIAL", "LESSON_MATERIAL", "HOMEWORK_MATERIAL", "STUDIO_RESOURCE", "OTHER"];
  return allowed.includes(normalized) ? normalized : "LESSON_MATERIAL";
}

function normalizeMaterialVisibility(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const allowed = ["ADMIN_ONLY", "STUDENT_VISIBLE", "HIDDEN"];
  return allowed.includes(normalized) ? normalized : "ADMIN_ONLY";
}

function getMaterialKindLabel(kind) {
  const labels = {
    DOCUMENT: "Document",
    VIDEO: "Video",
    IMAGE: "Image",
    LINK: "Link",
    AUDIO: "Audio",
    OTHER: "Other"
  };

  return labels[normalizeMaterialKind(kind)] || "Document";
}

function getMaterialScopeLabel(scope) {
  const labels = {
    ACTOR_MATERIAL: "Actor Material",
    LESSON_MATERIAL: "Lesson Material",
    HOMEWORK_MATERIAL: "Homework Material",
    STUDIO_RESOURCE: "Studio Resource",
    OTHER: "Other"
  };

  return labels[normalizeMaterialScope(scope)] || "Lesson Material";
}

function getMaterialVisibilityLabel(visibility) {
  const labels = {
    ADMIN_ONLY: "Admin Only",
    STUDENT_VISIBLE: "Student Visible",
    HIDDEN: "Hidden"
  };

  return labels[normalizeMaterialVisibility(visibility)] || "Admin Only";
}

function getMaterialVisibilityBadge(visibility) {
  const normalized = normalizeMaterialVisibility(visibility);

  if (normalized === "STUDENT_VISIBLE") return "bg-sage/10 text-sage";
  if (normalized === "HIDDEN") return "bg-warmgray/10 text-warmgray";
  return "bg-gold/10 text-gold";
}

function getMaterialSourceLabel(sourceType) {
  return normalizeMaterialSourceType(sourceType) === "LINK" ? "Link" : "Upload";
}

function getMaterialCategoryOptionsMarkup(selectedCategory = "") {
  const groups = [
    {
      label: "Actor Materials",
      options: ["Resume", "Headshot", "Reel", "Self Tape", "Audition Material"]
    },
    {
      label: "Coaching Materials",
      options: ["Scene", "Sides", "Script", "Homework"]
    },
    {
      label: "Resources",
      options: ["Resource", "Coach Reference", "Other"]
    }
  ];

  return groups.map((group) => `
    <optgroup label="${group.label}">
      ${group.options.map((option) => `
        <option value="${option}" ${String(selectedCategory || "") === option ? "selected" : ""}>${option}</option>
      `).join("")}
    </optgroup>
  `).join("");
}

function getDefaultScopeForMaterialCategory(category) {
  const normalized = String(category || "").trim().toLowerCase();

  if (["resume", "headshot", "reel", "self tape", "audition material"].includes(normalized)) {
    return "ACTOR_MATERIAL";
  }

  if (normalized === "homework") {
    return "HOMEWORK_MATERIAL";
  }

  if (["scene", "sides", "script"].includes(normalized)) {
    return "LESSON_MATERIAL";
  }

  if (["resource", "coach reference"].includes(normalized)) {
    return "STUDIO_RESOURCE";
  }

  return "OTHER";
}

function getDefaultKindForMaterialCategory(category, sourceType = "FILE") {
  const normalized = String(category || "").trim().toLowerCase();
  const normalizedSourceType = normalizeMaterialSourceType(sourceType);

  if (normalized === "headshot") return "IMAGE";
  if (["reel", "self tape"].includes(normalized)) return normalizedSourceType === "LINK" ? "VIDEO" : "VIDEO";
  if (["resource"].includes(normalized) && normalizedSourceType === "LINK") return "LINK";
  return normalizedSourceType === "LINK" ? "LINK" : "DOCUMENT";
}

function getDefaultVisibilityForMaterialCategory(category) {
  const normalized = String(category || "").trim().toLowerCase();

  if (["resume", "headshot", "reel"].includes(normalized)) {
    return "STUDENT_VISIBLE";
  }

  return "ADMIN_ONLY";
}

function getMaterialCategoryGroup(row) {
  const scope = normalizeMaterialScope(row?.scope);

  if (scope === "ACTOR_MATERIAL") return "actor";
  if (scope === "LESSON_MATERIAL" || scope === "HOMEWORK_MATERIAL") return "coaching";
  return "resource";
}

function getMaterialCategoryGroupLabel(groupKey) {
  const labels = {
    actor: "Actor Materials",
    coaching: "Lesson & Homework Materials",
    resource: "Resources & References"
  };

  return labels[groupKey] || "Materials";
}

function getPrimaryActorMaterialRow(studentId) {
  const rows = getMaterialRowsByStudentId(studentId)
    .filter((row) => normalizeMaterialScope(row.scope) === "ACTOR_MATERIAL" && String(row.status || "").toLowerCase() !== "vaulted");

  const priority = ["Headshot", "Resume", "Reel", "Self Tape", "Audition Material"];

  return rows.sort((a, b) => {
    const aPriority = priority.indexOf(a.category);
    const bPriority = priority.indexOf(b.category);
    const safeAPriority = aPriority === -1 ? 999 : aPriority;
    const safeBPriority = bPriority === -1 ? 999 : bPriority;

    if (safeAPriority !== safeBPriority) {
      return safeAPriority - safeBPriority;
    }

    return new Date(b.uploaded_at || 0).getTime() - new Date(a.uploaded_at || 0).getTime();
  })[0] || null;
}

function getLatestCoachingMaterialRow(studentId) {
  return getMaterialRowsByStudentId(studentId)
    .filter((row) => normalizeMaterialScope(row.scope) !== "ACTOR_MATERIAL" && String(row.status || "").toLowerCase() !== "vaulted")
    .sort((a, b) => new Date(b.uploaded_at || 0).getTime() - new Date(a.uploaded_at || 0).getTime())[0] || null;
}

function getMaterialDisplayName(file) {
  return String(file?.title || file?.file_name || "").trim() || "Untitled Material";
}

function getMaterialSourceUrl(file) {
  return String(file?.external_url || file?.file_url || "").trim();
}

function getMaterialActionLabel(file) {
  const sourceType = normalizeMaterialSourceType(file?.source_type);
  const kind = normalizeMaterialKind(file?.material_kind, sourceType);

  if (sourceType === "LINK") {
    if (kind === "VIDEO") return "Open Video";
    return "Open Link";
  }

  return "Open File";
}

function getMaterialInputHint(file) {
  const sourceType = normalizeMaterialSourceType(file?.source_type);
  const url = getMaterialSourceUrl(file);

  if (sourceType === "LINK") {
    return url ? "Saved as a reusable external link." : "Paste a YouTube, Google Drive, or other shareable URL.";
  }

  if (file?.file_name) {
    return "Uploaded files stay available for this mock session and can later be persisted to cloud storage.";
  }

  return "Choose a local file for the current session, or switch to Link for external resources.";
}

function getNextFileId() {
  const year = String(new Date().getFullYear());

  const maxId = getFileRecords().reduce((max, file) => {
    const match = String(file.file_id || "").match(/^FILE-(\d{4})-(\d{6})$/);
    if (!match) return max;
    if (match[1] !== year) return max;
    return Math.max(max, Number(match[2]));
  }, 0);

  return `FILE-${year}-${String(maxId + 1).padStart(6, "0")}`;
}

function getMaterialRowsByStudentId(studentId) {
  return getFilesByStudentId(studentId)
    .slice()
    .sort((a, b) => new Date(b.uploaded_at || 0).getTime() - new Date(a.uploaded_at || 0).getTime())
    .map((file) => {
      const lesson = file.lesson_id ? getSchemaLessonById(file.lesson_id) : null;
      const homework = file.homework_id ? getHomeworkById(file.homework_id) : null;
      const lessonLabel = lesson ? `${formatLongDate(lesson.scheduled_start)} · ${lesson.topic || "Lesson"}` : "";
      const homeworkLabel = homework ? `Homework · ${homework.title || "Untitled Homework"}` : "";

      return {
        ...file,
        display_name: getMaterialDisplayName(file),
        source_label: getMaterialSourceLabel(file.source_type),
        source_url: getMaterialSourceUrl(file),
        action_label: getMaterialActionLabel(file),
        kind_label: getMaterialKindLabel(file.material_kind),
        scope_label: getMaterialScopeLabel(file.scope),
        visibility_label: getMaterialVisibilityLabel(file.visibility),
        visibility_badge: getMaterialVisibilityBadge(file.visibility),
        status_label: getMaterialStatusLabel(file.status),
        status_badge: getMaterialStatusBadge(file.status),
        group_key: getMaterialCategoryGroup(file),
        group_label: getMaterialCategoryGroupLabel(getMaterialCategoryGroup(file)),
        lesson_label: lessonLabel || homeworkLabel || "General studio material",
        homework_label: homeworkLabel,
        lesson_detail_label: lessonLabel
      };
    });
}

function upsertMaterialRecord({
  file_id,
  student_id,
  lesson_id,
  homework_id,
  file_name,
  title,
  source_type,
  external_url,
  file_url,
  mime_type,
  material_kind,
  category,
  scope,
  visibility,
  notes,
  status,
  uploaded_at
}) {
  const cleanStudentId = String(student_id || "").trim();
  const cleanLessonId = String(lesson_id || "").trim();
  const cleanHomeworkId = String(homework_id || "").trim();
  const cleanFileName = String(file_name || "").trim();
  const cleanTitle = String(title || "").trim();
  const normalizedSourceType = normalizeMaterialSourceType(source_type);
  const cleanExternalUrl = String(external_url || "").trim();
  const cleanFileUrl = String(file_url || "").trim();
  const cleanMimeType = String(mime_type || "").trim();
  const normalizedKind = normalizeMaterialKind(material_kind, normalizedSourceType);
  const cleanCategory = String(category || "").trim();
  const normalizedScope = normalizeMaterialScope(scope);
  const normalizedVisibility = normalizeMaterialVisibility(visibility);
  const cleanNotes = String(notes || "").trim();
  const normalizedStatus = String(status || "Active").toLowerCase() === "vaulted" ? "Vaulted" : "Active";
  const cleanUploadedAt = String(uploaded_at || "").trim() || new Date().toISOString().slice(0, 10);

  if (!cleanStudentId) return { ok: false, errors: ["Student is required."] };
  if (!cleanTitle && !cleanFileName) return { ok: false, errors: ["A material title or file name is required."] };
  if (!cleanCategory) return { ok: false, errors: ["Category is required."] };

  if (normalizedSourceType === "LINK" && !cleanExternalUrl) {
    return { ok: false, errors: ["Link materials need a valid URL."] };
  }

  if (normalizedSourceType === "FILE" && !cleanFileName) {
    return { ok: false, errors: ["Uploaded materials need a file name."] };
  }

  const finalLessonId = normalizedScope === "LESSON_MATERIAL" || normalizedScope === "HOMEWORK_MATERIAL"
    ? cleanLessonId
    : "";
  const finalHomeworkId = normalizedScope === "HOMEWORK_MATERIAL"
    ? cleanHomeworkId
    : "";

  if (finalLessonId) {
    const lesson = getSchemaLessonById(finalLessonId);
    if (!lesson || lesson.student_id !== cleanStudentId) {
      return { ok: false, errors: ["Linked lesson must belong to the same student."] };
    }
  }

  if (finalHomeworkId) {
    const homework = getHomeworkById(finalHomeworkId);
    if (!homework || homework.student_id !== cleanStudentId) {
      return { ok: false, errors: ["Linked homework must belong to the same student."] };
    }

    if (finalLessonId && homework.lesson_id !== finalLessonId) {
      return { ok: false, errors: ["Linked homework must belong to the selected lesson."] };
    }
  }

  const existing = file_id ? getFileById(file_id) : null;

  if (existing) {
    const updated = patchRecordById("files", file_id, {
      student_id: cleanStudentId,
      lesson_id: finalLessonId || null,
      homework_id: finalHomeworkId || null,
      file_name: cleanFileName || existing.file_name || "",
      title: cleanTitle,
      source_type: normalizedSourceType,
      external_url: normalizedSourceType === "LINK" ? cleanExternalUrl : "",
      file_url: normalizedSourceType === "FILE" ? cleanFileUrl : "",
      mime_type: normalizedSourceType === "FILE" ? cleanMimeType : "",
      material_kind: normalizedKind,
      category: cleanCategory,
      scope: normalizedScope,
      visibility: normalizedVisibility,
      notes: cleanNotes,
      status: normalizedStatus,
      uploaded_at: cleanUploadedAt
    });

    return { ok: true, file: updated };
  }

  const newFile = {
    file_id: getNextFileId(),
    student_id: cleanStudentId,
    lesson_id: finalLessonId || null,
    homework_id: finalHomeworkId || null,
    file_name: cleanFileName,
    title: cleanTitle,
    source_type: normalizedSourceType,
    external_url: normalizedSourceType === "LINK" ? cleanExternalUrl : "",
    file_url: normalizedSourceType === "FILE" ? cleanFileUrl : "",
    mime_type: normalizedSourceType === "FILE" ? cleanMimeType : "",
    material_kind: normalizedKind,
    category: cleanCategory,
    scope: normalizedScope,
    visibility: normalizedVisibility,
    notes: cleanNotes,
    status: normalizedStatus,
    uploaded_at: cleanUploadedAt
  };

  insertRecord("files", newFile, { prepend: true });

  return { ok: true, file: newFile };
}

function archiveMaterial(fileId) {
  const file = getFileById(fileId);
  if (!file) return;

  patchRecordById("files", fileId, {
    status: "Vaulted"
  });

  if (selectedStudentId) {
    populateStudentProfile(selectedStudentId);
  }
}

function restoreMaterial(fileId) {
  const file = getFileById(fileId);
  if (!file) return;

  patchRecordById("files", fileId, {
    status: "Active"
  });

  if (selectedStudentId) {
    populateStudentProfile(selectedStudentId);
  }
}

function deleteMaterialPermanently(fileId) {
  const file = getFileById(fileId);
  if (!file) return;

  if (String(file.status || "").toLowerCase() !== "vaulted") {
    notifyUser({
      title: "Materials Vault",
      message: "Only vaulted materials can be permanently deleted.",
      tone: "error",
      source: "materials"
    });
    return;
  }

  const confirmed = confirm(`Permanently delete "${getMaterialDisplayName(file)}" from the vault? This cannot be undone.`);
  if (!confirmed) return;

  removeRecordById("files", fileId);

  if (activeLessonDetailId) {
    openLessonDetailModal(activeLessonDetailId);
    return;
  }

  if (selectedStudentId) {
    populateStudentProfile(selectedStudentId);
  }

  notifyUser({
    title: "Material Deleted",
    message: `${getMaterialDisplayName(file)} was permanently removed from the vault.`,
    tone: "success",
    source: "materials"
  });
}

function toggleProfileMaterialsVault() {
  showProfileMaterialsVault = !showProfileMaterialsVault;
  if (selectedStudentId) {
    renderProfileMaterialsTab(selectedStudentId);
  }
}

function getNoteSortTime(note) {
  return new Date(note?.published_at || note?.updated_at || note?.created_at || 0).getTime();
}

function getNoteCountsByStatus(notes) {
  return notes.reduce((counts, note) => {
    const status = normalizeNoteStatus(note.status);
    if (typeof counts[status] === "number") {
      counts[status] += 1;
    }
    return counts;
  }, {
    DRAFT: 0,
    NO_NOTES: 0,
    PUBLISHED: 0,
    ARCHIVED: 0
  });
}

function getNoteLastActivityLabel(note) {
  const status = normalizeNoteStatus(note?.status);

  if (status === "NO_NOTES") {
    if (note?.updated_at) {
      return `Marked no notes ${formatLongDate(note.updated_at)}`;
    }
    return "Marked no notes";
  }

  if (status === "PUBLISHED" && note?.published_at) {
    return `Published ${formatLongDate(note.published_at)}`;
  }

  if (note?.updated_at) {
    return `Updated ${formatLongDate(note.updated_at)}`;
  }

  if (note?.created_at) {
    return `Created ${formatLongDate(note.created_at)}`;
  }

  if (status === "ARCHIVED") {
    return "Archived";
  }

  return "Draft";
}

function getNoteAgeInDays(note) {
  const reference = note?.updated_at || note?.created_at || note?.published_at;
  if (!reference) return 0;

  const ms = startOfDay(APP_NOW).getTime() - startOfDay(reference).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function getStaleDraftNotesByStudentId(studentId, minDays = 7) {
  return getNotesByStudentId(studentId).filter((note) => {
    return normalizeNoteStatus(note.status) === "DRAFT" && getNoteAgeInDays(note) >= minDays;
  });
}

function resetProfileNotesVisibleCount() {
  profileNotesVisibleCount = 3;
}

function showMoreProfileNotes() {
  profileNotesVisibleCount += 3;
  if (selectedStudentId) {
    renderProfileNotesTab(selectedStudentId);
    lucide.createIcons();
  }
}

function hideProfileNotes() {
  profileNotesVisibleCount = 3;
  if (selectedStudentId) {
    renderProfileNotesTab(selectedStudentId);
    lucide.createIcons();
  }
}

function setProfileNotesFilter(filter) {
  currentProfileNotesFilter = filter || "all";
  resetProfileNotesVisibleCount();

  if (selectedStudentId) {
    renderProfileNotesTab(selectedStudentId);
    lucide.createIcons();
  }
}

function getNoteQueueUrgencyMeta(hoursSinceLesson, noteStatus) {
  const normalizedStatus = normalizeNoteStatus(noteStatus);

  if (normalizedStatus === "NO_NOTES") {
    return {
      key: "complete",
      label: "Complete",
      badge: "bg-blue-100 text-blue-700",
      sortWeight: 4
    };
  }

  if (normalizedStatus === "PUBLISHED") {
    return {
      key: "published",
      label: "Published",
      badge: "bg-sage/10 text-sage",
      sortWeight: 4
    };
  }

  if (hoursSinceLesson > 48) {
    return {
      key: "overdue",
      label: "Overdue",
      badge: "bg-burgundy/10 text-burgundy",
      sortWeight: 1
    };
  }

  if (hoursSinceLesson >= 36) {
    return {
      key: "due-now",
      label: "Due Now",
      badge: "bg-gold/10 text-gold",
      sortWeight: 2
    };
  }

  return {
    key: "within-window",
    label: "Within 48 Hours",
    badge: "bg-blue-100 text-blue-700",
    sortWeight: 3
  };
}

function getHoursSinceLesson(dateString) {
  if (!dateString) return 0;
  const lessonTime = new Date(dateString).getTime();
  if (Number.isNaN(lessonTime)) return 0;
  return Math.max(0, Math.floor((APP_NOW.getTime() - lessonTime) / (1000 * 60 * 60)));
}

function isLessonWithinNotesWindow(lesson, maxDays = 14) {
  const referenceDate = getLessonReferenceDate(lesson);
  if (!referenceDate) return false;

  const lessonTime = new Date(referenceDate).getTime();
  if (Number.isNaN(lessonTime)) return false;

  const diffDays = (APP_NOW.getTime() - lessonTime) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= maxDays;
}

function getCompletedLessonsNeedingNotesRows() {
  return getLessonRecords()
    .filter((lesson) => doesLessonRequireNotes(lesson) && isLessonWithinNotesWindow(lesson, 14))
    .map((lesson) => {
      const student = getSchemaStudentById(lesson.student_id);
      const note = getLessonNoteByLessonId(lesson.lesson_id);
      const noteStatus = note ? normalizeNoteStatus(note.status) : "MISSING";
      const noteStateMeta = getQueueNoteStateMeta(noteStatus);
      const hoursSinceLesson = getHoursSinceLesson(getLessonReferenceDate(lesson));
      const urgency = getNoteQueueUrgencyMeta(hoursSinceLesson, noteStatus);
      const actionRequired = noteStatus !== "PUBLISHED" && noteStatus !== "NO_NOTES";

      return {
        lesson_id: lesson.lesson_id,
        student_id: lesson.student_id,
        student_name: student ? student.full_name : "Unknown Student",
        lesson_topic: lesson.topic || "Untitled Lesson",
        lesson_type: lesson.lesson_type || "General Coaching",
        lesson_date: lesson.scheduled_start || "",
        completion_date: getLessonReferenceDate(lesson),
        hours_since_lesson: hoursSinceLesson,
        note_id: note?.note_id || "",
        note_status: noteStatus,
        note_status_label: noteStateMeta.label,
        note_status_badge: noteStateMeta.badge,
        queue_action_label: noteStateMeta.actionLabel,
        note_title: note?.title || "",
        note_activity_label: note ? getNoteLastActivityLabel(note) : "No note created yet",
        urgency_key: urgency.key,
        urgency_label: urgency.label,
        urgency_badge: urgency.badge,
        urgency_sort: urgency.sortWeight,
        action_required: actionRequired,
        search_blob: `${student?.full_name || ""} ${lesson.topic || ""} ${lesson.lesson_id} ${note?.title || ""} ${noteStatus}`.toLowerCase()
      };
    })
    .sort((a, b) => {
      if (a.action_required !== b.action_required) return a.action_required ? -1 : 1;
      if (a.urgency_sort !== b.urgency_sort) return a.urgency_sort - b.urgency_sort;
      return new Date(b.completion_date || 0).getTime() - new Date(a.completion_date || 0).getTime();
    });
}

function getFilteredNotesQueueRows() {
  let rows = getCompletedLessonsNeedingNotesRows();

  if (currentNotesQueueFilter !== "all") {
    rows = rows.filter((row) => row.urgency_key === currentNotesQueueFilter);
  }

  if (currentNotesQueueSearchQuery) {
    const query = currentNotesQueueSearchQuery.toLowerCase();
    rows = rows.filter((row) => row.search_blob.includes(query));
  }

  return rows;
}

function setNotesQueueFilter(filter) {
  currentNotesQueueFilter = filter || "all";
  renderNotesQueuePage();
}

function setNotesQueueSearchQuery(value) {
  currentNotesQueueSearchQuery = String(value || "").trimStart();
  renderNotesQueueResults();
}

function resetNotesQueueFilters() {
  currentNotesQueueFilter = "all";
  currentNotesQueueSearchQuery = "";
  renderNotesQueuePage();
}

function getNotesQueueFilterPills() {
  const pills = [];
  if (currentNotesQueueFilter !== "all") {
    const labelMap = {
      overdue: "Overdue",
      "due-now": "Due Now",
      "within-window": "Within 48h",
      published: "Published"
    };
    pills.push(getStatusFilterPill("Filter", labelMap[currentNotesQueueFilter] || currentNotesQueueFilter));
  }
  if (currentNotesQueueSearchQuery) {
    pills.push(getStatusFilterPill("Search", currentNotesQueueSearchQuery));
  }
  return pills;
}

function toggleNotesQueueWorkflow() {
  currentNotesQueueShowWorkflow = !currentNotesQueueShowWorkflow;
  renderNotesQueuePage();
}

function openStudentProfileFromNotesQueue(studentId) {
  selectedStudentId = studentId;
  navigateTo("profile");
}

function closeNoteWorkspaceModal() {
  const modal = document.getElementById("note-workspace-modal-overlay");
  if (modal) modal.remove();
}

function getStudentLessonsForNotes(studentId) {
  return getLessonsByStudentId(studentId).slice();
}

function getNotesWorkspaceLessonOptionsMarkup(studentId, selectedLessonId = "") {
  return getStudentLessonsForNotes(studentId)
    .map((lesson) => {
      const note = getLessonNoteByLessonId(lesson.lesson_id);
      const statusLabel = note ? getNoteStatusLabel(note.status) : "No note";
      const selected = lesson.lesson_id === selectedLessonId ? "selected" : "";
      return `<option value="${lesson.lesson_id}" ${selected}>${escapeHtml(formatLongDate(lesson.scheduled_start))} · ${escapeHtml(lesson.topic || "Untitled Lesson")} · ${escapeHtml(statusLabel)}</option>`;
    })
    .join("");
}

function saveNoteFromWorkspace(studentId, lessonId) {
  const titleEl = document.getElementById("note-workspace-title");
  const statusEl = document.getElementById("note-workspace-status");
  const bodyEl = document.getElementById("note-workspace-body");
  const normalizedStatus = normalizeNoteStatus(statusEl ? statusEl.value : "DRAFT");

  const result = upsertLessonNote({
    lesson_id: lessonId,
    title: titleEl ? titleEl.value : "",
    status: statusEl ? statusEl.value : "DRAFT",
    body: bodyEl ? normalizeEditorHtml(bodyEl.innerHTML) : ""
  });

  if (!result || result.ok === false) {
    const errors = result?.errors || ["Unable to save lesson note."];
    notifyUser({
      title: "Notes Workspace",
      message: errors.join(" "),
      tone: "error",
      source: "notes"
    });
    return;
  }

  renderAppFromSchema();
  openNoteWorkspace(studentId, lessonId);
  notifyUser({
    title: normalizedStatus === "NO_NOTES" ? "No Notes Saved" : "Notes Workspace Saved",
    message: normalizedStatus === "NO_NOTES"
      ? "This lesson is marked as not needing a published note."
      : "The note workspace was saved successfully.",
    tone: "success",
    source: "notes"
  });
}

function openNoteWorkspace(studentId = selectedStudentId, lessonId = null) {
  const resolvedStudentId = studentId || selectedStudentId;
  const student = resolvedStudentId ? getSchemaStudentById(resolvedStudentId) : null;
  if (!student) return;

  closeNoteWorkspaceModal();

  const lessons = getStudentLessonsForNotes(resolvedStudentId);
  if (!lessons.length) {
    notifyUser({
      title: "Notes Workspace",
      message: "This student does not have any lessons yet.",
      tone: "warm",
      source: "notes"
    });
    return;
  }

  const resolvedLessonId = lessonId || lessons[0].lesson_id;
  const lesson = getSchemaLessonById(resolvedLessonId);
  if (!lesson) return;

  const note = getLessonNoteByLessonId(resolvedLessonId);
  const noteStatus = normalizeNoteStatus(note?.status);
  const noteGuidance = getNoteStateGuidance(noteStatus);
  const noteVisibility =
    note && noteStatus === "PUBLISHED"
      ? "Visible to the future student portal"
      : note && noteStatus === "ARCHIVED"
        ? "Hidden from students and kept for history"
        : "Admin-only working draft";

  const overlay = document.createElement("div");
  overlay.id = "note-workspace-modal-overlay";
  overlay.className = "fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4";

  overlay.innerHTML = `
    <div class="app-modal-shell bg-white rounded-2xl border border-cream w-full max-w-5xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
      <div class="app-modal-header flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wider text-warmgray font-medium mb-2">Admin Notes Workspace</p>
          <h3 class="font-display text-2xl font-bold text-warmblack">${escapeHtml(student.full_name)}</h3>
          <p class="text-sm text-warmgray mt-1">Edit notes without leaving the profile flow.</p>
        </div>
        <button type="button" id="close-note-workspace-modal" class="self-start text-sm text-warmgray">Close</button>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
        <div class="space-y-4 min-w-0">
          <div class="rounded-2xl border border-cream bg-parchment p-4">
            <label class="block text-xs font-medium text-warmgray mb-2">Choose Lesson</label>
            <select id="note-workspace-lesson-select" class="w-full rounded-xl border border-cream bg-white px-3 py-2.5 text-sm">
              ${getNotesWorkspaceLessonOptionsMarkup(resolvedStudentId, resolvedLessonId)}
            </select>
          </div>

          <div class="rounded-2xl border border-cream bg-parchment p-4 space-y-3">
            <div>
              <p class="text-[11px] uppercase tracking-wider text-warmgray">Lesson</p>
              <p class="text-sm font-semibold text-warmblack mt-1">${escapeHtml(lesson.topic || "Untitled Lesson")}</p>
              <p class="text-xs text-warmgray mt-1">${escapeHtml(formatLongDate(lesson.scheduled_start))} · ${escapeHtml(formatLessonTimeRange(lesson.scheduled_start, lesson.scheduled_end))}</p>
            </div>
            <div>
              <p class="text-[11px] uppercase tracking-wider text-warmgray">Status</p>
              <p class="text-sm mt-1"><span class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full ${note ? getNoteStatusBadge(note.status) : "bg-warmgray/10 text-warmgray"}">${escapeHtml(note ? getNoteStatusLabel(note.status) : "Not Started")}</span></p>
            </div>
            <div>
              <p class="text-[11px] uppercase tracking-wider text-warmgray">Visibility</p>
              <p class="text-sm text-warmblack mt-1">${escapeHtml(noteVisibility)}</p>
            </div>
            <div>
              <p class="text-[11px] uppercase tracking-wider text-warmgray">Last Activity</p>
              <p class="text-sm text-warmblack mt-1">${escapeHtml(note ? getNoteLastActivityLabel(note) : "No note saved yet")}</p>
            </div>
            <div>
              <p class="text-[11px] uppercase tracking-wider text-warmgray">State Guidance</p>
              <p class="text-sm text-warmblack mt-1">${escapeHtml(note ? noteGuidance : "Start with a draft, then publish when it is ready to send out.")}</p>
            </div>
          </div>

          <div class="rounded-2xl border border-cream bg-white p-4">
            <p class="text-[11px] uppercase tracking-wider text-warmgray mb-2">Quick Actions</p>
            <div class="flex flex-wrap gap-2">
              <button type="button" id="note-workspace-open-lesson-detail" class="px-3 py-2 rounded-lg bg-parchment border border-cream text-xs font-medium text-warmblack">Lesson Detail</button>
              <button type="button" id="note-workspace-edit-lesson" class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack">Edit Lesson</button>
            </div>
          </div>
        </div>

        <div class="space-y-4 min-w-0">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-warmgray mb-1">Note Title</label>
              <input id="note-workspace-title" type="text" value="${escapeHtml(note?.title || lesson.topic || "Lesson Note")}" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
            </div>
            <div>
              <label class="block text-xs font-medium text-warmgray mb-1">Note Status</label>
              <select id="note-workspace-status" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
                <option value="DRAFT" ${noteStatus === "DRAFT" ? "selected" : ""}>Draft</option>
                <option value="NO_NOTES" ${noteStatus === "NO_NOTES" ? "selected" : ""}>No Notes</option>
                <option value="PUBLISHED" ${noteStatus === "PUBLISHED" ? "selected" : ""}>Published</option>
                <option value="ARCHIVED" ${noteStatus === "ARCHIVED" ? "selected" : ""}>Archived</option>
              </select>
              <p class="text-xs text-warmgray mt-1">${escapeHtml(noteGuidance)}</p>
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-2">Note Body</label>
            <div class="flex flex-wrap gap-2 mb-2">
              <button type="button" onclick="execNoteCommand('bold')" class="px-3 py-1.5 rounded-lg bg-white border border-cream text-xs font-medium">Bold</button>
              <button type="button" onclick="execNoteCommand('italic')" class="px-3 py-1.5 rounded-lg bg-white border border-cream text-xs font-medium">Italic</button>
              <button type="button" onclick="execNoteCommand('underline')" class="px-3 py-1.5 rounded-lg bg-white border border-cream text-xs font-medium">Underline</button>
              <button type="button" onclick="setNoteBulletList()" class="px-3 py-1.5 rounded-lg bg-white border border-cream text-xs font-medium">Bullets</button>
            </div>
            <div id="note-workspace-body" contenteditable="true" class="h-[360px] w-full overflow-y-auto rounded-xl border border-cream bg-parchment px-3 py-3 text-sm focus:outline-none">${note?.body || ""}</div>
          </div>

          <div class="rounded-xl border border-cream bg-parchment p-3">
            <p class="text-xs font-medium uppercase tracking-wider text-warmgray mb-1">Coach Note</p>
            <p class="text-sm text-warmblack wrap-anywhere">${escapeHtml(lesson.internal_comments || "No internal comments saved yet.")}</p>
          </div>

          <div class="app-modal-footer flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3">
            <button type="button" id="cancel-note-workspace-btn" class="px-4 py-2.5 rounded-xl border border-cream bg-parchment text-sm font-medium text-warmgray">Close</button>
            <button type="button" id="save-note-workspace-btn" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">Save Note</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = document.getElementById("close-note-workspace-modal");
  const cancelBtn = document.getElementById("cancel-note-workspace-btn");
  const saveBtn = document.getElementById("save-note-workspace-btn");
  const lessonSelect = document.getElementById("note-workspace-lesson-select");
  const openLessonDetailBtn = document.getElementById("note-workspace-open-lesson-detail");
  const editLessonBtn = document.getElementById("note-workspace-edit-lesson");

  if (closeBtn) closeBtn.onclick = closeNoteWorkspaceModal;
  if (cancelBtn) cancelBtn.onclick = closeNoteWorkspaceModal;
  if (saveBtn) saveBtn.onclick = () => saveNoteFromWorkspace(resolvedStudentId, resolvedLessonId);
  if (lessonSelect) lessonSelect.onchange = () => openNoteWorkspace(resolvedStudentId, lessonSelect.value);
  if (openLessonDetailBtn) {
    openLessonDetailBtn.onclick = () => {
      closeNoteWorkspaceModal();
      openLessonDetailModal(resolvedLessonId);
    };
  }
  if (editLessonBtn) {
    editLessonBtn.onclick = () => {
      closeNoteWorkspaceModal();
      openLessonModal("edit", resolvedLessonId);
    };
  }

  lucide.createIcons();
}

/*********************************
 * FINANCE HELPERS
 *********************************/
function isPackageArchived(pkg) {
  return Boolean(pkg && pkg.archived_at);
}

function isPaymentArchived(payment) {
  return Boolean(payment && payment.archived_at);
}

function isPaymentCountedAsPaid(payment) {
  return String(payment?.status || "").toLowerCase() === "paid" && !isPaymentArchived(payment);
}

function getPackagesByStudentId(studentId, options = {}) {
  const includeArchived = options.includeArchived === true;

  return getPackageRecords()
    .filter((pkg) => pkg.student_id === studentId && (includeArchived || !isPackageArchived(pkg)))
    .sort((a, b) => {
      const aTime = a.expires_on ? new Date(a.expires_on).getTime() : 0;
      const bTime = b.expires_on ? new Date(b.expires_on).getTime() : 0;
      return bTime - aTime;
    });
}

function getCurrentPackageByStudentId(studentId) {
  const packages = getPackagesByStudentId(studentId);

  if (!packages.length) return null;

  return (
    packages.find((pkg) => String(pkg.status || "").toLowerCase() === "active") ||
    packages.find((pkg) => Number(pkg.sessions_remaining || 0) > 0) ||
    packages[0]
  );
}

function getPaymentsByStudentId(studentId, options = {}) {
  const includeArchived = options.includeArchived === true;

  return getPaymentRecords()
    .filter((payment) => payment.student_id === studentId && (includeArchived || !isPaymentArchived(payment)))
    .sort((a, b) => {
      const aTime = a.payment_date ? new Date(a.payment_date).getTime() : 0;
      const bTime = b.payment_date ? new Date(b.payment_date).getTime() : 0;
      return bTime - aTime;
    });
}

function getCompletedPackageLessonsCount(studentId) {
  return getLessonRecords().filter((lesson) => {
    return lesson.student_id === studentId && doesLessonConsumePackage(lesson);
  }).length;
}

function getCompletedPaygLessonsCount(studentId) {
  return getLessonRecords().filter((lesson) => {
    return lesson.student_id === studentId && isLessonPaygBillable(lesson);
  }).length;
}

function getResolvedPackageUsage(studentId, pkg) {
  if (!pkg) {
    return {
      total: 0,
      used: 0,
      remaining: 0
    };
  }

  const total = Number(pkg.sessions_total || 0);
  const schemaUsed = Number(pkg.sessions_used || 0);
  const schemaRemaining = Number(pkg.sessions_remaining || Math.max(total - schemaUsed, 0));
  const countedCompletedLessons = getCompletedPackageLessonsCount(studentId);

  const used = Math.max(schemaUsed, countedCompletedLessons);
  const remaining = Math.max(0, Math.min(schemaRemaining, total - used >= 0 ? total - used : schemaRemaining));

  return {
    total,
    used,
    remaining
  };
}

function getPackageLinkedPaidTotal(packageId, excludePaymentId = null) {
  return getPaymentRecords().reduce((sum, payment) => {
    if (excludePaymentId && payment.payment_id === excludePaymentId) return sum;
    if (payment.related_package_id !== packageId) return sum;
    if (!isPaymentCountedAsPaid(payment)) return sum;
    return sum + Number(payment.amount || 0);
  }, 0);
}

function getUnlinkedPaidTotalByStudentId(studentId, excludePaymentId = null) {
  return getPaymentRecords().reduce((sum, payment) => {
    if (excludePaymentId && payment.payment_id === excludePaymentId) return sum;
    if (payment.student_id !== studentId) return sum;
    if (payment.related_package_id) return sum;
    if (!isPaymentCountedAsPaid(payment)) return sum;
    return sum + Number(payment.amount || 0);
  }, 0);
}

function getPackageStatusMeta(studentId, pkg) {
  if (!pkg) {
    return {
      label: "No Package",
      badge: "bg-warmgray/10 text-warmgray"
    };
  }

  const usage = getResolvedPackageUsage(studentId, pkg);

  if (usage.remaining <= 0) {
    return {
      label: "Exhausted",
      badge: "bg-burgundy/10 text-burgundy"
    };
  }

  if (pkg.expires_on) {
    const expires = new Date(pkg.expires_on);
    const diffDays = Math.ceil((expires.getTime() - APP_NOW.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays <= 14) {
      return {
        label: "Expiring Soon",
        badge: "bg-gold/10 text-gold"
      };
    }
  }

  return {
    label: "Active",
    badge: "bg-sage/10 text-sage"
  };
}

function formatCurrency(amount, currency = "USD") {
  return Number(amount || 0).toLocaleString("en-US", {
    style: "currency",
    currency: currency || "USD"
  });
}

function getBillingModelLabel(model) {
  const normalized = String(model || "").toUpperCase();

  const labels = {
    PACKAGE: "Package",
    PAYG: "Pay As You Go",
    CUSTOM: "Custom"
  };

  return labels[normalized] || "Custom";
}

function getPaymentStatusBadge(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "paid") return "bg-sage/10 text-sage";
  if (normalized === "pending") return "bg-gold/10 text-gold";
  if (normalized === "failed") return "bg-burgundy/10 text-burgundy";
  if (normalized === "refunded") return "bg-warmgray/10 text-warmgray";
  if (normalized === "archived") return "bg-warmgray/10 text-warmgray";

  return "bg-sage/10 text-sage";
}

function buildFinanceSummary(studentId, schemaStudent) {
  const billingModel = String(schemaStudent?.billing_model || "CUSTOM").toUpperCase();
  const pkg = getCurrentPackageByStudentId(studentId);
  const payments = getPaymentsByStudentId(studentId);
  const packageUsage = getResolvedPackageUsage(studentId, pkg);
  const packageMeta = getPackageStatusMeta(studentId, pkg);

  if (billingModel === "PACKAGE") {
    const owed = Number(pkg?.package_price || 0);
    const paid = pkg ? getPackageLinkedPaidTotal(pkg.package_id) : 0;
    const remainingAmount = Math.max(0, owed - paid);
    const overpaidAmount = Math.max(0, paid - owed);

    return {
      mode: "PACKAGE",
      headline: pkg ? (pkg.package_name || "Package") : "Package Student",
      subline: pkg
        ? `${packageUsage.remaining} session${packageUsage.remaining === 1 ? "" : "s"} remaining`
        : "No active package on file",
      badgeLabel: packageMeta.label,
      badgeClass: packageMeta.badge,
      packageInfo: pkg,
      packageUsage,
      payments,
      owed,
      paid,
      remainingAmount,
      overpaidAmount,
      defaultLessonRate: 0
    };
  }

  if (billingModel === "PAYG") {
    const completedLessons = getCompletedPaygLessonsCount(studentId);
    const rate = Number(schemaStudent?.default_lesson_rate || 0);
    const owed = completedLessons * rate;
    const paid = getUnlinkedPaidTotalByStudentId(studentId);
    const remainingAmount = Math.max(0, owed - paid);
    const overpaidAmount = Math.max(0, paid - owed);

    return {
      mode: "PAYG",
      headline: "Pay As You Go",
      subline: rate
        ? `${completedLessons} completed lesson${completedLessons === 1 ? "" : "s"} at ${formatCurrency(rate)}`
        : "Set a default lesson rate to track balances",
      badgeLabel: "PAYG",
      badgeClass: "bg-blue-100 text-blue-700",
      packageInfo: null,
      packageUsage: null,
      payments,
      owed,
      paid,
      remainingAmount,
      overpaidAmount,
      defaultLessonRate: rate
    };
  }

  const owed = Number(schemaStudent?.custom_balance_due || 0);
  const paid = getUnlinkedPaidTotalByStudentId(studentId);
  const remainingAmount = Math.max(0, owed - paid);
  const overpaidAmount = Math.max(0, paid - owed);

  return {
    mode: "CUSTOM",
    headline: "Custom Billing",
    subline: owed
      ? `Manual balance due tracked at ${formatCurrency(owed)}`
      : "Handled manually or externally",
    badgeLabel: "Custom",
    badgeClass: "bg-amber-100 text-amber-700",
    packageInfo: null,
    packageUsage: null,
    payments,
    owed,
    paid,
    remainingAmount,
    overpaidAmount,
    defaultLessonRate: 0
  };
}
/*********************************
 * FINANCE PAGE HELPERS
 *********************************/
function getFinanceStudentName(studentId) {
  const student = getSchemaStudentById(studentId);
  return student ? student.full_name : "Unknown Student";
}

function getFinanceStudentBillingModel(studentId) {
  const student = getSchemaStudentById(studentId);
  return student ? String(student.billing_model || "CUSTOM").toUpperCase() : "CUSTOM";
}

function getFinanceScopeLabel() {
  return currentFinanceHistoryMode === "history" ? "Archived / History" : "Active";
}

function getFinancePackagesRows() {
  return getPackageRecords()
    .filter((pkg) => currentFinanceHistoryMode === "history" ? isPackageArchived(pkg) : !isPackageArchived(pkg))
    .map((pkg) => {
      const studentName = getFinanceStudentName(pkg.student_id);
      const billingModel = getFinanceStudentBillingModel(pkg.student_id);
      const usage = getResolvedPackageUsage(pkg.student_id, pkg);
      const meta = getPackageStatusMeta(pkg.student_id, pkg);
      const price = Number(pkg.package_price || 0);
      const paid = getPackageLinkedPaidTotal(pkg.package_id);
      const remainingBalance = Math.max(0, price - paid);

      return {
        package_id: pkg.package_id,
        student_id: pkg.student_id,
        student_name: studentName,
        billing_model: billingModel,
        package_name: pkg.package_name || "Package",
        total: usage.total,
        used: usage.used,
        remaining: usage.remaining,
        price,
        paid,
        remaining_balance: remainingBalance,
        expires_on: pkg.expires_on || "",
        archived_at: pkg.archived_at || "",
        badge: currentFinanceHistoryMode === "history" ? "bg-warmgray/10 text-warmgray" : meta.badge,
        status_label: currentFinanceHistoryMode === "history" ? "Archived" : meta.label,
        search_blob: `${studentName} ${billingModel} ${pkg.package_name || ""} ${pkg.package_id || ""}`.toLowerCase()
      };
    });
}

function getFinancePaymentsRows() {
  return getPaymentRecords()
    .filter((payment) => currentFinanceHistoryMode === "history" ? isPaymentArchived(payment) : !isPaymentArchived(payment))
    .map((payment) => {
      const studentName = getFinanceStudentName(payment.student_id);
      const billingModel = getFinanceStudentBillingModel(payment.student_id);
      const linkedPackage = payment.related_package_id ? getPackageById(payment.related_package_id) : null;

      return {
        payment_id: payment.payment_id,
        student_id: payment.student_id,
        student_name: studentName,
        billing_model: billingModel,
        amount: payment.amount,
        currency: payment.currency || "USD",
        payment_date: payment.payment_date || "",
        payment_type: payment.payment_type || "Payment",
        status: currentFinanceHistoryMode === "history" ? "Archived" : String(payment.status || "Paid"),
        status_badge: currentFinanceHistoryMode === "history" ? "bg-warmgray/10 text-warmgray" : getPaymentStatusBadge(payment.status),
        related_package_id: payment.related_package_id || "",
        related_package_name: linkedPackage ? linkedPackage.package_name || linkedPackage.package_id : "",
        archived_at: payment.archived_at || "",
        search_blob: `${studentName} ${billingModel} ${payment.payment_type || ""} ${payment.payment_id || ""}`.toLowerCase()
      };
    });
}

function getFilteredFinancePackagesRows() {
  let rows = getFinancePackagesRows();

  if (currentFinanceBillingFilter !== "all") {
    rows = rows.filter((row) => row.billing_model === currentFinanceBillingFilter);
  }

  if (currentFinanceStatusFilter !== "all") {
    rows = rows.filter((row) => row.status_label.toLowerCase() === currentFinanceStatusFilter.toLowerCase());
  }

  if (currentFinanceSearchQuery) {
    const query = currentFinanceSearchQuery.toLowerCase();
    rows = rows.filter((row) => row.search_blob.includes(query));
  }

  rows.sort((a, b) => {
    const aKey = currentFinanceHistoryMode === "history" ? a.archived_at : a.expires_on;
    const bKey = currentFinanceHistoryMode === "history" ? b.archived_at : b.expires_on;
    const aTime = aKey ? new Date(aKey).getTime() : 0;
    const bTime = bKey ? new Date(bKey).getTime() : 0;
    return bTime - aTime;
  });

  return rows;
}

function getFilteredFinancePaymentsRows() {
  let rows = getFinancePaymentsRows();

  if (currentFinanceBillingFilter !== "all") {
    rows = rows.filter((row) => row.billing_model === currentFinanceBillingFilter);
  }

  if (currentFinanceStatusFilter !== "all") {
    rows = rows.filter((row) => String(row.status || "").toLowerCase() === currentFinanceStatusFilter.toLowerCase());
  }

  if (currentFinanceSearchQuery) {
    const query = currentFinanceSearchQuery.toLowerCase();
    rows = rows.filter((row) => row.search_blob.includes(query));
  }

  rows.sort((a, b) => {
    const aKey = currentFinanceHistoryMode === "history" ? a.archived_at : a.payment_date;
    const bKey = currentFinanceHistoryMode === "history" ? b.archived_at : b.payment_date;
    const aTime = aKey ? new Date(aKey).getTime() : 0;
    const bTime = bKey ? new Date(bKey).getTime() : 0;
    return bTime - aTime;
  });

  return rows;
}

function setFinanceTab(tab) {
  currentFinanceTab = tab;
  currentFinanceStatusFilter = "all";
  renderFinancePage();
}

function openQuickLinkPackages() {
  currentFinanceTab = "packages";
  navigateTo("finance");
}

function setFinanceHistoryMode(mode) {
  currentFinanceHistoryMode = mode === "history" ? "history" : "active";
  currentFinanceStatusFilter = "all";
  renderFinancePage();
}

function setFinanceSearchQuery(value) {
  currentFinanceSearchQuery = String(value || "").trimStart();
  renderFinanceResults();
}

function setFinanceBillingFilter(value) {
  currentFinanceBillingFilter = value || "all";
  renderFinanceResults();
}

function setFinanceStatusFilter(value) {
  currentFinanceStatusFilter = value || "all";
  renderFinanceResults();
}

function resetFinanceFilters() {
  currentFinanceSearchQuery = "";
  currentFinanceBillingFilter = "all";
  currentFinanceStatusFilter = "all";
  renderFinancePage();
}
function getNextPackageId() {
  const year = String(new Date().getFullYear());

  const maxId = getPackageRecords().reduce((max, pkg) => {
    const match = String(pkg.package_id || "").match(/^PKG-(\d{4})-(\d{6})$/);
    if (!match) return max;
    if (match[1] !== year) return max;
    return Math.max(max, Number(match[2]));
  }, 0);

  return `PKG-${year}-${String(maxId + 1).padStart(6, "0")}`;
}

function getNextPaymentId() {
  const year = String(new Date().getFullYear());

  const maxId = getPaymentRecords().reduce((max, payment) => {
    const match = String(payment.payment_id || "").match(/^PAY-(\d{4})-(\d{6})$/);
    if (!match) return max;
    if (match[1] !== year) return max;
    return Math.max(max, Number(match[2]));
  }, 0);

  return `PAY-${year}-${String(maxId + 1).padStart(6, "0")}`;
}

function getPackageById(packageId) {
  return getPackageRecords().find((pkg) => pkg.package_id === packageId) || null;
}

function getPaymentById(paymentId) {
  return getPaymentRecords().find((payment) => payment.payment_id === paymentId) || null;
}

function getFinanceStudentOptionsMarkup(selectedStudentId = "") {
  return getStudentRecords()
    .slice()
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((student) => `
      <option value="${student.student_id}" ${student.student_id === selectedStudentId ? "selected" : ""}>
        ${student.full_name}
      </option>
    `)
    .join("");
}

function getPackageOptionsMarkup(selectedPackageId = "") {
  return `
    <option value="">No linked package</option>
    ${getPackageRecords()
      .slice()
      .sort((a, b) => a.package_name.localeCompare(b.package_name))
      .map((pkg) => `
        <option value="${pkg.package_id}" ${pkg.package_id === selectedPackageId ? "selected" : ""}>
          ${pkg.package_name} · ${getFinanceStudentName(pkg.student_id)}
        </option>
      `)
      .join("")}
  `;
}

function upsertPackageRecord(payload) {
  const studentId = String(payload.student_id || "").trim();
  const packageName = String(payload.package_name || "").trim();
  const sessionsTotal = Number(payload.sessions_total || 0);
  const sessionsUsed = Number(payload.sessions_used || 0);
  const packagePrice = Number(payload.package_price || 0);
  const expiresOn = String(payload.expires_on || "").trim();

  if (!studentId) return { ok: false, errors: ["Student is required."] };
  if (!packageName) return { ok: false, errors: ["Package name is required."] };
  if (!sessionsTotal || sessionsTotal < 1) return { ok: false, errors: ["Total sessions must be at least 1."] };
  if (sessionsUsed < 0) return { ok: false, errors: ["Used sessions cannot be negative."] };
  if (sessionsUsed > sessionsTotal) return { ok: false, errors: ["Used sessions cannot exceed purchased sessions."] };
  if (packagePrice < 0) return { ok: false, errors: ["Package price cannot be negative."] };

  const remaining = Math.max(0, sessionsTotal - sessionsUsed);
  const status = remaining <= 0 ? "Depleted" : "Active";
  const existingPaid = editingPackageId ? getPackageLinkedPaidTotal(editingPackageId) : 0;

  if (packagePrice && existingPaid > packagePrice) {
    return { ok: false, errors: ["Linked paid payments already exceed this package price. Increase the package price or archive/edit the linked payments first."] };
  }

  if (editingPackageId) {
    const existing = getPackageById(editingPackageId);
    if (!existing) return { ok: false, errors: ["Package not found."] };

    const updated = patchRecordById("packages", editingPackageId, {
      student_id: studentId,
      package_name: packageName,
      sessions_total: sessionsTotal,
      sessions_used: sessionsUsed,
      sessions_remaining: remaining,
      package_price: packagePrice,
      status,
      expires_on: expiresOn
    });

    return { ok: true, package: updated };
  }

  const newPackage = {
    package_id: getNextPackageId(),
    student_id: studentId,
    package_name: packageName,
    sessions_total: sessionsTotal,
    sessions_used: sessionsUsed,
    sessions_remaining: remaining,
    package_price: packagePrice,
    status,
    expires_on: expiresOn,
    archived_at: null
  };

  insertRecord("packages", newPackage, { prepend: true });

  return { ok: true, package: newPackage };
}

function upsertPaymentRecord(payload) {
  const studentId = String(payload.student_id || "").trim();
  const amount = Number(payload.amount || 0);
  const currency = String(payload.currency || "USD").trim() || "USD";
  const paymentDate = String(payload.payment_date || "").trim();
  const paymentType = String(payload.payment_type || "").trim();
  const status = String(payload.status || "Paid").trim() || "Paid";
  const relatedPackageId = String(payload.related_package_id || "").trim();
  const normalizedStatus = status.toLowerCase();

  if (!studentId) return { ok: false, errors: ["Student is required."] };
  if (!amount || amount <= 0) return { ok: false, errors: ["Amount must be greater than 0."] };
  if (!paymentDate) return { ok: false, errors: ["Payment date is required."] };
  if (!paymentType) return { ok: false, errors: ["Payment type is required."] };

  const schemaStudent = getSchemaStudentById(studentId);
  if (!schemaStudent) return { ok: false, errors: ["Student not found."] };

  if (relatedPackageId) {
    const linkedPackage = getPackageById(relatedPackageId);
    if (!linkedPackage) return { ok: false, errors: ["Linked package not found."] };
    if (linkedPackage.student_id !== studentId) {
      return { ok: false, errors: ["A payment can only link to a package that belongs to the same student."] };
    }

    if (normalizedStatus === "paid") {
      const alreadyPaid = getPackageLinkedPaidTotal(relatedPackageId, editingPaymentId);
      const packagePrice = Number(linkedPackage.package_price || 0);
      if (packagePrice > 0 && alreadyPaid + amount > packagePrice) {
        return { ok: false, errors: ["This payment would push the linked package above its package price."] };
      }
    }
  }

  if (String(schemaStudent.billing_model || "").toUpperCase() === "PACKAGE" && normalizedStatus === "paid" && !relatedPackageId) {
    return { ok: false, errors: ["Package students need paid payments linked to a package so balances stay accurate."] };
  }

  if (editingPaymentId) {
    const existing = getPaymentById(editingPaymentId);
    if (!existing) return { ok: false, errors: ["Payment not found."] };

    const updated = patchRecordById("payments", editingPaymentId, {
      student_id: studentId,
      amount,
      currency,
      payment_date: paymentDate,
      payment_type: paymentType,
      status,
      related_package_id: relatedPackageId
    });

    return { ok: true, payment: updated };
  }

  const newPayment = {
    payment_id: getNextPaymentId(),
    student_id: studentId,
    amount,
    currency,
    payment_date: paymentDate,
    payment_type: paymentType,
    status,
    related_package_id: relatedPackageId,
    archived_at: null
  };

  insertRecord("payments", newPayment, { prepend: true });

  return { ok: true, payment: newPayment };
}

function closeFinanceModal() {
  const modal = document.getElementById("finance-modal-overlay");
  if (modal) modal.remove();
  editingPackageId = null;
  editingPaymentId = null;
}

function openPackageModal(packageId = null) {
  editingPackageId = packageId;
  editingPaymentId = null;

  const pkg = packageId ? getPackageById(packageId) : null;

  closeFinanceModal();

  const overlay = document.createElement("div");
  overlay.id = "finance-modal-overlay";
  overlay.className = "fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4";

  overlay.innerHTML = `
    <div class="app-modal-shell finance-modal-shell bg-white rounded-2xl border border-cream w-full max-w-2xl p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
      <div class="app-modal-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <h3 class="font-display text-xl font-bold text-warmblack">${pkg ? "Edit Package" : "Add Package"}</h3>
        <button type="button" id="close-finance-modal" class="self-start text-sm text-warmgray">Close</button>
      </div>

      <form id="package-form" class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Student</label>
            <select name="student_id" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              ${getFinanceStudentOptionsMarkup(pkg?.student_id || "")}
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Package Name</label>
            <input name="package_name" type="text" value="${escapeHtml(pkg?.package_name || "")}" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Sessions Purchased</label>
            <input name="sessions_total" type="number" min="1" value="${escapeHtml(String(pkg?.sessions_total ?? 10))}" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Package Price</label>
            <input name="package_price" type="number" min="0" step="0.01" value="${escapeHtml(String(pkg?.package_price ?? ""))}" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Sessions Used</label>
            <input name="sessions_used" type="number" min="0" value="${escapeHtml(String(pkg?.sessions_used ?? 0))}" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Expires On</label>
            <input name="expires_on" type="date" value="${escapeHtml(pkg?.expires_on || "")}" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
          </div>
        </div>

        <div class="app-modal-footer flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
          <button type="button" id="cancel-finance-modal" class="px-4 py-2.5 rounded-xl border border-cream bg-parchment text-sm font-medium">Cancel</button>
          <button type="submit" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">
            ${pkg ? "Save Package" : "Add Package"}
          </button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("close-finance-modal").onclick = closeFinanceModal;
  document.getElementById("cancel-finance-modal").onclick = closeFinanceModal;
  document.getElementById("package-form").onsubmit = handlePackageFormSubmit;

  lucide.createIcons();
}

function closeMaterialModal() {
  const modal = document.getElementById("material-modal-overlay");
  if (modal) modal.remove();
  editingMaterialId = null;
}

function getMaterialLessonOptionsMarkup(studentId, selectedLessonId = "") {
  return `
    <option value="">General studio material</option>
    ${getLessonsByStudentId(studentId)
      .map((lesson) => `
        <option value="${lesson.lesson_id}" ${lesson.lesson_id === selectedLessonId ? "selected" : ""}>
          ${escapeHtml(formatLongDate(lesson.scheduled_start))} · ${escapeHtml(lesson.topic || "Untitled Lesson")}
        </option>
      `)
      .join("")}
  `;
}

function getMaterialHomeworkOptionsMarkup(studentId, selectedHomeworkId = "", selectedLessonId = "") {
  const homeworkItems = getHomeworkByStudentId(studentId)
    .filter((item) => !selectedLessonId || item.lesson_id === selectedLessonId)
    .sort((a, b) => {
      const aTime = new Date(a.due_date || a.assigned_at || 0).getTime();
      const bTime = new Date(b.due_date || b.assigned_at || 0).getTime();
      return bTime - aTime;
    });

  return `
    <option value="">No linked homework</option>
    ${homeworkItems.map((item) => `
      <option value="${item.homework_id}" ${item.homework_id === selectedHomeworkId ? "selected" : ""}>
        ${escapeHtml(item.title || "Untitled Homework")}${item.due_date ? ` · due ${escapeHtml(formatLongDate(item.due_date))}` : ""}
      </option>
    `).join("")}
  `;
}

function updateMaterialSourceFieldsVisibility(form) {
  const targetForm = form || document.getElementById("material-form");
  if (!targetForm) return;

  const sourceType = normalizeMaterialSourceType(targetForm.elements.source_type?.value);
  const fileField = targetForm.querySelector('[data-material-source="file"]');
  const linkField = targetForm.querySelector('[data-material-source="link"]');

  if (fileField) {
    fileField.classList.toggle("hidden", sourceType !== "FILE");
  }

  if (linkField) {
    linkField.classList.toggle("hidden", sourceType !== "LINK");
  }
}

function updateMaterialLinkFieldVisibility(form) {
  const targetForm = form || document.getElementById("material-form");
  if (!targetForm) return;

  const scope = normalizeMaterialScope(targetForm.elements.scope?.value);
  const lessonField = targetForm.querySelector('[data-material-link="lesson"]');
  const homeworkField = targetForm.querySelector('[data-material-link="homework"]');
  const lessonSelect = targetForm.elements.lesson_id;
  const homeworkSelect = targetForm.elements.homework_id;

  const showLesson = scope === "LESSON_MATERIAL" || scope === "HOMEWORK_MATERIAL";
  const showHomework = scope === "HOMEWORK_MATERIAL";

  if (lessonField) {
    lessonField.classList.toggle("hidden", !showLesson);
  }

  if (homeworkField) {
    homeworkField.classList.toggle("hidden", !showHomework);
  }

  if (!showLesson && lessonSelect) {
    lessonSelect.value = "";
  }

  if (!showHomework && homeworkSelect) {
    homeworkSelect.value = "";
  }
}

function syncMaterialFormDefaults(form) {
  const targetForm = form || document.getElementById("material-form");
  if (!targetForm) return;

  const category = targetForm.elements.category?.value || "";
  const sourceType = targetForm.elements.source_type?.value || "FILE";

  if (targetForm.elements.scope && category) {
    targetForm.elements.scope.value = getDefaultScopeForMaterialCategory(category);
  }

  if (targetForm.elements.material_kind && category) {
    targetForm.elements.material_kind.value = getDefaultKindForMaterialCategory(category, sourceType);
  }

  if (targetForm.elements.visibility && category) {
    targetForm.elements.visibility.value = getDefaultVisibilityForMaterialCategory(category);
  }

  updateMaterialLinkFieldVisibility(targetForm);
}

function openMaterialModal(studentId, fileId = null, defaults = {}) {
  editingMaterialId = fileId;

  const file = fileId ? getFileById(fileId) : null;
  const resolvedStudentId = file?.student_id || studentId || selectedStudentId || "";
  const resolvedLessonId = file?.lesson_id || defaults.lessonId || "";
  const resolvedHomeworkId = file?.homework_id || defaults.homeworkId || "";
  const resolvedScope = file?.scope || defaults.scope || "";
  const resolvedCategory = file?.category || defaults.category || "";

  closeMaterialModal();

  const overlay = document.createElement("div");
  overlay.id = "material-modal-overlay";
  overlay.className = "fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4";

  overlay.innerHTML = `
    <div class="app-modal-shell bg-white rounded-2xl border border-cream w-full max-w-3xl p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
      <div class="app-modal-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <h3 class="font-display text-xl font-bold text-warmblack">${file ? "Edit Material" : "Add Material"}</h3>
        <button type="button" id="close-material-modal" class="self-start text-sm text-warmgray">Close</button>
      </div>

      <div class="rounded-xl border border-cream bg-parchment px-4 py-3 mb-4">
        <p class="text-xs font-medium uppercase tracking-wider text-warmgray mb-1">Material Workflow</p>
        <p class="text-sm text-warmblack">Use actor materials for resumes, headshots, reels, and self tapes. Use lesson or homework materials for active coaching work. Vault anything you want preserved but out of the current workspace.</p>
      </div>

      <form id="material-form" class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="col-span-2">
            <label class="block text-xs font-medium text-warmgray mb-1">Student</label>
            <select name="student_id" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              ${getStudentRecords()
                .slice()
                .sort((a, b) => a.full_name.localeCompare(b.full_name))
                .map((student) => `
                  <option value="${student.student_id}" ${student.student_id === resolvedStudentId ? "selected" : ""}>
                    ${escapeHtml(student.full_name)}
                  </option>
                `).join("")}
            </select>
          </div>

          <div class="col-span-2">
            <label class="block text-xs font-medium text-warmgray mb-1">Title</label>
            <input name="title" type="text" value="${escapeHtml(file?.title || "")}" placeholder="Resume, Headshot, Scene PDF, YouTube Reel" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Source</label>
            <select name="source_type" onchange="updateMaterialSourceFieldsVisibility(this.form)" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              <option value="FILE" ${normalizeMaterialSourceType(file?.source_type) !== "LINK" ? "selected" : ""}>Upload File</option>
              <option value="LINK" ${normalizeMaterialSourceType(file?.source_type) === "LINK" ? "selected" : ""}>External Link</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Kind</label>
            <select name="material_kind" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              <option value="DOCUMENT" ${normalizeMaterialKind(file?.material_kind, file?.source_type) === "DOCUMENT" ? "selected" : ""}>Document</option>
              <option value="VIDEO" ${normalizeMaterialKind(file?.material_kind, file?.source_type) === "VIDEO" ? "selected" : ""}>Video</option>
              <option value="IMAGE" ${normalizeMaterialKind(file?.material_kind, file?.source_type) === "IMAGE" ? "selected" : ""}>Image</option>
              <option value="LINK" ${normalizeMaterialKind(file?.material_kind, file?.source_type) === "LINK" ? "selected" : ""}>Link</option>
              <option value="AUDIO" ${normalizeMaterialKind(file?.material_kind, file?.source_type) === "AUDIO" ? "selected" : ""}>Audio</option>
              <option value="OTHER" ${normalizeMaterialKind(file?.material_kind, file?.source_type) === "OTHER" ? "selected" : ""}>Other</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Category</label>
            <select name="category" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              ${getMaterialCategoryOptionsMarkup(resolvedCategory)}
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Context</label>
            <select name="scope" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              <option value="ACTOR_MATERIAL" ${normalizeMaterialScope(resolvedScope) === "ACTOR_MATERIAL" ? "selected" : ""}>Actor Material</option>
              <option value="LESSON_MATERIAL" ${normalizeMaterialScope(resolvedScope) === "LESSON_MATERIAL" ? "selected" : ""}>Lesson Material</option>
              <option value="HOMEWORK_MATERIAL" ${normalizeMaterialScope(resolvedScope) === "HOMEWORK_MATERIAL" ? "selected" : ""}>Homework Material</option>
              <option value="STUDIO_RESOURCE" ${normalizeMaterialScope(resolvedScope) === "STUDIO_RESOURCE" ? "selected" : ""}>Studio Resource</option>
              <option value="OTHER" ${normalizeMaterialScope(resolvedScope) === "OTHER" ? "selected" : ""}>Other</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Status</label>
            <select name="status" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              <option value="Active" ${String(file?.status || "Active").toLowerCase() !== "vaulted" ? "selected" : ""}>Active</option>
              <option value="Vaulted" ${String(file?.status || "").toLowerCase() === "vaulted" ? "selected" : ""}>Vaulted</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Visibility</label>
            <select name="visibility" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              <option value="ADMIN_ONLY" ${normalizeMaterialVisibility(file?.visibility) === "ADMIN_ONLY" ? "selected" : ""}>Admin Only</option>
              <option value="STUDENT_VISIBLE" ${normalizeMaterialVisibility(file?.visibility) === "STUDENT_VISIBLE" ? "selected" : ""}>Student Visible Later</option>
              <option value="HIDDEN" ${normalizeMaterialVisibility(file?.visibility) === "HIDDEN" ? "selected" : ""}>Hidden</option>
            </select>
          </div>

          <div class="col-span-2 ${normalizeMaterialSourceType(file?.source_type) === "LINK" ? "hidden" : ""}" data-material-source="file">
            <label class="block text-xs font-medium text-warmgray mb-1">Upload File</label>
            <input name="material_file" type="file" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
            <p class="text-xs text-warmgray mt-1">${escapeHtml(getMaterialInputHint(file))}</p>
          </div>

          <div class="col-span-2 ${normalizeMaterialSourceType(file?.source_type) === "LINK" ? "" : "hidden"}" data-material-source="link">
            <label class="block text-xs font-medium text-warmgray mb-1">External URL</label>
            <input name="external_url" type="url" value="${escapeHtml(file?.external_url || "")}" placeholder="https://youtube.com/... or https://drive.google.com/..." class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
            <p class="text-xs text-warmgray mt-1">${escapeHtml(getMaterialInputHint(file))}</p>
          </div>

          <div class="col-span-2" data-material-link="lesson">
            <label class="block text-xs font-medium text-warmgray mb-1">Linked Lesson</label>
            <select name="lesson_id" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              ${getMaterialLessonOptionsMarkup(resolvedStudentId, resolvedLessonId)}
            </select>
          </div>

          <div class="col-span-2" data-material-link="homework">
            <label class="block text-xs font-medium text-warmgray mb-1">Linked Homework</label>
            <select name="homework_id" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              ${getMaterialHomeworkOptionsMarkup(resolvedStudentId, resolvedHomeworkId, resolvedLessonId)}
            </select>
          </div>

          <div class="col-span-2">
            <label class="block text-xs font-medium text-warmgray mb-1">Uploaded Date</label>
            <input name="uploaded_at" type="date" value="${escapeHtml(file?.uploaded_at || new Date().toISOString().slice(0, 10))}" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
          </div>

          <div class="col-span-2">
            <label class="block text-xs font-medium text-warmgray mb-1">Notes</label>
            <textarea name="notes" rows="3" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">${escapeHtml(file?.notes || "")}</textarea>
          </div>
        </div>

        <div class="app-modal-footer flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
          <button type="button" id="cancel-material-modal" class="px-4 py-2.5 rounded-xl border border-cream bg-parchment text-sm font-medium">
            Cancel
          </button>
          <button type="submit" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">
            Save Material
          </button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  const form = document.getElementById("material-form");
  const studentField = form?.elements?.student_id;
  const lessonField = form?.elements?.lesson_id;
  const homeworkField = form?.elements?.homework_id;
  const categoryField = form?.elements?.category;
  const sourceField = form?.elements?.source_type;
  const scopeField = form?.elements?.scope;

  if (studentField && lessonField) {
    studentField.onchange = () => {
      lessonField.innerHTML = getMaterialLessonOptionsMarkup(studentField.value, "");
      if (homeworkField) {
        homeworkField.innerHTML = getMaterialHomeworkOptionsMarkup(studentField.value, "", "");
      }
    };
  }

  if (lessonField && homeworkField) {
    lessonField.onchange = () => {
      homeworkField.innerHTML = getMaterialHomeworkOptionsMarkup(studentField?.value || resolvedStudentId, homeworkField.value, lessonField.value);
    };
  }

  if (categoryField) {
    categoryField.onchange = () => syncMaterialFormDefaults(form);
  }

  if (sourceField) {
    sourceField.onchange = () => {
      updateMaterialSourceFieldsVisibility(form);
      syncMaterialFormDefaults(form);
    };
  }

  if (scopeField) {
    scopeField.onchange = () => updateMaterialLinkFieldVisibility(form);
  }

  document.getElementById("close-material-modal").onclick = closeMaterialModal;
  document.getElementById("cancel-material-modal").onclick = closeMaterialModal;
  document.getElementById("material-form").onsubmit = handleMaterialFormSubmit;

  updateMaterialSourceFieldsVisibility(form);
  updateMaterialLinkFieldVisibility(form);
  if (!file) {
    syncMaterialFormDefaults(form);
  }

  lucide.createIcons();
}

function openPaymentModal(paymentId = null) {
  editingPaymentId = paymentId;
  editingPackageId = null;

  const payment = paymentId ? getPaymentById(paymentId) : null;

  closeFinanceModal();

  const overlay = document.createElement("div");
  overlay.id = "finance-modal-overlay";
  overlay.className = "fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4";

  overlay.innerHTML = `
    <div class="app-modal-shell finance-modal-shell bg-white rounded-2xl border border-cream w-full max-w-2xl p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
      <div class="app-modal-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <h3 class="font-display text-xl font-bold text-warmblack">${payment ? "Edit Payment" : "Add Payment"}</h3>
        <button type="button" id="close-finance-modal" class="self-start text-sm text-warmgray">Close</button>
      </div>

      <form id="payment-form" class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Student</label>
            <select name="student_id" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              ${getFinanceStudentOptionsMarkup(payment?.student_id || "")}
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Amount</label>
            <input name="amount" type="number" min="0" step="0.01" value="${escapeHtml(String(payment?.amount ?? ""))}" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Currency</label>
            <input name="currency" type="text" value="${escapeHtml(payment?.currency || "USD")}" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Payment Date</label>
            <input name="payment_date" type="date" value="${escapeHtml(payment?.payment_date || "")}" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Payment Type</label>
            <input name="payment_type" type="text" value="${escapeHtml(payment?.payment_type || "")}" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
          </div>

          <div>
            <label class="block text-xs font-medium text-warmgray mb-1">Status</label>
            <select name="status" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              <option value="Paid" ${payment?.status === "Paid" ? "selected" : ""}>Paid</option>
              <option value="Pending" ${payment?.status === "Pending" ? "selected" : ""}>Pending</option>
              <option value="Failed" ${payment?.status === "Failed" ? "selected" : ""}>Failed</option>
              <option value="Refunded" ${payment?.status === "Refunded" ? "selected" : ""}>Refunded</option>
            </select>
          </div>

          <div class="col-span-2">
            <label class="block text-xs font-medium text-warmgray mb-1">Related Package</label>
            <select name="related_package_id" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
              ${getPackageOptionsMarkup(payment?.related_package_id || "")}
            </select>
          </div>
        </div>

        <div class="app-modal-footer flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
          <button type="button" id="cancel-finance-modal" class="px-4 py-2.5 rounded-xl border border-cream bg-parchment text-sm font-medium">Cancel</button>
          <button type="submit" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">
            ${payment ? "Save Payment" : "Add Payment"}
          </button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("close-finance-modal").onclick = closeFinanceModal;
  document.getElementById("cancel-finance-modal").onclick = closeFinanceModal;
  document.getElementById("payment-form").onsubmit = handlePaymentFormSubmit;

  lucide.createIcons();
}

function archivePackage(packageId) {
  const pkg = getPackageById(packageId);
  if (!pkg) return;
  patchRecordById("packages", packageId, {
    archived_at: new Date().toISOString()
  });
  renderFinancePage();
}

function restorePackage(packageId) {
  const pkg = getPackageById(packageId);
  if (!pkg) return;
  patchRecordById("packages", packageId, {
    archived_at: null
  });
  renderFinancePage();
}

function archivePayment(paymentId) {
  const payment = getPaymentById(paymentId);
  if (!payment) return;
  patchRecordById("payments", paymentId, {
    archived_at: new Date().toISOString()
  });
  renderFinancePage();
}

function restorePayment(paymentId) {
  const payment = getPaymentById(paymentId);
  if (!payment) return;
  patchRecordById("payments", paymentId, {
    archived_at: null
  });
  renderFinancePage();
}

function handlePackageFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const payload = {
    student_id: form.elements.student_id.value,
    package_name: form.elements.package_name.value,
    sessions_total: form.elements.sessions_total.value,
    sessions_used: form.elements.sessions_used.value,
    package_price: form.elements.package_price.value,
    expires_on: form.elements.expires_on.value
  };

  const result = upsertPackageRecord(payload);

  if (!result || result.ok === false) {
    const errors = result?.errors || ["Unable to save package."];
    notifyUser({
      title: "Package Save",
      message: errors.join(" "),
      tone: "error",
      source: "finance"
    });
    return;
  }

  closeFinanceModal();
  renderFinancePage();
  notifyUser({
    title: editingPackageId ? "Package Updated" : "Package Added",
    message: "Package details are saved and reflected in finance.",
    tone: "success",
    source: "finance"
  });
}

function handlePaymentFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const payload = {
    student_id: form.elements.student_id.value,
    amount: form.elements.amount.value,
    currency: form.elements.currency.value.trim(),
    payment_date: form.elements.payment_date.value,
    payment_type: form.elements.payment_type.value.trim(),
    status: form.elements.status.value,
    related_package_id: form.elements.related_package_id.value
  };

  const result = upsertPaymentRecord(payload);

  if (!result || result.ok === false) {
    const errors = result?.errors || ["Unable to save payment."];
    notifyUser({
      title: "Payment Save",
      message: errors.join(" "),
      tone: "error",
      source: "finance"
    });
    return;
  }

  closeFinanceModal();
  renderFinancePage();
  notifyUser({
    title: editingPaymentId ? "Payment Updated" : "Payment Added",
    message: "Payment details are saved and finance totals are up to date.",
    tone: "success",
    source: "finance"
  });
}

function handleMaterialFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const sourceType = normalizeMaterialSourceType(form.elements.source_type.value);
  const selectedFile = form.elements.material_file?.files?.[0] || null;
  const existingFile = editingMaterialId ? getFileById(editingMaterialId) : null;
  const fileUrl = sourceType === "FILE"
    ? (selectedFile ? URL.createObjectURL(selectedFile) : String(existingFile?.file_url || "").trim())
    : "";
  const fileName = sourceType === "FILE"
    ? (selectedFile ? selectedFile.name : String(existingFile?.file_name || "").trim())
    : "";
  const mimeType = sourceType === "FILE"
    ? (selectedFile ? selectedFile.type : String(existingFile?.mime_type || "").trim())
    : "";

  const payload = {
    file_id: editingMaterialId,
    student_id: form.elements.student_id.value,
    lesson_id: form.elements.lesson_id.value,
    homework_id: form.elements.homework_id.value,
    file_name: fileName,
    title: form.elements.title.value,
    source_type: sourceType,
    external_url: sourceType === "LINK" ? form.elements.external_url.value : "",
    file_url: fileUrl,
    mime_type: mimeType,
    material_kind: form.elements.material_kind.value,
    category: form.elements.category.value,
    scope: form.elements.scope.value,
    visibility: form.elements.visibility.value,
    notes: form.elements.notes.value,
    status: form.elements.status.value,
    uploaded_at: form.elements.uploaded_at.value
  };

  const result = upsertMaterialRecord(payload);

  if (!result || result.ok === false) {
    const errors = result?.errors || ["Unable to save material."];
    notifyUser({
      title: "Material Save",
      message: errors.join(" "),
      tone: "error",
      source: "materials"
    });
    return;
  }

  closeMaterialModal();

  if (result.file?.student_id) {
    selectedStudentId = result.file.student_id;
  }

  if (selectedStudentId) {
    populateStudentProfile(selectedStudentId);
  }

  notifyUser({
    title: editingMaterialId ? "Material Updated" : "Material Added",
    message: "The material is saved and ready to reference from the student record.",
    tone: "success",
    source: "materials"
  });
}

/*********************************
 * LESSONS PAGE HELPERS
 *********************************/
function getAllLessonsPageRows() {
  return getLessonRecords().map((lesson) => {
    const student = getSchemaStudentById(lesson.student_id);
    const effectiveStatus = getEffectiveLessonStatus(lesson);

    return {
      lesson_id: lesson.lesson_id,
      student_id: lesson.student_id,
      student_name: student ? student.full_name : "Unknown Student",
      lesson_status: effectiveStatus,
      raw_lesson_status: lesson.lesson_status || "SCHEDULED",
      lesson_type: lesson.lesson_type || "General Coaching",
      manual_payment_status: lesson.manual_payment_status || "",
      topic: lesson.topic || "Untitled Lesson",
      scheduled_start: lesson.scheduled_start || "",
      scheduled_end: lesson.scheduled_end || "",
      previous_schedule_label: getLessonRescheduleHistoryLabel(lesson),
      source: lesson.source || "manual",
      external_event_id: lesson.external_event_id || "",
      sync_state: lesson.sync_state || "",
      intake_review_state: lesson.intake_review_state || "",
      intake_conflict_note: lesson.intake_conflict_note || "",
      last_synced_at: lesson.last_synced_at || "",
      sort_time: lesson.scheduled_start ? new Date(lesson.scheduled_start).getTime() : 0
    };
  });
}

function getFilteredLessonsRows() {
  let rows = getAllLessonsPageRows();

  const now = getReferenceNow();
  const todayStart = startOfLocalDay(now);
  const todayEnd = endOfLocalDay(now);

  if (currentLessonsStatusFilter !== "all") {
    rows = rows.filter((row) => row.lesson_status === currentLessonsStatusFilter);
  }

  if (currentLessonsStudentFilter !== "all") {
    rows = rows.filter((row) => row.student_id === currentLessonsStudentFilter);
  }

  if (currentLessonsSearchQuery) {
    const query = currentLessonsSearchQuery.toLowerCase();

    rows = rows.filter((row) => {
      return (
        row.student_name.toLowerCase().includes(query) ||
        row.lesson_type.toLowerCase().includes(query) ||
        row.topic.toLowerCase().includes(query) ||
        row.lesson_id.toLowerCase().includes(query) ||
        row.external_event_id.toLowerCase().includes(query)
      );
    });
  }

  if (currentLessonsDateRangeFilter !== "all") {
    rows = rows.filter((row) => {
      const lessonDate = row.scheduled_start ? new Date(row.scheduled_start) : null;
      if (!lessonDate || Number.isNaN(lessonDate.getTime())) return false;

      if (currentLessonsDateRangeFilter === "today") {
        return lessonDate >= todayStart && lessonDate <= todayEnd;
      }

      if (currentLessonsDateRangeFilter === "this-week") {
        return lessonDate >= getStartOfWeek(now) && lessonDate <= getEndOfWeek(now);
      }

      if (currentLessonsDateRangeFilter === "this-month") {
        return lessonDate >= getStartOfMonth(now) && lessonDate <= getEndOfMonth(now);
      }

      if (currentLessonsDateRangeFilter === "next-7") {
        return lessonDate >= todayStart && lessonDate <= endOfLocalDay(addDaysToDate(now, 7));
      }

      if (currentLessonsDateRangeFilter === "next-30") {
        return lessonDate >= todayStart && lessonDate <= endOfLocalDay(addDaysToDate(now, 30));
      }

      if (currentLessonsDateRangeFilter === "previous-7") {
        return lessonDate >= startOfLocalDay(addDaysToDate(now, -7)) && lessonDate <= todayEnd;
      }

      if (currentLessonsDateRangeFilter === "previous-30") {
        return lessonDate >= startOfLocalDay(addDaysToDate(now, -30)) && lessonDate <= todayEnd;
      }

      return true;
    });
  }

  rows.sort((a, b) => b.sort_time - a.sort_time);
  return rows;
}

function getLessonsStudentFilterOptionsMarkup() {
  return `
    <option value="all" ${currentLessonsStudentFilter === "all" ? "selected" : ""}>All Students</option>
    ${getStudentRecords()
      .slice()
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map((student) => {
        const selected = currentLessonsStudentFilter === student.student_id ? "selected" : "";
        return `<option value="${student.student_id}" ${selected}>${student.full_name}</option>`;
      })
      .join("")}
  `;
}

function getLessonsPageSummaryRows() {
  const rows = getAllLessonsPageRows();
  const now = getReferenceNow();
  const weekStart = getStartOfWeek(now);
  const weekEnd = getEndOfWeek(now);

  return {
    upcoming: rows.filter((row) => row.lesson_status === "SCHEDULED" && row.scheduled_start && new Date(row.scheduled_start) >= now).length,
    completedThisWeek: rows.filter((row) => row.lesson_status === "COMPLETED" && row.scheduled_start && new Date(row.scheduled_start) >= weekStart && new Date(row.scheduled_start) <= weekEnd).length,
    intakeReview: rows.filter((row) => row.source !== "manual" && isLessonIntakeActionRequired(getSchemaLessonById(row.lesson_id))).length,
    imported: rows.filter((row) => row.source !== "manual").length
  };
}

function getLessonsFilterPills() {
  const pills = [];
  if (currentLessonsDateRangeFilter !== "all") {
    const labels = {
      today: "Today",
      "this-week": "This Week",
      "this-month": "This Month",
      "next-7": "Next 7 Days",
      "next-30": "Next 30 Days",
      "previous-7": "Previous 7 Days",
      "previous-30": "Previous 30 Days"
    };
    pills.push(getStatusFilterPill("Date", labels[currentLessonsDateRangeFilter] || currentLessonsDateRangeFilter));
  }
  if (currentLessonsStatusFilter !== "all") {
    pills.push(getStatusFilterPill("Status", getLessonStatusLabel(currentLessonsStatusFilter)));
  }
  if (currentLessonsStudentFilter !== "all") {
    const student = getSchemaStudentById(currentLessonsStudentFilter);
    pills.push(getStatusFilterPill("Student", student?.full_name || currentLessonsStudentFilter));
  }
  if (currentLessonsSearchQuery) {
    pills.push(getStatusFilterPill("Search", currentLessonsSearchQuery));
  }
  return pills;
}

function setLessonsStatusFilter(value) {
  currentLessonsStatusFilter = value || "all";
  renderLessonsRows();
}

function setLessonsStudentFilter(value) {
  currentLessonsStudentFilter = value || "all";
  renderLessonsRows();
}

function setLessonsSearchQuery(value) {
  currentLessonsSearchQuery = String(value || "").trimStart();
  renderLessonsRows();
}

function setLessonsDateRangeFilter(value) {
  currentLessonsDateRangeFilter = value || "all";
  renderLessonsRows();
}

function viewStudentProfileFromLesson(studentId) {
  if (!studentId) return;
  selectedStudentId = studentId;
  navigateTo("profile");
}

/*********************************
 * NOTES QUEUE PAGE
 *********************************/
function renderNotesQueueResults() {
  const resultsEl = document.getElementById("notes-queue-results");
  const countEl = document.getElementById("notes-queue-results-count");
  if (!resultsEl) return;

  const rows = getFilteredNotesQueueRows();
  const compact = isCompactView("notes");
  const overdueCount = rows.filter((row) => row.urgency_key === "overdue" && row.action_required).length;
  const missingCount = rows.filter((row) => row.note_status === "MISSING" && row.action_required).length;
  const draftCount = rows.filter((row) => row.note_status === "DRAFT" && row.action_required).length;

  if (countEl) {
    countEl.textContent = `${rows.length} completed lesson${rows.length === 1 ? "" : "s"} shown${overdueCount ? ` · ${overdueCount} overdue` : ""}${missingCount ? ` · ${missingCount} missing` : ""}${draftCount ? ` · ${draftCount} drafts` : ""}`;
  }

  resultsEl.innerHTML = `
    <div class="bg-white rounded-2xl border border-cream overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[1320px] text-sm ${compact ? "compact-table" : ""}">
          <thead class="bg-parchment/70">
            <tr class="text-left text-xs text-warmgray uppercase tracking-wider">
              <th class="px-5 py-3 font-medium">Urgency</th>
              <th class="px-5 py-3 font-medium">Student</th>
              <th class="px-5 py-3 font-medium">Lesson</th>
              <th class="px-5 py-3 font-medium">Completed</th>
              <th class="px-5 py-3 font-medium">Elapsed</th>
              <th class="px-5 py-3 font-medium">Note State</th>
              <th class="px-5 py-3 font-medium">Last Activity</th>
              <th class="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map((row) => `
                    <tr class="border-t border-cream/80 hover:bg-parchment/60 transition-colors">
                      <td class="px-5 py-4 align-top">
                        <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.urgency_badge}">
                          ${escapeHtml(row.urgency_label)}
                        </span>
                      </td>
                      <td class="px-5 py-4 align-top">
                        <button
                          type="button"
                          class="text-sm font-medium text-warmblack hover:text-gold transition-colors text-left"
                          onclick="openStudentProfileFromNotesQueue('${row.student_id}')"
                        >
                          ${escapeHtml(row.student_name)}
                        </button>
                        <div class="text-xs text-warmgray mt-1">${escapeHtml(row.lesson_id)}</div>
                      </td>
                      <td class="px-5 py-4 align-top">
                        <p class="font-medium text-warmblack">${escapeHtml(row.lesson_topic)}</p>
                        <p class="text-xs text-warmgray mt-1">${escapeHtml(row.lesson_type)}</p>
                      </td>
                      <td class="px-5 py-4 align-top">${escapeHtml(formatLongDate(row.completion_date))}</td>
                      <td class="px-5 py-4 align-top">
                        <span class="${row.hours_since_lesson > 48 && row.action_required ? "text-burgundy font-medium" : "text-warmblack"}">${escapeHtml(`${row.hours_since_lesson}h`)}</span>
                      </td>
                      <td class="px-5 py-4 align-top">
                        <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.note_status_badge}">
                          ${escapeHtml(row.note_status_label)}
                        </span>
                        ${
                          row.note_title
                            ? `<div class="text-xs text-warmgray mt-1">${escapeHtml(row.note_title)}</div>`
                            : ""
                        }
                      </td>
                      <td class="px-5 py-4 align-top">${escapeHtml(row.note_activity_label)}</td>
                      <td class="px-5 py-4 align-top text-right">
                        <div class="flex justify-end gap-2">
                          <button
                            type="button"
                            class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                            onclick="openNoteWorkspace('${row.student_id}', '${row.lesson_id}')"
                          >
                            ${row.queue_action_label}
                          </button>
                          <button
                            type="button"
                            class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmgray card-hover"
                            onclick="openLessonDetailModal('${row.lesson_id}')"
                          >
                            Lesson
                          </button>
                        </div>
                      </td>
                    </tr>
                  `).join("")
                : `
                  <tr>
                    <td colspan="8" class="px-5 py-12 text-center">
                      <div class="page-empty-state flex flex-col items-center justify-center text-warmgray">
                        <i data-lucide="notebook-tabs" class="w-8 h-8 mb-3 opacity-50"></i>
                        <p class="text-sm font-medium">No note follow-up in this view</p>
                        <p class="text-xs mt-1">Try changing your filters, or use No Notes when a written note is not needed.</p>
                      </div>
                    </td>
                  </tr>
                `
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  lucide.createIcons();
}

function renderNotesQueuePage() {
  const root = document.getElementById("page-root");
  if (!root) return;

  const allRows = getCompletedLessonsNeedingNotesRows();
  const actionableRows = allRows.filter((row) => row.action_required);
  const overdueRows = actionableRows.filter((row) => row.urgency_key === "overdue");
  const dueNowRows = actionableRows.filter((row) => row.urgency_key === "due-now");
  const withinWindowRows = actionableRows.filter((row) => row.urgency_key === "within-window");
  const missingRows = actionableRows.filter((row) => row.note_status === "MISSING");
  const draftRows = actionableRows.filter((row) => row.note_status === "DRAFT");
  const archivedRows = actionableRows.filter((row) => row.note_status === "ARCHIVED");
  const compact = isCompactView("notes");
  const filterPills = getNotesQueueFilterPills();

  root.innerHTML = `
    <div class="p-4 sm:p-6 xl:p-8 w-full ${compact ? "compact-view" : ""}">
      <header class="mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 fade-in">
        <div class="min-w-0">
          <h2 class="font-display text-2xl font-bold text-warmblack">Notes Queue</h2>
          <p class="text-sm text-warmgray mt-0.5">Completed lessons from the last 14 days that still need published follow-up, or to be marked as no notes.</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto">
          <div class="rounded-xl border ${overdueRows.length ? "border-burgundy/20 bg-burgundy/5" : "border-cream bg-white"} px-4 py-3 min-w-0">
            <p class="text-[11px] uppercase tracking-wider text-warmgray">Overdue</p>
            <p class="text-lg font-semibold ${overdueRows.length ? "text-burgundy" : "text-warmblack"}">${overdueRows.length}</p>
          </div>
          <div class="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3 min-w-0">
            <p class="text-[11px] uppercase tracking-wider text-warmgray">Due Now</p>
            <p class="text-lg font-semibold text-warmblack">${dueNowRows.length}</p>
          </div>
          <div class="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 min-w-0">
            <p class="text-[11px] uppercase tracking-wider text-warmgray">Within Window</p>
            <p class="text-lg font-semibold text-warmblack">${withinWindowRows.length}</p>
          </div>
        </div>
      </header>

      <div class="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-5 fade-in" style="animation-delay:0.02s">
        <div class="rounded-2xl border border-burgundy/20 bg-burgundy/5 px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Missing Notes</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${missingRows.length}</p>
        </div>
        <div class="rounded-2xl border border-gold/20 bg-gold/5 px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Drafts</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${draftRows.length}</p>
        </div>
        <div class="rounded-2xl border border-cream bg-parchment px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Archived</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${archivedRows.length}</p>
        </div>
        <div class="rounded-2xl border border-sage/20 bg-sage/5 px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Published</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${allRows.filter((row) => row.note_status === "PUBLISHED").length}</p>
        </div>
      </div>

      ${
        overdueRows.length
          ? `
            <div class="mb-5 rounded-2xl border border-burgundy/20 bg-burgundy/5 p-4 fade-in" style="animation-delay:0.03s">
              <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-xs font-medium uppercase tracking-wider text-burgundy">Urgent Follow-Up</p>
                  <p class="text-sm text-warmblack mt-1">${overdueRows.length} completed lesson${overdueRows.length === 1 ? "" : "s"} passed the 48-hour note window.</p>
                </div>
                <button
                  type="button"
                  class="px-4 py-2.5 rounded-xl bg-white border border-burgundy/20 text-sm font-medium text-warmblack self-start md:self-auto"
                  onclick="openNoteWorkspace('${overdueRows[0].student_id}', '${overdueRows[0].lesson_id}')"
                >
                  Start With Oldest
                </button>
              </div>
            </div>
          `
          : ""
      }

      ${
        actionableRows.length
          ? `
            <div class="mb-5 rounded-2xl border border-cream bg-white p-4 fade-in" style="animation-delay:0.04s">
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-xs font-medium uppercase tracking-wider text-warmgray">Daily Workflow</p>
                  <p class="text-sm text-warmgray mt-1">Use this as a quick reminder when you need it, then hide it.</p>
                </div>
                <button
                  type="button"
                  class="px-4 py-2 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmblack self-start sm:self-auto"
                  onclick="toggleNotesQueueWorkflow()"
                >
                  ${currentNotesQueueShowWorkflow ? "Hide Workflow" : "Show Workflow"}
                </button>
              </div>
              <div class="${currentNotesQueueShowWorkflow ? "grid" : "hidden"} grid-cols-1 xl:grid-cols-3 gap-4 text-sm mt-4">
                <div class="rounded-xl bg-parchment border border-cream px-4 py-3 min-w-0">
                  <p class="font-semibold text-warmblack">1. Start with missing notes</p>
                  <p class="text-warmgray mt-1">Create notes for completed lessons that still have no draft at all.</p>
                </div>
                <div class="rounded-xl bg-parchment border border-cream px-4 py-3 min-w-0">
                  <p class="font-semibold text-warmblack">2. Finish drafts within 48 hours</p>
                  <p class="text-warmgray mt-1">Drafts still count as follow-up due until they are published.</p>
                </div>
                <div class="rounded-xl bg-parchment border border-cream px-4 py-3 min-w-0">
                  <p class="font-semibold text-warmblack">3. Use archive for history only</p>
                  <p class="text-warmgray mt-1">Archived notes are preserved, but they do not satisfy student follow-up.</p>
                </div>
              </div>
            </div>
          `
          : ""
      }

      <div class="page-toolbar-sticky bg-white rounded-2xl border border-cream p-4 mb-5 fade-in" style="animation-delay:0.05s">
        <div class="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div class="xl:col-span-7 relative min-w-0">
            <i data-lucide="search" class="w-4 h-4 text-warmgray absolute left-3 top-1/2 -translate-y-1/2"></i>
            <input
              type="search"
              value="${escapeHtml(currentNotesQueueSearchQuery)}"
              placeholder="Search by student, lesson, note title, or lesson ID..."
              class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-parchment border border-cream text-sm placeholder:text-warmgray/60"
              oninput="setNotesQueueSearchQuery(this.value)"
            />
          </div>

          <div class="xl:col-span-5 min-w-0">
            <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 rounded-xl border border-cream overflow-hidden">
              <button type="button" onclick="setNotesQueueFilter('all')" class="px-4 py-2.5 text-sm font-medium ${currentNotesQueueFilter === "all" ? "bg-parchment text-warmblack" : "bg-white text-warmgray"}">All</button>
              <button type="button" onclick="setNotesQueueFilter('overdue')" class="px-4 py-2.5 text-sm font-medium ${currentNotesQueueFilter === "overdue" ? "bg-parchment text-warmblack" : "bg-white text-warmgray"}">Overdue</button>
              <button type="button" onclick="setNotesQueueFilter('due-now')" class="px-4 py-2.5 text-sm font-medium ${currentNotesQueueFilter === "due-now" ? "bg-parchment text-warmblack" : "bg-white text-warmgray"}">Due Now</button>
              <button type="button" onclick="setNotesQueueFilter('within-window')" class="px-4 py-2.5 text-sm font-medium ${currentNotesQueueFilter === "within-window" ? "bg-parchment text-warmblack" : "bg-white text-warmgray"}">Within 48h</button>
              <button type="button" onclick="setNotesQueueFilter('published')" class="px-4 py-2.5 text-sm font-medium ${currentNotesQueueFilter === "published" ? "bg-parchment text-warmblack" : "bg-white text-warmgray"}">Published</button>
            </div>
          </div>
        </div>

        <div class="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p id="notes-queue-results-count" class="text-xs text-warmgray">0 completed lessons shown</p>
          <div class="flex flex-wrap items-center gap-3">
            <button type="button" class="text-xs font-medium text-gold hover:underline" onclick="toggleCompactView('notes')">${getCompactToggleLabel("notes")}</button>
            <button type="button" class="text-xs font-medium text-gold hover:underline" onclick="resetNotesQueueFilters()">Reset filters</button>
          </div>
        </div>
        ${filterPills.length ? `<div class="page-filter-summary mt-3">${filterPills.join("")}</div>` : ""}
      </div>

      <div id="notes-queue-results" class="fade-in" style="animation-delay:0.08s"></div>
    </div>
  `;

  renderNotesQueueResults();
  lucide.createIcons();
}

/*********************************
 * STUDENTS PAGE RENDERERS
 *********************************/

function updateStudentsHeaderCounts(list = students) {
  const activeCount = list.filter((s) => s.status === "active").length;
  const inactiveCount = list.filter((s) => s.status === "inactive").length;
  const expiringCount = list.filter((s) => s.status === "expiring").length;

  const countText = document.getElementById("students-header-counts");
  if (countText) {
    countText.textContent = `${activeCount} active students · ${inactiveCount} inactive · ${expiringCount} expiring`;
  }
}

function renderStudents(list) {
  const grid = document.getElementById("student-grid");
  const filterSummaryEl = document.getElementById("students-filter-summary");
  if (!grid) return;

  grid.innerHTML = "";

  list.forEach((s, i) => {
    const sc = getStatusColor(s.status);
    const card = document.createElement("div");

    card.className = "bg-white rounded-2xl border border-cream p-5 card-hover cursor-pointer slide-up";
    card.style.animationDelay = `${0.05 * i}s`;
    card.onclick = () => {
      selectedStudentId = s.id;
      navigateTo("profile");
    };

    card.innerHTML = `
      <div class="flex items-center gap-3 mb-3">
        <div class="w-11 h-11 rounded-full headshot-placeholder flex items-center justify-center text-sm font-semibold text-warmgray">${s.initials}</div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold truncate">${s.name}</p>
          <p class="text-xs text-warmgray truncate">${s.focus}</p>
          <p class="text-[11px] text-warmgray truncate mt-1">Source · ${escapeHtml(getStudentLeadSourceLabel(s.leadSource))}</p>
        </div>
        <span class="inline-flex items-center gap-1 text-[11px] font-medium ${sc.text} ${sc.bg} px-2 py-0.5 rounded-full shrink-0">
          <span class="w-1.5 h-1.5 rounded-full ${sc.dot}"></span>${sc.label}
        </span>
      </div>
      <div class="flex items-center justify-between text-xs text-warmgray border-t border-cream pt-3">
        <span>${s.pkg}</span>
        <span>${s.status !== "inactive" ? s.sessions + " sessions left" : "Last: " + s.lastSeen}</span>
      </div>
    `;

    grid.appendChild(card);
  });

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="col-span-3 page-empty-state text-warmgray">
        <i data-lucide="search" class="w-8 h-8 mx-auto mb-3 opacity-40"></i>
        <p class="text-sm font-medium text-warmblack">No students match this view</p>
        <p class="text-xs mt-1">Try widening your filters, or import a CSV and merge contacts into existing students.</p>
      </div>
    `;
  }

  if (filterSummaryEl) {
    const pills = getStudentsFilterPills();
    filterSummaryEl.innerHTML = pills.length ? pills.join("") : `<span class="text-xs text-warmgray">Showing the full student roster right now.</span>`;
  }

  updateStudentsHeaderCounts(list);
  lucide.createIcons();
}

function getActiveStudentFilterValues() {
  if (!currentStudentFilters || currentStudentFilters.size === 0 || currentStudentFilters.has("all")) {
    return ["active", "expiring", "inactive"];
  }

  return Array.from(currentStudentFilters);
}

function refreshStudentFilterButtons() {
  const activeFilters = getActiveStudentFilterValues();
  const isAllActive = currentStudentFilters.has("all") || activeFilters.length === 3;

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    const filter = btn.dataset.filter;
    const isActive = filter === "all" ? isAllActive : activeFilters.includes(filter);

    btn.className = isActive
      ? "filter-btn active-filter px-3 py-2 rounded-lg text-xs font-medium bg-charcoal text-white transition-all"
      : "filter-btn px-3 py-2 rounded-lg text-xs font-medium bg-parchment text-warmgray transition-all";
  });
}

function filterStudents() {
  const searchInput = document.getElementById("student-search");
  const query = searchInput ? searchInput.value.toLowerCase() : "";

  let filtered = students;
  const activeFilters = getActiveStudentFilterValues();
  filtered = filtered.filter((s) => activeFilters.includes(s.status));

  if (query) {
    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.focus.toLowerCase().includes(query) ||
        getStudentLeadSourceLabel(s.leadSource).toLowerCase().includes(query) ||
        (s.leadSourceDetail && s.leadSourceDetail.toLowerCase().includes(query)) ||
        (s.email && s.email.toLowerCase().includes(query)) ||
        (s.additionalEmails && s.additionalEmails.toLowerCase().includes(query)) ||
        (s.guardianName && s.guardianName.toLowerCase().includes(query)) ||
        (s.guardianEmail && s.guardianEmail.toLowerCase().includes(query))
    );
  }

  renderStudents(filtered);
}

function setFilter(f) {
  const nextFilter = String(f || "all");

  if (nextFilter === "all") {
    currentStudentFilters = new Set(["all"]);
  } else {
    const nextFilters = new Set(currentStudentFilters);
    nextFilters.delete("all");

    if (nextFilters.has(nextFilter)) {
      nextFilters.delete(nextFilter);
    } else {
      nextFilters.add(nextFilter);
    }

    if (nextFilters.size === 0 || nextFilters.size === 3) {
      currentStudentFilters = new Set(["all"]);
    } else {
      currentStudentFilters = nextFilters;
    }
  }

  refreshStudentFilterButtons();
  filterStudents();
}

function getStudentsPageSummaryRows() {
  const studentRows = Array.isArray(students) ? students : [];
  const records = getStudentRecords();
  return {
    active: studentRows.filter((student) => student.status === "active").length,
    expiring: studentRows.filter((student) => student.status === "expiring").length,
    inactive: studentRows.filter((student) => student.status === "inactive").length,
    importedInactive: records.filter((student) => student.studio_status === "INACTIVE" && student.lead_source).length
  };
}

function getStudentsFilterPills() {
  const pills = [];
  const filters = getActiveStudentFilterValues();
  if (!currentStudentFilters.has("all")) {
    pills.push(getStatusFilterPill("Status", filters.map((filter) => filter.charAt(0).toUpperCase() + filter.slice(1)).join(", ")));
  }

  const searchInput = document.getElementById("student-search");
  const query = String(searchInput?.value || "").trim();
  if (query) {
    pills.push(getStatusFilterPill("Search", query));
  }

  return pills;
}

function renderStudentsPage() {
  const root = document.getElementById("page-root");
  if (!root) return;
  const summary = getStudentsPageSummaryRows();
  const compact = isCompactView("students");

  root.innerHTML = `
    <div class="students-shell p-4 sm:p-6 xl:p-8 w-full ${compact ? "compact-view" : ""}">
      <header class="mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 fade-in">
        <div class="min-w-0">
          <h2 class="font-display text-2xl font-bold text-warmblack">Students</h2>
          <p id="students-header-counts" class="text-sm text-warmgray mt-0.5"></p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button id="import-students-btn" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-warmblack text-sm font-semibold flex items-center gap-2 card-hover">
            <i data-lucide="upload" class="w-4 h-4"></i>
            Import CSV
          </button>
          <button id="add-student-btn" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold flex items-center gap-2 card-hover">
            <i data-lucide="plus" class="w-4 h-4"></i>
            Add Student
          </button>
        </div>
      </header>

      <div class="page-summary-grid mb-5 fade-in" style="animation-delay:0.03s">
        <div class="page-summary-card">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Active Students</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${summary.active}</p>
        </div>
        <div class="page-summary-card">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Expiring Soon</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${summary.expiring}</p>
        </div>
        <div class="page-summary-card">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Inactive</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${summary.inactive}</p>
        </div>
        <div class="page-summary-card">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Imported to Review</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${summary.importedInactive}</p>
        </div>
      </div>

      <div class="page-toolbar-sticky bg-white rounded-2xl border border-cream p-4 mb-5 flex flex-col lg:flex-row lg:items-center gap-4 fade-in" style="animation-delay:0.05s">
        <div class="flex-1 relative min-w-0">
          <i data-lucide="search" class="w-4 h-4 text-warmgray absolute left-3 top-1/2 -translate-y-1/2"></i>
          <input
            id="student-search"
            type="search"
            placeholder="Search students by name, focus area, email, or lead source..."
            class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-parchment border border-cream text-sm placeholder:text-warmgray/60"
            oninput="filterStudents()"
          />
        </div>

        <div class="flex flex-wrap gap-2">
          <button onclick="setFilter('all')" class="filter-btn active-filter px-3 py-2 rounded-lg text-xs font-medium bg-charcoal text-white transition-all" data-filter="all">All</button>
          <button onclick="setFilter('active')" class="filter-btn px-3 py-2 rounded-lg text-xs font-medium bg-parchment text-warmgray transition-all" data-filter="active">Active</button>
          <button onclick="setFilter('expiring')" class="filter-btn px-3 py-2 rounded-lg text-xs font-medium bg-parchment text-warmgray transition-all" data-filter="expiring">Expiring</button>
          <button onclick="setFilter('inactive')" class="filter-btn px-3 py-2 rounded-lg text-xs font-medium bg-parchment text-warmgray transition-all" data-filter="inactive">Inactive</button>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="text-xs font-medium text-gold hover:underline" onclick="toggleCompactView('students')">${getCompactToggleLabel("students")}</button>
        </div>
        <div id="students-filter-summary" class="page-filter-summary w-full lg:order-last"></div>
      </div>

      <div id="student-grid" class="grid grid-cols-1 xl:grid-cols-3 gap-4"></div>
    </div>
  `;

  const addStudentBtn = document.getElementById("add-student-btn");
  if (addStudentBtn) {
    addStudentBtn.onclick = () => openStudentModal("create");
  }

  const importStudentsBtn = document.getElementById("import-students-btn");
  if (importStudentsBtn) {
    importStudentsBtn.onclick = openStudentImportModal;
  }

  refreshStudentFilterButtons();
  filterStudents();
  lucide.createIcons();
}

/*********************************
 * LESSONS PAGE RENDERERS
 *********************************/

function renderLessonsRows() {
  const tbody = document.getElementById("lessons-table-body");
  const countEl = document.getElementById("lessons-results-count");
  if (!tbody) return;

  const rows = getFilteredLessonsRows();
  const compact = isCompactView("lessons");

  if (countEl) {
    countEl.textContent = `${rows.length} lesson${rows.length === 1 ? "" : "s"} shown`;
  }

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="px-5 py-12 text-center">
          <div class="page-empty-state flex flex-col items-center justify-center text-warmgray">
            <i data-lucide="calendar-x-2" class="w-8 h-8 mb-3 opacity-50"></i>
            <p class="text-sm font-medium">No lessons found in this view</p>
            <p class="text-xs mt-1">Try widening your filters, switching the date range, or adding a lesson.</p>
          </div>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  tbody.innerHTML = rows.map((lesson) => {
    const statusLabel = getLessonStatusLabel(lesson.lesson_status);
    const statusClass = formatLessonStatusBadge(lesson.lesson_status);
    const paymentStatusLabel = getLessonManualPaymentStatusLabel(lesson.manual_payment_status);
    const paymentStatusClass = getLessonManualPaymentStatusBadge(lesson.manual_payment_status);

    return `
      <tr class="border-t border-cream/80 hover:bg-parchment/60 transition-colors">
        <td class="px-5 py-4 align-top">
          <button
            type="button"
            class="text-sm font-medium text-warmblack hover:text-gold transition-colors text-left"
            onclick="openLessonDetailModal('${lesson.lesson_id}')"
          >
            ${escapeHtml(formatLessonDate(lesson.scheduled_start))}
          </button>
          <div class="text-xs text-warmgray mt-1">${escapeHtml(lesson.lesson_id)}</div>
        </td>
        <td class="px-5 py-4 align-top">
          <div class="text-sm text-warmblack">${escapeHtml(formatLessonTimeRange(lesson.scheduled_start, lesson.scheduled_end))}</div>
        </td>
        <td class="px-5 py-4 align-top">
          ${
            lesson.student_id
              ? `<button
                  type="button"
                  class="text-sm font-medium text-warmblack hover:text-gold transition-colors text-left"
                  onclick="viewStudentProfileFromLesson('${lesson.student_id}')"
                >
                  ${escapeHtml(lesson.student_name)}
                </button>`
              : `<div class="text-sm font-medium text-warmblack">${escapeHtml(lesson.student_name)}</div>`
          }
        </td>
        <td class="px-5 py-4 align-top">
          <div class="text-sm text-warmblack">${escapeHtml(lesson.lesson_type)}</div>
        </td>
        <td class="px-5 py-4 align-top">
          <div class="text-sm text-warmblack">${escapeHtml(lesson.topic)}</div>
          ${lesson.previous_schedule_label ? `<div class="text-xs text-warmgray mt-1">Rescheduled from ${escapeHtml(lesson.previous_schedule_label)}</div>` : ""}
        </td>
        <td class="px-5 py-4 align-top">
          <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${statusClass}">
            ${escapeHtml(statusLabel)}
          </span>
          <div class="mt-2">
            <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${paymentStatusClass}">
              ${escapeHtml(paymentStatusLabel)}
            </span>
          </div>
        </td>
        <td class="px-5 py-4 align-top">
          <div class="text-sm text-warmblack">${escapeHtml(getLessonSourceLabel(lesson.source))}</div>
          <div class="text-xs text-warmgray mt-1 truncate max-w-[180px]">${escapeHtml(lesson.external_event_id || "—")}</div>
          ${
            lesson.source !== "manual"
              ? `<div class="mt-2 flex flex-wrap gap-1">
                  <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${getLessonIntakeReviewStateBadge(lesson.intake_review_state, lesson.source)}">
                    ${escapeHtml(getLessonIntakeReviewStateLabel(lesson.intake_review_state, lesson.source))}
                  </span>
                </div>`
              : ""
          }
        </td>
        <td class="px-5 py-4 align-top">
          <div class="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              class="px-3 py-2 rounded-lg bg-parchment border border-cream text-xs font-medium text-warmblack card-hover"
              onclick="openLessonDetailModal('${lesson.lesson_id}')"
            >
              Open Lesson
            </button>
            <button
              type="button"
              class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
              onclick="openLessonModal('edit', '${lesson.lesson_id}')"
            >
              Edit
            </button>
            <button
              type="button"
              class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
              onclick="quickChangeLessonStatus('${lesson.lesson_id}')"
            >
              Update Status
            </button>
            ${
              lesson.student_id
                ? `<button
                    type="button"
                    class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                    onclick="viewStudentProfileFromLesson('${lesson.student_id}')"
                  >
                    Open Student
                  </button>`
                : ""
            }
          </div>
        </td>
      </tr>
    `;
  }).join("");

  lucide.createIcons();
}

function renderLessonsPage() {
  const root = document.getElementById("page-root");
  if (!root) return;
  const summary = getLessonsPageSummaryRows();
  const compact = isCompactView("lessons");
  const filterPills = getLessonsFilterPills();

  root.innerHTML = `
    <div class="lessons-shell p-4 sm:p-6 xl:p-8 w-full ${compact ? "compact-view" : ""}">
      <header class="mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 fade-in">
        <div class="min-w-0">
          <h2 class="font-display text-2xl font-bold text-warmblack">Lessons</h2>
          <p class="text-sm text-warmgray mt-0.5">All lesson records across students</p>
        </div>

        <button
          id="add-lesson-page-btn"
          class="self-start lg:self-auto px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold flex items-center gap-2 card-hover"
        >
          <i data-lucide="plus" class="w-4 h-4"></i>
          Add Lesson
        </button>
      </header>

      <div class="page-summary-grid mb-5 fade-in" style="animation-delay:0.03s">
        <div class="page-summary-card">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Upcoming</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${summary.upcoming}</p>
        </div>
        <div class="page-summary-card">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Completed This Week</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${summary.completedThisWeek}</p>
        </div>
        <div class="page-summary-card">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Needs Intake Review</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${summary.intakeReview}</p>
        </div>
        <div class="page-summary-card">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Imported Lessons</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${summary.imported}</p>
        </div>
      </div>

      <div class="lessons-filter-panel page-toolbar-sticky bg-white rounded-2xl border border-cream p-4 mb-5 fade-in" style="animation-delay:0.05s">
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4">
          <div class="xl:col-span-4 relative">
            <i data-lucide="search" class="w-4 h-4 text-warmgray absolute left-3 top-1/2 -translate-y-1/2"></i>
            <input
              id="lessons-search"
              type="search"
              placeholder="Search by student, topic, type, or lesson ID..."
              value="${currentLessonsSearchQuery.replace(/"/g, "&quot;")}"
              class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-parchment border border-cream text-sm placeholder:text-warmgray/60"
              oninput="setLessonsSearchQuery(this.value)"
            />
          </div>

          <div class="xl:col-span-2">
            <select
              id="lessons-date-range-filter"
              class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"
              onchange="setLessonsDateRangeFilter(this.value)"
            >
              <option value="all" ${currentLessonsDateRangeFilter === "all" ? "selected" : ""}>All Dates</option>
              <option value="today" ${currentLessonsDateRangeFilter === "today" ? "selected" : ""}>Today</option>
              <option value="this-week" ${currentLessonsDateRangeFilter === "this-week" ? "selected" : ""}>This Week</option>
              <option value="this-month" ${currentLessonsDateRangeFilter === "this-month" ? "selected" : ""}>This Month</option>
              <option value="next-7" ${currentLessonsDateRangeFilter === "next-7" ? "selected" : ""}>Next 7 Days</option>
              <option value="next-30" ${currentLessonsDateRangeFilter === "next-30" ? "selected" : ""}>Next 30 Days</option>
              <option value="previous-7" ${currentLessonsDateRangeFilter === "previous-7" ? "selected" : ""}>Previous 7 Days</option>
              <option value="previous-30" ${currentLessonsDateRangeFilter === "previous-30" ? "selected" : ""}>Previous 30 Days</option>
            </select>
          </div>

          <div class="xl:col-span-2">
            <select
              id="lessons-status-filter"
              class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"
              onchange="setLessonsStatusFilter(this.value)"
            >
              <option value="all" ${currentLessonsStatusFilter === "all" ? "selected" : ""}>All Statuses</option>
              <option value="SCHEDULED" ${currentLessonsStatusFilter === "SCHEDULED" ? "selected" : ""}>Scheduled</option>
              <option value="COMPLETED" ${currentLessonsStatusFilter === "COMPLETED" ? "selected" : ""}>Completed</option>
              <option value="CANCELLED" ${currentLessonsStatusFilter === "CANCELLED" ? "selected" : ""}>Cancelled</option>
              <option value="LATE_CANCEL" ${currentLessonsStatusFilter === "LATE_CANCEL" ? "selected" : ""}>Late Cancel</option>
              <option value="NO_SHOW" ${currentLessonsStatusFilter === "NO_SHOW" ? "selected" : ""}>No Show</option>
            </select>
          </div>

          <div class="xl:col-span-4">
            <select
              id="lessons-student-filter"
              class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"
              onchange="setLessonsStudentFilter(this.value)"
            >
              ${getLessonsStudentFilterOptionsMarkup()}
            </select>
          </div>
        </div>

        <div class="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p id="lessons-results-count" class="text-xs text-warmgray">0 lessons shown</p>
          <div class="flex flex-wrap items-center gap-3">
            <button type="button" class="text-xs font-medium text-gold hover:underline" onclick="toggleCompactView('lessons')">${getCompactToggleLabel("lessons")}</button>
            <button
              type="button"
              class="text-xs font-medium text-gold hover:underline"
              onclick="currentLessonsStatusFilter='all'; currentLessonsStudentFilter='all'; currentLessonsSearchQuery=''; currentLessonsDateRangeFilter='all'; renderLessonsPage();"
            >
              Reset filters
            </button>
          </div>
        </div>
        ${filterPills.length ? `<div class="page-filter-summary mt-3">${filterPills.join("")}</div>` : ""}
      </div>

      <div class="lessons-results-panel bg-white rounded-2xl border border-cream overflow-hidden fade-in" style="animation-delay:0.1s">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[980px] text-sm ${compact ? "compact-table" : ""}">
            <thead class="bg-parchment/70">
              <tr class="text-left text-xs text-warmgray uppercase tracking-wider">
                <th class="px-5 py-3 font-medium">Date</th>
                <th class="px-5 py-3 font-medium">Time</th>
                <th class="px-5 py-3 font-medium">Student</th>
                <th class="px-5 py-3 font-medium">Type</th>
                <th class="px-5 py-3 font-medium">Topic</th>
                <th class="px-5 py-3 font-medium">Status</th>
                <th class="px-5 py-3 font-medium">Source</th>
                <th class="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="lessons-table-body"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const addLessonPageBtn = document.getElementById("add-lesson-page-btn");
  if (addLessonPageBtn) {
    addLessonPageBtn.onclick = () => openLessonModal("create");
  }

  renderLessonsRows();
  lucide.createIcons();
}

/*********************************
 * SCHEDULE / INTAKE PAGE
 *********************************/
function getScheduleIntakeRows() {
  return getLessonRecords()
    .filter((lesson) => isImportedLesson(lesson))
    .map((lesson) => {
      const student = getSchemaStudentById(lesson.student_id);
      const lessonDate = lesson.scheduled_start ? new Date(lesson.scheduled_start) : null;
      const isUpcoming = lessonDate && !Number.isNaN(lessonDate.getTime()) ? lessonDate >= APP_NOW : false;
      const reviewState = normalizeLessonIntakeReviewStateValue(lesson.intake_review_state, lesson.source);
      const syncState = normalizeLessonSyncStateValue(lesson.sync_state, lesson.source);
      const reviewGuidance = getImportedLessonReviewGuidance(lesson);

      return {
        lesson_id: lesson.lesson_id,
        student_id: lesson.student_id,
        student_name: student?.full_name || lesson.external_contact_name || "Unmatched Student",
        lesson_type: lesson.lesson_type || "General Coaching",
        topic: lesson.topic || "Untitled Lesson",
        scheduled_start: lesson.scheduled_start || "",
        scheduled_end: lesson.scheduled_end || "",
        source: lesson.source || "manual",
        source_label: getLessonSourceLabel(lesson.source),
        source_calendar_id: lesson.source_calendar_id || "",
        external_event_id: lesson.external_event_id || "",
        external_event_title: lesson.external_event_title || "",
        external_contact_name: lesson.external_contact_name || "",
        external_contact_email: lesson.external_contact_email || "",
        external_contact_phone: lesson.external_contact_phone || "",
        external_platform_hint: lesson.external_platform_hint || "",
        platform_hint_label: getImportedLessonPlatformLabel(lesson.external_platform_hint),
        sync_state: syncState,
        sync_state_label: getLessonSyncStateLabel(syncState, lesson.source),
        sync_state_badge: getLessonSyncStateBadge(syncState, lesson.source),
        intake_review_state: reviewState,
        intake_review_label: getLessonIntakeReviewStateLabel(reviewState, lesson.source),
        intake_review_badge: getLessonIntakeReviewStateBadge(reviewState, lesson.source),
        intake_conflict_note: lesson.intake_conflict_note || "",
        last_synced_at: lesson.last_synced_at || "",
        imported_at: lesson.imported_at || "",
        external_updated_at: lesson.external_updated_at || "",
        pending_external_start: lesson.pending_external_start || "",
        pending_external_end: lesson.pending_external_end || "",
        operational_status: getEffectiveLessonStatus(lesson),
        operational_status_label: getLessonStatusLabel(getEffectiveLessonStatus(lesson)),
        operational_status_badge: formatLessonStatusBadge(getEffectiveLessonStatus(lesson)),
        timing_key: isUpcoming ? "upcoming" : "past",
        action_required: isLessonIntakeActionRequired(lesson),
        review_priority: reviewGuidance.priority,
        review_priority_label: reviewGuidance.priority_label,
        review_priority_badge: reviewGuidance.priority_badge,
        review_reasons: reviewGuidance.reasons,
        recommended_action: reviewGuidance.recommended_action,
        recommended_action_label: reviewGuidance.recommended_action_label,
        review_blocking: reviewGuidance.blocking,
        sort_time: lessonDate && !Number.isNaN(lessonDate.getTime()) ? lessonDate.getTime() : 0
      };
    })
    .sort((a, b) => {
      const priorityWeight = { high: 0, medium: 1, low: 2 };
      if (a.timing_key === b.timing_key) {
        if (a.action_required !== b.action_required) {
          return a.action_required ? -1 : 1;
        }
        if (a.review_priority !== b.review_priority) {
          return (priorityWeight[a.review_priority] ?? 99) - (priorityWeight[b.review_priority] ?? 99);
        }
        return a.timing_key === "upcoming" ? a.sort_time - b.sort_time : b.sort_time - a.sort_time;
      }

      return a.timing_key === "upcoming" ? -1 : 1;
    });
}

function getFilteredScheduleIntakeRows() {
  let rows = getScheduleIntakeRows();

  if (currentScheduleTimingFilter !== "all") {
    rows = rows.filter((row) => row.timing_key === currentScheduleTimingFilter);
  }

  if (currentScheduleReviewFilter === "action-needed") {
    rows = rows.filter((row) => row.action_required);
  } else if (currentScheduleReviewFilter !== "all") {
    rows = rows.filter((row) => row.intake_review_state === currentScheduleReviewFilter);
  }

  if (currentScheduleSourceFilter !== "all") {
    const normalizedSourceFilter = String(currentScheduleSourceFilter || "").trim().toUpperCase();
    rows = rows.filter((row) =>
      row.source === currentScheduleSourceFilter ||
      String(row.external_platform_hint || "").trim().toUpperCase() === normalizedSourceFilter
    );
  }

  if (currentScheduleSearchQuery) {
    const query = currentScheduleSearchQuery.toLowerCase();
    rows = rows.filter((row) =>
      row.student_name.toLowerCase().includes(query) ||
      row.external_contact_name.toLowerCase().includes(query) ||
      row.external_contact_email.toLowerCase().includes(query) ||
      row.external_contact_phone.toLowerCase().includes(query) ||
      row.platform_hint_label.toLowerCase().includes(query) ||
      row.topic.toLowerCase().includes(query) ||
      row.lesson_type.toLowerCase().includes(query) ||
      row.lesson_id.toLowerCase().includes(query) ||
      row.external_event_id.toLowerCase().includes(query) ||
      row.review_reasons.some((reason) => reason.toLowerCase().includes(query)) ||
      row.recommended_action_label.toLowerCase().includes(query)
    );
  }

  return rows;
}

function setScheduleTimingFilter(value) {
  currentScheduleTimingFilter = value || "all";
  renderScheduleResults();
}

function setScheduleReviewFilter(value) {
  currentScheduleReviewFilter = value || "action-needed";
  renderScheduleResults();
}

function setScheduleSourceFilter(value) {
  currentScheduleSourceFilter = value || "all";
  renderScheduleResults();
}

function setScheduleSearchQuery(value) {
  currentScheduleSearchQuery = String(value || "").trimStart();
  renderScheduleResults();
}

function resetScheduleFilters() {
  currentScheduleTimingFilter = "upcoming";
  currentScheduleReviewFilter = "action-needed";
  currentScheduleSourceFilter = "all";
  currentScheduleSearchQuery = "";
  renderSchedulePage();
}

function getScheduleFilterPills() {
  const pills = [];
  pills.push(getStatusFilterPill("View", currentScheduleView === "calendar" ? `Calendar · ${currentScheduleCalendarMode}` : "Schedule Intake"));
  if (currentScheduleView === "intake") {
    if (currentScheduleTimingFilter !== "all") {
      pills.push(getStatusFilterPill("Timing", currentScheduleTimingFilter));
    }
    if (currentScheduleReviewFilter !== "all") {
      pills.push(getStatusFilterPill("Review", currentScheduleReviewFilter));
    }
    if (currentScheduleSourceFilter !== "all") {
      pills.push(getStatusFilterPill("Source", currentScheduleSourceFilter));
    }
    if (currentScheduleSearchQuery) {
      pills.push(getStatusFilterPill("Search", currentScheduleSearchQuery));
    }
  }
  return pills;
}

function setScheduleView(view) {
  currentScheduleView = view === "intake" ? "intake" : "calendar";
  renderSchedulePage();
}

function setScheduleCalendarMode(mode) {
  currentScheduleCalendarMode = ["day", "week", "month"].includes(mode) ? mode : "month";
  renderSchedulePage();
}

function getScheduleCalendarMonthLabel() {
  return currentScheduleCalendarMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });
}

function shiftScheduleCalendarMonth(offset) {
  currentScheduleCalendarMonth = new Date(
    currentScheduleCalendarMonth.getFullYear(),
    currentScheduleCalendarMonth.getMonth() + offset,
    1
  );
  renderSchedulePage();
}

function goToScheduleToday() {
  const today = typeof APP_NOW !== "undefined" ? APP_NOW : new Date();
  currentScheduleCalendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  currentScheduleSelectedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  renderSchedulePage();
}

function selectScheduleDate(dateKey) {
  currentScheduleSelectedDate = dateKey;
  renderSchedulePage();
}

function getCalendarDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getScheduleCalendarRows() {
  return getLessonRecords()
    .map((lesson) => {
      const student = getSchemaStudentById(lesson.student_id);
      const lessonDate = lesson.scheduled_start ? new Date(lesson.scheduled_start) : null;
      if (!lessonDate || Number.isNaN(lessonDate.getTime())) return null;

      return {
        lesson_id: lesson.lesson_id,
        student_id: lesson.student_id,
        student_name: student?.full_name || lesson.external_contact_name || "Unmatched Student",
        lead_source: student?.lead_source || "",
        lesson_type: lesson.lesson_type || "General Coaching",
        topic: lesson.topic || "Untitled Lesson",
        scheduled_start: lesson.scheduled_start,
        scheduled_end: lesson.scheduled_end,
        date_key: getCalendarDateKey(lessonDate),
        source: lesson.source || "manual",
        intake_action_required: isLessonIntakeActionRequired(lesson),
        status: getEffectiveLessonStatus(lesson),
        status_label: getLessonStatusLabel(getEffectiveLessonStatus(lesson)),
        status_badge: formatLessonStatusBadge(getEffectiveLessonStatus(lesson))
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
}

function getScheduleWeekDays() {
  const selectedDate = new Date(`${currentScheduleSelectedDate}T12:00:00`);
  const base = Number.isNaN(selectedDate.getTime()) ? getReferenceNow() : selectedDate;
  const weekStart = getStartOfWeek(base);

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysToDate(weekStart, index);
    const dateKey = getCalendarDateKey(date);
    return {
      date,
      date_key: dateKey,
      is_today: dateKey === getCalendarDateKey(getReferenceNow()),
      is_selected: dateKey === currentScheduleSelectedDate,
      lessons: getScheduleCalendarRows().filter((row) => row.date_key === dateKey)
    };
  });
}

function renderScheduleDayView() {
  const selectedRows = getScheduleCalendarRows().filter((row) => row.date_key === currentScheduleSelectedDate);
  const selectedDate = new Date(`${currentScheduleSelectedDate}T12:00:00`);
  const selectedDateLabel = Number.isNaN(selectedDate.getTime())
    ? currentScheduleSelectedDate
    : selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return `
    <div class="bg-white rounded-2xl border border-cream p-4 sm:p-5 fade-in" style="animation-delay:0.08s">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wider text-warmgray">Day View</p>
          <h3 class="font-display text-xl font-semibold text-warmblack mt-1">${escapeHtml(selectedDateLabel)}</h3>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="px-3 py-2 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmblack" onclick="selectScheduleDate('${getCalendarDateKey(addDaysToDate(selectedDate, -1))}')">Previous Day</button>
          <button type="button" class="px-3 py-2 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack" onclick="goToScheduleToday()">Today</button>
          <button type="button" class="px-3 py-2 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmblack" onclick="selectScheduleDate('${getCalendarDateKey(addDaysToDate(selectedDate, 1))}')">Next Day</button>
        </div>
      </div>

      <div class="space-y-3">
        ${
          selectedRows.length
            ? selectedRows.map((row) => `
                <div class="rounded-2xl border border-cream bg-parchment/55 p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <button type="button" class="text-base font-semibold text-warmblack hover:text-gold text-left transition-colors" onclick="openLessonDetailModal('${row.lesson_id}')">
                        ${escapeHtml(row.student_name)}
                      </button>
                      <p class="text-sm text-warmgray mt-1">${escapeHtml(formatLessonTimeRange(row.scheduled_start, row.scheduled_end))} · ${escapeHtml(row.lesson_type)}</p>
                    </div>
                    <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.status_badge}">
                      ${escapeHtml(row.status_label)}
                    </span>
                  </div>
                  <p class="text-sm text-warmblack mt-3 wrap-anywhere">${escapeHtml(row.topic)}</p>
                  <div class="flex flex-wrap items-center gap-2 mt-3">
                    <span class="text-[11px] px-2 py-1 rounded-full bg-white border border-cream text-warmgray">Lead Source · ${escapeHtml(getStudentLeadSourceLabel(row.lead_source))}</span>
                    ${row.source !== "manual" ? `<span class="text-[11px] px-2 py-1 rounded-full ${row.intake_action_required ? "bg-burgundy/10 text-burgundy" : "bg-sage/10 text-sage"}">${row.intake_action_required ? "Needs Intake Review" : "Imported"}</span>` : ""}
                  </div>
                    <div class="flex flex-wrap gap-2 mt-3">
                      <button type="button" class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack" onclick="openLessonDetailModal('${row.lesson_id}')">Open Lesson</button>
                      ${
                        row.student_id
                          ? `<button type="button" class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack" onclick="viewStudentProfileFromLesson('${row.student_id}')">Student</button>`
                          : `<button type="button" class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack" onclick="openScheduleStudentMatchModal('${row.lesson_id}')">Merge Student</button>`
                      }
                    </div>
                  </div>
                `).join("")
            : `<div class="rounded-2xl border border-cream bg-parchment p-5 text-sm text-warmgray">No lessons on this day yet.</div>`
        }
      </div>
    </div>
  `;
}

function renderScheduleWeekView() {
  const weekDays = getScheduleWeekDays();

  return `
    <div class="bg-white rounded-2xl border border-cream overflow-hidden fade-in" style="animation-delay:0.08s">
      <div class="px-4 sm:px-5 py-4 border-b border-cream flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wider text-warmgray">Week View</p>
          <h3 class="font-display text-xl font-semibold text-warmblack mt-1">Week of ${escapeHtml(weekDays[0].date.toLocaleDateString("en-US", { month: "long", day: "numeric" }))}</h3>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="px-3 py-2 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmblack" onclick="selectScheduleDate('${getCalendarDateKey(addDaysToDate(weekDays[0].date, -7))}')">Previous Week</button>
          <button type="button" class="px-3 py-2 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack" onclick="goToScheduleToday()">Today</button>
          <button type="button" class="px-3 py-2 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmblack" onclick="selectScheduleDate('${getCalendarDateKey(addDaysToDate(weekDays[0].date, 7))}')">Next Week</button>
        </div>
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-7">
        ${weekDays.map((day) => `
          <div class="border-r border-b border-cream last:border-r-0 min-w-0">
            <button
              type="button"
              class="w-full text-left px-4 py-3 ${day.is_selected ? "bg-gold/10" : "bg-parchment/60"}"
              onclick="selectScheduleDate('${day.date_key}')"
            >
              <p class="text-[11px] uppercase tracking-wider text-warmgray">${day.date.toLocaleDateString("en-US", { weekday: "short" })}</p>
              <p class="text-sm font-semibold text-warmblack mt-1">${day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
            </button>
            <div class="p-3 space-y-2 min-h-[260px]">
              ${
                day.lessons.length
                  ? day.lessons.map((lesson) => `
                      <div class="rounded-xl px-3 py-3 ${lesson.intake_action_required ? "bg-burgundy/8 border border-burgundy/15" : "bg-parchment border border-cream"}">
                        <button type="button" class="text-sm font-medium text-warmblack hover:text-gold text-left transition-colors" onclick="openLessonDetailModal('${lesson.lesson_id}')">
                          ${escapeHtml(formatLessonTime(lesson.scheduled_start))} · ${escapeHtml(lesson.student_name)}
                        </button>
                        <p class="text-[11px] text-warmgray mt-1 wrap-anywhere">${escapeHtml(lesson.topic)}</p>
                      </div>
                    `).join("")
                  : `<p class="text-xs text-warmgray">No lessons</p>`
              }
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function getScheduleCalendarGrid() {
  const monthStart = new Date(currentScheduleCalendarMonth.getFullYear(), currentScheduleCalendarMonth.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());

  const calendarRows = getScheduleCalendarRows();
  const days = [];

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = getCalendarDateKey(date);

    days.push({
      date,
      date_key: dateKey,
      in_month: date.getMonth() === currentScheduleCalendarMonth.getMonth(),
      is_today: dateKey === getCalendarDateKey(typeof APP_NOW !== "undefined" ? APP_NOW : new Date()),
      is_selected: dateKey === currentScheduleSelectedDate,
      lessons: calendarRows.filter((row) => row.date_key === dateKey)
    });
  }

  return days;
}

function renderScheduleCalendarView() {
  const days = getScheduleCalendarGrid();
  const selectedRows = getScheduleCalendarRows().filter((row) => row.date_key === currentScheduleSelectedDate);
  const selectedDate = new Date(`${currentScheduleSelectedDate}T12:00:00`);
  const selectedDateLabel = Number.isNaN(selectedDate.getTime())
    ? currentScheduleSelectedDate
    : selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return `
    <div class="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-5 fade-in" style="animation-delay:0.08s">
      <div class="bg-white rounded-2xl border border-cream overflow-hidden">
        <div class="px-4 sm:px-5 py-4 border-b border-cream flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div class="min-w-0">
            <p class="text-xs uppercase tracking-wider text-warmgray">Calendar View</p>
            <h3 class="font-display text-xl font-semibold text-warmblack mt-1">${escapeHtml(getScheduleCalendarMonthLabel())}</h3>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="px-3 py-2 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmblack" onclick="shiftScheduleCalendarMonth(-1)">Previous</button>
            <button type="button" class="px-3 py-2 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack" onclick="goToScheduleToday()">Today</button>
            <button type="button" class="px-3 py-2 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmblack" onclick="shiftScheduleCalendarMonth(1)">Next</button>
          </div>
        </div>
        <div class="grid grid-cols-7 bg-parchment/60 border-b border-cream">
          ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((label) => `
            <div class="px-3 py-2 text-[11px] uppercase tracking-wider text-warmgray font-medium">${label}</div>
          `).join("")}
        </div>
        <div class="grid grid-cols-7">
          ${days.map((day) => `
            <button
              type="button"
              class="schedule-day-cell min-h-[138px] border-b border-r border-cream px-2 py-2 text-left transition-colors ${day.in_month ? "bg-white hover:bg-parchment/40" : "bg-parchment/35 text-warmgray"} ${day.is_selected ? "ring-2 ring-inset ring-gold/40" : ""}"
              onclick="selectScheduleDate('${day.date_key}')"
            >
              <div class="flex items-center justify-between gap-2 mb-2">
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium ${day.is_today ? "bg-charcoal text-white" : day.is_selected ? "bg-gold/15 text-warmblack" : "text-warmblack"}">${day.date.getDate()}</span>
                ${day.lessons.length ? `<span class="text-[11px] text-warmgray">${day.lessons.length}</span>` : ""}
              </div>
              <div class="space-y-1.5">
                ${day.lessons.slice(0, 3).map((lesson) => `
                  <div class="rounded-lg px-2 py-1.5 ${lesson.intake_action_required ? "bg-burgundy/8 border border-burgundy/15" : "bg-parchment border border-cream"}">
                    <p class="text-[11px] font-medium text-warmblack truncate">${escapeHtml(formatLessonTime(lesson.scheduled_start))} · ${escapeHtml(lesson.student_name)}</p>
                    <p class="text-[11px] text-warmgray truncate">${escapeHtml(lesson.topic)}</p>
                  </div>
                `).join("")}
                ${day.lessons.length > 3 ? `<p class="text-[11px] text-warmgray px-1">+${day.lessons.length - 3} more</p>` : ""}
              </div>
            </button>
          `).join("")}
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-cream p-4 sm:p-5">
        <div class="mb-4">
          <p class="text-xs uppercase tracking-wider text-warmgray">Selected Day</p>
          <h3 class="font-display text-xl font-semibold text-warmblack mt-1">${escapeHtml(selectedDateLabel)}</h3>
          <p class="text-sm text-warmgray mt-1">${selectedRows.length} lesson${selectedRows.length === 1 ? "" : "s"} on this date</p>
        </div>

        <div class="space-y-3 max-h-[760px] overflow-y-auto pr-1">
          ${
            selectedRows.length
              ? selectedRows.map((row) => `
                  <div class="rounded-2xl border border-cream bg-parchment/55 p-4">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <button type="button" class="text-sm font-semibold text-warmblack hover:text-gold text-left transition-colors" onclick="openLessonDetailModal('${row.lesson_id}')">
                          ${escapeHtml(row.student_name)}
                        </button>
                        <p class="text-xs text-warmgray mt-1">${escapeHtml(formatLessonTimeRange(row.scheduled_start, row.scheduled_end))} · ${escapeHtml(row.lesson_type)}</p>
                      </div>
                      <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.status_badge}">
                        ${escapeHtml(row.status_label)}
                      </span>
                    </div>
                    <p class="text-sm text-warmblack mt-3 wrap-anywhere">${escapeHtml(row.topic)}</p>
                    <div class="flex flex-wrap items-center gap-2 mt-3">
                      <span class="text-[11px] px-2 py-1 rounded-full bg-white border border-cream text-warmgray">Lead Source · ${escapeHtml(getStudentLeadSourceLabel(row.lead_source))}</span>
                      ${row.source !== "manual" ? `<span class="text-[11px] px-2 py-1 rounded-full ${row.intake_action_required ? "bg-burgundy/10 text-burgundy" : "bg-sage/10 text-sage"}">${row.intake_action_required ? "Needs Intake Review" : "Imported"}</span>` : ""}
                    </div>
                    <div class="flex flex-wrap gap-2 mt-3">
                      <button type="button" class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack" onclick="openLessonDetailModal('${row.lesson_id}')">Open Lesson</button>
                      ${
                        row.student_id
                          ? `<button type="button" class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack" onclick="viewStudentProfileFromLesson('${row.student_id}')">Student</button>`
                          : `<button type="button" class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmgray" onclick="openScheduleStudentMatchModal('${row.lesson_id}')">Match Student</button>`
                      }
                    </div>
                  </div>
                `).join("")
              : `<div class="rounded-2xl border border-cream bg-parchment p-5 text-sm text-warmgray">No lessons on this day yet.</div>`
          }
        </div>
      </div>
    </div>
  `;
}

function confirmScheduleIntake(lessonId) {
  const lesson = getSchemaLessonById(lessonId);
  if (!lesson) return;
  const reviewGuidance = getImportedLessonReviewGuidance(lesson);
  if (!lesson.student_id) {
    notifyUser({
      title: "Schedule Intake",
      message: "Match this imported event to a student before confirming it.",
      tone: "error",
      source: "schedule"
    });
    return;
  }
  if (reviewGuidance.blocking) {
    notifyUser({
      title: "Schedule Intake",
      message: reviewGuidance.reasons[0] || "This imported lesson still needs review before it can be confirmed.",
      tone: "error",
      source: "schedule"
    });
    return;
  }

  const result = setLessonIntakeReviewState(lessonId, "CONFIRMED");
  if (!result || result.ok === false) {
    const errors = result?.errors || ["Unable to confirm imported lesson."];
    notifyUser({
      title: "Schedule Intake",
      message: errors.join(" "),
      tone: "error",
      source: "schedule"
    });
    return;
  }

  renderAppFromSchema();
  notifyUser({
    title: "Lesson Confirmed",
    message: "The imported lesson is confirmed and ready to drive workflow.",
    tone: "success",
    source: "schedule"
  });
}

function flagScheduleNeedsAttention(lessonId) {
  const lesson = getSchemaLessonById(lessonId);
  if (!lesson) return;

  const result = setLessonIntakeReviewState(
    lessonId,
    "NEEDS_ATTENTION",
    lesson.intake_conflict_note || "This imported lesson needs a manual review before it should drive follow-up."
  );

  if (!result || result.ok === false) {
    const errors = result?.errors || ["Unable to flag imported lesson."];
    notifyUser({
      title: "Schedule Intake",
      message: errors.join(" "),
      tone: "error",
      source: "schedule"
    });
    return;
  }

  renderAppFromSchema();
  notifyUser({
    title: "Needs Attention",
    message: "This imported lesson was moved into the attention queue.",
    tone: "warm",
    source: "schedule"
  });
}

function ignoreScheduleIntake(lessonId) {
  const result = setLessonIntakeReviewState(lessonId, "IGNORED");
  if (!result || result.ok === false) {
    const errors = result?.errors || ["Unable to ignore imported lesson."];
    notifyUser({
      title: "Schedule Intake",
      message: errors.join(" "),
      tone: "error",
      source: "schedule"
    });
    return;
  }

  renderAppFromSchema();
  notifyUser({
    title: "Lesson Ignored",
    message: "The imported lesson was removed from the active intake queue.",
    tone: "info",
    source: "schedule"
  });
}

function renderScheduleResults() {
  const resultsEl = document.getElementById("schedule-results");
  const countEl = document.getElementById("schedule-results-count");
  if (!resultsEl) return;

  const rows = getFilteredScheduleIntakeRows();

  if (countEl) {
    const actionCount = rows.filter((row) => row.action_required).length;
    const highPriorityCount = rows.filter((row) => row.review_priority === "high").length;
    countEl.textContent = `${rows.length} imported lesson${rows.length === 1 ? "" : "s"} shown${actionCount ? ` · ${actionCount} action needed` : ""}${highPriorityCount ? ` · ${highPriorityCount} high priority` : ""}`;
  }

  resultsEl.innerHTML = `
    <div class="bg-white rounded-2xl border border-cream overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[1380px] text-sm">
          <thead class="bg-parchment/70">
            <tr class="text-left text-xs text-warmgray uppercase tracking-wider">
              <th class="px-5 py-3 font-medium">When</th>
              <th class="px-5 py-3 font-medium">Student</th>
              <th class="px-5 py-3 font-medium">Lesson</th>
              <th class="px-5 py-3 font-medium">Review Guidance</th>
              <th class="px-5 py-3 font-medium">Operational Status</th>
              <th class="px-5 py-3 font-medium">Intake Review</th>
              <th class="px-5 py-3 font-medium">Sync</th>
              <th class="px-5 py-3 font-medium">Source</th>
              <th class="px-5 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map((row) => `
                    <tr class="border-t border-cream/80 hover:bg-parchment/60 transition-colors">
                      <td class="px-5 py-4 align-top">
                        <button
                          type="button"
                          class="text-sm font-medium text-warmblack hover:text-gold transition-colors text-left"
                          onclick="openLessonDetailModal('${row.lesson_id}')"
                        >
                          ${escapeHtml(formatLessonDate(row.scheduled_start))}
                        </button>
                        <div class="text-xs text-warmgray mt-1">${escapeHtml(formatLessonTimeRange(row.scheduled_start, row.scheduled_end))}</div>
                        <div class="text-xs text-warmgray mt-1">${row.timing_key === "upcoming" ? "Upcoming" : "Past Import"}</div>
                      </td>
                      <td class="px-5 py-4 align-top">
                        ${
                          row.student_id
                            ? `<button
                                type="button"
                                class="text-sm font-medium text-warmblack hover:text-gold transition-colors text-left"
                                onclick="openStudentProfileFromNotesQueue('${row.student_id}')"
                              >
                                ${escapeHtml(row.student_name)}
                              </button>`
                            : `<div class="text-sm font-medium text-warmblack">${escapeHtml(row.student_name)}</div>`
                        }
                        <div class="text-xs text-warmgray mt-1">${escapeHtml(row.lesson_id)}</div>
                        ${
                          row.external_contact_email || row.external_contact_phone
                            ? `<div class="text-xs text-warmgray mt-2">${escapeHtml(row.external_contact_email || row.external_contact_phone)}</div>`
                            : ""
                        }
                      </td>
                      <td class="px-5 py-4 align-top">
                        <div class="text-sm text-warmblack">${escapeHtml(row.topic)}</div>
                        <div class="text-xs text-warmgray mt-1">${escapeHtml(row.lesson_type)}</div>
                        ${
                          row.pending_external_start
                            ? `<div class="text-xs text-burgundy mt-2">Pending external change: ${escapeHtml(formatLessonTimeRange(row.pending_external_start, row.pending_external_end || row.pending_external_start))}</div>`
                            : ""
                        }
                        ${
                          row.intake_conflict_note
                            ? `<div class="text-xs text-burgundy mt-2 wrap-anywhere">${escapeHtml(row.intake_conflict_note)}</div>`
                            : ""
                        }
                      </td>
                      <td class="px-5 py-4 align-top">
                        <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.review_priority_badge}">
                          ${escapeHtml(row.review_priority_label)}
                        </span>
                        <div class="text-xs text-warmgray mt-2">${escapeHtml(row.recommended_action_label)}</div>
                        <div class="space-y-1 mt-2">
                          ${row.review_reasons.slice(0, 3).map((reason) => `<div class="text-xs text-warmgray wrap-anywhere">${escapeHtml(reason)}</div>`).join("")}
                        </div>
                      </td>
                      <td class="px-5 py-4 align-top">
                        <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.operational_status_badge}">
                          ${escapeHtml(row.operational_status_label)}
                        </span>
                      </td>
                      <td class="px-5 py-4 align-top">
                        <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.intake_review_badge}">
                          ${escapeHtml(row.intake_review_label)}
                        </span>
                        <div class="text-xs text-warmgray mt-1">${escapeHtml(formatLastSyncMeta(row.imported_at))} imported</div>
                      </td>
                      <td class="px-5 py-4 align-top">
                        <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.sync_state_badge}">
                          ${escapeHtml(row.sync_state_label)}
                        </span>
                        <div class="text-xs text-warmgray mt-1">${escapeHtml(formatLastSyncMeta(row.last_synced_at))}</div>
                      </td>
                      <td class="px-5 py-4 align-top">
                        <div class="text-sm text-warmblack">${escapeHtml(row.source_label)}</div>
                        <div class="text-xs text-warmgray mt-1">${escapeHtml(row.platform_hint_label)}</div>
                        <div class="text-xs text-warmgray mt-1 wrap-anywhere">${escapeHtml(row.external_event_id || "No external ID")}</div>
                        ${
                          row.source_calendar_id
                            ? `<div class="text-xs text-warmgray mt-1">Calendar: ${escapeHtml(row.source_calendar_id)}</div>`
                            : ""
                        }
                      </td>
                      <td class="px-5 py-4 align-top text-right">
                        <div class="flex flex-wrap gap-2 justify-end">
                          <button
                            type="button"
                            class="px-3 py-2 rounded-lg bg-parchment border border-cream text-xs font-medium text-warmblack card-hover"
                            onclick="openLessonDetailModal('${row.lesson_id}')"
                          >
                            ${row.review_blocking ? "Review Intake" : "Open Lesson"}
                          </button>
                          ${
                            row.student_id
                              ? row.recommended_action === "pull_contact"
                                ? `<button
                                    type="button"
                                    class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                                    onclick="pullStudentInfoFromLesson('${row.lesson_id}')"
                                  >
                                    Pull Contact
                                  </button>`
                                : ""
                              : `<button
                                  type="button"
                                  class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                                  onclick="openScheduleStudentMatchModal('${row.lesson_id}')"
                                >
                                  ${row.recommended_action === "match_student" ? "Review Match" : "Merge Student"}
                                </button>
                                <button
                                  type="button"
                                  class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                                  onclick="createStudentFromImportedLesson('${row.lesson_id}')"
                                >
                                  Create Student
                                </button>`
                          }
                          <button
                            type="button"
                            class="px-3 py-2 rounded-lg ${row.review_blocking ? "bg-white border border-cream text-warmgray" : "bg-white border border-cream text-warmblack"} text-xs font-medium card-hover"
                            onclick="confirmScheduleIntake('${row.lesson_id}')"
                          >
                            ${row.recommended_action === "confirm" ? "Confirm Intake" : "Confirm"}
                          </button>
                          <button
                            type="button"
                            class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                            onclick="${row.intake_review_state === "NEEDS_ATTENTION" ? `confirmScheduleIntake('${row.lesson_id}')` : `flagScheduleNeedsAttention('${row.lesson_id}')`}"
                          >
                            ${row.intake_review_state === "NEEDS_ATTENTION" ? "Clear Attention" : "Needs Attention"}
                          </button>
                          <button
                            type="button"
                            class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmgray card-hover"
                            onclick="ignoreScheduleIntake('${row.lesson_id}')"
                          >
                            Ignore
                          </button>
                        </div>
                      </td>
                    </tr>
                  `).join("")
                : `
                  <tr>
                    <td colspan="9" class="px-5 py-12 text-center">
                      <div class="flex flex-col items-center justify-center text-warmgray">
                        <i data-lucide="calendar-days" class="w-8 h-8 mb-3 opacity-50"></i>
                        <p class="text-sm font-medium">No imported lessons found</p>
                        <p class="text-xs mt-1">Once outside bookings are ingested, they will land here for review.</p>
                      </div>
                    </td>
                  </tr>
                `
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  lucide.createIcons();
}

function renderSchedulePage() {
  const root = document.getElementById("page-root");
  if (!root) return;

  syncCalendarStateFromBackendSettings();
  const importedRows = getScheduleIntakeRows();
  const allCalendarRows = getScheduleCalendarRows();
  const actionRows = importedRows.filter((row) => row.action_required);
  const upcomingRows = importedRows.filter((row) => row.timing_key === "upcoming");
  const confirmedRows = importedRows.filter((row) => row.intake_review_state === "CONFIRMED");
  const externallyUpdatedRows = importedRows.filter((row) => ["UPDATED_EXTERNALLY", "NEEDS_REVIEW"].includes(row.sync_state));
  const unmatchedRows = importedRows.filter((row) => !row.student_id);
  const backend = studioDataService.getBackendSettings();
  const googleAccountEmail = backend.google_account_email || "coach@d-a-j.com";
  const calendarStatus = backend.google_calendar_status || "demo_ready";
  const gmailStatus = backend.google_gmail_status || "demo_ready";
  const lastSyncSummary = calendarSyncState.last_sync_summary || { imported: 0, updated: 0, flagged: 0, skipped: 0 };
  const gmailSyncSummary = calendarSyncState.gmail_last_sync_summary || { imported: 0, flagged: 0, skipped: 0 };
  const compact = isCompactView("schedule");
  const filterPills = getScheduleFilterPills();

  root.innerHTML = `
    <div class="schedule-shell p-4 sm:p-6 xl:p-8 w-full ${compact ? "compact-view" : ""}">
      <header class="mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 fade-in">
        <div class="min-w-0">
          <h2 class="font-display text-2xl font-bold text-warmblack">Schedule</h2>
          <p class="text-sm text-warmgray mt-0.5">Calendar first for day-to-day studio flow, with intake review available when you need to reconcile imported bookings.</p>
        </div>

        <div class="flex flex-wrap gap-2">
          <div class="inline-flex rounded-xl border border-cream overflow-hidden bg-white">
            <button type="button" class="px-4 py-2.5 text-sm font-medium ${currentScheduleView === "calendar" ? "bg-parchment text-warmblack" : "bg-white text-warmgray"}" onclick="setScheduleView('calendar')">Calendar</button>
            <button type="button" class="px-4 py-2.5 text-sm font-medium ${currentScheduleView === "intake" ? "bg-parchment text-warmblack" : "bg-white text-warmgray"}" onclick="setScheduleView('intake')">Schedule Intake</button>
          </div>
          <button
            type="button"
            class="self-start lg:self-auto px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover"
            onclick="toggleCompactView('schedule')"
          >
            ${getCompactToggleLabel("schedule")}
          </button>
          <button
            type="button"
            class="self-start lg:self-auto px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover"
            onclick="navigateTo('lessons')"
          >
            Open All Lessons
          </button>
        </div>
      </header>

      ${
        currentScheduleView === "calendar"
          ? `
            <div class="mb-5 inline-flex rounded-xl border border-cream overflow-hidden bg-white fade-in" style="animation-delay:0.02s">
              <button type="button" class="px-4 py-2.5 text-sm font-medium ${currentScheduleCalendarMode === "day" ? "bg-parchment text-warmblack" : "bg-white text-warmgray"}" onclick="setScheduleCalendarMode('day')">Day</button>
              <button type="button" class="px-4 py-2.5 text-sm font-medium ${currentScheduleCalendarMode === "week" ? "bg-parchment text-warmblack" : "bg-white text-warmgray"}" onclick="setScheduleCalendarMode('week')">Week</button>
              <button type="button" class="px-4 py-2.5 text-sm font-medium ${currentScheduleCalendarMode === "month" ? "bg-parchment text-warmblack" : "bg-white text-warmgray"}" onclick="setScheduleCalendarMode('month')">Month</button>
            </div>
          `
          : ""
      }

      ${
        currentScheduleView === "intake"
          ? `
            <div class="rounded-2xl border border-cream bg-white p-4 mb-5 fade-in" style="animation-delay:0.025s">
              <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-xs font-medium uppercase tracking-wider text-warmgray">Google Calendar Sync</p>
                  <p class="text-sm text-warmgray mt-1">Main calendar only under ${escapeHtml(googleAccountEmail)}. Manual sync first. Lesson-like events from the past 30 days and next 60 days stay review-first, and external changes are flagged instead of silently trusted.</p>
                  <div class="flex flex-wrap gap-2 mt-3">
                    <span class="text-[11px] px-2 py-1 rounded-full ${getGoogleServiceStatusBadgeClass(calendarStatus)}">${escapeHtml(getGoogleServiceStatusLabel(calendarStatus))}</span>
                    <span class="text-[11px] px-2 py-1 rounded-full bg-parchment border border-cream text-warmgray">Account · ${escapeHtml(googleAccountEmail)}</span>
                    <span class="text-[11px] px-2 py-1 rounded-full bg-parchment border border-cream text-warmgray">Manual Sync</span>
                    <span class="text-[11px] px-2 py-1 rounded-full bg-parchment border border-cream text-warmgray">Window · Past ${calendarSyncState.sync_window_past_days} / Next ${calendarSyncState.sync_window_future_days}</span>
                    <span class="text-[11px] px-2 py-1 rounded-full bg-parchment border border-cream text-warmgray">Filter · Lesson-Like Events Only</span>
                  </div>
                  <p class="text-xs text-warmgray mt-3">${backend.google_calendar_last_sync_at ? `Last synced ${escapeHtml(formatLastSyncMeta(backend.google_calendar_last_sync_at))}` : calendarSyncState.last_sync_at ? `Last synced ${escapeHtml(formatLastSyncMeta(calendarSyncState.last_sync_at))}` : "No sync has run yet."}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold" onclick="runGoogleCalendarSync()">Run Sync</button>
                  <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack" onclick="checkGoogleConnectionStatus()">Refresh Status</button>
                </div>
              </div>
              <div class="grid grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
                <div class="rounded-xl border border-cream bg-parchment/60 px-4 py-3 min-w-0">
                  <p class="text-[11px] uppercase tracking-wider text-warmgray">Imported This Sync</p>
                  <p class="text-lg font-semibold text-warmblack mt-1">${lastSyncSummary.imported}</p>
                </div>
                <div class="rounded-xl border border-cream bg-parchment/60 px-4 py-3 min-w-0">
                  <p class="text-[11px] uppercase tracking-wider text-warmgray">Metadata Updated</p>
                  <p class="text-lg font-semibold text-warmblack mt-1">${lastSyncSummary.updated}</p>
                </div>
                <div class="rounded-xl border border-burgundy/20 bg-burgundy/5 px-4 py-3 min-w-0">
                  <p class="text-[11px] uppercase tracking-wider text-warmgray">Flagged Changes</p>
                  <p class="text-lg font-semibold text-burgundy mt-1">${lastSyncSummary.flagged}</p>
                </div>
                <div class="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3 min-w-0">
                  <p class="text-[11px] uppercase tracking-wider text-warmgray">Unmatched Students</p>
                  <p class="text-lg font-semibold text-warmblack mt-1">${unmatchedRows.length}</p>
                </div>
              </div>
            </div>

            <div class="rounded-2xl border border-cream bg-white p-4 mb-5 fade-in" style="animation-delay:0.03s">
              <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-xs font-medium uppercase tracking-wider text-warmgray">Gmail Assist</p>
                  <p class="text-sm text-warmgray mt-1">Supplemental booking-email intake under ${escapeHtml(googleAccountEmail)}. Manual sync only, booking-related messages only, and unmatched items always stay in review until you take action.</p>
                  <div class="flex flex-wrap gap-2 mt-3">
                    <span class="text-[11px] px-2 py-1 rounded-full ${getGoogleServiceStatusBadgeClass(gmailStatus)}">${escapeHtml(getGoogleServiceStatusLabel(gmailStatus))}</span>
                    <span class="text-[11px] px-2 py-1 rounded-full bg-parchment border border-cream text-warmgray">Account · ${escapeHtml(googleAccountEmail)}</span>
                    <span class="text-[11px] px-2 py-1 rounded-full bg-parchment border border-cream text-warmgray">Booking Emails Only</span>
                    <span class="text-[11px] px-2 py-1 rounded-full bg-parchment border border-cream text-warmgray">Supplemental Only</span>
                    <span class="text-[11px] px-2 py-1 rounded-full bg-parchment border border-cream text-warmgray">Review First</span>
                  </div>
                  <p class="text-xs text-warmgray mt-3">${backend.google_gmail_last_sync_at ? `Last synced ${escapeHtml(formatLastSyncMeta(backend.google_gmail_last_sync_at))}` : calendarSyncState.gmail_last_sync_at ? `Last synced ${escapeHtml(formatLastSyncMeta(calendarSyncState.gmail_last_sync_at))}` : "No Gmail assist sync has run yet."}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold" onclick="runGmailAssistSync()">Run Gmail Assist</button>
                  <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack" onclick="checkGoogleConnectionStatus()">Refresh Status</button>
                </div>
              </div>
              <div class="grid grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
                <div class="rounded-xl border border-cream bg-parchment/60 px-4 py-3 min-w-0">
                  <p class="text-[11px] uppercase tracking-wider text-warmgray">Imported This Sync</p>
                  <p class="text-lg font-semibold text-warmblack mt-1">${gmailSyncSummary.imported}</p>
                </div>
                <div class="rounded-xl border border-burgundy/20 bg-burgundy/5 px-4 py-3 min-w-0">
                  <p class="text-[11px] uppercase tracking-wider text-warmgray">Flagged For Review</p>
                  <p class="text-lg font-semibold text-burgundy mt-1">${gmailSyncSummary.flagged}</p>
                </div>
                <div class="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3 min-w-0">
                  <p class="text-[11px] uppercase tracking-wider text-warmgray">Skipped</p>
                  <p class="text-lg font-semibold text-warmblack mt-1">${gmailSyncSummary.skipped}</p>
                </div>
              </div>
            </div>
          `
          : ""
      }

      <div class="page-toolbar-sticky">
      <div class="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-3 fade-in" style="animation-delay:0.03s">
        <div class="rounded-2xl border border-cream bg-white px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">${currentScheduleView === "calendar" ? "This Month" : "Imported Upcoming"}</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${currentScheduleView === "calendar" ? allCalendarRows.filter((row) => {
            const start = new Date(row.scheduled_start);
            return start.getMonth() === currentScheduleCalendarMonth.getMonth() && start.getFullYear() === currentScheduleCalendarMonth.getFullYear();
          }).length : upcomingRows.length}</p>
        </div>
        <div class="rounded-2xl border ${actionRows.length ? "border-burgundy/20 bg-burgundy/5" : "border-cream bg-white"} px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">${currentScheduleView === "calendar" ? "Needs Intake Review" : "Action Needed"}</p>
          <p class="text-lg font-semibold ${actionRows.length ? "text-burgundy" : "text-warmblack"} mt-1">${actionRows.length}</p>
        </div>
        <div class="rounded-2xl border border-sage/20 bg-sage/5 px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">${currentScheduleView === "calendar" ? "Imported Confirmed" : "Confirmed"}</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${confirmedRows.length}</p>
        </div>
        <div class="rounded-2xl border border-gold/20 bg-gold/5 px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">${currentScheduleView === "calendar" ? "Imported Total" : "External Changes"}</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${currentScheduleView === "calendar" ? importedRows.length : externallyUpdatedRows.length}</p>
        </div>
      </div>
      ${filterPills.length ? `<div class="page-filter-summary mb-5 fade-in" style="animation-delay:0.035s">${filterPills.join("")}</div>` : ""}
      </div>

      ${
        currentScheduleView === "calendar"
          ? currentScheduleCalendarMode === "day"
            ? renderScheduleDayView()
            : currentScheduleCalendarMode === "week"
              ? renderScheduleWeekView()
              : renderScheduleCalendarView()
          : `
            <div class="rounded-2xl border border-cream bg-white p-4 mb-5 fade-in" style="animation-delay:0.05s">
              <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                <div class="min-w-0">
                  <p class="text-xs font-medium uppercase tracking-wider text-warmgray">Intake Rules</p>
                  <p class="text-sm text-warmgray mt-1">Imported lessons should arrive as tracked records, not as automatically trusted business truth. Use this queue to confirm changes before they drive follow-up and day-to-day operations.</p>
                </div>
                ${
                  actionRows.length
                    ? `<button
                        type="button"
                        class="px-4 py-2.5 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmblack self-start"
                        onclick="openLessonDetailModal('${actionRows[0].lesson_id}')"
                      >
                        Review Next Intake Item
                      </button>`
                    : ""
                }
              </div>
            </div>

            <div class="bg-white rounded-2xl border border-cream p-4 mb-5 fade-in" style="animation-delay:0.07s">
              <div class="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <div class="xl:col-span-5 relative min-w-0">
                  <i data-lucide="search" class="w-4 h-4 text-warmgray absolute left-3 top-1/2 -translate-y-1/2"></i>
                  <input
                    type="search"
                    value="${escapeHtml(currentScheduleSearchQuery)}"
                    placeholder="Search by student, topic, lesson ID, or external event..."
                    class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-parchment border border-cream text-sm placeholder:text-warmgray/60"
                    oninput="setScheduleSearchQuery(this.value)"
                  />
                </div>
                <div class="xl:col-span-2">
                  <select class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" onchange="setScheduleTimingFilter(this.value)">
                    <option value="all" ${currentScheduleTimingFilter === "all" ? "selected" : ""}>All Timing</option>
                    <option value="upcoming" ${currentScheduleTimingFilter === "upcoming" ? "selected" : ""}>Upcoming</option>
                    <option value="past" ${currentScheduleTimingFilter === "past" ? "selected" : ""}>Past Imports</option>
                  </select>
                </div>
                <div class="xl:col-span-3">
                  <select class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" onchange="setScheduleReviewFilter(this.value)">
                    <option value="action-needed" ${currentScheduleReviewFilter === "action-needed" ? "selected" : ""}>Action Needed</option>
                    <option value="all" ${currentScheduleReviewFilter === "all" ? "selected" : ""}>All Review States</option>
                    <option value="UNREVIEWED" ${currentScheduleReviewFilter === "UNREVIEWED" ? "selected" : ""}>Unreviewed</option>
                    <option value="CONFIRMED" ${currentScheduleReviewFilter === "CONFIRMED" ? "selected" : ""}>Confirmed</option>
                    <option value="NEEDS_ATTENTION" ${currentScheduleReviewFilter === "NEEDS_ATTENTION" ? "selected" : ""}>Needs Attention</option>
                    <option value="IGNORED" ${currentScheduleReviewFilter === "IGNORED" ? "selected" : ""}>Ignored</option>
                  </select>
                </div>
                <div class="xl:col-span-2">
                  <select class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" onchange="setScheduleSourceFilter(this.value)">
                    <option value="all" ${currentScheduleSourceFilter === "all" ? "selected" : ""}>All Sources</option>
                    <option value="google_calendar" ${currentScheduleSourceFilter === "google_calendar" ? "selected" : ""}>Google Calendar</option>
                    <option value="gmail" ${currentScheduleSourceFilter === "gmail" ? "selected" : ""}>Gmail Assist</option>
                    <option value="LESSONFACE" ${currentScheduleSourceFilter === "LESSONFACE" ? "selected" : ""}>Lessonface</option>
                    <option value="LESSONS_COM" ${currentScheduleSourceFilter === "LESSONS_COM" ? "selected" : ""}>Lessons.com</option>
                    <option value="ACUITY" ${currentScheduleSourceFilter === "ACUITY" ? "selected" : ""}>Acuity</option>
                    <option value="GOOGLE" ${currentScheduleSourceFilter === "GOOGLE" ? "selected" : ""}>Google</option>
                  </select>
                </div>
              </div>

              <div class="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p id="schedule-results-count" class="text-xs text-warmgray">0 imported lessons shown</p>
                <button type="button" class="text-xs font-medium text-gold hover:underline" onclick="resetScheduleFilters()">Reset filters</button>
              </div>
            </div>

            <div id="schedule-results" class="fade-in" style="animation-delay:0.09s"></div>
          `
      }
    </div>
  `;

  if (currentScheduleView === "intake") {
    renderScheduleResults();
  }
  lucide.createIcons();
}

/*********************************
 * AUTOMATIONS PAGE
 *********************************/
function isAutomationEnabled(key) {
  return automationSettings[key] !== false;
}

function setAutomationEnabled(key, enabled) {
  automationSettings = {
    ...automationSettings,
    [key]: Boolean(enabled)
  };
  saveAutomationSettings();

  if (typeof currentPage !== "undefined" && currentPage === "automations") {
    renderAutomationsPage();
  }
}

function toggleAutomationEnabled(key) {
  setAutomationEnabled(key, !isAutomationEnabled(key));
}

function getAllStaleDraftNotes(minDays = 7) {
  const cutoff = new Date(getReferenceNow());
  cutoff.setDate(cutoff.getDate() - Number(minDays || 7));

  return getNoteRecords()
    .filter((note) => normalizeNoteStatus(note.status) === "DRAFT")
    .map((note) => {
      const lastActivity = note.updated_at || note.created_at || "";
      const lastActivityDate = lastActivity ? new Date(lastActivity) : null;
      return {
        ...note,
        student_name: getSchemaStudentById(note.student_id)?.full_name || "Unknown Student",
        last_activity: lastActivity,
        last_activity_date: lastActivityDate && !Number.isNaN(lastActivityDate.getTime()) ? lastActivityDate : null
      };
    })
    .filter((note) => note.last_activity_date && note.last_activity_date <= cutoff)
    .sort((a, b) => a.last_activity_date - b.last_activity_date);
}

function getExternalChangeScheduleRows() {
  return getScheduleIntakeRows()
    .filter((row) => row.pending_external_start || row.pending_external_end || row.sync_state === "EXTERNALLY_UPDATED")
    .sort((a, b) => {
      const aTime = new Date(a.external_updated_at || a.last_synced_at || 0).getTime();
      const bTime = new Date(b.external_updated_at || b.last_synced_at || 0).getTime();
      return bTime - aTime;
    });
}

function getPublicPagePolicyStudents() {
  return getStudentRecords()
    .map((student) => ({
      student,
      late_cancel_count: getLateCancelCountForStudent(student.student_id, 6)
    }))
    .filter((row) => row.late_cancel_count >= 2)
    .sort((a, b) => b.late_cancel_count - a.late_cancel_count || a.student.full_name.localeCompare(b.student.full_name));
}

function getAutomationWorkflows() {
  const noteRows = getCompletedLessonsNeedingNotesRows().filter((row) => row.action_required);
  const overdueNoteRows = noteRows
    .filter((row) => row.urgency_key === "overdue")
    .slice()
    .sort((a, b) => new Date(a.completion_date || 0).getTime() - new Date(b.completion_date || 0).getTime());
  const staleDraftRows = getAllStaleDraftNotes(7);
  const intakeRows = getScheduleIntakeRows().filter((row) => row.action_required);
  const externalChangeRows = getExternalChangeScheduleRows();
  const policyRows = getPublicPagePolicyStudents();
  const blockedPolicyRows = policyRows.filter((row) => row.late_cancel_count >= 3);
  const warningPolicyRows = policyRows.filter((row) => row.late_cancel_count === 2);

  return [
    {
      key: "notes_follow_up",
      label: "Notes Follow-Up",
      description: "Keep completed lessons moving from missing or draft notes to published follow-up within 48 hours.",
      signal_count: noteRows.length,
      signal_label: noteRows.length === 1 ? "lesson needs follow-up" : "lessons need follow-up",
      highlight: overdueNoteRows.length ? `${overdueNoteRows.length} overdue` : noteRows.length ? "Inside 48-hour window" : "On track",
      tone_class: overdueNoteRows.length ? "border-burgundy/20 bg-burgundy/5" : noteRows.length ? "border-gold/20 bg-gold/5" : "border-sage/20 bg-sage/5",
      status_label: overdueNoteRows.length ? "Urgent" : noteRows.length ? "Monitoring" : "Clear",
      primary_action_label: overdueNoteRows.length ? "Open Oldest Due" : "Open Notes Queue",
      primary_action: "openAutomationNotesFollowUp()",
      secondary_action_label: noteRows.length ? "Notes Queue" : "",
      secondary_action: noteRows.length ? "openAutomationNotesQueue()" : "",
      attention_summary: overdueNoteRows.length
        ? `${overdueNoteRows[0].student_name} has the oldest overdue note follow-up.`
        : noteRows.length
          ? `${noteRows.length} completed lessons are still waiting on published notes.`
          : "No note follow-up is due right now."
    },
    {
      key: "stale_draft_cleanup",
      label: "Draft Cleanup",
      description: "Catch draft notes that have gone quiet so they do not get lost in the daily flow.",
      signal_count: staleDraftRows.length,
      signal_label: staleDraftRows.length === 1 ? "draft needs cleanup" : "drafts need cleanup",
      highlight: staleDraftRows.length ? `Older than 7 days` : "No stale drafts",
      tone_class: staleDraftRows.length ? "border-burgundy/20 bg-burgundy/5" : "border-sage/20 bg-sage/5",
      status_label: staleDraftRows.length ? "Needs Attention" : "Clear",
      primary_action_label: staleDraftRows.length ? "Open Oldest Draft" : "Review Notes",
      primary_action: staleDraftRows.length ? "openAutomationStaleDrafts()" : "openAutomationNotesQueue()",
      secondary_action_label: staleDraftRows.length ? "Notes Queue" : "",
      secondary_action: staleDraftRows.length ? "openAutomationNotesQueue()" : "",
      attention_summary: staleDraftRows.length
        ? `${staleDraftRows[0].student_name} has the oldest draft still waiting on cleanup.`
        : "Draft cleanup is under control right now."
    },
    {
      key: "intake_review",
      label: "Intake Review",
      description: "Surface imported lessons that still need matching, confirmation, or manual review before they become trusted.",
      signal_count: intakeRows.length,
      signal_label: intakeRows.length === 1 ? "import needs review" : "imports need review",
      highlight: intakeRows.length ? `${intakeRows.filter((row) => row.source === "gmail").length} from Gmail Assist` : "Queue clear",
      tone_class: intakeRows.length ? "border-burgundy/20 bg-burgundy/5" : "border-sage/20 bg-sage/5",
      status_label: intakeRows.length ? "Action Needed" : "Clear",
      primary_action_label: "Open Intake",
      primary_action: "openAutomationIntakeReview()",
      secondary_action_label: intakeRows.length ? "Review Next" : "",
      secondary_action: intakeRows.length ? `openLessonDetailModal('${intakeRows[0].lesson_id}')` : "",
      attention_summary: intakeRows.length
        ? `${intakeRows[0].student_name} is at the top of the intake review queue.`
        : "Imported lessons are currently reviewed and confirmed."
    },
    {
      key: "external_change_watch",
      label: "External Changes",
      description: "Flag calendar or email-driven lesson updates without silently overwriting the studio record you already trust.",
      signal_count: externalChangeRows.length,
      signal_label: externalChangeRows.length === 1 ? "lesson changed externally" : "lessons changed externally",
      highlight: externalChangeRows.length ? "Review before trusting updates" : "No pending changes",
      tone_class: externalChangeRows.length ? "border-gold/20 bg-gold/5" : "border-sage/20 bg-sage/5",
      status_label: externalChangeRows.length ? "Review Pending" : "Clear",
      primary_action_label: externalChangeRows.length ? "Review Changes" : "Open Intake",
      primary_action: "openAutomationExternalChanges()",
      secondary_action_label: externalChangeRows.length ? "Open Lesson" : "",
      secondary_action: externalChangeRows.length ? `openLessonDetailModal('${externalChangeRows[0].lesson_id}')` : "",
      attention_summary: externalChangeRows.length
        ? `${externalChangeRows[0].student_name} has the most recent external schedule change waiting for review.`
        : "No imported lessons have pending external changes right now."
    },
    {
      key: "public_page_policy",
      label: "Public Page Policy Watch",
      description: "Track late-cancel risk so public-page eligibility does not slip without you noticing.",
      signal_count: policyRows.length,
      signal_label: policyRows.length === 1 ? "student is on policy watch" : "students are on policy watch",
      highlight: blockedPolicyRows.length
        ? `${blockedPolicyRows.length} blocked`
        : warningPolicyRows.length
          ? `${warningPolicyRows.length} nearing threshold`
          : "No current policy flags",
      tone_class: blockedPolicyRows.length ? "border-burgundy/20 bg-burgundy/5" : warningPolicyRows.length ? "border-gold/20 bg-gold/5" : "border-sage/20 bg-sage/5",
      status_label: blockedPolicyRows.length ? "Blocked" : warningPolicyRows.length ? "Warning" : "Clear",
      primary_action_label: policyRows.length ? "Open Student" : "Review Profiles",
      primary_action: "openAutomationPublicPagePolicy()",
      secondary_action_label: blockedPolicyRows.length ? "Public Page" : "",
      secondary_action: blockedPolicyRows.length ? "navigateTo('public')" : "",
      attention_summary: blockedPolicyRows.length
        ? `${blockedPolicyRows[0].student.full_name} is currently blocked by the late-cancel policy.`
        : warningPolicyRows.length
          ? `${warningPolicyRows[0].student.full_name} is one late cancel away from a public-page block.`
          : "No students are currently triggering the public-page late-cancel rule."
    }
  ];
}

function getAutomationAttentionRows() {
  return getAutomationWorkflows()
    .filter((workflow) => isAutomationEnabled(workflow.key) && workflow.signal_count > 0)
    .map((workflow) => ({
      ...workflow,
      priority:
        workflow.key === "notes_follow_up" && /Urgent/i.test(workflow.status_label) ? 0
          : workflow.key === "intake_review" ? 1
            : workflow.key === "public_page_policy" && /Blocked/i.test(workflow.status_label) ? 1
              : workflow.key === "external_change_watch" ? 2
                : 3
    }))
    .sort((a, b) => a.priority - b.priority || b.signal_count - a.signal_count);
}

function openAutomationNotesQueue() {
  currentNotesQueueFilter = "all";
  currentNotesQueueSearchQuery = "";
  navigateTo("notes");
}

function openAutomationNotesFollowUp() {
  const overdueRow = getCompletedLessonsNeedingNotesRows()
    .filter((row) => row.action_required && row.urgency_key === "overdue")
    .slice()
    .sort((a, b) => new Date(a.completion_date || 0).getTime() - new Date(b.completion_date || 0).getTime())[0];

  if (overdueRow) {
    openNoteWorkspace(overdueRow.student_id, overdueRow.lesson_id);
    return;
  }

  openAutomationNotesQueue();
}

function openAutomationStaleDrafts() {
  const oldestDraft = getAllStaleDraftNotes(7)[0];
  if (oldestDraft) {
    openNoteWorkspace(oldestDraft.student_id, oldestDraft.lesson_id);
    return;
  }

  openAutomationNotesQueue();
}

function openAutomationIntakeReview() {
  currentScheduleView = "intake";
  currentScheduleTimingFilter = "upcoming";
  currentScheduleReviewFilter = "action-needed";
  currentScheduleSourceFilter = "all";
  currentScheduleSearchQuery = "";
  navigateTo("schedule");
}

function openAutomationExternalChanges() {
  const changedRow = getExternalChangeScheduleRows()[0];
  currentScheduleView = "intake";
  currentScheduleTimingFilter = "all";
  currentScheduleReviewFilter = "all";
  currentScheduleSourceFilter = "all";
  currentScheduleSearchQuery = "";

  if (changedRow) {
    navigateTo("schedule");
    openLessonDetailModal(changedRow.lesson_id);
    return;
  }

  navigateTo("schedule");
}

function openAutomationPublicPagePolicy() {
  const target = getPublicPagePolicyStudents()[0];
  if (target) {
    selectedStudentId = target.student.student_id;
    navigateTo("profile");
    return;
  }

  navigateTo("public");
}

function renderAutomationsPage() {
  const root = document.getElementById("page-root");
  if (!root) return;

  const workflows = getAutomationWorkflows();
  const enabledWorkflows = workflows.filter((workflow) => isAutomationEnabled(workflow.key));
  const attentionRows = getAutomationAttentionRows();
  const notesWorkflow = workflows.find((workflow) => workflow.key === "notes_follow_up");
  const intakeWorkflow = workflows.find((workflow) => workflow.key === "intake_review");
  const blockedPolicyWorkflow = workflows.find((workflow) => workflow.key === "public_page_policy");

  root.innerHTML = `
    <div class="p-4 sm:p-6 xl:p-8 w-full automation-shell">
      <header class="mb-6 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 fade-in">
        <div class="min-w-0">
          <h2 class="font-display text-2xl font-bold text-warmblack">Automations</h2>
          <p class="text-sm text-warmgray mt-0.5">In-app reminder workflows for notes, intake follow-up, and policy watch. Live background delivery can plug into these rules later in Phase 5.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="openAutomationNotesQueue()">Notes Queue</button>
          <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="openAutomationIntakeReview()">Schedule Intake</button>
        </div>
      </header>

      <div class="grid grid-cols-2 xl:grid-cols-5 gap-4 mb-6 fade-in" style="animation-delay:0.02s">
        <div class="rounded-2xl border border-cream bg-white px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Enabled Workflows</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${enabledWorkflows.length}</p>
        </div>
        <div class="rounded-2xl border ${attentionRows.length ? "border-burgundy/20 bg-burgundy/5" : "border-sage/20 bg-sage/5"} px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Attention Now</p>
          <p class="text-lg font-semibold ${attentionRows.length ? "text-burgundy" : "text-warmblack"} mt-1">${attentionRows.length}</p>
        </div>
        <div class="rounded-2xl border ${notesWorkflow?.signal_count ? "border-gold/20 bg-gold/5" : "border-cream bg-white"} px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Notes Follow-Up</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${notesWorkflow?.signal_count || 0}</p>
        </div>
        <div class="rounded-2xl border ${intakeWorkflow?.signal_count || blockedPolicyWorkflow?.signal_count ? "border-blue-200 bg-blue-50" : "border-cream bg-white"} px-4 py-3 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Intake / Policy</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${(intakeWorkflow?.signal_count || 0) + (blockedPolicyWorkflow?.signal_count || 0)}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6 fade-in" style="animation-delay:0.04s">
        ${workflows.map((workflow) => `
          <div class="rounded-2xl border ${workflow.tone_class} p-4 sm:p-5 min-w-0">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2 mb-2">
                  <p class="text-xs font-medium uppercase tracking-wider text-warmgray">${escapeHtml(workflow.label)}</p>
                  <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${isAutomationEnabled(workflow.key) ? "bg-white border border-cream text-warmblack" : "bg-warmgray/10 text-warmgray"}">
                    ${isAutomationEnabled(workflow.key) ? escapeHtml(workflow.status_label) : "Paused"}
                  </span>
                </div>
                <h3 class="font-display text-xl font-semibold text-warmblack">${workflow.signal_count}</h3>
                <p class="text-sm text-warmgray mt-1">${escapeHtml(workflow.signal_label)}</p>
                <p class="text-sm text-warmblack mt-3 wrap-anywhere">${escapeHtml(workflow.description)}</p>
                <p class="text-xs text-warmgray mt-3">${escapeHtml(workflow.highlight)}</p>
              </div>
              <button
                type="button"
                class="px-3 py-2 rounded-xl ${isAutomationEnabled(workflow.key) ? "bg-white border border-cream text-warmblack" : "bg-parchment border border-cream text-warmgray"} text-sm font-medium self-start card-hover"
                onclick="toggleAutomationEnabled('${workflow.key}')"
              >
                ${isAutomationEnabled(workflow.key) ? "Pause" : "Resume"}
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-2 mt-4">
              <button
                type="button"
                class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover"
                onclick="${workflow.primary_action}"
              >
                ${escapeHtml(workflow.primary_action_label)}
              </button>
              ${
                workflow.secondary_action_label
                  ? `
                    <button
                      type="button"
                      class="px-4 py-2.5 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmgray card-hover"
                      onclick="${workflow.secondary_action}"
                    >
                      ${escapeHtml(workflow.secondary_action_label)}
                    </button>
                  `
                  : ""
              }
            </div>
          </div>
        `).join("")}
      </div>

      <div class="rounded-2xl border border-cream bg-white p-4 sm:p-5 fade-in" style="animation-delay:0.06s">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div class="min-w-0">
            <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Attention Queue</p>
            <h3 class="font-display text-xl font-semibold text-warmblack mt-1">What needs follow-up right now</h3>
          </div>
          <span class="text-xs text-warmgray">${attentionRows.length} active workflow${attentionRows.length === 1 ? "" : "s"}</span>
        </div>

        ${
          attentionRows.length
            ? `
              <div class="space-y-3">
                ${attentionRows.map((row) => `
                  <div class="rounded-2xl border border-cream bg-parchment/60 p-4">
                    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2 mb-1">
                          <p class="text-sm font-semibold text-warmblack">${escapeHtml(row.label)}</p>
                          <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.tone_class.includes("burgundy") ? "bg-burgundy/10 text-burgundy" : row.tone_class.includes("gold") ? "bg-gold/10 text-gold" : "bg-sage/10 text-sage"}">
                            ${escapeHtml(row.status_label)}
                          </span>
                        </div>
                        <p class="text-sm text-warmgray wrap-anywhere">${escapeHtml(row.attention_summary)}</p>
                      </div>
                      <div class="flex flex-wrap gap-2">
                        <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="${row.primary_action}">
                          ${escapeHtml(row.primary_action_label)}
                        </button>
                        ${
                          row.secondary_action_label
                            ? `<button type="button" class="px-4 py-2.5 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmgray card-hover" onclick="${row.secondary_action}">
                                ${escapeHtml(row.secondary_action_label)}
                              </button>`
                            : ""
                        }
                      </div>
                    </div>
                  </div>
                `).join("")}
              </div>
            `
            : `
              <div class="rounded-2xl border border-sage/20 bg-sage/5 px-4 py-6 text-center">
                <p class="text-sm font-medium text-warmblack">No active automation follow-up right now.</p>
                <p class="text-xs text-warmgray mt-1">Your notes, intake queue, and late-cancel policy watch are currently in a good place.</p>
              </div>
            `
        }
      </div>
    </div>
  `;

  lucide.createIcons();
}

/*********************************
 * SETTINGS / PERSISTENCE PAGE
 *********************************/
function setSettingsActionFeedback(message, tone = "warm") {
  settingsActionMessage = String(message || "").trim();
  settingsActionTone = tone || "warm";
}

function getSettingsActionFeedbackMarkup() {
  if (!settingsActionMessage) return "";

  const toneClass =
    settingsActionTone === "success"
      ? "border-sage/20 bg-sage/5 text-sage"
      : settingsActionTone === "error"
        ? "border-burgundy/20 bg-burgundy/5 text-burgundy"
        : "border-gold/20 bg-gold/5 text-warmblack";

  return `
    <div class="rounded-2xl border ${toneClass} px-4 py-3 mb-5">
      <p class="text-sm wrap-anywhere">${escapeHtml(settingsActionMessage)}</p>
    </div>
  `;
}

function getPersistenceModeLabel(mode) {
  if (mode === "google_sheets") return "Google Sheets via Backend";
  return "Local Cache";
}

function getSettingsStatusBadgeClass(status) {
  if (["success", "connected", "pulled"].includes(status)) return "bg-sage/10 text-sage";
  if (["error", "retry-pending"].includes(status)) return "bg-burgundy/10 text-burgundy";
  if (["local-only", "idle"].includes(status)) return "bg-gold/10 text-gold";
  return "bg-warmgray/10 text-warmgray";
}

function getAdminSecurityStatusLabel() {
  if (!adminAuthSettings.require_unlock || !adminAuthSettings.local_passcode) return "Open";
  return isPortalLocked() ? "Locked" : "Unlocked";
}

function getAdminSecurityStatusBadgeClass() {
  const label = getAdminSecurityStatusLabel();
  if (label === "Unlocked") return "bg-sage/10 text-sage";
  if (label === "Locked") return "bg-burgundy/10 text-burgundy";
  return "bg-gold/10 text-gold";
}

function openGoogleSheetsBlueprintReference() {
  navigateTo("settings");
}

async function savePersistenceSettings(event) {
  if (event) event.preventDefault();
  const form = document.getElementById("settings-persistence-form");
  if (!form) return;

  const nextSettings = studioDataService.updateBackendSettings({
    persistence_mode: form.elements.persistence_mode.value,
    cache_enabled: form.elements.cache_enabled.checked,
    auto_sync: form.elements.auto_sync.checked,
    google_sheets_web_app_url: form.elements.google_sheets_web_app_url.value,
    api_token: form.elements.api_token.value
  });

  setSettingsActionFeedback(
    nextSettings.persistence_mode === "google_sheets"
      ? "Backend settings saved. Use a server-side proxy/backend URL here, then test the connection and sync a snapshot."
      : "Settings saved. The portal is currently persisting to local cache on this browser.",
    "success"
  );
  renderSettingsPage();
}

function saveAdminSecuritySettings(event) {
  if (event) event.preventDefault();
  const form = document.getElementById("settings-admin-security-form");
  if (!form) return;

  const passcode = String(form.elements.local_passcode.value || "").trim();
  const confirmPasscode = String(form.elements.confirm_passcode.value || "").trim();
  const requireUnlock = form.elements.require_unlock.checked;
  const timeoutMinutes = Math.max(5, Number(form.elements.session_timeout_minutes.value || 30));

  if (requireUnlock && !passcode) {
    setSettingsActionFeedback("Set a passcode before turning on the admin access gate.", "error");
    renderSettingsPage();
    return;
  }

  if (passcode && passcode !== confirmPasscode) {
    setSettingsActionFeedback("Passcode confirmation didn’t match.", "error");
    renderSettingsPage();
    return;
  }

  adminAuthSettings = {
    require_unlock: requireUnlock,
    local_passcode: passcode,
    session_timeout_minutes: timeoutMinutes
  };
  saveAdminAuthSettings();

  if (!requiresAdminUnlock()) {
    setAdminSessionUnlocked(true);
    clearAdminAuthMessage();
  } else {
    lockPortalSession("Admin security settings updated. Unlock the portal with your new passcode.");
  }

  setSettingsActionFeedback(
    requiresAdminUnlock()
      ? "Admin access gate saved. The hosted portal will now require your passcode after refresh or timeout."
      : "Admin access gate is turned off for now.",
    "success"
  );
  renderSettingsPage();
}

async function runBackendConnectionTest() {
  try {
    await studioDataService.testBackendConnection();
    setSettingsActionFeedback("Connection succeeded. The backend/proxy is reachable from the portal.", "success");
  } catch (error) {
    setSettingsActionFeedback(error.message || "Unable to reach the Google Sheets backend.", "error");
  }
  renderSettingsPage();
}

async function syncSettingsSnapshotToBackend() {
  const result = await studioDataService.syncToBackend();
  if (result.ok) {
    setSettingsActionFeedback(
      result.mode === "google_sheets"
        ? "Current studio data snapshot pushed through the backend/proxy."
        : "Snapshot saved locally. Switch to Google Sheets mode when you are ready to sync remotely.",
      "success"
    );
  } else {
    setSettingsActionFeedback(result.error || "Unable to sync the current studio snapshot.", "error");
  }
  renderSettingsPage();
}

async function pullSettingsSnapshotFromBackend() {
  if (!confirm("Pulling from the backend will replace the current in-browser data with the backend snapshot. Continue?")) {
    return;
  }

  try {
    await studioDataService.pullFromBackend();
    setSettingsActionFeedback("Backend snapshot pulled into the portal and saved to local cache.", "success");
  } catch (error) {
    setSettingsActionFeedback(error.message || "Unable to pull a snapshot from the backend.", "error");
  }

  renderSettingsPage();
}

function renderSettingsPage() {
  const root = document.getElementById("page-root");
  if (!root) return;

  syncCalendarStateFromBackendSettings();
  const backend = studioDataService.getBackendSettings();
  const status = studioDataService.getPersistenceStatus();
  const blueprint = studioDataService.getGoogleSheetsBlueprint();
  const blueprintRows = Object.entries(blueprint);

  root.innerHTML = `
    <div class="p-4 sm:p-6 xl:p-8 w-full settings-shell">
      <header class="mb-6 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 fade-in">
        <div class="min-w-0">
          <h2 class="font-display text-2xl font-bold text-warmblack">Settings</h2>
          <p class="text-sm text-warmgray mt-0.5">Persistence, hosted admin access, and manual Google connection controls now live together here. Google Calendar and Gmail still stay review-first until the live OAuth layer is added.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="syncSettingsSnapshotToBackend()">Push Snapshot</button>
          <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="pullSettingsSnapshotFromBackend()">Pull Snapshot</button>
        </div>
      </header>

      ${getSettingsActionFeedbackMarkup()}

      <div class="grid grid-cols-2 xl:grid-cols-6 gap-4 mb-6 fade-in" style="animation-delay:0.02s">
        <div class="rounded-2xl border border-cream bg-white px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Mode</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${escapeHtml(getPersistenceModeLabel(status.mode))}</p>
        </div>
        <div class="rounded-2xl border ${status.queue_count ? "border-gold/20 bg-gold/5" : "border-sage/20 bg-sage/5"} px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Pending Changes</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${status.queue_count}</p>
        </div>
        <div class="rounded-2xl border border-cream bg-white px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Last Sync</p>
          <p class="text-sm font-semibold text-warmblack mt-1">${escapeHtml(formatLastSyncMeta(status.last_sync_at))}</p>
        </div>
        <div class="rounded-2xl border border-cream bg-white px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Status</p>
          <p class="mt-1">
            <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${getSettingsStatusBadgeClass(status.last_sync_status)}">
              ${escapeHtml(status.last_sync_status || "idle")}
            </span>
          </p>
        </div>
        <div class="rounded-2xl border border-cream bg-white px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Admin Access</p>
          <p class="mt-1">
            <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${getAdminSecurityStatusBadgeClass()}">
              ${escapeHtml(getAdminSecurityStatusLabel())}
            </span>
          </p>
        </div>
        <div class="rounded-2xl border border-cream bg-white px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Google Account</p>
          <p class="text-sm font-semibold text-warmblack mt-1 wrap-anywhere">${escapeHtml(backend.google_account_email || "Not set")}</p>
        </div>
        <div class="rounded-2xl border border-cream bg-white px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Google Intake</p>
          <p class="mt-1 flex flex-wrap gap-1.5">
            <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${getGoogleServiceStatusBadgeClass(backend.google_calendar_status)}">${escapeHtml(getGoogleServiceStatusLabel(backend.google_calendar_status))}</span>
            <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${getGoogleServiceStatusBadgeClass(backend.google_gmail_status)}">${escapeHtml(getGoogleServiceStatusLabel(backend.google_gmail_status))}</span>
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-5">
        <div class="space-y-5">
          <form id="settings-persistence-form" class="rounded-2xl border border-cream bg-white p-4 sm:p-5 fade-in" style="animation-delay:0.04s" onsubmit="savePersistenceSettings(event)">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
              <div class="min-w-0">
                <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Persistence</p>
                <h3 class="font-display text-xl font-semibold text-warmblack mt-1">Data storage and backend bridge</h3>
                <p class="text-sm text-warmgray mt-1">Everything already saves to this browser. Switch to Google Sheets mode when your backend/proxy endpoint is ready.</p>
              </div>
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <label class="block">
                <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Persistence Mode</span>
                <select name="persistence_mode" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
                  <option value="local_cache" ${backend.persistence_mode === "local_cache" ? "selected" : ""}>Local Cache</option>
                  <option value="google_sheets" ${backend.persistence_mode === "google_sheets" ? "selected" : ""}>Google Sheets via Backend</option>
                </select>
              </label>

              <label class="block">
                <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Backend / Proxy URL</span>
                <input
                  name="google_sheets_web_app_url"
                  type="url"
                  value="${escapeHtml(backend.google_sheets_web_app_url)}"
                  placeholder="https://your-backend.example.com/api/studio-sync"
                  class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"
                />
              </label>

              <label class="block xl:col-span-2">
                <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Shared Token</span>
                <input
                  name="api_token"
                  type="text"
                  value="${escapeHtml(backend.api_token)}"
                  placeholder="Optional shared secret for the backend"
                  class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"
                />
              </label>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <label class="rounded-xl border border-cream bg-parchment px-4 py-3 flex items-start gap-3">
                <input type="checkbox" name="cache_enabled" class="mt-1" ${backend.cache_enabled ? "checked" : ""}>
                <span class="min-w-0">
                  <span class="block text-sm font-medium text-warmblack">Keep local cache on this browser</span>
                  <span class="block text-xs text-warmgray mt-1">This makes refresh persistence work even before the Google Sheets backend is live.</span>
                </span>
              </label>
              <label class="rounded-xl border border-cream bg-parchment px-4 py-3 flex items-start gap-3">
                <input type="checkbox" name="auto_sync" class="mt-1" ${backend.auto_sync ? "checked" : ""}>
                <span class="min-w-0">
                  <span class="block text-sm font-medium text-warmblack">Auto-sync after changes</span>
                  <span class="block text-xs text-warmgray mt-1">Only runs when Google Sheets mode is active and a backend/proxy URL is configured.</span>
                </span>
              </label>
            </div>

            <div class="flex flex-wrap items-center gap-2 mt-5">
              <button type="submit" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold card-hover">Save Settings</button>
              <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="runBackendConnectionTest()">Test Connection</button>
            </div>
          </form>

          <form id="settings-google-connections-form" class="rounded-2xl border border-cream bg-white p-4 sm:p-5 fade-in" style="animation-delay:0.045s" onsubmit="saveGoogleConnectionSettings(event)">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
              <div class="min-w-0">
                <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Google Connections</p>
                <h3 class="font-display text-xl font-semibold text-warmblack mt-1">One account, manual sync, review-first intake</h3>
                <p class="text-sm text-warmgray mt-1">Calendar and Gmail both live under one Google account. Gmail stays booking-related only, and unmatched imports still wait for your review.</p>
              </div>
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <label class="block xl:col-span-2">
                <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Google Account Email</span>
                <input
                  name="google_account_email"
                  type="email"
                  value="${escapeHtml(backend.google_account_email)}"
                  placeholder="coach@d-a-j.com"
                  class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"
                />
              </label>

              <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                <p class="text-[11px] uppercase tracking-wider text-warmgray">Calendar</p>
                <div class="flex flex-wrap items-center gap-2 mt-2">
                  <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${getGoogleServiceStatusBadgeClass(backend.google_calendar_status)}">${escapeHtml(getGoogleServiceStatusLabel(backend.google_calendar_status))}</span>
                  <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full bg-white border border-cream text-warmgray">Manual Sync</span>
                </div>
                <p class="text-xs text-warmgray mt-2">${backend.google_calendar_last_sync_at ? `Last synced ${escapeHtml(formatLastSyncMeta(backend.google_calendar_last_sync_at))}` : "No calendar sync has run yet."}</p>
                ${backend.google_calendar_last_sync_error ? `<p class="text-xs text-burgundy mt-2 wrap-anywhere">${escapeHtml(backend.google_calendar_last_sync_error)}</p>` : ""}
              </div>

              <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                <p class="text-[11px] uppercase tracking-wider text-warmgray">Gmail Assist</p>
                <div class="flex flex-wrap items-center gap-2 mt-2">
                  <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${getGoogleServiceStatusBadgeClass(backend.google_gmail_status)}">${escapeHtml(getGoogleServiceStatusLabel(backend.google_gmail_status))}</span>
                  <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full bg-white border border-cream text-warmgray">Booking Emails Only</span>
                  <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full bg-white border border-cream text-warmgray">Review First</span>
                </div>
                <p class="text-xs text-warmgray mt-2">${backend.google_gmail_last_sync_at ? `Last synced ${escapeHtml(formatLastSyncMeta(backend.google_gmail_last_sync_at))}` : "No Gmail assist sync has run yet."}</p>
                ${backend.google_gmail_last_sync_error ? `<p class="text-xs text-burgundy mt-2 wrap-anywhere">${escapeHtml(backend.google_gmail_last_sync_error)}</p>` : ""}
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 mt-5">
              <button type="submit" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold card-hover">Save Google Setup</button>
              <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="startGoogleOAuthFlow()">Connect Google Account</button>
              <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="checkGoogleConnectionStatus()">Refresh Google Status</button>
              <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="runGoogleCalendarSync()">Run Calendar Sync</button>
              <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="runGmailAssistSync()">Run Gmail Assist</button>
            </div>
            ${backend.google_status_error ? `<p class="text-xs text-burgundy mt-3 wrap-anywhere">${escapeHtml(backend.google_status_error)}</p>` : ""}
          </form>

          <form id="settings-admin-security-form" class="rounded-2xl border border-cream bg-white p-4 sm:p-5 fade-in" style="animation-delay:0.05s" onsubmit="saveAdminSecuritySettings(event)">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
              <div class="min-w-0">
                <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Admin Security</p>
                <h3 class="font-display text-xl font-semibold text-warmblack mt-1">Session lock for the hosted portal</h3>
                <p class="text-sm text-warmgray mt-1">This is a practical admin gate for the live portal right now. Deeper production auth can still layer on later.</p>
              </div>
              ${
                requiresAdminUnlock()
                  ? `<button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover self-start" onclick="lockPortalSession('Portal locked manually from Settings.')">Lock Now</button>`
                  : ""
              }
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <label class="rounded-xl border border-cream bg-parchment px-4 py-3 flex items-start gap-3 xl:col-span-2">
                <input type="checkbox" name="require_unlock" class="mt-1" ${adminAuthSettings.require_unlock ? "checked" : ""}>
                <span class="min-w-0">
                  <span class="block text-sm font-medium text-warmblack">Require passcode to unlock the portal</span>
                  <span class="block text-xs text-warmgray mt-1">Turn this on after you set a passcode. It will lock the hosted portal after refresh and after inactivity.</span>
                </span>
              </label>

              <label class="block">
                <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Passcode</span>
                <input
                  name="local_passcode"
                  type="password"
                  value="${escapeHtml(adminAuthSettings.local_passcode)}"
                  placeholder="Set admin passcode"
                  class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"
                />
              </label>

              <label class="block">
                <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Confirm Passcode</span>
                <input
                  name="confirm_passcode"
                  type="password"
                  value="${escapeHtml(adminAuthSettings.local_passcode)}"
                  placeholder="Re-enter passcode"
                  class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"
                />
              </label>

              <label class="block xl:max-w-xs">
                <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Session Timeout</span>
                <select name="session_timeout_minutes" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
                  <option value="15" ${Number(adminAuthSettings.session_timeout_minutes) === 15 ? "selected" : ""}>15 minutes</option>
                  <option value="30" ${Number(adminAuthSettings.session_timeout_minutes) === 30 ? "selected" : ""}>30 minutes</option>
                  <option value="60" ${Number(adminAuthSettings.session_timeout_minutes) === 60 ? "selected" : ""}>60 minutes</option>
                  <option value="120" ${Number(adminAuthSettings.session_timeout_minutes) === 120 ? "selected" : ""}>2 hours</option>
                </select>
              </label>
            </div>

            <div class="flex flex-wrap items-center gap-2 mt-5">
              <button type="submit" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold card-hover">Save Security</button>
            </div>
          </form>

          <div class="rounded-2xl border border-cream bg-white p-4 sm:p-5 fade-in" style="animation-delay:0.06s">
            <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Sync Notes</p>
            <h3 class="font-display text-xl font-semibold text-warmblack mt-1">How this phase works</h3>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-sm">
              <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                <p class="font-semibold text-warmblack">1. Local persistence is live</p>
                <p class="text-warmgray mt-1">Student, lesson, note, finance, and materials changes now persist in this browser instead of disappearing on refresh.</p>
              </div>
              <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                <p class="font-semibold text-warmblack">2. Google Sheets is endpoint-based</p>
                <p class="text-warmgray mt-1">The portal should talk to a backend/proxy, and that backend can talk to Google Sheets without browser CORS issues.</p>
              </div>
              <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                <p class="font-semibold text-warmblack">3. Live Calendar/Gmail come next</p>
                <p class="text-warmgray mt-1">Once backend and auth are live, the existing intake UI can start using real Google services instead of demo-fed sync.</p>
              </div>
            </div>
            ${
              status.last_sync_error
                ? `<div class="rounded-xl border border-burgundy/20 bg-burgundy/5 px-4 py-3 mt-4">
                    <p class="text-xs uppercase tracking-wider text-burgundy font-medium">Most Recent Sync Error</p>
                    <p class="text-sm text-warmblack mt-1 wrap-anywhere">${escapeHtml(status.last_sync_error)}</p>
                  </div>`
                : ""
            }
          </div>
        </div>

        <div class="space-y-5">
          <div class="rounded-2xl border border-cream bg-white p-4 sm:p-5 fade-in" style="animation-delay:0.08s">
            <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Google Sheets Blueprint</p>
            <h3 class="font-display text-xl font-semibold text-warmblack mt-1">Recommended tabs and columns</h3>
            <p class="text-sm text-warmgray mt-1">This is the shape the backend should read and write into Google Sheets. It matches the current frontend data contracts.</p>
            <div class="space-y-3 mt-4 max-h-[620px] overflow-y-auto pr-1">
              ${blueprintRows.map(([sheetName, columns]) => `
                <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                  <div class="flex items-center justify-between gap-3">
                    <p class="font-semibold text-warmblack">${escapeHtml(sheetName)}</p>
                    <span class="text-xs text-warmgray">${columns.length} columns</span>
                  </div>
                  <p class="text-xs text-warmgray mt-2 wrap-anywhere">${escapeHtml(columns.join(", "))}</p>
                </div>
              `).join("")}
            </div>
          </div>

          <div class="rounded-2xl border border-cream bg-white p-4 sm:p-5 fade-in" style="animation-delay:0.1s">
            <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Current Backend State</p>
            <h3 class="font-display text-xl font-semibold text-warmblack mt-1">At a glance</h3>
            <div class="space-y-3 mt-4 text-sm">
              <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                <p class="text-warmgray">Endpoint configured</p>
                <p class="font-semibold text-warmblack mt-1">${status.endpoint_configured ? "Yes" : "Not yet"}</p>
              </div>
              <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                <p class="text-warmgray">Auto-sync</p>
                <p class="font-semibold text-warmblack mt-1">${status.auto_sync ? "Enabled" : "Off"}</p>
              </div>
              <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                <p class="text-warmgray">Last pull</p>
                <p class="font-semibold text-warmblack mt-1">${escapeHtml(formatLastSyncMeta(status.last_pull_at))}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  lucide.createIcons();
}

/*********************************
 * FINANCE PAGE RENDERER
 *********************************/
function renderFinanceResults() {
  const resultsEl = document.getElementById("finance-results-wrap");
  const countEl = document.getElementById("finance-results-count");

  if (!resultsEl) return;

  const packageRows = getFilteredFinancePackagesRows();
  const paymentRows = getFilteredFinancePaymentsRows();
  const compact = isCompactView("finance");

  if (countEl) {
    countEl.textContent =
      currentFinanceTab === "packages"
        ? `${packageRows.length} package record${packageRows.length === 1 ? "" : "s"} shown · ${getFinanceScopeLabel()}`
        : `${paymentRows.length} payment record${paymentRows.length === 1 ? "" : "s"} shown · ${getFinanceScopeLabel()}`;
  }

  resultsEl.innerHTML = `
    <div class="finance-results-panel bg-white rounded-2xl border border-cream overflow-hidden">
      <div class="overflow-x-auto">
        ${
          currentFinanceTab === "packages"
            ? `
              <table class="w-full min-w-[1120px] text-sm ${compact ? "compact-table" : ""}">
                <thead class="bg-parchment/70">
                  <tr class="text-left text-xs text-warmgray uppercase tracking-wider">
                    <th class="px-5 py-3 font-medium">Student</th>
                    <th class="px-5 py-3 font-medium">Billing</th>
                    <th class="px-5 py-3 font-medium">Package</th>
                    <th class="px-5 py-3 font-medium">Price</th>
                    <th class="px-5 py-3 font-medium">Paid</th>
                    <th class="px-5 py-3 font-medium">Balance</th>
                    <th class="px-5 py-3 font-medium">Used</th>
                    <th class="px-5 py-3 font-medium">Remaining</th>
                    <th class="px-5 py-3 font-medium">${currentFinanceHistoryMode === "history" ? "Archived" : "Expires"}</th>
                    <th class="px-5 py-3 font-medium">Status</th>
                    <th class="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    packageRows.length
                      ? packageRows.map((row) => `
                        <tr class="border-t border-cream/80 hover:bg-parchment/60 transition-colors">
                          <td class="px-5 py-4 align-top">
                            <button
                              type="button"
                              class="text-sm font-medium text-warmblack hover:text-gold transition-colors text-left"
                              onclick="viewStudentProfileFromLesson('${row.student_id}')"
                            >
                              ${escapeHtml(row.student_name)}
                            </button>
                            <div class="text-xs text-warmgray mt-1">${escapeHtml(row.package_id)}</div>
                          </td>
                          <td class="px-5 py-4 align-top">${escapeHtml(getBillingModelLabel(row.billing_model))}</td>
                          <td class="px-5 py-4 align-top">${escapeHtml(row.package_name)}</td>
                          <td class="px-5 py-4 align-top">${escapeHtml(formatCurrency(row.price || 0))}</td>
                          <td class="px-5 py-4 align-top">${escapeHtml(formatCurrency(row.paid || 0))}</td>
                          <td class="px-5 py-4 align-top ${row.remaining_balance > 0 ? "text-burgundy font-medium" : "text-sage font-medium"}">${escapeHtml(formatCurrency(row.remaining_balance || 0))}</td>
                          <td class="px-5 py-4 align-top">${escapeHtml(String(row.used))}</td>
                          <td class="px-5 py-4 align-top">${escapeHtml(String(row.remaining))}</td>
                          <td class="px-5 py-4 align-top">${escapeHtml((currentFinanceHistoryMode === "history" ? row.archived_at : row.expires_on) ? formatLongDate(currentFinanceHistoryMode === "history" ? row.archived_at : row.expires_on) : "—")}</td>
                          <td class="px-5 py-4 align-top">
                            <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.badge}">
                              ${escapeHtml(row.status_label)}
                            </span>
                          </td>
                          <td class="px-5 py-4 align-top text-right">
                            <div class="flex flex-wrap justify-end gap-2">
                              ${
                                currentFinanceHistoryMode === "history"
                                  ? `
                                    <button
                                      type="button"
                                      class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                                      onclick="restorePackage('${row.package_id}')"
                                    >
                                      Restore
                                    </button>
                                  `
                                  : `
                                    <button
                                      type="button"
                                      class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                                      onclick="openPackageModal('${row.package_id}')"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmgray card-hover"
                                      onclick="archivePackage('${row.package_id}')"
                                    >
                                      Archive
                                    </button>
                                  `
                              }
                            </div>
                          </td>
                        </tr>
                      `).join("")
                      : `
                        <tr>
                          <td colspan="11" class="px-5 py-12 text-center">
                              <div class="page-empty-state flex flex-col items-center justify-center text-warmgray">
                                <i data-lucide="package-x" class="w-8 h-8 mb-3 opacity-50"></i>
                                <p class="text-sm font-medium">No packages found in this view</p>
                                <p class="text-xs mt-1">Try widening your filters or add a package.</p>
                              </div>
                          </td>
                        </tr>
                      `
                  }
                </tbody>
              </table>
            `
            : `
              <table class="w-full min-w-[980px] text-sm ${compact ? "compact-table" : ""}">
                <thead class="bg-parchment/70">
                  <tr class="text-left text-xs text-warmgray uppercase tracking-wider">
                    <th class="px-5 py-3 font-medium">Student</th>
                    <th class="px-5 py-3 font-medium">Billing</th>
                    <th class="px-5 py-3 font-medium">Amount</th>
                    <th class="px-5 py-3 font-medium">Date</th>
                    <th class="px-5 py-3 font-medium">Type</th>
                    <th class="px-5 py-3 font-medium">Linked Package</th>
                    <th class="px-5 py-3 font-medium">Status</th>
                    <th class="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    paymentRows.length
                      ? paymentRows.map((row) => `
                        <tr class="border-t border-cream/80 hover:bg-parchment/60 transition-colors">
                          <td class="px-5 py-4 align-top">
                            <button
                              type="button"
                              class="text-sm font-medium text-warmblack hover:text-gold transition-colors text-left"
                              onclick="viewStudentProfileFromLesson('${row.student_id}')"
                            >
                              ${escapeHtml(row.student_name)}
                            </button>
                            <div class="text-xs text-warmgray mt-1">${escapeHtml(row.payment_id)}</div>
                          </td>
                          <td class="px-5 py-4 align-top">${escapeHtml(getBillingModelLabel(row.billing_model))}</td>
                          <td class="px-5 py-4 align-top">${escapeHtml(formatCurrency(row.amount, row.currency))}</td>
                          <td class="px-5 py-4 align-top">${escapeHtml((currentFinanceHistoryMode === "history" ? row.archived_at : row.payment_date) ? formatLongDate(currentFinanceHistoryMode === "history" ? row.archived_at : row.payment_date) : "—")}</td>
                          <td class="px-5 py-4 align-top">${escapeHtml(row.payment_type)}</td>
                          <td class="px-5 py-4 align-top">${escapeHtml(row.related_package_name || "—")}</td>
                          <td class="px-5 py-4 align-top">
                            <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.status_badge}">
                              ${escapeHtml(String(row.status || "Paid"))}
                            </span>
                          </td>
                          <td class="px-5 py-4 align-top text-right">
                            <div class="flex flex-wrap justify-end gap-2">
                              ${
                                currentFinanceHistoryMode === "history"
                                  ? `
                                    <button
                                      type="button"
                                      class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                                      onclick="restorePayment('${row.payment_id}')"
                                    >
                                      Restore
                                    </button>
                                  `
                                  : `
                                    <button
                                      type="button"
                                      class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                                      onclick="openPaymentModal('${row.payment_id}')"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmgray card-hover"
                                      onclick="archivePayment('${row.payment_id}')"
                                    >
                                      Archive
                                    </button>
                                  `
                              }
                            </div>
                          </td>
                        </tr>
                      `).join("")
                      : `
                        <tr>
                          <td colspan="8" class="px-5 py-12 text-center">
                            <div class="page-empty-state flex flex-col items-center justify-center text-warmgray">
                              <i data-lucide="receipt-text" class="w-8 h-8 mb-3 opacity-50"></i>
                              <p class="text-sm font-medium">No payments found in this view</p>
                              <p class="text-xs mt-1">Try widening your filters or add a payment.</p>
                            </div>
                          </td>
                        </tr>
                      `
                  }
                </tbody>
              </table>
            `
        }
      </div>
    </div>
  `;

  lucide.createIcons();
}

function getFinancePageSummaryRows() {
  const outstandingRows = getOutstandingBalanceRows();
  return {
    outstandingTotal: formatCurrency(getOutstandingBalanceTotal()),
    outstandingStudents: outstandingRows.length,
    packagePressure: getExpiringPackagesList().length,
    pendingPayments: getPaymentRecords().filter((payment) => !isPaymentArchived(payment) && String(payment.status || "").toLowerCase() === "pending").length
  };
}

function getFinanceFilterPills() {
  const pills = [];
  pills.push(getStatusFilterPill("Scope", currentFinanceHistoryMode === "history" ? "History" : "Active"));
  pills.push(getStatusFilterPill("Tab", currentFinanceTab === "packages" ? "Packages" : "Payments"));
  if (currentFinanceBillingFilter !== "all") {
    pills.push(getStatusFilterPill("Billing", getBillingModelLabel(currentFinanceBillingFilter)));
  }
  if (currentFinanceStatusFilter !== "all") {
    pills.push(getStatusFilterPill("Status", currentFinanceStatusFilter));
  }
  if (currentFinanceSearchQuery) {
    pills.push(getStatusFilterPill("Search", currentFinanceSearchQuery));
  }
  return pills;
}

function renderFinancePage() {
  const root = document.getElementById("page-root");
  if (!root) return;
  const summary = getFinancePageSummaryRows();
  const compact = isCompactView("finance");
  const filterPills = getFinanceFilterPills();

  const statusOptions =
    currentFinanceHistoryMode === "history"
      ? `
        <option value="all" ${currentFinanceStatusFilter === "all" ? "selected" : ""}>All Statuses</option>
        <option value="archived" ${currentFinanceStatusFilter === "archived" ? "selected" : ""}>Archived</option>
      `
      : currentFinanceTab === "packages"
        ? `
          <option value="all" ${currentFinanceStatusFilter === "all" ? "selected" : ""}>All Statuses</option>
          <option value="active" ${currentFinanceStatusFilter === "active" ? "selected" : ""}>Active</option>
          <option value="expiring soon" ${currentFinanceStatusFilter === "expiring soon" ? "selected" : ""}>Expiring Soon</option>
          <option value="exhausted" ${currentFinanceStatusFilter === "exhausted" ? "selected" : ""}>Exhausted</option>
          <option value="no package" ${currentFinanceStatusFilter === "no package" ? "selected" : ""}>No Package</option>
        `
        : `
          <option value="all" ${currentFinanceStatusFilter === "all" ? "selected" : ""}>All Statuses</option>
          <option value="paid" ${currentFinanceStatusFilter === "paid" ? "selected" : ""}>Paid</option>
          <option value="pending" ${currentFinanceStatusFilter === "pending" ? "selected" : ""}>Pending</option>
          <option value="failed" ${currentFinanceStatusFilter === "failed" ? "selected" : ""}>Failed</option>
          <option value="refunded" ${currentFinanceStatusFilter === "refunded" ? "selected" : ""}>Refunded</option>
        `;

  root.innerHTML = `
    <div class="finance-shell p-4 sm:p-6 xl:p-8 w-full ${compact ? "compact-view" : ""}">
      <header class="mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 fade-in">
        <div class="min-w-0">
          <h2 class="font-display text-2xl font-bold text-warmblack">Finance</h2>
          <p class="text-sm text-warmgray mt-0.5">Packages and payments across the whole studio</p>
        </div>

        <div class="finance-header-actions flex flex-wrap items-center gap-2">
          <div class="inline-flex rounded-xl border border-cream bg-white overflow-hidden">
            <button
              type="button"
              onclick="setFinanceHistoryMode('active')"
              class="px-4 py-2.5 text-sm font-medium ${currentFinanceHistoryMode === "active" ? "bg-parchment text-warmblack" : "text-warmgray"}"
            >
              Active
            </button>
            <button
              type="button"
              onclick="setFinanceHistoryMode('history')"
              class="px-4 py-2.5 text-sm font-medium ${currentFinanceHistoryMode === "history" ? "bg-parchment text-warmblack" : "text-warmgray"}"
            >
              History
            </button>
          </div>
          <button
            type="button"
            onclick="openPackageModal()"
            class="px-4 py-2.5 rounded-xl bg-white border border-cream text-warmblack text-sm font-medium card-hover"
          >
            Add Package
          </button>
          <button
            type="button"
            onclick="openPaymentModal()"
            class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold card-hover"
          >
            Add Payment
          </button>
        </div>
      </header>

      <div class="page-summary-grid mb-5 fade-in" style="animation-delay:0.02s">
        <div class="page-summary-card">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Outstanding Balance</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${summary.outstandingTotal}</p>
          <p class="text-xs text-warmgray mt-1">${summary.outstandingStudents} student${summary.outstandingStudents === 1 ? "" : "s"} with open balances</p>
        </div>
        <div class="page-summary-card">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Package Pressure</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${summary.packagePressure}</p>
        </div>
        <div class="page-summary-card">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Pending Payments</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${summary.pendingPayments}</p>
        </div>
      </div>

      <div class="finance-filter-panel page-toolbar-sticky bg-white rounded-2xl border border-cream overflow-hidden fade-in" style="animation-delay:0.03s">
        <div class="flex flex-wrap border-b border-cream">
          <button
            type="button"
            onclick="setFinanceTab('packages')"
            class="px-5 py-3.5 text-sm font-medium border-b-2 ${currentFinanceTab === "packages" ? "text-gold border-gold" : "text-warmgray border-transparent"}"
          >
            Packages
          </button>
          <button
            type="button"
            onclick="setFinanceTab('payments')"
            class="px-5 py-3.5 text-sm font-medium border-b-2 ${currentFinanceTab === "payments" ? "text-gold border-gold" : "text-warmgray border-transparent"}"
          >
            Payments
          </button>
        </div>

        <div class="p-4 bg-white">
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4">
            <div class="xl:col-span-5 relative">
              <i data-lucide="search" class="w-4 h-4 text-warmgray absolute left-3 top-1/2 -translate-y-1/2"></i>
              <input
                id="finance-search-input"
                type="search"
                value="${escapeHtml(currentFinanceSearchQuery)}"
                placeholder="Search by student, billing model, type, or ID..."
                class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-parchment border border-cream text-sm placeholder:text-warmgray/60"
                oninput="setFinanceSearchQuery(this.value)"
              />
            </div>

            <div class="xl:col-span-3">
              <select
                class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"
                onchange="setFinanceBillingFilter(this.value)"
              >
                <option value="all" ${currentFinanceBillingFilter === "all" ? "selected" : ""}>All Billing Models</option>
                <option value="PACKAGE" ${currentFinanceBillingFilter === "PACKAGE" ? "selected" : ""}>Package</option>
                <option value="PAYG" ${currentFinanceBillingFilter === "PAYG" ? "selected" : ""}>Pay As You Go</option>
                <option value="CUSTOM" ${currentFinanceBillingFilter === "CUSTOM" ? "selected" : ""}>Custom</option>
              </select>
            </div>

            <div class="xl:col-span-4">
              <select
                class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"
                onchange="setFinanceStatusFilter(this.value)"
              >
                ${statusOptions}
              </select>
            </div>
          </div>

          <div class="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p id="finance-results-count" class="text-xs text-warmgray">0 records shown</p>
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="text-xs font-medium text-gold hover:underline" onclick="toggleCompactView('finance')">${getCompactToggleLabel("finance")}</button>
              <button
                type="button"
                class="text-xs font-medium text-gold hover:underline"
                onclick="resetFinanceFilters()"
              >
                Reset filters
              </button>
            </div>
          </div>
          ${filterPills.length ? `<div class="page-filter-summary mt-3">${filterPills.join("")}</div>` : ""}
        </div>
      </div>

      <div id="finance-results-wrap" class="mt-5 fade-in" style="animation-delay:0.08s"></div>
    </div>
  `;

  renderFinanceResults();
  lucide.createIcons();
}

/*********************************
 * PROFILE PAGE RENDERERS
 *********************************/

function renderProfileLessons(studentId) {
  const container = document.getElementById("profile-lessons-list");
  if (!container) return;

  const lessons = getLessonsByStudentId(studentId);
  const now = APP_NOW;

  const upcomingLessons = lessons
    .filter((lesson) => lesson.scheduled_start && new Date(lesson.scheduled_start) >= now)
    .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime());

  const previousLessons = lessons
    .filter((lesson) => !lesson.scheduled_start || new Date(lesson.scheduled_start) < now)
    .sort((a, b) => new Date(b.scheduled_start).getTime() - new Date(a.scheduled_start).getTime());

  const visiblePrevious = previousLessons.slice(0, profilePreviousLessonsVisibleCount);

  container.innerHTML = `
    <div class="space-y-5">
      <div>
        <div class="flex items-center justify-between mb-3">
          <div>
            <h4 class="font-display text-base font-semibold text-warmblack">Upcoming Lessons</h4>
            <p class="text-xs text-warmgray mt-0.5">What’s scheduled next</p>
          </div>
        </div>

        <div class="space-y-3">
          ${
            upcomingLessons.length
              ? upcomingLessons.map((lesson) => {
                  const effectiveStatus = getEffectiveLessonStatus(lesson);
                  const statusLabel = getLessonStatusLabel(effectiveStatus);
                  const statusClass = formatLessonStatusBadge(effectiveStatus);

                  return `
                    <div class="p-4 rounded-xl border border-cream bg-parchment">
                      <div class="flex items-start justify-between gap-4">
                        <div>
                          <div class="flex items-center gap-2 mb-2">
                            <span class="text-[11px] px-2 py-0.5 rounded-full ${statusClass}">${statusLabel}</span>
                            <span class="text-[11px] text-warmgray">${lesson.lesson_id}</span>
                          </div>
                          <p class="text-sm font-semibold">${escapeHtml(lesson.topic || "Untitled Lesson")}</p>
                          <p class="text-xs text-warmgray mt-1">${escapeHtml(lesson.lesson_type || "General Coaching")} · ${escapeHtml(formatLongDate(lesson.scheduled_start))}</p>
                          <p class="text-xs text-warmgray mt-1">${escapeHtml(formatLessonTimeRange(lesson.scheduled_start, lesson.scheduled_end))}</p>
                        </div>

                        <div class="flex items-center gap-2 shrink-0">
                          <button class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover" onclick="openLessonDetailModal('${lesson.lesson_id}')">
                            Details
                          </button>
                          <button class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover" onclick="openLessonModal('edit', '${lesson.lesson_id}')">
                            Edit
                          </button>
                        </div>
                      </div>
                    </div>
                  `;
                }).join("")
              : `<div class="p-4 rounded-xl border border-cream bg-parchment text-sm text-warmgray">No upcoming lessons.</div>`
          }
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between mb-3">
          <div>
            <h4 class="font-display text-base font-semibold text-warmblack">Previous Lessons</h4>
            <p class="text-xs text-warmgray mt-0.5">Recent history, kept compact</p>
          </div>
        </div>

        <div class="space-y-3">
          ${
            visiblePrevious.length
              ? visiblePrevious.map((lesson) => {
                  const effectiveStatus = getEffectiveLessonStatus(lesson);
                  const statusLabel = getLessonStatusLabel(effectiveStatus);
                  const statusClass = formatLessonStatusBadge(effectiveStatus);
                  const rescheduleHistory = getLessonRescheduleHistoryLabel(lesson);

                  return `
                    <div class="p-4 rounded-xl border border-cream bg-parchment">
                      <div class="flex items-start justify-between gap-4">
                        <div>
                          <div class="flex items-center gap-2 mb-2">
                            <span class="text-[11px] px-2 py-0.5 rounded-full ${statusClass}">${statusLabel}</span>
                            <span class="text-[11px] text-warmgray">${lesson.lesson_id}</span>
                          </div>
                          <p class="text-sm font-semibold">${escapeHtml(lesson.topic || "Untitled Lesson")}</p>
                          <p class="text-xs text-warmgray mt-1">${escapeHtml(lesson.lesson_type || "General Coaching")} · ${escapeHtml(formatLongDate(lesson.scheduled_start))}</p>
                          <p class="text-xs text-warmgray mt-1">${escapeHtml(formatLessonTimeRange(lesson.scheduled_start, lesson.scheduled_end))}</p>
                          ${rescheduleHistory ? `<p class="text-xs text-warmgray mt-1">Rescheduled from ${escapeHtml(rescheduleHistory)}</p>` : ""}
                        </div>

                        <div class="flex items-center gap-2 shrink-0">
                          <button class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover" onclick="openLessonDetailModal('${lesson.lesson_id}')">
                            Details
                          </button>
                          <button class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover" onclick="quickChangeLessonStatus('${lesson.lesson_id}')">
                            Status
                          </button>
                        </div>
                      </div>
                    </div>
                  `;
                }).join("")
              : `<div class="p-4 rounded-xl border border-cream bg-parchment text-sm text-warmgray">No previous lessons yet.</div>`
          }

          <div class="flex items-center gap-3 pt-1">
            ${
              previousLessons.length > profilePreviousLessonsVisibleCount
                ? `
                  <button
                    type="button"
                    class="px-4 py-2 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover"
                    onclick="showMorePreviousLessons()"
                  >
                    See More
                  </button>
                `
                : ""
            }

            ${
              profilePreviousLessonsVisibleCount > 3
                ? `
                  <button
                    type="button"
                    class="px-4 py-2 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmgray card-hover"
                    onclick="hidePreviousLessons()"
                  >
                    Hide
                  </button>
                `
                : ""
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderProfileNotesTabLegacy(studentId) {
  const notesContainer = document.getElementById("profile-tab-notes");
  if (!notesContainer) return;

  const publishedNotes = getNotesByStudentId(studentId)
    .filter((note) => note.status === "Published")
    .sort((a, b) => {
      const aTime = new Date(a.published_at || a.created_at || 0).getTime();
      const bTime = new Date(b.published_at || b.created_at || 0).getTime();
      return bTime - aTime;
    });

  if (!publishedNotes.length) {
    notesContainer.innerHTML = `
      <div class="p-6 bg-parchment rounded-xl border border-cream text-sm text-warmgray">
        No published lesson notes yet.
      </div>
    `;
    return;
  }

  const visibleNotes = publishedNotes.slice(0, profileNotesVisibleCount);

  notesContainer.innerHTML = `
    <div class="space-y-4">
      ${visibleNotes.map((note, index) => {
        const lesson = getSchemaLessonById(note.lesson_id);
        const lessonDate = lesson?.scheduled_start ? formatLongDate(lesson.scheduled_start) : "No lesson date";

        if (index === 0) {
          const plainText = stripHtmlForPreview(note.body);
          const firstTenLines = getFirstLines(plainText, 10);
          const wasTrimmed = plainText.trim() !== firstTenLines.trim();

          return `
            <div class="p-4 bg-parchment rounded-xl border border-cream">
              <div class="flex items-center justify-between mb-2 gap-4">
                <div>
                  <h5 class="text-sm font-semibold text-warmblack">${escapeHtml(note.title)}</h5>
                  <p class="text-xs text-warmgray mt-1">${escapeHtml(lesson?.topic || "Lesson")} · ${escapeHtml(lessonDate)}</p>
                </div>
                <span class="text-xs text-warmgray">${escapeHtml(formatLongDate(note.published_at))}</span>
              </div>

              <div class="text-sm text-warmgray leading-relaxed">
                ${formatPreviewTextAsHtml(firstTenLines)}
                ${wasTrimmed ? `<span class="text-warmgray">...</span>` : ""}
              </div>

              <div class="mt-3 flex items-center justify-between gap-3">
                <span class="text-[11px] bg-sage/10 text-sage px-2 py-0.5 rounded-full">${escapeHtml(note.status)}</span>
                <button
                  type="button"
                  class="text-xs font-medium text-gold hover:underline"
                  onclick="openLessonDetailModal('${note.lesson_id}')"
                >
                  See More
                </button>
              </div>
            </div>
          `;
        }

        return `
          <div class="p-4 bg-parchment rounded-xl border border-cream">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h5 class="text-sm font-semibold text-warmblack">${escapeHtml(note.title)}</h5>
                <p class="text-xs text-warmgray mt-1">${escapeHtml(lesson?.topic || "Lesson")} · ${escapeHtml(lessonDate)}</p>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <span class="text-xs text-warmgray">${escapeHtml(formatLongDate(note.published_at))}</span>
                <button
                  type="button"
                  class="text-xs font-medium text-gold hover:underline"
                  onclick="openLessonDetailModal('${note.lesson_id}')"
                >
                  See More
                </button>
              </div>
            </div>
          </div>
        `;
      }).join("")}

      <div class="flex items-center gap-3 pt-1">
        ${
          publishedNotes.length > profileNotesVisibleCount
            ? `
              <button
                type="button"
                class="px-4 py-2 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover"
                onclick="showMoreProfileNotes()"
              >
                See More
              </button>
            `
            : ""
        }

        ${
          profileNotesVisibleCount > 3
            ? `
              <button
                type="button"
                class="px-4 py-2 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmgray card-hover"
                onclick="hideProfileNotes()"
              >
                Hide
              </button>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function renderProfileMaterialsTab(studentId) {
  const materialsContainer = document.getElementById("profile-tab-materials");
  if (!materialsContainer) return;

  const materialRows = getMaterialRowsByStudentId(studentId);
  const activeRows = materialRows.filter((row) => String(row.status || "").toLowerCase() !== "vaulted");
  const vaultedRows = materialRows.filter((row) => String(row.status || "").toLowerCase() === "vaulted");
  const actorRows = activeRows.filter((row) => row.group_key === "actor");
  const coachingRows = activeRows.filter((row) => row.group_key === "coaching");
  const resourceRows = activeRows.filter((row) => row.group_key === "resource");

  function renderMaterialCards(rows, options = {}) {
    const {
      emptyMessage = "No materials yet.",
      primaryActionLabel = "",
      primaryActionHandler = "",
      secondaryActionLabel = "",
      secondaryActionHandler = ""
    } = options;

    if (!rows.length) {
      return `
        <div class="rounded-xl border border-dashed border-cream bg-white/70 p-4 text-sm text-warmgray">
          ${escapeHtml(emptyMessage)}
        </div>
      `;
    }

    return rows.map((row) => `
      <div class="rounded-xl border border-cream bg-white p-4">
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="text-sm font-semibold text-warmblack break-words">${escapeHtml(row.display_name)}</p>
              <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.status_badge}">
                ${escapeHtml(row.status_label)}
              </span>
              <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${row.visibility_badge}">
                ${escapeHtml(row.visibility_label)}
              </span>
            </div>
            <p class="text-xs text-warmgray mt-1">${escapeHtml(row.kind_label)} · ${escapeHtml(row.category)} · ${escapeHtml(row.scope_label)}</p>
            <p class="text-xs text-warmgray mt-1">${escapeHtml(row.source_label)} · ${escapeHtml(formatLongDate(row.uploaded_at))}</p>
            <p class="text-xs text-warmgray mt-1">${escapeHtml(row.lesson_label)}</p>
            ${row.notes ? `<p class="text-xs text-warmgray mt-1">${escapeHtml(row.notes)}</p>` : ""}
          </div>
          <div class="flex flex-wrap items-center gap-2 shrink-0">
            ${row.source_url ? `
              <a
                href="${escapeHtml(row.source_url)}"
                target="_blank"
                rel="noopener noreferrer"
                class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-gold card-hover"
              >
                ${escapeHtml(row.action_label)}
              </a>
            ` : ""}
            <button
              type="button"
              onclick="openMaterialModal('${studentId}', '${row.file_id}')"
              class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
            >
              Edit
            </button>
            ${
              primaryActionLabel && primaryActionHandler
                ? `
                  <button
                    type="button"
                    onclick="${primaryActionHandler}('${row.file_id}')"
                    class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmgray card-hover"
                  >
                    ${escapeHtml(primaryActionLabel)}
                  </button>
                `
                : ""
            }
            ${
              secondaryActionLabel && secondaryActionHandler
                ? `
                  <button
                    type="button"
                    onclick="${secondaryActionHandler}('${row.file_id}')"
                    class="px-3 py-2 rounded-lg bg-white border border-burgundy/20 text-xs font-medium text-burgundy card-hover"
                  >
                    ${escapeHtml(secondaryActionLabel)}
                  </button>
                `
                : ""
            }
          </div>
        </div>
      </div>
    `).join("");
  }

  materialsContainer.innerHTML = `
    <div class="space-y-5">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h4 class="font-display text-lg font-semibold text-warmblack">Materials</h4>
          <p class="text-sm text-warmgray mt-1">Keep current actor assets, coaching files, and reusable resources easy to reach. Vault stays tucked away until you need history.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onclick="toggleProfileMaterialsVault()"
            class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover"
          >
            ${showProfileMaterialsVault ? "Hide Vault" : `View Vault (${vaultedRows.length})`}
          </button>
          <button
            type="button"
            onclick="openMaterialModal('${studentId}')"
            class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold card-hover"
          >
            Add Material
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="rounded-xl border border-sage/20 bg-sage/5 px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Current</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${activeRows.length}</p>
        </div>
        <div class="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Actor Assets</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${actorRows.length}</p>
        </div>
        <div class="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Coaching</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${coachingRows.length}</p>
        </div>
      </div>

      <div class="space-y-4">
        <div class="rounded-2xl border border-gold/15 bg-gold/5 p-4">
          <div class="flex items-center justify-between gap-3 mb-4">
            <div>
              <p class="text-xs uppercase tracking-wider text-gold font-medium">Actor Materials</p>
              <h5 class="font-semibold text-warmblack mt-1">Headshots, resumes, reels, and self tapes</h5>
            </div>
            <span class="text-xs text-warmgray">${actorRows.filter((row) => normalizeMaterialVisibility(row.visibility) === "STUDENT_VISIBLE").length} student-visible</span>
          </div>
          <div class="space-y-3">
            ${renderMaterialCards(actorRows, {
              emptyMessage: "No actor materials yet. Add resumes, headshots, reels, and audition assets here.",
              primaryActionLabel: "Vault",
              primaryActionHandler: "archiveMaterial"
            })}
          </div>
        </div>

        <div class="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div class="flex items-center justify-between gap-3 mb-4">
            <div>
              <p class="text-xs uppercase tracking-wider text-blue-700 font-medium">Lesson & Homework Materials</p>
              <h5 class="font-semibold text-warmblack mt-1">Current coaching files linked to active work</h5>
            </div>
            <span class="text-xs text-warmgray">${coachingRows.length} active item${coachingRows.length === 1 ? "" : "s"}</span>
          </div>
          <div class="space-y-3">
            ${renderMaterialCards(coachingRows, {
              emptyMessage: "No active lesson or homework materials yet. Add scripts, sides, homework files, and self-tape references here.",
              primaryActionLabel: "Vault",
              primaryActionHandler: "archiveMaterial"
            })}
          </div>
        </div>

        <div class="rounded-2xl border border-sage/15 bg-sage/5 p-4">
          <div class="flex items-center justify-between gap-3 mb-4">
            <div>
              <p class="text-xs uppercase tracking-wider text-sage font-medium">Resources & References</p>
              <h5 class="font-semibold text-warmblack mt-1">Reusable links, docs, and coach resources</h5>
            </div>
            <span class="text-xs text-warmgray">${resourceRows.length} resource${resourceRows.length === 1 ? "" : "s"}</span>
          </div>
          <div class="space-y-3">
            ${renderMaterialCards(resourceRows, {
              emptyMessage: "No shared resources yet. Add studio references, prep links, and reusable coaching materials here.",
              primaryActionLabel: "Vault",
              primaryActionHandler: "archiveMaterial"
            })}
          </div>
        </div>

        ${
          showProfileMaterialsVault
            ? `
              <div class="rounded-2xl border border-warmgray/15 bg-parchment p-4">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <div>
                    <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Vault</p>
                    <h5 class="font-semibold text-warmblack mt-1">Preserved history kept out of the main workspace</h5>
                  </div>
                  <span class="text-xs text-warmgray">Restore or permanently delete vaulted items here only</span>
                </div>
                <div class="space-y-3">
                  ${renderMaterialCards(vaultedRows, {
                    emptyMessage: "Nothing is vaulted right now.",
                    primaryActionLabel: "Restore",
                    primaryActionHandler: "restoreMaterial",
                    secondaryActionLabel: "Delete Permanently",
                    secondaryActionHandler: "deleteMaterialPermanently"
                  })}
                </div>
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function renderProfileNotesTab(studentId) {
  const notesContainer = document.getElementById("profile-tab-notes");
  if (!notesContainer) return;

  const allNotes = getNotesByStudentId(studentId);
  const counts = getNoteCountsByStatus(allNotes);
  const staleDrafts = getStaleDraftNotesByStudentId(studentId, 7);
  const filteredNotes = currentProfileNotesFilter === "all"
    ? allNotes
    : allNotes.filter((note) => normalizeNoteStatus(note.status).toLowerCase() === currentProfileNotesFilter);

  if (!allNotes.length) {
    notesContainer.innerHTML = `
      <div class="p-6 bg-parchment rounded-xl border border-cream text-sm text-warmgray">
        No lesson notes yet.
      </div>
    `;
    return;
  }

  const visibleNotes = filteredNotes.slice(0, profileNotesVisibleCount);
  const filterButtons = [
    { key: "all", label: "All", count: allNotes.length },
    { key: "draft", label: "Drafts", count: counts.DRAFT },
    { key: "published", label: "Published", count: counts.PUBLISHED },
    { key: "archived", label: "Archived", count: counts.ARCHIVED }
  ];

  notesContainer.innerHTML = `
    <div class="space-y-4">
      <div class="grid grid-cols-4 gap-3">
        <div class="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Total Notes</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${allNotes.length}</p>
        </div>
        <div class="rounded-xl border border-gold/20 bg-white px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Drafts</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${counts.DRAFT}</p>
        </div>
        <div class="rounded-xl border border-sage/20 bg-sage/5 px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Published</p>
          <p class="text-lg font-semibold text-warmblack mt-1">${counts.PUBLISHED}</p>
        </div>
        <div class="rounded-xl border ${staleDrafts.length ? "border-burgundy/20 bg-burgundy/5" : "border-cream bg-parchment"} px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Stale Drafts</p>
          <p class="text-lg font-semibold ${staleDrafts.length ? "text-burgundy" : "text-warmblack"} mt-1">${staleDrafts.length}</p>
        </div>
      </div>

      ${
        staleDrafts.length
          ? `
            <div class="rounded-xl border border-burgundy/20 bg-burgundy/5 px-4 py-3">
              <p class="text-xs font-medium uppercase tracking-wider text-burgundy mb-2">Needs Cleanup</p>
              <div class="flex flex-wrap gap-2">
                ${staleDrafts.slice(0, 4).map((note) => `
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded-full border border-burgundy/20 bg-white text-xs text-warmblack hover:border-burgundy/40"
                    onclick="openLessonDetailModal('${note.lesson_id}')"
                  >
                    ${escapeHtml(note.title || "Untitled note")}
                  </button>
                `).join("")}
              </div>
            </div>
          `
          : ""
      }

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="px-3 py-2 rounded-xl border border-cream bg-white text-xs font-medium text-warmblack"
          onclick="openNoteWorkspace('${studentId}')"
        >
          Open Notes Workspace
        </button>
        ${filterButtons.map((filter) => `
          <button
            type="button"
            class="px-3 py-2 rounded-xl border text-xs font-medium ${currentProfileNotesFilter === filter.key ? "border-gold bg-gold/10 text-gold" : "border-cream bg-white text-warmgray"}"
            onclick="setProfileNotesFilter('${filter.key}')"
          >
            ${filter.label} (${filter.count})
          </button>
        `).join("")}
      </div>

      ${
        filteredNotes.length
          ? ""
          : `
            <div class="p-4 bg-parchment rounded-xl border border-cream text-sm text-warmgray">
              No ${currentProfileNotesFilter === "all" ? "" : `${escapeHtml(currentProfileNotesFilter)} `}notes in this view yet.
            </div>
          `
      }

      ${visibleNotes.map((note, index) => {
        const lesson = getSchemaLessonById(note.lesson_id);
        const lessonDate = lesson?.scheduled_start ? formatLongDate(lesson.scheduled_start) : "No lesson date";
        const noteStatus = normalizeNoteStatus(note.status);
        const noteStatusLabel = getNoteStatusLabel(noteStatus);
        const noteStatusBadge = getNoteStatusBadge(noteStatus);
        const noteDateLabel = getNoteLastActivityLabel(note);
        const previewText = stripHtmlForPreview(note.body);

        if (index === 0) {
          const firstTenLines = getFirstLines(previewText, 10);
          const wasTrimmed = previewText.trim() !== firstTenLines.trim();

          return `
            <div class="p-4 bg-parchment rounded-xl border border-cream">
              <div class="flex items-center justify-between mb-2 gap-4">
                <div>
                  <h5 class="text-sm font-semibold text-warmblack">${escapeHtml(note.title)}</h5>
                  <p class="text-xs text-warmgray mt-1">${escapeHtml(lesson?.topic || "Lesson")} · ${escapeHtml(lessonDate)}</p>
                </div>
                <span class="text-xs text-warmgray">${escapeHtml(noteDateLabel)}</span>
              </div>

              <div class="text-sm text-warmgray leading-relaxed">
                ${formatPreviewTextAsHtml(firstTenLines)}
                ${wasTrimmed ? `<span class="text-warmgray">...</span>` : ""}
              </div>

              <div class="mt-3 flex items-center justify-between gap-3">
                <span class="text-[11px] px-2 py-0.5 rounded-full ${noteStatusBadge}">${escapeHtml(noteStatusLabel)}</span>
                <div class="flex items-center gap-3">
                  <button
                    type="button"
                    class="text-xs font-medium text-warmblack hover:underline"
                    onclick="openNoteWorkspace('${studentId}', '${note.lesson_id}')"
                  >
                    Edit Note
                  </button>
                  <button
                    type="button"
                    class="text-xs font-medium text-gold hover:underline"
                    onclick="openLessonDetailModal('${note.lesson_id}')"
                  >
                    Lesson
                  </button>
                </div>
              </div>
            </div>
          `;
        }

        return `
          <div class="p-4 bg-parchment rounded-xl border border-cream">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h5 class="text-sm font-semibold text-warmblack">${escapeHtml(note.title)}</h5>
                <p class="text-xs text-warmgray mt-1">${escapeHtml(lesson?.topic || "Lesson")} · ${escapeHtml(lessonDate)}</p>
                <p class="text-xs text-warmgray mt-1">${escapeHtml(previewText.slice(0, 96) || "No note body yet.")}${previewText.length > 96 ? "..." : ""}</p>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <span class="text-[11px] px-2 py-0.5 rounded-full ${noteStatusBadge}">${escapeHtml(noteStatusLabel)}</span>
                <span class="text-xs text-warmgray">${escapeHtml(noteDateLabel)}</span>
                <button
                  type="button"
                  class="text-xs font-medium text-warmblack hover:underline"
                  onclick="openNoteWorkspace('${studentId}', '${note.lesson_id}')"
                >
                  Edit Note
                </button>
                <button
                  type="button"
                  class="text-xs font-medium text-gold hover:underline"
                  onclick="openLessonDetailModal('${note.lesson_id}')"
                >
                  Lesson
                </button>
              </div>
            </div>
          </div>
        `;
      }).join("")}

      <div class="flex items-center gap-3 pt-1">
        ${
          filteredNotes.length > profileNotesVisibleCount
            ? `
              <button
                type="button"
                class="px-4 py-2 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover"
                onclick="showMoreProfileNotes()"
              >
                See More
              </button>
            `
            : ""
        }

        ${
          profileNotesVisibleCount > 3
            ? `
              <button
                type="button"
                class="px-4 py-2 rounded-xl bg-parchment border border-cream text-sm font-medium text-warmgray card-hover"
                onclick="hideProfileNotes()"
              >
                Hide
              </button>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function renderProfilePage() {
  if (!selectedStudentId || !getStudentById(selectedStudentId)) {
    selectedStudentId = students.length > 0 ? students[0].id : null;
  }

  currentProfileNotesFilter = "all";

  const root = document.getElementById("page-root");
  if (!root) return;

  if (!selectedStudentId) {
    root.innerHTML = `
      <div class="p-8 w-full">
        <h2 class="font-display text-2xl font-bold text-warmblack">Student Profile</h2>
        <p class="text-warmgray mt-2">No student selected yet.</p>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="profile-shell p-4 sm:p-6 xl:p-8 w-full">
      <header class="profile-header mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div class="min-w-0 flex items-center gap-3">
          <button onclick="navigateTo('students')" class="w-9 h-9 rounded-full bg-white border border-cream flex items-center justify-center card-hover">
            <i data-lucide="arrow-left" class="w-4 h-4 text-charcoal"></i>
          </button>
          <div class="min-w-0">
            <h2 id="profile-page-title" class="font-display text-2xl font-bold text-warmblack">Student Profile</h2>
            <p id="profile-page-subtitle" class="text-sm text-warmgray">Detailed view and lesson management</p>
          </div>
        </div>

        <div class="profile-header-actions flex flex-wrap items-center gap-2">
          <button id="edit-student-btn" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-warmblack text-sm font-medium card-hover">
            Edit Student
          </button>
          <button id="change-status-btn" class="px-4 py-2.5 rounded-xl bg-parchment border border-cream text-warmblack text-sm font-medium card-hover">
            Change Status
          </button>
        </div>
      </header>

      <div class="profile-layout grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6">
        <div class="profile-sidebar space-y-4">
          <div class="profile-panel bg-white rounded-2xl border border-cream overflow-hidden fade-in">
            <div class="h-28 headshot-placeholder relative">
              <div class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
                <div class="w-24 h-24 rounded-full border-4 border-white headshot-placeholder flex items-center justify-center">
                  <i data-lucide="user" class="w-10 h-10 text-warmgray/60"></i>
                </div>
              </div>
            </div>

            <div class="pt-14 pb-5 px-5 text-center">
              <h3 id="profile-student-name" class="font-display text-xl font-bold">Student Name</h3>
              <p id="profile-student-focus" class="text-sm text-warmgray mt-0.5">Focus Area</p>
              <div id="profile-badges" class="flex items-center justify-center gap-2 mt-3"></div>
            </div>

            <div class="profile-meta-list px-5 pb-5 space-y-3 border-t border-cream pt-4">
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Billing Model</span>
                <span id="profile-billing-model" class="font-medium text-right">—</span>
              </div>
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Finance Summary</span>
                <span id="profile-finance-summary" class="font-medium text-right">—</span>
              </div>
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Last Lesson</span>
                <span id="profile-last-lesson" class="font-medium text-right">—</span>
              </div>
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Public Page</span>
                <span id="profile-public-status" class="font-medium text-right">—</span>
              </div>
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Email</span>
                <span id="profile-email" class="font-medium text-right break-all">—</span>
              </div>
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Phone</span>
                <span id="profile-phone" class="font-medium text-right">—</span>
              </div>
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Additional Emails</span>
                <span id="profile-additional-emails" class="font-medium text-right break-all">—</span>
              </div>
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Guardian / Parent</span>
                <span id="profile-guardian-name" class="font-medium text-right">—</span>
              </div>
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Guardian Email</span>
                <span id="profile-guardian-email" class="font-medium text-right break-all">—</span>
              </div>
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Guardian Phone</span>
                <span id="profile-guardian-phone" class="font-medium text-right">—</span>
              </div>
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Timezone</span>
                <span id="profile-timezone" class="font-medium text-right">—</span>
              </div>
              <div class="profile-meta-row flex justify-between text-sm gap-4">
                <span class="text-warmgray">Lead Source</span>
                <span id="profile-lead-source" class="font-medium text-right">—</span>
              </div>
              <div class="pt-2">
                <a id="profile-email-btn" href="#" class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-cream text-warmblack text-sm font-medium card-hover">
                  <i data-lucide="mail" class="w-4 h-4"></i>
                  Email Student
                </a>
              </div>
            </div>
          </div>

          <div class="profile-panel bg-white rounded-2xl border border-cream p-5 fade-in" style="animation-delay:0.1s">
            <h4 class="font-display font-semibold mb-2">Bio</h4>
            <p id="profile-bio" class="text-sm text-warmgray leading-relaxed wrap-anywhere"></p>
          </div>

          <div class="profile-panel bg-white rounded-2xl border border-cream p-5 fade-in" style="animation-delay:0.14s">
  <div class="flex items-center justify-between mb-3">
    <h4 class="font-display font-semibold">Finance</h4>
    <span id="profile-finance-badge" class="text-[11px] px-2 py-1 rounded-full bg-warmgray/10 text-warmgray">—</span>
  </div>

  <div class="space-y-3">
    <div>
      <p id="profile-finance-headline" class="text-sm font-semibold text-warmblack">—</p>
      <p id="profile-finance-subline" class="text-xs text-warmgray mt-1">—</p>
    </div>

    <div id="profile-finance-package-block" class="space-y-3">
      <div class="flex justify-between text-sm">
        <span class="text-warmgray">Package</span>
        <span id="profile-finance-package-name" class="font-medium text-right">—</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-warmgray">Sessions Purchased</span>
        <span id="profile-finance-package-total" class="font-medium">—</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-warmgray">Used</span>
        <span id="profile-finance-package-used" class="font-medium">—</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-warmgray">Remaining</span>
        <span id="profile-finance-package-remaining" class="font-medium">—</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-warmgray">Expires</span>
        <span id="profile-finance-package-expires" class="font-medium text-right">—</span>
      </div>
    </div>
  </div>
</div>

          <div class="profile-panel bg-white rounded-2xl border border-cream p-5 fade-in" style="animation-delay:0.15s">
            <h4 class="font-display font-semibold mb-3">Resume</h4>
            <div class="flex items-center gap-3 p-3 bg-parchment rounded-xl">
              <div class="w-10 h-10 rounded-lg bg-burgundy/10 flex items-center justify-center">
                <i data-lucide="file-text" class="w-5 h-5 text-burgundy"></i>
              </div>
              <div class="flex-1 min-w-0">
                <p id="profile-resume-name" class="text-sm font-medium truncate">No resume uploaded</p>
                <p id="profile-resume-meta" class="text-xs text-warmgray">No file available</p>
              </div>
              <button class="text-xs text-gold font-medium hover:underline">View</button>
            </div>
          </div>

          <div class="profile-panel bg-white rounded-2xl border border-cream p-5 fade-in" style="animation-delay:0.18s">
  <div class="flex items-center justify-between mb-3">
    <h4 class="font-display font-semibold">Payments</h4>
    <span id="profile-payments-count" class="text-xs text-warmgray">—</span>
  </div>

  <div id="profile-payments-list" class="space-y-3 max-h-[260px] overflow-y-auto pr-1">
    <div class="text-sm text-warmgray">No payments yet.</div>
  </div>
</div>

          <div class="profile-panel bg-white rounded-2xl border border-cream p-5 fade-in" style="animation-delay:0.2s">
            <h4 class="font-display font-semibold mb-3">Working Snapshot</h4>
            <div class="space-y-2">
              <div id="profile-material-1" class="p-3 bg-gold/5 border border-gold/15 rounded-xl"></div>
              <div id="profile-material-2" class="p-3 bg-sage/5 border border-sage/15 rounded-xl"></div>
            </div>
          </div>
        </div>

        <div class="profile-main min-w-0 space-y-5">
          <div class="profile-panel bg-white rounded-2xl border border-cream fade-in" style="animation-delay:0.1s">
            <div class="profile-tab-bar flex flex-wrap border-b border-cream">
              <button
                onclick="switchProfileTab('notes', this)"
                class="tab-btn active-tab px-5 py-3.5 text-sm font-medium text-gold border-b-2 border-gold"
              >
                Lesson Notes
              </button>
              <button
                onclick="switchProfileTab('homework', this)"
                class="tab-btn px-5 py-3.5 text-sm font-medium text-warmgray border-b-2 border-transparent"
              >
                Homework
              </button>
              <button
                onclick="switchProfileTab('materials', this)"
                class="tab-btn px-5 py-3.5 text-sm font-medium text-warmgray border-b-2 border-transparent"
              >
                Materials
              </button>
            </div>

            <div id="profile-tab-notes" class="p-5 space-y-4"></div>
            <div id="profile-tab-homework" class="p-5" style="display:none;"></div>
            <div id="profile-tab-materials" class="p-5" style="display:none;"></div>
          </div>

          <div class="profile-panel bg-white rounded-2xl border border-cream fade-in" style="animation-delay:0.15s">
            <div class="dashboard-panel-header p-5 border-b border-cream flex items-center justify-between gap-3">
              <div class="min-w-0">
                <h3 class="font-display text-lg font-semibold">Lessons</h3>
                <p class="text-xs text-warmgray mt-1">Upcoming and recent lesson history for this student</p>
              </div>
              <button id="add-lesson-btn" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold card-hover">
                Add Lesson
              </button>
            </div>

            <div id="profile-lessons-list" class="p-5 space-y-3">
              <div class="text-sm text-warmgray">No lessons yet.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  populateStudentProfile(selectedStudentId);

  const editBtn = document.getElementById("edit-student-btn");
  if (editBtn) {
    editBtn.onclick = () => openStudentModal("edit", selectedStudentId);
  }

  const statusBtn = document.getElementById("change-status-btn");
  if (statusBtn) {
    statusBtn.onclick = () => changeSelectedStudentStatus();
  }

  const addLessonBtn = document.getElementById("add-lesson-btn");
  if (addLessonBtn) {
    addLessonBtn.onclick = () => openLessonModal("create");
  }

  lucide.createIcons();
}

/*********************************
 * PUBLIC PAGE RENDERER
 *********************************/

function renderPublicPage() {
  if (!selectedStudentId || !getStudentById(selectedStudentId)) {
    selectedStudentId = students.length > 0 ? students[0].id : null;
  }

  const root = document.getElementById("page-root");
  if (!root) return;

  root.innerHTML = `
    <div>
      <div class="public-hero text-white">
        <div class="max-w-4xl mx-auto px-8 pt-16 pb-20">
          <div class="flex flex-col md:flex-row items-center gap-10 fade-in">
            <div class="w-56 h-56 rounded-2xl headshot-placeholder flex items-center justify-center shrink-0 border-2 border-white/10 shadow-2xl">
              <i data-lucide="user" class="w-20 h-20 text-warmgray/40"></i>
            </div>

            <div class="text-center md:text-left">
              <p class="text-xs uppercase tracking-[0.25em] text-gold mb-3 font-medium">Actor</p>
              <h1 id="public-name" class="font-display text-5xl font-bold mb-3">Actor Name</h1>
              <p id="public-bio" class="text-warmgray text-base leading-relaxed max-w-lg"></p>

              <div class="flex flex-wrap gap-3 mt-6 justify-center md:justify-start">
                <span class="text-xs border border-white/20 text-white/80 px-3 py-1.5 rounded-full">Film &amp; Television</span>
                <span class="text-xs border border-white/20 text-white/80 px-3 py-1.5 rounded-full">Theater</span>
                <span class="text-xs border border-white/20 text-white/80 px-3 py-1.5 rounded-full">Voice Over</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="max-w-4xl mx-auto px-8 -mt-8">
        <div class="bg-white rounded-2xl border border-cream p-6 mb-6 fade-in" style="animation-delay:0.1s">
          <h3 class="font-display text-xl font-semibold mb-4">Demo Reel</h3>
          <div class="aspect-video bg-warmblack rounded-xl flex items-center justify-center relative overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-br from-charcoal to-warmblack"></div>
            <div class="relative z-10 text-center">
              <div class="w-16 h-16 rounded-full bg-gold/20 flex items-center justify-center mx-auto mb-3 cursor-pointer hover:bg-gold/30 transition-colors">
                <i data-lucide="play" class="w-7 h-7 text-gold ml-1"></i>
              </div>
              <p class="text-sm text-warmgray">Demo Reel Placeholder</p>
              <p class="text-xs text-warmgray/60 mt-1">2:34</p>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-6 mb-12">
          <div class="bg-white rounded-2xl border border-cream p-6 fade-in" style="animation-delay:0.15s">
            <h3 class="font-display text-xl font-semibold mb-4">Resume</h3>
            <div class="space-y-3">
              <div>
                <p class="text-xs uppercase tracking-wider text-warmgray font-medium mb-2">Selected Film &amp; TV</p>
                <div class="space-y-1.5 text-sm">
                  <div class="flex justify-between"><span class="font-medium">Role Sample</span><span class="text-warmgray">Lead · Studio</span></div>
                </div>
              </div>

              <button class="w-full mt-3 py-2.5 rounded-xl bg-parchment border border-cream text-sm font-medium text-charcoal hover:bg-cream transition-colors flex items-center justify-center gap-2">
                <i data-lucide="download" class="w-4 h-4"></i>
                Download Full Resume
              </button>
            </div>
          </div>

          <div class="bg-white rounded-2xl border border-cream p-6 fade-in" style="animation-delay:0.2s">
            <h3 class="font-display text-xl font-semibold mb-4">Contact &amp; Representation</h3>
            <div class="space-y-4">
              <div class="p-4 bg-parchment rounded-xl">
                <p class="text-xs uppercase tracking-wider text-warmgray font-medium mb-2">Direct Contact</p>
                <p id="public-contact-email" class="text-sm text-gold">actor@example.com</p>
              </div>
            </div>
          </div>
        </div>

        <div class="text-center py-8 border-t border-cream">
          <p id="public-studio-name" class="text-xs uppercase tracking-[0.2em] text-warmgray font-medium">Stage &amp; Story Studio</p>
          <p class="text-[11px] text-warmgray/60 mt-1">Actor profile managed by studio</p>
        </div>
      </div>
    </div>
  `;

  populatePublicPage(selectedStudentId);
  lucide.createIcons();
}

function populateStudentProfile(studentId) {
  resetProfileNotesVisibleCount();
  resetProfilePreviousLessonsVisibleCount();

  const student = getStudentById(studentId);
  const schemaStudent = getSchemaStudentById(studentId);
  const actorProfile = getActorProfileByStudentId(studentId);
  const files = getFilesByStudentId(studentId);
  const notes = getNotesByStudentId(studentId);
  const lessons = getLessonsByStudentId(studentId);

  if (!student || !schemaStudent) return;

  const statusConfig = getStatusColor(student.status);
  const resumeFile = files.find((file) => file.category === "Resume") || files[0] || null;
  const activeFiles = files.filter((file) => String(file.status || "").toLowerCase() !== "vaulted");
  const vaultedFiles = files.filter((file) => String(file.status || "").toLowerCase() === "vaulted");
  const currentLesson = lessons[0] || null;
  const publishedNotes = notes.filter((note) => normalizeNoteStatus(note.status) === "PUBLISHED");

  const titleEl = document.getElementById("profile-page-title");
  if (titleEl) titleEl.textContent = `${student.name} Profile`;

  const subtitleEl = document.getElementById("profile-page-subtitle");
  if (subtitleEl) subtitleEl.textContent = `${schemaStudent.student_id} · ${schemaStudent.billing_model} · ${getStudentLeadSourceLabel(schemaStudent.lead_source)}`;

  const nameEl = document.getElementById("profile-student-name");
  if (nameEl) nameEl.textContent = student.name;

  const focusEl = document.getElementById("profile-student-focus");
  if (focusEl) focusEl.textContent = student.focus;

  const badgesEl = document.getElementById("profile-badges");
  if (badgesEl) {
    badgesEl.innerHTML = `
      <span class="inline-flex items-center gap-1 text-xs font-medium ${statusConfig.text} ${statusConfig.bg} px-2.5 py-1 rounded-full">
        <span class="w-1.5 h-1.5 rounded-full ${statusConfig.dot}"></span> ${statusConfig.label}
      </span>
      <span class="text-xs text-warmgray bg-warmgray/10 px-2.5 py-1 rounded-full">
        Since ${formatLongDate(schemaStudent.created_at)}
      </span>
    `;
  }

  const lastLessonEl = document.getElementById("profile-last-lesson");
  const billingModelEl = document.getElementById("profile-billing-model");
  const financeSummaryEl = document.getElementById("profile-finance-summary");

  const financeBadgeEl = document.getElementById("profile-finance-badge");
  const financeHeadlineEl = document.getElementById("profile-finance-headline");
  const financeSublineEl = document.getElementById("profile-finance-subline");

  const financePaidEl = document.getElementById("profile-finance-paid");
  const financeOwedEl = document.getElementById("profile-finance-owed");
  const financeRemainingBalanceEl = document.getElementById("profile-finance-remaining-balance");
  const financePackageBlockEl = document.getElementById("profile-finance-package-block");
  const financePackageNameEl = document.getElementById("profile-finance-package-name");
  const financePackageTotalEl = document.getElementById("profile-finance-package-total");
  const financePackageUsedEl = document.getElementById("profile-finance-package-used");
  const financePackageRemainingEl = document.getElementById("profile-finance-package-remaining");
  const financePackageExpiresEl = document.getElementById("profile-finance-package-expires");

  const paymentsCountEl = document.getElementById("profile-payments-count");
  const paymentsListEl = document.getElementById("profile-payments-list");
  if (lastLessonEl) lastLessonEl.textContent = student.lastSeen;

  const publicStatusEl = document.getElementById("profile-public-status");
  if (publicStatusEl) {
    const isActive = actorProfile && actorProfile.status === "Active";
    const lateCancelCount = getLateCancelCountForStudent(studentId, 6);
    const blockedByPolicy = isStudentPublicPageBlockedByLessonPolicy(studentId);

    if (blockedByPolicy) {
      publicStatusEl.innerHTML = `<span class="inline-flex items-center gap-1 text-burgundy"><span class="w-1.5 h-1.5 rounded-full bg-burgundy"></span>Blocked · ${lateCancelCount} late cancels in 6 months</span>`;
    } else {
      publicStatusEl.innerHTML = `<span class="inline-flex items-center gap-1 ${isActive ? "text-sage" : "text-warmgray"}"><span class="w-1.5 h-1.5 rounded-full ${isActive ? "bg-sage" : "bg-warmgray"}"></span>${actorProfile ? actorProfile.status : "Not Live"}</span>`;
    }
  }

  const emailEl = document.getElementById("profile-email");
  if (emailEl) emailEl.textContent = schemaStudent.email || "—";

  const phoneEl = document.getElementById("profile-phone");
  if (phoneEl) phoneEl.textContent = schemaStudent.phone || "—";

  const additionalEmailsEl = document.getElementById("profile-additional-emails");
  if (additionalEmailsEl) additionalEmailsEl.textContent = schemaStudent.additional_emails || "—";

  const guardianNameEl = document.getElementById("profile-guardian-name");
  if (guardianNameEl) guardianNameEl.textContent = schemaStudent.guardian_name || "—";

  const guardianEmailEl = document.getElementById("profile-guardian-email");
  if (guardianEmailEl) guardianEmailEl.textContent = schemaStudent.guardian_email || "—";

  const guardianPhoneEl = document.getElementById("profile-guardian-phone");
  if (guardianPhoneEl) guardianPhoneEl.textContent = schemaStudent.guardian_phone || "—";

  const timezoneEl = document.getElementById("profile-timezone");
  if (timezoneEl) timezoneEl.textContent = schemaStudent.timezone || "—";

  const leadSourceEl = document.getElementById("profile-lead-source");
  if (leadSourceEl) {
    const base = getStudentLeadSourceLabel(schemaStudent.lead_source);
    leadSourceEl.textContent = schemaStudent.lead_source_detail ? `${base} · ${schemaStudent.lead_source_detail}` : base;
  }

  const emailBtn = document.getElementById("profile-email-btn");
  const bestContactEmail = String(schemaStudent.email || schemaStudent.guardian_email || parseStoredEmailList(schemaStudent.additional_emails || "")[0] || "").trim();
  if (emailBtn) {
    emailBtn.href = bestContactEmail ? `mailto:${bestContactEmail}` : "#";
    emailBtn.target = bestContactEmail ? "_blank" : "";
    emailBtn.rel = bestContactEmail ? "noopener noreferrer" : "";
    emailBtn.onclick = bestContactEmail
      ? () => {
          window.open(`mailto:${bestContactEmail}`, "_blank", "noopener");
          return false;
        }
      : null;

    if (!bestContactEmail) {
      emailBtn.classList.add("pointer-events-none", "opacity-60");
    } else {
      emailBtn.classList.remove("pointer-events-none", "opacity-60");
    }
  }

  const finance = buildFinanceSummary(studentId, schemaStudent);

if (billingModelEl) {
  billingModelEl.textContent = getBillingModelLabel(schemaStudent.billing_model);
}

if (financeSummaryEl) {
  financeSummaryEl.textContent = finance.subline || "—";
}

if (financeBadgeEl) {
  financeBadgeEl.className = `text-[11px] px-2 py-1 rounded-full ${finance.badgeClass}`;
  financeBadgeEl.textContent = finance.badgeLabel;
}

if (financeHeadlineEl) {
  financeHeadlineEl.textContent = finance.headline || "—";
}

if (financeSublineEl) {
  financeSublineEl.textContent = finance.subline || "—";
}

if (financePaidEl) {
  financePaidEl.textContent = formatCurrency(finance.paid || 0);
}

if (financeOwedEl) {
  financeOwedEl.textContent = formatCurrency(finance.owed || 0);
}

if (financeRemainingBalanceEl) {
  financeRemainingBalanceEl.textContent = formatCurrency(finance.remainingAmount || 0);
  financeRemainingBalanceEl.classList.remove("text-sage", "text-gold", "text-burgundy", "text-warmblack");

  if ((finance.remainingAmount || 0) <= 0) {
    financeRemainingBalanceEl.classList.add("text-sage");
  } else if ((finance.remainingAmount || 0) <= 100) {
    financeRemainingBalanceEl.classList.add("text-gold");
  } else {
    financeRemainingBalanceEl.classList.add("text-burgundy");
  }
}

if (financePackageBlockEl) {
  financePackageBlockEl.style.display = finance.mode === "PACKAGE" ? "block" : "none";
}

if (financePackageNameEl) {
  financePackageNameEl.textContent = finance.packageInfo ? (finance.packageInfo.package_name || "Package") : "—";
}

if (financePackageTotalEl) {
  financePackageTotalEl.textContent = finance.packageUsage ? String(finance.packageUsage.total) : "—";
}

if (financePackageUsedEl) {
  financePackageUsedEl.textContent = finance.packageUsage ? String(finance.packageUsage.used) : "—";
}

if (financePackageRemainingEl) {
  financePackageRemainingEl.textContent = finance.packageUsage ? String(finance.packageUsage.remaining) : "—";
  financePackageRemainingEl.classList.remove("text-gold", "text-burgundy", "text-warmblack");

  if (!finance.packageUsage) {
    financePackageRemainingEl.classList.add("text-warmblack");
  } else if (finance.packageUsage.remaining <= 0) {
    financePackageRemainingEl.classList.add("text-burgundy");
  } else if (finance.packageUsage.remaining <= 2) {
    financePackageRemainingEl.classList.add("text-gold");
  } else {
    financePackageRemainingEl.classList.add("text-warmblack");
  }
}

if (financePackageExpiresEl) {
  financePackageExpiresEl.textContent = finance.packageInfo?.expires_on ? formatLongDate(finance.packageInfo.expires_on) : "—";
}

if (paymentsCountEl) {
  paymentsCountEl.textContent = `${finance.payments.length} payment${finance.payments.length === 1 ? "" : "s"}`;
}

if (paymentsListEl) {
  if (!finance.payments.length) {
    paymentsListEl.innerHTML = `<div class="text-sm text-warmgray">No payments yet.</div>`;
  } else {
    paymentsListEl.innerHTML = finance.payments.map((payment) => `
      <div class="p-3 rounded-xl border border-cream bg-parchment">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-warmblack">${escapeHtml(formatCurrency(payment.amount, payment.currency))}</p>
          <span class="text-[11px] px-2 py-0.5 rounded-full ${getPaymentStatusBadge(payment.status)}">
            ${escapeHtml(String(payment.status || "Paid"))}
          </span>
        </div>
        <p class="text-xs text-warmgray mt-1">${escapeHtml(formatLongDate(payment.payment_date || ""))}</p>
        <p class="text-xs text-warmgray mt-1">${escapeHtml(payment.payment_type || "Payment")}</p>
      </div>
    `).join("");
  }
}

  const bioEl = document.getElementById("profile-bio");
  if (bioEl) {
    bioEl.textContent = actorProfile?.bio || `${student.name} is currently focused on ${student.focus}. Billing model: ${schemaStudent.billing_model}. Booking style: ${schemaStudent.booking_behavior}.`;
  }

  const resumeNameEl = document.getElementById("profile-resume-name");
  if (resumeNameEl) resumeNameEl.textContent = resumeFile ? getMaterialDisplayName(resumeFile) : "No resume uploaded";

  const resumeMetaEl = document.getElementById("profile-resume-meta");
  if (resumeMetaEl) resumeMetaEl.textContent = resumeFile ? `Uploaded ${formatLongDate(resumeFile.uploaded_at)}` : "No file available";

  const primaryActorMaterial = getPrimaryActorMaterialRow(studentId);
  const latestCoachingMaterial = getLatestCoachingMaterialRow(studentId);

  const material1 = document.getElementById("profile-material-1");
  if (material1) {
    material1.innerHTML = primaryActorMaterial
      ? `
        <p class="text-xs text-gold font-medium uppercase tracking-wider mb-1">Primary Actor Material</p>
        <p class="text-sm font-medium">${escapeHtml(primaryActorMaterial.display_name)}</p>
        <p class="text-xs text-warmgray mt-0.5">${escapeHtml(primaryActorMaterial.category)} � ${escapeHtml(primaryActorMaterial.visibility_label)} � ${escapeHtml(formatLongDate(primaryActorMaterial.uploaded_at))}</p>
      `
      : `
        <p class="text-xs text-gold font-medium uppercase tracking-wider mb-1">Primary Actor Material</p>
        <p class="text-sm font-medium">No actor material yet</p>
        <p class="text-xs text-warmgray mt-0.5">Add a headshot, resume, reel, or self tape</p>
      `;
  }

  const material2 = document.getElementById("profile-material-2");
  if (material2) {
    material2.innerHTML = latestCoachingMaterial
      ? `
        <p class="text-xs text-sage font-medium uppercase tracking-wider mb-1">Current Coaching Material</p>
        <p class="text-sm font-medium">${escapeHtml(latestCoachingMaterial.display_name)}</p>
        <p class="text-xs text-warmgray mt-0.5">${escapeHtml(latestCoachingMaterial.category)} � ${escapeHtml(latestCoachingMaterial.scope_label)} � ${escapeHtml(formatLongDate(latestCoachingMaterial.uploaded_at))}</p>
      `
      : `
        <p class="text-xs text-sage font-medium uppercase tracking-wider mb-1">Current Coaching Material</p>
        <p class="text-sm font-medium">No coaching material yet</p>
        <p class="text-xs text-warmgray mt-0.5">Add scripts, sides, homework, or resource links</p>
      `;
  }

  renderProfileNotesTab(studentId);

  renderProfileHomeworkTab(studentId);
  renderProfileMaterialsTab(studentId);

  renderProfileLessons(studentId);
  lucide.createIcons();
}

function populatePublicPage(studentId) {
  const student = getStudentById(studentId);
  const actorProfile = getActorProfileByStudentId(studentId);
  if (!student) return;

  const nameEl = document.getElementById("public-name");
  if (nameEl) nameEl.textContent = actorProfile?.display_name || student.name;

  const bioEl = document.getElementById("public-bio");
  if (bioEl) bioEl.textContent = actorProfile?.bio || `${student.name} is an actor working in ${student.focus}.`;

  const emailEl = document.getElementById("public-contact-email");
  if (emailEl) emailEl.textContent = student.email || "actor@example.com";
}

/*********************************
 * STUDENT MODAL HANDLERS
 *********************************/

function openStudentModal(mode = "create", studentId = null) {
  const modal = document.getElementById("student-modal");
  const title = document.getElementById("student-modal-title");
  const form = document.getElementById("student-form");

  if (!modal || !title || !form) return;

  form.reset();
  editingStudentId = null;

  if (mode === "edit" && studentId) {
    const schemaStudent = getSchemaStudentById(studentId);
    if (!schemaStudent) return;

    editingStudentId = studentId;
    title.textContent = "Edit Student";

    if (form.elements.full_name) form.elements.full_name.value = schemaStudent.full_name || "";
    if (form.elements.email) form.elements.email.value = schemaStudent.email || "";
    if (form.elements.additional_emails) form.elements.additional_emails.value = schemaStudent.additional_emails || "";
    if (form.elements.phone) form.elements.phone.value = schemaStudent.phone || "";
    if (form.elements.guardian_name) form.elements.guardian_name.value = schemaStudent.guardian_name || "";
    if (form.elements.guardian_email) form.elements.guardian_email.value = schemaStudent.guardian_email || "";
    if (form.elements.guardian_phone) form.elements.guardian_phone.value = schemaStudent.guardian_phone || "";
    if (form.elements.timezone) form.elements.timezone.value = schemaStudent.timezone || "";
    if (form.elements.studio_status) form.elements.studio_status.value = schemaStudent.studio_status || "ACTIVE";
    if (form.elements.billing_model) form.elements.billing_model.value = schemaStudent.billing_model || "PAYG";
    if (form.elements.booking_behavior) form.elements.booking_behavior.value = schemaStudent.booking_behavior || "MIXED";
    if (form.elements.lead_source) form.elements.lead_source.value = schemaStudent.lead_source || "";
    if (form.elements.lead_source_detail) form.elements.lead_source_detail.value = schemaStudent.lead_source_detail || "";
    if (form.elements.focus_area) form.elements.focus_area.value = schemaStudent.focus_area || "";
    if (form.elements.actor_page_eligible) {
      form.elements.actor_page_eligible.checked = Boolean(schemaStudent.actor_page_eligible);
    }
    } else {
      title.textContent = "Add Student";
    }

  modal.classList.remove("hidden");
}

function closeStudentModal() {
  const modal = document.getElementById("student-modal");
  if (!modal) return;
  modal.classList.add("hidden");
}

function closeStudentStatusPicker() {
  const picker = document.getElementById("student-status-picker-overlay");
  if (picker) picker.remove();
}

function changeSelectedStudentStatus() {
  if (!selectedStudentId) return;

  const student = getSchemaStudentById(selectedStudentId);
  if (!student) return;

  closeStudentStatusPicker();

  const current = student.studio_status || "ACTIVE";

  const overlay = document.createElement("div");
  overlay.id = "student-status-picker-overlay";
  overlay.className = "fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4";

  overlay.innerHTML = `
    <div class="app-modal-shell bg-white rounded-2xl border border-cream w-full max-w-md p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
      <div class="app-modal-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h3 class="font-display text-lg font-bold text-warmblack">Update Student Status</h3>
        <button type="button" id="close-student-status-picker" class="self-start text-sm text-warmgray">Close</button>
      </div>

      <div class="space-y-4">
        <div>
          <p class="text-xs uppercase tracking-wider text-warmgray font-medium mb-2">Student</p>
          <p class="text-sm font-semibold text-warmblack">${escapeHtml(student.full_name || "Unknown Student")}</p>
        </div>

        <div>
          <label class="block text-xs font-medium text-warmgray mb-1">Status</label>
          <select id="student-status-picker-select" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
            <option value="LEAD" ${current === "LEAD" ? "selected" : ""}>Lead</option>
            <option value="ACTIVE" ${current === "ACTIVE" ? "selected" : ""}>Active</option>
            <option value="PAUSED" ${current === "PAUSED" ? "selected" : ""}>Paused</option>
            <option value="INACTIVE" ${current === "INACTIVE" ? "selected" : ""}>Inactive</option>
            <option value="ALUMNI" ${current === "ALUMNI" ? "selected" : ""}>Alumni</option>
          </select>
        </div>

        <div class="app-modal-footer flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
          <button type="button" id="cancel-student-status-picker" class="px-4 py-2.5 rounded-xl border border-cream bg-parchment text-sm font-medium">
            Cancel
          </button>
          <button type="button" id="save-student-status-picker" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">
            Save Status
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = document.getElementById("close-student-status-picker");
  const cancelBtn = document.getElementById("cancel-student-status-picker");
  const saveBtn = document.getElementById("save-student-status-picker");
  const select = document.getElementById("student-status-picker-select");

  if (closeBtn) closeBtn.onclick = closeStudentStatusPicker;
  if (cancelBtn) cancelBtn.onclick = closeStudentStatusPicker;

  if (saveBtn && select) {
    saveBtn.onclick = () => {
      const result = setStudentStatus(selectedStudentId, select.value);

      if (!result || result.ok === false) {
        const errors = result?.errors || ["Unable to update status."];
        notifyUser({
          title: "Student Status",
          message: errors.join(" "),
          tone: "error",
          source: "students"
        });
        return;
      }

      closeStudentStatusPicker();
      renderAppFromSchema();
      notifyUser({
        title: "Student Status Updated",
        message: "The student status was updated successfully.",
        tone: "success",
        source: "students"
      });
    };
  }
}

/*********************************
 * FORM SUBMIT HANDLERS
 *********************************/

function handleStudentFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  if (!form) return;

  const payload = {
    full_name: form.elements.full_name ? form.elements.full_name.value.trim() : "",
    email: form.elements.email ? form.elements.email.value.trim() : "",
    additional_emails: form.elements.additional_emails ? form.elements.additional_emails.value.trim() : "",
    phone: form.elements.phone ? form.elements.phone.value.trim() : "",
    guardian_name: form.elements.guardian_name ? form.elements.guardian_name.value.trim() : "",
    guardian_email: form.elements.guardian_email ? form.elements.guardian_email.value.trim() : "",
    guardian_phone: form.elements.guardian_phone ? form.elements.guardian_phone.value.trim() : "",
    timezone: form.elements.timezone ? form.elements.timezone.value.trim() : "",
    studio_status: form.elements.studio_status ? form.elements.studio_status.value : "ACTIVE",
    billing_model: form.elements.billing_model ? form.elements.billing_model.value : "PAYG",
    booking_behavior: form.elements.booking_behavior ? form.elements.booking_behavior.value : "MIXED",
    lead_source: form.elements.lead_source ? form.elements.lead_source.value : "",
    lead_source_detail: form.elements.lead_source_detail ? form.elements.lead_source_detail.value.trim() : "",
    focus_area: form.elements.focus_area ? form.elements.focus_area.value.trim() : "",
    actor_page_eligible: form.elements.actor_page_eligible ? form.elements.actor_page_eligible.checked : false
  };

  const result = editingStudentId
    ? updateStudent(editingStudentId, payload)
    : createStudent(payload);

  if (!result || result.ok === false) {
    const errors = result && Array.isArray(result.errors) ? result.errors : ["Unable to save student."];
    notifyUser({
      title: "Student Save",
      message: errors.join(" "),
      tone: "error",
      source: "students"
    });
    return;
  }

  if (result.student && result.student.student_id) {
    selectedStudentId = result.student.student_id;
  }

  renderAppFromSchema();
  closeStudentModal();
  notifyUser({
    title: editingStudentId ? "Student Updated" : "Student Added",
    message: `${payload.full_name} is saved and ready to work with.`,
    tone: "success",
    source: "students"
  });
}

function handleLessonFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  if (!form) return;

  const scheduledStart = buildLessonStartIso(form);

  const durationMinutes = form.elements.duration_minutes
    ? Number(form.elements.duration_minutes.value || 60)
    : 60;

  const scheduledEnd = scheduledStart
    ? addMinutesToIso(scheduledStart, durationMinutes)
    : "";

  const payload = {
    student_id: form.elements.student_id.value,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    lesson_status: form.elements.lesson_status.value,
    lesson_type: form.elements.lesson_type.value.trim(),
    manual_payment_status: form.elements.manual_payment_status.value,
    location_type: form.elements.location_type.value,
    location_address: form.elements.location_address.value.trim(),
    topic: form.elements.topic.value.trim(),
    join_link: form.elements.join_link.value.trim(),
    actual_completion_date: form.elements.actual_completion_date.value ? new Date(form.elements.actual_completion_date.value).toISOString() : "",
    cancellation_type: form.elements.cancellation_type.value,
    source: form.elements.source.value,
    external_event_id: form.elements.external_event_id.value.trim(),
    internal_comments: form.elements.internal_comments.value.trim()
  };

  const result = editingLessonId
    ? updateLesson(editingLessonId, payload)
    : createLesson(payload);

  if (!result || result.ok === false) {
    const errors = result && Array.isArray(result.errors) ? result.errors : ["Unable to save lesson."];
    notifyUser({
      title: "Lesson Save",
      message: errors.join(" "),
      tone: "error",
      source: "lessons"
    });
    return;
  }

  if (result.lesson && result.lesson.student_id) {
    selectedStudentId = result.lesson.student_id;
  }

  renderAppFromSchema();
  closeLessonModal();
  notifyUser({
    title: editingLessonId ? "Lesson Updated" : "Lesson Added",
    message: `${payload.topic || "Lesson"} is saved and visible in the schedule.`,
    tone: "success",
    source: "lessons"
  });
}

/*********************************
 * LESSON MODAL HANDLERS
 *********************************/

function populateLessonStudentOptions(selectedStudentIdOverride = "") {
  const form = document.getElementById("lesson-form");
  if (!form || !form.elements.student_id) return;

  const currentValue = selectedStudentIdOverride || form.elements.student_id.value || "";

  form.elements.student_id.innerHTML = getStudentRecords()
    .map((student) => {
      const selected = student.student_id === currentValue ? "selected" : "";
      return `<option value="${student.student_id}" ${selected}>${student.full_name}</option>`;
    })
    .join("");
}

function ensureLessonTypeOption(form, lessonType) {
  const lessonTypeField = form?.elements?.lesson_type;
  const value = String(lessonType || "").trim();
  if (!lessonTypeField || !value) return;

  const hasOption = Array.from(lessonTypeField.options || []).some((option) => option.value === value);
  if (!hasOption) {
    lessonTypeField.insertAdjacentHTML(
      "beforeend",
      `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
    );
  }
}

function openLessonModal(mode = "create", lessonId = null) {
  const modal = document.getElementById("lesson-modal");
  const title = document.getElementById("lesson-modal-title");
  const form = document.getElementById("lesson-form");

  if (!modal || !title || !form) return;

  form.reset();
  editingLessonId = null;
  populateLessonStudentOptions(selectedStudentId || "");

  if (mode === "edit" && lessonId) {
    const lesson = getLessonRecords().find((item) => item.lesson_id === lessonId);
    if (!lesson) return;

    editingLessonId = lessonId;
    title.textContent = "Edit Lesson";

    populateLessonStudentOptions(lesson.student_id);

    if (form.elements.student_id) {
      form.elements.student_id.value = lesson.student_id || "";
    }

    populateLessonStartFields(form, lesson.scheduled_start);

    if (form.elements.duration_minutes) {
      form.elements.duration_minutes.value = getDurationFromLesson(lesson);
    }

    if (form.elements.lesson_status) {
      form.elements.lesson_status.value = (lesson.lesson_status || "SCHEDULED").toUpperCase();
    }

    if (form.elements.lesson_type) {
      ensureLessonTypeOption(form, lesson.lesson_type);
      form.elements.lesson_type.value = lesson.lesson_type || "";
    }

    if (form.elements.manual_payment_status) {
      form.elements.manual_payment_status.value = lesson.manual_payment_status || "";
    }

    if (form.elements.location_type) {
      form.elements.location_type.value = getLessonLocationType(lesson);
    }

    if (form.elements.topic) {
      form.elements.topic.value = lesson.topic || "";
    }

    if (form.elements.join_link) {
      form.elements.join_link.value = lesson.join_link || "";
    }

    if (form.elements.location_address) {
      form.elements.location_address.value = lesson.location_address || "";
    }

    if (form.elements.actual_completion_date) {
      form.elements.actual_completion_date.value = formatDateTimeLocalValue(lesson.actual_completion_date);
    }

    if (form.elements.cancellation_type) {
      form.elements.cancellation_type.value = lesson.cancellation_type || "";
    }

    if (form.elements.source) {
      form.elements.source.value = lesson.source || "manual";
    }

    if (form.elements.external_event_id) {
      form.elements.external_event_id.value = lesson.external_event_id || "";
    }

    if (form.elements.internal_comments) {
      form.elements.internal_comments.value = lesson.internal_comments || "";
    }
  } else {
    title.textContent = "Add Lesson";
    populateLessonStudentOptions(selectedStudentId || "");

    if (selectedStudentId && form.elements.student_id) {
      form.elements.student_id.value = selectedStudentId;
    }

    if (form.elements.lesson_status) {
      form.elements.lesson_status.value = "SCHEDULED";
    }

    if (form.elements.duration_minutes) {
      form.elements.duration_minutes.value = "60";
    }

    populateLessonStartFields(form, "");

    if (form.elements.lesson_type) {
      form.elements.lesson_type.value = "Audition Coaching";
    }

    if (form.elements.manual_payment_status) {
      form.elements.manual_payment_status.value = "";
    }

    if (form.elements.location_type) {
      form.elements.location_type.value = "VIRTUAL";
    }

    if (form.elements.location_address) {
      form.elements.location_address.value = "";
    }

    if (form.elements.source) {
      form.elements.source.value = "manual";
    }
  }

  updateLessonLocationFieldsVisibility(form);

  modal.classList.remove("hidden");
}

function closeLessonModal() {
  const modal = document.getElementById("lesson-modal");
  if (!modal) return;
  modal.classList.add("hidden");
}

/*********************************
 * LESSON DETAIL + STATUS HANDLERS
 *********************************/

function closeLessonStatusPicker() {
  const picker = document.getElementById("lesson-status-picker-overlay");
  if (picker) picker.remove();
}

function quickChangeLessonStatus(lessonId) {
  const lesson = getSchemaLessonById(lessonId);
  if (!lesson) return;

  closeLessonStatusPicker();

  const current = getEffectiveLessonStatus(lesson);

  const overlay = document.createElement("div");
  overlay.id = "lesson-status-picker-overlay";
  overlay.className = "fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4";

  overlay.innerHTML = `
    <div class="app-modal-shell bg-white rounded-2xl border border-cream w-full max-w-md p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
      <div class="app-modal-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h3 class="font-display text-lg font-bold text-warmblack">Update Lesson Status</h3>
        <button type="button" id="close-lesson-status-picker" class="self-start text-sm text-warmgray">Close</button>
      </div>

      <div class="space-y-4">
        <div>
          <p class="text-xs uppercase tracking-wider text-warmgray font-medium mb-2">Lesson</p>
          <p class="text-sm font-semibold text-warmblack">${escapeHtml(lesson.topic || "Untitled Lesson")}</p>
          <p class="text-xs text-warmgray mt-1">${escapeHtml(formatLessonDate(lesson.scheduled_start))}</p>
        </div>

        <div>
          <label class="block text-xs font-medium text-warmgray mb-1">Status</label>
          <select id="lesson-status-picker-select" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
            <option value="SCHEDULED" ${current === "SCHEDULED" ? "selected" : ""}>Scheduled</option>
            <option value="COMPLETED" ${current === "COMPLETED" ? "selected" : ""}>Completed</option>
            <option value="CANCELLED" ${current === "CANCELLED" ? "selected" : ""}>Cancelled</option>
            <option value="LATE_CANCEL" ${current === "LATE_CANCEL" ? "selected" : ""}>Late Cancel</option>
            <option value="NO_SHOW" ${current === "NO_SHOW" ? "selected" : ""}>No Show</option>
          </select>
        </div>

        <div class="app-modal-footer flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
          <button type="button" id="cancel-lesson-status-picker" class="px-4 py-2.5 rounded-xl border border-cream bg-parchment text-sm font-medium">
            Cancel
          </button>
          <button type="button" id="save-lesson-status-picker" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">
            Save Status
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = document.getElementById("close-lesson-status-picker");
  const cancelBtn = document.getElementById("cancel-lesson-status-picker");
  const saveBtn = document.getElementById("save-lesson-status-picker");
  const select = document.getElementById("lesson-status-picker-select");

  if (closeBtn) closeBtn.onclick = closeLessonStatusPicker;
  if (cancelBtn) cancelBtn.onclick = closeLessonStatusPicker;

  if (saveBtn && select) {
    saveBtn.onclick = () => {
      const result = setLessonStatus(lessonId, select.value);

      if (!result || result.ok === false) {
        const errors = result?.errors || ["Unable to update lesson status."];
        notifyUser({
          title: "Lesson Status",
          message: errors.join(" "),
          tone: "error",
          source: "lessons"
        });
        return;
      }

      closeLessonStatusPicker();
      renderAppFromSchema();

      if (activeLessonDetailId === lessonId) {
        setTimeout(() => openLessonDetailModal(lessonId), 0);
      }
      notifyUser({
        title: "Lesson Status Updated",
        message: "The lesson status was updated successfully.",
        tone: "success",
        source: "lessons"
      });
    };
  }
}

function closeLessonDetailModal() {
  const modal = document.getElementById("lesson-detail-modal-overlay");
  if (modal) modal.remove();
  activeLessonDetailId = null;
}

function refreshProfileNotesIfNeeded(studentId) {
  if (currentPage === "profile" && selectedStudentId === studentId) {
    renderProfileNotesTab(studentId);
  }
}

function openLessonDetailModal(lessonId) {
  const lesson = getSchemaLessonById(lessonId);
  if (!lesson) return;

  activeLessonDetailId = lessonId;
  closeLessonDetailModal();

  const student = getSchemaStudentById(lesson.student_id);
  const note = getLessonNoteByLessonId(lessonId);
  const homeworkItems = getHomeworkByLessonId(lessonId);
  const lessonFiles = getLessonFiles(lessonId);
  const importedContact = getImportedLessonContactInfo(lesson);
  const effectiveStatus = getEffectiveLessonStatus(lesson);
  const paymentStatusLabel = getLessonManualPaymentStatusLabel(lesson.manual_payment_status);
  const paymentStatusClass = getLessonManualPaymentStatusBadge(lesson.manual_payment_status);
  const rescheduleHistoryLabel = getLessonRescheduleHistoryLabel(lesson);
  const lateCancelCount = getLateCancelCountForStudent(lesson.student_id, 6);
  const publicPageBlocked = isStudentPublicPageBlockedByLessonPolicy(lesson.student_id);
  const intakeReviewLabel = getLessonIntakeReviewStateLabel(lesson.intake_review_state, lesson.source);
  const intakeReviewClass = getLessonIntakeReviewStateBadge(lesson.intake_review_state, lesson.source);
  const syncStateLabel = getLessonSyncStateLabel(lesson.sync_state, lesson.source);
  const syncStateClass = getLessonSyncStateBadge(lesson.sync_state, lesson.source);
  const importedLesson = isImportedLesson(lesson);

  const statusLabel = getLessonStatusLabel(effectiveStatus);
  const statusClass = formatLessonStatusBadge(effectiveStatus);

  const overlay = document.createElement("div");
  overlay.id = "lesson-detail-modal-overlay";
  overlay.className = "fixed inset-0 z-[65] bg-black/50 flex items-center justify-center p-4";

  overlay.innerHTML = `
    <div class="lesson-detail-shell bg-white rounded-2xl border border-cream w-full max-w-5xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wider text-warmgray font-medium mb-2">Lesson Detail</p>
          <h3 class="font-display text-2xl font-bold text-warmblack">${escapeHtml(lesson.topic || "Untitled Lesson")}</h3>
          <p class="text-sm text-warmgray mt-1 wrap-anywhere">
            ${escapeHtml(student?.full_name || "Unknown Student")} · ${escapeHtml(lesson.lesson_id)}
          </p>
        </div>

        <button type="button" id="close-lesson-detail-modal" class="self-start text-sm text-warmgray">Close</button>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div class="space-y-5 min-w-0">
          <div class="bg-parchment rounded-2xl border border-cream p-5">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <h4 class="font-display text-lg font-semibold text-warmblack">Lesson Info</h4>
              <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full ${statusClass}">
                ${escapeHtml(statusLabel)}
              </span>
            </div>

            <div class="space-y-3 text-sm">
              <div class="lesson-detail-meta-row flex justify-between gap-4">
                <span class="text-warmgray">Date</span>
                <span class="font-medium text-warmblack">${escapeHtml(formatLessonDate(lesson.scheduled_start))}</span>
              </div>
              <div class="lesson-detail-meta-row flex justify-between gap-4">
                <span class="text-warmgray">Time</span>
                <span class="font-medium text-warmblack">${escapeHtml(formatLessonTimeRange(lesson.scheduled_start, lesson.scheduled_end))}</span>
              </div>
              <div class="lesson-detail-meta-row flex justify-between gap-4">
                <span class="text-warmgray">Type</span>
                <span class="font-medium text-warmblack">${escapeHtml(lesson.lesson_type || "Audition Coaching")}</span>
              </div>
              <div class="lesson-detail-meta-row flex justify-between gap-4">
                <span class="text-warmgray">Location</span>
                <span class="font-medium text-warmblack">${escapeHtml(getLessonLocationLabel(lesson))}</span>
              </div>
              <div class="lesson-detail-meta-row flex justify-between gap-4">
                <span class="text-warmgray">Source</span>
                <span class="font-medium text-warmblack">${escapeHtml(getLessonSourceLabel(lesson.source))}</span>
              </div>
              ${
                importedLesson
                  ? `
                    <div class="lesson-detail-meta-row flex justify-between gap-4">
                      <span class="text-warmgray">Intake Review</span>
                      <span class="font-medium text-warmblack">${escapeHtml(intakeReviewLabel)}</span>
                    </div>
                    <div class="lesson-detail-meta-row flex justify-between gap-4">
                      <span class="text-warmgray">Sync State</span>
                      <span class="font-medium text-warmblack">${escapeHtml(syncStateLabel)}</span>
                    </div>
                  `
                  : ""
              }
              <div class="lesson-detail-meta-row flex justify-between gap-4">
                <span class="text-warmgray">Payment Mark</span>
                <span class="font-medium text-warmblack">${escapeHtml(paymentStatusLabel)}</span>
              </div>
              ${
                rescheduleHistoryLabel
                  ? `
                    <div class="lesson-detail-meta-row flex justify-between gap-4">
                      <span class="text-warmgray">Previous Time</span>
                      <span class="font-medium text-warmblack">${escapeHtml(rescheduleHistoryLabel)}</span>
                    </div>
                  `
                  : ""
              }
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <div class="rounded-xl border border-cream bg-white px-4 py-3">
                <p class="text-[11px] uppercase tracking-wider text-warmgray">Manual Billing Check</p>
                <p class="text-sm font-semibold mt-1 ${paymentStatusClass.includes("burgundy") ? "text-burgundy" : "text-warmblack"}">${escapeHtml(paymentStatusLabel)}</p>
              </div>
              <div class="rounded-xl border border-cream bg-white px-4 py-3">
                <p class="text-[11px] uppercase tracking-wider text-warmgray">Public Page Policy</p>
                <p class="text-sm font-semibold mt-1 ${publicPageBlocked ? "text-burgundy" : "text-warmblack"}">${publicPageBlocked ? "Blocked by late-cancel rule" : "No lesson-policy block"}</p>
                <p class="text-xs text-warmgray mt-1">${lateCancelCount} late cancel${lateCancelCount === 1 ? "" : "s"} in the last 6 months</p>
              </div>
            </div>

            ${
              importedLesson
                ? `
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                    <div class="rounded-xl border border-cream bg-white px-4 py-3">
                      <p class="text-[11px] uppercase tracking-wider text-warmgray">Intake Review</p>
                      <p class="text-sm font-semibold mt-1 ${intakeReviewClass.includes("burgundy") ? "text-burgundy" : "text-warmblack"}">${escapeHtml(intakeReviewLabel)}</p>
                      <p class="text-xs text-warmgray mt-1">${escapeHtml(formatLastSyncMeta(lesson.imported_at))} imported</p>
                    </div>
                    <div class="rounded-xl border border-cream bg-white px-4 py-3">
                      <p class="text-[11px] uppercase tracking-wider text-warmgray">Sync State</p>
                      <p class="text-sm font-semibold mt-1 ${syncStateClass.includes("burgundy") ? "text-burgundy" : "text-warmblack"}">${escapeHtml(syncStateLabel)}</p>
                      <p class="text-xs text-warmgray mt-1">${escapeHtml(formatLastSyncMeta(lesson.last_synced_at))}</p>
                    </div>
                  </div>
                `
                : ""
            }

            ${
              importedLesson && (lesson.external_event_id || lesson.source_calendar_id || lesson.intake_conflict_note || lesson.pending_external_start || lesson.external_contact_name)
                ? `
                  <div class="mt-3 rounded-xl border border-cream bg-white px-4 py-3">
                    <p class="text-[11px] uppercase tracking-wider text-warmgray">Intake Metadata</p>
                    <div class="space-y-2 mt-2 text-sm">
                      ${lesson.external_event_id ? `<p class="text-warmblack wrap-anywhere"><span class="text-warmgray">External Event</span> · ${escapeHtml(lesson.external_event_id)}</p>` : ""}
                      ${lesson.source_calendar_id ? `<p class="text-warmblack wrap-anywhere"><span class="text-warmgray">Calendar</span> · ${escapeHtml(lesson.source_calendar_id)}</p>` : ""}
                      ${lesson.external_platform_hint ? `<p class="text-warmblack wrap-anywhere"><span class="text-warmgray">Platform</span> · ${escapeHtml(getImportedLessonPlatformLabel(lesson.external_platform_hint))}</p>` : ""}
                      ${importedContact.raw_name ? `<p class="text-warmblack wrap-anywhere"><span class="text-warmgray">Imported Contact</span> · ${escapeHtml(importedContact.display_name)}</p>` : ""}
                      ${importedContact.email ? `<p class="text-warmblack wrap-anywhere"><span class="text-warmgray">Imported Email</span> · ${escapeHtml(importedContact.email)}</p>` : ""}
                      ${importedContact.phone ? `<p class="text-warmblack wrap-anywhere"><span class="text-warmgray">Imported Phone</span> · ${escapeHtml(importedContact.phone)}</p>` : ""}
                      ${lesson.external_updated_at ? `<p class="text-warmblack wrap-anywhere"><span class="text-warmgray">External Update</span> · ${escapeHtml(formatLastSyncMeta(lesson.external_updated_at))}</p>` : ""}
                      ${lesson.pending_external_start ? `<p class="text-burgundy wrap-anywhere"><span class="text-warmgray">Pending External Time</span> · ${escapeHtml(formatLessonTimeRange(lesson.pending_external_start, lesson.pending_external_end || lesson.pending_external_start))}</p>` : ""}
                      ${lesson.intake_conflict_note ? `<p class="text-burgundy wrap-anywhere">${escapeHtml(lesson.intake_conflict_note)}</p>` : ""}
                    </div>
                    <div class="flex flex-wrap gap-2 mt-3">
                      ${
                        !lesson.student_id
                          ? `
                            <button type="button" class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack" onclick="openScheduleStudentMatchModal('${lesson.lesson_id}')">Merge Student</button>
                            <button type="button" class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack" onclick="createStudentFromImportedLesson('${lesson.lesson_id}')">Create New Student</button>
                          `
                          : Object.keys(getImportedLessonStudentMergePatch(lesson, getSchemaStudentById(lesson.student_id))).length
                            ? `<button type="button" class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack" onclick="pullStudentInfoFromLesson('${lesson.lesson_id}')">Pull Contact Into Student</button>`
                            : ""
                      }
                    </div>
                  </div>
                `
                : ""
            }

            <div class="mt-5 flex flex-wrap gap-3">
              ${
                getLessonLocationType(lesson) === "VIRTUAL" && lesson.join_link
                  ? `<a href="${escapeHtml(lesson.join_link)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold card-hover">
                      <i data-lucide="video" class="w-4 h-4"></i>
                      Join Meeting
                    </a>`
                  : getLessonLocationType(lesson) === "IN_PERSON" && lesson.location_address
                    ? `<div class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-parchment border border-cream text-warmblack text-sm font-medium">
                        <i data-lucide="map-pin" class="w-4 h-4 text-burgundy"></i>
                        ${escapeHtml(lesson.location_address)}
                      </div>`
                    : `<button type="button" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-parchment border border-cream text-warmgray text-sm font-medium" disabled>
                      <i data-lucide="video-off" class="w-4 h-4"></i>
                      ${getLessonLocationType(lesson) === "VIRTUAL" ? "No Join Link" : "No Address"}
                    </button>`
              }

              <button type="button" id="detail-edit-lesson-btn" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-warmblack text-sm font-medium card-hover">
                Edit Lesson
              </button>

              <button type="button" id="detail-status-lesson-btn" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-warmblack text-sm font-medium card-hover">
                Change Status
              </button>
            </div>
          </div>

          <div class="bg-white rounded-2xl border border-cream p-5">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
              <h4 class="font-display text-lg font-semibold text-warmblack">Attachments</h4>
              <button
                type="button"
                class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                onclick="openMaterialModal('${lesson.student_id}', null, { lessonId: '${lesson.lesson_id}', scope: 'LESSON_MATERIAL' })"
              >
                Add Material
              </button>
            </div>
            <div class="space-y-3">
              ${
                lessonFiles.length
                  ? lessonFiles.map((file) => `
                    <div class="rounded-xl border border-cream bg-parchment p-4">
                      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div class="min-w-0">
                          <p class="text-sm font-medium text-warmblack break-words">${escapeHtml(getMaterialDisplayName(file))}</p>
                          <p class="text-xs text-warmgray mt-1">${escapeHtml(getMaterialKindLabel(file.material_kind))} · ${escapeHtml(file.category || "Other")} · ${escapeHtml(getMaterialScopeLabel(file.scope))}</p>
                          <p class="text-xs text-warmgray mt-1">${escapeHtml(getMaterialSourceLabel(file.source_type))} · ${escapeHtml(getMaterialStatusLabel(file.status))} · ${escapeHtml(formatLongDate(file.uploaded_at))}</p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2 shrink-0">
                          ${getMaterialSourceUrl(file) ? `
                            <a
                              href="${escapeHtml(getMaterialSourceUrl(file))}"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-gold card-hover"
                            >
                              ${escapeHtml(getMaterialActionLabel(file))}
                            </a>
                          ` : ""}
                          <button
                            type="button"
                            class="px-3 py-2 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack card-hover"
                            onclick="openMaterialModal('${lesson.student_id}', '${file.file_id}')"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    </div>
                  `).join("")
                  : `
                    <div class="rounded-xl border border-dashed border-cream bg-parchment p-4">
                      <p class="text-sm font-medium text-warmblack">No materials linked to this lesson yet</p>
                      <p class="text-xs text-warmgray mt-1">Add a lesson material here or manage the full library from the student Materials tab.</p>
                    </div>
                  `
              }
            </div>
          </div>
        </div>

        <div class="space-y-5 min-w-0">
          <div class="bg-white rounded-2xl border border-cream overflow-hidden">
            <div class="flex flex-wrap border-b border-cream">
              <button
                id="lesson-detail-tab-btn-notes"
                type="button"
                onclick="switchLessonDetailTab('notes')"
                class="px-5 py-3.5 text-sm font-medium border-b-2 ${activeLessonDetailTab === "notes" ? "text-gold border-gold" : "text-warmgray border-transparent"}"
              >
                Notes
              </button>
              <button
                id="lesson-detail-tab-btn-homework"
                type="button"
                onclick="switchLessonDetailTab('homework')"
                class="px-5 py-3.5 text-sm font-medium border-b-2 ${activeLessonDetailTab === "homework" ? "text-gold border-gold" : "text-warmgray border-transparent"}"
              >
                Homework
              </button>
            </div>

            <div id="lesson-detail-tab-notes" class="p-5" style="display:${activeLessonDetailTab === "notes" ? "block" : "none"};">
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                <h4 class="font-display text-lg font-semibold text-warmblack">Lesson Notes</h4>
                <div class="flex flex-wrap items-center gap-3">
                  <button type="button" id="open-note-workspace-from-lesson-detail" class="text-xs font-medium text-warmblack hover:underline">Open Workspace</button>
                  <span class="text-xs text-warmgray">${note ? escapeHtml(getNoteStatusLabel(note.status)) : "No note yet"}</span>
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                  <p class="text-[11px] uppercase tracking-wider text-warmgray">Student Visibility</p>
                  <p class="text-sm font-semibold text-warmblack mt-1">${note && normalizeNoteStatus(note.status) === "PUBLISHED" ? "Visible to student portal later" : "Admin only"}</p>
                </div>
                <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                  <p class="text-[11px] uppercase tracking-wider text-warmgray">Last Activity</p>
                  <p class="text-sm font-semibold text-warmblack mt-1">${note ? escapeHtml(getNoteLastActivityLabel(note)) : "Not saved yet"}</p>
                </div>
                <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                  <p class="text-[11px] uppercase tracking-wider text-warmgray">Workflow Cue</p>
                  <p class="text-sm font-semibold text-warmblack mt-1">${note && normalizeNoteStatus(note.status) === "ARCHIVED" ? "Kept for history" : note && normalizeNoteStatus(note.status) === "PUBLISHED" ? "Student-ready version" : "Still in working draft"}</p>
                </div>
              </div>

              <div class="space-y-4">
                <div>
                  <label class="block text-xs font-medium text-warmgray mb-1">Note Title</label>
                  <input
                    id="lesson-detail-note-title"
                    type="text"
                    value="${escapeHtml(note?.title || lesson.topic || "Lesson Note")}"
                    class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"
                  />
                </div>

                <div>
                  <label class="block text-xs font-medium text-warmgray mb-1">Note Status</label>
                  <select id="lesson-detail-note-status" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
                    <option value="DRAFT" ${normalizeNoteStatus(note?.status) === "DRAFT" ? "selected" : ""}>Draft</option>
                    <option value="NO_NOTES" ${normalizeNoteStatus(note?.status) === "NO_NOTES" ? "selected" : ""}>No Notes</option>
                    <option value="PUBLISHED" ${normalizeNoteStatus(note?.status) === "PUBLISHED" ? "selected" : ""}>Published</option>
                    <option value="ARCHIVED" ${normalizeNoteStatus(note?.status) === "ARCHIVED" ? "selected" : ""}>Archived</option>
                  </select>
                </div>

                <div>
                  <label class="block text-xs font-medium text-warmgray mb-2">Note Body</label>

                  <div class="flex flex-wrap gap-2 mb-2">
                    <button type="button" onclick="execNoteCommand('bold')" class="px-3 py-1.5 rounded-lg bg-white border border-cream text-xs font-medium">Bold</button>
                    <button type="button" onclick="execNoteCommand('italic')" class="px-3 py-1.5 rounded-lg bg-white border border-cream text-xs font-medium">Italic</button>
                    <button type="button" onclick="execNoteCommand('underline')" class="px-3 py-1.5 rounded-lg bg-white border border-cream text-xs font-medium">Underline</button>
                    <button type="button" onclick="setNoteBulletList()" class="px-3 py-1.5 rounded-lg bg-white border border-cream text-xs font-medium">Bullets</button>
                  </div>

                  <div
                    id="lesson-detail-note-body"
                    contenteditable="true"
                    class="h-[260px] w-full overflow-y-auto rounded-xl border border-cream bg-parchment px-3 py-3 text-sm focus:outline-none"
                  >${note?.body || ""}</div>
                </div>

                <div class="rounded-xl bg-parchment border border-cream p-3">
                  <p class="text-xs font-medium uppercase tracking-wider text-warmgray mb-1">Internal Comments</p>
                  <p class="text-sm text-warmblack wrap-anywhere">${escapeHtml(lesson.internal_comments || "No internal comments saved yet.")}</p>
                </div>

                <div class="flex justify-end gap-3 pt-1">
                  <button type="button" id="save-lesson-note-btn" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">
                    Save Lesson Note
                  </button>
                </div>
              </div>
            </div>

            <div id="lesson-detail-tab-homework" class="p-5" style="display:${activeLessonDetailTab === "homework" ? "block" : "none"};">
              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h4 class="font-display text-lg font-semibold text-warmblack">Homework</h4>
              </div>

              <div class="space-y-4">
                <div class="rounded-xl border border-cream bg-parchment p-4">
                  <p class="text-xs font-medium uppercase tracking-wider text-warmgray mb-3">Homework Editor</p>

                  <div class="space-y-3">
                    <input
                      id="lesson-homework-title"
                      type="text"
                      placeholder="Homework title"
                      class="w-full rounded-xl border border-cream bg-white px-3 py-2.5 text-sm"
                    />

                    <textarea
                      id="lesson-homework-details"
                      rows="3"
                      placeholder="Homework details"
                      class="w-full rounded-xl border border-cream bg-white px-3 py-2.5 text-sm"
                    ></textarea>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        id="lesson-homework-due-date"
                        type="date"
                        class="w-full rounded-xl border border-cream bg-white px-3 py-2.5 text-sm"
                      />

                      <select id="lesson-homework-status" class="w-full rounded-xl border border-cream bg-white px-3 py-2.5 text-sm">
                        <option value="ASSIGNED">Assigned</option>
                        <option value="DONE">Done</option>
                      </select>
                    </div>

                    <div class="flex justify-end gap-2">
                      <button
                        type="button"
                        id="cancel-homework-edit-btn"
                        class="px-4 py-2.5 rounded-xl bg-white border border-cream text-warmgray text-sm font-medium"
                        style="display:none;"
                      >
                        Cancel
                      </button>

                      <button
                        type="button"
                        id="add-homework-btn"
                        class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold"
                      >
                        Save Homework
                      </button>
                    </div>
                  </div>
                </div>

                ${homeworkItems.length
                  ? homeworkItems.map((hw) => {
                      const hwMeta = getHomeworkStatusClasses(hw);

                      return `
                        <div class="p-4 rounded-xl border border-cream bg-white">
                          <div class="flex items-start gap-3">
                            <input
                              type="checkbox"
                              class="checkbox-custom mt-1"
                              ${hw.status === "DONE" ? "checked" : ""}
                              onchange="toggleHomeworkStatusFromDetail('${hw.homework_id}', this.checked, '${lessonId}')"
                            />
                            <div class="flex-1 min-w-0">
                              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <p class="text-sm font-semibold ${hw.status === "DONE" ? "line-through text-warmgray" : "text-warmblack"}">${escapeHtml(hw.title)}</p>
                                <span class="text-[11px] px-2 py-0.5 rounded-full ${hwMeta.badge}">
                                  ${hwMeta.label}
                                </span>
                              </div>

                              <p class="text-xs text-warmgray mt-1">${escapeHtml(hw.details || "No details")}</p>
                              <p class="text-xs text-warmgray mt-2">Due: ${escapeHtml(formatDueDate(hw.due_date))}</p>

                              <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
                                <button
                                  type="button"
                                  class="px-3 py-1.5 rounded-lg bg-white border border-cream text-xs font-medium text-warmblack"
                                  onclick="beginHomeworkEdit('${hw.homework_id}', '${lessonId}')"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  class="px-3 py-1.5 rounded-lg bg-white border border-cream text-xs font-medium text-burgundy"
                                  onclick="removeHomeworkFromLessonDetail('${hw.homework_id}', '${lessonId}')"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      `;
                    }).join("")
                  : `<div class="p-4 rounded-xl border border-cream bg-parchment text-sm text-warmgray">No homework attached to this lesson yet.</div>`
                }
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const editor = document.getElementById("lesson-detail-note-body");
  if (editor) {
    editor.scrollTop = 0;
  }

  const closeBtn = document.getElementById("close-lesson-detail-modal");
  const editBtn = document.getElementById("detail-edit-lesson-btn");
  const statusBtn = document.getElementById("detail-status-lesson-btn");
  const saveNoteBtn = document.getElementById("save-lesson-note-btn");
  const openWorkspaceBtn = document.getElementById("open-note-workspace-from-lesson-detail");
  const addHomeworkBtn = document.getElementById("add-homework-btn");
  const cancelHomeworkEditBtn = document.getElementById("cancel-homework-edit-btn");

  if (closeBtn) closeBtn.onclick = closeLessonDetailModal;

  if (editBtn) {
    editBtn.onclick = () => {
      closeLessonDetailModal();
      openLessonModal("edit", lessonId);
    };
  }

  if (statusBtn) {
    statusBtn.onclick = () => quickChangeLessonStatus(lessonId);
  }

  if (openWorkspaceBtn) {
    openWorkspaceBtn.onclick = () => {
      closeLessonDetailModal();
      openNoteWorkspace(lesson.student_id, lessonId);
    };
  }

  if (addHomeworkBtn) {
    addHomeworkBtn.onclick = () => saveHomeworkFromLessonDetail(lessonId, lesson.student_id);
  }

  if (cancelHomeworkEditBtn) {
    cancelHomeworkEditBtn.onclick = () => resetLessonHomeworkForm();
  }

  if (saveNoteBtn) {
    saveNoteBtn.onclick = () => {
      const titleEl = document.getElementById("lesson-detail-note-title");
      const statusEl = document.getElementById("lesson-detail-note-status");
      const bodyEl = document.getElementById("lesson-detail-note-body");

      const result = upsertLessonNote({
        lesson_id: lessonId,
        title: titleEl ? titleEl.value : "",
        status: statusEl ? statusEl.value : "DRAFT",
        body: bodyEl ? normalizeEditorHtml(bodyEl.innerHTML) : ""
      });

      if (!result || result.ok === false) {
        const errors = result?.errors || ["Unable to save lesson note."];
        notifyUser({
          title: "Lesson Note",
          message: errors.join(" "),
          tone: "error",
          source: "notes"
        });
        return;
      }

      refreshProfileNotesIfNeeded(lesson.student_id);

      if (selectedStudentId) {
        renderProfileHomeworkTab(selectedStudentId);
      }

      openLessonDetailModal(lessonId);
      notifyUser({
        title: normalizeNoteStatus(statusEl ? statusEl.value : "DRAFT") === "NO_NOTES" ? "No Notes Saved" : "Lesson Note Saved",
        message: normalizeNoteStatus(statusEl ? statusEl.value : "DRAFT") === "NO_NOTES"
          ? "This lesson is marked as not needing a follow-up note."
          : "The lesson note was saved successfully.",
        tone: "success",
        source: "notes"
      });
    };
  }

  resetLessonHomeworkForm();

  lucide.createIcons();
}

