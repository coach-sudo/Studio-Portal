import type { StudioSnapshot } from "./model";
import { lessonCreditDebit } from "./credits";
import { invoiceDue } from "./invoices";

/** Demo-only mirror of invoice/lesson coverage; the live database owns these transitions. */
export function syncDemoInvoices(data: StudioSnapshot) {
  for (const invoice of data.invoices ?? []) {
    if (["draft", "void"].includes(invoice.status)) continue;
    let changed = false;
    for (const line of invoice.items) {
      if (line.lessonIds.length !== 1) continue;
      const lesson = data.lessons.find((l) => l.id === line.lessonIds[0]);
      if (!lesson) continue;
      const booking = data.bookings.find(
        (b) =>
          b.studentId === invoice.student_id &&
          data.lessonParticipants.some(
            (p) => p.bookingId === b.id && p.lessonId === lesson.id,
          ),
      );
      const covered = data.packages.some(
        (p) =>
          p.studentId === invoice.student_id &&
          lessonCreditDebit(data.creditEntries, lesson.id, p.id) > 0,
      );
      if (
        !line.cancelled &&
        (["cancelled", "late_cancelled"].includes(lesson.status) ||
          (booking && ["cancelled", "late_cancelled"].includes(booking.status)))
      ) {
        line.cancelled = true;
        changed = true;
        if (
          lesson.status !== "late_cancelled" &&
          booking?.status !== "late_cancelled" &&
          !covered
        ) {
          line.waivedMinor = Math.max(
            0,
            line.quantity * line.unitMinor - line.paidMinor - line.creditMinor,
          );
          invoice.waived_minor = (invoice.waived_minor ?? 0) + line.waivedMinor;
          if (booking?.paymentStatus === "refunded")
            line.returnedMinor = line.paidMinor;
        }
      } else if (
        !line.cancelled &&
        !line.paidMinor &&
        !line.creditMinor &&
        covered
      ) {
        line.creditMinor = line.quantity * line.unitMinor;
        invoice.credit_minor += line.creditMinor;
        changed = true;
      }
    }
    if (changed) {
      invoice.status =
        invoiceDue(invoice) === 0
          ? "paid"
          : invoice.paid_minor || invoice.credit_minor
            ? "partially_paid"
            : "open";
      invoice.version++;
    }
  }
}
