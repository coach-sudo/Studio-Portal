import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readRuntime } from "../support/runtime";
import { openAs } from "../support/auth";
const id = (n: number) =>
  `e8630000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
test("historical source UI commits replay-safe scheduled history and preserves a paid completed original", async ({
  browser,
}, info) => {
  expect(process.env.IDENTITY_CONNECTED_LOCAL).toBe("true");
  expect(process.env.DB_CONTAINER).toBe("supabase_db_studio-portal");
  const runtime = await readRuntime();
  expect(runtime.fixtureReady).toBe(true);
  const student = runtime.ids!.student;
  expect(student).toMatch(/^[0-9a-f-]{36}$/);
  const studio = sql(
      `select studio_id from public.students where id='${student}'`,
    ),
    actor = sql(
      `select user_id from public.memberships where id='${runtime.ids!.membership}'`,
    );
  for (const uuid of [studio, actor]) expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
  sql(`begin;
    insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,price_minor,paid_minor,payment_status)
      values('${id(5)}','${studio}','${student}','E2E retained paid historical','2020-01-05T15:00Z','2020-01-05T16:00Z','completed','in_person','Original studio',1900,1900,'paid');
    insert into public.lesson_participants(lesson_id,student_id,display_name,email,status) values('${id(5)}','${student}','E2E original learner','e2e-connected-historical@example.test','attended');
    insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values('${student}','payment',1900,'USD','e2e-connected-historical-payment','Original historical payment');
    insert into discovery_internal.scans(id,studio_id,actor_id,request_key,request_hash,range_start,range_end,timezone)
      values('${id(1)}','${studio}','${actor}','e2e-connected-history-scan',repeat('a',64),'2020-01-01','2020-02-01','America/New_York');
    insert into discovery_internal.sources(scan_id,calendar_id,label,calendar_timezone,status,page_sequence,observed,last_success_at)
      values('${id(1)}','e2e-connected-calendar','E2E saved historical source','America/New_York','completed',1,2,now());
    insert into discovery_internal.candidates(id,scan_id,calendar_id,event_id,source_key,summary,status,starts_at,ends_at,reason_code)
      values('${id(2)}','${id(1)}','e2e-connected-calendar','e2e-connected-create',jsonb_build_array('e2e-connected-calendar','e2e-connected-create')::text,'E2E source for scheduled history','active','2020-01-06T15:00Z','2020-01-06T16:00Z','event_detected'),
      ('${id(3)}','${id(1)}','e2e-connected-calendar','e2e-connected-link',jsonb_build_array('e2e-connected-calendar','e2e-connected-link')::text,'E2E source for original paid lesson','active','2020-01-05T15:00Z','2020-01-05T16:00Z','event_detected');
    insert into public.integration_imports(id,studio_id,provider,external_id,detected_source,status,payload,updated_at)
      values('${id(7)}','${studio}','google_calendar','e2e-connected-create','google_calendar','ignored','{}','2020-01-01');commit;`);
  const financial = () =>
    sql(`select jsonb_build_object('payments',(select jsonb_agg(to_jsonb(t) order by id) from public.payment_entries t),
    'credits',(select jsonb_agg(to_jsonb(t) order by id) from public.package_credit_entries t),'accounts',(select jsonb_agg(to_jsonb(t) order by student_id) from public.student_credit_accounts t),
    'outbox',(select jsonb_agg(to_jsonb(t) order by id) from public.outbox_messages t),'originalLesson',(select to_jsonb(t) from public.lessons t where id='${id(5)}'),
    'originalParticipant',(select jsonb_agg(to_jsonb(t) order by id) from public.lesson_participants t where lesson_id='${id(5)}'));`);
  const before = financial(),
    coach = await openAs(browser, "coach"),
    requests: Record<string, unknown>[] = [];
  let lost = false;
  await coach.context.route("**/api/v2/integrations", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command !== "historical_calendar_reconciliation")
      return route.continue();
    requests.push(structuredClone(body));
    if (!lost) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      lost = true;
      return route.abort("failed");
    }
    return route.continue();
  });
  await coach.page.goto("/coach/settings?panel=integrations");
  await coach.page
    .getByRole("button", { name: "Saved Calendar previews", exact: true })
    .click();
  let dialog = coach.page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  await coach.page
    .getByRole("button", {
      name: "Review source: E2E source for scheduled history",
      exact: true,
    })
    .click();
  dialog = coach.page.getByRole("dialog", {
    name: "Review Calendar source",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Review action", exact: true })
    .selectOption("reopen");
  await dialog
    .getByRole("combobox", { name: "Source decision to reopen", exact: true })
    .selectOption(id(7));
  await dialog.getByLabel(/I verified this exact legacy event/).check();
  await dialog
    .getByLabel("Reason for this source decision", { exact: true })
    .fill("Coach explicitly reopens this exact synthetic source.");
  await dialog
    .getByRole("button", { name: "Preview source decision", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm source decision", exact: true })
    .click();
  await expect(
    dialog.getByText("Source decision saved.", { exact: true }),
  ).toBeVisible();
  expect(
    sql(`select status from public.integration_imports where id='${id(7)}'`),
  ).toBe("needs_review");
  for (const action of ["skip", "not_lesson", "reopen"]) {
    await dialog
      .getByRole("combobox", { name: "Review action", exact: true })
      .selectOption(action);
    await dialog
      .getByRole("button", { name: "Preview source decision", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Confirm source decision", exact: true })
      .click();
    await expect(
      dialog.getByText("Source decision saved.", { exact: true }),
    ).toBeVisible();
    expect(financial()).toBe(before);
  }
  const chooseStudent = async () => {
    await dialog
      .getByLabel("Find original student", { exact: true })
      .fill(runtime.runId);
    await dialog
      .getByRole("button", { name: "Search original students", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: `${runtime.runId} Student`, exact: true })
      .click();
  };
  await dialog
    .getByRole("combobox", { name: "Review action", exact: true })
    .selectOption("create");
  await chooseStudent();
  await dialog
    .getByLabel("Confirmed location or meeting description", { exact: true })
    .fill("Original studio");
  await dialog
    .getByRole("button", { name: "Preview source decision", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Source decision preview" }),
  ).toContainText("Recorded outcome: scheduled");
  await dialog
    .getByRole("button", { name: "Confirm source decision", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Recover unchanged source request",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    sql(
      `select count(*) from public.lessons where source_external_id=jsonb_build_array('e2e-connected-calendar','e2e-connected-create')::text`,
    ),
  ).toBe("1");
  await coach.page.keyboard.press("Escape");
  await coach.page
    .getByRole("button", { name: "Calendar discovery previews", exact: true })
    .click();
  dialog = coach.page.getByRole("dialog", {
    name: "Review Calendar source",
    exact: true,
  });
  await dialog
    .getByRole("button", {
      name: "Recover unchanged source request",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByText("Source decision saved.", { exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(
    sql(
      `select status||':'||payment_status||':'||paid_minor from public.lessons where source_external_id=jsonb_build_array('e2e-connected-calendar','e2e-connected-create')::text`,
    ),
  ).toBe("scheduled:untracked:0");
  expect(
    sql(
      `select count(*) from public.calendar_projections p join public.lessons l on l.id=p.lesson_id where l.source_external_id=jsonb_build_array('e2e-connected-calendar','e2e-connected-create')::text`,
    ),
  ).toBe("0");
  expect(
    sql(
      `select p.status from public.lesson_participants p join public.lessons l on l.id=p.lesson_id where l.source_external_id=jsonb_build_array('e2e-connected-calendar','e2e-connected-create')::text`,
    ),
  ).toBe("confirmed");
  expect(financial()).toBe(before);
  await dialog
    .getByRole("button", { name: "Back to source observations", exact: true })
    .click();
  await coach.page
    .getByRole("button", {
      name: "Review source: E2E source for original paid lesson",
      exact: true,
    })
    .click();
  dialog = coach.page.getByRole("dialog", {
    name: "Review Calendar source",
    exact: true,
  });
  await chooseStudent();
  await dialog
    .getByLabel("Find existing lesson", { exact: true })
    .fill("E2E retained paid historical");
  await dialog
    .getByRole("button", { name: "Search this student's lessons", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "E2E retained paid historical", exact: true })
    .click();
  await dialog
    .getByLabel("Reason for this source decision", { exact: true })
    .fill(
      "Coach links the exact original paid and attended historical lesson.",
    );
  await dialog
    .getByRole("button", { name: "Preview source decision", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Source decision preview" }),
  ).toContainText("Recorded outcome: completed");
  await dialog
    .getByRole("button", { name: "Confirm source decision", exact: true })
    .click();
  await expect(
    dialog.getByText(
      /recorded outcome \(completed\) and financial history were preserved/,
    ),
  ).toBeVisible();
  expect(financial()).toBe(before);
  expect(
    sql(
      `select lesson_id from discovery_internal.source_decisions where event_id='e2e-connected-link'`,
    ),
  ).toBe(id(5));
  expect(
    sql(
      `select count(*) from discovery_internal.review_receipts where studio_id='${studio}'`,
    ),
  ).toBe("6");
  await coach.page.screenshot({
    path: info.outputPath("historical-original-preserved.png"),
    fullPage: true,
  });
  await coach.context.close();
  writeFileSync(
    "test-results/identity-connected/historical-canonical-proof.json",
    JSON.stringify(
      {
        layer:
          "real authenticated UI→server→PostgreSQL, isolated loopback only",
        identicalReplay: true,
        originalFinancialAndAttendanceHash: createHash("sha256")
          .update(before)
          .digest("hex"),
        afterHash: createHash("sha256").update(financial()).digest("hex"),
        createdLessons: 1,
        createdOutcome: "scheduled",
        createdPaymentStatus: "untracked",
        createdPaidMinor: 0,
        sourceReceipts: 6,
        providerMutationsRequestedByHarness: false,
      },
      null,
      2,
    ) + "\n",
  );
});
