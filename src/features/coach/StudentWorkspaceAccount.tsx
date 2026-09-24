import { useQueryClient } from "@tanstack/react-query";
import { Mail, MessageSquare, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  Dialog,
  EmptyState,
  Section,
  Status,
  Toggle,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { uploadStudioFile } from "../../data/uploads";
import { formatMoney } from "../../domain/finance";
import type { Student } from "../../domain/model";
import { formatStudioDateTime } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import {
  now,
  portalInvitationDelivery,
  uid,
  type Data,
} from "./StudentWorkspace.shared";

function PortalInvite({
  accountType,
  label,
  email,
  username,
  busy,
  onInvite,
}: {
  accountType: "student" | "guardian";
  label: string;
  email?: string;
  username?: string;
  busy: boolean;
  onInvite: (
    accountType: "student" | "guardian",
    linkedContactId?: string,
  ) => Promise<void>;
}) {
  return (
    <div className="credential-form">
      <div>
        <strong>{label}</strong>
        <small>
          {email || `Add a ${accountType} email in Edit details first.`}{" "}
          {username ? `Current username: ${username}. ` : ""}
          Sending an invite generates the username and one-time password
          automatically. The recipient creates a private password at first
          sign-in.
        </small>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !email}
          onClick={() => void onInvite(accountType)}
        >
          {busy
            ? "Sending…"
            : username
              ? `Send new ${accountType} invite`
              : `Send ${accountType} invite`}
        </button>
      </div>
    </div>
  );
}

const notificationLabels = {
  lessonReminders: "Lesson reminders",
  scheduleChanges: "Reschedules and cancellations",
  lessonContent: "Notes and lesson materials",
  assignments: "Assignments and practice",
  packageBalance: "Package balance and expiration",
  payments: "Payments and receipts",
  accountAccess: "Account access",
} as const;

