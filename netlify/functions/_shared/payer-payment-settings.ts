import type { Context } from "@netlify/functions";
import { z } from "zod";
import { AppError, json } from "./http";
import { trainingStripe } from "./training-autopay";
import { trainingCheckout } from "./training-checkout";
import { serviceClient, userClient } from "./supabase";

export type PayerPaymentAction =
  "payment-settings" | "payment-method" | "billing";

const payerId = z.uuid();
const unavailable = () =>
  new AppError("PROVIDER_UNAVAILABLE", {
    status: 503,
    message: "Secure payment methods are temporarily unavailable.",
  });

export async function payerPaymentSettings(
  request: Request,
  context: Context,
  action: PayerPaymentAction,
  studentId: string,
  db: ReturnType<typeof userClient>,
) {
  const actor = await requireBillingPayer(db, studentId);
  const { data: student, error: studentError } = await db
    .from("students")
    .select("studio_id")
    .eq("id", studentId)
    .single();
  if (studentError || !student) throw new Error("FORBIDDEN");
  const studio = payerId.parse(student.studio_id);
  const provider = trainingStripe(context, "TRAINING_CHECKOUT_TEST_MODE");
  if (!provider) {
    if (action === "payment-settings") return json({ available: false });
    throw unavailable();
  }

  // The student customer can belong to a former payer or hold a package
  // subscription. A lesson mandate has its own separately consented customer.
  const { stripe } = provider;
  const owner = { coachd_payment_settings_payer: actor, coachd_studio: studio };
  const customers = await stripe.customers.search({
    query: `metadata['coachd_payment_settings_payer']:'${actor}' AND metadata['coachd_studio']:'${studio}'`,
    limit: 2,
  });
  if (customers.has_more || customers.data.length > 1) throw unavailable();
  let customer = customers.data[0];
  if (
    customer &&
    (customer.metadata.coachd_payment_settings_payer !== actor ||
      customer.metadata.coachd_studio !== studio ||
      customer.livemode !== provider.live)
  )
    throw new Error("FORBIDDEN");
  if (action === "payment-settings") {
    const methods = customer
      ? await stripe.customers.listPaymentMethods(customer.id, { limit: 1 })
      : null;
    return json({
      available: true,
      hasSavedMethod: Boolean(methods?.data.length),
    });
  }

  if (!customer) {
    if (action !== "payment-method") throw new Error("NOT_FOUND");
    customer = await stripe.customers.create(
      { metadata: owner },
      { idempotencyKey: `coachd-payer-settings:${studio}:${actor}` },
    );
  }
  const back = new URL("/portal/settings", provider.origin);
  back.searchParams.set("student", studentId);
  back.hash = "billing";
  if (action === "billing") {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: back.href,
    });
    return json({ url: portal.url });
  }
  const requestId = payerId.parse(request.headers.get("idempotency-key"));
  const { data: studioRow, error: studioError } = await serviceClient()
    .from("studios")
    .select("settings")
    .eq("id", studio)
    .single();
  if (studioError || !studioRow) throw unavailable();
  const currency = z
    .string()
    .regex(/^[A-Z]{3}$/i)
    .parse(studioRow.settings?.currency ?? "USD");
  const success = new URL(back);
  success.searchParams.set("payment", "returned");
  const cancel = new URL(back);
  cancel.searchParams.set("payment", "cancelled");
  const session = await stripe.checkout.sessions.create(
    {
      mode: "setup",
      integration_identifier: "coachd-portal-methods-hwqstnra",
      currency: currency.toLowerCase(),
      customer: customer.id,
      success_url: success.href,
      cancel_url: cancel.href,
    },
    { idempotencyKey: `coachd-payer-settings-session:${actor}:${requestId}` },
  );
  if (!session.url) throw unavailable();
  return json({ url: session.url });
}

export async function requireBillingPayer(
  db: ReturnType<typeof userClient>,
  studentId: string,
) {
  const { data: auth, error } = await db.auth.getUser();
  if (error || !auth.user) throw new Error("FORBIDDEN");
  const actor = payerId.parse(auth.user.id);
  const { studentIds } = await trainingCheckout<{ studentIds: string[] }>(
    "payers",
    { actor, studentIds: [studentId] },
  );
  if (!studentIds.includes(studentId)) throw new Error("FORBIDDEN");
  return actor;
}
