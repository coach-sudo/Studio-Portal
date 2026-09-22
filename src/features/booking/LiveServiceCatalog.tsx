import {
  CalendarDays,
  ChevronRight,
  Clock3,
  MapPin,
  ShieldCheck,
  Sparkles,
  Video,
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatMoney } from "../../domain/finance";
import type { BookingService } from "../../domain/model";

import { locationLabel, type PublicStudio } from "./PublicBooking.shared";
import { serviceCatalogPriceLabel } from "./pricePresentation";

export function LiveServiceCatalog({
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
                    ? serviceCatalogPriceLabel(service)
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
