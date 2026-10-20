import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function layout(page: Page, scope?: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  // The email preview deliberately has an opaque, script-disabled sandbox.
  // Audit its containing UI here; shared email markup is checked separately.
  let audit = new AxeBuilder({ page })
    .setLegacyMode(true)
    .options({ iframes: false });
  if (scope) audit = audit.include(scope);
  const a = await audit.analyze();
  expect(
    a.violations
      .filter((v) => ["serious", "critical"].includes(v.impact || ""))
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        "*,*::before,*::after{transition-duration:0s!important;animation-duration:0s!important}";
      document.head.append(style);
    });
  });
  await context.route("**/*", (r) =>
    new URL(r.request().url()).origin === "http://127.0.0.1:4178"
      ? r.continue()
      : r.abort(),
  );
  await context.routeWebSocket("**/*", (s) => s.close());
});
for (const width of [320, 390, 768, 1440])
  test(`Wave 5 authoring and contrast at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/coach/students");
    await page
      .getByRole("button", { name: "Add student", exact: true })
      .click();
    await page.getByRole("button", { name: /Quick Add/ }).click();
    const add = page.getByRole("dialog", { name: "Add student", exact: true });
    await add
      .getByRole("textbox", { name: "Full name", exact: true })
      .fill("Wave Five Local Learner");
    expect(
      await add
        .getByRole("textbox", { name: "Student email (optional)", exact: true })
        .getAttribute("required"),
    ).toBeNull();
    await layout(page);
    await add.getByRole("button", { name: "Add student", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Wave Five Local Learner",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto("/coach/campaigns");
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Local studio update");
    await page
      .getByRole("textbox", { name: "Subject", exact: true })
      .fill("Lesson plans");
    await page.getByRole("button", { name: "3. Preview", exact: true }).click();
    await expect(page.locator("iframe")).toBeVisible();
    await layout(page);
    await page.screenshot({
      path: info.outputPath(`campaign-${width}.png`),
      fullPage: true,
    });
    page.once("dialog", (d) => d.accept());
    await page.goto("/coach/students/student-maya/actor-page");
    await page.getByRole("button", { name: "Build page", exact: true }).click();
    const builder = page.getByRole("dialog", {
      name: "Build actor page",
      exact: true,
    });
    await builder
      .getByRole("combobox", { name: "Layout", exact: true })
      .selectOption("spotlight");
    await builder
      .getByRole("button", { name: "Move media up", exact: true })
      .click();
    await builder
      .getByRole("button", { name: "Mobile preview", exact: true })
      .click();
    expect(
      await builder
        .locator(".actor-builder-viewport")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await layout(page, '[role="dialog"]');
    await page.screenshot({
      path: info.outputPath(`actor-light-${width}.png`),
      fullPage: true,
    });
    await page.evaluate(
      () => (document.documentElement.dataset.portalTheme = "dark"),
    );
    await layout(page, '[role="dialog"]');
    await page.screenshot({
      path: info.outputPath(`actor-dark-${width}.png`),
      fullPage: true,
    });
  });
test("Settings canonical categories persist a save, cancel and refresh", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.goto("/coach/settings?panel=studio");
  await expect(page).toHaveURL(/panel=profile/);
  const name = page.getByRole("textbox", { name: "Studio name", exact: true });
  await name.fill("Wave Five Settings");
  await page.getByRole("button", { name: "Save studio", exact: true }).click();
  await page.reload();
  await expect(name).toHaveValue("Wave Five Settings");
  await name.fill("Unsaved change");
  await page
    .getByRole("button", { name: "Cancel changes", exact: true })
    .click();
  await expect(name).toHaveValue("Wave Five Settings");
  for (const panel of [
    "pricing",
    "booking",
    "communications",
    "integrations",
    "access",
    "data",
  ]) {
    await page.goto("/coach/settings?panel=" + panel);
    await expect(page.locator("main h1")).toBeVisible();
    await layout(page);
  }
});
