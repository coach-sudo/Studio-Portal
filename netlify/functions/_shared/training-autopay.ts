import type { Context } from "@netlify/functions";
import Stripe from "stripe";
import { AppError } from "./http";
import { portalOrigin } from "./portal-url";
import { serviceClient } from "./supabase";
import type { LessonAutopayPlan } from "../../../src/domain/lessonAutopay";

type SetupOperation =
  | "list"
  | "review"
  | "begin"
  | "setup_for_payer"
  | "setup_attach"
  | "setup_complete"
  | "setup_expired"
  | "setup_reference"
  | "pause"
  | "resume"
  | "cancel";

export interface PendingSetup {
  id: string;
  student_id: string;
  currency: string;
  status: "pending_setup";
  setup_expires_at: string;
  stripe_session: string | null;
}

interface Attempt {
  id: string;
  intent: string | null;
  currency: string;
  amountMinor: number;
  customer: string;
  method: string;
  submitted: boolean;
  eligible: boolean;
}

export async function autopay<T>(
  action: SetupOperation,
  value: Record<string, unknown>,
) {
  const result = await serviceClient().rpc("training_lesson_autopay", {
    p_action: action,
    p_value: value,
  });
  if (
    result.error?.message ===
    "INVALID_TRANSITION: Finish or cancel the pending payment setup first."
  )
    throw new AppError("VERSION_CONFLICT", {
      status: 409,
      message: "Continue or cancel the pending automatic payment setup first.",
      cause: result.error,
    });
  if (result.error) throw result.error;
  return result.data as T;
}

async function job<T>(
  action: "refresh" | "claim" | "attach" | "submit" | "abandon" | "reconcile",
  value: Record<string, unknown> = {},
) {
  const result = await serviceClient().rpc("training_lesson_autopay_job", {
    p_action: action,
    p_value: value,
  });
  if (result.error) throw result.error;
  return result.data as T;
}

type TrainingDeployment = Pick<Context, "deploy" | "site">;

export function isLiveTrainingDeployment(context: TrainingDeployment) {
  return (
    context.site?.id === "93829451-dbcf-4863-a07f-fa448cb17494" &&
    context.deploy?.context === "production" &&
    context.deploy.published === true &&
    Netlify.env.get("E2E_EPHEMERAL") !== "true" &&
    Netlify.env.get("SUPABASE_URL") ===
      "https://htwthzshhilrjtqwprlo.supabase.co" &&
    /^(sk|rk)_live_/.test(Netlify.env.get("STRIPE_SECRET_KEY") ?? "")
  );
}

export function trainingSandbox(context: TrainingDeployment) {
  const key = Netlify.env.get("STRIPE_SECRET_KEY") ?? "";
  const disposable =
    !context.site?.id &&
    !Netlify.env.get("SITE_ID") &&
    Netlify.env.get("E2E_EPHEMERAL") === "true";
  if (disposable && /^(sk|rk|rkcs)_test_/.test(key)) return "disposable";
  if (
    context.site?.id === "d83ff6cb-f57b-4741-8c3c-3eaae7adab19" &&
    context.deploy?.context === "deploy-preview" &&
    context.deploy.published === false &&
    Netlify.env.get("SUPABASE_URL") ===
      "https://lrxrivfqjpkvygozphoz.supabase.co" &&
    /^(sk|rk)_test_/.test(key)
  )
    return "staging";
  return null;
}

