import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ids, installFixture } from "../candidate-local/fixture";

for (const role of ["coach", "student", "guardian"] as const) {
  test(`${role}: zoom reflow, short mobile sheet, keyboard and lazy viewer`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context, role);
    if (role !== "coach")
      await context.route("**/rest/v1/rpc/portal_student_contexts", (route) => {
        const student = {
          id: "70000000-0000-4000-8000-000000000002",
          fullName: "E2E Candidate Student",
          isMinor: false,
          canViewSchedule: true,
          canViewWork: true,
          canViewFinance: true,
          canManageProfile: true,
          canManageLessons: true,
        };
        return route.fulfill({
          json: { items: [student], selected: student, hasMore: false },
        });
      });
    const errors: string[] = [],
      pdf: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/pdf-renderer|pdf\.worker/.test(request.url()))
        pdf.push(request.url());
    });
    for (const width of [320, 390, 768, 1440, 720]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
      await page.goto(
        role === "coach" ? "/coach/settings?panel=profile" : "/portal/settings",
      );
      await expect(
        page.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth + 1,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(
          `${role}-${width}${width === 720 ? "-200pct-reflow" : ""}.png`,
        ),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 320, height: 568 });
    const more = page
      .locator(".mobile-nav")
      .getByRole("button", { name: "More", exact: true });
    await more.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const logout = dialog.getByRole("button", { name: "Log out", exact: true });
    await logout.scrollIntoViewIfNeeded();
    await expect(logout).toBeInViewport();
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let index = 0; index < 16; index++) {
        await page.keyboard.press(key);
        expect(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true);
      }
    }
    const axe = await new AxeBuilder({ page }).analyze();
    expect(
      axe.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact || ""),
      ),
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`${role}-short-mobile-more.png`),
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();
    expect(pdf).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("provider change review requires the exact occurrence and keeps retries stable", async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, "coach");
  fixture.imports = [
    {
      id: "e6600000-0000-4000-8000-000000000008",
      studio_id: ids.studio,
      provider: "gmail",
      external_id: "local-synthetic-mail",
      detected_source: "superprof",
      student_id: ids.student,
      status: "needs_review",
      confidence: 0.9,
      payload: {
        headers: { subject: "Superprof lesson rescheduled" },
        changeType: "reschedule",
        candidate: {
          startsAt: "2031-11-02T20:00:00Z",
          endsAt: "2031-11-02T21:00:00Z",
        },
      },
      updated_at: "2026-10-21T14:00:00Z",
    },
  ];
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/coach/today");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Verify imported lesson",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const occurrence = dialog.getByRole("combobox", {
    name: /Existing lesson to reschedule/,
  });
  await occurrence.selectOption(ids.lesson);
  await expect(
    dialog.getByRole("switch", { name: /Create an interested student/ }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("provider-review-320.png"),
    fullPage: true,
  });
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact || ""),
    ),
  ).toEqual([]);
  const confirm = dialog.getByRole("button", { name: /Confirm student/ });
  await confirm.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await confirm.click();
  await expect.poll(() => fixture.keys.length).toBe(2);
  expect(fixture.keys[0]).toBe(fixture.keys[1]);
  expect(fixture.commands).toEqual(["review_import", "review_import"]);
});
