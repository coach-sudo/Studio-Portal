import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

const template = {
  kind: "uncovered_lesson",
  version: 0,
  subject: "A lesson needs a credit",
  body: "Hi {{billing_contact_name}}, {{student_first_name}} needs a lesson credit.",
  active: true,
};

test("coach previews templates, saves credit thresholds, and pauses a reminder", async ({
  page,
  context,
}, info) => {
  await installFixture(context, "coach");
  await context.route(
    "**/rest/v1/rpc/household_credit_access",
    async (route) => {
      const action = route.request().postDataJSON().p_action;
      return route.fulfill({
        json:
          action === "coach"
            ? {
                households: [],
                students: [],
                definitions: [],
                transferLots: [],
              }
            : [],
      });
    },
  );
  let version = { ...template };
  let history: object[] = [];
  let paused = false;
  let threshold: number | null = null;
  await context.route(
    "**/rest/v1/rpc/manage_credit_reminders",
    async (route) => {
      const { p_action: action, p_value: value } = route
        .request()
        .postDataJSON();
      if (action === "configuration")
        return route.fulfill({
          json: {
            settings:
              threshold === null
                ? []
                : [
                    {
                      scope: "studio",
                      targetId: ids.student,
                      threshold,
                      enabled: true,
                      studentCopy: null,
                    },
                  ],
            packages: [],
            templates: [version],
            history,
          },
        });
      if (action === "preview_template")
        return route.fulfill({
          json: {
            subject: value.subject,
            body: "Hi Morgan, Jordan needs a lesson credit.",
          },
        });
      if (action === "save_template") {
        expect(value.version).toBe(0);
        version = { ...version, subject: value.subject, version: 1 };
        history = [{ ...version, createdAt: "2026-11-15T15:00:00Z" }];
        return route.fulfill({ json: version });
      }
      if (action === "save_settings") {
        threshold = value.threshold;
        expect(threshold).toBe(3);
        return route.fulfill({ json: { saved: true } });
      }
      if (action === "pause") {
        expect(value.reason).toBe("Review payer assignment");
        paused = true;
        return route.fulfill({ json: { pausedAt: "2026-11-15T15:00:00Z" } });
      }
      expect(action).toBe("attention");
      return route.fulfill({
        json: [
          {
            id: "synthetic-condition",
            studentId: ids.student,
            studentName: "E2E Candidate Student",
            householdId: null,
            packageId: null,
            packageName: null,
            lessonId: ids.lesson,
            lessonName: "Candidate scene study",
            kind: "uncovered_lesson",
            status: "open",
            reason: "uncovered",
            paused,
            nextDueAt: "2027-01-20T18:00:00Z",
            lastDeliveryAt: null,
            delivery: {
              id: "synthetic-email",
              status: "uncertain",
              reason: "delivery_acknowledgement_missing",
              attempts: 1,
            },
            history: [
              {
                channel: "email",
                status: "uncertain",
                reason: "delivery_acknowledgement_missing",
                attempts: 1,
                at: "2026-11-15T15:00:00Z",
                templateVersion: 0,
              },
            ],
          },
        ],
      });
    },
  );
  await page.goto("/coach/today");
  await page
    .getByRole("button", { name: "Credit Attention", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Credit Attention" });
  await dialog
    .getByText("Reminder settings and templates", { exact: true })
    .click();
  await dialog.getByLabel("Available credit threshold").fill("3");
  await dialog.getByRole("button", { name: "Save reminder settings" }).click();
  await expect(dialog.getByText("Reminder settings saved.")).toBeVisible();
  await dialog
    .getByLabel("Subject", { exact: true })
    .fill("Please review lesson credits");
  await dialog
    .getByRole("button", { name: "Preview with sample data" })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Synthetic template preview" }),
  ).toContainText("Hi Morgan");
  await page.screenshot({ path: info.outputPath("reminder-template.png") });
  await dialog.getByRole("button", { name: "Save template version" }).click();
  await dialog.getByText("Template version history", { exact: true }).click();
  await expect(
    dialog.getByText("Version 1 · Please review lesson credits"),
  ).toBeVisible();
  await dialog
    .getByText("Reminder settings and templates", { exact: true })
    .click();
  await dialog.getByLabel("Issue type").selectOption("reminder");
  await dialog.getByLabel("Reminder status").selectOption("delivery");
  await expect(dialog.getByText(/Email outcome unknown/)).toBeVisible();
  await dialog.getByText("Delivery history", { exact: true }).click();
  await expect(dialog.getByText(/Email · uncertain/)).toBeVisible();
  await dialog.getByRole("button", { name: "Pause reminders" }).click();
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Review payer assignment");
  await dialog.getByRole("button", { name: "Confirm pause" }).click();
  await expect(
    dialog.getByRole("button", { name: "Resume reminders" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("reminder-attention.png") });
});

for (const role of ["student", "guardian"] as const) {
  test(`${role} sees authorized renewal reminder history`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context, role);
    await context.route("**/rest/v1/rpc/household_credit_access", (route) =>
      route.fulfill({ json: [] }),
    );
    await context.route(
      "**/rest/v1/rpc/student_credit_coverage",
      async (route) => {
        return route.fulfill({
          json: {
            studentId: ids.student,
            evaluatedAt: new Date().toISOString(),
            previewEnable: false,
            settingReasonCode: null,
            lessonsVisible: true,
            packages: [],
            items: [
              {
                lessonId: ids.lesson,
                topic: "Candidate scene study",
                startsAt: "2027-01-20T18:00:00Z",
                endsAt: "2027-01-20T19:00:00Z",
                durationMinutes: 60,
                version: 1,
                state: "ineligible",
                reasonCode: "no_available_credits",
                eligible: false,
                coverageStatus: "needs_credit",
              },
            ],
            summary: {
              remaining: 0,
              reserved: 0,
              available: 0,
              expired: 0,
              version: 1,
              autoApply: true,
              needsReview: false,
            },
            counts: {
              covered: 0,
              eligible: 0,
              uncovered: 1,
              reviewRequired: 0,
            },
            page: route.request().postDataJSON().p_page,
            pageSize: route.request().postDataJSON().p_page_size,
            total: 1,
            hasMore: false,
          },
        });
      },
    );
    await context.route(
      "**/rest/v1/rpc/credit_reminder_history",
      async (route) => {
        expect(route.request().postDataJSON().p_students).toContain(
          ids.student,
        );
        return route.fulfill({
          json: [
            {
              id: "synthetic-portal-notice",
              subject: "A lesson needs a credit",
              body: "The upcoming lesson is still scheduled.",
              path:
                "/portal/credits?student=" +
                ids.student +
                "&lesson=" +
                ids.lesson,
              at: new Date().toISOString(),
              studentName: "E2E Candidate Student",
              requiresAction: true,
            },
          ],
        });
      },
    );
    await page.goto("/portal/credits?student=" + ids.student);
    await expect(
      page.getByText("Candidate scene study", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /unread notifications/ }).click();
    await expect(
      page.getByRole("button", { name: /A lesson needs a credit/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close notifications" }).click();
    await page.getByText("Renewal reminders", { exact: true }).click();
    await expect(
      page.getByText("The upcoming lesson is still scheduled."),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Review lesson credits", exact: true }),
    ).toHaveAttribute("href", /lesson=/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(role + "-reminder-history.png"),
      fullPage: true,
    });
  });
}
