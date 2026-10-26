// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
const db = new PGlite();
beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls;",
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261026161014_reliable_scheduled_workers.sql",
      "utf8",
    ),
  );
});
afterAll(() => db.close());
const scalar = async (sql: string, args: unknown[] = []) =>
  (await db.query<{ value: string | null }>(sql, args)).rows[0].value;
it("retains pending work, fences overlap, recovers expired claims and rejects stale completion", async () => {
  const job = await scalar(
    "select enqueue_scheduled_worker('provider-intake') value",
  );
  expect(
    await scalar("select enqueue_scheduled_worker('provider-intake') value"),
  ).toBe(job);
  const token = await scalar(
    "select claim_scheduled_worker('provider-intake',$1) value",
    [job],
  );
  expect(token).toBeTruthy();
  expect(
    await scalar("select enqueue_scheduled_worker('provider-intake') value"),
  ).toBeNull();
  expect(
    await scalar("select claim_scheduled_worker('provider-intake',$1) value", [
      job,
    ]),
  ).toBeNull();
  expect(
    await scalar(
      "select finish_scheduled_worker('provider-intake',$1,gen_random_uuid())::text value",
      [job],
    ),
  ).toBe("false");
  await db.exec(
    "update worker_internal.scheduled_jobs set claim_until=now()-interval '1 second'",
  );
  const next = await scalar(
    "select claim_scheduled_worker('provider-intake',$1) value",
    [job],
  );
  expect(next).not.toBe(token);
  expect(
    await scalar(
      "select finish_scheduled_worker('provider-intake',$1,$2)::text value",
      [job, token],
    ),
  ).toBe("false");
  expect(
    await scalar(
      "select finish_scheduled_worker('provider-intake',$1,$2,'database')::text value",
      [job, next],
    ),
  ).toBe("true");
  const retry = await scalar(
    "select claim_scheduled_worker('provider-intake',$1) value",
    [job],
  );
  expect(retry).toBeTruthy();
  expect(
    await scalar(
      "select finish_scheduled_worker('provider-intake',$1,$2)::text value",
      [job, retry],
    ),
  ).toBe("true");
  expect(
    await scalar("select claim_scheduled_worker('provider-intake',$1) value", [
      job,
    ]),
  ).toBeNull();
  const secondJob = await scalar(
    "select enqueue_scheduled_worker('provider-intake') value",
  );
  expect(secondJob).not.toBe(job);
  expect(
    await scalar("select claim_scheduled_worker('provider-intake',$1) value", [
      job,
    ]),
  ).toBeNull();
});
it("does not expose receipts or privileged RPCs to portal roles", async () => {
  for (const role of ["anon", "authenticated"]) {
    expect(
      await scalar(
        `select has_function_privilege('${role}','public.enqueue_scheduled_worker(text)','execute')::text value`,
      ),
    ).toBe("false");
    expect(
      await scalar(
        `select has_schema_privilege('${role}','worker_internal','usage')::text value`,
      ),
    ).toBe("false");
  }
  expect(
    await scalar(
      "select has_function_privilege('service_role','public.claim_scheduled_worker(text,uuid)','execute')::text value",
    ),
  ).toBe("true");
});
