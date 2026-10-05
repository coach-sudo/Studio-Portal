/* global document, innerWidth, console */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch();
const out = "test-results/redesign";
await mkdir(out, { recursive: true });
const report = [];
const routes = [
  ["coach-home", "/coach"],
  ["today", "/coach/today"],
  ["students", "/coach/students"],
  ["student-detail", "/coach/students/student-maya"],
  ["coach-lesson", "/coach/students/student-maya/lessons/lesson-maya-next"],
  ["calendar", "/coach/bookings"],
  ["calendar-lesson", "/coach/bookings?lesson=lesson-liam-next"],
  ["services", "/coach/bookings?view=services"],
  ["availability", "/coach/bookings?view=availability"],
  ["payments", "/coach/finance"],
  ["coach-inbox", "/coach/inbox"],
  ["settings", "/coach/settings"],
  ["materials", "/coach/materials"],
  ["actor-admin", "/coach/actor-pages"],
  ["campaigns", "/coach/campaigns"],
  ["coach-referrals", "/coach/referrals"],
  ["coach-class", "/coach/classes/offering-scene-night"],
  ["student-home", "/portal"],
  ["student-work", "/portal/work"],
  ["student-schedule", "/portal/bookings"],
  ["student-lesson", "/portal/lessons/lesson-maya-next"],
  ["student-payments", "/portal/payments"],
  ["student-settings", "/portal/settings"],
  ["student-inbox", "/portal/inbox"],
  ["student-actor", "/portal/actor-page"],
  ["student-referrals", "/portal/referrals"],
  ["public-booking", "/book"],
  ["booking-flow", "/book/private-acting-coaching"],
  ["booking-management", "/booking/demo-maya"],
  ["public-package", "/package/package-definition-private-coaching-4"],
  ["gift-purchase", "/gift/package-definition-private-coaching-4"],
  ["gift-claim", "/gift/claim/local-visual-fixture"],
  ["gift-confirmation", "/gift/thanks"],
  ["public-actor", "/actors/maya-kim"],
  ["login", "/login"],
  ["terms", "/terms"],
  ["guardian-home", "/e2e/local-preview.html?view=guardian"],
  ["automation", "/e2e/local-preview.html?view=automation"],
  ["skeleton", "/e2e/local-preview.html?view=skeleton"],
  ["empty", "/e2e/local-preview.html?view=empty"],
  ["form-error", "/e2e/local-preview.html?view=dialog"],
];
for (const [size, viewport] of [
  ["desktop", { width: 1440, height: 1000 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({
    viewport,
    timezoneId: "America/New_York",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  // Deterministic catalog response for visual review only; no checkout is submitted.
  await page.route(
    "http://127.0.0.1:5173/api/v2/public/package-gifts/catalog?*",
    (route) =>
      route.fulfill({
        json: {
          studio: { name: "Stage & Story Studio" },
          package: {
            id: "package-definition-private-coaching-4",
            name: "Four private coaching sessions",
            description:
              "Four flexible private coaching sessions purchased together.",
            sessionCount: 4,
            sessionDurationMinutes: 60,
            priceMinor: 32000,
            currency: "USD",
            deliveryFormat: "google_meet",
            expirationDays: 180,
            discountType: "none",
            discountMinor: 0,
            discountBasisPoints: 0,
            recurringEligible: true,
            giftable: true,
          },
        },
      }),
  );
  await page.clock.install({ time: new Date("2026-10-05T14:00:00-04:00") });
  for (const [name, route] of routes) {
    const errors = [];
    const listener = (error) => errors.push(error.message);
    page.on("pageerror", listener);
    await page.goto("http://127.0.0.1:5173" + route);
    await page.locator("h1").first().waitFor({ timeout: 15000 });
    await page.locator(".loading").first().waitFor({ state: "hidden" });
    await page.screenshot({
      path: `${out}/${name}-${size}.png`,
      fullPage: true,
      animations: "disabled",
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    report.push({
      name,
      size,
      overflow,
      errors,
      violations: axe.violations
        .filter((v) => ["serious", "critical"].includes(v.impact))
        .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    });
    console.log(
      name,
      size,
      overflow ? "OVERFLOW" : "ok",
      report.at(-1).violations.length
        ? "AXE " + JSON.stringify(report.at(-1).violations)
        : "",
    );
    page.off("pageerror", listener);
  }
  await page.goto("http://127.0.0.1:5173/coach/bookings");
  const appointment = page
    .locator(".calendar-event")
    .filter({ hasText: "Maya Kim" })
    .filter({ hasText: "Scene Study" })
    .first();
  await appointment.focus();
  await page.keyboard.press("Enter");
  const appointmentDrawer = page.getByRole("dialog", { name: "SS-1048" });
  await appointmentDrawer.waitFor();
  await page.screenshot({
    path: `${out}/calendar-drawer-${size}.png`,
    animations: "disabled",
  });
  const appointmentAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const appointmentBounds = await appointmentDrawer.boundingBox();
  const appointmentFocus = [];
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press(key);
      appointmentFocus.push(
        await appointmentDrawer.evaluate((el) =>
          el.contains(document.activeElement),
        ),
      );
    }
  }
  const appointmentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  await page.keyboard.press("Escape");
  report.push({
    name: "calendar-drawer",
    size,
    bounds: appointmentBounds,
    focusContained: appointmentFocus.every(Boolean),
    focusReturned: await appointment.evaluate(
      (el) => el === document.activeElement,
    ),
    closed: (await appointmentDrawer.count()) === 0,
    overflow: appointmentOverflow,
    violations: appointmentAxe.violations
      .filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  });
  console.log("calendar-drawer", size, JSON.stringify(report.at(-1)));
  await page.goto("http://127.0.0.1:5173/coach/bookings?view=services");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.screenshot({
    path: `${out}/service-drawer-${size}.png`,
    animations: "disabled",
  });
  const drawer = page.getByRole("dialog");
  const bounds = await drawer.boundingBox();
  const focus = [];
  for (let i = 0; i < 65; i++) {
    await page.keyboard.press("Tab");
    focus.push(
      await drawer.evaluate((el) => el.contains(document.activeElement)),
    );
  }
  await page.keyboard.press("Escape");
  report.push({
    name: "drawer-keyboard",
    size,
    focusContained: focus.every(Boolean),
    closed: (await drawer.count()) === 0,
    bounds,
  });
  await page.goto("http://127.0.0.1:5173/book/private-acting-coaching");
  await page.getByRole("button", { name: "Choose a time" }).click();
  await page.locator(".booking-time-list button").first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Student name", { exact: true }).fill("Design Fixture");
  await page
    .getByLabel("Student email", { exact: true })
    .fill("design@example.invalid");
  await page.getByRole("button", { name: /Review payment/ }).click();
  await page.locator(".terms-check input").check();
  await page
    .getByRole("button", { name: "Confirm booking", exact: true })
    .click();
  await page.locator(".booking-confirmation").waitFor();
  await page.screenshot({
    path: `${out}/booking-confirmation-${size}.png`,
    fullPage: true,
    animations: "disabled",
  });
  const confirmationAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  report.push({
    name: "booking-confirmation",
    size,
    overflow: await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    errors: [],
    violations: confirmationAxe.violations
      .filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  });
  await page.goto("http://127.0.0.1:5173/portal/settings");
  await page.getByRole("switch", { name: /Dark/ }).click();
  await page.screenshot({
    path: `${out}/portal-dark-${size}.png`,
    fullPage: true,
    animations: "disabled",
  });
  const darkAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  report.push({
    name: "portal-dark",
    size,
    overflow: await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    errors: [],
    violations: darkAxe.violations
      .filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  });
  await context.close();
}
await writeFile(out + "/verification.json", JSON.stringify(report, null, 2));
await browser.close();
assert.equal(
  report.filter(
    (r) =>
      r.overflow ||
      r.errors?.length ||
      r.violations?.length ||
      r.focusContained === false ||
      r.focusReturned === false ||
      r.closed === false,
  ).length,
  0,
  "Visual checks found overflow, accessibility, runtime, or keyboard failures; see verification.json",
);
