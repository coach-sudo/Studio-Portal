import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LessonCalendar } from "../../components/LessonCalendar";
import { Dialog, Section, Status } from "../../components/Primitives";
import { RescheduleLessonForm } from "../../components/RescheduleLessonForm";
import {
  checkSchedulingConflicts,
  studioCommand,
} from "../../data/bookingCommands";
import { formatMoney, packageSummary } from "../../domain/finance";
import type { Lesson, StudioSnapshot } from "../../domain/model";
import { formatStudioDateTime } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { sourceLabel, studentName } from "./StudioOperations.shared";

export function LessonsView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const navigate = useNavigate(),
    store = useStudioStore(),
    queryClient = useQueryClient(),
    [selected, setSelected] = useState<Lesson>(),
    [panel, setPanel] = useState<"details" | "reschedule" | "credits">(
      "details",
    ),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [confirmCancel, setConfirmCancel] = useState(false),
    [cadence, setCadence] = useState<"weekly" | "biweekly">("weekly"),
    [occurrences, setOccurrences] = useState(6),
    [creditQuantityText, setCreditQuantityText] = useState("1"),
    [creditReason, setCreditReason] = useState("Lesson-specific credit"),
    [paymentStatus, setPaymentStatus] =
      useState<NonNullable<Lesson["paymentStatus"]>>("untracked"),
    [lessonPrice, setLessonPrice] = useState(""),
    [lessonPaid, setLessonPaid] = useState("");
  const openLesson = (lesson: Lesson) => {
    setSelected(lesson);
    setPanel("details");
    setConfirmCancel(false);
    setPaymentStatus(lesson.paymentStatus || "untracked");
    setLessonPrice(
      lesson.priceMinor == null ? "" : String(lesson.priceMinor / 100),
    );
    setLessonPaid(String((lesson.paidMinor || 0) / 100));
  };
  const update = async (status: "completed" | "cancelled") => {
    if (!selected || busy) return;
    setBusy(status);
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.lessons.find((i) => i.id === selected.id)!;
          item.status = status;
          item.version += 1;
          item.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("lessons", {
          command: status === "completed" ? "complete" : "cancel",
          entityId: selected.id,
          expectedVersion: selected.version,
          reason: `Coach marked lesson ${status}`,
        });
        await invalidateStudioDomains(queryClient, ["lessons"]);
      }
      setSelected(undefined);
      setNotice(
        status === "cancelled"
          ? "Lesson cancelled and removed from the active calendar. Calendar notifications are being updated."
          : "Lesson marked completed.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Lesson could not be updated.",
      );
    } finally {
      setBusy("");
    }
  };
  const move = async (
    startsAt: string,
    endsAt: string,
    allowConflict = false,
  ) => {
    if (!selected || busy) return;
    setBusy("reschedule");
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.lessons.find((i) => i.id === selected.id)!;
          item.startsAt = startsAt;
          item.endsAt = endsAt;
          item.version += 1;
        });
      else {
        await studioCommand("lessons", {
          command: "reschedule",
          entityId: selected.id,
          expectedVersion: selected.version,
          payload: { startsAt, endsAt, allowConflict },
          reason: "Coach rescheduled lesson",
        });
        await invalidateStudioDomains(queryClient, ["lessons"]);
      }
      setSelected(undefined);
      setNotice(
        "Lesson rescheduled. Calendar and student invitation updates are queued.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Lesson could not be rescheduled.",
      );
    } finally {
      setBusy("");
    }
  };
  const makeRecurring = async () => {
    if (!selected || busy) return;
    setBusy("recurring");
    try {
      if (isDemo)
        store.transact((draft) => {
          const base = draft.lessons.find(
            (lesson) => lesson.id === selected.id,
          )!;
          const seriesId = `series-${crypto.randomUUID()}`;
          base.seriesId = seriesId;
          base.version += 1;
          for (let index = 1; index < occurrences; index += 1) {
            const days = (cadence === "biweekly" ? 14 : 7) * index;
            draft.lessons.push({
              ...base,
              id: `lesson-${crypto.randomUUID()}`,
              seriesId,
              startsAt: new Date(
                new Date(base.startsAt).getTime() + days * 86400000,
              ).toISOString(),
              endsAt: new Date(
                new Date(base.endsAt).getTime() + days * 86400000,
              ).toISOString(),
              version: 1,
              updatedAt: new Date().toISOString(),
            });
          }
        });
      else {
        await studioCommand("lessons", {
          command: "make_recurring",
          entityId: selected.id,
          expectedVersion: selected.version,
          payload: {
            cadence,
            occurrenceCount: occurrences,
            timezone: data.settings.timezone,
          },
          reason: "Coach created recurring lesson series",
        });
        await invalidateStudioDomains(queryClient, ["lessons"]);
      }
      setSelected(undefined);
      setNotice(`${occurrences} ${cadence} lessons added as one series.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Recurring lessons could not be created.",
      );
    } finally {
      setBusy("");
    }
  };
  const creditQuantity = Number(creditQuantityText);
  const validCreditQuantity =
    creditQuantityText.trim() !== "" &&
    Number.isInteger(creditQuantity) &&
    creditQuantity !== 0 &&
    Math.abs(creditQuantity) <= 20;
  const adjustLessonCredit = async () => {
    if (
      !selected ||
      !validCreditQuantity ||
      creditReason.trim().length < 3 ||
      busy
    )
      return;
    setBusy("credit");
    try {
      if (isDemo) {
        store.transact((draft) => {
          let pkg = draft.packages.find(
            (item) =>
              item.studentId === selected.studentId &&
              item.name === "Studio lesson credits",
          );
          if (!pkg) {
            pkg = {
              id: `package-${crypto.randomUUID()}`,
              studentId: selected.studentId,
              name: "Studio lesson credits",
              priceMinor: 0,
              currency: "USD",
              version: 1,
              updatedAt: new Date().toISOString(),
            };
            draft.packages.push(pkg);
          }
          draft.creditEntries.push({
            id: `credit-${crypto.randomUUID()}`,
            packageId: pkg.id,
            lessonId: selected.id,
            kind: "adjustment",
            quantity: creditQuantity,
            reason: creditReason,
            createdAt: new Date().toISOString(),
          });
        });
      } else {
        await studioCommand("credits", {
          command: "grant",
          expectedVersion: 0,
          payload: {
            studentId: selected.studentId,
            lessonId: selected.id,
            quantity: creditQuantity,
            reason: creditReason,
          },
          reason: "Coach adjusted credit for a specific lesson",
        });
        await invalidateStudioDomains(queryClient, ["lessons", "finance"]);
      }
      setNotice(`Credit adjustment attached to ${selected.topic}.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Lesson credit could not be adjusted.",
      );
    } finally {
      setBusy("");
    }
  };
  const payWithCredit = async () => {
    if (!selected || busy) return;
    setBusy("pay-credit");
    try {
      if (isDemo) {
        store.transact((draft) => {
          const pkg = draft.packages
            .filter((item) => item.studentId === selected.studentId)
            .find(
              (item) =>
                packageSummary(item, draft.creditEntries).remainingCredits > 0,
            );
          if (!pkg)
            throw new Error("This student does not have an available credit.");
          draft.creditEntries.push({
            id: `credit-${crypto.randomUUID()}`,
            packageId: pkg.id,
            lessonId: selected.id,
            kind: "consumption",
            quantity: -1,
            reason: `Paid by credit for ${selected.topic}`,
            createdAt: new Date().toISOString(),
          });
          const lesson = draft.lessons.find((item) => item.id === selected.id);
          if (lesson) lesson.packageId = pkg.id;
        });
      } else {
        await studioCommand("credits", {
          command: "use_for_lesson",
          entityId: selected.id,
          expectedVersion: selected.version,
          payload: { reason: `Paid by credit for ${selected.topic}` },
          reason: "Coach marked lesson paid by credit",
        });
        await invalidateStudioDomains(queryClient, ["lessons", "finance"]);
      }
      setSelected(undefined);
      setNotice("One credit was used and the lesson is marked paid by credit.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "The lesson could not be paid by credit.",
      );
    } finally {
      setBusy("");
    }
  };
  const savePaymentStatus = async () => {
    if (!selected || busy) return;
    setBusy("payment");
    const priceMinor =
      lessonPrice === "" ? undefined : Math.round(Number(lessonPrice) * 100);
    const paidMinor = Math.round(Number(lessonPaid || 0) * 100);
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.lessons.find((row) => row.id === selected.id);
          if (item) {
            item.paymentStatus = paymentStatus;
            item.priceMinor = priceMinor;
            item.paidMinor = paidMinor;
            item.version += 1;
            item.updatedAt = new Date().toISOString();
          }
        });
      else {
        await studioCommand("lessons", {
          command: "set_payment_status",
          entityId: selected.id,
          expectedVersion: selected.version,
          payload: { paymentStatus, priceMinor, paidMinor },
          reason: "Coach updated lesson payment status",
        });
        await invalidateStudioDomains(queryClient, ["lessons", "finance"]);
      }
      setNotice("Lesson payment status saved.");
      setSelected(undefined);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Payment status could not be saved.",
      );
    } finally {
      setBusy("");
    }
  };
  const selectedStudent = selected
    ? data.students.find((student) => student.id === selected.studentId)
    : undefined;
  const availableCredits = selectedStudent
    ? data.packages
        .filter((pkg) => pkg.studentId === selectedStudent.id)
        .reduce(
          (total, pkg) =>
            total + packageSummary(pkg, data.creditEntries).remainingCredits,
          0,
        )
    : 0;
  const paidByCredit = selected
    ? data.creditEntries.some(
        (entry) =>
          entry.lessonId === selected.id &&
          ["reservation", "consumption"].includes(entry.kind),
      )
    : false;
  const selectedNotes = selected
    ? data.notes.filter((item) => item.lessonId === selected.id).length
    : 0;
  const selectedPractice = selected
    ? data.assignments.filter((item) => item.lessonId === selected.id).length
    : 0;
  const selectedMaterials = selected
    ? data.materials.filter((item) => item.lessonId === selected.id).length
    : 0;
  const selectedDuration = selected
    ? Math.round(
        (new Date(selected.endsAt).getTime() -
          new Date(selected.startsAt).getTime()) /
          60_000,
      )
    : 0;
  return (
    <Section title="Lesson calendar" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <p className="section-intro">
        Day, week, month, and year views share one searchable schedule.
        Cancelled lessons stay out of the way unless you choose to show them.
      </p>
      <LessonCalendar
        lessons={data.lessons}
        timezone={data.settings.timezone}
        studentName={(id) => studentName(data, id)}
        sourceName={sourceLabel}
        onOpen={openLesson}
      />
      {selected && (
        <Dialog
          title={
            panel === "reschedule"
              ? "Reschedule lesson"
              : panel === "credits"
                ? "Lesson credits"
                : selected.topic
          }
          description={`${studentName(data, selected.studentId)} · ${formatStudioDateTime(selected.startsAt, data.settings.timezone)} · ${sourceLabel(selected.sourceProvider)}`}
          onClose={() => setSelected(undefined)}
        >
          {panel === "reschedule" ? (
            <RescheduleLessonForm
              lesson={selected}
              studentName={studentName(data, selected.studentId)}
              timezone={data.settings.timezone}
              cancellationWindowHours={
                data.settings.bookingDefaults.cancellationWindowHours
              }
              busy={busy === "reschedule"}
              onCheckConflicts={(startsAt, endsAt) =>
                isDemo
                  ? Promise.resolve(
                      data.lessons
                        .filter(
                          (lesson) =>
                            lesson.id !== selected.id &&
                            lesson.status === "scheduled" &&
                            lesson.startsAt < endsAt &&
                            lesson.endsAt > startsAt,
                        )
                        .map((lesson) => ({
                          id: lesson.id,
                          summary: lesson.topic,
                          start: lesson.startsAt,
                          end: lesson.endsAt,
                        })),
                    )
                  : checkSchedulingConflicts(startsAt, endsAt, selected.id)
              }
              onCancel={() => setPanel("details")}
              onSubmit={move}
            />
          ) : (
            <div className="workflow-content lesson-command-center">
              <div className="lesson-command-summary">
                <Status
                  tone={
                    selected.status === "completed"
                      ? "good"
                      : selected.status === "scheduled"
                        ? "neutral"
                        : "warn"
                  }
                >
                  {selected.status}
                </Status>
                <span>{selected.locationLabel}</span>
                <span>
                  {selected.seriesId ? "Recurring series" : "Single lesson"}
                </span>
                <span>
                  {paidByCredit
                    ? "Paid by credit"
                    : `${availableCredits} credits available`}
                </span>
              </div>
              <div className="form-actions">
                {panel === "credits" && (
                  <button
                    className="text-button"
                    onClick={() => setPanel("details")}
                  >
                    Back to lesson details
                  </button>
                )}
                {panel === "details" && selected.status === "scheduled" && (
                  <button
                    className="primary"
                    onClick={() => setPanel("reschedule")}
                  >
                    Reschedule
                  </button>
                )}
                {panel === "details" && (
                  <button
                    className="text-button"
                    onClick={() => setPanel("credits")}
                  >
                    Adjust credits
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() =>
                    navigate(
                      `/coach/students/${selected.studentId}/lessons/${selected.id}`,
                    )
                  }
                >
                  Open lesson workspace
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    navigate(`/coach/students/${selected.studentId}/lessons`)
                  }
                >
                  Student history
                </button>
                {data.lessonParticipants.some(
                  (part) => part.lessonId === selected.id && part.bookingId,
                ) && (
                  <button
                    className="text-button"
                    onClick={() =>
                      navigate(
                        `/coach/bookings?view=calendar&lesson=${selected.id}`,
                      )
                    }
                  >
                    Open booking record
                  </button>
                )}
              </div>
              {panel === "details" && (
                <section
                  className="lesson-facts"
                  aria-label="Lesson information"
                >
                  <div>
                    <small>Date & time</small>
                    <strong>
                      {formatStudioDateTime(
                        selected.startsAt,
                        data.settings.timezone,
                      )}
                    </strong>
                  </div>
                  <div>
                    <small>Duration</small>
                    <strong>{selectedDuration} minutes</strong>
                  </div>
                  <div>
                    <small>Delivery</small>
                    <strong>{selected.locationLabel}</strong>
                  </div>
                  <div>
                    <small>Source</small>
                    <strong>{sourceLabel(selected.sourceProvider)}</strong>
                  </div>
                  <div>
                    <small>Lesson work</small>
                    <strong>
                      {selectedNotes} notes · {selectedPractice} practice ·{" "}
                      {selectedMaterials} files
                    </strong>
                  </div>
                  <div>
                    <small>Payment</small>
                    <strong>
                      {paidByCredit
                        ? "Paid with lesson credit"
                        : (selected.paymentStatus || "untracked").replaceAll(
                            "_",
                            " ",
                          )}
                      {selected.priceMinor != null
                        ? ` · ${formatMoney(selected.priceMinor)}`
                        : ""}
                    </strong>
                  </div>
                </section>
              )}
              {panel === "details" &&
                selected.status === "scheduled" &&
                !selected.seriesId && (
                  <section className="lesson-command-section">
                    <h3>Make recurring</h3>
                    <p>
                      Create the remaining occurrences in one DST-safe series.
                    </p>
                    <div className="inline-command">
                      <label>
                        Rhythm
                        <select
                          value={cadence}
                          onChange={(event) =>
                            setCadence(event.target.value as typeof cadence)
                          }
                        >
                          <option value="weekly">Weekly</option>
                          <option value="biweekly">Every other week</option>
                        </select>
                      </label>
                      <label>
                        Total lessons
                        <input
                          type="number"
                          min="2"
                          max="52"
                          value={occurrences}
                          onChange={(event) =>
                            setOccurrences(Number(event.target.value))
                          }
                        />
                      </label>
                      <button
                        disabled={
                          Boolean(busy) || occurrences < 2 || occurrences > 52
                        }
                        onClick={() => void makeRecurring()}
                      >
                        {busy === "recurring" ? "Creating…" : "Create series"}
                      </button>
                    </div>
                  </section>
                )}
              {panel === "credits" && (
                <section className="lesson-command-section">
                  <h3>Credits & payment</h3>
                  <p>
                    Adjust the student’s balance and attach the reason to this
                    lesson. Positive numbers add credits; negative numbers
                    remove them.
                  </p>
                  <div className="inline-command">
                    <label>
                      Credits
                      <input
                        type="text"
                        inputMode="numeric"
                        value={creditQuantityText}
                        onChange={(event) =>
                          setCreditQuantityText(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Reason
                      <input
                        value={creditReason}
                        onChange={(event) =>
                          setCreditReason(event.target.value)
                        }
                      />
                    </label>
                    <button
                      disabled={
                        Boolean(busy) ||
                        !validCreditQuantity ||
                        creditReason.trim().length < 3
                      }
                      onClick={() => void adjustLessonCredit()}
                    >
                      {busy === "credit" ? "Saving…" : "Add adjustment"}
                    </button>
                  </div>
                  {!paidByCredit && (
                    <button
                      className="primary"
                      disabled={Boolean(busy) || availableCredits < 1}
                      onClick={() => void payWithCredit()}
                    >
                      {busy === "pay-credit"
                        ? "Applying…"
                        : availableCredits > 0
                          ? "Use 1 credit for this lesson"
                          : "No credit available"}
                    </button>
                  )}
                  <div className="inline-command payment-status-command">
                    <label>
                      Status
                      <select
                        value={paymentStatus}
                        onChange={(event) =>
                          setPaymentStatus(
                            event.target.value as typeof paymentStatus,
                          )
                        }
                      >
                        <option value="untracked">Not tracked</option>
                        <option value="due">Due</option>
                        <option value="partially_paid">Partially paid</option>
                        <option value="paid">Paid</option>
                        <option value="waived">Waived</option>
                        <option value="refunded">Refunded</option>
                      </select>
                    </label>
                    <label>
                      Lesson price (USD)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={lessonPrice}
                        onChange={(event) => setLessonPrice(event.target.value)}
                      />
                    </label>
                    <label>
                      Amount paid (USD)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={lessonPaid}
                        onChange={(event) => setLessonPaid(event.target.value)}
                      />
                    </label>
                    <button
                      disabled={Boolean(busy)}
                      onClick={() => void savePaymentStatus()}
                    >
                      {busy === "payment" ? "Saving…" : "Save payment status"}
                    </button>
                  </div>
                </section>
              )}
              {panel === "details" && selected.status === "scheduled" && (
                <div className="form-actions lesson-final-actions">
                  <button
                    className="primary"
                    disabled={Boolean(busy)}
                    onClick={() => void update("completed")}
                  >
                    {busy === "completed" ? "Saving…" : "Mark complete"}
                  </button>
                  {confirmCancel ? (
                    <>
                      <span>
                        This removes it from active calendars and sends the
                        cancellation to Google.
                      </span>
                      <button
                        className="danger-button"
                        disabled={Boolean(busy)}
                        onClick={() => void update("cancelled")}
                      >
                        {busy === "cancelled"
                          ? "Cancelling…"
                          : "Confirm cancellation"}
                      </button>
                      <button onClick={() => setConfirmCancel(false)}>
                        Keep lesson
                      </button>
                    </>
                  ) : (
                    <button
                      className="danger-button"
                      onClick={() => setConfirmCancel(true)}
                    >
                      Cancel & remove lesson
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </Dialog>
      )}
    </Section>
  );
}
