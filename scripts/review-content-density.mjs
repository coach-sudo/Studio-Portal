/* global document, innerWidth, localStorage, process */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const phase = process.argv[2] || "after";
const origin = process.env.CONTENT_REVIEW_URL || "http://127.0.0.1:5174";
const out = `test-results/content-density/${phase}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const report = [];
const routes = [
  ["today", "/coach/today"],
  ["students", "/coach/students"],
  ["workspace", "/coach/students/student-maya"],
  ["campaigns", "/coach/campaigns"],
  ["home", "/portal"],
  ["notes", "/portal/notes"],
  ["lesson", "/portal/lessons/lesson-maya-next"],
  ["booking", "/coach/bookings"],
];
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
    await context.addInitScript(() => {
      if (!localStorage.getItem("stage-story-studio-core-v2")) {
        const body =
          "Explore the character’s objective, the obstacle, and the change in each beat. ".repeat(
            18,
          );
        localStorage.setItem(
          "stage-story-studio-core-v2",
          JSON.stringify({
            settings: {
              welcomeMessage: "Welcome to your studio workspace. ".repeat(12),
            },
            notes: [
              {
                id: "content-review-note",
                version: 1,
                updatedAt: "2026-10-05T10:00:00Z",
                studentId: "student-maya",
                lessonId: "lesson-maya-next",
                title: "Character and scene work",
                category: "Coaching",
                tags: [],
                status: "published",
                body,
                bodyHtml: `<p><strong>Scene objective</strong></p><p>${body}</p><p>Keep this complete closing instruction.</p>`,
              },
            ],
          }),
        );
      }
    });
    await page.clock.install({ time: new Date("2026-10-05T12:00:00Z") });
    for (const [name, route] of routes) {
      await page.goto(`${origin}${route}`);
      await page.locator("main h1").first().waitFor();
      if (name === "booking") {
        await page
          .getByRole("button", { name: "New booking", exact: true })
          .click();
        await page.getByRole("dialog").waitFor();
      }
      await page.screenshot({
        path: `${out}/${name}-${size}.png`,
        fullPage: true,
        animations: "disabled",
      });
      const axe = await new AxeBuilder({ page }).analyze();
      report.push({
        name,
        size,
        overflow: await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        violations: axe.violations
          .filter((v) => ["serious", "critical"].includes(v.impact))
          .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
      });
      if (phase === "after") {
        if (name === "home" || name === "lesson" || name === "campaigns") {
          for (const summary of await page
            .locator(
              ".student-welcome summary, .note-cards summary, .campaigns-page summary",
            )
            .all()) {
            await summary.focus();
            await page.keyboard.press("Enter");
          }
          await page.screenshot({
            path: `${out}/${name}-expanded-${size}.png`,
            fullPage: true,
            animations: "disabled",
          });
        }
      }
    }
    await context.close();
  }
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
