import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildAvailability,
  cancelDemoBooking,
  isLateChange,
} from "../../domain/booking";
import type { Booking, BookingService } from "../../domain/model";
import { formatStudioTime } from "../../domain/presentation";
import { useStudioStore } from "../../state/StudioStore";

import { BookingHeader } from "./BookingHeader";
import {
  formatDate,
  locationLabel,
  visitorTimezone,
  type PublicStudio,
} from "./PublicBooking.shared";

export function ManageBooking({
  token,
  services,
  studio,
}: {
  token: string;
  services: BookingService[];
  studio: PublicStudio;
}) {
  const store = useStudioStore();
  const demoBooking = store.snapshot.bookings.find(
    (item) => item.manageToken === token,
  );
  const [booking, setBooking] = useState<Booking | undefined>(demoBooking);
  const [loading, setLoading] = useState(!demoBooking);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"idle" | "cancel" | "reschedule">("idle");
  const [selectedSlot, setSelectedSlot] = useState<string>();
  const live = !token.startsWith("demo-");
  useEffect(() => {
    if (!live) {
      setBooking(
        store.snapshot.bookings.find((item) => item.manageToken === token),
      );
      setLoading(false);
      return;
    }
    let cancelled = false,
      attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const response = await fetch(
          `/api/v2/public/booking/manage?token=${encodeURIComponent(token)}`,
        );
        if (!response.ok) throw new Error();
        const row = await response.json();
        if (!cancelled) {
          setBooking({
            id: row.id,
            reference: row.reference,
            serviceId: row.service_id,
            studentId: row.student_id,
            guestName: row.guest_name,
            guestEmail: "",
            forMinor: false,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            timezone: row.timezone,
            location: row.location,
            status: row.status,
            paymentPolicy: row.payment_policy,
            paymentStatus: row.payment_status,
            totalMinor: Number(row.total_minor),
            paidMinor: Number(row.paid_minor),
            currency: row.currency,
            policySnapshot: row.policy_snapshot,
            rescheduleCount: row.reschedule_count,
            studioId: "",
            version: row.version,
            updatedAt: row.updated_at ?? new Date().toISOString(),
          });
          setLoading(false);
          if (["held", "pending_payment"].includes(row.status) && attempts < 24)
            setTimeout(poll, 5000);
        }
      } catch {
        if (!cancelled) {
          setMessage("This management link is invalid or expired.");
          setLoading(false);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [live, store.snapshot.bookings, token]);
  const service = booking
    ? (services.find((item) => item.id === booking.serviceId) ??
      store.snapshot.bookingServices.find(
        (item) => item.id === booking.serviceId,
      ))
    : undefined;
  const demoManageSlots = useMemo(
    () =>
      service && booking
        ? buildAvailability({
            service,
            rules: store.snapshot.availabilityRules,
            exceptions: store.snapshot.availabilityExceptions,
            lessons: store.snapshot.lessons.filter(
              (item) =>
                !store.snapshot.lessonParticipants.some(
                  (part) =>
                    part.bookingId === booking.id && part.lessonId === item.id,
                ),
            ),
            visibleSlotsPercent:
              store.snapshot.settings.bookingDefaults.visibleSlotsPercent,
            from: new Date(),
            days: 21,
          }).slice(0, 8)
        : [],
    [
      booking,
      service,
      store.snapshot.availabilityExceptions,
      store.snapshot.availabilityRules,
      store.snapshot.lessonParticipants,
      store.snapshot.lessons,
      store.snapshot.settings.bookingDefaults.visibleSlotsPercent,
    ],
  );
  const [slots, setSlots] = useState(demoManageSlots);
  useEffect(() => {
    setSlots(demoManageSlots);
    if (!live || !service) return;
    fetch(
      `/api/v2/public/booking/availability?serviceId=${encodeURIComponent(service.id)}`,
    )
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload: { slots: { startsAt: string; endsAt: string }[] }) =>
        setSlots(
          payload.slots.slice(0, 8).map((item) => ({
            ...item,
            label: formatStudioTime(item.startsAt, visitorTimezone()),
          })),
        ),
      )
      .catch(() =>
        setMessage(
          "Live alternatives could not be loaded. Your current booking is unchanged.",
        ),
      );
  }, [demoManageSlots, live, service]);

  async function command(action: "cancel" | "reschedule") {
    if (!booking) return;
    setMessage("");
    try {
      let updated: Booking;
      if (!live) {
        updated = store.transact((draft) => {
          const target = draft.bookings.find((item) => item.id === booking.id)!;
          const late = isLateChange(
            target.startsAt,
            target.policySnapshot.cancellationWindowHours,
          );
          if (action === "cancel") cancelDemoBooking(draft, target, { late });
          else {
            const next = slots.find((item) => item.startsAt === selectedSlot);
            if (
              !next ||
              target.rescheduleCount >= target.policySnapshot.rescheduleLimit
            )
              throw new Error(
                "This booking has no self-service reschedules remaining.",
              );
            const shift =
              new Date(next.startsAt).getTime() -
              new Date(target.startsAt).getTime();
            target.startsAt = next.startsAt;
            target.endsAt = next.endsAt;
            target.rescheduleCount += 1;
            draft.lessons
              .filter((lesson) =>
                draft.lessonParticipants.some(
                  (part) =>
                    part.bookingId === target.id && part.lessonId === lesson.id,
                ),
              )
              .forEach((lesson) => {
                lesson.startsAt = new Date(
                  new Date(lesson.startsAt).getTime() + shift,
                ).toISOString();
                lesson.endsAt = new Date(
                  new Date(lesson.endsAt).getTime() + shift,
                ).toISOString();
                lesson.version += 1;
                lesson.updatedAt = new Date().toISOString();
              });
          }
          if (action !== "cancel") {
            target.version += 1;
            target.updatedAt = new Date().toISOString();
          }
          return structuredClone(target);
        });
      } else {
        const next = slots.find((item) => item.startsAt === selectedSlot);
        const response = await fetch(
          `/api/v2/public/booking/manage?token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              command: action,
              ...(action === "reschedule" && next
                ? { startsAt: next.startsAt, endsAt: next.endsAt }
                : {}),
            }),
          },
        );
        const row = await response.json();
        if (!response.ok)
          throw new Error(row.message || "That change is not permitted.");
        updated = {
          ...booking,
          status: row.status,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          rescheduleCount: row.reschedule_count,
          version: row.version,
        };
      }
      setBooking(updated);
      setMode("idle");
      setSelectedSlot(undefined);
      setMessage(
        action === "cancel"
          ? live
            ? "Booking cancelled. The policy settlement is processing."
            : "Booking cancelled. The demo settlement has been applied."
          : "Your booking has been rescheduled.",
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "That change could not be completed.",
      );
    }
  }

  if (loading)
    return (
      <main className="booking-public">
        <BookingHeader back studio={studio} />
        <div className="loading">Checking booking status…</div>
      </main>
    );
  if (!booking || !service)
    return (
      <main className="booking-public">
        <BookingHeader back studio={studio} />
        <section className="public-empty">
          <div>
            <TriangleAlert />
            <h1>Management link unavailable</h1>
            <p>{message || "This link is invalid or expired."}</p>
            <Link to="/book">Return to booking</Link>
          </div>
        </section>
      </main>
    );
  return (
    <main className="booking-public manage-page">
      <BookingHeader back studio={studio} />
      <section>
        <span className="eyebrow">Secure booking management</span>
        <h1>{service.name}</h1>
        {message && (
          <p className="portal-notice" role="status">
            <ShieldCheck />
            {message}
          </p>
        )}
        <div className="manage-card">
          <div>
            <span
              className={`status ${booking.status === "confirmed" ? "good" : "warn"}`}
            >
              {booking.status.replaceAll("_", " ")}
            </span>
            <strong>
              {formatDate(booking.startsAt, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </strong>
            <small>
              {locationLabel(booking.location)} · {booking.reference}
            </small>
          </div>
          <dl>
            <div>
              <dt>Student</dt>
              <dd>{booking.guestName}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{booking.paymentStatus.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>
                {booking.policySnapshot.cancellationWindowHours}-hour notice ·{" "}
                {Math.max(
                  0,
                  booking.policySnapshot.rescheduleLimit -
                    booking.rescheduleCount,
                )}{" "}
                reschedules left
              </dd>
            </div>
          </dl>
          {booking.status === "confirmed" ? (
            <>
              {mode === "reschedule" && (
                <div className="slot-list">
                  {slots.map((item) => (
                    <button
                      key={item.startsAt}
                      className={
                        selectedSlot === item.startsAt ? "selected" : ""
                      }
                      onClick={() => setSelectedSlot(item.startsAt)}
                    >
                      <span>{formatDate(item.startsAt)}</span>
                      <strong>{item.label}</strong>
                    </button>
                  ))}
                </div>
              )}
              {mode === "cancel" && (
                <div className="cancelled-note">
                  {isLateChange(
                    booking.startsAt,
                    booking.policySnapshot.cancellationWindowHours,
                  )
                    ? "This is inside the cancellation window. No automatic refund will be issued."
                    : `This cancellation is eligible for ${booking.policySnapshot.settlement.replaceAll("_", " ")}.`}
                </div>
              )}
              <div className="manage-actions">
                {mode === "reschedule" ? (
                  <>
                    <button onClick={() => setMode("idle")}>
                      Keep current time
                    </button>
                    <button
                      className="booking-primary"
                      disabled={!selectedSlot}
                      onClick={() => command("reschedule")}
                    >
                      Confirm new time
                    </button>
                  </>
                ) : mode === "cancel" ? (
                  <>
                    <button onClick={() => setMode("idle")}>
                      Keep booking
                    </button>
                    <button
                      className="booking-primary"
                      onClick={() => command("cancel")}
                    >
                      Confirm cancellation
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="booking-primary"
                      disabled={
                        booking.rescheduleCount >=
                        booking.policySnapshot.rescheduleLimit
                      }
                      onClick={() => setMode("reschedule")}
                    >
                      Reschedule
                    </button>
                    <button onClick={() => setMode("cancel")}>
                      Cancel booking
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="cancelled-note">
              This booking is {booking.status.replaceAll("_", " ")}. Any
              eligible settlement is being processed.
            </div>
          )}
        </div>
        <p className="secure-note">
          <ShieldCheck />
          This link only grants access to this booking. Sign in to see your full
          studio history.
        </p>
      </section>
    </main>
  );
}
