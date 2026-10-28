import { Link } from "react-router-dom";
import type { Dispatch } from "react";
import { recordLink } from "../../app/recordLinks";
import {
  discoveryFailures,
  discoveryReasons,
  type DiscoveryCandidate,
  type DiscoveryProgress,
  type SavedDiscoveries,
} from "../../domain/calendarDiscovery";
import { formatZonedInput } from "../../domain/zonedInput";

const discoveryTime = (instant: string, zone: string) => {
  try {
    return formatZonedInput(instant, zone).replace("T", " ") + ` (${zone})`;
  } catch {
    return instant + " (original offset; display timezone unavailable)";
  }
};
function Candidate({
  item,
  timezone,
}: {
  item: DiscoveryCandidate;
  timezone: string;
}) {
  return (
    <article className="discovery-candidate">
      <strong>{item.summary}</strong>
      <p>
        {item.startsAt && item.endsAt
          ? `${discoveryTime(item.startsAt, timezone)} – ${discoveryTime(item.endsAt, timezone)}`
          : item.startDate
            ? `${item.startDate} – ${item.endDate || "end date unavailable"} (all-day end date excluded)`
            : "Source time requires review."}
      </p>
      <p>
        {discoveryReasons[item.reasonCode] ||
          "Source evidence requires coach review."}
      </p>
      {item.recurringEventId && (
        <p>
          Recurring occurrence
          {item.originalStart
            ? ` · original occurrence ${item.originalStart}`
            : ""}
          .
        </p>
      )}
      {item.possibleLessonCount > 0 && (
        <p>
          {item.possibleLessonCount} possible matching lesson
          {item.possibleLessonCount === 1 ? "" : "s"}. Verify the record before
          linking or creating another.
        </p>
      )}
      {item.possiblePriorSignals.map((signal) => (
        <div key={signal.id}>
          <p>
            {signal.status === "ignored"
              ? "Previously ignored; it remains ignored until explicitly reopened for review."
              : `Previous signal: ${signal.status}.`}
            {signal.matchType === "legacy_unscoped"
              ? " Legacy event ID match; calendar identity still needs verification."
              : " Calendar and event identity match."}
          </p>
          {signal.lessonId && (
            <Link
              to={recordLink("coach", { kind: "lesson", id: signal.lessonId })}
            >
              Open possibly linked lesson
            </Link>
          )}
        </div>
      ))}
    </article>
  );
}
export function DiscoveryProgressView({
  data,
  busy,
  pending,
  onRead,
  onRefresh,
  onMore,
}: {
  data: DiscoveryProgress;
  busy: boolean;
  pending: ReadonlySet<string>;
  onRead: Dispatch<DiscoveryProgress["sources"][number]>;
  onRefresh: () => void;
  onMore: () => void;
}) {
  return (
    <div className="workflow-content">
      <h3>Preview {data.status}</h3>
      <p>
        {discoveryTime(data.from, data.timezone)} –{" "}
        {discoveryTime(data.to, data.timezone)}.
      </p>
      <p>
        Completed means source pages are saved. Lesson identity, attendance and
        financial coverage require their own review.
      </p>
      <div className="header-actions">
        <button type="button" disabled={busy} onClick={onRefresh}>
          Refresh preview progress
        </button>
      </div>
      <div className="discovery-sources">
        {data.sources.map((source) => {
          const action =
            source.status === "failed" || source.status === "retry_required"
              ? "Retry saved page"
              : pending.has(source.calendarId)
                ? "Recover previous page result"
                : "Read next page";
          return (
            <article key={source.calendarId}>
              <strong>{source.label}</strong>
              <p>
                {source.status.replaceAll("_", " ")} · {source.pageSequence}{" "}
                saved page{source.pageSequence === 1 ? "" : "s"} ·{" "}
                {source.observed} observations.
              </p>
              <small>
                Last attempt:{" "}
                {source.lastAttemptAt
                  ? discoveryTime(source.lastAttemptAt, data.timezone)
                  : "Not attempted"}
                . Last saved page:{" "}
                {source.lastSuccessAt
                  ? discoveryTime(source.lastSuccessAt, data.timezone)
                  : "None"}
                .
              </small>
              {source.failureCode && (
                <p>
                  {discoveryFailures[source.failureCode] ||
                    "This source requires review before another attempt."}
                </p>
              )}
              {source.status === "retry_required" && (
                <p>
                  The processing lease expired. Retry the saved page to recover.
                </p>
              )}
              {(source.status !== "completed" ||
                pending.has(source.calendarId)) && (
                <button
                  type="button"
                  className="primary"
                  disabled={busy || source.status === "running"}
                  onClick={() => onRead(source)}
                  aria-label={`${source.label}: ${action.toLowerCase()}`}
                >
                  {action}
                </button>
              )}
            </article>
          );
        })}
      </div>
      <h3>Source observations</h3>
      <p>
        Showing {data.items.length} of {data.total} saved candidates. A page
        size is not a total discovery limit.
      </p>
      {data.items.map((item) => (
        <div key={item.id}>
          <small>
            {data.sources.find(
              (source) => source.calendarId === item.calendarId,
            )?.label || item.calendarId}
          </small>
          <Candidate item={item} timezone={data.timezone} />
        </div>
      ))}
      {!data.total && (
        <p>
          {data.status === "completed"
            ? "No events were returned in this selected range."
            : "No observations are saved yet. Read an available source page to begin."}
        </p>
      )}
      {data.hasMore && (
        <div className="header-actions">
          <button type="button" disabled={busy} onClick={onMore}>
            Load more candidates
          </button>
        </div>
      )}
    </div>
  );
}
export function SavedDiscoveryView({
  data,
  busy,
  onOpen,
  onMore,
}: {
  data: SavedDiscoveries;
  busy: boolean;
  onOpen: Dispatch<string>;
  onMore: () => void;
}) {
  return (
    <div className="workflow-content">
      <p>
        {data.total} saved previews · showing {data.items.length}.
      </p>
      {data.items.map((row) => (
        <article className="discovery-candidate" key={row.scanId}>
          <strong>
            {discoveryTime(row.from, row.timezone)} –{" "}
            {discoveryTime(row.to, row.timezone)}
          </strong>
          <p>
            {row.calendarCount} calendars · {row.candidateCount} candidates.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpen(row.scanId)}
          >
            Open preview
          </button>
        </article>
      ))}
      {!data.total && (
        <p>
          No previews have been saved. Choose calendars and a date range to
          begin.
        </p>
      )}
      {data.hasMore && (
        <button type="button" disabled={busy} onClick={onMore}>
          Load more saved previews
        </button>
      )}
    </div>
  );
}
