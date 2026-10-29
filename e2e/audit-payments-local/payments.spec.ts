import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ids, installFixture } from "../candidate-local/fixture";

// Real React and authenticated HTTP contracts; actual ledger atomicity and
// role/concurrency proof run separately against isolated PostgreSQL.
for (const entry of ["workspace", "calendar"] as const)
  for (const width of [320, 390, 768, 1440])
    test(`${entry} payment receipt survives reload at ${width}`, async ({
      page,
      context,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      const fixture = await installFixture(context, "coach");
      const writes: Record<string, unknown>[] = [];
      let ledgerEffects = 0;
      await context.route("**/api/v2/lessons", async (route) => {
        const body = route.request().postDataJSON();
        if (body.command === "payment_context")
          return route.fulfill({
            json: {
              resource: {
                lessonId: ids.lesson,
                studentId: ids.student,
                participantId: null,
                bookingId: null,
                bookingVersion: null,
                version: 1,
                currency: "USD",
                priceMinor: 6000,
                paidMinor: 0,
                remainingMinor: 6000,
                eligible: true,
                reasonCode: null,
                reviewToken: "a".repeat(64),
              },
            },
          });
        if (body.command === "record_payment") {
          writes.push(body);
          if (writes.length === 1) {
            ledgerEffects++;
            return route.fulfill({
              status: 503,
              json: {
                code: "PROVIDER_UNAVAILABLE",
                message: "Synthetic response lost after commit",
                retryable: true,
                correlationId: "payment-recovery",
              },
            });
          }
          return route.fulfill({
            json: {
              resource: {
                receiptId: "e2950000-0000-4000-8000-000000000001",
                paymentEntryId: "e2950000-0000-4000-8000-000000000002",
                auditEventId: "e2950000-0000-4000-8000-000000000003",
                lessonId: ids.lesson,
                studentId: ids.student,
                bookingId: null,
                version: 2,
                amountMinor: 1000,
                paidMinor: 1000,
                remainingMinor: 5000,
                currency: "USD",
                queuedSideEffects: [],
              },
            },
          });
        }
        return route.fallback();
      });
      const openPayment = async () => {
        await page
          .getByText("Payment, credits & lesson administration", {
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "Credits & payment", exact: true })
          .click();
      };
      const open = async () => {
        if (entry === "workspace") {
          await page.goto(
            `/coach/students/${ids.student}/lessons/${ids.lesson}`,
          );
        } else {
          await page.goto(
            "/coach/lessons?calendarDate=2027-01-20&calendarView=day",
          );
          await page
            .getByRole("button", { name: /Candidate scene study/ })
            .first()
            .click();
          await page
            .getByRole("link", { name: "Open lesson", exact: true })
            .click();
        }
        await openPayment();
      };
      await open();
      const form = page.getByRole("form", { name: "Record lesson payment" });
      await expect(form).toBeVisible();
      await page.getByLabel("Amount received (USD)").fill("10");
      await page.getByLabel("Payment method").selectOption("bank");
      await page
        .getByLabel("Payment reason")
        .fill("Bank transfer already received");
      await page
        .getByRole("button", { name: "Record payment", exact: true })
        .focus();
      await expect(
        page.getByRole("button", { name: "Record payment", exact: true }),
      ).toBeFocused();
      const axe = await new AxeBuilder({ page })
        .include('form[aria-label="Record lesson payment"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(axe.violations).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`${entry}-${width}-record.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Record payment", exact: true })
        .press("Enter");
      await expect(
        page.getByRole("button", { name: "Recover payment receipt" }),
      ).toBeVisible();
      await expect(page.getByLabel("Amount received (USD)")).toBeDisabled();
      await page.waitForLoadState("networkidle");
      await page.reload();
      await openPayment();
      await expect(
        page.getByRole("button", { name: "Recover payment receipt" }),
      ).toBeVisible();
      await expect(page.getByLabel("Payment reason")).toHaveValue(
        "Bank transfer already received",
      );
      await page
        .getByRole("button", { name: "Recover payment receipt" })
        .click();
      await expect(page.getByText(/Payment recorded:.*10\.00/)).toBeVisible();
      expect(writes).toHaveLength(2);
      expect(writes[1]).toEqual(writes[0]);
      expect(ledgerEffects).toBe(1);
      expect(writes[0].entityId).toBe(ids.lesson);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${entry}-${width}-receipt.png`),
        fullPage: true,
      });
      expect(fixture.pageErrors).toEqual([]);
    });
