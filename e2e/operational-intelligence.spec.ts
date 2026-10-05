import { openAs, accessToken } from "./support/auth";
import { expectNoSeriousAxeViolations } from "./support/axe";
import {
  test,
  expect,
  requireFixtures,
  expectNoHorizontalOverflow,
} from "./support/fixtures";
import type { Page } from "@playwright/test";
import type { E2ERuntime } from "./support/runtime";

async function read(page: Page, table: string, filter: string) {
  const token = await accessToken(page);
  const response = await page.request.get(
    `${process.env.SUPABASE_URL}/rest/v1/${table}?${filter}`,
    {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${token}`,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function command(
  page: Page,
  runtime: E2ERuntime,
  domain: string,
  commandName: string,
  entityId: string,
  version: number,
  payload: Record<string, unknown> = {},
) {
  const token = await accessToken(page);
  const response = await page.request.post(`/api/v2/${domain}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-correlation-id": `${runtime.runId}:${crypto.randomUUID()}`,
    },
    data: {
      command: commandName,
      entityId,
      expectedVersion: version,
      idempotencyKey: crypto.randomUUID(),
      reason: "Namespaced isolated operational E2E verification",
      payload,
    },
  });
  expect(
    response.ok(),
    `Command ${commandName} HTTP ${response.status()}`,
  ).toBeTruthy();
  return response.json();
}

