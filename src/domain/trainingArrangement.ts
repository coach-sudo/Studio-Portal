import type { Invoice, InvoiceLine } from "./invoices";
import { invoiceDue } from "./invoices";
import type { Lesson, StudioSnapshot } from "./model";

type TrainingRecords = Pick<
  StudioSnapshot,
  "lessons" | "lessonParticipants" | "bookings" | "recurringSeries"
>;

export type TrainingPaymentState =
  "paid" | "unpaid" | "processing" | "review" | "cancelled";

export const trainingPaymentLabel: Record<TrainingPaymentState, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  processing: "Payment processing",
  review: "Payment under review",
  cancelled: "Cancelled",
};

const paidLesson = new Set(["paid", "paid_by_credit", "waived"]);
const paidBooking = new Set(["paid", "not_required"]);
const confirmedBooking = new Set(["confirmed", "completed"]);
const cancelledLesson = new Set(["cancelled", "late_cancelled"]);

export function lessonPaymentState(
  lesson: Pick<Lesson, "paymentNeedsReview" | "invoicePaymentPending"> & {
    paymentStatus?: string;
    status: string;
  },
  booking?: { paymentStatus: string; status: string },
  ownsLesson = true,
): TrainingPaymentState {
  if (ownsLesson && lesson.paymentNeedsReview) return "review";
  if (lesson.invoicePaymentPending && ownsLesson) return "processing";
  if (booking?.paymentStatus === "processing") return "processing";
  if (
    (ownsLesson && lesson.paymentStatus === "refunded") ||
    booking?.paymentStatus === "refunded"
  )
    return "review";
  if (
    ownsLesson &&
    lesson.paymentStatus &&
    paidLesson.has(lesson.paymentStatus)
  )
    return "paid";
  if (
    booking &&
    paidBooking.has(booking.paymentStatus) &&
    confirmedBooking.has(booking.status)
  )
    return "paid";
  if (cancelledLesson.has(lesson.status)) return "cancelled";
  if (!ownsLesson && !booking) return "review";
  if (
    (ownsLesson &&
      ["due", "partially_paid"].includes(lesson.paymentStatus ?? "")) ||
    (booking &&
      ["due", "partially_paid", "past_due", "failed"].includes(
        booking.paymentStatus,
      ))
  )
    return "unpaid";
  return "review";
}

export function trainingArrangement(
  data: TrainingRecords,
  studentId: string,
  now = new Date(),
) {
  const studentBookings = new Map(
    data.bookings
      .filter((booking) => booking.studentId === studentId)
      .map((booking) => [booking.id, booking]),
  );
  const studentSeries = new Map(
    data.recurringSeries
      .filter((series) => series.studentId === studentId)
      .map((series) => [series.id, series]),
  );
  const participants = new Map<string, Set<string>>();
  for (const part of data.lessonParticipants) {
    if (part.studentId !== studentId || part.status === "cancelled") continue;
    const ids = participants.get(part.lessonId) ?? new Set<string>();
    if (part.bookingId) ids.add(part.bookingId);
    participants.set(part.lessonId, ids);
  }
  const occurrences = data.lessons
    .filter(
      (lesson) => lesson.studentId === studentId || participants.has(lesson.id),
    )
    .map((lesson) => {
      const bookingIds = [...(participants.get(lesson.id) ?? [])];
      const booking =
        bookingIds.length === 1
          ? studentBookings.get(bookingIds[0])
          : undefined;
      const ambiguousBooking =
        bookingIds.length > 1 || (bookingIds.length === 1 && !booking);
      const own = lesson.studentId === studentId;
      const seriesId = (own ? lesson.seriesId : undefined) ?? booking?.seriesId;
      const seriesMatches =
        !own ||
        !lesson.seriesId ||
        !booking?.seriesId ||
        lesson.seriesId === booking.seriesId;
      const series =
        seriesId && seriesMatches ? studentSeries.get(seriesId) : undefined;
      const verifiedSeries =
        series?.studioId === lesson.studioId ? series : undefined;
      const payment = ambiguousBooking
        ? "review"
        : lessonPaymentState(lesson, booking, own);
      const confirmed =
        lesson.status === "scheduled" &&
        (!booking || confirmedBooking.has(booking.status));
      return {
        lesson,
        booking,
        payment,
        confirmed,
        series: verifiedSeries,
        seriesNeedsReview: Boolean(seriesId && !verifiedSeries),
        // The booking confirmation path also writes source_provider=studio.
        // Count a studio-sourced lesson only when it has no separate booking.
        coachScheduled:
          lesson.sourceProvider === "studio" && !booking && !ambiguousBooking,
      };
    })
    .sort((a, b) => a.lesson.startsAt.localeCompare(b.lesson.startsAt));
  const upcoming = occurrences.filter(
    (item) => item.confirmed && Date.parse(item.lesson.endsAt) >= now.getTime(),
  );
  const history = occurrences
    .filter(
      (item) =>
        !item.confirmed || Date.parse(item.lesson.endsAt) < now.getTime(),
    )
    .reverse();
  return {
    occurrences,
    upcoming,
    history,
    coachScheduledCount: upcoming.filter((item) => item.coachScheduled).length,
  };
}

