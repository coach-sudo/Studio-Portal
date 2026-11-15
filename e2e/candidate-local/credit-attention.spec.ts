import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

test("coach finds credit attention from the dashboard", async ({
  page,
  context,
}, info) => {
  await installFixture(context, "coach");
  await context.route(
    "**/rest/v1/rpc/student_credit_coverage",
    async (route) => {
      const input = route.request().postDataJSON();
      const now = new Date().toISOString();
      await route.fulfill({
        json: {
          studentId: input.p_student,
          evaluatedAt: now,
          previewEnable: false,
          lessonsVisible: true,
          settingReasonCode: null,
          summary: {
            remaining: 0,
            available: 0,
            reserved: 0,
            expired: 0,
            version: 1,
            autoApply: true,
            needsReview: false,
          },
          packages: [],
          page: input.p_page,
          pageSize: input.p_page_size,
          total: 1,
          hasMore: false,
          counts: { covered: 0, eligible: 0, uncovered: 1, reviewRequired: 0 },
          items: [
            {
              lessonId: ids.lesson,
              topic: "Scene Study needs attention",
              startsAt: now,
              endsAt: now,
              version: 1,
              eligible: false,
              state: "ineligible",
              reasonCode: "no_available_credits",
              coverageStatus: "needs_credit",
            },
          ],
        },
      });
    },
  );
  await context.route(
    "**/rest/v1/rpc/household_credit_access",
    async (route) => {
      const input = route.request().postDataJSON();
      if (input.p_action === "attention_cases") {
        return route.fulfill({
          json: [
            {
              id: ids.lesson,
              studentId: ids.student,
              packageId: ids.lesson,
              packageName: "Coaching package",
              finding: "missing_issuance",
              status: "under_review",
            },
          ],
        });
      }
      const expiresAt = new Date(Date.now() + 2 * 86400_000).toISOString();
      const member = { id: ids.student, name: "E2E Candidate Student" };
      return route.fulfill({
        json: {
          students: [member],
          definitions: [],
          transferLots: [],
          households: [
            {
              id: ids.lesson,
              name: "Candidate household",
              members: [member],
              pools: [
                {
                  id: ids.lesson,
                  householdId: ids.lesson,
                  householdName: "Candidate household",
                  name: "Shared coaching",
                  durationMinutes: 60,
                  expiresAt,
                  services: ["Coaching"],
                  unused: 1,
                  reserved: 0,
                  available: 1,
                  consumed: 0,
                  members: [member],
                  usage: [],
                },
              ],
            },
          ],
        },
      });
    },
  );
  await page.goto("/coach");
  await page.getByRole("button", { name: "Credit Attention" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Scene Study needs attention/)).toBeVisible();
  await dialog.getByLabel("Search students").fill("does not match");
  await expect(dialog.getByText("No matching credit issues.")).toBeVisible();
  await dialog.getByLabel("Search students").fill("");
  await dialog.getByLabel("Household").selectOption(ids.lesson);
  await dialog.getByLabel("Severity").selectOption("upcoming");
  await expect(dialog.getByText(/Shared coaching/)).toBeVisible();
  await expect(dialog.getByText(/Scene Study needs attention/)).toHaveCount(0);
  await dialog.getByLabel("Severity").selectOption("action");
  await dialog.getByLabel("Issue type").selectOption("review");
  await expect(dialog.getByText(/Under review/)).toBeVisible();
  await expect(dialog.getByText(/Shared coaching/)).toHaveCount(0);
  await dialog.getByLabel("Issue type").selectOption("uncovered");
  await expect(
    dialog.getByRole("link", { name: "Manage credits" }).first(),
  ).toBeVisible();
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("credit-attention.png") });
  await dialog.getByRole("link", { name: "Manage credits" }).first().click();
  await expect(page).toHaveURL(/\/coach\/students\/[^/]+\/payments/);
});
