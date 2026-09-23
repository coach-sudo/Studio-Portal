import {
  expect,
  expectNoHorizontalOverflow,
  requireFixtures,
  test,
} from "./support/fixtures";
import { expectNoSeriousAxeViolations } from "./support/axe";
import { storageStatePath } from "./support/runtime";

test.describe("student product-review evidence", () => {
  test.use({ storageState: storageStatePath("student") });

  test("@visual @mobile captures the connected student surfaces", async ({
    page,
    runtime,
  }, testInfo) => {
    requireFixtures(runtime);
    const routes = [
      ["home", "/portal"],
      ["schedule", "/portal/bookings"],
      ["lesson", `/portal/lessons/${runtime.ids?.lessonPending}`],
      ["payments", "/portal/payments"],
      ["referrals", "/portal/referrals"],
      ["settings", "/portal/settings"],
      ["actor-editor", "/portal/actor-page"],
    ] as const;
    for (const [name, route] of routes) {
      await page.goto(route);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (name === "actor-editor") {
        await page.getByRole("button", { name: "Edit" }).click();
        await expect(
          page.getByRole("dialog", { name: "Edit actor profile" }),
        ).toBeVisible();
      }
      if (name === "settings") {
        if (testInfo.project.name === "mobile-chromium") {
          await expect(
            page
              .getByRole("navigation", { name: "Settings sections" })
              .getByRole("link", { name: "Preferences & notifications" }),
          ).toBeInViewport();
        }
        await page.getByRole("combobox", { name: "Timezone" }).fill("Eastern");
        const option = page.getByRole("option", { name: /America\/New York/ });
        await expect(option).toBeVisible();
        if (testInfo.project.name === "mobile-chromium") {
          await expect
            .poll(async () =>
              page.evaluate(() => {
                const option = document.querySelector('[role="option"]')!;
                const navigation = document.querySelector(".mobile-nav")!;
                return (
                  option.getBoundingClientRect().top >= 0 &&
                  option.getBoundingClientRect().bottom <=
                    navigation.getBoundingClientRect().top
                );
              }),
            )
            .toBe(true);
        }
      }
      if (name === "referrals") {
        await expect(page.getByLabel("Your referral link")).toHaveValue(
          /\/book\?ref=/,
        );
      }
      if (name === "payments" && testInfo.project.name === "mobile-chromium") {
        const amount = page.locator(".payment-history-amount").first();
        await expect(amount).toBeVisible();
        const bounds = await amount.boundingBox();
        expect(bounds?.width).toBeGreaterThan(40);
        expect(bounds?.height).toBeLessThan(35);
      }
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    }

    await page.goto("/portal/inbox");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    if (!(await page.getByLabel("Message").isVisible())) {
      await page
        .getByRole("complementary", { name: "Conversations" })
        .getByRole("button", { name: /Acting Coach/ })
        .click();
    }
    await expect(page.getByLabel("Message")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (testInfo.project.name === "mobile-chromium") {
      const { sendBottom, navTop } = await page.evaluate(() => ({
        sendBottom: document
          .querySelector(".inbox-composer button")!
          .getBoundingClientRect().bottom,
        navTop: document.querySelector(".mobile-nav")!.getBoundingClientRect()
          .top,
      }));
      expect(sendBottom).toBeLessThanOrEqual(navTop);
      await expectNoSeriousAxeViolations(page);
    }
    await page.screenshot({ path: testInfo.outputPath("inbox.png") });
  });
});

test.describe("guardian product-review evidence", () => {
  test.use({ storageState: storageStatePath("guardian") });

  test("@visual @mobile captures persistent household context", async ({
    page,
    runtime,
  }, testInfo) => {
    requireFixtures(runtime);
    for (const [name, route] of [
      ["home", "/portal"],
      ["schedule", "/portal/bookings"],
    ] as const) {
      await page.goto(route);
      await expect(page.getByLabel("Household context")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`guardian-${name}.png`),
      });
    }
  });
});

test.describe("coach product-review evidence", () => {
  test.use({ storageState: storageStatePath("coach") });

  test("@visual @mobile captures the student record and contextual lesson actions", async ({
    page,
    runtime,
  }, testInfo) => {
    requireFixtures(runtime);
    const student = runtime.ids?.student;
    const lesson = runtime.ids?.lessonPending;
    expect(student).toBeTruthy();
    expect(lesson).toBeTruthy();
    await page.goto(`/coach/students/${student}`);
    await expect(
      page.getByRole("heading", { name: `${runtime.runId} Student` }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("coach-student.png") });

    await page.goto(`/coach/students/${student}/lessons/${lesson}`);
    await expect(page.getByRole("button", { name: "Add note" })).toBeVisible();
    await expect(page.locator(".lesson-facts")).toHaveCSS("display", "grid");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("coach-lesson.png") });
    for (const [action, dialog, filename] of [
      ["Add note", "New note", "coach-note"],
      ["Assign practice", "Assign practice", "coach-practice"],
      ["Attach resource", "Add material", "coach-material"],
    ] as const) {
      await page.getByRole("button", { name: action }).click();
      const workflow = page.getByRole("dialog", { name: dialog });
      await expect(workflow.getByLabel("Related lesson")).toHaveValue(lesson!);
      await page.screenshot({ path: testInfo.outputPath(`${filename}.png`) });
      await page.keyboard.press("Escape");
      await expect(workflow).toBeHidden();
    }
  });
});
