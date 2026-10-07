import { openAs, accessToken } from "./support/auth";
import { expectNoSeriousAxeViolations } from "./support/axe";
import {
  expect,
  requireFixtures,
  test,
  expectNoHorizontalOverflow,
} from "./support/fixtures";

test.describe("Unified invoice acceptance", () => {
  test.describe.configure({ retries: 0 });
  test("@journey @a11y invoices preserve drafts, partial payments, PDF access, and student authorization", async ({
    browser,
    runtime,
  }, testInfo) => {
    requireFixtures(runtime);
    const coach = await openAs(browser, "coach");
    const student = await openAs(browser, "student");
    const unrelated = await openAs(browser, "unrelated");
    try {
      await coach.page.goto("/coach/finance");
      await coach.page
        .getByRole("button", { name: "Create invoice", exact: true })
        .click();
      let drawer = coach.page.getByRole("dialog");
      await drawer
        .getByRole("combobox", { name: /^Student/ })
        .selectOption(runtime.ids!.student);
      await drawer
        .getByRole("button", { name: "Add service", exact: true })
        .click();
      await drawer
        .getByRole("combobox", { name: /^Service/ })
        .selectOption(runtime.ids!.paidService);
      await drawer
        .getByLabel("Description", { exact: true })
        .fill(`${runtime.runId} Invoice services`);
      await drawer.getByLabel("Quantity", { exact: true }).fill("2");
      await drawer.getByLabel(/Unit price/).fill("75");
      await drawer
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      drawer = coach.page.getByRole("dialog");
      await expect(
        drawer.getByRole("button", { name: "Edit / issue draft", exact: true }),
      ).toBeVisible();
      const invoiceId = new URL(coach.page.url()).searchParams.get("invoice")!;
      const getInvoices = async (actor: typeof student) =>
        actor.context.request.get("/api/invoices", {
          headers: { Authorization: `Bearer ${await accessToken(actor.page)}` },
        });
      await student.page.goto("/portal/payments");
      const hiddenDraft = await getInvoices(student);
      expect(hiddenDraft.ok()).toBeTruthy();
      expect(JSON.stringify(await hiddenDraft.json())).not.toContain(invoiceId);
      await drawer
        .getByRole("button", { name: "Edit / issue draft", exact: true })
        .click();
      await coach.page
        .getByRole("dialog")
        .getByRole("button", { name: "Save invoice", exact: true })
        .click();
      drawer = coach.page.getByRole("dialog");
      await expect(
        drawer.getByRole("button", { name: "Record payment", exact: true }),
      ).toBeVisible();
      await drawer.getByLabel(/Amount \(USD\)/).fill("5");
      await drawer
        .getByRole("button", { name: "Record payment", exact: true })
        .click();
      await expect(drawer.locator(".invoice-paper")).toContainText("$145.00");
      await expectNoSeriousAxeViolations(coach.page);
      await expectNoHorizontalOverflow(coach.page);
      await coach.page.screenshot({
        path: testInfo.outputPath("coach-invoice-partial.png"),
        fullPage: true,
      });
      await student.page.goto(`/portal/payments?invoice=${invoiceId}`);
      const studentDrawer = student.page.getByRole("dialog");
      await expect(studentDrawer.locator(".invoice-paper")).toContainText(
        "$145.00",
      );
      await expect(
        studentDrawer.getByRole("button", {
          name: "Record payment",
          exact: true,
        }),
      ).toHaveCount(0);
      const pdf = student.page.waitForEvent("download", { timeout: 15000 });
      await studentDrawer
        .getByRole("button", { name: "Download PDF", exact: true })
        .click();
      const download = await pdf;
      expect(download.suggestedFilename()).toMatch(/\.pdf$/);
      await download.saveAs(testInfo.outputPath("student-invoice.pdf"));
      await expectNoSeriousAxeViolations(student.page);
      await expectNoHorizontalOverflow(student.page);
      await unrelated.page.goto("/portal/payments");
      const unrelatedInvoices = await getInvoices(unrelated);
      expect(unrelatedInvoices.ok()).toBeTruthy();
      expect(JSON.stringify(await unrelatedInvoices.json())).not.toContain(
        invoiceId,
      );
      const deniedPdf = await unrelated.context.request.post(
        "/api/invoice-pdf",
        {
          headers: {
            Authorization: `Bearer ${await accessToken(unrelated.page)}`,
          },
          data: { invoiceId },
        },
      );
      expect(deniedPdf.status()).toBe(403);
      const deniedWrite = await student.context.request.patch(
        `${process.env.SUPABASE_URL}/rest/v1/studio_invoices?id=eq.${invoiceId}`,
        {
          headers: {
            apikey: process.env.SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${await accessToken(student.page)}`,
          },
          data: { paid_minor: 15000 },
        },
      );
      expect(deniedWrite.status()).toBe(403);
      await student.page.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalOverflow(student.page);
      await student.page.screenshot({
        path: testInfo.outputPath("student-invoice-mobile.png"),
        fullPage: true,
      });
    } finally {
      await coach.context.close();
      await student.context.close();
      await unrelated.context.close();
    }
  });
});
