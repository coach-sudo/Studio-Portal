/*********************************
 * STUDENT PORTAL AUTH / SCOPE
 *********************************/
let studentPortalMessage = "";
let studentPortalMessageTone = "warm";
let studentPortalRequestId = 0;
let studentPortalState = {
  identity: null,
  data: null,
  activeTab: "overview"
};

function normalizePortalEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getStudentPortalAuthEndpoint(action = "") {
  const base = "/api/student-auth";
  return action ? `${base}?action=${encodeURIComponent(action)}` : base;
}

async function requestStudentPortalAuth(action, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };
  const requestOptions = {
    method,
    headers,
    credentials: "include"
  };

  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify({
      action,
      ...(options.body || {})
    });
  }

  const response = await fetch(
    method === "GET" ? getStudentPortalAuthEndpoint(action) : getStudentPortalAuthEndpoint(),
    requestOptions
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || "Student portal auth request failed.");
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function loadStudentPortalServerData() {
  try {
    return await requestStudentPortalAuth("portal_data");
  } catch (error) {
    if (Number(error.status) === 401) return null;
    throw error;
  }
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

async function submitStudentPortalLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const email = normalizePortalEmail(form.elements.email.value);
  const accessCode = String(form.elements.access_code.value || "").trim();

  if (!email) {
    setStudentPortalMessage("Enter the student or guardian email on file.", "error");
    renderStudentPortalPage();
    return;
  }

  const button = form.querySelector("button[type='submit']");
  if (button) {
    button.disabled = true;
    button.textContent = "Signing in...";
  }

  try {
    const payload = await requestStudentPortalAuth("login", {
      method: "POST",
      body: {
        email,
        access_code: accessCode
      }
    });
    setStudentPortalMessage(`Signed in for ${payload.identity?.student_name || email}.`, "success");
    renderStudentPortalPage();
  } catch (error) {
    setStudentPortalMessage(String(error && error.message ? error.message : error || "Unable to sign in."), "error");
    renderStudentPortalPage();
  }
}

async function signOutStudentPortal() {
  try {
    await requestStudentPortalAuth("logout", { method: "POST" });
  } catch (error) {
    // The UI should still return to the sign-in state if the cookie is already gone.
  }

  studentPortalState = { identity: null, data: null, activeTab: "overview" };
  setStudentPortalMessage("Signed out of the student portal.", "warm");
  renderStudentPortalPage();
}

async function submitStudentPortalMutation(action, body = {}, successMessage = "Saved.") {
  try {
    const payload = await requestStudentPortalAuth(action, {
      method: "POST",
      body
    });
    studentPortalState.data = payload.data || studentPortalState.data;
    setStudentPortalMessage(successMessage, "success");
    renderStudentPortalDashboard(studentPortalState.identity, studentPortalState.data);
  } catch (error) {
    setStudentPortalMessage(String(error && error.message ? error.message : error || "Unable to save."), "error");
    renderStudentPortalDashboard(studentPortalState.identity, studentPortalState.data);
  }
}

