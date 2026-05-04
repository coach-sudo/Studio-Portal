/*********************************
 * STUDENT PORTAL AUTH / SCOPE
 *********************************/

let studentPortalMessage = "";
let studentPortalMessageTone = "warm";
let studentPortalRequestId = 0;

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

  setStudentPortalMessage("Signed out of the student portal.", "warm");
  renderStudentPortalPage();
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
          <div class="rounded-xl border border-gold/20 bg-gold/5 px-4 py-3 text-xs text-warmgray">
            Access is checked by the server against the student or guardian contact email on file.
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
        root.innerHTML = renderStudentPortalLogin();
        lucide.createIcons();
        return;
      }

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
    student: null,
    lessons: [],
    notes: [],
    homework: [],
    packages: [],
    payments: [],
    materials: [],
    ...(scoped || {})
  };

  if (!identity) {
    root.innerHTML = renderStudentPortalLogin();
    lucide.createIcons();
    return;
  }

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
