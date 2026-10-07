/* global document, innerWidth, getComputedStyle, console */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { renderStudioEmail } from "../netlify/functions/_shared/email-presentation.ts";

const out = "test-results/responsive";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const report = [];
const panels = [
  "Studio",
  "Student workspace",
  "Daily popup",
  "Rates & reminders",
  "Email automations",
  "Connections",
  "Data & recovery",
];
for (const width of [320, 390, 700, 768, 900, 1024, 1440]) {
  const context = await browser.newContext({
    viewport: { width, height: 600 },
    reducedMotion: "reduce",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-10-05T12:00:00Z") });
  await page.goto("http://127.0.0.1:5173/coach/settings");
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  for (const panel of panels) {
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: new RegExp(`^${panel}`) })
      .click();
    await page.screenshot({
      path: `${out}/settings-${panel.toLowerCase().replaceAll(/[^a-z]+/g, "-")}-${width}.png`,
      fullPage: true,
    });
    if (panel === "Email automations") {
      await page
        .locator(".automation-rule-card")
        .first()
        .screenshot({ path: `${out}/automation-card-${width}.png` });
    }
    const failures = [];
    const controls = page.locator(
      ".settings-content button:visible, .settings-content input:visible, .settings-content select:visible",
    );
    for (let i = 0; i < (await controls.count()); i++) {
      const control = controls.nth(i);
      await control.evaluate((el) =>
        el.scrollIntoView({ block: "center", inline: "nearest" }),
      );
      const failure = await control.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const center = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        const overlap = center && center !== el && !el.contains(center);
        const hiddenText =
          el.textContent.trim() &&
          !el.querySelector("svg") &&
          parseFloat(getComputedStyle(el).fontSize) === 0;
        if (r.left < -1 || r.right > innerWidth + 1 || overlap || hiddenText)
          return {
            label: (
              el.textContent ||
              el.name ||
              el.getAttribute("aria-label") ||
              "control"
            )
              .trim()
              .slice(0, 100),
            rect: { x: r.x, y: r.y, width: r.width, height: r.height },
            overlap: overlap && center.outerHTML.slice(0, 150),
          };
      });
      if (failure) failures.push(failure);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    report.push({ width, panel, overflow, failures });
  }
  if (width > 768) {
    const sidebar = page.locator(".sidebar");
    assert.equal(
      await sidebar.evaluate((el) => getComputedStyle(el).overflowY),
      "auto",
    );
    await sidebar.getByRole("link", { name: "Settings", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert(await sidebar.evaluate((el) => el.contains(document.activeElement)));
    await sidebar
      .getByRole("button", { name: "Sign out" })
      .scrollIntoViewIfNeeded();
    assert(await sidebar.evaluate((el) => el.scrollTop > 0));
  }
  const axe = await new AxeBuilder({ page }).analyze();
  report.push({
    width,
    axe: axe.violations
      .filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => v.id),
  });
  await context.close();
}
const email = renderStudioEmail({
  heading: "Upcoming lesson reminder",
  greeting: "Hi Taylor,",
  message:
    "Your piano lesson is tomorrow.\n\nTuesday, October 6 at 4:00 PM (America/New_York)\nPiano with Coach D",
  primaryAction: {
    label: "View lesson details",
    url: "https://preview.example.test/portal/lessons/fixture",
  },
  coachName: "Coach D",
  studioName: "Dance · Art · Joy",
});
await writeFile(`${out}/email.html`, email.html);
for (const width of [320, 600]) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
  });
  const page = await context.newPage();
  await page.setContent(email.html);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  const axe = await new AxeBuilder({ page }).analyze();
  report.push({
    emailWidth: width,
    overflow,
    axe: axe.violations
      .filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => v.id),
  });
  await page.screenshot({ path: `${out}/email-${width}.png` });
  await context.close();
}
await browser.close();
await writeFile(`${out}/review.json`, JSON.stringify(report, null, 2));
const failed = report.filter(
  (row) => row.overflow || row.failures?.length || row.axe?.length,
);
console.log(JSON.stringify({ checked: report.length, failed }, null, 2));
assert.equal(
  failed.length,
  0,
  "Responsive control or accessibility regression",
);
