const DATA_RECORD_SHAPES = {
  students: [
    "student_id",
    "first_name",
    "last_name",
    "full_name",
    "email",
    "phone",
    "timezone",
    "studio_status",
    "billing_model",
    "booking_behavior",
    "lead_source",
    "lead_source_detail",
    "focus_area",
    "actor_page_eligible",
    "actor_profile_id",
    "actor_page_status",
    "default_lesson_rate",
    "custom_balance_due",
    "created_at",
    "updated_at"
  ],
  lessons: [
    "lesson_id",
    "student_id",
    "lesson_status",
    "lesson_type",
    "manual_payment_status",
    "location_type",
    "location_address",
    "topic",
    "scheduled_start",
    "scheduled_end",
    "previous_scheduled_start",
    "previous_scheduled_end",
    "actual_completion_date",
    "cancellation_type",
    "counts_against_package",
    "note_id",
    "join_link",
    "internal_comments",
    "source",
    "external_event_id",
    "source_calendar_id",
    "external_platform_hint",
    "external_event_title",
    "external_contact_name",
    "external_contact_email",
    "external_contact_phone",
    "sync_state",
    "intake_review_state",
    "imported_at",
    "last_synced_at",
    "external_updated_at",
    "intake_conflict_note",
    "pending_external_start",
    "pending_external_end",
    "created_at",
    "updated_at"
  ],
  notes: [
    "note_id",
    "student_id",
    "lesson_id",
    "status",
    "title",
    "body",
    "published_at",
    "archived_at",
    "created_at",
    "updated_at"
  ],
  homework: [
    "homework_id",
    "student_id",
    "lesson_id",
    "title",
    "details",
    "status",
    "due_date",
    "assigned_at",
    "completed_at"
  ],
  packages: [
    "package_id",
    "student_id",
    "package_name",
    "sessions_total",
    "sessions_used",
    "sessions_remaining",
    "package_price",
    "status",
    "expires_on",
    "archived_at",
    "created_at",
    "updated_at"
  ],
  payments: [
    "payment_id",
    "student_id",
    "related_package_id",
    "amount",
    "currency",
    "payment_date",
    "payment_type",
    "status",
    "archived_at",
    "created_at",
    "updated_at"
  ],
  actorProfiles: [
    "actor_profile_id",
    "student_id",
    "slug",
    "status",
    "display_name",
    "bio",
    "updated_at"
  ],
  files: [
    "file_id",
    "student_id",
    "lesson_id",
    "homework_id",
    "file_name",
    "title",
    "source_type",
    "external_url",
    "file_url",
    "mime_type",
    "material_kind",
    "category",
    "scope",
    "visibility",
    "notes",
    "status",
    "uploaded_at"
  ]
};

const DATA_CACHE_STORAGE_KEY = "studioPortal.dataCache.v1";
const DATA_SYNC_QUEUE_STORAGE_KEY = "studioPortal.dataSyncQueue.v1";
const BACKEND_SETTINGS_STORAGE_KEY = "studioPortal.backendSettings";
const DEFAULT_BACKEND_SETTINGS = {
  persistence_mode: "local_cache",
  cache_enabled: true,
  auto_sync: false,
  google_sheets_web_app_url: "",
  api_token: "",
  google_account_email: "coach@d-a-j.com",
  google_sync_mode: "manual",
  gmail_filter_scope: "booking_only",
  import_review_mode: "review_first",
  google_calendar_status: "demo_ready",
  google_gmail_status: "demo_ready",
  google_status_checked_at: "",
  google_status_error: "",
  google_auth_start_url: "",
  google_calendar_last_sync_at: "",
  google_calendar_last_sync_status: "idle",
  google_calendar_last_sync_error: "",
  google_gmail_last_sync_at: "",
  google_gmail_last_sync_status: "idle",
  google_gmail_last_sync_error: "",
  last_sync_at: "",
  last_pull_at: "",
  last_sync_status: "idle",
  last_sync_error: ""
};

function readStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStorageJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}

