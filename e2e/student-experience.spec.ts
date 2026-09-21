import { openAs } from "./support/auth";
import { expect, requireFixtures, test } from "./support/fixtures";

test("@journey Journey 02: home and schedule present deterministic lesson delivery states", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "student");
  await page.goto("/portal");
  await expect(
    page.getByRole("heading", { name: /Welcome back/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Join lesson" })).toBeVisible();
  await page.goto("/portal/bookings");
  const availableLesson = page.locator("article", {
    hasText: `${runtime.runId} Meet available`,
  });
  await expect(
    availableLesson.getByRole("link", { name: "Join" }),
  ).toBeVisible();
  for (const lessonTitle of [
    `${runtime.runId} No meeting link`,
    `${runtime.runId} Meet pending`,
  ]) {
    await expect(
      page
        .locator("article", { hasText: lessonTitle })
        .getByRole("button", { name: "Meet pending" }),
    ).toBeVisible();
  }
  await expect(
    page.getByText(`${runtime.runId} Cancelled lesson`),
  ).toBeVisible();
  await context.close();
});

test("@journey Journey 05: inbox shows coach identity and supports a safe reply", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "student");
  await page.goto("/portal/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await page.getByRole("button", { name: /E2E Coach conversation/ }).click();
  await expect(
    page.getByText("E2E Coach", { exact: true }).first(),
  ).toBeVisible();
  const reply = `${runtime.runId} reply`;
  await page.getByLabel("Message").fill(reply);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(reply)).toBeVisible();
  await context.close();
});

test("@journey Journey 06: current work exposes allowed assignment/material only", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "student");
  await page.goto("/portal/work");
  await expect(page.getByText(`${runtime.runId} Current work`)).toBeVisible();
  await expect(
    page.getByText(`${runtime.runId} Fixture material`),
  ).toBeVisible();
  await expect(
    page.getByText(`${runtime.runId} Unrelated`, { exact: false }),
  ).toHaveCount(0);
  await context.close();
});

test("@journey Journey 07: student uploads and removes a namespaced safe fixture file", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "student");
  await page.goto("/portal/work");
  await page.getByRole("button", { name: "Submit material" }).click();
  await page.getByLabel("Title").fill(`${runtime.runId} uploaded material`);
  await page.getByLabel("Upload file").setInputFiles({
    name: `${runtime.runId}-safe.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Deterministic Coach'D E2E fixture. No private student data.",
    ),
  });
  await page.getByRole("button", { name: "Set as current script" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Current script updated",
  );
  // Global teardown verifies the uploaded object and row are removed without
  // relying on the current page's already-loaded pagination snapshot.
  await context.close();
});

test("@journey Journey 10: referral link copy and pending/earned/redeemed states render", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "student");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/portal/referrals");
  await expect(page.getByLabel("Your referral link")).toHaveValue(
    /\/book\?ref=/,
  );
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(page.getByText("Awaiting a paid booking")).toBeVisible();
  await expect(page.getByText("used")).toBeVisible();
  await expect(page.getByText(/E2E-EARNED-/)).toBeVisible();
  await context.close();
});
