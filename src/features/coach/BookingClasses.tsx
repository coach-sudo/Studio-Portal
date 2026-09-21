import { Plus } from "lucide-react";
import { remainingCapacity } from "../../domain/booking";
import type { ServiceOffering, StudioSnapshot } from "../../domain/model";
import {
  formatStudioDate,
  formatStudioDateTime,
} from "../../domain/presentation";

import { CoachPanel } from "./BookingPanel";

export function Classes({
  data,
  onCreate,
  onOpen,
  onRoster,
}: {
  data: StudioSnapshot;
  onCreate: () => void;
  onOpen: (item: ServiceOffering) => void;
  onRoster: (item: ServiceOffering) => void;
}) {
  return (
    <CoachPanel
      title="Group classes"
      aside={
        <button className="small-primary" onClick={onCreate}>
          <Plus />
          Create offering
        </button>
      }
    >
      <div className="offering-grid">
        {data.serviceOfferings
          .filter(
            (offering) =>
              data.bookingServices.find(
                (service) => service.id === offering.serviceId,
              )?.category === "group_class",
          )
          .map((offering) => {
            const service = data.bookingServices.find(
              (item) => item.id === offering.serviceId,
            );
            const remaining = remainingCapacity(
              offering.capacity,
              offering.enrolled,
            );
            return (
              <article key={offering.id}>
                <div className="offering-date">
                  <span>
                    {formatStudioDate(
                      offering.startsAt,
                      data.settings.timezone,
                      {
                        month: "short",
                      },
                    )}
                  </span>
                  <strong>
                    {formatStudioDate(
                      offering.startsAt,
                      data.settings.timezone,
                      { day: "numeric", month: undefined, year: undefined },
                    )}
                  </strong>
                </div>
                <div>
                  <span className="eyebrow">
                    {service?.category.replaceAll("_", " ")}
                  </span>
                  <h3>{offering.title}</h3>
                  <p>
                    {formatStudioDateTime(
                      offering.startsAt,
                      data.settings.timezone,
                      {
                        weekday: "long",
                        month: undefined,
                        day: undefined,
                        year: undefined,
                        hour: "numeric",
                        minute: "2-digit",
                      },
                    )}{" "}
                    ·{" "}
                    {service?.defaultLocation === "google_meet"
                      ? "Google Meet"
                      : "Studio"}
                  </p>
                  <div className="capacity-bar">
                    <i
                      style={{
                        width: `${(offering.enrolled / offering.capacity) * 100}%`,
                      }}
                    />
                    <span>
                      {offering.enrolled} enrolled · {remaining} spots left
                    </span>
                  </div>
                </div>
                <div className="offering-actions">
                  <button className="primary" onClick={() => onOpen(offering)}>
                    Open class
                  </button>
                  <button onClick={() => onRoster(offering)}>Roster</button>
                  {offering.published && service?.slug && (
                    <a
                      className="button-link"
                      href={`/book/${service.slug}?offering=${encodeURIComponent(offering.id)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Direct link
                    </a>
                  )}
                </div>
              </article>
            );
          })}
      </div>
    </CoachPanel>
  );
}
