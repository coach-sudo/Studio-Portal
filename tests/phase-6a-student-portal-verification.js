const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const authFunction = require("../netlify/functions/student-auth.js");
const publicProfileFunction = require("../netlify/functions/public-profile.js");

const LOCAL_SECRET = "phase-6a-local-secret-for-verification";
const LOCAL_ACCESS_CODE = "phase-6a-code";
const LOCAL_ADMIN_TOKEN = "phase-6a-admin";
const SESSION_COOKIE_NAME = "studio_student_session";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSampleSnapshot() {
  const schemaPath = path.resolve(__dirname, "../assets/js/schema.js");
  const source = fs.readFileSync(schemaPath, "utf8");
  const script = new vm.Script(`${source}
    ;({
      students: sampleStudents,
      lessons: sampleLessons,
      notes: sampleNotes,
      homework: sampleHomework,
      packages: samplePackages,
      payments: samplePayments,
      actorProfiles: sampleActorProfiles,
      files: sampleFiles,
      studentAccounts: typeof sampleStudentAccounts !== "undefined" ? sampleStudentAccounts : [],
      readerRequests: typeof sampleReaderRequests !== "undefined" ? sampleReaderRequests : [],
      lessonComments: typeof sampleLessonComments !== "undefined" ? sampleLessonComments : []
    });`);
  return script.runInNewContext({ console, Date, Math, JSON });
}

function resetEnv() {
  delete process.env.STUDENT_PORTAL_SESSION_SECRET;
  delete process.env.STUDENT_PORTAL_ACCESS_CODE;
  delete process.env.STUDENT_PORTAL_SESSION_MINUTES;
  delete process.env.STUDENT_PORTAL_ADMIN_TOKEN;
  delete process.env.GOOGLE_APPS_SCRIPT_URL;
  delete process.env.GOOGLE_APPS_SCRIPT_TOKEN;
  delete process.env.NETLIFY_GAS_URL;
  delete process.env.STUDIO_PORTAL_TOKEN;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
}

function configureLocalAuth() {
  process.env.STUDENT_PORTAL_SESSION_SECRET = LOCAL_SECRET;
  process.env.STUDENT_PORTAL_ACCESS_CODE = LOCAL_ACCESS_CODE;
  process.env.STUDENT_PORTAL_SESSION_MINUTES = "120";
  process.env.STUDENT_PORTAL_ADMIN_TOKEN = LOCAL_ADMIN_TOKEN;
}

function buildEvent(method, action, body = null, cookie = "") {
  const isGet = method === "GET";
  return {
    httpMethod: method,
    headers: cookie ? { cookie } : {},
    queryStringParameters: isGet ? { action } : {},
    body: isGet ? "" : JSON.stringify({ action, ...(body || {}) })
  };
}

async function invoke(method, action, body = null, cookie = "") {
  const response = await authFunction.handler(buildEvent(method, action, body, cookie));
  const payload = JSON.parse(response.body || "{}");
  return { ...response, payload };
}

async function invokePublicProfile(slug) {
  const response = await publicProfileFunction.handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: { slug },
    body: ""
  });
  return {
    ...response,
    payload: JSON.parse(response.body || "{}")
  };
}

function getSessionCookie(response) {
  const setCookie = response.headers && response.headers["Set-Cookie"];
  assert(setCookie, "Expected Set-Cookie header");
  return setCookie.split(";")[0];
}

async function login(email, accessCode = LOCAL_ACCESS_CODE) {
  const response = await invoke("POST", "login", { email, access_code: accessCode });
  assert.strictEqual(response.statusCode, 200, `Login failed for ${email}: ${response.body}`);
  return {
    response,
    cookie: getSessionCookie(response)
  };
}

