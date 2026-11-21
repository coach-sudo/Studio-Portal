import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

test("an adult reviews and starts exact lesson balances without an invoice", async ({
  page,
  context,
}) => {
  await installFixture(context, "student");
  const quote = {
    lessonId: ids.lesson,
    studentId: ids.student,
    description: "Private training",
    date: "2031-03-18",
    remainingMinor: 6000,
    paidMinor: 2000,
    currency: "USD",
    terms: "a".repeat(64),
  };
  let submitted: unknown;
  await context.route("**/api/v2/invoices", async (route) => {
    const request = route.request().postDataJSON();
    switch (request?.command) {
      case "training_payers":
        return route.fulfill({
          json: {
            resource: { ready: true, studentIds: [ids.student], attempts: [] },
          },
        });
      case "training_direct_options":
        return route.fulfill({
          json: { resource: { enabled: true, items: [quote] } },
        });
      case "training_start_direct":
        submitted = request.payload;
        return route.fulfill({
          json: { resource: { url: "/synthetic-checkout" } },
        });
      default:
        return route.fallback();
    }
  });
  await context.route("**/synthetic-checkout", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Synthetic checkout</h1>",
    }),
  );
  await page.goto(
    `/portal/payments?pay=lesson&student=${ids.student}&lesson=${ids.lesson}`,
  );
  await expect(
    page.getByText("Balance remaining", { exact: true }),
  ).toBeVisible();
  const balance = page.getByRole("checkbox", { name: /Private training/ });
  await balance.check();
  await page.getByRole("button", { name: "Review payment" }).click();
  const review = page.getByRole("dialog", { name: "Review selected lessons" });
  await expect(review.getByText("$60.00").first()).toBeVisible();
  await review
    .getByRole("button", { name: "Continue to secure checkout" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Synthetic checkout" }),
  ).toBeVisible();
  expect(submitted).toEqual({
    studentId: ids.student,
    items: [
      {
        lessonId: ids.lesson,
        studentId: ids.student,
        amountMinor: 6000,
        currency: "USD",
        terms: quote.terms,
      },
    ],
  });
});
