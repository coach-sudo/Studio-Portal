import { CalendarClock, MoreHorizontal } from "lucide-react";
import { Status } from "../../components/Primitives";
import type { RecurringSeries, StudioSnapshot } from "../../domain/model";
import { formatStudioDate } from "../../domain/presentation";

import { CoachPanel } from "./BookingPanel";

export function Series({
  data,
  onManage,
}: {
  data: StudioSnapshot;
  onManage: (item: RecurringSeries) => void;
}) {
  return (
    <CoachPanel
      title="Recurring students"
      aside={<span className="status good">Rolling 12 weeks</span>}
    >
      <div className="series-list">
        {data.recurringSeries.map((series) => {
          const student = data.students.find(
            (item) => item.id === series.studentId,
          );
          const service = data.bookingServices.find(
            (item) => item.id === series.serviceId,
          );
          return (
            <article key={series.id}>
              <span className="series-icon">
                <CalendarClock />
              </span>
              <div>
                <strong>{student?.fullName ?? "Course cohort"}</strong>
                <small>
                  {service?.name} · {series.cadence} · {series.kind}
                </small>
              </div>
              <div>
                <strong>
                  {series.nextBillingAt
                    ? formatStudioDate(
                        series.nextBillingAt,
                        data.settings.timezone,
                      )
                    : "Paid upfront"}
                </strong>
                <small>next billing</small>
              </div>
              <Status tone={series.status === "active" ? "good" : "warn"}>
                {series.status.replaceAll("_", " ")}
              </Status>
              <button
                aria-label="Manage series"
                onClick={() => onManage(series)}
              >
                <MoreHorizontal />
              </button>
            </article>
          );
        })}
      </div>
    </CoachPanel>
  );
}
