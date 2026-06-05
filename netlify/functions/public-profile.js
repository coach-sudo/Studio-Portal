const fs = require("fs");
const path = require("path");
const vm = require("vm");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function getAppsScriptUrl() {
  return getEnv("GOOGLE_APPS_SCRIPT_URL") || getEnv("NETLIFY_GAS_URL");
}

function getAppsScriptToken() {
  return getEnv("GOOGLE_APPS_SCRIPT_TOKEN") || getEnv("STUDIO_PORTAL_TOKEN");
}

function getPublicProfileFetchTimeoutMs() {
  const value = Number(getEnv("PUBLIC_PROFILE_FETCH_TIMEOUT_MS", "8000"));
  return Number.isFinite(value) && value >= 1000 ? value : 8000;
}

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
}

function loadLocalSampleSnapshot() {
  const schemaPath = path.resolve(__dirname, "../../assets/js/schema.js");
  const source = fs.readFileSync(schemaPath, "utf8");
  const script = new vm.Script(`${source}
    ;({
      students: sampleStudents,
      actorProfiles: sampleActorProfiles,
      files: sampleFiles
    });`);
  return script.runInNewContext({ console, Date, Math, JSON });
}

async function fetchAppsScriptSnapshot() {
  const baseUrl = getAppsScriptUrl();
  if (!baseUrl) return null;
  const url = new URL(baseUrl);
  url.searchParams.set("action", "snapshot");
  const token = getAppsScriptToken();
  if (token) url.searchParams.set("token", token);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getPublicProfileFetchTimeoutMs());
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload || payload.ok === false) {
    throw new Error(payload.error || "Unable to load public profile snapshot.");
  }
  return payload.snapshot || payload.data || null;
}

async function loadTrustedSnapshot() {
  const remote = await fetchAppsScriptSnapshot().catch(() => null);
  return remote || loadLocalSampleSnapshot();
}

function getMaterialSourceUrl(file) {
  return String(file && (file.external_url || file.file_url) || "").trim();
}

function isApprovedPublicMaterial(file) {
  if (!file) return false;
  const status = String(file.status || "").toLowerCase();
  const review = String(file.public_page_status || "").toUpperCase();
  const scope = String(file.scope || "").toUpperCase();
  const visibility = String(file.visibility || "").toUpperCase();
  return status !== "vaulted" &&
    status !== "archived" &&
    scope === "ACTOR_MATERIAL" &&
    visibility === "STUDENT_VISIBLE" &&
    review === "APPROVED" &&
    Boolean(getMaterialSourceUrl(file) || String(file.title || file.file_name || "").trim());
}

function sanitizeMaterial(file) {
  return {
    file_id: file.file_id,
    title: file.title || file.file_name || "Material",
    category: file.category || file.material_kind || "Material",
    source_type: file.source_type || "",
    url: getMaterialSourceUrl(file),
    mime_type: file.mime_type || "",
    material_kind: file.material_kind || "",
    featured: file.public_page_featured || "",
    uploaded_at: file.uploaded_at || ""
  };
}

function buildPublicProfile(snapshot, slug) {
  const normalizedSlug = normalizeSlug(slug);
  const profile = (snapshot.actorProfiles || []).find((row) => normalizeSlug(row.slug) === normalizedSlug);
  if (!profile || String(profile.status || "").toLowerCase() !== "active") return null;

  const student = (snapshot.students || []).find((row) => row.student_id === profile.student_id);
  if (!student || student.actor_page_eligible !== true) return null;

  const materials = (snapshot.files || [])
    .filter((file) => file.student_id === student.student_id)
    .filter(isApprovedPublicMaterial)
    .sort((a, b) => new Date(b.uploaded_at || 0).getTime() - new Date(a.uploaded_at || 0).getTime())
    .map(sanitizeMaterial);

  return {
    slug: profile.slug,
    display_name: profile.display_name || student.full_name || [student.first_name, student.last_name].filter(Boolean).join(" "),
    bio: profile.bio || "",
    location: profile.location || "",
    height: profile.height || "",
    weight: profile.weight || "",
    eye_color: profile.eye_color || "",
    hair_color: profile.hair_color || "",
    background_color: profile.background_color || "#ffffff",
    contact_email: student.preferred_contact_email || student.email || "",
    headshot_file_id: profile.headshot_file_id || "",
    materials
  };
}

exports.handler = async function (event) {
  try {
    const slug = normalizeSlug(event.queryStringParameters && event.queryStringParameters.slug);
    if (!slug) return json(400, { ok: false, error: "Profile slug is required." });
    const snapshot = await loadTrustedSnapshot();
    const profile = buildPublicProfile(snapshot, slug);
    if (!profile) return json(404, { ok: false, error: "Public profile not found." });
    return json(200, { ok: true, profile });
  } catch (error) {
    return json(500, {
      ok: false,
      error: String(error && error.message ? error.message : error || "Unable to load public profile.")
    });
  }
};
