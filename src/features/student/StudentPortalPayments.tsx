import { useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import "../../components/IdentityActions.css";
import {
  Dialog,
  EmptyState,
  Section,
  Status,
  Toggle,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import {
  formatMoney,
  packageSummary,
  studentBalanceMinor,
} from "../../domain/finance";
import {
  recentLessonDuration,
  sortPackageDefinitions,
} from "../../domain/packageSelection";
import { packageBenefitLines } from "../../domain/packagePresentation";
import { formatStudioDate } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { type Snapshot } from "./StudentPortal.shared";

export function Payments({
  data,
  isDemo,
}: {
  data: Snapshot;
  isDemo: boolean;
}) {
  const student = data.students[0];
  const preferredDuration = student
    ? recentLessonDuration(data.lessons, student.id)
    : undefined;
  const purchasableDefinitions = data.packageDefinitions.filter(
    (item) =>
      item.active && item.visibility === "public" && item.directPurchase,
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
    const filtered =
      durationFilter === "all"
        ? purchasableDefinitions
        : purchasableDefinitions.filter(
            (item) => item.sessionDurationMinutes === Number(durationFilter),
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
  }, [durationFilter, packageSort, preferredDuration, purchasableDefinitions]);
  const [params] = useSearchParams();
  const [notice, setNotice] = useState("");
  const [packageBusy, setPackageBusy] = useState("");
  const [purchaseDefinition, setPurchaseDefinition] =
    useState<Snapshot["packageDefinitions"][number]>();
  const [renewalMode, setRenewalMode] = useState("one_time");
  const [purchaseAutoApply, setPurchaseAutoApply] = useState(false);
  const store = useStudioStore();
  const queryClient = useQueryClient();
  useEffect(() => {
    const definitionId = params.get("package");
    const definition = data.packageDefinitions.find(
      (item) => item.id === definitionId && item.active && item.directPurchase,
    );
    if (definition) setPurchaseDefinition(definition);
  }, [data.packageDefinitions, params]);
  const purchase = async (id: string) => {
    if (isDemo) {
      setNotice("Demo mode does not open a real checkout.");
      return;
    }
    try {
      const result = await studioCommand("finance", {
        command: "checkout_definition",
        expectedVersion: 0,
        payload: {
          packageDefinitionId: id,
          renewalMode,
          autoApply: purchaseAutoApply,
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
    }
  };
  const toggleAutoApply = async (pkg: Snapshot["packages"][number]) => {
    if (packageBusy) return;
    setPackageBusy(pkg.id);
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.packages.find((item) => item.id === pkg.id);
          if (!current) return;
          current.autoApply = !pkg.autoApply;
          current.version += 1;
          current.updatedAt = new Date().toISOString();
        });
      else {
        const result = await studioCommand("packages", {
          command: "toggle_auto_apply",
          entityId: pkg.id,
          expectedVersion: pkg.version,
          payload: { enabled: !pkg.autoApply },
          reason: "Student changed automatic credit preference",
        });
        await invalidateStudioDomains(queryClient, ["finance"]);
        setNotice(
          !pkg.autoApply
            ? `Automatic credits enabled${result.resource.applied ? `; ${result.resource.applied} upcoming lesson${result.resource.applied === 1 ? "" : "s"} updated` : ""}.`
            : "Automatic credits disabled. Existing lesson allocations are unchanged.",
        );
      }
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "The package preference could not be saved.",
      );
    } finally {
      setPackageBusy("");
    }
  };
  const cancelRenewal = async (
    subscription: Snapshot["packageSubscriptions"][number],
  ) => {
    const pendingKey = `subscription:${subscription.id}`;
    if (packageBusy) return;
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
        <p>See your balance, payment history, and available lesson packages.</p>
      </header>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      {student && (
        <Section title="Current balance" marked>
          <div className="account-balance-card" role="status">
            <span>Amount due</span>
            <strong>
              {formatMoney(
                Math.max(0, studentBalanceMinor(student.id, data.payments)),
              )}
            </strong>
            <small>Payments and adjustments are listed below.</small>
          </div>
        </Section>
      )}
      <Section title="Receipts & adjustments">
        <div className="table-list">
          {data.payments.map((entry) => (
            <article key={entry.id}>
              <FileText />
              <div>
                <strong>{entry.reason}</strong>
                <small>
                  {formatStudioDate(entry.createdAt, data.settings.timezone)} ·{" "}
                  {entry.externalReference ?? "Studio ledger"}
                </small>
              </div>
              <strong>
                {entry.kind === "refund" ? "+" : "−"}
                {formatMoney(entry.amountMinor, entry.currency)}
              </strong>
            </article>
          ))}
          {!data.payments.length && (
            <EmptyState
              title="No payment history"
              detail="Receipts, refunds, and adjustments will appear here."
            />
          )}
        </div>
      </Section>
      {data.packages.length > 0 && (
        <Section title="Your packages">
          <div className="table-list">
            {data.packages.map((pkg) => {
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
                    <strong>{pkg.name}</strong>
                    <small>
                      {packageSummary(pkg, data.creditEntries).remainingCredits}{" "}
                      credits · {formatMoney(pkg.priceMinor, pkg.currency)}
                      {pkg.expiresAt &&
                        ` · ${expired ? "expired" : "expires"} ${formatStudioDate(pkg.expiresAt, data.settings.timezone)}`}
                      {subscription &&
                        ` · ${subscription.status === "cancel_at_period_end" ? "renewal ends after this period" : subscription.status === "cancelled" ? "renewal off" : subscription.renewalMode === "balance_threshold" ? `renews at ${subscription.balanceThreshold ?? 1} credit` : `renews ${subscription.renewalMode}`}`}
                    </small>
                  </div>
                  <Status tone={expired ? "danger" : "good"}>
                    {expired ? "expired" : "active"}
                  </Status>
                  {!expired &&
                    packageSummary(pkg, data.creditEntries).remainingCredits >
                      0 && (
                      <Toggle
                        checked={Boolean(pkg.autoApply)}
                        label="Auto-apply"
                        detail="Use this package for eligible upcoming lessons."
                        onChange={() => void toggleAutoApply(pkg)}
                      />
                    )}
                  {subscription && renewalActive && (
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
      {purchasableDefinitions.length > 0 && (
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
                  <strong>{definition.name}</strong>
                  <small>
                    {definition.sessionDurationMinutes === preferredDuration
                      ? "Matches your latest lesson · "
                      : ""}
                    {definition.sessionCount} sessions ·{" "}
                    {definition.sessionDurationMinutes} minutes each ·{" "}
                    {formatMoney(definition.priceMinor, definition.currency)}
                  </small>
                  <ul className="package-benefits">
                    {packageBenefitLines(definition).map((benefit) => (
                      <li key={benefit}>{benefit}</li>
                    ))}
                  </ul>
                </div>
                <button
                  onClick={() => {
                    setPurchaseDefinition(definition);
                    setRenewalMode("one_time");
                    setPurchaseAutoApply(false);
                  }}
                >
                  Choose package
                </button>
              </article>
            ))}
          </div>
        </Section>
      )}
      {purchaseDefinition && (
        <Dialog
          title={purchaseDefinition.name}
          description="Choose how this package should renew and whether its credits should cover eligible upcoming lessons automatically."
          onClose={() => setPurchaseDefinition(undefined)}
        >
          <div className="package-purchase-summary">
            <strong>
              {formatMoney(
                purchaseDefinition.priceMinor,
                purchaseDefinition.currency,
              )}
            </strong>
            <span>{purchaseDefinition.sessionCount} lesson credits</span>
          </div>
          <label>
            Purchase option
            <select
              value={renewalMode}
              onChange={(event) => setRenewalMode(event.target.value)}
            >
              {data.packageBillingOptions
                .filter(
                  (option) =>
                    option.definitionId === purchaseDefinition.id &&
                    option.active,
                )
                .map((option) => (
                  <option key={option.id} value={option.renewalMode}>
                    {option.renewalMode === "one_time"
                      ? "One-time purchase"
                      : option.renewalMode === "biweekly"
                        ? "Renew every two weeks"
                        : option.renewalMode === "balance_threshold"
                          ? `Renew when ${option.balanceThreshold ?? 1} credit remains`
                          : `Renew ${option.renewalMode}`}
                  </option>
                ))}
            </select>
          </label>
          <Toggle
            checked={purchaseAutoApply}
            label="Apply to upcoming lessons"
            detail="After payment, use credits only for eligible unpaid lessons. Paid, cancelled, and incompatible lessons are skipped."
            onChange={() => setPurchaseAutoApply((current) => !current)}
          />
          {renewalMode === "balance_threshold" && (
            <p className="portal-notice">
              By continuing, you authorize Coach’D to charge the saved payment
              method only when your balance reaches the displayed threshold. You
              can turn this off later.
            </p>
          )}
          <div className="form-actions">
            <button onClick={() => setPurchaseDefinition(undefined)}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => void purchase(purchaseDefinition.id)}
            >
              Continue to secure checkout
            </button>
          </div>
          {purchaseDefinition.giftable && (
            <Link className="button-link" to={`/gift/${purchaseDefinition.id}`}>
              Purchase this package as a gift
            </Link>
          )}
        </Dialog>
      )}
    </div>
  );
}
