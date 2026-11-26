import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ids, installFixture } from "./fixture";

test("shared navigation preserves custom brand contrast", async ({
  page,
  context,
}) => {
  await installFixture(context, "coach", { coach: "Candidate Coach" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/coach/today");
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  for (const primaryColor of [
    "#ffffff",
    "#787878",
    "#000000",
    "#f1e9a8",
    "#75007e",
  ]) {
    await page.evaluate(async (primaryColor) => {
      const modulePath = "/src/lib/branding.ts";
      const { applyStudioBranding } = await import(
        /* @vite-ignore */ modulePath
      );
      applyStudioBranding({ primaryColor });
    }, primaryColor);
    const audit = await new AxeBuilder({ page })
      .include(".sidebar")
      .withRules(["color-contrast"])
      .analyze();
    expect(
      audit.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
      primaryColor,
    ).toEqual([]);
  }
});

for (const width of [390, 768, 1440]) {
  for (const role of ["coach", "student", "guardian"] as const) {
    test(`shared foundations preserve ${role} actions at ${width}px`, async ({
      page,
      context,
    }, info) => {
      const fixture = await installFixture(context, role, {
        coach: "Candidate Coach",
      });
      fixture.packageDefinitions.push(
        ...[30, 60].map((minutes) => ({
          id: `70000000-0000-4000-8000-0000000000${minutes}`,
          studio_id: ids.studio,
          name: `${minutes}-minute rehearsal package`,
          session_count: 4,
          session_duration_minutes: minutes,
          price_minor: minutes * 400,
          currency: "USD",
          visibility: "public",
          direct_purchase: true,
          active: true,
          version: 1,
          eligible_service_ids: [],
        })),
      );
      fixture.additionalLessons.push({
        id: "70000000-0000-4000-8000-000000000051",
        studio_id: ids.studio,
        student_id: ids.student,
        topic: "Extended scene rehearsal and character development",
        starts_at: "2026-11-21T16:30:00Z",
        ends_at: "2026-11-21T17:30:00Z",
        status: "scheduled",
        payment_status: "due",
        invoice_payment_pending: true,
        location_type: "virtual",
        location_label: "Synthetic online rehearsal",
        price_minor: 10000,
        version: 1,
        updated_at: "2026-11-21T17:30:00Z",
      });
      if (role === "coach") {
        fixture.additionalLessons.push({
          ...fixture.additionalLessons[0],
          id: "70000000-0000-4000-8000-000000000054",
          starts_at: "2026-11-23T18:00:00Z",
          ends_at: "2026-11-23T19:00:00Z",
          invoice_payment_pending: false,
        });
      }
      await context.route("**/api/v2/invoices", (route) =>
        route.request().postDataJSON()?.command === "training_payers"
          ? route.fulfill({
              json: {
                resource: {
                  ready: true,
                  studentIds: [ids.student],
                  attempts: [],
                },
              },
            })
          : route.fallback(),
      );
      fixture.packageBillingOptions.push(
        ...fixture.packageDefinitions.map((offer) => ({
          id: `${offer.id}-one-time`,
          studio_id: ids.studio,
          definition_id: offer.id,
          renewal_mode: "one_time",
          active: true,
          version: 1,
        })),
      );
      await page.clock.setFixedTime(new Date("2026-11-23T17:00:00Z"));
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        role === "coach"
          ? "/coach/today"
          : `/portal/bookings?student=${ids.student}`,
      );
      await expect(
        page.getByRole("heading", {
          name: role === "coach" ? "Today" : "Lesson history",
          exact: true,
        }),
      ).toBeVisible({ timeout: 20000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (role === "coach") {
        const brokenWords = await page
          .locator(".today-lesson-row .row-actions")
          .evaluateAll((actions) => {
            const broken: string[] = [];
            for (const action of actions) {
              const walker = document.createTreeWalker(
                action,
                NodeFilter.SHOW_TEXT,
              );
              for (
                let node = walker.nextNode();
                node;
                node = walker.nextNode()
              ) {
                for (const word of (node.textContent || "").matchAll(/\S+/g)) {
                  const range = new Range();
                  range.setStart(node, word.index);
                  range.setEnd(node, word.index + word[0].length);
                  if (range.getClientRects().length !== 1) broken.push(word[0]);
                }
              }
            }
            return broken;
          });
        expect(brokenWords).toEqual([]);
      }
      await page.screenshot({
        path: info.outputPath(`${role}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      if (role !== "coach") {
        await page.goto(`/portal/payments?student=${ids.student}`);
        await expect(
          page.getByRole("heading", {
            name: "Available packages",
            exact: true,
          }),
        ).toBeVisible({ timeout: 20000 });
        await page.screenshot({
          path: info.outputPath(`${role}-packages-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
        const select = page.getByRole("combobox", { name: "Lesson length" });
        await select.focus();
        await expect(select).toBeFocused();
        await select.selectOption("60");
        await page
          .getByRole("button", { name: "Choose package", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: /60-minute rehearsal package/,
        });
        await expect(dialog).toBeVisible({ timeout: 20000 });
        await page.screenshot({
          path: info.outputPath(`${role}-review-${width}.png`),
          animations: "disabled",
        });
        const audit = await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .analyze();
        expect(
          audit.violations
            .filter((v) => ["serious", "critical"].includes(v.impact || ""))
            .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
        ).toEqual([]);
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await expect(dialog).toBeHidden();
      }
    });
  }
}
