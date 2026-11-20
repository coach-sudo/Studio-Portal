import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@netlify/functions";
import { payerPaymentSettings } from "./payer-payment-settings";
import { userClient } from "./supabase";

const mocks = vi.hoisted(() => ({
  payers: vi.fn(),
  search: vi.fn(),
  saved: vi.fn(),
  customer: vi.fn(),
  portal: vi.fn(),
  checkout: vi.fn(),
}));
vi.mock("./training-checkout", () => ({ trainingCheckout: mocks.payers }));
vi.mock("./training-autopay", () => ({
  trainingStripe: () => ({
    live: false,
    origin: "https://sandbox.example.test",
    stripe: {
      customers: {
        search: mocks.search,
        listPaymentMethods: mocks.saved,
        create: mocks.customer,
      },
      checkout: { sessions: { create: mocks.checkout } },
      billingPortal: { sessions: { create: mocks.portal } },
    },
  }),
}));
vi.mock("./supabase", () => ({
  userClient: vi.fn(),
  serviceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { settings: { currency: "USD" } } }),
        }),
      }),
    }),
  }),
}));

const payer = "00000000-0000-4000-8000-000000000001";
const student = "00000000-0000-4000-8000-000000000002";
const studio = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";
const request = new Request("https://localhost", {
  headers: { "Idempotency-Key": requestId },
});
const customer = {
  id: "cus_owned",
  livemode: false,
  metadata: { coachd_payment_settings_payer: payer, coachd_studio: studio },
};
const db = {
  auth: { getUser: async () => ({ data: { user: { id: payer } } }) },
  from: () => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: { studio_id: studio } }),
      }),
    }),
  }),
} as unknown as ReturnType<typeof userClient>;
const call = (action: Parameters<typeof payerPaymentSettings>[2]) =>
  payerPaymentSettings(request, {} as Context, action, student, db);

describe("payer payment settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.payers.mockResolvedValue({ studentIds: [student] });
    mocks.search.mockResolvedValue({ data: [customer] });
  });

  it("denies an authenticated schedule-only contact before calling Stripe", async () => {
    mocks.payers.mockResolvedValue({ studentIds: [] });
    await expect(call("payment-settings")).rejects.toThrow("FORBIDDEN");
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.customer).not.toHaveBeenCalled();
  });

  it("does not trust a search result with a different payer", async () => {
    mocks.search.mockResolvedValue({
      data: [{ ...customer, metadata: { coachd_studio: studio } }],
    });
    await expect(call("billing")).rejects.toThrow("FORBIDDEN");
    expect(mocks.portal).not.toHaveBeenCalled();
  });

  it("returns a presence flag without exposing provider identifiers", async () => {
    mocks.saved.mockResolvedValue({ data: [{ id: "pm_private" }] });
    expect(await (await call("payment-settings")).json()).toEqual({
      available: true,
      hasSavedMethod: true,
    });
    expect(mocks.saved).toHaveBeenCalledWith(customer.id, { limit: 1 });
  });

  it("starts setup without taking a charge or changing automatic payment authorization", async () => {
    mocks.search.mockResolvedValue({ data: [] });
    mocks.customer.mockResolvedValue(customer);
    mocks.checkout.mockResolvedValue({
      url: "https://checkout.stripe.com/setup",
    });
    expect(await (await call("payment-method")).json()).toEqual({
      url: "https://checkout.stripe.com/setup",
    });
    expect(mocks.customer).toHaveBeenCalledWith(
      { metadata: customer.metadata },
      { idempotencyKey: `coachd-payer-settings:${studio}:${payer}` },
    );
    expect(mocks.checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "setup",
        customer: customer.id,
        currency: "usd",
      }),
      { idempotencyKey: `coachd-payer-settings-session:${payer}:${requestId}` },
    );
    expect(mocks.portal).not.toHaveBeenCalled();
  });
});
