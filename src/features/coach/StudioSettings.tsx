import {
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Database,
  Palette,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  EmptyState,
  ListControls,
  Section,
  Status,
  usePagedList,
} from "../../components/Primitives";
import { TimezoneSelect } from "../../components/TimezoneSelect";
import {
  loadPlatformHealth,
  loadStorageHealth,
  startProviderIntake,
  studioCommand,
  type PlatformHealth,
  type StorageHealth,
} from "../../data/bookingCommands";
import type {
  StudioSettings as Settings,
  StudioSnapshot,
} from "../../domain/model";
import { useStudioStore } from "../../state/StudioStore";
import { uploadStudioFile } from "../../data/uploads";
import { useStudioMutation } from "../../hooks/useStudioMutation";

type Panel =
  "studio" | "portal" | "pricing" | "email" | "integrations" | "data";
export function StudioSettings({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const store = useStudioStore(),
    queryClient = useQueryClient(),
    settingsMutation = useStudioMutation(),
    [panel, setPanel] = useState<Panel>("studio"),
    [notice, setNotice] = useState(""),
    [health, setHealth] = useState<PlatformHealth>({
      mode: "demo",
      supabase: false,
      stripe: false,
      googleCalendar: false,
      gmail: false,
      scheduledWorkers: false,
    });
  useEffect(() => {
    void loadPlatformHealth().then(setHealth);
  }, []);
  const refreshHealth = async () => {
    const next = await loadPlatformHealth();
    setHealth(next);
    return next;
  };
  const save = async (updates: Partial<Settings>, message: string) => {
    if (settingsMutation.isPending()) return;
    try {
      await settingsMutation.run(`settings-${panel}`, async () => {
        if (isDemo)
          store.transact((draft) => {
            draft.settings = { ...draft.settings, ...updates };
            draft.displayName =
              draft.settings.coachName.split(" ")[0] || draft.displayName;
          });
        else {
          await studioCommand("settings", {
            command: "update",
            expectedVersion: 1,
            payload: { settings: updates },
            reason: "Coach updated studio settings",
          });
          queryClient.setQueryData<StudioSnapshot>(
            ["studio", "coach", undefined],
            (current) =>
              current
                ? {
                    ...current,
                    displayName:
                      updates.coachName?.split(" ")[0] || current.displayName,
                    settings: { ...current.settings, ...updates },
                  }
                : current,
          );
          await queryClient.invalidateQueries({ queryKey: ["studio"] });
        }
      });
      setNotice(message);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Settings could not be saved.",
      );
    }
  };
  const panels: [
    [Panel, string, typeof Palette, string],
    ...Array<[Panel, string, typeof Palette, string]>,
  ] = [
    ["studio", "Studio", Palette, "Name, contact, timezone"],
    ["portal", "Student workspace", Users, "Visibility and welcome"],
    ["pricing", "Rates & reminders", CircleDollarSign, "Lesson rates and timing"],
    ["email", "Email automations", Send, "Confirmations and reminders"],
    ["integrations", "Connections", Settings2, "Calendar, email, payments"],
    ["data", "Data & recovery", Database, "Saved data and delivery queue"],
  ];
  return (
    <div className="settings-layout">
      <aside className="settings-nav" aria-label="Settings categories">
        {panels.map(([key, label, Icon, detail]) => (
          <button
            key={key}
            className={panel === key ? "active" : ""}
            onClick={() => {
              setPanel(key);
              setNotice("");
            }}
          >
            <Icon />
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </button>
        ))}
      </aside>
      <div className="settings-content">
        {notice && (
          <p className="portal-notice" role="status">
            <CheckCircle2 />
            {notice}
          </p>
        )}
        {panel === "studio" && (
          <StudioForm
            value={data.settings}
            studioId={data.studioId}
            onSave={(value) =>
              void save(value, "Studio identity and contact details saved.")
            }
          />
        )}{" "}
        {panel === "portal" && (
          <PortalForm
            value={data.settings}
            onSave={(value) =>
              void save(value, "Student workspace preferences saved.")
            }
          />
        )}{" "}
        {panel === "pricing" && (
          <PricingForm
            value={data.settings}
            onSave={(value) =>
              void save(value, "Lesson rates and reminder timing saved.")
            }
          />
        )}{" "}
        {panel === "email" && (
          <EmailAutomationForm
            value={data.settings}
            onSave={(value) =>
              void save(value, "Email automation settings saved.")
            }
          />
        )}{" "}
        {panel === "integrations" && (
          <Integrations
            health={health}
            onNotice={setNotice}
            onRefresh={async () => {
              await Promise.all([
                refreshHealth(),
                queryClient.invalidateQueries({ queryKey: ["studio"] }),
              ]);
            }}
          />
        )}{" "}
        {panel === "data" && (
          <DataPanel data={data} isDemo={isDemo} onNotice={setNotice} />
        )}
      </div>
    </div>
  );
}

