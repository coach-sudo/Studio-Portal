import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  reminderAttentionSchema,
  reminderCommand,
  reminderConfigurationSchema,
  reminderLabels,
  renderedTemplateSchema,
  templateKinds,
  type ReminderScope,
  type ReminderTemplate,
} from "../../data/creditReminders";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { formatStudioDateTime } from "../../domain/presentation";

type Student = { id: string; fullName: string };
type Configuration = ReturnType<typeof reminderConfigurationSchema.parse>;
const detail = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The reminder change could not be completed.";

function useReminderConfiguration(studentId: string, enabled: boolean) {
  const identity = usePrivateIdentity();
  return useQuery({
    queryKey: ["reminder-configuration", identity, studentId],
    enabled: enabled && !!identity,
    retry: false,
    queryFn: async ({ signal }) =>
      reminderConfigurationSchema.parse(
        await reminderCommand(studentId, "configuration", {}, signal),
      ),
  });
}

function TemplateEditor({
  studentId,
  template,
  refresh,
}: {
  studentId: string;
  template: ReminderTemplate;
  refresh: () => void;
}) {
  const id = useId();
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [active, setActive] = useState(template.active);
  const [preview, setPreview] = useState<{ subject: string; body: string }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function apply(action: "preview_template" | "save_template") {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await reminderCommand(studentId, action, {
        kind: template.kind,
        version: template.version,
        subject,
        body,
        active,
      });
      if (action === "preview_template")
        setPreview(renderedTemplateSchema.parse(result));
      else refresh();
    } catch (error) {
      setMessage(detail(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="workflow-form"
      onSubmit={(event) => {
        event.preventDefault();
        void apply("save_template");
      }}
    >
      <label htmlFor={id + "-subject"} className="full">
        Subject
        <input
          id={id + "-subject"}
          required
          maxLength={140}
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setPreview(undefined);
          }}
        />
      </label>
      <label htmlFor={id + "-message"} className="full">
        Message
        <textarea
          id={id + "-message"}
          required
          maxLength={1800}
          rows={5}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setPreview(undefined);
          }}
        />
      </label>
      <label htmlFor={id + "-active"} className="check-row full">
        <input
          id={id + "-active"}
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Template active
      </label>
      <details className="full">
        <summary>Personalization fields</summary>
        <p>
          Use double braces, for example <code>{"{{student_first_name}}"}</code>
          .
        </p>
        <p>
          student_first_name, billing_contact_name, package_name, credit_type,
          available_credits, lesson_date, credits_required, renewal_link,
          studio_name
        </p>
      </details>
      {preview && (
        <section
          className="full portal-notice"
          aria-label="Synthetic template preview"
        >
          <div>
            <strong>{preview.subject}</strong>
            <p>{preview.body}</p>
          </div>
        </section>
      )}
      {message && (
        <p className="full" role="alert">
          {message}
        </p>
      )}
      <div className="form-actions full">
        <button
          type="button"
          disabled={busy}
          onClick={() => void apply("preview_template")}
        >
          Preview with sample data
        </button>
        <button type="submit" className="primary" disabled={busy}>
          Save template version
        </button>
      </div>
    </form>
  );
}

function ThresholdEditor({
  studentId,
  scope,
  targetId,
  setting,
  refresh,
}: {
  studentId: string;
  scope: ReminderScope;
  targetId: string;
  setting?: Configuration["settings"][number];
  refresh: () => void;
}) {
  const id = useId();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const pick = (key: string) =>
      form.get(key) ? form.get(key) === "true" : null;
    setBusy(true);
    setFeedback("");
    try {
      await reminderCommand(studentId, "save_settings", {
        scope,
        targetId: scope === "studio" ? null : targetId,
        threshold: form.get("threshold") ? Number(form.get("threshold")) : null,
        enabled: pick("enabled"),
        studentCopy: pick("copy"),
      });
      setFeedback("Reminder settings saved.");
      refresh();
    } catch (error) {
      setFeedback(detail(error));
    } finally {
      setBusy(false);
    }
  }
  function value(input: boolean | null | undefined) {
    return input == null ? "" : String(input);
  }
  return (
    <form className="workflow-form" onSubmit={(event) => void save(event)}>
      <label htmlFor={id + "-threshold"}>
        Available credit threshold
        <input
          id={id + "-threshold"}
          name="threshold"
          type="number"
          min={0}
          max={100000}
          defaultValue={setting?.threshold ?? ""}
          placeholder={scope === "studio" ? "2" : "Inherit"}
        />
      </label>
      <label htmlFor={id + "-enabled"}>
        Reminders
        <select
          id={id + "-enabled"}
          name="enabled"
          defaultValue={value(setting?.enabled)}
        >
          <option value="">
            {scope === "studio" ? "Studio default (enabled)" : "Inherit"}
          </option>
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      </label>
      {scope !== "package" && (
        <label htmlFor={id + "-copies"}>
          Authorized student copies
          <select
            id={id + "-copies"}
            name="copy"
            defaultValue={value(setting?.studentCopy)}
          >
            <option value="">
              {scope === "studio" ? "Studio default (off)" : "Inherit"}
            </option>
            <option value="true">On</option>
            <option value="false">Off</option>
          </select>
        </label>
      )}
      <div className="form-actions full">
        <button type="submit" disabled={busy}>
          Save reminder settings
        </button>
      </div>
      {feedback && (
        <p className="full" role="status">
          {feedback}
        </p>
      )}
    </form>
  );
}

