let currentPage = "operations";
let isSidebarCollapsed = false;
let globalLoadingCount = 0;

function navEscapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

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
  closeCommandPalette();
  setGlobalLoading(true);
  window.setTimeout(() => setGlobalLoading(false), 180);
  renderCurrentPage();
}

function setGlobalLoading(isLoading) {
  globalLoadingCount = Math.max(0, globalLoadingCount + (isLoading ? 1 : -1));
  const indicator = document.getElementById("global-loading-indicator");
  if (indicator) indicator.classList.toggle("is-visible", globalLoadingCount > 0);
}

function installGlobalLoadingFetch() {
  if (window.__studioPortalLoadingFetchInstalled || typeof window.fetch !== "function") return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    setGlobalLoading(true);
    try {
      return await nativeFetch(...args);
    } finally {
      setGlobalLoading(false);
    }
  };
  window.__studioPortalLoadingFetchInstalled = true;
}

function getCommandPaletteActions() {
  return [
    { label: "Home", detail: "Triage board for what needs attention now", icon: "clipboard-list", action: () => navigateTo("operations") },
    { label: "Today", detail: "Daily teaching, prep, and follow-up flow", icon: "sun", action: () => navigateTo("today") },
    { label: "Students", detail: "Student hubs and account controls", icon: "users", action: () => navigateTo("students") },
    { label: "Lessons", detail: "Lesson list, notes, homework, comments", icon: "calendar-days", action: () => navigateTo("lessons") },
    { label: "Notes", detail: "Draft, published, and follow-up notes", icon: "file-text", action: () => navigateTo("notes") },
    { label: "Materials", detail: "Current work and vaulted studio materials", icon: "folder-open", action: () => navigateTo("materials") },
    { label: "Payments", detail: "Packages, balances, and Stripe renewal state", icon: "wallet", action: () => navigateTo("finance") },
    { label: "Actor Pages", detail: "Actor page lifecycle and public materials", icon: "globe", action: () => navigateTo("public") },
    { label: "Settings", detail: "Studio identity, integrations, student visibility", icon: "settings", action: () => navigateTo("settings") },
    { label: "Open Student Portal", detail: "/portal workspace students use", icon: "graduation-cap", action: () => window.open("/portal", "_blank", "noopener") },
    { label: "Copy Student Portal Link", detail: `${window.location.origin}/portal`, icon: "copy", action: async () => {
      try { await navigator.clipboard.writeText(`${window.location.origin}/portal`); } catch (error) {}
      closeCommandPalette();
      if (typeof notifyUser === "function") notifyUser({ title: "Portal Link", message: "Student portal link copied.", tone: "success", source: "navigation" });
    } }
  ];
}

function renderCommandPalette(filter = "") {
  const root = document.getElementById("command-palette-root");
  if (!root) return;
  const query = String(filter || "").trim().toLowerCase();
  const actions = getCommandPaletteActions().filter((item) => {
    const haystack = `${item.label} ${item.detail}`.toLowerCase();
    return !query || haystack.includes(query);
  });

  root.innerHTML = `
    <div class="command-palette-backdrop" onclick="closeCommandPalette()">
      <section class="command-palette" onclick="event.stopPropagation()">
        <div class="command-palette-search">
          <i data-lucide="search" class="w-4 h-4 text-warmgray"></i>
          <input id="command-palette-input" value="${navEscapeHtml(filter)}" placeholder="Search pages, flows, or student portal..." oninput="renderCommandPalette(this.value)" />
          <button type="button" onclick="closeCommandPalette()" aria-label="Close quick switcher">Esc</button>
        </div>
        <div class="command-palette-list">
          ${actions.length ? actions.map((item, index) => `
            <button type="button" class="command-palette-item" onclick="getCommandPaletteActions().find((action) => action.label === '${navEscapeHtml(item.label)}').action()">
              <span class="command-palette-icon"><i data-lucide="${navEscapeHtml(item.icon)}" class="w-4 h-4"></i></span>
              <span class="min-w-0">
                <span class="command-palette-title">${navEscapeHtml(item.label)}</span>
                <span class="command-palette-detail">${navEscapeHtml(item.detail)}</span>
              </span>
              <span class="command-palette-key">${index + 1}</span>
            </button>
          `).join("") : `<div class="command-palette-empty">No matching flow</div>`}
        </div>
      </section>
    </div>
  `;

  const input = document.getElementById("command-palette-input");
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  lucide.createIcons();
}

function openCommandPalette() {
  renderCommandPalette("");
}

function closeCommandPalette() {
  const root = document.getElementById("command-palette-root");
  if (root) root.innerHTML = "";
}

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isTyping = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (event.key === "Escape") closeCommandPalette();
  if (!isTyping && event.key === "/" && !document.getElementById("command-palette-input")) {
    event.preventDefault();
    openCommandPalette();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  installGlobalLoadingFetch();
  const quickButton = document.getElementById("quick-switcher-button");
  if (quickButton && quickButton.tagName === "BUTTON") quickButton.addEventListener("click", openCommandPalette);
});

window.navigateTo = navigateTo;
window.renderCurrentPage = renderCurrentPage;
window.openCommandPalette = openCommandPalette;
window.closeCommandPalette = closeCommandPalette;
window.renderCommandPalette = renderCommandPalette;
window.setGlobalLoading = setGlobalLoading;
window.getCommandPaletteActions = getCommandPaletteActions;

function renderCurrentPage() {
  if (typeof isPortalLocked === "function" && isPortalLocked()) {
    applyAdminAccessState();
    return;
  }

  updateNavState(currentPage);
  const pageRenderers = {
    dashboard: typeof renderDashboardPage === "function" ? renderDashboardPage : null,
    operations: typeof renderOperationsPage === "function" ? renderOperationsPage : null,
    today: typeof renderTodayPage === "function" ? renderTodayPage : (typeof renderTodoPage === "function" ? renderTodoPage : null),
    students: typeof renderStudentsPage === "function" ? renderStudentsPage : null,
    lessons: typeof renderLessonsPage === "function" ? renderLessonsPage : null,
    schedule: typeof renderSchedulePage === "function" ? renderSchedulePage : null,
    todo: typeof renderTodoPage === "function" ? renderTodoPage : null,
    reports: typeof renderReportsPage === "function" ? renderReportsPage : null,
    automations: typeof renderAutomationsPage === "function" ? renderAutomationsPage : null,
    finance: typeof renderFinancePage === "function" ? renderFinancePage : null,
    notes: typeof renderNotesQueuePage === "function" ? renderNotesQueuePage : null,
    materials: typeof renderMaterialsPage === "function" ? renderMaterialsPage : null,
    profile: typeof renderProfilePage === "function" ? renderProfilePage : null,
    student_portal: typeof renderStudentPortalPage === "function" ? renderStudentPortalPage : null,
    public: typeof renderPublicPage === "function" ? renderPublicPage : null,
    settings: typeof renderSettingsPage === "function" ? renderSettingsPage : null
  };

  const renderer = pageRenderers[currentPage] || pageRenderers.operations || pageRenderers.dashboard;

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
              <button type="button" class="px-4 py-2.5 rounded-xl gold-gradient text-warmblack text-sm font-semibold" onclick="navigateTo('operations')">Go to Home</button>
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
  if (homeworkEl) homeworkEl.style.display = tab === "homework" || tab === "current" ? "block" : "none";
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
