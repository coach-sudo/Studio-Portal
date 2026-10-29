import { captureReviewActor } from "../../data/reviewActor";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import { Dialog } from "../../components/Primitives";
import { ApiClientError } from "../../data/apiClientError";
import {
  loadStudentIdentity,
  previewStudentIdentity,
  saveStudentIdentity,
} from "../../data/studentIdentity";
import {
  identityHold,
  type IdentityGroup,
  type IdentityPreview,
  type IdentityProposal,
} from "../../domain/studentIdentity";
import type { Student } from "../../domain/model";
import "./StudentIdentity.css";
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The related profiles could not be updated. Your selections are retained.";
type Reviewed = { preview: IdentityPreview; key: string; actorId: string };
export function StudentIdentityDialog({
  students,
  loading,
  open,
  onClose,
  onSaved,
}: {
  students: Pick<Student, "id" | "fullName">[];
  loading: boolean;
  open: boolean;
  onClose: () => void;
  onSaved: Dispatch<string>;
}) {
  const id = useId();
  const [currentId, setCurrentId] = useState(""),
    [duplicateId, setDuplicateId] = useState(""),
    [reason, setReason] = useState(""),
    [action, setAction] = useState<"group" | "dissolve">("group");
  const [review, setReview] = useState<Reviewed>(),
    [pending, setPending] = useState<Reviewed>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const guard = useRef(false);
  const invalidate = () => {
    setReview(undefined);
    setSuccess("");
    setError("");
  };
  const perform = async (event?: FormEvent) => {
    event?.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      if (!review && !pending) {
        const proposal: IdentityProposal =
          action === "group"
            ? {
                action,
                currentStudentId: currentId,
                duplicateStudentId: duplicateId,
                reason: reason.trim(),
              }
            : { action, currentStudentId: currentId, reason: reason.trim() };
        const actorId = await captureReviewActor();
        const preview = await previewStudentIdentity(proposal, actorId);
        setReview({ preview, key: crypto.randomUUID(), actorId });
      } else {
        const saved = pending ?? review!;
        setPending(saved);
        await saveStudentIdentity(
          saved.preview.proposal,
          saved.preview.stamp,
          saved.key,
          saved.actorId,
        );
        setPending(undefined);
        setReview(undefined);
        setSuccess(
          action === "group"
            ? "Profiles linked. Open each original record for its own history and balances."
            : "Profiles unlinked. Original records and history are retained.",
        );
        try {
          await onSaved(saved.preview.currentProfile.name);
        } catch {
          setError(
            "Saved successfully. Refreshing the student list failed; you can still open the original records.",
          );
        }
      }
    } catch (failure) {
      setError(message(failure));
      if (
        !pending &&
        failure instanceof ApiClientError &&
        ["REVIEW_REQUIRED", "VALIDATION_FAILED"].includes(failure.code)
      ) {
        setPending(undefined);
        setReview(undefined);
      }
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  if (!open) return null;
  const held = !!pending || busy;
  return (
    <Dialog
      title={
        action === "dissolve"
          ? "Unlink related profiles"
          : "Link duplicate profiles"
      }
      description="Related profiles keep their original records, balances and permissions."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="workflow-form identity-review" onSubmit={perform}>
        {loading && <p role="status">Loading the complete student list…</p>}
        {error && (
          <p className="inline-error full" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="portal-notice full" role="status">
            {success}
          </p>
        )}
        {pending && (
          <p className="portal-notice full" role="status">
            The last outcome is unconfirmed. Retry the saved request to confirm
            whether it was saved. Your reviewed selections are held.
          </p>
        )}
        <label className="full" htmlFor={`${id}-action`}>
          Action
          <select
            id={`${id}-action`}
            value={action}
            disabled={held}
            onChange={(e) => {
              setAction(e.target.value as "group" | "dissolve");
              invalidate();
            }}
          >
            <option value="group">Link related profiles</option>
            <option value="dissolve">Unlink a profile group</option>
          </select>
        </label>
        <label className="full" htmlFor={`${id}-current`}>
          Current profile
          <select
            id={`${id}-current`}
            value={currentId}
            required
            disabled={held || loading}
            onChange={(e) => {
              setCurrentId(e.target.value);
              if (duplicateId === e.target.value) setDuplicateId("");
              invalidate();
            }}
          >
            <option value="">Choose the current profile</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </label>
        {action === "group" && (
          <label className="full" htmlFor={`${id}-duplicate`}>
            Related duplicate
            <select
              id={`${id}-duplicate`}
              required
              value={duplicateId}
              disabled={held || loading}
              onChange={(e) => {
                setDuplicateId(e.target.value);
                invalidate();
              }}
            >
              <option value="">Choose the related profile</option>
              {students
                .filter((s) => s.id !== currentId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="full" htmlFor={`${id}-reason`}>
          Reason
          <textarea
            id={`${id}-reason`}
            required
            minLength={3}
            maxLength={500}
            value={reason}
            disabled={held}
            onChange={(e) => {
              setReason(e.target.value);
              invalidate();
            }}
          />
        </label>
        {review && (
          <section
            className="identity-review-summary full"
            aria-label="Identity review"
          >
            <h3>
              Review{" "}
              {review.preview.proposal.action === "group"
                ? "profile links"
                : "unlinking"}
            </h3>
            <p>
              <strong>{review.preview.currentProfile.name}</strong>
              {review.preview.duplicateProfile ? (
                <>
                  {" "}
                  with <strong>{review.preview.duplicateProfile.name}</strong>
                </>
              ) : (
                <>
                  {" "}
                  · {review.preview.group?.memberCount ?? 0} profiles in this
                  group
                </>
              )}
            </p>
            <p>
              History, balances and access stay with each original profile. No
              profiles are deleted or messages sent.
            </p>
            {review.preview.blockedReason && (
              <p role="alert">{identityHold(review.preview.blockedReason)}</p>
            )}
          </section>
        )}
        {success && currentId && (
          <p className="full">
            <Link to={`/coach/students/${currentId}`}>
              Open current profile
            </Link>
            {duplicateId && action === "group" && (
              <>
                {" "}
                ·{" "}
                <Link to={`/coach/students/${duplicateId}`}>
                  Open original related profile
                </Link>
              </>
            )}
          </p>
        )}
        <div className="form-actions full">
          <button type="button" disabled={busy} onClick={onClose}>
            {success ? "Done" : "Close review"}
          </button>
          {review && !pending && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setReview(undefined)}
            >
              Edit review
            </button>
          )}
          <button
            className="primary"
            disabled={
              busy ||
              loading ||
              !!review?.preview.blockedReason ||
              (!pending &&
                (!currentId ||
                  reason.trim().length < 3 ||
                  (action === "group" && !duplicateId)))
            }
          >
            {busy
              ? "Checking…"
              : pending
                ? "Retry saved request"
                : review
                  ? review.preview.proposal.action === "group"
                    ? "Confirm profile links"
                    : "Confirm unlinking"
                  : "Review change"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function StudentIdentityLinks({
  studentId,
  enabled = true,
}: {
  studentId: string;
  enabled?: boolean;
}) {
  const [data, setData] = useState<IdentityGroup>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const current = useRef(studentId),
    guard = useRef(false);
  current.current = studentId;
  useEffect(() => {
    setData(undefined);
    setError("");
    if (!enabled) return;
    let active = true;
    setBusy(true);
    loadStudentIdentity(studentId)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((failure) => {
        if (active) setError(message(failure));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [studentId, enabled]);
  const read = async (more = false) => {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    const selected = studentId;
    try {
      const next = await loadStudentIdentity(
        selected,
        more ? (data?.nextAfterStudent ?? undefined) : undefined,
      );
      if (current.current !== selected) return;
      if (
        more &&
        data &&
        (data.group?.id !== next.group?.id ||
          data.group?.version !== next.group?.version)
      ) {
        const refreshed = await loadStudentIdentity(selected);
        if (current.current === selected) setData(refreshed);
        return;
      }
      setData((previous) =>
        more &&
        previous &&
        previous.group?.id === next.group?.id &&
        previous.group?.version === next.group?.version
          ? {
              ...next,
              members: [
                ...previous.members,
                ...next.members.filter(
                  (m) =>
                    !previous.members.some((p) => p.studentId === m.studentId),
                ),
              ],
            }
          : next,
      );
    } catch (failure) {
      if (current.current === selected) setError(message(failure));
    } finally {
      guard.current = false;
      if (current.current === selected) setBusy(false);
    }
  };
  if (!enabled) return null;
  if (!busy && !error && data?.total === 0) return null;
  return (
    <section className="identity-links" aria-label="Related student profiles">
      <h2>Related profiles</h2>
      {busy && !data && <p role="status">Loading related profiles…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" disabled={busy} onClick={() => void read()}>
            Retry related profiles
          </button>
        </p>
      )}
      {data && (
        <>
          <p>
            Showing {data.members.length} of {data.total}. Each record keeps its
            own history, balances and permissions.
          </p>
          <ul>
            {data.members.map((member) => (
              <li key={member.studentId}>
                <Link
                  to={`/coach/students/${member.studentId}`}
                  aria-current={
                    member.studentId === studentId ? "page" : undefined
                  }
                >
                  {member.name}
                </Link>
                {member.isCurrent ? " · Current profile" : ""}
                {member.deletedAt ? " · Archived" : ""}
              </li>
            ))}
          </ul>
          {data.hasMore && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void read(true)}
            >
              {busy ? "Loading…" : "Load more related profiles"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
