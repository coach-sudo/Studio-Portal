// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import webhook from "../stripe-webhook-v2";
const h = vi.hoisted(() => ({
  eventId: "evt_synthetic",
  setupMode: false,
  failCancel: true,
  failLedger: false,
  loseCommitResponse: false,
  failDone: false,
  booking: {
    id: "synthetic-booking",
    payment_policy: "installments",
    paid_minor: 6000,
    installments_paid: 1,
    installment_count: 2,
  },
  events: new Map<string, Record<string, unknown>>(),
  receipts: new Map<string, Record<string, unknown>>(),
  payments: new Map<string, number>(),
  effect: {} as Record<string, unknown>,
  cancel: vi.fn(),
  rounding: vi.fn(),
  notify: vi.fn(),
  portal: vi.fn(),
  subscriptionStatus: "active",
  calls: [] as string[],
}));
vi.mock("stripe", () => ({
  default: class {
    webhooks = {
      constructEvent: () =>
        h.setupMode
          ? {
              id: h.eventId,
              type: "checkout.session.completed",
              data: {
                object: {
                  id: "cs_synthetic_setup",
                  mode: "setup",
                  metadata: {},
                },
              },
            }
          : {
              id: h.eventId,
              type: "invoice.paid",
              data: {
                object: {
                  id: "in_synthetic",
                  amount_paid: 6000,
                  currency: "usd",
                  customer: "cus_synthetic",
                  parent: {
                    subscription_details: {
                      subscription: "sub_synthetic",
                      metadata: { booking_id: "synthetic-booking" },
                    },
                  },
                },
              },
            },
    };
    subscriptions = {
      retrieve: async () => ({ status: h.subscriptionStatus }),
      cancel: h.cancel,
    };
    invoiceItems = { create: h.rounding };
  },
}));
vi.mock("./booking-email", () => ({
  queueBookingEmails: h.notify,
  queueLessonChangeEmails: vi.fn(),
  queuePaymentFailedEmail: vi.fn(),
}));
vi.mock("./portal-access", () => ({ ensureBookingPortalAccess: h.portal }));
vi.mock("./supabase", () => ({
  serviceClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push(name);
      if (name === "settle_stripe_booking_invoice") {
        const value = args.p_value as Record<string, unknown>;
        const prior = h.receipts.get(String(value.invoiceId));
        if (prior) return { data: prior, error: null };
        if (h.failLedger)
          return {
            data: null,
            error: { message: "Synthetic ledger insert failure" },
          };
        h.booking.paid_minor += Number(value.amountMinor);
        h.booking.installments_paid++;
        h.payments.set(String(value.invoiceId), Number(value.amountMinor));
        const result = {
          paidMinor: h.booking.paid_minor,
          installmentsPaid: h.booking.installments_paid,
        };
        h.receipts.set(String(value.invoiceId), result);
        if (h.loseCommitResponse) {
          h.loseCommitResponse = false;
          throw new Error("Synthetic lost transaction response");
        }
        return { data: result, error: null };
      }
      if (name === "claim_stripe_booking_invoice_effect") {
        if (h.effect.status === "pending") h.effect.status = "processing";
        if (
          (Number(h.effect.rounding_minor) === 0 ||
            h.effect.rounding_reference) &&
          h.effect.cancel_done &&
          h.effect.notify_done
        )
          h.effect.status = "completed";
        return { data: { ...h.effect }, error: null };
      }
      if (name === "finish_stripe_booking_invoice_effect") {
        if (args.p_step === "cancel") h.effect.cancel_done = true;
        if (args.p_step === "notify") h.effect.notify_done = true;
        if (args.p_step === "provider" || args.p_step === "notification")
          h.effect.status = "pending";
        if (args.p_step === "rounding")
          h.effect.rounding_reference = args.p_reference;
        if (args.p_step === "unknown_outcome")
          h.effect.status = "review_required";
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table: string) => {
      let operation = "read",
        value: Record<string, unknown> = {},
        eventId = h.eventId;
      const result = () => {
        if (table === "webhook_events") {
          if (operation !== "read") {
            if (value.status === "processed" && h.failDone) {
              h.failDone = false;
              return {
                data: null,
                error: { message: "Synthetic receipt acknowledgement failure" },
              };
            }
            h.events.set(eventId, { ...h.events.get(eventId), ...value });
          }
          return { data: h.events.get(eventId) ?? null, error: null };
        }
        if (table === "bookings") {
          if (operation !== "read")
            throw new Error(
              "Canonical financial writes must use the transaction",
            );
          return { data: { ...h.booking }, error: null };
        }
        throw new Error(`Unexpected table ${table}`);
      };
      const q = {
        select: () => q,
        eq: (_key: string, id: string) => {
          if (table === "webhook_events") eventId = id;
          return q;
        },
        insert: (next: Record<string, unknown>) => {
          operation = "insert";
          value = next;
          return q;
        },
        update: (next: Record<string, unknown>) => {
          operation = "update";
          value = next;
          return q;
        },
        maybeSingle: async () => result(),
        then: (resolve: Parameters<Promise<unknown>["then"]>[0]) =>
          Promise.resolve(result()).then(resolve),
      };
      return q;
    },
  }),
}));
beforeEach(() => {
  h.events.clear();
  h.receipts.clear();
  h.payments.clear();
  h.calls = [];
  h.eventId = "evt_synthetic";
  h.setupMode = false;
  h.failCancel = true;
  h.failLedger = false;
  h.loseCommitResponse = false;
  h.failDone = false;
  h.subscriptionStatus = "active";
  h.notify.mockReset().mockResolvedValue([]);
  h.portal.mockReset().mockResolvedValue({ accounts: [] });
  h.booking.paid_minor = 6000;
  h.booking.installments_paid = 1;
  h.effect = {
    status: "processing",
    claim_token: "synthetic-claim",
    subscription_id: "sub_synthetic",
    customer_id: "cus_synthetic",
    currency: "USD",
    rounding_minor: 0,
    rounding_reference: null,
    cancel_required: true,
    cancel_done: false,
    notify_booking: null,
    notify_done: true,
    first_attempt_at: new Date().toISOString(),
  };
  h.cancel.mockReset().mockImplementation(async () => {
    if (h.failCancel) throw new Error("Synthetic provider outage");
    return { status: "canceled" };
  });
  h.rounding.mockReset().mockResolvedValue({ id: "ii_synthetic" });
  vi.stubGlobal("Netlify", { env: { get: () => "synthetic" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const call = () =>
  webhook(
    new Request("https://isolated.example.test", {
      method: "POST",
      body: "synthetic signature fixture",
      headers: { "stripe-signature": "synthetic" },
    }),
    { requestId: "synthetic-installment" } as never,
  );
it("provider failure and same/different event replay add one financial effect", async () => {
  expect((await call()).status).toBe(500);
  expect(h.booking).toMatchObject({ paid_minor: 12000, installments_paid: 2 });
  h.failCancel = false;
  expect((await call()).status).toBe(200);
  h.eventId = "evt_synthetic_second";
  expect((await call()).status).toBe(200);
  expect(h.booking).toMatchObject({ paid_minor: 12000, installments_paid: 2 });
  expect(h.payments.size).toBe(1);
  expect(h.receipts.size).toBe(1);
});
it("a lost committed response replays without incrementing again", async () => {
  h.loseCommitResponse = true;
  h.failCancel = false;
  expect((await call()).status).toBe(500);
  expect((await call()).status).toBe(200);
  expect(h.booking.paid_minor).toBe(12000);
  expect(h.payments.size).toBe(1);
});
it("ledger rejection never changes the booking or starts provider work", async () => {
  h.failLedger = true;
  expect((await call()).status).toBe(500);
  expect(h.booking.paid_minor).toBe(6000);
  expect(h.booking.installments_paid).toBe(1);
  expect(h.payments.size).toBe(0);
  expect(h.cancel).not.toHaveBeenCalled();
});
it("a failed webhook acknowledgement retries only the saved logical result", async () => {
  h.failCancel = false;
  h.failDone = true;
  expect((await call()).status).toBe(500);
  expect((await call()).status).toBe(200);
  expect(h.booking.paid_minor).toBe(12000);
  expect(h.cancel).toHaveBeenCalledTimes(1);
});
it("rounding uses one durable identity and stops unknown outcomes beyond its retry window", async () => {
  h.effect.rounding_minor = 1;
  h.effect.cancel_required = false;
  h.effect.cancel_done = true;
  expect((await call()).status).toBe(200);
  expect(h.rounding).toHaveBeenCalledWith(
    expect.objectContaining({
      amount: 1,
      metadata: { studio_invoice_identity: "in_synthetic" },
    }),
    { idempotencyKey: "booking-installment-rounding:in_synthetic" },
  );
  h.events.clear();
  h.effect.status = "processing";
  h.effect.rounding_reference = null;
  h.effect.first_attempt_at = new Date(Date.now() - 25 * 3600000).toISOString();
  expect((await call()).status).toBe(409);
  expect(h.effect.status).toBe("review_required");
  expect(h.rounding).toHaveBeenCalledTimes(1);
});
it("notification failure retains recovery independently of the committed installment", async () => {
  h.failCancel = false;
  h.effect.notify_booking = "synthetic-booking";
  h.effect.notify_done = false;
  h.notify.mockRejectedValueOnce(new Error("Synthetic queue unavailable"));
  expect((await call()).status).toBe(500);
  expect(h.effect.status).toBe("pending");
  expect(h.effect.notify_done).toBe(false);
  expect((await call()).status).toBe(200);
  expect(h.booking.paid_minor).toBe(12000);
  expect(h.payments.size).toBe(1);
  expect(h.notify).toHaveBeenCalledTimes(2);
});
it("an unknown cancellation response is reconciled through subscription state", async () => {
  h.subscriptionStatus = "canceled";
  expect((await call()).status).toBe(200);
  expect(h.cancel).not.toHaveBeenCalled();
  expect(h.effect.cancel_done).toBe(true);
});
it("setup-mode checkout acknowledges without purchasing or settling an installment", async () => {
  h.setupMode = true;
  expect((await call()).status).toBe(200);
  expect(h.calls).toEqual([]);
  expect(h.payments.size).toBe(0);
  expect(h.cancel).not.toHaveBeenCalled();
  expect(h.notify).not.toHaveBeenCalled();
});
