import { PDFDocument, PDFDict, PDFName, PDFString } from "pdf-lib";
import { expect, it } from "vitest";
import { presentOutboxMessage } from "./outbox-presentation";
import { createInvoicePdf } from "../../../src/features/finance/invoicePdf";
import type { Invoice } from "../../../src/domain/invoices";
it("includes a Pay invoice button targeting that specific invoice in email", () => {
  const email = presentOutboxMessage(
    {
      body: "Hello Payer,\nInvoice details",
      event_key: "invoice.issued",
      entity_snapshot: { invoiceId: "invoice-id" },
    },
    { name: "Studio" },
    "https://studio.test",
  );
  expect(email.html).toContain("Pay invoice");
  expect(email.html).toContain(
    "https://studio.test/portal/payments?invoice=invoice-id",
  );
});
it("exports a clickable PDF payment button to the same secure invoice link", async () => {
  const invoice = {
    id: "invoice-id",
    number: "INV-1",
    status: "open",
    currency: "USD",
    issue_date: "2026-10-13",
    due_date: "2026-10-27",
    branding: { studioName: "Studio" },
    recipient: { name: "Paying Parent", studentName: "Student" },
    items: [],
    total_minor: 10000,
    paid_minor: 0,
    credit_minor: 0,
    notes: "Payment details",
    footer: "Thank you",
  } as unknown as Invoice;
  const url = "https://studio.test/portal/payments?invoice=invoice-id";
  const bytes = await createInvoicePdf(
    invoice,
    undefined,
    undefined,
    undefined,
    url,
  );
  const pdf = await PDFDocument.load(bytes);
  const annotation = pdf
    .getPages()
    .flatMap((page) => page.node.Annots()?.asArray() ?? [])
    .map((ref) => pdf.context.lookup(ref, PDFDict))
    .find((dict) => dict.get(PDFName.of("Subtype")) === PDFName.of("Link"));
  expect(annotation).toBeDefined();
  const action = annotation!.lookup(PDFName.of("A"), PDFDict);
  expect(action.lookup(PDFName.of("URI"), PDFString).decodeText()).toBe(url);
});
