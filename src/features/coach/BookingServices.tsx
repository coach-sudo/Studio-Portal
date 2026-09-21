import { Edit3, Plus } from "lucide-react";
import { Status } from "../../components/Primitives";
import { formatMoney } from "../../domain/finance";
import type { BookingService, StudioSnapshot } from "../../domain/model";

import { CoachPanel } from "./BookingPanel";

export function Services({
  data,
  onAdd,
  onEdit,
}: {
  data: StudioSnapshot;
  onAdd: () => void;
  onEdit: (item: BookingService) => void;
}) {
  return (
    <CoachPanel
      title="Booking services"
      aside={
        <button className="small-primary" onClick={onAdd}>
          <Plus />
          Add service
        </button>
      }
    >
      <div className="service-admin-grid">
        {data.bookingServices.map((service) => (
          <article key={service.id}>
            <header>
              <span>{service.category.replaceAll("_", " ")}</span>
              <Status tone={service.published ? "good" : "neutral"}>
                {service.published ? "published" : "draft"}
              </Status>
            </header>
            <h3>{service.name}</h3>
            <p>
              {service.durationMinutes} min ·{" "}
              {formatMoney(service.priceMinor, service.currency)} ·{" "}
              {service.locationOptions
                .map((item) => (item === "google_meet" ? "Meet" : "Studio"))
                .join(" / ")}
            </p>
            <div className="policy-chips">
              <span>{service.minimumNoticeHours}h notice</span>
              <span>{service.bufferAfterMinutes}m buffer</span>
              <span>{service.paymentPolicies.length} payment options</span>
            </div>
            <footer>
              {service.published && (
                <a
                  className="button-link"
                  href={`/book/${service.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Direct link
                </a>
              )}
              <button onClick={() => onEdit(service)}>
                <Edit3 />
                Edit
              </button>
            </footer>
          </article>
        ))}
      </div>
    </CoachPanel>
  );
}
