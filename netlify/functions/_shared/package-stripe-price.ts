import type Stripe from "stripe";

/** Stripe prices are immutable. A new quote must not change a shared catalog price or subscription. */
export async function packageStripePrice(
  stripe: Stripe,
  sourcePriceId: string,
  quote: { price_minor: number; currency: string },
  idempotencyKey: string,
) {
  const source = await stripe.prices.retrieve(sourcePriceId);
  if (
    source.unit_amount === Number(quote.price_minor) &&
    source.currency === String(quote.currency).toLowerCase()
  )
    return source.id;
  const product =
    typeof source.product === "string" ? source.product : source.product.id;
  const interval = source.recurring?.interval;
  if (interval && !["day", "week", "month", "year"].includes(interval))
    throw new Error("Package renewal interval is unavailable.");
  const price = await stripe.prices.create(
    {
      product,
      unit_amount: Number(quote.price_minor),
      currency: String(quote.currency).toLowerCase(),
      ...(source.recurring
        ? {
            recurring: {
              interval: interval as "day" | "week" | "month" | "year",
              interval_count: source.recurring.interval_count,
            },
          }
        : {}),
      metadata: source.metadata,
    },
    { idempotencyKey: `${idempotencyKey}:price` },
  );
  return price.id;
}

export function assertPackageQuote(
  quote: { price_minor: number; currency: string },
  payload: Record<string, unknown>,
) {
  if (
    payload.expectedPriceMinor !== undefined &&
    (Number(payload.expectedPriceMinor) !== Number(quote.price_minor) ||
      payload.expectedCurrency !== quote.currency)
  ) {
    throw new Error(
      "VALIDATION_FAILED: Package pricing changed. Refresh and review the current price before continuing.",
    );
  }
}
