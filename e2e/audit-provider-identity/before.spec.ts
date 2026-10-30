import { test, expect } from "@playwright/test";
import { providerIdentityFixture, selectedId } from "./fixture";
for (const width of [320, 390, 768, 1440])
  test(`parent provider merge promise at ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await providerIdentityFixture(context);
    await page.goto("/coach/today");
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "Verify imported lesson",
      exact: true,
    });
    await dialog
      .getByRole("combobox", { name: "Student", exact: true })
      .selectOption(selectedId);
    await expect(dialog.getByRole("checkbox")).toBeVisible();
    await expect(
      dialog.getByText(/portal access move to the selected student/),
    ).toBeVisible();
    await dialog.screenshot({
      path: `docs/audit-provider-identity/evidence/${info.project.name}-${width}-before.png`,
    });
  });
