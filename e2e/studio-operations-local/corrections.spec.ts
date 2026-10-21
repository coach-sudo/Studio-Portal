import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Touch desktop-mode viewport keeps one fixed navigation", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 980, height: 900 },
    screen: { width: 390, height: 900 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await context.route("**/*", (r) =>
      new URL(r.request().url()).origin === "http://127.0.0.1:4178"
        ? r.continue()
        : r.abort(),
    );
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4178/coach/today");
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".mobile-nav")).toBeVisible();
    expect(
      await page
        .locator(".mobile-nav")
        .evaluate((el) => getComputedStyle(el).position),
    ).toBe("fixed");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

for (const width of [320, 390, 768, 1440])
  test(`Corrective rendered pages at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (r) =>
      new URL(r.request().url()).origin === "http://127.0.0.1:4178"
        ? r.continue()
        : r.abort(),
    );
    await page.goto("/coach/settings?panel=profile");
    await page
      .getByLabel("Studio name", { exact: true })
      .fill("Corrective Studio");
    await page
      .getByRole("button", { name: "Save studio", exact: true })
      .click();
    await expect(
      page.getByText("Studio identity and contact details saved."),
    ).toBeVisible();
    await page.evaluate(() => {
      const key = "stage-story-studio-core-v2",
        data = JSON.parse(localStorage.getItem(key)!);
      data.lessons.slice(0, 3).forEach((l: any, i: number) => {
        l.status = "completed";
        l.startsAt = new Date(Date.now() - (3 + i) * 86400000).toISOString();
        l.endsAt = new Date(
          Date.now() - (3 + i) * 86400000 + 3600000,
        ).toISOString();
        l.topic = "Private coaching and a longer scene preparation lesson";
      });
      data.notes = [];
      localStorage.setItem(key, JSON.stringify(data));
    });
    for (const [label, route] of [
      ["today", "/coach/today"],
      ["calendar", "/coach/bookings"],
      ["students", "/coach/students"],
      ["inbox", "/coach/inbox?student=student-maya"],
      ["library", "/coach/materials"],
      ["studio", "/coach/studio"],
      ["finance", "/coach/finance"],
      ["actors", "/coach/actor-pages"],
      ["campaigns", "/coach/campaigns"],
      ["referrals", "/coach/referrals"],
      ["settings", "/coach/settings?panel=profile"],
      ["student-home", "/portal?student=student-maya"],
      ["student-work", "/portal/work?student=student-maya"],
      ["student-settings", "/portal/settings?student=student-maya"],
    ]) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      await expect
        .poll(() => page.locator("main").innerText())
        .not.toMatch(/^Opening|^Loading/);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${label} overflow`,
      ).toBe(true);
      if (
        ["today", "inbox", "settings", "calendar", "campaigns"].includes(label)
      ) {
        const results = await new AxeBuilder({ page })
          .setLegacyMode(true)
          .options({ iframes: false })
          .analyze();
        expect(
          results.violations
            .filter((v) => ["serious", "critical"].includes(v.impact || ""))
            .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
          label,
        ).toEqual([]);
        await page.screenshot({
          path: info.outputPath(`${label}-${width}.png`),
          fullPage: true,
        });
      }
      if (label === "today") {
        const row = page.locator(".note-followup-row").first();
        await expect(row).toBeVisible();
        if (width <= 600)
          expect(
            await row
              .locator("strong")
              .evaluate((el) => el.getBoundingClientRect().width),
          ).toBeGreaterThan(width - 140);
      }
      if (label === "settings" && width <= 900) {
        const selector = page.getByRole("combobox", {
          name: "Settings section",
        });
        await expect(selector).toBeVisible();
        await selector.selectOption("pricing");
        await expect(page).toHaveURL(/panel=pricing/);
        await expect(
          page.getByRole("heading", { name: "Rates & reminders" }),
        ).toBeVisible();
        await page.goBack();
        await expect(selector).toHaveValue("profile");
      }
    }
    if (width <= 768) {
      await page.goto("/coach/today");
      await page.getByRole("button", { name: "More", exact: true }).click();
      const menu = page.getByRole("dialog", { name: "More", exact: true });
      await expect(menu.getByRole("link")).toHaveCount(10);
      expect(
        await menu
          .locator("a")
          .first()
          .evaluate((el) => getComputedStyle(el).textDecorationLine),
      ).toBe("none");
      await page.screenshot({
        path: info.outputPath(`more-${width}.png`),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    }
  });
