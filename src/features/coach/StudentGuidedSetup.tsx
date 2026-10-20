import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Drawer, Status } from "../../components/Primitives";
import { WritingArea } from "../../components/WritingArea";
import { useUnsavedWorkspaceChanges } from "../../hooks/useWorkspaceLocation";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import {
  loadSetupContext,
  setupCommand,
  type SetupContext,
} from "../../data/studentSetup";
import {
  setupActionLabel,
  type SetupAction,
  type StudentSetupState,
} from "../../domain/studentSetup";
import { zonedDateTimeToUtc } from "../../domain/booking";
import { formatStudioDateTime } from "../../domain/presentation";
import { formatMoney } from "../../domain/finance";
import type { Student, StudioSnapshot } from "../../domain/model";
import "./StudentGuidedSetup.css";

const steps = [
  "Student",
  "Household",
  "Scheduling",
  "Billing",
  "Access",
  "Review",
];
const emptyContact = {
  fullName: "",
  email: "",
  relationshipType: "guardian" as const,
  isPrimaryPayer: false,
  isPrimarySchedulingContact: false,
  canViewWork: false,
  canViewSchedule: false,
  canViewFinance: false,
  canManageLessons: false,
  canManageProfile: false,
  canReceiveNotifications: false,
  portalEnabled: false,
};
const utc = (value: string, timezone: string) => {
  const [date, time] = value.split("T"),
    [year, month, day] = date.split("-").map(Number),
    [hour, minute] = time.split(":").map(Number);
  const d = zonedDateTimeToUtc({ year, month, day, hour, minute }, timezone);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(d)
    .replace(" ", "T");
  if (parts !== value)
    throw new Error(
      "That local time does not exist because of daylight saving. Choose another time.",
    );
  return d.toISOString();
};
function describe(a: SetupAction, context?: SetupContext) {
  switch (a.kind) {
    case "details":
      return `${a.payload.fullName} · ${a.payload.focusArea || "Focus not set"}`;
    case "contact":
      return `${a.payload.fullName} · ${a.payload.email} · ${a.payload.portalEnabled ? "access enabled" : "no portal access"}`;
    case "lesson":
      return `${a.payload.topic} · ${formatStudioDateTime(a.payload.startsAt, a.payload.timezone)} · ${a.payload.recurrence === "none" ? "one lesson" : a.payload.occurrenceCount + " " + a.payload.recurrence + " lessons"}`;
    case "package":
      return `${context?.definitions.find((d) => d.id === a.payload.definitionId)?.name || "Package"}${a.payload.expectedPriceMinor !== undefined ? " · " + formatMoney(a.payload.expectedPriceMinor, a.payload.expectedCurrency) : ""} · existing assignment policy; no payment charged`;
    case "access":
      return a.payload.portalEnabled
        ? "Enable existing student access"
        : "Disable student access";
    case "invitation":
      return `Invite ${a.payload.accountType} · ${a.payload.expectedRecipient || "recipient will be verified at review"}`;
  }
}