export function CreditReminderConfiguration({
  studentId,
  students,
}: {
  studentId: string;
  students: Student[];
}) {
  const [opened, setOpened] = useState(false);
  const id = useId();
  const config = useReminderConfiguration(studentId, opened);
  const [scope, setScope] = useState<ReminderScope>("studio");
  const [target, setTarget] = useState("");
  const [kind, setKind] =
    useState<ReminderTemplate["kind"]>("uncovered_lesson");
  const data = config.data;
  const template = data?.templates.find((entry) => entry.kind === kind);
  const refresh = () => {
    void config.refetch();
  };
  return (
    <details
      className="disclosure-section"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>Reminder settings and templates</summary>
      {opened && config.isFetching && !data && (
        <p role="status">Loading reminder settings…</p>
      )}
      {opened && config.isError && <p role="alert">{detail(config.error)}</p>}
      {opened && data && (
        <>
          <h3>Low-credit thresholds</h3>
          <p>
            Student settings take precedence over package settings and then the
            studio default of two. Disabling studio reminders pauses every
            scope.
          </p>
          <div className="workflow-form">
            <label htmlFor={id + "-scope"}>
              Settings scope
              <select
                id={id + "-scope"}
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as ReminderScope);
                  setTarget("");
                }}
              >
                <option value="studio">Studio</option>
                <option value="student">Student</option>
                <option value="package">Package or household pool</option>
              </select>
            </label>
            {scope !== "studio" && (
              <label htmlFor={id + "-target"}>
                {scope === "student" ? "Student" : "Package"}
                <select
                  id={id + "-target"}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Choose an account</option>
                  {scope === "student"
                    ? students.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.fullName}
                        </option>
                      ))
                    : data.packages.map((pkg) => (
                        <option key={pkg.id} value={pkg.id}>
                          {pkg.name} · {pkg.owner}
                        </option>
                      ))}
                </select>
              </label>
            )}
          </div>
          {(scope === "studio" || target) && (
            <ThresholdEditor
              key={scope + ":" + target}
              studentId={studentId}
              scope={scope}
              targetId={target}
              setting={data.settings.find(
                (item) =>
                  item.scope === scope &&
                  (scope === "studio" || item.targetId === target),
              )}
              refresh={refresh}
            />
          )}
          <h3>Reminder templates</h3>
          <label htmlFor={id + "-template"}>
            Template
            <select
              id={id + "-template"}
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as ReminderTemplate["kind"])
              }
            >
              {templateKinds.map((item) => (
                <option key={item} value={item}>
                  {reminderLabels[item]}
                </option>
              ))}
            </select>
          </label>
          {template && (
            <TemplateEditor
              key={kind + ":" + template.version}
              template={template}
              studentId={studentId}
              refresh={refresh}
            />
          )}
          <details>
            <summary>Template version history</summary>
            {data.history.filter((item) => item.kind === kind).length === 0 && (
              <p>No custom versions yet.</p>
            )}
            {data.history
              .filter((item) => item.kind === kind)
              .map((item) => (
                <details key={item.version}>
                  <summary>
                    Version {item.version} · {item.subject}
                  </summary>
                  <p>{item.body}</p>
                </details>
              ))}
          </details>
        </>
      )}
    </details>
  );
}

const reasons: Record<string, string> = {
  ambiguous_pool: "Multiple credit pools could apply",
  missing_recipient: "No authorized billing recipient",
  recipient_preference: "Recipient has disabled credit notifications",
  studio_review: "Credit coverage needs studio review",
  processing: "Payment or credit processing is pending",
  pool_routing_or_review: "Check household routing or credit eligibility",
  reminders_disabled: "Reminders are disabled for this account",
};

type ReminderIssue = ReturnType<typeof reminderAttentionSchema.parse>[number];

