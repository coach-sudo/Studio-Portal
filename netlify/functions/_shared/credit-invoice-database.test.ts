// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { creditCoverageSchema } from "../../../src/domain/creditCoverage";
const studio = "10000000-0000-4000-8000-000000000001",
  student = "20000000-0000-4000-8000-000000000001",
  other = "20000000-0000-4000-8000-000000000002",
  coach = "30000000-0000-4000-8000-000000000001";
let db: PGlite;
let preservedExplicitBalance: Record<string, unknown>;
const scalar = async (sql: string, params: unknown[] = []) =>
  (await db.query<Record<string, unknown>>(sql, params)).rows[0];
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
 create type public.lesson_status as enum('scheduled','completed','cancelled','late_cancelled');
 create type public.payment_entry_kind as enum('payment','refund','adjustment');
 create type public.credit_entry_kind as enum('purchase','reservation','consumption','release','adjustment','expiration');
 create table public.studios(id uuid primary key,name text,timezone text,settings jsonb default '{}');
 create table public.students(id uuid primary key,studio_id uuid references public.studios, user_id uuid,deleted_at timestamptz,full_name text,email text,guardian_name text,guardian_email text,updated_at timestamptz default now(),is_minor boolean default false,portal_enabled boolean default true);
 create table public.memberships(user_id uuid,studio_id uuid,role text);
 create function public.is_studio_coach(studio uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.memberships where user_id=auth.uid() and studio_id=studio and role='coach') $$;
 create function public.can_view_student_finance(sid uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.students where id=sid and (user_id=auth.uid() or public.is_studio_coach(studio_id))) $$;
 create table public.package_definitions(id uuid primary key,studio_id uuid,name text,currency text default 'USD',price_minor bigint default 10000,session_count integer,expiration_days integer,active boolean default true);
 create table public.packages(id uuid primary key default gen_random_uuid(),student_id uuid references public.students,name text,definition_id uuid references public.package_definitions,expires_at timestamptz,price_minor bigint default 0,currency text default 'USD',credit_quantity integer default 1,auto_apply boolean default false,version integer default 1,created_at timestamptz default now(),updated_at timestamptz default now());
 create table public.lessons(id uuid primary key default gen_random_uuid(),studio_id uuid references public.studios,student_id uuid references public.students,topic text,starts_at timestamptz,ends_at timestamptz,status public.lesson_status default 'scheduled',payment_status text default 'untracked',price_minor bigint,paid_minor bigint default 0,package_id uuid references public.packages,service_id uuid,location_type text,location_label text,meeting_provider text,series_id uuid,capacity integer,source_provider text,version integer default 1,updated_at timestamptz default now());
 create table public.package_credit_entries(id uuid primary key default gen_random_uuid(),package_id uuid references public.packages,lesson_id uuid references public.lessons,kind public.credit_entry_kind,quantity integer,reason text,idempotency_key text unique,reverses_entry_id uuid unique,created_by uuid,created_at timestamptz default now());
 create function public.package_credit_balance(pid uuid) returns integer language sql stable as $$select coalesce(sum(quantity),0)::integer from public.package_credit_entries where package_id=pid$$;
 create table public.payment_entries(id uuid primary key default gen_random_uuid(),student_id uuid references public.students,package_id uuid,kind public.payment_entry_kind,amount_minor bigint,currency text,external_reference text unique,reason text,created_at timestamptz default now());
 create table public.booking_services(id uuid primary key default gen_random_uuid(),studio_id uuid references public.studios,name text,price_minor bigint,currency text default 'USD',buffer_before_minutes integer default 0,buffer_after_minutes integer default 0);
 create table public.bookings(id uuid primary key default gen_random_uuid(),studio_id uuid references public.studios,student_id uuid references public.students,reference text,starts_at timestamptz,ends_at timestamptz,status text default 'confirmed',payment_policy text default 'pay_later',payment_status text default 'due',policy_snapshot jsonb default '{"cancellationWindowHours":36,"settlement":"original_payment"}',paid_minor bigint default 0,total_minor bigint default 0,currency text default 'USD',version integer default 1,updated_at timestamptz default now(),offering_id uuid,service_id uuid,series_id uuid,guest_name text,guest_email text,guardian_name text,guardian_email text,hold_ids uuid[],location text,timezone text,reschedule_count integer default 0);
 create table public.lesson_participants(id uuid primary key default gen_random_uuid(),lesson_id uuid references public.lessons,student_id uuid references public.students,booking_id uuid references public.bookings,status text default 'confirmed',created_at timestamptz default now(),email text,display_name text,unique(lesson_id,email));
 create table public.service_offerings(id uuid primary key,capacity integer,enrolled integer,version integer,updated_at timestamptz,lesson_ids uuid[]);
 create table public.recurring_series(id uuid primary key,kind text,occurrence_count integer,cadence text);
 create table public.booking_holds(id uuid primary key,status text);
 create table public.outbox_messages(id uuid,lesson_id uuid,booking_id uuid,status text,event_key text,updated_at timestamptz);
 create table public.calendar_projections(lesson_id uuid primary key,status text,last_error text,next_attempt_at timestamptz,attempts integer default 0,projected_version integer,conference_request_id text);
 create table public.audit_events(id uuid primary key default gen_random_uuid(),studio_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,reason text,correlation_id text,source text,before_state jsonb,after_state jsonb);
 create table public.idempotency_keys(key text primary key,response jsonb);
 create table public.recommendations(id uuid default gen_random_uuid(),studio_id uuid,student_id uuid,entity_type text,entity_id uuid,reason_code text,title text,explanation text,evidence jsonb,urgency integer,due_at timestamptz,suggested_action text,requires_confirmation boolean,status text,dedupe_key text unique);
 insert into public.studios(id,name) values('${studio}','DAJ Studio');
 insert into public.students(id,studio_id,user_id,full_name) values('${student}','${studio}','${student}','Taylor'),('${other}','${studio}','${other}','Other student');
 insert into public.memberships values('${coach}','${studio}','coach');
 insert into public.payment_entries(student_id,kind,amount_minor,currency,reason) values('${student}','refund',1200,'USD','Legacy credit');
 insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values
 ('${other}','payment',10000,'USD','receipt:legacy','Legacy receipt'),
 ('${other}','refund',10000,'USD','studio-credit:legacy','Legacy cancellation credit'),
 ('${other}','refund',2500,'USD','account-credit:legacy:add','Legacy manual credit'),
 ('${other}','adjustment',500,'USD','account-credit:legacy:remove','Legacy manual debit');
 `);
  await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;
    alter table public.calendar_projections add constraint calendar_projections_lesson_id_key unique(lesson_id);
    alter table public.audit_events alter column correlation_id set not null;
    alter table public.audit_events enable row level security;
    create policy audit_coach_access on public.audit_events for select to authenticated using(public.is_studio_coach(studio_id));
    alter table public.recommendations add column updated_at timestamptz default now();
    alter table public.idempotency_keys add column actor_id uuid,add column command text,add column request_hash text;`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261006204647_unified_credits_and_invoices.sql",
      "utf8",
    ),
  );
  await db.exec(`create function public.can_view_student_schedule(sid uuid) returns boolean
    language sql stable as $$select public.can_view_student_finance(sid)$$;`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261014142813_credit_coverage_diagnostics.sql",
      "utf8",
    ),
  );
  await db.exec(`alter table public.packages add column stripe_price_id text;
    alter table public.lessons add column join_url text;
    alter table public.recurring_series alter column id set default gen_random_uuid();
    alter table public.recurring_series add column studio_id uuid,add column service_id uuid,add column student_id uuid,
      add column status text,add column starts_on timestamptz,add column payment_policy text,
      add column recurrence_rule jsonb,add column meeting_provider text;
    create table public.webhook_events(id text primary key,provider text,event_type text,payload jsonb,status text,error text,processed_at timestamptz);
    create table public.package_gifts(id uuid primary key,definition_id uuid,studio_id uuid,status text,claimed_student_id uuid,
      package_id uuid,expires_at timestamptz,deliver_at timestamptz,updated_at timestamptz,stripe_checkout_session_id text);`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261014151934_credit_lifecycle_reliability.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20260830221230_sync_lesson_booking_financials.sql",
      "utf8",
    ),
  );
  preservedExplicitBalance = (await scalar(
    `select sum(case when kind='refund' then amount_minor else -amount_minor end) filter(where account_credit) balance,
    count(*) entries, count(*) filter(where external_reference like 'opening-account-credit:%') openings,
    sum(amount_minor) filter(where external_reference='receipt:legacy' and not account_credit) receipt
    from public.payment_entries where student_id=$1`,
    [other],
  ))!;
  await db.exec(`alter table lessons add column offering_id uuid;
    alter table recurring_series add column updated_at timestamptz default now();
    alter table outbox_messages add column suppression_reason text,add column student_id uuid;
    alter table calendar_projections add column id uuid default gen_random_uuid(),add column external_event_id text,
      add column external_version text,add column last_projected_at timestamptz;
    create table sync_conflicts(entity_type text,entity_id uuid,status text);`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261014163444_occurrence_safe_lesson_changes.sql",
      "utf8",
    ),
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("occurrence-safe lesson changes against the dependent SQL stack", () => {
  it("rejects mismatched studio/booking associations without returning another studio's booking identity", async () => {
    await reset();
    const l = await lesson();
    const b = await booking([l]);
    const foreign = "10000000-0000-4000-8000-000000000099";
    await db.query(
      `insert into studios(id,name) values($1,'Other studio') on conflict do nothing`,
      [foreign],
    );
    await db.query(`update bookings set studio_id=$1 where id=$2`, [
      foreign,
      b,
    ]);
    const r = await review(l);
    expect(r.preview.items[0]).toMatchObject({
      eligible: false,
      reasonCode: "booking_ownership_review_required",
      bookings: [],
    });
    await expect(change(l)).rejects.toThrow(
      "booking_ownership_review_required",
    );
    expect(
      (await scalar(`select status from bookings where id=$1`, [b]))!.status,
    ).toBe("confirmed");
  });
  it("retains a shared booking and its completed occurrence when its last scheduled occurrence changes", async () => {
    await reset();
    const upcoming = await lesson(),
      past = await lesson("now()-interval '7 days'");
    await db.query(`update lessons set status='completed' where id=$1`, [past]);
    const b = await booking([upcoming, past]);
    await db.query(
      `update lesson_participants set status='attended' where lesson_id=$1`,
      [past],
    );
    const before = await scalar(
      `select to_jsonb(b) booking,(select to_jsonb(l) from lessons l where id=$2) history from bookings b where id=$1`,
      [b, past],
    );
    await change(upcoming);
    expect(
      await scalar(
        `select to_jsonb(b) booking,(select to_jsonb(l) from lessons l where id=$2) history from bookings b where id=$1`,
        [b, past],
      ),
    ).toEqual(before);
  });
  it("keeps local time and durations across DST for explicitly requested booking-series reschedules", async () => {
    await reset();
    const first = await lesson("'2027-03-06T15:00:00Z'::timestamptz"),
      next = await lesson("'2027-03-20T14:00:00Z'::timestamptz");
    const b = await booking([first, next]);
    await db.query(
      `update bookings set timezone='America/New_York' where id=$1`,
      [b],
    );
    await db.query(
      `select reschedule_booking_occurrences($1,1,'2027-03-14T14:00:00Z','2027-03-14T15:30:00Z','series')`,
      [b],
    );
    expect(
      (await scalar(`select starts_at,ends_at from lessons where id=$1`, [
        next,
      ]))!,
    ).toEqual({
      starts_at: new Date("2027-03-28T14:00:00Z"),
      ends_at: new Date("2027-03-28T15:30:00Z"),
    });
  });
  it("keeps withdrawal notification intent valid after another participant changes the class", async () => {
    await reset();
    const l = await lesson();
    await db.query(
      `update lessons set student_id=null,capacity=2 where id=$1`,
      [l],
    );
    const b = await booking([l]);
    await booking([l], other);
    await db.query(`select cancel_booking_credit($1,1,false,true)`, [b]);
    const claimed = (
      (await scalar(`select claim_lesson_change_effects() result`))!
        .result as any
    ).effects[0];
    await db.query(
      `update lessons set starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day',version=version+1 where id=$1`,
      [l],
    );
    expect(
      (await scalar(`select lesson_change_effect_current($1,$2) result`, [
        claimed.id,
        claimed.claim_token,
      ]))!.result,
    ).toBe(true);
    await db.query(`select finish_lesson_change_effect($1,$2,'{}')`, [
      claimed.id,
      claimed.claim_token,
    ]);
    expect(
      (await scalar(`select status from lesson_ops.effects where id=$1`, [
        claimed.id,
      ]))!.status,
    ).toBe("completed");
  });
  it("keeps an ongoing contract generating after its last visible occurrence is cancelled, until future scope is explicitly selected", async () => {
    await reset();
    const l = await lesson();
    const b = await booking([l]);
    const series = await scalar(
      `insert into recurring_series(studio_id,student_id,service_id,kind,cadence,status,starts_on,payment_policy)
      select studio_id,student_id,service_id,'ongoing','weekly','active',starts_at,payment_policy from bookings where id=$1 returning id`,
      [b],
    );
    await db.query(`update lessons set series_id=$1 where id=$2`, [
      series!.id,
      l,
    ]);
    await db.query(
      `update bookings set series_id=$1,timezone='America/New_York',location='in_person' where id=$2`,
      [series!.id, b],
    );
    await change(l);
    expect(
      (await scalar(`select status from bookings where id=$1`, [b]))!.status,
    ).toBe("confirmed");
    expect(
      (await scalar(`select extend_ongoing_series() n`))!.n,
    ).toBeGreaterThan(0);
    const next = (await scalar(
      `select id from lessons where status='scheduled' and series_id=$1 order by starts_at limit 1`,
      [series!.id],
    ))!.id as string;
    await execute((await review(next, { scope: "future" })).value);
    expect(
      (await scalar(`select status from recurring_series where id=$1`, [
        series!.id,
      ]))!.status,
    ).toBe("cancelled");
    expect(
      (await scalar(`select status from bookings where id=$1`, [b]))!.status,
    ).toBe("cancelled");
    expect((await scalar(`select extend_ongoing_series() n`))!.n).toBe(0);
  });
  it("keeps a previously withdrawn student's upcoming work and ledger unchanged in a whole-class change", async () => {
    await reset();
    const l = await lesson();
    await db.query(
      `update lessons set student_id=null,capacity=3 where id=$1`,
      [l],
    );
    await booking([l]);
    const old = await booking([l], other);
    await db.query(
      `update lesson_participants set status='cancelled' where booking_id=$1`,
      [old],
    );
    const next = await lesson("now()+interval '12 days'", other);
    const p = await lot(1);
    await db.query(`update packages set student_id=$1 where id=$2`, [other, p]);
    await db.query(
      `update student_credit_accounts set auto_apply=true where student_id=$1`,
      [other],
    );
    const before = await scalar(
      `select to_jsonb(l) lesson,(select jsonb_agg(to_jsonb(e) order by e.id) from package_credit_entries e) ledger from lessons l where id=$1`,
      [next],
    );
    await execute((await review(l, { wholeClass: true })).value);
    expect(
      await scalar(
        `select to_jsonb(l) lesson,(select jsonb_agg(to_jsonb(e) order by e.id) from package_credit_entries e) ledger from lessons l where id=$1`,
        [next],
      ),
    ).toEqual(before);
    expect(
      (await scalar(
        `select student_ids from lesson_ops.effects where lesson_id=$1`,
        [l],
      ))!.student_ids,
    ).toEqual([student]);
  });
  it("booking financial triggers never treat an uncovered recurring occurrence as paid credit or cash", async () => {
    await reset();
    await lot(1);
    const first = await lesson(),
      next = await lesson("now()+interval '12 days'");
    const b = await booking([first, next]);
    await db.query(`select reserve_student_lesson_credit($1,$2,null,true)`, [
      first,
      student,
    ]);
    expect(
      (await scalar(`select payment_status from lessons where id=$1`, [next]))!
        .payment_status,
    ).not.toBe("paid");
    expect(
      (await scalar(
        `select count(*) n from package_credit_entries where lesson_id=$1`,
        [next],
      ))!.n,
    ).toBe(0);
    await db.query(
      `update student_credit_accounts set auto_apply=true where student_id=$1`,
      [student],
    );
    await change(first);
    expect(
      (await scalar(`select payment_status from lessons where id=$1`, [next]))!
        .payment_status,
    ).toBe("paid_by_credit");
    expect(
      (await scalar(`select status from bookings where id=$1`, [b]))!.status,
    ).toBe("confirmed");
    expect(
      (await scalar(
        `select sum(quantity) n from package_credit_entries where lesson_id=$1`,
        [next],
      ))!.n,
    ).toBe(-1);
  });
  it("blocks a multi-occurrence invoice line without waiving unrelated charges or changing its associations", async () => {
    await reset();
    const first = await lesson(),
      next = await lesson("now()+interval '12 days'");
    const inv = await invoice(await service(), "service", [first]);
    // Characterize an existing legacy/imported JSON line; current authoring already refuses it.
    await db.query(
      `update studio_invoices set items=jsonb_set(items,'{0,lessonIds}',$2::jsonb) where id=$1`,
      [inv.id, JSON.stringify([first, next])],
    );
    const before = await scalar(
      `select to_jsonb(i) invoice from studio_invoices i where id=$1`,
      [inv.id],
    );
    await expect(change(first)).rejects.toThrow(
      "shared_invoice_review_required",
    );
    expect(
      await scalar(
        `select to_jsonb(i) invoice from studio_invoices i where id=$1`,
        [inv.id],
      ),
    ).toEqual(before);
  });
  it("increments the shared booking's reschedule counter without moving its contract and rejects stale repeats", async () => {
    await reset();
    const first = await lesson(),
      next = await lesson("now()+interval '12 days'");
    const b = await booking([first, next]);
    const before = await scalar(
      `select starts_at,ends_at from bookings where id=$1`,
      [b],
    );
    const startsAt = new Date(Date.now() + 7 * 86400000).toISOString(),
      endsAt = new Date(Date.now() + 7 * 86400000 + 3600000).toISOString();
    const moved = (await scalar(
      `select to_jsonb(reschedule_booking_occurrences($1,1,$2,$3)) result`,
      [b, startsAt, endsAt],
    ))!.result as any;
    expect(moved.reschedule_count).toBe(1);
    expect(
      await scalar(`select starts_at,ends_at from bookings where id=$1`, [b]),
    ).toEqual(before);
    await expect(
      db.query(`select reschedule_booking_occurrences($1,1,$2,$3)`, [
        b,
        startsAt,
        endsAt,
      ]),
    ).rejects.toThrow("VERSION_CONFLICT");
  });
  async function booking(ids: string[], sid = student, paid = false) {
    const b = await scalar(
      `insert into bookings(studio_id,student_id,service_id,starts_at,ends_at,payment_policy,payment_status,total_minor,paid_minor,policy_snapshot)
      select studio_id,$2,$3,starts_at,ends_at,$4,$5,$6,$6,'{"rescheduleLimit":5}' from lessons where id=$1 returning id`,
      [
        ids[0],
        sid,
        await service(),
        paid ? "pay_now" : "pay_later",
        paid ? "paid" : "due",
        paid ? 10000 : 0,
      ],
    );
    for (const id of ids)
      await db.query(
        `insert into lesson_participants(lesson_id,student_id,booking_id,email) values($1,$2,$3,$4)`,
        [id, sid, b!.id, sid + "@example.test"],
      );
    return b!.id as string;
  }
  async function change(
    id: string,
    action = "cancel",
    extra: Record<string, unknown> = {},
  ) {
    const v = (await scalar(`select version from lessons where id=$1`, [id]))!
      .version;
    return (await scalar(
      `select command_change_lesson_state($1,$2,$3,$4,$5) result`,
      [id, v, action, extra.startsAt || null, extra.endsAt || null],
    ))!.result as any;
  }
  async function review(id: string, extra: Record<string, unknown> = {}) {
    const value = {
      lessonId: id,
      action: "cancel",
      scope: "occurrence",
      reason: "Reviewed occurrence change",
      wholeClass: false,
      useCredit: false,
      ...extra,
    };
    const preview = (await scalar(
      `select preview_lesson_occurrence_change($1,$2) result`,
      [coach, value],
    ))!.result as any;
    return { preview, value: { ...value, reviewToken: preview.reviewToken } };
  }
  async function execute(value: unknown, key = "review-change-key") {
    return (await scalar(
      `select execute_lesson_occurrence_change($1,$2,$3) result`,
      [coach, key, value],
    ))!.result as any;
  }
  it("cancels only one shared-booking occurrence, leaves history/reminders/participants untouched, and replays once", async () => {
    await reset();
    const first = await lesson("now()+interval '2 days'"),
      next = await lesson("now()+interval '9 days'");
    const b = await booking([first, next]);
    await db.query(
      `insert into outbox_messages(id,lesson_id,booking_id,event_key,status) values(gen_random_uuid(),$1,$3,'booking.reminder.student','queued'),(gen_random_uuid(),$2,$3,'booking.reminder.student','queued')`,
      [first, next, b],
    );
    const before = await scalar(
      `select to_jsonb(l) lesson,(select to_jsonb(b) from bookings b where id=$2) booking,(select jsonb_agg(to_jsonb(p)) from lesson_participants p where lesson_id=$1) participants from lessons l where id=$1`,
      [next, b],
    );
    const changed = await change(first);
    expect(
      await scalar(
        `select to_jsonb(l) lesson,(select to_jsonb(b) from bookings b where id=$2) booking,(select jsonb_agg(to_jsonb(p)) from lesson_participants p where lesson_id=$1) participants from lessons l where id=$1`,
        [next, b],
      ),
    ).toEqual(before);
    expect(
      (await scalar(`select status from outbox_messages where lesson_id=$1`, [
        next,
      ]))!.status,
    ).toBe("queued");
    expect(
      (await scalar(`select status from outbox_messages where lesson_id=$1`, [
        first,
      ]))!.status,
    ).toBe("cancelled");
    const replay = (await scalar(
      `select command_change_lesson_state($1,1,'cancel') result`,
      [first],
    ))!.result as any;
    expect(replay).toEqual({ ...changed, duplicate: true });
    expect((await scalar(`select count(*) n from lesson_ops.effects`))!.n).toBe(
      1,
    );
    expect(
      (await scalar(
        `select count(*) n from audit_events where action='lesson.cancelled'`,
      ))!.n,
    ).toBe(1);
  });
  it("reschedules one occurrence without shifting the shared booking or its next occurrence", async () => {
    await reset();
    const first = await lesson("now()+interval '2 days'"),
      next = await lesson("now()+interval '9 days'");
    const b = await booking([first, next], student, true);
    const before = await scalar(
      `select to_jsonb(b) booking,(select to_jsonb(l) from lessons l where id=$2) lesson from bookings b where id=$1`,
      [b, next],
    );
    await change(first, "reschedule", {
      startsAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      endsAt: new Date(Date.now() + 3 * 86400000 + 3600000).toISOString(),
    });
    expect(
      await scalar(
        `select to_jsonb(b) booking,(select to_jsonb(l) from lessons l where id=$2) lesson from bookings b where id=$1`,
        [b, next],
      ),
    ).toEqual(before);
  });
  it("blocks ambiguous shared prepaid cancellation without changing any financial or coaching records", async () => {
    await reset();
    const a = await lesson(),
      b = await lesson("now()+interval '9 days'");
    await booking([a, b], student, true);
    const before = await scalar(
      `select jsonb_agg(to_jsonb(l) order by id) lessons from lessons l`,
    );
    await expect(change(a)).rejects.toThrow("shared_prepaid_review_required");
    expect(
      await scalar(
        `select jsonb_agg(to_jsonb(l) order by id) lessons from lessons l`,
      ),
    ).toEqual(before);
    expect((await scalar(`select count(*) n from lesson_ops.effects`))!.n).toBe(
      0,
    );
  });
  it("permits a paid standalone cancellation while preserving the cash receipt and booking payment history", async () => {
    await reset();
    const a = await lesson();
    const b = await booking([a], student, true);
    await db.query(
      `update lessons set paid_minor=10000,payment_status='paid' where id=$1`,
      [a],
    );
    await change(a);
    expect(
      await scalar(
        `select status,paid_minor,payment_status from bookings where id=$1`,
        [b],
      ),
    ).toMatchObject({
      status: "cancelled",
      paid_minor: 10000,
      payment_status: "paid",
    });
  });
  it("requires explicit whole-class review and refuses student-scoped class changes", async () => {
    await reset();
    const l = await lesson();
    await db.query(`update lessons set capacity=2 where id=$1`, [l]);
    await booking([l]);
    await booking([l], other);
    await expect(change(l)).rejects.toThrow("class_scope_required");
    const blocked = await review(l, { studentContextId: student });
    expect(blocked.preview.items[0]).toMatchObject({
      eligible: false,
      reasonCode: "class_scope_required",
    });
    const r = await review(l, { wholeClass: true });
    expect(r.preview.items[0].notificationParticipantCount).toBe(2);
    await execute(r.value);
    expect(
      (await scalar(
        `select count(*) n from lesson_participants where status='confirmed'`,
      ))!.n,
    ).toBe(0);
    expect(
      (await scalar(
        `select cardinality(student_ids) n from lesson_ops.effects`,
      ))!.n,
    ).toBe(2);
  });
  it("withdrawing a booked student leaves a booking-free class participant, reminders and credit ledger intact", async () => {
    await reset();
    const l = await lesson();
    await db.query(
      `update lessons set student_id=null,capacity=2 where id=$1`,
      [l],
    );
    const b = await booking([l]);
    await db.query(
      `insert into lesson_participants(lesson_id,student_id,email) values($1,$2,'native@example.test')`,
      [l, other],
    );
    await db.query(
      `insert into outbox_messages(id,lesson_id,student_id,status,event_key) values(gen_random_uuid(),$1,$2,'queued','booking.reminder.student'),(gen_random_uuid(),$1,$3,'queued','booking.reminder.student')`,
      [l, student, other],
    );
    await lot(2);
    await db.query(`select reserve_student_lesson_credit($1,$2,null,true)`, [
      l,
      student,
    ]);
    const before = await scalar(
      `select to_jsonb(lp) participant from lesson_participants lp where student_id=$1`,
      [other],
    );
    const v = (await scalar(`select version from bookings where id=$1`, [b]))!
      .version;
    await db.query(`select cancel_booking_credit($1,$2,false,true)`, [b, v]);
    expect(
      (await scalar(`select status from lessons where id=$1`, [l]))!.status,
    ).toBe("scheduled");
    expect(
      await scalar(
        `select to_jsonb(lp) participant from lesson_participants lp where student_id=$1`,
        [other],
      ),
    ).toEqual(before);
    expect((await summary()).reserved).toBe(0);
    expect(
      (await scalar(`select status from outbox_messages where student_id=$1`, [
        student,
      ]))!.status,
    ).toBe("cancelled");
    expect(
      (await scalar(`select status from outbox_messages where student_id=$1`, [
        other,
      ]))!.status,
    ).toBe("queued");
    expect(
      (await scalar(`select student_ids from lesson_ops.effects`))!.student_ids,
    ).toEqual([student]);
  });
  it("rejects pending invoice JSON associations and unresolved provider synchronization", async () => {
    await reset();
    const l = await lesson();
    const inv = await invoice(await service(), "service", [l]);
    await db.query(
      `update studio_invoices set checkout_key='pending' where id=$1`,
      [inv.id],
    );
    await expect(change(l)).rejects.toThrow("payment_pending");
    await db.query(`update studio_invoices set checkout_key=null where id=$1`, [
      inv.id,
    ]);
    await db.query(
      `update lessons set source_provider='google_calendar' where id=$1`,
      [l],
    );
    await db.query(`insert into sync_conflicts values('lesson',$1,'open')`, [
      l,
    ]);
    await expect(change(l)).rejects.toThrow("synchronization_review_required");
  });
  it("executes a frozen selection and rejects dependencies added after review", async () => {
    await reset();
    const a = await lesson(),
      b = await lesson("now()+interval '9 days'");
    const r = await review(a, { scope: "selected", selectedIds: [a, b] });
    await db.query(
      `insert into lesson_participants(lesson_id,student_id,email) values($1,$2,'added@example.test')`,
      [b, student],
    );
    await expect(execute(r.value)).rejects.toThrow("VERSION_CONFLICT");
    expect(
      (await scalar(`select count(*) n from lessons where status='scheduled'`))!
        .n,
    ).toBe(2);
    const fresh = await review(a, { scope: "selected", selectedIds: [a, b] });
    const extra = await lesson("now()+interval '16 days'");
    await execute(fresh.value);
    expect(
      (await scalar(`select status from lessons where id=$1`, [extra]))!.status,
    ).toBe("scheduled");
    expect((await execute(fresh.value)).duplicate).toBe(true);
  });
  it("stops future generation only for explicit future scope and freezes expanded IDs", async () => {
    await reset();
    const a = await lesson(),
      b = await lesson("now()+interval '9 days'");
    const series = await scalar(
      `insert into recurring_series(studio_id,student_id,kind,status) values($1,$2,'ongoing','active') returning id`,
      [studio, student],
    );
    await db.query(`update lessons set series_id=$1`, [series!.id]);
    const r = await review(a, { scope: "future" });
    const extra = await lesson("now()+interval '16 days'");
    await db.query(`update lessons set series_id=$1 where id=$2`, [
      series!.id,
      extra,
    ]);
    await expect(execute(r.value)).rejects.toThrow("VERSION_CONFLICT");
    await execute((await review(a)).value, "single-occurrence");
    expect((await scalar(`select status from recurring_series`))!.status).toBe(
      "active",
    );
    await execute(
      (await review(b, { scope: "future" })).value,
      "future-occurrences",
    );
    expect((await scalar(`select status from recurring_series`))!.status).toBe(
      "cancelled",
    );
  });
  it("reschedules multiple occurrences before allocating credits and preserves wall-clock time across DST", async () => {
    await reset();
    await lot(2);
    await db.query(
      `update student_credit_accounts set auto_apply=true where student_id=$1`,
      [student],
    );
    const a = await lesson("'2027-03-06T15:00:00Z'::timestamptz"),
      b = await lesson("'2027-03-13T15:00:00Z'::timestamptz");
    const r = await review(a, {
      scope: "selected",
      selectedIds: [a, b],
      action: "reschedule",
      startsAt: "2027-03-07T15:00:00Z",
      endsAt: "2027-03-07T16:30:00Z",
    });
    await execute(r.value);
    expect(
      (await scalar(`select starts_at from lessons where id=$1`, [b]))!
        .starts_at,
    ).toEqual(new Date("2027-03-14T14:00:00Z"));
    expect((await summary()).reserved).toBe(2);
  });
  it("fences late calendar completions, preserves obtained identity and retries an expired lease", async () => {
    await reset();
    const l = await lesson();
    await db.query(
      `insert into calendar_projections(lesson_id,status) values($1,'queued')`,
      [l],
    );
    const claimed = (
      await db.query<any>(`select * from claim_calendar_projections(10)`)
    ).rows[0];
    await change(l);
    const done = (await scalar(
      `select finish_calendar_projection($1,$2,$3) result`,
      [
        claimed.projection.id,
        claimed.projection.claim_token,
        { id: "individual-event", etag: "etag" },
      ],
    ))!.result;
    expect(done).toBe(false);
    const p = await scalar(
      `select status,external_event_id,projected_version,first_attempted_at from calendar_projections`,
    );
    expect(p).toMatchObject({
      status: "queued",
      external_event_id: "individual-event",
    });
    expect(p!.first_attempted_at).toBeTruthy();
    const next = (
      await db.query<any>(`select * from claim_calendar_projections(10)`)
    ).rows[0];
    await db.exec(
      `update calendar_projections set claim_until=now()-interval '1 second'`,
    );
    const recovered = (
      await db.query<any>(`select * from claim_calendar_projections(10)`)
    ).rows[0];
    expect(recovered.projection.claim_token).not.toBe(
      next.projection.claim_token,
    );
    expect(
      (await scalar(`select finish_calendar_projection($1,$2,'{}') result`, [
        next.projection.id,
        next.projection.claim_token,
      ]))!.result,
    ).toBe(false);
  });
  it("recovers notification intent failures with a stable cohort and refuses an old worker token", async () => {
    await reset();
    const l = await lesson();
    await change(l);
    const claim = (await scalar(`select claim_lesson_change_effects() result`))!
      .result as any;
    const e = claim.effects[0];
    await db.query(`select finish_lesson_change_effect($1,$2,'{}',true)`, [
      e.id,
      e.claim_token,
    ]);
    expect(
      (await scalar(`select status from lesson_ops.effects`))!.status,
    ).toBe("failed");
    expect(
      (
        (await scalar(`select claim_lesson_change_effects() result`))!
          .result as any
      ).effects,
    ).toHaveLength(0);
    await db.exec(
      `update lesson_ops.effects set next_attempt_at=now()-interval '1 second'`,
    );
    const retry = (
      (await scalar(`select claim_lesson_change_effects() result`))!
        .result as any
    ).effects[0];
    expect(retry.student_ids).toEqual(e.student_ids);
    expect(
      (await scalar(`select finish_lesson_change_effect($1,$2,'{}') result`, [
        e.id,
        e.claim_token,
      ]))!.result,
    ).toBe(false);
    await db.query(`select finish_lesson_change_effect($1,$2,'{}')`, [
      e.id,
      retry.claim_token,
    ]);
    expect(
      (await scalar(`select status from lesson_ops.effects`))!.status,
    ).toBe("completed");
  });
});