function sanitizeBackendSettings(settings = {}) {
  return {
    ...DEFAULT_BACKEND_SETTINGS,
    ...settings,
    persistence_mode: ["local_cache", "google_sheets"].includes(settings.persistence_mode) ? settings.persistence_mode : DEFAULT_BACKEND_SETTINGS.persistence_mode,
    cache_enabled: settings.cache_enabled !== false,
    auto_sync: settings.auto_sync === true,
    google_sheets_web_app_url: String(settings.google_sheets_web_app_url || "").trim(),
    api_token: String(settings.api_token || "").trim(),
    google_account_email: String(settings.google_account_email || DEFAULT_BACKEND_SETTINGS.google_account_email).trim(),
    google_sync_mode: String(settings.google_sync_mode || DEFAULT_BACKEND_SETTINGS.google_sync_mode).trim() === "automatic" ? "automatic" : "manual",
    gmail_filter_scope: String(settings.gmail_filter_scope || DEFAULT_BACKEND_SETTINGS.gmail_filter_scope).trim() === "all_mail" ? "all_mail" : "booking_only",
    import_review_mode: String(settings.import_review_mode || DEFAULT_BACKEND_SETTINGS.import_review_mode).trim() === "auto_match" ? "auto_match" : "review_first",
    google_calendar_status: String(settings.google_calendar_status || DEFAULT_BACKEND_SETTINGS.google_calendar_status).trim() || "demo_ready",
    google_gmail_status: String(settings.google_gmail_status || DEFAULT_BACKEND_SETTINGS.google_gmail_status).trim() || "demo_ready",
    google_status_checked_at: String(settings.google_status_checked_at || "").trim(),
    google_status_error: String(settings.google_status_error || "").trim(),
    google_auth_start_url: String(settings.google_auth_start_url || "").trim(),
    google_calendar_last_sync_at: String(settings.google_calendar_last_sync_at || "").trim(),
    google_calendar_last_sync_status: String(settings.google_calendar_last_sync_status || "idle").trim(),
    google_calendar_last_sync_error: String(settings.google_calendar_last_sync_error || "").trim(),
    google_gmail_last_sync_at: String(settings.google_gmail_last_sync_at || "").trim(),
    google_gmail_last_sync_status: String(settings.google_gmail_last_sync_status || "idle").trim(),
    google_gmail_last_sync_error: String(settings.google_gmail_last_sync_error || "").trim(),
    last_sync_at: String(settings.last_sync_at || "").trim(),
    last_pull_at: String(settings.last_pull_at || "").trim(),
    last_sync_status: String(settings.last_sync_status || DEFAULT_BACKEND_SETTINGS.last_sync_status).trim(),
    last_sync_error: String(settings.last_sync_error || "").trim()
  };
}

const appDataStore = {
  students: sampleStudents,
  lessons: sampleLessons,
  notes: sampleNotes,
  homework: sampleHomework,
  packages: samplePackages,
  payments: samplePayments,
  actorProfiles: sampleActorProfiles,
  files: sampleFiles
};

const DATA_COLLECTION_ID_FIELDS = {
  students: "student_id",
  lessons: "lesson_id",
  notes: "note_id",
  homework: "homework_id",
  packages: "package_id",
  payments: "payment_id",
  actorProfiles: "actor_profile_id",
  files: "file_id"
};

let backendSettings = sanitizeBackendSettings(readStorageJson(BACKEND_SETTINGS_STORAGE_KEY, DEFAULT_BACKEND_SETTINGS));
const initialSyncQueue = readStorageJson(DATA_SYNC_QUEUE_STORAGE_KEY, []);
let dataSyncQueue = Array.isArray(initialSyncQueue) ? initialSyncQueue : [];
let backendAutoSyncTimer = null;

function getBackendSettings() {
  return { ...backendSettings };
}

function saveBackendSettings() {
  backendSettings = sanitizeBackendSettings(backendSettings);
  writeStorageJson(BACKEND_SETTINGS_STORAGE_KEY, backendSettings);
  return getBackendSettings();
}

function updateBackendSettings(updates = {}) {
  backendSettings = sanitizeBackendSettings({
    ...backendSettings,
    ...updates
  });
  saveBackendSettings();
  return getBackendSettings();
}

