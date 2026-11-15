import { useState, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Dialog } from "../../components/Primitives";
import { householdCreditCommand } from "../../data/householdCredits";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import type { BookingService } from "../../domain/model";

const detailsSchema = z.object({
  service_id: z.string().optional(),
  duration_minutes: z.string().optional(),
  starts_at: z.string().optional(),
  billing_arrangement: z.string().optional(),
  reason: z.string().optional(),
  timezone: z.string().optional(),
});
const draftSchema = z.object({
  id: z.string(),
  version: z.number(),
  details: detailsSchema,
  confirmed_lesson_id: z.string().nullable(),
});
type Draft = z.infer<typeof draftSchema>;

export function ManualLessonDrafts({
  studentId,
  timezone,
  services,
  onClose,
}: {
  studentId: string;
  timezone: string;
  services: BookingService[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    id: crypto.randomUUID(),
    version: 0,
    details: {},
    confirmed_lesson_id: null,
  }));
  const [start, setStart] = useState("");
  const [dirty, setDirty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const id = useId();
  const identity = usePrivateIdentity();
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["manual-lesson-drafts", identity, studentId],
    enabled: !!identity,
    queryFn: async ({ signal }) =>
      z
        .array(draftSchema)
        .parse(
          await householdCreditCommand(
            studentId,
            "manual_draft_list",
            {},
            signal,
          ),
        ),
  });
  const details = draft.details;
  const ready =
    !!details.service_id &&
    !!details.duration_minutes &&
    !!start &&
    !!details.billing_arrangement &&
    (details.reason?.trim().length ?? 0) >= 3;
  function edit(value: Partial<Draft["details"]>) {
    setDraft({ ...draft, details: { ...details, ...value } });
    setDirty(true);
  }
  async function save(confirm: boolean) {
    if (busy || (confirm && !ready)) return;
    setBusy(true);
    setNotice("");
    try {
      const fields = {
        ...details,
        starts_at: start ? new Date(start).toISOString() : "",
        timezone,
      };
      const saved =
        !dirty && confirm
          ? draft
          : draftSchema.parse(
              await householdCreditCommand(studentId, "manual_draft_save", {
                draftId: draft.id,
                version: draft.version,
                details: fields,
              }),
            );
      setDraft(saved);
      setDirty(false);
      await list.refetch();
      if (!confirm) {
        setNotice("Draft saved.");
        return;
      }
      const confirmed = draftSchema.parse(
        await householdCreditCommand(studentId, "manual_draft_confirm", {
          draftId: saved.id,
          version: saved.version,
        }),
      );
      if (!confirmed.confirmed_lesson_id)
        throw new Error("Confirmation could not be verified.");
      await Promise.all([
        invalidateStudioDomains(client, ["lessons", "booking", "finance"]),
        client.invalidateQueries({ queryKey: ["credit-coverage"] }),
        list.refetch(),
      ]);
      setNotice("Lesson confirmed and added to the schedule.");
      setDraft({
        id: crypto.randomUUID(),
        version: 0,
        details: {},
        confirmed_lesson_id: null,
      });
      setStart("");
      setDirty(true);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The lesson could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Schedule a lesson"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(true);
        }}
      >
        {list.isError && <p role="alert">Saved drafts could not be loaded.</p>}
        {!!list.data?.length && (
          <label htmlFor={id + "-draft"}>
            Saved drafts
            <select
              id={id + "-draft"}
              value={
                list.data.some((item) => item.id === draft.id) ? draft.id : ""
              }
              disabled={busy}
              onChange={(event) => {
                const next = list.data.find(
                  (item) => item.id === event.target.value,
                );
                setDirty(!next);
                if (!next) {
                  setDraft({
                    id: crypto.randomUUID(),
                    version: 0,
                    details: {},
                    confirmed_lesson_id: null,
                  });
                  setStart("");
                  return;
                }
                setDraft(next);
                const at = next.details.starts_at
                  ? new Date(next.details.starts_at)
                  : null;
                setStart(
                  at
                    ? new Date(at.getTime() - at.getTimezoneOffset() * 60000)
                        .toISOString()
                        .slice(0, 16)
                    : "",
                );
                setNotice("");
              }}
            >
              <option value="">New draft</option>
              {list.data.map((item) => (
                <option key={item.id} value={item.id}>
                  {services.find(
                    (service) => service.id === item.details.service_id,
                  )?.name ?? "Unclassified lesson"}{" "}
                  ·{" "}
                  {item.details.starts_at
                    ? new Date(item.details.starts_at).toLocaleString()
                    : "Time pending"}{" "}
                  · {item.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label htmlFor={id + "-service"}>
          Lesson service
          <select
            id={id + "-service"}
            value={details.service_id ?? ""}
            disabled={busy}
            onChange={(event) => {
              const service = services.find(
                (item) => item.id === event.target.value,
              );
              edit({
                service_id: event.target.value,
                duration_minutes: service
                  ? String(service.durationMinutes)
                  : "",
              });
            }}
          >
            <option value="">Select a service</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={id + "-duration"}>
          Duration in minutes
          <input
            id={id + "-duration"}
            type="number"
            value={details.duration_minutes ?? ""}
            min={15}
            max={480}
            disabled={busy}
            onChange={(event) => edit({ duration_minutes: event.target.value })}
          />
        </label>
        <label htmlFor={id + "-date"}>
          Start in your local time
          <input
            id={id + "-date"}
            type="datetime-local"
            value={start}
            disabled={busy}
            onChange={(event) => {
              setStart(event.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label htmlFor={id + "-billing"}>
          Billing arrangement
          <select
            id={id + "-billing"}
            value={details.billing_arrangement ?? ""}
            disabled={busy}
            onChange={(event) =>
              edit({ billing_arrangement: event.target.value })
            }
          >
            <option value="">Select an arrangement</option>
            <option value="credits">Prepaid credits</option>
            <option value="pay_later">Pay-as-you-go</option>
            <option value="custom">Custom separate payment</option>
            <option value="credit_exception">
              Coach-approved uncovered credit exception
            </option>
          </select>
        </label>
        <label htmlFor={id + "-reason"}>
          Reason
          <textarea
            id={id + "-reason"}
            value={details.reason ?? ""}
            maxLength={500}
            disabled={busy}
            onChange={(event) => edit({ reason: event.target.value })}
          />
        </label>
        {!ready && (
          <p>
            Choose a service, duration, time, billing arrangement, and reason to
            confirm.
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(false)}
          >
            Save draft
          </button>
          <button disabled={!ready || busy}>Confirm lesson</button>
        </div>
        {notice && <p role="status">{notice}</p>}
      </form>
    </Dialog>
  );
}