function LinkedContacts({
  data,
  student,
  busy,
  onInvite,
  isDemo,
}: {
  data: Data;
  student: Student;
  busy: boolean;
  isDemo: boolean;
  onInvite: (
    accountType: "student" | "guardian",
    linkedContactId?: string,
  ) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const store = useStudioStore();
  const [editing, setEditing] = useState<Data["linkedContacts"][number]>();
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const contacts = data.linkedContacts.filter(
    (contact) => contact.studentId === student.id,
  );
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const preferences = Object.fromEntries(
      Object.keys(notificationLabels).map((key) => [
        key,
        values.get(`notify-${key}`) === "on",
      ]),
    );
    setNotice("Saving linked contact…");
    try {
      const payload = {
        contactId: editing?.id,
        fullName: String(values.get("fullName") || ""),
        email: String(values.get("email") || "").toLowerCase(),
        relationshipType: values.get("relationshipType"),
        relationshipLabel: values.get("relationshipLabel"),
        canViewSchedule: values.get("canViewSchedule") === "on",
        canManageLessons: values.get("canManageLessons") === "on",
        canViewWork: values.get("canViewWork") === "on",
        canManageProfile: values.get("canManageProfile") === "on",
        canViewFinance: values.get("canViewFinance") === "on",
        canReceiveNotifications: values.get("canReceiveNotifications") === "on",
        notificationPreferences: preferences,
        portalEnabled: values.get("portalEnabled") === "on",
      };
      if (isDemo)
        store.transact((draft) => {
          const match = draft.linkedContacts.find(
            (item) =>
              item.id === editing?.id ||
              (item.studentId === student.id &&
                item.email.toLowerCase() === payload.email),
          );
          const mapped = {
            fullName: payload.fullName,
            email: payload.email,
            relationshipType: payload.relationshipType as
              "guardian" | "support_person" | "other",
            relationshipLabel: String(payload.relationshipLabel || ""),
            canViewSchedule: payload.canViewSchedule,
            canManageLessons: payload.canManageLessons,
            canViewWork: payload.canViewWork,
            canManageProfile: payload.canManageProfile,
            canViewFinance: payload.canViewFinance,
            canReceiveNotifications: payload.canReceiveNotifications,
            notificationPreferences:
              preferences as unknown as Data["linkedContacts"][number]["notificationPreferences"],
            portalEnabled: payload.portalEnabled,
            updatedAt: now(),
          };
          if (match)
            Object.assign(match, mapped, { version: match.version + 1 });
          else
            draft.linkedContacts.push({
              id: uid("contact"),
              studioId: draft.studioId,
              studentId: student.id,
              userId: undefined,
              ...mapped,
              version: 1,
            });
        });
      else
        await studioCommand("students", {
          command: "save_linked_contact",
          entityId: student.id,
          expectedVersion: editing?.version || 0,
          payload,
          reason: "Coach configured linked household access",
        });
      if (!isDemo)
        await invalidateStudioDomains(queryClient, ["students", "households"]);
      setAdding(false);
      setEditing(undefined);
      setNotice("Linked contact saved.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Linked contact could not be saved.",
      );
    }
  };
  const disable = async (contact: Data["linkedContacts"][number]) => {
    setNotice("Removing access…");
    try {
      if (isDemo)
        store.transact((draft) => {
          const match = draft.linkedContacts.find(
            (item) => item.id === contact.id,
          );
          if (match)
            Object.assign(match, {
              portalEnabled: false,
              canReceiveNotifications: false,
              version: match.version + 1,
              updatedAt: now(),
            });
        });
      else {
        await studioCommand("students", {
          command: "remove_linked_contact",
          entityId: student.id,
          expectedVersion: contact.version,
          payload: { contactId: contact.id },
          reason: "Coach removed linked household access",
        });
        await invalidateStudioDomains(queryClient, ["students", "households"]);
      }
      setNotice(
        "Linked contact access and optional notifications were disabled.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Access could not be removed.",
      );
    }
  };
  const invitation = (contact: Data["linkedContacts"][number]) =>
    portalInvitationDelivery(data, student.id, contact.email);
  return (
    <Section
      title="Household access"
      marked
      aside={
        <button
          type="button"
          onClick={() => {
            setEditing(undefined);
            setAdding(true);
          }}
        >
          Add contact
        </button>
      }
    >
      <p className="section-intro">
        Add guardians for minors or support people for students of any age. Each
        person gets only the schedule, work, profile, payment, and notification
        access you choose.
      </p>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <div className="table-list">
        {contacts.map((contact) => {
          const delivery = invitation(contact);
          return (
            <article
              key={contact.id}
              className={!contact.portalEnabled ? "disabled-row" : ""}
            >
              <UserRound />
              <div>
                <strong>{contact.fullName}</strong>
                <small>
                  {contact.relationshipLabel ||
                    contact.relationshipType.replaceAll("_", " ")}{" "}
                  · {contact.email}
                </small>
              </div>
              <Status
                tone={
                  !contact.portalEnabled
                    ? "neutral"
                    : delivery?.status === "failed"
                      ? "danger"
                      : delivery?.status === "sent"
                        ? "good"
                        : "warn"
                }
              >
                {!contact.portalEnabled
                  ? "Access off"
                  : delivery?.status === "failed"
                    ? "Needs retry"
                    : delivery?.status === "sent"
                      ? "Sent"
                      : delivery
                        ? "Sending"
                        : "Not invited"}
              </Status>
              <Link
                className="button-link"
                to={`/coach/students/${student.id}/contacts/${contact.id}`}
              >
                Open profile
              </Link>
              <button onClick={() => setEditing(contact)}>
                {contact.portalEnabled ? "Edit access" : "Restore access"}
              </button>
              {contact.portalEnabled && (
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void onInvite("guardian", contact.id)}
                >
                  {delivery?.status === "failed"
                    ? "Retry invite"
                    : "Send invite"}
                </button>
              )}
              {contact.portalEnabled && (
                <button
                  className="danger-button"
                  onClick={() => void disable(contact)}
                >
                  Remove
                </button>
              )}
            </article>
          );
        })}
      </div>
      {!contacts.length && !adding && (
        <EmptyState
          title="No linked contacts"
          detail="Adult students can have support people too; access is never limited to minor guardians."
        />
      )}
      {(adding || editing) && (
        <Dialog
          title={editing ? `Edit ${editing.fullName}` : "Add linked contact"}
          description="Access and optional email preferences can be changed at any time."
          onClose={() => {
            setAdding(false);
            setEditing(undefined);
          }}
        >
          <form className="workflow-form" onSubmit={save}>
            <label>
              Name
              <input
                name="fullName"
                required
                defaultValue={editing?.fullName}
              />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                required
                defaultValue={editing?.email}
              />
            </label>
            <label>
              Relationship
              <select
                name="relationshipType"
                defaultValue={
                  editing?.relationshipType ||
                  (student.isMinor ? "guardian" : "support_person")
                }
              >
                <option value="guardian">Guardian</option>
                <option value="support_person">Support person</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Custom relationship label
              <input
                name="relationshipLabel"
                defaultValue={editing?.relationshipLabel}
                placeholder="Parent, manager, spouse…"
              />
            </label>
            <label className="check-row full">
              <input
                name="portalEnabled"
                type="checkbox"
                defaultChecked={editing?.portalEnabled ?? true}
              />
              Allow this person to use the portal
            </label>
            <fieldset className="full option-fieldset">
              <legend>Portal permissions</legend>
              {[
                ["canViewSchedule", "View schedule", true],
                ["canManageLessons", "Manage or reschedule lessons", false],
                ["canViewWork", "View work and notes", true],
                ["canManageProfile", "Manage profile", false],
                ["canViewFinance", "View payments", student.isMinor],
              ].map(([name, label, fallback]) => (
                <label className="check-row" key={String(name)}>
                  <input
                    name={String(name)}
                    type="checkbox"
                    defaultChecked={
                      editing
                        ? Boolean(editing[name as keyof typeof editing])
                        : Boolean(fallback)
                    }
                  />
                  {String(label)}
                </label>
              ))}
            </fieldset>
            <fieldset className="full option-fieldset">
              <legend>Notifications</legend>
              <label className="check-row">
                <input
                  name="canReceiveNotifications"
                  type="checkbox"
                  defaultChecked={editing?.canReceiveNotifications ?? true}
                />
                Receive optional notifications
              </label>
              {Object.entries(notificationLabels).map(([key, label]) => (
                <label className="check-row" key={key}>
                  <input
                    name={`notify-${key}`}
                    type="checkbox"
                    defaultChecked={
                      editing?.notificationPreferences?.[
                        key as keyof typeof editing.notificationPreferences
                      ] ??
                      ((key !== "payments" && key !== "packageBalance") ||
                        student.isMinor)
                    }
                  />
                  {label}
                  {["accountAccess", "scheduleChanges", "payments"].includes(
                    key,
                  ) && (
                    <small>
                      Critical messages cannot be disabled when applicable.
                    </small>
                  )}
                </label>
              ))}
            </fieldset>
            <div className="form-actions full">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setEditing(undefined);
                }}
              >
                Cancel
              </button>
              <button className="primary">Save contact</button>
            </div>
          </form>
        </Dialog>
      )}
    </Section>
  );
}

