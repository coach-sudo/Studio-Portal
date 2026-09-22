import {
  CalendarDays,
  Check,
  ChevronRight,
  CreditCard,
  MapPin,
  ShieldCheck,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { readApiClientError } from "../../data/apiClientError";
import {
  buildAvailability,
  remainingCapacity,
  seriesDates,
} from "../../domain/booking";
import { formatMoney } from "../../domain/finance";
import type {
  BookingService,
  MeetingProvider,
  PaymentPolicy,
  RecurrenceCadence,
  ServiceOffering,
} from "../../domain/model";
import {
  formatCalendarDateKey,
  formatStudioTime,
  studioDateKey,
} from "../../domain/presentation";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import { useStudioStore } from "../../state/StudioStore";

import {
  createDemoBooking,
  formatDate,
  locationLabel,
  visitorTimezone,
  type AuthenticatedBooker,
  type PublicStudio,
} from "./PublicBooking.shared";

type Step = "format" | "time" | "details" | "payment" | "done";
export function BookingFlow({
  service,
  offerings,
  initialOfferingId,
  live,
  studio,
  booker,
  initialReferralCode,
  initialDiscountCode,
}: {
  service: BookingService;
  offerings: ServiceOffering[];
  initialOfferingId?: string;
  live: boolean;
  studio: PublicStudio;
  booker?: AuthenticatedBooker;
  initialReferralCode: string;
  initialDiscountCode: string;
}) {
  const store = useStudioStore();
  const initialOffering = offerings.find(
    (item) =>
      item.id === initialOfferingId &&
      item.serviceId === service.id &&
      item.published,
  );
  const [step, setStep] = useState<Step>(initialOffering ? "time" : "format");
  const [location, setLocation] = useState<MeetingProvider>(
    service.defaultLocation,
  );
  const locationUpcharge = Number(
    service.locationPriceAdjustments[location] ?? 0,
  );
  const displayedPrice = service.priceMinor + locationUpcharge;
  const [recurrence, setRecurrence] = useState<RecurrenceCadence>(
    service.category === "course" ? "weekly" : "none",
  );
  const recurrenceOptions =
    service.category === "private" && !studio.bookingDefaults.allowRecurring
      ? service.recurrenceOptions.filter((item) => item === "none")
      : service.recurrenceOptions;
  const validPayments = useMemo(
    () =>
      service.paymentPolicies.filter(
        (item) =>
          (studio.bookingDefaults.allowPayLater || item !== "pay_later") &&
          (recurrence !== "none" ||
            !["installments", "subscription"].includes(item)),
      ),
    [recurrence, service.paymentPolicies, studio.bookingDefaults.allowPayLater],
  );
  const [payment, setPayment] = useState<PaymentPolicy>(validPayments[0]);
  const [slot, setSlot] = useState<string | undefined>(
    initialOffering?.startsAt,
  );
  const [name, setName] = useState(booker?.name || "");
  const [email, setEmail] = useState(booker?.email || "");
  const [phone, setPhone] = useState("");
  const [forMinor, setForMinor] = useState(booker?.forMinor || false);
  const [guardian, setGuardian] = useState(booker?.guardianName || "");
  const [guardianEmail, setGuardianEmail] = useState(
    booker?.guardianEmail || "",
  );
  const [createPortalProfile, setCreatePortalProfile] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [discountCode, setDiscountCode] = useState(initialDiscountCode);
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<{
    reference: string;
    manageUrl?: string;
    demo: boolean;
    startsAt: string;
    portalRequested: boolean;
  }>();
  useEffect(() => {
    if (!validPayments.includes(payment)) setPayment(validPayments[0]);
  }, [payment, validPayments]);
  useEffect(() => {
    if (!booker) return;
    setName(booker.name);
    setEmail(booker.email);
    setForMinor(booker.forMinor);
    setGuardian(booker.guardianName || "");
    setGuardianEmail(booker.guardianEmail || "");
  }, [booker]);
  const demoSlots = useMemo(
    () =>
      service.category === "private"
        ? buildAvailability({
            service,
            rules: store.snapshot.availabilityRules,
            exceptions: store.snapshot.availabilityExceptions,
            lessons: store.snapshot.lessons,
            visibleSlotsPercent:
              store.snapshot.settings.bookingDefaults.visibleSlotsPercent,
            from: new Date(),
            days: 45,
          })
        : offerings
            .filter(
              (offering) =>
                offering.serviceId === service.id &&
                offering.published &&
                remainingCapacity(offering.capacity, offering.enrolled) > 0,
            )
            .map((offering) => ({
              startsAt: offering.startsAt,
              endsAt: new Date(
                new Date(offering.startsAt).getTime() +
                  service.durationMinutes * 60_000,
              ).toISOString(),
              label: `${formatStudioTime(offering.startsAt, visitorTimezone())} · ${remainingCapacity(offering.capacity, offering.enrolled)} spots`,
            })),
    [
      offerings,
      service,
      store.snapshot.availabilityExceptions,
      store.snapshot.availabilityRules,
      store.snapshot.lessons,
      store.snapshot.settings.bookingDefaults.visibleSlotsPercent,
    ],
  );
  const [slots, setSlots] = useState(demoSlots);
  useEffect(() => {
    setSlots(demoSlots);
    if (!live || service.category !== "private") return;
    fetch(
      `/api/v2/public/booking/availability?serviceId=${encodeURIComponent(service.id)}`,
    )
      .then((response) =>
        response.ok
          ? response.json()
          : response
              .json()
              .then((body) => Promise.reject(new Error(body.message))),
      )
      .then((payload: { slots: { startsAt: string; endsAt: string }[] }) =>
        setSlots(
          payload.slots.map((item) => ({
            ...item,
            label: formatStudioTime(item.startsAt, visitorTimezone()),
          })),
        ),
      )
      .catch((reason) =>
        setError(
          reason.message || "Live availability is temporarily unavailable.",
        ),
      );
  }, [demoSlots, live, service.category, service.id]);
  const bookingTimezone = visitorTimezone();
  const dayKey = (value: string | Date) =>
    studioDateKey(value, bookingTimezone);
  const [selectedDay, setSelectedDay] = useState("");
  useEffect(() => {
    const availableDays = [
      ...new Set(slots.map((item) => dayKey(item.startsAt))),
    ];
    if (!availableDays.includes(selectedDay))
      setSelectedDay(availableDays[0] || "");
  }, [selectedDay, slots]);
  const calendarDays = useMemo(
    () =>
      Array.from({ length: 45 }, (_, index) => {
        const value = new Date();
        value.setHours(12, 0, 0, 0);
        value.setDate(value.getDate() + index);
        return value;
      }),
    [],
  );
  const daySlots = slots.filter(
    (item) => dayKey(item.startsAt) === selectedDay,
  );
  const chosen = slots.find((item) => item.startsAt === slot);
  const chosenOffering = offerings.find(
    (item) =>
      item.serviceId === service.id && item.startsAt === chosen?.startsAt,
  );
  const steps: Step[] = ["format", "time", "details", "payment"];

  async function confirm() {
    if (!chosen) return;
    setError("");
    setStatus("saving");
    const timezone = bookingTimezone;
    try {
      if (!live) {
        const booking = store.transact((draft) =>
          createDemoBooking(draft, {
            service,
            offering: chosenOffering,
            startsAt: chosen.startsAt,
            endsAt: chosen.endsAt,
            location,
            recurrence,
            paymentPolicy: payment,
            guestName: name,
            guestEmail: email,
            guestPhone: phone || undefined,
            forMinor,
            guardianName: guardian || undefined,
            guardianEmail: guardianEmail || undefined,
            createPortalProfile,
            timezone,
          }),
        );
        setConfirmed({
          reference: booking.reference,
          manageUrl: `/booking/${booking.manageToken}`,
          demo: true,
          startsAt: chosen.startsAt,
          portalRequested: createPortalProfile,
        });
        setStep("done");
        return;
      }
      const session = isSupabaseConfigured
        ? await supabase?.auth.getSession()
        : undefined;
      const accessToken = session?.data.session?.access_token;
      if (payment === "credits" && !accessToken) {
        window.location.assign(
          `/login?returnTo=${encodeURIComponent(window.location.pathname)}`,
        );
        return;
      }
      const response = await fetch("/api/v2/public/booking/holds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          serviceId: service.id,
          offeringId: chosenOffering?.id,
          startsAt: chosen.startsAt,
          endsAt: chosen.endsAt,
          location,
          recurrence,
          paymentPolicy: payment,
          guestName: name,
          guestEmail: email,
          guestPhone: phone || undefined,
          forMinor,
          guardianName: guardian || undefined,
          guardianEmail: guardianEmail || undefined,
          createPortalProfile,
          timezone,
          occurrenceCount: recurrence === "none" ? undefined : 6,
          termsAccepted: true,
          termsVersion: "2026-08-20",
          discountCode: discountCode.trim() || undefined,
          referralCode: referralCode || undefined,
        }),
      });
      if (!response.ok)
        throw await readApiClientError(
          response,
          "The booking could not be confirmed.",
        );
      const result = await response.json();
      window.sessionStorage.removeItem("studio-reward-code");
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      setConfirmed({
        reference: result.reference,
        manageUrl: result.manageUrl,
        demo: false,
        startsAt: chosen.startsAt,
        portalRequested: createPortalProfile,
      });
      setStep("done");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The booking could not be confirmed.",
      );
    } finally {
      setStatus("idle");
    }
  }

  if (step === "done" && confirmed)
    return (
      <Confirmation
        service={service}
        slot={confirmed.startsAt}
        name={name}
        forMinor={forMinor}
        result={confirmed}
        message={studio.bookingDefaults.confirmationMessage}
      />
    );
  return (
    <section className="booking-flow">
      <aside className="booking-summary">
        <span className="eyebrow">Your selection</span>
        <h1>{service.name}</h1>
        <p>{service.description}</p>
        <dl>
          <div>
            <dt>Duration</dt>
            <dd>{service.durationMinutes} minutes</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>
              {formatMoney(displayedPrice, service.currency)}
              {locationUpcharge > 0 && (
                <small>
                  {" "}
                  includes {formatMoney(
                    locationUpcharge,
                    service.currency,
                  )}{" "}
                  in-person upcharge
                </small>
              )}
            </dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>{locationLabel(location)}</dd>
          </div>
          {chosen && (
            <div>
              <dt>When</dt>
              <dd>
                {formatDate(chosen.startsAt, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </dd>
            </div>
          )}
        </dl>
        {studio.bookingPage.showPolicies && (
          <div className="policy-note">
            <ShieldCheck />
            <p>
              <strong>Plans change.</strong>
              <br />
              {service.policy.cancellationWindowHours}-hour notice ·{" "}
              {service.policy.rescheduleLimit} self-service reschedule.
            </p>
          </div>
        )}
      </aside>
      <div className="booking-step">
        <ol className="stepper" aria-label="Booking progress">
          {steps.map((item, index) => (
            <li
              key={item}
              className={
                item === step
                  ? "active"
                  : steps.indexOf(step) > index
                    ? "complete"
                    : ""
              }
            >
              <span>{steps.indexOf(step) > index ? <Check /> : index + 1}</span>
              {item}
            </li>
          ))}
        </ol>
        {step === "format" && (
          <div className="step-panel">
            <span className="eyebrow">Session setup</span>
            <h2>How would you like to meet?</h2>
            <div className="choice-grid">
              {service.locationOptions.map((item) => (
                <button
                  key={item}
                  className={location === item ? "selected" : ""}
                  onClick={() => setLocation(item)}
                >
                  {item === "google_meet" ? <Video /> : <MapPin />}
                  <strong>{locationLabel(item)}</strong>
                  <small>
                    {item === "google_meet"
                      ? "A private link is added automatically."
                      : `${Number(service.locationPriceAdjustments[item] || 0) > 0 ? `${formatMoney(Number(service.locationPriceAdjustments[item]), service.currency)} upcharge. ` : ""}Location arrives with confirmation.`}
                  </small>
                </button>
              ))}
            </div>
            {recurrenceOptions.length > 1 && (
              <>
                <h3>Booking rhythm</h3>
                <div className="segmented">
                  {recurrenceOptions.map((item) => (
                    <button
                      key={item}
                      className={recurrence === item ? "selected" : ""}
                      onClick={() => setRecurrence(item)}
                    >
                      {item === "none" ? "One time" : item}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button className="booking-primary" onClick={() => setStep("time")}>
              Choose a time <ChevronRight />
            </button>
          </div>
        )}
        {step === "time" && (
          <div className="step-panel">
            <span className="eyebrow">
              {live ? "Live availability" : "Interactive demo availability"}
            </span>
            <h2>Pick your first session</h2>
            <p className="step-copy">
              Times shown in {bookingTimezone.replaceAll("_", " ")}.
            </p>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <div className="booking-calendar" aria-label="Available dates">
              <div className="booking-calendar-weekdays" aria-hidden="true">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (day) => (
                    <span key={day}>{day}</span>
                  ),
                )}
              </div>
              <div className="booking-calendar-grid">
                {Array.from(
                  { length: calendarDays[0]?.getDay() || 0 },
                  (_, index) => (
                    <span key={`blank-${index}`} />
                  ),
                )}
                {calendarDays.map((day) => {
                  const key = dayKey(day);
                  const count = slots.filter(
                    (item) => dayKey(item.startsAt) === key,
                  ).length;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!count}
                      className={selectedDay === key ? "selected" : ""}
                      onClick={() => {
                        setSelectedDay(key);
                        setSlot(undefined);
                      }}
                      aria-label={`${formatCalendarDateKey(key, { weekday: "long", month: "long", day: "numeric", year: undefined })}${count ? `, ${count} times available` : ", unavailable"}`}
                    >
                      <small>
                        {formatCalendarDateKey(key, {
                          month: "short",
                          day: undefined,
                          year: undefined,
                        })}
                      </small>
                      <strong>
                        {formatCalendarDateKey(key, {
                          day: "numeric",
                          month: undefined,
                          year: undefined,
                        })}
                      </strong>
                      {count > 0 && <i>{count}</i>}
                    </button>
                  );
                })}
              </div>
            </div>
            {selectedDay && (
              <h3>
                {formatCalendarDateKey(selectedDay, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: undefined,
                })}
              </h3>
            )}
            <div className="slot-list booking-time-list">
              {daySlots.map((item) => (
                <button
                  key={item.startsAt}
                  className={slot === item.startsAt ? "selected" : ""}
                  onClick={() => setSlot(item.startsAt)}
                >
                  <strong>{item.label}</strong>
                </button>
              ))}
            </div>
            {!slots.length && (
              <p className="inline-error">
                No bookable times are currently available. The studio may be
                fully booked or weekly hours may not be published yet.
              </p>
            )}
            {recurrence !== "none" && slot && (
              <div className="series-preview">
                <CalendarDays />
                <div>
                  <strong>
                    {recurrence === "weekly" ? "Weekly" : "Every other week"}{" "}
                    preview
                  </strong>
                  <small>
                    {seriesDates(slot, recurrence, 6)
                      .map((date) => formatDate(date))
                      .join(" · ")}
                  </small>
                </div>
              </div>
            )}
            <div className="step-actions">
              <button onClick={() => setStep("format")}>Back</button>
              <button
                className="booking-primary"
                disabled={!slot}
                onClick={() => setStep("details")}
              >
                Continue <ChevronRight />
              </button>
            </div>
          </div>
        )}
        {step === "details" && (
          <form
            className="step-panel"
            onSubmit={(event) => {
              event.preventDefault();
              setStep("payment");
            }}
          >
            <span className="eyebrow">Your details</span>
            <h2>Who is this session for?</h2>
            {booker && (
              <p className="portal-notice">
                <strong>Booking from your portal profile.</strong> This lesson
                will be attached to {booker.name} automatically. Change contact
                details in <Link to="/portal/settings">portal settings</Link>.
              </p>
            )}
            <label>
              Student name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                readOnly={Boolean(booker)}
                autoComplete="name"
                placeholder="Full name"
              />
            </label>
            <label>
              Student email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                readOnly={Boolean(booker)}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
            <label>
              Phone number
              {studio.bookingDefaults.requirePhone
                ? " (required)"
                : " (optional)"}
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required={studio.bookingDefaults.requirePhone}
                type="tel"
                autoComplete="tel"
                placeholder="(555) 555-5555"
              />
            </label>
            {!booker && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={forMinor}
                  onChange={(event) => setForMinor(event.target.checked)}
                />
                <span>
                  <strong>I’m booking for a student under 18</strong>
                  <small>
                    A guardian will receive account and payment access.
                  </small>
                </span>
              </label>
            )}
            {forMinor && (
              <>
                <label>
                  Guardian name
                  <input
                    value={guardian}
                    onChange={(event) => setGuardian(event.target.value)}
                    required
                    readOnly={Boolean(booker)}
                    placeholder="Guardian full name"
                  />
                </label>
                <label>
                  Guardian email
                  <input
                    value={guardianEmail}
                    onChange={(event) => setGuardianEmail(event.target.value)}
                    required
                    readOnly={Boolean(booker)}
                    type="email"
                    placeholder="guardian@example.com"
                  />
                </label>
              </>
            )}
            {!booker && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={createPortalProfile}
                  onChange={(event) =>
                    setCreatePortalProfile(event.target.checked)
                  }
                />
                <span>
                  <strong>Create a studio portal profile</strong>
                  <small>
                    After this booking is confirmed, we’ll email{" "}
                    {forMinor
                      ? "separate student and guardian logins"
                      : "the student login"}
                    , each with a generated username and one-time password. Each
                    person creates a private password at first sign-in.
                  </small>
                </span>
              </label>
            )}
            <div className="step-actions">
              <button type="button" onClick={() => setStep("time")}>
                Back
              </button>
              <button className="booking-primary">
                Review payment <ChevronRight />
              </button>
            </div>
          </form>
        )}
        {step === "payment" && (
          <div className="step-panel">
            <span className="eyebrow">Payment &amp; policy</span>
            <h2>Choose how to confirm</h2>
            <div className="payment-list">
              {validPayments.map((item) => (
                <button
                  key={item}
                  className={payment === item ? "selected" : ""}
                  onClick={() => setPayment(item)}
                >
                  <CreditCard />
                  <div>
                    <strong>{item.replaceAll("_", " ")}</strong>
                    <small>
                      {paymentDescription(item, service, displayedPrice)}
                    </small>
                  </div>
                  <span>{payment === item ? <Check /> : ""}</span>
                </button>
              ))}
            </div>
            {booker && (
              <p className="booking-referral">
                If you have an unused $15 referral reward, it will apply
                automatically at checkout. To use a free-lesson reward instead,
                enter its code below.
              </p>
            )}
            {referralCode && (
              <p className="booking-referral">
                Referral link applied. When your paid booking is confirmed, your
                friend can earn a reward.{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setReferralCode("");
                    window.sessionStorage.removeItem("studio-referral-code");
                  }}
                >
                  Remove
                </button>
              </p>
            )}
            <label className="booking-discount">
              Coupon or discount code
              <input
                value={discountCode}
                onChange={(event) => {
                  window.sessionStorage.removeItem("studio-reward-code");
                  setDiscountCode(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9_-]/g, ""),
                  );
                }}
                placeholder="Optional"
                maxLength={40}
              />
              <small>
                Valid codes are applied securely before Stripe opens.
              </small>
            </label>
            {studio.bookingPage.showPolicies && (
              <div className="policy-box">
                <strong>Change policy</strong>
                <p>
                  Change this booking at least{" "}
                  {service.policy.cancellationWindowHours} hours before it
                  starts for {service.policy.settlement.replaceAll("_", " ")}.
                  Changes inside that window are treated as a late cancellation.
                </p>
              </div>
            )}
            <label className="check-row terms-check">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
              />
              <span>
                <strong>
                  {forMinor
                    ? "I am the student’s parent or legal guardian and I agree"
                    : "I agree"}{" "}
                  to the{" "}
                  <Link to="/terms" target="_blank">
                    Terms and Conditions
                  </Link>
                  .
                </strong>
                <small>
                  Effective August 20, 2026. Your acceptance is stored with this
                  booking.
                </small>
              </span>
            </label>
            {!live && (
              <p className="portal-notice">
                <ShieldCheck />
                Demo mode simulates the ledger and confirmation. It will not
                charge a card or send email.
              </p>
            )}
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <div className="step-actions">
              <button onClick={() => setStep("details")}>Back</button>
              <button
                className="booking-primary"
                disabled={status === "saving" || !termsAccepted}
                onClick={confirm}
              >
                {status === "saving"
                  ? "Reserving your time…"
                  : "Confirm booking"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function paymentDescription(
  value: PaymentPolicy,
  service: BookingService,
  totalMinor = service.priceMinor,
) {
  if (value === "pay_now")
    return `${formatMoney(totalMinor, service.currency)} securely by card`;
  if (value === "pay_later")
    return `${formatMoney(totalMinor, service.currency)} balance due after confirmation`;
  if (value === "deposit")
    return `${formatMoney(service.depositMinor, service.currency)} today, balance due later`;
  if (value === "credits")
    return "Use an available lesson credit after sign in";
  if (value === "installments")
    return "Split a fixed series into scheduled payments";
  return "Automatic billing for an ongoing series";
}
function Confirmation({
  service,
  slot,
  name,
  forMinor,
  result,
  message,
}: {
  service: BookingService;
  slot: string;
  name: string;
  forMinor: boolean;
  result: {
    reference: string;
    manageUrl?: string;
    demo: boolean;
    portalRequested: boolean;
  };
  message?: string;
}) {
  return (
    <div className="booking-confirmation">
      <span className="confirmation-mark">
        <Check />
      </span>
      <span className="eyebrow">
        {result.demo ? "Demo booking confirmed" : "Booking confirmed"}
      </span>
      <h1>You’re on the calendar, {name.split(" ")[0] || "there"}.</h1>
      <p>
        {result.demo
          ? "This session now appears throughout the interactive coach and student demo. No card was charged and no email was sent."
          : message ||
            "We sent your confirmation and secure management link. Google Meet details will appear as soon as the calendar invitation is ready."}
      </p>
      {result.portalRequested && (
        <p className="portal-notice">
          {forMinor
            ? "Separate student and guardian portal invitations are being prepared. Each includes a generated username, a one-time password, and clear first-login instructions."
            : "Your portal invitation is being prepared separately. It includes a generated username, a one-time password, and clear first-login instructions."}
        </p>
      )}
      <article>
        <strong>{service.name}</strong>
        <span>{formatDate(slot, { hour: "numeric", minute: "2-digit" })}</span>
        <span>Reference {result.reference}</span>
      </article>
      <div>
        {result.manageUrl && (
          <Link className="booking-primary" to={result.manageUrl}>
            Manage booking
          </Link>
        )}
        <Link to="/book">Book another session</Link>
      </div>
    </div>
  );
}
