import {
  expect,
  expectNoHorizontalOverflow,
  requireFixtures,
  test,
} from "./support/fixtures";

test("@journey Journey 03: desktop booking distinguishes free and varying paid pricing and exposes unavailable dates", async ({
  page,
  runtime,
}) => {
  requireFixtures(runtime);
  await page.goto(`/book/${runtime.runId}-free-introduction`);
  await expect(
    page.getByRole("heading", { name: `${runtime.runId} Free introduction` }),
  ).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose a time" }).click();
  await expect(
    page.getByRole("heading", { name: "Pick your first session" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /unavailable/i }).first(),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: /Continue/i })).toBeDisabled();

  await page.goto(`/book/${runtime.runId}-paid-coaching`);
  await expect(page.getByText("$75.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /In person/i }).click();
  await expect(
    page.getByText(/includes \$15\.00 in-person upcharge/i),
  ).toBeVisible();
});

test("@journey @mobile @mobile-only Journey 04: mobile booking reflows and keeps validation/actions reachable", async ({
  page,
  runtime,
}) => {
  requireFixtures(runtime);
  await page.goto(`/book/${runtime.runId}-free-introduction`);
  await expect(
    page.getByRole("button", { name: "Choose a time" }),
  ).toBeInViewport();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Choose a time" }).click();
  await expect(page.getByRole("button", { name: /Continue/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue/i })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});
