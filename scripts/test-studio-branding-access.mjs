import assert from "node:assert/strict";
import fs from "node:fs";

export async function verifyBrandingAccess({
  db,
  as,
  coach,
  peer,
  student,
  studio,
}) {
  // The embedded bootstrap omits the Storage service's standard SELECT grants.
  // Model them locally so the real policy, rather than a missing grant, is tested.
  await db.query("grant select on storage.objects to authenticated,anon");
  const user = "f5550000-0000-4000-8000-000000000001";
  await db.query(
    "insert into auth.users(id,email) values($1,'branding-student@example.test')",
    [user],
  );
  await db.query(
    "update public.students set user_id=$1,portal_enabled=true where id=$2",
    [user, student],
  );
  await db.query(
    "insert into public.portal_accounts(studio_id,student_id,user_id,username,email,account_type,must_change_password) values($1,$2,$3,'branding-student','branding-student@example.test','student',false)",
    [studio, student, user],
  );
  const prefix = `${studio}/${studio}/`,
    paths = [
      prefix + "public_actor/logo",
      prefix + "public_actor/popup",
      prefix + "private/photo",
      prefix + "public_actor/unrelated",
    ];
  await db.query(
    "update public.studios set settings=settings||$2::jsonb where id=$1",
    [
      studio,
      JSON.stringify({
        branding: {
          logoStoragePath: paths[0],
          coachProfilePhotoStoragePath: paths[2],
        },
        dailyPopup: { backgroundImageStoragePath: paths[1] },
      }),
    ],
  );
  for (const name of paths)
    await db.query(
      "insert into storage.objects(bucket_id,name) values('studio-materials',$1)",
      [name],
    );
  const read = (id, role = "authenticated") =>
    as(
      role,
      id,
      "select coalesce(jsonb_agg(name order by name),'[]') v from storage.objects where name=any($1)",
      [paths],
    );
  assert.equal(
    await as("authenticated", user, "select public.can_access_student($1) v", [
      student,
    ]),
    true,
    "Synthetic student is authorized before evaluating storage",
  );
  assert.equal(
    await as(
      "authenticated",
      user,
      "select count(*)::int v from public.studios where id=$1",
      [studio],
    ),
    1,
    "Related studio is visible",
  );
  assert.deepEqual(await read(user), paths.slice(0, 2).sort());
  assert.deepEqual(await read(peer), []);
  assert.deepEqual(await read(coach), [...paths].sort());
  assert.deepEqual(await read(null, "anon"), []);
  await db.query(
    "update public.studios set settings=jsonb_set(settings,'{branding}', (settings->'branding') || $2::jsonb) where id=$1",
    [
      studio,
      JSON.stringify({
        logoUrl: "expiring-logo",
        coachProfilePhotoUrl: "private-token",
        primaryColor: "#123456",
      }),
    ],
  );
  const cleanup = fs
    .readFileSync(
      "supabase/migrations/20261021050357_studio_branding_asset_access.sql",
      "utf8",
    )
    .match(/update public\.studios set settings[\s\S]*?;/)[0];
  await db.query(cleanup);
  const brand = (
    await db.query(
      "select settings->'branding' v from public.studios where id=$1",
      [studio],
    )
  ).rows[0].v;
  assert.deepEqual(brand, {
    logoStoragePath: paths[0],
    coachProfilePhotoStoragePath: paths[2],
    primaryColor: "#123456",
  });
  await db.query(
    "update public.studios set settings=jsonb_set(settings,'{branding,logoStoragePath}',to_jsonb($2::text)) where id=$1",
    [studio, paths[3]],
  );
  assert.deepEqual(await read(user), [paths[1], paths[3]].sort());
  await db.query(
    "update public.studios set settings=settings-'branding'-'dailyPopup' where id=$1",
    [studio],
  );
  assert.deepEqual(await read(user), []);
  console.log(
    "PASS: current shared branding references readable by related student; private photo/unrelated file/peer/anon denied; replacement and removal revoke old reads",
  );
}
