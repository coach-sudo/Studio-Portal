const APP_NOW = new Date();

function getDashboardGreeting(date = APP_NOW) {
  const hour = date.getHours();

  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getDashboardHeaderDate(date = APP_NOW) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function getDashboardHeaderTime(date = APP_NOW) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatMonthDay(dateString) {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

function formatLessonDateTime(dateString) {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";

  const monthDay = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });

  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });

  return `${monthDay}, ${time}`;
}

function getStudentNameById(studentId) {
  const student = getStudentRecords().find((s) => s.student_id === studentId);
  return student ? student.full_name : "Unknown Student";
}

function getStudentInitialsById(studentId) {
  const student = getStudentRecords().find((s) => s.student_id === studentId);
  if (!student) return "??";
  return `${student.first_name.charAt(0)}${student.last_name.charAt(0)}`.toUpperCase();
}

function getActiveStudentsCount() {
  return getStudentRecords().filter((student) => student.studio_status === "ACTIVE").length;
}

function getThisWeeksLessonsCount() {
  const todayStart = startOfDay(APP_NOW);
  const weekEnd = endOfDay(addDays(APP_NOW, 7));

  return getLessonRecords().filter((lesson) => {
    const lessonDate = new Date(lesson.scheduled_start);
    return lessonDate >= todayStart && lessonDate <= weekEnd;
  }).length;
}

function isPackagePressure(pkg) {
  if (!pkg || isPackageArchived(pkg)) return false;

  const finance = buildFinanceSummary(pkg.student_id, getSchemaStudentById(pkg.student_id));
  const expiresOn = pkg.expires_on ? new Date(pkg.expires_on) : null;
  const daysUntilExpiry = expiresOn ? Math.ceil((startOfDay(expiresOn) - startOfDay(APP_NOW)) / (1000 * 60 * 60 * 24)) : 999;

  return (
    (finance.mode === "PACKAGE" && finance.remainingAmount > 0) ||
    getResolvedPackageUsage(pkg.student_id, pkg).remaining <= 1 ||
    daysUntilExpiry <= 14
  );
}

function getExpiringPackagesList() {
  return getPackageRecords()
    .filter(isPackagePressure)
    .sort((a, b) => {
      const aDate = a.expires_on ? new Date(a.expires_on).getTime() : 0;
      const bDate = b.expires_on ? new Date(b.expires_on).getTime() : 0;
      return aDate - bDate;
    });
}

function getInactiveStudentsList() {
  return students
    .filter((student) => student.status === "inactive")
    .sort((a, b) => {
      const aDate = new Date(`2026 ${a.lastSeen}`).getTime();
      const bDate = new Date(`2026 ${b.lastSeen}`).getTime();
      return aDate - bDate;
    });
}

function getUpcomingLessonsList() {
  return getLessonRecords()
    .filter((lesson) => lesson.lesson_status === "SCHEDULED" && new Date(lesson.scheduled_start) >= APP_NOW)
    .sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start))
    .slice(0, 5);
}

function getRecentPublishedNotes() {
  return getNoteRecords()
    .filter((note) => normalizeNoteStatus(note.status) === "PUBLISHED" && note.published_at)
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, 3);
}

function getNotesByStatus(status) {
  return getNoteRecords().filter((note) => normalizeNoteStatus(note.status) === status);
}

function getOpenDraftNotes() {
  return getNotesByStatus("DRAFT")
    .sort((a, b) => getNoteSortTime(b) - getNoteSortTime(a))
    .slice(0, 3);
}

function getStaleDraftNotes(minDays = 7) {
  return getNotesByStatus("DRAFT")
    .filter((note) => getNoteAgeInDays(note) >= minDays)
    .sort((a, b) => getNoteAgeInDays(b) - getNoteAgeInDays(a));
}

function getFinanceDashboardRows() {
  return getStudentRecords().map((student) => {
    const finance = buildFinanceSummary(student.student_id, student);
    return {
      student_id: student.student_id,
      student_name: student.full_name,
      billing_model: student.billing_model,
      finance
    };
  });
}

