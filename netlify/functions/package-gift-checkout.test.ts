// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import handler from "./package-gifts";

const mocks = vi.hoisted(() => ({
  service: vi.fn(),
  quote: vi.fn(),
  price: vi.fn(),
  checkout: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("./_shared/supabase", () => ({ serviceClient: mocks.service }));
vi.mock("./_shared/package-pricing", () => ({
  quotePackageDefinition: mocks.quote,
}));
vi.mock("./_shared/package-stripe-price", async (original) => ({
  ...(await original<typeof import("./_shared/package-stripe-price")>()),
  packageStripePrice: mocks.price,
}));
vi.mock("./_shared/portal-url", () => ({
  portalOrigin: () => "https://example.test",
}));
vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: mocks.checkout } };
  },
}));

const definitionId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("Netlify", { env: { get: () => "sk_test_fixture" } });
  mocks.quote.mockResolvedValue({ price_minor: 40000, currency: "USD" });
  mocks.price.mockResolvedValue("price-current");
  mocks.checkout.mockResolvedValue({
    id: "checkout",
    url: "https://checkout.example.test",
  });
  mocks.service.mockReturnValue({
    rpc: async () => ({ data: true, error: null }),
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        insert(values: unknown) {
          mocks.insert(values);
          return query;
        },
        update: () => query,
        single: async () => ({
          data:
            table === "package_gifts"
              ? { id: "gift" }
              : {
                  id: definitionId,
                  studio_id: "studio",
                  giftable: true,
                  active: true,
                  visibility: "public",
                  direct_purchase: true,
                  stripe_price_id: "price-original",
                },
          error: null,
        }),
      };
      return query;
    },
  });
});

async function create(expected: Record<string, unknown>) {
  return handler(
    new Request("https://example.test/api/package-gifts/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        definitionId,
        purchaserName: "Purchaser",
        purchaserEmail: "buyer@example.test",
        recipientName: "Recipient",
        recipientEmail: "recipient@example.test",
        message: "Enjoy your lessons!",
        ...expected,
      }),
    }),
    { params: { action: "create" }, requestId: "test" } as never,
  );
}

it.each([
  { expectedPriceMinor: 36000, expectedCurrency: "USD" },
  { expectedPriceMinor: 40000, expectedCurrency: "EUR" },
  {},
])(
  "rejects an outdated or missing displayed gift quote before any purchase writes: %j",
  async (expected) => {
    const response = await create(expected);
    expect(response.status).toBe(422);
    expect((await response.json()).message).toContain(
      "Refresh and review the current price",
    );
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.price).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  },
);

it("creates Checkout only for the price the purchaser reviewed and preserves the gift message", async () => {
  const response = await create({
    expectedPriceMinor: 40000,
    expectedCurrency: "USD",
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url: "https://checkout.example.test",
  });
  expect(mocks.insert).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Enjoy your lessons!" }),
  );
  expect(mocks.checkout).toHaveBeenCalledWith(
    expect.objectContaining({
      line_items: [{ price: "price-current", quantity: 1 }],
      metadata: expect.objectContaining({
        package_price_minor: "40000",
        package_currency: "USD",
      }),
    }),
    expect.anything(),
  );
});