function ReminderIssueActions({
  row,
  studentId,
  refresh,
}: {
  row: ReminderIssue;
  studentId: string;
  refresh: () => Promise<unknown>;
}) {
  const id = useId();
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await reminderCommand(studentId, action, {
        targetId: row.id,
        reason,
        deliveryId: row.delivery?.id ?? null,
      });
      setReason("");
      setAction("");
      await refresh();
    } catch (error) {
      setMessage(detail(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="header-actions">
        <button
          type="button"
          onClick={() => setAction(row.paused ? "resume" : "pause")}
        >
          {row.paused ? "Resume reminders" : "Pause reminders"}
        </button>
        {(row.delivery?.status === "failed" ||
          row.delivery?.status === "uncertain") && (
          <button type="button" onClick={() => setAction("dismiss_delivery")}>
            Dismiss delivery issue
          </button>
        )}
      </div>
      {action && (
        <form className="workflow-form" onSubmit={(event) => void apply(event)}>
          <label htmlFor={id}>
            Reason
            <input
              id={id}
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button type="button" onClick={() => setAction("")}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            Confirm {action === "dismiss_delivery" ? "dismissal" : action}
          </button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
    </>
  );
}

export function CreditReminderAttention({
  studentId,
  timezone,
  search,
  household,
  onNavigate,
}: {
  studentId: string;
  timezone: string;
  search: string;
  household: string;
  onNavigate: () => void;
}) {
  const identity = usePrivateIdentity();
  const [filter, setFilter] = useState("");
  const query = useQuery({
    queryKey: ["credit-reminder-attention", identity, studentId],
    enabled: !!identity,
    retry: false,
    queryFn: async ({ signal }) =>
      reminderAttentionSchema.parse(
        await reminderCommand(studentId, "attention", {}, signal),
      ),
  });
  const rows = query.data?.filter(
    (row) =>
      (!household || row.householdId === household) &&
      row.studentName.toLowerCase().includes(search.trim().toLowerCase()) &&
      (!filter ||
        (filter === "delivery" && !!row.delivery) ||
        (filter === "paused" && row.paused) ||
        filter === row.status),
  );
  return (
    <section aria-label="Credit reminder monitoring">
      <select
        aria-label="Reminder status"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="">All reminder statuses</option>
        <option value="open">Unresolved</option>
        <option value="blocked">Suppressed for review</option>
        <option value="delivery">Delivery problems</option>
        <option value="paused">Paused</option>
      </select>
      {query.isPending && <p role="status">Checking reminders…</p>}
      {query.isError && <p role="alert">{detail(query.error)}</p>}
      {rows?.length === 0 && <p>No matching reminder issues.</p>}
      {rows?.map((row) => (
        <article key={row.id}>
          <h3>{row.studentName}</h3>
          <p>
            {reminderLabels[row.kind]} ·{" "}
            {row.lessonName ?? row.packageName ?? "Lesson credits"}
          </p>
          <p>
            {row.paused
              ? "Paused"
              : (reasons[row.reason] ??
                (row.status === "resolved" ? "Resolved" : "Unresolved"))}
          </p>
          {row.delivery && (
            <p>
              {row.delivery.status === "uncertain"
                ? "Email outcome unknown. Check delivery before dismissal."
                : row.delivery.status === "failed"
                  ? "Email was not sent. Safe retries use the same delivery record."
                  : "Email delivery was suppressed."}
            </p>
          )}
          {row.nextDueAt && !row.paused && (
            <p>Next eligible {formatStudioDateTime(row.nextDueAt, timezone)}</p>
          )}
          <Link
            to={
              row.lessonId
                ? "/coach/records/lesson/" +
                  row.lessonId +
                  "?student=" +
                  row.studentId
                : row.householdId && row.packageId
                  ? "/coach/finance?creditHousehold=" +
                    row.householdId +
                    "&creditPool=" +
                    row.packageId
                  : "/coach/students/" + row.studentId + "/payments"
            }
            onClick={onNavigate}
          >
            {row.lessonId ? "Open lesson" : "Open credit account"}
          </Link>
          <details>
            <summary>Delivery history</summary>
            {row.history.length === 0 && <p>No deliveries recorded.</p>}
            <ul>
              {row.history.map((item, index) => (
                <li key={index}>
                  {item.channel === "portal" ? "Portal" : "Email"} ·{" "}
                  {item.status} · {formatStudioDateTime(item.at, timezone)}
                </li>
              ))}
            </ul>
          </details>
          <ReminderIssueActions
            row={row}
            studentId={studentId}
            refresh={query.refetch}
          />
        </article>
      ))}
    </section>
  );
}
