// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, it } from "vitest";
let db: PGlite;
const studio = "10000000-0000-4000-8000-000000000001";
const coach = "20000000-0000-4000-8000-000000000001";
const studentA = "30000000-0000-4000-8000-000000000001";
const studentB = "30000000-0000-4000-8000-000000000002";
const userA = "40000000-0000-4000-8000-000000000001";
const userB = "40000000-0000-4000-8000-000000000002";
let resource: string;
async function as(user: string) {
  await db.exec(
    `reset role; select set_config('test.user','${user}',false); set role authenticated;`,
  );
}
async function command(
  name: string,
  payload: Record<string, unknown>,
  version = 0,
) {
  return (
    await db.query<{ result: { id: string } }>(
      "select public.manage_material_resources($1,$2,$3) result",
      [name, JSON.stringify({ studioId: studio, ...payload }), version],
    )
  ).rows[0].result;
}
async function search(
  payload: {
    studentId?: string;
    catalog?: boolean;
    search?: string;
    filters?: Record<string, string[]>;
    status?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  return (
    await db.query<{
      result: { items: Array<Record<string, unknown>>; total: number };
    }>(
      "select public.search_material_resources($1,$2,$3,$4,$5,$6,false,'title',$7,$8) result",
      [
        studio,
        payload.studentId || null,
        payload.catalog ?? true,
        payload.search || "",
        JSON.stringify(payload.filters || {}),
        payload.status || "active",
        payload.page || 1,
        payload.limit || 25,
      ],
    )
  ).rows[0].result;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 create table auth.users(id uuid primary key);
 create table public.studios(id uuid primary key);
 create table public.students(id uuid primary key,studio_id uuid,user_id uuid,deleted_at timestamptz,full_name text default 'Student');
 create table public.memberships(studio_id uuid,user_id uuid,role text);
 create table public.lessons(id uuid primary key,studio_id uuid,student_id uuid,topic text default 'Lesson');
 create table public.lesson_participants(lesson_id uuid,student_id uuid,topic text default 'Lesson');
 create table public.notes(id uuid primary key,lesson_id uuid,student_id uuid,status text);
 create type public.material_status as enum('active','vaulted','archived');
 create table public.file_assets(id uuid primary key default gen_random_uuid(),studio_id uuid,owner_student_id uuid,storage_path text,mime_type text,file_size_bytes bigint,uploaded_by uuid,bucket_id text,visibility text default 'student');
 create table public.materials(id uuid primary key default gen_random_uuid(),studio_id uuid,owner_student_id uuid,title text,category text default 'Other',caption text default '',storage_path text,external_url text,mime_type text,file_size_bytes bigint,media_kind text,approval_status text default 'not_public',public_embed boolean default false,sort_order integer default 0,status public.material_status default 'active',version integer default 1,created_at timestamptz default now(),updated_at timestamptz default now(),check(storage_path is not null or external_url is not null));
 create table public.material_links(id uuid primary key default gen_random_uuid(),material_id uuid references materials(id) on delete cascade,student_id uuid,lesson_id uuid,role text,visible_to_student boolean default false,created_at timestamptz default now());
 create table public.audit_events(studio_id uuid,actor_id uuid,entity_type text,entity_id uuid,action text,reason text,correlation_id text,source text,before_state jsonb,after_state jsonb);
 create table storage.objects(name text,bucket_id text,visibility text default 'student');
 create function public.is_studio_coach(s uuid) returns boolean language sql stable security definer as $$select exists(select 1 from public.memberships where studio_id=s and user_id=auth.uid() and role='coach')$$;
 create function public.can_view_student_work(s uuid) returns boolean language sql stable security definer as $$select exists(select 1 from public.students where id=s and (user_id=auth.uid() or public.is_studio_coach(studio_id)))$$;
 create function public.can_manage_student_profile(s uuid) returns boolean language sql stable security definer as $$select public.can_view_student_work(s)$$;
 alter table public.materials enable row level security; alter table public.material_links enable row level security; alter table storage.objects enable row level security; alter table public.file_assets enable row level security;
 create policy materials_access on public.materials for select to authenticated using(owner_student_id is not null and public.can_view_student_work(owner_student_id));
 create policy material_links_access on public.material_links for select to authenticated using(public.can_view_student_work(student_id));
 grant usage on schema public,auth,storage to authenticated;
 grant select on all tables in schema public,storage to authenticated;
 grant insert on public.file_assets to authenticated;
 grant update,delete on storage.objects to authenticated;
 insert into public.studios values('${studio}');
 insert into auth.users values('${coach}'),('${userA}'),('${userB}');
 insert into public.students(id,studio_id,user_id,deleted_at) values('${studentA}','${studio}','${userA}',null),('${studentB}','${studio}','${userB}',null);
 insert into public.memberships values('${studio}','${coach}','coach');
 insert into public.materials(studio_id,owner_student_id,title,external_url,status,created_at) values('${studio}','${studentA}','Legacy vaulted study guide','https://example.test/legacy','vaulted','2025-01-01T00:00:00Z');
 `);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261008203319_studio_library_resources.sql",
      "utf8",
    ),
  );
  await as(coach);
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("stores a resource once and assigns it to two students without duplicating its file", async () => {
  await db.exec("reset role");
  const asset = (
    await db.query<{ id: string }>(
      "insert into public.file_assets(studio_id,storage_path,mime_type,file_size_bytes,content_sha256) values($1,$3,'application/pdf',100,$2) returning id",
      [
        studio,
        "a".repeat(64),
        `${studio}/${studio}/student/sha256-${"a".repeat(64)}`,
      ],
    )
  ).rows[0].id;
  await as(coach);
  resource = (
    await command("resource_create", {
      title: "Shakespeare Lexicon",
      fileAssetId: asset,
      inLibrary: true,
    })
  ).id;
  await command("resource_assign", {
    id: resource,
    studentIds: [studentA, studentB],
    coachNotes: "Private coaching observation",
    instructions: "Read the glossary",
  });
  await command("resource_assign", {
    id: resource,
    studentIds: [studentA, studentB],
  });
  expect((await search()).total).toBe(1);
  await db.exec("reset role");
  expect(
    (
      await db.query<{ count: number }>(
        "select count(*)::int count from public.file_assets",
      )
    ).rows[0].count,
  ).toBe(1);
  expect(
    (
      await db.query<{ count: number }>(
        "select count(*)::int count from public.material_links where material_id=$1",
        [resource],
      )
    ).rows[0].count,
  ).toBe(2);
});
it("vaulting and pinning are isolated and students never receive private coach notes", async () => {
  await as(userA);
  const result = await search({ catalog: false, studentId: studentA });
  expect(result.items[0].hasInstructions).toBe(true);
  expect(
    (
      await db.query<{ result: { instructions: string; coachNotes: null } }>(
        "select public.get_material_assignment($1) result",
        [result.items[0].assignmentId],
      )
    ).rows[0].result,
  ).toEqual(
    expect.objectContaining({
      instructions: "Read the glossary",
      coachNotes: null,
    }),
  );
  expect(JSON.stringify(result)).not.toContain("Private coaching");
  await command(
    "assignment_update",
    { id: result.items[0].assignmentId, status: "vaulted", pinned: true },
    1,
  );
  expect((await search({ catalog: false, studentId: studentA })).total).toBe(0);
  expect(
    (
      await search({
        catalog: false,
        studentId: studentA,
        status: "vaulted",
        search: "Shakespeare",
      })
    ).total,
  ).toBe(1);
  expect(
    (await search({ catalog: false, studentId: studentB, status: "all" }))
      .total,
  ).toBe(0);
  expect(
    (await db.query("select * from public.material_assignment_private")).rows,
  ).toEqual([]);
  await as(userB);
  expect((await search({ catalog: false, studentId: studentB })).total).toBe(1);
});
it("supports multiple levels, custom options, combined filters, safe rename and merge", async () => {
  await as(coach);
  const beginner = (
    await command("option_create", { kind: "level", name: "Beginner" })
  ).id;
  const intermediate = (
    await command("option_create", { kind: "level", name: "Intermediate" })
  ).id;
  const topic = (
    await command("option_create", { kind: "topic", name: "Shakespeare" })
  ).id;
  const normalized = (
    await command("option_create", { kind: "topic", name: "  shakespeare  " })
  ).id;
  expect(normalized).toBe(topic);
  await command(
    "resource_update",
    {
      id: resource,
      title: "Shakespeare Lexicon",
      inLibrary: true,
      description: "Vocabulary reference",
      optionIds: [beginner, intermediate, topic],
    },
    1,
  );
  expect(
    (
      await search({
        filters: { level: [beginner, intermediate], topic: [topic] },
      })
    ).total,
  ).toBe(1);
  expect((await search({ search: "Intermediate" })).total).toBe(1);
  await command("option_rename", { id: topic, name: "Classical Shakespeare" });
  expect((await search({ search: "Classical" })).total).toBe(1);
  await command("option_merge", { id: beginner, targetId: intermediate });
  expect(
    (await search({ filters: { level: [intermediate] } })).items[0].options,
  ).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: intermediate })]),
  );
});
it("bounds pages, omits text bodies, and permits complete retrieval only for authorized resources", async () => {
  await as(coach);
  for (let i = 0; i < 30; i++)
    await command("resource_create", {
      title: `Resource ${String(i).padStart(2, "0")}`,
      text: "Full document body",
      inLibrary: true,
    });
  const first = await search({ limit: 500 });
  expect(first.items.length).toBe(31);
  const page1 = await search({ limit: 10 });
  const page2 = await search({ limit: 10, page: 2 });
  expect(page1.items.length).toBe(10);
  expect(page2.items.length).toBe(10);
  expect(page2.items.some((i) => page1.items.some((j) => j.id === i.id))).toBe(
    false,
  );
  expect(JSON.stringify(page1)).not.toContain("Full document body");
  await as(userA);
  expect((await search()).total).toBe(0);
  expect(
    (
      await db.query<{ result: unknown }>(
        "select public.get_material_resource($1) result",
        [page1.items[0].id],
      )
    ).rows[0].result,
  ).toBeNull();
  await expect(
    command("option_create", { kind: "topic", name: "Forbidden" }),
  ).rejects.toThrow("FORBIDDEN");
  await expect(
    command("resource_update", { id: resource, title: "Overwrite" }),
  ).rejects.toThrow("FORBIDDEN");
});
it("student uploads stay private and cannot be promoted or assigned to another student", async () => {
  await as(userA);
  const own = (
    await command("resource_create", {
      studentId: studentA,
      title: "Private monologue",
      text: "Private writing",
    })
  ).id;
  await expect(
    command("resource_create", {
      studentId: studentA,
      title: "Promote",
      text: "Private writing",
      inLibrary: true,
    }),
  ).rejects.toThrow("FORBIDDEN");
  await expect(
    command("resource_assign", {
      id: own,
      creatingPrivate: true,
      studentIds: [studentB],
    }),
  ).rejects.toThrow("Promote");
  await as(userB);
  expect(
    (
      await db.query<{ result: unknown }>(
        "select public.get_material_resource($1) result",
        [own],
      )
    ).rows[0].result,
  ).toBeNull();
});
it("collection assignment is a stable snapshot and does not copy files", async () => {
  await as(coach);
  const extra = (
    await command("resource_create", {
      title: "Voice Toolkit",
      text: "Voice exercises",
      inLibrary: true,
    })
  ).id;
  const collection = (
    await command("collection_create", {
      title: "Classical Foundations",
      resourceIds: [resource],
      description: "Foundations",
    })
  ).id;
  await command(
    "collection_assign",
    { id: collection, studentIds: [studentA, studentB] },
    1,
  );
  await command(
    "collection_update",
    {
      id: collection,
      title: "Classical Foundations",
      resourceIds: [resource, extra],
    },
    1,
  );
  await as(userA);
  const before = await search({
    catalog: false,
    studentId: studentA,
    status: "all",
  });
  expect(before.items.some((i) => i.id === extra)).toBe(false);
  const snapshots = (
    await db.query<{ resource_ids: string[] }>(
      "select resource_ids from public.material_collection_assignments where collection_id=$1",
      [collection],
    )
  ).rows;
  expect(snapshots).toEqual([{ resource_ids: [resource] }]);
  await as(coach);
  await command(
    "collection_assign",
    { id: collection, studentIds: [studentA] },
    2,
  );
  await as(userA);
  expect(
    (
      await search({ catalog: false, studentId: studentA, status: "all" })
    ).items.some((i) => i.id === extra),
  ).toBe(true);
  await expect(
    command(
      "collection_update",
      { id: collection, title: "Unauthorized", resourceIds: [] },
      2,
    ),
  ).rejects.toThrow("FORBIDDEN");
});
it("draft attachments hide metadata and downloads until published; deleting a note does not expose its resource", async () => {
  const lesson = "50000000-0000-4000-8000-000000000001",
    note = "60000000-0000-4000-8000-000000000001";
  const path = `${studio}/${studentA}/private/sha256-${"b".repeat(64)}`;
  await db.exec("reset role");
  await db.query(
    "insert into public.lessons(id,studio_id,student_id) values($1,$2,$3)",
    [lesson, studio, studentA],
  );
  await db.query(
    "insert into public.notes(id,student_id,lesson_id,status) values($1,$2,$3,'draft')",
    [note, studentA, lesson],
  );
  const asset = (
    await db.query<{ id: string }>(
      "insert into public.file_assets(studio_id,owner_student_id,storage_path,visibility,uploaded_by,content_sha256) values($1,$2,$3,'private',$4,$5) returning id",
      [studio, studentA, path, coach, "b".repeat(64)],
    )
  ).rows[0].id;
  await db.query(
    "insert into storage.objects(name,bucket_id) values($1,'studio-materials')",
    [path],
  );
  await as(coach);
  const draft = (
    await command("resource_create", {
      studentId: studentA,
      lessonId: lesson,
      noteId: note,
      title: "Unpublished coaching reference",
      fileAssetId: asset,
    })
  ).id;
  await as(userA);
  await expect(
    command("resource_assign", { id: draft, studentIds: [studentA] }),
  ).rejects.toThrow("FORBIDDEN");
  expect(
    (
      await search({ studentId: studentA, catalog: false, status: "all" })
    ).items.some((i) => i.id === draft),
  ).toBe(false);
  expect(
    (await db.query("select * from public.file_assets where id=$1", [asset]))
      .rows,
  ).toEqual([]);
  expect(
    (await db.query("select * from storage.objects where name=$1", [path]))
      .rows,
  ).toEqual([]);
  expect(
    (
      await db.query(
        "update storage.objects set name='overwritten' where name=$1 returning name",
        [path],
      )
    ).rows,
  ).toEqual([]);
  await db.exec("reset role");
  await db.query("update public.notes set status='published' where id=$1", [
    note,
  ]);
  await as(userA);
  expect(
    (
      await search({ studentId: studentA, catalog: false, status: "all" })
    ).items.some((i) => i.id === draft),
  ).toBe(true);
  expect(
    (await db.query("select * from storage.objects where name=$1", [path]))
      .rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "delete from storage.objects where name=$1 returning name",
        [path],
      )
    ).rows,
  ).toEqual([]);
  await db.exec("reset role");
  await db.query("delete from public.notes where id=$1", [note]);
  await as(userA);
  expect(
    (
      await db.query<{ result: unknown }>(
        "select public.get_material_resource($1) result",
        [draft],
      )
    ).rows[0].result,
  ).toBeNull();
  expect(
    (await db.query("select * from storage.objects where name=$1", [path]))
      .rows,
  ).toEqual([]);
});
it("hash deduplication is scoped to owner and visibility, with no private-file metadata leak", async () => {
  const hash = "c".repeat(64);
  await as(userA);
  const pathA = `${studio}/${studentA}/student/sha256-${hash}`;
  const pathB = `${studio}/${studentB}/student/sha256-${hash}`;
  await db.query(
    "insert into public.file_assets(studio_id,owner_student_id,storage_path,visibility,bucket_id,uploaded_by,content_sha256) values($1,$2,$3,'student','studio-materials',$4,$5)",
    [studio, studentA, pathA, userA, hash],
  );
  await expect(
    db.query(
      "insert into public.file_assets(studio_id,owner_student_id,storage_path,visibility,bucket_id,uploaded_by,content_sha256) values($1,$2,$3,'student','studio-materials',$4,$5)",
      [studio, studentB, pathB, userA, hash],
    ),
  ).rejects.toThrow("row-level security");
  await as(userB);
  expect(
    (
      await db.query(
        "select * from public.file_assets where content_sha256=$1",
        [hash],
      )
    ).rows,
  ).toEqual([]);
  await db.query(
    "insert into public.file_assets(studio_id,owner_student_id,storage_path,visibility,bucket_id,uploaded_by,content_sha256) values($1,$2,$3,'student','studio-materials',$4,$5)",
    [studio, studentB, pathB, userB, hash],
  );
  await expect(
    db.query(
      "insert into public.file_assets(studio_id,owner_student_id,storage_path,visibility,bucket_id,uploaded_by,content_sha256) values($1,$2,$3,'student','studio-materials',$4,$5)",
      [studio, studentB, pathB, userB, hash],
    ),
  ).rejects.toThrow("duplicate key");
});
it("removing an assignment preserves the canonical resource and another student's access", async () => {
  await as(userB);
  const item = (
    await search({ studentId: studentB, catalog: false })
  ).items.find((i) => i.id === resource)!;
  await command(
    "assignment_remove",
    { id: item.assignmentId },
    Number(item.assignmentVersion),
  );
  expect(
    (
      await search({ studentId: studentB, catalog: false, status: "all" })
    ).items.some((i) => i.id === resource),
  ).toBe(false);
  await as(userA);
  expect(
    (
      await search({ studentId: studentA, catalog: false, status: "all" })
    ).items.some((i) => i.id === resource),
  ).toBe(true);
  await as(coach);
  expect(
    (await search({ search: "Shakes" })).items.some((i) => i.id === resource),
  ).toBe(true);
});
it("preserves legacy owner-only resources, their vaulted status and original added date", async () => {
  await as(userA);
  const rows = await search({
    catalog: false,
    studentId: studentA,
    status: "vaulted",
    search: "Legacy",
  });
  expect(rows.total).toBe(1);
  expect(rows.items[0].title).toBe("Legacy vaulted study guide");
  expect(String(rows.items[0].assignedAt)).toContain("2025-01-01");
  await as(userB);
  expect(
    (
      await search({
        catalog: false,
        studentId: studentA,
        status: "all",
        search: "Legacy",
      })
    ).total,
  ).toBe(0);
});
