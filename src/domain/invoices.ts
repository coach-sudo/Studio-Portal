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
  recipient: { name: string; email?: string };
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
