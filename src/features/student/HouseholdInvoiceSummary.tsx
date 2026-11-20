import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Section } from "../../components/Primitives";
import { useInvoices } from "../../data/invoices";
import type { PortalContext } from "../../data/portalContext";
import { portalContextLink } from "../../domain/coachingContext";
import { directLessonReceipt } from "../../domain/directLessonReceipt";
import { formatMoney } from "../../domain/finance";
import { invoiceDue } from "../../domain/invoices";
import { lessonPaymentPath } from "../../domain/lessonPaymentLink";
import type { StudioSnapshot } from "../../domain/model";
import { formatStudioDate } from "../../domain/presentation";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { supabase } from "../../lib/supabase";
import { useTrainingPayers } from "./useTrainingPayers";

const receiptPageSize = 10;

export function HouseholdInvoiceSummary({
  data,
  students,
  studentId,
  isDemo,
}: {
  data: StudioSnapshot;
  students: Pick<PortalContext, "id" | "fullName" | "preferredName">[];
  studentId: string;
  isDemo: boolean;
}) {
  const invoices = useInvoices(isDemo, data.invoices, true);
  const identity = usePrivateIdentity();
  const studentIds = [...new Set(students.map(({ id }) => id))].sort();
  const receiptScope = JSON.stringify([identity, data.studioId, studentIds]);
  const [receiptPage, setReceiptPage] = useState({ scope: "", number: 0 });
  const page = receiptPage.scope === receiptScope ? receiptPage.number : 0;
  const receipts = useQuery({
    queryKey: ["household-payment-history", receiptScope, page],
    enabled: !isDemo && !!identity && studentIds.length > 1,
    queryFn: async ({ signal }) => {
      const session = await supabase?.auth.getSession();
      if (!supabase || session?.data.session?.user.id !== identity)
        throw new Error("Sign in to view household payments.");
      const start = page * receiptPageSize;
      const { data: entries, error } = await supabase
        .from("payment_entries")
        .select(
          "id,student_id,kind,amount_minor,currency,created_at,external_reference,students!inner(studio_id)",
        )
        .in("student_id", studentIds)
        .eq("students.studio_id", data.studioId)
        .in("kind", ["payment", "refund"])
        .eq("account_credit", false)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(start, start + receiptPageSize)
        .abortSignal(signal);
      if (error) throw error;
      return {
        entries: entries.slice(0, receiptPageSize),
        more: entries.length > receiptPageSize,
      };
    },
  });
  const payer = useTrainingPayers(
    studentId,
    students.map(({ id }) => id),
    !isDemo,
  );
  const rows = invoices.data?.filter(
    (invoice) => invoice.studio_id === data.studioId,
  );
  const canChoose =
    payer.data?.ready && payer.data.studentIds.includes(studentId);

  return (
    <Section
      title="Household payments"
      aside={
        canChoose && (
          <Link
            className="button-link primary"
            to={lessonPaymentPath(studentId)}
          >
            Choose lessons
          </Link>
        )
      }
    >
      {invoices.isLoading && <p role="status">Checking household invoices…</p>}
      {invoices.error && (
        <p role="alert">Household invoices could not be loaded.</p>
      )}
      {rows && (
        <div className="table-list">
          {students.map((student) => {
            const balances = new Map<string, number>();
            for (const invoice of rows.filter(
              (row) => row.student_id === student.id,
            )) {
              const amount = invoiceDue(invoice);
              if (amount > 0)
                balances.set(
                  invoice.currency,
                  (balances.get(invoice.currency) ?? 0) + amount,
                );
            }
            const name = student.preferredName || student.fullName;
            return (
              <article key={student.id}>
                <div>
                  <strong>{name}</strong>
                  <small>
                    {balances.size
                      ? [...balances]
                          .map(([currency, amount]) =>
                            formatMoney(amount, currency),
                          )
                          .join(" · ") + " on open invoices"
                      : "No open invoice balance"}
                  </small>
                </div>
                <Link
                  to={portalContextLink("/portal/payments", student.id)}
                  aria-label={`View payments for ${name}`}
                >
                  View payments
                </Link>
              </article>
            );
          })}
        </div>
      )}
      {!isDemo && (
        <details className="disclosure-section">
          <summary>Household payment history</summary>
          {receipts.isLoading && <p role="status">Checking payment history…</p>}
          {receipts.isError && (
            <p role="alert">Household payment history could not be loaded.</p>
          )}
          {receipts.data?.entries.length === 0 && (
            <p>No payments or refunds to show.</p>
          )}
          <div className="table-list">
            {receipts.data?.entries.map((entry) => {
              const student = students.find(
                ({ id }) => id === entry.student_id,
              );
              if (!student) return null;
              const receipt = directLessonReceipt(entry.external_reference);
              return (
                <article key={entry.id}>
                  <div>
                    <strong>{student.preferredName || student.fullName}</strong>
                    <small>
                      {entry.kind === "refund" ? "Refund" : "Payment"} ·{" "}
                      {formatStudioDate(
                        entry.created_at,
                        data.settings.timezone,
                      )}
                    </small>
                    {receipt && (
                      <Link
                        to={portalContextLink(
                          `/portal/lessons/${receipt.lessonId}`,
                          student.id,
                        )}
                      >
                        View paid lesson
                      </Link>
                    )}
                  </div>
                  <strong>
                    {formatMoney(entry.amount_minor, entry.currency)}
                  </strong>
                </article>
              );
            })}
          </div>
          {(page > 0 || receipts.data?.more) && (
            <div
              className="form-actions"
              aria-label="Household payment history pages"
            >
              <button
                type="button"
                disabled={page === 0}
                onClick={() =>
                  setReceiptPage({ scope: receiptScope, number: page - 1 })
                }
              >
                Previous payments
              </button>
              <button
                type="button"
                disabled={!receipts.data?.more}
                onClick={() =>
                  setReceiptPage({ scope: receiptScope, number: page + 1 })
                }
              >
                More payments
              </button>
            </div>
          )}
        </details>
      )}
    </Section>
  );
}