function getDataSyncQueue() {
  return Array.isArray(dataSyncQueue) ? dataSyncQueue.slice() : [];
}

function saveDataSyncQueue() {
  writeStorageJson(DATA_SYNC_QUEUE_STORAGE_KEY, dataSyncQueue);
  return getDataSyncQueue();
}

function clearDataSyncQueue() {
  dataSyncQueue = [];
  saveDataSyncQueue();
}

function enqueueDataSyncOperation(type, collectionKey, recordId = "") {
  dataSyncQueue.push({
    id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: String(type || "update"),
    collection_key: String(collectionKey || ""),
    record_id: String(recordId || ""),
    created_at: new Date().toISOString()
  });
  saveDataSyncQueue();
}

function getDataRecordShapes() {
  return DATA_RECORD_SHAPES;
}

function getDataCollection(key) {
  return appDataStore[key] || [];
}

function replaceDataCollection(key, records) {
  const nextRecords = Array.isArray(records) ? records : [];
  appDataStore[key] = nextRecords;
  return appDataStore[key];
}

function getCollectionIdField(collectionKey) {
  return DATA_COLLECTION_ID_FIELDS[collectionKey] || "id";
}

function cloneRecord(record) {
  return record ? JSON.parse(JSON.stringify(record)) : record;
}

function cloneCollection(records) {
  return Array.isArray(records) ? records.map((record) => cloneRecord(record)) : [];
}

function createDataSnapshot() {
  return Object.keys(appDataStore).reduce((snapshot, key) => {
    snapshot[key] = cloneCollection(getDataCollection(key));
    return snapshot;
  }, {});
}

function persistSnapshotToLocalCache(snapshot = createDataSnapshot()) {
  if (backendSettings.cache_enabled === false) return false;
  return writeStorageJson(DATA_CACHE_STORAGE_KEY, snapshot);
}

function loadCachedDataSnapshot() {
  const snapshot = readStorageJson(DATA_CACHE_STORAGE_KEY, null);
  return snapshot && typeof snapshot === "object" ? snapshot : null;
}

function hydrateDataStore(snapshot) {
  Object.keys(appDataStore).forEach((key) => {
    if (snapshot && key in snapshot) {
      replaceDataCollection(key, cloneCollection(snapshot[key]));
    }
  });

  persistSnapshotToLocalCache(createDataSnapshot());

  if (typeof rebuildStudentViewModels === "function") {
    rebuildStudentViewModels();
  }
  return getDataStore();
}

function getDataStore() {
  return appDataStore;
}

function getGoogleSheetsCollectionBlueprint() {
  return {
    Students: DATA_RECORD_SHAPES.students,
    Lessons: DATA_RECORD_SHAPES.lessons,
    Notes: DATA_RECORD_SHAPES.notes,
    Homework: DATA_RECORD_SHAPES.homework,
    Packages: DATA_RECORD_SHAPES.packages,
    Payments: DATA_RECORD_SHAPES.payments,
    ActorProfiles: DATA_RECORD_SHAPES.actorProfiles,
    Materials: DATA_RECORD_SHAPES.files
  };
}

function getPersistenceStatus() {
  return {
    mode: backendSettings.persistence_mode,
    cache_enabled: backendSettings.cache_enabled,
    auto_sync: backendSettings.auto_sync,
    endpoint_configured: Boolean(backendSettings.google_sheets_web_app_url),
    queue_count: getDataSyncQueue().length,
    last_sync_at: backendSettings.last_sync_at,
    last_pull_at: backendSettings.last_pull_at,
    last_sync_status: backendSettings.last_sync_status,
    last_sync_error: backendSettings.last_sync_error
  };
}

function getFriendlyBackendErrorMessage(error, fallback = "Unable to reach the backend.") {
  const rawMessage = String(error && error.message ? error.message : error || "").trim();

  if (!rawMessage) {
    return fallback;
  }

  if (/failed to fetch/i.test(rawMessage) || /load failed/i.test(rawMessage) || /networkerror/i.test(rawMessage)) {
    return "Browser connection failed. This usually means the portal is trying to call Google Apps Script directly and the browser is blocking it. Use a backend/proxy URL here instead of calling Apps Script from the frontend.";
  }

  return rawMessage;
}

