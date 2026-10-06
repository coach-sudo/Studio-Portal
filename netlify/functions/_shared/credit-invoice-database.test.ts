// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
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
 create table public.students(id uuid primary key,studio_id uuid references public.studios, user_id uuid,deleted_at timestamptz,full_name text,email text,guardian_name text,guardian_email text,updated_at timestamptz default now());
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
    alter table public.recommendations add column updated_at timestamptz default now();
    alter table public.idempotency_keys add column actor_id uuid,add column command text,add column request_hash text;`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261006204647_unified_credits_and_invoices.sql",
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
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function reset() {
  await db.exec(
    `reset role; update public.lessons set invoice_id=null;delete from public.payment_entries where reason not in ('Legacy credit','Preserved opening dollar credit balance');delete from public.invoice_settlements;delete from public.studio_invoices;delete from public.package_credit_entries;delete from public.lesson_participants;delete from public.calendar_projections;delete from public.lessons;delete from public.bookings;delete from public.packages;update public.student_credit_accounts set version=1,auto_apply=false;`,
  );
}
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
    await db.exec(`reset role;set role anon;`);
    await expect(
      db.query(`select * from public.studio_invoices`),
    ).rejects.toThrow(/permission denied/);
    await db.exec(`reset role;`);
  });
});