function installSnapshotBackend(initialSnapshot) {
  process.env.GOOGLE_APPS_SCRIPT_URL = "https://phase-6a.local/apps-script";
  let snapshot = deepClone(initialSnapshot);
  let pushedSnapshot = null;
  const originalFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    if (method === "GET") {
      return {
        ok: true,
        json: async () => ({ ok: true, snapshot: deepClone(snapshot) })
      };
    }

    if (method === "POST") {
      const body = JSON.parse(String(options.body || "{}"));
      pushedSnapshot = deepClone(body.snapshot);
      snapshot = deepClone(body.snapshot);
      return {
        ok: true,
        json: async () => ({ ok: true, updatedAt: new Date().toISOString() })
      };
    }

    throw new Error(`Unexpected fake backend request: ${method} ${url}`);
  };

  return {
    get snapshot() {
      return snapshot;
    },
    get pushedSnapshot() {
      return pushedSnapshot;
    },
    restore() {
      global.fetch = originalFetch;
    }
  };
}

function assertScopedToStudent(data, studentId) {
  assert(data.student, "Expected scoped student");
  assert.strictEqual(data.student.student_id, studentId);
  ["lessons", "notes", "homework", "packages", "payments", "materials", "lessonComments"].forEach((key) => {
    assert(Array.isArray(data[key]), `Expected ${key} array`);
    data[key].forEach((record) => {
      assert.strictEqual(record.student_id, studentId, `${key} leaked another student record`);
    });
  });
}

function assertPortalVisibilityRules(data) {
  data.notes.forEach((note) => {
    assert.strictEqual(String(note.status || "").toUpperCase(), "PUBLISHED", "Draft note leaked to portal");
  });

  data.materials.forEach((file) => {
    const visibility = String(file.visibility || "").toUpperCase();
    const submittedByPortal = String(file.submitted_by || "").toUpperCase() === "STUDENT_PORTAL";
    const reviewState = String(file.public_page_status || "").toUpperCase();
    assert(
      visibility === "STUDENT_VISIBLE" || (submittedByPortal && ["PENDING_REVIEW", "REJECTED"].includes(reviewState)),
      "Admin-only material leaked to portal"
    );
  });

  data.payments.forEach((payment) => {
    assert.notStrictEqual(String(payment.review_state || "").toUpperCase(), "NEEDS_REVIEW", "Review payment leaked to portal");
  });
}

async function runLocalAuthChecks() {
  resetEnv();
  let response = await invoke("POST", "login", {
    email: "maya@example.com",
    access_code: LOCAL_ACCESS_CODE
  });
  assert.strictEqual(response.statusCode, 500);
  assert.match(response.payload.error, /STUDENT_PORTAL_SESSION_SECRET/);

  configureLocalAuth();
  response = await invoke("POST", "login", {
    email: "maya@example.com",
    access_code: "wrong-code"
  });
  assert.strictEqual(response.statusCode, 401);
  assert.match(response.payload.error, /Invalid access code/);

  const studentLogin = await login("maya@example.com");
  assert.strictEqual(studentLogin.response.payload.identity.role, "STUDENT");
  assert.strictEqual(studentLogin.response.payload.identity.student_id, "STU-000001");

  response = await invoke("GET", "session", null, studentLogin.cookie);
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.payload.identity.student_id, "STU-000001");

  response = await invoke("GET", "portal_data", null, studentLogin.cookie);
  assert.strictEqual(response.statusCode, 200);
  assertScopedToStudent(response.payload.data, "STU-000001");
  assertPortalVisibilityRules(response.payload.data);
  assert.strictEqual(response.payload.data.permissions.finance, true);

  const guardianLogin = await login("jin.guardian@example.com");
  assert.strictEqual(guardianLogin.response.payload.identity.role, "GUARDIAN");
  response = await invoke("GET", "portal_data", null, guardianLogin.cookie);
  assert.strictEqual(response.statusCode, 200);
  assertScopedToStudent(response.payload.data, "STU-000001");
  assert.strictEqual(response.payload.data.permissions.finance, false);

  response = await invoke("POST", "logout", {}, studentLogin.cookie);
  assert.strictEqual(response.statusCode, 200);
  assert.match(response.headers["Set-Cookie"], /Max-Age=0/);
}

