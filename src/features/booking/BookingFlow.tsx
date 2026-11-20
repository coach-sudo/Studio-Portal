import {
  CalendarDays,
  Check,
  ChevronRight,
  CreditCard,
  MapPin,
  ShieldCheck,
  Video,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  formatStudioDateTime,
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
import { exactBookingPriceLabel } from "./pricePresentation";
import {
  previewLessonAutopay,
  type AutopayPreviewOptions,
} from "../../domain/lessonAutopay";
import type { BookingContinuation } from "../../domain/recurringOccurrences";
import {
  trainingPaymentLabel,
  type TrainingPaymentState,
} from "../../domain/trainingArrangement";

type Step = "format" | "time" | "details" | "payment" | "done";
type ContinuationReview = {
  starts: string[];
  skipped: string[];
  conflicts: string[];
  timeZone: string;
  currency: string;
  unitMinor: number;
  canPay: boolean;
  invoicesEnabled: boolean;
  automaticPayment?: Omit<AutopayPreviewOptions["policy"], "timeZone">;
  existing: {
    startsAt: string;
    topic: string;
    payment?: TrainingPaymentState;
    balance?: { amountMinor: number; currency: string };
  }[];
};
export function BookingFlow({
  service,
  offerings,
  initialOfferingId,
  live,
  studio,
  booker,
  continuation,
  initialReferralCode,
  initialDiscountCode,
}: {
  service: BookingService;
  offerings: ServiceOffering[];
  initialOfferingId?: string;
  live: boolean;
  studio: PublicStudio;
  booker?: AuthenticatedBooker;
  continuation?: BookingContinuation;
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
  const [step, setStep] = useState<Step>(
    initialOffering || continuation ? "time" : "format",
  );
  const [location, setLocation] = useState<MeetingProvider>(
    service.defaultLocation,
  );
  const locationUpcharge = Number(
    service.locationPriceAdjustments[location] ?? 0,
  );
  const displayedPrice = service.priceMinor + locationUpcharge;
  const [recurrence, setRecurrence] = useState<RecurrenceCadence>(
    continuation?.cadence ??
      (service.category === "course" ? "weekly" : "none"),
  );
  const [skippedStarts, setSkippedStarts] = useState<string[]>([]);
  const bookingTimezone = visitorTimezone();
  const recurrenceTimezone = studio.timezone || bookingTimezone;
  const horizon = Date.now() + service.bookingHorizonDays * 86400000;
  const maximumCount = continuation
    ? seriesDates(
        continuation.startsAt,
        continuation.cadence,
        52,
        recurrenceTimezone,
      ).filter((date) => Date.parse(date) <= horizon).length
    : 6;
  const [proposedCount, setProposedCount] = useState(
    Math.max(2, Math.min(6, maximumCount)),
  );
  const recurrenceOptions =
    service.category === "private" && !studio.bookingDefaults.allowRecurring
      ? service.recurrenceOptions.filter((item) => item === "none")
      : service.recurrenceOptions;
  const validPayments = useMemo(
    () =>
      service.paymentPolicies.filter(
        (item) =>
          (!continuation || item === "pay_later") &&
          (studio.bookingDefaults.allowPayLater || item !== "pay_later") &&
          (!skippedStarts.length ||
            !["subscription", "deposit"].includes(item)) &&
          (recurrence !== "none" ||
            !["installments", "subscription"].includes(item)),
      ),
    [
      continuation,
      recurrence,
      service.paymentPolicies,
      studio.bookingDefaults.allowPayLater,
      skippedStarts.length,
    ],
  );
  const [payment, setPayment] = useState<PaymentPolicy>(validPayments[0]);
  const [slot, setSlot] = useState<string | undefined>(
    continuation?.startsAt ?? initialOffering?.startsAt,
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
  const [scheduleReview, setScheduleReview] = useState<ContinuationReview>();
  const [proposedLead, setProposedLead] = useState<number>();
  const bookingRequest = useRef<{ body: string; key: string }>(undefined);
  const [confirmed, setConfirmed] = useState<{
    reference: string;
    manageUrl?: string;
    demo: boolean;
    startsAt: string;
    portalRequested: boolean;
    paymentReviewUrl?: string;
    followUpRequired?: boolean;
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
  const [slots, setSlots] = useState(continuation ? [] : demoSlots);
  useEffect(() => {
    setSlots(continuation ? [] : demoSlots);
    if (!live || service.category !== "private") return;
    const request = new URLSearchParams({ serviceId: service.id });
    if (continuation) request.set("from", continuation.startsAt);
    fetch(`/api/v2/public/booking/availability?${request}`)
      .then((response) =>
        response.ok
          ? response.json()
          : response
              .json()
              .then((body) => Promise.reject(new Error(body.message))),
      )
      .then((payload: { slots: { startsAt: string; endsAt: string }[] }) =>
        setSlots(
          payload.slots
            .filter(
              (item) =>
                !continuation ||
                Date.parse(item.startsAt) === Date.parse(continuation.startsAt),
            )
            .map((item) => ({
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
  }, [continuation, demoSlots, live, service.category, service.id]);
  const canSkipDates =
    service.category === "private" &&
    service.paymentPolicies.some(
      (policy) =>
        policy === "pay_now" ||
        policy === "credits" ||
        (policy === "pay_later" && studio.bookingDefaults.allowPayLater),
    );
  const proposedStarts =
    recurrence !== "none" && slot && service.category === "private"
      ? seriesDates(slot, recurrence, proposedCount, recurrenceTimezone)
      : [];
  const selectedDates = proposedStarts.filter(
    (date) => !skippedStarts.includes(date),
  );
  useEffect(() => setSkippedStarts([]), [slot, recurrence, proposedCount]);
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
        const value = continuation
          ? new Date(continuation.startsAt)
          : new Date();
        value.setHours(12, 0, 0, 0);
        value.setDate(value.getDate() + index);
        return value;
      }),
    [continuation],
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

  async function confirm(reviewOnly = false) {
    if (!chosen || (proposedStarts.length > 0 && !selectedDates.length)) return;
    if (
      live &&
      continuation &&
      !reviewOnly &&
      (!scheduleReview || scheduleReview.conflicts.length)
    )
      return;
    setError("");
    setStatus("saving");
    const timezone = recurrenceTimezone;
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
            proposedOccurrenceCount: proposedCount,
            skippedOccurrenceStarts: skippedStarts,
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
          startsAt: booking.startsAt,
          portalRequested: createPortalProfile,
        });
        setStep("done");
        return;
      }
      const session = isSupabaseConfigured
        ? await supabase?.auth.getSession()
        : undefined;
      const accessToken = session?.data.session?.access_token;
      if ((payment === "credits" || continuation) && !accessToken) {
        window.location.assign(
          `/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
        return;
      }
      const body = JSON.stringify({
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
        occurrenceCount: recurrence === "none" ? undefined : proposedCount,
        skippedOccurrenceStarts: skippedStarts.length
          ? skippedStarts
          : undefined,
        continuation: continuation && {
          sourceSeriesId: continuation.sourceSeriesId,
          studentId: continuation.studentId,
        },
        reviewOnly: reviewOnly || undefined,
        reviewUnitMinor: !reviewOnly ? scheduleReview?.unitMinor : undefined,
        termsAccepted: true,
        termsVersion: "2026-08-20",
        discountCode: discountCode.trim() || undefined,
        referralCode: referralCode || undefined,
      });
      if (!reviewOnly && bookingRequest.current?.body !== body)
        bookingRequest.current = { body, key: crypto.randomUUID() };
      const response = await fetch("/api/v2/public/booking/holds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": reviewOnly
            ? crypto.randomUUID()
            : bookingRequest.current!.key,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body,
      });
      if (!response.ok)
        throw await readApiClientError(
          response,
          "The booking could not be confirmed.",
        );
      const result = await response.json();
      if (reviewOnly) {
        if (result.status !== "review")
          throw new Error("The proposed dates could not be reviewed.");
        setScheduleReview(result);
        setProposedLead(undefined);
        return;
      }
      window.sessionStorage.removeItem("studio-reward-code");
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (result.status !== "confirmed")
        throw new Error(
          "The booking is still processing. Check your schedule before trying again.",
        );
      const paymentReview =
        continuation && scheduleReview?.canPay && result.invoicePrepared
          ? new URLSearchParams({
              recurring: "arrangements",
              student: continuation.studentId,
              booked: result.bookingId,
              ...(proposedLead === undefined
                ? {}
                : { lead: String(proposedLead) }),
            })
          : undefined;
      setConfirmed({
        reference: result.reference,
        manageUrl: result.manageUrl,
        demo: false,
        startsAt: selectedDates[0] ?? chosen.startsAt,
        portalRequested: createPortalProfile,
        paymentReviewUrl: paymentReview
          ? `/portal/payments?${paymentReview}`
          : undefined,
        followUpRequired: result.followUpRequired,
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
              <span aria-live="polite">
                {exactBookingPriceLabel(displayedPrice, service.currency)}
              </span>
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
                      {item === "none"
                        ? "One time"
                        : item === "weekly"
                          ? "Weekly"
                          : "Every other week"}
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
              <div className="inline-error">
                <p role="alert">{error}</p>
                {proposedStarts.length > 0 && (
                  <button type="button" onClick={() => setStep("time")}>
                    Review dates
                  </button>
                )}
              </div>
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
            {proposedStarts.length > 0 && (
              <div className="series-preview">
                <CalendarDays aria-hidden="true" />
                <div>
                  <strong>
                    {recurrence === "weekly" ? "Weekly" : "Every other week"}{" "}
                    preview
                  </strong>
                  {canSkipDates ? (
                    <fieldset className="series-date-picker">
                      <legend>Dates to book</legend>
                      {continuation && (
                        <label htmlFor="continuation-proposed-count">
                          Number of proposed lessons
                          <select
                            id="continuation-proposed-count"
                            value={proposedCount}
                            onChange={(event) =>
                              setProposedCount(Number(event.target.value))
                            }
                          >
                            {Array.from(
                              { length: Math.max(1, maximumCount - 1) },
                              (_, index) => index + 2,
                            ).map((count) => (
                              <option key={count} value={count}>
                                {count}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {proposedStarts.map((date, index) => (
                        <label
                          className="check-row"
                          key={date}
                          htmlFor={`series-date-${index}`}
                        >
                          <input
                            id={`series-date-${index}`}
                            type="checkbox"
                            checked={!skippedStarts.includes(date)}
                            onChange={(event) =>
                              setSkippedStarts((current) =>
                                event.target.checked
                                  ? current.filter((item) => item !== date)
                                  : [...current, date],
                              )
                            }
                          />
                          <span>
                            {formatDate(date, {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        </label>
                      ))}
                      <small aria-live="polite">
                        {selectedDates.length} to book · {skippedStarts.length}{" "}
                        skipped
                      </small>
                    </fieldset>
                  ) : (
                    <small>
                      {proposedStarts
                        .map((date) => formatDate(date))
                        .join(" · ")}
                    </small>
                  )}
                </div>
              </div>
            )}
            <div className="step-actions">
              {continuation ? (
                <Link
                  className="button-link"
                  to={`/portal/bookings?student=${encodeURIComponent(continuation.studentId)}`}
                >
                  Keep my existing schedule
                </Link>
              ) : (
                <button onClick={() => setStep("format")}>Back</button>
              )}
              <button
                className="booking-primary"
                disabled={
                  !slot || (proposedStarts.length > 0 && !selectedDates.length)
                }
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
            <h2>
              {continuation
                ? "Review lessons and payments"
                : "Choose how to confirm"}
            </h2>
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
            {skippedStarts.length > 0 && !scheduleReview && (
              <div className="policy-box">
                <strong>
                  {selectedDates.length} lessons to book ·{" "}
                  {skippedStarts.length} dates skipped
                </strong>
                <p>
                  {selectedDates.map((date) => formatDate(date)).join(" · ")}
                </p>
                {payment !== "credits" && (
                  <p>
                    {formatMoney(
                      displayedPrice * selectedDates.length,
                      service.currency,
                    )}{" "}
                    before any applied discounts.
                  </p>
                )}
                <p>Skipped dates will have no booking or payment.</p>
              </div>
            )}
            {continuation && (
              <p>
                Confirm the new dates first. An authorized payer can review and
                authorize automatic payments separately after booking.
              </p>
            )}
            {scheduleReview && (
              <ContinuationReviewDetails
                review={scheduleReview}
                leadDays={proposedLead}
                selectLeadDays={setProposedLead}
              />
            )}
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
              <button
                onClick={() => {
                  setScheduleReview(undefined);
                  setStep("details");
                }}
              >
                Back
              </button>
              {live && continuation && !scheduleReview && (
                <button
                  className="booking-primary"
                  disabled={status === "saving"}
                  onClick={() => void confirm(true)}
                >
                  {status === "saving"
                    ? "Checking dates…"
                    : "Check proposed dates"}
                </button>
              )}
              {(!live || !continuation || scheduleReview) && (
                <button
                  className="booking-primary"
                  disabled={
                    status === "saving" ||
                    !termsAccepted ||
                    Boolean(scheduleReview?.conflicts.length)
                  }
                  onClick={() => void confirm()}
                >
                  {status === "saving"
                    ? "Reserving your time…"
                    : "Confirm booking"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ContinuationReviewDetails({
  review,
  leadDays,
  selectLeadDays,
}: {
  review: ContinuationReview;
  leadDays?: number;
  selectLeadDays: (value: number | undefined) => void;
}) {
  const date = (value: string) => formatStudioDateTime(value, review.timeZone);
  const leadField = useId();
  const timing = review.automaticPayment;
  const automatic =
    timing &&
    Number.isInteger(timing.minimumLeadDays) &&
    Number.isInteger(timing.maximumLeadDays) &&
    timing.minimumLeadDays >= 0 &&
    timing.maximumLeadDays >= timing.minimumLeadDays &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(timing.chargeAtLocal) &&
    Number.isSafeInteger(timing.maximumLessonMinor) &&
    timing.maximumLessonMinor > 0
      ? timing
      : undefined;
  const forecast =
    automatic && leadDays !== undefined
      ? previewLessonAutopay(
          { ...automatic, timeZone: review.timeZone },
          {
            scope: "existing",
            leadDays,
            existingLessonIds: review.starts,
            effectiveAt: new Date().toISOString(),
            currency: review.currency,
            maximumLessonMinor: automatic.maximumLessonMinor,
          },
          review.starts.map((startsAt) => ({
            id: startsAt,
            startsAt,
            createdAt: new Date().toISOString(),
            status: "scheduled",
            payment: "unpaid",
            obligation: {
              currency: review.currency,
              amountMinor: review.unitMinor,
              eligible: review.unitMinor > 0,
            },
          })),
        )
      : [];
  return (
    <div className="policy-box">
      <h3>Already scheduled</h3>
      {review.existing.length ? (
        <ul>
          {review.existing.map((item, index) => (
            <li key={`${item.startsAt}-${index}`}>
              {date(item.startsAt)} · {item.topic}
              {item.payment && ` · ${trainingPaymentLabel[item.payment]}`}
              {item.payment === "unpaid" &&
                item.balance &&
                ` · ${formatMoney(item.balance.amountMinor, item.balance.currency)}`}
            </li>
          ))}
        </ul>
      ) : (
        <p>No upcoming lessons to keep.</p>
      )}
      <h3>Dates to add</h3>
      <ul>
        {review.starts.map((item) => (
          <li key={item}>{date(item)}</li>
        ))}
      </ul>
      {review.skipped.length > 0 && (
        <>
          <h3>Dates you skipped</h3>
          <ul>
            {review.skipped.map((item) => (
              <li key={item}>{date(item)}</li>
            ))}
          </ul>
        </>
      )}
      {review.conflicts.length > 0 && (
        <div role="alert">
          <h3>Dates with conflicts</h3>
          <ul>
            {review.conflicts.map((item) => (
              <li key={item}>{date(item)}</li>
            ))}
          </ul>
          <p>Go back and skip those dates before confirming.</p>
        </div>
      )}
      <h3>Payment review</h3>
      <p>
        {formatMoney(review.unitMinor, review.currency)} per lesson ·{" "}
        {formatMoney(review.unitMinor * review.starts.length, review.currency)}{" "}
        before discounts or coverage.
      </p>
      <p>
        {review.canPay
          ? "You are the designated payer."
          : "The designated payer manages lesson payments."}
      </p>
      <p>
        {review.canPay && review.invoicesEnabled
          ? "After confirming the booking, you can review the exact balances and payment dates before authorizing automatic payments."
          : "The booking is confirmed under the studio’s pay-later policy."}
      </p>
      {automatic && (
        <details>
          <summary>Preview automatic payment timing</summary>
          <label htmlFor={leadField}>
            Days before each eligible lesson
            <input
              id={leadField}
              type="number"
              min={automatic.minimumLeadDays}
              max={automatic.maximumLeadDays}
              value={leadDays ?? ""}
              inputMode="numeric"
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                selectLeadDays(
                  Number.isInteger(value) &&
                    value >= automatic.minimumLeadDays &&
                    value <= automatic.maximumLeadDays
                    ? value
                    : undefined,
                );
              }}
            />
          </label>
          <p>
            These estimates use the proposed dates and the full lesson price.
            You’ll review the final amounts and authorize payments after
            booking.
          </p>
          {forecast.length > 0 && (
            <ul>
              {forecast.map((item) => (
                <li key={item.lessonId}>
                  {date(item.lessonId)} ·{" "}
                  {item.state === "review"
                    ? item.reason
                    : item.state === "pay_now"
                      ? "Pay now separately"
                      : date(item.payAt)}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
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
  if (value === "credits") return "Use an existing package after sign in";
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
    paymentReviewUrl?: string;
    followUpRequired?: boolean;
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
      {result.followUpRequired && (
        <p role="status">
          Your booking was confirmed. Open your schedule for current details.
        </p>
      )}
      {result.paymentReviewUrl && (
        <p>
          Your booking is complete. Review any eligible amounts before
          authorizing automatic payments.
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
        {result.paymentReviewUrl && (
          <Link className="booking-primary" to={result.paymentReviewUrl}>
            Review automatic payments
          </Link>
        )}
        <Link to="/book">Book another session</Link>
      </div>
    </div>
  );
}
