// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const definition = "10000000-0000-4000-8000-000000000001";
const student = "20000000-0000-4000-8000-000000000001";
const gift = "30000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.package_definitions(id uuid primary key,name text,price_minor bigint,currency text,expiration_days integer,session_count integer);
    create table public.packages(id uuid primary key default gen_random_uuid(),student_id uuid,name text,price_minor bigint,currency text,expires_at timestamptz,credit_quantity integer,definition_id uuid,auto_apply boolean);
    create table public.package_gifts(id uuid primary key,definition_id uuid,status text,claimed_student_id uuid,package_id uuid,expires_at timestamptz,deliver_at timestamptz,stripe_checkout_session_id text,updated_at timestamptz);
    create table public.package_credit_entries(package_id uuid,kind text,quantity integer,reason text,idempotency_key text unique);
    create table public.webhook_events(provider text,event_type text,payload jsonb);
    insert into public.package_definitions values('${definition}','Four lessons',36000,'USD',180,4);
    insert into public.package_gifts(id,definition_id,status,expires_at,stripe_checkout_session_id) values('${gift}','${definition}','purchased',now()+interval '1 day','checkout-gift');
  `);
  await db.exec(
    readFileSync(
      "supabase/migrations/20261008120000_preserve_package_gift_price.sql",
      "utf8",
    ),
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("gift purchase price snapshots", () => {
  it("claims with the signed paid checkout quote after a service or catalog price change", async () => {
    const payload = {
      data: {
        object: {
          id: "checkout-gift",
          payment_status: "paid",
          amount_total: 43200,
          currency: "usd",
          metadata: {
            package_gift_id: gift,
            package_price_minor: "43200",
            package_currency: "USD",
          },
        },
      },
    };
    await db.query(
      "insert into public.webhook_events values('stripe','checkout.session.completed',$1)",
      [JSON.stringify(payload)],
    );
    await db.query(
      "update public.package_definitions set price_minor=50000 where id=$1",
      [definition],
    );
    await db.query("select public.claim_package_gift($1,$2,false)", [
      gift,
      student,
    ]);
    const packages = (
      await db.query<{ price_minor: number; currency: string }>(
        "select price_minor,currency from public.packages",
      )
    ).rows;
    expect(packages).toEqual([{ price_minor: 43200, currency: "USD" }]);
    expect(
      (
        await db.query<{ quantity: number }>(
          "select quantity from public.package_credit_entries",
        )
      ).rows,
    ).toEqual([{ quantity: 4 }]);
    await db.query(
      "update public.package_definitions set price_minor=60000 where id=$1",
      [definition],
    );
    const retry = await db.query<{
      claim_package_gift: { duplicate: boolean };
    }>("select public.claim_package_gift($1,$2,false)", [gift, student]);
    expect(retry.rows[0].claim_package_gift.duplicate).toBe(true);
    expect(
      (await db.query("select price_minor,currency from public.packages")).rows,
    ).toEqual(packages);
    expect(
      (await db.query("select * from public.package_credit_entries")).rows,
    ).toHaveLength(1);
  });
  it("retains ownership and availability checks", async () => {
    await expect(
      db.query("select public.claim_package_gift($1,$2,false)", [
        gift,
        "20000000-0000-4000-8000-000000000002",
      ]),
    ).rejects.toThrow("GIFT_ALREADY_CLAIMED");
    const pending = "30000000-0000-4000-8000-000000000002";
    await db.query(
      "insert into public.package_gifts(id,definition_id,status,expires_at) values($1,$2,'pending_payment',now()+interval '1 day')",
      [pending, definition],
    );
    await expect(
      db.query("select public.claim_package_gift($1,$2,false)", [
        pending,
        student,
      ]),
    ).rejects.toThrow("GIFT_NOT_AVAILABLE");
  });
});