async function runLocalMutationChecks() {
  resetEnv();
  configureLocalAuth();
  const backend = installSnapshotBackend(loadSampleSnapshot());

  try {
    const { cookie } = await login("maya@example.com");

    let response = await invoke("POST", "update_homework", {
      homework_id: "HW-2026-000001",
      completed: true
    }, cookie);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(
      backend.snapshot.homework.find((item) => item.homework_id === "HW-2026-000001").status,
      "COMPLETED"
    );

    response = await invoke("POST", "update_homework", {
      homework_id: "HW-2026-000002",
      completed: true
    }, cookie);
    assert.strictEqual(response.statusCode, 404);
    assert.match(response.payload.error, /Homework item not found/);

    response = await invoke("POST", "update_public_profile", {
      display_name: "Maya Phase 6A",
      bio: "Phase 6A verification draft.",
      location: "New York, NY",
      height: "5'6\"",
      weight: "",
      eye_color: "Brown",
      hair_color: "Black",
      background_color: "#f7f3ee",
      status: "Draft"
    }, cookie);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(
      backend.snapshot.actorProfiles.find((profile) => profile.student_id === "STU-000001").display_name,
      "Maya Phase 6A"
    );

    response = await invoke("POST", "submit_public_material", {
      title: "Phase 6A Test Link",
      category: "Resume",
      external_url: "https://example.com/phase-6a-test",
      notes: "Created by automated Phase 6A verification.",
      source_type: "LINK"
    }, cookie);
    assert.strictEqual(response.statusCode, 200);
    const submittedMaterial = backend.snapshot.files.find((file) => file.title === "Phase 6A Test Link");
    assert(submittedMaterial, "Expected submitted public material");
    assert.strictEqual(submittedMaterial.student_id, "STU-000001");
    assert.strictEqual(submittedMaterial.public_page_status, "PENDING_REVIEW");
    assert.strictEqual(submittedMaterial.visibility, "ADMIN_ONLY");

    response = await invoke("POST", "save_current_script", {
      title: "Phase 6A Current Script",
      script_url: "",
      script_text: "Phase 6A script text."
    }, cookie);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(
      backend.snapshot.files.find((file) => file.file_id === "FILE-2026-000004").title,
      "Phase 6A Current Script"
    );

    response = await invoke("POST", "add_script_comment", {
      comment: "Phase 6A comment."
    }, cookie);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.payload.result.body, "Phase 6A comment.");

    response = await invoke("POST", "archive_current_script", {}, cookie);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.payload.result.status, "Archived");

    response = await invoke("POST", "request_reader", {
      filming_date: "2026-06-15",
      filming_time: "14:30",
      duration_minutes: 60,
      meeting_method: "ZOOM",
      meeting_details: "Zoom link will be provided.",
      sides_url: "https://example.com/sides.pdf",
      instructions_url: "https://example.com/instructions",
      notes: "Automated reader request verification."
    }, cookie);
    assert.strictEqual(response.statusCode, 200);
    const readerRequest = backend.snapshot.readerRequests.find((request) => request.student_id === "STU-000001");
    assert(readerRequest, "Expected reader request to be stored");
    assert.strictEqual(readerRequest.status, "SUBMITTED");
    assert.strictEqual(readerRequest.meeting_method, "ZOOM");
    assert.strictEqual(response.payload.data.readerRequests.length, 1);

    const ownLesson = backend.snapshot.lessons.find((lesson) => lesson.student_id === "STU-000001");
    assert(ownLesson, "Expected an own lesson for comment verification");
    response = await invoke("POST", "add_lesson_comment", {
      lesson_id: ownLesson.lesson_id,
      comment: "Phase 6A lesson question."
    }, cookie);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.payload.result.body, "Phase 6A lesson question.");
    assert.strictEqual(response.payload.result.student_id, "STU-000001");
    assert(
      backend.snapshot.lessonComments.some((comment) => comment.lesson_id === ownLesson.lesson_id && comment.body === "Phase 6A lesson question."),
      "Expected lesson comment to be stored"
    );
    assert(
      response.payload.data.lessonComments.some((comment) => comment.lesson_id === ownLesson.lesson_id && comment.body === "Phase 6A lesson question."),
      "Expected scoped portal data to include the new lesson comment"
    );

    const otherLesson = backend.snapshot.lessons.find((lesson) => lesson.student_id && lesson.student_id !== "STU-000001");
    if (otherLesson) {
      response = await invoke("POST", "add_lesson_comment", {
        lesson_id: otherLesson.lesson_id,
        comment: "Cross-student attempt."
      }, cookie);
      assert.strictEqual(response.statusCode, 404);
      assert.match(response.payload.error, /Lesson not found/);
    }
  } finally {
    backend.restore();
  }
}

