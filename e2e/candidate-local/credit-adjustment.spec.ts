import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

test("coach reviews a credit adjustment without submitting it", async ({
  page,
  context,
}, info) => {
  const state = await installFixture(context, "coach");
  await page.goto("/coach/students/" + ids.student + "/payments");
  const manage = page.getByRole("button", {
    name: "Manage credits",
    exact: true,
  });
  await expect(manage).toBeVisible();
  await manage.click();
  const dialog = page.getByRole("dialog", { name: "Manage lesson credits" });
  await dialog.getByLabel("Adjustment").selectOption("remove");
  await dialog.getByRole("spinbutton").fill("1");
  await expect(
    dialog.getByRole("button", { name: "Review adjustment" }),
  ).toBeDisabled();
  await dialog.getByLabel("Adjustment").selectOption("add");
  await dialog.getByRole("spinbutton").fill("2");
  await expect(
    dialog.getByRole("button", { name: "Review adjustment" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Reason")
    .fill("Correct a synthetic training account");
  await dialog.getByRole("button", { name: "Review adjustment" }).click();
  await expect(
    dialog.getByText("Unused Credits change from 0 to 2."),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirm credit adjustment" }),
  ).toBeVisible();
  expect(state.commands).not.toContain("set_total");
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("credit-adjustment-preview.png"),
  });
  await dialog.getByRole("button", { name: "Back to edit" }).click();
  await expect(dialog.getByRole("spinbutton")).toHaveValue("2");
  await page.keyboard.press("Escape");
  await expect(manage).toBeFocused();
});
