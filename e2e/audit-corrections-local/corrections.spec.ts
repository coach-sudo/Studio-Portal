import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ids, installFixture } from "../candidate-local/fixture";

// Real React/auth/query UI with denied-by-default synthetic HTTP responses.
// PostgreSQL roles, atomicity and replay are exercised separately by #77.
for (const width of [320, 390, 768, 1440])
  test(`correction, receipt recovery and history at ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await installFixture(context, "coach");
    const writes: Record<string, unknown>[] = [],
      cursors: unknown[] = [];
    let reviewed = false,
      historyFailed = false;
    const firstId = "e7800000-0000-4000-8000-000000000001";
    const history = (id: string) => ({
      id,
      recordedAt: "2026-10-28T12:00:00Z",
      reason: "Original time was mistyped",
      timezone: "America/New_York",
      original: {
        startsAt: "2020-01-01T15:00:00Z",
        endsAt: "2020-01-01T16:00:00Z",
        status: "scheduled",
      },
      corrected: {
        startsAt: "2020-01-01T14:00:00Z",
        endsAt: "2020-01-01T15:00:00Z",
        status: "scheduled",
      },
      financialReviewRequired: !reviewed,
      providerReviewRequired: true,
    });
    await context.route("**/api/v2/lessons", (route) => {
      const body = route.request().postDataJSON();
      if (body.command === "preview_datetime_correction")
        return route.fulfill({
          json: {
            resource: {
              lessonId: ids.lesson,
              version: 1,
              eligible: true,
              reasonCode: null,
              reviewToken: "synthetic-seal",
              financialReviewRequired: true,
              providerReviewRequired: true,
              completedInFuture: false,
              bookingCount: 1,
              invoiceCount: 1,
              creditEntryCount: 0,
              participantCount: 1,
              sharedBooking: false,
              status: "scheduled",
            },
          },
        });
      if (body.command === "correct_datetime") {
        writes.push(body);
        return writes.length === 1
          ? route.fulfill({
              status: 503,
              json: {
                code: "PROVIDER_UNAVAILABLE",
                message: "Synthetic lost response. Retry unchanged.",
                retryable: true,
                correlationId: "e2e-correction",
              },
            })
          : route.fulfill({ json: { resource: { correctionId: firstId } } });
      }
      if (body.command === "datetime_correction_history") {
        if (!historyFailed) {
          historyFailed = true;
          return route.fulfill({
            status: 503,
            json: {
              message: "Synthetic history unavailable",
              code: "PROVIDER_UNAVAILABLE",
              retryable: true,
              correlationId: "e2e-correction",
            },
          });
        }
        const cursor = body.payload.cursor;
        cursors.push(cursor ?? null);
        return route.fulfill({
          json: {
            resource: {
              items: [
                history(
                  cursor ? "e7800000-0000-4000-8000-000000000002" : firstId,
                ),
              ],
              hasMore: !cursor,
              nextCursor: cursor
                ? null
                : { createdAt: "2026-10-28T12:00:00Z", id: firstId },
              total: 2,
              lessonVersion: 2,
              financialReviewsPending: reviewed ? 0 : 2,
              providerReviewsPending: 2,
            },
          },
        });
      }
      if (body.command === "review_datetime_correction") {
        reviewed = true;
        return route.fulfill({
          json: { resource: { reviewId: "synthetic-review" } },
        });
      }
      return route.fallback();
    });
    await page.goto(`/coach/students/${ids.student}/lessons/${ids.lesson}`);
    const opener = page.getByRole("button", {
      name: "Correct lesson date/time",
      exact: true,
    });
    await expect(opener).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`correction-entry-${width}.png`),
      fullPage: true,
    });
    await opener.focus();
    await page.keyboard.press("Enter");
    let dialog = page.getByRole("dialog", {
      name: "Correct lesson date/time",
      exact: true,
    });
    await dialog.getByLabel("Starts", { exact: true }).fill("2020-01-01T09:00");
    await dialog.getByLabel("Ends", { exact: true }).fill("2020-01-01T10:00");
    await dialog
      .getByLabel("Correction reason")
      .fill("Original time was mistyped");
    await dialog
      .getByRole("button", { name: "Preview correction", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    const apply = dialog.getByRole("button", {
      name: "Apply correction",
      exact: true,
    });
    await expect(apply).toBeDisabled();
    const acknowledgement = dialog.getByRole("checkbox", {
      name: /financial history stays unchanged/,
    });
    await acknowledgement.focus();
    await page.keyboard.press("Space");
    await apply.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic lost response",
    );
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .include(".corrections-dialog")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      axe.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`correction-review-${width}.png`),
      fullPage: true,
    });
    await apply.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    await opener.click();
    await page
      .getByRole("button", { name: "View correction history and reviews" })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Correction history and reviews",
    });
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic history unavailable",
    );
    await dialog.getByRole("button", { name: "Refresh history" }).click();
    await expect(dialog).toContainText("2 corrections");
    await dialog.getByRole("button", { name: "Load more corrections" }).click();
    await expect(dialog.locator("article")).toHaveCount(2);
    expect(cursors[1]).toEqual({
      createdAt: "2026-10-28T12:00:00Z",
      id: firstId,
    });
    await dialog
      .getByRole("button", { name: "Record financial review" })
      .first()
      .click();
    await dialog
      .getByLabel("Financial review note")
      .fill("Reviewed existing accounting; no adjustment required");
    await dialog
      .getByRole("button", { name: "Record reviewed", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toContainText("0 financial reviews");
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    const historyAxe = await new AxeBuilder({ page })
      .include(".corrections-dialog")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(historyAxe.violations.map((v) => v.id)).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`correction-history-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(fixture.pageErrors).toEqual([]);
    await info.attach("synthetic-acceptance", {
      body: JSON.stringify(
        {
          layer: "HTTP-fixture browser",
          identicalReplay: true,
          cursorVerified: true,
          externalEffects: "not exercised",
          commands: writes,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
