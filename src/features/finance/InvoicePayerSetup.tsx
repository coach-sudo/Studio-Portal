import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { studioCommand } from "../../data/bookingCommands";
import type { LinkedContact, Student } from "../../domain/model";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

export function InvoicePayerSetup({
  student,
  contacts,
  isDemo,
  label = "Set up payer",
}: {
  student: Student;
  contacts: LinkedContact[];
  isDemo: boolean;
  label?: string;
}) {
  const store = useStudioStore();
  const client = useQueryClient();
  const fields = useId();
  const household = contacts.filter(
    (contact) => contact.studentId === student.id,
  );
  const primary = household.filter((contact) => contact.isPrimaryPayer);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(
    primary[0]?.id ?? (student.isMinor ? (household[0]?.id ?? "new") : "self"),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const contact = household.find((item) => item.id === choice);
  const needsAccess = !contact?.portalEnabled || !contact.canViewFinance;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "")
      .trim()
      .toLowerCase();
    const fullName = String(values.get("name") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      if (choice === "self") {
        if (student.isMinor || primary.length)
          throw new Error("Choose an authorized household payer.");
        if (isDemo) {
          store.transact((draft) => {
            const record = draft.students.find(
              (item) => item.id === student.id,
            );
            if (!record) throw new Error("Student record is unavailable.");
            record.email = email;
            record.version += 1;
          });
        } else {
          await studioCommand("students", {
            command: "update",
            entityId: student.id,
            expectedVersion: student.version,
            payload: { email },
            reason:
              "Coach updated the adult self-payer's email while preparing an invoice",
          });
        }
      } else {
        if (needsAccess && values.get("confirmAccess") !== "on")
          throw new Error("Confirm financial access for this payer.");
        const relationshipType: LinkedContact["relationshipType"] =
          contact?.relationshipType ?? (student.isMinor ? "guardian" : "other");
        const contactDetails = {
          fullName,
          email,
          relationshipType,
          relationshipLabel: contact?.relationshipLabel,
          canViewSchedule: contact?.canViewSchedule ?? false,
          canManageLessons: contact?.canManageLessons ?? false,
          canViewWork: contact?.canViewWork ?? false,
          canManageProfile: contact?.canManageProfile ?? false,
          canViewFinance: true,
          canReceiveNotifications: contact?.canReceiveNotifications ?? false,
          isPrimaryPayer: true,
          isPrimarySchedulingContact:
            contact?.isPrimarySchedulingContact ?? false,
          receivesFinancialEscalations:
            contact?.receivesFinancialEscalations ?? false,
          notificationPreferences: contact?.notificationPreferences ?? {
            lessonReminders: false,
            scheduleChanges: false,
            lessonContent: false,
            assignments: false,
            packageBalance: false,
            payments: false,
            accountAccess: false,
          },
          portalEnabled: true,
        };
        if (isDemo) {
          store.transact((draft) => {
            const existing = draft.linkedContacts.find(
              (item) => item.id === contact?.id,
            );
            const match = draft.linkedContacts.find(
              (item) =>
                item.studentId === student.id &&
                item.id !== contact?.id &&
                (item.isPrimaryPayer || item.email.toLowerCase() === email),
            );
            if (match)
              throw new Error(
                "Review the existing household payer before saving.",
              );
            if (existing)
              Object.assign(existing, contactDetails, {
                version: existing.version + 1,
              });
            else
              draft.linkedContacts.push({
                ...contactDetails,
                id: crypto.randomUUID(),
                studioId: student.studioId,
                studentId: student.id,
                version: 1,
                updatedAt: new Date().toISOString(),
              });
          });
        } else {
          await studioCommand("students", {
            command: "save_linked_contact",
            entityId: student.id,
            expectedVersion: contact?.version ?? 0,
            payload: {
              ...contactDetails,
              contactId: contact?.id,
              billingSetup: true,
            },
            reason:
              "Coach confirmed the designated payer while preparing an invoice",
          });
        }
      }
      if (!isDemo)
        await invalidateStudioDomains(client, ["students", "households"]);
      setOpen(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The payer could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (primary.length > 1)
    return (
      <Link to={`/coach/students/${student.id}/household`}>
        Review duplicate primary payers
      </Link>
    );
  if (!open) return <button onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form
      className="invoice-payer-setup"
      onSubmit={(event) => void save(event)}
    >
      <label className="lesson-invoice-field" htmlFor={`${fields}-payer`}>
        Responsible payer
        <select
          id={`${fields}-payer`}
          value={choice}
          disabled={busy || primary.length === 1}
          onChange={(event) => {
            setChoice(event.target.value);
            setError("");
          }}
        >
          {!student.isMinor && !primary.length && (
            <option value="self">{student.fullName} (self-payer)</option>
          )}
          {(primary.length ? primary : household).map((item) => (
            <option value={item.id} key={item.id}>
              {item.fullName}
            </option>
          ))}
          {!primary.length && (
            <option value="new">Add a household payer</option>
          )}
        </select>
      </label>
      <div key={choice}>
        {choice !== "self" && (
          <label className="lesson-invoice-field" htmlFor={`${fields}-name`}>
            Payer name
            <input
              id={`${fields}-name`}
              name="name"
              defaultValue={contact?.fullName}
              required
              minLength={2}
              disabled={busy}
            />
          </label>
        )}
        <label className="lesson-invoice-field" htmlFor={`${fields}-email`}>
          {choice === "self" ? "Student email" : "Payer email"}
          <input
            id={`${fields}-email`}
            name="email"
            type="email"
            defaultValue={choice === "self" ? student.email : contact?.email}
            required
            disabled={busy}
          />
        </label>
        {choice !== "self" && needsAccess && (
          <label className="invoice-payer-access" htmlFor={`${fields}-access`}>
            <input
              id={`${fields}-access`}
              type="checkbox"
              name="confirmAccess"
              required
              disabled={busy}
            />
            Grant this payer portal access and permission to view billing.
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="header-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save payer"}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)}>
          Cancel setup
        </button>
      </div>
    </form>
  );
}
