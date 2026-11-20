import { z } from "zod";
import { AppError, json } from "../_shared/http";
import {
  autopay,
  openAutopaySetup,
  trainingStripe,
  type PendingSetup,
} from "../_shared/training-autopay";
import {
  autopaySelectionObject,
  loadPreview,
} from "./training-autopay-preview";
import type { V2CommandContext } from "./types";
import { trainingCheckout } from "../_shared/training-checkout";
import {
  lessonAutopayConsentVersion,
  type AutopayProposal,
  type LessonAutopayAccount,
  type LessonAutopayPlan,
} from "../../../src/domain/lessonAutopay";

const target = z.object({ studentId: z.uuid() }).strict();
const authorize = autopaySelectionObject.extend({
  consentVersion: z.literal(lessonAutopayConsentVersion),
  consented: z.literal(true),
  reviewDigest: z.string().regex(/^[0-9a-f]{64}$/),
  replacesId: z.uuid().optional(),
});

type ReviewSnapshot = {
  reviewDigest: string;
  timeZone: string;
  evaluatedAt: string;
  reviewed: Record<
    string,
    {
      startsAt: string;
      date: string;
      payAt: string | null;
      terms: { currency: string; amountMinor: number };
    }
  >;
};

export async function handleLessonAutopayCommand(
  { input, context }: V2CommandContext,
  actor: string,
  payerEmail?: string,
) {
  const command = input.command.replace(/^training_autopay_/, "");
  const provider = trainingStripe(context);
  if (command === "list") {
    const { studentId } = target.parse(input.payload);
    if (Netlify.env.get("TRAINING_AUTOPAY_PREVIEW") !== "true")
      return json({ resource: null });
    const allowed = await trainingCheckout<{ studentIds: string[] }>("payers", {
      actor,
      studentIds: [studentId],
    });
    if (!allowed.studentIds.includes(studentId))
      return json({ resource: null });
    const record = await autopay<Omit<LessonAutopayAccount, "canSetUp">>(
      "list",
      { actor, studentId },
    );
    return json({
      resource: { ...record, canSetUp: Boolean(provider), payerEmail },
    });
  }
  if (command === "pause" || command === "resume" || command === "cancel") {
    const { studentId } = target.parse(input.payload);
    const resource = await autopay<LessonAutopayPlan>(command, {
      id: z.uuid().parse(input.entityId),
      studentId,
      actor,
      expectedVersion: input.expectedVersion,
    });
    return json({ resource });
  }
  if (!provider)
    throw new AppError("PROVIDER_UNAVAILABLE", {
      status: 503,
      message: "Secure automatic payment setup is unavailable here.",
    });
  if (command === "continue") {
    const { studentId } = target.parse(input.payload);
    const plan = await autopay<PendingSetup | LessonAutopayPlan>(
      "setup_for_payer",
      {
        id: z.uuid().parse(input.entityId),
        actor,
        studentId,
      },
    );
    return json({
      resource:
        "stripe_session" in plan
          ? await openAutopaySetup(
              provider.stripe,
              provider.origin,
              plan,
              provider.live,
            )
          : { status: plan.status },
    });
  }
  if (command !== "review" && command !== "authorize")
    throw new Error("NOT_FOUND");
  const selection =
    command === "authorize"
      ? authorize.parse(input.payload)
      : autopaySelectionObject.parse(input.payload);
  const now = new Date();
  const source = await loadPreview(actor, selection.studentId, now, true);
  if (!source) throw AppError.validation();
  const { currency } = source;
  if (command === "authorize") {
    const plan = await autopay<PendingSetup>("begin", {
      ...selection,
      id: z.uuid().parse(input.idempotencyKey),
      actor,
      currency,
      expectedVersion: input.expectedVersion,
    });
    return json({
      resource: await openAutopaySetup(
        provider.stripe,
        provider.origin,
        plan,
        provider.live,
      ),
    });
  }
  const reviewed = await autopay<ReviewSnapshot>("review", {
    ...selection,
    actor,
    currency,
  });
  const preview = Object.entries(reviewed.reviewed)
    .sort(
      ([, first], [, second]) =>
        Date.parse(first.startsAt) - Date.parse(second.startsAt),
    )
    .map<AutopayProposal>(([lessonId, entry]) => {
      const { date, payAt, startsAt, terms } = entry;
      if (!payAt)
        return {
          lessonId,
          date,
          state: "review",
          reason:
            "The configured payment time is unavailable or ambiguous on this date.",
        };
      const details = {
        lessonId,
        date,
        amountMinor: terms.amountMinor,
        currency: terms.currency,
      };
      return Date.parse(payAt) <= Date.parse(reviewed.evaluatedAt) ||
        Date.parse(payAt) >= Date.parse(startsAt)
        ? { ...details, state: "pay_now" }
        : { ...details, state: "scheduled", payAt };
    });
  return json({ resource: { preview, reviewDigest: reviewed.reviewDigest } });
}