export function trainingStripe(
  context: Pick<Context, "deploy" | "site">,
  feature:
    | "TRAINING_AUTOPAY_TEST_MODE"
    | "TRAINING_CHECKOUT_TEST_MODE" = "TRAINING_AUTOPAY_TEST_MODE",
) {
  const key = Netlify.env.get("STRIPE_SECRET_KEY");
  if (key && isLiveTrainingDeployment(context)) {
    if (!Netlify.env.get("STRIPE_WEBHOOK_SECRET")) return null;
    const liveFlag =
      feature === "TRAINING_CHECKOUT_TEST_MODE"
        ? "TRAINING_CHECKOUT_LIVE"
        : "TRAINING_AUTOPAY_LIVE";
    if (Netlify.env.get(liveFlag) !== "true") return null;
    return {
      stripe: new Stripe(key, {
        apiVersion: "2026-07-29.dahlia",
        timeout: 8000,
      }),
      origin: portalOrigin(context),
      live: true,
    };
  }
  const sandbox = trainingSandbox(context);
  if (Netlify.env.get(feature) !== "true" || !key || !sandbox) return null;
  const origin = portalOrigin(context);
  if (
    sandbox === "disposable" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)
  )
    return null;
  return {
    stripe: new Stripe(key, { apiVersion: "2026-07-29.dahlia", timeout: 8000 }),
    origin,
    live: false,
  };
}

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}

export async function openAutopaySetup(
  stripe: Stripe,
  origin: string,
  plan: PendingSetup,
  live = false,
) {
  if (plan.stripe_session) {
    const session = await stripe.checkout.sessions.retrieve(
      plan.stripe_session,
    );
    if (session.livemode !== live)
      throw new Error("VERSION_CONFLICT: Stripe setup mode mismatch.");
    if (session.status === "complete") return { status: "processing" };
    return {
      status: session.status,
      url: session.status === "open" ? session.url : undefined,
    };
  }
  const expires = Math.floor(Date.parse(plan.setup_expires_at) / 1000);
  if (expires - Date.now() / 1000 < 31 * 60)
    throw new AppError("VERSION_CONFLICT", {
      status: 409,
      message:
        "Automatic payment setup expired. Cancel it and review a new arrangement.",
    });
  const customer = await stripe.customers.create(
    { metadata: { training_autopay_mandate: plan.id } },
    { idempotencyKey: `lesson-autopay-customer:${plan.id}` },
  );
  const back = new URL("/portal/payments", origin);
  back.searchParams.set("recurring", "arrangements");
  back.searchParams.set("student", plan.student_id);
  const session = await stripe.checkout.sessions.create(
    {
      mode: "setup",
      integration_identifier: "coachd-lesson-setup-vrpxqhta",
      customer: customer.id,
      currency: plan.currency.toLowerCase(),
      client_reference_id: plan.id,
      metadata: { training_autopay_mandate: plan.id },
      setup_intent_data: { metadata: { training_autopay_mandate: plan.id } },
      success_url: back.href,
      cancel_url: back.href,
      expires_at: expires,
    },
    { idempotencyKey: `lesson-autopay-setup:${plan.id}` },
  );
  if (
    session.livemode !== live ||
    session.mode !== "setup" ||
    stripeId(session.customer) !== customer.id
  )
    throw new Error(
      "VERSION_CONFLICT: Stripe payment setup does not match the authorization.",
    );
  await autopay("setup_attach", {
    id: plan.id,
    session: session.id,
    customer: customer.id,
  });
  return { status: session.status, url: session.url };
}

export async function reconcileAutopaySetup(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  live = false,
) {
  const id = session.metadata?.training_autopay_mandate;
  if (
    !id ||
    session.livemode !== live ||
    session.mode !== "setup" ||
    session.client_reference_id !== id
  )
    throw new Error(
      "VALIDATION_FAILED: Stripe lesson payment setup does not match.",
    );
  if (session.status === "expired")
    return autopay<LessonAutopayPlan>("setup_expired", {
      id,
      session: session.id,
    });
  const intentId = stripeId(session.setup_intent);
  if (session.status !== "complete" || !intentId) return null;
  const intent = await stripe.setupIntents.retrieve(intentId, {
    expand: ["payment_method"],
  });
  if (intent.status !== "succeeded") return null;
  const customer = stripeId(session.customer);
  const method = intent.payment_method;
  if (
    !customer ||
    intent.livemode !== live ||
    intent.usage !== "off_session" ||
    intent.metadata?.training_autopay_mandate !== id ||
    stripeId(intent.customer) !== customer ||
    !method ||
    typeof method === "string" ||
    method.livemode !== live ||
    stripeId(method.customer) !== customer
  )
    throw new Error(
      "VERSION_CONFLICT: Stripe payment method does not match the authorization.",
    );
  return autopay<LessonAutopayPlan>("setup_complete", {
    id,
    session: session.id,
    customer,
    intent: intentId,
    method: method.id,
    methodLabel: method.card
      ? `${method.card.brand.toUpperCase()} ending in ${method.card.last4}`
      : "Saved payment method",
  });
}

