import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ids, installFixture, type FixtureRole } from "./fixture";

test.use({ hasTouch: true });

for (const role of ["student", "guardian"] satisfies FixtureRole[]) {
  test(`${role} reviews exact automatic payment terms before opening secure setup`, async ({
    page,
    context,
  }, info) => {
    await installFixture(context, role);
    const commands: { command: string; payload: Record<string, unknown> }[] =
      [];
    const date = "2031-03-18";
    await context.route("**/api/v2/invoices", async (route) => {
      const body = route.request().postDataJSON();
      if (!body) return route.fallback();
      commands.push(body);
      const action = body.command;
      if (action === "training_autopay_options") {
        return route.fulfill({
          json: {
            resource: {
              currency: "USD",
              hasMore: false,
              lessons: [{ id: ids.lesson, date, amountMinor: 8500 }],
              policy: {
                timeZone: "America/New_York",
                chargeAtLocal: "09:00",
                minimumLeadDays: 0,
                maximumLeadDays: 7,
                maximumLessonMinor: 9000,
              },
            },
          },
        });
      }
      if (action === "training_autopay_list")
        return route.fulfill({
          json: {
            resource: {
              arrangement: null,
              pending: null,
              canSetUp: true,
              payerEmail: `${role}@example.test`,
            },
          },
        });
      if (action === "training_autopay_review") {
        return route.fulfill({
          json: {
            resource: {
              reviewDigest: "a".repeat(64),
              preview: [
                {
                  lessonId: ids.lesson,
                  date,
                  state: "scheduled",
                  amountMinor: 8500,
                  currency: "USD",
                  payAt: "2031-03-16T13:00:00Z",
                },
              ],
            },
          },
        });
      }
      if (action === "training_autopay_authorize")
        return route.fulfill({
          json: { resource: { url: "/local-secure-setup-fixture" } },
        });
      await route.fallback();
    });
    await context.route("**/local-secure-setup-fixture", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html lang='en'><title>Local secure setup fixture</title><h1>Secure setup fixture</h1></html>",
      }),
    );

    await page.goto(
      `/portal/payments?recurring=arrangements&student=${ids.student}`,
    );
    await expect(
      page.getByRole("heading", { name: "Automatic payments by lesson" }),
    ).toBeVisible();
    const dates = page.getByRole("group", {
      name: "Lessons to include",
      exact: true,
    });
    await dates.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    await page
      .getByRole("spinbutton", { name: "Days before each lesson" })
      .fill("2");
    await page.getByRole("button", { name: "Preview payment dates" }).click();
    const authorize = page.getByRole("button", {
      name: "Continue to Stripe payment setup",
    });
    const consent = page.getByRole("checkbox", {
      name: /I authorize these automatic lesson payments/,
    });
    await expect(authorize).toBeDisabled();
    await expect(
      page.getByText("Proposed payment dates", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/\$85\.00 on/)).toBeVisible();
    expect(
      commands.some(
        (command) => command.command === "training_autopay_authorize",
      ),
    ).toBe(false);

    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.portalTheme = value;
      }, theme);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(page.viewportSize()!.width);
      const audit = await new AxeBuilder({ page })
        .include(".training-payment-picker")
        .analyze();
      expect(
        audit.violations.filter(
          ({ impact }) => impact === "serious" || impact === "critical",
        ),
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`payment-consent-${role}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    if (info.project.name === "narrow") {
      await page.addStyleTag({
        content: "html { font-size: 200% !important; }",
      });
      await expect(consent).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(page.viewportSize()!.width);
      await page.screenshot({
        path: info.outputPath(`payment-consent-${role}-enlarged.png`),
        fullPage: true,
      });
      await consent.tap();
    } else {
      await consent.focus();
      await page.keyboard.press("Space");
    }
    await expect(authorize).toBeEnabled();
    await authorize.click();
    await expect(
      page.getByRole("heading", { name: "Secure setup fixture" }),
    ).toBeVisible();
    expect(
      commands.find((entry) => entry.command === "training_autopay_authorize")
        ?.payload,
    ).toMatchObject({
      studentId: ids.student,
      leadDays: 2,
      existingLessonIds: [ids.lesson],
      consented: true,
    });
  });
}
