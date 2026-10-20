import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer, Status } from "../../components/Primitives";
import { LessonChangeReview } from "../../components/LessonChangeReview";
import {
  checkSchedulingConflicts,
  studioCommand,
} from "../../data/bookingCommands";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { useStudioStore } from "../../state/StudioStore";
import type { CalendarProposal } from "../../domain/calendarProposals";
import type { StudioSnapshot } from "../../domain/model";
import { formatStudioDateTime } from "../../domain/presentation";
import { uid } from "./StudentWorkspace.shared";

export function CalendarProposalDialog({
  proposal,
  data,
  isDemo,
  onClose,
}: {
  proposal: CalendarProposal;
  data: StudioSnapshot;
  isDemo: boolean;
  onClose: () => void;
}) {
  const identity = usePrivateIdentity(),
    queryClient = useQueryClient(),
    store = useStudioStore(),
    [studentId, setStudentId] = useState(proposal.lesson?.studentId || ""),
    [topic, setTopic] = useState("Private coaching"),
    [location, setLocation] = useState(""),
    [format, setFormat] = useState<"in_person" | "virtual">("in_person"),
    [recurrence, setRecurrence] = useState<"none" | "weekly" | "biweekly">(
      "none",
    ),
    [count, setCount] = useState(6),
    [reviewing, setReviewing] = useState(false),
    [override, setOverride] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [key] = useState(() => crypto.randomUUID());
  const conflicts = useQuery({
    queryKey: [
      "calendar-proposal",
      identity,
      proposal.lesson?.id,
      proposal.startsAt,
      proposal.endsAt,
    ],
    queryFn: () =>
      checkSchedulingConflicts(
        proposal.startsAt,
        proposal.endsAt,
        proposal.lesson?.id,
      ),
    enabled: !isDemo && !!identity,
    retry: false,
  });
  const localConflicts = data.lessons
      .filter(
        (l) =>
          l.id !== proposal.lesson?.id &&
          l.status === "scheduled" &&
          l.startsAt < proposal.endsAt &&
          l.endsAt > proposal.startsAt,
      )
      .map((l) => ({ id: l.id, summary: l.topic })),
    warnings = isDemo ? localConflicts : conflicts.data || [];
  const applied = async () => {
    await invalidateStudioDomains(queryClient, [
      "students",
      "lessons",
      "booking",
      "finance",
      "messaging",
    ]);
    onClose();
  };
  const create = async () => {
    if (busy || !reviewing) return;
    setBusy(true);
    setError("");
    try {
      if (isDemo) {
        store.transact((draft) => {
          const student = draft.students.find((s) => s.id === studentId);
          if (!student) throw Error("Choose a student");
          if (recurrence !== "none")
            throw Error(
              "Use the recurring setup flow for a recurring demo lesson.",
            );
          draft.lessons.push({
            id: uid("lesson"),
            studioId: data.studioId,
            studentId,
            topic,
            startsAt: proposal.startsAt,
            endsAt: proposal.endsAt,
            status: "scheduled",
            locationType: format,
            locationLabel: location,
            meetingProvider:
              format === "in_person" ? "in_person" : "google_meet",
            capacity: 1,
            preparation: {
              planned: false,
              materialsReady: false,
              setupReady: false,
            },
            version: 1,
            updatedAt: new Date().toISOString(),
          });
        });
      } else
        await studioCommand("lessons", {
          command: "create",
          expectedVersion: 0,
          idempotencyKey: key,
          payload: {
            studentId,
            topic,
            startsAt: proposal.startsAt,
            endsAt: proposal.endsAt,
            locationType: format,
            locationLabel: location,
            recurrence,
            occurrenceCount: recurrence === "none" ? 1 : count,
            timezone: data.settings.timezone,
            allowConflict: override,
          },
          reason: "Coach confirmed a calendar slot proposal",
        });
      await applied();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Creation failed. Retry the same proposal to recover the original result.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      title={
        proposal.lesson
          ? proposal.kind === "resize"
            ? "Review lesson duration"
            : "Review lesson move"
          : "Create lesson from calendar"
      }
      onClose={() => !busy && onClose()}
    >
      <div className="setup-existing">
        <small>{data.settings.timezone}</small>
        {proposal.lesson && (
          <>
            <strong>
              {data.students.find((s) => s.id === proposal.lesson!.studentId)
                ?.fullName || proposal.lesson.topic}
            </strong>
            <span>
              Current:{" "}
              {formatStudioDateTime(
                proposal.lesson.startsAt,
                data.settings.timezone,
              )}{" "}
              –{" "}
              {formatStudioDateTime(
                proposal.lesson.endsAt,
                data.settings.timezone,
              )}
            </span>
          </>
        )}
        <strong>
          Proposed:{" "}
          {formatStudioDateTime(proposal.startsAt, data.settings.timezone)} –{" "}
          {formatStudioDateTime(proposal.endsAt, data.settings.timezone)}
        </strong>
        <span>No change has been saved.</span>
      </div>
      {!isDemo && conflicts.isPending && (
        <p role="status">Checking conflicts…</p>
      )}
      {conflicts.isError && !isDemo && (
        <p role="alert">
          Availability could not be checked.{" "}
          <button onClick={() => void conflicts.refetch()}>Retry</button>
        </p>
      )}
      {warnings.length > 0 && (
        <div className="portal-notice">
          <strong>Scheduling conflicts</strong>
          {warnings.map((w) => (
            <p key={w.id}>{w.summary}</p>
          ))}
          <label className="check-row">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            I have reviewed these conflicts and authorize the existing coach
            override.
          </label>
        </div>
      )}
      {proposal.lesson ? (
        !conflicts.isError &&
        (isDemo || conflicts.isSuccess) &&
        (!warnings.length || override) && (
          <>
            {isDemo ? (
              <div className="form-actions">
                <button onClick={onClose}>Keep original time</button>
                <button
                  className="primary"
                  onClick={() => {
                    store.transact((d) => {
                      const l = d.lessons.find(
                        (l) => l.id === proposal.lesson!.id,
                      );
                      if (l) {
                        l.startsAt = proposal.startsAt;
                        l.endsAt = proposal.endsAt;
                        l.version++;
                      }
                    });
                    void applied();
                  }}
                >
                  Confirm proposed change
                </button>
              </div>
            ) : (
              <LessonChangeReview
                lesson={proposal.lesson}
                action="reschedule"
                times={{
                  startsAt: proposal.startsAt,
                  endsAt: proposal.endsAt,
                  allowConflict: override,
                }}
                onApplied={applied}
                onCancel={onClose}
              />
            )}
          </>
        )
      ) : (
        <div className="workflow-form">
          <label className="full">
            Student
            <select
              disabled={reviewing}
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
            >
              <option value="">Choose a student</option>
              {data.students
                .filter((s) => !s.deletedAt)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
            </select>
          </label>
          <label className="full">
            Lesson focus
            <input
              disabled={reviewing}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>
          <label>
            Location
            <select
              disabled={reviewing}
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
            >
              <option value="in_person">In person</option>
              <option value="virtual">Google Meet</option>
            </select>
          </label>
          <label>
            Location details
            <input
              disabled={reviewing}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label>
            Repeat
            <select
              disabled={reviewing}
              value={recurrence}
              onChange={(e) =>
                setRecurrence(e.target.value as typeof recurrence)
              }
            >
              <option value="none">Once</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every other week</option>
            </select>
          </label>
          {recurrence !== "none" && (
            <label>
              Total occurrences
              <input
                type="number"
                min={2}
                max={52}
                disabled={reviewing}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
          )}
          {reviewing && (
            <div className="setup-existing full">
              <Status tone="warn">Review before scheduling</Status>
              <p>
                {data.students.find((s) => s.id === studentId)?.fullName} ·{" "}
                {topic} · {recurrence === "none" ? 1 : count} occurrence(s)
              </p>
              <p>
                No card is charged or invoice issued. Existing automatic-credit
                policy will evaluate eligible occurrences after creation.
                Calendar synchronization is queued separately.
              </p>
            </div>
          )}
          {error && (
            <p className="full" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions full">
            {reviewing ? (
              <>
                <button disabled={busy} onClick={() => setReviewing(false)}>
                  Edit proposal
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void create()}
                >
                  {busy ? "Scheduling…" : "Confirm & schedule"}
                </button>
              </>
            ) : (
              <button
                className="primary"
                disabled={
                  !studentId ||
                  !topic.trim() ||
                  (!isDemo && !conflicts.isSuccess) ||
                  (!!warnings.length && !override)
                }
                onClick={() => setReviewing(true)}
              >
                Review proposed lesson
              </button>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
