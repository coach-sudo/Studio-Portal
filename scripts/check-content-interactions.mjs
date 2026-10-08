/* global document, innerWidth, localStorage, process */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const origin = process.env.CONTENT_REVIEW_URL || "http://127.0.0.1:5174";
const out = "test-results/content-density/interactions";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const report = [];
try {
  for (const [size, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["tablet", { width: 768, height: 1024 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({
      viewport,
      timezoneId: "America/New_York",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-10-05T12:00:00Z") });
    const visit = async (path) => {
      await page.goto(`${origin}${path}`);
      await page.locator("main h1").first().waitFor();
    };
    const evidence = async (name) => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      const clipped = await page
        .locator(
          "main button:visible, main input:visible, main select:visible, main textarea:visible, main summary:visible, [role=dialog] button:visible",
        )
        .evaluateAll((elements) =>
          elements
            .filter((el) => {
              if (el.closest(".visually-hidden, [hidden], [inert]"))
                return false;
              // Mobile tabs intentionally scroll; check each control in view.
              el.scrollIntoView({
                block: "nearest",
                inline: "nearest",
                behavior: "instant",
              });
              const r = el.getBoundingClientRect();
              return (
                r.left < -1 ||
                r.right > innerWidth + 1 ||
                (!["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) &&
                  el.clientWidth + 1 < el.scrollWidth)
              );
            })
            .map((el) =>
              (el.getAttribute("aria-label") || el.textContent || el.name)
                .trim()
                .slice(0, 80),
            ),
        );
      const axe = await new AxeBuilder({ page }).analyze();
      const violations = axe.violations
        .filter((v) => ["serious", "critical"].includes(v.impact))
        .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }));
      report.push({ size, name, overflow, clipped, violations });
      await page.screenshot({
        path: `${out}/${name}-${size}.png`,
        fullPage: true,
        animations: "disabled",
      });
      assert.equal(overflow, false, `${size} ${name} horizontal overflow`);
      assert.deepEqual(clipped, [], `${size} ${name} clipped controls`);
    };

    await visit("/coach");
    assert.equal(
      await page.locator(".operational-counts, .home-today-link").count(),
      0,
    );
    await expect(
      page
        .locator(".dashboard-rail")
        .getByRole("button", { name: /Open Today/ }),
    ).toBeVisible();
    await evidence("coach-home-summary");

    await page.evaluate(() => {
      const saved = JSON.parse(
        localStorage.getItem("stage-story-studio-core-v2") || "{}",
      );
      saved.payments = [
        {
          id: "density-receipt",
          studentId: "student-maya",
          kind: "payment",
          amountMinor: 5000,
          currency: "USD",
          accountCredit: false,
          reason: "Matched payment receipt",
          createdAt: "2026-10-05T10:00:00Z",
        },
      ];
      localStorage.setItem("stage-story-studio-core-v2", JSON.stringify(saved));
    });
    await visit("/portal/payments");
    const history = page.getByText(/^Receipts & adjustments \(\d+\)$/);
    await history.focus();
    await page.keyboard.press("Enter");
    await expect(history.locator("..")).toHaveAttribute("open", "");
    await expect(
      history.locator("..").locator(".payment-history-row").first(),
    ).toBeVisible();
    await evidence("payment-history-keyboard");
    await page
      .getByRole("button", { name: "Choose package", exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toContainText("$500.00");
    await expect(page.getByRole("dialog")).toContainText(
      "One credit covers one lesson",
    );
    await evidence("package-offer-quote");
    await page.keyboard.press("Escape");

    await visit("/portal");
    const welcome = page.getByText("Studio welcome message", { exact: true });
    await welcome.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".student-welcome details")).toHaveAttribute(
      "open",
      "",
    );
    await expect(
      page.getByRole("link", { name: "Message coach" }),
    ).toBeVisible();
    await evidence("welcome-keyboard");

    await page.evaluate(() => {
      const saved = JSON.parse(
        localStorage.getItem("stage-story-studio-core-v2") || "{}",
      );
      saved.notes = [
        {
          id: "browser-density-note",
          version: 1,
          updatedAt: "2026-10-05T10:00:00Z",
          studentId: "student-maya",
          lessonId: "lesson-maya-next",
          title: "Long lesson note",
          status: "published",
          body: "Searchable scene objective",
          bodyHtml: `<p><strong>Scene objective</strong></p><p>${"Complete authored lesson instruction. ".repeat(60)}</p><p>Closing instruction is preserved.</p>`,
        },
      ];
      localStorage.setItem("stage-story-studio-core-v2", JSON.stringify(saved));
    });
    await visit("/portal/lessons/lesson-maya-next");
    const note = page.getByText("Read Long lesson note", { exact: true });
    await note.focus();
    await page.keyboard.press("Space");
    await expect(
      page.getByText("Closing instruction is preserved."),
    ).toBeVisible();
    await evidence("long-note-keyboard");

    await visit("/portal/notes");
    await page.getByLabel("Search notes").fill("scene objective");
    const noteTrigger = page.getByRole("button", { name: /1 note/ });
    await noteTrigger.click();
    await expect(
      page.getByRole("dialog").getByText("Closing instruction is preserved."),
    ).toBeVisible();
    await evidence("requested-full-note");
    await page.keyboard.press("Escape");
    await expect(noteTrigger).toBeFocused();
    await page.getByLabel("Search notes").fill("No matching authored record");
    await expect(page.getByText("No published notes yet")).toBeVisible();
    await evidence("notes-empty-search");

    await visit("/coach/students");
    const addStudent = page.getByRole("button", {
      name: "Add student",
      exact: true,
    });
    await addStudent.click();
    const dialog = page.getByRole("dialog", { name: "Add student" });
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press("Tab");
      assert(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
        "focus stays in Add student",
      );
    }
    await evidence("add-student-focus");
    await page.keyboard.press("Escape");
    await expect(addStudent).toBeFocused();

    await visit("/coach/campaigns");
    const fields = page.getByText("Personalization fields", { exact: true });
    await fields.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText(/\{\{firstName\}\}, \{\{fullName\}\}/),
    ).toBeVisible();
    await page.getByLabel("Campaign / template name").fill("Fixture campaign");
    await page
      .getByLabel("Subject", { exact: true })
      .fill("Hello {{unknownField}}");
    await page
      .getByLabel("Email body")
      .fill("Full personalized body. ".repeat(35));
    await expect(page.getByText("Unknown fields: unknownField")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review send" }),
    ).toBeDisabled();
    await evidence("campaign-field-error");
    await page
      .getByLabel("Subject", { exact: true })
      .fill("Hello {{firstName}}");
    await page.getByRole("button", { name: "Review send" }).click();
    await expect(
      page.locator(".campaigns-side details").last(),
    ).toHaveAttribute("open", "");
    await expect(page.locator(".campaign-send-review")).toContainText(
      "unsubscribed addresses are excluded",
    );
    await evidence("campaign-full-review");

    await visit("/coach/students/student-maya");
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove student", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "will lose portal access",
    );
    await expect(page.getByRole("dialog")).toContainText(
      "Future lessons will be cancelled",
    );
    await evidence("remove-warning");

    await visit("/coach/students/student-maya/payments");
    await page
      .getByRole("button", { name: "Adjust dollar balance", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "separate from lesson credits",
    );
    await expect(page.getByRole("dialog")).toContainText("-10.00 removes $10");
    await evidence("financial-warning");
    for (const [name, path] of [
      ["coach-lessons", "/coach/lessons"],
      ["coach-notes", "/coach/notes"],
      ["coach-materials", "/coach/materials"],
      ["coach-payments", "/coach/finance"],
      ["coach-settings", "/coach/settings"],
      ["coach-inbox", "/coach/inbox"],
      [
        "workspace-lesson",
        "/coach/students/student-maya/lessons/lesson-maya-next",
      ],
      ["workspace-account", "/coach/students/student-maya/account"],
      ["workspace-notes", "/coach/students/student-maya/notes"],
      ["student-work", "/portal/work"],
      ["student-practice", "/portal/practice"],
      ["student-materials", "/portal/materials"],
      ["student-schedule", "/portal/bookings"],
      ["student-payments", "/portal/payments"],
      ["student-settings", "/portal/settings"],
      ["student-actor", "/portal/actor-page"],
      ["student-referrals", "/portal/referrals"],
      ["student-inbox", "/portal/inbox"],
    ]) {
      await visit(path);
      await evidence(name);
    }
    await visit("/coach/settings");
    for (const [name, label] of [
      ["settings-daily-popup", "Daily popup"],
      ["settings-automations", "Email automations"],
      ["settings-integrations", "Connections"],
    ]) {
      await page
        .locator(".settings-nav")
        .getByRole("button", { name: new RegExp(`^${label}`) })
        .click();
      await evidence(name);
    }
    await context.close();
  }
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
