import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { queueBookingEmails } from "./booking-email";
import { ensureBookingPortalAccess } from "./portal-access";

type Effect = {
  status: string;
  claim_token: string;
  subscription_id: string;
  customer_id: string | null;
  currency: string;
  rounding_minor: number;
  rounding_reference: string | null;
  cancel_required: boolean;
  cancel_done: boolean;
  notify_booking: string | null;
  manage_token: string | null;
  notify_done: boolean;
  first_attempt_at: string;
};
// Less than Stripe API v1's minimum 24-hour retention, measured from the first
// durable attempt. An unknown rounding result past this window needs review.
const SAFE_RETRY_MS = 23 * 60 * 60 * 1000;
export async function processStripeInstallmentEffects(
  db: SupabaseClient,
  stripe: Stripe,
  invoiceId: string,
) {
  const claim = await db.rpc("claim_stripe_booking_invoice_effect", {
    p_invoice: invoiceId,
  });
  if (claim.error) throw claim.error;
  const effect = claim.data as unknown as Effect;
  if (effect?.status === "completed") return;
  if (effect?.status === "review_required")
    throw new Error(
      "REVIEW_REQUIRED: Unknown provider outcome needs reconciliation.",
    );
  if (effect?.status !== "processing")
    throw new Error(
      "BOOKING_PROCESSING: Another delivery owns the provider effects.",
    );
  const finish = async (step: string, reference: string | null = null) => {
    const result = await db.rpc("finish_stripe_booking_invoice_effect", {
      p_invoice: invoiceId,
      p_token: effect.claim_token,
      p_step: step,
      p_reference: reference ?? undefined,
    });
    if (result.error) throw result.error;
    if (result.data !== true)
      throw new Error("BOOKING_PROCESSING: Provider effect lease changed.");
  };
  let stage = "provider";
  try {
    if (Number(effect.rounding_minor) > 0 && !effect.rounding_reference) {
      if (!effect.customer_id)
        throw new Error(
          "REVIEW_REQUIRED: Rounding adjustment customer is unavailable.",
        );
      if (
        !Number.isFinite(Date.parse(effect.first_attempt_at)) ||
        Date.now() - Date.parse(effect.first_attempt_at) >= SAFE_RETRY_MS
      ) {
        stage = "unknown_outcome";
        throw new Error(
          "REVIEW_REQUIRED: Rounding outcome must be reconciled before another provider write.",
        );
      }
      const item = await stripe.invoiceItems.create(
        {
          customer: effect.customer_id,
          subscription: effect.subscription_id,
          amount: Number(effect.rounding_minor),
          currency: effect.currency.toLowerCase(),
          description: "Final installment rounding adjustment",
          metadata: { studio_invoice_identity: invoiceId },
        },
        { idempotencyKey: `booking-installment-rounding:${invoiceId}` },
      );
      await finish("rounding", item.id);
    }
    if (effect.cancel_required && !effect.cancel_done) {
      const subscription = await stripe.subscriptions.retrieve(
        effect.subscription_id,
      );
      if (subscription.status !== "canceled")
        await stripe.subscriptions.cancel(effect.subscription_id);
      await finish("cancel");
    }
    if (effect.notify_booking && !effect.notify_done) {
      stage = "notification";
      await queueBookingEmails(
        db,
        effect.notify_booking,
        effect.manage_token ?? undefined,
      );
      await ensureBookingPortalAccess(db, effect.notify_booking);
      await finish("notify");
    }
    // Handles a claim whose last unfinished step was completed by this delivery.
    const completed = await db.rpc("claim_stripe_booking_invoice_effect", {
      p_invoice: invoiceId,
    });
    if (completed.error) throw completed.error;
    if ((completed.data as { status?: string } | null)?.status !== "completed")
      throw new Error(
        "BOOKING_PROCESSING: Provider effects have not completed.",
      );
  } catch (error) {
    await finish(stage);
    throw error;
  }
}
