import { openAs, accessToken } from "./support/auth";
import { expectNoSeriousAxeViolations } from "./support/axe";
import {
  test,
  expect,
  requireFixtures,
  expectNoHorizontalOverflow,
} from "./support/fixtures";
test("@journey @a11y coach reviews one recurring occurrence, preserves shared booking, and portal actors cannot forge changes", async ({
  browser,
  runtime,
}, testInfo) => {
  requireFixtures(runtime);
  const coach = await openAs(browser, "coach"),
    student = await openAs(browser, "student");
  const ids = runtime.ids!;
  try {
    await coach.page.goto(
      `/coach/students/${ids.occurrenceStudent}/lessons/${ids.occurrenceFirst}`,
    );
    const headers = {
      Authorization: `Bearer ${await accessToken(coach.page)}`,
    };
    const read = async (table: string, id: string) => {
      const response = await coach.context.request.get(
        `${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=*`,
        { headers: { ...headers, apikey: process.env.SUPABASE_ANON_KEY! } },
      );
      expect(response.ok()).toBeTruthy();
      return (await response.json())[0];
    };
    const next = await read("lessons", ids.occurrenceNext),
      booking = await read("bookings", ids.occurrenceBooking);
    await coach.page
      .getByText("Payment, credits & lesson administration", { exact: true })
      .click();
    await coach.page
      .getByRole("button", { name: "Cancel lesson", exact: true })
      .click();
    const dialog = coach.page.getByRole("dialog");
    await expect(dialog.getByLabel("Change scope")).toHaveValue("occurrence");
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Erroneous individual occurrence");
    await dialog
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    await expect(
      dialog.getByRole("region", { name: "Reviewed occurrences" }),
    ).toContainText("1 occurrence.");
    await expect(dialog).toContainText("Recurring generation continues.");
    await expectNoSeriousAxeViolations(coach.page);
    await expectNoHorizontalOverflow(coach.page);
    await coach.page.screenshot({
      path: testInfo.outputPath("occurrence-review-desktop.png"),
      fullPage: true,
    });
    await coach.page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(coach.page);
    await coach.page.screenshot({
      path: testInfo.outputPath("occurrence-review-mobile.png"),
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Confirm cancellation", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect((await read("lessons", ids.occurrenceFirst)).status).toBe(
      "cancelled",
    );
    expect(await read("lessons", ids.occurrenceNext)).toEqual(next);
    expect(await read("bookings", ids.occurrenceBooking)).toEqual(booking);
    expect((await read("recurring_series", ids.occurrenceSeries)).status).toBe(
      "active",
    );
    await student.page.goto("/portal/bookings");
    const denied = await student.context.request.post("/api/v2/lessons", {
      headers: { Authorization: `Bearer ${await accessToken(student.page)}` },
      data: {
        command: "preview_change",
        entityId: ids.occurrenceNext,
        expectedVersion: next.version,
        idempotencyKey: crypto.randomUUID(),
        reason: "Forged coach cancellation",
        payload: { action: "cancel", scope: "occurrence" },
      },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await coach.context.close();
    await student.context.close();
  }
});
