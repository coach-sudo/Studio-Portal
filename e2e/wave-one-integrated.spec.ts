import { accessToken } from "./support/auth";
import { storageStatePath } from "./support/runtime";
import {
  bulkFixture,
  batchId,
  chooseBulkOperation,
} from "./support/lessonBulk";
import {
  test,
  expect,
  requireFixtures,
  expectNoHorizontalOverflow,
} from "./support/fixtures";
import { expectNoSeriousAxeViolations } from "./support/axe";

test("@journey @mobile @a11y Wave 1 credits, cancellation, protected deletion and Payments agree with the ledger", async ({
  browser,
  runtime,
}, info) => {
  requireFixtures(runtime);
  test.setTimeout(180000);
  const f = await bulkFixture(runtime, 6, false, 240);
  const pkg = crypto.randomUUID();
  const context = await browser.newContext({
    baseURL: runtime.baseURL,
    storageState: storageStatePath("coach"),
    bypassCSP: true,
    viewport: {
      width: info.project.name.startsWith("mobile") ? 390 : 1440,
      height: 1000,
    },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const base = `/coach/students/${f.studentId}`;
  const metric = (label: string) =>
    page
      .locator(".account-metrics > div")
      .filter({
        has: page.locator("small", { hasText: new RegExp(`^${label}$`) }),
      })
      .locator("strong");
  const verifyTotals = async (due: string) => {
    const credit = await f.db.rpc("student_credit_summary", {
      p_student: f.studentId,
    });
    expect(credit.error).toBeNull();
    const totals = credit.data as {
      remaining: number;
      reserved: number;
      available: number;
    };
    expect(totals).toMatchObject({ remaining: 2, reserved: 2, available: 0 });
    for (const label of ["Remaining", "Available", "Reserved"] as const)
      await expect(metric(label)).toHaveText(
        String(totals[label.toLowerCase() as keyof typeof totals]),
      );
    const finance = await page.request.post(
      `${process.env.SUPABASE_URL}/rest/v1/rpc/student_financial_overview`,
      {
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${await accessToken(page)}`,
        },
        data: { p_student: f.studentId },
      },
    );
    expect(finance.ok(), await finance.text()).toBe(true);
    expect(await finance.json()).toMatchObject({
      reviewRequired: false,
      balances: [{ currency: "USD", dueMinor: Number(due) * 100 }],
    });
    await expect(metric("Amount due · USD")).toHaveText(
      `$${Number(due).toFixed(2)}`,
    );
    expect(
      f.sql(
        `select -coalesce(sum(quantity),0) from package_credit_entries where package_id='${pkg}' and lesson_id is not null`,
      ),
    ).toBe("2");
  };
  try {
    f.sql(`update lessons set status='scheduled',payment_status='due',price_minor=4000,paid_minor=0 where id in (${f.lessonIds
      .slice(0, 4)
      .map((id) => `'${id}'`)
      .join(",")});
      update lessons set payment_status='partially_paid',paid_minor=1000 where id='${f.lessonIds[2]}';
      insert into packages(id,student_id,name) values('${pkg}','${f.studentId}','Integrated study credits');
      insert into package_credit_entries(package_id,kind,quantity,reason) values('${pkg}','purchase',2,'Isolated integrated purchase');
      insert into student_credit_accounts(student_id,auto_apply) values('${f.studentId}',false) on conflict(student_id) do update set auto_apply=false;`);
    await page.goto(`${base}/payments`);
    await page
      .getByRole("button", { name: "Apply eligible credits now" })
      .click();
    await expect(
      page.getByText(/2 newly covered · 0 already covered/),
    ).toBeVisible();
    await expect(
      page.getByText("Use credits automatically: Off", { exact: true }),
    ).toBeVisible();
    await verifyTotals("70");
    await page
      .getByRole("button", { name: "Apply eligible credits now" })
      .click();
    await expect(
      page.getByText(/0 newly covered · 2 already covered/),
    ).toBeVisible();
    await verifyTotals("70");
    await page.getByRole("button", { name: "Review and enable" }).click();
    await page.getByRole("button", { name: "Confirm setting" }).click();
    await expect(
      page.getByText("Use credits automatically: On", { exact: true }),
    ).toBeVisible();
    const unaffected = f.sql(
      `select row_to_json(l) from lessons l where id='${f.lessonIds[1]}'`,
    );
    await page.goto(`${base}/lessons?lessonQuery=Lesson%200001`);
    await page.getByLabel("Select all visible", { exact: true }).check();
    await chooseBulkOperation(page, "cancel");
    const cancelled = batchId(page);
    await page
      .getByRole("button", {
        name: "Confirm cancel lessons (1 eligible)",
        exact: true,
      })
      .click();
    await expect(page.getByText(/Batch accepted/)).toBeVisible();
    await f.work(cancelled);
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(
      page.getByText("1 completed of 1", { exact: true }),
    ).toBeVisible();
    expect(
      f.sql(`select status from lessons where id='${f.lessonIds[0]}'`),
    ).toBe("cancelled");
    expect(
      f.sql(
        `select coalesce(sum(quantity),0) from package_credit_entries where lesson_id='${f.lessonIds[0]}'`,
      ),
    ).toBe("0");
    expect(
      f.sql(
        `select row_to_json(l) from lessons l where id='${f.lessonIds[1]}'`,
      ),
    ).toBe(unaffected);
    expect(
      f.sql(
        `select generation>completed_generation from credit_internal.credit_coverage_jobs where student_id='${f.studentId}'`,
      ),
    ).toBe("t");
    const recovered = await f.db.rpc("process_credit_coverage_job", {
      p_student: f.studentId,
    });
    expect(recovered.error).toBeNull();
    expect(recovered.data).toMatchObject({ applied: 1 });
    const repeated = await f.db.rpc("process_credit_coverage_job", {
      p_student: f.studentId,
    });
    expect(repeated.error).toBeNull();
    expect(repeated.data).toMatchObject({ processed: false });
    expect(
      f.sql(`select payment_status from lessons where id='${f.lessonIds[3]}'`),
    ).toBe("paid_by_credit");
    expect(
      f.sql(
        `select count(*) from audit_events where entity_id='${f.lessonIds[0]}' and action='lesson.bulk_cancel'`,
      ),
    ).toBe("1");
    await page.goto(`${base}/payments`);
    await verifyTotals("30");
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxeViolations(page, "main");
    await page.screenshot({
      path: info.outputPath("integrated-payment-ledger.png"),
      fullPage: true,
    });
    await page.goto(`/coach/students/${f.secondStudent}/payments`);
    await expect(metric("Amount due · USD")).toHaveText("$0.00");
    await expect(metric("Remaining")).toHaveText("0");
    await expect(page.getByText(f.rows[0].topic!, { exact: true })).toHaveCount(
      0,
    );
    await page.goto(`${base}/lessons`);
    const rows = page.locator(".bulk-lesson-rows input[type=checkbox]");
    await expect(rows).toHaveCount(6);
    // Released ledger entries still protect the cancelled lesson from deletion.
    for (const n of [0, 1, 4]) await rows.nth(n).check();
    await chooseBulkOperation(page, "delete");
    await expect(page.getByText("1 eligible", { exact: true })).toBeVisible();
    await expect(page.getByText("2 blocked", { exact: true })).toBeVisible();
    const deletion = batchId(page);
    await page.screenshot({
      path: info.outputPath("integrated-protected-deletion.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: "Permanently delete 1 eligible lessons",
        exact: true,
      })
      .click();
    await expect(page.getByText(/Batch accepted/)).toBeVisible();
    await f.work(deletion);
    await page.reload();
    await expect(
      page.getByText("1 completed of 3", { exact: true }),
    ).toBeVisible();
    expect(
      f.sql(`select count(*) from lessons where id='${f.lessonIds[4]}'`),
    ).toBe("0");
    expect(
      f.sql(
        `select count(*) from lessons where id in ('${f.lessonIds[0]}','${f.lessonIds[1]}')`,
      ),
    ).toBe("2");
    expect(
      f.sql(
        `select count(*) from lesson_ops.lesson_deletion_snapshots where lesson_id='${f.lessonIds[4]}'`,
      ),
    ).toBe("1");
    await page.goto(`${base}/payments`);
    await verifyTotals("30");
  } finally {
    try {
      f.sql(
        `update lessons set package_id=null where student_id='${f.studentId}';delete from package_credit_entries where package_id='${pkg}';delete from packages where id='${pkg}';delete from student_credit_accounts where student_id='${f.studentId}';`,
      );
      await f.cleanup();
    } finally {
      await context.close();
    }
  }
});
