import { describe, expect, it, vi } from "vitest";
import { assertPackageQuote, packageStripePrice } from "./package-stripe-price";

describe("immutable Stripe package prices", () => {
  const quote = { price_minor: 28800, currency: "USD" };
  function client(amount = 36000, recurring: unknown = null) {
    return {
      prices: {
        retrieve: vi.fn().mockResolvedValue({
          id: "price-original",
          product: "product-package",
          unit_amount: amount,
          currency: "usd",
          recurring,
          metadata: { package_definition_id: "definition" },
        }),
        create: vi.fn().mockResolvedValue({ id: "price-quoted" }),
      },
    };
  }
  it("creates a separate price with the quoted amount without updating the original", async () => {
    const stripe = client();
    expect(
      await packageStripePrice(
        stripe as never,
        "price-original",
        quote,
        "checkout-key",
      ),
    ).toBe("price-quoted");
    expect(stripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        product: "product-package",
        unit_amount: 28800,
        currency: "usd",
      }),
      { idempotencyKey: "checkout-key:price" },
    );
  });
  it("preserves the chosen recurring interval for a new agreement", async () => {
    const stripe = client(36000, { interval: "week", interval_count: 2 });
    await packageStripePrice(
      stripe as never,
      "price-original",
      quote,
      "checkout-key",
    );
    expect(stripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recurring: { interval: "week", interval_count: 2 },
      }),
      expect.anything(),
    );
  });
  it("reuses an existing matching price", async () => {
    const stripe = client(28800);
    expect(
      await packageStripePrice(
        stripe as never,
        "price-original",
        quote,
        "checkout-key",
      ),
    ).toBe("price-original");
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });
  it("fails rather than charging an old price when Stripe cannot create the quote", async () => {
    const stripe = client();
    stripe.prices.create.mockRejectedValue(new Error("Stripe unavailable"));
    await expect(
      packageStripePrice(
        stripe as never,
        "price-original",
        quote,
        "checkout-key",
      ),
    ).rejects.toThrow("Stripe unavailable");
  });
  it("requires review when a displayed price or currency changes", () => {
    expect(() =>
      assertPackageQuote(quote, {
        expectedPriceMinor: 36000,
        expectedCurrency: "USD",
      }),
    ).toThrow("Refresh and review");
    expect(() =>
      assertPackageQuote(quote, {
        expectedPriceMinor: 28800,
        expectedCurrency: "EUR",
      }),
    ).toThrow("Refresh and review");
    expect(() =>
      assertPackageQuote(quote, {
        expectedPriceMinor: 28800,
        expectedCurrency: "USD",
      }),
    ).not.toThrow();
  });
});