async function runAccountFlowChecks() {
  resetEnv();
  configureLocalAuth();
  const backend = installSnapshotBackend(loadSampleSnapshot());
  const accountEmail = `phase6a-local-${Date.now()}@example.com`;

  try {
    let response = await invoke("POST", "create_invite", {
      student_id: "STU-000001",
      role: "STUDENT",
      email: accountEmail,
      admin_token: "wrong-token"
    });
    assert.strictEqual(response.statusCode, 403);
    assert.match(response.payload.error, /Invalid student account admin token/);

    response = await invoke("POST", "create_invite", {
      student_id: "STU-000001",
      role: "STUDENT",
      email: accountEmail,
      admin_token: LOCAL_ADMIN_TOKEN
    });
    assert.strictEqual(response.statusCode, 200);
    assert(response.payload.result.setup_token, "Expected setup token");
    assert(response.payload.result.setup_url.includes("/portal?setup="), "Expected portal setup URL");
    assert.strictEqual(backend.snapshot.studentAccounts.length, 1);
    assert(!backend.snapshot.studentAccounts[0].password_hash, "Invite should not set password yet");

    const setupToken = response.payload.result.setup_token;
    response = await invoke("POST", "complete_invite", {
      token: setupToken,
      password: "phase6a-password"
    });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(backend.snapshot.studentAccounts[0].status, "ACTIVE");
    assert(backend.snapshot.studentAccounts[0].password_hash, "Expected password hash");
    assert(!backend.snapshot.studentAccounts[0].invite_token_hash, "Invite token hash should be cleared");

    delete process.env.STUDENT_PORTAL_ACCESS_CODE;
    const loginResponse = await invoke("POST", "login", {
      email: accountEmail,
      password: "phase6a-password"
    });
    assert.strictEqual(loginResponse.statusCode, 200);
    assert.strictEqual(loginResponse.payload.identity.role, "STUDENT");
    assert.strictEqual(loginResponse.payload.identity.student_id, "STU-000001");
    assert.strictEqual(loginResponse.payload.identity.account_id, backend.snapshot.studentAccounts[0].account_id);

    const cookie = getSessionCookie(loginResponse);
    response = await invoke("GET", "portal_data", null, cookie);
    assert.strictEqual(response.statusCode, 200);
    assertScopedToStudent(response.payload.data, "STU-000001");
    assert.strictEqual(response.payload.data.studentAccounts, undefined, "Private account metadata leaked in portal data");

    response = await invoke("POST", "login", {
      email: accountEmail,
      password: "wrong-password"
    });
    assert.strictEqual(response.statusCode, 401);

    response = await invoke("POST", "request_reset", {
      email: accountEmail,
      admin_token: LOCAL_ADMIN_TOKEN
    });
    assert.strictEqual(response.statusCode, 200);
    assert(response.payload.result.reset_token, "Expected reset token");
    assert(response.payload.result.reset_url.includes("/portal?reset="), "Expected reset URL");

    const resetToken = response.payload.result.reset_token;
    response = await invoke("POST", "complete_reset", {
      token: resetToken,
      password: "phase6a-password-reset"
    });
    assert.strictEqual(response.statusCode, 200);
    assert(!backend.snapshot.studentAccounts[0].reset_token_hash, "Reset token hash should be cleared");

    response = await invoke("POST", "login", {
      email: accountEmail,
      password: "phase6a-password"
    });
    assert.strictEqual(response.statusCode, 401);

    response = await invoke("POST", "login", {
      email: accountEmail,
      password: "phase6a-password-reset"
    });
    assert.strictEqual(response.statusCode, 200);

    response = await invoke("POST", "disable_account", {
      account_id: backend.snapshot.studentAccounts[0].account_id,
      admin_token: LOCAL_ADMIN_TOKEN
    });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(backend.snapshot.studentAccounts[0].status, "DISABLED");

    response = await invoke("POST", "login", {
      email: accountEmail,
      password: "phase6a-password-reset"
    });
    assert.strictEqual(response.statusCode, 401);
  } finally {
    backend.restore();
  }
}

