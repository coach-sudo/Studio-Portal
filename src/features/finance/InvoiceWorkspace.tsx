import { WritingArea } from "../../components/WritingArea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Dialog,
  Drawer,
  EmptyState,
  Section,
  Status,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { useInvoices } from "../../data/invoices";
import { lessonCreditDebit, reserveDemoCredits } from "../../domain/credits";
import { packageOffer } from "../../domain/packagePricing";
import { formatMoney, studentBalanceMinor } from "../../domain/finance";
import {
  invoiceDue,
  invoiceLineTotal,
  type Invoice,
  type InvoiceLine,
} from "../../domain/invoices";
import type { StudioSnapshot } from "../../domain/model";
import { studioDateKey } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";
import { InvoiceDocument } from "./InvoiceDocument";
import "./InvoiceWorkspace.css";

export function InvoiceWorkspace({
  data,
  isDemo,
  studentId,
  readOnly = false,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  studentId?: string;
  readOnly?: boolean;
}) {
  const query = useInvoices(isDemo, data.invoices, readOnly),
    client = useQueryClient(),
    store = useStudioStore();
  const [params, setParams] = useSearchParams(),
    [editing, setEditing] = useState<Invoice | "new">(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [payment, setPayment] = useState(""),
    [method, setMethod] = useState<"cash" | "bank">("cash"),
    [review, setReview] = useState<string[]>();
  const invoices = (query.data ?? []).filter(
    (i) =>
      (!studentId || i.student_id === studentId) &&
      (!readOnly || i.status !== "draft"),
  );
  const selected = invoices.find((i) => i.id === params.get("invoice"));
  const logo = useQuery({
    queryKey: [
      "invoice-logo",
      readOnly,
      selected?.id,
      selected?.branding.logoStoragePath,
    ],
    enabled: !!selected?.branding.logoStoragePath && !isDemo,
    staleTime: 30 * 60000,
    queryFn: async () =>
      (await import("./downloadInvoice")).invoiceLogoUrl(selected!.id),
  });
  const logoUrl = selected?.branding.logoStoragePath
    ? isDemo
      ? data.settings.branding.logoUrl
      : logo.data
    : selected?.branding.logoUrl;
  function open(id: string) {
    setPayment("");
    setReview(undefined);
    setParams((p) => {
      p.set("invoice", id);
      return p;
    });
  }
  function close() {
    setParams((p) => {
      p.delete("invoice");
      return p;
    });
    setReview(undefined);
  }
  async function refresh() {
    await client.invalidateQueries({ queryKey: ["invoices"] });
    await invalidateStudioDomains(client, [
      "finance",
      "lessons",
      "booking",
      "messaging",
    ]);
    await client.invalidateQueries({ queryKey: ["credit-account"] });
  }
  function storeDemo(invoice: Invoice) {
    store.transact((draft) => {
      draft.invoices = [
        ...(draft.invoices ?? []).filter((i) => i.id !== invoice.id),
        invoice,
      ];
    });
  }
  async function command(
    action: string,
    payload: Record<string, unknown> = {},
  ) {
    if (!selected || busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (isDemo) {
        if (action === "checkout")
          throw new Error(
            "Online payment is available on live invoices. No demo payment was created.",
          );
        if (action === "preview_recipients") {
          setReview(selected.recipient.email ? [selected.recipient.email] : []);
          return;
        }
        if (action === "send") {
          setReview(undefined);
          setNotice("Demo approval recorded. No email was sent.");
          return;
        }
        const inv = structuredClone(selected);
        if (action === "void") {
          if (inv.paid_minor || inv.credit_minor)
            throw new Error("A settled invoice cannot be voided.");
          inv.status = "void";
          store.transact((draft) => {
            for (const line of inv.items)
              for (const id of line.lessonIds) {
                const lesson = draft.lessons.find(
                  (l) => l.id === id && l.invoiceId === inv.id,
                );
                if (
                  lesson &&
                  !lesson.paidMinor &&
                  ["due", "waived"].includes(lesson.paymentStatus ?? "")
                ) {
                  lesson.priceMinor = line.originalLesson?.priceMinor;
                  lesson.paymentStatus = line.originalLesson
                    ?.paymentStatus as typeof lesson.paymentStatus;
                  lesson.serviceId = line.originalLesson?.serviceId;
                  lesson.invoiceId = undefined;
                }
              }
          });
        } else if (action === "apply_lesson_credit") {
          const line = inv.items.find((l) => l.id === payload.lineId);
          if (
            !line ||
            line.lessonIds.length !== 1 ||
            line.cancelled ||
            line.waivedMinor ||
            line.unitMinor <= 0 ||
            line.paidMinor ||
            line.creditMinor
          )
            throw new Error("Choose one unpaid linked lesson.");
          store.transact((draft) => {
            const lesson = draft.lessons.find(
              (l) => l.id === line.lessonIds[0],
            );
            if (!lesson) throw new Error("Lesson not found.");
            const pkg = draft.packages
              .filter(
                (p) =>
                  p.studentId === inv.student_id &&
                  (!p.expiresAt ||
                    Date.parse(p.expiresAt) >
                      Math.max(Date.now(), Date.parse(lesson.startsAt))) &&
                  draft.creditEntries
                    .filter((e) => e.packageId === p.id)
                    .reduce((n, e) => n + e.quantity, 0) > 0,
              )
              .sort((a, b) =>
                (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999"),
              )[0];
            if (
              !draft.packages.some(
                (p) =>
                  p.studentId === inv.student_id &&
                  lessonCreditDebit(draft.creditEntries, lesson.id, p.id) > 0,
              )
            ) {
              if (!pkg) throw new Error("No valid credit available.");
              draft.creditEntries.push({
                id: crypto.randomUUID(),
                packageId: pkg.id,
                lessonId: lesson.id,
                kind: "reservation",
                quantity: -1,
                reason: `Invoice ${inv.number}`,
                createdAt: new Date().toISOString(),
              });
              lesson.packageId = pkg.id;
              lesson.paymentStatus = "paid_by_credit";
            }
          });
          line.creditMinor = line.quantity * line.unitMinor;
          inv.credit_minor += line.creditMinor;
        } else {
          const amount = Number(payload.amountMinor);
          if (
            !Number.isInteger(amount) ||
            amount <= 0 ||
            amount > invoiceDue(inv)
          )
            throw new Error("Enter an amount within the outstanding balance.");
          let remaining = amount;
          store.transact((draft) => {
            if (
              action === "apply_account_credit" &&
              amount >
                studentBalanceMinor(
                  inv.student_id,
                  draft.payments,
                  inv.currency,
                )
            )
              throw new Error("Insufficient dollar balance.");
            draft.payments.push({
              id: crypto.randomUUID(),
              studentId: inv.student_id,
              kind:
                action === "apply_account_credit" ? "adjustment" : "payment",
              accountCredit: action === "apply_account_credit",
              amountMinor: amount,
              currency: inv.currency,
              reason: `Invoice ${inv.number}`,
              createdAt: new Date().toISOString(),
            });
            for (const line of inv.items) {
              const take = Math.min(
                remaining,
                line.quantity * line.unitMinor -
                  line.paidMinor -
                  line.creditMinor,
              );
              line.paidMinor += take;
              remaining -= take;
              if (
                take &&
                line.kind === "package" &&
                !line.packageId &&
                line.paidMinor === line.quantity * line.unitMinor
              ) {
                const def = draft.packageDefinitions.find(
                  (d) => d.id === line.referenceId,
                );
                if (!def) throw new Error("Package not found.");
                const id = crypto.randomUUID();
                line.packageId = id;
                draft.packages.push({
                  id,
                  definitionId: def.id,
                  studentId: inv.student_id,
                  name: line.description,
                  priceMinor: line.quantity * line.unitMinor,
                  currency: inv.currency,
                  expiresAt: line.expirationDays
                    ? new Date(
                        Date.now() + line.expirationDays * 86400000,
                      ).toISOString()
                    : undefined,
                  autoApply:
                    draft.packages
                      .filter((p) => p.studentId === inv.student_id)
                      .every((p) => p.autoApply) &&
                    draft.packages.some((p) => p.studentId === inv.student_id),
                  version: 1,
                  updatedAt: new Date().toISOString(),
                });
                draft.creditEntries.push({
                  id: crypto.randomUUID(),
                  packageId: id,
                  quantity:
                    line.creditQuantity ?? line.quantity * def.sessionCount,
                  kind: "purchase",
                  reason: `Invoice ${inv.number}`,
                  createdAt: new Date().toISOString(),
                });
              }
              if (take && line.lessonIds.length) {
                const l = draft.lessons.find((l) => l.id === line.lessonIds[0]);
                if (l) {
                  l.paidMinor = line.paidMinor;
                  l.paymentStatus =
                    line.paidMinor === line.quantity * line.unitMinor
                      ? "paid"
                      : "partially_paid";
                  l.version++;
                  for (const b of draft.bookings.filter(
                    (b) =>
                      b.studentId === inv.student_id &&
                      draft.lessonParticipants.some(
                        (p) => p.bookingId === b.id && p.lessonId === l.id,
                      ),
                  )) {
                    b.paidMinor = draft.lessonParticipants
                      .filter((p) => p.bookingId === b.id)
                      .reduce(
                        (n, p) =>
                          n +
                          (draft.lessons.find((l) => l.id === p.lessonId)
                            ?.paidMinor ?? 0),
                        0,
                      );
                    b.paymentStatus = draft.lessonParticipants
                      .filter((p) => p.bookingId === b.id)
                      .every((p) =>
                        ["paid", "paid_by_credit", "waived"].includes(
                          draft.lessons.find((l) => l.id === p.lessonId)
                            ?.paymentStatus ?? "",
                        ),
                      )
                      ? "paid"
                      : "partially_paid";
                    b.version++;
                  }
                }
              }
            }
            reserveDemoCredits(draft, inv.student_id);
          });
          inv.paid_minor += amount;
        }
        if (inv.status !== "void")
          inv.status = invoiceDue(inv) === 0 ? "paid" : "partially_paid";
        inv.version++;
        storeDemo(inv);
      } else {
        const result = await studioCommand("invoices", {
          command: action,
          entityId: selected.id,
          expectedVersion: selected.version,
          payload: { ...payload, returnTo: readOnly ? "student" : "coach" },
          reason: `Reviewed invoice ${selected.number}`,
        });
        if (action === "checkout" && result.resource.url) {
          window.location.assign(result.resource.url);
          return;
        }
        if (action === "preview_recipients") {
          setReview(result.resource.recipients);
          return;
        }
        await refresh();
      }
      setPayment("");
      setReview(undefined);
      setNotice(
        action === "send"
          ? "Invoice approved and queued for sending."
          : "Invoice updated.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Invoice could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }
  const accountMinor = selected
    ? Math.max(
        0,
        studentBalanceMinor(
          selected.student_id,
          data.payments,
          selected.currency,
        ),
      )
    : 0;
  return (
    <div className="invoice-workspace">
      <Section
        title="Invoices"
        aside={
          !readOnly && (
            <button className="primary" onClick={() => setEditing("new")}>
              <Plus size={16} /> Create invoice
            </button>
          )
        }
      >
        {query.isLoading && <p role="status">Loading invoices…</p>}
        {query.error && <p role="alert">{query.error.message}</p>}
        <div className="table-list">
          {invoices.map((inv) => (
            <article key={inv.id}>
              <FileText />
              <div>
                <strong>
                  {inv.number} · {inv.recipient.name}
                </strong>
                <small>
                  Due {inv.due_date} · {inv.items.length} item(s)
                </small>
              </div>
              <Status
                tone={
                  inv.status === "paid"
                    ? "good"
                    : inv.status === "void"
                      ? "neutral"
                      : "warn"
                }
              >
                {inv.status.replaceAll("_", " ")}
              </Status>
              <strong>{formatMoney(invoiceDue(inv), inv.currency)}</strong>
              <button onClick={() => open(inv.id)}>View invoice</button>
            </article>
          ))}
        </div>
        {!query.isLoading && !query.error && !invoices.length && (
          <EmptyState
            title="No invoices yet"
            detail={
              readOnly
                ? "Your studio’s invoices will appear here."
                : "Choose a student and services or packages to create your first invoice."
            }
          />
        )}
        {notice && (
          <p className="portal-notice" role="status">
            {notice}
          </p>
        )}
      </Section>
      {editing && (
        <InvoiceEditor
          data={data}
          studentId={studentId}
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSave={async (value, status) => {
            if (isDemo) {
              const existing = editing === "new" ? undefined : editing;
              const now = new Date().toISOString();
              for (const line of value.items) {
                if (line.kind === "package") {
                  const def = data.packageDefinitions.find(
                    (p) => p.id === line.referenceId,
                  );
                  if (!def) throw new Error("Package not found.");
                  line.creditQuantity = line.quantity * def.sessionCount;
                  line.expirationDays = def.expirationDays ?? null;
                }
                if (line.lessonIds.length) {
                  const lesson = data.lessons.find(
                    (l) => l.id === line.lessonIds[0],
                  );
                  if (!lesson) throw new Error("Lesson not found.");
                  if (
                    status !== "draft" &&
                    (data.invoices ?? []).some(
                      (i) =>
                        !["draft", "void"].includes(i.status) &&
                        i.items.some((l) => l.lessonIds.includes(lesson.id)),
                    )
                  )
                    throw new Error("This lesson is already invoiced.");
                  line.originalLesson = {
                    priceMinor: lesson.priceMinor,
                    paymentStatus: lesson.paymentStatus,
                    serviceId: lesson.serviceId,
                  };
                }
              }
              const invoice = {
                ...value,
                id: existing?.id ?? crypto.randomUUID(),
                number:
                  existing?.number ??
                  `INV-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
                studio_id: data.studioId,
                status:
                  status === "draft"
                    ? "draft"
                    : value.total_minor === 0
                      ? "paid"
                      : "open",
                version: (existing?.version ?? 0) + 1,
                created_at: existing?.created_at ?? now,
              } as Invoice;
              storeDemo(invoice);
              store.transact((draft) => {
                if (status !== "draft")
                  for (const line of invoice.items)
                    for (const id of line.lessonIds) {
                      const l = draft.lessons.find((l) => l.id === id);
                      if (l) {
                        l.invoiceId = invoice.id;
                        l.priceMinor = line.unitMinor;
                        if (l.paymentStatus !== "paid_by_credit")
                          l.paymentStatus =
                            line.unitMinor === 0 ? "waived" : "due";
                      }
                    }
              });
              setEditing(undefined);
              open(invoice.id);
            } else {
              const result = await studioCommand("invoices", {
                command: "save",
                entityId: editing === "new" ? undefined : editing.id,
                expectedVersion: editing === "new" ? 0 : editing.version,
                payload: { ...value, status },
                reason: "Coach saved invoice",
              });
              await refresh();
              setEditing(undefined);
              open(result.resource.id);
            }
          }}
        />
      )}
      {selected && !editing && !review && (
        <Drawer
          title={selected.number}
          description={`${selected.recipient.name} · ${selected.status.replaceAll("_", " ")}`}
          onClose={() => !busy && close()}
        >
          <div className="header-actions">
            <button
              disabled={
                busy ||
                (isDemo && !!selected.branding.logoStoragePath && !logoUrl)
              }
              onClick={async () => {
                setBusy(true);
                try {
                  const pdf = await import("./downloadInvoice");
                  await pdf.downloadInvoice(selected, isDemo, logoUrl);
                } catch (e) {
                  setNotice(
                    e instanceof Error
                      ? e.message
                      : "PDF could not be downloaded.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Download size={16} /> Download PDF
            </button>
            {!readOnly && selected.status === "draft" && (
              <button onClick={() => setEditing(selected)}>
                Edit / issue draft
              </button>
            )}
            {!readOnly && !["draft", "void"].includes(selected.status) && (
              <button
                disabled={busy}
                onClick={() => void command("preview_recipients")}
              >
                Review and send
              </button>
            )}
            {!readOnly &&
              !selected.paid_minor &&
              !selected.credit_minor &&
              !selected.checkout_key &&
              selected.status !== "void" && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Void this invoice? Linked unpaid charges will be removed.",
                      )
                    )
                      void command("void");
                  }}
                >
                  Void invoice
                </button>
              )}
          </div>
          {logo.error && (
            <p role="alert">
              The saved studio logo could not be loaded. Refresh before
              downloading the PDF.
            </p>
          )}
          <InvoiceDocument invoice={selected} logoUrl={logoUrl} />
          {selected.checkout_key && (
            <Section title="Online payment pending">
              <p>
                This payment is reserved while checkout is open or processing.
                Check its status, or cancel an open checkout before recording
                another payment or applying credits.
              </p>
              <div className="header-actions">
                <button
                  disabled={busy}
                  onClick={() => void command("check_checkout")}
                >
                  Check payment status
                </button>
                <button
                  disabled={busy}
                  onClick={() => void command("cancel_checkout")}
                >
                  Cancel open checkout
                </button>
              </div>
            </Section>
          )}
          {invoiceDue(selected) > 0 && !selected.checkout_key && (
            <Section title="Settle this invoice">
              <form
                className="invoice-payment-form"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void command(readOnly ? "checkout" : "record_payment", {
                    amountMinor: Math.round(
                      Number(payment || invoiceDue(selected) / 100) * 100,
                    ),
                    method,
                  });
                }}
              >
                <label>
                  Amount ({selected.currency})
                  <input
                    type="number"
                    min="0.01"
                    max={invoiceDue(selected) / 100}
                    step="0.01"
                    required
                    value={payment || String(invoiceDue(selected) / 100)}
                    onChange={(e) => setPayment(e.target.value)}
                  />
                </label>
                {!readOnly && (
                  <label>
                    Received by
                    <select
                      value={method}
                      onChange={(e) =>
                        setMethod(e.target.value as "cash" | "bank")
                      }
                    >
                      <option value="cash">Cash</option>
                      <option value="bank">Bank transfer</option>
                    </select>
                  </label>
                )}
                <button className="primary" disabled={busy}>
                  {readOnly ? "Pay online" : "Record payment"}
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void command("checkout", {
                        amountMinor: Math.round(
                          Number(payment || invoiceDue(selected) / 100) * 100,
                        ),
                      })
                    }
                  >
                    Pay online
                  </button>
                )}
              </form>
              {accountMinor > 0 && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void command("apply_account_credit", {
                      amountMinor: Math.min(accountMinor, invoiceDue(selected)),
                    })
                  }
                >
                  Apply{" "}
                  {formatMoney(
                    Math.min(accountMinor, invoiceDue(selected)),
                    selected.currency,
                  )}{" "}
                  account credit
                </button>
              )}
              {selected.items
                .filter(
                  (l) =>
                    l.kind === "service" &&
                    l.lessonIds.length === 1 &&
                    !l.cancelled &&
                    !l.waivedMinor &&
                    l.unitMinor > 0 &&
                    !l.paidMinor &&
                    !l.creditMinor,
                )
                .map((l) => (
                  <div className="header-actions" key={l.id}>
                    <span>{l.description}</span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void command("apply_lesson_credit", { lineId: l.id })
                      }
                    >
                      Apply one lesson credit
                    </button>
                  </div>
                ))}
            </Section>
          )}
          {notice && (
            <p className="portal-notice" role="status">
              {notice}
            </p>
          )}
          <div className="form-actions">
            <button className="primary" disabled={busy} onClick={close}>
              Done
            </button>
          </div>
        </Drawer>
      )}
      {review && (
        <Dialog
          title="Review invoice email"
          description="Only the permitted financial recipients below will receive this invoice link."
          onClose={() => !busy && setReview(undefined)}
        >
          <p>
            Invoice {selected?.number} ·{" "}
            {selected && formatMoney(invoiceDue(selected), selected.currency)}{" "}
            due
          </p>
          <ul>
            {review.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
          {!review.length && (
            <p>
              No permitted recipients. Update the student’s payer/contact
              settings.
            </p>
          )}
          <div className="form-actions">
            <button disabled={busy} onClick={() => setReview(undefined)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !review.length}
              onClick={() => void command("send", { recipients: review })}
            >
              Approve and send
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function InvoiceEditor({
  data,
  studentId,
  initial,
  onClose,
  onSave,
}: {
  data: StudioSnapshot;
  studentId?: string;
  initial?: Invoice;
  onClose: () => void;
  onSave: (invoice: Invoice, status: "draft" | "open") => Promise<void>;
}) {
  const [student, setStudent] = useState(
      initial?.student_id ?? studentId ?? "",
    ),
    [issue, setIssue] = useState(
      initial?.issue_date ?? studioDateKey(new Date(), data.settings.timezone),
    ),
    [due, setDue] = useState(
      initial?.due_date ??
        studioDateKey(
          new Date(Date.now() + 14 * 86400000),
          data.settings.timezone,
        ),
    ),
    [intro, setIntro] = useState(
      initial?.introduction ??
        "Thank you for choosing our studio. Here are the details of your upcoming services.",
    ),
    [notes, setNotes] = useState(
      initial?.notes ??
        "Pay securely through your student portal, or contact the studio to arrange payment.",
    ),
    [footer, setFooter] = useState(
      initial?.footer ?? "We look forward to working with you.",
    ),
    [items, setItems] = useState<InvoiceLine[]>(initial?.items ?? []),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const recipient = data.students.find((s) => s.id === student);
  const document: Invoice = {
    id: initial?.id ?? "",
    studio_id: data.studioId,
    student_id: student,
    number: initial?.number ?? "DRAFT",
    status: "draft",
    currency: initial?.currency ?? data.settings.currency,
    issue_date: issue,
    due_date: due,
    introduction: intro,
    notes,
    footer,
    branding: initial?.branding ?? {
      studioName: data.settings.studioName,
      email: data.settings.contactEmail,
      logoStoragePath: data.settings.branding.logoStoragePath,
      logoUrl: data.settings.branding.logoUrl,
    },
    recipient: {
      name: recipient?.fullName ?? "Choose a student",
      email: recipient?.email,
    },
    items,
    total_minor: items.reduce((n, l) => n + l.quantity * l.unitMinor, 0),
    paid_minor: 0,
    credit_minor: 0,
    version: initial?.version ?? 0,
    created_at: initial?.created_at ?? new Date().toISOString(),
  };
  function change(id: string, values: Partial<InvoiceLine>) {
    setItems((rows) =>
      rows.map((l) => (l.id === id ? { ...l, ...values } : l)),
    );
  }
  function add(kind: "service" | "package") {
    const source =
      kind === "service"
        ? data.bookingServices[0]
        : (() => {
            const definition = data.packageDefinitions.find((p) => p.active);
            return definition
              ? packageOffer(definition, data, recipient)
              : undefined;
          })();
    if (!source) {
      setError(`Add a ${kind} before invoicing it.`);
      return;
    }
    setItems((rows) => [
      ...rows,
      {
        id: crypto.randomUUID(),
        kind,
        referenceId: source.id,
        description: source.name,
        quantity: 1,
        unitMinor: source.priceMinor,
        startsOn: issue,
        endsOn: issue,
        lessonIds: [],
        creditMinor: 0,
        paidMinor: 0,
      },
    ]);
  }
  async function save(status: "draft" | "open") {
    setError("");
    try {
      if (!recipient || !items.length)
        throw new Error("Choose a student and add at least one item.");
      if (!issue || !due) throw new Error("Choose issue and due dates.");
      if (due < issue)
        throw new Error("The due date must follow the issue date.");
      const linked = items.flatMap((l) => l.lessonIds);
      if (new Set(linked).size !== linked.length)
        throw new Error("Each lesson can appear only once.");
      for (const l of items) {
        invoiceLineTotal(l);
        if (l.kind === "package" && l.unitMinor === 0)
          throw new Error(
            "Package invoices need a positive price. Use Set remaining credits to give complimentary credits.",
          );
        if (!l.description.trim() || !l.startsOn || !l.endsOn)
          throw new Error("Complete each description and coverage date.");
        if (l.endsOn < l.startsOn) throw new Error("Check the coverage dates.");
        if (l.lessonIds.length && l.quantity !== 1)
          throw new Error("Use one line for each linked lesson.");
      }
      setBusy(true);
      await onSave(document, status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invoice could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={initial ? "Edit draft invoice" : "Create invoice"}
      description="Save a draft, or issue the invoice to add it to the student’s payment record. Sending is a separate reviewed action."
      onClose={() => !busy && onClose()}
    >
      <div className="invoice-editor">
        <div className="header-actions">
          <button onClick={() => setPreview(!preview)}>
            {preview ? "Back to editing" : "Preview invoice"}
          </button>
        </div>
        {preview ? (
          <InvoiceDocument
            invoice={document}
            logoUrl={data.settings.branding.logoUrl}
          />
        ) : (
          <>
            <div className="workflow-form">
              <label className="full">
                Student
                <select
                  value={student}
                  required
                  disabled={!!studentId || !!initial}
                  onChange={(e) => {
                    setStudent(e.target.value);
                    setItems((rows) =>
                      rows.map((l) => {
                        const definition =
                          l.kind === "package" && !initial
                            ? data.packageDefinitions.find(
                                (item) => item.id === l.referenceId,
                              )
                            : undefined;
                        const offer = definition
                          ? packageOffer(
                              definition,
                              data,
                              data.students.find(
                                (item) => item.id === e.target.value,
                              ),
                            )
                          : undefined;
                        return {
                          ...l,
                          ...(offer ? { unitMinor: offer.priceMinor } : {}),
                          lessonIds: [],
                        };
                      }),
                    );
                  }}
                >
                  <option value="">Choose student</option>
                  {data.students.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Issue date
                <input
                  type="date"
                  required
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                />
              </label>
              <label>
                Due date
                <input
                  type="date"
                  required
                  min={issue}
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
            </div>
            {items.map((l, index) => (
              <div className="invoice-line-editor" key={l.id}>
                <div className="header-actions">
                  <strong>
                    Item {index + 1} · {l.kind}
                  </strong>
                  <button
                    onClick={() =>
                      setItems((rows) => rows.filter((r) => r.id !== l.id))
                    }
                  >
                    Remove item
                  </button>
                </div>
                <div className="workflow-form">
                  <label className="full">
                    {l.kind === "service" ? "Service" : "Package"}
                    <select
                      value={l.referenceId}
                      onChange={(e) => {
                        const source = (
                          l.kind === "service"
                            ? data.bookingServices
                            : data.packageDefinitions
                        ).find((s) => s.id === e.target.value);
                        const priced =
                          source && l.kind === "package"
                            ? packageOffer(
                                source as StudioSnapshot["packageDefinitions"][number],
                                data,
                                recipient,
                              )
                            : source;
                        if (priced)
                          change(l.id, {
                            referenceId: priced.id,
                            description: priced.name,
                            unitMinor: priced.priceMinor,
                            lessonIds: [],
                          });
                      }}
                    >
                      {(l.kind === "service"
                        ? data.bookingServices
                        : data.packageDefinitions.filter(
                            (p) => p.active || p.id === l.referenceId,
                          )
                      ).map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="full">
                    Description
                    <input
                      required
                      maxLength={500}
                      value={l.description}
                      onChange={(e) =>
                        change(l.id, { description: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Quantity
                    <input
                      type="number"
                      min={1}
                      max={500}
                      step={1}
                      value={l.quantity}
                      onChange={(e) =>
                        change(l.id, { quantity: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Unit price ({document.currency})
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.unitMinor / 100}
                      onChange={(e) =>
                        change(l.id, {
                          unitMinor: Math.round(Number(e.target.value) * 100),
                        })
                      }
                    />
                  </label>
                  <label>
                    Coverage starts
                    <input
                      type="date"
                      required
                      value={l.startsOn}
                      onChange={(e) =>
                        change(l.id, { startsOn: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Coverage ends
                    <input
                      type="date"
                      required
                      min={l.startsOn}
                      value={l.endsOn}
                      onChange={(e) => change(l.id, { endsOn: e.target.value })}
                    />
                  </label>
                  {l.kind === "service" && (
                    <label className="full">
                      Link an existing lesson (optional)
                      <select
                        value={l.lessonIds[0] ?? ""}
                        onChange={(e) =>
                          change(l.id, {
                            lessonIds: e.target.value ? [e.target.value] : [],
                            quantity: e.target.value ? 1 : l.quantity,
                          })
                        }
                      >
                        <option value="">Dates only · no lesson created</option>
                        {data.lessons
                          .filter(
                            (x) =>
                              x.studentId === student &&
                              (!x.serviceId || x.serviceId === l.referenceId) &&
                              !["cancelled", "late_cancelled"].includes(
                                x.status,
                              ) &&
                              !(x.paidMinor ?? 0) &&
                              !["paid", "waived", "refunded"].includes(
                                x.paymentStatus ?? "",
                              ),
                          )
                          .map((x) => (
                            <option value={x.id} key={x.id}>
                              {new Date(x.startsAt).toLocaleDateString()} ·{" "}
                              {x.topic}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </div>
                <strong>
                  {formatMoney(l.quantity * l.unitMinor, document.currency)}
                </strong>
              </div>
            ))}
            <div className="header-actions">
              <button onClick={() => add("service")}>Add service</button>
              <button onClick={() => add("package")}>Add package</button>
              <strong>
                Total {formatMoney(document.total_minor, document.currency)}
              </strong>
            </div>
            <div className="workflow-form">
              <label className="full">
                Introduction
                <WritingArea
                  maxLength={3000}
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                />
              </label>
              <label className="full">
                Notes / payment instructions
                <WritingArea
                  maxLength={5000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <label className="full">
                Footer
                <WritingArea
                  maxLength={2000}
                  value={footer}
                  onChange={(e) => setFooter(e.target.value)}
                />
              </label>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} onClick={() => void save("draft")}>
            Save draft
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void save("open")}
          >
            {busy ? "Saving…" : "Save invoice"}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
