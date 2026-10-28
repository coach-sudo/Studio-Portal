import { test, expect } from "@playwright/test";
import { ids } from "../candidate-local/fixture";
import { identityFixture, duplicateId } from "./fixture";
for (const width of [320, 390, 768, 1440])
  test(`parent physical merge review at ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await identityFixture(context);
    await page.goto("/coach/students");
    await page
      .getByRole("button", { name: "Merge duplicates", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Merge duplicate students",
      exact: true,
    });
    await dialog
      .getByRole("combobox", { name: "Record to keep", exact: true })
      .selectOption(ids.student);
    await dialog
      .getByRole("combobox", { name: "Duplicate to merge", exact: true })
      .selectOption(duplicateId);
    await expect(dialog.getByText(/will be removed/)).toBeVisible();
    await page.screenshot({
      path: `docs/audit-identity/evidence/${info.project.name}-before-merge-${width}.png`,
      fullPage: true,
    });
  });
