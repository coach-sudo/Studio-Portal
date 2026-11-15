import { useState } from "react";
import { Link } from "react-router-dom";
import { useCreditReminderHistory } from "../data/creditReminders";
import { formatStudioDateTime } from "../domain/presentation";

export function CreditReminderHistory({
  studentIds,
  timezone,
}: {
  studentIds: string[];
  timezone: string;
}) {
  const [opened, setOpened] = useState(false);
  const history = useCreditReminderHistory(studentIds, opened);
  return (
    <details
      className="disclosure-section"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>Renewal reminders</summary>
      {opened && history.isFetching && <p role="status">Checking reminders…</p>}
      {opened && history.isError && (
        <p role="status">Reminder history is unavailable.</p>
      )}
      {opened &&
        !history.isFetching &&
        !history.isError &&
        !history.data?.length && <p>No credit reminders yet.</p>}
      {opened &&
        history.data?.map((entry) => (
          <article key={entry.id}>
            <strong>{entry.subject}</strong>
            <p>
              {entry.studentName} · {formatStudioDateTime(entry.at, timezone)}
            </p>
            <p>{entry.body}</p>
            {entry.requiresAction ? (
              <Link to={entry.path}>Review lesson credits</Link>
            ) : (
              <small>No action required</small>
            )}
          </article>
        ))}
    </details>
  );
}
