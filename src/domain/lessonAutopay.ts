import type {
  LessonObligation,
  TrainingPaymentState,
} from "./trainingArrangement";
import { studioDateKey } from "./presentation";
import { zonedDateTimeToUtc } from "./booking";

export interface AutopayPolicy {
  timeZone: string;
  chargeAtLocal: string;
  minimumLeadDays: number;
  maximumLeadDays: number;
}

export interface AutopaySelection {
  scope: "existing" | "future" | "existing_and_future";
  leadDays: number;
  existingLessonIds: readonly string[];
  effectiveAt: string;
  currency: string;
  maximumLessonMinor: number;
}

export interface AutopayOccurrence {
  id: string;
  status: "scheduled" | string;
  startsAt: string;
  createdAt: string;
  payment: TrainingPaymentState;
  obligation?: LessonObligation;
  // The previous approved plan can execute on time. A new or moved lesson
  // inside the lead window requires a deliberate Pay now action.
  approvedPaymentAt?: string;
}

export type AutopayProposal =
  | {
      lessonId: string;
      state: "scheduled" | "ready";
      payAt: string;
      amountMinor: number;
      currency: string;
    }
  | {
      lessonId: string;
      state: "pay_now";
      amountMinor: number;
      currency: string;
    }
  | { lessonId: string; state: "review"; reason: string };

function localChargeTime(
  lessonStart: string,
  policy: AutopayPolicy,
  days: number,
) {
  const [year, month, day] = studioDateKey(lessonStart, policy.timeZone)
    .split("-")
    .map(Number);
  const [hour, minute] = policy.chargeAtLocal.split(":").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - days));
  const stamp = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour,
    minute,
  };
  const instant = zonedDateTimeToUtc(stamp, policy.timeZone);
  const displayed = new Intl.DateTimeFormat("en-GB", {
    timeZone: policy.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  // An invalid local time during the DST jump is a review condition. The
  // scheduler must never silently move a charge to a different local hour.
  return displayed === policy.chargeAtLocal ? instant.toISOString() : undefined;
}

export function previewLessonAutopay(
  policy: AutopayPolicy,
  selection: AutopaySelection,
  lessons: readonly AutopayOccurrence[],
  now = new Date(),
): AutopayProposal[] {
  if (
    !Number.isInteger(policy.minimumLeadDays) ||
    !Number.isInteger(policy.maximumLeadDays) ||
    policy.minimumLeadDays < 0 ||
    policy.maximumLeadDays < policy.minimumLeadDays ||
    !Number.isInteger(selection.leadDays) ||
    selection.leadDays < policy.minimumLeadDays ||
    selection.leadDays > policy.maximumLeadDays ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(policy.chargeAtLocal) ||
    !Number.isSafeInteger(selection.maximumLessonMinor) ||
    selection.maximumLessonMinor <= 0 ||
    !Number.isFinite(Date.parse(selection.effectiveAt))
  )
    throw new Error("Review the studio's automatic payment limits.");

  const beginsAt = Date.parse(selection.effectiveAt);
  const selected = new Set(selection.existingLessonIds);
  const proposals: AutopayProposal[] = [];
  for (const lesson of lessons) {
    if (
      lesson.status !== "scheduled" ||
      Date.parse(lesson.startsAt) <= now.getTime()
    )
      continue;
    const createdAt = Date.parse(lesson.createdAt);
    const future = Number.isFinite(createdAt) && createdAt >= beginsAt;
    const included =
      selection.scope === "future"
        ? future
        : selection.scope === "existing"
          ? selected.has(lesson.id)
          : selected.has(lesson.id) || future;
    if (
      !included ||
      ["paid", "processing", "cancelled"].includes(lesson.payment)
    )
      continue;

    const { obligation } = lesson;
    if (
      lesson.payment === "review" ||
      !obligation?.eligible ||
      obligation.currency !== selection.currency ||
      obligation.amountMinor > selection.maximumLessonMinor
    ) {
      proposals.push({
        lessonId: lesson.id,
        state: "review",
        reason:
          "Review the lesson amount or payment terms before scheduling a charge.",
      });
      continue;
    }
    const chargeAt = localChargeTime(
      lesson.startsAt,
      policy,
      selection.leadDays,
    );
    if (!chargeAt || Date.parse(chargeAt) > Date.parse(lesson.startsAt)) {
      proposals.push({
        lessonId: lesson.id,
        state: "pay_now",
        amountMinor: obligation.amountMinor,
        currency: obligation.currency,
      });
      continue;
    }
    const details = {
      lessonId: lesson.id,
      amountMinor: obligation.amountMinor,
      currency: obligation.currency,
    };
    const plannedPastWindow = Date.parse(chargeAt) <= now.getTime();
    if (
      plannedPastWindow &&
      (lesson.approvedPaymentAt !== chargeAt ||
        Date.parse(chargeAt) < beginsAt ||
        createdAt > Date.parse(chargeAt))
    ) {
      proposals.push({ ...details, state: "pay_now" });
      continue;
    }
    proposals.push({
      ...details,
      state: plannedPastWindow ? "ready" : "scheduled",
      payAt: chargeAt,
    });
  }
  return proposals;
}