export function HouseholdContactProfile({
  data,
  student,
  busy,
  onInvite,
}: {
  data: Data;
  student: Student;
  busy: boolean;
  onInvite: (
    accountType: "student" | "guardian",
    linkedContactId?: string,
  ) => Promise<void>;
}) {
  const { contactId = "" } = useParams();
  const contact = data.linkedContacts.find(
    (item) => item.id === contactId && item.studentId === student.id,
  );
  if (!contact)
    return <Navigate to={`/coach/students/${student.id}/account`} replace />;
  const access = [
    ["Schedule", contact.canViewSchedule],
    ["Manage lessons", contact.canManageLessons],
    ["Work and notes", contact.canViewWork],
    ["Manage profile", contact.canManageProfile],
    ["Payments", contact.canViewFinance],
  ] as const;
  const delivery = portalInvitationDelivery(data, student.id, contact.email);
  return (
    <div className="two-section-grid household-profile">
      <Section title={contact.fullName} marked>
        <p className="section-intro">
          {contact.relationshipLabel ||
            contact.relationshipType.replaceAll("_", " ")}{" "}
          for {student.preferredName || student.fullName}
        </p>
        <dl className="profile-grid">
          <div>
            <dt>Email</dt>
            <dd>{contact.email}</dd>
          </div>
          <div>
            <dt>Timezone</dt>
            <dd>{contact.timezone || "Uses device timezone"}</dd>
          </div>
          <div>
            <dt>Portal access</dt>
            <dd>{contact.portalEnabled ? "Enabled" : "Disabled"}</dd>
          </div>
          <div>
            <dt>Notifications</dt>
            <dd>
              {contact.canReceiveNotifications
                ? "Enabled"
                : "Optional messages off"}
            </dd>
          </div>
        </dl>
        <div className="form-actions">
          {contact.portalEnabled && (
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void onInvite("guardian", contact.id)}
            >
              {busy
                ? "Sending…"
                : delivery?.status === "failed"
                  ? "Retry portal invite"
                  : delivery?.status === "sent"
                    ? "Send new portal invite"
                    : "Send portal invite"}
            </button>
          )}
          <Link
            className="button-link"
            to={`/coach/inbox?student=${encodeURIComponent(student.id)}`}
          >
            <MessageSquare />
            Message household
          </Link>
          <Link
            className="button-link"
            to={`/coach/inbox?student=${encodeURIComponent(student.id)}&recipient=${encodeURIComponent(contact.email)}&email=1`}
          >
            <Mail />
            Email {contact.fullName.split(" ")[0]}
          </Link>
          <Link
            className="button-link"
            to={`/coach/students/${student.id}/account`}
          >
            Edit access
          </Link>
        </div>
        <p className="section-intro">
          {!contact.portalEnabled
            ? "Turn on portal access before inviting this person."
            : delivery?.status === "sent"
              ? `Last invitation sent ${formatStudioDateTime(delivery.updatedAt, data.settings.timezone)}.`
              : delivery
                ? "The invitation is queued with automatic retry protection."
                : "They can sign in with this Google email now, or you can send a username and temporary-password invitation."}
        </p>
      </Section>
      <Section title="Access & notifications">
        <div className="permission-summary">
          {access.map(([label, enabled]) => (
            <div key={label}>
              <span>{label}</span>
              <Status tone={enabled ? "good" : "neutral"}>
                {enabled ? "Allowed" : "Hidden"}
              </Status>
            </div>
          ))}
        </div>
        <h3>Receives</h3>
        <div className="policy-chips">
          {Object.entries(notificationLabels)
            .filter(
              ([key]) =>
                contact.notificationPreferences?.[
                  key as keyof typeof contact.notificationPreferences
                ],
            )
            .map(([key, label]) => (
              <span key={key}>{label}</span>
            ))}
        </div>
      </Section>
    </div>
  );
}

