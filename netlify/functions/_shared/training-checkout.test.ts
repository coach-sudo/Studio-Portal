import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { reconcileTrainingCheckoutEvent } from "./training-checkout";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabase", () => ({ serviceClient: () => ({ rpc }) }));
const retrieve = vi.fn();
const stripe = { checkout: { sessions: { retrieve } } } as unknown as Stripe;
function session(fields: Partial<Stripe.Checkout.Session> = {}) {
  return {
    id: "cs_test_checkout",
    mode: "payment",
    livemode: false,
    client_reference_id: "attempt",
    metadata: { training_checkout_id: "attempt" },
    amount_total: 8000,
    currency: "usd",
    status: "complete",
    payment_status: "unpaid",
    payment_intent: { id: "pi_test", status: "processing" },
    ...fields,
  } as Stripe.Checkout.Session;
}

beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockResolvedValue({ data: {} });
});

it("settles the authoritative paid state when a delayed unpaid event arrives", async () => {
  retrieve.mockResolvedValue(session({ payment_status: "paid" }));
  await reconcileTrainingCheckoutEvent(
    stripe,
    session(),
    "checkout.session.async_payment_failed",
    false,
  );
  expect(rpc).toHaveBeenCalledWith(
    "training_lesson_checkout",
    expect.objectContaining({ p_action: "settle" }),
  );
});

it("keeps processing reserved when a failure event conflicts with the current intent", async () => {
  retrieve.mockResolvedValue(session());
  await reconcileTrainingCheckoutEvent(
    stripe,
    session(),
    "checkout.session.async_payment_failed",
    false,
  );
  expect(rpc).toHaveBeenCalledWith(
    "training_lesson_checkout",
    expect.objectContaining({ p_action: "attach" }),
  );
});

it("releases a verified expired session or terminal asynchronous failure", async () => {
  retrieve.mockResolvedValueOnce(session({ status: "expired" }));
  await reconcileTrainingCheckoutEvent(
    stripe,
    session(),
    "checkout.session.expired",
    false,
  );
  expect(rpc).toHaveBeenLastCalledWith(
    "training_lesson_checkout",
    expect.objectContaining({ p_action: "expire" }),
  );
  retrieve.mockResolvedValueOnce(
    session({
      payment_intent: {
        id: "pi_test",
        status: "requires_payment_method",
      } as Stripe.PaymentIntent,
    }),
  );
  await reconcileTrainingCheckoutEvent(
    stripe,
    session(),
    "checkout.session.async_payment_failed",
    false,
  );
  expect(rpc).toHaveBeenLastCalledWith(
    "training_lesson_checkout",
    expect.objectContaining({ p_action: "fail" }),
  );
});

it("refuses a provider read that resolves to a different checkout identity", async () => {
  retrieve.mockResolvedValue(
    session({ metadata: { training_checkout_id: "different" } }),
  );
  await expect(
    reconcileTrainingCheckoutEvent(
      stripe,
      session(),
      "checkout.session.completed",
      false,
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  expect(rpc).not.toHaveBeenCalled();
});