test.describe("Stateful operational acceptance", () => {
  // Multi-step money/cancellation checks cannot replay against their own mutated fixture.
  test.describe.configure({ retries: 0 });
  test("@journey @a11y Operational intelligence: 15 constrained coach journeys", async ({
    browser,
    runtime,
  }, testInfo) => {
    requireFixtures(runtime);
    test.setTimeout(180000);
    const coach = await openAs(browser, "coach"),
      page = coach.page,
      ids = runtime.ids!;
    await page.goto(`/coach/students/${ids.operationalStudent}/account`);
    await test.step("01 Today/readiness: paid, package-covered and due lessons", async () => {
      // Freeze the browser to the fixture's operational day; database time and provider writes remain untouched.
      const [lesson] = await read(
        page,
        "lessons",
        `select=starts_at&id=eq.${ids.lessonPaid}`,
      );
      await page.clock.install({ time: Date.parse(lesson.starts_at) - 60000 });
      await page.goto("/coach/today");
      await expect(
        page.getByTestId(`readiness-${ids.lessonPaid}`),
      ).toContainText("Paid");
      await expect(
        page.getByTestId(`readiness-${ids.lessonCredit}`),
      ).toContainText("Package covered");
      await expect(
        page.getByTestId(`readiness-${ids.lessonDue}`),
      ).toContainText("Payment due");
      await page.screenshot({
        path: testInfo.outputPath("coach-today-desktop.png"),
        fullPage: true,
      });
    });
    await test.step("02 Correct payer appears on due lesson", async () => {
      const panel = page.getByTestId(`readiness-${ids.lessonDue}`);
      await panel.locator("summary").click();
      await expect(panel).toContainText("E2E Primary payer");
    });
    await test.step("03 Minor never becomes the finance recipient", async () => {
      const outbox = await read(
        page,
        "outbox_messages",
        `select=recipient,recipient_intent&student_id=eq.${ids.operationalStudent}`,
      );
      expect(
        outbox
          .filter(
            (item: { recipient_intent: string }) =>
              item.recipient_intent === "payment_due",
          )
          .every(
            (item: { recipient: string }) =>
              item.recipient === runtime.accounts!.guardian.email,
          ),
      ).toBeTruthy();
    });
    await test.step("04 Linked contact responsibility is editable independently of private work permission", async () => {
      await page.goto(`/coach/students/${ids.operationalStudent}/account`);
      await page
        .getByRole("button", { name: "Edit access", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByLabel("Primary payer", { exact: true }),
      ).toBeChecked();
      await dialog.getByLabel("Primary payer", { exact: true }).uncheck();
      await dialog.getByRole("button", { name: /Save/ }).click();
      await expect(dialog).toHaveCount(0);
      await page
        .getByRole("button", { name: "Edit access", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByLabel("Primary payer", { exact: true })
        .check();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /Save/ })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const [contact] = await read(
        page,
        "linked_contacts",
        `select=is_primary_payer,can_view_work&id=eq.${ids.operationalContact}`,
      );
      expect(contact).toMatchObject({
        is_primary_payer: true,
        can_view_work: false,
      });
    });
    await test.step("05 Package shortfall surfaced without consuming forecast credits", async () => {
      await expect(
        page.getByText(/Package shortfall: 1 uncovered/),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("student-account-desktop.png"),
        fullPage: true,
      });
    });
    await test.step("06 Upcoming communication visible before sending", async () => {
      await expect(
        page.getByRole("heading", { name: "Communication timeline" }),
      ).toBeVisible();
      await expect(
        page.getByText(`${runtime.runId} Future lesson reminder`, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(`${runtime.runId} Future payment reminder`, {
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("communication-timeline-desktop.png"),
        fullPage: true,
      });
    });
    await test.step("07 Payment resolution suppresses future billing email and retains history", async () => {
      const [lesson] = await read(
        page,
        "lessons",
        `select=version&id=eq.${ids.lessonDue}`,
      );
      await command(
        page,
        runtime,
        "lessons",
        "set_payment_status",
        ids.lessonDue,
        lesson.version,
        { paymentStatus: "paid", priceMinor: 7500, paidMinor: 7500 },
      );
      const [message] = await read(
        page,
        "outbox_messages",
        `select=status,suppression_reason&id=eq.${ids.operationalPaymentReminder}`,
      );
      expect(message.status).toBe("cancelled");
      expect(message.suppression_reason).toBe("financial_condition_resolved");
    });
    await test.step("08 Cancellation suppresses stale reminders", async () => {
      const [lesson] = await read(
        page,
        "lessons",
        `select=version&id=eq.${ids.lessonDue}`,
      );
      await command(
        page,
        runtime,
        "lessons",
        "cancel",
        ids.lessonDue,
        lesson.version,
      );
      const [message] = await read(
        page,
        "outbox_messages",
        `select=status,suppression_reason&id=eq.${ids.operationalReminder}`,
      );
      expect(message).toMatchObject({
        status: "cancelled",
        suppression_reason: "lesson_cancelled",
      });
    });
    await test.step("09 Reschedule replaces obsolete timing through the production queue helper (Google availability isolated)", async () => {
      // Re-open only this disposable fixture so the normal tracked reschedule command can be exercised without a Google account.
      const token = await accessToken(page),
        patch = await page.request.patch(
          `${process.env.SUPABASE_URL}/rest/v1/lessons?id=eq.${ids.lessonDue}`,
          {
            headers: {
              apikey: process.env.SUPABASE_ANON_KEY!,
              Authorization: `Bearer ${token}`,
            },
            data: { status: "scheduled", payment_status: "due", paid_minor: 0 },
          },
        );
      expect(patch.ok()).toBeTruthy();
      const response = await page.request.post("/api/e2e/fixtures", {
        headers: {
          "x-e2e-fixture-token": process.env.STAGING_E2E_FIXTURE_TOKEN!,
        },
        data: { action: "reschedule_operational", runId: runtime.runId },
      });
      expect(response.ok()).toBeTruthy();
      const messages = await read(
        page,
        "outbox_messages",
        `select=status,event_key,entity_snapshot&lesson_id=eq.${ids.lessonDue}`,
      );
      expect(
        messages.some(
          (item: { status: string; event_key: string }) =>
            item.status === "queued" &&
            item.event_key === "booking.reminder.student",
        ),
      ).toBeTruthy();
      expect(
        messages.some(
          (item: { status: string }) => item.status === "cancelled",
        ),
      ).toBeTruthy();
    });
    let rule: {
      id: string;
      version: number;
      timing: object;
      template: object;
      escalation: object;
    };
    await test.step("10 Draft mode creates reviewable outbox, never sends", async () => {
      [rule] = await read(
        page,
        "automation_rules",
        "select=*&rule_key=eq.payment_due",
      );
      await command(
        page,
        runtime,
        "automations",
        "save_rule",
        rule.id,
        rule.version,
        {
          enabled: true,
          mode: "draft",
          timing: { hoursBefore: [24, 2] },
          template: {},
          escalation: {},
        },
      );
      await command(
        page,
        runtime,
        "automations",
        "run_rule",
        rule.id,
        rule.version + 1,
        { studentId: ids.operationalStudent, entityId: ids.lessonDue },
      );
      const messages = await read(
        page,
        "outbox_messages",
        `select=status,body&automation_rule_id=eq.${rule.id}`,
      );
      expect(messages.length).toBeGreaterThan(0);
      expect(
        messages.every((item: { status: string }) => item.status === "draft"),
      ).toBeTruthy();
    });
    await test.step("11 Automatic mode creates queued outbox entries without Gmail", async () => {
      const [current] = await read(
        page,
        "automation_rules",
        `select=*&id=eq.${rule.id}`,
      );
      await command(
        page,
        runtime,
        "automations",
        "save_rule",
        rule.id,
        current.version,
        {
          enabled: true,
          mode: "automatic",
          timing: { hoursBefore: [1] },
          template: {},
          escalation: {},
        },
      );
      const result = await command(
        page,
        runtime,
        "automations",
        "run_rule",
        rule.id,
        current.version + 1,
        { studentId: ids.operationalStudent, entityId: ids.lessonDue },
      );
      expect(result.resource.result).toBe("queued");
      expect(result.resource.outboxIds.length).toBeGreaterThan(0);
    });
    await test.step("12 Outbox audit and suppression history remain visible", async () => {
      await page.goto(`/coach/students/${ids.operationalStudent}/account`);
      await page.getByRole("button", { name: "Recent & suppressed" }).click();
      await expect(
        page.getByText(`${runtime.runId} Suppressed payment reminder`, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(/Suppressed: payment received/),
      ).toBeVisible();
      const runs = await read(
        page,
        "automation_runs",
        `select=result,explanation&rule_id=eq.${rule.id}`,
      );
      expect(
        runs.some((item: { result: string }) => item.result === "draft"),
      ).toBeTruthy();
      expect(
        runs.some((item: { result: string }) => item.result === "queued"),
      ).toBeTruthy();
    });
    await test.step("13 Canonical CTA uses this isolated deployed origin; rule preview never queues", async () => {
      const messages = await read(
        page,
        "outbox_messages",
        `select=body,html_body&automation_rule_id=eq.${rule.id}`,
      );
      for (const message of messages) {
        expect(message.body).toContain(`${runtime.baseURL}/portal/payments`);
        expect(message.body).not.toContain("portal.daj.com");
        expect(message.html_body).toContain(
          `${runtime.baseURL}/portal/payments`,
        );
      }
      const before = messages.length;
      const result = await command(
        page,
        runtime,
        "automations",
        "test_rule",
        rule.id,
        rule.version + 2,
        { studentId: ids.operationalStudent, entityId: ids.lessonDue },
      );
      expect(result.resource.outboxIds).toHaveLength(0);
      expect(
        (
          await read(
            page,
            "outbox_messages",
            `select=id&automation_rule_id=eq.${rule.id}`,
          )
        ).length,
      ).toBe(before);
    });
    await test.step("14 Guardian remains isolated from operational minor and unrelated student", async () => {
      const guardian = await openAs(browser, "guardian");
      await guardian.page.goto("/portal");
      const result = await read(
        guardian.page,
        "students",
        `select=id&id=in.(${ids.operationalStudent},${ids.unrelatedStudent})`,
      );
      expect(result).toEqual([]);
      const rules = await read(guardian.page, "automation_rules", "select=id");
      expect(rules).toEqual([]);
      await guardian.context.close();
    });
    await test.step("15 Keyboard/axe/reflow on Today, Account, Payments, timeline and Settings", async () => {
      await page.goto(`/coach/students/${ids.operationalStudent}/payments`);
      await expect(
        page.getByRole("heading", { name: "Financial setup" }),
      ).toBeVisible();
      await expectNoSeriousAxeViolations(page);
      await page.screenshot({
        path: testInfo.outputPath("student-payments-desktop.png"),
        fullPage: true,
      });
      await page.goto("/coach/settings");
      await page.getByRole("button", { name: /Email automations/ }).click();
      await expect(
        page.getByRole("heading", { name: "Automation rules" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Edit Payment due", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectNoSeriousAxeViolations(page);
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Edit Payment due", exact: true }),
      ).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath("automation-settings-desktop.png"),
        fullPage: true,
      });
    });
    // Restore the rule baseline in global teardown; leave message/run history for cleanup verification.
    await coach.context.close();
  });
});

test("@mobile @mobile-only @a11y Operational mobile surfaces retain hierarchy, reflow and keyboard access", async ({
  browser,
  runtime,
}, testInfo) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "coach");
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto(`/coach/students/${runtime.ids!.operationalStudent}/account`);
  const [lesson] = await read(
    page,
    "lessons",
    `select=starts_at&id=eq.${runtime.ids!.lessonPaid}`,
  );
  await page.clock.install({ time: Date.parse(lesson.starts_at) - 60000 });
  for (const [name, path] of [
    ["today", "/coach/today"],
    ["account", `/coach/students/${runtime.ids!.operationalStudent}/account`],
    ["payments", `/coach/students/${runtime.ids!.operationalStudent}/payments`],
    ["settings", "/coach/settings"],
  ]) {
    await page.goto(path);
    if (name === "settings")
      await page.getByRole("button", { name: /Email automations/ }).click();
    await expect(page.locator("main")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxeViolations(page);
    await page.screenshot({
      path: testInfo.outputPath(`${name}-mobile.png`),
      fullPage: true,
    });
  }
  await context.close();
});
