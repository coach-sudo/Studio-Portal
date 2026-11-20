import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { CircleDollarSign } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import {
  Dialog,
  ListControls,
  usePagedList,
  EmptyState,
  Section,
  Status,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { useInvoices } from "../../data/invoices";
import {
  formatMoney,
  packageSummary,
  studentBalanceMinor,
} from "../../domain/finance";
import type { Lesson, Student } from "../../domain/model";
import { invoiceDue } from "../../domain/invoices";
import {
  recentLessonDuration,
  sortPackageDefinitions,
} from "../../domain/packageSelection";
import { formatStudioDate } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { now, uid, type Data } from "./StudentWorkspace.shared";
import { StudentFinancialSetup } from "./StudentFinancialSetup";
import { PaymentReminderSteps } from "./PaymentReminderSteps";
import { CreditAccount } from "./CreditAccount";
import { InvoiceWorkspace } from "../finance/InvoiceWorkspace";
import { CoachLessonPaymentDialog } from "../finance/CoachLessonBilling";
import {
  canRecordDirectLessonPayment,
  lessonBillingStatus,
} from "../../domain/lessonPayment";
import { CoachBillingContact } from "../finance/CoachBillingContact";
import { creditApplicationResultSchema } from "../../domain/creditCoverage";
import { creditApplicationMessage } from "../../domain/creditCoveragePresentation";
import { CoachBillingSummary } from "../finance/CoachBillingSummary";
import { packageOffer } from "../../domain/packagePricing";
import { reserveDemoCredits } from "../../domain/credits";

export function Payments({
  data,
  student,
  isDemo,
}: {
  data: Data;
  student: Student;
  isDemo: boolean;
}) {
  const fields = useId();
  const [params, setParams] = useSearchParams();
  const creditsDisclosure = useRef<HTMLDetailsElement>(null);
  const [openComposer, setOpenComposer] = useState(false);
  const [recording, setRecording] = useState(false);
  const [paymentLessonId, setPaymentLessonId] = useState("");
  const [lessonSearch, setLessonSearch] = useState("");
  const [lessonStatus, setLessonStatus] = useState("");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [latestFirst, setLatestFirst] = useState(false);
  const invoices = useInvoices(isDemo, data.invoices);
  const lessons = data.lessons
    .filter(
      (lesson) => lesson.studentId === student.id && lesson.status !== "draft",
    )
    .sort((a, b) =>
      latestFirst
        ? b.startsAt.localeCompare(a.startsAt)
        : a.startsAt.localeCompare(b.startsAt),
    );
  const lessonPage = usePagedList(
    lessons.filter(
      (lesson) =>
        lesson.topic
          .toLowerCase()
          .includes(lessonSearch.trim().toLowerCase()) &&
        (!lessonStatus || lessonBillingStatus(lesson) === lessonStatus),
    ),
  );
  const payableInvoices = (invoices.error ? [] : (invoices.data ?? [])).filter(
    (invoice) =>
      invoice.student_id === student.id &&
      !invoice.checkout_key &&
      invoiceDue(invoice) > 0,
  );
  const recordable = lessons.filter(
    (lesson) =>
      canRecordDirectLessonPayment(lesson) ||
      (lessonBillingStatus(lesson) === "Payment needed" &&
        payableInvoices.some((invoice) => invoice.id === lesson.invoiceId)),
  );
  const paymentLesson = lessons.find((lesson) => lesson.id === paymentLessonId);
  function startPayment(lesson: Lesson) {
    if (payableInvoices.some((invoice) => invoice.id === lesson.invoiceId)) {
      setRecording(false);
      setParams((current) => {
        current.set("invoice", lesson.invoiceId!);
        return current;
      });
      return;
    }
    setPaymentLessonId(lesson.id);
    setRecording(true);
  }

  const pkgs = data.packages.filter((i) => i.studentId === student.id),
    payments = data.payments.filter((i) => i.studentId === student.id),
    preferredDuration = recentLessonDuration(data.lessons, student.id),
    availableDefinitions = sortPackageDefinitions(
      data.packageDefinitions
        .filter((item) => item.active)
        .map((item) => packageOffer(item, data, student))
        .filter((item): item is Data["packageDefinitions"][number] =>
          Boolean(item),
        ),
      preferredDuration,
    );
  const store = useStudioStore(),
    queryClient = useQueryClient(),
    [assigning, setAssigning] = useState(false),
    [definitionId, setDefinitionId] = useState(
      availableDefinitions[0]?.id ?? "",
    ),
    [adjustingBalance, setAdjustingBalance] = useState(false),
    [balanceAmount, setBalanceAmount] = useState("0.00"),
    [balanceReason, setBalanceReason] = useState("Studio account credit"),
    [notice, setNotice] = useState("");
  const assignmentIntent = useRef<{ signature: string; key: string } | null>(
    null,
  );
  const assigningNow = useRef(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const paymentPage = usePagedList(
    payments
      .filter((entry) =>
        [entry.reason, entry.externalReference, entry.kind].some((value) =>
          value?.toLowerCase().includes(paymentSearch.trim().toLowerCase()),
        ),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  const packagePage = usePagedList(pkgs);
  const autoApplyOnAssign = pkgs.length > 0 && pkgs.every((p) => p.autoApply);
  const adjustBalance = async (event: FormEvent) => {
    event.preventDefault();
    const amountMinor = Math.round(Number(balanceAmount) * 100);
    if (!amountMinor || balanceReason.trim().length < 3) return;
    try {
      if (isDemo) {
        store.transact((draft) => {
          draft.payments.push({
            id: uid("payment"),
            studentId: student.id,
            kind: amountMinor > 0 ? "refund" : "adjustment",
            amountMinor: Math.abs(amountMinor),
            accountCredit: true,
            currency: data.settings.currency,
            reason: balanceReason.trim(),
            createdAt: now(),
          });
        });
      } else {
        await studioCommand("finance", {
          command: "adjust_account_credit",
          entityId: student.id,
          expectedVersion: 0,
          payload: {
            amountMinor,
            currency: data.settings.currency,
            reason: balanceReason.trim(),
          },
          reason: "Coach adjusted student dollar balance",
        });
        await invalidateStudioDomains(queryClient, [
          "finance",
          "lessons",
          "booking",
        ]);
      }
      setAdjustingBalance(false);
      setBalanceAmount("0.00");
      setNotice(
        `${amountMinor > 0 ? "Added" : "Removed"} ${formatMoney(Math.abs(amountMinor))} ${amountMinor > 0 ? "of account credit" : "from the account balance"}.`,
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "The account balance could not be adjusted.",
      );
    }
  };
  const assign = async (event: FormEvent) => {
    event.preventDefault();
    const definition = availableDefinitions.find(
      (item) => item.id === definitionId,
    );
    if (!definition || assigningNow.current) return;
    const signature = JSON.stringify([
      student.id,
      definitionId,
      definition.priceMinor,
      definition.currency,
    ]);
    if (assignmentIntent.current?.signature !== signature)
      assignmentIntent.current = { signature, key: crypto.randomUUID() };
    assigningNow.current = true;
    setAssignBusy(true);
    try {
      if (isDemo)
        store.transact((draft) => {
          const packageId = uid("package");
          draft.packages.push({
            id: packageId,
            studentId: student.id,
            name: definition.name,
            priceMinor: definition.priceMinor,
            currency: definition.currency,
            autoApply: autoApplyOnAssign,
            expiresAt: definition.expirationDays
              ? new Date(
                  Date.now() + definition.expirationDays * 86400000,
                ).toISOString()
              : undefined,
            version: 1,
            updatedAt: now(),
          });
          draft.creditEntries.push({
            id: uid("credit"),
            packageId,
            kind: "adjustment",
            quantity: definition.sessionCount,
            reason: "Coach assigned package",
            createdAt: now(),
          });
          if (autoApplyOnAssign) reserveDemoCredits(draft, student.id);
        });
      else {
        const result = await studioCommand("packages", {
          command: "assign",
          idempotencyKey: assignmentIntent.current.key,
          expectedVersion: 0,
          payload: {
            definitionId,
            expectedPriceMinor: definition.priceMinor,
            expectedCurrency: definition.currency,
            studentId: student.id,
            autoApply: autoApplyOnAssign,
            reason: "Coach assigned package",
          },
          reason: "Coach assigned package",
        });
        await invalidateStudioDomains(queryClient, [
          "finance",
          "lessons",
          "booking",
        ]);
        const coverage = creditApplicationResultSchema.safeParse(
          result.resource.coverage,
        );
        assignmentIntent.current = null;
        setAssigning(false);
        setNotice(
          `Package assigned. ${coverage.success ? creditApplicationMessage(coverage.data) : "Refresh coverage to verify application."}`,
        );
        return;
      }
      assignmentIntent.current = null;
      setAssigning(false);
      setNotice(
        `Package assigned with its full credit balance${autoApplyOnAssign ? "; eligible upcoming lessons will use its credits automatically" : ""}.`,
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Package could not be assigned.",
      );
    } finally {
      assigningNow.current = false;
      setAssignBusy(false);
    }
  };
  return (
    <div className="student-billing-workspace">
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <CoachBillingSummary data={data} studentId={student.id} isDemo={isDemo} />
      <div className="student-billing-grid">
        <Section title="Lessons">
          <div className="header-actions student-billing-controls">
            <label htmlFor={`${fields}-lesson-search`}>
              Search lessons
              <input
                id={`${fields}-lesson-search`}
                type="search"
                value={lessonSearch}
                onChange={(event) => {
                  setLessonSearch(event.target.value);
                  lessonPage.setPage(1);
                }}
              />
            </label>
            <label htmlFor={`${fields}-lesson-status`}>
              Status
              <select
                id={`${fields}-lesson-status`}
                value={lessonStatus}
                onChange={(event) => {
                  setLessonStatus(event.target.value);
                  lessonPage.setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {[...new Set(lessons.map(lessonBillingStatus))]
                  .sort()
                  .map((status) => (
                    <option key={status}>{status}</option>
                  ))}
              </select>
            </label>
            <label htmlFor={`${fields}-lesson-sort`}>
              Sort by
              <select
                id={`${fields}-lesson-sort`}
                value={latestFirst ? "latest" : "earliest"}
                onChange={(event) => {
                  setLatestFirst(event.target.value === "latest");
                  lessonPage.setPage(1);
                }}
              >
                <option value="earliest">Earliest first</option>
                <option value="latest">Latest first</option>
              </select>
            </label>
          </div>
          <ul className="lesson-invoice-rows">
            {lessonPage.visible.map((lesson) => {
              const status = lessonBillingStatus(lesson);
              return (
                <li key={lesson.id}>
                  <span>
                    <strong>{lesson.topic}</strong>
                    <small>
                      {formatStudioDate(
                        lesson.startsAt,
                        data.settings.timezone,
                      )}
                    </small>
                  </span>
                  <div className="billing-lesson-actions">
                    <Status
                      tone={status === "Payment needed" ? "warn" : "neutral"}
                    >
                      {status}
                    </Status>
                    {canRecordDirectLessonPayment(lesson) &&
                      lesson.priceMinor !== undefined && (
                        <strong>
                          {formatMoney(
                            lesson.priceMinor - (lesson.paidMinor ?? 0),
                            data.settings.currency,
                          )}
                        </strong>
                      )}
                    <Link
                      className="button-link"
                      to={`/coach/students/${student.id}/lessons/${lesson.id}`}
                    >
                      Open lesson
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          {!lessonPage.total && (
            <EmptyState
              title="No matching lessons"
              detail="Change the search or status to see more lessons."
            />
          )}
          <ListControls
            page={lessonPage.page}
            pageCount={lessonPage.pageCount}
            pageSize={lessonPage.pageSize}
            total={lessonPage.total}
            onPage={lessonPage.setPage}
            onPageSize={lessonPage.setPageSize}
            label="lessons"
          />
          <div className="header-actions">
            <button className="primary" onClick={() => setOpenComposer(true)}>
              Send invoice
            </button>
            <button
              disabled={!recordable.length}
              onClick={() => {
                if (recordable.length === 1) {
                  startPayment(recordable[0]);
                  return;
                }
                setPaymentLessonId("");
                setRecording(true);
              }}
            >
              Record payment
            </button>
            <button
              onClick={() => {
                if (!creditsDisclosure.current) return;
                creditsDisclosure.current.open = true;
                creditsDisclosure.current.querySelector("summary")?.focus();
              }}
            >
              Manage credits
            </button>
          </div>
        </Section>
        <div className="student-billing-sidebar">
          <CoachBillingContact data={data} student={student} isDemo={isDemo} />
          <Section title="Payment history">
            <label
              className="lesson-invoice-field"
              htmlFor={`${fields}-payment-search`}
            >
              Search billing history
              <input
                id={`${fields}-payment-search`}
                type="search"
                value={paymentSearch}
                onChange={(event) => {
                  setPaymentSearch(event.target.value);
                  paymentPage.setPage(1);
                }}
              />
            </label>
            <ListControls
              page={paymentPage.page}
              pageCount={paymentPage.pageCount}
              pageSize={paymentPage.pageSize}
              total={paymentPage.total}
              onPage={paymentPage.setPage}
              onPageSize={paymentPage.setPageSize}
              label="payments"
            />
            <div className="table-list">
              {paymentPage.visible.map((p) => (
                <article key={p.id}>
                  <CircleDollarSign />
                  <div>
                    <strong>{p.reason}</strong>
                    <small>
                      {formatStudioDate(p.createdAt, data.settings.timezone)}
                    </small>
                    {p.externalReference?.startsWith("lesson-payment:") && (
                      <small>
                        Receipt{" "}
                        {p.externalReference.slice("lesson-payment:".length)}
                      </small>
                    )}
                  </div>
                  <strong>{formatMoney(p.amountMinor, p.currency)}</strong>
                </article>
              ))}
              {!paymentPage.total && (
                <EmptyState
                  title={
                    payments.length
                      ? "No matching entries"
                      : "No ledger entries"
                  }
                  detail={
                    payments.length
                      ? "Change the search to see more entries."
                      : "Payments and adjustments will appear here."
                  }
                />
              )}
            </div>
          </Section>
        </div>
      </div>
      <details
        className="disclosure-section"
        open={
          params.has("invoice") ||
          params.has("billLesson") ||
          openComposer ||
          undefined
        }
      >
        <summary>Invoices</summary>
        <InvoiceWorkspace
          data={data}
          isDemo={isDemo}
          studentId={student.id}
          openComposer={openComposer}
          onComposerDismiss={() => setOpenComposer(false)}
        />
      </details>
      <details className="disclosure-section" ref={creditsDisclosure}>
        <summary>Manage credits</summary>
        <CreditAccount data={data} studentId={student.id} isDemo={isDemo} />
      </details>
      {recording &&
        (paymentLesson ? (
          <CoachLessonPaymentDialog
            lesson={paymentLesson}
            isDemo={isDemo}
            onClose={() => setRecording(false)}
          />
        ) : (
          <Dialog
            title="Record payment"
            description="Choose the lesson the payment applies to."
            onClose={() => setRecording(false)}
          >
            <label
              className="lesson-invoice-field"
              htmlFor={`${fields}-record-lesson`}
            >
              Lesson
              <select
                id={`${fields}-record-lesson`}
                value={paymentLessonId}
                onChange={(event) => {
                  const lesson = recordable.find(
                    (entry) => entry.id === event.target.value,
                  );
                  if (lesson) startPayment(lesson);
                }}
              >
                <option value="">Choose a lesson</option>
                {recordable.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {formatStudioDate(lesson.startsAt, data.settings.timezone)}{" "}
                    · {lesson.topic}
                  </option>
                ))}
              </select>
            </label>
          </Dialog>
        ))}
      <details className="disclosure-section">
        <summary>Financial configuration and forecasts</summary>
        <StudentFinancialSetup data={data} student={student} />
      </details>
      <details className="disclosure-section">
        <summary>Payment reminders</summary>
        <PaymentReminderSteps data={data} student={student} isDemo={isDemo} />
      </details>
      <details className="disclosure-section" id="payment-arrangements">
        <summary>Packages and account adjustments</summary>
        <div className="two-section-grid">
          <Section
            title="Packages"
            marked
            aside={
              <div className="header-actions">
                <button onClick={() => setAdjustingBalance(true)}>
                  Adjust dollar balance
                </button>
                <button
                  disabled={
                    !data.packageDefinitions.some((item) => item.active)
                  }
                  onClick={() => setAssigning(true)}
                >
                  Assign package
                </button>
              </div>
            }
          >
            <ListControls
              page={packagePage.page}
              pageCount={packagePage.pageCount}
              pageSize={packagePage.pageSize}
              total={pkgs.length}
              onPage={packagePage.setPage}
              onPageSize={packagePage.setPageSize}
              label="packages"
            />
            <div className="table-list">
              {packagePage.visible.map((pkg) => (
                <article key={pkg.id}>
                  <CircleDollarSign />
                  <div>
                    <strong>{pkg.name}</strong>
                    <small>{formatMoney(pkg.priceMinor, pkg.currency)}</small>
                  </div>
                  <Status tone="good">
                    {packageSummary(pkg, data.creditEntries).remainingCredits}{" "}
                    remaining
                  </Status>
                  <small>
                    {pkg.expiresAt
                      ? `Expires ${formatStudioDate(pkg.expiresAt, data.settings.timezone)}`
                      : "No expiration"}
                  </small>
                </article>
              ))}
              {!pkgs.length && (
                <EmptyState
                  title="No package"
                  detail="This student is currently pay as you go."
                />
              )}
            </div>
          </Section>
          <Section title="Payments & adjustments">
            <div className="metric-strip compact-metrics">
              <div>
                <small>Dollar account credit</small>
                <strong>
                  {formatMoney(
                    Math.max(
                      0,
                      studentBalanceMinor(
                        student.id,
                        data.payments,
                        data.settings.currency,
                      ),
                    ),
                  )}
                </strong>
              </div>
            </div>
          </Section>
        </div>
      </details>
      {assigning && (
        <Dialog
          title="Assign package"
          description="This grants the package’s complete lesson-credit balance to this student."
          onClose={() => setAssigning(false)}
        >
          <form className="workflow-form" onSubmit={assign}>
            <label className="full">
              Package
              <select
                required
                value={definitionId}
                onChange={(event) => setDefinitionId(event.target.value)}
              >
                {availableDefinitions.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.sessionDurationMinutes === preferredDuration
                      ? "Recommended from last lesson · "
                      : ""}
                    {definition.sessionDurationMinutes} min · {definition.name}{" "}
                    · {definition.sessionCount} sessions
                  </option>
                ))}
              </select>
            </label>
            <p className="full">
              Automatic use follows this student’s credit setting.
            </p>
            <div className="form-actions full">
              <button type="button" onClick={() => setAssigning(false)}>
                Cancel
              </button>
              <button className="primary" disabled={assignBusy}>
                {assignBusy ? "Assigning…" : "Assign credits"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {adjustingBalance && (
        <Dialog
          title="Adjust dollar balance"
          description="This is money on the account, separate from lesson credits. Positive amounts add studio credit; negative amounts correct or remove it."
          onClose={() => setAdjustingBalance(false)}
        >
          <form className="workflow-form" onSubmit={adjustBalance}>
            <label>
              Amount ({data.settings.currency})
              <input
                required
                type="number"
                step="0.01"
                min="-10000"
                max="10000"
                value={balanceAmount}
                onChange={(event) => setBalanceAmount(event.target.value)}
              />
              <small>Examples: 25.00 adds $25; -10.00 removes $10.</small>
            </label>
            <label className="full">
              Reason
              <input
                required
                minLength={3}
                value={balanceReason}
                onChange={(event) => setBalanceReason(event.target.value)}
              />
            </label>
            <div className="form-actions full">
              <button type="button" onClick={() => setAdjustingBalance(false)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={
                  !Number(balanceAmount) || balanceReason.trim().length < 3
                }
              >
                Save dollar adjustment
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
