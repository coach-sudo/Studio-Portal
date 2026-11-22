import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

const second = "70000000-0000-4000-8000-000000000021";
const lotId = "70000000-0000-4000-8000-000000000022";

function person(id: string, fullName: string) {
  return {
    id,
    fullName,
    preferredName: fullName,
    isMinor: false,
    canViewSchedule: true,
    canViewWork: true,
    canViewFinance: true,
    canManageProfile: true,
    canManageLessons: true,
  };
}

for (const role of ["student", "guardian", "coach"] as const) {
  test(`${role} reads one package balance at the current width`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context, role);
    if (role === "guardian")
      await context.route(
        "**/rest/v1/rpc/portal_student_contexts",
        async (route) => {
          const primary = person(ids.student, "E2E Candidate Student");
          return route.fulfill({
            json: {
              items: [primary, person(second, "Second student")],
              selected: primary,
              hasMore: false,
            },
          });
        },
      );
    await context.route(
      "**/rest/v1/rpc/student_credit_coverage",
      async (route) => {
        const input = route.request().postDataJSON();
        const shared = role === "guardian";
        return route.fulfill({
          json: {
            studentId: input.p_student,
            evaluatedAt: new Date().toISOString(),
            previewEnable: Boolean(input.p_preview_enable),
            settingReasonCode: null,
            lessonsVisible: true,
            summary: {
              remaining: 5,
              available: 4,
              reserved: 1,
              expired: 0,
              version: 1,
              autoApply: false,
              needsReview: false,
            },
            packages: [
              {
                id: lotId,
                name: "Private lesson package",
                expiresAt: "2031-05-01T14:00:00Z",
                shared,
                available: 4,
                reserved: shared ? 2 : 1,
                used: 2,
                expired: 0,
                needsReview: false,
                lessons: [
                  {
                    id: ids.lesson,
                    topic:
                      input.p_student === second
                        ? "Second student coaching"
                        : "Private coaching",
                    startsAt: "2031-03-18T14:00:00Z",
                    status: "scheduled",
                    units: 1,
                  },
                ],
              },
            ],
            items: [],
            page: input.p_page,
            pageSize: input.p_page_size,
            total: 0,
            hasMore: false,
            counts: {
              covered: 0,
              eligible: 0,
              uncovered: 0,
              reviewRequired: 0,
            },
          },
        });
      },
    );
    await page.goto(
      role === "coach"
        ? `/coach/students/${ids.student}/payments`
        : "/portal/payments",
    );
    if (role === "coach")
      await page
        .getByRole("button", { name: "Manage credits", exact: true })
        .first()
        .click();
    const wallet = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Lesson credits", exact: true }),
      })
      .last();
    await expect(wallet).toBeVisible();
    if (role === "coach") {
      await wallet
        .getByRole("button", { name: "Manage credits", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Manage lesson credits",
      });
      await expect(
        dialog.getByRole("button", { name: "Review adjustment" }),
      ).toBeDisabled();
      await dialog
        .getByRole("combobox", { name: "Adjustment", exact: true })
        .selectOption("remove");
      await dialog.getByLabel("Number of credits").fill("1");
      await dialog
        .getByLabel("Reason", { exact: true })
        .fill("Synthetic correction");
      await dialog.getByRole("button", { name: "Review adjustment" }).click();
      await expect(
        dialog.getByText(/Unused Credits change from 5 to 4/),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath("coach.png"),
        animations: "disabled",
      });
      return;
    }
    await expect(
      wallet.getByText("Private lesson package", { exact: true }),
    ).toHaveCount(1);
    await expect(
      wallet.getByText(
        role === "guardian" ? "Shared package" : "Individual package",
        { exact: false },
      ),
    ).toBeVisible();
    await wallet
      .getByText("Eligibility and lesson use", { exact: true })
      .click();
    if (role === "guardian")
      await expect(wallet.getByText(/Second student coaching/)).toBeVisible();
    await expect(wallet.getByText(/Private coaching/)).toBeVisible();
    expect(
      await wallet.evaluate((item) => item.scrollWidth <= item.clientWidth + 1),
    ).toBe(true);
    await wallet.screenshot({
      path: info.outputPath(role + ".png"),
      animations: "disabled",
    });
  });
}
