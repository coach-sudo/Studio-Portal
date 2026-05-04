const defaultConfig = {
  studio_name: "Stage & Story",
  coach_name: "Darius A. Journigan",
  coach_title: "Acting Coach",
  tagline: "Studio Management",
  background_color: "#f7f3ee",
  surface_color: "#ffffff",
  text_color: "#2d2926",
  primary_action_color: "#c9a84c",
  secondary_action_color: "#8c2f39",
  font_family: "DM Sans",
  font_size: 14,
};

const STUDIO_BRANDING_STORAGE_KEY = "studioPortal.branding";

function loadStudioBranding() {
  try {
    const raw = localStorage.getItem(STUDIO_BRANDING_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function saveStudioBranding(branding = {}) {
  try {
    localStorage.setItem(STUDIO_BRANDING_STORAGE_KEY, JSON.stringify(branding));
    return true;
  } catch (error) {
    return false;
  }
}

function getStudioBranding() {
  return loadStudioBranding();
}

function applyConfig(config = defaultConfig) {
  const studioName = config.studio_name || defaultConfig.studio_name;
  const coachName = config.coach_name || defaultConfig.coach_name;
  const coachTitle = config.coach_title || defaultConfig.coach_title;
  const tagline = config.tagline || defaultConfig.tagline;
  const bg = config.background_color || defaultConfig.background_color;
  const surface = config.surface_color || defaultConfig.surface_color;
  const txt = config.text_color || defaultConfig.text_color;
  const primary = config.primary_action_color || defaultConfig.primary_action_color;
  const secondary = config.secondary_action_color || defaultConfig.secondary_action_color;
  const font = config.font_family || defaultConfig.font_family;
  const fontSize = config.font_size || defaultConfig.font_size;

  const studioNameEl = document.getElementById("sidebar-studio-name");
  const taglineEl = document.getElementById("sidebar-tagline");
  const coachNameEl = document.getElementById("sidebar-coach-name");
  const coachTitleEl = document.getElementById("sidebar-coach-title");
  const dashCoachNameEl = document.getElementById("dash-coach-name");
  const publicStudioNameEl = document.getElementById("public-studio-name");
  const sidebarLogoImageEl = document.getElementById("sidebar-logo-image");
  const sidebarLogoMarkEl = document.getElementById("sidebar-logo-mark");
  const sidebarLogoIconEl = sidebarLogoMarkEl ? sidebarLogoMarkEl.querySelector("[data-lucide='drama']") : null;
  const branding = loadStudioBranding();

  if (studioNameEl) studioNameEl.textContent = studioName;
  if (taglineEl) taglineEl.textContent = tagline;
  if (coachNameEl) coachNameEl.textContent = coachName;
  if (coachTitleEl) coachTitleEl.textContent = coachTitle;
  if (dashCoachNameEl) dashCoachNameEl.textContent = coachName.split(" ")[0];
  if (publicStudioNameEl) publicStudioNameEl.textContent = `${studioName} Studio`;
  if (sidebarLogoImageEl && sidebarLogoMarkEl) {
    const logoUrl = String(branding.logo_url || "").trim();
    if (logoUrl) {
      sidebarLogoImageEl.src = logoUrl;
      sidebarLogoImageEl.classList.remove("hidden");
      if (sidebarLogoIconEl) sidebarLogoIconEl.classList.add("hidden");
      sidebarLogoMarkEl.classList.remove("gold-gradient");
      sidebarLogoMarkEl.classList.add("bg-white");
    } else {
      sidebarLogoImageEl.removeAttribute("src");
      sidebarLogoImageEl.classList.add("hidden");
      if (sidebarLogoIconEl) sidebarLogoIconEl.classList.remove("hidden");
      sidebarLogoMarkEl.classList.add("gold-gradient");
      sidebarLogoMarkEl.classList.remove("bg-white");
    }
  }

  document.body.style.fontFamily = `${font}, DM Sans, sans-serif`;
  document.body.style.fontSize = `${fontSize}px`;
  document.body.style.backgroundColor = bg;
  document.body.style.color = txt;

  document.documentElement.style.setProperty("--surface-color", surface);
  document.documentElement.style.setProperty("--primary-action-color", primary);
  document.documentElement.style.setProperty("--secondary-action-color", secondary);
}

if (window.elementSdk) {
  window.elementSdk.init({
    defaultConfig,
    onConfigChange: async (config) => {
      applyConfig(config);
    },
    mapToCapabilities: (config) => ({
      recolorables: [
        {
          get: () => config.background_color || defaultConfig.background_color,
          set: (v) => {
            config.background_color = v;
            window.elementSdk.setConfig({ background_color: v });
          },
        },
        {
          get: () => config.surface_color || defaultConfig.surface_color,
          set: (v) => {
            config.surface_color = v;
            window.elementSdk.setConfig({ surface_color: v });
          },
        },
        {
          get: () => config.text_color || defaultConfig.text_color,
          set: (v) => {
            config.text_color = v;
            window.elementSdk.setConfig({ text_color: v });
          },
        },
        {
          get: () => config.primary_action_color || defaultConfig.primary_action_color,
          set: (v) => {
            config.primary_action_color = v;
            window.elementSdk.setConfig({ primary_action_color: v });
          },
        },
        {
          get: () => config.secondary_action_color || defaultConfig.secondary_action_color,
          set: (v) => {
            config.secondary_action_color = v;
            window.elementSdk.setConfig({ secondary_action_color: v });
          },
        },
      ],
      borderables: [],
      fontEditable: {
        get: () => config.font_family || defaultConfig.font_family,
        set: (v) => {
          config.font_family = v;
          window.elementSdk.setConfig({ font_family: v });
        },
      },
      fontSizeable: {
        get: () => config.font_size || defaultConfig.font_size,
        set: (v) => {
          config.font_size = v;
          window.elementSdk.setConfig({ font_size: v });
        },
      },
    }),
    mapToEditPanelValues: (config) =>
      new Map([
        ["studio_name", config.studio_name || defaultConfig.studio_name],
        ["coach_name", config.coach_name || defaultConfig.coach_name],
        ["coach_title", config.coach_title || defaultConfig.coach_title],
        ["tagline", config.tagline || defaultConfig.tagline],
      ]),
  });
}