function SettingToggle({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <Toggle
      checked={checked}
      label={title}
      detail={detail}
      onChange={onChange}
    />
  );
}

export function Account({
  data,
  student,
  isDemo,
  onSave,
  onInvite,
  settingCredentials,
}: {
  data: Data;
  student: Student;
  isDemo: boolean;
  onSave: (updates: Partial<Student>) => Promise<void> | void;
  onInvite: (
    accountType: "student" | "guardian",
    linkedContactId?: string,
  ) => Promise<void>;
  settingCredentials: boolean;
}) {
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const [savingRate, setSavingRate] = useState("");
  const [rateNotice, setRateNotice] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const toggle = (field: "portalEnabled" | "actorPageEligible") =>
    onSave({ [field]: !student[field] });
  const saveRate = async (serviceId: string, form: HTMLFormElement) => {
    const values = new FormData(form),
      service = data.bookingServices.find((item) => item.id === serviceId);
    if (!service) return;
    const priceMinor = Math.round(Number(values.get("price")) * 100),
      depositMinor = Math.round(Number(values.get("deposit") || 0) * 100);
    const locationPriceAdjustments = Object.fromEntries(
      service.locationOptions.map((location) => [
        location,
        Math.round(Number(values.get(`location-${location}`) || 0) * 100),
      ]),
    );
    setSavingRate(serviceId);
    setRateNotice("");
    try {
      if (isDemo)
        store.transact((draft) => {
          const existing = draft.studentPricingRules.find(
            (row) =>
              row.studentId === student.id && row.serviceId === serviceId,
          );
          if (existing)
            Object.assign(existing, {
              priceMinor,
              depositMinor,
              locationPriceAdjustments,
              version: existing.version + 1,
              updatedAt: now(),
            });
          else
            draft.studentPricingRules.push({
              id: uid("rate"),
              studioId: draft.studioId,
              studentId: student.id,
              serviceId,
              priceMinor,
              depositMinor,
              locationPriceAdjustments,
              reason: "Student-specific pricing",
              startsAt: now(),
              active: true,
              version: 1,
              updatedAt: now(),
            });
        });
      else {
        await studioCommand("pricing", {
          command: "upsert_student_rate",
          expectedVersion: 0,
          payload: {
            studentId: student.id,
            serviceId,
            priceMinor,
            depositMinor,
            locationPriceAdjustments,
            reason: "Student-specific pricing",
          },
          reason: "Coach saved student-specific pricing",
        });
        await invalidateStudioDomains(queryClient, ["finance"]);
      }
      setRateNotice(`${service.name} pricing saved.`);
    } catch (reason) {
      setRateNotice(
        reason instanceof Error
          ? reason.message
          : "Special pricing could not be saved.",
      );
    } finally {
      setSavingRate("");
    }
  };
  const updateProfilePhoto = async (file?: File) => {
    if (!file || profileBusy) return;
    setProfileBusy(true);
    setRateNotice("Uploading profile photo…");
    try {
      if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024)
        throw new Error("Choose a JPG, PNG, or WebP image smaller than 5 MB.");
      if (isDemo)
        setRateNotice("Profile-photo upload is available in production mode.");
      else {
        const uploaded = await uploadStudioFile({
          studioId: data.studioId,
          studentId: student.id,
          entityType: "student",
          entityId: student.id,
          file,
          visibility: "private",
        });
        await onSave({
          profilePhotoAssetId: uploaded.id,
          profilePhotoPosition: { x: 50, y: 50 },
        });
        setRateNotice("Student profile photo saved.");
      }
    } catch (reason) {
      setRateNotice(
        reason instanceof Error
          ? reason.message
          : "Profile photo could not be saved.",
      );
    } finally {
      setProfileBusy(false);
    }
  };
  return (
    <div className="two-section-grid">
      <Section title="Access & visibility" marked>
        <div className="settings-list">
          <div className="profile-identity-card">
            <span>
              {student.profilePhotoUrl ? (
                <img src={student.profilePhotoUrl} alt="" />
              ) : (
                student.fullName
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
              )}
            </span>
            <div>
              <strong>Portal profile photo</strong>
              <small>
                Private identity photo. Actor-page headshots stay separate.
              </small>
              <label className="button-link">
                {profileBusy ? "Uploading…" : "Upload photo"}
                <input
                  hidden
                  disabled={profileBusy}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) =>
                    void updateProfilePhoto(event.target.files?.[0])
                  }
                />
              </label>
              {student.profilePhotoAssetId && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    void onSave({ profilePhotoAssetId: undefined })
                  }
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>
          <SettingToggle
            title="Student workspace"
            detail="Allow this student or guardian to access shared lessons, practice, and materials."
            checked={student.portalEnabled}
            onChange={() => toggle("portalEnabled")}
          />
          <SettingToggle
            title="Actor page eligible"
            detail="Allow an approved public actor page for this student."
            checked={student.actorPageEligible}
            onChange={() => toggle("actorPageEligible")}
          />
          <PortalInvite
            accountType="student"
            label="Student login"
            email={student.email}
            username={student.portalUsername}
            busy={settingCredentials}
            onInvite={onInvite}
          />
          <SettingToggle
            title="Special pricing"
            detail="Use student-specific prices and delivery add-ons when this student books while signed in."
            checked={Boolean(student.specialPricingEnabled)}
            onChange={() =>
              void onSave({
                specialPricingEnabled: !student.specialPricingEnabled,
              })
            }
          />
        </div>
      </Section>
      <LinkedContacts
        data={data}
        student={student}
        busy={settingCredentials}
        onInvite={onInvite}
        isDemo={isDemo}
      />
      {student.specialPricingEnabled && (
        <Section title="Student-specific pricing" marked>
          <p className="section-intro">
            Only services you customize are overridden. Everything else
            continues to use the public booking price.
          </p>
          {rateNotice && (
            <p className="portal-notice" role="status">
              {rateNotice}
            </p>
          )}
          <div className="special-pricing-list">
            {data.bookingServices.map((service) => {
              const rule = data.studentPricingRules.find(
                (item) =>
                  item.studentId === student.id &&
                  item.serviceId === service.id &&
                  item.active,
              );
              return (
                <details key={service.id}>
                  <summary>
                    <span>
                      <strong>{service.name}</strong>
                      <small>
                        {rule
                          ? `${formatMoney(rule.priceMinor)} custom base price`
                          : `${formatMoney(service.priceMinor)} studio price`}
                      </small>
                    </span>
                    <span>{rule ? "Customized" : "Use studio price"}</span>
                  </summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveRate(service.id, event.currentTarget);
                    }}
                    className="pricing-rule-form"
                  >
                    <label>
                      Base price (USD)
                      <input
                        name="price"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={
                          (rule?.priceMinor ?? service.priceMinor) / 100
                        }
                      />
                    </label>
                    <label>
                      Deposit (USD)
                      <input
                        name="deposit"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={
                          (rule?.depositMinor ?? service.depositMinor) / 100
                        }
                      />
                    </label>
                    {service.locationOptions.map((location) => (
                      <label key={location}>
                        {location.replaceAll("_", " ")} add-on (USD)
                        <input
                          name={`location-${location}`}
                          type="number"
                          step="0.01"
                          defaultValue={
                            Number(
                              rule?.locationPriceAdjustments?.[location] ??
                                service.locationPriceAdjustments[location] ??
                                0,
                            ) / 100
                          }
                        />
                      </label>
                    ))}
                    <button
                      className="primary-button"
                      disabled={Boolean(savingRate)}
                    >
                      {savingRate === service.id
                        ? "Saving…"
                        : `Save ${service.name} pricing`}
                    </button>
                  </form>
                </details>
              );
            })}
          </div>
        </Section>
      )}
      <Section title="Studio details">
        <dl className="detail-list">
          <div>
            <dt>Status</dt>
            <dd>{student.status}</dd>
          </div>
          <div>
            <dt>Default lesson rate</dt>
            <dd>
              {student.defaultRateMinor
                ? formatMoney(student.defaultRateMinor)
                : "Studio default"}
            </dd>
          </div>
          <div>
            <dt>Drive folder</dt>
            <dd>
              {student.driveFolderUrl ? (
                <a
                  href={student.driveFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open folder
                </a>
              ) : (
                "Not connected"
              )}
            </dd>
          </div>
          <div>
            <dt>Tags</dt>
            <dd>{student.tags?.join(", ") || "—"}</dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}
