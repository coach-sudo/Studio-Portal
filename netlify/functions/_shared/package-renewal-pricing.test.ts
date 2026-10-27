// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBookingMaintenance } from "./booking-maintenance";
const maintenance = () =>
  runBookingMaintenance({
    stage() {},
    failure() {
      return { category: "internal", message: "Test error", retryable: true };
    },
    success() {},
  });
import webhook from "../stripe-webhook-v2";

const mocks = vi.hoisted(() => ({
  service: vi.fn(),
  item: vi.fn(),
  invoice: vi.fn(),
  event: vi.fn(),
}));
vi.mock("./supabase", () => ({ serviceClient: mocks.service }));
vi.mock("stripe", () => ({
  default: class {
    invoiceItems = { create: mocks.item };
    invoices = { create: mocks.invoice };
    webhooks = { constructEvent: mocks.event };
  },
}));

function database(paymentError = false) {
  const filters: unknown[][] = [];
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
    renewal_claimed_at: "2026-10-26T12:00:00Z",
    packages: { credit_quantity: 4, currency: "USD" },
    package_definitions: {
      session_count: 8,
      price_minor: 98765,
      currency: "USD",
    },
  };
  const db = {
    rpc: vi.fn(async (name: string) => ({
      data:
        name === "claim_package_auto_renewals"
          ? [subscription]
          : name === "claim_lesson_bulk_items"
            ? []
            : name === "claim_lesson_change_effects"
              ? { effects: [], tracked: true }
              : null,
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
                resolve({
                  data: [],
                  error:
                    paymentError && table === "payment_entries"
                      ? new Error("Renewal receipt unavailable")
                      : null,
                  count: 0,
                });
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
              if (method === "eq") filters.push(args);
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
  return { writes, filters, rpc: db.rpc };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("Netlify", {
    env: {
      get: (key: string) =>
        key.startsWith("WORKER_")
          ? "true"
          : key === "DEPLOY_PRIME_URL"
            ? "https://portal.example.test"
            : "test-only",
    },
  });
  mocks.item.mockResolvedValue({ id: "item" });
  mocks.invoice.mockResolvedValue({ id: "invoice" });
});

describe("existing package renewal agreements", () => {
  it("reports a receipt-write failure and retries through the same atomic fulfillment key", async () => {
    const first = database(true);
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
    const request = () =>
      new Request("https://portal.example.test/api/stripe", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "test-only" },
      });
    expect(
      (await webhook(request(), { requestId: "test" } as never)).status,
    ).toBe(500);
    expect(first.writes).toContainEqual(
      expect.objectContaining({
        table: "webhook_events",
        values: expect.objectContaining({ status: "failed" }),
      }),
    );
    const retry = database();
    expect(
      (await webhook(request(), { requestId: "test" } as never)).status,
    ).toBe(200);
    for (const call of [first.rpc, retry.rpc])
      expect(call).toHaveBeenCalledWith(
        "command_grant_student_credits",
        expect.objectContaining({
          p_key: "package-subscription-invoice:invoice",
        }),
      );
  });
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
    const { writes, rpc } = database();
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
    expect(rpc).toHaveBeenCalledWith("command_grant_student_credits", {
      p_student: "student",
      p_key: "package-subscription-invoice:invoice",
      p_value: {
        packageId: "original-purchase",
        kind: "purchase",
        quantity: 4,
        reason: "Package renewal · invoice",
      },
    });
    expect(
      writes.some((write) => write.table === "package_credit_entries"),
    ).toBe(false);
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

it("containment after renewal claim releases only unstarted matching claims and preserves retry keys", async () => {
  let enabled = true;
  vi.stubGlobal("Netlify", {
    env: {
      get: (key: string) =>
        key.startsWith("WORKER_") ? (enabled ? "true" : "false") : "test-only",
    },
  });
  const { rpc, writes, filters } = database();
  const original = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (name: string) => {
    const response = await original(name);
    if (name === "claim_package_auto_renewals") enabled = false;
    return response;
  });
  await expect(maintenance()).rejects.toThrow("Worker execution is disabled.");
  expect(filters).toContainEqual(["renewal_attempt_key", "attempt"]);
  expect(filters).toContainEqual([
    "renewal_claimed_at",
    "2026-10-26T12:00:00Z",
  ]);
  expect(mocks.item).not.toHaveBeenCalled();
  expect(mocks.invoice).not.toHaveBeenCalled();
  expect(writes).toContainEqual({
    table: "package_subscriptions",
    action: "update",
    values: { renewal_in_flight: false },
  });
  expect(
    writes.some(
      (w) =>
        w.table === "package_subscriptions" &&
        "renewal_attempt_key" in w.values,
    ),
  ).toBe(false);
});
