import { test, expect } from "@playwright/test";

test("search autofocus, trap and opener restoration survive repeated visits", async ({
  page,
  context,
}) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:4186"
      ? route.continue()
      : route.abort(),
  );
  await context.routeWebSocket("**/*", (socket) => socket.close());
  await page.goto("/coach");
  const trigger = page.getByRole("button", {
    name: "Search records and destinations",
    exact: true,
  });
  for (let visit = 0; visit < 2; visit++) {
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Search", exact: true });
    await expect(
      dialog.getByRole("combobox", {
        name: "Search records and destinations",
        exact: true,
      }),
    ).toBeFocused();
    for (let tab = 0; tab < 16; tab++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test("320 px student header gives long names a readable column", async ({
  page,
  context,
}, info) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:4186"
      ? route.continue()
      : route.abort(),
  );
  await context.routeWebSocket("**/*", (socket) => socket.close());
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/coach/students/student-maya/household");
  const title = page.locator(".student-record-identity h1");
  await expect(title).toBeVisible();
  // Presentation-only long-name fixture; no application command or database write.
  await title.evaluate((el) => {
    el.textContent = "E2E Staging Student";
  });
  const box = await title.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(140);
  const status = await page
    .locator(".student-record-identity > .status")
    .boundingBox();
  expect(status!.y).toBeGreaterThanOrEqual(box!.y + box!.height);
  await page.screenshot({
    path: `${process.env.HOSTED_ACCEPTANCE_DIRECTORY}/header-fixed-${info.project.name}.png`,
    fullPage: true,
  });
});
