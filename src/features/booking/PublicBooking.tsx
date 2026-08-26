import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  MapPin,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Video,
} from "lucide-react";
import { applyStudioBranding } from "../../lib/branding";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  buildAvailability,
  cancelDemoBooking,
  isLateChange,
  remainingCapacity,
  seriesDates,
} from "../../domain/booking";
import { formatMoney } from "../../domain/finance";
import type {
  Booking,
  BookingService,
  MeetingProvider,
  PaymentPolicy,
  RecurrenceCadence,
  ServiceOffering,
  StudioSnapshot,
} from "../../domain/model";
import { isDemoMode, isSupabaseConfigured, supabase } from "../../lib/supabase";
import { useStudioStore } from "../../state/StudioStore";

const formatDate = (value: string, options: Intl.DateTimeFormatOptions = {}) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...options,
  }).format(new Date(value));
const locationLabel = (value: MeetingProvider) =>
  value === "google_meet" ? "Google Meet" : "In person";
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
type PublicStudio = {
  name: string;
  coachName?: string;
  branding: StudioSnapshot["settings"]["branding"];
  bookingCopy: StudioSnapshot["settings"]["bookingCopy"];
  bookingPage: StudioSnapshot["settings"]["bookingPage"];
  bookingDefaults: StudioSnapshot["settings"]["bookingDefaults"];
  contactEmail?: string;
};
type AuthenticatedBooker = {
  studentId: string;
  name: string;
  email: string;
  forMinor: boolean;
  guardianName?: string;
  guardianEmail?: string;
};

const mapService = (row: any): BookingService => ({
  id: row.id,
  version: row.version,
  updatedAt: row.updated_at,
  studioId: row.studio_id ?? "",
  slug: row.slug,
  name: row.name,
  description: row.description,
  category: row.category,
  durationMinutes: row.duration_minutes,
  priceMinor: Number(row.price_minor),
  depositMinor: Number(row.deposit_minor),
  depositType:
    row.deposit_type ?? (Number(row.deposit_minor) > 0 ? "fixed" : "none"),
  depositPercentage:
    row.deposit_percentage == null ? undefined : Number(row.deposit_percentage),
  balanceDueTiming: row.balance_due_timing ?? "at_booking",
  balanceDueHours: row.balance_due_hours ?? undefined,
  autoChargeBalance: Boolean(row.auto_charge_balance),
  currency: row.currency,
  capacity: row.capacity,
  locationOptions: row.location_options,
  defaultLocation: row.default_location,
  recurrenceOptions: row.recurrence_options,
  paymentPolicies: row.payment_policies,
  bufferBeforeMinutes: row.buffer_before_minutes,
  bufferAfterMinutes: row.buffer_after_minutes,
  bufferByLocation: row.buffer_by_location ?? {},
  locationPriceAdjustments: row.location_price_adjustments ?? {},
  minimumNoticeHours: row.minimum_notice_hours,
  bookingHorizonDays: row.booking_horizon_days,
  slotIntervalMinutes: row.slot_interval_minutes,
  policy: row.policy,
  policyVersion: row.policy_version ?? 1,
  published: true,
});
const mapOffering = (row: any): ServiceOffering => ({
  id: row.id,
  version: row.version,
  updatedAt: row.updated_at,
  studioId: row.studio_id ?? "",
  serviceId: row.service_id,
  title: row.title,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  enrollmentClosesAt: row.enrollment_closes_at,
  capacity: row.capacity,
  enrolled: row.enrolled,
  lessonIds: row.lesson_ids,
  published: true,
  description: row.description || undefined,
  meetingUrl: row.meeting_url || undefined,
  resourceLinks: row.resource_links ?? [],
});

interface DemoBookingInput {
  service: BookingService;
  offering?: ServiceOffering;
  startsAt: string;
  endsAt: string;
  location: MeetingProvider;
  recurrence: RecurrenceCadence;
  paymentPolicy: PaymentPolicy;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  forMinor: boolean;
  guardianName?: string;
  guardianEmail?: string;
  timezone: string;
}

