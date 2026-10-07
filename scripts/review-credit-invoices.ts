import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import { createInvoicePdf } from "../src/features/finance/invoicePdf";
import type { Invoice } from "../src/domain/invoices";

const out = "test-results/credit-invoices";
await mkdir(out, { recursive: true });
async function assertCardSpacing(
  page: import("@playwright/test").Page,
  name: string,
) {
  const failures = await page.evaluate(() => {
    const failures: string[] = [];
    for (const card of document.querySelectorAll<HTMLElement>(
      ".section, .record-card, .table-list > article, .campaign-email-preview, .communication-card",
    )) {
      if (!card.checkVisibility()) continue;
      const rect = card.getBoundingClientRect(),
        style = getComputedStyle(card);
      const left =
        rect.left +
        parseFloat(style.borderLeftWidth) +
        Math.max(12, parseFloat(style.paddingLeft));
      const right =
        rect.right -
        parseFloat(style.borderRightWidth) -
        Math.max(12, parseFloat(style.paddingRight));
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode,
          el = node.parentElement;
        if (
          !node.textContent?.trim() ||
          !el?.checkVisibility() ||
          el.closest("svg,script,style,select,option")
        )
          continue;
        let clipped = false;
        for (
          let parent: Element | null = el;
          parent && parent !== card;
          parent = parent.parentElement
        )
          if (
            ["hidden", "clip", "auto", "scroll"].includes(
              getComputedStyle(parent).overflowX,
            )
          ) {
            clipped = true;
            break;
          }
        if (clipped) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (
          [...range.getClientRects()].some(
            (box) =>
              box.width && (box.left < left - 2 || box.right > right + 2),
          )
        )
          failures.push(node.textContent.trim().slice(0, 120));
      }
    }
    return failures;
  });
  assert.deepEqual(failures, [], `${name} text outside card inset`);
}
const invoice: Invoice = {
  id: "40000000-0000-4000-8000-000000000001",
  studio_id: "demo-studio",
  student_id: "student-maya",
  number: "INV-2026-DAJ001",
  status: "open",
  currency: "USD",
  issue_date: "2026-10-06",
  due_date: "2026-10-20",
  introduction:
    "Thank you for choosing DAJ Studio. This invoice covers your private coaching and four flexible lesson credits.",
  notes:
    "Pay securely in your student portal, or arrange a bank transfer with the studio. Your package credits become available when the package line is paid in full.",
  footer: "Dance · Art · Joy\nThank you for being part of our studio.",
  branding: {
    studioName: "DAJ Studio",
    email: "studio@example.test",
    logoUrl: "/og.png",
  },
  recipient: { name: "Maya Kim", email: "maya.longaddress@example.test" },
  items: [
    {
      id: crypto.randomUUID(),
      kind: "service",
      referenceId: "service",
      description:
        "Private acting coaching · audition preparation and scene study",
      quantity: 2,
      unitMinor: 8000,
      startsOn: "2026-10-07",
      endsOn: "2026-10-21",
      lessonIds: [],
      paidMinor: 0,
      creditMinor: 0,
    },
    {
      id: crypto.randomUUID(),
      kind: "package",
      referenceId: "package",
      description: "Four flexible studio lesson credits",
      quantity: 1,
      unitMinor: 32000,
      startsOn: "2026-10-06",
      endsOn: "2026-11-06",
      lessonIds: [],
      paidMinor: 0,
      creditMinor: 0,
    },
  ],
  total_minor: 48000,
  paid_minor: 0,
  credit_minor: 0,
  version: 1,
  created_at: new Date().toISOString(),
};
if (process.argv.includes("--pdf")) {
  const logo = await sharp(
    Buffer.from(
      '<svg width="260" height="100" xmlns="http://www.w3.org/2000/svg"><text x="0" y="76" font-family="Georgia" font-size="78" fill="#142d44">DAJ</text></svg>',
    ),
  )
    .png()
    .toBuffer();
  await writeFile(
    `${out}/sample-invoice.pdf`,
    await createInvoicePdf(
      invoice,
      await readFile("public/fonts/invoice-sans.ttf"),
      logo,
      fontkit,
    ),
  );
  console.log("Generated sample-invoice.pdf from the production renderer.");
} else {
  const browser = await chromium.launch();
  const report = [];
  try {
    for (const width of [1440, 768, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
        acceptDownloads: true,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      for (const [name, route] of [
        ["payments", "/coach/finance"],
        ["campaigns", "/coach/campaigns"],
        ["student-payments", "/coach/students/student-maya/payments"],
        ["student-contact", "/coach/students/student-maya/account"],
      ]) {
        await page.goto("http://127.0.0.1:5173" + route);
        await page.locator("main h1").first().waitFor();
        await page.locator(".section").first().waitFor();
        await page.locator(".loading").first().waitFor({ state: "hidden" });
        await page.evaluate(() => document.fonts.ready);
        await assertCardSpacing(page, `${name} ${width}`);
        if (name === "campaigns" || name === "student-contact") {
          const text = page
            .locator(
              name === "campaigns"
                ? ".campaign-recipient-list small"
                : ".detail-list dd",
            )
            .first();
          if (await text.count()) {
            await text.evaluate((el) => {
              el.textContent =
                "alexandria.very-long-household-recipient-name@long-studio-domain.example.invalid";
            });
            await assertCardSpacing(page, `${name} long address ${width}`);
          }
        }
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${name} horizontal overflow at ${width}`,
        );
        const axe = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(
          axe.violations,
          [],
          `${name} accessibility at ${width}`,
        );
        await page.screenshot({
          path: `${out}/${name}-${width}.png`,
          fullPage: true,
        });
        report.push({ name, width, overflow: false, axe: 0 });
      }
      await page.goto("http://127.0.0.1:5173/coach/finance");
      await page
        .getByRole("button", { name: "Create invoice", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Create invoice", exact: true })
        .click();
      let dialog = page.getByRole("dialog");
      await dialog
        .getByRole("combobox", { name: /^Student/ })
        .selectOption("student-maya");
      await dialog
        .getByRole("button", { name: "Add service", exact: true })
        .click();
      await dialog
        .getByLabel("Description", { exact: true })
        .fill(
          "A long service description for audition preparation, coaching, and scheduling across several weeks",
        );
      await dialog
        .getByRole("button", { name: "Preview invoice", exact: true })
        .click();
      await page.screenshot({
        path: `${out}/invoice-editor-${width}.png`,
        fullPage: true,
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `invoice editor overflow at ${width}`,
      );
      await dialog
        .getByRole("button", { name: "Save invoice", exact: true })
        .click();
      dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: "Download PDF", exact: true })
        .waitFor();
      const axe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(axe.violations, [], `invoice accessibility at ${width}`);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `invoice overflow at ${width}`,
      );
      await page.screenshot({
        path: `${out}/invoice-virtual-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Tab");
      const focusIn = await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      );
      assert(focusIn, "drawer focus escaped");
      for (let i = 0; i < 24; i++) {
        await page.keyboard.press("Tab");
        assert(
          await page.evaluate(
            () => !!document.activeElement?.closest('[role="dialog"]'),
          ),
          "drawer tab escaped",
        );
      }
      const download = page.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "Download PDF", exact: true })
        .click();
      assert((await download).suggestedFilename().endsWith(".pdf"));
      const number = await dialog.getAttribute("aria-labelledby");
      assert(number, "drawer label missing");
      await expect(
        dialog.getByRole("button", { name: "Done", exact: true }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.reload();
      await page
        .getByRole("button", { name: "View invoice", exact: true })
        .first()
        .waitFor();
      await page
        .getByRole("button", { name: "View invoice", exact: true })
        .first()
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await expect(
        page.getByRole("button", { name: "View invoice", exact: true }).first(),
      ).toBeFocused();
      await page.goto(
        "http://127.0.0.1:5173/coach/students/student-maya/payments",
      );
      await page
        .getByRole("button", { name: "Set remaining credits", exact: true })
        .click();
      dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("New remaining total", { exact: false })
        .fill("6");
      await dialog
        .getByLabel("Reason", { exact: true })
        .fill("Coach confirmed the available lesson balance");
      await dialog
        .getByRole("button", { name: "Save total", exact: true })
        .click();
      await page
        .getByText(
          "Remaining credit total updated. Existing reservations are preserved.",
          { exact: true },
        )
        .waitFor();
      await page.reload();
      await page
        .getByRole("button", { name: "Set remaining credits", exact: true })
        .click();
      assert(
        (await page
          .getByRole("dialog")
          .getByLabel("New remaining total", { exact: false })
          .inputValue()) === "6",
        "credit balance did not persist",
      );
      await page.keyboard.press("Escape");
      assert.deepEqual(errors, [], "runtime errors");
      report.push({
        name: "invoice and credits journey",
        width,
        axe: 0,
        keyboard: true,
        pdf: true,
        persistence: true,
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    `${report.length} targeted route and invoice/credit scenarios passed.`,
  );
}
