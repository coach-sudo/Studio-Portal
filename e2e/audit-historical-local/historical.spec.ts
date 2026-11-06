import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ids, installFixture } from "../candidate-local/fixture";
for (const width of [320, 390, 768, 1440])
  test(`historical booking and replay form at ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await installFixture(context, "coach");
    fixture.bookingServices = [
      {
        id: "e7300000-0000-4000-8000-000000000012",
        studio_id: ids.studio,
        slug: "e2e-historical",
        name: "E2E Historical Coaching",
        description: "Synthetic historical booking fixture",
        category: "private",
        duration_minutes: 60,
        price_minor: 6000,
        deposit_minor: 0,
        currency: "USD",
        capacity: 1,
        location_options: ["google_meet", "in_person"],
        default_location: "google_meet",
        recurrence_options: ["none"],
        payment_policies: ["pay_later"],
        buffer_before_minutes: 0,
        buffer_after_minutes: 0,
        minimum_notice_hours: 24,
        booking_horizon_days: 90,
        slot_interval_minutes: 30,
        location_price_adjustments: {},
        policy: {
          cancellationWindowHours: 24,
          rescheduleLimit: 1,
          settlement: "original_payment",
          lateSettlement: "none",
        },
        policy_version: 1,
        published: true,
        version: 1,
        updated_at: new Date().toISOString(),
      },
    ];
    let previews = 0;
    const writes: Array<{
      key: string | null;
      payload: Record<string, unknown>;
    }> = [];
    await context.route("**/api/v2/admin/booking/bookings", (r) => {
      const body = r.request().postDataJSON();
      if (body.command === "check_conflicts") {
        previews++;
        return r.fulfill({
          json: { resource: { conflicts: [], externalCalendarChecked: false } },
        });
      }
      writes.push({
        key: r.request().headers()["idempotency-key"] ?? null,
        payload: body.payload,
      });
      if (writes.length === 1)
        return r.fulfill({
          status: 503,
          json: {
            code: "PROVIDER_UNAVAILABLE",
            message:
              "Synthetic lost response. Retry unchanged to recover the receipt.",
            retryable: true,
            correlationId: "e2e-historical",
          },
        });
      return r.fulfill({
        status: 201,
        json: {
          resource: { id: "synthetic-booking" },
          sideEffects: "suppressed_historical",
        },
      });
    });
    await page.goto("/coach/bookings");
    await page
      .getByRole("button", { name: "New booking", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Create a booking" });
    await dialog.getByLabel("Entry type").selectOption("historical");
    await dialog.getByLabel("Starts", { exact: true }).fill("2020-01-01T10:00");
    await dialog
      .getByRole("button", { name: "Create booking", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic lost response",
    );
    await expect(dialog.getByLabel("Starts", { exact: true })).toHaveValue(
      "2020-01-01T10:00",
    );
    const axe = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      axe.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`historical-${width}.png`),
      fullPage: true,
    });
    await dialog.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: info.outputPath(`historical-top-${width}.png`),
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Create booking", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(previews).toBe(1);
    expect(writes[0].payload).toMatchObject({
      historical: true,
      historical_outcome: "scheduled",
      historical_financial: "record_only",
      attendance_confirmed: false,
    });
    await info.attach("request-identity", {
      body: JSON.stringify(
        {
          sameKey: writes[0].key === writes[1].key,
          previews,
          payload: writes[0].payload,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
