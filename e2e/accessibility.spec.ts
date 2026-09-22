import { openAs } from "./support/auth";
import { expectNoSeriousAxeViolations } from "./support/axe";
import { expect, requireFixtures, test } from "./support/fixtures";

test("@a11y @mobile login and public booking have no serious axe violations", async ({
  page,
  runtime,
}) => {
  await page.goto("/login");
  await expectNoSeriousAxeViolations(page);
  if (runtime.fixtureReady) {
    await page.goto(`/book/${runtime.runId}-free-introduction`);
  } else {
    await page.goto("/book");
  }
  await expectNoSeriousAxeViolations(page);
});

for (const [route, label] of [
  ["/portal", "student home"],
  ["/portal/inbox", "inbox"],
  ["/portal/work", "current work"],
  ["/portal/bookings", "schedule"],
  ["/portal/payments", "payments"],
  ["/portal/referrals", "referrals"],
  ["/portal/settings", "settings"],
  ["/portal/actor-page", "actor profile"],
] as const) {
  test(`@a11y ${label} has no serious axe violations`, async ({
    browser,
    runtime,
  }) => {
    requireFixtures(runtime);
    const { context, page } = await openAs(browser, "student");
    await page.goto(route);
    await expectNoSeriousAxeViolations(page);
    await context.close();
  });
}

test("@a11y guardian and coach representative workspaces have no serious axe violations", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const guardian = await openAs(browser, "guardian");
  await guardian.page.goto("/portal");
  await expectNoSeriousAxeViolations(guardian.page);
  await guardian.context.close();

  const coach = await openAs(browser, "coach");
  await coach.page.goto(`/coach/students/${runtime.ids?.student}/actor-page`);
  await expectNoSeriousAxeViolations(coach.page);
  await coach.page.goto(
    `/coach/students/${runtime.ids?.student}/lessons/${runtime.ids?.lessonPending}`,
  );
  await expectNoSeriousAxeViolations(coach.page);
  await coach.context.close();
});

test("@a11y focused dialog, form validation, pagination, and live-region patterns pass axe", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "student");
  await page.goto("/portal/work");
  await page.getByRole("button", { name: "Submit material" }).click();
  await expectNoSeriousAxeViolations(page, '[role="dialog"]');
  await page.keyboard.press("Escape");

  await page.goto("/portal/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator("form").first()).toBeVisible();
  await expectNoSeriousAxeViolations(page, "form");

  await page.goto("/portal/bookings");
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  const controls = page.locator('[aria-label$="display controls"]').first();
  if (await controls.isVisible()) {
    await expectNoSeriousAxeViolations(
      page,
      '[aria-label$="display controls"]',
    );
  }
  await context.close();
});
