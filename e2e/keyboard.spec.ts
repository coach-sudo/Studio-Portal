import { openAs } from "./support/auth";
import { expect, requireFixtures, test } from "./support/fixtures";

test("@journey Journey 13: booking, messaging, settings, payments, dialogs, and menus are keyboard operable", async ({
  browser,
  page,
  runtime,
}) => {
  requireFixtures(runtime);

  await page.goto(`/book/${runtime.runId}-free-introduction`);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY",
  );
  const chooseTime = page.getByRole("button", { name: "Choose a time" });
  await chooseTime.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Pick your first session" }),
  ).toBeVisible();

  const student = await openAs(browser, "student");
  for (const route of ["inbox", "settings", "payments"]) {
    await student.page.goto(`/portal/${route}`);
    await student.page.keyboard.press("Tab");
    expect(
      await student.page.evaluate(() => document.activeElement?.tagName),
    ).not.toBe("BODY");
  }
  await student.page.goto("/portal/work");
  const opener = student.page.getByRole("button", { name: "Submit material" });
  await opener.focus();
  await student.page.keyboard.press("Enter");
  const dialog = student.page.getByRole("dialog", { name: "Submit material" });
  await expect(dialog).toBeVisible();
  await student.page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  const more = student.page.getByRole("button", { name: "More" });
  if (await more.isVisible()) {
    await more.focus();
    await student.page.keyboard.press("Enter");
    await expect(
      student.page.getByRole("dialog", { name: "Student portal menu" }),
    ).toBeVisible();
    await student.page.keyboard.press("Escape");
  }
  await student.context.close();
});
