// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, expect, it } from "vitest";

const db = new PGlite({ extensions: { pgcrypto } });
const studio = "5fa00000-0000-4000-8000-000000000001";
const coach = "5fa00000-0000-4000-8000-000000000002";
const student = "5fa00000-0000-4000-8000-000000000003";
const lesson = "5fa00000-0000-4000-8000-000000000004";
const startsAt = "2040-01-01T10:00:00Z";
const endsAt = "2040-01-01T11:00:00Z";

beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key)",
  );
  await db.exec(
    readFileSync("supabase/migrations/202607030001_core.sql", "utf8"),
  );
  await db.exec(`
    alter table public.calendar_projections add column next_attempt_at timestamptz,
      add column claim_token uuid, add column claim_until timestamptz;
    insert into auth.users values ('${coach}'),('${student}');
    insert into public.studios(id,name,slug) values ('${studio}','Synthetic','e2e-calendar-review');
    insert into public.memberships(studio_id,user_id,role,display_name)
      values ('${studio}','${coach}','coach','Fixture'),('${studio}','${student}','student','Fixture');
    insert into public.students(id,studio_id,full_name) values ('${student}','${studio}','Fixture learner');
    insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,version,status,location_type,location_label)
      values ('${lesson}','${studio}','${student}','Synthetic','${startsAt}','${endsAt}',2,'scheduled','in_person','Fixture studio');
    insert into public.calendar_projections(lesson_id,external_event_id,external_version,
      status, last_error, next_attempt_at)
      values ('${lesson}','fixture-event','original','failed','synchronization_review_required', now());
    insert into public.sync_conflicts(studio_id,entity_type,entity_id,source,internal_version,external_payload)
      select '${studio}','lesson','${lesson}','google_calendar',1,'{"id":"fixture-event"}'
      from generate_series(1, 3);
  `);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261124153000_confirm_calendar_conflict_review.sql",
      "utf8",
    ),
  );
});

afterAll(() => db.close());

async function review(actor = coach, version = 2, start = startsAt) {
  const result = await db.query<{ result: string }>(
    "select public.confirm_calendar_conflict_review($1,$2,$3,$4,'fixture-event','verified-revision',$5,$6,'fixture-review') result",
    [studio, actor, lesson, version, start, endsAt],
  );
  return result.rows[0].result;
}

it("rejects unrelated actors and stale timing, then resolves duplicates with one audit and no event replay", async () => {
  await expect(review(student)).rejects.toThrow("FORBIDDEN");
  expect(await review(coach, 1)).toBe("changed");
  expect(await review(coach, 2, "2040-01-01T09:00:00Z")).toBe("changed");

  await db.query(
    "insert into public.sync_conflicts(studio_id,entity_type,entity_id,source,internal_version,external_payload) values ($1,'lesson',$2,'google_calendar',2,'{\"id\":\"fixture-event\"}')",
    [studio, lesson],
  );
  expect(await review()).toBe("changed");
  await db.query(
    "delete from public.sync_conflicts where entity_id=$1 and internal_version=2",
    [lesson],
  );

  await db.exec(
    readFileSync(
      "supabase/migrations/20261124161000_consolidate_calendar_conflict_observations.sql",
      "utf8",
    ),
  );
  const observe = (event: object) =>
    db.query(
      "insert into public.sync_conflicts(studio_id,entity_type,entity_id,source,internal_version,external_payload) values ($1,'lesson',$2,'google_calendar',2,$3) returning id",
      [studio, lesson, event],
    );
  expect(
    (await observe({ id: "fixture-event", etag: "new-revision" })).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("select id from public.sync_conflicts where status='open'"))
      .rows,
  ).toHaveLength(1);
  expect(
    (
      await db.query(
        "select id from public.sync_conflicts where status='merged'",
      )
    ).rows,
  ).toHaveLength(2);

  const before = await db.query("select * from public.lessons where id=$1", [
    lesson,
  ]);
  expect(await review()).toBe("reviewed");
  expect(await review()).toBe("already_reviewed");
  expect(
    await db.query("select * from public.lessons where id=$1", [lesson]),
  ).toEqual(before);
  expect(
    (
      await db.query(
        "select distinct status from public.sync_conflicts where status<>'merged'",
      )
    ).rows,
  ).toEqual([{ status: "accepted_internal" }]);
  expect(
    (
      await db.query(
        "select status,external_event_id,external_version,next_attempt_at from public.calendar_projections",
      )
    ).rows,
  ).toEqual([
    {
      status: "reviewed",
      external_event_id: "fixture-event",
      external_version: "verified-revision",
      next_attempt_at: null,
    },
  ]);
  expect(
    (await db.query("select action from public.audit_events")).rows,
  ).toEqual([{ action: "system_health.review_calendar_conflict" }]);
  const replay = await db.query(
    "select public.observe_existing_calendar_conflict($1,$2,$3) as known",
    [studio, lesson, { id: "fixture-event", etag: "later-metadata-revision" }],
  );
  expect(replay.rows).toEqual([{ known: true }]);
  expect((await observe({ id: "fixture-event" })).rows).toHaveLength(0);
  expect(
    (
      await observe({
        id: "fixture-event",
        start: { dateTime: "2040-01-01T12:00:00Z" },
        end: { dateTime: "2040-01-01T13:00:00Z" },
      })
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await observe({
        id: "fixture-event",
        startsAt: "2040-01-01T07:00:00-05:00",
        endsAt: "2040-01-01T08:00:00-05:00",
      })
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        "select status,last_error from public.calendar_projections",
      )
    ).rows,
  ).toEqual([
    { status: "failed", last_error: "synchronization_review_required" },
  ]);
});
