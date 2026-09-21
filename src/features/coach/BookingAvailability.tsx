import { CalendarDays, Edit3, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { EmptyState, Status } from "../../components/Primitives";
import type { AvailabilityRule, StudioSnapshot } from "../../domain/model";
import { formatStudioDate } from "../../domain/presentation";

import { uid } from "./BookingCenter.shared";
import { CoachPanel } from "./BookingPanel";

export function Availability({
  data,
  onSaveVisibility,
  onRule,
  onException,
  onDeleteRule,
  onDeleteException,
}: {
  data: StudioSnapshot;
  onSaveVisibility: (percent: 100 | 90 | 75) => Promise<void>;
  onRule: (item: AvailabilityRule) => void;
  onException: () => void;
  onDeleteRule: (item: AvailabilityRule) => void;
  onDeleteException: (
    item: StudioSnapshot["availabilityExceptions"][number],
  ) => void;
}) {
  const [visibility, setVisibility] = useState<100 | 90 | 75>(
    data.settings.bookingDefaults.visibleSlotsPercent,
  );
  const [savingVisibility, setSavingVisibility] = useState(false);
  const names = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return (
    <div className="availability-layout">
      <CoachPanel title="Public slot visibility">
        <div className="settings-form">
          <label>
            Show this share of open times
            <select
              value={visibility}
              onChange={(event) =>
                setVisibility(Number(event.target.value) as 100 | 90 | 75)
              }
            >
              <option value={100}>100% of open slots</option>
              <option value={90}>About 90% of open slots</option>
              <option value={75}>About 75% of open slots</option>
            </select>
            <small>
              Held-back slots stay free on your calendar but are unavailable
              through online booking. The same times stay hidden for every
              visitor.
            </small>
          </label>
          <div className="form-actions">
            <button
              className="primary"
              type="button"
              disabled={
                savingVisibility ||
                visibility === data.settings.bookingDefaults.visibleSlotsPercent
              }
              onClick={async () => {
                setSavingVisibility(true);
                try {
                  await onSaveVisibility(visibility);
                } finally {
                  setSavingVisibility(false);
                }
              }}
            >
              {savingVisibility ? "Saving…" : "Save visibility"}
            </button>
          </div>
        </div>
      </CoachPanel>
      <CoachPanel
        title="Weekly hours"
        aside={
          <span className="status neutral">
            <Settings2 />
            {data.settings.timezone}
          </span>
        }
      >
        <div className="hours-list">
          {names.map((name, index) => {
            const rules = data.availabilityRules
              .filter((item) => item.weekday === index)
              .sort((a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal));
            return (
              <article key={name} className={!rules.length ? "off" : ""}>
                <strong>{name}</strong>
                <div className="availability-windows">
                  {rules.length ? (
                    rules.map((rule) => (
                      <span key={rule.id}>
                        {rule.startsAtLocal} – {rule.endsAtLocal}
                        <button
                          aria-label={`Edit ${name} ${rule.startsAtLocal}`}
                          onClick={() => onRule(rule)}
                        >
                          <Edit3 />
                        </button>
                        <button
                          aria-label={`Delete ${name} ${rule.startsAtLocal}`}
                          onClick={() => onDeleteRule(rule)}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  ) : (
                    <span>Unavailable</span>
                  )}
                </div>
                <button
                  aria-label={`Add ${name}`}
                  onClick={() =>
                    onRule({
                      id: uid("rule"),
                      studioId: data.studioId,
                      weekday: index,
                      startsAtLocal: "12:00",
                      endsAtLocal: "18:00",
                      timezone: data.settings.timezone,
                      active: true,
                      version: 1,
                      updatedAt: new Date().toISOString(),
                    })
                  }
                >
                  <Plus />
                </button>
              </article>
            );
          })}
        </div>
      </CoachPanel>
      <CoachPanel
        title="Blackouts & exceptions"
        aside={
          <button className="small-primary" onClick={onException}>
            <Plus />
            Add
          </button>
        }
      >
        <div className="exception-list">
          {data.availabilityExceptions.map((item) => (
            <article key={item.id}>
              <CalendarDays />
              <div>
                <strong>{item.label}</strong>
                <small>
                  {formatStudioDate(item.startsAt, data.settings.timezone)} –{" "}
                  {formatStudioDate(item.endsAt, data.settings.timezone)}
                </small>
              </div>
              <Status tone={item.kind === "unavailable" ? "warn" : "good"}>
                {item.kind}
              </Status>
              <button
                aria-label={`Delete ${item.label}`}
                onClick={() => onDeleteException(item)}
              >
                ×
              </button>
            </article>
          ))}
          {!data.availabilityExceptions.length && (
            <EmptyState
              title="No exceptions"
              detail="Blackouts, vacations, and special availability will appear here."
            />
          )}
        </div>
      </CoachPanel>
    </div>
  );
}
