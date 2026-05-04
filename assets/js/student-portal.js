/*********************************
 * STUDENT PORTAL AUTH / SCOPE
 *********************************/
const STUDENT_PORTAL_SESSION_KEY = "studioPortal.studentSession.v1";
const STUDENT_PORTAL_SETTINGS_KEY = "studioPortal.studentPortalSettings.v1";
const DEFAULT_STUDENT_PORTAL_SETTINGS = {
  enabled: true,
  shared_access_code: "STAGE",
  session_timeout_minutes: 120,
  show_finance: true,
  show_materials: true,
  show_published_notes: true,
  show_homework: true
};

let studentPortalMessage = "";
let studentPortalMessageTone = "warm";

function normalizePortalEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function splitPortalList(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function loadStudentPortalSettings() {
  try {
    const raw = localStorage.getItem(STUDENT_PORTAL_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_STUDENT_PORTAL_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STUDENT_PORTAL_SETTINGS,
      ...parsed,
      enabled: parsed.enabled !== false,
      shared_access_code: String(parsed.shared_access_code || DEFAULT_STUDENT_PORTAL_SETTINGS.shared_access_code).trim(),
      session_timeout_minutes: Math.max(15, Number(parsed.session_timeout_minutes || DEFAULT_STUDENT_PORTAL_SETTINGS.session_timeout_minutes)),
      show_finance: parsed.show_finance !== false,
      show_materials: parsed.show_materials !== false,
      show_published_notes: parsed.show_published_notes !== false,
      show_homework: parsed.show_homework !== false
    };
  } catch (error) {
    return { ...DEFAULT_STUDENT_PORTAL_SETTINGS };
  }
}

function saveStudentPortalSettings(settings) {
  const next = {
    ...DEFAULT_STUDENT_PORTAL_SETTINGS,
    ...settings
  };

  try {
    localStorage.setItem(STUDENT_PORTAL_SETTINGS_KEY, JSON.stringify(next));
  } catch (error) {
    // Keep in-memory behavior working even if browser storage is unavailable.
  }

  return next;
}

function saveStudentPortalSettingsFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  saveStudentPortalSettings({
    enabled: form.elements.enabled.checked,
    shared_access_code: String(form.elements.shared_access_code.value || "").trim(),
    session_timeout_minutes: Number(form.elements.session_timeout_minutes.value || DEFAULT_STUDENT_PORTAL_SETTINGS.session_timeout_minutes),
    show_finance: form.elements.show_finance.checked,
    show_materials: form.elements.show_materials.checked,
    show_published_notes: form.elements.show_published_notes.checked,
    show_homework: form.elements.show_homework.checked
  });

  setSettingsActionFeedback("Student portal access settings saved.", "success");
  renderSettingsPage();
}

function getStudentPortalSettings() {
  return loadStudentPortalSettings();
}

function getStudentContactEmails(student) {
  const emails = [
    student?.email,
    student?.guardian_email,
    student?.preferred_contact_email,
    ...splitPortalList(student?.additional_emails)
  ];

  return Array.from(new Set(emails.map(normalizePortalEmail).filter(Boolean)));
}

function getStudentPortalIdentityForEmail(email) {
  const normalizedEmail = normalizePortalEmail(email);
  if (!normalizedEmail) return null;

  const student = getStudentRecords().find((record) => getStudentContactEmails(record).includes(normalizedEmail));
  if (!student) return null;

  const directEmails = [
    student.email,
    ...splitPortalList(student.additional_emails)
  ].map(normalizePortalEmail);

  const guardianEmails = [
    student.guardian_email,
    student.preferred_contact_email
  ].map(normalizePortalEmail);

  const role = directEmails.includes(normalizedEmail)
    ? "STUDENT"
    : guardianEmails.includes(normalizedEmail)
      ? "GUARDIAN"
      : "CONTACT";

  return {
    email: normalizedEmail,
    role,
    student_id: student.student_id,
    student_name: student.full_name || [student.first_name, student.last_name].filter(Boolean).join(" "),
    signed_in_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString()
  };
}

