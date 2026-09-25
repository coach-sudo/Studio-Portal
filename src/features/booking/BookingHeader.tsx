import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

import {
  type AuthenticatedBooker,
  type PublicStudio,
} from "./PublicBooking.shared";

export function BookingHeader({
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
          <span className="wordmark" aria-hidden="true">
            Booking
          </span>
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
