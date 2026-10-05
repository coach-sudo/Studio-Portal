/* global document, innerWidth, getComputedStyle, NodeFilter, console */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import process from "node:process";

// Keep the route inventory shared with the design review, plus every record tab.
const source = await readFile("scripts/review-product-design.mjs", "utf8");
const inventory = source.slice(
  source.indexOf("const routes = ["),
  source.indexOf("for (const [size"),
);
const routes = [...inventory.matchAll(/\["([^"]+)", "([^"]+)"\]/g)].map(
  (match) => [match[1], match[2]],
);
for (const tab of [
  "lessons",
  "work",
  "notes",
  "account",
  "payments",
  "actor-page",
])
  routes.push([`student-record-${tab}`, `/coach/students/student-maya/${tab}`]);
routes.push(["portal-class", "/portal/classes/offering-scene-night"]);
routes.push([
  "household-contact",
  "/coach/students/student-sarah/contacts/contact-dana",
]);
const supplemental = [
  ...["overview", "setup", "classes", "series"].map((tab) => [
    `bookings-${tab}`,
    `/coach/bookings?view=${tab}`,
  ]),
  ["minor-student-record", "/coach/students/student-sarah"],
  ["minor-student-account", "/coach/students/student-sarah/account"],
  ["coach-login", "/coach/login"],
];
const supplementOnly = process.argv.includes("--supplement");
const reviewRoutes = supplementOnly
  ? supplemental
  : [...routes, ...supplemental];
const out = `test-results/page-spacing${supplementOnly ? "-supplement" : ""}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const report = [];

async function inspect(page, name, width) {
  const result = await page.evaluate(() => {
    const failures = [];
    const cards = [
      ...document.querySelectorAll(
        ".section, .record-card, .coach-panel, .service-card, .service-admin-grid > article, .campaigns-summary article, .assignment-card, .gift-card, .profile-preview, .student-record-header, .booking-table-row, .portal-row, .table-list > article, .workflow-list > article, .communication-card, .campaign-email-preview, .lesson-readiness",
      ),
    ];
    for (const card of cards) {
      if (!card.checkVisibility()) continue;
      const rect = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      const left =
        rect.left +
        parseFloat(style.borderLeftWidth) +
        Math.max(12, parseFloat(style.paddingLeft));
      const right =
        rect.right -
        parseFloat(style.borderRightWidth) -
        Math.max(12, parseFloat(style.paddingRight));
      if (
        card.matches(".section") &&
        (parseFloat(style.paddingLeft) < 12 ||
          parseFloat(style.paddingRight) < 12)
      )
        failures.push({
          card: card.querySelector("h2")?.textContent,
          kind: "missing card inset",
          padding: style.padding,
        });
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const el = node.parentElement;
        if (
          !node.textContent.trim() ||
          !el?.checkVisibility() ||
          el.closest("svg, script, style, select, option")
        )
          continue;
        // Intentional ellipsis and horizontal scrolling remain usable patterns.
        let clipped = false;
        for (
          let parent = el;
          parent && parent !== card;
          parent = parent.parentElement
        ) {
          const css = getComputedStyle(parent);
          if (["hidden", "clip", "auto", "scroll"].includes(css.overflowX)) {
            clipped = true;
            break;
          }
        }
        if (clipped) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const box of range.getClientRects()) {
          if (box.width && (box.left < left - 2 || box.right > right + 2)) {
            failures.push({
              card: card.querySelector("h2")?.textContent,
              text: node.textContent.trim().slice(0, 120),
              kind: "text outside card content",
              left: box.left,
              right: box.right,
              insetLeft: left,
              insetRight: right,
              element: el.className,
            });
            break;
          }
        }
      }
    }
    return {
      cards: cards.length,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      failures,
    };
  });
  report.push({ name, width, ...result });
  await page.screenshot({
    path: `${out}/${name}-${width}.png`,
    fullPage: true,
    animations: "disabled",
  });
  console.log(
    name,
    width,
    result.failures.length || result.overflow
      ? JSON.stringify({
          overflow: result.overflow,
          failureCount: result.failures.length,
          examples: result.failures.slice(0, 3),
        })
      : "ok",
  );
}

for (const width of [320, 390, 700, 768, 900, 1024, 1440]) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    timezoneId: "America/New_York",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-10-05T14:00:00-04:00") });
  await page.route("**/api/v2/public/package-gifts/catalog?*", (route) =>
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
  for (const [name, route] of reviewRoutes) {
    await page.goto("http://127.0.0.1:5173" + route);
    await page.locator("h1").first().waitFor();
    await page.locator(".loading").first().waitFor({ state: "hidden" });
    // Let lazy content and font loading settle before measuring line boxes.
    await page.evaluate(() => document.fonts.ready);
    await inspect(page, name, width);
    if (name === "campaigns" || name === "student-detail") {
      // Browser-only stress copy; never writes studio records or sends a campaign.
      await page
        .locator(
          name === "campaigns"
            ? ".campaign-recipient-list small"
            : ".detail-list dd",
        )
        .first()
        .evaluate((el) => {
          el.textContent =
            "alexandria.very-long-household-recipient-name@long-studio-domain.example.invalid";
        });
      await inspect(page, `${name}-long-address`, width);
    }
  }
  if (supplementOnly) {
    await context.close();
    continue;
  }
  await page.goto("http://127.0.0.1:5173/coach/settings");
  for (const panel of [
    "Studio",
    "Student workspace",
    "Daily popup",
    "Rates & reminders",
    "Email automations",
    "Connections",
    "Data & recovery",
  ]) {
    await page
      .locator(".settings-nav")
      .getByRole("button", { name: new RegExp(`^${panel}`) })
      .click();
    await inspect(
      page,
      `settings-${panel.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`,
      width,
    );
  }
  await context.close();
}
await browser.close();
await writeFile(`${out}/review.json`, JSON.stringify(report, null, 2));
const failed = report.filter((row) => row.overflow || row.failures.length);
console.log(JSON.stringify({ checked: report.length, failed }, null, 2));
assert.equal(failed.length, 0, "Page spacing regression");
