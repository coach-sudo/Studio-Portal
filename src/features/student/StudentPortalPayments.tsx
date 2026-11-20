import { LessonPaymentOptions } from "./LessonPaymentOptions";
import { useTrainingPayers } from "./useTrainingPayers";
import { LessonAutopayPreview } from "./LessonAutopayPreview";
import { useLessonAutopayOptions } from "./useLessonAutopayOptions";
import { portalContextLink } from "../../domain/coachingContext";
import { lessonPaymentPath } from "../../domain/lessonPaymentLink";
import { useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import "../../components/IdentityActions.css";
import {
  Dialog,
  ListControls,
  usePagedList,
  EmptyState,
  Section,
  Status,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { formatMoney, packageSummary } from "../../domain/finance";
import { directLessonReceipt } from "../../domain/directLessonReceipt";
import {
  recentLessonDuration,
  sortPackageDefinitions,
} from "../../domain/packageSelection";
import { packageOffer } from "../../domain/packagePricing";
import {
  learnerPackageText,
  packageBenefitLines,
  isCalendarRenewal,
} from "../../domain/packagePresentation";
import { formatStudioDate } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { type Snapshot } from "./StudentPortal.shared";
import { InvoiceWorkspace } from "../finance/InvoiceWorkspace";
import { StudentFinancialSummary } from "../../components/StudentFinancialSummary";
import { HouseholdInvoiceSummary } from "./HouseholdInvoiceSummary";
import type { PortalContext } from "../../data/portalContext";

export function Payments({
  data,
  isDemo,
  canManageLessons = false,
  household,
}: {
  data: Snapshot;
  isDemo: boolean;
  canManageLessons?: boolean;
  household?: Pick<PortalContext, "id" | "fullName" | "preferredName">[];
}) {
  const student = data.students[0];
  const [params] = useSearchParams();
  const lessonId = params.get("lesson");
  const paying = params.get("pay") === "lesson";
  const recurring = params.get("recurring");
  const recurringOnly =
    recurring === "packages" || recurring === "arrangements";
  const booked = data.bookings.find(
    (item) =>
      item.id === params.get("booked") &&
      item.studentId === student?.id &&
      item.status === "confirmed",
  );
  const bookedLessonIds = booked
    ? data.lessonParticipants
        .filter(
          (item) =>
            item.bookingId === booked.id &&
            item.studentId === student?.id &&
            item.status !== "cancelled",
        )
        .map((item) => item.lessonId)
    : [];
  const autopay = useLessonAutopayOptions(data, student?.id ?? "", isDemo);
  const lesson = data.lessons.find(
    (item) =>
      item.id === lessonId &&
      (item.studentId === student?.id ||
        data.lessonParticipants.some(
          (participant) =>
            participant.lessonId === item.id &&
            participant.studentId === student?.id &&
            participant.status !== "cancelled",
        )),
  );
  const payments = data.payments.filter(
    (item) =>
      item.studentId === student?.id &&
      !item.accountCredit &&
      (item.kind === "payment" || item.kind === "refund"),
  );
  const packages = data.packages.filter(
    (item) => item.studentId === student?.id,
  );
  const paymentPage = usePagedList(payments);
  const packagePage = usePagedList(packages);
  const preferredDuration = lesson
    ? Math.round(
        (Date.parse(lesson.endsAt) - Date.parse(lesson.startsAt)) / 60_000,
      )
    : student
      ? recentLessonDuration(data.lessons, student.id)
      : undefined;
  const sourceDefinitions = data.packageDefinitions.filter(
    (item) =>
      item.active && item.visibility === "public" && item.directPurchase,
  );
  const payer = useTrainingPayers(
    student?.id ?? "",
    student ? [student.id] : [],
    !isDemo &&
      Boolean(student && (sourceDefinitions.length || packages.length)),
  );
  const canManagePackagePayment =
    isDemo || Boolean(student && payer.data?.studentIds.includes(student.id));
  const purchasableDefinitions = sourceDefinitions
    .map((item) => packageOffer(item, data, student))
    .filter((item): item is Snapshot["packageDefinitions"][number] =>
      Boolean(item),
    );
  const hasCalendarOffers =
    canManagePackagePayment &&
    purchasableDefinitions.some((item) =>
      data.packageBillingOptions.some(
        (option) =>
          option.definitionId === item.id && isCalendarRenewal(option),
      ),
    );
  const durationOptions = [
    ...new Set(
      purchasableDefinitions.map((item) => item.sessionDurationMinutes),
    ),
  ].sort((a, b) => a - b);
  const [durationFilter, setDurationFilter] = useState("all");
  const [packageSort, setPackageSort] = useState<
    "recommended" | "shortest" | "longest"
  >("recommended");
  const availableDefinitions = useMemo(() => {
    const filtered = purchasableDefinitions.filter(
      (item) =>
        (durationFilter === "all" ||
          item.sessionDurationMinutes === Number(durationFilter)) &&
        (!recurringOnly ||
          data.packageBillingOptions.some(
            (option) =>
              option.definitionId === item.id && isCalendarRenewal(option),
          )),
    );
    if (packageSort === "recommended")
      return sortPackageDefinitions(filtered, preferredDuration);
    return [...filtered].sort((a, b) =>
      packageSort === "shortest"
        ? a.sessionDurationMinutes - b.sessionDurationMinutes ||
          a.sessionCount - b.sessionCount ||
          a.name.localeCompare(b.name)
        : b.sessionDurationMinutes - a.sessionDurationMinutes ||
          a.sessionCount - b.sessionCount ||
          a.name.localeCompare(b.name),
    );
  }, [
    durationFilter,
    packageSort,
    preferredDuration,
    purchasableDefinitions,
    recurringOnly,
    data.packageBillingOptions,
  ]);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [packageBusy, setPackageBusy] = useState("");
  const [purchaseDefinition, setPurchaseDefinition] =
    useState<Snapshot["packageDefinitions"][number]>();
  const [renewalMode, setRenewalMode] = useState("one_time");
  const store = useStudioStore();
  const queryClient = useQueryClient();
  useEffect(() => {
    const definitionId = params.get("package");
    const definition = data.packageDefinitions.find(
      (item) => item.id === definitionId && item.active && item.directPurchase,
    );
    if (definition && canManagePackagePayment) {
      setPurchaseDefinition(packageOffer(definition, data, student));
      setRenewalMode(recurringOnly ? "" : "one_time");
    }
  }, [data, student, params, recurringOnly, canManagePackagePayment]);
  const purchase = async (id: string) => {
    if (checkoutBusy || !student || !renewalMode || !canManagePackagePayment)
      return;
    if (isDemo) {
      setNotice("Demo mode does not open a real checkout.");
      return;
    }
    setCheckoutBusy(true);
    setNotice("");
    try {
      const result = await studioCommand("finance", {
        command: "checkout_definition",
        expectedVersion: 0,
        payload: {
          packageDefinitionId: id,
          studentId: student.id,
          lessonId: lesson?.id,
          renewalMode,
          expectedPriceMinor: purchaseDefinition?.priceMinor,
          expectedCurrency: purchaseDefinition?.currency,
        },
        reason: "Student started package checkout",
      });
      window.location.assign(result.resource.url);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Checkout could not be opened.",
      );
      setCheckoutBusy(false);
    }
  };
  const cancelRenewal = async (
    subscription: Snapshot["packageSubscriptions"][number],
  ) => {
    const pendingKey = `subscription:${subscription.id}`;
    if (packageBusy || !canManagePackagePayment) return;
    setPackageBusy(pendingKey);
    setNotice("Turning off package renewal…");
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.packageSubscriptions.find(
            (item) => item.id === subscription.id,
          );
          if (!current) return;
          current.status =
            current.renewalMode === "balance_threshold"
              ? "cancelled"
              : "cancel_at_period_end";
          current.version += 1;
          current.updatedAt = new Date().toISOString();
        });
      else {
        const result = await studioCommand("finance", {
          command: "cancel_package_subscription",
          entityId: subscription.id,
          expectedVersion: subscription.version,
          payload: {},
          reason: "Student turned off package renewal",
        });
        await invalidateStudioDomains(queryClient, ["finance"]);
        setNotice(
          result.resource.status === "cancel_at_period_end"
            ? "Renewal is off. Your current paid period remains available."
            : "Automatic package renewal is off.",
        );
      }
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Package renewal could not be changed.",
      );
    } finally {
      setPackageBusy("");
    }
  };
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>Payments</h1>
        {!paying && !recurringOnly && student && (
          <Link
            className="button-link"
            to={portalContextLink("/portal/settings#billing", student.id)}
          >
            Payment settings
          </Link>
        )}
        {!paying && !recurringOnly && student && (
          <Link
            className="button-link primary"
            to={lessonPaymentPath(student.id)}
          >
            Pay for my lesson
          </Link>
        )}
        {!recurringOnly && (hasCalendarOffers || autopay) && student && (
          <Link
            className="button-link"
            to={portalContextLink(
              "/portal/payments?recurring=arrangements",
              student.id,
            )}
          >
            Make Recurring
          </Link>
        )}
      </header>
      {recurringOnly && booked && (
        <p role="status" className="portal-notice">
          Booking {booked.reference} is confirmed. Review payment timing for the
          new lessons below. Your booking stays confirmed if you leave payment
          setup or Stripe needs another attempt.
        </p>
      )}
      {recurringOnly && student && (
        <div>
          <Link to={portalContextLink("/portal/payments", student.id)}>
            Back to Payments
          </Link>
        </div>
      )}
      {recurringOnly && student && autopay && (
        <LessonAutopayPreview
          key={`${student.id}:${lessonId ?? ""}:${booked?.id ?? ""}`}
          studentId={student.id}
          studentName={student.preferredName || student.fullName}
          initialLessonId={lessonId ?? undefined}
          bookedLessonIds={bookedLessonIds}
          initialLeadDays={
            booked && params.has("lead")
              ? Number(params.get("lead"))
              : undefined
          }
          options={autopay}
          demoLessons={isDemo ? data.lessons : undefined}
        />
      )}
      {recurringOnly &&
        canManagePackagePayment &&
        (hasCalendarOffers || recurring === "packages") && (
          <Section title="Recurring packages">
            <p>
              These packages renew on the calendar. Choose a package to review
              the amount, frequency, and included lessons.
            </p>
            {!hasCalendarOffers && (
              <p>No recurring packages are currently offered.</p>
            )}
          </Section>
        )}
      {recurringOnly &&
        student &&
        canManageLessons &&
        data.settings.bookingDefaults.allowRecurring && (
          <Section title="Recurring bookings">
            <Link to={portalContextLink("/portal/bookings", student.id)}>
              Review your schedule before booking more lessons
            </Link>
          </Section>
        )}
      {params.get("checkout") === "processing" && !params.has("invoice") && (
        <p role="status" className="portal-notice">
          Checkout returned. Your package will appear after payment is
          confirmed.
        </p>
      )}
      {params.get("checkout") === "cancelled" && !params.has("invoice") && (
        <p role="status" className="portal-notice">
          Checkout was canceled. You can choose a package again below.
        </p>
      )}
      {paying && student && (
        <LessonPaymentOptions
          data={data}
          isDemo={isDemo}
          studentId={student.id}
          lesson={lesson}
          householdStudentIds={household?.map(({ id }) => id)}
          hasPackages={
            canManagePackagePayment && purchasableDefinitions.length > 0
          }
        />
      )}
      {notice && !purchaseDefinition && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      {!paying &&
        !recurringOnly &&
        student &&
        household &&
        household.length > 1 && (
          <HouseholdInvoiceSummary
            students={household}
            data={data}
            studentId={student.id}
            isDemo={isDemo}
          />
        )}
      {student && (
        <>
          {!paying && !recurringOnly && !isDemo && (
            <StudentFinancialSummary studentId={student.id} learnerView />
          )}
          <details
            className="disclosure-section"
            open={params.has("invoice") || undefined}
          >
            <summary>Invoices</summary>
            <InvoiceWorkspace
              data={data}
              isDemo={isDemo}
              studentId={student.id}
              readOnly
            />
          </details>
        </>
      )}
      {!paying && !recurringOnly && (
        <details className="disclosure-section">
          <summary>Receipts & adjustments ({payments.length})</summary>
          <Section title="Receipts & adjustments">
            <ListControls
              {...paymentPage}
              total={payments.length}
              onPage={paymentPage.setPage}
              onPageSize={paymentPage.setPageSize}
              label="payments"
            />
            <div className="table-list">
              {paymentPage.visible.map((entry) => {
                const directReceipt = directLessonReceipt(
                  entry.externalReference,
                );
                return (
                  <article key={entry.id} className="payment-history-row">
                    <FileText />
                    <div>
                      <strong>
                        {entry.reason && !/\bcredits?\b/i.test(entry.reason)
                          ? entry.reason
                          : entry.kind === "refund"
                            ? "Refund"
                            : "Payment"}
                      </strong>
                      <small>
                        {formatStudioDate(
                          entry.createdAt,
                          data.settings.timezone,
                        )}{" "}
                        ·{" "}
                        {directReceipt
                          ? `Receipt ${entry.id}`
                          : entry.externalReference?.startsWith(
                                "lesson-payment:",
                              )
                            ? `Receipt ${entry.externalReference.slice("lesson-payment:".length)}`
                            : "Studio ledger"}
                      </small>
                      {directReceipt && student && (
                        <Link
                          to={portalContextLink(
                            `/portal/lessons/${directReceipt.lessonId}`,
                            student.id,
                          )}
                        >
                          View paid lesson
                        </Link>
                      )}
                    </div>
                    <strong className="payment-history-amount">
                      {entry.kind === "refund" ? "+" : "−"}
                      {formatMoney(entry.amountMinor, entry.currency)}
                    </strong>
                  </article>
                );
              })}
              {!payments.length && (
                <EmptyState
                  title="No payment history"
                  detail="Receipts, refunds, and adjustments will appear here."
                />
              )}
            </div>
          </Section>
        </details>
      )}
      {!paying && !recurringOnly && packages.length > 0 && (
        <Section title="Your packages">
          <ListControls
            {...packagePage}
            total={packages.length}
            onPage={packagePage.setPage}
            onPageSize={packagePage.setPageSize}
            label="packages"
          />
          <div className="table-list">
            {packagePage.visible.map((pkg) => {
              const expired = Boolean(
                pkg.expiresAt && new Date(pkg.expiresAt) <= new Date(),
              );
              const subscription = data.packageSubscriptions.find(
                (item) => item.packageId === pkg.id,
              );
              const renewalActive = Boolean(
                subscription &&
                ["pending", "active", "past_due"].includes(subscription.status),
              );
              return (
                <article key={pkg.id}>
                  <CircleDollarSign />
                  <div>
                    <strong>{learnerPackageText(pkg.name)}</strong>
                    <small>
                      {packageSummary(pkg, data.creditEntries).remainingCredits}{" "}
                      lessons remaining ·{" "}
                      {formatMoney(pkg.priceMinor, pkg.currency)}
                      {pkg.expiresAt &&
                        ` · ${expired ? "expired" : "expires"} ${formatStudioDate(pkg.expiresAt, data.settings.timezone)}`}
                      {subscription &&
                        ` · ${subscription.status === "cancel_at_period_end" ? "renewal ends after this period" : subscription.status === "cancelled" ? "renewal off" : subscription.renewalMode === "balance_threshold" ? `renews at ${subscription.balanceThreshold ?? 1} lessons remaining` : `renews ${subscription.renewalMode}`}`}
                    </small>
                  </div>
                  <Status tone={expired ? "danger" : "good"}>
                    {expired ? "expired" : "active"}
                  </Status>

                  {subscription && renewalActive && canManagePackagePayment && (
                    <button
                      disabled={
                        packageBusy === `subscription:${subscription.id}`
                      }
                      onClick={() => void cancelRenewal(subscription)}
                    >
                      {packageBusy === `subscription:${subscription.id}`
                        ? "Saving…"
                        : "Turn off renewal"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </Section>
      )}
      {canManagePackagePayment &&
        sourceDefinitions.length !== purchasableDefinitions.length && (
          <p role="status" className="portal-notice">
            Some package prices are unavailable. Try again later.
          </p>
        )}
      {canManagePackagePayment && availableDefinitions.length > 0 && (
        <div id="lesson-packages" tabIndex={-1}>
          <Section title="Available packages">
            {purchasableDefinitions.length > 1 && (
              <div className="list-controls package-purchase-controls">
                <label>
                  Lesson length
                  <select
                    value={durationFilter}
                    onChange={(event) => setDurationFilter(event.target.value)}
                  >
                    <option value="all">All lesson lengths</option>
                    {durationOptions.map((duration) => (
                      <option key={duration} value={duration}>
                        {duration} minutes
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Sort packages
                  <select
                    value={packageSort}
                    onChange={(event) =>
                      setPackageSort(event.target.value as typeof packageSort)
                    }
                  >
                    <option value="recommended">Recommended first</option>
                    <option value="shortest">Shortest lessons first</option>
                    <option value="longest">Longest lessons first</option>
                  </select>
                </label>
              </div>
            )}
            <div className="table-list package-offer-list">
              {availableDefinitions.map((definition) => (
                <article key={definition.id}>
                  <CircleDollarSign />
                  <div>
                    <strong>{learnerPackageText(definition.name)}</strong>
                    <small>
                      {definition.sessionDurationMinutes === preferredDuration
                        ? lesson
                          ? "Matches this lesson’s length · "
                          : "Matches your latest lesson · "
                        : ""}
                      {definition.sessionCount} sessions ·{" "}
                      {definition.sessionDurationMinutes} minutes each ·{" "}
                      {formatMoney(definition.priceMinor, definition.currency)}
                    </small>
                    <ul className="package-benefits">
                      {packageBenefitLines(definition, true).map((benefit) => (
                        <li key={benefit}>{benefit}</li>
                      ))}
                    </ul>
                  </div>
                  <button
                    onClick={() => {
                      setPurchaseDefinition(definition);
                      setRenewalMode(recurringOnly ? "" : "one_time");
                    }}
                  >
                    Choose package
                  </button>
                </article>
              ))}
            </div>
          </Section>
        </div>
      )}
      {purchaseDefinition && canManagePackagePayment && (
        <Dialog
          title={learnerPackageText(purchaseDefinition.name)}
          onClose={() => {
            if (!checkoutBusy) setPurchaseDefinition(undefined);
          }}
        >
          <div className="package-purchase-summary">
            <strong>
              {formatMoney(
                purchaseDefinition.priceMinor,
                purchaseDefinition.currency,
              )}
            </strong>
            <span>{purchaseDefinition.sessionCount} lessons included</span>
          </div>
          <label>
            Purchase option
            <select
              value={renewalMode}
              disabled={checkoutBusy}
              onChange={(event) => setRenewalMode(event.target.value)}
            >
              {recurringOnly && (
                <option value="">Choose a renewal schedule</option>
              )}
              {data.packageBillingOptions
                .filter(
                  (option) =>
                    option.definitionId === purchaseDefinition.id &&
                    option.active &&
                    (!recurringOnly || isCalendarRenewal(option)),
                )
                .map((option) => (
                  <option key={option.id} value={option.renewalMode}>
                    {option.renewalMode === "one_time"
                      ? "One-time purchase"
                      : option.renewalMode === "biweekly"
                        ? "Renew every two weeks"
                        : option.renewalMode === "balance_threshold"
                          ? `Renew when ${option.balanceThreshold ?? 1} ${(option.balanceThreshold ?? 1) === 1 ? "lesson remains" : "lessons remain"}`
                          : `Renew ${option.renewalMode}`}
                  </option>
                ))}
            </select>
          </label>
          <p>
            Includes {purchaseDefinition.sessionCount} lessons of{" "}
            {purchaseDefinition.sessionDurationMinutes} minutes each.
          </p>
          {["weekly", "biweekly", "monthly"].includes(renewalMode) && (
            <p className="portal-notice">
              The first payment is due at checkout. You’ll pay{" "}
              {formatMoney(
                purchaseDefinition.priceMinor,
                purchaseDefinition.currency,
              )}{" "}
              {renewalMode === "biweekly" ? "every two weeks" : renewalMode}{" "}
              until you turn off renewal in Payments.
              {purchaseDefinition.expirationDays
                ? ` Each package can be used for ${purchaseDefinition.expirationDays} days.`
                : ""}
            </p>
          )}
          {paying && (
            <p>After checkout, check whether this lesson is marked Paid.</p>
          )}
          {renewalMode === "balance_threshold" && (
            <p className="portal-notice">
              By continuing, you authorize Coach’D to charge the saved payment
              method when the package reaches the selected number of lessons
              remaining. You can turn this off later.
            </p>
          )}
          {notice && (
            <p className="portal-notice" role="status">
              {notice}
            </p>
          )}
          <div className="form-actions">
            <button
              disabled={checkoutBusy}
              onClick={() => setPurchaseDefinition(undefined)}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={checkoutBusy || !renewalMode}
              onClick={() => void purchase(purchaseDefinition.id)}
            >
              {checkoutBusy
                ? "Opening checkout…"
                : "Continue to secure checkout"}
            </button>
          </div>
          {purchaseDefinition.giftable && (
            <Link className="button-link" to={`/gift/${purchaseDefinition.id}`}>
              Gift at studio pricing
            </Link>
          )}
        </Dialog>
      )}
    </div>
  );
}
