import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

test("coach reviews a bulk credit adjustment before confirming", async ({
  page,
  context,
}, info) => {
  const state = await installFixture(context, "coach");
  const packageId = "70000000-0000-4000-8000-000000000031";
  state.packages.push({
    id: packageId,
    student_id: ids.student,
    name: "Synthetic coaching package",
    currency: "USD",
    price_minor: 10000,
    credit_quantity: 4,
    auto_apply: false,
    version: 1,
    created_at: "2026-11-15T00:00:00Z",
  });
  let confirmation: unknown;
  await context.route("**/api/v2/credits", async (route) => {
    const input = route.request().postDataJSON();
    const row = {
      studentId: ids.student,
      packageId,
      version: 1,
      delta: 2,
      before: {
        name: "Synthetic coaching package",
        services: ["Coaching"],
        durationMinutes: 60,
        unused: 4,
        reserved: 1,
        available: 3,
      },
      afterUnused: 6,
      conflict: null,
      reservations: [],
    };
    if (input.command === "bulk_package_preview")
      return route.fulfill({
        json: { resource: { status: "preview", canApply: true, rows: [row] } },
      });
    if (input.command === "bulk_package_apply") {
      confirmation = input.payload;
      return route.fulfill({
        json: { resource: { status: "completed", rows: [row], receipts: [] } },
      });
    }
    return route.fallback();
  });
  await page.goto("/coach/finance");
  await page.getByRole("button", { name: "Bulk credit adjustments" }).click();
  const dialog = page.getByRole("dialog", { name: "Bulk credit adjustments" });
  await dialog.getByLabel("Add a package").selectOption(packageId);
  await dialog.getByLabel("Credits to add or remove").fill("2");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic bulk adjustment");
  await dialog.getByLabel("Show adjustments in portal history").uncheck();
  await dialog.getByRole("button", { name: "Review adjustments" }).click();
  await expect(
    dialog.getByText("4 unused · 1 reserved · 3 available"),
  ).toBeVisible();
  await expect(
    dialog.getByText("+2 credits · 6 unused after adjustment"),
  ).toBeVisible();
  expect(confirmation).toBeUndefined();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("bulk-preview.png") });
  await dialog.getByRole("button", { name: "Confirm all adjustments" }).click();
  await expect(
    page.getByText("All selected package adjustments were recorded."),
  ).toBeVisible();
  expect(confirmation).toMatchObject({
    portalVisible: false,
    preview: [{ packageId, afterUnused: 6 }],
  });
});