export async function reconcileAutopayIntent(
  intent: Stripe.PaymentIntent,
  live = false,
) {
  const id = intent.metadata.training_autopay_attempt;
  if (!id || intent.livemode !== live)
    throw new Error("VALIDATION_FAILED: Stripe lesson payment does not match.");
  return job<{ status: string }>("reconcile", {
    id,
    intent: intent.id,
    status: intent.status,
    amountMinor: intent.amount,
    receivedMinor: intent.amount_received,
    currency: intent.currency,
    customer: stripeId(intent.customer),
    method: stripeId(intent.payment_method),
  });
}

async function executeAttempt(stripe: Stripe, attempt: Attempt, live: boolean) {
  if (!attempt.intent && !attempt.eligible)
    return job("abandon", { id: attempt.id });
  let intent = attempt.intent
    ? await stripe.paymentIntents.retrieve(attempt.intent)
    : await stripe.paymentIntents.create(
        {
          amount: attempt.amountMinor,
          currency: attempt.currency.toLowerCase(),
          customer: attempt.customer,
          payment_method: attempt.method,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
          metadata: { training_autopay_attempt: attempt.id },
        },
        { idempotencyKey: `lesson-autopay-intent:${attempt.id}` },
      );
  if (
    intent.livemode !== live ||
    intent.metadata.training_autopay_attempt !== attempt.id
  )
    throw new Error(
      "VERSION_CONFLICT: Stripe payment does not match the reservation.",
    );
  if (!attempt.intent) {
    await job("attach", {
      id: attempt.id,
      intent: intent.id,
      amountMinor: intent.amount,
      currency: intent.currency,
      customer: stripeId(intent.customer),
      method: stripeId(intent.payment_method),
    });
  }
  if (intent.status === "requires_confirmation") {
    const submission = await job<{ allowed: boolean }>("submit", {
      id: attempt.id,
      intent: intent.id,
    });
    if (submission.allowed) {
      try {
        intent = await stripe.paymentIntents.confirm(
          intent.id,
          { off_session: true },
          { idempotencyKey: `lesson-autopay-confirm:${attempt.id}` },
        );
      } catch {
        // Preserve the reservation across an unknown provider result. A retrieved
        // intent determines whether this can retry, needs attention, or paid.
        intent = await stripe.paymentIntents.retrieve(intent.id);
        if (intent.status === "requires_confirmation")
          throw new Error(
            "PROVIDER_UNAVAILABLE: Payment confirmation will be checked again.",
          );
      }
    } else {
      intent = await stripe.paymentIntents.cancel(
        intent.id,
        { cancellation_reason: "abandoned" },
        { idempotencyKey: `lesson-autopay-cancel:${attempt.id}` },
      );
    }
  }
  if (
    intent.status === "requires_payment_method" ||
    intent.status === "requires_action"
  ) {
    intent = await stripe.paymentIntents.cancel(
      intent.id,
      { cancellation_reason: "abandoned" },
      { idempotencyKey: `lesson-autopay-cancel:${attempt.id}` },
    );
  }
  return reconcileAutopayIntent(intent, live);
}

export async function runLessonAutopay(stripe: Stripe, live = false) {
  await job("refresh");
  let processed = 0;
  let pending = 0;
  const deadline = Date.now() + 17_000;
  for (let index = 0; index < 5 && Date.now() < deadline; index++) {
    const attempt = await job<Attempt | null>("claim");
    if (!attempt) break;
    try {
      await executeAttempt(stripe, attempt, live);
      processed++;
    } catch {
      // The attempt lease is durable. Subsequent runs recover the same intent.
      pending++;
    }
  }
  return { processed, pending };
}
