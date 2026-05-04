let currentPage = "operations";
let isSidebarCollapsed = false;

function applySidebarState() {
  const appRoot = document.getElementById("app-root");
  const toggleBtn = document.getElementById("sidebar-toggle");
  const toggleIcon = document.getElementById("sidebar-toggle-icon");

  if (appRoot) {
    appRoot.classList.toggle("sidebar-collapsed", isSidebarCollapsed);
  }

  if (toggleBtn) {
    const label = isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
    toggleBtn.setAttribute("aria-label", label);
    toggleBtn.setAttribute("title", label);
  }

  if (toggleIcon) {
    toggleIcon.setAttribute("data-lucide", isSidebarCollapsed ? "panel-left-open" : "panel-left-close");
  }

  lucide.createIcons();
}

function initializeSidebarState() {
  try {
    isSidebarCollapsed = localStorage.getItem("studioPortal.sidebarCollapsed") === "true";
  } catch (error) {
    isSidebarCollapsed = false;
  }

  applySidebarState();
}

function toggleSidebar() {
  isSidebarCollapsed = !isSidebarCollapsed;

  try {
    localStorage.setItem("studioPortal.sidebarCollapsed", String(isSidebarCollapsed));
  } catch (error) {
    // Ignore storage issues and still update the UI state.
  }

  applySidebarState();
}

function updateNavState(page) {
  document.querySelectorAll(".nav-item[data-nav]").forEach((btn) => {
    btn.classList.remove("active");
    btn.classList.add("text-cream/70");
    btn.classList.remove("text-cream/90");

    if (btn.dataset.nav === page) {
      btn.classList.add("active", "text-cream/90");
      btn.classList.remove("text-cream/70");
    }
  });
}

function navigateTo(page) {
  currentPage = page;
  renderCurrentPage();
}

function renderCurrentPage() {
  if (typeof isPortalLocked === "function" && isPortalLocked()) {
    applyAdminAccessState();
    return;
  }

  updateNavState(currentPage);
  const pageRenderers = {
    dashboard: typeof renderDashboardPage === "function" ? renderDashboardPage : null,
    operations: typeof renderOperationsPage === "function" ? renderOperationsPage : null,
    students: typeof renderStudentsPage === "function" ? renderStudentsPage : null,
    lessons: typeof renderLessonsPage === "function" ? renderLessonsPage : null,
    schedule: typeof renderSchedulePage === "function" ? renderSchedulePage : null,
    todo: typeof renderTodoPage === "function" ? renderTodoPage : null,
    reports: typeof renderReportsPage === "function" ? renderReportsPage : null,
    automations: typeof renderAutomationsPage === "function" ? renderAutomationsPage : null,
    finance: typeof renderFinancePage === "function" ? renderFinancePage : null,
    notes: typeof renderNotesQueuePage === "function" ? renderNotesQueuePage : null,
    profile: typeof renderProfilePage === "function" ? renderProfilePage : null,
    student_portal: typeof renderStudentPortalPage === "function" ? renderStudentPortalPage : null,
    public: typeof renderPublicPage === "function" ? renderPublicPage : null,
    settings: typeof renderSettingsPage === "function" ? renderSettingsPage : null
  };

  const renderer = pageRenderers[currentPage] || pageRenderers.dashboard;

  try {
    if (typeof renderer !== "function") {
      throw new Error(`No renderer is available for "${currentPage}" right now.`);
    }

    renderer();
  } catch (error) {
    const root = document.getElementById("page-root");
    if (root) {
      root.innerHTML = `
        <div class="p-4 sm:p-6 xl:p-8 w-full">
          <div class="page-empty-state">
            <p class="text-sm font-semibold text-warmblack">This page hit an unexpected error.</p>
            <p class="text-xs text-warmgray mt-2 wrap-anywhere">${String(error?.message || error || "Unknown page error.")}</p>
            <div class="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold" onclick="navigateTo('dashboard')">Go to Dashboard</button>
              <button type="button" class="px-4 py-2.5 rounded-xl bg-white border border-cream text-sm font-medium text-warmblack" onclick="renderCurrentPage()">Retry</button>
            </div>
          </div>
        </div>
      `;
    }

    if (typeof notifyUser === "function") {
      notifyUser({
        title: "Page Error",
        message: `The ${String(currentPage || "current")} page ran into an error: ${String(error?.message || error || "Unknown error")}`,
        tone: "error",
        source: "navigation"
      });
    } else {
      console.error(error);
    }
  }

  const mainEl = document.getElementById("page-root");
  if (mainEl) {
    mainEl.scrollTop = 0;
  }

  lucide.createIcons();
}

function switchProfileTab(tab, clickedButton) {
  const notesEl = document.getElementById("profile-tab-notes");
  const homeworkEl = document.getElementById("profile-tab-homework");
  const materialsEl = document.getElementById("profile-tab-materials");

  if (notesEl) notesEl.style.display = tab === "notes" ? "block" : "none";
  if (homeworkEl) homeworkEl.style.display = tab === "homework" ? "block" : "none";
  if (materialsEl) materialsEl.style.display = tab === "materials" ? "block" : "none";

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active-tab", "text-gold", "border-gold");
    btn.classList.add("text-warmgray", "border-transparent");
  });

  if (clickedButton) {
    clickedButton.classList.add("active-tab", "text-gold", "border-gold");
    clickedButton.classList.remove("text-warmgray", "border-transparent");
  }
}