async function runPublicProfileChecks() {
  resetEnv();
  let response = await invokePublicProfile("maya-kim");
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.payload.ok, true);
  assert.strictEqual(response.payload.profile.display_name, "Maya Kim");
  assert(Array.isArray(response.payload.profile.materials), "Expected public materials");
  response.payload.profile.materials.forEach((material) => {
    assert(!("notes" in material), "Internal material notes leaked");
    assert(!("student_id" in material), "Internal student id leaked");
  });

  response = await invokePublicProfile("aiden-liu");
  assert.strictEqual(response.statusCode, 404);
}

async function runPermissionHardeningChecks() {
  resetEnv();
  configureLocalAuth();
  const snapshot = loadSampleSnapshot();
  const maya = snapshot.students.find((student) => student.student_id === "STU-000001");
  maya.portal_script_access = false;
  const backend = installSnapshotBackend(snapshot);

  try {
    const { cookie } = await login("maya@example.com");

    let response = await invoke("POST", "save_current_script", {
      title: "Should fail",
      script_text: "Should fail"
    }, cookie);
    assert.strictEqual(response.statusCode, 403);
    assert.match(response.payload.error, /Current script access is not enabled/);

    response = await invoke("POST", "add_script_comment", {
      comment: "Should fail"
    }, cookie);
    assert.strictEqual(response.statusCode, 403);
    assert.match(response.payload.error, /Current script access is not enabled/);

    response = await invoke("POST", "archive_current_script", {}, cookie);
    assert.strictEqual(response.statusCode, 403);
    assert.match(response.payload.error, /Current script access is not enabled/);
  } finally {
    backend.restore();
  }
}

async function runLivePublicSmokeChecks() {
  const baseUrl = process.env.PHASE6A_LIVE_BASE_URL || "https://studio-portal.netlify.app";
  const ping = await fetch(`${baseUrl}/api/studio-sync?action=ping`);
  const pingPayload = await ping.json();
  assert.strictEqual(ping.status, 200);
  assert.strictEqual(pingPayload.ok, true);

  const session = await fetch(`${baseUrl}/api/student-auth?action=session`);
  assert.strictEqual(session.status, 401);

  const portalData = await fetch(`${baseUrl}/api/student-auth?action=portal_data`);
  assert.strictEqual(portalData.status, 401);

  const publicProfile = await fetch(`${baseUrl}/api/public-profile?slug=maya-kim`);
  assert([200, 404].includes(publicProfile.status), `Unexpected public profile status: ${publicProfile.status}`);
}

