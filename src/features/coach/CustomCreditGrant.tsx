import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { studioCommand } from "../../data/bookingCommands";
import { Dialog } from "../../components/Primitives";
import type { BookingService } from "../../domain/model";
import { invalidateStudioDomains } from "../../hooks/useStudio";

export function CustomCreditGrant({
  studentId,
  services,
}: {
  studentId: string;
  services: BookingService[];
}) {
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [minutes, setMinutes] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expires, setExpires] = useState("");
  const [reason, setReason] = useState("");
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const intent = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const client = useQueryClient();
  const id = useId();
  const selected = services.find((service) => service.id === serviceId);
  async function submit() {
    if (!selected || busy) return;
    if (!reviewed) {
      setReviewed(true);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        studentId,
        quantity: Number(quantity),
        reason: reason.trim(),
        portalVisible: visible,
        customTerms: {
          serviceId,
          durationMinutes: Number(minutes),
          expiresAt: expires ? new Date(expires).toISOString() : null,
        },
      };
      const signature = JSON.stringify(payload);
      if (intent.current?.signature !== signature)
        intent.current = { signature, key: crypto.randomUUID() };
      await studioCommand("credits", {
        command: "grant",
        expectedVersion: 0,
        reason: payload.reason,
        payload,
        idempotencyKey: intent.current.key,
      });
      intent.current = undefined;
      setOpen(false);
      setReviewed(false);
      setQuantity("");
      setReason("");
      setMessage("Discretionary credits granted.");
      await Promise.all([
        invalidateStudioDomains(client, ["finance", "lessons"]),
        ...[
          "credit-coverage",
          "student-credit-history",
          "credit-attention",
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The credit grant could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setMessage("");
        }}
      >
        Grant discretionary credits
      </button>
      {open && (
        <Dialog
          title="Grant discretionary credits"
          onClose={() => {
            if (!busy) {
              setOpen(false);
              setReviewed(false);
            }
          }}
        >
          <form
            className="workflow-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {reviewed ? (
              <>
                <p>
                  {quantity} credits · {selected?.name} · {minutes} minutes
                </p>
                <p>
                  {expires
                    ? "Expires " + new Date(expires).toLocaleString()
                    : "No expiration"}
                </p>
                <p>{reason}</p>
                <button
                  type="button"
                  onClick={() => setReviewed(false)}
                  disabled={busy}
                >
                  Back to edit
                </button>
              </>
            ) : (
              <>
                <label htmlFor={id + "-service"}>
                  Eligible lesson service
                  <select
                    id={id + "-service"}
                    required
                    value={serviceId}
                    onChange={(event) => {
                      const service = services.find(
                        (item) => item.id === event.target.value,
                      );
                      setServiceId(event.target.value);
                      setMinutes(
                        service ? String(service.durationMinutes) : "",
                      );
                    }}
                  >
                    <option value="">Choose a service</option>
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor={id + "-duration"}>
                  Eligible duration in minutes
                  <input
                    id={id + "-duration"}
                    type="number"
                    min={15}
                    max={480}
                    required
                    value={minutes}
                    onChange={(event) => setMinutes(event.target.value)}
                  />
                </label>
                <label htmlFor={id + "-qty"}>
                  Credits
                  <input
                    id={id + "-qty"}
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </label>
                <label htmlFor={id + "-expiry"}>
                  Expiration in your local time, if any
                  <input
                    id={id + "-expiry"}
                    type="datetime-local"
                    value={expires}
                    onChange={(event) => setExpires(event.target.value)}
                  />
                </label>
                <label htmlFor={id + "-reason"}>
                  Reason
                  <textarea
                    id={id + "-reason"}
                    required
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <label htmlFor={id + "-visible"}>
                  <input
                    id={id + "-visible"}
                    type="checkbox"
                    checked={visible}
                    onChange={(event) => setVisible(event.target.checked)}
                  />{" "}
                  Show grant in portal history
                </label>
              </>
            )}
            <button disabled={busy}>
              {reviewed ? "Confirm grant" : "Preview grant"}
            </button>
            {message && <p role="status">{message}</p>}
          </form>
        </Dialog>
      )}
      {!open && message && <p role="status">{message}</p>}
    </>
  );
}