function getStudentPortalPermissionSummary() {
  return {
    enabled: true,
    auth: "server_signed_cookie",
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
  return "Server Cookie";
}

function getStudentPortalSettingsPanelMarkup() {
  return `
    <section class="rounded-2xl border border-cream bg-white p-4 sm:p-5 fade-in">
      <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Student Portal Access</p>
          <h3 class="font-display text-xl font-semibold text-warmblack mt-1">Server-backed auth is active</h3>
          <p class="text-sm text-warmgray mt-1">Student and guardian sessions are issued by Netlify Functions as signed HttpOnly cookies. Configure secrets in Netlify environment variables.</p>
        </div>
        <span class="inline-flex self-start px-2 py-1 rounded-full bg-gold/10 text-gold text-[11px] font-medium">${escapeHtml(getStudentPortalSecurityStatusLabel())}</span>
      </div>
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-4">
        <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Required Secret</p>
          <p class="text-sm font-semibold text-warmblack mt-1">STUDENT_PORTAL_SESSION_SECRET</p>
        </div>
        <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Access Code</p>
          <p class="text-sm font-semibold text-warmblack mt-1">STUDENT_PORTAL_ACCESS_CODE</p>
        </div>
        <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Timeout</p>
          <p class="text-sm font-semibold text-warmblack mt-1">STUDENT_PORTAL_SESSION_MINUTES</p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2 mt-5">
        <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="navigateTo('student_portal')">Open Student Portal</button>
      </div>
    </section>
  `;
}

function parseStudentPortalJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function getStudentPortalScriptMeta(script) {
  return parseStudentPortalJson(script?.notes, { script_text: "", comments: [] });
}

function getStudentPortalTabs(permissions = {}) {
  return [
    { key: "overview", label: "Overview", icon: "layout-dashboard", enabled: true },
    { key: "lessons", label: "Lessons", icon: "calendar-days", enabled: true },
    { key: "script", label: "Current Script", icon: "file-search", enabled: permissions.script !== false },
    { key: "assignments", label: "Assignments", icon: "list-checks", enabled: permissions.homework !== false || permissions.notes !== false },
    { key: "materials", label: "Materials & Public", icon: "folder-open", enabled: permissions.materials !== false || permissions.publicPage !== false },
    { key: "finance", label: "Packages", icon: "wallet", enabled: permissions.finance === true }
  ].filter((tab) => tab.enabled);
}

function setStudentPortalTab(tab) {
  studentPortalState.activeTab = tab || "overview";
  renderStudentPortalDashboard(studentPortalState.identity, studentPortalState.data);
}

function renderStudentPortalLogin() {
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
            <input name="access_code" type="password" autocomplete="current-password" placeholder="Student portal access code" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" />
          </label>
          <button type="submit" class="w-full px-4 py-3 rounded-xl gold-gradient text-warmblack text-sm font-semibold">Sign In</button>
        </form>
      </div>
    </div>
  `;
}

function formatStudentPortalLessonWhen(lesson) {
  const start = lesson.scheduled_start ? new Date(lesson.scheduled_start) : null;
  return start && !Number.isNaN(start.getTime())
    ? `${formatLongDate(lesson.scheduled_start)} - ${formatLessonTime(lesson.scheduled_start)}`
    : "Date not set";
}

function renderStudentPortalLessonCard(lesson) {
  const location = lesson.location_type === "IN_PERSON"
    ? (lesson.location_address || "In person")
    : (lesson.join_link ? "Virtual link available" : "Virtual");
  return `
    <button type="button" onclick="openStudentPortalLessonModal('${escapeHtml(lesson.lesson_id)}')" class="w-full text-left rounded-xl border border-cream bg-white px-4 py-3 card-hover">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-warmblack">${escapeHtml(lesson.topic || lesson.lesson_type || "Lesson")}</p>
          <p class="text-xs text-warmgray mt-1">${escapeHtml(formatStudentPortalLessonWhen(lesson))}</p>
          <p class="text-xs text-warmgray mt-1">${escapeHtml(location)}</p>
        </div>
        <span class="inline-flex self-start px-2 py-1 rounded-full bg-parchment border border-cream text-[11px] font-medium text-warmgray">${escapeHtml(getLessonStatusLabel(lesson.lesson_status))}</span>
      </div>
    </button>
  `;
}

function renderStudentPortalPage() {
  const root = document.getElementById("page-root");
  if (!root) return;

  const requestId = ++studentPortalRequestId;
  root.innerHTML = `
    <div class="p-4 sm:p-6 xl:p-8 w-full">
      <div class="max-w-xl mx-auto rounded-2xl border border-cream bg-white p-5 sm:p-6">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg gold-gradient flex items-center justify-center">
            <i data-lucide="loader-circle" class="w-5 h-5 text-warmblack"></i>
          </div>
          <div>
            <p class="text-sm font-semibold text-warmblack">Checking student portal session</p>
            <p class="text-xs text-warmgray mt-1">Asking the server for the signed identity and scoped records.</p>
          </div>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();

  loadStudentPortalServerData()
    .then((payload) => {
      if (requestId !== studentPortalRequestId) return;
      if (!payload || !payload.identity) {
        studentPortalState = { identity: null, data: null, activeTab: "overview" };
        root.innerHTML = renderStudentPortalLogin();
        lucide.createIcons();
        return;
      }

      studentPortalState.identity = payload.identity;
      studentPortalState.data = payload.data || {};
      renderStudentPortalDashboard(payload.identity, payload.data || {});
    })
    .catch((error) => {
      if (requestId !== studentPortalRequestId) return;
      setStudentPortalMessage(String(error && error.message ? error.message : error || "Unable to load the student portal."), "error");
      root.innerHTML = renderStudentPortalLogin();
      lucide.createIcons();
    });
}

function renderStudentPortalDashboard(identity, scoped) {
  const root = document.getElementById("page-root");
  if (!root) return;

  scoped = {
    permissions: {},
    student: null,
    publicProfile: null,
    currentScript: null,
    lessons: [],
    notes: [],
    homework: [],
    packages: [],
    payments: [],
    materials: [],
    ...(scoped || {})
  };

  studentPortalState.identity = identity;
  studentPortalState.data = scoped;

  const tabs = getStudentPortalTabs(scoped.permissions || {});
  if (!tabs.some((tab) => tab.key === studentPortalState.activeTab)) {
    studentPortalState.activeTab = "overview";
  }

  const nextLessons = scoped.lessons.filter((lesson) => {
    const start = new Date(lesson.scheduled_start || 0);
    return !Number.isNaN(start.getTime()) && start.getTime() >= getReferenceNow().getTime() && normalizeLessonStatusValue(lesson.lesson_status) === "SCHEDULED";
  }).slice(0, 4);
  const recentLessons = scoped.lessons.filter((lesson) => normalizeLessonStatusValue(lesson.lesson_status) !== "SCHEDULED").slice(-5).reverse();
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
              <p class="text-sm text-warmgray mt-2">Signed in as ${escapeHtml(identity.email)}.</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover" onclick="signOutStudentPortal()">Sign Out</button>
            </div>
          </div>
          ${studentPortalMessage ? `<div class="mt-4">${getStudentPortalMessageMarkup()}</div>` : ""}
        </section>

        <nav class="student-portal-tabbar rounded-2xl border border-cream bg-white p-2 flex flex-wrap gap-2">
          ${tabs.map((tab) => `
            <button type="button" onclick="setStudentPortalTab('${tab.key}')" class="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium ${studentPortalState.activeTab === tab.key ? "gold-gradient text-warmblack" : "bg-parchment text-warmgray"}">
              <i data-lucide="${tab.icon}" class="w-4 h-4"></i>
              ${escapeHtml(tab.label)}
            </button>
          `).join("")}
        </nav>

        ${renderStudentPortalActiveTab(scoped, { nextLessons, recentLessons, activePackage, balance })}
      </div>
    </div>
  `;

  lucide.createIcons();
}

function renderStudentPortalActiveTab(scoped, meta) {
  const tab = studentPortalState.activeTab;
  if (tab === "lessons") return renderStudentPortalLessonsTab(scoped);
  if (tab === "finance") return renderStudentPortalFinanceTab(scoped, meta);
  if (tab === "materials") return renderStudentPortalMaterialsTab(scoped);
  if (tab === "assignments") return renderStudentPortalAssignmentsTab(scoped);
  if (tab === "script") return renderStudentPortalScriptTab(scoped);
  return renderStudentPortalOverviewTab(scoped, meta);
}

function renderStudentPortalOverviewTab(scoped, meta) {
  return `
    <section class="grid grid-cols-1 md:grid-cols-4 gap-3">
      <div class="rounded-xl border border-cream bg-white px-4 py-3">
        <p class="text-[11px] uppercase tracking-wider text-warmgray">Upcoming</p>
        <p class="text-2xl font-semibold text-warmblack mt-1">${meta.nextLessons.length}</p>
      </div>
      <div class="rounded-xl border border-cream bg-white px-4 py-3">
        <p class="text-[11px] uppercase tracking-wider text-warmgray">Homework</p>
        <p class="text-2xl font-semibold text-warmblack mt-1">${scoped.homework.filter((item) => String(item.status || "").toUpperCase() !== "COMPLETED").length}</p>
      </div>
      <div class="rounded-xl border border-cream bg-white px-4 py-3">
        <p class="text-[11px] uppercase tracking-wider text-warmgray">Script</p>
        <p class="text-lg font-semibold text-warmblack mt-1">${escapeHtml(scoped.currentScript?.title || "Not set")}</p>
      </div>
      ${scoped.permissions.finance ? `
        <div class="rounded-xl border border-cream bg-white px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Balance</p>
          <p class="text-2xl font-semibold text-warmblack mt-1">${formatCurrency(Math.max(0, meta.balance))}</p>
        </div>
      ` : `
        <div class="rounded-xl border border-cream bg-white px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Finance</p>
          <p class="text-lg font-semibold text-warmblack mt-1">Hidden</p>
        </div>
      `}
    </section>
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <section class="xl:col-span-2 rounded-2xl border border-cream bg-white p-4 sm:p-5">
        <h3 class="font-display text-xl font-semibold text-warmblack">Upcoming Lessons</h3>
        <div class="space-y-3 mt-4">
          ${meta.nextLessons.length ? meta.nextLessons.map(renderStudentPortalLessonCard).join("") : `<div class="page-empty-state py-8"><p class="text-sm text-warmgray">No upcoming lessons are visible yet.</p></div>`}
        </div>
      </section>
      <aside class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
        <h3 class="font-display text-xl font-semibold text-warmblack">Current Script</h3>
        ${renderStudentPortalScriptSummary(scoped.currentScript)}
      </aside>
    </div>
  `;
}

function renderStudentPortalLessonsTab(scoped) {
  const upcoming = scoped.lessons.filter((lesson) => normalizeLessonStatusValue(lesson.lesson_status) === "SCHEDULED");
  const history = scoped.lessons.filter((lesson) => normalizeLessonStatusValue(lesson.lesson_status) !== "SCHEDULED").slice().reverse();
  return `
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <section class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
        <h3 class="font-display text-xl font-semibold text-warmblack">Upcoming Lessons</h3>
        <div class="space-y-3 mt-4">${upcoming.length ? upcoming.map(renderStudentPortalLessonCard).join("") : `<p class="text-sm text-warmgray">No upcoming lessons.</p>`}</div>
      </section>
      <section class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
        <h3 class="font-display text-xl font-semibold text-warmblack">Lesson History</h3>
        <div class="space-y-3 mt-4">${history.length ? history.map(renderStudentPortalLessonCard).join("") : `<p class="text-sm text-warmgray">No lesson history yet.</p>`}</div>
      </section>
    </div>
  `;
}

function renderStudentPortalFinanceTab(scoped, meta) {
  return `
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <section class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
        <h3 class="font-display text-xl font-semibold text-warmblack">Packages</h3>
        <div class="space-y-3 mt-4">
          ${scoped.packages.length ? scoped.packages.map((pkg) => `
            <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
              <p class="text-sm font-semibold text-warmblack">${escapeHtml(pkg.package_name || "Lesson Package")}</p>
              <p class="text-xs text-warmgray mt-1">${Number(pkg.sessions_remaining || 0)} of ${Number(pkg.sessions_total || 0)} sessions remaining</p>
              <p class="text-xs text-warmgray mt-1">${formatCurrency(pkg.package_price || 0)} - ${escapeHtml(pkg.payment_status || "Due")}</p>
            </div>
          `).join("") : `<p class="text-sm text-warmgray">No package records are visible.</p>`}
        </div>
      </section>
      <section class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
        <h3 class="font-display text-xl font-semibold text-warmblack">Payments</h3>
        <p class="text-sm text-warmgray mt-1">Current balance: <span class="font-semibold text-warmblack">${formatCurrency(Math.max(0, meta.balance))}</span></p>
        <div class="space-y-3 mt-4">
          ${scoped.payments.length ? scoped.payments.map((payment) => `
            <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
              <p class="text-sm font-semibold text-warmblack">${formatCurrency(payment.amount || 0, payment.currency || "USD")}</p>
              <p class="text-xs text-warmgray mt-1">${escapeHtml(formatLongDate(payment.payment_date || payment.created_at))} - ${escapeHtml(payment.status || "Recorded")}</p>
            </div>
          `).join("") : `<p class="text-sm text-warmgray">No payment records are visible.</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderStudentPortalAssignmentsTab(scoped) {
  return `
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <section class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
        <h3 class="font-display text-xl font-semibold text-warmblack">Homework</h3>
        <div class="space-y-3 mt-4">
          ${scoped.homework.length ? scoped.homework.map((item) => `
            <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
              <p class="text-sm font-semibold text-warmblack">${escapeHtml(item.title || "Homework")}</p>
              <p class="text-xs text-warmgray mt-1">${item.due_date ? `Due ${escapeHtml(formatLongDate(item.due_date))}` : "No due date"} - ${escapeHtml(item.status || "Assigned")}</p>
              <p class="text-sm text-warmgray mt-2 whitespace-pre-wrap">${escapeHtml(item.details || "")}</p>
            </div>
          `).join("") : `<p class="text-sm text-warmgray">No homework is assigned.</p>`}
        </div>
      </section>
      <section class="rounded-2xl border border-cream bg-white p-4 sm:p-5">
        <h3 class="font-display text-xl font-semibold text-warmblack">Published Notes</h3>
        <div class="space-y-3 mt-4">
          ${scoped.notes.length ? scoped.notes.map((note) => `
            <article class="rounded-xl border border-cream bg-parchment px-4 py-3">
              <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <h4 class="text-sm font-semibold text-warmblack">${escapeHtml(note.title || "Lesson Note")}</h4>
                <span class="text-xs text-warmgray">${escapeHtml(formatLongDate(note.published_at || note.updated_at || note.created_at))}</span>
              </div>
              <p class="text-sm text-warmgray mt-2 whitespace-pre-wrap">${escapeHtml(note.body || "No note body.")}</p>
            </article>
          `).join("") : `<p class="text-sm text-warmgray">No published notes are visible yet.</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderStudentPortalMaterialsTab(scoped) {
  const profile = scoped.publicProfile || {};
  const canEditPublicPage = scoped.permissions?.publicPage !== false;
  const canSeeMaterials = scoped.permissions?.materials !== false;

  return `
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-5">
      ${canEditPublicPage ? `
        <form class="student-portal-panel rounded-2xl border border-cream bg-white p-4 sm:p-5" onsubmit="submitStudentPortalPublicProfile(event)">
          <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Public Page</p>
          <h3 class="font-display text-xl font-semibold text-warmblack mt-1">Profile Draft</h3>
          <div class="space-y-3 mt-4">
            <label class="block">
              <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Display Name</span>
              <input name="display_name" type="text" value="${escapeHtml(profile.display_name || scoped.student?.full_name || "")}" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" />
            </label>
            <label class="block">
              <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Bio</span>
              <textarea name="bio" rows="9" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">${escapeHtml(profile.bio || "")}</textarea>
            </label>
            <button type="submit" class="w-full px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">Save Profile Draft</button>
          </div>
        </form>
      ` : ""}
      <section class="${canEditPublicPage ? "xl:col-span-1" : "xl:col-span-2"} student-portal-panel rounded-2xl border border-cream bg-white p-4 sm:p-5">
        <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Materials</p>
        <h3 class="font-display text-xl font-semibold text-warmblack mt-1">Visible Library</h3>
        ${canSeeMaterials ? `
          <div class="space-y-3 mt-4">
            ${scoped.materials.length ? scoped.materials.map((file) => `
              <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                <p class="text-sm font-semibold text-warmblack">${escapeHtml(file.title || file.file_name || "Material")}</p>
                <p class="text-xs text-warmgray mt-1">${escapeHtml(file.category || file.material_kind || "Resource")}</p>
                ${file.external_url || file.file_url ? `<a class="inline-flex items-center gap-1 text-xs text-gold font-medium mt-2" href="${escapeHtml(file.external_url || file.file_url)}" target="_blank" rel="noopener">Open <i data-lucide="external-link" class="w-3 h-3"></i></a>` : ""}
              </div>
            `).join("") : `<p class="text-sm text-warmgray">No student-visible materials yet.</p>`}
          </div>
        ` : `<p class="text-sm text-warmgray mt-4">Material visibility is currently disabled for this portal.</p>`}
      </section>
      ${canEditPublicPage ? renderStudentPortalMaterialForm() : ""}
    </div>
  `;
}

function renderStudentPortalMaterialForm() {
  return `
    <form class="rounded-2xl border border-cream bg-white p-4 sm:p-5" onsubmit="submitStudentPortalMaterial(event)">
      <h3 class="font-display text-xl font-semibold text-warmblack">Public Material</h3>
      <div class="space-y-3 mt-4">
        <label class="block">
          <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Title</span>
          <input name="title" type="text" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" />
        </label>
        <label class="block">
          <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Category</span>
          <select name="category" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm">
            <option value="Headshot">Headshot</option>
            <option value="Resume">Resume</option>
            <option value="Reel">Reel</option>
            <option value="Self Tape">Self Tape</option>
            <option value="Public Page">Public Page</option>
          </select>
        </label>
        <label class="block">
          <span class="text-xs uppercase tracking-wider text-warmgray font-medium">URL</span>
          <input name="external_url" type="url" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" />
        </label>
        <button type="submit" class="w-full px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">Submit Material</button>
      </div>
    </form>
  `;
}

function submitStudentPortalMaterial(event) {
  event.preventDefault();
  const form = event.currentTarget;
  submitStudentPortalMutation("submit_public_material", {
    title: form.elements.title.value,
    category: form.elements.category.value,
    external_url: form.elements.external_url.value,
    source_type: "LINK"
  }, "Material submitted for public page review.");
}

function submitStudentPortalPublicProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  submitStudentPortalMutation("update_public_profile", {
    display_name: form.elements.display_name.value,
    bio: form.elements.bio.value
  }, "Public profile draft saved.");
}

function renderStudentPortalScriptSummary(script) {
  if (!script) return `<p class="text-sm text-warmgray mt-3">No current script is active.</p>`;
  const meta = getStudentPortalScriptMeta(script);
  return `
    <div class="rounded-xl border border-cream bg-parchment px-4 py-3 mt-4">
      <p class="text-sm font-semibold text-warmblack">${escapeHtml(script.title || "Current Script")}</p>
      <p class="text-xs text-warmgray mt-1">${Number((meta.comments || []).length)} comments</p>
    </div>
  `;
}

function renderStudentPortalScriptTab(scoped) {
  const script = scoped.currentScript || null;
  const meta = getStudentPortalScriptMeta(script);
  return `
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <section class="xl:col-span-2 rounded-2xl border border-cream bg-white p-4 sm:p-5">
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Current Script</p>
            <h3 class="font-display text-xl font-semibold text-warmblack mt-1">${escapeHtml(script?.title || "No active script")}</h3>
          </div>
          ${script ? `<button type="button" onclick="archiveStudentPortalScript()" class="px-3 py-2 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover">Archive</button>` : ""}
        </div>
        <div class="mt-4">
          ${script?.external_url ? `
            <iframe title="Current script" src="${escapeHtml(script.external_url)}" class="student-portal-script-frame w-full rounded-xl border border-cream bg-parchment"></iframe>
          ` : `
            <pre class="student-portal-script-frame w-full whitespace-pre-wrap rounded-xl border border-cream bg-parchment px-4 py-3 text-sm text-warmblack overflow-auto">${escapeHtml(meta.script_text || "No script text has been added yet.")}</pre>
          `}
        </div>
      </section>
      <aside class="space-y-4">
        <form class="rounded-2xl border border-cream bg-white p-4 sm:p-5" onsubmit="saveStudentPortalScript(event)">
          <h3 class="font-display text-xl font-semibold text-warmblack">Script Source</h3>
          <div class="space-y-3 mt-4">
            <label class="block">
              <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Title</span>
              <input name="title" type="text" value="${escapeHtml(script?.title || "")}" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" />
            </label>
            <label class="block">
              <span class="text-xs uppercase tracking-wider text-warmgray font-medium">PDF URL</span>
              <input name="script_url" type="url" value="${escapeHtml(script?.external_url || "")}" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm" />
            </label>
            <label class="block">
              <span class="text-xs uppercase tracking-wider text-warmgray font-medium">Pasted Text</span>
              <textarea name="script_text" rows="8" class="mt-2 w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm font-mono whitespace-pre-wrap">${escapeHtml(meta.script_text || "")}</textarea>
            </label>
            <button type="submit" class="w-full px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold">Save Script</button>
          </div>
        </form>
        <form class="rounded-2xl border border-cream bg-white p-4 sm:p-5" onsubmit="addStudentPortalScriptComment(event)">
          <h3 class="font-display text-xl font-semibold text-warmblack">Comments</h3>
          <div class="space-y-3 mt-4">
            <textarea name="comment" rows="4" class="w-full rounded-xl border border-cream bg-parchment px-3 py-2.5 text-sm"></textarea>
            <button type="submit" class="w-full px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack card-hover">Add Comment</button>
          </div>
          <div class="space-y-3 mt-4">
            ${(meta.comments || []).map((comment) => `
              <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
                <p class="text-xs text-warmgray">${escapeHtml(formatLongDate(comment.created_at))} - ${escapeHtml(comment.author_role || "Student")}</p>
                <p class="text-sm text-warmblack mt-2 whitespace-pre-wrap">${escapeHtml(comment.body || "")}</p>
              </div>
            `).join("") || `<p class="text-sm text-warmgray">No comments yet.</p>`}
          </div>
        </form>
      </aside>
    </div>
  `;
}

function saveStudentPortalScript(event) {
  event.preventDefault();
  const form = event.currentTarget;
  submitStudentPortalMutation("save_current_script", {
    title: form.elements.title.value,
    script_url: form.elements.script_url.value,
    script_text: form.elements.script_text.value
  }, "Current script saved.");
}

function addStudentPortalScriptComment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  submitStudentPortalMutation("add_script_comment", {
    comment: form.elements.comment.value
  }, "Script comment added.");
}

function archiveStudentPortalScript() {
  submitStudentPortalMutation("archive_current_script", {}, "Current script archived.");
}

function openStudentPortalLessonModal(lessonId) {
  const lesson = (studentPortalState.data?.lessons || []).find((row) => row.lesson_id === lessonId);
  if (!lesson) return;
  closeStudentPortalLessonModal();
  const note = (studentPortalState.data?.notes || []).find((row) => row.lesson_id === lessonId);
  const homework = (studentPortalState.data?.homework || []).filter((row) => row.lesson_id === lessonId);
  const overlay = document.createElement("div");
  overlay.id = "student-portal-lesson-modal";
  overlay.className = "fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4";
  overlay.innerHTML = `
    <div class="app-modal-shell bg-white rounded-2xl border border-cream w-full max-w-2xl p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
      <div class="app-modal-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <p class="text-xs uppercase tracking-wider text-warmgray font-medium">Lesson Details</p>
          <h3 class="font-display text-xl font-bold text-warmblack">${escapeHtml(lesson.topic || lesson.lesson_type || "Lesson")}</h3>
        </div>
        <button type="button" onclick="closeStudentPortalLessonModal()" class="self-start text-sm text-warmgray">Close</button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">When</p>
          <p class="text-sm font-semibold text-warmblack mt-1">${escapeHtml(formatStudentPortalLessonWhen(lesson))}</p>
        </div>
        <div class="rounded-xl border border-cream bg-parchment px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Status</p>
          <p class="text-sm font-semibold text-warmblack mt-1">${escapeHtml(getLessonStatusLabel(lesson.lesson_status))}</p>
        </div>
        <div class="rounded-xl border border-cream bg-parchment px-4 py-3 sm:col-span-2">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Location</p>
          <p class="text-sm font-semibold text-warmblack mt-1">${escapeHtml(lesson.location_type === "IN_PERSON" ? (lesson.location_address || "In person") : "Virtual")}</p>
          ${lesson.join_link ? `<a class="inline-flex items-center gap-1 text-xs text-gold font-medium mt-2" href="${escapeHtml(lesson.join_link)}" target="_blank" rel="noopener">Open Link <i data-lucide="external-link" class="w-3 h-3"></i></a>` : ""}
        </div>
      </div>
      <div class="mt-4 space-y-3">
        <section class="rounded-xl border border-cream bg-parchment px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Published Note</p>
          <p class="text-sm text-warmblack mt-2 whitespace-pre-wrap">${escapeHtml(note?.body || "No published note for this lesson.")}</p>
        </section>
        <section class="rounded-xl border border-cream bg-parchment px-4 py-3">
          <p class="text-[11px] uppercase tracking-wider text-warmgray">Homework</p>
          ${homework.length ? homework.map((item) => `<p class="text-sm text-warmblack mt-2">${escapeHtml(item.title || "Homework")} ${item.due_date ? `- due ${escapeHtml(formatLongDate(item.due_date))}` : ""}</p>`).join("") : `<p class="text-sm text-warmblack mt-2">No homework attached.</p>`}
        </section>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  lucide.createIcons();
}

function closeStudentPortalLessonModal() {
  const modal = document.getElementById("student-portal-lesson-modal");
  if (modal) modal.remove();
}

function getCoachPreviewPortalPermissions(student, role = "STUDENT") {
  const identity = { role, student };
  const finance =
    role === "STUDENT"
      ? student.portal_student_finance_access !== false
      : student.portal_guardian_finance_access === true;
  return {
    role,
    finance: finance && !(student.student_is_minor === true && student.portal_minor_finance_access !== true),
    notes: student.portal_notes_access !== false,
    homework: student.portal_homework_access !== false,
    materials: student.portal_materials_access !== false,
    publicPage: student.portal_public_page_access !== false,
    script: student.portal_script_access !== false
  };
}

function buildCoachStudentPortalPreviewData(studentId, role = "STUDENT") {
  const student = getSchemaStudentById(studentId);
  if (!student) return null;
  const permissions = getCoachPreviewPortalPermissions(student, role);
  const materials = permissions.materials
    ? getFileRecords().filter((file) => file.student_id === studentId && normalizeMaterialVisibility(file.visibility) === "STUDENT_VISIBLE")
    : [];
  const currentScript = materials
    .filter((file) => String(file.category || "").toUpperCase() === "CURRENT_SCRIPT")
    .filter((file) => String(file.status || "").toUpperCase() !== "ARCHIVED" && !file.archived_at)
    .sort((a, b) => new Date(b.uploaded_at || 0).getTime() - new Date(a.uploaded_at || 0).getTime())[0] || null;

  return {
    permissions,
    student,
    publicProfile: permissions.publicPage ? getActorProfileByStudentId(studentId) : null,
    currentScript,
    lessons: getLessonRecords()
      .filter((lesson) => lesson.student_id === studentId)
      .sort((a, b) => new Date(a.scheduled_start || 0).getTime() - new Date(b.scheduled_start || 0).getTime()),
    notes: permissions.notes
      ? getNoteRecords()
        .filter((note) => note.student_id === studentId && normalizeNoteStatus(note.status) === "PUBLISHED")
        .sort((a, b) => new Date(b.published_at || b.updated_at || 0).getTime() - new Date(a.published_at || a.updated_at || 0).getTime())
      : [],
    homework: permissions.homework
      ? getHomeworkRecords().filter((item) => item.student_id === studentId)
      : [],
    packages: permissions.finance
      ? getPackageRecords().filter((pkg) => pkg.student_id === studentId && !isPackageArchived(pkg))
      : [],
    payments: permissions.finance
      ? getPaymentRecords().filter((payment) => payment.student_id === studentId && !isPaymentArchived(payment) && normalizePaymentReviewStateValue(payment.review_state, payment) !== "NEEDS_REVIEW")
      : [],
    materials
  };
}

function previewStudentPortalAsCoach(studentId, role = "STUDENT") {
  const data = buildCoachStudentPortalPreviewData(studentId, role);
  if (!data) return;
  studentPortalState = {
    identity: {
      role,
      email: role === "GUARDIAN" ? data.student.guardian_email || data.student.preferred_contact_email || "" : data.student.email || "",
      student_id: studentId,
      student_name: data.student.full_name || "Student"
    },
    data,
    activeTab: "overview"
  };
  currentPage = "student_portal";
  updateNavState("student_portal");
  renderStudentPortalDashboard(studentPortalState.identity, data);
}
