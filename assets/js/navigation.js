let currentPage = "dashboard";
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
  updateNavState(currentPage);

  if (currentPage === "dashboard") {
    renderDashboardPage();
  }

  if (currentPage === "students") {
    renderStudentsPage();
  }

  if (currentPage === "lessons") {
    renderLessonsPage();
  }

  if (currentPage === "schedule") {
    renderSchedulePage();
  }

  if (currentPage === "automations") {
    renderAutomationsPage();
  }

  if (currentPage === "finance") {
    renderFinancePage();
  }

  if (currentPage === "notes") {
    renderNotesQueuePage();
  }

  if (currentPage === "profile") {
    renderProfilePage();
  }

  if (currentPage === "public") {
    renderPublicPage();
  }

  if (currentPage === "settings") {
    renderSettingsPage();
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
