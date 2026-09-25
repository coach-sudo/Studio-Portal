import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { applyStudioBranding } from "../../lib/branding";
import { isDemoMode, supabase } from "../../lib/supabase";
import { useStudioStore } from "../../state/StudioStore";

import { BookingFlow } from "./BookingFlow";
import { BookingHeader } from "./BookingHeader";
import { LiveServiceCatalog } from "./LiveServiceCatalog";
import { ManageBooking } from "./ManageBooking";
import {
  mapOffering,
  mapService,
  type AuthenticatedBooker,
  type PublicStudio,
} from "./PublicBooking.shared";

export function PublicBooking() {
  const { slug, token } = useParams();
  const [searchParams] = useSearchParams();
  const initialOfferingId = searchParams.get("offering") || undefined;
  const incomingReferralCode = searchParams.get("ref")?.trim().toUpperCase();
  const referralCode =
    incomingReferralCode ||
    window.sessionStorage.getItem("studio-referral-code") ||
    "";
  const incomingDiscountCode = searchParams
    .get("discount")
    ?.trim()
    .toUpperCase();
  const rewardDiscountCode =
    incomingDiscountCode ||
    window.sessionStorage.getItem("studio-reward-code") ||
    "";
  useEffect(() => {
    if (incomingReferralCode)
      window.sessionStorage.setItem(
        "studio-referral-code",
        incomingReferralCode,
      );
  }, [incomingReferralCode]);
  useEffect(() => {
    if (incomingDiscountCode)
      window.sessionStorage.setItem("studio-reward-code", incomingDiscountCode);
  }, [incomingDiscountCode]);
  const store = useStudioStore();
  const [services, setServices] = useState(
    isDemoMode
      ? store.snapshot.bookingServices.filter(
          (service) => service.published && service.category !== "course",
        )
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
    const sessionRequest = supabase
      ? supabase.auth.getSession()
      : Promise.resolve({ data: { session: null } } as any);
    sessionRequest
      .then(({ data }) =>
        fetch("/api/v2/public/booking/services", {
          signal: controller.signal,
          headers: data.session
            ? { Authorization: `Bearer ${data.session.access_token}` }
            : undefined,
        }),
      )
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
      ? "Booking · Coach’D"
      : `${studio.name} — ${slug ? "Book a session" : "Booking"} · Coach’D`;
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
          initialOfferingId={initialOfferingId}
          live={liveCatalog}
          studio={studio}
          booker={booker}
          initialReferralCode={referralCode}
          initialDiscountCode={rewardDiscountCode}
        />
      ) : !catalogLoading ? (
        <LiveServiceCatalog services={services} studio={studio} />
      ) : null}
    </main>
  );
}