function getBackendRequestHeaders() {
  const headers = {
    "Content-Type": "application/json"
  };

  if (backendSettings.api_token) {
    headers["X-Studio-Token"] = backendSettings.api_token;
  }

  return headers;
}

function resolveBackendUrl(action) {
  const baseUrl = String(backendSettings.google_sheets_web_app_url || "").trim();
  if (!baseUrl) {
    throw new Error("Add your backend or proxy URL in Settings before syncing.");
  }

  const url = new URL(baseUrl);
  if (action) {
    url.searchParams.set("action", action);
  }
  if (backendSettings.api_token) {
    url.searchParams.set("token", backendSettings.api_token);
  }
  return url.toString();
}

async function testStudioBackendConnection() {
  const url = resolveBackendUrl("ping");
  const response = await fetch(url, {
    method: "GET",
    headers: getBackendRequestHeaders()
  });

  if (!response.ok) {
    throw new Error(`Backend connection failed (${response.status}).`);
  }

  const payload = await response.json().catch(() => ({}));
  updateBackendSettings({
    last_sync_status: "connected",
    last_sync_error: ""
  });
  return payload;
}

async function pushSnapshotToStudioBackend(snapshot = createDataSnapshot()) {
  const url = resolveBackendUrl("push_snapshot");
  const response = await fetch(url, {
    method: "POST",
    headers: getBackendRequestHeaders(),
    body: JSON.stringify({
      action: "push_snapshot",
      token: backendSettings.api_token || "",
      snapshot,
      shapes: getGoogleSheetsCollectionBlueprint()
    })
  });

  if (!response.ok) {
    throw new Error(`Push failed (${response.status}).`);
  }

  return response.json().catch(() => ({ ok: true }));
}

async function pullSnapshotFromStudioBackend() {
  const url = resolveBackendUrl("snapshot");
  const response = await fetch(url, {
    method: "GET",
    headers: getBackendRequestHeaders()
  });

  if (!response.ok) {
    throw new Error(`Snapshot pull failed (${response.status}).`);
  }

  const payload = await response.json();
  const snapshot = payload?.snapshot || payload?.data || payload;

  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Backend snapshot response was not valid.");
  }

  return snapshot;
}

async function getGoogleIntegrationStatusFromBackend() {
  const url = resolveBackendUrl("google_status");
  const response = await fetch(url, {
    method: "GET",
    headers: getBackendRequestHeaders()
  });

  if (!response.ok) {
    throw new Error(`Google status check failed (${response.status}).`);
  }

  const payload = await response.json().catch(() => ({}));
  const google = payload?.google || payload || {};
  const calendar = google.calendar || {};
  const gmail = google.gmail || {};

  updateBackendSettings({
    google_account_email: String(google.account_email || backendSettings.google_account_email || "").trim(),
    google_sync_mode: String(google.sync_mode || backendSettings.google_sync_mode || "manual").trim() === "automatic" ? "automatic" : "manual",
    gmail_filter_scope: String(google.gmail_filter_scope || backendSettings.gmail_filter_scope || "booking_only").trim() === "all_mail" ? "all_mail" : "booking_only",
    import_review_mode: String(google.import_review_mode || backendSettings.import_review_mode || "review_first").trim() === "auto_match" ? "auto_match" : "review_first",
    google_calendar_status: String(calendar.status || backendSettings.google_calendar_status || "demo_ready").trim(),
    google_gmail_status: String(gmail.status || backendSettings.google_gmail_status || "demo_ready").trim(),
    google_auth_start_url: String(google.auth_start_url || backendSettings.google_auth_start_url || "").trim(),
    google_status_checked_at: new Date().toISOString(),
    google_status_error: String(google.error || "").trim()
  });

  return google;
}

