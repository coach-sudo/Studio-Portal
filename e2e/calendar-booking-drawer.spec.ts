import {
  expect,
  expectNoHorizontalOverflow,
  requireFixtures,
  test,
} from "./support/fixtures";
import { expectNoSeriousAxeViolations } from "./support/axe";
import { storageStatePath } from "./support/runtime";

test.use({ storageState: storageStatePath("coach") });

test("@visual @mobile @a11y Calendar appointments stay in contextual drawers", async ({
  page,
  runtime,
}, testInfo) => {
  requireFixtures(runtime);
  const ids = runtime.ids!;
  const reference = `${runtime.runId.toUpperCase()}-1`;
  await page.goto("/coach/bookings");
  await page
    .getByLabel("Search lessons")
    .fill(`${runtime.runId} Calendar booking`);
  const appointment = page
    .getByRole("button")
    .filter({ hasText: `${runtime.runId} Calendar booking` })
    .first();
  await expect(appointment).toBeVisible();
  await appointment.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: reference });
  await expect(drawer).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lesson calendar" }),
  ).toBeVisible();
  await expect(drawer.getByText(/\$0.00 paid of \$75.00/)).toBeVisible();
  await expect(
    drawer.getByRole("link", { name: "Open student" }),
  ).toHaveAttribute("href", `/coach/students/${ids.referredPending}`);
  await expect(
    drawer.getByRole("link", { name: "Open lesson", exact: true }).first(),
  ).toHaveAttribute(
    "href",
    `/coach/students/${ids.referredPending}/lessons/${ids.calendarLesson}`,
  );
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
  await page.screenshot({
    path: testInfo.outputPath("calendar-booking-drawer.png"),
  });
  if (testInfo.project.name === "mobile-chromium") {
    const bounds = await drawer.boundingBox();
    expect(bounds!.x).toBe(0);
    expect(bounds!.width).toBe(page.viewportSize()!.width);
    expect(bounds!.height).toBe(page.viewportSize()!.height);
  }
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press(key);
      expect(
        await drawer.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    }
  }
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(appointment).toBeFocused();
  await expect(page).toHaveURL(/\/coach\/bookings$/);

  for (const query of [
    `booking=${ids.bookingPending}`,
    `lesson=${ids.calendarLesson}`,
  ]) {
    await page.goto(`/coach/bookings?${query}`);
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "Done" }).click();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/\/coach\/bookings$/);
  }
  await page.goto(`/coach/bookings?lesson=${ids.lessonPending}`);
  const lesson = page.getByRole("dialog", {
    name: `${runtime.runId} Meet pending`,
  });
  await expect(lesson).toBeVisible();
  await expect(lesson.getByRole("button", { name: "Refund" })).toHaveCount(0);
  await expect(
    lesson.getByRole("link", { name: "Open lesson", exact: true }).first(),
  ).toHaveAttribute(
    "href",
    `/coach/students/${ids.student}/lessons/${ids.lessonPending}`,
  );
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page);
  await page.screenshot({
    path: testInfo.outputPath("calendar-lesson-drawer.png"),
  });
  await page.keyboard.press("Escape");
  await expect(lesson).toBeHidden();
});
