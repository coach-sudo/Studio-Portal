import { readFile } from "node:fs/promises";
import {
  test,
  expect,
  requireFixtures,
  expectNoHorizontalOverflow,
} from "./support/fixtures";
import { bulkFixture } from "./support/lessonBulk";
import { storageStatePath } from "./support/runtime";
import { openAs, accessToken } from "./support/auth";
import { expectNoSeriousAxeViolations } from "./support/axe";
import { createClient } from "@supabase/supabase-js";

test.use({ trace: "retain-on-failure" });
test("@journey @mobile @a11y student context, household, credit truth and failure recovery", async ({
  browser,
  runtime,
}, info) => {
  requireFixtures(runtime);
  test.setTimeout(180000);
  const f = await bulkFixture(runtime, 12, false, 100);
  const mobile = info.project.name.startsWith("mobile");
  const context = await browser.newContext({
    baseURL: runtime.baseURL,
    storageState: storageStatePath("coach"),
    bypassCSP: true,
    viewport: { width: mobile ? 390 : 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const base = `/coach/students/${f.studentId}`;
  const packages = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  const contacts = [crypto.randomUUID(), crypto.randomUUID()];
  const note = crypto.randomUUID();
  try {
    f.sql(`update students set focus_area='Callback confidence',portal_enabled=true where id='${f.studentId}';
      update lessons set payment_status='due',price_minor=4000 where id in ('${f.lessonIds[0]}','${f.lessonIds[1]}');
      insert into notes(id,student_id,lesson_id,title,body,status) values('${note}','${f.studentId}','${f.lessonIds[0]}','Latest private takeaway','Find the clear objective','draft');
      insert into packages(id,student_id,name,expires_at) values('${packages[0]}','${f.studentId}','Study credits',null),('${packages[1]}','${f.studentId}','Expired credits',now()-interval '1 day');
      insert into package_credit_entries(package_id,kind,quantity,reason) values('${packages[0]}','purchase',2,'Isolated credit purchase'),('${packages[1]}','purchase',1,'Expired fixture');
      insert into student_credit_accounts(student_id,auto_apply) values('${f.studentId}',false) on conflict(student_id) do update set auto_apply=false;
      insert into payment_entries(student_id,kind,amount_minor,currency,reason,account_credit) select '${f.studentId}','payment',100,'USD','Isolated history '||n,false from generate_series(1,125)n;
      insert into linked_contacts(id,studio_id,student_id,full_name,email,relationship_type,is_primary_payer,is_primary_scheduling_contact,can_view_finance,can_view_schedule,can_view_work) values
      ('${contacts[0]}','${f.studioId}','${f.studentId}','Casey Payer','casey@example.test','guardian',true,false,true,false,false),
      ('${contacts[1]}','${f.studioId}','${f.studentId}','Robin Scheduler','robin@example.test','support_person',false,true,false,true,true);`);
    // Same fixture, pinned old frontend, read-only screenshots before any action.
    if (process.env.BASELINE_UI_URL) {
      const state = JSON.parse(
        await readFile(storageStatePath("coach"), "utf8"),
      );
      state.origins = state.origins.map((origin: { origin: string }) => ({
        ...origin,
        origin: process.env.BASELINE_UI_URL,
      }));
      const before = await browser.newContext({
        baseURL: process.env.BASELINE_UI_URL,
        storageState: state,
        bypassCSP: true,
        viewport: { width: mobile ? 390 : 1440, height: 1000 },
      });
      try {
        const bp = await before.newPage();
        for (const [name, route] of [
          ["overview", base],
          ["household", `${base}/account`],
          ["payments", `${base}/payments`],
        ]) {
          await bp.goto(route);
          await expect(bp.locator(".student-record-header h1")).toBeVisible();
          await expect(bp.locator(".page .loading")).toHaveCount(0);
          await bp.waitForLoadState("networkidle");
          await bp.screenshot({
            path: info.outputPath(`before-${name}-${mobile ? 390 : 1440}.png`),
            fullPage: true,
          });
        }
      } finally {
        await before.close();
      }
    }
    await page.goto(base);
    await expect(
      page.getByText("Find the clear objective", { exact: false }),
    ).toBeVisible();
    await expect(
      page.locator(`a[href="${base}/lessons/${f.lessonIds[0]}"]`),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`after-overview-${mobile ? 390 : 1440}.png`),
      fullPage: true,
    });
    await expectNoSeriousAxeViolations(page, "main");
    await page
      .getByRole("link", { name: "Latest coaching note", exact: false })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Find the clear objective",
    );
    await page.keyboard.press("Escape");
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto(
        `${base}/lessons/${f.lessonIds[0]}?writeNote=${f.lessonIds[0]}`,
      );
      const editor = page.getByRole("dialog", {
        name: "Edit note",
        exact: true,
      });
      await expect(
        editor.getByRole("textbox", { name: "Note", exact: true }),
      ).toContainText("Find the clear objective");
      await editor
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(editor).toHaveCount(0);
      expect(
        f.sql(`select count(*) from notes where student_id='${f.studentId}'`),
      ).toBe("1");
    }
    await page.goto(`${base}/household`);
    await expect(page.getByText("Casey Payer", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Robin Scheduler", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Portal permissions", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`after-household-${mobile ? 390 : 1440}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Manage Access", exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toContainText("Portal permissions");
    await expectNoSeriousAxeViolations(page, '[role="dialog"]');
    await page.keyboard.press("Escape");
    await page.goto(`${base}/payments`);
    await expect(
      page.getByText("Use credits automatically: Off", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Account summary" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Invoices", exact: true }),
    ).toHaveCount(0);
    // Saving the setting succeeds even when actual reservations fail transactionally.
    f.sql(`create function public.e2e_workspace_fail_${f.studentId.replaceAll("-", "")}() returns trigger language plpgsql as $$begin if new.quantity<0 and exists(select 1 from packages where id=new.package_id and student_id='${f.studentId}') then raise exception 'fixture coverage failure';end if;return new;end$$;
      create trigger workspace_fail_${f.studentId.replaceAll("-", "")} after insert on package_credit_entries for each row execute function public.e2e_workspace_fail_${f.studentId.replaceAll("-", "")}();`);
    await page.getByRole("button", { name: "Review and enable" }).click();
    await page.getByRole("button", { name: "Confirm setting" }).click();
    await expect(page.getByText(/Setting saved\..*2 failed/)).toBeVisible();
    await expect(
      page.getByText("Use credits automatically: On", { exact: true }),
    ).toBeVisible();
    f.sql(
      `drop trigger workspace_fail_${f.studentId.replaceAll("-", "")} on package_credit_entries;drop function public.e2e_workspace_fail_${f.studentId.replaceAll("-", "")}();update credit_internal.credit_coverage_jobs set next_attempt_at=now()-interval '1 second' where student_id='${f.studentId}';select public.process_credit_coverage_job('${f.studentId}');`,
    );
    await page.getByRole("button", { name: "Refresh coverage" }).click();
    await expect(
      page.getByText("Credit reserved", { exact: true }),
    ).toHaveCount(2);
    await page
      .getByRole("button", { name: "Apply eligible credits now" })
      .click();
    await expect(
      page.getByText(/0 newly covered · 2 already covered/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Turn off", exact: true }).click();
    await page.getByRole("button", { name: "Confirm setting" }).click();
    await expect(
      page.getByText("Use credits automatically: Off", { exact: true }),
    ).toBeVisible();
    f.sql(
      `insert into package_credit_entries(package_id,kind,quantity,reason) values('${packages[0]}','adjustment',1,'Manual application fixture');update lessons set status='scheduled',payment_status='due',price_minor=4000,paid_minor=0 where id='${f.lessonIds[3]}';`,
    );
    await page.getByRole("button", { name: "Refresh coverage" }).click();
    await expect(
      page.getByText("Automatic use is off", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Apply eligible credits now" })
      .click();
    await expect(
      page.getByText(/1 newly covered · 2 already covered/),
    ).toBeVisible();
    await expect(
      page.getByText("Use credits automatically: Off", { exact: true }),
    ).toBeVisible();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: info.outputPath(`after-payments-${width}.png`),
        fullPage: true,
      });
    }
    await expectNoSeriousAxeViolations(page, "main");
    expect(
      f.sql(
        `select count(*) from package_credit_entries where package_id='${packages[0]}' and quantity<0`,
      ),
    ).toBe("3");
    await page.goto(`/coach/students/${f.secondStudent}/payments`);
    await expect(
      page
        .getByText("Remaining", { exact: true })
        .locator("..")
        .getByText("0", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No upcoming lessons.")).toBeVisible();
    f.sql(`insert into packages(id,student_id,name,auto_apply) values('${packages[2]}','${f.secondStudent}','Legacy automatic package',true),('${packages[3]}','${f.secondStudent}','Legacy manual package',false);
      insert into package_credit_entries(package_id,kind,quantity,reason) values('${packages[2]}','purchase',1,'Mixed preference fixture'),('${packages[3]}','purchase',1,'Mixed preference fixture');`);
    await page.reload();
    await expect(
      page.getByText("Use credits automatically: Needs review", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Package preferences differ. Review and choose a single automatic setting.",
      ),
    ).toBeVisible();
    for (const role of ["student", "guardian", "unrelated"] as const) {
      const portal = await openAs(browser, role);
      try {
        await portal.page.goto("/portal");
        const token = await accessToken(portal.page);
        const denied = await portal.page.request.post(
          `${process.env.SUPABASE_URL}/rest/v1/rpc/student_workspace_summary`,
          {
            headers: {
              apikey: process.env.SUPABASE_ANON_KEY!,
              Authorization: `Bearer ${token}`,
            },
            data: { p_student: f.studentId },
          },
        );
        expect(denied.ok()).toBe(false);
      } finally {
        await portal.context.close();
      }
    }
  } finally {
    try {
      f.sql(`drop trigger if exists workspace_fail_${f.studentId.replaceAll("-", "")} on package_credit_entries;drop function if exists public.e2e_workspace_fail_${f.studentId.replaceAll("-", "")}();
        delete from linked_contacts where id in ('${contacts[0]}','${contacts[1]}');delete from audit_events where entity_id='${note}' and studio_id='${f.studioId}';delete from notes where id='${note}';
        update lessons set package_id=null where id in (${f.lessonIds.map((id) => `'${id}'`).join(",")});
        delete from package_credit_entries where package_id in ('${packages[0]}','${packages[1]}','${packages[2]}','${packages[3]}');delete from packages where id in ('${packages[0]}','${packages[1]}','${packages[2]}','${packages[3]}');
        delete from payment_entries where student_id='${f.studentId}';delete from student_credit_accounts where student_id='${f.studentId}';`);
      await f.cleanup();
    } finally {
      await context.close();
    }
  }
});

test("@journey @mobile @a11y finance-only guardian sees account totals without lesson logistics", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const f = await bulkFixture(runtime, 2, false, 130);
  const userId = crypto.randomUUID(),
    contact = crypto.randomUUID();
  const email = `${runtime.runId}-${userId}@example.test`,
    password = `Isolated-${crypto.randomUUID()}-aA1!`;
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const created = await f.db.auth.admin.createUser({
      id: userId,
      email,
      password,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    f.sql(`update students set portal_enabled=true where id='${f.studentId}';update lessons set payment_status='due',price_minor=4000 where student_id='${f.studentId}';
      insert into memberships(studio_id,user_id,role,display_name) values('${f.studioId}','${userId}','guardian','Finance-only guardian');
      insert into linked_contacts(id,studio_id,student_id,user_id,full_name,email,relationship_type,portal_enabled,can_view_finance,can_view_schedule,can_view_work) values('${contact}','${f.studioId}','${f.studentId}','${userId}','Finance-only guardian','${email}','guardian',true,true,false,false);`);
    const client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const login = await client.auth.signInWithPassword({ email, password });
    expect(login.error).toBeNull();
    const baseline = JSON.parse(
      await readFile(storageStatePath("guardian"), "utf8"),
    );
    const storageKey = baseline.origins
      .flatMap(
        (origin: { localStorage: { name: string }[] }) => origin.localStorage,
      )
      .find((entry: { name: string }) =>
        entry.name.endsWith("-auth-token"),
      )!.name;
    context = await browser.newContext({
      baseURL: runtime.baseURL,
      bypassCSP: true,
      viewport: { width: 390, height: 1000 },
      storageState: {
        cookies: [],
        origins: [
          {
            origin: new URL(runtime.baseURL).origin,
            localStorage: [
              { name: storageKey, value: JSON.stringify(login.data.session) },
            ],
          },
        ],
      },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto("/portal/payments");
    await expect(
      page.getByRole("heading", { name: "Account summary" }),
    ).toBeVisible();
    await expect(page.getByText("$80.00", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Your coach manages this setting."),
    ).toBeVisible();
    await expect(page.getByText(/Upcoming coverage/)).toHaveCount(0);
    await expect(page.getByText(f.rows[0].topic!, { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Apply eligible credits now" }),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxeViolations(page, "main");
    const headers = {
      apikey: process.env.SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${login.data.session!.access_token}`,
    };
    const coverage = await page.request.post(
      `${process.env.SUPABASE_URL}/rest/v1/rpc/student_credit_coverage`,
      { headers, data: { p_student: f.studentId } },
    );
    expect(coverage.ok()).toBe(true);
    expect(await coverage.json()).toMatchObject({
      lessonsVisible: false,
      counts: null,
      items: [],
    });
    f.sql(
      `update linked_contacts set portal_enabled=false where id='${contact}'`,
    );
    const denied = await page.request.post(
      `${process.env.SUPABASE_URL}/rest/v1/rpc/student_financial_overview`,
      { headers, data: { p_student: f.studentId } },
    );
    expect(denied.ok()).toBe(false);
  } finally {
    try {
      f.sql(
        `delete from linked_contacts where id='${contact}';delete from memberships where user_id='${userId}' and studio_id='${f.studioId}';`,
      );
      await f.db.auth.admin.deleteUser(userId);
      await f.cleanup();
    } finally {
      await context?.close();
    }
  }
});