async function runGoogleCalendarBackendSync() {
  const url = resolveBackendUrl("calendar_sync");
  const response = await fetch(url, {
    method: "POST",
    headers: getBackendRequestHeaders(),
    body: JSON.stringify({
      action: "calendar_sync",
      token: backendSettings.api_token || "",
      account_email: backendSettings.google_account_email || "",
      sync_mode: backendSettings.google_sync_mode || "manual",
      import_mode: "lesson_like_only",
      window: {
        past_days: 30,
        future_days: 60
      }
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.ok === false) {
    const message = payload?.error || `Google Calendar sync failed (${response.status}).`;
    updateBackendSettings({
      google_calendar_last_sync_status: "error",
      google_calendar_last_sync_error: message
    });
    throw new Error(message);
  }

  updateBackendSettings({
    google_calendar_status: String(payload?.google?.calendar?.status || payload?.status || backendSettings.google_calendar_status || "demo_ready").trim(),
    google_calendar_last_sync_at: new Date().toISOString(),
    google_calendar_last_sync_status: String(payload?.status || "success").trim(),
    google_calendar_last_sync_error: ""
  });

  return payload;
}

async function runGmailBackendSync() {
  const url = resolveBackendUrl("gmail_sync");
  const response = await fetch(url, {
    method: "POST",
    headers: getBackendRequestHeaders(),
    body: JSON.stringify({
      action: "gmail_sync",
      token: backendSettings.api_token || "",
      account_email: backendSettings.google_account_email || "",
      sync_mode: backendSettings.google_sync_mode || "manual",
      gmail_filter_scope: backendSettings.gmail_filter_scope || "booking_only",
      import_review_mode: backendSettings.import_review_mode || "review_first"
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.ok === false) {
    const message = payload?.error || `Gmail sync failed (${response.status}).`;
    updateBackendSettings({
      google_gmail_last_sync_status: "error",
      google_gmail_last_sync_error: message
    });
    throw new Error(message);
  }

  updateBackendSettings({
    google_gmail_status: String(payload?.google?.gmail?.status || payload?.status || backendSettings.google_gmail_status || "demo_ready").trim(),
    google_gmail_last_sync_at: new Date().toISOString(),
    google_gmail_last_sync_status: String(payload?.status || "success").trim(),
    google_gmail_last_sync_error: ""
  });

  return payload;
}

async function syncStudioDataToBackend(options = {}) {
  const { silent = false } = options;

  if (backendSettings.persistence_mode !== "google_sheets") {
    persistSnapshotToLocalCache(createDataSnapshot());
    updateBackendSettings({
      last_sync_status: "local-only",
      last_sync_error: ""
    });
    return {
      ok: true,
      mode: "local_cache",
      queue_count: getDataSyncQueue().length
    };
  }

  try {
    const payload = await pushSnapshotToStudioBackend(createDataSnapshot());
    clearDataSyncQueue();
    updateBackendSettings({
      last_sync_at: new Date().toISOString(),
      last_sync_status: "success",
      last_sync_error: ""
    });
    return {
      ok: true,
      mode: "google_sheets",
      payload
    };
  } catch (error) {
    updateBackendSettings({
      last_sync_status: silent ? "retry-pending" : "error",
      last_sync_error: getFriendlyBackendErrorMessage(error, "Unable to sync to Google Sheets.")
    });
    return {
      ok: false,
      error: getFriendlyBackendErrorMessage(error, "Unable to sync to Google Sheets.")
    };
  }
}

async function pullStudioDataFromBackend() {
  const snapshot = await pullSnapshotFromStudioBackend();
  hydrateDataStore(snapshot);
  clearDataSyncQueue();
  updateBackendSettings({
    last_pull_at: new Date().toISOString(),
    last_sync_status: "pulled",
    last_sync_error: ""
  });
  return snapshot;
}

function requestAutoSync() {
  if (!backendSettings.auto_sync || backendSettings.persistence_mode !== "google_sheets" || !backendSettings.google_sheets_web_app_url) {
    return;
  }

  if (backendAutoSyncTimer) {
    clearTimeout(backendAutoSyncTimer);
  }

  backendAutoSyncTimer = setTimeout(() => {
    syncStudioDataToBackend({ silent: true });
    backendAutoSyncTimer = null;
  }, 900);
}

function handleDataMutation(type, collectionKey, recordId = "") {
  persistSnapshotToLocalCache(createDataSnapshot());
  enqueueDataSyncOperation(type, collectionKey, recordId);
  requestAutoSync();
}

function initializeStudioPersistence() {
  const cachedSnapshot = loadCachedDataSnapshot();
  if (cachedSnapshot) {
    Object.keys(appDataStore).forEach((key) => {
      if (cachedSnapshot && key in cachedSnapshot) {
        replaceDataCollection(key, cloneCollection(cachedSnapshot[key]));
      }
    });
  } else {
    persistSnapshotToLocalCache(createDataSnapshot());
  }

  return getPersistenceStatus();
}

function createInMemoryDataAdapter() {
  return {
    id: "memory",
    loadSnapshot() {
      return createDataSnapshot();
    },
    replaceCollection(collectionKey, records) {
      const nextCollection = replaceDataCollection(collectionKey, records);
      handleDataMutation("replace_collection", collectionKey, "");
      return nextCollection;
    },
    insert(collectionKey, record, options = {}) {
      const collection = getDataCollection(collectionKey);
      if (options.prepend === false) {
        collection.push(record);
      } else {
        collection.unshift(record);
      }
      handleDataMutation("insert", collectionKey, record?.[getCollectionIdField(collectionKey)] || "");
      return record;
    },
    update(collectionKey, recordId, updates) {
      const idField = getCollectionIdField(collectionKey);
      const record = findRecordById(collectionKey, idField, recordId);
      if (!record) return null;

      Object.assign(record, updates);
      handleDataMutation("update", collectionKey, recordId);
      return record;
    },
    replace(collectionKey, recordId, nextRecord) {
      const idField = getCollectionIdField(collectionKey);
      const collection = getDataCollection(collectionKey);
      const index = collection.findIndex((record) => record[idField] === recordId);
      if (index === -1) return null;

      collection[index] = nextRecord;
      handleDataMutation("replace", collectionKey, recordId);
      return collection[index];
    },
    remove(collectionKey, recordId) {
      const idField = getCollectionIdField(collectionKey);
      const collection = getDataCollection(collectionKey);
      const index = collection.findIndex((record) => record[idField] === recordId);
      if (index === -1) return null;

      const [removed] = collection.splice(index, 1);
      handleDataMutation("remove", collectionKey, recordId);
      return removed || null;
    }
  };
}

let activeDataAdapter = createInMemoryDataAdapter();

function getDataAdapter() {
  return activeDataAdapter;
}

function setDataAdapter(adapter) {
  activeDataAdapter = adapter || createInMemoryDataAdapter();
  return activeDataAdapter;
}

function replaceCollectionRecords(collectionKey, records) {
  return getDataAdapter().replaceCollection(collectionKey, records);
}

function insertRecord(collectionKey, record, options = {}) {
  return getDataAdapter().insert(collectionKey, record, options);
}

function patchRecordById(collectionKey, recordId, updates) {
  return getDataAdapter().update(collectionKey, recordId, updates);
}

function replaceRecordById(collectionKey, recordId, nextRecord) {
  return getDataAdapter().replace(collectionKey, recordId, nextRecord);
}

function removeRecordById(collectionKey, recordId) {
  return getDataAdapter().remove(collectionKey, recordId);
}

function createStudioDataService() {
  return {
    getRecordShapes: getDataRecordShapes,
    getAdapter: getDataAdapter,
    setAdapter: setDataAdapter,
    getSnapshot: createDataSnapshot,
    hydrate: hydrateDataStore,
    initializePersistence: initializeStudioPersistence,
    getBackendSettings,
    updateBackendSettings,
    getPersistenceStatus,
    getSyncQueue: getDataSyncQueue,
    syncToBackend: syncStudioDataToBackend,
    pullFromBackend: pullStudioDataFromBackend,
    testBackendConnection: testStudioBackendConnection,
    getGoogleStatus: getGoogleIntegrationStatusFromBackend,
    runGoogleCalendarSync: runGoogleCalendarBackendSync,
    runGmailSync: runGmailBackendSync,
    getGoogleSheetsBlueprint: getGoogleSheetsCollectionBlueprint,
    list(collectionKey) {
      return getDataCollection(collectionKey);
    },
    get(collectionKey, recordId) {
      const idField = getCollectionIdField(collectionKey);
      return findRecordById(collectionKey, idField, recordId);
    },
    insert(collectionKey, record, options = {}) {
      return insertRecord(collectionKey, record, options);
    },
    update(collectionKey, recordId, updates) {
      return patchRecordById(collectionKey, recordId, updates);
    },
    replace(collectionKey, recordId, nextRecord) {
      return replaceRecordById(collectionKey, recordId, nextRecord);
    },
    remove(collectionKey, recordId) {
      return removeRecordById(collectionKey, recordId);
    },
    replaceCollection(collectionKey, records) {
      return replaceCollectionRecords(collectionKey, records);
    }
  };
}

const studioDataService = createStudioDataService();

function getStudentRecords() {
  return getDataCollection("students");
}

function getLessonRecords() {
  return getDataCollection("lessons");
}

function getNoteRecords() {
  return getDataCollection("notes");
}

function getHomeworkRecords() {
  return getDataCollection("homework");
}

function getPackageRecords() {
  return getDataCollection("packages");
}

function getPaymentRecords() {
  return getDataCollection("payments");
}

function getActorProfileRecords() {
  return getDataCollection("actorProfiles");
}

function getFileRecords() {
  return getDataCollection("files");
}

function findRecordById(collectionKey, fieldName, value) {
  return getDataCollection(collectionKey).find((record) => record[fieldName] === value) || null;
}

function getInitials(firstName = "", lastName = "") {
  const first = firstName.trim().charAt(0);
  const last = lastName.trim().charAt(0);
  return `${first}${last}`.toUpperCase();
}

function normalizeStudentStatus(student, pkg) {
  const studioStatus = (student.studio_status || "").toLowerCase();

  if (studioStatus === "inactive" || studioStatus === "paused" || studioStatus === "alumni") {
    return "inactive";
  }

  if (pkg && typeof pkg.sessions_remaining === "number" && pkg.sessions_remaining <= 1) {
    return "expiring";
  }

  return "active";
}

function getStudentPackage(studentId) {
  return getPackageRecords().find((pkg) => pkg.student_id === studentId) || null;
}

function getStudentLastLesson(studentId) {
  const completedLessons = getLessonRecords()
    .filter(
      (lesson) =>
        lesson.student_id === studentId &&
        (typeof doesLessonRequireNotes === "function"
          ? doesLessonRequireNotes(lesson)
          : lesson.lesson_status === "COMPLETED") &&
        lesson.scheduled_start
    )
    .sort(
      (a, b) => new Date(b.scheduled_start).getTime() - new Date(a.scheduled_start).getTime()
    );

  return completedLessons[0] || null;
}

function formatShortDate(dateString) {
  if (!dateString) return "—";

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

function buildStudents() {
  return getStudentRecords().map((student) => {
    const pkg = getStudentPackage(student.student_id);
    const lastLesson = getStudentLastLesson(student.student_id);
    const status = normalizeStudentStatus(student, pkg);

    return {
      id: student.student_id,
      name: student.full_name,
      initials: getInitials(student.first_name, student.last_name),
      focus: student.focus_area || "General Coaching",
      status,
      sessions: pkg ? pkg.sessions_remaining : 0,
      lastSeen: lastLesson ? formatShortDate(lastLesson.scheduled_start) : "—",
      pkg: pkg ? pkg.package_name : "No Active Package",
      email: student.email || "",
      studioStatus: student.studio_status || "",
      billingModel: student.billing_model || "",
      bookingBehavior: student.booking_behavior || "",
      leadSource: student.lead_source || "",
      leadSourceDetail: student.lead_source_detail || "",
      actorProfileId: student.actor_profile_id || null,
      createdAt: student.created_at || ""
    };
  });
}

let students = buildStudents();
let currentFilter = "all";

function rebuildStudentViewModels() {
  students = buildStudents();
}
