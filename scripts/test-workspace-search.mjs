// Disposable native PostgreSQL 17 only. Never reads hosted credentials/config.
import console from "node:console";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";

const runtime = resolve(process.env.STUDIO_LOCAL_PG_RUNTIME || ""),
  repo = process.cwd();
assert(
  runtime !== repo &&
    !runtime.startsWith(repo + "\\") &&
    !runtime.startsWith(repo + "/"),
);
assert(
  process.env.STUDIO_LOCAL_PG_RUNTIME,
  "Existing local PostgreSQL runtime required",
);
const { Client } = createRequire(join(runtime, "package.json"))("pg");
const { initdb, pg_ctl } = await import(
  pathToFileURL(
    join(runtime, "node_modules/@embedded-postgres/windows-x64/dist/index.js"),
  ).href
);
const run = (bin, args) =>
  execFileSync(bin, args, { encoding: "utf8", windowsHide: true });
assert.match(run(initdb, ["--version"]), /17\./);
const directory = join(runtime, "workspace-" + Date.now());
fs.mkdirSync(directory);
run(initdb, [
  "-D",
  directory,
  "-U",
  "postgres",
  "-A",
  "trust",
  "--encoding=UTF8",
  "--locale=C",
]);
const port = 56436;
execFileSync(
  pg_ctl,
  [
    "-D",
    directory,
    "-l",
    join(directory, "server.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -c wal_level=logical -c studio.workspace_disposable=wave-two`,
    "-w",
    "start",
  ],
  { windowsHide: true, stdio: "ignore" },
);
const db = new Client({
  host: "127.0.0.1",
  port,
  user: "postgres",
  database: "postgres",
});
let assertions = 0;
const check = (condition, message) => {
  assert(condition, message);
  assertions++;
};
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const coach = id(1),
  student = id(2),
  guardian = id(3),
  unrelated = id(4),
  studio = id(10),
  otherStudio = id(11),
  a = id(20),
  b = id(21),
  foreign = id(22);
try {
  await db.connect();
  assert.equal(
    (await db.query("select current_setting('studio.workspace_disposable') v"))
      .rows[0].v,
    "wave-two",
  );
  const source = fs
    .readFileSync("scripts/staging/test-recurring-crlf-recovery.mjs", "utf8")
    .replace(/\r\n/g, "\n");
  const bootstrap = source.match(
    /await client\.query\(`(create role anon;[\s\S]*?)`\);/,
  );
  assert(bootstrap, "Reviewed local Auth/Storage bootstrap missing");
  await db.query(bootstrap[1]);
  const files = fs
    .readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await db.query("begin");
      await db.query(
        fs
          .readFileSync(join("supabase/migrations", file), "utf8")
          .replace(/\r\n/g, "\n"),
      );
      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw Error("Migration failed: " + file + " " + e.message);
    }
  }
  await db.query(
    "insert into auth.users(id,email) select x,'workspace-'||x||'@example.test' from unnest($1::uuid[]) x",
    [[coach, student, guardian, unrelated]],
  );
  await db.query(
    "insert into public.studios(id,name,slug) values($1,'Workspace','workspace'),($2,'Other','other')",
    [studio, otherStudio],
  );
  for (const [user, role] of [
    [coach, "coach"],
    [student, "student"],
    [guardian, "guardian"],
  ])
    await db.query(
      "insert into public.memberships(studio_id,user_id,role,display_name) values($1,$2,$3::text::public.studio_role,$3::text)",
      [studio, user, role],
    );
  for (const [sid, studioId, name, user] of [
    [a, studio, "Needle Student", student],
    [b, studio, "Sibling Student", null],
    [foreign, otherStudio, "Forbidden Needle", null],
  ])
    await db.query(
      "insert into public.students(id,studio_id,full_name,user_id,portal_enabled) values($1,$2,$3,$4,true)",
      [sid, studioId, name, user],
    );
  for (const [sid, work, schedule] of [
    [a, true, true],
    [b, false, false],
  ])
    await db.query(
      "insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,relationship_type,portal_enabled,can_view_work,can_view_schedule,can_view_finance) values($1,$2,$3,'Guardian','workspace-guardian@example.test','guardian',true,$4,$5,true)",
      [studio, sid, guardian, work, schedule],
    );
  for (let n = 0; n < 36; n++)
    await db.query(
      "insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label) values($1,$2,$3,$4,$5,$6,'scheduled','virtual','Studio')",
      [
        id(100 + n),
        studio,
        a,
        `Needle Lesson ${String(n).padStart(2, "0")}`,
        `2027-01-${String(1 + Math.floor(n / 24)).padStart(2, "0")}T${String(n % 24).padStart(2, "0")}:00:00Z`,
        `2027-01-${String(1 + Math.floor(n / 24)).padStart(2, "0")}T${String(n % 24).padStart(2, "0")}:30:00Z`,
      ],
    );
  for (const [lid, sid, sidStudio, title] of [
    [id(150), b, studio, "Sibling Secret"],
    [id(151), foreign, otherStudio, "Forbidden Needle"],
  ])
    await db.query(
      "insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label) values($1,$2,$3,$4,'2027-02-01T10:00Z','2027-02-01T11:00Z','scheduled','virtual','Studio')",
      [lid, sidStudio, sid, title],
    );
  await db.query(
    "insert into public.notes(id,lesson_id,student_id,title,body,status) values($1,$2,$3,'Needle Published',$4,'published'),($5,$2,$3,'Needle Draft','Unpublished sentinel','draft')",
    [
      id(200),
      id(100),
      a,
      "<p>" + "safe text ".repeat(50) + "bodyneedle</p>",
      id(201),
    ],
  );
  await db.query(
    "insert into public.materials(id,studio_id,owner_student_id,title,external_url) values($1,$2,$3,'Needle Resource','https://example.invalid/private-file')",
    [id(300), studio, a],
  );
  await db.query(
    "insert into public.material_links(material_id,student_id,role) values($1,$2,'lesson_material')",
    [id(300), a],
  );
  await db.query(
    "insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes) values($1,$2,'workspace','Studio','private',60)",
    [id(400), studio],
  );
  await db.query(
    "insert into public.bookings(id,studio_id,student_id,service_id,reference,guest_name,guest_email,starts_at,ends_at,timezone,location,payment_policy,payment_status,total_minor,policy_snapshot,manage_token_hash) values($1,$2,$3,$4,'Needle Booking','Private guest','private@example.test','2027-01-01T10:00Z','2027-01-01T11:00Z','UTC','google_meet','pay_later','due',0,'{}','private-token-sentinel')",
    [id(401), studio, a, id(400)],
  );
  async function as(user, fn) {
    await db.query("begin read only");
    try {
      await db.query("set local role authenticated");
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",
        [user],
      );
      return await fn();
    } finally {
      await db.query("rollback");
    }
  }
  const search = (user, q, sid = null, group = null, page = 1) =>
    as(
      user,
      async () =>
        (
          await db.query(
            "select public.studio_global_search($1,$2,$3,$4) value",
            [q, sid, group, page],
          )
        ).rows[0].value,
    );
  const target = (user, kind, rid, sid = null) =>
    as(
      user,
      async () =>
        (
          await db.query("select public.studio_record_target($1,$2,$3) value", [
            kind,
            rid,
            sid,
          ])
        ).rows[0].value,
    );
  for (const user of [coach, student, guardian, unrelated])
    check(
      (await search(user, "n")).items.length === 0,
      "Minimum two characters",
    );
  for (const user of [coach, student, guardian]) {
    const r = await search(user, "Needle");
    check(r.items.length <= 25, "Initial response bounded");
    for (const group of ["student", "lesson", "booking", "resource", "note"])
      check(
        r.items.filter((x) => x.kind === group).length <= 5,
        "Five per group",
      );
    check(!JSON.stringify(r).includes("Forbidden"), "Foreign studio hidden");
    check(
      !JSON.stringify(r).includes("private@example.test") &&
        !JSON.stringify(r).includes("private-token-sentinel") &&
        !JSON.stringify(r).includes("https://"),
      "No private metadata or file URLs",
    );
  }
  for (const user of [student, guardian]) {
    const r = await search(user, "Needle", a);
    check(
      !r.items.some((x) => x.kind === "student"),
      "Portal does not search student directory",
    );
    check(!JSON.stringify(r).includes("Draft"), "Draft note hidden");
    check(
      (await target(user, "note", id(201), a)) === null,
      "Forged draft ID hidden",
    );
    check(
      (await target(user, "lesson", id(151), a)) === null,
      "Foreign deep link hidden",
    );
    check(
      (await target(user, "resource", id(300), a))?.id === id(300),
      "Canonical assigned resource resolves",
    );
    check(
      (await target(user, "resource", id(300), b)) === null,
      "Wrong-child resource context denied",
    );
  }
  check(
    (await search(unrelated, "Needle")).items.length === 0,
    "Unrelated actor sees no records",
  );
  check(
    (await search(guardian, "Sibling", b)).items.length === 0,
    "Guardian schedule/work permissions enforced",
  );
  check(
    (await target(guardian, "lesson", id(150), b)) === null,
    "Guardian direct schedule denial",
  );
  check(
    (await search(student, "bodyneedle", a)).items.some(
      (x) => x.id === id(200),
    ),
    "Server searches note body beyond preview",
  );
  check(
    !(await search(student, "bodyneedle", a)).items[0].snippet.includes("<p>"),
    "Plain snippets only",
  );
  const first = await search(coach, "Needle", null, "lesson", 1),
    second = await search(coach, "Needle", null, "lesson", 2);
  check(
    first.items.length === 20 && second.items.length === 16,
    "Bounded expanded paging",
  );
  check(
    !second.items.some((x) => first.items.some((y) => x.id === y.id)),
    "Stable non-overlapping pages",
  );
  check(
    (await target(coach, "lesson", id(135)))?.id === id(135),
    "Exact record outside first page",
  );
  check(
    (await search(coach, "%_")).items.length === 0,
    "Search metacharacters are literal",
  );
  check(
    (await search(coach, "Needle", null, "unknown")).items.length === 0,
    "Unknown groups disclose nothing",
  );
  const context = (user, sid = null, page = 1) =>
    as(
      user,
      async () =>
        (
          await db.query("select public.portal_student_contexts($1,$2) value", [
            sid,
            page,
          ])
        ).rows[0].value,
    );
  const household = await context(guardian, b);
  check(
    household.items.length === 2,
    "Guardian has two authorized child contexts",
  );
  check(
    household.selected.id === b &&
      !household.selected.canViewSchedule &&
      !household.selected.canViewWork,
    "Selected child uses its own permissions",
  );
  check(
    (await context(student, b)).selected === null,
    "Student cannot select sibling",
  );
  check(
    (await context(guardian, foreign)).selected === null,
    "Foreign direct student context denied",
  );
  check(
    (await context(unrelated, a)).items.length === 0,
    "No contexts for unrelated identity",
  );
  const functions = (
    await db.query(
      "select proname,prosecdef from pg_proc where proname in ('studio_global_search','studio_record_target','portal_student_contexts')",
    )
  ).rows;
  check(
    functions.length === 3 && functions.every((f) => !f.prosecdef),
    "Invoker authority only",
  );
  check(
    (
      await db.query(
        "select has_function_privilege('anon','public.studio_global_search(text,uuid,text,integer)','execute') ok",
      )
    ).rows[0].ok === false,
    "Anonymous RPC denied",
  );
  await db.query(
    "update public.linked_contacts set portal_enabled=false where user_id=$1 and student_id=$2",
    [guardian, a],
  );
  check(
    (await search(guardian, "Needle", a)).items.length === 0,
    "Fresh revocation removes search results",
  );
  check(
    (await target(guardian, "lesson", id(100), a)) === null,
    "Fresh revocation removes target resolution",
  );
  check(
    (await context(guardian, a)).selected === null,
    "Fresh revocation removes selected context",
  );
  const signatures = (
    await db.query(
      "select p.proname,p.pronargdefaults,p.proargnames,array(select format_type(t,null) from unnest(p.proargtypes) with ordinality x(t,n) order by n) types,pg_get_function_result(p.oid) result from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[]) order by p.proname",
      [
        [
          "studio_global_search",
          "studio_record_target",
          "portal_student_contexts",
        ],
      ],
    )
  ).rows;
  if (process.env.STUDIO_UPDATE_RPC_TYPES === "1") {
    const path = "src/types/database.generated.ts";
    let text = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    for (const f of signatures) {
      assert.equal(f.result, "jsonb");
      const args = f.proargnames
        .map((name, i) => ({
          name,
          optional: i >= f.proargnames.length - f.pronargdefaults,
          type: f.types[i] === "integer" ? "number" : "string",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const block = `      ${f.proname}: {\n        Args: {\n${args.map((a) => `          ${a.name}${a.optional ? "?" : ""}: ${a.type}`).join("\n")}\n        }\n        Returns: Json\n      }\n`;
      const start = text.indexOf("    Functions: {"),
        end = text.indexOf("    Enums:", start);
      assert(start >= 0 && end > start);
      let section = text.slice(start, end);
      const existing = section.indexOf(`      ${f.proname}: {`);
      if (existing >= 0) {
        let depth = 0,
          close = section.indexOf("{", existing);
        for (; close < section.length; close++) {
          if (section[close] === "{") depth++;
          if (section[close] === "}" && --depth === 0) {
            close++;
            break;
          }
        }
        section =
          section.slice(0, existing) + section.slice(close).replace(/^\n/, "");
      }
      const next = [...section.matchAll(/^ {6}(\w+): \{/gm)].find(
        (m) => m[1] > f.proname,
      );
      const at = next?.index ?? section.lastIndexOf("    }");
      assert(at >= 0);
      section = section.slice(0, at) + block + section.slice(at);
      text = text.slice(0, start) + section + text.slice(end);
    }
    fs.writeFileSync(path, text);
  }
  const result = {
    postgres: 17,
    migrations: files.length,
    assertions,
    passed: true,
    hostedConnections: 0,
    clusterStoppedOnExit: true,
    rpcCatalogSignatures: signatures,
    rpcTypesGeneratedFromIsolatedCatalog:
      process.env.STUDIO_UPDATE_RPC_TYPES === "1",
  };
  fs.writeFileSync(
    "docs/wave-two-database-validation.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      postgres: 17,
      migrations: files.length,
      assertions,
      passed: true,
      rpcTypesGenerated: result.rpcTypesGeneratedFromIsolatedCatalog,
    }),
  );
} finally {
  await db.end();
  run(pg_ctl, ["-D", directory, "-m", "fast", "-w", "stop"]);
}
