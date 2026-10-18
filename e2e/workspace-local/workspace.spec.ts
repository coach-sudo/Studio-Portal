import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== baseURL) return route.abort("blockedbyclient");
    return route.continue();
  });
});

async function auditPage(page: Page, name: string) {
  const result = await new AxeBuilder({ page }).analyze();
  await test.info().attach(name, {
    body: JSON.stringify(
      result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        targets: v.nodes.map((n) => n.target),
      })),
    ),
    contentType: "application/json",
  });
  expect(
    result.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact || ""),
    ),
  ).toEqual([]);
}

async function openSearch(page: Page) {
  const opener = page.locator(".shell-search");
  await opener.waitFor({ state: "attached" });
  if (await opener.isVisible()) await opener.click();
  else {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Search", exact: true })
      .click();
  }
  return page.getByRole("combobox", {
    name: "Search records and destinations",
  });
}

test("coach search, exact lesson, return, refresh and URL filters", async ({
  page,
}) => {
  await page.goto("/coach/students?q=Maya&status=active&sort=name");
  const input = await openSearch(page);
  await input.fill("Maya");
  await expect(
    page.getByRole("option", { name: "Students: Maya Kim" }),
  ).toBeVisible();
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Maya Kim", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Lessons", exact: true }).click();
  await page.locator('a[href*="lessons/lesson-maya"]').first().click();
  await expect(page).toHaveURL(/lessons\/lesson-maya/);
  await page.getByRole("button", { name: /Back/ }).last().click();
  await page.getByRole("button", { name: "Back to students" }).click();
  await expect(page).toHaveURL(/students\?q=Maya&status=active&sort=name/);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Search students" }),
  ).toHaveValue("Maya");
});

test("Today action and browser history preserve the origin", async ({
  page,
}) => {
  await page.goto("/coach?view=day");
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const plan = page
    .getByRole("checkbox", { name: "Plan", exact: true })
    .first();
  await plan.check();
  await expect(plan).toBeChecked();
  await page
    .getByRole("button", { name: "Open lesson", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/lessons\//);
  await page.getByRole("button", { name: "Back to students" }).click();
  await expect(page).toHaveURL(/\/coach\/today\?view=day/);
  await expect(
    page.getByRole("checkbox", { name: "Plan", exact: true }).first(),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Open lesson", exact: true })
    .first()
    .click();
  await page.goBack();
  await expect(page).toHaveURL(/\/coach\/today\?view=day/);
  await page.goForward();
  await expect(page).toHaveURL(/\/lessons\//);
});

test("student linked resource and lesson retain return context", async ({
  page,
}) => {
  await page.goto("/portal/work?student=student-maya");
  await expect(
    page.getByRole("heading", { name: "My Work", exact: true }),
  ).toBeVisible();
  await auditPage(page, "student-work-a11y");
  await page
    .getByRole("button", { name: "Details", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/records\/resource\//);
  const related = page.getByRole("button", { name: "Open related lesson" });
  if (await related.count()) {
    await related.click();
    await expect(page).toHaveURL(/\/portal\/lessons\//);
    await page.getByRole("button", { name: "‹ Back" }).click();
    await expect(page).toHaveURL(/\/records\/resource\//);
  }
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/work\?student=student-maya/);
});

test("guardian authorized context survives refresh and history; forged context denies", async ({
  page,
  baseURL,
}) => {
  const html = await (
    await page.request.get(`${baseURL}/e2e/workspace-preview.html`)
  ).text();
  await page.route("**/portal**", (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({ status: 200, contentType: "text/html", body: html })
      : route.continue(),
  );
  await page.goto("/portal?student=student-sarah");
  await auditPage(page, "guardian-a11y");
  const selector = page.getByRole("combobox", { name: "Student", exact: true });
  await selector.selectOption("student-maya");
  await expect(page).toHaveURL(/student=student-maya/);
  await page.reload();
  await expect(selector).toHaveValue("student-maya");
  await page.goBack();
  await expect(selector).toHaveValue("student-sarah");
  await page.goForward();
  await expect(selector).toHaveValue("student-maya");
  await expect(
    page.getByRole("region", { name: "Household context" }),
  ).toBeVisible();
  await page.goto("/portal?student=unrelated");
  await expect(
    page.getByRole("heading", { name: "Record unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Household context" }),
  ).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440]) {
  test(`navigation, keyboard and accessibility at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/coach/today");
    await expect(
      page.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible();
    await auditPage(page, "today-a11y");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width <= 900) {
      await page.getByRole("button", { name: "More", exact: true }).click();
      const menu = page.getByRole("dialog", { name: "More", exact: true });
      await expect(
        menu.getByRole("link", { name: "Library", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
    }
    const input = await openSearch(page);
    await input.fill("Maya");
    await expect(
      page.getByRole("option", { name: "Students: Maya Kim" }),
    ).toBeVisible();
    const audit = await new AxeBuilder({ page }).analyze();
    expect(
      audit.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact || ""),
      ),
    ).toEqual([]);
    await input.press("ArrowDown");
    await input.press("ArrowUp");
    await input.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Maya Kim", exact: true }),
    ).toBeVisible();
  });
}

test("dirty note remains open when navigation is declined", async ({
  page,
}) => {
  await page.goto("/coach/today");
  await page
    .getByRole("button", { name: "Open lesson", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Write note", exact: true })
    .first()
    .click();
  const editor = page.getByRole("textbox", { name: "Note", exact: true });
  await editor.fill("Unsaved local rehearsal note");
  const before = page.url();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(before);
  await expect(editor).toHaveText("Unsaved local rehearsal note");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
});