export function StudentGuidedSetup({
  student,
  data,
  isDemo,
  onClose,
}: {
  student: Student;
  data: StudioSnapshot;
  isDemo: boolean;
  onClose: () => void;
}) {
  const identity = usePrivateIdentity(),
    queryClient = useQueryClient(),
    [state, setState] = useState<StudentSetupState>({
      version: 0,
      draft: { step: 0, actions: [] },
      results: {},
    }),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [approved, setApproved] = useState(false),
    [search, setSearch] = useState("");
  const [details, setDetails] = useState({
    fullName: student.fullName,
    focusArea: student.focusArea || "",
    goals: student.goals || "",
    isMinor: student.isMinor,
    email: student.email || "",
    phone: student.phone || "",
  });
  const [contact, setContact] =
      useState<Extract<SetupAction, { kind: "contact" }>["payload"]>(
        emptyContact,
      ),
    [lesson, setLesson] = useState({
      topic: "Private coaching",
      start: "",
      end: "",
      recurrence: "none" as "none" | "weekly" | "biweekly",
      occurrenceCount: 6,
      locationType: "in_person" as "in_person" | "virtual",
      locationLabel: "",
    }),
    [definition, setDefinition] = useState(""),
    [accountType, setAccountType] = useState<"student" | "guardian">("student"),
    [linkedContactId, setLinkedContactId] = useState(""),
    [consent, setConsent] = useState(false);
  const loaded = useQuery({
    queryKey: ["student-setup", identity, student.id],
    queryFn: () => setupCommand(student.id, "read"),
    enabled: !isDemo && !!identity,
    staleTime: 0,
  });
  const context = useQuery({
    queryKey: ["student-setup-context", identity, student.id, search],
    queryFn: () => loadSetupContext(student.id, search),
    enabled: !isDemo && !!identity,
  });
  const initialized = useRef(false);
  useEffect(() => {
    if (loaded.data && !initialized.current) {
      initialized.current = true;
      setState(loaded.data);
      const d = loaded.data.draft.actions?.find((a) => a.kind === "details");
      if (d?.kind === "details")
        setDetails({
          ...d.payload,
          email: d.payload.email || "",
          phone: d.payload.phone || "",
        });
    }
  }, [loaded.data]);
  const confirmDiscard = useUnsavedWorkspaceChanges(dirty),
    actions = state.draft.actions || [],
    step = state.draft.step || 0;
  const change = (next: SetupAction[]) => {
    setState((s) => ({
      ...s,
      draft: { ...s.draft, actions: next },
      review: null,
    }));
    setDirty(true);
    setApproved(false);
    setNotice("");
  };
  const add = (action: SetupAction) => change([...actions, action]);
  const save = async () => {
    if (isDemo)
      throw new Error(
        "Guided execution requires a connected studio. Demo is a preview only.",
      );
    const result = await setupCommand(
      student.id,
      "save",
      { step, actions },
      state.version,
    );
    setState(result);
    setDirty(false);
    return result;
  };
  const run = async (kind: "save" | "review" | "execute") => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (kind === "save") {
        await save();
        setNotice(
          "Setup draft saved. No scheduling, access or messages were created.",
        );
      } else if (kind === "review") {
        const s = dirty || !state.version ? await save() : state;
        setState(await setupCommand(student.id, "review", {}, s.version));
        setApproved(false);
      } else {
        if (!approved || !state.review)
          throw new Error("Review and approve the proposed actions first.");
        for (const a of state.review.actions) {
          if (state.results[a.id]?.status === "succeeded") continue;
          try {
            await setupCommand(
              student.id,
              "execute_action",
              { reviewId: state.review.id, actionId: a.id },
              state.version,
              `${state.review.id}:${a.id}`,
            );
          } catch (e) {
            setNotice(
              e instanceof Error ? e.message : "An action needs attention.",
            );
            break;
          } finally {
            setState(await setupCommand(student.id, "read"));
          }
        }
        await invalidateStudioDomains(queryClient, [
          "students",
          "households",
          "lessons",
          "finance",
          "booking",
          "identity",
        ]);
        setNotice(
          (n) => n || "Approved actions processed. Review each result below.",
        );
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Setup could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const updateDetails = (patch: Partial<typeof details>) => {
    const next = { ...details, ...patch };
    setDetails(next);
    const old = actions.find((a) => a.kind === "details");
    change([
      ...actions.filter((a) => a.kind !== "details"),
      { id: old?.id || crypto.randomUUID(), kind: "details", payload: next },
    ]);
  };
  const current = context.data,
    ready = isDemo || loaded.isSuccess;
  return (
    <Drawer
      title={`Set up ${student.preferredName || student.fullName}`}
      onClose={() => {
        if (!busy && confirmDiscard()) onClose();
      }}
    >
      <nav className="setup-steps" aria-label="Student setup steps">
        {steps.map((name, i) => (
          <button
            key={name}
            aria-current={step === i ? "step" : undefined}
            disabled={busy}
            onClick={() => {
              setState((s) => ({ ...s, draft: { ...s.draft, step: i } }));
              setDirty(true);
            }}
          >
            {i + 1}. {name}
          </button>
        ))}
      </nav>
      {!ready ? (
        <p role="status">
          {loaded.isError ? "Setup unavailable." : "Loading saved setup…"}
          {loaded.isError && (
            <button onClick={() => void loaded.refetch()}>Retry</button>
          )}
        </p>
      ) : (
        <>
          <div className="setup-existing">
            <small>Already in place</small>
            <strong>
              {current?.contacts.filter((c) => c.student_id === student.id)
                .length || 0}{" "}
              contacts · {current?.lessons.length || 0} upcoming lessons ·{" "}
              {current?.packages.length || 0} packages
            </strong>
          </div>
          {isDemo && (
            <p className="portal-notice">
              Preview only. Connect a studio to save and execute setup.
            </p>
          )}
          <div className="workflow-form setup-content">
            {step === 0 && (
              <>
                <label className="full">
                  Name
                  <input
                    value={details.fullName}
                    onChange={(e) =>
                      updateDetails({ fullName: e.target.value })
                    }
                  />
                </label>
                <label className="full">
                  Coaching focus
                  <input
                    value={details.focusArea}
                    onChange={(e) =>
                      updateDetails({ focusArea: e.target.value })
                    }
                  />
                </label>
                <label>
                  Email (optional)
                  <input
                    type="email"
                    value={details.email}
                    onChange={(e) => updateDetails({ email: e.target.value })}
                  />
                </label>
                <label>
                  Phone (optional)
                  <input
                    type="tel"
                    value={details.phone}
                    onChange={(e) => updateDetails({ phone: e.target.value })}
                  />
                </label>
                <label className="full">
                  Goals
                  <WritingArea
                    value={details.goals}
                    onChange={(e) => updateDetails({ goals: e.target.value })}
                  />
                </label>
                <label className="check-row full">
                  <input
                    type="checkbox"
                    checked={details.isMinor}
                    onChange={(e) =>
                      updateDetails({ isMinor: e.target.checked })
                    }
                  />
                  Student is under 18
                </label>
              </>
            )}
            {step === 1 && (
              <>
                <label className="full">
                  Find an existing studio contact
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name or email"
                  />
                </label>
                {search.length >= 2 &&
                  current?.contacts
                    .filter((c) => c.student_id !== student.id)
                    .map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        className="setup-contact-choice full"
                        onClick={() =>
                          setContact({
                            ...emptyContact,
                            sourceContactId: c.id,
                            sourceVersion: c.version,
                            fullName: c.full_name,
                            email: c.email,
                          })
                        }
                      >
                        {c.full_name}
                        <small>{c.email}</small>
                      </button>
                    ))}
                <label>
                  Name
                  <input
                    value={contact.fullName}
                    onChange={(e) =>
                      setContact({
                        ...contact,
                        sourceContactId: undefined,
                        fullName: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={contact.email}
                    onChange={(e) =>
                      setContact({
                        ...contact,
                        sourceContactId: undefined,
                        email: e.target.value,
                      })
                    }
                  />
                </label>
                <label className="full">
                  Relationship
                  <select
                    value={contact.relationshipType}
                    onChange={(e) =>
                      setContact({
                        ...contact,
                        relationshipType: e.target
                          .value as typeof contact.relationshipType,
                      })
                    }
                  >
                    <option value="guardian">Guardian</option>
                    <option value="support_person">Support person</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <fieldset className="full">
                  <legend>Responsibilities</legend>
                  {(
                    ["isPrimaryPayer", "isPrimarySchedulingContact"] as const
                  ).map((key, i) => (
                    <label className="check-row" key={key}>
                      <input
                        type="checkbox"
                        checked={contact[key]}
                        onChange={(e) =>
                          setContact({ ...contact, [key]: e.target.checked })
                        }
                      />
                      {["Primary payer", "Primary scheduling contact"][i]}
                    </label>
                  ))}
                </fieldset>
                <details className="full">
                  <summary>Review portal permissions</summary>
                  {(
                    [
                      "canViewWork",
                      "canViewSchedule",
                      "canViewFinance",
                      "canManageLessons",
                      "canManageProfile",
                      "canReceiveNotifications",
                      "portalEnabled",
                    ] as const
                  ).map((key, i) => (
                    <label className="check-row" key={key}>
                      <input
                        type="checkbox"
                        checked={contact[key]}
                        onChange={(e) =>
                          setContact({ ...contact, [key]: e.target.checked })
                        }
                      />
                      {
                        [
                          "View work",
                          "View schedule",
                          "View finance",
                          "Manage lessons",
                          "Manage profile",
                          "Receive notifications",
                          "Enable portal access",
                        ][i]
                      }
                    </label>
                  ))}
                </details>
                <button
                  className="button-link full"
                  disabled={!contact.fullName || !contact.email.includes("@")}
                  onClick={() => {
                    add({
                      id: crypto.randomUUID(),
                      kind: "contact",
                      payload: contact,
                    });
                    setContact(emptyContact);
                  }}
                >
                  <Plus />
                  Add contact to review
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <label className="full">
                  Lesson focus
                  <input
                    value={lesson.topic}
                    onChange={(e) =>
                      setLesson({ ...lesson, topic: e.target.value })
                    }
                  />
                </label>
                <label>
                  Start ({data.settings.timezone})
                  <input
                    type="datetime-local"
                    value={lesson.start}
                    onChange={(e) =>
                      setLesson({ ...lesson, start: e.target.value })
                    }
                  />
                </label>
                <label>
                  End ({data.settings.timezone})
                  <input
                    type="datetime-local"
                    value={lesson.end}
                    onChange={(e) =>
                      setLesson({ ...lesson, end: e.target.value })
                    }
                  />
                </label>
                <label>
                  Repeat
                  <select
                    value={lesson.recurrence}
                    onChange={(e) =>
                      setLesson({
                        ...lesson,
                        recurrence: e.target.value as typeof lesson.recurrence,
                      })
                    }
                  >
                    <option value="none">Once</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every other week</option>
                  </select>
                </label>
                {lesson.recurrence !== "none" && (
                  <label>
                    Total lessons
                    <input
                      type="number"
                      min={2}
                      max={52}
                      value={lesson.occurrenceCount}
                      onChange={(e) =>
                        setLesson({
                          ...lesson,
                          occurrenceCount: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                )}
                <label>
                  Location
                  <select
                    value={lesson.locationType}
                    onChange={(e) =>
                      setLesson({
                        ...lesson,
                        locationType: e.target
                          .value as typeof lesson.locationType,
                      })
                    }
                  >
                    <option value="in_person">In person</option>
                    <option value="virtual">Google Meet</option>
                  </select>
                </label>
                <label>
                  Location details
                  <input
                    value={lesson.locationLabel}
                    onChange={(e) =>
                      setLesson({ ...lesson, locationLabel: e.target.value })
                    }
                  />
                </label>
                <button
                  className="button-link full"
                  disabled={!lesson.start || !lesson.end}
                  onClick={() => {
                    try {
                      add({
                        id: crypto.randomUUID(),
                        kind: "lesson",
                        payload: {
                          topic: lesson.topic,
                          startsAt: utc(lesson.start, data.settings.timezone),
                          endsAt: utc(lesson.end, data.settings.timezone),
                          recurrence: lesson.recurrence,
                          occurrenceCount:
                            lesson.recurrence === "none"
                              ? 1
                              : lesson.occurrenceCount,
                          timezone: data.settings.timezone,
                          locationType: lesson.locationType,
                          locationLabel: lesson.locationLabel,
                        },
                      });
                    } catch (e) {
                      setNotice(
                        e instanceof Error ? e.message : "Check lesson times",
                      );
                    }
                  }}
                >
                  <Plus />
                  Add proposed lesson
                </button>
              </>
            )}
            {step === 3 && (
              <>
                <p className="full">
                  Existing packages stay unchanged. A new assignment follows the
                  current credit policy and does not charge a card.
                </p>
                {current?.packages.map((p) => (
                  <div className="setup-existing full" key={p.id}>
                    {p.name} · {p.expires_at ? `Expires ${formatStudioDateTime(p.expires_at, data.settings.timezone)}` : "No expiry"}
                  </div>
                ))}
                <label className="full">
                  Package
                  <select
                    value={definition}
                    onChange={(e) => setDefinition(e.target.value)}
                  >
                    <option value="">No new package</option>
                    {current?.definitions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · {d.session_count} credits
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="full"
                  disabled={!definition}
                  onClick={() => {
                    add({
                      id: crypto.randomUUID(),
                      kind: "package",
                      payload: { definitionId: definition },
                    });
                    setDefinition("");
                  }}
                >
                  <Plus />
                  Add package to review
                </button>
                <p className="full">
                  Payer and scheduling responsibilities are set in Household.
                  Pricing changes remain in the student’s Payments
                  administration.
                </p>
              </>
            )}
            {step === 4 && (
              <>
                <div className="setup-existing full">
                  Student portal:{" "}
                  {student.portalEnabled
                    ? "enabled"
                    : current?.hasStudentAccount
                      ? "account exists, access disabled"
                      : "not provisioned"}
                </div>
                <label>
                  Invitation for
                  <select
                    value={accountType}
                    onChange={(e) =>
                      setAccountType(e.target.value as typeof accountType)
                    }
                  >
                    <option value="student">Student</option>
                    <option value="guardian">Guardian</option>
                  </select>
                </label>
                {accountType === "guardian" && (
                  <label>
                    Household recipient
                    <select
                      value={linkedContactId}
                      onChange={(e) => setLinkedContactId(e.target.value)}
                    >
                      <option value="">Student’s recorded guardian</option>
                      {current?.contacts
                        .filter((c) => c.student_id === student.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.full_name} · {c.email}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label className="check-row full">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  Guardian consent and the intended access/recipient have been
                  reviewed
                </label>
                <button
                  className="full"
                  disabled={details.isMinor && !consent}
                  onClick={() =>
                    add({
                      id: crypto.randomUUID(),
                      kind: "invitation",
                      payload: {
                        accountType,
                        ...(linkedContactId ? { linkedContactId } : {}),
                        consentConfirmed: consent,
                      },
                    })
                  }
                >
                  <Plus />
                  Add invitation to review
                </button>
                {current?.hasStudentAccount && (
                  <button
                    className="full"
                    disabled={details.isMinor && !consent}
                    onClick={() =>
                      add({
                        id: crypto.randomUUID(),
                        kind: "access",
                        payload: {
                          portalEnabled: !student.portalEnabled,
                          consentConfirmed: consent,
                        },
                      })
                    }
                  >
                    {student.portalEnabled ? "Disable" : "Enable"} existing
                    student access at approval
                  </button>
                )}
              </>
            )}
            {step === 5 && (
              <div className="full">
                <h3>Review setup</h3>
                <p>
                  {actions.length} proposed actions. Nothing executes until you
                  approve this review.
                </p>
                {(state.review?.actions || actions).map((a) => (
                  <article className="setup-review-row" key={a.id}>
                    <div>
                      <strong>{setupActionLabel(a)}</strong>
                      <p>{describe(a, current)}</p>
                      {state.results[a.id] && (
                        <>
                          <Status
                            tone={
                              state.results[a.id].status === "succeeded"
                                ? "good"
                                : "warn"
                            }
                          >
                            {state.results[a.id].status.replaceAll("_", " ")}
                          </Status>
                          <small>{state.results[a.id].message}</small>
                        </>
                      )}
                    </div>
                    {!state.review &&
                      state.results[a.id]?.status !== "succeeded" && (
                        <button
                          aria-label={`Remove ${setupActionLabel(a)}`}
                          onClick={() =>
                            change(actions.filter((x) => x.id !== a.id))
                          }
                        >
                          <Trash2 />
                        </button>
                      )}
                  </article>
                ))}
                {state.review && (
                  <>
                    <p>
                      Review expires{" "}
                      {formatStudioDateTime(
                        state.review.expiresAt,
                        data.settings.timezone,
                      )}
                      .
                    </p>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={approved}
                        onChange={(e) => setApproved(e.target.checked)}
                        disabled={busy}
                      />
                      I approve these actions, access grants and invitation
                      recipients.
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
          {notice && (
            <p className="portal-notice" role="status">
              {notice}
            </p>
          )}
          <footer className="form-actions">
            <button disabled={busy || isDemo} onClick={() => void run("save")}>
              {busy ? "Working…" : "Save setup draft"}
            </button>
            {step < 5 ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    draft: { ...s.draft, step: step + 1 },
                  }));
                  setDirty(true);
                }}
              >
                Continue <ChevronRight />
              </button>
            ) : state.review && !dirty ? (
              <button
                className="primary"
                disabled={busy || !approved || isDemo}
                onClick={() => void run("execute")}
              >
                <Check />
                Execute approved actions
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || !actions.length || isDemo}
                onClick={() => void run("review")}
              >
                Prepare final review
              </button>
            )}
          </footer>
        </>
      )}
    </Drawer>
  );
}