async function runLiveCredentialChecksIfConfigured() {
  const baseUrl = process.env.PHASE6A_LIVE_BASE_URL || "https://studio-portal.netlify.app";
  const email = process.env.PHASE6A_LIVE_STUDENT_EMAIL;
  const accessCode = process.env.PHASE6A_LIVE_ACCESS_CODE;

  if (!email || !accessCode) {
    console.log("Skipping live authenticated checks: set PHASE6A_LIVE_STUDENT_EMAIL and PHASE6A_LIVE_ACCESS_CODE to enable them.");
    return;
  }

  const loginResponse = await fetch(`${baseUrl}/api/student-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email, access_code: accessCode })
  });
  const loginPayload = await loginResponse.json();
  assert.strictEqual(loginResponse.status, 200, `Live login failed: ${JSON.stringify(loginPayload)}`);
  const cookie = loginResponse.headers.get("set-cookie").split(";")[0];

  const portalDataResponse = await fetch(`${baseUrl}/api/student-auth?action=portal_data`, {
    headers: { cookie, Accept: "application/json" }
  });
  const portalDataPayload = await portalDataResponse.json();
  assert.strictEqual(portalDataResponse.status, 200, `Live portal data failed: ${JSON.stringify(portalDataPayload)}`);
  assert(portalDataPayload.data && portalDataPayload.data.student, "Expected live scoped student data");

  if (process.env.PHASE6A_ENABLE_LIVE_WRITES === "true") {
    const homeworkId = process.env.PHASE6A_LIVE_HOMEWORK_ID || portalDataPayload.data.homework[0]?.homework_id;
    if (homeworkId) {
      const homeworkResponse = await fetch(`${baseUrl}/api/student-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", cookie },
        body: JSON.stringify({ action: "update_homework", homework_id: homeworkId, reminder_requested: true })
      });
      const homeworkPayload = await homeworkResponse.json();
      assert.strictEqual(homeworkResponse.status, 200, `Live homework update failed: ${JSON.stringify(homeworkPayload)}`);
    } else {
      console.log("Skipping live homework write: no homework item was visible for this test student.");
    }

    const marker = `Phase 6A live verification ${new Date().toISOString()}`;
    const profileResponse = await fetch(`${baseUrl}/api/student-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", cookie },
      body: JSON.stringify({
        action: "update_public_profile",
        display_name: portalDataPayload.data.publicProfile?.display_name || portalDataPayload.data.student.full_name || "Phase 6A Test",
        bio: marker,
        location: portalDataPayload.data.publicProfile?.location || "",
        height: portalDataPayload.data.publicProfile?.height || "",
        weight: portalDataPayload.data.publicProfile?.weight || "",
        eye_color: portalDataPayload.data.publicProfile?.eye_color || "",
        hair_color: portalDataPayload.data.publicProfile?.hair_color || "",
        background_color: portalDataPayload.data.publicProfile?.background_color || "#f7f3ee",
        status: "Draft"
      })
    });
    const profilePayload = await profileResponse.json();
    assert.strictEqual(profileResponse.status, 200, `Live profile update failed: ${JSON.stringify(profilePayload)}`);
  } else {
    console.log("Skipping live write checks: set PHASE6A_ENABLE_LIVE_WRITES=true after designating a reversible test student.");
  }

  const logoutResponse = await fetch(`${baseUrl}/api/student-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", cookie },
    body: JSON.stringify({ action: "logout" })
  });
  assert.strictEqual(logoutResponse.status, 200);
}

async function main() {
  await runLocalAuthChecks();
  console.log("PASS local auth/session/scoping checks");

  await runLocalMutationChecks();
  console.log("PASS local mutation checks");

  await runAccountFlowChecks();
  console.log("PASS full account invite/login checks");

  await runPublicProfileChecks();
  console.log("PASS public actor profile checks");

  await runPermissionHardeningChecks();
  console.log("PASS script permission hardening checks");

  await runLivePublicSmokeChecks();
  console.log("PASS live public smoke checks");

  await runLiveCredentialChecksIfConfigured();
  console.log("Phase 6A student portal verification complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
