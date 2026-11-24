import { expect, test, type Locator } from "@playwright/test";
import { ids, installFixture } from "./fixture";

const widths = [320, 375, 390, 428, 768, 1024, 1280, 1440];
const extended = "Extended rehearsal and audition preparation package";
const offers = [30, 60].map((duration) => ({
  id: `70000000-0000-4000-8000-0000000000${duration}`,
  studio_id: ids.studio,
  name: duration === 60 ? extended : "Focused rehearsal package",
  session_count: 4,
  session_duration_minutes: duration,
  price_minor: duration * 400,
  discount_minor: 0,
  currency: "USD",
  expiration_days: 180,
  eligible_service_ids: [],
  meeting_providers: ["google_meet"],
  recurring_eligible: true,
  visibility: "public",
  direct_purchase: true,
  active: true,
  version: 1,
}));

async function fitsWithin(control: Locator, container: Locator) {
  const [item, area] = await Promise.all([
    control.boundingBox(),
    container.boundingBox(),
  ]);
  return Boolean(
    item &&
    area &&
    item.x >= area.x - 1 &&
    item.x + item.width <= area.x + area.width + 1,
  );
}

for (const width of widths) {
  test(`package filters and purchase review fit at ${width}px`, async ({
    context,
    page,
  }, info) => {
    const fixture = await installFixture(context, "student");
    fixture.packageDefinitions.push(...offers);
    fixture.packageBillingOptions.push(
      ...offers.flatMap((offer) =>
        ["one_time", "balance_threshold"].map((mode) => ({
          id: `${offer.id}-${mode}`,
          studio_id: ids.studio,
          definition_id: offer.id,
          renewal_mode: mode,
          balance_threshold: 1,
          active: true,
          version: 1,
        })),
      ),
    );
    await context.route("**/api/v2/invoices", (route) =>
      route.request().postDataJSON()?.command === "training_payers"
        ? route.fulfill({
            json: {
              resource: {
                ready: true,
                studentIds: [ids.student],
                attempts: [],
              },
            },
          })
        : route.fallback(),
    );
    await page.setViewportSize({ width, height: width <= 428 ? 844 : 940 });
    await page.goto(`/portal/payments?student=${ids.student}`);
    const filters = page.locator(".package-purchase-controls");
    const length = page.getByRole("combobox", { name: "Lesson length" });
    const sort = page.getByRole("combobox", { name: "Sort packages" });
    await expect(filters).toBeVisible();
    if ([320, 390, 768, 1440].includes(width)) {
      await filters.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.screenshot({
        path: info.outputPath(`filters-${width}.png`),
        animations: "disabled",
      });
    }
    for (const select of [length, sort]) {
      expect.soft(await fitsWithin(select, filters)).toBe(true);
      const labelWordsAreWhole = await select.evaluate((element) => {
        const text = element.closest("label")?.firstChild;
        if (!text) return false;
        return [...(text.textContent ?? "").matchAll(/\S+/g)].every((word) => {
          const range = new Range();
          range.setStart(text, word.index);
          range.setEnd(text, word.index + word[0].length);
          return range.getClientRects().length === 1;
        });
      });
      expect.soft(labelWordsAreWhole).toBe(true);
    }
    await sort.selectOption("longest");
    const cards = page.locator(".package-offer-list > article");
    await expect(cards.first()).toContainText(extended);
    await length.selectOption("60");
    await expect(cards).toHaveCount(1);
    const choose = cards.getByRole("button", { name: "Choose package" });
    await choose.press("Enter");
    const dialog = page.getByRole("dialog", { name: extended });
    await expect(dialog.getByText("$240.00", { exact: true })).toBeVisible();
    const purchaseOption = dialog.getByRole("combobox", {
      name: "Purchase option",
    });
    await expect(purchaseOption).toHaveValue("one_time");
    await purchaseOption.selectOption("balance_threshold");
    await expect(
      dialog.getByText(/charge the saved payment method/),
    ).toBeVisible();
    expect.soft(await fitsWithin(purchaseOption, dialog)).toBe(true);
    const inset =
      (await purchaseOption.boundingBox())!.x - (await dialog.boundingBox())!.x;
    expect.soft(inset).toBeGreaterThanOrEqual(12);
    const checkout = dialog.getByRole("button", {
      name: "Continue to secure checkout",
    });
    await expect(checkout).toBeEnabled();
    expect.soft(await fitsWithin(checkout, dialog)).toBe(true);
    if ([320, 390, 768, 1440].includes(width))
      await page.screenshot({
        path: info.outputPath(`purchase-${width}.png`),
        animations: "disabled",
      });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(choose).toBeFocused();
    expect(fixture.commands).not.toContain("checkout_definition");
  });
}