function readStudentPortalSession() {
  try {
    const raw = sessionStorage.getItem(STUDENT_PORTAL_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.student_id || !parsed.email) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function writeStudentPortalSession(session) {
  try {
    sessionStorage.setItem(STUDENT_PORTAL_SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    // Session storage is a convenience for the local preview.
  }
}

function clearStudentPortalSession() {
  try {
    sessionStorage.removeItem(STUDENT_PORTAL_SESSION_KEY);
  } catch (error) {
    // Ignore storage cleanup issues.
  }
}

function getStudentPortalSessionExpired(session) {
  const settings = getStudentPortalSettings();
  const lastActivity = new Date(session?.last_activity_at || session?.signed_in_at || 0);
  if (Number.isNaN(lastActivity.getTime())) return true;
  const expiresAt = lastActivity.getTime() + Number(settings.session_timeout_minutes || 120) * 60 * 1000;
  return Date.now() > expiresAt;
}

function getCurrentStudentPortalIdentity() {
  const session = readStudentPortalSession();
  if (!session) return null;

  if (getStudentPortalSessionExpired(session)) {
    clearStudentPortalSession();
    setStudentPortalMessage("Your student portal session timed out. Sign in again.", "warm");
    return null;
  }

  const student = getSchemaStudentById(session.student_id);
  if (!student || !getStudentContactEmails(student).includes(normalizePortalEmail(session.email))) {
    clearStudentPortalSession();
    setStudentPortalMessage("That portal access no longer matches an active student contact.", "error");
    return null;
  }

  const nextSession = {
    ...session,
    last_activity_at: new Date().toISOString()
  };
  writeStudentPortalSession(nextSession);
  return nextSession;
}

function hasStudentPortalSession() {
  return Boolean(getCurrentStudentPortalIdentity());
}

function setStudentPortalMessage(message, tone = "warm") {
  studentPortalMessage = String(message || "").trim();
  studentPortalMessageTone = tone || "warm";
}

function getStudentPortalMessageMarkup() {
  if (!studentPortalMessage) return "";
  const toneClass =
    studentPortalMessageTone === "success"
      ? "border-sage/20 bg-sage/5 text-sage"
      : studentPortalMessageTone === "error"
        ? "border-burgundy/20 bg-burgundy/5 text-burgundy"
        : "border-gold/20 bg-gold/5 text-warmblack";

  return `<div class="rounded-xl border ${toneClass} px-4 py-3"><p class="text-sm">${escapeHtml(studentPortalMessage)}</p></div>`;
}

function submitStudentPortalLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const settings = getStudentPortalSettings();
  const email = normalizePortalEmail(form.elements.email.value);
  const accessCode = String(form.elements.access_code.value || "").trim();

  if (!settings.enabled) {
    setStudentPortalMessage("Student portal access is currently disabled.", "error");
    renderStudentPortalPage();
    return;
  }

  if (!email) {
    setStudentPortalMessage("Enter the student or guardian email on file.", "error");
    renderStudentPortalPage();
    return;
  }

  if (settings.shared_access_code && accessCode !== settings.shared_access_code) {
    setStudentPortalMessage("That access code did not match.", "error");
    renderStudentPortalPage();
    return;
  }

  const identity = getStudentPortalIdentityForEmail(email);
  if (!identity) {
    setStudentPortalMessage("No student or guardian contact matched that email.", "error");
    renderStudentPortalPage();
    return;
  }

  writeStudentPortalSession(identity);
  setStudentPortalMessage(`Signed in for ${identity.student_name}.`, "success");
  renderStudentPortalPage();
}

function signOutStudentPortal() {
  clearStudentPortalSession();
  setStudentPortalMessage("Signed out of the student portal preview.", "warm");
  renderStudentPortalPage();
}

function studentPortalCanAccessStudent(identity, studentId) {
  return Boolean(identity && studentId && identity.student_id === studentId);
}

function studentPortalCanViewRecord(identity, record, options = {}) {
  if (!identity || !record) return false;
  if (record.student_id && record.student_id !== identity.student_id) return false;

  if (options.kind === "note") {
    return normalizeNoteStatus(record.status) === "PUBLISHED";
  }

  if (options.kind === "material") {
    return normalizeMaterialVisibility(record.visibility) === "STUDENT_VISIBLE";
  }

  if (options.kind === "payment") {
    return !isPaymentArchived(record) && normalizePaymentReviewStateValue(record.review_state, record) !== "NEEDS_REVIEW";
  }

  if (options.kind === "package") {
    return !isPackageArchived(record);
  }

  return true;
}

function getStudentPortalScopedData(identity = getCurrentStudentPortalIdentity()) {
  if (!identity) {
    return {
      student: null,
      lessons: [],
      notes: [],
      homework: [],
      packages: [],
      payments: [],
      materials: []
    };
  }

  const settings = getStudentPortalSettings();
  const studentId = identity.student_id;
  return {
    student: getSchemaStudentById(studentId),
    lessons: getLessonRecords()
      .filter((lesson) => studentPortalCanViewRecord(identity, lesson, { kind: "lesson" }))
      .sort((a, b) => new Date(a.scheduled_start || 0).getTime() - new Date(b.scheduled_start || 0).getTime()),
    notes: settings.show_published_notes
      ? getNoteRecords()
        .filter((note) => studentPortalCanViewRecord(identity, note, { kind: "note" }))
        .sort((a, b) => new Date(b.published_at || b.updated_at || 0).getTime() - new Date(a.published_at || a.updated_at || 0).getTime())
      : [],
    homework: settings.show_homework
      ? getHomeworkRecords()
        .filter((item) => studentPortalCanViewRecord(identity, item, { kind: "homework" }))
        .sort((a, b) => new Date(a.due_date || a.assigned_at || 0).getTime() - new Date(b.due_date || b.assigned_at || 0).getTime())
      : [],
    packages: settings.show_finance
      ? getPackageRecords().filter((pkg) => studentPortalCanViewRecord(identity, pkg, { kind: "package" }))
      : [],
    payments: settings.show_finance
      ? getPaymentRecords()
        .filter((payment) => studentPortalCanViewRecord(identity, payment, { kind: "payment" }))
        .sort((a, b) => new Date(b.payment_date || b.created_at || 0).getTime() - new Date(a.payment_date || a.created_at || 0).getTime())
      : [],
    materials: settings.show_materials
      ? getFileRecords()
        .filter((file) => studentPortalCanViewRecord(identity, file, { kind: "material" }))
        .sort((a, b) => new Date(b.uploaded_at || 0).getTime() - new Date(a.uploaded_at || 0).getTime())
      : []
  };
}

function getStudentPortalPermissionSummary() {
  const settings = getStudentPortalSettings();
  return {
    enabled: settings.enabled,
    auth: "local_preview_shared_code",
    student_scope: "own_student_record",
    guardian_scope: "matched_guardian_contact",
    visible_record_rules: [
      "own lessons",
      "published notes",
      "assigned homework",
      "student-visible materials",
      "non-review finance records"
    ]
  };
}

function getStudentPortalSecurityStatusLabel() {
  const settings = getStudentPortalSettings();
  if (!settings.enabled) return "Disabled";
  return settings.shared_access_code ? "Preview Code" : "Email Match";
}

function getStudentPortalSettingsPanelMarkup() {
  const settings = getStudentPortalSettings();
  return `
    <form id="settings-student-portal-form" class="rounded-2xl border border-cream bg-white p-4 sm:p-5 fade-in" onsubmit="saveStudentPortalSettingsFromForm(event)">
      <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Student Portal Access</p>
          <h3 class="font-display text-xl font-semibold text-warmblack mt-1">Preview auth and visibility rules</h3>
          <p class="text-sm text-warmgray mt-1">These controls govern the local preview route. Server-side auth should replace the shared code before production use.</p>
        </div>
        <span class="inline-flex self-start px-2 py-1 rounded-full bg-gold/10 text-gold text-[11px] font-medium">${escapeHtml(getStudentPortalSecurityStatusLabel())}</span>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
        <label class="rounded-xl border border-cream bg-parchment px-4 py-3 flex items-start gap-3 xl:col-span-2">
          <input type="checkbox" name="enabled" class="mt-1" ${settings.enabled ? "checked" : ""}>
          <span class="min-w-0">
            <span class="block text-sm font-medium text-warmblack">Enable student portal preview</span>
            <span class="block text-xs text-warmgray mt-1">Matched student and guardian emails can sign into the scoped portal route.</span>
          </span>
        </label>
        <label class="block">
          <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Shared Preview Code</span>
          <input name="shared_access_code" type="text" value="${escapeHtml(settings.shared_access_code)}" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" />
        </label>
        <label class="block">
          <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Session Timeout</span>
          <select name="session_timeout_minutes" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
            <option value="30" ${Number(settings.session_timeout_minutes) === 30 ? "selected" : ""}>30 minutes</option>
            <option value="60" ${Number(settings.session_timeout_minutes) === 60 ? "selected" : ""}>60 minutes</option>
            <option value="120" ${Number(settings.session_timeout_minutes) === 120 ? "selected" : ""}>2 hours</option>
            <option value="240" ${Number(settings.session_timeout_minutes) === 240 ? "selected" : ""}>4 hours</option>
          </select>
        </label>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <label class="rounded-xl border border-cream bg-parchment px-4 py-3 flex items-start gap-3">
          <input type="checkbox" name="show_published_notes" class="mt-1" ${settings.show_published_notes ? "checked" : ""}>
          <span class="text-sm text-warmblack">Show published notes</span>
        </label>
        <label class="rounded-xl border border-cream bg-parchment px-4 py-3 flex items-start gap-3">
          <input type="checkbox" name="show_homework" class="mt-1" ${settings.show_homework ? "checked" : ""}>
          <span class="text-sm text-warmblack">Show homework</span>
        </label>
        <label class="rounded-xl border border-cream bg-parchment px-4 py-3 flex items-start gap-3">
          <input type="checkbox" name="show_materials" class="mt-1" ${settings.show_materials ? "checked" : ""}>
          <span class="text-sm text-warmblack">Show student-visible materials</span>
        </label>
        <label class="rounded-xl border border-cream bg-parchment px-4 py-3 flex items-start gap-3">
          <input type="checkbox" name="show_finance" class="mt-1" ${settings.show_finance ? "checked" : ""}>
          <span class="text-sm text-warmblack">Show package and payment summary</span>
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-2 mt-5">
        <button type="submit" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold card-hover">Save Student Portal</button>
        <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="navigateTo('student_portal')">Open Student Portal</button>
      </div>
    </form>
  `;
}

function renderStudentPortalLogin() {
  const settings = getStudentPortalSettings();
  const demoStudent = getStudentRecords().find((student) => student.email) || null;
  const placeholderEmail = demoStudent?.email || "student@example.com";

  return `
    <div class="max-w-xl mx-auto px-4 sm:px-6 xl:px-8 py-10">
      <div class="rounded-2xl border border-cream bg-white p-5 sm:p-6 shadow-sm">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-lg gold-gradient flex items-center justify-center shrink-0">
            <i data-lucide="key-round" class="w-5 h-5 text-warmblack"></i>
          </div>
          <div class="min-w-0">
            <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Student Portal</p>
            <h2 class="font-display text-2xl font-bold text-warmblack mt-1">Student or Guardian Sign In</h2>
            <p class="text-sm text-warmgray mt-2">Matched contacts only see their own lessons, published notes, homework, visible materials, and approved finance records.</p>
          </div>
        </div>

        <div class="mt-5">${getStudentPortalMessageMarkup()}</div>

        <form class="space-y-4 mt-5" onsubmit="submitStudentPortalLogin(event)">
          <label class="block">
            <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Email On File</span>
            <input name="email" type="email" autocomplete="email" placeholder="${escapeHtml(placeholderEmail)}" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" />
          </label>
          <label class="block">
            <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Access Code</span>
            <input name="access_code" type="password" autocomplete="current-password" placeholder="Shared preview code" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" />
          </label>
          <div class="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3 text-xs text-warmgray">
            Preview code: <span class="font-semibold text-warmblack">${escapeHtml(settings.shared_access_code || "not set")}</span>
          </div>
          <button type="submit" class="w-full px-4 py-3 rounded-xl gold-gradient text-warmblack text-sm font-semibold">Sign In</button>
        </form>
      </div>
    </div>
  `;
}

function renderStudentPortalLessonCard(lesson) {
  const start = lesson.scheduled_start ? new Date(lesson.scheduled_start) : null;
  const when = start && !Number.isNaN(start.getTime())
    ? `${formatLongDate(lesson.scheduled_start)} - ${formatLessonTime(lesson.scheduled_start)}`
    : "Date not set";
  const location = lesson.location_type === "IN_PERSON"
    ? (lesson.location_address || "In person")
    : (lesson.join_link ? "Virtual link available" : "Virtual");

  return `
    <div class="rounded-xl border border-cream bg-white px-4 py-3">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-warmblack">${escapeHtml(lesson.topic || lesson.lesson_type || "Lesson")}</p>
          <p class="text-xs text-warmgray mt-1">${escapeHtml(when)}</p>
          <p class="text-xs text-warmgray mt-1">${escapeHtml(location)}</p>
        </div>
        <span class="inline-flex self-start px-2 py-1 rounded-full bg-parchment border border-cream text-[11px] font-medium text-warmgray">${escapeHtml(getLessonStatusLabel(lesson.lesson_status))}</span>
      </div>
    </div>
  `;
}

function renderStudentPortalPage() {
  const root = document.getElementById("page-root");
  if (!root) return;

  const identity = getCurrentStudentPortalIdentity();
  if (!identity) {
    root.innerHTML = renderStudentPortalLogin();
    lucide.createIcons();
    return;
  }

  const scoped = getStudentPortalScopedData(identity);
  const nextLessons = scoped.lessons.filter((lesson) => {
    const start = new Date(lesson.scheduled_start || 0);
    return !Number.isNaN(start.getTime()) && start.getTime() >= getReferenceNow().getTime() && normalizeLessonStatusValue(lesson.lesson_status) === "SCHEDULED";
  }).slice(0, 4);
  const recentLessons = scoped.lessons.filter((lesson) => normalizeLessonStatusValue(lesson.lesson_status) !== "SCHEDULED").slice(-4).reverse();
  const activePackage = scoped.packages.find((pkg) => !isPackageArchived(pkg)) || scoped.packages[0] || null;
  const balance = scoped.payments.reduce((sum, payment) => {
    const amount = Number(payment.amount || 0);
    return String(payment.status || "").toLowerCase() === "paid" ? sum - amount : sum;
  }, Number(scoped.student?.custom_balance_due || 0));

  root.innerHTML = `
    <div class="p-4 sm:p-6 xl:p-8 w-full">
      <div class="max-w-7xl mx-auto space-y-5">
        <section class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
          <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
            <div class="min-w-0">
              <p class="text-xs uppercase tracking-wider text-warmgray font-medium">${escapeHtml(identity.role === "GUARDIAN" ? "Guardian Access" : "Student Access")}</p>
              <h2 class="font-display text-3xl font-bold text-warmblack mt-1">${escapeHtml(scoped.student?.full_name || identity.student_name || "Student Portal")}</h2>
              <p class="text-sm text-warmgray mt-2">Signed in as ${escapeHtml(identity.email)}. Records are scoped to this student profile.</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="signOutStudentPortal()">Sign Out</button>
            </div>
          </div>
          ${studentPortalMessage ? `<div class="mt-4">${getStudentPortalMessageMarkup()}</div>` : ""}
        </section>

        <section class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div class="rounded-xl border border-cream bg-white px-4 py-3">
            <p class="text-[11px] uppercase tracking-wider text-warmgray">Upcoming</p>
            <p class="text-2xl font-semibold text-warmblack mt-1">${nextLessons.length}</p>
          </div>
          <div class="rounded-xl border border-cream bg-white px-4 py-3">
            <p class="text-[11px] uppercase tracking-wider text-warmgray">Homework</p>
            <p class="text-2xl font-semibold text-warmblack mt-1">${scoped.homework.filter((item) => String(item.status || "").toUpperCase() !== "COMPLETED").length}</p>
          </div>
          <div class="rounded-xl border border-cream bg-white px-4 py-3">
            <p class="text-[11px] uppercase tracking-wider text-warmgray">Package</p>
            <p class="text-2xl font-semibold text-warmblack mt-1">${activePackage ? Number(activePackage.sessions_remaining || 0) : 0}</p>
            <p class="text-xs text-warmgray">sessions left</p>
          </div>
          <div class="rounded-xl border border-cream bg-white px-4 py-3">
            <p class="text-[11px] uppercase tracking-wider text-warmgray">Balance</p>
            <p class="text-2xl font-semibold text-warmblack mt-1">${formatCurrency(Math.max(0, balance))}</p>
          </div>
        </section>

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <section class="xl:col-span-2 space-y-4">
            <div class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
              <h3 class="font-display text-xl font-semibold text-warmblack">Upcoming Lessons</h3>
              <div class="space-y-3 mt-4">
                ${nextLessons.length ? nextLessons.map(renderStudentPortalLessonCard).join("") : `<div class="page-empty-state py-8"><p class="text-sm text-warmgray">No upcoming lessons are visible yet.</p></div>`}
              </div>
            </div>

            <div class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
              <h3 class="font-display text-xl font-semibold text-warmblack">Published Notes</h3>
              <div class="space-y-3 mt-4">
                ${scoped.notes.length ? scoped.notes.slice(0, 4).map((note) => `
                  <article class="rounded-xl border border-cream bg-parchment px-4 py-3">
                    <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <h4 class="text-sm font-semibold text-warmblack">${escapeHtml(note.title || "Lesson Note")}</h4>
                      <span class="text-xs text-warmgray">${escapeHtml(formatLongDate(note.published_at || note.updated_at || note.created_at))}</span>
                    </div>
                    <p class="text-sm text-warmgray mt-2 whitespace-pre-line">${escapeHtml(note.body || "No note body.")}</p>
                  </article>
                `).join("") : `<div class="page-empty-state py-8"><p class="text-sm text-warmgray">No published notes are visible yet.</p></div>`}
              </div>
            </div>
          </section>

          <aside class="space-y-4">
            <section class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
              <h3 class="font-display text-xl font-semibold text-warmblack">Homework</h3>
              <div class="space-y-3 mt-4">
                ${scoped.homework.length ? scoped.homework.slice(0, 5).map((item) => `
                  <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                    <p class="text-sm font-semibold text-warmblack">${escapeHtml(item.title || "Homework")}</p>
                    <p class="text-xs text-warmgray mt-1">${item.due_date ? `Due ${escapeHtml(formatLongDate(item.due_date))}` : "No due date"}</p>
                    <p class="text-xs text-warmgray mt-2">${escapeHtml(item.details || "")}</p>
                  </div>
                `).join("") : `<p class="text-sm text-warmgray">No homework is assigned.</p>`}
              </div>
            </section>

            <section class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
              <h3 class="font-display text-xl font-semibold text-warmblack">Materials</h3>
              <div class="space-y-3 mt-4">
                ${scoped.materials.length ? scoped.materials.slice(0, 5).map((file) => `
                  <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                    <p class="text-sm font-semibold text-warmblack">${escapeHtml(file.title || file.file_name || "Material")}</p>
                    <p class="text-xs text-warmgray mt-1">${escapeHtml(file.category || file.material_kind || "Resource")}</p>
                    ${file.external_url || file.file_url ? `<a class="inline-flex items-center gap-1 text-xs text-gold font-medium mt-2" href="${escapeHtml(file.external_url || file.file_url)}" target="_blank" rel="noopener">Open <i data-lucide="external-link" class="w-3 h-3"></i></a>` : ""}
                  </div>
                `).join("") : `<p class="text-sm text-warmgray">No student-visible materials yet.</p>`}
              </div>
            </section>

            <section class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
              <h3 class="font-display text-xl font-semibold text-warmblack">Recent Lessons</h3>
              <div class="space-y-3 mt-4">
                ${recentLessons.length ? recentLessons.map(renderStudentPortalLessonCard).join("") : `<p class="text-sm text-warmgray">No recent lessons yet.</p>`}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  `;

  lucide.createIcons();
}
