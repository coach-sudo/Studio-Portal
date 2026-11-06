import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFixture, ids } from "../candidate-local/fixture";
for (const width of [320, 390, 768, 1440])
  test(`source-aware overlap and provider recovery at ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const app = await installFixture(context, "coach");
    let mode = "failure";
    const previews: Record<string, unknown>[] = [],
      checks: Record<string, unknown>[] = [];
    await context.route("**/api/v2/admin/booking/bookings", (route) => {
      const body = route.request().postDataJSON();
      checks.push(body);
      if (mode === "failure")
        return route.fulfill({
          status: 503,
          json: {
            code: "CALENDAR_UNAVAILABLE",
            message:
              "Synthetic Google conflict check unavailable. Nothing was changed.",
            retryable: true,
            correlationId: "synthetic",
          },
        });
      const row = {
        id: "synthetic-overlap",
        summary: "Synthetic overlapping lesson",
        start: body.payload.starts_at,
        end: body.payload.ends_at,
        source: mode === "google" ? "google" : "studio",
        policy:
          mode === "google"
            ? "google_busy"
            : mode === "advisory"
              ? "studio_advisory"
              : "private_overlap",
        blocksChange: mode === "private",
      };
      return route.fulfill({
        json: {
          resource: {
            conflicts: [row],
            externalCalendarChecked: mode === "google",
          },
        },
      });
    });
    await context.route("**/api/v2/lessons", (route) => {
      const body = route.request().postDataJSON();
      previews.push(body);
      return route.fulfill({
        status: 409,
        json: {
          code: "REVIEW_REQUIRED",
          message: "Synthetic review boundary: no execution performed.",
          retryable: false,
          correlationId: "synthetic",
        },
      });
    });
    await page.goto(`/coach/students/${ids.student}/lessons/${ids.lesson}`);
    const opener = page.getByRole("button", {
      name: "Reschedule upcoming lesson",
      exact: true,
    });
    await expect(opener).toBeVisible({ timeout: 20000 });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Reschedule upcoming lesson",
      exact: true,
    });
    await dialog.getByRole("button", { name: "Next day", exact: true }).focus();
    await page.keyboard.press("Enter");
    const selectedDate = await dialog
      .getByLabel("New date", { exact: true })
      .inputValue();
    await dialog
      .getByRole("button", { name: "Confirm new time", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic Google conflict check unavailable",
    );
    await expect(dialog.getByLabel("New date", { exact: true })).toHaveValue(
      selectedDate,
    );
    await page.screenshot({
      path: info.outputPath(`reschedule-provider-error-${width}.png`),
      fullPage: false,
    });
    expect(previews).toHaveLength(0);
    mode = "private";
    await dialog
      .getByRole("button", { name: "Confirm new time", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Choose another time", exact: true }),
    ).toBeDisabled();
    await expect(dialog).toContainText(
      "Scheduled private lessons cannot overlap",
    );
    await expect(
      dialog.getByRole("button", { name: /anyway|override/i }),
    ).toHaveCount(0);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include(".reschedule-form")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await dialog
      .getByRole("button", { name: "Choose another time", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`reschedule-private-blocked-${width}.png`),
      fullPage: false,
    });
    expect(previews).toHaveLength(0);
    mode = "advisory";
    await dialog
      .getByRole("button", { name: "Next week", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Confirm new time", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: "Review studio overlap",
        exact: true,
      }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "Review studio overlap", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`reschedule-advisory-${width}.png`),
      fullPage: false,
    });
    await dialog
      .getByRole("button", { name: "Review studio overlap", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Synthetic advisory overlap review");
    await dialog
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic review boundary",
    );
    expect(previews[0]).toMatchObject({
      command: "preview_change",
      payload: { allowConflict: false },
    });
    await dialog
      .getByRole("button", { name: "Keep lesson", exact: true })
      .click();
    mode = "google";
    await dialog
      .getByRole("button", { name: "Two weeks later", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Confirm new time", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: "Confirm Google overlap",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(dialog).toContainText("America/New_York");
    expect(
      (
        await new AxeBuilder({ page })
          .include(".reschedule-form")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "Confirm Google overlap", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`reschedule-google-review-${width}.png`),
      fullPage: false,
    });
    await dialog
      .getByRole("button", { name: "Confirm Google overlap", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Synthetic Google busy-time review");
    await dialog
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic review boundary",
    );
    expect(previews[1]).toMatchObject({
      command: "preview_change",
      payload: { allowConflict: true },
    });
    expect(previews.every((row) => row.command === "preview_change")).toBe(
      true,
    );
    expect(checks).toHaveLength(4);
    expect(
      checks.every(
        (row) =>
          (row.payload as Record<string, unknown>).lesson_id === ids.lesson,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(
      app.commands.filter(
        (command) => command === "execute_change" || command === "reschedule",
      ),
    ).toHaveLength(0);
  });
