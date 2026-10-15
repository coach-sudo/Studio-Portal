import { WritingArea } from "../../components/WritingArea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import { Dialog, Section } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import {
  creditTotals,
  creditAdjustmentTarget,
  type CreditAdjustmentMode,
  lessonCreditDebit,
  reserveDemoCredits,
  setDemoCreditTotal,
} from "../../domain/credits";
import type { StudioSnapshot } from "../../domain/model";
import { formatStudioDateTime } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { supabase } from "../../lib/supabase";
import { useStudioStore } from "../../state/StudioStore";
import { LiveCreditAccount } from "./LiveCreditAccount";

export function CreditAccount({
  data,
  studentId,
  isDemo,
  readOnly = false,
}: {
  data: StudioSnapshot;
  studentId: string;
  isDemo: boolean;
  readOnly?: boolean;
}) {
  return isDemo ? (
    <DemoCreditAccount
      data={data}
      studentId={studentId}
      isDemo={isDemo}
      readOnly={readOnly}
    />
  ) : (
    <LiveCreditAccount
      studentId={studentId}
      timezone={data.settings.timezone}
      readOnly={readOnly}
    />
  );
}

function DemoCreditAccount({
  data,
  studentId,
  isDemo,
  readOnly = false,
}: {
  data: StudioSnapshot;
  studentId: string;
  isDemo: boolean;
  readOnly?: boolean;
}) {
  const client = useQueryClient(),
    store = useStudioStore(),
    [editing, setEditing] = useState(false),
    [reconciling, setReconciling] = useState(false),
    [automatic, setAutomatic] = useState<boolean>(),
    [target, setTarget] = useState(""),
    [adjustmentMode, setAdjustmentMode] = useState<CreditAdjustmentMode>("add"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const localTotals = creditTotals(
    data.packages,
    data.creditEntries,
    data.lessons,
    studentId,
    Date.now(),
    data.lessonParticipants,
  );
  const packages = data.packages.filter((p) => p.studentId === studentId);
  const account = useQuery({
    queryKey: [
      "credit-account",
      studentId,
      data.creditEntries.length,
      data.lessons.map((l) => `${l.id}:${l.status}`).join(),
      packages.map((p) => `${p.id}:${p.version}`).join(),
    ],
    enabled: !isDemo,
    queryFn: async () => {
      const result = await (supabase as unknown as SupabaseClient).rpc(
        "student_credit_summary",
        { p_student: studentId },
      );
      if (result.error) throw result.error;
      return result.data as {
        version: number;
        autoApply: boolean | null;
        remaining: number;
        reserved: number;
        available: number;
        needsReview: boolean;
      };
    },
  });
  const totals = { ...localTotals, ...account.data };
  let adjustment: ReturnType<typeof creditAdjustmentTarget> | undefined;
  let adjustmentError = "";
  try {
    if (target.trim())
      adjustment = creditAdjustmentTarget(
        totals,
        adjustmentMode,
        Number(target),
      );
  } catch (error) {
    adjustmentError =
      error instanceof Error ? error.message : "Check the credit amount.";
  }
  const enabled = isDemo
    ? packages.length
      ? packages.every((p) => p.autoApply)
        ? true
        : packages.some((p) => p.autoApply)
          ? null
          : false
      : false
    : account.data?.autoApply;
  const ownsActiveLesson = (l: StudioSnapshot["lessons"][number]) =>
    l.studentId === studentId ||
    data.lessonParticipants.some(
      (p) =>
        p.lessonId === l.id &&
        p.studentId === studentId &&
        ["reserved", "confirmed"].includes(p.status),
    );
  const ownEntries = data.creditEntries.filter((e) =>
    packages.some((p) => p.id === e.packageId),
  );
  const upcoming = data.lessons
    .filter(
      (l) =>
        ownsActiveLesson(l) &&
        l.status === "scheduled" &&
        Date.parse(l.startsAt) >= Date.now() &&
        !lessonCreditDebit(ownEntries, l.id) &&
        !(
          l.studentId === studentId &&
          ["paid", "partially_paid", "waived", "refunded"].includes(
            l.paymentStatus ?? "",
          )
        ) &&
        !l.invoicePaymentPending &&
        !(l.paidMinor ?? 0),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const preview = structuredClone(data);
  preview.packages
    .filter((p) => p.studentId === studentId)
    .forEach((p) => {
      p.autoApply = true;
    });
  reserveDemoCredits(preview, studentId);
  const covered = new Set(
    preview.creditEntries
      .filter(
        (e) =>
          !data.creditEntries.some((old) => old.id === e.id) && e.quantity < 0,
      )
      .map((e) => e.lessonId),
  );
  async function save(
    kind: "set_total" | "set_auto" | "reconcile" | "apply_upcoming",
  ) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (kind === "set_total" && !adjustment)
        throw new Error(adjustmentError || "Enter a credit amount.");
      let applied = 0;
      if (isDemo)
        store.transact((draft) => {
          if (kind === "set_total")
            setDemoCreditTotal(
              draft,
              studentId,
              adjustment!.total,
              reason.trim(),
            );
          else if (kind !== "apply_upcoming") {
            if (!draft.packages.some((p) => p.studentId === studentId))
              draft.packages.push({
                id: crypto.randomUUID(),
                studentId,
                name: "Studio lesson credits",
                priceMinor: 0,
                currency: data.settings.currency,
                version: 1,
                updatedAt: new Date().toISOString(),
                autoApply: automatic,
              });
            draft.packages
              .filter((p) => p.studentId === studentId)
              .forEach((p) => {
                p.autoApply = automatic;
                p.version++;
              });
          }
          if (
            (kind === "set_auto" && automatic) ||
            (kind === "set_total" && enabled) ||
            kind === "apply_upcoming"
          )
            applied = reserveDemoCredits(draft, studentId);
        });
      else {
        if (!account.data)
          throw new Error("Wait for the current balance to load.");
        const result = await studioCommand("credits", {
          command: kind,
          expectedVersion: account.data.version,
          payload: {
            studentId,
            total: adjustment?.total,
            reason: reason.trim(),
            enabled: automatic,
          },
          reason:
            kind === "set_total"
              ? reason.trim()
              : "Coach reviewed automatic credit use",
        });
        applied = Number(result.resource?.applied ?? 0);
        await invalidateStudioDomains(client, [
          "finance",
          "lessons",
          "booking",
          "messaging",
        ]);
        await client.invalidateQueries({
          queryKey: ["credit-account", studentId],
        });
        await client.invalidateQueries({ queryKey: ["invoices"] });
      }
      setEditing(false);
      setReconciling(false);
      setAutomatic(undefined);
      setNotice(
        kind === "reconcile"
          ? "Legacy series reservations matched to their lessons. The available balance is unchanged."
          : kind === "apply_upcoming"
            ? applied
              ? `Applied ${applied} credit(s) to upcoming lessons.`
              : "No additional lessons could use a credit. Check available credits, expiration dates, and existing payment coverage."
            : kind === "set_total"
              ? "Credit balance updated. Existing reservations are preserved."
              : automatic
                ? "Automatic use enabled. Upcoming lessons have been checked for coverage."
                : "Automatic use disabled. Existing reservations are preserved.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Credit update failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const history = data.creditEntries
    .filter((e) => packages.some((p) => p.id === e.packageId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <Section
      title="Lesson credits"
      aside={
        !readOnly && (
          <button
            disabled={!isDemo && (!account.data || account.data.needsReview)}
            onClick={() => {
              setAdjustmentMode("add");
              setTarget("1");
              setReason("Coach credit adjustment");
              setEditing(true);
            }}
          >
            Adjust credits
          </button>
        )
      }
    >
      <p className="section-intro">
        One credit covers one lesson of any service or duration.
      </p>
      <div className="metric-strip compact-metrics">
        {[
          ["Available to use", totals.available],
          ["Reserved for lessons", totals.reserved],
          ["Total remaining", totals.remaining],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p>
        {totals.available} available to apply now. {totals.reserved} credits are
        already assigned to lessons and are included in the remaining total.
      </p>
      {totals.expired > 0 && (
        <p>{totals.expired} expired credit(s), excluded from available.</p>
      )}
      {(totals.available < 0 || account.data?.needsReview) && (
        <div className="inline-error">
          <p>
            Legacy credit reservations need review before changing this balance
            or enabling automatic use. Existing credits and history have been
            preserved.
          </p>
          {!readOnly && !isDemo && (
            <button disabled={busy} onClick={() => setReconciling(true)}>
              Review legacy reservations
            </button>
          )}
        </div>
      )}
      {reconciling && (
        <Dialog
          title="Review legacy reservations"
          description="Older bookings sometimes attached several credits to the first lesson in a series."
          onClose={() => !busy && setReconciling(false)}
        >
          <p>
            Confirm to assign those existing credits to the linked lessons, one
            per lesson. This preserves the available balance and history. If the
            booking, lesson count, or ledger does not match exactly, no credits
            will change and a ledger review will be needed.
          </p>
          <div className="form-actions">
            <button disabled={busy} onClick={() => setReconciling(false)}>
              Keep existing records
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void save("reconcile")}
            >
              Confirm matching reservations
            </button>
          </div>
          {notice && <p role="alert">{notice}</p>}
        </Dialog>
      )}
      {!readOnly && (
        <div className="header-actions">
          <span>
            Automatically use credits:{" "}
            {enabled === null
              ? "Review mixed package settings"
              : enabled === undefined
                ? "Loading…"
                : enabled
                  ? "On"
                  : "Off"}
          </span>
          <button
            disabled={
              busy || (!isDemo && (!account.data || account.data.needsReview))
            }
            onClick={() => setAutomatic(enabled !== true)}
          >
            {enabled === true ? "Turn off" : "Review and turn on"}
          </button>
          {enabled === true && (
            <button
              disabled={
                busy ||
                (!isDemo && (!account.data || account.data.needsReview)) ||
                totals.available <= 0
              }
              onClick={() => void save("apply_upcoming")}
            >
              {busy ? "Applying…" : "Apply available credits now"}
            </button>
          )}
        </div>
      )}
      {readOnly && (
        <p>
          Automatic credit use:{" "}
          {enabled === undefined
            ? "Loading…"
            : enabled === null
              ? "Awaiting coach review"
              : enabled
                ? "On"
                : "Off"}
          . Your coach manages this setting.
        </p>
      )}
      <div className="table-list">
        {data.lessons
          .filter(
            (l) =>
              l.status === "scheduled" &&
              ownsActiveLesson(l) &&
              packages.some(
                (p) => lessonCreditDebit(data.creditEntries, l.id, p.id) > 0,
              ),
          )
          .map((l) => (
            <article key={l.id}>
              <div>
                <strong>{l.topic}</strong>
                <small>
                  {formatStudioDateTime(l.startsAt, data.settings.timezone)}
                </small>
              </div>
              <span>Credit reserved</span>
            </article>
          ))}
      </div>
      <details>
        <summary>Credit history · {history.length} entries</summary>
        <div className="table-list">
          {history.map((e) => (
            <article key={e.id}>
              <div>
                <strong>{e.reason}</strong>
                <small>
                  {formatStudioDateTime(e.createdAt, data.settings.timezone)} ·{" "}
                  {packages.find((p) => p.id === e.packageId)?.name}
                </small>
              </div>
              <span>
                {e.quantity > 0 ? "+" : ""}
                {e.quantity}
              </span>
            </article>
          ))}
        </div>
      </details>
      {notice && (
        <p role="status" className="portal-notice">
          {notice}
        </p>
      )}
      {account.error && (
        <p role="alert">
          Credit settings could not be loaded. {account.error.message}
        </p>
      )}
      {editing && (
        <Dialog
          title="Adjust lesson credits"
          description="Add or remove available credits, or set a balance. Credits already reserved for lessons are preserved."
          onClose={() => !busy && setEditing(false)}
        >
          <form
            className="workflow-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save("set_total");
            }}
          >
            <label className="full">
              Adjustment
              <select
                value={adjustmentMode}
                onChange={(event) => {
                  const mode = event.target.value as CreditAdjustmentMode;
                  setAdjustmentMode(mode);
                  setTarget(
                    String(
                      mode === "set_available"
                        ? Math.max(0, totals.available)
                        : mode === "set_total"
                          ? totals.remaining
                          : 1,
                    ),
                  );
                }}
              >
                <option value="add">Add credits</option>
                <option value="remove">Remove available credits</option>
                <option value="set_available">Set available balance</option>
                <option value="set_total">Set remaining total</option>
              </select>
            </label>
            <label className="full">
              {adjustmentMode === "add"
                ? "Credits to add"
                : adjustmentMode === "remove"
                  ? "Credits to remove"
                  : adjustmentMode === "set_available"
                    ? "New available balance"
                    : "New remaining total"}
              <input
                type="number"
                min={
                  adjustmentMode === "set_total"
                    ? Math.max(0, totals.reserved)
                    : adjustmentMode === "set_available"
                      ? 0
                      : 1
                }
                max={100000}
                step={1}
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
              <small>
                Current: {totals.available} available + {totals.reserved}{" "}
                reserved.{" "}
                {adjustment &&
                  `After adjustment: ${adjustment.available} available + ${totals.reserved} reserved = ${adjustment.total} remaining.`}{" "}
                {enabled &&
                  "Automatic use may then reserve available credits for upcoming lessons."}
              </small>
            </label>
            <label className="full">
              Reason
              <WritingArea
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p className="full">
              Reservations stay attached to their lessons. Reductions remove
              unreserved credits with the latest expiration first; additions are
              general credits without expiration.
            </p>
            <div className="form-actions full">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || !adjustment || reason.trim().length < 3}
              >
                {busy ? "Saving…" : "Save credit adjustment"}
              </button>
            </div>
            {adjustmentError && (
              <p className="full" role="alert">
                {adjustmentError}
              </p>
            )}
            {notice && (
              <p className="full" role="alert">
                {notice}
              </p>
            )}
          </form>
        </Dialog>
      )}
      {automatic !== undefined && (
        <Dialog
          title={
            automatic
              ? "Enable automatic credit use"
              : "Disable automatic credit use"
          }
          description={
            automatic
              ? "Reserve available, unexpired credits for upcoming unpaid lessons, earliest lesson first. Existing cash payments are protected."
              : "Existing reservations stay attached. Newly scheduled lessons will not receive credits automatically."
          }
          onClose={() => !busy && setAutomatic(undefined)}
        >
          <div className="table-list">
            {automatic &&
              upcoming.map((l) => (
                <article key={l.id}>
                  <div>
                    <strong>{l.topic}</strong>
                    <small>
                      {formatStudioDateTime(l.startsAt, data.settings.timezone)}
                    </small>
                  </div>
                  <span>
                    {covered.has(l.id)
                      ? "One credit will be reserved"
                      : "Remains unpaid"}
                  </span>
                </article>
              ))}
          </div>
          <p>
            {automatic
              ? `${totals.available} available credits. Coverage also requires the credit to remain valid on the lesson date. Uncovered lessons stay due.`
              : "You can still apply a credit manually."}
          </p>
          <div className="form-actions">
            <button disabled={busy} onClick={() => setAutomatic(undefined)}>
              Keep current setting
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void save("set_auto")}
            >
              {busy ? "Saving…" : "Confirm"}
            </button>
          </div>
          {notice && <p role="alert">{notice}</p>}
        </Dialog>
      )}
    </Section>
  );
}
