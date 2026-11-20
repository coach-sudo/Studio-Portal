import type { Lesson, StudioSnapshot } from "./model";
import { lessonCreditDebit } from "./credits";

export interface InvoiceLine {
  id: string;
  kind: "service" | "package";
  referenceId: string;
  description: string;
  quantity: number;
  unitMinor: number;
  startsOn: string;
  endsOn: string;
  lessonIds: string[];
  creditMinor: number;
  paidMinor: number;
  packageId?: string;
  creditQuantity?: number;
  expirationDays?: number | null;
  cancelled?: boolean;
  verifiedLesson?: boolean;
  lessonVersion?: number;
  waivedMinor?: number;
  returnedMinor?: number;
  originalLesson?: {
    priceMinor?: number;
    paymentStatus?: string;
    serviceId?: string;
  };
}
export interface Invoice {
  id: string;
  studio_id: string;
  student_id: string;
  number: string;
  status: "draft" | "open" | "partially_paid" | "paid" | "void";
  currency: string;
  issue_date: string;
  due_date: string;
  introduction: string;
  notes: string;
  footer: string;
  branding: {
    studioName: string;
    email?: string;
    logoUrl?: string;
    logoStoragePath?: string;
  };
  recipient: { name: string; email?: string; studentName?: string };
  delivery?: {
    status:
      | "not_sent"
      | "queued"
      | "sending"
      | "sent"
      | "failed"
      | "suppressed"
      | "cancelled"
      | "unknown";
    error?: string;
    updatedAt?: string;
  };
  items: InvoiceLine[];
  total_minor: number;
  paid_minor: number;
  credit_minor: number;
  waived_minor?: number;
  version: number;
  created_at: string;
  checkout_key?: string | null;
  checkout_session_id?: string | null;
  checkout_amount?: number | null;
}
export const invoiceDue = (invoice: Invoice) =>
  invoice.status === "void" || invoice.status === "draft"
    ? 0
    : Math.max(
        0,
        invoice.total_minor -
          invoice.paid_minor -
          invoice.credit_minor -
          (invoice.waived_minor ?? 0),
      );

export function lessonInvoiceFor(
  invoices: readonly Invoice[],
  lessonId: string,
) {
  const matches = (invoice: Invoice) =>
    invoice.status !== "void" &&
    invoice.items.some(
      (line) => !line.cancelled && line.lessonIds.includes(lessonId),
    );
  return (
    invoices.find(
      (invoice) => invoice.status !== "draft" && matches(invoice),
    ) ?? invoices.find(matches)
  );
}

export function verifiedInvoiceLesson(
  data: StudioSnapshot,
  lesson: Lesson,
  studentId: string,
) {
  const links = data.lessonParticipants.filter(
    (participant) =>
      participant.lessonId === lesson.id && participant.bookingId,
  );
  const link = links[0];
  const booking =
    link && data.bookings.find((entry) => entry.id === link.bookingId);
  // Invoicing can reuse the booking balance when it belongs to one occurrence.
  const verifiedBooking =
    links.length === 1 &&
    link.studentId === studentId &&
    ["confirmed", "attended"].includes(link.status) &&
    booking?.adminOverride?.createdByCoach === true &&
    booking.studentId === studentId &&
    booking.serviceId === lesson.serviceId &&
    booking.currency === data.settings.currency &&
    booking.totalMinor === lesson.priceMinor &&
    booking.paidMinor === 0 &&
    booking.paymentPolicy === "pay_later" &&
    booking.paymentStatus === "due" &&
    ["confirmed", "completed"].includes(booking.status) &&
    !booking.autoChargeBalance &&
    !booking.offeringId &&
    !booking.seriesId &&
    !data.lessonParticipants.some(
      (participant) =>
        participant.bookingId === booking.id && participant.id !== link.id,
    );
  return (
    canPrepareLessonInvoice(data, lesson, studentId) &&
    (lesson.sourceProvider ?? "studio") === "studio" &&
    lesson.paymentStatus === "due" &&
    !lesson.paymentNeedsReview &&
    !lesson.packageId &&
    !data.packages.some(
      (pkg) =>
        pkg.studentId === studentId &&
        lessonCreditDebit(data.creditEntries, lesson.id, pkg.id) > 0,
    ) &&
    Number.isSafeInteger(lesson.priceMinor) &&
    (lesson.priceMinor ?? 0) > 0 &&
    (!links.length || verifiedBooking) &&
    data.bookingServices.some(
      (service) =>
        service.id === lesson.serviceId &&
        service.currency === data.settings.currency,
    )
  );
}
/** Mirror the invoice command's ownership and payment-coverage checks. */
export function canPrepareLessonInvoice(
  data: Pick<StudioSnapshot, "lessonParticipants" | "bookings">,
  lesson: Lesson,
  studentId: string,
) {
  if (
    lesson.studentId !== studentId ||
    !["scheduled", "completed"].includes(lesson.status) ||
    (lesson.paidMinor ?? 0) !== 0 ||
    !["untracked", "due"].includes(lesson.paymentStatus ?? "untracked") ||
    lesson.invoiceId ||
    lesson.invoicePaymentPending
  )
    return false;

  return !data.lessonParticipants.some(
    (participant) =>
      participant.lessonId === lesson.id &&
      participant.bookingId &&
      data.bookings.some(
        (booking) =>
          booking.id === participant.bookingId &&
          booking.studentId === studentId &&
          booking.paymentPolicy !== "credits" &&
          (booking.paidMinor > 0 ||
            ["paid", "partially_paid", "processing", "not_required"].includes(
              booking.paymentStatus,
            )),
      ),
  );
}

export function invoiceLineTotal(
  line: Pick<InvoiceLine, "quantity" | "unitMinor">,
) {
  if (
    !Number.isSafeInteger(line.quantity) ||
    line.quantity < 1 ||
    line.quantity > 500 ||
    !Number.isSafeInteger(line.unitMinor) ||
    line.unitMinor < 0 ||
    line.quantity * line.unitMinor > 100000000
  )
    throw new Error("Choose a valid quantity and price.");
  return line.quantity * line.unitMinor;
}
