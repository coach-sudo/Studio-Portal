import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import { invoiceDue, type Invoice } from "../../domain/invoices";
import { formatMoney } from "../../domain/finance";

export function wrapInvoiceText(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const char of word) {
        if (font.widthOfTextAtSize(line + char, size) > width && line) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Same immutable invoice content as the virtual document; font and logo bytes are explicit inputs for reproducible tests. */
export async function createInvoicePdf(
  invoice: Invoice,
  fontBytes?: Uint8Array,
  logoBytes?: Uint8Array,
  customFontkit?: Parameters<PDFDocument["registerFontkit"]>[0],
) {
  const pdf = await PDFDocument.create();
  if (customFontkit) pdf.registerFontkit(customFontkit);
  const font = fontBytes
    ? await pdf.embedFont(fontBytes, { subset: false })
    : await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.12, 0.19, 0.22),
    forest = rgb(0.09, 0.25, 0.21),
    muted = rgb(0.38, 0.45, 0.46),
    gold = rgb(0.75, 0.61, 0.35),
    line = rgb(0.87, 0.91, 0.9);
  let page = pdf.addPage([612, 792]),
    y = 744;
  const text = (value: string, x: number, at: number, size = 11, color = ink) =>
    page.drawText(value, { x, y: at, size, font, color });
  const rule = (at: number) =>
    page.drawLine({
      start: { x: 48, y: at },
      end: { x: 564, y: at },
      thickness: 0.7,
      color: line,
    });
  function newPage() {
    page = pdf.addPage([612, 792]);
    y = 744;
    text(invoice.branding.studioName, 48, y, 12, forest);
    text(invoice.number, 414, y, 10, muted);
    y -= 30;
    rule(y);
    y -= 24;
  }
  function ensure(height: number) {
    if (y - height < 66) newPage();
  }
  function block(
    value: string,
    x: number,
    width: number,
    size = 11,
    color = ink,
  ) {
    for (const row of wrapInvoiceText(value, font, size, width)) {
      ensure(size * 1.5);
      text(row, x, y, size, color);
      y -= size * 1.5;
    }
  }
  if (logoBytes) {
    try {
      const logo = await pdf.embedPng(logoBytes);
      const scale = Math.min(130 / logo.width, 52 / logo.height);
      page.drawImage(logo, {
        x: 48,
        y: y - logo.height * scale,
        width: logo.width * scale,
        height: logo.height * scale,
      });
      y -= logo.height * scale + 12;
    } catch {
      throw new Error(
        "The invoice logo could not be embedded. Refresh the logo and try again.",
      );
    }
  }
  const titleTop = 744;
  block(invoice.branding.studioName, 48, 260, 15, forest);
  if (invoice.branding.email) block(invoice.branding.email, 48, 260, 10, muted);
  text("INVOICE", 414, titleTop, 27, forest);
  text(invoice.number, 414, titleTop - 25, 9, muted);
  text(
    invoice.status.replaceAll("_", " ").toUpperCase(),
    414,
    titleTop - 45,
    9,
    forest,
  );
  y = Math.min(y, titleTop - 85);
  page.drawLine({
    start: { x: 48, y },
    end: { x: 564, y },
    thickness: 1.5,
    color: gold,
  });
  y -= 27;
  text("BILL TO", 48, y, 9, muted);
  text(`Issued: ${invoice.issue_date}`, 378, y, 10, muted);
  y -= 18;
  text(`Due: ${invoice.due_date}`, 378, y, 10, muted);
  block(invoice.recipient.name, 48, 290, 13);
  if (invoice.recipient.email)
    block(invoice.recipient.email, 48, 290, 10, muted);
  y -= 12;
  if (invoice.introduction) {
    block(invoice.introduction, 48, 516);
    y -= 14;
  }
  ensure(48);
  rule(y);
  y -= 22;
  text("SERVICE / COVERAGE", 48, y, 9, muted);
  text("AMOUNT", 500, y, 9, muted);
  y -= 20;
  for (const item of invoice.items) {
    const rows = wrapInvoiceText(item.description, font, 12, 350);
    ensure(Math.min(600, rows.length * 18 + 58));
    const amount = formatMoney(
      item.quantity * item.unitMinor,
      invoice.currency,
    );
    text(amount, 564 - font.widthOfTextAtSize(amount, 11), y, 11);
    block(item.description, 48, 350, 12);
    block(`${item.startsOn} – ${item.endsOn}`, 48, 350, 9, muted);
    block(
      `${item.quantity} × ${formatMoney(item.unitMinor, invoice.currency)}${item.cancelled ? " · Cancelled" : item.creditMinor ? " · Lesson credit applied" : ""}`,
      48,
      350,
      9,
      muted,
    );
    y -= 12;
    rule(y);
    y -= 20;
  }
  ensure(136 + (invoice.waived_minor ? 21 : 0));
  for (const [label, amount] of [
    ["Total", invoice.total_minor],
    ["Credits / adjustments", -invoice.credit_minor],
    ["Cancelled charges", -(invoice.waived_minor ?? 0)],
    ["Payments", -invoice.paid_minor],
  ] as const) {
    if (label === "Cancelled charges" && !amount) continue;
    text(label, 335, y, 10, muted);
    const value = formatMoney(amount, invoice.currency);
    text(value, 564 - font.widthOfTextAtSize(value, 11), y);
    y -= 21;
  }
  page.drawLine({
    start: { x: 335, y: y + 4 },
    end: { x: 564, y: y + 4 },
    thickness: 1,
    color: gold,
  });
  y -= 21;
  text(
    invoice.status === "draft" ? "Draft total" : "Balance due",
    335,
    y,
    11,
    forest,
  );
  const due = formatMoney(
    invoice.status === "draft" ? invoice.total_minor : invoiceDue(invoice),
    invoice.currency,
  );
  text(due, 564 - font.widthOfTextAtSize(due, 20), y - 4, 20, forest);
  y -= 44;
  if (invoice.notes) {
    ensure(35);
    text("NOTES & PAYMENT DETAILS", 48, y, 9, muted);
    y -= 19;
    block(invoice.notes, 48, 516);
    y -= 15;
  }
  block(
    invoice.footer || "Thank you for being part of our studio.",
    48,
    516,
    10,
    muted,
  );
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: 48, y: 45 },
      end: { x: 564, y: 45 },
      thickness: 0.5,
      color: line,
    });
    p.drawText(`${invoice.number} · ${index + 1} / ${pages.length}`, {
      x: 48,
      y: 30,
      font,
      size: 9,
      color: muted,
    });
  });
  pdf.setTitle(`Invoice ${invoice.number}`);
  pdf.setAuthor(invoice.branding.studioName);
  return pdf.save();
}
