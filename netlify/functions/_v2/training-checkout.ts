import Stripe from "stripe";
import { z } from "zod";
import { json } from "../_shared/http";
import { portalOrigin } from "../_shared/portal-url";
import {
  reconcileTrainingCheckout,
  trainingCheckout,
  type TrainingCheckout,
} from "../_shared/training-checkout";
import type { V2CommandContext } from "./types";
import { trainingAutopayPreview } from "./training-autopay-preview";

const paySelection = z
  .object({
    studentId: z.uuid(),
    items: z
      .array(
        z
          .object({
            invoiceId: z.uuid(),
            invoiceVersion: z.number().int().nonnegative(),
            lineId: z.uuid(),
            lessonId: z.uuid(),
            amountMinor: z.number().int().positive().max(99999999),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

function testStripeKey() {
  const key = Netlify.env.get("STRIPE_SECRET_KEY");
  return Netlify.env.get("TRAINING_CHECKOUT_TEST_MODE") === "true" &&
    key &&
    /^(sk|rk)_test_/.test(key)
    ? key
    : null;
}

export async function handleTrainingCheckout({
  input,
  db,
  context,
}: V2CommandContext): Promise<Response> {
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error("FORBIDDEN");
  const actor = data.user.id;
  if (input.command === "training_autopay_preview")
    return trainingAutopayPreview(actor, input.payload);
  const key = testStripeKey();

  if (input.command === "training_payers") {
    const { studentIds } = z
      .object({
        studentIds: z.array(z.uuid()).max(50),
      })
      .parse(input.payload);
    const payer = await trainingCheckout<{
      studentIds: string[];
      attempts: {
        id: string;
        studentId: string;
        status: "reserved" | "review";
        createdAt: string;
      }[];
    }>("payers", { actor, studentIds: [...new Set(studentIds)] });
    return json({ resource: { ...payer, ready: Boolean(key) } });
  }

  const creating = input.command === "training_start";
  const status = input.command === "training_status";
  const cancel = input.command === "training_cancel";
  if (!creating && !status && !cancel) throw new Error("NOT_FOUND");
  const id = z.uuid().parse(creating ? input.idempotencyKey : input.entityId);
  if (!key)
    throw new Error(
      "PROVIDER_UNAVAILABLE: Test lesson checkout is unavailable.",
    );
  const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
  // Resolve the trusted private deploy before reserving invoices.
  const origin = creating ? portalOrigin(context) : undefined;
  const attempt = creating
    ? await trainingCheckout<TrainingCheckout>("reserve", {
        ...paySelection.parse(input.payload),
        id,
        actor,
      })
    : await trainingCheckout<TrainingCheckout>("read", { id, actor });
  if (attempt.status !== "reserved")
    return json({ resource: { status: attempt.status, id } });

  let session: Stripe.Checkout.Session;
  if (attempt.stripe_session_id) {
    session = await stripe.checkout.sessions.retrieve(
      attempt.stripe_session_id,
    );
  } else {
    // Avoid retrying provider creation beyond this attempt's fixed expiry.
    const expiresAt =
      Math.floor(Date.parse(attempt.created_at) / 1000) + 2 * 3600;
    if (expiresAt - Date.now() / 1000 < 31 * 60)
      throw new Error(
        "INVALID_TRANSITION: The payment attempt needs studio review.",
      );
    const back = new URL("/portal/payments", origin ?? portalOrigin(context));
    back.searchParams.set("pay", "lesson");
    back.searchParams.set("student", attempt.return_student_id);
    back.searchParams.set("attempt", id);
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: id,
        expires_at: expiresAt,
        line_items: attempt.allocations.map((row) => ({
          quantity: 1,
          price_data: {
            currency: attempt.currency.toLowerCase(),
            unit_amount: row.amountMinor,
            product_data: {
              name: row.description,
              description: [row.date, row.invoiceNumber]
                .filter(Boolean)
                .join(" · "),
            },
          },
        })),
        metadata: { training_checkout_id: id },
        payment_intent_data: { metadata: { training_checkout_id: id } },
        success_url: back.href,
        cancel_url: back.href,
      },
      { idempotencyKey: `training:${id}` },
    );
  }
  if (cancel && session.status === "open")
    session = await stripe.checkout.sessions.expire(session.id);
  const reconciled = await reconcileTrainingCheckout(session);
  return json({
    resource: {
      status:
        reconciled.status === "reserved" && session.status === "open"
          ? "open"
          : reconciled.status === "reserved"
            ? "processing"
            : reconciled.status,
      url: session.status === "open" ? session.url : undefined,
      id,
    },
  });
}
