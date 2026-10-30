import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { readRuntime } from "../support/runtime";
import { openAs, accessToken } from "../support/auth";
const duplicate = "e8620000-0000-4000-8000-000000000021";
const sql = (input: string) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_studio-portal",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input, encoding: "utf8" },
  ).trim();
const tables = [
  "public.students",
  "public.lessons",
  "public.lesson_participants",
  "public.payment_entries",
  "public.bookings",
  "public.student_credit_accounts",
  "public.package_credit_entries",
  "public.packages",
  "public.studio_invoices",
  "public.invoice_settlements",
  "public.portal_accounts",
  "public.student_relationships",
  "public.linked_contacts",
  "public.memberships",
  "public.integration_imports",
  "public.outbox_messages",
  "public.audit_events",
  "workspace_internal.operation_receipts",
  "credit_internal.credit_coverage_jobs",
];
const snapshot = () =>
  Object.fromEntries(
    tables.map((table) => [
      table,
      createHash("sha256")
        .update(
          sql(
            `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t ${table === "public.audit_events" ? "where source is distinct from 'coach_identity_review'" : ""};`,
          ),
        )
        .digest("hex"),
    ]),
  );
test("original identity grouping, role isolation, lost response and retained history against real PostgreSQL", async ({
  browser,
}, info) => {
  expect(process.env.IDENTITY_CONNECTED_LOCAL).toBe("true");
  expect(process.env.DB_CONTAINER).toBe("supabase_db_studio-portal");
  const runtime = await readRuntime();
  expect(runtime.fixtureReady).toBe(true);
  const original = runtime.ids!.student;
  expect(original).toMatch(/^[0-9a-f-]{36}$/);
  const studio = sql(
    `select studio_id from public.students where id='${original}'`,
  );
  expect(studio).toMatch(/^[0-9a-f-]{36}$/);
  expect(
    sql(`select count(*) from public.students where id='${duplicate}'`),
  ).toBe("0");
  sql(`begin;insert into public.students(id,studio_id,full_name,preferred_name,status,portal_enabled) values('${duplicate}','${studio}','E2E retained original duplicate','Original duplicate','active',false);
    insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values('${duplicate}','payment',1200,'USD','e2e-connected-duplicate-payment','Synthetic original duplicate history');
    insert into public.integration_imports(id,studio_id,student_id,lesson_id,provider,external_id,detected_source,status,payload) values('e8620000-0000-4000-8000-000000000022','${studio}','${original}','${runtime.ids!.lessonAvailable}','gmail','e2e-connected-original-provider-signal','superprof','needs_review','{}');commit;`);
  const actorIds = {
    student: sql(`select user_id from public.students where id='${original}'`),
    guardian: sql(
      `select user_id from public.student_relationships where id='${runtime.ids!.guardianRelationship}'`,
    ),
    unrelated: sql(
      `select user_id from public.students where id='${runtime.ids!.unrelatedStudent}'`,
    ),
  };
  for (const actor of Object.values(actorIds))
    expect(actor).toMatch(/^[0-9a-f-]{36}$/);
  const permissions = () =>
    Object.fromEntries(
      Object.entries(actorIds).map(([role, actor]) => [
        role,
        JSON.parse(
          sql(
            `begin;set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);select jsonb_build_object('original',public.can_view_student_finance('${original}'),'duplicate',public.can_view_student_finance('${duplicate}'));rollback;`,
          )
            .split(/\r?\n/)
            .at(-1)!,
        ),
      ]),
    );
  const permissionsBefore = permissions();
  const coach = await openAs(browser, "coach");
  await coach.page.goto("/coach/students");
  const before = snapshot(),
    requests: Record<string, unknown>[] = [];
  let lost = false;
  await coach.context.route("**/api/v2/students", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command !== "identity_change") return route.continue();
    requests.push(structuredClone(body));
    if (!lost) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      lost = true;
      return route.abort("failed");
    }
    return route.continue();
  });
  await coach.page
    .getByRole("button", { name: "Link duplicate profiles", exact: true })
    .click();
  let dialog = coach.page.getByRole("dialog", {
    name: "Link duplicate profiles",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Current profile", exact: true })
    .selectOption(original);
  await dialog
    .getByRole("combobox", { name: "Related duplicate", exact: true })
    .selectOption(duplicate);
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic coach review preserving every original owner.");
  await dialog
    .getByRole("button", { name: "Review change", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Confirm profile links", exact: true }),
  ).toBeEnabled();
  expect(
    sql("select count(*) from workspace_internal.student_identity_groups"),
  ).toBe("0");
  await dialog
    .getByRole("button", { name: "Confirm profile links", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry saved request", exact: true }),
  ).toBeEnabled();
  expect(
    sql(
      "select count(*) from workspace_internal.student_identity_groups where active",
    ),
  ).toBe("1");
  await dialog
    .getByRole("button", { name: "Retry saved request", exact: true })
    .click();
  await expect(
    dialog.getByText(/Profiles linked. Open each original record/),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(
    sql("select count(*) from workspace_internal.student_identity_receipts"),
  ).toBe("1");
  expect(snapshot()).toEqual(before);
  expect(permissions()).toEqual(permissionsBefore);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await coach.page.goto(`/coach/students/${original}`);
  const related = coach.page.getByRole("region", {
    name: "Related student profiles",
  });
  await expect(related).toContainText("Showing 2 of 2");
  await expect(
    related.getByRole("link", { name: "Original duplicate", exact: true }),
  ).toHaveAttribute("href", `/coach/students/${duplicate}`);
  await related
    .getByRole("link", { name: "Original duplicate", exact: true })
    .click();
  await expect(coach.page).toHaveURL(new RegExp(duplicate + "$"));
  await expect(
    coach.page.getByRole("region", { name: "Related student profiles" }),
  ).toContainText("Showing 2 of 2");
  const roleProof: Record<string, unknown>[] = [];
  for (const role of ["student", "guardian", "unrelated"] as const) {
    const actor = await openAs(browser, role);
    await actor.page.goto("/portal");
    const token = await accessToken(actor.page);
    expect(token).not.toBe("");
    const headers = {
        apikey: process.env.SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${token}`,
      },
      base = process.env.SUPABASE_URL!;
    const finance = async (student: string) => {
      const r = await actor.context.request.post(
        `${base}/rest/v1/rpc/can_view_student_finance`,
        { headers, data: { target_student: student } },
      );
      expect(r.ok()).toBe(true);
      return r.json();
    };
    expect(await finance(original)).toBe(role !== "unrelated");
    expect(await finance(duplicate)).toBe(false);
    const ledger = await actor.context.request.get(
      `${base}/rest/v1/payment_entries?student_id=eq.${duplicate}&select=id`,
      { headers },
    );
    expect(ledger.ok()).toBe(true);
    expect(await ledger.json()).toEqual([]);
    const denied = await actor.context.request.post(
      "http://127.0.0.1:8888/api/v2/students",
      {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          command: "identity_group",
          idempotencyKey: `e2e-connected-role-denial-${role}-${original}`,
          payload: { studentId: original },
          expectedVersion: 0,
          reason: "Synthetic access check",
        },
      },
    );
    expect([401, 403]).toContain(denied.status());
    const denial = await denied.json();
    expect(["FORBIDDEN", "AUTHENTICATION_REQUIRED"]).toContain(denial.code);
    roleProof.push({
      role,
      originalFinance: role !== "unrelated",
      duplicateFinance: false,
      identityCommandDenied: true,
      identityDenialStatus: denied.status(),
      identityDenialCode: denial.code,
    });
    await actor.context.close();
  }
  const anonymous = await browser.newContext();
  const deny = await anonymous.request.post(
    "http://127.0.0.1:8888/api/v2/students",
    {
      data: {
        command: "identity_group",
        idempotencyKey: `e2e-connected-role-denial-anonymous-${original}`,
        payload: { studentId: original },
        expectedVersion: 0,
        reason: "Synthetic anonymous denial",
      },
    },
  );
  expect([401, 403]).toContain(deny.status());
  expect(["FORBIDDEN", "AUTHENTICATION_REQUIRED"]).toContain(
    (await deny.json()).code,
  );
  await anonymous.close();
  expect(snapshot()).toEqual(before);
  await coach.page.goto("/coach/students");
  await coach.page
    .getByRole("button", { name: "Link duplicate profiles", exact: true })
    .click();
  dialog = coach.page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("dissolve");
  await dialog
    .getByRole("combobox", { name: "Current profile", exact: true })
    .selectOption(original);
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic reversal keeps original records and private history.");
  await dialog
    .getByRole("button", { name: "Review change", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm unlinking", exact: true })
    .click();
  await expect(
    dialog.getByText(
      /Profiles unlinked. Original records and history are retained/,
    ),
  ).toBeVisible();
  expect(snapshot()).toEqual(before);
  expect(
    sql(
      "select count(*) from workspace_internal.student_identity_groups where not active",
    ),
  ).toBe("1");
  expect(
    sql(
      "select count(*) from workspace_internal.student_identity_members where ended_at is not null",
    ),
  ).toBe("2");
  expect(
    sql("select count(*) from workspace_internal.student_identity_receipts"),
  ).toBe("2");
  expect(
    sql("select count(*) from workspace_internal.student_identity_revisions"),
  ).toBe("2");
  expect(
    sql(
      "select count(*) from public.audit_events where source='coach_identity_review'",
    ),
  ).toBe("2");
  await coach.page.screenshot({
    path: info.outputPath("retained-group-history.png"),
    fullPage: true,
  });
  await coach.context.close();
  writeFileSync(
    "test-results/identity-connected/canonical-role-proof.json",
    JSON.stringify(
      {
        layer:
          "real authenticated UI→server→PostgreSQL; isolated loopback only",
        canonicalHashesBefore: before,
        permissionsBefore,
        permissionsAfter: permissions(),
        canonicalHashesAfter: snapshot(),
        roleProof,
        anonymousDenied: true,
        identicalReplay: true,
        groupsRetained: 1,
        membersRetained: 2,
        receiptsRetained: 2,
        revisionsRetained: 2,
        auditEventsRetained: 2,
        profilesDeleted: 0,
        providerMutationsRequestedByHarness: false,
      },
      null,
      2,
    ) + "\n",
  );
});
