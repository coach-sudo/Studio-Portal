import { WritingArea } from "../../components/WritingArea";
import {
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Database,
  Megaphone,
  Palette,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
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
import {
  invalidateStudioDomains,
  studioDomainQueryKey,
} from "../../hooks/useStudio";
import { DailyPopupForm } from "./DailyPopupSettingsForm";
import { CalendarDiscovery } from "./CalendarDiscovery";
import { AutomationSettings } from "./AutomationSettings";
import { BookingSetup } from "./BookingSetup";
import {
  canonicalSettingsPanel,
  type SettingsPanel as Panel,
} from "../../domain/settingsPanels";
import { useUnsavedWorkspaceChanges } from "../../hooks/useWorkspaceLocation";
import {
  settingsWriteValues,
  validateStudioImage,
} from "../../domain/settingsAssets";
import { mergeStudioSettings } from "../../data/settings";
import { intakeDispatchNotice } from "../../domain/integrationHealth";

export const studioRecoverySummary = (data: StudioSnapshot) =>
  `${data.students.length} people · ${data.lessons.length} lessons · ${data.materials.length} materials.`;

export function StudioSettings({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const store = useStudioStore(),
    queryClient = useQueryClient(),
    settingsMutation = useStudioMutation(),
    [panel, setPanel] = useState<Panel>(() =>
      canonicalSettingsPanel(searchParams.get("panel")),
    ),
    [notice, setNotice] = useState(""),
    [health, setHealth] = useState<PlatformHealth>({
      mode: "demo",
      supabase: false,
      stripe: false,
      googleCalendar: false,
      gmail: false,
      scheduledWorkers: false,
    });
  const [dirty, setDirty] = useState(false),
    [editorBase, setEditorBase] = useState(data.settings),
    [epoch, setEpoch] = useState(0);
  const confirmDiscard = useUnsavedWorkspaceChanges(dirty);
  useEffect(() => {
    const raw = searchParams.get("panel"),
      next = canonicalSettingsPanel(raw);
    if (next !== panel) {
      if (!confirmDiscard()) {
        setSearchParams(
          (p) => {
            const next = new URLSearchParams(p);
            next.set("panel", panel);
            return next;
          },
          { replace: true },
        );
        return;
      }
      setPanel(next);
      setEditorBase(data.settings);
      setDirty(false);
      setEpoch((n) => n + 1);
      setNotice("");
    }
    if (raw !== next)
      setSearchParams(
        (p) => {
          const copy = new URLSearchParams(p);
          copy.set("panel", next);
          if (raw === "popup") copy.set("section", "popup");
          return copy;
        },
        { replace: true },
      );
  }, [searchParams, panel, data.settings, setSearchParams, confirmDiscard]);
  useEffect(() => {
    if (!isDemo)
      void loadPlatformHealth()
        .then(setHealth)
        .catch(() =>
          setNotice(
            "Integration status could not be loaded. Refresh connection status to retry.",
          ),
        );
  }, []);
  const refreshHealth = useCallback(async () => {
    const next = await loadPlatformHealth();
    setHealth(next);
    return next;
  }, []);
  const save = async (updates: Partial<Settings>, message: string) => {
    if (settingsMutation.isPending())
      throw new Error("Another Settings save is still running. Please wait.");
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
            payload: {
              settings: settingsWriteValues(updates),
              baseSettings: settingsWriteValues(editorBase, true),
            },
            reason: "Coach updated studio settings",
          });
          queryClient.setQueryData<StudioSnapshot>(
            studioDomainQueryKey("coach", undefined, "identity"),
            (current) =>
              current
                ? {
                    ...current,
                    displayName:
                      updates.coachName?.split(" ")[0] || current.displayName,
                    settings: mergeStudioSettings(current.settings, updates),
                  }
                : current,
          );
          await invalidateStudioDomains(queryClient, ["identity"]);
        }
      });
      setDirty(false);
      setEditorBase(mergeStudioSettings(editorBase, updates));
      setEpoch((n) => n + 1);
      setNotice(message);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Settings could not be saved.",
      );
      throw reason;
    }
  };
  const panels: Array<[Panel, string, typeof Palette, string]> = [
    [
      "profile",
      "Studio Profile and Branding",
      Palette,
      "Identity, appearance and contact",
    ],
    [
      "pricing",
      "Pricing and Billing",
      CircleDollarSign,
      "Default rates, invoices and packages",
    ],
    [
      "booking",
      "Booking Rules and Availability",
      CalendarClock,
      "Booking policy and scheduling setup",
    ],
    [
      "communications",
      "Communications and Notifications",
      Send,
      "Automations, templates and daily popup",
    ],
    [
      "integrations",
      "Integrations",
      Settings2,
      "Configured status and recent evidence",
    ],
    [
      "access",
      "Access and Privacy",
      ShieldCheck,
      "Portal experience and Household access",
    ],
    [
      "data",
      "Data and Recovery",
      Database,
      "Storage, history and delivery recovery",
    ],
  ];
  const choosePanel = (key: string) =>
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set("panel", key);
      next.delete("section");
      return next;
    });
  useEffect(() => {
    if (!dirty && !settingsMutation.isPending()) {
      setEditorBase(data.settings);
      setEpoch((n) => n + 1);
    }
  }, [data.settings, dirty]);
  return (
    <div className="settings-layout">
      <label className="settings-mobile-selector">
        Settings section
        <select value={panel} onChange={(e) => choosePanel(e.target.value)}>
          {panels.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <aside className="settings-nav" aria-label="Settings categories">
        {panels.map(([key, label, Icon, detail]) => (
          <button
            key={key}
            className={panel === key ? "active" : ""}
            onClick={() => {
              setSearchParams((p) => {
                const next = new URLSearchParams(p);
                next.set("panel", key);
                next.delete("section");
                return next;
              });
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
      <div
        className="settings-content"
        aria-busy={settingsMutation.isPending()}
        onChangeCapture={(e) => {
          if ((e.target as HTMLElement).closest(".settings-form"))
            setDirty(true);
        }}
        onClickCapture={(e) => {
          if (
            (e.target as HTMLElement).closest(".settings-form .toggle-button")
          )
            setDirty(true);
        }}
      >
        <h2>{panels.find((p) => p[0] === panel)?.[1]}</h2>
        {settingsMutation.isPending() && <p role="status">Saving settings…</p>}
        {dirty && (
          <div className="portal-notice" role="status">
            Unsaved changes{" "}
            <button
              onClick={() => {
                setDirty(false);
                setEditorBase(data.settings);
                setEpoch((n) => n + 1);
                setNotice("Changes cancelled.");
              }}
            >
              Cancel changes
            </button>
          </div>
        )}
        {notice && (
          <p className="portal-notice" role="status">
            {notice}
          </p>
        )}
        {panel === "profile" && (
          <StudioForm
            key={epoch}
            value={editorBase}
            studioId={data.studioId}
            onSave={(value) =>
              save(value, "Studio identity and contact details saved.")
            }
          />
        )}{" "}
        {panel === "access" && (
          <PortalForm
            key={epoch}
            value={editorBase}
            onSave={(value) =>
              void save(value, "Student workspace preferences saved.").catch(
                () => {},
              )
            }
          />
        )}{" "}
        {panel === "booking" && (
          <>
            <BookingSetup
              key={epoch}
              value={editorBase}
              onSave={(v) =>
                save(
                  v,
                  "Booking defaults saved. Existing agreements are unchanged.",
                )
              }
            />
            <div className="form-actions">
              <Link to="/coach/bookings?view=availability">
                Manage availability
              </Link>
              <Link to="/coach/bookings?view=services">Manage services</Link>
            </div>
          </>
        )}
        {panel === "pricing" && (
          <PricingForm
            key={epoch}
            value={editorBase}
            onSave={(value) =>
              void save(value, "Lesson rates and reminder timing saved.").catch(
                () => {},
              )
            }
          />
        )}{" "}
        {panel === "communications" && (
          <DailyPopupForm
            key={epoch}
            value={editorBase.dailyPopup}
            studioId={data.studioId}
            isDemo={isDemo}
            onSave={(dailyPopup) =>
              save({ dailyPopup }, "Daily popup settings saved.")
            }
          />
        )}{" "}
        {panel === "communications" && (
          <>
            <AutomationSettings data={data} isDemo={isDemo} />
            <details>
              <summary>Legacy email defaults and templates</summary>
              <EmailAutomationForm
                key={epoch}
                value={editorBase}
                onSave={(value) =>
                  void save(value, "Email automation settings saved.").catch(
                    () => {},
                  )
                }
              />
            </details>
          </>
        )}{" "}
        {panel === "integrations" && (
          <>
            <Integrations
              health={health}
              onNotice={setNotice}
              onRefresh={async () => {
                const [next] = await Promise.all([
                  refreshHealth(),
                  invalidateStudioDomains(queryClient, [
                    "identity",
                    "administration",
                  ]),
                ]);
                return next;
              }}
            />
            {!isDemo && (
              <CalendarDiscovery
                timezone={data.settings.timezone}
                onChanged={() =>
                  invalidateStudioDomains(queryClient, [
                    "identity",
                    "students",
                    "lessons",
                    "booking",
                    "administration",
                  ])
                }
              />
            )}
          </>
        )}{" "}
        {panel === "data" && (
          <DataPanel data={data} isDemo={isDemo} onNotice={setNotice} />
        )}
      </div>
    </div>
  );
}

export function StudioForm({
  value,
  studioId,
  onSave,
}: {
  value: Settings;
  studioId: string;
  onSave: (v: Partial<Settings>) => Promise<void>;
}) {
  const [form, setForm] = useState(value),
    [logo, setLogo] = useState<File>(),
    [coachPhoto, setCoachPhoto] = useState<File>(),
    [removeLogo, setRemoveLogo] = useState(false),
    [removeCoachPhoto, setRemoveCoachPhoto] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (uploading) return;
    setError("");
    try {
      if (logo) validateStudioImage(logo);
      if (coachPhoto) validateStudioImage(coachPhoto);
      setUploading(true);
      let branding = form.branding;
      if (removeLogo)
        branding = {
          ...branding,
          logoStoragePath: undefined,
          logoUrl: undefined,
        };
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
          logoUrl: undefined,
        };
      }
      if (removeCoachPhoto)
        branding = {
          ...branding,
          coachProfilePhotoStoragePath: undefined,
          coachProfilePhotoUrl: undefined,
        };
      if (coachPhoto) {
        const uploaded = await uploadStudioFile({
          studioId,
          entityType: "studio",
          file: coachPhoto,
          visibility: "private",
        });
        branding = {
          ...branding,
          coachProfilePhotoStoragePath: uploaded.storagePath,
          coachProfilePhotoUrl: undefined,
          coachProfilePhotoPosition: { x: 50, y: 50 },
        };
      }
      await onSave({
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
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Studio files could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  };
  return (
    <Section title="Studio identity" marked>
      <form className="settings-form" onSubmit={submit}>
        {error && (
          <p className="form-error full" role="alert">
            {error}
          </p>
        )}
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
            aria-label="Studio logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              setLogo(e.target.files?.[0]);
              setRemoveLogo(false);
            }}
          />
          <small>
            The uploaded logo is used in the booking header, footer, and public
            actor pages and invoices. PNG, JPEG or WebP, up to 5 MB.
          </small>
        </label>
        {(form.branding.logoStoragePath || form.branding.logoUrl) &&
          !removeLogo && (
            <div className="profile-photo-preview full">
              {form.branding.logoUrl && (
                <img src={form.branding.logoUrl} alt="Current studio logo" />
              )}
              <button
                type="button"
                onClick={() => {
                  setRemoveLogo(true);
                  setLogo(undefined);
                }}
              >
                Remove studio logo
              </button>
            </div>
          )}
        <label className="full material-upload">
          Coach profile photo
          <input
            aria-label="Coach profile photo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              setCoachPhoto(event.target.files?.[0]);
              setRemoveCoachPhoto(false);
            }}
          />
          <small>
            Optional. Used only in your signed-in identity areas. Coach’D never
            inserts stock or generated people.
          </small>
          {(form.branding.coachProfilePhotoStoragePath ||
            form.branding.coachProfilePhotoUrl) &&
            !removeCoachPhoto && (
              <span className="profile-photo-preview">
                <img
                  src={form.branding.coachProfilePhotoUrl}
                  alt="Current coach profile"
                />
                Current photo{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setRemoveCoachPhoto(true);
                    setCoachPhoto(undefined);
                  }}
                >
                  Remove
                </button>
              </span>
            )}
        </label>
        <div className="form-actions full">
          <button className="primary" disabled={uploading}>
            {uploading ? "Saving studio…" : "Save studio"}
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
      <p>
        Manage each person's permissions and revocation in the student's
        Household. Payer and scheduling responsibilities stay separate.
      </p>
      <Link to="/coach/students">Open student Households</Link>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            portalLabel: form.portalLabel,
            welcomeMessage: form.welcomeMessage,
            showContactButtons: form.showContactButtons,
            showDriveFolder: form.showDriveFolder,
            actorPageCta: form.actorPageCta,
            referralProgram: form.referralProgram,
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
          <WritingArea
            writingSize="long"
            value={form.welcomeMessage}
            onChange={(e) =>
              setForm({ ...form, welcomeMessage: e.target.value })
            }
          />
        </label>
        <fieldset className="full option-fieldset">
          <legend>Public actor-page coaching action</legend>
          <label>
            Button label
            <input
              required
              maxLength={60}
              value={form.actorPageCta.label}
              onChange={(event) =>
                setForm({
                  ...form,
                  actorPageCta: {
                    ...form.actorPageCta,
                    label: event.target.value,
                  },
                })
              }
            />
          </label>
          <label>
            Destination
            <input
              required
              value={form.actorPageCta.url}
              onChange={(event) =>
                setForm({
                  ...form,
                  actorPageCta: {
                    ...form.actorPageCta,
                    url: event.target.value,
                  },
                })
              }
              placeholder="/book or https://…"
            />
          </label>
        </fieldset>
        <fieldset className="full option-fieldset">
          <legend>Referral offer</legend>
          <label className="full">
            Referred-person benefit
            <input
              maxLength={200}
              value={form.referralProgram.referredPersonBenefit || ""}
              onChange={(event) =>
                setForm({
                  ...form,
                  referralProgram: {
                    ...form.referralProgram,
                    referredPersonBenefit: event.target.value || undefined,
                  },
                })
              }
              placeholder="Leave blank when only the referring student earns a reward"
            />
            <small>
              Student and public referral copy omits this benefit when it is not
              configured. Existing reward amounts remain authoritative.
            </small>
          </label>
        </fieldset>
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
          <WritingArea
            writingSize="long"
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
          <WritingArea
            writingSize="long"
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
          <WritingArea
            writingSize="long"
            rows={5}
            value={form.reminderBody}
            onChange={(event) =>
              setForm({ ...form, reminderBody: event.target.value })
            }
          />
        </label>
        <label>
          Reschedule subject
          <input
            value={form.rescheduleSubject}
            onChange={(event) =>
              setForm({ ...form, rescheduleSubject: event.target.value })
            }
          />
        </label>
        <label className="full">
          Reschedule body
          <WritingArea
            writingSize="long"
            rows={4}
            value={form.rescheduleBody}
            onChange={(event) =>
              setForm({ ...form, rescheduleBody: event.target.value })
            }
          />
        </label>
        <label>
          Cancellation subject
          <input
            value={form.cancellationSubject}
            onChange={(event) =>
              setForm({ ...form, cancellationSubject: event.target.value })
            }
          />
        </label>
        <label className="full">
          Cancellation body
          <WritingArea
            writingSize="long"
            rows={4}
            value={form.cancellationBody}
            onChange={(event) =>
              setForm({ ...form, cancellationBody: event.target.value })
            }
          />
        </label>
        <label>
          Package-expiry subject
          <input
            value={form.packageExpirySubject}
            onChange={(event) =>
              setForm({ ...form, packageExpirySubject: event.target.value })
            }
          />
        </label>
        <label className="full">
          Package-expiry body
          <WritingArea
            writingSize="long"
            rows={4}
            value={form.packageExpiryBody}
            onChange={(event) =>
              setForm({ ...form, packageExpiryBody: event.target.value })
            }
          />
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
          <WritingArea
            writingSize="long"
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

export function Integrations({
  health,
  onNotice,
  onRefresh,
}: {
  health: PlatformHealth;
  onNotice: (value: string) => void;
  onRefresh: () => Promise<PlatformHealth>;
}) {
  const [syncing, setSyncing] = useState(false),
    [repairing, setRepairing] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [watching, setWatching] = useState(false);
  const intake = health.workers?.["provider-intake"];
  const active =
    !!intake && ["queued", "accepted", "running"].includes(intake.status);
  useEffect(() => {
    if (!watching && !active) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void onRefresh()
        .then((next) => {
          if (cancelled) return;
          const status = next.workers?.["provider-intake"]?.status;
          if (!status || !["queued", "accepted", "running"].includes(status))
            setWatching(false);
        })
        .catch(() => {
          if (!cancelled) {
            setWatching(false);
            onNotice(
              "Receipt status could not be refreshed. Processing outcome is unknown; refresh status before retrying.",
            );
          }
        });
    }, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [watching, active, health.workers, onRefresh, onNotice]);
  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const dispatch = await startProviderIntake();
      onNotice(intakeDispatchNotice(dispatch));
      setWatching(dispatch.status !== "disabled");
      await onRefresh();
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
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "Connection status could not be refreshed.",
      );
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
      {health.issues?.map((issue) => (
        <p className="inline-error" key={issue}>
          {issue}
        </p>
      ))}
      <div className="settings-grid">
        {cards.map(([name, ready, detail], index) => {
          const key = [
              "googleCalendar",
              "gmail",
              "supabase",
              "stripe",
              "scheduledWorkers",
            ][index],
            evidence = health.integrations?.[key],
            working = evidence?.state === "working";
          return (
            <article key={name}>
              {working ? <CheckCircle2 /> : <RefreshCw />}
              <strong>{name}</strong>
              <small>{detail}</small>
              <Status tone={working ? "good" : "warn"}>
                {evidence?.state.replaceAll("_", " ") ||
                  (ready ? "configured — unverified" : "unconfigured")}
              </Status>
              {evidence?.lastSuccessAt && (
                <small>
                  Last recorded success{" "}
                  {new Date(evidence.lastSuccessAt).toLocaleString()}
                </small>
              )}
            </article>
          );
        })}
      </div>
      {Object.entries(health.workers ?? {}).map(([worker, observation]) => (
        <article
          className="settings-card"
          key={worker}
          aria-label={`${worker} processing status`}
        >
          <h3>
            {worker === "provider-intake"
              ? "Calendar & Gmail intake"
              : "Scheduled maintenance"}
          </h3>
          <p>
            <strong>{observation.status.replaceAll("_", " ")}</strong> ·{" "}
            {observation.enabled ? "Enabled" : "Disabled"}
          </p>
          <p>{observation.recovery}</p>
          {observation.receipt && (
            <>
              <p>
                Last requested:{" "}
                {new Date(observation.receipt.requestedAt).toLocaleString()}.
                Attempt {observation.receipt.attempts}.
              </p>
              <p>
                Last started:{" "}
                {observation.receipt.startedAt
                  ? new Date(observation.receipt.startedAt).toLocaleString()
                  : "Not started"}
                .
              </p>
              <p>
                Last completed successfully:{" "}
                {observation.receipt.lastSuccessAt
                  ? new Date(observation.receipt.lastSuccessAt).toLocaleString()
                  : "No saved successful completion"}
                .
              </p>
              <p>
                Saved receipt: {observation.receipt.state}.{" "}
                {observation.receipt.errorCategory &&
                  `Failure category: ${observation.receipt.errorCategory.replaceAll("_", " ")}.`}
              </p>
              <ul>
                {observation.receipt.stages
                  .filter((stage) =>
                    ["calendar_processing", "gmail_processing"].includes(
                      stage.stage,
                    ),
                  )
                  .map((stage) => (
                    <li key={stage.stage}>
                      {stage.stage === "calendar_processing"
                        ? "Calendar"
                        : "Gmail"}
                      : {stage.state.replace("stage_", "")}
                      {stage.errorCategory
                        ? ` (${stage.errorCategory.replaceAll("_", " ")})`
                        : ""}
                    </li>
                  ))}
              </ul>
              {!observation.receipt.stages.length && (
                <p>Stage outcomes were not retained for this receipt.</p>
              )}
              {!!observation.receipt.history.length && (
                <details>
                  <summary>Recent recorded attempts</summary>
                  <ul>
                    {observation.receipt.history.map((run, index) => (
                      <li key={`${run.jobId}:${run.attempt}:${index}`}>
                        {new Date(run.at).toLocaleString()}: {run.state},
                        attempt {run.attempt}
                        {run.errorCategory ? ` (${run.errorCategory})` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </article>
      ))}
      <div className="form-actions">
        <button
          className="primary"
          disabled={
            syncing ||
            active ||
            watching ||
            intake?.enabled === false ||
            !(
              health.integrations?.googleCalendar?.configured ??
              health.googleCalendar
            )
          }
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
  const failed = data.outbox.filter((item) => item.status === "failed");
  const cleanupCount = storage
    ? Object.values(storage.cleanupCandidates).reduce(
        (total, value) => total + value,
        0,
      )
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
      setStorageError(
        reason instanceof Error
          ? reason.message
          : "Storage information could not be loaded.",
      );
    }
  };
  useEffect(() => {
    void refreshStorage();
  }, [isDemo]);
  const retry = async () => {
    try {
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
      await invalidateStudioDomains(queryClient, ["messaging"]);
      onNotice(
        `${failed.length} failed message${failed.length === 1 ? "" : "s"} queued again.`,
      );
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "Failed messages could not be queued for retry.",
      );
    }
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
              {studioRecoverySummary(data)}{" "}
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
              <strong>
                {storage
                  ? formatBytes(storage.databaseBytes)
                  : storageError
                    ? "Unavailable"
                    : "Measuring…"}
              </strong>
              <span>
                Includes Supabase’s system tables and indexes, not just studio
                records.
              </span>
            </article>
            <article>
              <small>Uploaded files</small>
              <strong>
                {storage
                  ? formatBytes(storage.storageBytes)
                  : storageError
                    ? "Unavailable"
                    : "Measuring…"}
              </strong>
              <span>
                {storage
                  ? storage.storageObjects + " stored objects."
                  : "Object count unavailable."}{" "}
                Active files are never auto-deleted.
              </span>
            </article>
            <article>
              <small>Operator-managed retention</small>
              <strong>
                {storage
                  ? `${cleanupCount} candidate records`
                  : storageError
                    ? "Unavailable"
                    : "Measuring…"}
              </strong>
              <span>
                Only expired or reconstructable operational records qualify.
              </span>
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
                Students, lessons, notes, practice, payments, credits, actor
                profiles, audit history, and current materials are retained.
                Automated cleanup targets expired booking holds and rate limits,
                old processed webhook receipts, successful delivery attempts,
                resolved alerts, and bulky old provider-import payloads.
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
              a.download = "studio-workspace-export.json";
              a.click();
              URL.revokeObjectURL(url);
              onNotice(
                "Loaded workspace JSON exported. Database, Auth and Storage backups are managed separately.",
              );
            }}
          >
            Export loaded workspace JSON
          </button>
          {isDemo && (
            <button className="danger-button" onClick={reset}>
              Reset local data
            </button>
          )}
          {!isDemo && (
            <p>
              Retention and backup schedules are managed by the project
              operator. This portal does not remove historical receipts or alter
              backups.
            </p>
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