function createDemoBooking(draft: StudioSnapshot, input: DemoBookingInput) {
  const now = new Date().toISOString();
  let student = draft.students.find(
    (item) => item.email?.toLowerCase() === input.guestEmail.toLowerCase(),
  );
  if (!student) {
    student = {
      id: uid("student"),
      studioId: draft.studioId,
      fullName: input.guestName,
      email: input.guestEmail.toLowerCase(),
      status: "lead",
      isMinor: input.forMinor,
      guardianName: input.guardianName,
      guardianEmail: input.guardianEmail,
      portalEnabled: true,
      actorPageEligible: false,
      version: 1,
      updatedAt: now,
    };
    draft.students.push(student);
  }
  const occurrenceCount = input.offering
    ? Math.max(1, input.offering.lessonIds.length)
    : input.recurrence === "none"
      ? 1
      : input.paymentPolicy === "subscription"
        ? 12
        : 6;
  const totalMinor =
    input.service.category === "private" &&
    input.recurrence !== "none" &&
    input.paymentPolicy !== "subscription"
      ? input.service.priceMinor * occurrenceCount
      : input.service.priceMinor;
  let paidMinor =
    input.paymentPolicy === "pay_now"
      ? totalMinor
      : input.paymentPolicy === "deposit"
        ? input.service.depositMinor
        : input.paymentPolicy === "credits"
          ? totalMinor
          : input.paymentPolicy === "installments"
            ? Math.floor(totalMinor / occurrenceCount)
            : input.paymentPolicy === "subscription"
              ? input.service.priceMinor
              : 0;
  let creditEntry: StudioSnapshot["creditEntries"][number] | undefined;
  if (input.paymentPolicy === "credits") {
    const packages = draft.packages.filter(
      (item) => item.studentId === student!.id,
    );
    const available = packages.find(
      (item) =>
        draft.creditEntries
          .filter((entry) => entry.packageId === item.id)
          .reduce((sum, entry) => sum + entry.quantity, 0) >= occurrenceCount,
    );
    if (!available)
      throw new Error(
        "This demo student does not have enough lesson credits. Use maya@example.com or choose another payment option.",
      );
    creditEntry = {
      id: uid("credit"),
      packageId: available.id,
      kind: "reservation",
      quantity: -occurrenceCount,
      reason: "Interactive demo booking",
      createdAt: now,
    };
    draft.creditEntries.push(creditEntry);
  }
  const seriesId =
    input.service.category === "private" && input.recurrence !== "none"
      ? uid("series")
      : undefined;
  if (seriesId)
    draft.recurringSeries.push({
      id: seriesId,
      studioId: draft.studioId,
      serviceId: input.service.id,
      studentId: student.id,
      kind: input.paymentPolicy === "subscription" ? "ongoing" : "fixed",
      cadence: input.recurrence as "weekly" | "biweekly",
      status: "active",
      startsOn: input.startsAt,
      occurrenceCount:
        input.paymentPolicy === "subscription" ? undefined : occurrenceCount,
      paymentPolicy: input.paymentPolicy,
      nextBillingAt:
        input.paymentPolicy === "subscription"
          ? seriesDates(
              input.startsAt,
              input.recurrence as "weekly" | "biweekly",
              2,
              input.timezone,
            )[1]
          : undefined,
      recurrenceRule: {
        intervalWeeks: input.recurrence === "biweekly" ? 2 : 1,
        slots: [],
      },
      studentCanModify: false,
      discountMinor: 0,
      meetingProvider: input.location,
      version: 1,
      updatedAt: now,
    });
  if (input.offering) {
    const offering = draft.serviceOfferings.find(
      (item) => item.id === input.offering!.id,
    );
    if (!offering || offering.enrolled >= offering.capacity)
      throw new Error("That class is sold out.");
    offering.enrolled += 1;
    offering.version += 1;
    offering.updatedAt = now;
  }
  const manageToken = `demo-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const booking: Booking = {
    id: uid("booking"),
    studioId: draft.studioId,
    reference: `SS-${Math.floor(100000 + Math.random() * 899999)}`,
    serviceId: input.service.id,
    offeringId: input.offering?.id,
    seriesId,
    studentId: student.id,
    guestName: input.guestName,
    guestEmail: input.guestEmail.toLowerCase(),
    guardianName: input.guardianName,
    guardianEmail: input.guardianEmail,
    forMinor: input.forMinor,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timezone: input.timezone,
    location: input.location,
    status: "confirmed",
    paymentPolicy: input.paymentPolicy,
    paymentStatus:
      input.paymentPolicy === "pay_later"
        ? "due"
        : input.paymentPolicy === "deposit" ||
            input.paymentPolicy === "installments"
          ? "partially_paid"
          : "paid",
    totalMinor,
    paidMinor,
    currency: input.service.currency,
    policySnapshot: structuredClone(input.service.policy),
    rescheduleCount: 0,
    manageToken,
    version: 1,
    updatedAt: now,
  };
  draft.bookings.push(booking);

  const occurrenceStarts = input.offering
    ? seriesDates(
        input.startsAt,
        "weekly",
        Math.max(1, input.offering.lessonIds.length),
        input.timezone,
      )
    : input.recurrence === "none"
      ? [input.startsAt]
      : seriesDates(
          input.startsAt,
          input.recurrence as "weekly" | "biweekly",
          occurrenceCount,
          input.timezone,
        );
  occurrenceStarts.forEach((startsAt, index) => {
    const lessonId = input.offering?.lessonIds[index] ?? uid("lesson");
    const endsAt = new Date(
      new Date(startsAt).getTime() + input.service.durationMinutes * 60_000,
    ).toISOString();
    if (!draft.lessons.some((item) => item.id === lessonId))
      draft.lessons.push({
        id: lessonId,
        studioId: draft.studioId,
        studentId: student!.id,
        topic: input.offering?.title ?? input.service.name,
        startsAt,
        endsAt,
        status: "scheduled",
        locationType: input.location === "in_person" ? "in_person" : "virtual",
        locationLabel:
          input.location === "in_person"
            ? `${draft.settings.studioName} studio`
            : "Google Meet pending",
        serviceId: input.service.id,
        offeringId: input.offering?.id,
        seriesId,
        meetingProvider: input.location,
        capacity: input.offering?.capacity ?? 1,
        version: 1,
        updatedAt: now,
      });
    draft.lessonParticipants.push({
      id: uid("participant"),
      lessonId,
      bookingId: booking.id,
      studentId: student!.id,
      displayName: input.guestName,
      email: input.guestEmail.toLowerCase(),
      status: "confirmed",
    });
  });
  if (creditEntry)
    creditEntry.lessonId =
      input.offering?.lessonIds[0] ??
      draft.lessonParticipants.find((item) => item.bookingId === booking.id)
        ?.lessonId;
  if (paidMinor > 0 && input.paymentPolicy !== "credits")
    draft.payments.push({
      id: uid("payment"),
      studentId: student.id,
      kind: "payment",
      amountMinor: paidMinor,
      currency: input.service.currency,
      externalReference: `demo:${booking.id}`,
      reason: "Interactive demo payment",
      createdAt: now,
    });
  draft.outbox.push({
    id: uid("outbox"),
    studentId: student.id,
    channel: "email",
    recipient: input.guardianEmail || input.guestEmail,
    subject: `Your ${draft.settings.studioName} booking is confirmed`,
    body: `${input.service.name}\nManage booking: /booking/${manageToken}`,
    status: "sent",
    attempts: 1,
    version: 1,
    updatedAt: now,
  });
  return booking;
}

export function PublicBooking() {
  const { slug, token } = useParams();
  const store = useStudioStore();
  const [services, setServices] = useState(
    isDemoMode
      ? store.snapshot.bookingServices.filter((service) => service.published)
      : [],
  );
  const [offerings, setOfferings] = useState(
    isDemoMode ? store.snapshot.serviceOfferings : [],
  );
  const [liveCatalog, setLiveCatalog] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(!isDemoMode);
  const [catalogError, setCatalogError] = useState("");
  const [booker, setBooker] = useState<AuthenticatedBooker>();
  const [studio, setStudio] = useState<PublicStudio>({
    name: isDemoMode ? store.snapshot.settings.studioName : "Studio Portal",
    coachName: isDemoMode ? store.snapshot.settings.coachName : "",
    branding: store.snapshot.settings.branding,
    bookingCopy: store.snapshot.settings.bookingCopy,
    bookingPage: store.snapshot.settings.bookingPage,
    bookingDefaults: store.snapshot.settings.bookingDefaults,
    contactEmail: store.snapshot.settings.contactEmail,
  });
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!supabase) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const { data: owned } = await supabase
        .from("students")
        .select(
          "id,full_name,preferred_name,email,is_minor,guardian_name,guardian_email",
        )
        .eq("user_id", session.user.id)
        .limit(1)
        .maybeSingle();
      let student = owned;
      if (!student) {
        const { data: relation } = await supabase
          .from("student_relationships")
          .select("student_id")
          .eq("user_id", session.user.id)
          .limit(1)
          .maybeSingle();
        if (relation?.student_id) {
          const { data: related } = await supabase
            .from("students")
            .select(
              "id,full_name,preferred_name,email,is_minor,guardian_name,guardian_email",
            )
            .eq("id", relation.student_id)
            .maybeSingle();
          student = related;
        }
      }
      if (active && student)
        setBooker({
          studentId: student.id,
          name: student.preferred_name || student.full_name,
          email:
            student.email || student.guardian_email || session.user.email || "",
          forMinor: Boolean(student.is_minor),
          guardianName: student.guardian_name || undefined,
          guardianEmail:
            student.guardian_email || session.user.email || undefined,
        });
    };
    void load();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(),
      timeout = window.setTimeout(() => controller.abort(), 12000);
    fetch("/api/v2/public/booking/services", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(
        (payload: {
          studio: PublicStudio;
          services: any[];
          offerings: any[];
        }) => {
          if (active) {
            setStudio({
              ...payload.studio,
              bookingDefaults: {
                ...store.snapshot.settings.bookingDefaults,
                ...payload.studio.bookingDefaults,
              },
            });
            setServices(payload.services.map(mapService));
            setOfferings(payload.offerings.map(mapOffering));
            setLiveCatalog(true);
            setCatalogError("");
          }
        },
      )
      .catch(() => {
        if (active) {
          setLiveCatalog(false);
          setCatalogError(
            "Booking is temporarily unavailable. No request or payment was submitted.",
          );
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);
  useEffect(() => {
    applyStudioBranding(studio.branding);
  }, [studio.branding]);
  useEffect(() => {
    document.title = catalogLoading
      ? "Booking"
      : `${studio.name} — ${slug ? "Book a session" : "Booking"}`;
  }, [catalogLoading, slug, studio.name]);
  if (token)
    return (
      <>
        {token.startsWith("demo-") && (
          <div className="demo-banner">
            <TriangleAlert />
            Interactive demo: this management link and its changes reset on
            refresh.
          </div>
        )}
        <ManageBooking token={token} services={services} studio={studio} />
      </>
    );
  const selected = services.find((service) => service.slug === slug);
  return (
    <main className="booking-public">
      <BookingHeader
        back={Boolean(selected)}
        studio={studio}
        booker={booker}
        loading={catalogLoading}
      />
      {!liveCatalog && isDemoMode && (
        <div className="demo-banner">
          <TriangleAlert />
          Interactive demo mode: changes work for this session, but payments,
          email, and calendar delivery require production integrations.
        </div>
      )}
      {catalogError && !isDemoMode && (
        <div className="catalog-error" role="alert">
          <strong>Booking could not load.</strong>
          <p>{catalogError}</p>
          <button
            className="booking-primary"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      )}
      {catalogLoading && !token && (
        <section
          className="booking-loading"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="booking-loading-copy">
            <span className="eyebrow">Live availability</span>
            <h1>Opening the booking calendar…</h1>
            <p>Loading services, pricing, and the studio’s current schedule.</p>
          </div>
          <div className="booking-loading-grid" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </section>
      )}
      {!catalogLoading && selected ? (
        <BookingFlow
          service={selected}
          offerings={offerings}
          live={liveCatalog}
          studio={studio}
          booker={booker}
        />
      ) : !catalogLoading ? (
        <LiveServiceCatalog services={services} studio={studio} />
      ) : null}
    </main>
  );
}

function BookingHeader({
  back,
  studio,
  booker,
  loading = false,
}: {
  back: boolean;
  studio: PublicStudio;
  booker?: AuthenticatedBooker;
  loading?: boolean;
}) {
  return (
    <header className="booking-topbar">
      <Link
        to="/book"
        aria-label={back ? "Back to services" : `${studio.name} home`}
      >
        {back ? (
          <ArrowLeft />
        ) : loading ? (
          <span className="wordmark" aria-hidden="true">Booking</span>
        ) : studio.branding.logoUrl ? (
          <img
            src={studio.branding.logoUrl}
            alt={studio.name}
            className="booking-logo"
          />
        ) : (
          <span className="wordmark">{studio.name}</span>
        )}
      </Link>
      <span>
        {studio.coachName
          ? `Book with ${studio.coachName.split(" ")[0]}`
          : "Book a lesson"}
      </span>
      {booker ? (
        <Link to="/portal">Booking as {booker.name}</Link>
      ) : (
        <Link to="/login?returnTo=%2Fbook">Student or guardian sign in</Link>
      )}
    </header>
  );
}

function LiveServiceCatalog({
  services,
  studio,
}: {
  services: BookingService[];
  studio: PublicStudio;
}) {
  return (
    <>
      <section className="booking-hero">
        <span className="eyebrow">
          <Sparkles />
          {studio.bookingCopy.eyebrow}
        </span>
        <h1>{studio.bookingCopy.headline}</h1>
        <p>{studio.bookingCopy.intro}</p>
        {studio.bookingPage.showCoachName && studio.coachName && (
          <p className="booking-coach">Coaching with {studio.coachName}</p>
        )}
        {studio.bookingPage.showTrustRow && (
          <div className="trust-row">
            <span>
              <ShieldCheck />
              Secure checkout
            </span>
            <span>
              <CalendarDays />
              Live availability
            </span>
            <span>
              <Video />
              Meet or studio
            </span>
          </div>
        )}
      </section>
      <section className="service-catalog" aria-labelledby="services-title">
        <div className="catalog-heading">
          <div>
            <span className="eyebrow">Ways to work together</span>
            <h2 id="services-title">Choose your session</h2>
          </div>
          <p>
            All times are shown in your timezone. You’ll review the full policy
            before confirming.
          </p>
        </div>
        <div className="service-grid">
          {services.map((service) => (
            <article
              key={service.id}
              className={`service-card ${service.category}`}
            >
              <div className="service-card-top">
                <span>{service.category.replaceAll("_", " ")}</span>
                <strong>
                  {studio.bookingDefaults.showPrices
                    ? `From ${formatMoney(service.priceMinor, service.currency)}`
                    : "Session details"}
                </strong>
              </div>
              <h3>{service.name}</h3>
              <p>{service.description}</p>
              <div className="service-meta">
                <span>
                  <Clock3 />
                  {service.durationMinutes} min
                </span>
                <span>
                  <MapPin />
                  {service.locationOptions
                    .map(
                      (item) =>
                        `${locationLabel(item)}${Number(service.locationPriceAdjustments[item] || 0) > 0 ? ` +${formatMoney(Number(service.locationPriceAdjustments[item]), service.currency)}` : ""}`,
                    )
                    .join(" · ")}
                </span>
              </div>
              <Link to={`/book/${service.slug}`}>
                {studio.bookingDefaults.bookingButtonLabel || "View times"}{" "}
                <ChevronRight />
              </Link>
            </article>
          ))}
        </div>
      </section>
      <footer className="booking-footer">
        <div>
          {studio.branding.logoUrl ? (
            <img
              src={studio.branding.logoUrl}
              alt={studio.name}
              className="booking-logo"
            />
          ) : (
            <div className="wordmark">{studio.name}</div>
          )}
          <p>{studio.contactEmail}</p>
        </div>
        {studio.bookingPage.footerWebsiteUrl && (
          <a
            href={studio.bookingPage.footerWebsiteUrl}
            target="_blank"
            rel="noreferrer"
          >
            {studio.bookingPage.footerWebsiteLabel}
          </a>
        )}
        <Link to="/terms">Terms and Conditions</Link>
      </footer>
    </>
  );
}

type Step = "format" | "time" | "details" | "payment" | "done";
function BookingFlow({
  service,
  offerings,
  live,
  studio,
  booker,
}: {
  service: BookingService;
  offerings: ServiceOffering[];
  live: boolean;
  studio: PublicStudio;
  booker?: AuthenticatedBooker;
}) {
  const store = useStudioStore();
  const [step, setStep] = useState<Step>("format");
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
  const [slot, setSlot] = useState<string>();
  const [name, setName] = useState(booker?.name || "");
  const [email, setEmail] = useState(booker?.email || "");
  const [phone, setPhone] = useState("");
  const [forMinor, setForMinor] = useState(booker?.forMinor || false);
  const [guardian, setGuardian] = useState(booker?.guardianName || "");
  const [guardianEmail, setGuardianEmail] = useState(
    booker?.guardianEmail || "",
  );
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<{
    reference: string;
    manageUrl?: string;
    demo: boolean;
    startsAt: string;
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
              label: `${new Date(offering.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${remainingCapacity(offering.capacity, offering.enrolled)} spots`,
            })),
    [
      offerings,
      service,
      store.snapshot.availabilityExceptions,
      store.snapshot.availabilityRules,
      store.snapshot.lessons,
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
            label: new Date(item.startsAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
          })),
        ),
      )
      .catch((reason) =>
        setError(
          reason.message || "Live availability is temporarily unavailable.",
        ),
      );
  }, [demoSlots, live, service.category, service.id]);
  const dayKey = (value: string | Date) => {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
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
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
            timezone,
          }),
        );
        setConfirmed({
          reference: booking.reference,
          manageUrl: `/booking/${booking.manageToken}`,
          demo: true,
          startsAt: chosen.startsAt,
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
          timezone,
          occurrenceCount: recurrence === "none" ? undefined : 6,
          termsAccepted: true,
          termsVersion: "2026-08-20",
          discountCode: discountCode.trim() || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.message || "The booking could not be confirmed.",
        );
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      setConfirmed({
        reference: result.reference,
        manageUrl: result.manageUrl,
        demo: false,
        startsAt: chosen.startsAt,
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
              Times shown in{" "}
              {Intl.DateTimeFormat()
                .resolvedOptions()
                .timeZone.replaceAll("_", " ")}
              .
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
                      aria-label={`${day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}${count ? `, ${count} times available` : ", unavailable"}`}
                    >
                      <small>
                        {day.toLocaleDateString([], { month: "short" })}
                      </small>
                      <strong>{day.getDate()}</strong>
                      {count > 0 && <i>{count}</i>}
                    </button>
                  );
                })}
              </div>
            </div>
            {selectedDay && (
              <h3>
                {new Date(`${selectedDay}T12:00:00`).toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
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
            <label className="booking-discount">
              Coupon or discount code
              <input
                value={discountCode}
                onChange={(event) =>
                  setDiscountCode(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9_-]/g, ""),
                  )
                }
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
  result,
  message,
}: {
  service: BookingService;
  slot: string;
  name: string;
  result: { reference: string; manageUrl?: string; demo: boolean };
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

function ManageBooking({
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
            label: new Date(item.startsAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
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
