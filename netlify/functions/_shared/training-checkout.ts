import Stripe from "stripe";
import { serviceClient } from "./supabase";

type CheckoutOperation =
  | "payers"
  | "reserve"
  | "reserve_direct"
  | "direct_options"
  | "begin_direct_provider"
  | "cancel_unstarted"
  | "read"
  | "attach"
  | "settle"
  | "expire"
  | "fail"
  | "review";

export interface TrainingCheckout {
  id: string;
  status: "reserved" | "settled" | "expired" | "failed" | "review";
  amount_minor: number;
  currency: string;
  return_student_id: string;
  stripe_session_id?: string;
  provider_started_at?: string | null;
  created_at: string;
  allocations: {
    kind?: "direct";
    invoiceNumber?: string;
    description: string;
    date: string;
    lessonId: string;
    studentId: string;
    amountMinor: number;
  }[];
}

export async function trainingCheckout<T>(
  action: CheckoutOperation,
  payload: Record<string, unknown>,
) {
  const result = await serviceClient().rpc("training_lesson_checkout", {
    p_action: action,
    p_value: payload,
  });
  if (result.error) throw result.error;
  return result.data as T;
}

export async function reconcileTrainingCheckout(
  session: Stripe.Checkout.Session,
  failed = false,
  live = false,
) {
  const id = session.metadata?.training_checkout_id;
  if (
    !id ||
    session.mode !== "payment" ||
    session.livemode !== live ||
    session.client_reference_id !== id
  ) {
    throw new Error(
      "VALIDATION_FAILED: The checkout does not match a lesson payment.",
    );
  }
  return trainingCheckout<TrainingCheckout>(
    session.payment_status === "paid"
      ? "settle"
      : session.status === "expired"
        ? "expire"
        : failed
          ? "fail"
          : "attach",
    {
      id,
      session: session.id,
      currency: session.currency,
      amountMinor: session.amount_total,
      intent:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id,
    },
  );
}

export async function reconcileTrainingCheckoutEvent(
  stripe: Stripe,
  snapshot: Stripe.Checkout.Session,
  eventType: string,
  live: boolean,
) {
  const session = await stripe.checkout.sessions.retrieve(snapshot.id, {
    expand: ["payment_intent"],
  });
  if (
    session.id !== snapshot.id ||
    session.metadata?.training_checkout_id !==
      snapshot.metadata?.training_checkout_id
  )
    throw new Error("VERSION_CONFLICT: Stripe checkout identity changed.");
  const intent = session.payment_intent;
  const failed =
    eventType === "checkout.session.async_payment_failed" &&
    session.status === "complete" &&
    intent !== null &&
    typeof intent === "object" &&
    ["canceled", "requires_payment_method"].includes(intent.status);
  return reconcileTrainingCheckout(session, failed, live);
}