export function invoiceLineBalance(line: InvoiceLine) {
  const amounts = [
    line.quantity,
    line.unitMinor,
    line.paidMinor,
    line.creditMinor,
    line.waivedMinor ?? 0,
  ];
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0))
    return NaN;
  const gross = line.quantity * line.unitMinor;
  const balance =
    gross - line.paidMinor - line.creditMinor - (line.waivedMinor ?? 0);
  return Number.isSafeInteger(gross) && balance >= 0 ? balance : NaN;
}

export interface LessonObligation {
  lessonId: string;
  studentId: string;
  invoiceId: string;
  invoiceVersion: number;
  invoiceNumber: string;
  studentName?: string;
  lineId: string;
  description: string;
  date: string;
  amountMinor: number;
  adjustmentsMinor: number;
  currency: string;
  pending: boolean;
  eligible: boolean;
}

export function trainingObligations(
  invoices: readonly Invoice[],
  studentId: string,
  arrangement?: ReturnType<typeof trainingArrangement>,
) {
  const groups = new Map<string, LessonObligation[]>();
  const known = new Map(
    arrangement?.occurrences.map((item) => [item.lesson.id, item]),
  );
  for (const invoice of invoices) {
    if (
      invoice.student_id !== studentId ||
      !["open", "partially_paid"].includes(invoice.status)
    )
      continue;
    const activeLines = invoice.items.filter((line) => !line.cancelled);
    const consistent =
      activeLines.reduce(
        (total, line) => total + invoiceLineBalance(line),
        0,
      ) === invoiceDue(invoice);
    for (const line of activeLines) {
      if (
        line.kind !== "service" ||
        line.quantity !== 1 ||
        line.lessonIds.length !== 1
      )
        continue;
      const amountMinor = invoiceLineBalance(line);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) continue;
      const lessonId = line.lessonIds[0];
      const occurrence = known.get(lessonId);
      const pending = Boolean(
        invoice.checkout_key || occurrence?.payment === "processing",
      );
      const eligible =
        consistent &&
        !pending &&
        (!occurrence ||
          (["scheduled", "completed"].includes(occurrence.lesson.status) &&
            occurrence.payment !== "paid" &&
            occurrence.payment !== "review" &&
            (!occurrence.lesson.invoiceId ||
              occurrence.lesson.invoiceId === invoice.id)));
      const group = groups.get(lessonId) ?? [];
      group.push({
        lessonId,
        studentId,
        invoiceId: invoice.id,
        invoiceVersion: invoice.version,
        invoiceNumber: invoice.number,
        studentName: invoice.recipient.studentName,
        lineId: line.id,
        description: line.description,
        date: line.startsOn,
        amountMinor,
        adjustmentsMinor: line.creditMinor + (line.waivedMinor ?? 0),
        currency: invoice.currency,
        pending,
        eligible,
      });
      groups.set(lessonId, group);
    }
  }
  return [...groups.values()]
    .flatMap((group) =>
      group.length === 1
        ? group
        : group.map((item) => ({ ...item, eligible: false })),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.lineId.localeCompare(b.lineId),
    );
}