describe("read-only credit coverage diagnostics", () => {
  async function coverage(page = 1, size = 25, preview = false) {
    await db.exec(`reset role;select set_config('app.uid','${coach}',false);`);
    const result = await scalar(
      `select public.student_credit_coverage($1,$2,$3,$4) result`,
      [student, page, size, preview],
    );
    return creditCoverageSchema.parse(result!.result);
  }

  it("allocates before pagination and never writes the ledger, lessons or preference", async () => {
    await reset();
    await lot(1);
    const first = await lesson("now()+interval '1 day'");
    const second = await lesson("now()+interval '2 days'");
    const before = await scalar(
      `select public.student_credit_summary($1) summary,
      (select jsonb_agg(to_jsonb(l) order by id) from public.lessons l) lessons,
      (select jsonb_agg(to_jsonb(e) order by id) from public.package_credit_entries e) ledger`,
      [student],
    );
    const page1 = await coverage(1, 1, true);
    const page2 = await coverage(2, 1, true);
    expect(page1.items[0]).toMatchObject({
      lessonId: first,
      state: "eligible_unreserved",
      reasonCode: "eligible",
    });
    expect(page2.items[0]).toMatchObject({
      lessonId: second,
      reasonCode: "no_available_credits",
    });
    expect(page2.counts).toEqual({
      covered: 0,
      eligible: 1,
      uncovered: 1,
      reviewRequired: 0,
    });
    expect(page1.hasMore).toBe(true);
    expect(page2.hasMore).toBe(false);
    expect(
      await scalar(
        `select public.student_credit_summary($1) summary,
      (select jsonb_agg(to_jsonb(l) order by id) from public.lessons l) lessons,
      (select jsonb_agg(to_jsonb(e) order by id) from public.package_credit_entries e) ledger`,
        [student],
      ),
    ).toEqual(before);
    expect(
      (await coverage()).items.every(
        (item) => item.reasonCode === "auto_disabled",
      ),
    ).toBe(true);
  });

  it("uses earliest expiry and explains credits that expire before a lesson", async () => {
    await reset();
    const expiry = new Date(Date.now() + 3 * 86400000).toISOString();
    const earlyLot = await lot(1, expiry);
    const lastingLot = await lot(1);
    await lesson("now()+interval '1 day'");
    await lesson("now()+interval '5 days'");
    const result = await coverage(1, 25, true);
    expect(result.items.map((item) => item.packageId)).toEqual([
      earlyLot,
      lastingLot,
    ]);
    await db.query(
      `delete from public.package_credit_entries where package_id=$1`,
      [lastingLot],
    );
    expect((await coverage(1, 25, true)).items[1].reasonCode).toBe(
      "no_available_credits",
    );
    await db.query(
      `delete from public.lessons where starts_at < now()+interval '3 days'`,
    );
    expect((await coverage(1, 25, true)).items[0].reasonCode).toBe(
      "expires_before_lesson",
    );
  });

  it("recognizes existing reservations even when automatic use is off", async () => {
    await reset();
    const p = await lot(2);
    const l = await lesson();
    await db.query(
      `select public.reserve_student_lesson_credit($1,$2,$3,true)`,
      [l, student, p],
    );
    expect((await coverage()).items[0]).toMatchObject({
      state: "covered",
      reasonCode: "already_reserved",
      eligible: false,
    });
    expect((await coverage()).summary).toMatchObject({
      available: 1,
      reserved: 1,
      remaining: 2,
      autoApply: false,
    });
  });

  it("protects paid, partial, waived and invoice-checkout lessons", async () => {
    await reset();
    await lot(10);
    for (const status of ["paid", "partially_paid", "waived"]) {
      const l = await lesson();
      await db.query(
        `update public.lessons set payment_status=$2 where id=$1`,
        [l, status],
      );
    }
    const pending = await lesson();
    const inv = await invoice(await service(), "service", [pending]);
    await db.query(
      `update public.studio_invoices set checkout_key='pending-key' where id=$1`,
      [inv.id],
    );
    expect(
      (await coverage(1, 25, true)).items.map((item) => item.reasonCode).sort(),
    ).toEqual([
      "cash_paid",
      "lesson_ineligible",
      "partially_paid",
      "payment_pending",
    ]);
  });

  it("explains booking processing without reserving a credit", async () => {
    await reset();
    await lot(2);
    const l = await lesson();
    const b = await scalar(
      `insert into public.bookings(studio_id,student_id,payment_policy,payment_status)
      values($1,$2,'pay_later','processing') returning id`,
      [studio, student],
    );
    await db.query(
      `insert into public.lesson_participants(lesson_id,student_id,booking_id) values($1,$2,$3)`,
      [l, student, b!.id],
    );
    expect((await coverage(1, 25, true)).items[0].reasonCode).toBe(
      "payment_pending",
    );
    expect((await summary()).available).toBe(2);
  });

  it("keeps mixed legacy flags for review without automatic spending", async () => {
    await reset();
    const on = await lot(1);
    await lot(1);
    await db.query(`update public.packages set auto_apply=true where id=$1`, [
      on,
    ]);
    await db.query(
      `update public.student_credit_accounts set auto_apply=null where student_id=$1`,
      [student],
    );
    await lesson("now()+interval '1 day'");
    await lesson("now()+interval '2 days'");
    const result = await coverage();
    expect(result.settingReasonCode).toBe("mixed_settings_review");
    expect(result.items.map((item) => item.reasonCode)).toEqual([
      "mixed_settings_review",
      "mixed_settings_review",
    ]);
    expect((await coverage(1, 25, true)).counts?.eligible).toBe(2);
  });

  it("flags ambiguous ledger records instead of repairing them", async () => {
    await reset();
    const p = await lot(1);
    const l = await lesson();
    await db.query(
      `insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason)
      values($1,$2,'reservation',-2,'Legacy duplicate')`,
      [p, l],
    );
    expect((await coverage(1, 25, true)).items[0]).toMatchObject({
      state: "review_required",
      reasonCode: "reconciliation_required",
    });
    expect((await coverage()).summary.needsReview).toBe(true);
  });

  it("covers only an active student's group participation", async () => {
    await reset();
    await lot(1);
    const group = await lesson("now()+interval '1 day'", other);
    await db.query(`update public.lessons set student_id=null where id=$1`, [
      group,
    ]);
    await db.query(
      `insert into public.lesson_participants(lesson_id,student_id,status) values($1,$2,'confirmed')`,
      [group, student],
    );
    expect((await coverage(1, 25, true)).items[0].lessonId).toBe(group);
    await db.query(
      `update public.lesson_participants set status='cancelled' where lesson_id=$1`,
      [group],
    );
    expect((await coverage()).items).toEqual([]);
  });

  it("rejects anonymous and unrelated access through public and private readers", async () => {
    await reset();
    await lot(1);
    await db.exec(
      `grant usage on schema public,auth to authenticated;select set_config('app.uid','${other}',false);set role authenticated;`,
    );
    await expect(
      db.query(`select public.student_credit_coverage($1)`, [student]),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      db.query(
        `select credit_internal.read_student_credit_coverage($1,1,25,false)`,
        [student],
      ),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      db.query(
        `select credit_internal.evaluate_student_lesson_credit($1,gen_random_uuid())`,
        [student],
      ),
    ).rejects.toThrow(/permission denied/);
    await db.exec(`reset role;set role anon;`);
    await expect(
      db.query(`select public.student_credit_coverage($1)`, [student]),
    ).rejects.toThrow(/permission denied/);
    await db.exec(`reset role;`);
  });

  it("never exposes another studio's logistics through a malformed participation", async () => {
    await reset();
    const otherStudio = "10000000-0000-4000-8000-000000000002";
    await db.query(
      `insert into public.studios(id,name) values($1,'Other studio') on conflict do nothing`,
      [otherStudio],
    );
    const foreign = await lesson();
    await db.query(
      `update public.lessons set studio_id=$2,student_id=null where id=$1`,
      [foreign, otherStudio],
    );
    await db.query(
      `insert into public.lesson_participants(lesson_id,student_id) values($1,$2)`,
      [foreign, student],
    );
    expect((await coverage()).items).toEqual([]);
  });

  it("handles empty results and rejects invalid paging", async () => {
    await reset();
    expect((await coverage()).counts).toEqual({
      covered: 0,
      eligible: 0,
      uncovered: 0,
      reviewRequired: 0,
    });
    await expect(coverage(0)).rejects.toThrow("VALIDATION_FAILED");
    await expect(coverage(1, 101)).rejects.toThrow("VALIDATION_FAILED");
  });

  it("counts existing reservations separately from newly applied credits", async () => {
    await reset();
    const p = await lot(1);
    const l = await lesson();
    await db.query(
      `select public.reserve_student_lesson_credit($1,$2,$3,true)`,
      [l, student, p],
    );
    const result = await scalar(
      `select public.reserve_student_upcoming_credits($1) result`,
      [student],
    );
    expect(result!.result).toMatchObject({
      applied: 0,
      alreadyCovered: 1,
      skipped: 0,
      failed: 0,
    });
    expect((await coverage()).counts?.eligible).toBe(0);
    expect((await summary()).reserved).toBe(1);
  });
});
async function reset() {
  await db.exec(`delete from lesson_ops.effects;delete from lesson_ops.receipts;delete from sync_conflicts;delete from outbox_messages;
    select set_config('app.lesson_actor','',false),set_config('app.lesson_class','false',false),set_config('app.lesson_reason','',false),set_config('app.lesson_defer_coverage','false',false);`);
  await db.exec(
    `select set_config('app.use_credit','false',false),set_config('app.student_cancel','false',false),set_config('app.invoice_checkout_key','',false);`,
  );
  await db.exec(
    `reset role;delete from credit_internal.credit_command_receipts;delete from credit_internal.credit_coverage_jobs;update credit_internal.coverage_sweep set cursor=null;delete from public.audit_events;delete from public.idempotency_keys;delete from public.recommendations;delete from public.package_gifts;delete from public.webhook_events;update public.lessons set invoice_id=null;delete from public.payment_entries where reason not in ('Legacy credit','Preserved opening dollar credit balance');delete from public.invoice_settlements;delete from public.studio_invoices;delete from public.package_credit_entries;delete from public.lesson_participants;delete from public.calendar_projections;delete from public.lessons;delete from public.bookings;delete from public.recurring_series;delete from public.packages;update public.student_credit_accounts set version=1,auto_apply=false;`,
  );
}
describe("credit lifecycle reliability", () => {
  async function grant(key: string, quantity = 2, extra = {}) {
    return (await scalar(
      `select public.command_grant_student_credits($1,$2,$3,$4) result`,
      [
        student,
        key,
        {
          quantity,
          kind: "adjustment",
          reason: "Regression credit grant",
          ...extra,
        },
        coach,
      ],
    ))!.result as any;
  }
  async function scan() {
    return (await scalar(
      `select public.reserve_student_upcoming_credits($1) result`,
      [student],
    ))!.result as any;
  }
  async function enable() {
    await db.query(
      `update public.student_credit_accounts set auto_apply=true where student_id=$1`,
      [student],
    );
  }
  it("atomically grants, reserves and audits once on exact replay; rejects changed requests", async () => {
    await reset();
    await enable();
    await lesson();
    await lesson("now()+interval '3 days'");
    const first = await grant("grant-repeat");
    expect(first.coverage).toMatchObject({
      applied: 2,
      alreadyCovered: 0,
      skipped: 0,
      failed: 0,
    });
    expect(await grant("grant-repeat")).toEqual({ ...first, duplicate: true });
    expect(await scan()).toMatchObject({
      applied: 0,
      alreadyCovered: 2,
      failed: 0,
    });
    expect(
      (await scalar(
        `select count(*) n from public.audit_events where correlation_id='grant-repeat'`,
      ))!.n,
    ).toBe(1);
    await expect(grant("grant-repeat", 3)).rejects.toThrow(
      "IDEMPOTENCY_CONFLICT",
    );
    expect((await summary()).remaining).toBe(2);
  });
  it("creates a reviewed package exactly once and rolls back grant if audit persistence fails", async () => {
    await reset();
    await enable();
    await lesson();
    const definition = await scalar(
      `insert into public.package_definitions(id,studio_id,name,session_count) values(gen_random_uuid(),$1,'Reviewed package',2) returning id`,
      [studio],
    );
    const payload = {
      package: {
        definitionId: definition!.id,
        name: "Reviewed package",
        priceMinor: 12345,
        currency: "USD",
        stripePriceId: null,
      },
    };
    const first = await grant("package-repeat", 2, payload);
    expect(first.package.price_minor).toBe(12345);
    expect(first.coverage.applied).toBe(1);
    expect((await grant("package-repeat", 2, payload)).package.id).toBe(
      first.package.id,
    );
    await db.exec(`create function public.fail_credit_audit() returns trigger language plpgsql as $$begin if new.correlation_id='fail-audit' then raise exception 'audit unavailable'; end if; return new;end$$;
      create trigger fail_credit_audit before insert on public.audit_events for each row execute function public.fail_credit_audit();`);
    try {
      await expect(grant("fail-audit", 2, payload)).rejects.toThrow(
        "audit unavailable",
      );
    } finally {
      await db.exec(
        `drop trigger fail_credit_audit on public.audit_events;drop function public.fail_credit_audit();`,
      );
    }
    expect((await scalar(`select count(*) n from public.packages`))!.n).toBe(1);
    expect((await summary()).remaining).toBe(2);
  });
  it("preserves a grant and durable recovery when invoice synchronization fails, then retries once", async () => {
    await reset();
    await enable();
    const l = await lesson();
    await db.exec(`create function public.fail_credit_sync() returns trigger language plpgsql as $$begin if new.quantity<0 then raise exception 'simulated invoice sync failure'; end if;return new;end$$;
      create trigger fail_credit_sync after insert on public.package_credit_entries for each row execute function public.fail_credit_sync();`);
    try {
      const result = await grant("recovery-grant", 1);
      expect(result.coverage).toMatchObject({
        applied: 0,
        failed: 1,
        autoApplyPending: true,
      });
      expect(await summary()).toMatchObject({ available: 1, reserved: 0 });
      expect(
        await scalar(
          `select generation>completed_generation pending,attempts from credit_internal.credit_coverage_jobs where student_id=$1`,
          [student],
        ),
      ).toEqual({ pending: true, attempts: 1 });
      expect(
        (await scalar(`select public.process_credit_coverage_job($1) result`, [
          student,
        ]))!.result,
      ).toEqual({ processed: false });
    } finally {
      await db.exec(
        `drop trigger fail_credit_sync on public.package_credit_entries;drop function public.fail_credit_sync();`,
      );
    }
    await db.query(
      `update credit_internal.credit_coverage_jobs set next_attempt_at=now()-interval '1 second' where student_id=$1`,
      [student],
    );
    expect(
      (await scalar(`select public.process_credit_coverage_job($1) result`, [
        student,
      ]))!.result,
    ).toMatchObject({ processed: true, applied: 1, failed: 0 });
    expect(
      (await scalar(`select public.process_credit_coverage_job($1) result`, [
        student,
      ]))!.result,
    ).toEqual({ processed: false });
    expect(
      (await scalar(
        `select count(*) n from public.package_credit_entries where lesson_id=$1 and quantity<0`,
        [l],
      ))!.n,
    ).toBe(1);
  });
  it("application requires an enabled preference and replays its audited result without changing settings", async () => {
    await reset();
    await lot(1);
    await lesson();
    const version = (await summary()).version;
    const args = [
      student,
      "apply_upcoming",
      {},
      version,
      "explicit-apply",
      coach,
    ];
    await expect(
      db.query(
        `select public.command_student_credit_settings($1,$2,$3,$4,$5,$6)`,
        args,
      ),
    ).rejects.toThrow("Review and enable");
    expect((await summary()).autoApply).toBe(false);
    await enable();
    const first = (await scalar(
      `select public.command_student_credit_settings($1,$2,$3,$4,$5,$6) result`,
      args,
    ))!.result as any;
    expect(first).toMatchObject({ applied: 1, autoApply: true, failed: 0 });
    expect(
      (await scalar(
        `select public.command_student_credit_settings($1,$2,$3,$4,$5,$6) result`,
        args,
      ))!.result,
    ).toEqual({ ...first, duplicate: true });
    expect((await summary()).autoApply).toBe(true);
  });
  it("enable, disable and adjust report accurate coverage while preserving existing holds", async () => {
    await reset();
    await lot(1);
    await lesson();
    await lesson("now()+interval '4 days'");
    const on = (await scalar(
      `select public.set_student_credit_auto($1,true,$2) result`,
      [student, (await summary()).version],
    ))!.result;
    expect(on).toMatchObject({
      applied: 1,
      alreadyCovered: 0,
      skipped: 1,
      skipReasons: { no_available_credits: 1 },
    });
    const adjust = (await scalar(
      `select public.set_student_credit_total($1,2,$2,'More lesson credits','total-add') result`,
      [student, (await summary()).version],
    ))!.result;
    expect(adjust).toMatchObject({ applied: 1, alreadyCovered: 1, failed: 0 });
    const off = (await scalar(
      `select public.set_student_credit_auto($1,false,$2) result`,
      [student, (await summary()).version],
    ))!.result;
    expect(off).toMatchObject({
      applied: 0,
      alreadyCovered: 2,
      autoApply: false,
    });
    await expect(grant("negative-grant", -1)).rejects.toThrow(
      "Reserved credits cannot be removed",
    );
    expect((await summary()).reserved).toBe(2);
  });
  it("covers actual recurring conversion immediately and does not double consume completed lessons", async () => {
    await reset();
    await enable();
    await lot(4);
    const l = await lesson();
    const result = (await scalar(
      `select public.command_make_lesson_recurring($1,1,'weekly',3,'America/New_York') result`,
      [l],
    ))!.result as any;
    expect(result.creditCoverage[student]).toMatchObject({
      applied: 3,
      failed: 0,
    });
    expect(await scan()).toMatchObject({ applied: 0, alreadyCovered: 3 });
    await db.exec(`select set_config('app.uid','${coach}',false);`);
    const version = (await scalar(
      `select version from public.lessons where id=$1`,
      [l],
    ))!.version;
    const args = [
      l,
      version,
      "Completed regression lesson",
      "complete-repeat",
      "complete-repeat",
    ];
    const completed = (await scalar(
      `select public.command_complete_lesson($1,$2,$3,$4,$5) result`,
      args,
    ))!.result;
    expect(
      (await scalar(
        `select public.command_complete_lesson($1,$2,$3,$4,$5) result`,
        args,
      ))!.result,
    ).toEqual(completed);
    expect(await summary()).toMatchObject({
      available: 1,
      reserved: 2,
      remaining: 3,
    });
  });
  it("applies returned cancellation credit to the next lesson and keeps valid rescheduled holds", async () => {
    await reset();
    await enable();
    await lot(1);
    const first = await lesson("now()+interval '1 day'");
    const next = await lesson("now()+interval '5 days'");
    await scan();
    const version = (await scalar(
      `select version from public.lessons where id=$1`,
      [first],
    ))!.version;
    const cancelled = (await scalar(
      `select public.command_cancel_lesson_credit($1,$2,false) result`,
      [first, version],
    ))!.result as any;
    expect(
      cancelled.creditCoverage[student],
      JSON.stringify(cancelled.creditCoverage[student]),
    ).toMatchObject({ applied: 1, failed: 0 });
    expect(
      (await scalar(`select payment_status from public.lessons where id=$1`, [
        next,
      ]))!.payment_status,
    ).toBe("paid_by_credit");
    const nextVersion = (await scalar(
      `select version from public.lessons where id=$1`,
      [next],
    ))!.version;
    const moved = (await scalar(
      `select public.command_change_lesson_state($1,$2,'reschedule',now()+interval '4 days',now()+interval '4 days 1 hour') result`,
      [next, nextVersion],
    ))!.result as any;
    expect(moved.creditCoverage[student]).toMatchObject({
      applied: 0,
      alreadyCovered: 1,
    });
    expect(await summary()).toMatchObject({
      available: 0,
      reserved: 1,
      remaining: 1,
    });
  });
  it("reserves after moving an uncovered lesson inside validity, and refuses to move a hold past expiry", async () => {
    await reset();
    await enable();
    await lot(1, new Date(Date.now() + 3 * 86400000).toISOString());
    const l = await lesson("now()+interval '10 days'");
    expect(await scan()).toMatchObject({
      applied: 0,
      skipped: 1,
      skipReasons: { expires_before_lesson: 1 },
    });
    const moved = (await scalar(
      `select public.command_change_lesson_state($1,1,'reschedule',now()+interval '1 day',now()+interval '1 day 1 hour') result`,
      [l],
    ))!.result as any;
    expect(moved.creditCoverage[student].applied).toBe(1);
    await expect(
      db.query(
        `select public.command_change_lesson_state($1,$2,'reschedule',now()+interval '5 days',now()+interval '5 days 1 hour')`,
        [l, moved.lesson.version],
      ),
    ).rejects.toThrow("expires before that date");
    expect((await summary()).reserved).toBe(1);
  });
  it("manual replay finds an existing reservation with zero available credits and keeps automatic use off", async () => {
    await reset();
    await lot(1);
    const l = await lesson();
    const first = (await scalar(
      `select public.command_apply_lesson_credit($1,null,'Explicit lesson coverage','manual-repeat') result`,
      [l],
    ))!.result as any;
    expect(first.creditCoverage).toMatchObject({
      applied: 1,
      alreadyCovered: 0,
      autoApply: false,
    });
    expect((await summary()).available).toBe(0);
    const repeat = (await scalar(
      `select public.command_apply_lesson_credit($1,null,'Explicit lesson coverage','manual-repeat') result`,
      [l],
    ))!.result as any;
    expect(repeat.creditCoverage).toMatchObject({
      applied: 0,
      alreadyCovered: 1,
      autoApply: false,
    });
    expect(repeat.entry.id).toBe(first.entry.id);
    expect(await summary()).toMatchObject({ remaining: 1, reserved: 1 });
  });
  it("self-service booking rescheduling covers newly valid lessons and protects expiry/checkout", async () => {
    await reset();
    await enable();
    await lot(1, new Date(Date.now() + 3 * 86400000).toISOString());
    const l = await lesson("now()+interval '10 days'");
    const serviceId = await service();
    const b = await scalar(
      `insert into public.bookings(studio_id,student_id,service_id,starts_at,ends_at,policy_snapshot)
      select studio_id,student_id,$2,starts_at,ends_at,'{"rescheduleLimit":5}' from public.lessons where id=$1 returning id`,
      [l, serviceId],
    );
    await db.query(
      `insert into public.lesson_participants(lesson_id,student_id,booking_id) values($1,$2,$3)`,
      [l, student, b!.id],
    );
    await scan();
    const moved = (await scalar(
      `select to_jsonb(public.reschedule_booking_occurrences($1,1,now()+interval '1 day',now()+interval '1 day 1 hour')) result`,
      [b!.id],
    ))!.result as any;
    expect(moved.payment_policy).toBe("credits");
    expect(moved.payment_status).toBe("paid");
    expect(moved.creditCoverage).toBeUndefined();
    expect(await summary()).toMatchObject({ available: 0, reserved: 1 });
    await expect(
      db.query(
        `select public.reschedule_booking_occurrences($1,$2,now()+interval '5 days',now()+interval '5 days 1 hour')`,
        [b!.id, moved.version],
      ),
    ).rejects.toThrow("expires before that date");
    await db.query(
      `update public.lessons set invoice_payment_pending=true where id=$1`,
      [l],
    );
    await expect(
      db.query(
        `select public.reschedule_booking_occurrences($1,$2,now()+interval '2 days',now()+interval '2 days 1 hour')`,
        [b!.id, moved.version],
      ),
    ).rejects.toThrow("pending online invoice");
    expect((await summary()).reserved).toBe(1);
  });
  it("classifies uncertain imported payment policy for review; paid imports stay cash covered", async () => {
    await reset();
    await enable();
    await lot(2);
    const imported = await lesson();
    const paid = await lesson();
    await db.query(
      `update public.lessons set source_provider='lessonface' where id in ($1,$2)`,
      [imported, paid],
    );
    await db.query(
      `update public.lessons set payment_status='paid',paid_minor=10000 where id=$1`,
      [paid],
    );
    expect(await scan()).toMatchObject({
      applied: 0,
      skipped: 2,
      skipReasons: { reconciliation_required: 1, cash_paid: 1 },
    });
    expect((await summary()).available).toBe(2);
  });
  it("recovers a pre-upgrade provider key without granting twice and bounds sweep progress", async () => {
    await reset();
    await enable();
    const p = await lot(1);
    await lesson();
    await db.query(
      `update public.package_credit_entries set idempotency_key='legacy-provider' where package_id=$1`,
      [p],
    );
    const result = await grant("legacy-provider", 1, {
      packageId: p,
      kind: "purchase",
    });
    expect(result.coverage.applied).toBe(1);
    expect((await summary()).remaining).toBe(1);
    expect(
      (await scalar(`select public.credit_coverage_work(1) result`))!.result,
    ).toEqual([student]);
    await db.query(`select public.process_credit_coverage_job($1)`, [student]);
    expect(
      (await scalar(`select public.credit_coverage_work(1) result`))!.result,
    ).toEqual([]);
    expect(
      (await scalar(`select public.credit_coverage_work(1) result`))!.result,
    ).toEqual([student]);
  });
  it("keeps checkout grants exactly once across provider event replay", async () => {
    await reset();
    await enable();
    await lesson();
    const pkg = await scalar(
      `insert into public.packages(student_id,name,credit_quantity) values($1,'Purchased snapshot',2) returning id`,
      [student],
    );
    const args = [
      "checkout-event",
      "checkout.session.completed",
      {},
      "checkout-session",
      student,
      pkg!.id,
      20000,
      "usd",
    ];
    const first = (await scalar(
      `select public.process_stripe_checkout($1,$2,$3,$4,$5,$6,$7,$8) result`,
      args,
    ))!.result as any;
    expect(first.creditCoverage).toMatchObject({ applied: 1, failed: 0 });
    expect(
      (await scalar(
        `select public.process_stripe_checkout($1,$2,$3,$4,$5,$6,$7,$8) result`,
        args,
      ))!.result,
    ).toMatchObject({ duplicate: true });
    expect(await summary()).toMatchObject({
      remaining: 2,
      reserved: 1,
      available: 1,
    });
    expect(
      (await scalar(
        `select count(*) n from public.payment_entries where external_reference='checkout-session'`,
      ))!.n,
    ).toBe(1);
  });
  it("gift delivery uses the account preference, preserves paid price, and replays without another lot", async () => {
    await reset();
    await enable();
    await lesson();
    const def = await scalar(
      `insert into public.package_definitions(id,studio_id,name,session_count,price_minor) values(gen_random_uuid(),$1,'Gift snapshot',2,99999) returning id`,
      [studio],
    );
    const gift = await scalar(
      `insert into public.package_gifts(id,studio_id,definition_id,status,expires_at,stripe_checkout_session_id) values(gen_random_uuid(),$1,$2,'purchased',now()+interval '20 days','gift-session') returning id`,
      [studio, def!.id],
    );
    await db.query(
      `insert into public.webhook_events(id,provider,event_type,status,payload) values('gift-receipt','stripe','checkout.session.completed','processed',$1)`,
      [
        {
          data: {
            object: {
              id: "gift-session",
              payment_status: "paid",
              metadata: {
                package_gift_id: gift!.id,
                package_price_minor: "12345",
                package_currency: "USD",
              },
            },
          },
        },
      ],
    );
    const first = (await scalar(
      `select public.claim_package_gift($1,$2,false) result`,
      [gift!.id, student],
    ))!.result as any;
    expect(first.creditCoverage).toMatchObject({ applied: 1, failed: 0 });
    expect(
      (await scalar(`select price_minor from public.packages where id=$1`, [
        first.packageId,
      ]))!.price_minor,
    ).toBe(12345);
    expect(
      (await scalar(`select public.claim_package_gift($1,$2,false) result`, [
        gift!.id,
        student,
      ]))!.result,
    ).toMatchObject({ duplicate: true, packageId: first.packageId });
    expect((await summary()).remaining).toBe(2);
    expect((await scalar(`select count(*) n from public.packages`))!.n).toBe(1);
  });
});
async function lot(quantity = 10, expires?: string) {
  const p = await scalar(
    `insert into public.packages(student_id,name,expires_at) values($1,'Package',$2) returning id`,
    [student, expires ?? null],
  );
  await db.query(
    `insert into public.package_credit_entries(package_id,kind,quantity,reason) values($1,'purchase',$2,'Purchased')`,
    [p!.id, quantity],
  );
  return p!.id as string;
}
async function lesson(starts = "now()+interval '5 days'", sid = student) {
  const l = await scalar(
    `insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at) values($1,$2,'Lesson',${starts},${starts}+interval '90 minutes') returning id`,
    [studio, sid],
  );
  return l!.id as string;
}
async function summary() {
  return (await scalar(`select public.student_credit_summary($1) summary`, [
    student,
  ]))!.summary as {
    available: number;
    autoApply: boolean | null;
    reserved: number;
    remaining: number;
    version: number;
  };
}
async function service() {
  return (await scalar(
    `insert into public.booking_services(studio_id,name,price_minor) values($1,'Coaching',4000) returning id`,
    [studio],
  ))!.id as string;
}
async function invoice(
  ref: string,
  kind = "service",
  lessonIds: string[] = [],
  unitMinor = 4000,
) {
  const value = {
    studio_id: studio,
    student_id: student,
    status: "open",
    currency: "USD",
    issue_date: "2026-10-06",
    due_date: "2026-10-20",
    introduction: "Thank you",
    notes: "Payment details",
    footer: "DAJ Studio",
    branding: { studioName: "DAJ Studio" },
    recipient: { name: "Taylor" },
    items: [
      {
        id: crypto.randomUUID(),
        kind,
        referenceId: ref,
        description: "Coaching",
        quantity: 1,
        unitMinor,
        startsOn: "2026-10-07",
        endsOn: "2026-10-07",
        lessonIds,
        paidMinor: 0,
        creditMinor: 0,
        creditQuantity: 4,
        expirationDays: 30,
      },
    ],
  };
  return (await scalar(`select public.save_studio_invoice($1,$2,0) invoice`, [
    value,
    crypto.randomUUID(),
  ]))!.invoice as {
    id: string;
    version: number;
    status: string;
    paid_minor: number;
    credit_minor: number;
  };
}
describe("credit and invoice migration against PostgreSQL", () => {
  it("completes an already-covered lesson without charging a second credit", async () => {
    await reset();
    const pkg = await lot(2),
      lid = await lesson();
    await db.query(
      `select public.reserve_student_lesson_credit($1,'20000000-0000-4000-8000-000000000001'::uuid,$2,true)`,
      [lid, pkg],
    );
    await db.query(`select set_config('app.uid',$1,false)`, [coach]);
    await db.query(
      `select public.command_complete_lesson($1,(select version from public.lessons where id=$1),'Coach completed','complete-covered','test')`,
      [lid],
    );
    expect(await summary()).toMatchObject({
      remaining: 1,
      reserved: 0,
      available: 1,
    });
    await db.query(
      `select public.command_complete_lesson($1,1,'Retry completed','complete-covered','test')`,
      [lid],
    );
    expect(await summary()).toMatchObject({ remaining: 1, available: 1 });
  });
  it("reserves exactly one per recurring occurrence across expiring lots", async () => {
    await reset();
    const first = await lot(
        1,
        new Date(Date.now() + 7 * 86400000).toISOString(),
      ),
      second = await lot(1),
      ref = await service();
    const series = crypto.randomUUID();
    await db.query(
      `insert into public.recurring_series(id,kind,occurrence_count,cadence) values($1,'fixed',2,'weekly')`,
      [series],
    );
    const b = await scalar(
      `insert into public.bookings(studio_id,student_id,service_id,series_id,reference,starts_at,ends_at,status,payment_policy,location,timezone,total_minor) values($1,$2,$3,$4,'CREDIT-SERIES',now()+interval '5 days',now()+interval '5 days 1 hour','held','credits','in_person','America/New_York',8000) returning id`,
      [studio, student, ref, series],
    );
    await db.query(`select public.confirm_booking($1,null,0,'credit-series')`, [
      b!.id,
    ]);
    const debits = await db.query<Record<string, unknown>>(
      `select package_id,quantity from public.package_credit_entries where quantity<0 order by created_at,id`,
    );
    expect(debits.rows).toHaveLength(2);
    expect(new Set(debits.rows.map((e) => e.package_id))).toEqual(
      new Set([first, second]),
    );
    expect(debits.rows.every((e) => e.quantity === -1)).toBe(true);
    expect(await summary()).toMatchObject({
      remaining: 2,
      reserved: 2,
      available: 0,
    });
    await db.query(`select public.confirm_booking($1,null,0,'credit-series')`, [
      b!.id,
    ]);
    expect(await summary()).toMatchObject({ reserved: 2, available: 0 });
  });
  it("rejects a credit booking atomically when future occurrences cannot be covered", async () => {
    await reset();
    await lot(1);
    const ref = await service(),
      series = crypto.randomUUID();
    await db.query(
      `insert into public.recurring_series(id,kind,occurrence_count,cadence) values($1,'fixed',2,'weekly')`,
      [series],
    );
    const b = await scalar(
      `insert into public.bookings(studio_id,student_id,service_id,series_id,reference,starts_at,ends_at,status,payment_policy,location,timezone,total_minor) values($1,$2,$3,$4,'SHORT-CREDITS',now()+interval '5 days',now()+interval '5 days 1 hour','held','credits','in_person','America/New_York',8000) returning id`,
      [studio, student, ref, series],
    );
    await expect(
      db.query(
        `select public.confirm_booking($1,null,0,'short-credit-series')`,
        [b!.id],
      ),
    ).rejects.toThrow(/CREDIT_UNAVAILABLE/);
    expect(await summary()).toMatchObject({ available: 1, reserved: 0 });
    expect((await db.query(`select id from public.lessons`)).rows).toHaveLength(
      0,
    );
  });
  it("normalizes a reviewed legacy series reservation without changing available credits", async () => {
    await reset();
    const pkg = await lot(4),
      ids = [await lesson(), await lesson("now()+interval '12 days'")];
    const b = await scalar(
      `insert into public.bookings(studio_id,student_id,reference,starts_at,payment_policy,payment_status) values($1,$2,'OLD-SERIES',now()+interval '5 days','credits','paid') returning id`,
      [studio, student],
    );
    for (const lid of ids)
      await db.query(
        `insert into public.lesson_participants(lesson_id,student_id,booking_id) values($1,$2,$3)`,
        [lid, student, b!.id],
      );
    await db.query(
      `insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason) values($1,$2,'reservation',-2,'Old series')`,
      [pkg, ids[0]],
    );
    expect(
      (await scalar(`select public.student_credit_summary($1) value`, [
        student,
      ]))!.value,
    ).toMatchObject({ needsReview: true });
    await db.query(
      `select public.reconcile_student_credit_reservations($1,$2)`,
      [student, (await summary()).version],
    );
    expect(await summary()).toMatchObject({
      remaining: 4,
      available: 2,
      reserved: 2,
    });
    const rows = await db.query<Record<string, unknown>>(
      `select lesson_id,sum(quantity)::integer quantity from public.package_credit_entries where lesson_id is not null group by lesson_id`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.quantity === -1)).toBe(true);
  });
  it("holds online payment exclusively, verifies its amount, and settles once", async () => {
    await reset();
    await lot(2);
    const lid = await lesson(),
      inv = await invoice(await service(), "service", [lid]);
    await db.query(
      `select public.claim_studio_invoice_checkout($1,4000,'checkout-key',1)`,
      [inv.id],
    );
    expect(
      (await scalar(
        `select invoice_payment_pending from public.lessons where id=$1`,
        [lid],
      ))!.invoice_payment_pending,
    ).toBe(true);
    await expect(
      db.query(
        `select public.settle_studio_invoice($1,100,'cash','concurrent-cash',2)`,
        [inv.id],
      ),
    ).rejects.toThrow(/pending/);
    await expect(
      db.query(
        `select public.command_cancel_lesson_credit($1,(select version from public.lessons where id=$1),false)`,
        [lid],
      ),
    ).rejects.toThrow(/pending/);
    expect(
      (await scalar(
        `select public.reserve_student_lesson_credit($1,$2,null,true) pkg`,
        [lid, student],
      ))!.pkg,
    ).toBe(null);
    await db.query(
      `select public.attach_studio_invoice_checkout($1,'checkout-key','session-test')`,
      [inv.id],
    );
    await expect(
      db.query(
        `select public.settle_studio_invoice_checkout($1,'checkout-key','session-test',5000)`,
        [inv.id],
      ),
    ).rejects.toThrow(/does not match/);
    await db.query(
      `select public.settle_studio_invoice_checkout($1,'checkout-key','session-test',4000)`,
      [inv.id],
    );
    await db.query(
      `select public.settle_studio_invoice_checkout($1,'checkout-key','session-test',4000)`,
      [inv.id],
    );
    expect(
      await scalar(
        `select paid_minor,checkout_key,status from public.studio_invoices where id=$1`,
        [inv.id],
      ),
    ).toMatchObject({ paid_minor: 4000, checkout_key: null, status: "paid" });
    expect(
      (await scalar(
        `select invoice_payment_pending from public.lessons where id=$1`,
        [lid],
      ))!.invoice_payment_pending,
    ).toBe(false);
  });
  it("waives an unpaid cancelled invoice lesson and restores original charges on void", async () => {
    await reset();
    const ref = await service(),
      lid = await lesson();
    await db.query(
      `update public.lessons set price_minor=2500,payment_status='due' where id=$1`,
      [lid],
    );
    let inv = await invoice(ref, "service", [lid]);
    await db.query(`select public.void_studio_invoice($1,1)`, [inv.id]);
    expect(
      await scalar(
        `select price_minor,payment_status from public.lessons where id=$1`,
        [lid],
      ),
    ).toMatchObject({ price_minor: 2500, payment_status: "due" });
    inv = await invoice(ref, "service", [lid]);
    await db.query(
      `select public.command_cancel_lesson_credit($1,(select version from public.lessons where id=$1),false)`,
      [lid],
    );
    expect(
      await scalar(
        `select waived_minor,status from public.studio_invoices where id=$1`,
        [inv.id],
      ),
    ).toMatchObject({ waived_minor: 4000, status: "paid" });
  });
  it("returns only actual invoice payment on timely cancellation, without a second booking refund", async () => {
    await reset();
    const lid = await lesson(),
      inv = await invoice(await service(), "service", [lid]);
    const b = await scalar(
      `insert into public.bookings(studio_id,student_id,reference,starts_at) select studio_id,student_id,'INVOICE-BOOK',starts_at from public.lessons where id=$1 returning id`,
      [lid],
    );
    await db.query(
      `insert into public.lesson_participants(lesson_id,booking_id,student_id) values($1,$2,$3)`,
      [lid, b!.id, student],
    );
    await db.query(
      `select public.settle_studio_invoice($1,1500,'cash','cancel-partial',1)`,
      [inv.id],
    );
    await db.query(
      `select public.cancel_booking_credit($1,(select version from public.bookings where id=$1),false,true)`,
      [b!.id],
    );
    expect(
      await scalar(
        `select waived_minor,paid_minor,status from public.studio_invoices where id=$1`,
        [inv.id],
      ),
    ).toMatchObject({ waived_minor: 2500, paid_minor: 1500, status: "paid" });
    const refunds = await db.query(
      `select amount_minor from public.payment_entries where account_credit and external_reference like $1`,
      [`invoice-cancel:${inv.id}:%`],
    );
    expect(refunds.rows).toEqual([{ amount_minor: 1500 }]);
    expect(
      (
        await db.query(
          `select id from public.payment_entries where external_reference=$1`,
          [`studio-credit:${b!.id}`],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("preserves the opening dollar credit without rewriting receipts", async () => {
    await reset();
    const row = await scalar(
      `select sum(amount_minor) total from public.payment_entries where account_credit`,
    );
    expect(Number(row!.total)).toBe(1200);
    expect(
      (await db.query(`select * from public.payment_entries`)).rows,
    ).toHaveLength(2);
    expect(Number(preservedExplicitBalance.balance)).toBe(12000);
    expect(Number(preservedExplicitBalance.entries)).toBe(4);
    expect(Number(preservedExplicitBalance.openings)).toBe(0);
    expect(Number(preservedExplicitBalance.receipt)).toBe(10000);
  });
  it("sets the total including reservations and rejects stale edits", async () => {
    await reset();
    const pkg = await lot(),
      lid = await lesson();
    await db.query(
      `select public.reserve_student_lesson_credit($1,'20000000-0000-4000-8000-000000000001'::uuid,$2,true)`,
      [lid, pkg],
    );
    expect(await summary()).toMatchObject({
      remaining: 10,
      available: 9,
      reserved: 1,
    });
    const version = (await summary()).version;
    await db.query(
      `select public.set_student_credit_total($1,4,$2,'Balance corrected','test-set-total')`,
      [student, version],
    );
    expect(await summary()).toMatchObject({
      remaining: 4,
      available: 3,
      reserved: 1,
    });
    await expect(
      db.query(
        `select public.set_student_credit_total($1,3,$2,'Stale correction','stale')`,
        [student, version],
      ),
    ).rejects.toThrow(/VERSION_CONFLICT/);
    await expect(
      db.query(
        `select public.set_student_credit_total($1,0,$2,'Invalid correction','below-held')`,
        [student, (await summary()).version],
      ),
    ).rejects.toThrow(/reserved/);
  });
  it("uses any lesson duration, returns once, and permits reapplication", async () => {
    await reset();
    const pkg = await lot(2),
      lid = await lesson();
    await db.query(
      `select public.reserve_student_lesson_credit($1,'20000000-0000-4000-8000-000000000001'::uuid,$2,true)`,
      [lid, pkg],
    );
    await db.query(`select public.settle_lesson_credits($1,false)`, [lid]);
    await db.query(`select public.settle_lesson_credits($1,false)`, [lid]);
    expect(await summary()).toMatchObject({ available: 2, reserved: 0 });
    await db.query(
      `select public.reserve_student_lesson_credit($1,'20000000-0000-4000-8000-000000000001'::uuid,$2,true)`,
      [lid, pkg],
    );
    expect(await summary()).toMatchObject({ available: 1, reserved: 1 });
  });
  it("gives an expired returned credit 30 days without reviving other expired credits", async () => {
    await reset();
    const pkg = await lot(3),
      lid = await lesson();
    await db.query(
      `select public.reserve_student_lesson_credit($1,'20000000-0000-4000-8000-000000000001'::uuid,$2,true)`,
      [lid, pkg],
    );
    await db.query(
      `update public.packages set expires_at=now()-interval '1 day' where id=$1`,
      [pkg],
    );
    await db.query(`select public.settle_lesson_credits($1,false)`, [lid]);
    expect(await summary()).toMatchObject({ available: 1, reserved: 0 });
    const rows = await db.query(
      `select name,expires_at from public.packages where name='Returned lesson credits'`,
    );
    expect(rows.rows).toHaveLength(1);
  });
  it("applies chronologically on enable and never deducts twice", async () => {
    await reset();
    await lot(2);
    const l = await lesson();
    await lesson();
    await db.query(`select public.set_student_credit_auto($1,true,$2)`, [
      student,
      (await summary()).version,
    ]);
    expect(await summary()).toMatchObject({
      available: 0,
      reserved: 2,
      remaining: 2,
    });
    await db.query(`select public.reserve_package_credit_for_lesson($1)`, [l]);
    expect(await summary()).toMatchObject({ available: 0, reserved: 2 });
  });
  it("returns or consumes a coach-cancelled lesson credit", async () => {
    for (const use of [false, true]) {
      await reset();
      const pkg = await lot(2),
        lid = await lesson();
      await db.query(
        `select public.reserve_student_lesson_credit($1,'20000000-0000-4000-8000-000000000001'::uuid,$2,true)`,
        [lid, pkg],
      );
      const l = await scalar(`select version from public.lessons where id=$1`, [
        lid,
      ]);
      await db.query(`select public.command_cancel_lesson_credit($1,$2,$3)`, [
        lid,
        l!.version,
        use,
      ]);
      expect(await summary()).toMatchObject({
        available: use ? 1 : 2,
        reserved: 0,
        remaining: use ? 1 : 2,
      });
    }
  });
  it("student on-time money cancellations create dollar credit, late ones retain payment", async () => {
    for (const late of [false, true]) {
      await reset();
      const lid = await lesson(
        late ? "now()+interval '1 hour'" : "now()+interval '5 days'",
      );
      const b = await scalar(
        `insert into public.bookings(studio_id,student_id,reference,starts_at,paid_minor,payment_status) select studio_id,student_id,'BOOK',starts_at,4000,'paid' from public.lessons where id=$1 returning id`,
        [lid],
      );
      await db.query(
        `insert into public.lesson_participants(lesson_id,booking_id,student_id) values($1,$2,$3)`,
        [lid, b!.id, student],
      );
      await db.query(`select public.cancel_booking_credit($1,1,false,true)`, [
        b!.id,
      ]);
      const r = await scalar(
        `select sum(amount_minor) total from public.payment_entries where external_reference=$1 and account_credit`,
        [`studio-credit:${b!.id}`],
      );
      expect(Number(r!.total ?? 0)).toBe(late ? 0 : 4000);
    }
  });
  it("supports partial invoice payments and idempotent settlement", async () => {
    await reset();
    const inv = await invoice(await service());
    await db.query(
      `select public.settle_studio_invoice($1,1500,'cash','partial-invoice',1)`,
      [inv.id],
    );
    const first = await scalar(
      `select status,paid_minor,version from public.studio_invoices where id=$1`,
      [inv.id],
    );
    expect(first).toMatchObject({ status: "partially_paid", paid_minor: 1500 });
    await db.query(
      `select public.settle_studio_invoice($1,1500,'cash','partial-invoice',1)`,
      [inv.id],
    );
    expect(
      (await scalar(
        `select paid_minor from public.studio_invoices where id=$1`,
        [inv.id],
      ))!.paid_minor,
    ).toBe(1500);
    await expect(
      db.query(
        `select public.settle_studio_invoice($1,3000,'cash','overpayment',2)`,
        [inv.id],
      ),
    ).rejects.toThrow(/exceeds/);
    await db.query(
      `select public.settle_studio_invoice($1,2500,'bank','invoice-finish',2)`,
      [inv.id],
    );
    expect(
      await scalar(
        `select status,paid_minor from public.studio_invoices where id=$1`,
        [inv.id],
      ),
    ).toMatchObject({ status: "paid", paid_minor: 4000 });
  });
  it("grants package credits once after full settlement using the issued quantity snapshot", async () => {
    await reset();
    const def = await scalar(
      `insert into public.package_definitions(id,studio_id,name,session_count,expiration_days) values(gen_random_uuid(),$1,'Four lessons',4,30) returning id`,
      [studio],
    );
    const inv = await invoice(def!.id as string, "package");
    await db.query(
      `update public.package_definitions set session_count=8 where id=$1`,
      [def!.id],
    );
    await db.query(
      `select public.settle_studio_invoice($1,1000,'cash','package-partial',1)`,
      [inv.id],
    );
    expect((await summary()).available).toBe(0);
    await db.query(
      `select public.settle_studio_invoice($1,3000,'cash','package-full',2)`,
      [inv.id],
    );
    expect((await summary()).available).toBe(4);
    await db.query(
      `select public.settle_studio_invoice($1,3000,'cash','package-full',2)`,
      [inv.id],
    );
    expect((await summary()).available).toBe(4);
  });
  it("settles a linked lesson invoice with one credit and blocks duplicate invoicing", async () => {
    await reset();
    await lot(2);
    const ref = await service(),
      lid = await lesson();
    const inv = await invoice(ref, "service", [lid]);
    const item = await scalar(
      `select items->0->>'id' line from public.studio_invoices where id=$1`,
      [inv.id],
    );
    await db.query(`select public.apply_invoice_lesson_credit($1,$2,1)`, [
      inv.id,
      item!.line,
    ]);
    expect(
      await scalar(
        `select status,credit_minor from public.studio_invoices where id=$1`,
        [inv.id],
      ),
    ).toMatchObject({ status: "paid", credit_minor: 4000 });
    expect(await summary()).toMatchObject({ available: 1, reserved: 1 });
    await expect(invoice(ref, "service", [lid])).rejects.toThrow(
      /already invoiced/,
    );
  });
  it("picks up existing reservations without charging a second credit", async () => {
    await reset();
    const pkg = await lot(2),
      ref = await service(),
      lid = await lesson();
    await db.query(
      `select public.reserve_student_lesson_credit($1,'20000000-0000-4000-8000-000000000001'::uuid,$2,true)`,
      [lid, pkg],
    );
    const inv = await invoice(ref, "service", [lid]);
    expect(inv).toMatchObject({ status: "paid", credit_minor: 4000 });
    expect(await summary()).toMatchObject({ available: 1, reserved: 1 });
  });
  it("keeps a shared group lesson and another student's credits when one booking cancels", async () => {
    await reset();
    const lid = await lesson("now()+interval '5 days'", other);
    await db.query(`update public.lessons set student_id=null where id=$1`, [
      lid,
    ]);
    const bookings = [];
    for (const sid of [student, other]) {
      const b = await scalar(
        `insert into public.bookings(studio_id,student_id,reference,starts_at,payment_policy,payment_status) values($1,$2,'GROUP',now()+interval '5 days','credits','paid') returning id`,
        [studio, sid],
      );
      bookings.push(b!.id);
      await db.query(
        `insert into public.lesson_participants(lesson_id,student_id,booking_id) values($1,$2,$3)`,
        [lid, sid, b!.id],
      );
      const p = await scalar(
        `insert into public.packages(student_id,name) values($1,'Group credits') returning id`,
        [sid],
      );
      await db.query(
        `insert into public.package_credit_entries(package_id,kind,quantity,reason) values($1,'purchase',2,'Bought')`,
        [p!.id],
      );
      await db.query(
        `insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason) values($1,$2,'reservation',-1,'Group lesson')`,
        [p!.id, lid],
      );
    }
    await db.query(`select public.cancel_booking_credit($1,1,false,true)`, [
      bookings[0],
    ]);
    expect(
      (await scalar(`select status from public.lessons where id=$1`, [lid]))!
        .status,
    ).toBe("scheduled");
    expect(await summary()).toMatchObject({ available: 2, reserved: 0 });
    const otherBalance = await scalar(
      `select sum(e.quantity)::integer available from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=$1`,
      [other],
    );
    expect(otherBalance!.available).toBe(1);
  });
  it("enforces invoice read permissions and denies all direct client writes and privileged commands", async () => {
    await reset();
    const inv = await invoice(await service());
    await db.exec(
      `grant usage on schema public,auth to authenticated;select set_config('app.uid','${student}',false);set role authenticated;`,
    );
    expect(
      (
        await db.query(`select id from public.studio_invoices where id=$1`, [
          inv.id,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (await db.query(`select * from public.audit_events`)).rows,
    ).toHaveLength(0);
    await expect(
      db.query(`update public.studio_invoices set total_minor=1 where id=$1`, [
        inv.id,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        `select public.set_student_credit_total($1,100,1,'Unauthorized','bad')`,
        [student],
      ),
    ).rejects.toThrow(/permission denied/);
    await db.exec(
      `reset role;select set_config('app.uid','${other}',false);set role authenticated;`,
    );
    expect(
      (
        await db.query(`select id from public.studio_invoices where id=$1`, [
          inv.id,
        ])
      ).rows,
    ).toHaveLength(0);
    await db.exec(
      `reset role;select set_config('app.uid','${coach}',false);set role authenticated;`,
    );
    expect(
      (await db.query(`select * from public.audit_events`)).rows.length,
    ).toBeGreaterThan(0);
    await db.exec(`reset role;set role anon;`);
    await expect(
      db.query(`select * from public.studio_invoices`),
    ).rejects.toThrow(/permission denied/);
    await db.exec(`reset role;`);
  });
});
