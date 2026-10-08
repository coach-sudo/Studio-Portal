// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import maintenance from "./booking-maintenance";
import webhook from "./stripe-webhook-v2";

const mocks = vi.hoisted(() => ({
  service: vi.fn(),
  item: vi.fn(),
  invoice: vi.fn(),
  event: vi.fn(),
}));
vi.mock("./_shared/supabase", () => ({ serviceClient: mocks.service }));
vi.mock("stripe", () => ({
  default: class {
    invoiceItems = { create: mocks.item };
    invoices = { create: mocks.invoice };
    webhooks = { constructEvent: mocks.event };
  },
}));

function database() {
  const writes: Array<{
    table: string;
    action: string;
    values: Record<string, unknown>;
  }> = [];
  const subscription = {
    id: "agreement",
    student_id: "student",
    package_id: "original-purchase",
    definition_id: "definition",
    billing_option_id: "option",
    stripe_customer_id: "customer",
    renewal_attempt_key: "attempt",
    packages: { credit_quantity: 4, currency: "USD" },
    package_definitions: {
      session_count: 8,
      price_minor: 98765,
      currency: "USD",
    },
  };
  const db = {
    rpc: vi.fn(async (name: string) => ({
      data: name === "claim_package_auto_renewals" ? [subscription] : null,
      error: null,
    })),
    from(table: string) {
      const query: unknown = new Proxy(
        {},
        {
          get(_target, method) {
            if (method === "then")
              // ESLint's base rule also checks names in callback type signatures.
              // eslint-disable-next-line no-unused-vars
              return (resolve: (value: unknown) => unknown) =>
                resolve({ data: [], error: null, count: 0 });
            if (method === "single")
              return async () => ({
                data:
                  table === "packages"
                    ? {
                        name: "Original purchase",
                        price_minor: 36000,
                        currency: "USD",
                      }
                    : table === "package_subscriptions"
                      ? subscription
                      : table === "package_definitions"
                        ? {
                            name: "Edited offer",
                            price_minor: 98765,
                            currency: "USD",
                          }
                        : { stripe_price_id: "price-original" },
                error: null,
              });
            if (method === "maybeSingle")
              return async () => ({ data: null, error: null });
            return (...args: unknown[]) => {
              if (["insert", "upsert", "update"].includes(String(method)))
                writes.push({
                  table,
                  action: String(method),
                  values: args[0] as Record<string, unknown>,
                });
              return query;
            };
          },
        },
      );
      return query;
    },
  };
  mocks.service.mockReturnValue(db);
  return { writes };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("Netlify", {
    env: {
      get: (key: string) =>
        key === "DEPLOY_PRIME_URL"
          ? "https://portal.example.test"
          : "test-only",
    },
  });
  mocks.item.mockResolvedValue({ id: "item" });
  mocks.invoice.mockResolvedValue({ id: "invoice" });
});

describe("existing package renewal agreements", () => {
  it("charges the original purchased price even after the offer price changes", async () => {
    database();
    await maintenance();
    expect(mocks.item).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 36000,
        currency: "usd",
        description: "Original purchase automatic renewal",
      }),
      { idempotencyKey: "package-renewal:agreement:attempt:item" },
    );
    expect(mocks.invoice).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "customer" }),
      { idempotencyKey: "package-renewal:agreement:attempt:invoice" },
    );
  });
  it("credits the purchased quantity rather than an edited definition on a paid renewal", async () => {
    const { writes } = database();
    mocks.event.mockReturnValue({
      id: "event",
      type: "invoice.paid",
      data: {
        object: {
          id: "invoice",
          metadata: { package_subscription_id: "agreement" },
          amount_paid: 36000,
          currency: "usd",
        },
      },
    });
    const response = await webhook(
      new Request("https://portal.example.test/api/stripe", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "test-only" },
      }),
      { requestId: "test" } as never,
    );
    expect(response.status).toBe(200);
    expect(
      writes.find((write) => write.table === "package_credit_entries")?.values,
    ).toEqual(
      expect.objectContaining({
        package_id: "original-purchase",
        quantity: 4,
        idempotency_key: "package-subscription-invoice:invoice",
      }),
    );
    expect(
      writes.find((write) => write.table === "payment_entries")?.values
        .amount_minor,
    ).toBe(36000);
    expect(
      writes.some(
        (write) =>
          write.table === "package_definitions" || write.table === "packages",
      ),
    ).toBe(false);
  });
});
