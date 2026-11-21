import { z } from "zod";
import type Stripe from "stripe";
import { json } from "../_shared/http";
import { serviceClient } from "../_shared/supabase";
import { trainingStripe } from "../_shared/training-autopay";
import {
  reconcileTrainingCheckout,
  trainingCheckout,
  type TrainingCheckout,
} from "../_shared/training-checkout";
import type { V2CommandContext } from "./types";
import { handleLessonAutopayCommand } from "./training-autopay";
import {
  trainingAutopayOptions,
  trainingAutopayPreview,
} from "./training-autopay-preview";

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
const directSelection = z
  .object({
    studentId: z.uuid(),
    items: z
      .array(
        z
          .object({
            studentId: z.uuid(),
            lessonId: z.uuid(),
            amountMinor: z.number().int().positive().max(99999999),
            terms: z.string().regex(/^[a-f0-9]{64}$/),
            currency: z.string().regex(/^[A-Z]{3}$/),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export async function handleTrainingCheckout(
  commandContext: V2CommandContext,
): Promise<Response> {
  const { input, db, context } = commandContext;
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error("FORBIDDEN");
  const actor = data.user.id;
  if (input.command === "training_autopay_options")
    return trainingAutopayOptions(actor, input.payload);
  if (input.command === "training_autopay_preview")
    return trainingAutopayPreview(actor, input.payload);
  if (input.command.startsWith("training_autopay_"))
    return handleLessonAutopayCommand(commandContext, actor, data.user.email);
  const provider = trainingStripe(context, "TRAINING_CHECKOUT_TEST_MODE");
  const directEnabled =
    Netlify.env.get("TRAINING_DIRECT_CHECKOUT_ENABLED") === "true";
  if (input.command === "training_direct_options") {
    const payload = z
      .object({
        studentId: z.uuid(),
        studentIds: z.array(z.uuid()).min(1).max(50),
        lessonId: z.uuid().optional(),
        upcomingOnly: z.boolean().optional(),
      })
      .strict()
      .parse(input.payload);
    if (!provider || !directEnabled)
      return json({ resource: { enabled: false, items: [] } });
    const rows = await trainingCheckout<unknown[]>("direct_options", {
      actor,
      ...payload,
    });
    return json({
      resource: {
        enabled: true,
        items: rows.slice(0, 50),
        hasMore: rows.length > 50,
      },
    });
  }

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
    return json({ resource: { ...payer, ready: Boolean(provider) } });
  }
  if (
    input.command === "training_invoice_quote" ||
    input.command === "training_invoice_issue"
  ) {
    if (!provider)
      throw new Error(
        "PROVIDER_UNAVAILABLE: Test lesson checkout is unavailable.",
      );
    const payload = z
      .object({
        studentId: z.uuid(),
        lessonId: z.uuid(),
        version: z.number().int().nonnegative().optional(),
        amountMinor: z.number().int().positive().optional(),
      })
      .strict()
      .parse(input.payload);
    const action =
      input.command === "training_invoice_quote" ? "quote" : "issue";
    const result = await serviceClient().rpc(
      "training_prepare_lesson_invoice",
      {
        p_action: action,
        p_value: { ...payload, actor },
      },
    );
    if (result.error) throw result.error;
    return json({ resource: result.data });
  }

  const creatingDirect = input.command === "training_start_direct";
  const creating = input.command === "training_start" || creatingDirect;
  const status = input.command === "training_status";
  const cancel = input.command === "training_cancel";
  if (!creating && !status && !cancel) throw new Error("NOT_FOUND");
  const id = z.uuid().parse(creating ? input.idempotencyKey : input.entityId);
  if (!provider)
    throw new Error(
      "PROVIDER_UNAVAILABLE: Test lesson checkout is unavailable.",
    );
  const { stripe, origin } = provider;
  if (creatingDirect && !directEnabled)
    throw new Error(
      "PROVIDER_UNAVAILABLE: Direct lesson checkout is unavailable.",
    );
  let attempt = creating
    ? await trainingCheckout<TrainingCheckout>(
        creatingDirect ? "reserve_direct" : "reserve",
        {
          ...(creatingDirect ? directSelection : paySelection).parse(
            input.payload,
          ),
          id,
          actor,
        },
      )
    : await trainingCheckout<TrainingCheckout>("read", { id, actor });
  const direct = attempt.allocations[0]?.kind === "direct";
  if (
    direct &&
    cancel &&
    attempt.status === "reserved" &&
    !attempt.stripe_session_id
  ) {
    attempt = await trainingCheckout<TrainingCheckout>("cancel_unstarted", {
      id,
      actor,
    });
  }
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
    if (direct) {
      if (!directEnabled && !attempt.provider_started_at)
        throw new Error(
          "PROVIDER_UNAVAILABLE: Direct lesson checkout is unavailable.",
        );
      attempt = await trainingCheckout<TrainingCheckout>(
        "begin_direct_provider",
        { id, actor },
      );
      if (attempt.status !== "reserved")
        return json({ resource: { status: attempt.status, id } });
    }
    const back = new URL("/portal/payments", origin);
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
  if (session.livemode !== provider.live)
    throw new Error("VERSION_CONFLICT: Stripe checkout mode mismatch.");
  if (cancel && session.status === "open")
    session = await stripe.checkout.sessions.expire(session.id);
  const reconciled = await reconcileTrainingCheckout(
    session,
    false,
    provider.live,
  );
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
