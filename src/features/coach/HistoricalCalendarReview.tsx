import { useId } from "react";
import { Link } from "react-router-dom";
import { recordLink } from "../../app/recordLinks";
import { historicalHold } from "../../domain/historicalCalendarReview";
import { formatZonedInput, zonedInputInstants } from "../../domain/zonedInput";
import type { HistoricalReviewController } from "./useHistoricalCalendarReview";
export function HistoricalCalendarReview({
  control: c,
  timezone,
}: {
  control: HistoricalReviewController;
  timezone: string;
}) {
  const id = useId(),
    f = c.fields,
    hasCanonicalLink =
      !!c.source?.decision?.lesson_id || !!c.source?.linkedLessons.length;
  const displayTime = (instant: string) => {
    try {
      return `${formatZonedInput(instant, timezone).replace("T", " ")} (${timezone})`;
    } catch {
      return `${instant} (original offset; studio timezone unavailable)`;
    }
  };
  const time = (
    label: "From" | "Until",
    key: "from" | "to",
    fold: "fromFold" | "toFold",
  ) => {
    const choices = zonedInputInstants(f[key], timezone);
    return (
      <div>
        <label htmlFor={id + key}>
          {label}
          <input
            id={id + key}
            required
            type="datetime-local"
            value={f[key]}
            onChange={(e) => c.edit(key, e.target.value)}
          />
        </label>
        {choices.length > 1 && (
          <label htmlFor={id + fold}>
            {label} repeated-hour occurrence
            <select
              id={id + fold}
              value={f[fold]}
              onChange={(e) => c.edit(fold, e.target.value)}
              required
            >
              <option value="">Choose occurrence</option>
              {choices.map((instant, index) => (
                <option value={instant} key={instant}>
                  {index === 0 ? "First" : "Second"} occurrence · {instant}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    );
  };
  return (
    <div className="workflow-content historical-source-review">
      <h3>{c.candidate?.summary || "Historical source review"}</h3>
      <p>
        Confirm what this source means. Source verification never proves
        attendance or payment.
      </p>
      {c.error && (
        <p role="alert" className="inline-error">
          {c.error}
        </p>
      )}
      {c.busy && <p role="status">Updating this source review…</p>}
      {c.pending && (
        <p role="status">
          The last save result is unknown. Your exact request is retained. Retry
          unchanged to recover its receipt before making another decision.
        </p>
      )}
      {c.receipt && (
        <div role="status">
          <strong>Source decision saved.</strong>
          <p>
            {c.receipt.resource.created
              ? "A scheduled historical lesson and confirmed participant were recorded. Attendance and financial coverage remain unverified."
              : c.receipt.resource.linked
                ? `Linked to the existing lesson. Its recorded outcome (${c.receipt.resource.recordedOutcome}) and financial history were preserved.`
                : `Decision: ${c.receipt.resource.disposition?.replaceAll("_", " ")}. No lesson, attendance, payment or notification was created.`}
          </p>
          {c.receipt.resource.lessonId && (
            <Link
              to={recordLink("coach", {
                kind: "lesson",
                id: c.receipt.resource.lessonId,
              })}
            >
              Open saved original lesson
            </Link>
          )}
        </div>
      )}
      <button type="button" onClick={c.refresh} disabled={c.locked}>
        Refresh source review
      </button>
      {c.source && (
        <>
          <p>
            Calendar: {c.source.calendarId}. Event: {c.source.sourceStatus}.
            Current decision: {c.source.decision?.disposition || "Not reviewed"}
            .
          </p>
          <p>
            Source time:{" "}
            {(c.source.observation.startsAt
              ? displayTime(c.source.observation.startsAt)
              : null) ||
              c.source.observation.startDate ||
              "Unconfirmed"}{" "}
            –{" "}
            {(c.source.observation.endsAt
              ? displayTime(c.source.observation.endsAt)
              : null) ||
              c.source.observation.endDate ||
              "Unconfirmed"}
            .
          </p>
          {c.source.linkedLessons.map((lesson) => (
            <p key={lesson.id}>
              <Link to={recordLink("coach", { kind: "lesson", id: lesson.id })}>
                Open original lesson: {lesson.topic}
              </Link>{" "}
              · {lesson.status}
            </p>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              c.prepare();
            }}
            className="historical-review-form"
          >
            <fieldset disabled={c.locked}>
              <legend>Choose an explicit outcome</legend>
              <label htmlFor={id + "action"}>
                Review action
                <select
                  id={id + "action"}
                  value={f.action}
                  onChange={(e) =>
                    c.edit("action", e.target.value as typeof f.action)
                  }
                >
                  <option value="link">Link existing historical lesson</option>
                  <option value="create">
                    Record scheduled historical lesson
                  </option>
                  <option value="reopen">Reopen for review</option>
                  <option value="not_lesson" disabled={hasCanonicalLink}>
                    Not a lesson
                  </option>
                  <option value="skip" disabled={hasCanonicalLink}>
                    Skip with reason
                  </option>
                </select>
              </label>
              {hasCanonicalLink && (
                <p>
                  This source already links an original lesson. Preserve that
                  link; exclusion decisions are unavailable.
                </p>
              )}
              {(f.action === "link" || f.action === "create") && (
                <>
                  <p>
                    Choose the original student. Related profile links never
                    combine ownership or balances.
                  </p>
                  <label htmlFor={id + "student"}>
                    Find original student
                    <input
                      id={id + "student"}
                      value={f.studentQuery}
                      onChange={(e) => c.edit("studentQuery", e.target.value)}
                    />
                  </label>
                  <button type="button" onClick={() => c.search("student")}>
                    Search original students
                  </button>
                  {c.students && (
                    <>
                      <ul aria-label="Original student results">
                        {c.students.items.map((row) => (
                          <li key={row.id}>
                            <button
                              type="button"
                              onClick={() => c.chooseStudent(row)}
                              aria-pressed={f.studentId === row.id}
                            >
                              {row.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                      {!c.students.items.length && (
                        <p>No matching original students were returned.</p>
                      )}
                      {c.students.moreGroups.includes("student") && (
                        <button
                          type="button"
                          onClick={() => c.search("student", true)}
                        >
                          Load more original students
                        </button>
                      )}
                    </>
                  )}
                  {f.studentId && (
                    <p>
                      Selected original student:{" "}
                      <Link
                        to={recordLink("coach", {
                          kind: "student",
                          id: f.studentId,
                        })}
                      >
                        {f.studentName}
                      </Link>
                    </p>
                  )}
                  {f.action === "link" && (
                    <>
                      <label htmlFor={id + "lesson"}>
                        Find existing lesson
                        <input
                          id={id + "lesson"}
                          value={f.lessonQuery}
                          onChange={(e) =>
                            c.edit("lessonQuery", e.target.value)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!f.studentId}
                        onClick={() => c.search("lesson")}
                      >
                        Search this student's lessons
                      </button>
                      {c.lessons && (
                        <>
                          <ul aria-label="Original lesson results">
                            {c.lessons.items.map((row) => (
                              <li key={row.id}>
                                <button
                                  type="button"
                                  onClick={() => c.chooseLesson(row.id)}
                                  aria-pressed={f.lesson?.id === row.id}
                                >
                                  {row.title}
                                </button>
                              </li>
                            ))}
                          </ul>
                          {!c.lessons.items.length && (
                            <p>
                              No matching lessons were returned. Try the
                              original lesson's topic.
                            </p>
                          )}
                          {c.lessons.moreGroups.includes("lesson") && (
                            <button
                              type="button"
                              onClick={() => c.search("lesson", true)}
                            >
                              Load more original lessons
                            </button>
                          )}
                        </>
                      )}
                      {f.lesson && (
                        <p>
                          Selected: {f.lesson.topic} ·{" "}
                          {displayTime(f.lesson.startsAt)} –{" "}
                          {displayTime(f.lesson.endsAt)} · recorded outcome{" "}
                          {f.lesson.status}.{" "}
                          <Link
                            to={recordLink("coach", {
                              kind: "lesson",
                              id: f.lesson.id,
                            })}
                          >
                            Open selected original lesson
                          </Link>
                        </p>
                      )}
                    </>
                  )}
                  {f.action === "create" && (
                    <>
                      <p>
                        Outcome: <strong>Scheduled historical</strong>.
                        Attendance is unverified. No credits, payments, Calendar
                        changes or student messages will be generated.
                      </p>
                      <p>
                        Local time controls use studio timezone:{" "}
                        {timezone || "Not configured"}. Date-only sources
                        require explicit times.
                      </p>
                      <div className="historical-time-fields">
                        {time("From", "from", "fromFold")}
                        {time("Until", "to", "toFold")}
                      </div>
                      <label htmlFor={id + "topic"}>
                        Lesson topic
                        <input
                          id={id + "topic"}
                          required
                          maxLength={300}
                          value={f.topic}
                          onChange={(e) => c.edit("topic", e.target.value)}
                        />
                      </label>
                      <label htmlFor={id + "locationType"}>
                        Meeting format
                        <select
                          id={id + "locationType"}
                          value={f.locationType}
                          onChange={(e) =>
                            c.edit(
                              "locationType",
                              e.target.value as typeof f.locationType,
                            )
                          }
                        >
                          <option value="in_person">In person</option>
                          <option value="virtual">Virtual</option>
                        </select>
                      </label>
                      <label htmlFor={id + "location"}>
                        Confirmed location or meeting description
                        <input
                          id={id + "location"}
                          maxLength={500}
                          required
                          value={f.locationLabel}
                          onChange={(e) =>
                            c.edit("locationLabel", e.target.value)
                          }
                        />
                      </label>
                    </>
                  )}
                  <label
                    className="historical-review-check"
                    htmlFor={id + "sourceAck"}
                  >
                    <input
                      id={id + "sourceAck"}
                      type="checkbox"
                      checked={f.sourceAck}
                      onChange={(e) => c.edit("sourceAck", e.target.checked)}
                    />
                    I reviewed any cancellation, date-only or time differences
                    between this source and the chosen lesson.
                  </label>
                  <label
                    className="historical-review-check"
                    htmlFor={id + "duplicateAck"}
                  >
                    <input
                      id={id + "duplicateAck"}
                      type="checkbox"
                      checked={f.duplicateAck}
                      onChange={(e) => c.edit("duplicateAck", e.target.checked)}
                    />
                    I reviewed possible matching lessons and selected the exact
                    original record.
                  </label>
                </>
              )}
              {f.action === "reopen" && (
                <>
                  <p>
                    Reopening changes one source decision to review. Existing
                    lesson owners and history stay intact.
                  </p>
                  <label htmlFor={id + "ignored"}>
                    Source decision to reopen
                    <select
                      id={id + "ignored"}
                      value={f.ignoredId}
                      onChange={(e) => c.edit("ignoredId", e.target.value)}
                    >
                      <option value="">
                        {c.source.decision &&
                        c.source.decision.disposition !== "review"
                          ? "Reopen current finalized source decision"
                          : "Choose an ignored signal"}
                      </option>
                      {c.source.priorSignals
                        .filter((row) => row.status === "ignored")
                        .map((row) => (
                          <option key={row.id} value={row.id}>
                            Ignored{" "}
                            {row.matchType === "legacy_unscoped"
                              ? "legacy signal"
                              : "calendar-qualified signal"}{" "}
                            · {row.updatedAt} · {row.id}
                          </option>
                        ))}
                    </select>
                  </label>
                  {c.source.priorSignals.find((row) => row.id === f.ignoredId)
                    ?.matchType === "legacy_unscoped" && (
                    <label
                      className="historical-review-check"
                      htmlFor={id + "unscoped"}
                    >
                      <input
                        id={id + "unscoped"}
                        type="checkbox"
                        checked={f.unscopedAck}
                        onChange={(e) =>
                          c.edit("unscopedAck", e.target.checked)
                        }
                      />
                      I verified this exact legacy event belongs to calendar{" "}
                      {c.source.calendarId}.
                    </label>
                  )}
                </>
              )}
              {(f.action === "not_lesson" || f.action === "skip") && (
                <p>
                  This records a historical source decision only. Existing
                  linked lessons, attendance and financial history remain
                  unchanged.
                </p>
              )}
              <label htmlFor={id + "reason"}>
                Reason for this source decision
                <textarea
                  id={id + "reason"}
                  value={f.reason}
                  required
                  minLength={3}
                  maxLength={500}
                  onChange={(e) => c.edit("reason", e.target.value)}
                />
              </label>
              <button type="submit" className="primary">
                Preview source decision
              </button>
            </fieldset>
          </form>
        </>
      )}
      {c.review && (
        <section
          aria-label="Source decision preview"
          className="historical-review-summary"
        >
          <h3>Review before saving</h3>
          <p>
            {c.review.request.kind === "canonical"
              ? c.review.request.proposal.action === "create"
                ? "Record one scheduled historical lesson and confirmed participant."
                : "Link this source to the selected original lesson without changing its outcome or history."
              : `Save ${c.review.request.decision.action.replaceAll("_", " ")} for this source only.`}
          </p>
          <p>
            Attendance and financial coverage remain unverified. No provider or
            message delivery is requested.
          </p>
          {c.review.preview && (
            <>
              <p>
                {c.review.preview.student.name} ·{" "}
                {displayTime(c.review.preview.startsAt)} –{" "}
                {displayTime(c.review.preview.endsAt)}. Recorded outcome:{" "}
                {c.review.preview.recordedOutcome}.
              </p>
              <p>
                {c.review.preview.sourceMatchCount} source-linked lessons;{" "}
                {c.review.preview.intervalMatchCount} same-student interval
                matches.
              </p>
              {!c.review.preview.examplesAreComplete && (
                <p>
                  Examples are incomplete. Review the original records before
                  selecting an exact link.
                </p>
              )}
              {[
                ...c.review.preview.sourceMatchExamples,
                ...c.review.preview.intervalMatchExamples,
              ]
                .filter(
                  (row, i, all) => all.findIndex((x) => x.id === row.id) === i,
                )
                .map((row) => (
                  <p key={row.id}>
                    <Link
                      to={recordLink("coach", { kind: "lesson", id: row.id })}
                    >
                      Open possible original lesson: {row.topic}
                    </Link>
                  </p>
                ))}
              {c.review.preview.blockedReason && (
                <p role="alert" className="inline-error">
                  {historicalHold(c.review.preview.blockedReason)}
                </p>
              )}
            </>
          )}
          <button
            type="button"
            className="primary"
            disabled={c.busy || !!c.review.preview?.blockedReason}
            onClick={c.save}
          >
            {c.pending
              ? "Recover unchanged source request"
              : "Confirm source decision"}
          </button>
        </section>
      )}
      {c.pending && !c.review && (
        <button
          type="button"
          className="primary"
          onClick={c.save}
          disabled={c.busy}
        >
          Recover unchanged source request
        </button>
      )}
      <section aria-label="Source decision history">
        <h3>Decision history</h3>
        <button
          type="button"
          disabled={c.locked}
          onClick={() => c.readHistory()}
        >
          Load source decision history
        </button>
        {c.history && (
          <>
            <p>
              Showing {c.history.items.length} of {c.history.total} decisions.
            </p>
            <ul>
              {c.history.items.map((row) => (
                <li key={row.version}>
                  Version {row.version} · {row.action.replaceAll("_", " ")} ·{" "}
                  {displayTime(row.createdAt)}
                  <p>{row.reason}</p>
                </li>
              ))}
            </ul>
            {c.history.hasMore && (
              <button
                type="button"
                disabled={c.locked}
                onClick={() => c.readHistory(true)}
              >
                Load older source decisions
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
