import { formatMoney } from "../../domain/finance";
import { invoiceDue, type Invoice } from "../../domain/invoices";
export function InvoiceDocument({
  invoice,
  logoUrl,
}: {
  invoice: Invoice;
  logoUrl?: string;
}) {
  return (
    <article className="invoice-paper" aria-label={`Invoice ${invoice.number}`}>
      <header className="invoice-paper-header">
        <div>
          {logoUrl ? (
            <img src={logoUrl} alt={`${invoice.branding.studioName} logo`} />
          ) : (
            <div className="invoice-monogram">
              {invoice.branding.studioName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <strong>{invoice.branding.studioName}</strong>
          {invoice.branding.email && <small>{invoice.branding.email}</small>}
        </div>
        <div>
          <span className="invoice-eyebrow">STATEMENT OF SERVICES</span>
          <h2>Invoice</h2>
          <strong>{invoice.number}</strong>
          <span className={`invoice-badge ${invoice.status}`}>
            {invoice.status.replaceAll("_", " ")}
          </span>
        </div>
      </header>
      <div className="invoice-meta">
        <div>
          <span className="invoice-eyebrow">BILL TO</span>
          <strong>{invoice.recipient.name}</strong>
          {invoice.recipient.email && <small>{invoice.recipient.email}</small>}
        </div>
        <dl>
          <div>
            <dt>Issued</dt>
            <dd>{invoice.issue_date}</dd>
          </div>
          <div>
            <dt>Due</dt>
            <dd>{invoice.due_date}</dd>
          </div>
        </dl>
      </div>
      {invoice.introduction && (
        <p className="invoice-copy">{invoice.introduction}</p>
      )}
      <div className="invoice-items">
        {invoice.items.map((line) => (
          <div className="invoice-item" key={line.id}>
            <div>
              <strong>{line.description}</strong>
              <small>
                {line.startsOn} – {line.endsOn}
              </small>
              <small>
                {line.quantity} ×{" "}
                {formatMoney(line.unitMinor, invoice.currency)}
                {line.creditMinor > 0 ? " · Lesson credit applied" : ""}
                {line.cancelled ? " · Cancelled" : ""}
              </small>
            </div>
            <strong>
              {formatMoney(line.quantity * line.unitMinor, invoice.currency)}
            </strong>
          </div>
        ))}
      </div>
      <div className="invoice-bottom">
        <div>
          {invoice.notes && (
            <>
              <span className="invoice-eyebrow">NOTES & PAYMENT DETAILS</span>
              <p className="invoice-copy">{invoice.notes}</p>
            </>
          )}
        </div>
        <dl className="invoice-totals">
          <div>
            <dt>Total</dt>
            <dd>{formatMoney(invoice.total_minor, invoice.currency)}</dd>
          </div>
          <div>
            <dt>Credits / adjustments</dt>
            <dd>−{formatMoney(invoice.credit_minor, invoice.currency)}</dd>
          </div>
          {!!invoice.waived_minor && (
            <div>
              <dt>Cancelled charges</dt>
              <dd>−{formatMoney(invoice.waived_minor, invoice.currency)}</dd>
            </div>
          )}
          <div>
            <dt>Payments</dt>
            <dd>−{formatMoney(invoice.paid_minor, invoice.currency)}</dd>
          </div>
          <div className="invoice-amount-due">
            <dt>
              {invoice.status === "draft" ? "Draft total" : "Balance due"}
            </dt>
            <dd>
              {formatMoney(
                invoice.status === "draft"
                  ? invoice.total_minor
                  : invoiceDue(invoice),
                invoice.currency,
              )}
            </dd>
          </div>
        </dl>
      </div>
      <footer className="invoice-paper-footer">
        <p className="invoice-copy">
          {invoice.footer || "Thank you for being part of our studio."}
        </p>
        <small>
          {invoice.branding.studioName} · {invoice.number}
        </small>
      </footer>
    </article>
  );
}