function getOutstandingBalanceRows() {
  return getFinanceDashboardRows()
    .filter((row) => Number(row.finance.remainingAmount || 0) > 0)
    .sort((a, b) => Number(b.finance.remainingAmount || 0) - Number(a.finance.remainingAmount || 0));
}

function getOutstandingBalanceTotal() {
  return getOutstandingBalanceRows().reduce((sum, row) => sum + Number(row.finance.remainingAmount || 0), 0);
}

function getPackageRenewalCount() {
  return getExpiringPackagesList().length;
}

function getRecentPaymentsList() {
  return getPaymentRecords()
    .filter((payment) => !isPaymentArchived(payment))
    .sort((a, b) => new Date(b.payment_date || 0) - new Date(a.payment_date || 0))
    .slice(0, 5);
}

function getDashboardNotesAlertSummary() {
  const rows = getCompletedLessonsNeedingNotesRows();
  const actionable = rows.filter((row) => row.action_required);
  const overdue = actionable.filter((row) => row.urgency_key === "overdue");
  const dueNow = actionable.filter((row) => row.urgency_key === "due-now");
  const withinWindow = actionable.filter((row) => row.urgency_key === "within-window");

  return {
    actionable,
    overdue,
    dueNow,
    withinWindow,
    oldestOverdue: overdue[0] || null
  };
}

function openDashboardNotesDueTarget() {
  navigateTo("notes");
}

function openDashboardFinanceTarget() {
  navigateTo("finance");
}

function openDashboardStudentsTarget() {
  navigateTo("students");
}

