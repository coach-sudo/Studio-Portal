import { expect, test, type Locator, type Page } from "@playwright/test";
import { ids, installFixture } from "./fixture";

test.use({ hasTouch: true });

const widths = [320, 375, 390, 428, 768, 1024, 1280, 1440];
const processingId = "70000000-0000-4000-8000-000000000051";
const completedId = "70000000-0000-4000-8000-000000000052";
const topic = "Extended scene rehearsal and character development";
const completedTopic = "Completed synthetic practice";
const historyPath = `/portal/bookings?student=${ids.student}`;
const historyFixtures = [
  {
    id: processingId,
    topic,
    starts_at: "2026-11-21T16:30:00Z",
    ends_at: "2026-11-21T17:30:00Z",
    status: "scheduled",
    payment_status: "due",
    invoice_payment_pending: true,
  },
  {
    id: completedId,
    topic: completedTopic,
    starts_at: "2026-11-18T16:30:00Z",
    ends_at: "2026-11-18T17:30:00Z",
    status: "completed",
    payment_status: "paid",
  },
].map((lesson) => ({
  studio_id: ids.studio,
  student_id: ids.student,
  location_type: "virtual",
  location_label: "Online rehearsal with extended location details",
  price_minor: 10000,
  version: 1,
  updated_at: "2026-11-21T17:30:00Z",
  ...lesson,
}));

function lessonHistory(page: Page) {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: "Lesson history", exact: true }),
  });
}

async function expectReadableRow(row: Locator, labels: string[]) {
  await expect(row.locator(".status")).toHaveText(labels);
  const layout = await row.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const inside = (rect: DOMRect) =>
      rect.left >= Math.max(0, frame.left) - 1 &&
      rect.right <=
        Math.min(document.documentElement.clientWidth, frame.right) + 1;
    const brokenWords: string[] = [];
    for (const label of element.querySelectorAll(
      "strong, small, .status, .open-label",
    )) {
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const word of (node.textContent || "").matchAll(/\S+/g)) {
          const range = new Range();
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          const parts = [...range.getClientRects()];
          if (parts.length !== 1 || !inside(parts[0]))
            brokenWords.push(word[0]);
        }
      }
    }
    const open = element.querySelector(".open-label")!.getBoundingClientRect();
    return {
      brokenWords,
      openInside: inside(open) && open.width > 0 && open.height > 0,
      pageFits:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    };
  });
  expect(layout).toEqual({
    brokenWords: [],
    openInside: true,
    pageFits: true,
  });
}

for (const width of widths) {
  test(`lesson history keeps status words and exact links readable at ${width}px`, async ({
    page,
    context,
  }, info) => {
    const fixture = await installFixture(context, "student");
    fixture.additionalLessons.push(...historyFixtures);
    await page.clock.setFixedTime(new Date("2026-11-23T17:00:00Z"));
    await page.setViewportSize({ width, height: width <= 428 ? 844 : 940 });
    await page.goto(historyPath);
    const history = lessonHistory(page);
    const processing = history.getByRole("link", { name: new RegExp(topic) });
    const completed = history.getByRole("link", {
      name: new RegExp(completedTopic),
    });
    await expect(processing).toBeVisible();
    if ([320, 390, 768, 1440].includes(width)) {
      await history.evaluate((element) =>
        element.scrollIntoView({ block: "start" }),
      );
      await page.screenshot({
        path: info.outputPath(`history-${width}.png`),
        animations: "disabled",
      });
    }
    await expectReadableRow(processing, ["scheduled", "Payment processing"]);
    await expectReadableRow(completed, ["completed", "Paid"]);
    const target = `/portal/lessons/${processingId}?student=${ids.student}`;
    await expect(processing).toHaveAttribute("href", target);
    await expect(completed).toHaveAttribute(
      "href",
      `/portal/lessons/${completedId}?student=${ids.student}`,
    );

    // Exercise the last row immediately above the phone's fixed navigation.
    if (width <= 428) {
      await completed.evaluate((row) => row.scrollIntoView({ block: "end" }));
      await completed.getByText("Open", { exact: true }).tap();
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === `/portal/lessons/${completedId}` &&
          url.searchParams.get("student") === ids.student,
      );
      await page.goBack();
    }

    await processing.focus();
    await expect(processing).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/portal/lessons/${processingId}` &&
        url.searchParams.get("student") === ids.student,
    );
  });
}

test("lesson history respects schedule-only Household access", async ({
  context,
  page,
}) => {
  const fixture = await installFixture(context, "guardian");
  fixture.canViewFinance = false;
  fixture.additionalLessons.push(...historyFixtures);
  await page.clock.setFixedTime(new Date("2026-11-23T17:00:00Z"));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(historyPath);

  const history = lessonHistory(page);
  const processing = history.getByRole("link", { name: new RegExp(topic) });
  await expectReadableRow(processing, ["scheduled"]);
  await expect(history.getByText("Payment processing")).toHaveCount(0);
  await expect(history.getByText("Paid", { exact: true })).toHaveCount(0);
});

test("lesson history shows its empty state at 320px", async ({
  context,
  page,
}) => {
  const fixture = await installFixture(context, "student");
  fixture.empty = true;
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(historyPath);

  const history = lessonHistory(page);
  await expect(history.getByText("No lesson history yet")).toBeVisible();
  await expect(history.locator(".lesson-history-row")).toHaveCount(0);
});
