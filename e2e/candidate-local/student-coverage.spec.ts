import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

for (const role of ["student", "guardian"] as const) {
  test(
    role + " sees lesson coverage and contextual renewal",
    async ({ page, context }, info) => {
      await installFixture(context, role);
      const now = new Date().toISOString();
      const shortage = "70000000-0000-4000-8000-000000000020";
      await context.route(
        "**/rest/v1/rpc/household_credit_access",
        async (route) => {
          expect(route.request().postDataJSON()).toMatchObject({
            p_action: "portal",
            p_value: { studentIds: [ids.student] },
          });
          await route.fulfill({
            json: [
              {
                id: "70000000-0000-4000-8000-000000000024",
                name: "Shared scene study",
                householdId: "70000000-0000-4000-8000-000000000025",
                householdName: "Candidate household",
                durationMinutes: 60,
                services: ["Scene study"],
                expiresAt: null,
                available: 2,
                unused: 3,
                reserved: 1,
                consumed: 1,
                members: [{ id: ids.student, name: "E2E Candidate Student" }],
                usage: [
                  {
                    studentId: ids.student,
                    studentName: "E2E Candidate Student",
                    lessonId: ids.lesson,
                    topic: "Shared reservation",
                    startsAt: "2027-01-20T18:00:00Z",
                    reserved: 1,
                    consumed: 0,
                  },
                ],
              },
            ],
          });
        },
      );
      await context.route(
        "**/rest/v1/rpc/student_credit_coverage",
        async (route) => {
          const input = route.request().postDataJSON();
          const lesson = {
            startsAt: "2027-01-20T18:00:00Z",
            endsAt: "2027-01-20T19:00:00Z",
            version: 1,
            durationMinutes: 60,
          };
          await route.fulfill({
            json: {
              studentId: ids.student,
              evaluatedAt: now,
              previewEnable: false,
              settingReasonCode: null,
              lessonsVisible: true,
              items: [
                {
                  ...lesson,
                  lessonId: ids.lesson,
                  topic: "Reserved scene study",
                  state: "covered",
                  reasonCode: "already_reserved",
                  packageId: "70000000-0000-4000-8000-000000000021",
                  eligible: false,
                  coverageStatus: "covered",
                },
                {
                  ...lesson,
                  lessonId: shortage,
                  topic: "Audition practice",
                  state: "ineligible",
                  reasonCode: "no_available_credits",
                  eligible: false,
                  coverageStatus: "needs_credit",
                },
              ],
              packages: [
                {
                  id: "70000000-0000-4000-8000-000000000021",
                  name: "Scene study package",
                  durationMinutes: 60,
                  services: ["Scene study"],
                  expiresAt: null,
                  unused: 1,
                  reserved: 1,
                  available: 0,
                  consumed: 1,
                  eligibilityVerified: true,
                },
              ],
              summary: {
                remaining: 1,
                reserved: 1,
                available: 0,
                expired: 0,
                version: 1,
                autoApply: true,
                needsReview: false,
              },
              counts: {
                covered: 1,
                eligible: 0,
                uncovered: 1,
                reviewRequired: 0,
              },
              page: input.p_page,
              pageSize: input.p_page_size,
              total: 2,
              hasMore: false,
            },
          });
        },
      );
      await context.route("**/api/v2/finance", async (route) => {
        if (route.request().postDataJSON().command !== "renewal_options")
          return route.fallback();
        await route.fulfill({
          json: {
            resource: {
              canPurchase: role === "guardian",
              options:
                role === "guardian"
                  ? [
                      {
                        id: "70000000-0000-4000-8000-000000000022",
                        name: "Audition renewal",
                        credits: 1,
                        durationMinutes: 60,
                        expirationDays: 30,
                        priceMinor: 9000,
                        currency: "USD",
                      },
                    ]
                  : [],
            },
          },
        });
      });
      await context.route("**/rest/v1/payment_entries?*", async (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (params.get("select") !== "id,created_at,amount_minor,currency")
          return route.fallback();
        expect(params.get("student_id")).toBe("eq." + ids.student);
        expect(params.get("kind")).toBe("eq.payment");
        await route.fulfill({
          json: [
            {
              id: "70000000-0000-4000-8000-000000000023",
              created_at: now,
              amount_minor: 20000,
              currency: "USD",
            },
          ],
        });
      });
      await page.goto("/portal?student=" + ids.student);
      const shared = page.getByRole("region", {
        name: "Shared household credits",
      });
      await expect(shared).toHaveCount(1);
      await shared
        .getByText("Shared scene study · 2 shared credits available")
        .click();
      await expect(shared.getByText(/Shared reservation/)).toBeVisible();
      if (role === "guardian") {
        const household = page.getByRole("region", {
          name: "Household Lesson Coverage",
        });
        await household
          .getByText("E2E Candidate Student", { exact: true })
          .click();
        await expect(
          household.getByText("Needs Credit", { exact: true }),
        ).toBeVisible();
        await household
          .getByText("Recent package purchases", { exact: true })
          .click();
        await expect(household.getByText(/\$200\.00/)).toBeVisible();
      } else {
        await expect(
          page
            .getByRole("region", { name: "Lesson Credits" })
            .getByText("Needs Credit", { exact: true }),
        ).toBeVisible();
      }
      await page.screenshot({
        path: info.outputPath("coverage-home.png"),
        fullPage: true,
      });
      await page.getByRole("link", { name: "Renew for this lesson" }).click();
      await expect(
        page.getByRole("heading", { name: "Credits & Lessons" }),
      ).toBeVisible();
      await expect(
        page.getByText("An eligible credit is reserved for this lesson."),
      ).toBeVisible();
      await expect(
        page.getByText(
          "The lesson is still scheduled and needs an eligible credit.",
        ),
      ).toBeVisible();
      if (role === "guardian") {
        await expect(
          page.getByText("Audition renewal", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Continue to checkout" }),
        ).toBeVisible();
      } else {
        await expect(
          page.getByText(
            "The designated billing contact can handle this renewal.",
          ),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Continue to checkout" }),
        ).toHaveCount(0);
      }
      expect(
        await page
          .locator("main")
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("coverage-renewal.png"),
        fullPage: true,
      });
      await page.goto(
        "/portal/credits?student=" +
          ids.student +
          "&lesson=" +
          shortage +
          "&checkout=processing",
      );
      await expect(page.getByText(/Checkout has returned/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Continue to checkout" }),
      ).toHaveCount(0);
    },
  );
}