function openDashboardLessonsTarget() {
  navigateTo("lessons");
}
function renderDashboardPage() {
  const root = document.getElementById("page-root");
  if (!root) return;

  root.innerHTML = `
    <div class="dashboard-shell p-4 sm:p-6 xl:p-8 w-full">
      <header class="mb-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 slide-up">
        <div class="min-w-0">
          <h2 class="font-display text-3xl font-bold text-warmblack">
            ${getDashboardGreeting()}, <span id="dash-coach-name">Darius</span>
          </h2>
          <p class="text-warmgray mt-1">Here's what's happening at your studio today</p>
        </div>
        <div class="dashboard-header-meta flex items-center gap-3 self-start lg:self-auto">
          <span class="text-sm text-warmgray">${escapeHtml(`${getDashboardHeaderDate()} · ${getDashboardHeaderTime()}`)}</span>
          <button type="button" onclick="openNotificationCenter()" class="w-10 h-10 rounded-full bg-white border border-cream flex items-center justify-center card-hover" aria-label="Open notifications">
            <i data-lucide="bell" class="w-[18px] h-[18px] text-charcoal"></i>
          </button>
        </div>
      </header>

      <div class="dashboard-stats-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        <button type="button" onclick="openDashboardLessonsTarget()" class="dashboard-stat-card w-full min-w-0 bg-white rounded-2xl p-5 border border-cream card-hover slide-up text-left overflow-hidden" style="animation-delay:0.05s">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 rounded-xl bg-burgundy/10 flex items-center justify-center">
              <i data-lucide="calendar" class="w-5 h-5 text-burgundy"></i>
            </div>
            <span class="text-xs font-medium text-burgundy bg-burgundy/10 px-2 py-1 rounded-full">This week</span>
          </div>
          <p id="dash-upcoming-lessons" class="text-3xl font-bold text-warmblack">0</p>
          <p class="text-sm text-warmgray mt-0.5">Upcoming Lessons</p>
        </button>

        <button type="button" onclick="openDashboardNotesDueTarget()" class="dashboard-stat-card w-full min-w-0 bg-white rounded-2xl p-5 border border-cream card-hover slide-up text-left overflow-hidden" style="animation-delay:0.1s">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 rounded-xl bg-burgundy/10 flex items-center justify-center">
              <i data-lucide="file-text" class="w-5 h-5 text-burgundy"></i>
            </div>
            <span id="dash-notes-due-badge" class="text-xs font-medium text-sage bg-sage/10 px-2 py-1 rounded-full">On track</span>
          </div>
          <p id="dash-notes-due" class="text-3xl font-bold text-warmblack">0</p>
          <p class="text-sm text-warmgray mt-0.5">Urgent Notes</p>
        </button>

        <button type="button" onclick="openDashboardFinanceTarget()" class="dashboard-stat-card w-full min-w-0 bg-white rounded-2xl p-5 border border-cream card-hover slide-up text-left overflow-hidden" style="animation-delay:0.15s">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center">
              <i data-lucide="refresh-cw" class="w-5 h-5 text-gold"></i>
            </div>
            <span class="text-xs font-medium text-gold bg-gold/10 px-2 py-1 rounded-full">Next 14d</span>
          </div>
          <p id="dash-package-renewals" class="text-3xl font-bold text-warmblack">0</p>
          <p class="text-sm text-warmgray mt-0.5">Packages Expiring Soon</p>
        </button>

        <button type="button" onclick="openDashboardFinanceTarget()" class="dashboard-stat-card w-full min-w-0 bg-white rounded-2xl p-5 border border-cream card-hover slide-up text-left overflow-hidden" style="animation-delay:0.2s">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 rounded-xl bg-burgundy/10 flex items-center justify-center">
              <i data-lucide="wallet" class="w-5 h-5 text-burgundy"></i>
            </div>
            <span class="text-xs font-medium text-burgundy bg-burgundy/10 px-2 py-1 rounded-full">Outstanding</span>
          </div>
          <p id="dash-outstanding-balance" class="text-3xl font-bold text-warmblack">$0</p>
          <p class="text-sm text-warmgray mt-0.5">Outstanding Balance</p>
        </button>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div class="dashboard-panel xl:col-span-2 min-w-0 bg-white rounded-2xl border border-cream slide-up" style="animation-delay:0.25s">
          <div class="dashboard-panel-header p-5 border-b border-cream flex items-center justify-between gap-3">
            <h3 class="font-display text-lg font-semibold">Upcoming Lessons</h3>
            <button class="text-xs text-gold font-medium hover:underline" onclick="navigateTo('lessons')">View all →</button>
          </div>

          <div id="dashboard-upcoming-lessons" class="divide-y divide-cream/70"></div>
        </div>

        <div class="space-y-6 min-w-0">
          <div class="dashboard-panel bg-white rounded-2xl border border-cream slide-up" style="animation-delay:0.3s">
            <div class="p-5 border-b border-cream">
              <h3 class="font-display text-lg font-semibold">Outstanding Balances</h3>
            </div>
            <div id="dashboard-outstanding-balances" class="p-3 space-y-2"></div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
        <div class="dashboard-panel min-w-0 bg-white rounded-2xl border border-cream slide-up" style="animation-delay:0.38s">
          <div class="p-5 border-b border-cream">
            <h3 class="font-display text-lg font-semibold">Reconnect Queue</h3>
          </div>
          <div id="dashboard-inactive-students" class="dashboard-scroll-list p-3 space-y-2"></div>
        </div>

        <div class="dashboard-panel xl:col-span-2 min-w-0 bg-white rounded-2xl border border-cream slide-up" style="animation-delay:0.4s">
          <div id="dashboard-notes-alert" class="border-b border-cream"></div>
          <div class="p-5 border-b border-cream">
            <h3 class="font-display text-lg font-semibold">Recent Lesson Notes</h3>
          </div>
          <div id="dashboard-recent-notes" class="p-4 space-y-4"></div>
        </div>
      </div>

      <div class="dashboard-panel mt-6 min-w-0 bg-white rounded-2xl border border-cream slide-up" style="animation-delay:0.45s">
        <div class="dashboard-panel-header p-5 border-b border-cream flex items-center justify-between gap-3">
          <h3 class="font-display text-lg font-semibold">Packages Expiring Soon</h3>
          <span class="text-xs text-warmgray">Within 14 days or with money still owed</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-warmgray uppercase tracking-wider">
                <th class="px-5 py-3 font-medium">Student</th>
                <th class="px-5 py-3 font-medium">Package</th>
                <th class="px-5 py-3 font-medium">Remaining Sessions</th>
                <th class="px-5 py-3 font-medium">Remaining Balance</th>
                <th class="px-5 py-3 font-medium">Expires</th>
                <th class="px-5 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody id="dashboard-expiring-packages" class="divide-y divide-cream/70"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  renderDashboard();
  lucide.createIcons();
}

function renderDashboardStats() {
  const upcomingEl = document.getElementById("dash-upcoming-lessons");
  const notesDueEl = document.getElementById("dash-notes-due");
  const notesDueBadgeEl = document.getElementById("dash-notes-due-badge");
  const renewalsEl = document.getElementById("dash-package-renewals");
  const outstandingEl = document.getElementById("dash-outstanding-balance");
  const notesSummary = getDashboardNotesAlertSummary();

  if (upcomingEl) upcomingEl.textContent = String(getThisWeeksLessonsCount());
  if (notesDueEl) notesDueEl.textContent = String(notesSummary.actionable.length);
  if (notesDueBadgeEl) {
    if (notesSummary.overdue.length) {
      notesDueBadgeEl.className = "text-xs font-medium text-burgundy bg-burgundy/10 px-2 py-1 rounded-full";
      notesDueBadgeEl.textContent = "Urgent";
    } else if (notesSummary.dueNow.length) {
      notesDueBadgeEl.className = "text-xs font-medium text-gold bg-gold/10 px-2 py-1 rounded-full";
      notesDueBadgeEl.textContent = "Due now";
    } else {
      notesDueBadgeEl.className = "text-xs font-medium text-sage bg-sage/10 px-2 py-1 rounded-full";
      notesDueBadgeEl.textContent = notesSummary.actionable.length ? "Within 48h" : "On track";
    }
  }
  if (renewalsEl) renewalsEl.textContent = String(getPackageRenewalCount());
  if (outstandingEl) outstandingEl.textContent = formatCurrency(getOutstandingBalanceTotal());
}

function renderDashboardUpcomingLessons() {
  const container = document.getElementById("dashboard-upcoming-lessons");
  if (!container) return;

  const lessons = getUpcomingLessonsList();

  if (lessons.length === 0) {
    container.innerHTML = `<div class="p-6 text-sm text-warmgray">No upcoming scheduled lessons.</div>`;
    return;
  }

  container.innerHTML = lessons.map((lesson) => {
    const studentName = getStudentNameById(lesson.student_id);
    const initials = getStudentInitialsById(lesson.student_id);
    const lessonDate = formatLessonDateTime(lesson.scheduled_start);

    return `
      <div class="p-4 flex items-start gap-4 hover:bg-parchment/50 transition-colors">
        <div class="w-10 h-10 rounded-full headshot-placeholder flex items-center justify-center text-sm font-semibold text-warmgray">
          ${initials}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">${studentName}</p>
          <p class="text-xs text-warmgray wrap-anywhere">${escapeHtml(lesson.topic || "Lesson")}</p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-sm font-medium text-warmblack">${lessonDate}</p>
          <p class="text-xs text-sage">${lesson.lesson_status}</p>
        </div>
      </div>
    `;
  }).join("");
}

function renderDashboardOutstandingBalances() {
  const container = document.getElementById("dashboard-outstanding-balances");
  if (!container) return;

  const balances = getOutstandingBalanceRows().slice(0, 5);

  if (balances.length === 0) {
    container.innerHTML = `<div class="p-4 text-sm text-warmgray">No outstanding balances right now.</div>`;
    return;
  }

  container.innerHTML = balances.map((row) => `
    <button
      type="button"
      class="w-full text-left flex items-center gap-3 p-2.5 rounded-xl bg-burgundy/5 border border-burgundy/10 hover:bg-burgundy/10 transition-colors"
      onclick="viewStudentProfileFromLesson('${row.student_id}')"
    >
      <div class="w-8 h-8 rounded-full headshot-placeholder flex items-center justify-center text-xs font-semibold text-warmgray">
        ${getStudentInitialsById(row.student_id)}
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${row.student_name}</p>
        <p class="text-[11px] text-warmgray">${getBillingModelLabel(row.billing_model)} · Owes ${formatCurrency(row.finance.remainingAmount)}</p>
      </div>
      <span class="text-xs text-burgundy font-medium shrink-0">Review</span>
    </button>
  `).join("");
}

function renderDashboardRecentPayments() {
  const container = document.getElementById("dashboard-recent-payments");
  if (!container) return;

  const payments = getRecentPaymentsList();

  if (payments.length === 0) {
    container.innerHTML = `<div class="p-4 text-sm text-warmgray">No payments recorded yet.</div>`;
    return;
  }

  container.innerHTML = payments.map((payment) => `
    <div class="flex items-center gap-3 p-2.5 rounded-xl bg-parchment/70 border border-cream/80">
      <div class="w-8 h-8 rounded-full bg-sage/10 flex items-center justify-center text-xs font-semibold text-sage">
        $
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${getStudentNameById(payment.student_id)}</p>
        <p class="text-[11px] text-warmgray">${payment.payment_type} · ${formatMonthDay(payment.payment_date)}</p>
      </div>
      <span class="text-xs font-medium ${String(payment.status || "").toLowerCase() === "paid" ? "text-sage" : "text-gold"}">${formatCurrency(payment.amount, payment.currency)}</span>
    </div>
  `).join("");
}

function renderDashboardInactiveStudents() {
  const container = document.getElementById("dashboard-inactive-students");
  if (!container) return;

  const inactiveStudents = getInactiveStudentsList();

  if (inactiveStudents.length === 0) {
    container.innerHTML = `<div class="p-4 text-sm text-warmgray">No inactive students right now.</div>`;
    return;
  }

  container.innerHTML = inactiveStudents.map((student) => `
    <div class="flex items-start gap-3 p-2.5 rounded-xl bg-burgundy/5 border border-burgundy/10">
      <div class="w-8 h-8 rounded-full headshot-placeholder flex items-center justify-center text-xs font-semibold text-warmgray">
        ${student.initials}
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${student.name}</p>
        <p class="text-[11px] text-warmgray">Last seen: ${student.lastSeen}</p>
      </div>
      <span class="text-xs text-burgundy font-medium shrink-0">Follow up</span>
    </div>
  `).join("");
}

function renderDashboardRecentNotesLegacy() {
  const container = document.getElementById("dashboard-recent-notes");
  if (!container) return;

  const notes = getRecentPublishedNotes();
  const borderClasses = ["border-gold", "border-sage", "border-burgundy"];

  if (notes.length === 0) {
    container.innerHTML = `<div class="text-sm text-warmgray">No published notes yet.</div>`;
    return;
  }

  container.innerHTML = notes.map((note, index) => `
    <div class="border-l-2 ${borderClasses[index % borderClasses.length]} pl-3">
      <p class="text-sm font-medium">
        ${getStudentNameById(note.student_id)}
        <span class="text-warmgray font-normal">· ${formatMonthDay(note.published_at)}</span>
      </p>
      <p class="text-xs text-warmgray mt-1 leading-relaxed">${note.body}</p>
    </div>
  `).join("");
}

function renderDashboardRecentNotes() {
  const container = document.getElementById("dashboard-recent-notes");
  if (!container) return;

  const notes = getRecentPublishedNotes();
  const draftNotes = getOpenDraftNotes();
  const staleDraftNotes = getStaleDraftNotes(7);
  const noteCounts = getNoteCountsByStatus(getNoteRecords());
  const borderClasses = ["border-gold", "border-sage", "border-burgundy"];

  if (notes.length === 0 && draftNotes.length === 0 && staleDraftNotes.length === 0) {
    container.innerHTML = `<div class="text-sm text-warmgray">No lesson notes yet.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <div class="rounded-xl border border-gold/20 bg-gold/5 px-3 py-2">
        <p class="text-[11px] uppercase tracking-wider text-warmgray">Drafts</p>
        <p class="text-lg font-semibold text-warmblack">${noteCounts.DRAFT}</p>
      </div>
      <div class="rounded-xl border border-sage/20 bg-sage/5 px-3 py-2">
        <p class="text-[11px] uppercase tracking-wider text-warmgray">Published</p>
        <p class="text-lg font-semibold text-warmblack">${noteCounts.PUBLISHED}</p>
      </div>
      <div class="rounded-xl border border-warmgray/20 bg-parchment px-3 py-2">
        <p class="text-[11px] uppercase tracking-wider text-warmgray">Archived</p>
        <p class="text-lg font-semibold text-warmblack">${noteCounts.ARCHIVED}</p>
      </div>
    </div>

    ${
      draftNotes.length
        ? `
          <div class="pt-1">
            <p class="text-xs font-medium uppercase tracking-wider text-warmgray mb-2">Needs Attention</p>
            <div class="space-y-2">
              ${draftNotes.map((note) => `
                <button
                  type="button"
                  class="w-full text-left rounded-xl border border-gold/20 bg-gold/5 px-3 py-2.5 hover:border-gold/40"
                  onclick="openNoteWorkspace('${note.student_id}', '${note.lesson_id}')"
                >
                  <p class="text-sm font-medium text-warmblack truncate">${escapeHtml(getStudentNameById(note.student_id))}</p>
                  <p class="text-xs text-warmgray mt-1 wrap-anywhere">${escapeHtml(note.title || "Untitled note")}</p>
                </button>
              `).join("")}
            </div>
          </div>
        `
        : ""
    }

    ${
      staleDraftNotes.length
        ? `
          <div class="rounded-xl border border-burgundy/20 bg-burgundy/5 px-4 py-3">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-xs font-medium uppercase tracking-wider text-burgundy">Draft Cleanup Queue</p>
                <p class="text-sm text-warmblack mt-1">${staleDraftNotes.length} draft${staleDraftNotes.length === 1 ? "" : "s"} untouched for 7+ days</p>
              </div>
              <span class="text-xs font-medium text-burgundy">${staleDraftNotes[0] ? `${getNoteAgeInDays(staleDraftNotes[0])}d oldest` : ""}</span>
            </div>
          </div>
        `
        : ""
    }

    <div class="space-y-4">
      <p class="text-xs font-medium uppercase tracking-wider text-warmgray">Recent Published</p>
      ${
        notes.length
          ? notes.map((note, index) => `
              <div class="border-l-2 ${borderClasses[index % borderClasses.length]} pl-3">
                <p class="text-sm font-medium">
                  ${escapeHtml(getStudentNameById(note.student_id))}
                  <span class="text-warmgray font-normal"> · ${escapeHtml(formatMonthDay(note.published_at))}</span>
                </p>
                <p class="text-xs text-warmgray mt-1 leading-relaxed wrap-anywhere">${escapeHtml(stripHtmlForPreview(note.body))}</p>
              </div>
            `).join("")
          : `<div class="text-sm text-warmgray">No published notes yet.</div>`
      }
    </div>
  `;
}

function renderDashboardNotesAlert() {
  const container = document.getElementById("dashboard-notes-alert");
  if (!container) return;

  const summary = getDashboardNotesAlertSummary();

  if (!summary.actionable.length) {
    container.innerHTML = `
      <div class="px-5 py-4 bg-sage/5">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div class="min-w-0">
            <p class="text-xs font-medium uppercase tracking-wider text-sage">Notes On Track</p>
            <p class="text-sm text-warmblack mt-1">No completed lessons are waiting on a published note right now.</p>
          </div>
          <button
            type="button"
            class="px-4 py-2 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack self-start sm:self-auto"
            onclick="navigateTo('notes')"
          >
            Open Queue
          </button>
        </div>
      </div>
    `;
    return;
  }

  const priorityTone = summary.overdue.length
    ? { wrapper: "bg-burgundy/5", label: "Urgent Notes", text: "text-burgundy" }
    : { wrapper: "bg-gold/5", label: "Notes Follow-Up", text: "text-gold" };

  container.innerHTML = `
    <div class="px-5 py-4 ${priorityTone.wrapper}">
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div class="min-w-0">
          <p class="text-xs font-medium uppercase tracking-wider ${priorityTone.text}">${priorityTone.label}</p>
          <p class="text-sm text-warmblack mt-1">
            ${summary.actionable.length} completed lesson${summary.actionable.length === 1 ? "" : "s"} still need a published note.
            ${summary.overdue.length ? `${summary.overdue.length} overdue.` : summary.dueNow.length ? `${summary.dueNow.length} due now.` : `${summary.withinWindow.length} still within the 48-hour window.`}
          </p>
        </div>
        <div class="flex flex-col sm:flex-row sm:items-center gap-2">
          ${
            summary.oldestOverdue
              ? `
                <button
                  type="button"
                  class="px-4 py-2 rounded-xl bg-white border border-burgundy/20 text-sm font-medium text-warmblack self-start sm:self-auto"
                  onclick="openNoteWorkspace('${summary.oldestOverdue.student_id}', '${summary.oldestOverdue.lesson_id}')"
                >
                  Oldest Overdue
                </button>
              `
              : ""
          }
          <button
            type="button"
            class="px-4 py-2 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack self-start sm:self-auto"
            onclick="navigateTo('notes')"
          >
            Open Queue
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderDashboardExpiringPackages() {
  const tbody = document.getElementById("dashboard-expiring-packages");
  if (!tbody) return;

  const packages = getExpiringPackagesList();

  if (packages.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-5 py-6 text-center text-sm text-warmgray">
          No package pressure points right now.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = packages.map((pkg) => {
    const studentName = getStudentNameById(pkg.student_id);
    const usage = getResolvedPackageUsage(pkg.student_id, pkg);
    const finance = buildFinanceSummary(pkg.student_id, getSchemaStudentById(pkg.student_id));
    const remainingClass = usage.remaining <= 1 ? "text-burgundy" : "text-gold";

    return `
      <tr class="hover:bg-parchment/50 transition-colors">
        <td class="px-5 py-3 font-medium">${studentName}</td>
        <td class="px-5 py-3 text-warmgray">${pkg.package_name}</td>
        <td class="px-5 py-3">
          <span class="${remainingClass} font-medium">${usage.remaining} ${usage.remaining === 1 ? "session" : "sessions"}</span>
        </td>
        <td class="px-5 py-3 ${finance.remainingAmount > 0 ? "text-burgundy font-medium" : "text-sage font-medium"}">${formatCurrency(finance.remainingAmount)}</td>
        <td class="px-5 py-3 text-warmgray">${formatMonthDay(pkg.expires_on)}</td>
        <td class="px-5 py-3">
          <button class="text-xs text-gold font-medium hover:underline" onclick="navigateTo('finance')">Review</button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderDashboard() {
  renderDashboardStats();
  renderDashboardUpcomingLessons();
  renderDashboardOutstandingBalances();
  renderDashboardInactiveStudents();
  renderDashboardNotesAlert();
  renderDashboardRecentNotes();
  renderDashboardExpiringPackages();
  lucide.createIcons();
}

function renderAppFromSchema() {
  rebuildStudentViewModels();

  if (!selectedStudentId || !getStudentById(selectedStudentId)) {
    selectedStudentId = students.length > 0 ? students[0].id : null;
  }

  renderCurrentPage();
}

document.addEventListener("DOMContentLoaded", () => {
  initializeSidebarState();
  applyConfig();
  studioDataService.initializePersistence();
  initializeAdminAccess();

  rebuildStudentViewModels();

  const studentForm = document.getElementById("student-form");
  if (studentForm) {
    studentForm.addEventListener("submit", handleStudentFormSubmit);
  }

  const lessonForm = document.getElementById("lesson-form");
  if (lessonForm) {
    lessonForm.addEventListener("submit", handleLessonFormSubmit);
  }

  if (!selectedStudentId || !getStudentById(selectedStudentId)) {
    selectedStudentId = students.length > 0 ? students[0].id : null;
  }

  renderCurrentPage();
  lucide.createIcons();
});