function StudioForm({
  value,
  studioId,
  onSave,
}: {
  value: Settings;
  studioId: string;
  onSave: (v: Partial<Settings>) => void;
}) {
  const [form, setForm] = useState(value),
    [logo, setLogo] = useState<File>(),
    [coachPhoto, setCoachPhoto] = useState<File>(),
    [removeCoachPhoto,setRemoveCoachPhoto]=useState(false),
    [uploading, setUploading] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setUploading(true);
      let branding = form.branding;
      if (logo) {
        const uploaded = await uploadStudioFile({
          studioId,
          entityType: "studio",
          file: logo,
          visibility: "public_actor",
        });
        branding = {
          ...branding,
          logoStoragePath: uploaded.storagePath,
          logoUrl: uploaded.signedUrl,
        };
      }
      if (removeCoachPhoto) branding={...branding,coachProfilePhotoStoragePath:undefined,coachProfilePhotoUrl:undefined};
      if (coachPhoto) {
        if (!coachPhoto.type.startsWith("image/") || coachPhoto.size > 5*1024*1024) throw new Error("Choose a JPG, PNG, or WebP image smaller than 5 MB.");
        const uploaded=await uploadStudioFile({studioId,entityType:"studio",file:coachPhoto,visibility:"private"});
        branding={...branding,coachProfilePhotoStoragePath:uploaded.storagePath,coachProfilePhotoUrl:uploaded.signedUrl,coachProfilePhotoPosition:{x:50,y:50}};
      }
      onSave({
        studioName: form.studioName,
        studioTagline: form.studioTagline,
        coachName: form.coachName,
        coachTitle: form.coachTitle,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        timezone: form.timezone,
        currency: form.currency,
        branding,
      });
    } finally {
      setUploading(false);
    }
  };
  return (
    <Section title="Studio identity" marked>
      <form className="settings-form" onSubmit={submit}>
        <label>
          Studio name
          <input
            required
            value={form.studioName}
            onChange={(e) => setForm({ ...form, studioName: e.target.value })}
          />
        </label>
        <label>
          Tagline
          <input
            value={form.studioTagline}
            onChange={(e) =>
              setForm({ ...form, studioTagline: e.target.value })
            }
          />
        </label>
        <label>
          Coach name
          <input
            required
            value={form.coachName}
            onChange={(e) => setForm({ ...form, coachName: e.target.value })}
          />
        </label>
        <label>
          Coach title
          <input
            value={form.coachTitle}
            onChange={(e) => setForm({ ...form, coachTitle: e.target.value })}
          />
        </label>
        <label>
          Email
          <input
            required
            type="email"
            value={form.contactEmail}
            onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
          />
        </label>
        <label>
          Text number
          <input
            value={form.contactPhone}
            onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
          />
        </label>
        <label>
          Timezone
          <TimezoneSelect
            value={form.timezone}
            onChange={(timezone) => setForm({ ...form, timezone })}
          />
        </label>
        <label>
          Currency
          <select
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          >
            <option>USD</option>
            <option>CAD</option>
            <option>GBP</option>
            <option>EUR</option>
          </select>
        </label>
        <fieldset className="full option-fieldset">
          <legend>Studio colors</legend>
          <div className="settings-grid">
            {(
              [
                ["primaryColor", "Main"],
                ["secondaryColor", "Secondary"],
                ["accentColor", "Accent"],
                ["surfaceColor", "Page background"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="color"
                  value={form.branding[key]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      branding: { ...form.branding, [key]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
        <label className="full material-upload">
          Studio logo
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setLogo(e.target.files?.[0])}
          />
          <small>
            The uploaded logo is used in the booking header, footer, and public
            actor pages.
          </small>
        </label>
        <label className="full material-upload">Coach profile photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event)=>{setCoachPhoto(event.target.files?.[0]);setRemoveCoachPhoto(false);}}/><small>Optional. Used only in your signed-in identity areas. Coach’D never inserts stock or generated people.</small>{form.branding.coachProfilePhotoUrl&&!removeCoachPhoto&&<span className="profile-photo-preview"><img src={form.branding.coachProfilePhotoUrl} alt="Current coach profile"/>Current photo <button type="button" className="text-button" onClick={()=>{setRemoveCoachPhoto(true);setCoachPhoto(undefined);}}>Remove</button></span>}</label>
        <div className="form-actions full">
          <button className="primary" disabled={uploading}>
            {uploading ? "Uploading…" : "Save studio"}
          </button>
        </div>
      </form>
    </Section>
  );
}
function PortalForm({
  value,
  onSave,
}: {
  value: Settings;
  onSave: (v: Partial<Settings>) => void;
}) {
  const [form, setForm] = useState(value);
  return (
    <Section title="Student workspace" marked>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            portalLabel: form.portalLabel,
            welcomeMessage: form.welcomeMessage,
            showContactButtons: form.showContactButtons,
            showDriveFolder: form.showDriveFolder,
          });
        }}
      >
        <label>
          Workspace label
          <input
            value={form.portalLabel}
            onChange={(e) => setForm({ ...form, portalLabel: e.target.value })}
          />
        </label>
        <label className="full">
          Welcome message
          <textarea
            value={form.welcomeMessage}
            onChange={(e) =>
              setForm({ ...form, welcomeMessage: e.target.value })
            }
          />
        </label>
        <div className="settings-list full">
          <Toggle
            title="Contact coach buttons"
            detail="Show email and text actions to students."
            checked={form.showContactButtons}
            onChange={(checked) =>
              setForm({ ...form, showContactButtons: checked })
            }
          />
          <Toggle
            title="Drive folder"
            detail="Show a student's connected Drive folder when one is saved."
            checked={form.showDriveFolder}
            onChange={(checked) =>
              setForm({ ...form, showDriveFolder: checked })
            }
          />
        </div>
        <div className="form-actions full">
          <button className="primary">Save workspace</button>
        </div>
      </form>
    </Section>
  );
}
function PricingForm({
  value,
  onSave,
}: {
  value: Settings;
  onSave: (v: Partial<Settings>) => void;
}) {
  const [rates, setRates] = useState(value.lessonRatesMinor),
    [reminders, setReminders] = useState(value.reminderHours.join(", "));
  const dollars = (minor: number) => minor / 100;
  return (
    <Section title="Rates & reminders" marked>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            lessonRatesMinor: rates,
            reminderHours: reminders
              .split(",")
              .map(Number)
              .filter((v) => Number.isFinite(v) && v > 0),
          });
        }}
      >
        {([30, 60, 90] as const).map((duration) => (
          <label key={duration}>
            {duration}-minute lesson
            <input
              type="number"
              min="0"
              step="0.01"
              value={dollars(rates[duration])}
              onChange={(e) =>
                setRates({
                  ...rates,
                  [duration]: Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </label>
        ))}
        <label>
          Intro session
          <input
            type="number"
            min="0"
            step="0.01"
            value={dollars(rates.intro)}
            onChange={(e) =>
              setRates({
                ...rates,
                intro: Math.round(Number(e.target.value) * 100),
              })
            }
          />
        </label>
        <label className="full">
          Reminder hours before lesson
          <input
            value={reminders}
            onChange={(e) => setReminders(e.target.value)}
            placeholder="24, 2"
          />
          <small>Separate multiple reminders with commas.</small>
        </label>
        <div className="form-actions full">
          <button className="primary">Save rates and reminders</button>
        </div>
      </form>
    </Section>
  );
}
function EmailAutomationForm({
  value,
  onSave,
}: {
  value: Settings;
  onSave: (value: Partial<Settings>) => void;
}) {
  const [form, setForm] = useState(value.emailAutomations);
  return (
    <Section title="Email automations" marked>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ emailAutomations: form });
        }}
      >
        <div className="settings-list full">
          <Toggle
            title="Send automated email"
            detail="Master switch for booking emails and reminders."
            checked={form.enabled}
            onChange={(enabled) => setForm({ ...form, enabled })}
          />
          <Toggle
            title="Notify me about new bookings"
            detail="Email the studio contact address after confirmation."
            checked={form.coachNewBooking}
            onChange={(coachNewBooking) =>
              setForm({ ...form, coachNewBooking })
            }
          />
          <Toggle
            title="Student confirmations"
            detail="Send the secure management link after confirmation."
            checked={form.studentConfirmation}
            onChange={(studentConfirmation) =>
              setForm({ ...form, studentConfirmation })
            }
          />
          <Toggle
            title="Lesson reminders"
            detail="Use the reminder timing configured under Rates & reminders."
            checked={form.reminders}
            onChange={(reminders) => setForm({ ...form, reminders })}
          />
        </div>
        <label>
          Student confirmation subject
          <input
            value={form.confirmationSubject}
            onChange={(event) =>
              setForm({ ...form, confirmationSubject: event.target.value })
            }
          />
        </label>
        <label className="full">
          Student confirmation body
          <textarea
            rows={6}
            value={form.confirmationBody}
            onChange={(event) =>
              setForm({ ...form, confirmationBody: event.target.value })
            }
          />
        </label>
        <label>
          Coach notification subject
          <input
            value={form.coachSubject}
            onChange={(event) =>
              setForm({ ...form, coachSubject: event.target.value })
            }
          />
        </label>
        <label className="full">
          Coach notification body
          <textarea
            rows={5}
            value={form.coachBody}
            onChange={(event) =>
              setForm({ ...form, coachBody: event.target.value })
            }
          />
        </label>
        <label>
          Reminder subject
          <input
            value={form.reminderSubject}
            onChange={(event) =>
              setForm({ ...form, reminderSubject: event.target.value })
            }
          />
        </label>
        <label className="full">
          Reminder body
          <textarea
            rows={5}
            value={form.reminderBody}
            onChange={(event) =>
              setForm({ ...form, reminderBody: event.target.value })
            }
          />
        </label>
        <label>
          Reschedule subject
          <input value={form.rescheduleSubject} onChange={(event) => setForm({ ...form, rescheduleSubject: event.target.value })} />
        </label>
        <label className="full">
          Reschedule body
          <textarea rows={4} value={form.rescheduleBody} onChange={(event) => setForm({ ...form, rescheduleBody: event.target.value })} />
        </label>
        <label>
          Cancellation subject
          <input value={form.cancellationSubject} onChange={(event) => setForm({ ...form, cancellationSubject: event.target.value })} />
        </label>
        <label className="full">
          Cancellation body
          <textarea rows={4} value={form.cancellationBody} onChange={(event) => setForm({ ...form, cancellationBody: event.target.value })} />
        </label>
        <label>
          Package-expiry subject
          <input value={form.packageExpirySubject} onChange={(event) => setForm({ ...form, packageExpirySubject: event.target.value })} />
        </label>
        <label className="full">
          Package-expiry body
          <textarea rows={4} value={form.packageExpiryBody} onChange={(event) => setForm({ ...form, packageExpiryBody: event.target.value })} />
        </label>
        <label>
          Failed-payment subject
          <input
            value={form.paymentFailedSubject}
            onChange={(event) =>
              setForm({ ...form, paymentFailedSubject: event.target.value })
            }
          />
        </label>
        <label className="full">
          Failed-payment body
          <textarea
            rows={4}
            value={form.paymentFailedBody}
            onChange={(event) =>
              setForm({ ...form, paymentFailedBody: event.target.value })
            }
          />
          <small>
            {
              "Available tokens: {{studioName}}, {{studentName}}, {{serviceName}}, {{startsAt}}, {{location}}, {{reference}}, {{manageUrl}}, {{hours}}, {{meetingDetails}}, {{packageName}}, {{days}}, {{credits}}, {{expiresAt}}."
            }
          </small>
        </label>
        <div className="form-actions full">
          <button className="primary">Save email automations</button>
        </div>
      </form>
    </Section>
  );
}

