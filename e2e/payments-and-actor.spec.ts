import { openAs } from "./support/auth";
import { expectNoSeriousAxeViolations } from "./support/axe";
import {
  expect,
  requireCapability,
  requireFixtures,
  test,
} from "./support/fixtures";

test("@journey Journey 08: package and payment context is usable without a provider", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "student");
  await page.goto("/portal/payments");
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(
    page.getByText(`${runtime.runId} Four-session package`).first(),
  ).toBeVisible();
  await expect(
    page.getByText(`${runtime.runId} fixture payment`),
  ).toBeVisible();
  await expect(
    page.getByText("Includes a coach-authored E2E package benefit."),
  ).toBeVisible();
  await context.close();
});

test("@journey Journey 08: Stripe test checkout hands off only to test-mode infrastructure", async ({
  browser,
  runtime,
}) => {
  requireCapability(
    runtime,
    "stripeTest",
    "staging STRIPE_SECRET_KEY is absent or is not a Stripe test-mode key",
  );
  const { context, page } = await openAs(browser, "student");
  await page.goto("/portal/payments");
  const packageRow = page
    .locator("article", { hasText: `${runtime.runId} Four-session package` })
    .first();
  await packageRow.getByRole("button", { name: "Choose package" }).click();
  await Promise.all([
    page.waitForURL(/https:\/\/checkout\.stripe\.com\//, { timeout: 30_000 }),
    page.getByRole("button", { name: "Continue to secure checkout" }).click(),
  ]);
  expect(page.url()).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  await context.close();
});

test("@journey @a11y Journey 09: student submits an actor edit, coach publishes it, and public page reflects it", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const updatedName = `E2E Actor ${runtime.runId.slice(-6)}`;
  const student = await openAs(browser, "student");
  await student.page.goto("/portal/actor-page");
  await student.page.getByRole("button", { name: "Edit" }).click();
  await student.page.getByLabel("Display name").fill(updatedName);
  await student.page.getByLabel("Submit for coach review").check();
  await student.page.getByRole("button", { name: "Save" }).click();
  await expect(student.page.getByRole("status")).toContainText(
    "submitted for coach review",
  );
  await student.context.close();

  const coach = await openAs(browser, "coach");
  await coach.page.goto("/coach/actor-pages");
  const profileRow = coach.page.locator("article", { hasText: updatedName });
  await expect(profileRow).toContainText("review requested");
  await profileRow.getByRole("button", { name: "Publish" }).click();
  await expect(
    coach.page.getByText("Actor page marked published"),
  ).toBeVisible();
  await coach.page.goto(`/actors/${runtime.actorSlug}`);
  await expect(
    coach.page.getByRole("heading", { name: updatedName }),
  ).toBeVisible();
  await expect(
    coach.page.getByRole("link", { name: "Book coaching" }),
  ).toBeVisible();
  await expect(coach.page.locator(".actor-public-hero-sparse")).toHaveCSS(
    "min-height",
    "340px",
  );
  await expect(coach.page.getByText(/being prepared/i)).toHaveCount(0);
  await expectNoSeriousAxeViolations(coach.page);
  await coach.context.close();
});
