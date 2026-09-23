import { useQueryClient } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import "../../components/IdentityActions.css";
import { Section, Toggle } from "../../components/Primitives";
import { TimezoneSelect } from "../../components/TimezoneSelect";
import { readApiClientError } from "../../data/apiClientError";
import { studioCommand } from "../../data/bookingCommands";
import { uploadStudioFile } from "../../data/uploads";
import type { Role } from "../../domain/model";
import { observedTimezone } from "../../domain/presentation";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioMutation } from "../../hooks/useStudioMutation";
import { useStudioStore } from "../../state/StudioStore";

import {
  portalNotificationLabels,
  type Snapshot,
} from "./StudentPortal.shared";

export function StudentSettings({
  data,
  isDemo,
  role,
}: {
  data: Snapshot;
  isDemo: boolean;
  role: Extract<Role, "student" | "guardian">;
}) {
  const student = data.students[0],
    linkedContact =
      role === "guardian"
        ? data.linkedContacts.find(
            (contact) => contact.id === data.currentLinkedContactId,
          )
        : undefined,
    store = useStudioStore(),
    queryClient = useQueryClient();
  const settingsMutation = useStudioMutation();
  const [form, setForm] = useState({
      preferredName:
        role === "guardian"
          ? linkedContact?.fullName || ""
          : student?.preferredName || "",
      pronouns: student?.pronouns || "",
      email:
        role === "guardian" ? linkedContact?.email || "" : student?.email || "",
      phone: student?.phone || "",
      timezone:
        role === "guardian"
          ? linkedContact?.timezoneConfirmed
            ? linkedContact.timezone || observedTimezone()
            : observedTimezone()
          : student?.timezoneConfirmed
            ? student.timezone || observedTimezone()
            : observedTimezone(),
      appearance:
        (role === "guardian"
          ? linkedContact?.portalPreferences?.appearance
          : student?.portalPreferences?.appearance) ??
        data.settings.portalDefaults.appearance ??
        "light",
      showProgress:
        student?.portalPreferences?.showProgress ??
        data.settings.portalDefaults.showProgress,
      emailReminders: student?.portalPreferences?.emailReminders ?? true,
      notificationPreferences: structuredClone(
        (role === "guardian"
          ? linkedContact?.notificationPreferences
          : student?.notificationPreferences) || {
          lessonReminders: true,
          scheduleChanges: true,
          lessonContent: true,
          assignments: true,
          packageBalance: role === "guardian",
          payments: role === "guardian",
          accountAccess: true,
        },
      ),
    }),
    [notice, setNotice] = useState(""),
    [loginPassword, setLoginPassword] = useState(""),
    [loginBusy, setLoginBusy] = useState(false),
    [stripeBusy, setStripeBusy] = useState<"payment-method" | "billing" | "">(
      "",
    ),
    [profilePhoto, setProfilePhoto] = useState<File>(),
    [removePhoto, setRemovePhoto] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.portalTheme = form.appearance;
  }, [form.appearance]);
  if (!student) return <div className="loading">Opening settings…</div>;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (settingsMutation.isPending()) return;
    setNotice("Saving your settings…");
    try {
      let profilePhotoAssetId: string | null | undefined =
        student.profilePhotoAssetId;
      if (removePhoto) profilePhotoAssetId = null;
      if (profilePhoto && role === "student" && !isDemo) {
        if (
          !profilePhoto.type.startsWith("image/") ||
          profilePhoto.size > 5 * 1024 * 1024
        )
          throw new Error(
            "Choose a JPG, PNG, or WebP image smaller than 5 MB.",
          );
        const uploaded = await uploadStudioFile({
          studioId: data.studioId,
          studentId: student.id,
          entityType: "student",
          entityId: student.id,
          file: profilePhoto,
          visibility: "private",
        });
        profilePhotoAssetId = uploaded.id;
      }
      const updates = {
        preferredName: form.preferredName,
        pronouns: form.pronouns,
        email: form.email,
        phone: form.phone,
        timezone: form.timezone,
        portalPreferences: {
          appearance: form.appearance as "light" | "dark",
          showProgress: form.showProgress,
          emailReminders: form.emailReminders,
        },
        notificationPreferences: form.notificationPreferences,
        profilePhotoAssetId,
        profilePhotoPosition: { x: 50, y: 50 },
      };
      await settingsMutation.run("portal-settings", async () => {
        if (isDemo)
          store.transact((draft) => {
            if (role === "guardian" && linkedContact) {
              const contact = draft.linkedContacts.find(
                (item) => item.id === linkedContact.id,
              );
              if (contact)
                Object.assign(contact, {
                  fullName: form.preferredName,
                  email: form.email,
                  timezone: form.timezone,
                  timezoneConfirmed: true,
                  notificationPreferences: form.notificationPreferences,
                  portalPreferences: { appearance: form.appearance },
                  version: contact.version + 1,
                  updatedAt: new Date().toISOString(),
                });
            } else
              Object.assign(draft.students[0], updates, {
                version: student.version + 1,
                updatedAt: new Date().toISOString(),
              });
          });
        else {
          if (role === "guardian" && linkedContact)
            await studioCommand("students", {
              command: "update_linked_contact_self",
              entityId: linkedContact.id,
              expectedVersion: linkedContact.version,
              payload: {
                fullName: form.preferredName,
                email: form.email,
                timezone: form.timezone,
                notificationPreferences: form.notificationPreferences,
                portalPreferences: { appearance: form.appearance },
              },
              reason: "Linked contact updated portal settings",
            });
          else
            await studioCommand("students", {
              command: "update_self",
              entityId: student.id,
              expectedVersion: student.version,
              payload: updates,
              reason: "Student updated portal settings",
            });
          await invalidateStudioDomains(queryClient, [
            "students",
            "households",
          ]);
        }
      });
      setNotice("Your settings were saved.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Settings could not be saved.",
      );
    }
  };
  const stripeAction = async (action: "payment-method" | "billing") => {
    if (stripeBusy) return;
    setStripeBusy(action);
    setNotice(
      action === "payment-method"
        ? "Opening Stripe’s secure card setup…"
        : "Opening secure billing…",
    );
    try {
      const { supabase } = await import("../../lib/supabase"),
        token = (await supabase?.auth.getSession())?.data.session?.access_token,
        response = await fetch(`/api/v2/portal/bookings/${action}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token || ""}`,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ studentId: student.id }),
        });
      if (!response.ok)
        throw await readApiClientError(
          response,
          "Payment settings could not be opened.",
        );
      const result = await response.json();
      window.location.assign(result.url);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Stripe could not be opened.",
      );
      setStripeBusy("");
    }
  };
  const saveLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true);
    setNotice("Updating your secure login…");
    try {
      if (isDemo) {
        store.transact((draft) => {
          draft.students[0].version += 1;
        });
      } else {
        const { supabase } = await import("../../lib/supabase");
        if (!supabase) throw new Error("Secure login is unavailable.");
        if (loginPassword) {
          if (
            loginPassword.length < 12 ||
            !/[a-z]/.test(loginPassword) ||
            !/[A-Z]/.test(loginPassword) ||
            !/\d/.test(loginPassword) ||
            !/[^A-Za-z0-9]/.test(loginPassword)
          )
            throw new Error(
              "Password must be 12+ characters with upper/lowercase letters, a number, and a symbol.",
            );
          const { error } = await supabase.auth.updateUser({
            password: loginPassword,
          });
          if (error) throw error;
        }
        void invalidateStudioDomains(queryClient, ["identity"]);
      }
      setLoginPassword("");
      setNotice("Your private password was updated.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Login settings could not be saved.",
      );
    } finally {
      setLoginBusy(false);
    }
  };
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>Settings</h1>
        <p>Contact details, payment methods, and your portal experience.</p>
      </header>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <nav className="settings-section-index" aria-label="Settings sections">
        <a href="#profile-timezone">Profile &amp; timezone</a>
        <a href="#preferences-notifications">Preferences &amp; notifications</a>
        <a href="#security">Security</a>
        {(role === "guardian"
          ? (linkedContact?.canViewFinance ?? student.isMinor)
          : !student.isMinor) && <a href="#billing">Billing</a>}
      </nav>
      <div id="profile-timezone" className="settings-anchor">
        <Section title="Profile & timezone" marked>
          <form className="settings-form" onSubmit={save}>
            <label>
              {role === "guardian" ? "Your name" : "Preferred name"}
              <input
                value={form.preferredName}
                onChange={(event) =>
                  setForm({ ...form, preferredName: event.target.value })
                }
              />
            </label>
            {role === "student" && (
              <label>
                Pronouns
                <input
                  value={form.pronouns}
                  onChange={(event) =>
                    setForm({ ...form, pronouns: event.target.value })
                  }
                />
              </label>
            )}
            <label>
              Email
              <input
                required
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </label>
            {role === "student" && (
              <label>
                Phone
                <input
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                />
              </label>
            )}
            {role === "student" && (
              <label className="full profile-photo-field">
                Profile photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    setProfilePhoto(event.target.files?.[0]);
                    setRemovePhoto(false);
                  }}
                />
                <small>
                  Optional. Shown only in portal identity areas; actor-page
                  headshots remain separate.
                </small>
                {student.profilePhotoUrl && !removePhoto && (
                  <span className="profile-photo-preview">
                    <img src={student.profilePhotoUrl} alt="Current profile" />
                    Current photo{" "}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setRemovePhoto(true);
                        setProfilePhoto(undefined);
                      }}
                    >
                      Remove
                    </button>
                  </span>
                )}
                {removePhoto && (
                  <small>Photo will be removed when you save.</small>
                )}
              </label>
            )}
            <label>
              Timezone
              <TimezoneSelect
                value={form.timezone}
                onChange={(timezone) => setForm({ ...form, timezone })}
              />
            </label>
            <div className="settings-list full">
              <Toggle
                checked={form.appearance === "dark"}
                label="Dark mode"
                detail="Use a lower-glare dark workspace on this account."
                onChange={(darkMode) =>
                  setForm({ ...form, appearance: darkMode ? "dark" : "light" })
                }
              />
              <Toggle
                checked={form.showProgress}
                label="Show progress"
                detail="Include practice progress in your workspace."
                onChange={(showProgress) => setForm({ ...form, showProgress })}
              />
              <Toggle
                checked={form.emailReminders}
                label="Email reminders"
                detail="Receive the lesson reminders configured by the studio."
                onChange={(emailReminders) =>
                  setForm({ ...form, emailReminders })
                }
              />
            </div>
            <div className="form-actions full">
              <button
                className="primary"
                disabled={settingsMutation.isPending("portal-settings")}
              >
                {settingsMutation.isPending("portal-settings")
                  ? "Saving…"
                  : "Save settings"}
              </button>
            </div>
          </form>
        </Section>
      </div>
      <div id="preferences-notifications" className="settings-anchor">
        <Section title="Preferences & notifications">
          <p className="section-intro">
            Choose optional updates. Security messages, credentials, receipts,
            cancellations, and critical payment failures are always sent to the
            responsible recipient.
          </p>
          <div className="settings-list">
            {Object.entries(portalNotificationLabels).map(([key, label]) => (
              <Toggle
                key={key}
                checked={Boolean(
                  form.notificationPreferences[
                    key as keyof typeof form.notificationPreferences
                  ],
                )}
                label={label}
                detail={
                  key === "lessonReminders"
                    ? "Students receive lesson reminders by default."
                    : "Email and in-app updates when applicable."
                }
                onChange={(checked) =>
                  setForm({
                    ...form,
                    notificationPreferences: {
                      ...form.notificationPreferences,
                      [key]: checked,
                    },
                  })
                }
              />
            ))}
          </div>
        </Section>
      </div>
      <div id="security" className="settings-anchor">
        <Section title="Password & security">
          <form className="settings-form" onSubmit={saveLogin}>
            <label>
              New password
              <input
                type="password"
                minLength={12}
                autoComplete="new-password"
                required
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
              />
              <small>
                Use 12+ characters with upper/lowercase letters, a number, and a
                symbol.
              </small>
            </label>
            <div className="form-actions full">
              <button className="primary" disabled={loginBusy}>
                {loginBusy ? "Saving login…" : "Save login"}
              </button>
            </div>
          </form>
        </Section>
      </div>
      {(role === "guardian"
        ? (linkedContact?.canViewFinance ?? student.isMinor)
        : !student.isMinor) && (
        <div id="billing" className="settings-anchor">
          <Section title="Payment method">
            <div className="data-summary">
              <CreditCard />
              <div>
                <strong>
                  {student.paymentMethodSummary || "No saved payment method"}
                </strong>
                <small>
                  Card details are stored by Stripe, never by this studio
                  portal.
                </small>
              </div>
            </div>
            <div className="form-actions">
              <button
                disabled={Boolean(stripeBusy)}
                onClick={() => void stripeAction("payment-method")}
              >
                {stripeBusy === "payment-method"
                  ? "Opening Stripe…"
                  : student.stripeCustomerId
                    ? "Add another payment method"
                    : "Add payment method"}
              </button>
              {student.stripeCustomerId && (
                <button
                  disabled={Boolean(stripeBusy)}
                  onClick={() => void stripeAction("billing")}
                >
                  {stripeBusy === "billing" ? "Opening…" : "Manage billing"}
                </button>
              )}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
