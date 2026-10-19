// Native, separate-session tests; only the existing isolated local Docker DB.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
const command = process.platform === "win32" ? "wsl.exe" : "docker";
const prefix =
  process.platform === "win32" ? ["-d", "Ubuntu-24.04", "--", "docker"] : [];
const info = JSON.parse(
  execFileSync(command, [...prefix, "inspect", "supabase_db_studio-portal"], {
    encoding: "utf8",
  }),
)[0];
assert.equal(info.Name, "/supabase_db_studio-portal");
const args = [
  ...prefix,
  "exec",
  "-i",
  info.Id,
  "psql",
  "-X",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-qAt",
  "-v",
  "ON_ERROR_STOP=1",
];
const query = (sql) =>
  execFileSync(command, args, {
    input: sql,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
assert.equal(
  query("select current_setting('server_version_num')::int/10000"),
  "17",
);
const user = "e7100000-0000-4000-8000-000000000001",
  studio = "e7200000-0000-4000-8000-000000000001",
  student = "e7300000-0000-4000-8000-000000000001",
  material = "e7400000-0000-4000-8000-000000000001",
  note = "e7500000-0000-4000-8000-000000000001";
assert.equal(
  query(`select count(*) from auth.users where id='${user}'`),
  "0",
  "Refuse existing fixture identity",
);
const as = `set local role authenticated;select set_config('request.jwt.claim.sub','${user}',true);`;
function session(sql, output = () => {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { windowsHide: true });
    let out = "",
      err = "";
    p.stdout.on("data", (b) => {
      out += b;
      output(out);
    });
    p.stderr.on("data", (b) => {
      err += b;
    });
    p.on("error", reject);
    p.on("close", (code) => (code ? reject(Error(err)) : resolve(out)));
    p.stdin.end(sql);
  });
}
try {
  query(
    `begin;insert into auth.users(id,email) values('${user}','e2e-wave3-concurrency@example.test');insert into public.studios(id,name,slug) values('${studio}','Study concurrency','e2e-wave3-concurrency');insert into public.students(id,studio_id,user_id,full_name,is_minor,portal_enabled) values('${student}','${studio}','${user}','Study concurrency',false,true);insert into public.materials(id,studio_id,owner_student_id,title,text_content) values('${material}','${studio}','${student}','Concurrent reader','Paragraph');commit;`,
  );
  const content = query(
    `begin;${as}select library_internal.material_content_identity('${material}');rollback;`,
  )
    .split("\n")
    .at(-1);
  assert.match(content, /^[a-f0-9]{64}$/);
  const save = (body, version) =>
    `select public.save_material_study('${material}','${student}','${content}','note','${note}','{"paragraph":1}','${body}',${version})->>'version';`;
  await Promise.all([
    session(`begin;${as}${save("Original", 0)}commit;`),
    session(`begin;${as}${save("Original", 0)}commit;`),
  ]);
  assert.equal(
    query(
      `select count(*)||':'||max(version) from public.material_study_annotations where id='${note}'`,
    ),
    "1:1",
  );
  let release;
  const ready = new Promise((r) => {
    release = r;
  });
  const holder = session(
    `begin;${as}${save("Winner", 1)}select 'HOLDER_READY';select pg_sleep(0.5);commit;`,
    (out) => {
      if (out.includes("HOLDER_READY")) release();
    },
  );
  await ready;
  await assert.rejects(
    session(`begin;${as}${save("Stale contender", 1)}commit;`),
    /VERSION_CONFLICT/,
  );
  await holder;
  assert.equal(
    query(
      `select body||':'||version from public.material_study_annotations where id='${note}'`,
    ),
    "Winner:2",
  );
  console.log(
    "PASS: concurrent duplicate creates one annotation; overlapping stale edits cannot overwrite the winner.",
  );
} finally {
  query(
    `begin;delete from public.material_study_annotations where material_id='${material}' and user_id='${user}';delete from public.material_study_state where material_id='${material}' and user_id='${user}';delete from public.materials where id='${material}' and studio_id='${studio}';delete from public.students where id='${student}' and studio_id='${studio}';delete from public.studios where id='${studio}';delete from auth.users where id='${user}';commit;`,
  );
}
