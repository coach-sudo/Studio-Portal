import { useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  Dialog,
  EmptyState,
  Section,
  Status,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import {
  formatMoney,
  packageSummary,
  studentBalanceMinor,
} from "../../domain/finance";
import type { Student } from "../../domain/model";
import {
  recentLessonDuration,
  sortPackageDefinitions,
} from "../../domain/packageSelection";
import { formatStudioDate } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { now, uid, type Data } from "./StudentWorkspace.shared";

export function Payments({
  data,
  student,
  isDemo,
}: {
  data: Data;
  student: Student;
  isDemo: boolean;
}) {
  const pkgs = data.packages.filter((i) => i.studentId === student.id),
    payments = data.payments.filter((i) => i.studentId === student.id),
    preferredDuration = recentLessonDuration(data.lessons, student.id),
    availableDefinitions = sortPackageDefinitions(
      data.packageDefinitions.filter((item) => item.active),
      preferredDuration,
    );
  const store = useStudioStore(),
    queryClient = useQueryClient(),
    [assigning, setAssigning] = useState(false),
    [definitionId, setDefinitionId] = useState(
      availableDefinitions[0]?.id ?? "",
    ),
    [crediting, setCrediting] = useState(false),
    [adjustingBalance, setAdjustingBalance] = useState(false),
    [balanceAmount, setBalanceAmount] = useState("0.00"),
    [balanceReason, setBalanceReason] = useState("Studio account credit"),
    [creditQuantityText, setCreditQuantityText] = useState("1"),
    [creditReason, setCreditReason] = useState("Courtesy lesson credit"),
    [autoApplyOnAssign, setAutoApplyOnAssign] = useState(true),
    [packageBusy, setPackageBusy] = useState(""),
    [notice, setNotice] = useState("");
  const creditQuantity = Number(creditQuantityText);
  const validCreditQuantity =
    creditQuantityText.trim() !== "" &&
    Number.isInteger(creditQuantity) &&
    creditQuantity !== 0 &&
    Math.abs(creditQuantity) <= 100;
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
            currency: "USD",
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
            currency: "USD",
            reason: balanceReason.trim(),
          },
          reason: "Coach adjusted student dollar balance",
        });
        await invalidateStudioDomains(queryClient, ["finance"]);
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
  const grantCredit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validCreditQuantity || creditReason.trim().length < 3) return;
    try {
      if (isDemo) {
        store.transact((draft) => {
          let pkg = draft.packages.find(
            (item) =>
              item.studentId === student.id &&
              item.name === "Studio lesson credits",
          );
          if (!pkg) {
            pkg = {
              id: uid("package"),
              studentId: student.id,
              name: "Studio lesson credits",
              priceMinor: 0,
              currency: "USD",
              version: 1,
              updatedAt: now(),
            };
            draft.packages.push(pkg);
          }
          draft.creditEntries.push({
            id: uid("credit"),
            packageId: pkg.id,
            kind: "adjustment",
            quantity: creditQuantity,
            reason: creditReason,
            createdAt: now(),
          });
        });
      } else {
        await studioCommand("credits", {
          command: "grant",
          expectedVersion: 0,
          payload: {
            studentId: student.id,
            quantity: creditQuantity,
            reason: creditReason,
          },
          reason: "Coach adjusted student credits",
        });
        await invalidateStudioDomains(queryClient, ["finance"]);
      }
      setCrediting(false);
      setNotice(
        `${creditQuantity > 0 ? "Added" : "Removed"} ${Math.abs(creditQuantity)} lesson credit${Math.abs(creditQuantity) === 1 ? "" : "s"}.`,
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Credits could not be updated.",
      );
    }
  };
  const togglePackageAutoApply = async (pkg: Data["packages"][number]) => {
    if (packageBusy) return;
    setPackageBusy(pkg.id);
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.packages.find((item) => item.id === pkg.id);
          if (current) {
            current.autoApply = !pkg.autoApply;
            current.version += 1;
            current.updatedAt = now();
          }
        });
      else {
        const result = await studioCommand("packages", {
          command: "toggle_auto_apply",
          entityId: pkg.id,
          expectedVersion: pkg.version,
          payload: { enabled: !pkg.autoApply },
          reason: "Coach changed automatic lesson credit preference",
        });
        await invalidateStudioDomains(queryClient, ["finance"]);
        setNotice(
          !pkg.autoApply
            ? `Automatic credits enabled. ${result.resource.applied || 0} upcoming lesson(s) covered.`
            : "Automatic credits disabled for this package.",
        );
      }
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Automatic credits could not be updated.",
      );
    } finally {
      setPackageBusy("");
    }
  };
  const assign = async (event: FormEvent) => {
    event.preventDefault();
    const definition = data.packageDefinitions.find(
      (item) => item.id === definitionId,
    );
    if (!definition) return;
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
        });
      else {
        const result = await studioCommand("packages", {
          command: "assign",
          expectedVersion: 0,
          payload: {
            definitionId,
            studentId: student.id,
            autoApply: autoApplyOnAssign,
            reason: "Coach assigned package",
          },
          reason: "Coach assigned package",
        });
        await invalidateStudioDomains(queryClient, ["finance"]);
        if (result.resource.autoApplyPending) {
          setAssigning(false);
          setNotice(
            "Package assigned. Automatic credit application is queued for the next maintenance run.",
          );
          return;
        }
      }
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
    }
  };
  return (
    <div>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <div className="two-section-grid">
        <Section
          title="Packages"
          marked
          aside={
            <div className="header-actions">
              <button onClick={() => setCrediting(true)}>Adjust credits</button>
              <button onClick={() => setAdjustingBalance(true)}>
                Adjust dollar balance
              </button>
              <button
                disabled={!data.packageDefinitions.some((item) => item.active)}
                onClick={() => setAssigning(true)}
              >
                Assign package
              </button>
            </div>
          }
        >
          <div className="table-list">
            {pkgs.map((pkg) => (
              <article key={pkg.id}>
                <CircleDollarSign />
                <div>
                  <strong>{pkg.name}</strong>
                  <small>{formatMoney(pkg.priceMinor, pkg.currency)}</small>
                </div>
                <Status tone="good">
                  {packageSummary(pkg, data.creditEntries).remainingCredits}{" "}
                  left
                </Status>
                <button
                  type="button"
                  disabled={Boolean(packageBusy)}
                  onClick={() => void togglePackageAutoApply(pkg)}
                >
                  {packageBusy === pkg.id
                    ? "Saving…"
                    : pkg.autoApply
                      ? "Auto-apply on"
                      : "Auto-apply off"}
                </button>
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
              <small>Available studio balance</small>
              <strong>
                {formatMoney(
                  Math.max(0, studentBalanceMinor(student.id, data.payments)),
                )}
              </strong>
            </div>
            <div>
              <small>Lesson credits</small>
              <strong>
                {pkgs.reduce(
                  (total, pkg) =>
                    total +
                    packageSummary(pkg, data.creditEntries).remainingCredits,
                  0,
                )}
              </strong>
            </div>
          </div>
          <div className="table-list">
            {payments.map((p) => (
              <article key={p.id}>
                <CircleDollarSign />
                <div>
                  <strong>{p.reason}</strong>
                  <small>
                    {formatStudioDate(p.createdAt, data.settings.timezone)}
                  </small>
                </div>
                <strong>{formatMoney(p.amountMinor, p.currency)}</strong>
              </article>
            ))}
            {!payments.length && (
              <EmptyState
                title="No ledger entries"
                detail="Payments and adjustments will appear here."
              />
            )}
          </div>
        </Section>
      </div>
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
            <label className="check-row full">
              <input
                type="checkbox"
                checked={autoApplyOnAssign}
                onChange={(event) => setAutoApplyOnAssign(event.target.checked)}
              />
              Automatically apply credits to eligible unpaid upcoming lessons
            </label>
            <div className="form-actions full">
              <button type="button" onClick={() => setAssigning(false)}>
                Cancel
              </button>
              <button className="primary">Assign credits</button>
            </div>
          </form>
        </Dialog>
      )}
      {crediting && (
        <Dialog
          title="Adjust lesson credits"
          description={`Add or remove credits for ${student.preferredName || student.fullName}. Every adjustment is recorded in the ledger.`}
          onClose={() => setCrediting(false)}
        >
          <form className="workflow-form" onSubmit={grantCredit}>
            <label>
              Credits
              <input
                required
                type="text"
                inputMode="numeric"
                value={creditQuantityText}
                onChange={(event) => setCreditQuantityText(event.target.value)}
              />
              <small>Use a negative number to correct a balance.</small>
            </label>
            <label className="full">
              Reason
              <input
                required
                minLength={3}
                value={creditReason}
                onChange={(event) => setCreditReason(event.target.value)}
              />
            </label>
            <div className="form-actions full">
              <button type="button" onClick={() => setCrediting(false)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={
                  !validCreditQuantity || creditReason.trim().length < 3
                }
              >
                Save credit adjustment
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
              Amount (USD)
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
