import { useState, type FormEvent } from "react";
import { Section, Toggle } from "../../components/Primitives";
import type { StudioSettings } from "../../domain/model";

export function BookingSetup({
  value,
  onSave,
}: {
  value: StudioSettings;
  onSave: (updates: Partial<StudioSettings>) => Promise<void>;
}) {
  const [form, setForm] = useState(value);
  const [saving, setSaving] = useState(false);
  const updateDefaults = (
    updates: Partial<StudioSettings["bookingDefaults"]>,
  ) =>
    setForm({
      ...form,
      bookingDefaults: { ...form.bookingDefaults, ...updates },
    });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await onSave({
        bookingUrl: form.bookingUrl,
        showBookingButton: form.showBookingButton,
        bookingCopy: form.bookingCopy,
        bookingPage: form.bookingPage,
        bookingDefaults: form.bookingDefaults,
      });
    } catch {
      // The booking center displays the actionable save error.
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section title="Public booking setup" marked>
      <p className="section-intro">
        Control what people see, when they can book, and the defaults used when
        you create a new service. A service can still override these defaults.
      </p>
      <form className="settings-form booking-setup-form" onSubmit={submit}>
        <h3 className="full">Page content</h3>
        <label>
          Booking page address
          <input
            value={form.bookingUrl}
            onChange={(event) =>
              setForm({ ...form, bookingUrl: event.target.value })
            }
            placeholder="https://portal.example.com/book"
          />
        </label>
        <label>
          Button text
          <input
            value={form.bookingDefaults.bookingButtonLabel}
            onChange={(event) =>
              updateDefaults({ bookingButtonLabel: event.target.value })
            }
            placeholder="View times"
          />
        </label>
        <label>
          Short label above the headline
          <input
            value={form.bookingCopy.eyebrow}
            onChange={(event) =>
              setForm({
                ...form,
                bookingCopy: {
                  ...form.bookingCopy,
                  eyebrow: event.target.value,
                },
              })
            }
          />
        </label>
        <label className="full">
          Main headline
          <input
            value={form.bookingCopy.headline}
            onChange={(event) =>
              setForm({
                ...form,
                bookingCopy: {
                  ...form.bookingCopy,
                  headline: event.target.value,
                },
              })
            }
          />
        </label>
        <label className="full">
          Introduction
          <textarea
            value={form.bookingCopy.intro}
            onChange={(event) =>
              setForm({
                ...form,
                bookingCopy: { ...form.bookingCopy, intro: event.target.value },
              })
            }
          />
        </label>
        <label className="full">
          Message shown after a booking is confirmed
          <textarea
            value={form.bookingDefaults.confirmationMessage}
            onChange={(event) =>
              updateDefaults({ confirmationMessage: event.target.value })
            }
          />
        </label>
        <label>
          Footer website address
          <input
            type="url"
            value={form.bookingPage.footerWebsiteUrl}
            onChange={(event) =>
              setForm({
                ...form,
                bookingPage: {
                  ...form.bookingPage,
                  footerWebsiteUrl: event.target.value,
                },
              })
            }
          />
        </label>
        <label>
          Footer link text
          <input
            value={form.bookingPage.footerWebsiteLabel}
            onChange={(event) =>
              setForm({
                ...form,
                bookingPage: {
                  ...form.bookingPage,
                  footerWebsiteLabel: event.target.value,
                },
              })
            }
          />
        </label>

        <h3 className="full">What people can see and choose</h3>
        <div className="settings-list full">
          <Toggle
            label="Show the booking button in student accounts"
            detail="Signed-in students can book from their own profile."
            checked={form.showBookingButton}
            onChange={(showBookingButton) =>
              setForm({ ...form, showBookingButton })
            }
          />
          <Toggle
            label="Show coach name"
            detail="Identify the coach beneath the booking-page introduction."
            checked={form.bookingPage.showCoachName}
            onChange={(showCoachName) =>
              setForm({
                ...form,
                bookingPage: { ...form.bookingPage, showCoachName },
              })
            }
          />
          <Toggle
            label="Show trust and security details"
            detail="Explain secure checkout, live availability, and lesson delivery."
            checked={form.bookingPage.showTrustRow}
            onChange={(showTrustRow) =>
              setForm({
                ...form,
                bookingPage: { ...form.bookingPage, showTrustRow },
              })
            }
          />
          <Toggle
            label="Show cancellation and rescheduling rules"
            detail="Keep the accepted change rules visible during booking."
            checked={form.bookingPage.showPolicies}
            onChange={(showPolicies) =>
              setForm({
                ...form,
                bookingPage: { ...form.bookingPage, showPolicies },
              })
            }
          />
          <Toggle
            label="Show prices"
            detail="Display prices in the public service list and checkout."
            checked={form.bookingDefaults.showPrices}
            onChange={(showPrices) => updateDefaults({ showPrices })}
          />
          <Toggle
            label="Require a phone number"
            detail="Ask for a reachable phone number before checkout."
            checked={form.bookingDefaults.requirePhone}
            onChange={(requirePhone) => updateDefaults({ requirePhone })}
          />
          <Toggle
            label="Allow weekly and biweekly booking"
            detail="Only services that offer repeating lessons will show these choices."
            checked={form.bookingDefaults.allowRecurring}
            onChange={(allowRecurring) => updateDefaults({ allowRecurring })}
          />
          <Toggle
            label="Allow payment later"
            detail="Only services that support payment later will show this choice."
            checked={form.bookingDefaults.allowPayLater}
            onChange={(allowPayLater) => updateDefaults({ allowPayLater })}
          />
        </div>

        <h3 className="full">Default timing and price rules</h3>
        <label>
          How soon someone can book (hours)
          <input
            type="number"
            min="0"
            value={form.bookingDefaults.minimumNoticeHours}
            onChange={(event) =>
              updateDefaults({ minimumNoticeHours: Number(event.target.value) })
            }
          />
          <small>For example, 24 prevents bookings less than a day away.</small>
        </label>
        <label>
          How far ahead people can book (days)
          <input
            type="number"
            min="1"
            max="730"
            value={form.bookingDefaults.bookingHorizonDays}
            onChange={(event) =>
              updateDefaults({ bookingHorizonDays: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Notice required to cancel or reschedule (hours)
          <input
            type="number"
            min="0"
            value={form.bookingDefaults.cancellationWindowHours}
            onChange={(event) =>
              updateDefaults({
                cancellationWindowHours: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Break before each lesson (minutes)
          <input
            type="number"
            min="0"
            value={form.bookingDefaults.bufferBeforeMinutes}
            onChange={(event) =>
              updateDefaults({
                bufferBeforeMinutes: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Break after each lesson (minutes)
          <input
            type="number"
            min="0"
            value={form.bookingDefaults.bufferAfterMinutes}
            onChange={(event) =>
              updateDefaults({ bufferAfterMinutes: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Weeks of ongoing lessons to keep scheduled
          <input
            type="number"
            min="1"
            value={form.bookingDefaults.recurringHorizonWeeks}
            onChange={(event) =>
              updateDefaults({
                recurringHorizonWeeks: Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Default extra charge for in-person lessons (USD)
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.bookingDefaults.inPersonUpchargeMinor / 100}
            onChange={(event) =>
              updateDefaults({
                inPersonUpchargeMinor: Math.round(
                  Number(event.target.value) * 100,
                ),
              })
            }
          />
          <small>
            A service-specific amount will take priority over this default.
          </small>
        </label>
        <div className="form-actions full">
          <button className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save booking setup"}
          </button>
        </div>
      </form>
    </Section>
  );
}
