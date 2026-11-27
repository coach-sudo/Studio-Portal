import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { Blob, Buffer } from "node:buffer";
import { log } from "node:console";
import process from "node:process";
import { URL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const origin = new URL(
  process.env.ASSIGNMENT_TEST_SUPABASE_URL || "http://127.0.0.1:55821",
);
if (
  origin.protocol !== "http:" ||
  origin.hostname !== "127.0.0.1" ||
  !origin.port ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw Error("This fixture is restricted to an explicit local Supabase port.");
const publicKey = process.env.ASSIGNMENT_TEST_SUPABASE_ANON_KEY;
const serviceKey = process.env.ASSIGNMENT_TEST_SUPABASE_SERVICE_KEY;
if (!publicKey || !serviceKey)
  throw Error("Provide the isolated stack's test keys.");
const localClient = (key) =>
  createClient(origin.origin, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
const admin = localClient(serviceKey);
const anonymous = localClient(publicKey);
const fixtureId = randomUUID();
const primaryStudio = randomUUID();
const otherStudio = randomUUID();
const learnerId = randomUUID();
const peerId = randomUUID();
const assignment = randomUUID();
const bucket = "assignment-attachments";
const filename = "Synthetic practice response.txt";
const content = "Synthetic file for assignment permissions.";
const hash = createHash("sha256").update(content).digest("hex");
const objectPath = `${primaryStudio}/${learnerId}/${assignment}/sha256-${hash}`;
const roles = [
  "learner",
  "peer",
  "coach",
  "other-coach",
  "work-guardian",
  "schedule-guardian",
];
const users = new Map();

function result({ error, data }, label) {
  if (error)
    throw Error(
      `${label}: ${error.code || error.name || "request error"} ${error.message}`,
    );
  return data;
}

async function expectAccess(client, expected, label) {
  const rows = result(
    await client
      .from("assignment_attachments")
      .select("original_name,mime_type,file_size_bytes")
      .eq("assignment_id", assignment),
    `${label} metadata query`,
  );
  const download = await client.storage
    .from(bucket)
    .download(objectPath, {}, { cache: "no-store" });
  assert.equal(rows.length, expected ? 1 : 0, `${label} metadata`);
  if (expected) {
    assert.equal(rows[0].original_name, filename, `${label} original filename`);
    assert.equal(rows[0].mime_type, "text/plain", `${label} content type`);
    assert.equal(
      Number(rows[0].file_size_bytes),
      Buffer.byteLength(content),
      `${label} byte count`,
    );
    const file = result(download, `${label} authenticated download`);
    assert.equal(await file.text(), content, `${label} file bytes`);
  } else assert.ok(download.error, `${label} download must be denied`);
}

const id = (role) => users.get(role).id;
const client = (role) => users.get(role).client;
try {
  for (const role of roles) {
    const email = `${role}-${fixtureId}@example.test`;
    const password = `${randomUUID()}-AssignmentTest9!`;
    const created = result(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
      "Create synthetic account",
    );
    const initialized = localClient(publicKey);
    users.set(role, { id: created.user.id, client: initialized });
    result(
      await initialized.auth.signInWithPassword({ email, password }),
      "Sign in synthetic account",
    );
  }
  result(
    await admin.from("studios").insert([
      {
        id: primaryStudio,
        name: "Synthetic assignment studio",
        slug: `assignment-test-${fixtureId}`,
      },
      {
        id: otherStudio,
        name: "Synthetic separate studio",
        slug: `assignment-other-${fixtureId}`,
      },
    ]),
    "Create synthetic studios",
  );
  result(
    await admin.from("students").insert([
      {
        id: learnerId,
        studio_id: primaryStudio,
        user_id: id("learner"),
        full_name: "Synthetic learner",
        status: "active",
      },
      {
        id: peerId,
        studio_id: primaryStudio,
        user_id: id("peer"),
        full_name: "Synthetic peer",
        status: "active",
      },
    ]),
    "Create synthetic learners",
  );
  result(
    await admin.from("memberships").insert([
      {
        studio_id: primaryStudio,
        user_id: id("coach"),
        role: "coach",
        display_name: "Synthetic coach",
      },
      {
        studio_id: otherStudio,
        user_id: id("other-coach"),
        role: "coach",
        display_name: "Synthetic other coach",
      },
    ]),
    "Create synthetic coach relationships",
  );
  result(
    await admin.from("student_relationships").insert([
      {
        student_id: learnerId,
        user_id: id("work-guardian"),
        relationship: "guardian",
        can_view_work: true,
        can_view_schedule: false,
        can_view_finance: false,
      },
      {
        student_id: learnerId,
        user_id: id("schedule-guardian"),
        relationship: "guardian",
        can_view_work: false,
        can_view_schedule: true,
        can_view_finance: true,
      },
    ]),
    "Create synthetic household relationships",
  );
  result(
    await admin.from("assignments").insert({
      id: assignment,
      student_id: learnerId,
      title: "Synthetic rehearsal response",
    }),
    "Create synthetic assignment",
  );

  const learner = client("learner");
  const transfer = await learner.storage
    .from(bucket)
    .upload(objectPath, new Blob([content], { type: "text/plain" }), {
      contentType: "text/plain",
      upsert: false,
      cacheControl: "0",
    });
  result(transfer, "Upload actual synthetic storage object");
  await expectAccess(learner, false, "Unlinked object");
  const attach = () =>
    learner.rpc("attach_assignment_file", {
      p_assignment: assignment,
      p_hash: hash,
      p_name: filename,
    });
  const receipt = result(await attach(), "Attach uploaded object");
  assert.equal(result(await attach(), "Retry attachment").id, receipt.id);
  await expectAccess(learner, true, "Student before completion");
  await expectAccess(client("coach"), false, "Coach before completion");
  await expectAccess(
    client("work-guardian"),
    false,
    "Household before completion",
  );
  result(
    await learner.rpc("remove_assignment_file", {
      p_assignment: assignment,
      p_attachment: receipt.id,
    }),
    "Unlink pending attachment",
  );
  await expectAccess(learner, false, "Removed attachment");
  result(await attach(), "Reattach retained object without a second upload");

  const complete = result(
    await admin
      .from("assignments")
      .update({ status: "completed" })
      .eq("id", assignment)
      .select("status")
      .single(),
    "Complete exact assignment",
  );
  assert.equal(complete.status, "completed");
  await expectAccess(learner, true, "Student after completion");
  await expectAccess(client("coach"), true, "Owning coach after completion");
  await expectAccess(
    client("work-guardian"),
    true,
    "Work household after completion",
  );
  await expectAccess(
    client("schedule-guardian"),
    false,
    "Schedule and payment household",
  );
  await expectAccess(client("peer"), false, "Unrelated student");
  await expectAccess(client("other-coach"), false, "Cross-studio coach");
  const unsigned = await anonymous.storage.from(bucket).download(objectPath);
  assert.ok(
    unsigned.error,
    "Anonymous authenticated-placeholder read must be denied",
  );
  const publicLink = anonymous.storage.from(bucket).getPublicUrl(objectPath)
    .data.publicUrl;
  assert.equal(
    (await globalThis.fetch(publicLink)).ok,
    false,
    "Public Storage route must not serve the object",
  );

  result(
    await admin
      .from("student_relationships")
      .update({ can_view_work: false })
      .eq("student_id", learnerId)
      .eq("user_id", id("work-guardian")),
    "Revoke synthetic household work permission",
  );
  await expectAccess(
    client("work-guardian"),
    false,
    "Revoked household after completion",
  );
  log(
    "Assignment Storage passed actual upload, retry, unlink, completion, role isolation and revocation.",
  );
} finally {
  await admin.storage.from(bucket).remove([objectPath]);
  await admin.from("studios").delete().in("id", [primaryStudio, otherStudio]);
  for (const user of users.values()) await admin.auth.admin.deleteUser(user.id);
}