function Integrations({
  health,
  onNotice,
  onRefresh,
}: {
  health: PlatformHealth;
  onNotice: (value: string) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [syncing, setSyncing] = useState(false),
    [repairing, setRepairing] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await startProviderIntake();
      onNotice(
        "Calendar and Gmail check started. High-confidence lessons will appear automatically; uncertain provider messages stay in Today for review.",
      );
      window.setTimeout(() => void onRefresh(), 15000);
    } catch (reason) {
      onNotice(
        reason instanceof Error
          ? reason.message
          : "Calendar and Gmail could not be checked.",
      );
    } finally {
      setSyncing(false);
    }
  };
  const repair = async () => {
    if (repairing) return;
    setRepairing(true);
    try {
      const result = await studioCommand("integrations", {
        command: "retry_failed",
        expectedVersion: 0,
        reason: "Coach retried failed Calendar and email work",
      });
      await onRefresh();
      const resource = result.resource || {};
      onNotice(
        `Queued ${Number(resource.calendar || 0)} Calendar and ${Number(resource.email || 0)} email job${Number(resource.calendar || 0) + Number(resource.email || 0) === 1 ? "" : "s"} for another attempt.`,
      );
    } catch (reason) {
      onNotice(
        reason instanceof Error
          ? reason.message
          : "Failed integration work could not be retried.",
      );
    } finally {
      setRepairing(false);
    }
  };
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
      onNotice("Connection status refreshed.");
    } finally {
      setRefreshing(false);
    }
  };
  const cards = [
    [
      "Google Calendar & Meet",
      health.googleCalendar,
      "Availability, invitations, Meet links, and event updates.",
    ],
    ["Gmail", health.gmail, "Confirmations, changes, and reminders."],
    [
      "Supabase",
      health.supabase,
      "Cross-device studio records and secure role access.",
    ],
    [
      "Stripe",
      health.stripe,
      "Live charges, deposits, subscriptions, and refunds.",
    ],
    [
      "Scheduled recovery",
      health.scheduledWorkers,
      "Retries, rolling series, and expired holds.",
    ],
  ] as const;
  return (
    <Section title="Integration health" marked>
      <p className="section-intro">
        The studio remains usable without every provider. Each card says exactly
        what becomes live when connected.
      </p>
      {health.issues?.map((issue) => (
        <p className="inline-error" key={issue}>
          {issue}
        </p>
      ))}
      <div className="settings-grid">
        {cards.map(([name, ready, detail]) => (
          <article key={name}>
            {ready ? <CheckCircle2 /> : <RefreshCw />}
            <strong>{name}</strong>
            <small>{detail}</small>
            <Status tone={ready ? "good" : "warn"}>
              {ready ? "connected" : "configuration required"}
            </Status>
          </article>
        ))}
      </div>
      <div className="form-actions">
        <button
          className="primary"
          disabled={syncing || !health.googleCalendar}
          onClick={() => void sync()}
        >
          <RefreshCw />
          {syncing
            ? "Checking Calendar & Gmail…"
            : "Check Calendar & Gmail now"}
        </button>
      </div>
      <div className="form-actions">
        <button disabled={repairing} onClick={() => void repair()}>
          <RefreshCw />
          {repairing
            ? "Queuing retries…"
            : "Retry failed Calendar & email jobs"}
        </button>
        <button disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw />
          {refreshing ? "Refreshing…" : "Refresh connection status"}
        </button>
      </div>
    </Section>
  );
}
function DataPanel({
  data,
  isDemo,
  onNotice,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
  onNotice: (v: string) => void;
}) {
  const messagePage = usePagedList(
    [...data.outbox].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
  const queryClient = useQueryClient();
  const store = useStudioStore();
  const [storage, setStorage] = useState<StorageHealth>();
  const [storageError, setStorageError] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const failed = data.outbox.filter((item) => item.status === "failed");
  const cleanupCount = storage
    ? Object.values(storage.cleanupCandidates).reduce((total, value) => total + value, 0)
    : 0;
  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };
  const refreshStorage = async () => {
    if (isDemo) return;
    try {
      setStorageError("");
      setStorage(await loadStorageHealth());
    } catch (reason) {
      setStorageError(reason instanceof Error ? reason.message : "Storage information could not be loaded.");
    }
  };
  useEffect(() => {
    void refreshStorage();
  }, [isDemo]);
  const retry = async () => {
    if (isDemo)
      store.transact((draft) =>
        draft.outbox
          .filter((i) => i.status === "failed")
          .forEach((i) => {
            i.status = "queued";
            i.lastError = undefined;
            i.attempts += 1;
          }),
      );
    else
      await studioCommand("outbox", {
        command: "retry_failed",
        expectedVersion: 0,
        reason: "Coach retried failed email delivery",
      });
    await queryClient.invalidateQueries({ queryKey: ["studio"] });
    onNotice(
      `${failed.length} failed message${failed.length === 1 ? "" : "s"} queued again.`,
    );
  };
  const reset = () => {
    if (
      window.confirm(
        "Reset locally saved studio changes and return to the sample studio?",
      )
    ) {
      store.reset();
      onNotice("Local studio data reset.");
    }
  };
  const cleanup = async () => {
    if (isDemo || cleaning || !cleanupCount) return;
    setCleaning(true);
    try {
      await studioCommand("settings", {
        command: "cleanup_storage",
        expectedVersion: 0,
        reason: "Coach ran safe transient-data cleanup",
      });
      await refreshStorage();
      onNotice("Safe cleanup finished. Student, lesson, note, payment, credit, and file records were preserved.");
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : "Safe cleanup could not be completed.");
    } finally {
      setCleaning(false);
    }
  };
  return (
    <>
      <Section title="Saved studio data" marked>
        <div className="data-summary">
          <Database />
          <div>
            <strong>
              {isDemo
                ? "Saved for this demo session"
                : "Saved securely in the studio database"}
            </strong>
            <small>
              {data.students.length} people · {data.lessons.length} lessons ·{" "}
              {data.materials.length} materials.{" "}
              {isDemo
                ? "Refreshing resets sample changes."
                : "Authorized users see the same current records on every device."}
            </small>
          </div>
          <Status tone="good">saved</Status>
        </div>
        {!isDemo && (
          <div className="storage-health-grid">
            <article>
              <small>Database</small>
              <strong>{storage ? formatBytes(storage.databaseBytes) : "Measuring…"}</strong>
              <span>Includes Supabase’s system tables and indexes, not just studio records.</span>
            </article>
            <article>
              <small>Uploaded files</small>
              <strong>{storage ? formatBytes(storage.storageBytes) : "Measuring…"}</strong>
              <span>{storage?.storageObjects ?? 0} stored objects. Active files are never auto-deleted.</span>
            </article>
            <article>
              <small>Safe cleanup</small>
              <strong>{storage ? `${cleanupCount} eligible records` : "Measuring…"}</strong>
              <span>Only expired or reconstructable operational records qualify.</span>
            </article>
          </div>
        )}
        {storageError && <p className="inline-error">{storageError}</p>}
        {!isDemo && (
          <div className="storage-retention-note">
            <ShieldCheck />
            <div>
              <strong>Studio history is protected</strong>
              <small>
                Students, lessons, notes, practice, payments, credits, actor profiles,
                audit history, and current materials are retained. Automated cleanup
                targets expired booking holds and rate limits, old processed webhook
                receipts, successful delivery attempts, resolved alerts, and bulky old
                provider-import payloads.
              </small>
            </div>
          </div>
        )}
        <div className="form-actions">
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "stage-story-backup.json";
              a.click();
              URL.revokeObjectURL(url);
              onNotice("Studio backup downloaded.");
            }}
          >
            Download backup
          </button>
          {isDemo && (
            <button className="danger-button" onClick={reset}>
              Reset local data
            </button>
          )}
          {!isDemo && (
            <button disabled={cleaning || !cleanupCount} onClick={() => void cleanup()}>
              <RefreshCw />
              {cleaning ? "Cleaning safely…" : cleanupCount ? `Clean ${cleanupCount} transient records` : "Nothing safe to clean"}
            </button>
          )}
        </div>
      </Section>
      <Section
        title="Communication recovery"
        aside={
          <button disabled={!failed.length} onClick={() => void retry()}>
            <RefreshCw />
            Retry failed
          </button>
        }
      >
        <ListControls
          page={messagePage.page}
          pageCount={messagePage.pageCount}
          pageSize={messagePage.pageSize}
          total={messagePage.total}
          onPage={messagePage.setPage}
          onPageSize={messagePage.setPageSize}
          label="messages"
        />
        <div className="table-list">
          {messagePage.visible.map((message) => (
            <article key={message.id}>
              <Send />
              <div>
                <strong>{message.subject}</strong>
                <small>
                  {message.recipient} · {message.attempts} attempts
                  {message.lastError ? ` · ${message.lastError}` : ""}
                </small>
              </div>
              <Status
                tone={
                  message.status === "failed"
                    ? "danger"
                    : message.status === "sent"
                      ? "good"
                      : "neutral"
                }
              >
                {message.status}
              </Status>
            </article>
          ))}
          {!data.outbox.length && (
            <EmptyState
              title="Delivery queue is clear"
              detail="Confirmations and reminders will appear here only when attention is needed."
            />
          )}
        </div>
      </Section>
      <div className="security-note">
        <ShieldCheck />
        <div>
          <strong>Booking security remains server-side</strong>
          <small>
            Public booking writes never use this local store. Live booking data
            continues to require Supabase and verified provider webhooks.
          </small>
        </div>
      </div>
    </>
  );
}
function Toggle({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`setting-toggle toggle-button ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <i aria-hidden="true">
        <b />
      </i>
    </button>
  );
}
